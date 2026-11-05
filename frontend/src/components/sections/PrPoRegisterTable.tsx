"use client";
import { useMemo, useState } from "react";
import {
  Search, X, SlidersHorizontal, ArrowUp, ArrowDown, ChevronsUpDown, Check,
} from "lucide-react";
import type { PrPoRow } from "@/types";
import { Filter } from "lucide-react";
import type { PrPoFilter } from "@/hooks/usePrPo";

/* The priority action register.

   A procurement case has forty-odd facts attached to it and a meeting needs
   a different dozen each time. So the table carries the lot and lets the
   reader choose: columns are grouped by the part of the process they belong
   to, hidden by default beyond the core set, and the whole thing scrolls
   sideways with the PR number pinned so a row never loses its name.

   WHY THE STAGE HAS ITS OWN COLOUR AND THE AGE DOES NOT SHARE IT. Two
   different facts: where a case is, and whether it is late. Painted in one
   scale they compete -- a green "paid" badge beside a green "on track" badge
   says nothing twice. The stage runs along a cool-to-warm progression that
   follows the procurement sequence, so a column of pills shows the spread of
   the pipeline at a glance; lateness stays red/amber/green and nothing else
   on the row uses those three. */

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

const RAG_TONE: Record<string, string> = {
  red:     "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900",
  amber:   "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900",
  green:   "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900",
  unknown: "bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700",
};
const RAG_WORD: Record<string, string> = {
  red: "Overdue", amber: "Due soon", green: "On track", unknown: "No target",
};

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

/* A header filter needs to know what text to match a row against. Columns
   that are a number, a date or a coloured badge are left out: filtering a
   money column by substring is a trap, and the toolbar already carries the
   range and status filters those columns would want. */
type Col = {
  key: string;
  filterOn?: (r: PrPoRow) => string;
  head: string;
  group: string;
  sort?: string;
  align?: "right";
  core?: boolean;              // shown until the reader says otherwise
  width?: string;
  render: (r: PrPoRow) => React.ReactNode;
};

const Dash = () => <span className="text-slate-300 dark:text-slate-600">—</span>;
const txt = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? <Dash /> : <>{v}</>;

export const COLUMNS: Col[] = [
  { key: "age", head: "Age", group: "Status", sort: "stage_age_days", core: true, width: "w-28",
    render: (r) => (
      <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${RAG_TONE[r.rag] ?? RAG_TONE.unknown}`}>
        {r.stage_age_days === null ? "—" : `${r.stage_age_days}d`} · {RAG_WORD[r.rag] ?? "—"}
      </span>) },
  { key: "stage", head: "Stage", group: "Status", sort: "stage", core: true, width: "w-44",
    filterOn: (r) => r.stage_label ?? "",
    render: (r) => (
      <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${STAGE_TONE[r.stage] ?? STAGE_TONE.UNASSIGNED}`}>
        {r.stage_label}
      </span>) },
  { key: "next_action", head: "Next action", group: "Status", core: true, width: "w-52",
    filterOn: (r) => r.next_action ?? "",
    render: (r) => <span className="text-[13px]">{txt(r.next_action)}</span> },
  { key: "pending_with", head: "Pending with", group: "Status", sort: "pending_with", core: true, width: "w-44",
    filterOn: (r) => r.pending_with ?? "",
    render: (r) => <span className="text-[13px]">{txt(r.pending_with)}</span> },

  { key: "requested_by", head: "Requested by", group: "Requester", core: true, width: "w-36",
    filterOn: (r) => `${r.requisitioner ?? ""} ${r.created_by ?? ""}`,
    render: (r) => <span className="text-[13px]">{txt(r.requisitioner || r.created_by)}</span> },
  { key: "cost_center", head: "Cost centre", group: "Requester", width: "w-28",
    filterOn: (r) => r.cost_center ?? "",
    render: (r) => <span className="text-[13px] tabular-nums">{txt(r.cost_center)}</span> },
  { key: "plant", head: "Plant", group: "Requester", width: "w-20",
    filterOn: (r) => r.plant ?? "",
    render: (r) => <span className="text-[13px] tabular-nums">{txt(r.plant)}</span> },

  /* THE DEPARTMENT IS A TOOLTIP, NOT A SECOND LINE. "Spares parts,
     Planning & Contract Management" under every row of the same buyer is
     the same sentence repeated forty times down a column, and it pushed
     every row to two lines to say nothing new. The purchasing group code
     goes there instead: four characters, different per buyer, and the key
     anybody cross-referencing SAP actually needs. */
  { key: "buyer", head: "Buyer", group: "SCM", sort: "buyer_name", core: true, width: "w-40",
    filterOn: (r) => `${r.buyer_name ?? ""} ${r.purchasing_group ?? ""}`,
    render: (r) => r.buyer_name ? (
      <div className="leading-tight"
           title={[r.buyer_name, r.buyer_department].filter(Boolean).join(" — ")}>
        <div className="truncate text-[13px]">{r.buyer_name}</div>
        {r.purchasing_group && (
          <div className="text-[11px] tabular-nums text-slate-400">{r.purchasing_group}</div>)}
      </div>) : <Dash /> },
  { key: "pr_dates", head: "PR / released", group: "SCM", sort: "release_date", width: "w-32",
    render: (r) => (
      <div className="leading-tight text-[12px] tabular-nums">
        <div>{shortDate(r.release_date)}</div>
        <div className="text-[11px] text-slate-500">raised {shortDate(r.pr_date)}</div>
      </div>) },
  { key: "pr_age", head: "PR age", group: "SCM", sort: "pr_age_days", align: "right", width: "w-20",
    render: (r) => <span className="text-[13px] tabular-nums">{r.pr_age_days === null ? <Dash /> : `${r.pr_age_days}d`}</span> },
  { key: "material", head: "Material group", group: "SCM", width: "w-40",
    filterOn: (r) => r.material_group ?? "",
    render: (r) => <span className="text-[12px]">{txt(r.material_group)}</span> },
  { key: "qty", head: "Qty", group: "SCM", align: "right", width: "w-24",
    render: (r) => <span className="text-[13px] tabular-nums">
      {r.quantity === null ? <Dash /> : `${r.quantity.toLocaleString("en-IN")} ${r.unit ?? ""}`}</span> },

  { key: "rfq", head: "RFQ", group: "Sourcing", width: "w-28",
    render: (r) => r.rfq_count ? (
      <div className="leading-tight text-[12px]">
        <div>{r.rfq_count} RFQ · {r.rfq_vendors ?? 0} vendors</div>
        <div className="text-[11px] text-slate-500">{shortDate(r.rfq_issued_at)}</div>
      </div>) : <Dash /> },
  { key: "quotes", head: "Quotes", group: "Sourcing", align: "right", width: "w-20",
    render: (r) => <span className="text-[13px] tabular-nums">{txt(r.quotation_count)}</span> },
  { key: "nfa", head: "NFA", group: "Sourcing", width: "w-40",
    render: (r) => r.nfa_id ? (
      <div className="leading-tight text-[12px]">
        <div className="truncate">{r.nfa_status ?? "—"}</div>
        {r.approver_name && (
          <div className="truncate text-[11px] text-slate-500">
            {r.approver_name}{r.nfa_pending_days !== null ? ` · ${r.nfa_pending_days}d` : ""}
          </div>)}
      </div>) : <Dash /> },

  { key: "po", head: "PO", group: "Order", sort: "po_date", core: true, width: "w-36",
    filterOn: (r) => r.po_no ?? "",
    render: (r) => r.po_no ? (
      <div className="leading-tight">
        <div className="text-[13px] font-medium tabular-nums">{r.po_no}</div>
        <div className="text-[11px] text-slate-500">{shortDate(r.po_date)}</div>
      </div>) : <Dash /> },
  { key: "vendor", head: "Vendor", group: "Order", sort: "vendor", width: "w-48",
    filterOn: (r) => r.vendor ?? "",
    render: (r) => <span className="text-[13px]">{txt(r.vendor)}</span> },
  { key: "po_value", head: "PO value", group: "Order", sort: "po_value", align: "right", core: true, width: "w-28",
    render: (r) => <span className="text-[13px] tabular-nums" title={exact(r.po_value)}>{crore(r.po_value)}</span> },
  { key: "delivery", head: "Delivery due", group: "Order", sort: "po_delivery_date", width: "w-28",
    render: (r) => r.po_delivery_date ? (
      <span className={`text-[12px] tabular-nums ${
        !r.delivery_complete && new Date(r.po_delivery_date) < new Date()
          ? "text-rose-600 dark:text-rose-400" : ""}`}>
        {shortDate(r.po_delivery_date)}{r.delivery_complete ? " ✓" : ""}
      </span>) : <Dash /> },

  { key: "invoiced", head: "Invoiced", group: "Payment", align: "right", width: "w-28",
    render: (r) => <span className="text-[13px] tabular-nums" title={exact(r.invoiced_value)}>{crore(r.invoiced_value)}</span> },
  { key: "paid", head: "Paid", group: "Payment", align: "right", width: "w-28",
    render: (r) => <span className="text-[13px] tabular-nums" title={exact(r.paid_amount)}>{crore(r.paid_amount)}</span> },
  { key: "outstanding", head: "Outstanding", group: "Payment", sort: "outstanding", align: "right", core: true, width: "w-32",
    render: (r) => (r.outstanding ?? 0) > 0 ? (
      <span className={`text-[13px] font-medium tabular-nums ${
        r.overdue_payable ? "text-rose-600 dark:text-rose-400" : ""}`} title={exact(r.outstanding)}>
        {crore(r.outstanding)}
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
    ) : <Dash /> },
  { key: "terms", head: "Payment terms", group: "Payment", width: "w-44",
    filterOn: (r) => r.payment_terms_desc ?? "",
    render: (r) => <span className="text-[12px]">{txt(r.payment_terms_desc)}</span> },
];

const GROUPS = ["Status", "Requester", "SCM", "Sourcing", "Order", "Payment"];

interface Props {
  rows: PrPoRow[];
  total: number;
  truncated: boolean;
  loading: boolean;
  buyers: string[];
  filter: PrPoFilter;
  onFilter: (patch: Partial<PrPoFilter>) => void;
  onClear: () => void;
}

export default function PrPoRegisterTable({
  rows, total, truncated, loading, buyers, filter, onFilter, onClear,
}: Props) {
  const [typed, setTyped] = useState(filter.q ?? "");
  const [picker, setPicker] = useState(false);
  /* HEADER FILTERS ARE CLIENT-SIDE ON PURPOSE. The server has already cut
     the population to at most 500 rows; sending another request per
     keystroke to narrow what is on screen would be slower and would make
     the row count flicker while somebody types. The toolbar filters, which
     change which rows exist at all, stay on the server. */
  const [colFilter, setColFilter] = useState<Record<string, string>>({});
  const [filterRow, setFilterRow] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(COLUMNS.filter((c) => !c.core).map((c) => c.key)));

  const cols = useMemo(() => COLUMNS.filter((c) => !hidden.has(c.key)), [hidden]);

  const shown = useMemo(() => {
    const active = Object.entries(colFilter)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => [COLUMNS.find((c) => c.key === k), v.trim().toLowerCase()] as const)
      .filter((p): p is readonly [Col, string] => Boolean(p[0]?.filterOn));
    if (!active.length) return rows;
    return rows.filter((r) =>
      active.every(([c, v]) => c.filterOn!(r).toLowerCase().includes(v)));
  }, [rows, colFilter]);
  const active = Boolean(filter.q || filter.stage || filter.rag || filter.owner
                         || filter.buyer || filter.from || filter.to);

  const toggle = (key: string) =>
    setHidden((h) => { const n = new Set(h); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const sortBy = (field?: string) => {
    if (!field) return;
    if (filter.sort === field) onFilter({ dir: filter.dir === "asc" ? "desc" : "asc" });
    else onFilter({ sort: field, dir: "desc" });
  };

  const SortIcon = ({ field }: { field?: string }) => {
    if (!field) return null;
    if (filter.sort !== field)
      return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-25" />;
    return filter.dir === "asc"
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />;
  };

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
            onKeyDown={(e) => { if (e.key === "Enter") onFilter({ q: typed }); }}
            onBlur={() => onFilter({ q: typed })}
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

        <select value={filter.buyer ?? ""}
                onChange={(e) => onFilter({ buyer: e.target.value || undefined })}
                className="rounded-md border border-slate-300 px-2 py-1 text-[12px]
                           dark:border-slate-700 dark:bg-slate-900">
          <option value="">All buyers</option>
          {buyers.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>

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
              {GROUPS.map((g) => (
                <div key={g} className="mb-1">
                  <div className="px-1 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{g}</div>
                  {COLUMNS.filter((c) => c.group === g).map((c) => (
                    <button key={c.key} onClick={() => toggle(c.key)}
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

        <button onClick={() => setFilterRow((f) => !f)}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[12px]
            ${filterRow || Object.values(colFilter).some((v) => v.trim())
              ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
              : "border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
          <Filter className="h-3.5 w-3.5" /> Column filters
        </button>

        {(active || Object.values(colFilter).some((v) => v.trim())) && (
          <button onClick={() => { setTyped(""); setColFilter({}); onClear(); }}
            className="flex items-center gap-1 rounded-md bg-slate-200 px-2 py-1 text-[12px]
                       dark:bg-slate-700">
            <X className="h-3 w-3" /> Clear
          </button>
        )}

        <span className="ml-auto text-xs tabular-nums text-slate-500">
          {loading ? "loading…"
            : shown.length === rows.length
              ? `${total.toLocaleString("en-IN")} items`
              : `${shown.length.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
          {truncated && " · first 500"}
        </span>
      </div>

      {/* ── the table ─────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800">
              {/* pinned: a row forty columns wide must never lose its name */}
              <th className="sticky left-0 z-10 w-56 bg-slate-50 px-3 py-2 text-left text-[10px]
                             font-semibold uppercase tracking-wider text-slate-500
                             dark:bg-slate-800">
                PR / item &amp; requirement
              </th>
              {cols.map((c) => (
                <th key={c.key}
                    onClick={() => sortBy(c.sort)}
                    className={`${c.width ?? ""} whitespace-nowrap px-3 py-2 text-[10px] font-semibold
                      uppercase tracking-wider text-slate-500
                      ${c.align === "right" ? "text-right" : "text-left"}
                      ${c.sort ? "cursor-pointer select-none hover:text-slate-900 dark:hover:text-white" : ""}`}>
                  {c.head}<SortIcon field={c.sort} />
                </th>
              ))}
            </tr>
            {filterRow && (
              <tr className="bg-white dark:bg-slate-900">
                <th className="sticky left-0 z-10 bg-white px-2 py-1 dark:bg-slate-900">
                  <span className="text-[10px] font-normal normal-case text-slate-400">
                    use the search box above
                  </span>
                </th>
                {cols.map((c) => (
                  <th key={c.key} className="px-2 py-1">
                    {c.filterOn ? (
                      <input
                        value={colFilter[c.key] ?? ""}
                        onChange={(e) => setColFilter((f) => ({ ...f, [c.key]: e.target.value }))}
                        placeholder="filter…"
                        aria-label={`Filter by ${c.head}`}
                        className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-[11px]
                                   font-normal normal-case tracking-normal
                                   placeholder:text-slate-300 focus:border-slate-500 focus:outline-none
                                   dark:border-slate-700 dark:bg-slate-950" />
                    ) : null}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.pr_number}-${r.pr_item}`}
                  className={`group border-t border-slate-100 align-top dark:border-slate-800
                    ${i % 2 ? "bg-slate-50/40 dark:bg-slate-900/40" : ""}
                    hover:bg-sky-50/60 dark:hover:bg-sky-950/20`}>
                <td className={`sticky left-0 z-10 px-3 py-2
                  ${i % 2 ? "bg-slate-50 dark:bg-slate-900" : "bg-white dark:bg-slate-950"}
                  group-hover:bg-sky-50 dark:group-hover:bg-sky-950/40`}>
                  <div className="text-[13px] font-semibold tabular-nums">
                    {r.pr_number}<span className="font-normal text-slate-400">/{r.pr_item}</span>
                  </div>
                  <div className="line-clamp-2 text-[12px] leading-snug text-slate-600 dark:text-slate-400"
                       title={r.description ?? ""}>
                    {r.description || <Dash />}
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c.key}
                      className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && !loading && (
              <tr><td colSpan={cols.length + 1} className="px-3 py-10 text-center text-sm text-slate-500">
                Nothing matches these filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
