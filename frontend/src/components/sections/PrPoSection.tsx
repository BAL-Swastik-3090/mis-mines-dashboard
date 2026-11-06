"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, AlertTriangle, Megaphone } from "lucide-react";
import { usePrPoSummary, usePrPoRegister, type PrPoFilter } from "@/hooks/usePrPo";
import PrPoRegisterTable from "@/components/sections/PrPoRegisterTable";
import type {
  PrPoStageBucket, PrPoOwnerBucket, PrPoRequesterBucket, PrPoAgeBand,
  PrPoDueBand, PrPoBuyerLoad, PrPoApprovalLoad,
} from "@/types";

/* PR to Payment.

   Built round the order a morning meeting asks its questions: what should we
   look at first, where is the work stuck, who is holding it, and which cases
   do we talk about. The table is the last thing on the page because it is
   the last thing anybody needs -- by the time you reach it you should already
   know which forty rows you came for.

   The first version of this screen was a flat table sorted newest-first,
   which opened on rows reading "0d, on track" while 1,654 items sat over
   thirty days in stage further down. Ordering is not presentation. */

/* ── money ──────────────────────────────────────────────────────────────
   Crore, because the register runs to ten digits and "₹ 1,65,64,06,404" is
   not a number anybody reads off a projector. Exact figure in the tooltip
   for whoever has to reconcile it. */
function crore(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `₹ ${(v / 1e7).toFixed(1)} Cr`;
  if (a >= 1e5) return `₹ ${(v / 1e5).toFixed(1)} L`;
  return `₹ ${Math.round(v).toLocaleString("en-IN")}`;
}
const exact = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : `₹ ${Math.round(v).toLocaleString("en-IN")}`;
/* "06 Nov 25" -- unambiguous across date conventions and readable in a
   header, where an ISO string reads as a serial number. */
function span(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
const num = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-IN");

/* Colour never carries a fact alone: this is read off a projector and by
   people who cannot separate red from green. Every badge says the word. */
const RAG_STYLE: Record<string, string> = {
  red:     "bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:ring-rose-900",
  amber:   "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-900",
  green:   "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-900",
  unknown: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
};
const RAG_WORD: Record<string, string> = {
  red: "Overdue", amber: "Due soon", green: "On track", unknown: "No target",
};

/* The procurement sequence. Drawn as horizontal bars rather than vertical
   ones: the stage names are words, and words read along a row. A vertical
   chart forces each label into six characters and then needs a legend to
   undo the abbreviation. */
const PIPELINE = [
  { stage: "UNASSIGNED",   label: "Assign buyer" },
  { stage: "ASSIGNED",     label: "Issue RFQ" },
  { stage: "RFQ_ISSUED",   label: "Await quotations" },
  { stage: "QUOTES_IN",    label: "Compare quotes" },
  { stage: "EVALUATION",   label: "Evaluate" },
  { stage: "NFA_PENDING",  label: "NFA approval" },
  { stage: "NFA_APPROVED", label: "Raise PO" },
  { stage: "PO_CREATED",   label: "Release PO" },
  { stage: "PO_RELEASED",  label: "Delivery" },
  { stage: "RECEIVED",     label: "Invoice" },
  { stage: "INVOICED",     label: "Payment" },
];

const CARD = "rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900";
const PANEL_H3 = "text-sm font-semibold";

function Dash() { return <span className="text-slate-400">—</span>; }

/* A hover card, in place of the browser's own tooltip.
   The native one waits a second, wraps where it likes, cannot be styled and
   renders in the operating system's font at the pointer -- which on a row
   of figures is exactly where it covers the next row.

   IT IS DRAWN IN A PORTAL, FIXED TO THE VIEWPORT, and that is not
   decoration. The first version placed it absolutely inside the row, and
   inside a scrollable list that flickered violently on the last few rows:
   the card extended past the bottom of the list, which gave the list more
   to scroll, which moved the row out from under the pointer, which hid the
   card, which shrank the list back -- several times a second. An element
   that is positioned against the viewport cannot change the size of
   anything, so the loop has nowhere to start.

   It also flips above the row when there is no room below, so a card on
   the last row opens upwards instead of off the bottom of the screen, and
   closes on scroll rather than hanging in the wrong place.

   `pointer-events-none` matters too: a card the pointer can land on sits
   between the pointer and the row underneath, which is its own flicker. */
function Hint({ lines, children, align = "left" }: {
  lines: (string | false | null | undefined)[];
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const text = lines.filter(Boolean) as string[];
  const host = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; up: boolean } | null>(null);

  const place = () => {
    const el = host.current;
    if (!el || !text.length) return;
    const r = el.getBoundingClientRect();
    // 22px a line plus the padding, which is all the room it needs.
    const need = text.length * 22 + 16;
    const up = r.bottom + need > window.innerHeight - 8;
    setAt({ x: align === "right" ? r.right : r.left, y: up ? r.top - 4 : r.bottom + 4, up });
  };

  useEffect(() => {
    if (!at) return;
    const off = () => setAt(null);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [at]);

  return (
    <span ref={host} className="block"
          onPointerEnter={place} onPointerLeave={() => setAt(null)}>
      {children}
      {at && createPortal(
        <div
          style={{
            position: "fixed", left: at.x, top: at.y,
            transform: `translate(${align === "right" ? "-100%" : "0"}, ${at.up ? "-100%" : "0"})`,
          }}
          className="pointer-events-none z-[100] w-max max-w-[18rem] rounded-lg border
                     border-slate-700/40 bg-slate-900 px-2.5 py-1.5 text-left text-[11px]
                     leading-relaxed text-white shadow-xl dark:bg-slate-800">
          {text.map((t, i) => (
            <span key={i} className={`block ${i ? "text-slate-300" : "font-semibold"}`}>{t}</span>
          ))}
        </div>, document.body)}
    </span>
  );
}

export default function PrPoSection() {
  const [filter, setFilter] = useState<PrPoFilter>({});
  const patch = (p: Partial<PrPoFilter>) => setFilter((f) => ({ ...f, ...p }));
  const clear = () => setFilter({});

  const summary  = usePrPoSummary({ from: filter.from });
  const register = usePrPoRegister({ from: filter.from });

  const stage = filter.stage;
  const owner = filter.owner;
  const setStage = (v: string | undefined) => patch({ stage: v, owner: undefined, rag: undefined });
  const setOwner = (v: string | undefined) => patch({ owner: v, stage: undefined, rag: undefined });
  /* The requester narrows whatever is already on screen rather than
     replacing it: "what is Accounts holding, of the ones TAPAS raised" is
     a real question, where stage-and-owner together is not. */
  const setRequester = (v: string | undefined) => patch({ requester: v });
  const requester = filter.requester;

  if (summary.isError) {
    const status = (summary.error as { response?: { status?: number } })?.response?.status;
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900
                      dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <AlertTriangle className="mb-1 mr-1 inline h-4 w-4" />
        {status === 403
          ? "You do not have access to procurement data."
          : "Procurement data could not be read, so nothing is shown rather than something wrong."}
      </div>
    );
  }

  const s = summary.data;
  const rows = register.data?.rows ?? [];
  const byStage = new Map((s?.by_stage ?? []).map((b: PrPoStageBucket) => [b.stage, b]));
  const stagePeak = Math.max(1, ...(s?.by_stage ?? []).map((b) => b.count));
  const agePeak   = Math.max(1, ...(s?.ageing ?? []).map((a) => a.count));
  const duePeak   = Math.max(1, ...(s?.payment_profile?.bands ?? []).map((d) => d.amount));

  const pickStage = (code: string) => setStage(stage === code ? undefined : code);

  const card = (k: string) => s?.cards.find((c) => c.key === k);
  const overduePayable = (s?.payment_profile?.bands ?? []).find((b) => b.band === "Overdue");

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="h-5 w-5" /> PR to Payment
          </h2>
          <p className="text-xs text-slate-500">
            Procurement progress and daily action review · Kaliapani
          </p>
        </div>
        {/* THE WINDOW, IN DATES. "released in the last year" made the
            reader work out what they were looking at, and stopped being
            true the moment the date filter was touched. The server reports
            the window it actually covered and this prints it. */}
        <p className="text-right text-xs text-slate-500">
          {s && (
            <>
              <span className="tabular-nums">{num(s.totals.pr_items)}</span> PR items ·{" "}
              <span className="tabular-nums">{s.totals.pr_numbers}</span> PRs ·{" "}
              <span className="tabular-nums">{s.totals.po_numbers}</span> POs
              <br />
              released <span className="tabular-nums">{span(register.data?.window?.from ?? s.window?.from)}</span>
              {" – "}<span className="tabular-nums">{span(register.data?.window?.to ?? s.window?.to)}</span>
              {" · as on "}<span className="tabular-nums">{span(String(s.as_on))}</span>
            </>
          )}
        </p>
      </header>

      {/* ── the figures ───────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className={`${CARD} p-3`}>
          <div className="text-2xl font-semibold tabular-nums">{num(s?.totals.pr_numbers)}</div>
          <div className="text-xs font-medium">Open requisitions</div>
          <div className="text-[11px] text-slate-500">
            <span className="tabular-nums">{num(s?.totals.pr_items)}</span> lines
            {" · "}<span className="tabular-nums">{num(s?.totals.po_numbers)}</span> POs
          </div>
        </div>

        <button onClick={() => setFilter({ rag: "red" })}
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-left hover:border-rose-400
                     dark:border-rose-900 dark:bg-rose-950/40">
          <div className="text-2xl font-semibold tabular-nums text-rose-900 dark:text-rose-200">
            {num(card("overdue_stage")?.count)}
          </div>
          <div className="text-xs font-medium">Past stage target</div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400">
            {s && card("overdue_stage") && s.totals.pr_numbers
              ? `${Math.round((card("overdue_stage")!.count / s.totals.pr_numbers) * 100)}% of open requisitions`
              : ""}
          </div>
        </button>

        <button onClick={() => pickStage("NFA_PENDING")}
          className={`${CARD} p-3 text-left hover:border-slate-400`}>
          <div className="text-2xl font-semibold tabular-nums">{num(card("nfa_pending")?.count)}</div>
          <div className="text-xs font-medium">NFA awaiting approval</div>
        </button>

        <div className={`${CARD} p-3`}>
          <div className="text-2xl font-semibold tabular-nums">{num(card("delivery_overdue")?.count)}</div>
          <div className="text-xs font-medium">Delivery overdue</div>
        </div>

        <div className={`${CARD} p-3`}>
          <div className="text-2xl font-semibold tabular-nums" title={exact(card("outstanding")?.amount)}>
            {crore(card("outstanding")?.amount)}
          </div>
          <div className="text-xs font-medium">Outstanding payable</div>
          <div className="text-[11px] text-rose-700 dark:text-rose-300" title={exact(overduePayable?.amount)}>
            {crore(overduePayable?.amount)} already overdue
          </div>
        </div>
      </div>

      {/* ── review first ──────────────────────────────────────────────── */}
      {!!s?.review_first?.length && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300
                        bg-amber-50 px-4 py-2.5 text-sm text-amber-950
                        dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <Megaphone className="h-4 w-4 shrink-0" />
          <span className="font-semibold">Review first:</span>
          <span>{s.review_first?.join(" · ")}</span>
        </div>
      )}

      {/* ── where the work is, who holds it, how old it is ────────────── */}
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
        <section className={`${CARD} min-w-0 p-4`}>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className={PANEL_H3}>Where the work is pending</h3>
            <span className="text-[11px] text-slate-500">requisitions · click to filter</span>
          </div>
          <div className="space-y-1">
            {PIPELINE.map(({ stage: code, label }) => {
              const b = byStage.get(code);
              const count = b?.count ?? 0;
              const red = b?.red ?? 0;
              const active = stage === code;
              const pct = (count / stagePeak) * 100;
              return (
                <Hint key={code} lines={[
                  b ? `${count} requisition${count === 1 ? "" : "s"} at ${label}` : `Nothing at ${label}`,
                  red > 0 && `${red} past the stage target`,
                  b?.oldest_days != null && `oldest has been here ${b.oldest_days} days`,
                  Boolean(count) && (active ? "click to clear this filter" : "click to filter the register"),
                ]}>
                <button onClick={() => pickStage(code)} disabled={!count}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition
                    ${active ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                             : count ? "hover:bg-slate-100 dark:hover:bg-slate-800" : "opacity-40"}`}>
                  <span className="w-28 shrink-0 truncate">{label}</span>
                  <span className="relative h-3.5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    {/* within target, then the overdue share drawn inside the
                        same bar -- compared against the whole, not against a
                        separate chart somewhere else on the page */}
                    <span className="absolute inset-y-0 left-0 bg-emerald-400/70"
                          style={{ width: `${pct}%` }} />
                    <span className="absolute inset-y-0 left-0 bg-rose-500"
                          style={{ width: `${count ? (red / stagePeak) * 100 : 0}%` }} />
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums">
                    {count}{red > 0 && <span className={active ? "" : " text-rose-600 dark:text-rose-400"}> · {red} late</span>}
                  </span>
                </button>
                </Hint>
              );
            })}
          </div>
        </section>

        <section className={`${CARD} min-w-0 p-4`}>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className={PANEL_H3}>Pending with</h3>
            <span className="text-[11px] text-slate-500">requisitions · worst first</span>
          </div>
          {/* EVERY OWNER, not the first eleven. A queue that is cut off is
              worse than no list: the desks that fall below the cut are
              exactly the ones nobody is watching, and the panel gave no
              sign they existed. */}
          <ul className="max-h-[19rem] space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
            {(s?.by_owner ?? []).map((o: PrPoOwnerBucket) => {
              const active = owner === o.owner;
              return (
                <li key={o.owner}>
                  <Hint align="right" lines={[
                    `${o.owner} is holding ${o.count} requisition${o.count === 1 ? "" : "s"}`,
                    o.red > 0 && `${o.red} past the stage target`,
                    o.oldest_days != null && `oldest has waited ${o.oldest_days} days`,
                    active ? "click to clear this filter" : "click to filter the register",
                  ]}>
                  <button
                    onClick={() => setOwner(active ? undefined : o.owner)}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs
                      ${active ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                               : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                    <span className="truncate">{o.owner}</span>
                    <span className="shrink-0 tabular-nums">
                      {o.count}
                      {o.red > 0 && <span className={active ? "" : " text-rose-600 dark:text-rose-400"}> ({o.red} late)</span>}
                    </span>
                  </button>
                  </Hint>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={`${CARD} min-w-0 p-4`}>
          <h3 className={`${PANEL_H3} mb-1`}>Ageing</h3>
          <p className="mb-3 text-[11px] text-slate-500">
            requisitions, by how long the holding item has sat in its stage
          </p>
          <div className="space-y-1.5">
            {(s?.ageing ?? []).map((a: PrPoAgeBand) => (
              <Hint key={a.band} lines={[
                `${a.count} requisition${a.count === 1 ? "" : "s"} · ${a.band}`,
                a.red > 0 && `${a.red} past the stage target`,
                a.band === "No date" && "no stage date recorded, so the wait cannot be measured",
              ]}>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0">{a.band}</span>
                <span className="relative h-3.5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  <span className="absolute inset-y-0 left-0 bg-sky-400/70"
                        style={{ width: `${(a.count / agePeak) * 100}%` }} />
                  <span className="absolute inset-y-0 left-0 bg-rose-500"
                        style={{ width: `${(a.red / agePeak) * 100}%` }} />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums">{a.count}</span>
              </div>
              </Hint>
            ))}
          </div>
        </section>
      </div>

      {/* ── buyers, requesters, approvers, money ──────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <section className={`${CARD} min-w-0 p-4`}>
          <h3 className={`${PANEL_H3} mb-1`}>Buyer workload</h3>
          <p className="mb-2 text-[11px] text-slate-500">
            requisitions at procurement stages only · median, not mean — one
            two-year-old item would drag a mean until every desk looked alike
          </p>
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase text-slate-500">
              <tr><th className="py-1">Buyer</th><th className="text-right">PRs</th>
                  <th className="text-right">Late</th><th className="text-right">Median</th></tr>
            </thead>
            <tbody>
              {(s?.buyer_workload ?? []).map((w: PrPoBuyerLoad) => (
                <tr key={w.buyer} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="max-w-[10rem] truncate py-1" title={w.department ?? ""}>
                    {w.buyer}
                    {w.department && (
                      <span className="block truncate text-[10px] text-slate-500">{w.department}</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{w.open_items}</td>
                  <td className="text-right tabular-nums text-rose-600 dark:text-rose-400">{w.past_target}</td>
                  <td className="text-right tabular-nums">
                    {w.median_age_days === null ? "—" : `${w.median_age_days}d`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* WHO ASKED FOR IT. Every other queue on this screen says who has
            to act next; this one says where the demand came from, which is
            what a department asks when it wants to know what it is still
            waiting on -- and the only list here that is not about SCM. */}
        <section className={`${CARD} min-w-0 p-4`}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className={PANEL_H3}>Requested by</h3>
            <span className="text-[11px] text-slate-500">click to filter</span>
          </div>
          <p className="mb-2 text-[11px] text-slate-500">
            open requisitions, by who raised them
          </p>
          {(s?.by_requester ?? []).length ? (
            <ul className="max-h-[17rem] space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
              {(s?.by_requester ?? []).map((q: PrPoRequesterBucket) => {
                const on = requester === q.requester;
                return (
                  <li key={q.requester}>
                    <Hint align="right" lines={[
                      `${q.requester} raised ${q.count} open requisition${q.count === 1 ? "" : "s"}`,
                      q.red > 0 && `${q.red} past the stage target`,
                      q.oldest_days != null && `oldest has waited ${q.oldest_days} days`,
                      on ? "click to clear this filter" : "click to filter the register",
                    ]}>
                      <button
                        onClick={() => setRequester(on ? undefined : q.requester)}
                        className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1
                          text-left text-xs
                          ${on ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                               : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                        <span className="truncate">{q.requester}</span>
                        <span className="shrink-0 tabular-nums">
                          {q.count}
                          {q.red > 0 && (
                            <span className={on ? "" : " text-rose-600 dark:text-rose-400"}>
                              {" "}({q.red} late)
                            </span>)}
                        </span>
                      </button>
                    </Hint>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-xs text-slate-500">No requester is recorded on these PRs.</p>}
        </section>

        <section className={`${CARD} min-w-0 p-4`}>
          <h3 className={`${PANEL_H3} mb-1`}>Approval bottlenecks</h3>
          <p className="mb-2 text-[11px] text-slate-500">NFAs waiting on a signature</p>
          {(s?.approval_bottlenecks ?? []).length ? (
            <ul className="space-y-2">
              {(s?.approval_bottlenecks ?? []).map((a: PrPoApprovalLoad) => (
                <li key={a.approver} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium" title={a.department ?? ""}>{a.approver}</span>
                    <span className="shrink-0 tabular-nums">
                      {a.pending} pending
                      {a.overdue > 0 && <span className="text-rose-600 dark:text-rose-400"> · {a.overdue} overdue</span>}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div className="h-full bg-amber-400"
                         style={{ width: `${Math.min(100, (a.pending / Math.max(1, s?.approval_bottlenecks?.[0]?.pending ?? 1)) * 100)}%` }} />
                  </div>
                  <div className="text-[10px] text-slate-500">oldest {a.oldest_days ?? "?"} days</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">Nothing is waiting on an approver.</p>}
        </section>

        <section className={`${CARD} min-w-0 p-4`}>
          <h3 className={`${PANEL_H3} mb-1`}>Payment due profile</h3>
          <p className="mb-2 text-[11px] text-slate-500">open invoice balance, once per PO</p>
          <div className="space-y-1.5">
            {(s?.payment_profile?.bands ?? []).map((d: PrPoDueBand) => (
              <div key={d.band} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0">{d.band}</span>
                <span className="relative h-3.5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  <span className={`absolute inset-y-0 left-0 ${
                    d.band === "Overdue" ? "bg-rose-500"
                      : d.band === "Due in 7 days" ? "bg-amber-400"
                      : d.band === "Due later" ? "bg-emerald-400/80" : "bg-slate-400"}`}
                    style={{ width: `${(d.amount / duePeak) * 100}%` }} />
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums" title={exact(d.amount)}>
                  {crore(d.amount)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-snug text-slate-500">
            {s?.payment_profile?.basis}
          </p>
        </section>
      </div>

      {/* The whole window goes to the table, which does every filter and
          sort itself. Only `from` is passed to the query, so touching a
          stage, an owner or a column heading costs nothing. */}
      <PrPoRegisterTable
        rows={register.data?.rows ?? []}
        loading={register.isFetching}
        filter={filter}
        onFilter={patch}
        onClear={clear}
      />

    </div>
  );
}
