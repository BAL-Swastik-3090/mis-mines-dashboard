"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, X, SlidersHorizontal, ArrowUp, ArrowDown, ChevronsUpDown, Check,
  Filter, ListFilter, ChevronRight,
} from "lucide-react";
import type { PrPoRow } from "@/types";
import type { PrPoFilter } from "@/hooks/usePrPo";

/* The priority action register.

   A REQUISITION IS THE UNIT OF WORK, NOT A LINE OF ONE. PR 1600003149 is
   eighteen spare parts on one order from one buyer, and listing it as
   eighteen rows said "eighteen things need chasing" when it is one. So the
   table opens a row per PR, carrying what the meeting asks -- how far it
   has got, what is holding it, who has it, what it is worth -- and the
   items are underneath it when somebody wants them.

   EVERYTHING HERE HAPPENS IN THE BROWSER. Sorting, searching and every
   filter work on rows that are already loaded; the server is asked again
   only when the "released from" date changes, because that is the one
   control that changes which rows exist.

   WHY THE STAGE HAS ITS OWN COLOUR AND THE AGE DOES NOT SHARE IT. Two
   different facts: where a case is, and whether it is late. Painted in one
   scale they compete -- a green "paid" badge beside a green "on track" badge
   says nothing twice. The stage runs along a cool-to-warm progression that
   follows the procurement sequence, so a column of pills shows the spread of
   the pipeline at a glance; lateness stays red/amber/green and nothing else
   on the row uses those three. */

/* The procurement sequence, in order. The progress bar and "what is
   holding this PR" both read off this: the furthest-behind item is the one
   that decides when the requisition is finished. */
const STAGE_ORDER = [
  "UNASSIGNED", "ASSIGNED", "RFQ_ISSUED", "QUOTES_IN", "EVALUATION",
  "NFA_PENDING", "NFA_APPROVED", "PO_CREATED", "PO_RELEASED", "RECEIVED",
  "INVOICED", "PAID",
] as const;
const STAGE_AT = new Map(STAGE_ORDER.map((s, i) => [s as string, i]));
const rank = (s: string) => STAGE_AT.get(s) ?? 0;

const STAGE_TONE: Record<string, string> = {
  UNASSIGNED:   "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
  ASSIGNED:     "bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
  RFQ_ISSUED:   "bg-cyan-100 text-cyan-800 ring-cyan-300 dark:bg-cyan-950 dark:text-cyan-200 dark:ring-cyan-800",
  QUOTES_IN:    "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-800",
  EVALUATION:   "bg-indigo-100 text-indigo-800 ring-indigo-300 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-800",
  NFA_PENDING:  "bg-violet-100 text-violet-800 ring-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800",
  NFA_APPROVED: "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-300 dark:bg-fuchsia-950 dark:text-fuchsia-200 dark:ring-fuchsia-800",
  PO_CREATED:   "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  PO_RELEASED:  "bg-orange-100 text-orange-900 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800",
  RECEIVED:     "bg-lime-100 text-lime-900 ring-lime-300 dark:bg-lime-950 dark:text-lime-200 dark:ring-lime-800",
  INVOICED:     "bg-emerald-100 text-emerald-900 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  PAID:         "bg-slate-200 text-slate-600 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600",
};

/* The same progression as a solid fill, for the bar. */
const STAGE_FILL: Record<string, string> = {
  UNASSIGNED: "bg-slate-300 dark:bg-slate-600",
  ASSIGNED: "bg-sky-400", RFQ_ISSUED: "bg-cyan-400", QUOTES_IN: "bg-teal-400",
  EVALUATION: "bg-indigo-400", NFA_PENDING: "bg-violet-400",
  NFA_APPROVED: "bg-fuchsia-400", PO_CREATED: "bg-amber-400",
  PO_RELEASED: "bg-orange-400", RECEIVED: "bg-lime-500",
  INVOICED: "bg-emerald-500", PAID: "bg-emerald-600",
};

const RAG_TONE: Record<string, string> = {
  red:     "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900",
  amber:   "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900",
  green:   "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900",
  unknown: "bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700",
};
const RAG_WORD: Record<string, string> = {
  red: "Overdue", amber: "Due soon", green: "On track", unknown: "No target",
};
const RAG_RANK: Record<string, number> = { red: 0, amber: 1, green: 2, unknown: 3 };

function crore(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}
const exact = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : `₹ ${Math.round(v).toLocaleString("en-IN")}`;

/* Dates as "05 Nov 26". ISO is unambiguous and unreadable in a column of
   forty; the month as letters removes the day/month ambiguity that a
   numeric format leaves for anyone reading across conventions. */
function shortDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-GB",
    { day: "2-digit", month: "short", year: "2-digit" });
}

const Dash = () => <span className="text-slate-300 dark:text-slate-600">—</span>;
const txt = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? <Dash /> : <>{v}</>;

/* ── one requisition ───────────────────────────────────────────────────
   MONEY IS NOT SUMMED THE SAME WAY DOWN EVERY COLUMN, because SAP does not
   record it at the same grain. po_value belongs to the line and adds up.
   invoiced, paid and outstanding belong to the PURCHASE ORDER and are
   repeated on each of its lines -- PR 1600003354 shows ₹76,095.80
   outstanding against both of its items because that is one invoice, not
   two. Adding those down the column reports ₹277 Cr against the register's
   real ₹151 Cr, so they are counted once per PO. */
interface PrGroup {
  pr: string;
  items: PrPoRow[];
  lead: PrPoRow;          // the furthest-behind item: what is holding the PR
  rag: string;            // the worst of them
  age: number | null;     // the longest any item has sat in its stage
  po_value: number | null;
  invoiced: number | null;
  paid: number | null;
  outstanding: number | null;
  pos: string[];
  /* One of this PR's POs also sits on another PR. The invoice belongs to
     the PO, so the figure on THIS row is right, but the column cannot be
     added up -- 16 of the 523 POs here cover more than one requisition,
     and totalling the column reports 153.93 Cr against the register's real
     151.43 Cr. Marked rather than hidden: the reader needs the number, and
     needs to know not to add it. */
  shared: string[];
  spread: { stage: string; n: number }[];
}

function oncePerPo(items: PrPoRow[], field: keyof PrPoRow): number | null {
  const seen = new Set<string>();
  let total = 0, any = false;
  for (const r of items) {
    const po = r.po_no;
    if (po) { if (seen.has(po)) continue; seen.add(po); }
    const v = r[field] as number | null | undefined;
    if (v !== null && v !== undefined) { total += v; any = true; }
  }
  return any ? total : null;
}

function group(rows: PrPoRow[]): PrGroup[] {
  const by = new Map<string, PrPoRow[]>();
  const poPrs = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = r.pr_number;
    const list = by.get(k);
    if (list) list.push(r); else by.set(k, [r]);
    if (r.po_no) {
      const set = poPrs.get(r.po_no);
      if (set) set.add(k); else poPrs.set(r.po_no, new Set([k]));
    }
  }
  const out: PrGroup[] = [];
  for (const [pr, items] of by) {
    const sorted = [...items].sort((a, b) =>
      a.pr_item.localeCompare(b.pr_item, "en", { numeric: true }));
    const lead = sorted.reduce((w, r) => rank(r.stage) < rank(w.stage) ? r : w, sorted[0]);
    const ages = sorted.map((r) => r.stage_age_days).filter((v): v is number => v !== null);
    const tally = new Map<string, number>();
    for (const r of sorted) tally.set(r.stage, (tally.get(r.stage) ?? 0) + 1);
    const vals = sorted.map((r) => r.po_value).filter((v): v is number => v !== null && v !== undefined);
    const pos = [...new Set(sorted.map((r) => r.po_no).filter(Boolean) as string[])];
    out.push({
      pr, items: sorted, lead,
      rag: sorted.reduce((w, r) =>
        (RAG_RANK[r.rag] ?? 3) < (RAG_RANK[w] ?? 3) ? r.rag : w, "unknown"),
      age: ages.length ? Math.max(...ages) : null,
      po_value: vals.length ? vals.reduce((a, b) => a + b, 0) : null,
      invoiced: oncePerPo(sorted, "invoiced_value"),
      paid: oncePerPo(sorted, "paid_amount"),
      outstanding: oncePerPo(sorted, "outstanding"),
      pos,
      shared: pos.filter((po) => (poPrs.get(po)?.size ?? 1) > 1),
      spread: [...tally.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]))
        .map(([stage, n]) => ({ stage, n })),
    });
  }
  return out;
}

/* One value if every item agrees, otherwise null -- rendered as "3 values"
   rather than silently showing the first, which would make a PR spread
   across three cost centres look like it sat in one. */
function same<T>(items: PrPoRow[], f: (r: PrPoRow) => T): T | null {
  const set = new Set(items.map(f).filter((v) => v !== null && v !== undefined && v !== ""));
  return set.size === 1 ? ([...set][0] as T) : null;
}
const Mixed = ({ n }: { n: number }) =>
  <span className="text-[11px] italic text-slate-400">{n} values</span>;

function many<T>(g: PrGroup, f: (r: PrPoRow) => T,
                 draw: (v: T) => React.ReactNode): React.ReactNode {
  const v = same(g.items, f);
  if (v !== null) return draw(v);
  const n = new Set(g.items.map(f).filter((x) => x !== null && x !== undefined && x !== "")).size;
  return n === 0 ? <Dash /> : <Mixed n={n} />;
}

/* `pick` is what a header filter lists and matches on: the column's value as
   a word, not as it is painted. Columns that are a number or a date are left
   out -- a list of 2,190 distinct rupee figures is not a filter, and the
   toolbar already carries the range controls those columns would want.

   `agg` draws the PR row, `sortOn` orders PR rows. A column with neither
   still shows on the item rows underneath. */
type Col = {
  key: string;
  head: string;
  group: string;
  pick?: (r: PrPoRow) => string;
  sort?: string;                       // item-level field, server's spelling
  sortOn?: (g: PrGroup) => number | string | null;
  align?: "right";
  core?: boolean;
  width?: string;
  render: (r: PrPoRow) => React.ReactNode;
  agg?: (g: PrGroup) => React.ReactNode;
};

const AgeBadge = ({ days, rag }: { days: number | null; rag: string }) => (
  <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${RAG_TONE[rag] ?? RAG_TONE.unknown}`}>
    {days === null ? "—" : `${days}d`} · {RAG_WORD[rag] ?? "—"}
  </span>
);
const StagePill = ({ stage, label }: { stage: string; label: string }) => (
  <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${STAGE_TONE[stage] ?? STAGE_TONE.UNASSIGNED}`}>
    {label}
  </span>
);

export const COLUMNS: Col[] = [
  { key: "age", head: "Age", group: "Status", sort: "stage_age_days", core: true, width: "w-28",
    pick: (r) => RAG_WORD[r.rag] ?? "—",
    sortOn: (g) => g.age,
    render: (r) => <AgeBadge days={r.stage_age_days} rag={r.rag} />,
    agg: (g) => <AgeBadge days={g.age} rag={g.rag} /> },

  { key: "stage", head: "Stage", group: "Status", sort: "stage", core: true, width: "w-44",
    pick: (r) => r.stage_label ?? "",
    sortOn: (g) => rank(g.lead.stage),
    render: (r) => <StagePill stage={r.stage} label={r.stage_label} />,
    agg: (g) => (
      <div className="space-y-1">
        <StagePill stage={g.lead.stage} label={g.lead.stage_label} />
        {g.items.length > 1 && g.spread.length > 1 && (
          <div className="text-[10px] text-slate-400">
            + {g.items.length - (g.spread[0]?.n ?? 0)} further on
          </div>)}
      </div>) },

  { key: "next_action", head: "Next action", group: "Status", core: true, width: "w-52",
    pick: (r) => r.next_action ?? "",
    sortOn: (g) => g.lead.next_action ?? null,
    render: (r) => <span className="text-[13px]">{txt(r.next_action)}</span>,
    agg: (g) => <span className="text-[13px]">{txt(g.lead.next_action)}</span> },

  { key: "pending_with", head: "Pending with", group: "Status", sort: "pending_with", core: true, width: "w-44",
    pick: (r) => r.pending_with ?? "",
    sortOn: (g) => g.lead.pending_with ?? null,
    render: (r) => <span className="text-[13px]">{txt(r.pending_with)}</span>,
    agg: (g) => <span className="text-[13px]">{txt(g.lead.pending_with)}</span> },

  { key: "requested_by", head: "Requested by", group: "Requester", core: true, width: "w-36",
    pick: (r) => r.requisitioner || r.created_by || "",
    sortOn: (g) => g.lead.requisitioner || g.lead.created_by || null,
    render: (r) => <span className="text-[13px]">{txt(r.requisitioner || r.created_by)}</span>,
    agg: (g) => many(g, (r) => r.requisitioner || r.created_by || "",
                     (v) => <span className="text-[13px]">{txt(v)}</span>) },

  { key: "cost_center", head: "Cost centre", group: "Requester", width: "w-28",
    pick: (r) => r.cost_center ?? "",
    render: (r) => <span className="text-[13px] tabular-nums">{txt(r.cost_center)}</span>,
    agg: (g) => many(g, (r) => r.cost_center ?? "",
                     (v) => <span className="text-[13px] tabular-nums">{txt(v)}</span>) },

  { key: "plant", head: "Plant", group: "Requester", width: "w-20",
    pick: (r) => r.plant ?? "",
    render: (r) => <span className="text-[13px] tabular-nums">{txt(r.plant)}</span>,
    agg: (g) => many(g, (r) => r.plant ?? "",
                     (v) => <span className="text-[13px] tabular-nums">{txt(v)}</span>) },

  /* THE DEPARTMENT IS A TOOLTIP, NOT A SECOND LINE. "Spares parts,
     Planning & Contract Management" under every row of the same buyer is
     the same sentence repeated forty times down a column, and it pushed
     every row to two lines to say nothing new. The purchasing group code
     goes there instead: four characters, different per buyer, and the key
     anybody cross-referencing SAP actually needs. */
  { key: "buyer", head: "Buyer", group: "SCM", sort: "buyer_name", core: true, width: "w-40",
    pick: (r) => r.buyer_name ?? "",
    sortOn: (g) => g.lead.buyer_name ?? null,
    render: (r) => r.buyer_name ? (
      <div className="leading-tight"
           title={[r.buyer_name, r.buyer_department].filter(Boolean).join(" — ")}>
        <div className="truncate text-[13px]">{r.buyer_name}</div>
        {r.purchasing_group && (
          <div className="text-[11px] tabular-nums text-slate-400">{r.purchasing_group}</div>)}
      </div>) : <Dash />,
    agg: (g) => many(g, (r) => r.buyer_name ?? "", (v) => (
      <div className="leading-tight"
           title={[v, g.lead.buyer_department].filter(Boolean).join(" — ")}>
        <div className="truncate text-[13px]">{v}</div>
        {g.lead.purchasing_group && (
          <div className="text-[11px] tabular-nums text-slate-400">{g.lead.purchasing_group}</div>)}
      </div>)) },

  { key: "pr_dates", head: "PR / released", group: "SCM", sort: "release_date", width: "w-32",
    sortOn: (g) => g.lead.release_date ?? null,
    render: (r) => (
      <div className="leading-tight text-[12px] tabular-nums">
        <div>{shortDate(r.release_date)}</div>
        <div className="text-[11px] text-slate-500">raised {shortDate(r.pr_date)}</div>
      </div>),
    agg: (g) => (
      <div className="leading-tight text-[12px] tabular-nums">
        <div>{shortDate(g.lead.release_date)}</div>
        <div className="text-[11px] text-slate-500">raised {shortDate(g.lead.pr_date)}</div>
      </div>) },

  { key: "pr_age", head: "PR age", group: "SCM", sort: "pr_age_days", align: "right", width: "w-20",
    sortOn: (g) => g.lead.pr_age_days,
    render: (r) => <span className="text-[13px] tabular-nums">{r.pr_age_days === null ? <Dash /> : `${r.pr_age_days}d`}</span>,
    agg: (g) => <span className="text-[13px] tabular-nums">{g.lead.pr_age_days === null ? <Dash /> : `${g.lead.pr_age_days}d`}</span> },

  { key: "material", head: "Material group", group: "SCM", width: "w-40",
    pick: (r) => r.material_group ?? "",
    render: (r) => <span className="text-[12px]">{txt(r.material_group)}</span>,
    agg: (g) => many(g, (r) => r.material_group ?? "",
                     (v) => <span className="text-[12px]">{txt(v)}</span>) },

  { key: "qty", head: "Qty", group: "SCM", align: "right", width: "w-24",
    render: (r) => <span className="text-[13px] tabular-nums">
      {r.quantity === null ? <Dash /> : `${r.quantity.toLocaleString("en-IN")} ${r.unit ?? ""}`}</span>,
    /* Not summed. Eighteen spares in four units of measure do not add up to
       a number, and a figure that looks like one would be read as one. */
    agg: (g) => <span className="text-[11px] italic text-slate-400">{g.items.length} items</span> },

  { key: "rfq", head: "RFQ", group: "Sourcing", width: "w-28",
    render: (r) => r.rfq_count ? (
      <div className="leading-tight text-[12px]">
        <div>{r.rfq_count} RFQ · {r.rfq_vendors ?? 0} vendors</div>
        <div className="text-[11px] text-slate-500">{shortDate(r.rfq_issued_at)}</div>
      </div>) : <Dash />,
    /* RFQ, quotes and the NFA are recorded against the requisition, so the
       PR row shows them as they are rather than combining anything. */
    agg: (g) => g.lead.rfq_count ? (
      <div className="leading-tight text-[12px]">
        <div>{g.lead.rfq_count} RFQ · {g.lead.rfq_vendors ?? 0} vendors</div>
        <div className="text-[11px] text-slate-500">{shortDate(g.lead.rfq_issued_at)}</div>
      </div>) : <Dash /> },

  { key: "quotes", head: "Quotes", group: "Sourcing", align: "right", width: "w-20",
    render: (r) => <span className="text-[13px] tabular-nums">{txt(r.quotation_count)}</span>,
    agg: (g) => <span className="text-[13px] tabular-nums">{txt(g.lead.quotation_count)}</span> },

  { key: "nfa", head: "NFA", group: "Sourcing", width: "w-40",
    pick: (r) => r.nfa_status ?? "",
    render: (r) => r.nfa_id ? (
      <div className="leading-tight text-[12px]">
        <div className="truncate">{r.nfa_status ?? "—"}</div>
        {r.approver_name && (
          <div className="truncate text-[11px] text-slate-500">
            {r.approver_name}{r.nfa_pending_days !== null ? ` · ${r.nfa_pending_days}d` : ""}
          </div>)}
      </div>) : <Dash />,
    agg: (g) => g.lead.nfa_id ? (
      <div className="leading-tight text-[12px]">
        <div className="truncate">{g.lead.nfa_status ?? "—"}</div>
        {g.lead.approver_name && (
          <div className="truncate text-[11px] text-slate-500">
            {g.lead.approver_name}{g.lead.nfa_pending_days !== null ? ` · ${g.lead.nfa_pending_days}d` : ""}
          </div>)}
      </div>) : <Dash /> },

  { key: "po", head: "PO", group: "Order", sort: "po_date", core: true, width: "w-36",
    pick: (r) => r.po_no ?? "",
    sortOn: (g) => g.lead.po_date ?? null,
    render: (r) => r.po_no ? (
      <div className="leading-tight">
        <div className="text-[13px] font-medium tabular-nums">{r.po_no}</div>
        <div className="text-[11px] text-slate-500">{shortDate(r.po_date)}</div>
      </div>) : <Dash />,
    agg: (g) => g.pos.length === 0 ? <Dash /> : g.pos.length === 1 ? (
      <div className="leading-tight">
        <div className="text-[13px] font-medium tabular-nums">{g.pos[0]}</div>
        <div className="text-[11px] text-slate-500">{shortDate(g.lead.po_date)}</div>
      </div>) : (
      <div className="leading-tight" title={g.pos.join(", ")}>
        <div className="text-[13px] font-medium tabular-nums">{g.pos.length} POs</div>
        <div className="truncate text-[11px] text-slate-500">{g.pos[0]} …</div>
      </div>) },

  { key: "vendor", head: "Vendor", group: "Order", sort: "vendor", width: "w-48",
    pick: (r) => r.vendor ?? "",
    render: (r) => <span className="text-[13px]">{txt(r.vendor)}</span>,
    agg: (g) => many(g, (r) => r.vendor ?? "",
                     (v) => <span className="text-[13px]">{txt(v)}</span>) },

  { key: "po_value", head: "PO value", group: "Order", sort: "po_value", align: "right", core: true, width: "w-28",
    sortOn: (g) => g.po_value,
    render: (r) => <span className="text-[13px] tabular-nums" title={exact(r.po_value)}>{crore(r.po_value)}</span>,
    agg: (g) => <span className="text-[13px] font-medium tabular-nums" title={exact(g.po_value)}>{crore(g.po_value)}</span> },

  { key: "delivery", head: "Delivery due", group: "Order", sort: "po_delivery_date", width: "w-28",
    render: (r) => r.po_delivery_date ? (
      <span className={`text-[12px] tabular-nums ${
        !r.delivery_complete && new Date(r.po_delivery_date) < new Date()
          ? "text-rose-600 dark:text-rose-400" : ""}`}>
        {shortDate(r.po_delivery_date)}{r.delivery_complete ? " ✓" : ""}
      </span>) : <Dash />,
    /* The earliest outstanding date, because that is the one that slips
       first. */
    agg: (g) => {
      const d = g.items.map((r) => r.po_delivery_date).filter(Boolean).sort()[0];
      if (!d) return <Dash />;
      return <span className={`text-[12px] tabular-nums ${
        new Date(d) < new Date() ? "text-rose-600 dark:text-rose-400" : ""}`}>
        {shortDate(d)}</span>;
    } },

  { key: "invoiced", head: "Invoiced", group: "Payment", align: "right", width: "w-28",
    render: (r) => <span className="text-[13px] tabular-nums" title={exact(r.invoiced_value)}>{crore(r.invoiced_value)}</span>,
    sortOn: (g) => g.invoiced,
    agg: (g) => <span className="text-[13px] tabular-nums" title={exact(g.invoiced)}>{crore(g.invoiced)}</span> },

  { key: "paid", head: "Paid", group: "Payment", align: "right", width: "w-28",
    render: (r) => <span className="text-[13px] tabular-nums" title={exact(r.paid_amount)}>{crore(r.paid_amount)}</span>,
    sortOn: (g) => g.paid,
    agg: (g) => <span className="text-[13px] tabular-nums" title={exact(g.paid)}>{crore(g.paid)}</span> },

  { key: "outstanding", head: "Outstanding", group: "Payment", sort: "outstanding", align: "right", core: true, width: "w-32",
    sortOn: (g) => g.outstanding,
    render: (r) => (r.outstanding ?? 0) > 0 ? (
      <span className={`text-[13px] font-medium tabular-nums ${
        r.overdue_payable ? "text-rose-600 dark:text-rose-400" : ""}`} title={exact(r.outstanding)}>
        {crore(r.outstanding)}
      </span>) : <Dash />,
    agg: (g) => (g.outstanding ?? 0) > 0 ? (
      <span className={`text-[13px] font-medium tabular-nums ${
        g.items.some((r) => r.overdue_payable) ? "text-rose-600 dark:text-rose-400" : ""}`}
        title={[
          exact(g.outstanding),
          g.pos.length > 1 ? `across ${g.pos.length} POs` : "",
          g.shared.length
            ? `${g.shared.join(", ")} also covers another requisition, so this `
              + `balance is shared and must not be added to other rows`
            : "",
        ].filter(Boolean).join(" — ")}>
        {crore(g.outstanding)}
        {g.shared.length > 0 && (
          <span className="ml-0.5 align-super text-[9px] font-normal text-amber-600
                           dark:text-amber-400">shared</span>)}
      </span>) : <Dash /> },

  { key: "due", head: "Due date", group: "Payment", sort: "due_date", width: "w-32",
    render: (r) => r.due_date ? (
      <span className={`text-[12px] tabular-nums ${r.overdue_payable ? "text-rose-600 dark:text-rose-400" : ""}`}>
        {shortDate(r.due_date)}
      </span>
    ) : (r.outstanding ?? 0) > 0 ? (
      /* An unknown due date is not an overdue one -- say which it is rather
         than leaving a blank the reader will fill in with the worse guess. */
      <span className="text-[11px] text-slate-500" title={r.payment_terms_desc ?? ""}>terms not stated</span>
    ) : <Dash />,
    agg: (g) => {
      const d = g.items.map((r) => r.due_date).filter(Boolean).sort()[0];
      if (!d) return (g.outstanding ?? 0) > 0
        ? <span className="text-[11px] text-slate-500">terms not stated</span> : <Dash />;
      return <span className={`text-[12px] tabular-nums ${
        g.items.some((r) => r.overdue_payable) ? "text-rose-600 dark:text-rose-400" : ""}`}>
        {shortDate(d)}</span>;
    } },

  { key: "terms", head: "Payment terms", group: "Payment", width: "w-44",
    pick: (r) => r.payment_terms_desc ?? "",
    render: (r) => <span className="text-[12px]">{txt(r.payment_terms_desc)}</span>,
    agg: (g) => many(g, (r) => r.payment_terms_desc ?? "",
                     (v) => <span className="text-[12px]">{txt(v)}</span>) },
];

const GROUPS = ["Status", "Requester", "SCM", "Sourcing", "Order", "Payment"];

/* The free-text box searches these, the same set the server used to. */
const SEARCH_FIELDS: (keyof PrPoRow)[] = [
  "pr_number", "po_no", "description", "vendor", "nfa_id", "created_by",
  "requisitioner", "buyer_name", "pending_with", "material_group", "cost_center",
];

const BLANK = "(blank)";

/* Rows are drawn a screenful at a time. The whole set is sorted and
   filtered -- the cap is on what reaches the DOM, not on what is
   considered. */
const PAGE = 100;

/* Missing values sort last in BOTH directions.
   The obvious comparator gets this wrong: making the key `[isNull, value]`
   and reversing it for descending flips the null flag too, so descending
   puts every empty row at the top and the column looks unsorted. Absent is
   not large and not small; it belongs at the end whichever way the column
   points, so the blanks are held aside and only the real values ordered. */
function sortBySelector<T>(xs: T[], of: (x: T) => number | string | null | undefined,
                           desc: boolean): T[] {
  const has: T[] = [], missing: T[] = [];
  for (const x of xs) {
    const v = of(x);
    (v === null || v === undefined || v === "" ? missing : has).push(x);
  }
  const dir = desc ? -1 : 1;
  has.sort((a, b) => {
    const x = of(a), y = of(b);
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y), "en", { numeric: true }) * dir;
  });
  return [...has, ...missing];
}

/* ── how far this requisition has got ───────────────────────────────────
   A segment per item, laid out in stage order and coloured by stage, so
   the bar shows both how far the PR has travelled and how far apart its
   items are. One item that never left the starting line is visible as a
   grey segment on an otherwise green bar, which is exactly the case a
   single "percent complete" number would hide. */
function Progress({ g }: { g: PrGroup }) {
  const n = g.items.length;
  return (
    <div className="mt-1 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
         title={g.spread.map((s) =>
           `${s.n} × ${g.items.find((r) => r.stage === s.stage)?.stage_label ?? s.stage}`).join(" · ")}>
      {g.spread.map((s) => (
        <div key={s.stage} style={{ width: `${(s.n / n) * 100}%` }}
             className={STAGE_FILL[s.stage] ?? "bg-slate-300"} />
      ))}
    </div>
  );
}

/* ── the Excel-style column filter ──────────────────────────────────────
   A funnel on the heading opens the values actually present in that
   column, each with a tick and a count. The list is built from the rows
   the OTHER filters have already allowed, so it never offers a value that
   would return nothing -- which is what makes the counts worth reading.

   "Select all" is a real tri-state box: ticked when nothing is filtered,
   and clicking it clears every tick so you can pick one or two out of
   thirty-four rather than unticking thirty-two. An empty selection shows
   no rows, as it does in Excel -- it does not quietly mean "no filter",
   which is the bug the first version had. */
function ColumnFilter({
  col, values, chosen, onChange,
}: {
  col: Col;
  values: { v: string; n: number }[];
  chosen: Set<string> | undefined;     // undefined = unfiltered; empty = none
  onChange: (next: Set<string> | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const list = useMemo(() => {
    const n = needle.trim().toLowerCase();
    return n ? values.filter((x) => x.v.toLowerCase().includes(n)) : values;
  }, [values, needle]);

  const on = chosen !== undefined;
  const allTicked = !on;
  const noneTicked = on && chosen.size === 0;

  const ticked = (v: string) => !chosen || chosen.has(v);
  const flip = (v: string) => {
    const next = new Set(chosen ?? values.map((x) => x.v));
    next.has(v) ? next.delete(v) : next.add(v);
    // Everything ticked is the same as no filter, and says so by clearing.
    onChange(next.size === values.length ? undefined : next);
  };

  return (
    <span className="relative inline-block" ref={box}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label={`Filter ${col.head}`}
        title={on ? `${chosen.size} of ${values.length} selected` : `Filter ${col.head}`}
        className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded
          ${on ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
               : "text-slate-400 opacity-0 hover:bg-slate-200 group-hover/th:opacity-100 dark:hover:bg-slate-700"}`}>
        <ListFilter className="h-3 w-3" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 z-40 mt-1 w-64 rounded-lg border border-slate-200 bg-white
                     p-2 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <input
            autoFocus value={needle} onChange={(e) => setNeedle(e.target.value)}
            placeholder={`Search ${col.head.toLowerCase()}…`}
            className="mb-1.5 w-full rounded border border-slate-200 px-2 py-1 text-[12px]
                       font-normal normal-case tracking-normal focus:border-slate-500
                       focus:outline-none dark:border-slate-700 dark:bg-slate-950" />

          {/* the tri-state box: tick to take everything, untick to take none */}
          <button
            onClick={() => onChange(allTicked ? new Set<string>() : undefined)}
            className="mb-1 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[12px]
                       font-semibold normal-case tracking-normal hover:bg-slate-100
                       dark:hover:bg-slate-800">
            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border
              ${allTicked ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                : noneTicked ? "border-slate-300 dark:border-slate-600"
                : "border-slate-900 bg-slate-900 dark:border-white dark:bg-white"}`}>
              {allTicked && <Check className="h-2.5 w-2.5" />}
              {!allTicked && !noneTicked && (
                <span className="h-[2px] w-2 rounded bg-white dark:bg-slate-900" />)}
            </span>
            Select all
            <span className="ml-auto font-normal text-slate-400">{values.length}</span>
          </button>

          {needle.trim() && (
            <button onClick={() => onChange(new Set(list.map((x) => x.v)))}
              className="mb-1 w-full rounded px-1 py-0.5 text-left text-[11px] font-normal
                         normal-case tracking-normal text-sky-700 hover:bg-slate-100
                         dark:text-sky-400 dark:hover:bg-slate-800">
              Only the {list.length} matching
            </button>
          )}

          <div className="max-h-56 overflow-y-auto border-t border-slate-100 pt-1 dark:border-slate-800">
            {list.map(({ v, n }) => (
              <button key={v} onClick={() => flip(v)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left
                           text-[12px] font-normal normal-case tracking-normal
                           hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border
                  ${ticked(v) ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                              : "border-slate-300 dark:border-slate-600"}`}>
                  {ticked(v) && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="flex-1 truncate" title={v}>{v}</span>
                <span className="shrink-0 tabular-nums text-slate-400">{n}</span>
              </button>
            ))}
            {!list.length && (
              <div className="px-1 py-2 text-[12px] font-normal normal-case text-slate-400">
                No matching values.
              </div>)}
          </div>

          {on && (
            <button onClick={() => { onChange(undefined); setNeedle(""); }}
              className="mt-1 w-full rounded border border-slate-200 px-1 py-1 text-[11px]
                         font-normal normal-case tracking-normal hover:bg-slate-50
                         dark:border-slate-700 dark:hover:bg-slate-800">
              Clear this filter
            </button>
          )}
        </div>
      )}
    </span>
  );
}

interface Props {
  rows: PrPoRow[];          // everything in the window; filtered here
  loading: boolean;
  filter: PrPoFilter;
  onFilter: (patch: Partial<PrPoFilter>) => void;
  onClear: () => void;
}

export default function PrPoRegisterTable({
  rows, loading, filter, onFilter, onClear,
}: Props) {
  const [typed, setTyped] = useState(filter.q ?? "");
  const [picker, setPicker] = useState(false);
  const [cuts, setCuts] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [page, setPage] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(COLUMNS.filter((c) => !c.core).map((c) => c.key)));

  useEffect(() => setTyped(filter.q ?? ""), [filter.q]);

  const cols = useMemo(() => COLUMNS.filter((c) => !hidden.has(c.key)), [hidden]);

  /* The toolbar's filters, which used to be the server's. */
  const broad = useMemo(() => {
    const q = typed.trim().toLowerCase();
    const stages = filter.stage
      ? new Set(filter.stage.split(",").map((s) => s.trim().toUpperCase())
          .flatMap((s) => s === "EVALUATION" ? [s, "QUOTES_IN"] : [s]))
      : null;
    const rags = filter.rag
      ? new Set(filter.rag.split(",").map((s) => s.trim().toLowerCase()))
      : null;
    return rows.filter((r) => {
      if (filter.to && !(r.release_date && r.release_date <= filter.to)) return false;
      if (stages && !stages.has(r.stage)) return false;
      if (rags && !rags.has(r.rag)) return false;
      if (filter.owner && (r.pending_with ?? "") !== filter.owner) return false;
      if (filter.buyer && (r.buyer_name ?? "") !== filter.buyer) return false;
      if (q && !SEARCH_FIELDS.some((f) =>
        String(r[f] ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, typed, filter.to, filter.stage, filter.rag, filter.owner, filter.buyer]);

  /* A filter is live as soon as the column HAS a selection, empty included:
     unticking everything means "show none", not "show all". */
  const passes = useMemo(() => {
    const live = Object.entries(cuts);
    return (r: PrPoRow, skip?: string) => live.every(([k, s]) => {
      if (k === skip) return true;
      const c = COLUMNS.find((x) => x.key === k);
      return !c?.pick || s.has(c.pick(r) || BLANK);
    });
  }, [cuts]);

  /* THE COUNTS BESIDE EACH VALUE ARE REQUISITIONS, NOT LINES, because the
     rows they will produce are requisitions. Counting lines, the list
     offered "36" next to a value that turns out to be five rows, and the
     number beside a filter has to be the number of things you will get. */
  const choices = useMemo(() => {
    const out: Record<string, { v: string; n: number }[]> = {};
    for (const c of cols) {
      if (!c.pick) continue;
      const tally = new Map<string, Set<string>>();
      for (const r of broad) {
        if (!passes(r, c.key)) continue;
        const v = c.pick(r) || BLANK;
        const seen = tally.get(v);
        if (seen) seen.add(r.pr_number); else tally.set(v, new Set([r.pr_number]));
      }
      out[c.key] = [...tally.entries()]
        .map(([v, prs]) => ({ v, n: prs.size }))
        .sort((a, b) => a.v === BLANK ? 1 : b.v === BLANK ? -1
                      : a.v.localeCompare(b.v, "en", { numeric: true }));
    }
    return out;
  }, [broad, cols, passes]);

  const kept = useMemo(() => broad.filter((r) => passes(r)), [broad, passes]);

  const groups = useMemo(() => {
    const gs = group(kept);
    if (sort) {
      const col = COLUMNS.find((c) => c.key === sort.key);
      if (col?.sortOn) return sortBySelector(gs, col.sortOn, sort.desc);
      return gs;
    }
    /* WORST FIRST. A register sorted newest-first opens on the healthiest
       rows and answers "is anything wrong?" with "no" by accident of
       ordering. Overdue first, then longest stuck. */
    return [...gs].sort((a, b) =>
      (RAG_RANK[a.rag] ?? 3) - (RAG_RANK[b.rag] ?? 3) || (b.age ?? 0) - (a.age ?? 0));
  }, [kept, sort]);

  useEffect(() => { setPage(PAGE); }, [groups.length, sort]);

  const cutCount = Object.keys(cuts).length;
  const active = Boolean(filter.q || typed || filter.stage || filter.rag
                         || filter.owner || filter.buyer || filter.to || cutCount);

  const toggleCol = (key: string) =>
    setHidden((h) => { const n = new Set(h); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const toggleRow = (pr: string) =>
    setOpen((o) => { const n = new Set(o); n.has(pr) ? n.delete(pr) : n.add(pr); return n; });

  const sortBy = (c: Col) => {
    if (!c.sortOn) return;
    setSort((s) => s?.key === c.key
      ? (s.desc ? { key: c.key, desc: false } : null)   // desc → asc → off
      : { key: c.key, desc: true });
  };

  const SortIcon = ({ c }: { c: Col }) => {
    if (!c.sortOn) return null;
    if (sort?.key !== c.key)
      return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-25" />;
    return sort.desc
      ? <ArrowDown className="ml-1 inline h-3 w-3" />
      : <ArrowUp className="ml-1 inline h-3 w-3" />;
  };

  const shownGroups = groups.slice(0, page);
  const allOpen = shownGroups.length > 0 && shownGroups.every((g) => open.has(g.pr));

  return (
    <section className="space-y-2">
      {/* ── toolbar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Priority action register</h3>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1.5 h-4 w-4 text-slate-400" />
          <input
            id="pr-po-search" value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="PR, PO, vendor, material, person…"
            className="w-64 rounded-md border border-slate-300 bg-white py-1 pl-8 pr-2 text-[13px]
                       placeholder:text-slate-400 focus:border-slate-500 focus:outline-none
                       dark:border-slate-700 dark:bg-slate-900" />
        </div>

        {/* released between -- its own filter, because this page reports a
            backlog and the dashboard's period filter would hide the old
            items that are the whole point of looking */}
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          Released
          <input type="date" value={filter.from ?? ""} max={filter.to || undefined}
                 onChange={(e) => onFilter({ from: e.target.value || undefined })}
                 className="rounded-md border border-slate-300 px-1.5 py-1 text-[12px]
                            dark:border-slate-700 dark:bg-slate-900" />
          to
          <input type="date" value={filter.to ?? ""} min={filter.from || undefined}
                 onChange={(e) => onFilter({ to: e.target.value || undefined })}
                 className="rounded-md border border-slate-300 px-1.5 py-1 text-[12px]
                            dark:border-slate-700 dark:bg-slate-900" />
        </label>

        <select value={filter.rag ?? ""}
                onChange={(e) => onFilter({ rag: e.target.value || undefined })}
                className="rounded-md border border-slate-300 px-2 py-1 text-[12px]
                           dark:border-slate-700 dark:bg-slate-900">
          <option value="">Any status</option>
          <option value="red">Overdue</option>
          <option value="amber">Due soon</option>
          <option value="green">On track</option>
          <option value="unknown">No target</option>
        </select>

        <div className="relative">
          <button onClick={() => setPicker((p) => !p)}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[12px]
                       hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Columns
            <span className="text-slate-400">({cols.length})</span>
          </button>
          {picker && (
            <div className="absolute right-0 z-20 mt-1 max-h-80 w-60 overflow-y-auto rounded-lg border
                            border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {GROUPS.map((gname) => (
                <div key={gname} className="mb-1">
                  <div className="px-1 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{gname}</div>
                  {COLUMNS.filter((c) => c.group === gname).map((c) => (
                    <button key={c.key} onClick={() => toggleCol(c.key)}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12px]
                                 hover:bg-slate-100 dark:hover:bg-slate-800">
                      <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border
                        ${hidden.has(c.key) ? "border-slate-300 dark:border-slate-600"
                                            : "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"}`}>
                        {!hidden.has(c.key) && <Check className="h-2.5 w-2.5" />}
                      </span>
                      {c.head}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setOpen(allOpen ? new Set() : new Set(shownGroups.map((g) => g.pr)))}
          className="rounded-md border border-slate-300 px-2 py-1 text-[12px]
                     hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          {allOpen ? "Collapse all" : "Expand all"}
        </button>

        {cutCount > 0 && (
          <button onClick={() => setCuts({})}
            className="flex items-center gap-1 rounded-md border border-slate-900 bg-slate-900 px-2 py-1
                       text-[12px] text-white dark:border-white dark:bg-white dark:text-slate-900">
            <Filter className="h-3.5 w-3.5" /> {cutCount} column filter{cutCount > 1 ? "s" : ""}
            <X className="h-3 w-3" />
          </button>
        )}

        {active && (
          <button onClick={() => { setTyped(""); setCuts({}); setSort(null); onClear(); }}
            className="flex items-center gap-1 rounded-md bg-slate-200 px-2 py-1 text-[12px]
                       dark:bg-slate-700">
            <X className="h-3 w-3" /> Clear
          </button>
        )}

        <span className="ml-auto text-xs tabular-nums text-slate-500">
          {loading ? "loading…"
            : `${groups.length.toLocaleString("en-IN")} PRs · ${kept.length.toLocaleString("en-IN")} items`}
          {kept.length !== rows.length && ` of ${rows.length.toLocaleString("en-IN")}`}
        </span>
      </div>

      {/* ── the table ─────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800">
              {/* pinned: a row forty columns wide must never lose its name */}
              <th className="sticky left-0 z-10 w-72 min-w-[18rem] bg-slate-50 px-3 py-2 text-left
                             text-[10px] font-semibold uppercase tracking-wider text-slate-500
                             dark:bg-slate-800">
                Requisition &amp; progress
              </th>
              {cols.map((c) => (
                <th key={c.key}
                    onClick={() => sortBy(c)}
                    className={`group/th ${c.width ?? ""} ${c.width ? "min-w-[5rem]" : ""}
                      whitespace-nowrap px-3 py-2 text-[10px]
                      font-semibold uppercase tracking-wider text-slate-500
                      ${c.align === "right" ? "text-right" : "text-left"}
                      ${c.sortOn ? "cursor-pointer select-none hover:text-slate-900 dark:hover:text-white" : ""}`}>
                  {c.head}
                  <SortIcon c={c} />
                  {c.pick && (
                    <ColumnFilter
                      col={c}
                      values={choices[c.key] ?? []}
                      chosen={cuts[c.key]}
                      onChange={(next) => setCuts((f) => {
                        const n = { ...f };
                        if (next) n[c.key] = next; else delete n[c.key];
                        return n;
                      })} />
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {shownGroups.map((g, i) => {
              const isOpen = open.has(g.pr);
              const zebra = i % 2 ? "bg-slate-50/40 dark:bg-slate-900/40" : "";
              const stick = i % 2 ? "bg-slate-50 dark:bg-slate-900" : "bg-white dark:bg-slate-950";
              return (
                <Fragment key={g.pr}>
                  <tr onClick={() => toggleRow(g.pr)}
                      className={`group cursor-pointer border-t border-slate-200 align-top
                        dark:border-slate-700 ${zebra}
                        hover:bg-sky-50/60 dark:hover:bg-sky-950/20`}>
                    <td className={`sticky left-0 z-10 min-w-[18rem] px-3 py-2 ${stick}
                      group-hover:bg-sky-50 dark:group-hover:bg-sky-950/40`}>
                      <div className="flex items-start gap-1.5">
                        <ChevronRight
                          className={`mt-[3px] h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform
                                      ${isOpen ? "rotate-90" : ""}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[13px] font-semibold tabular-nums">{g.pr}</span>
                            <span className="whitespace-nowrap text-[11px] text-slate-400">
                              {g.items.length} item{g.items.length > 1 ? "s" : ""}
                            </span>
                          </div>
                          <div className="line-clamp-1 text-[12px] leading-snug text-slate-600 dark:text-slate-400"
                               title={g.items.map((r) => r.description).filter(Boolean).join(" · ")}>
                            {g.lead.description || <Dash />}
                          </div>
                          <Progress g={g} />
                        </div>
                      </div>
                    </td>
                    {cols.map((c) => (
                      <td key={c.key}
                          className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""}`}>
                        {c.agg ? c.agg(g) : <Dash />}
                      </td>
                    ))}
                  </tr>

                  {isOpen && g.items.map((r) => (
                    <tr key={`${g.pr}-${r.pr_item}`}
                        className="group/i border-t border-slate-100 bg-sky-50/30 align-top
                                   text-slate-700 dark:border-slate-800 dark:bg-sky-950/10
                                   dark:text-slate-300">
                      <td className="sticky left-0 z-10 min-w-[18rem] bg-sky-50 px-3 py-1.5 pl-8
                                     dark:bg-sky-950/30">
                        <div className="text-[12px] font-medium tabular-nums text-slate-500">
                          item {r.pr_item}
                        </div>
                        <div className="line-clamp-2 text-[12px] leading-snug"
                             title={r.description ?? ""}>
                          {r.description || <Dash />}
                        </div>
                      </td>
                      {cols.map((c) => (
                        <td key={c.key}
                            className={`px-3 py-1.5 ${c.align === "right" ? "text-right" : ""}`}>
                          {c.render(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {!groups.length && !loading && (
              <tr><td colSpan={cols.length + 1} className="px-3 py-10 text-center text-sm text-slate-500">
                Nothing matches these filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {groups.length > page && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <span className="text-xs tabular-nums text-slate-500">
            showing {page.toLocaleString("en-IN")} of {groups.length.toLocaleString("en-IN")} PRs
          </span>
          <button onClick={() => setPage((p) => p + PAGE * 2)}
            className="rounded-md border border-slate-300 px-3 py-1 text-[12px]
                       hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            Show more
          </button>
          <button onClick={() => setPage(groups.length)}
            className="rounded-md border border-slate-300 px-3 py-1 text-[12px]
                       hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            Show all {groups.length.toLocaleString("en-IN")}
          </button>
        </div>
      )}
    </section>
  );
}
