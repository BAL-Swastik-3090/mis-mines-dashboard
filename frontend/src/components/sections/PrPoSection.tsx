"use client";
import { useState } from "react";
import { ClipboardList, AlertTriangle, Search, X, ChevronRight } from "lucide-react";
import { usePrPoSummary, usePrPoRegister } from "@/hooks/usePrPo";
import type { PrPoRow, PrPoStageBucket, PrPoOwnerBucket } from "@/types";

/* PR to Payment.

   THE SCREEN IS BUILT ROUND THREE QUESTIONS, in the order a morning meeting
   asks them: where is the work stuck, who is holding it, and which cases do
   we talk about today. A flat table answers none of them -- the first
   version of this page was 2,191 rows sorted by release date, which opened
   on the newest items, every one of them reading "on track", while 1,695
   sat past their target below the fold.

   The pipeline strip is the backbone. Procurement is a sequence, so the
   stages are drawn in sequence rather than as ten identical boxes: where the
   column is tall is where the backlog is, and that is readable before any
   number is. */

/* ── money ──────────────────────────────────────────────────────────────
   Rupees in crore. The register runs to ten-digit figures and
   "₹ 1,65,64,06,404" is a number nobody reads off a projector; "₹ 165.6 Cr"
   is the same fact at the precision the conversation actually uses. The
   exact figure stays in the tooltip for whoever needs to reconcile it. */
function crore(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹ ${(v / 1e7).toFixed(1)} Cr`;
  if (abs >= 1e5) return `₹ ${(v / 1e5).toFixed(1)} L`;
  return `₹ ${Math.round(v).toLocaleString("en-IN")}`;
}
const exact = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : `₹ ${Math.round(v).toLocaleString("en-IN")}`;

/* Colour never carries a fact on its own -- this is read off a projector and
   by people who cannot separate red from green. Every badge says the word. */
const RAG_STYLE: Record<string, string> = {
  red:     "bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:ring-rose-900",
  amber:   "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-900",
  green:   "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-900",
  unknown: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
};
const RAG_WORD: Record<string, string> = {
  red: "Overdue", amber: "Due soon", green: "On track", unknown: "No target",
};

/* The procurement sequence, in order. Drawn left to right so the shape of
   the backlog is visible before any figure is read. */
const PIPELINE: { stage: string; short: string }[] = [
  { stage: "UNASSIGNED",   short: "Assign" },
  { stage: "ASSIGNED",     short: "RFQ" },
  { stage: "RFQ_ISSUED",   short: "Quotes" },
  { stage: "QUOTES_IN",    short: "Compare" },
  { stage: "EVALUATION",   short: "Evaluate" },
  { stage: "NFA_PENDING",  short: "NFA" },
  { stage: "NFA_APPROVED", short: "Raise PO" },
  { stage: "PO_CREATED",   short: "Release" },
  { stage: "PO_RELEASED",  short: "Deliver" },
  { stage: "RECEIVED",     short: "Invoice" },
  { stage: "INVOICED",     short: "Pay" },
  { stage: "PAID",         short: "Closed" },
];

function Dash() { return <span className="text-slate-400">—</span>; }

export default function PrPoSection() {
  const [stage, setStage] = useState<string | undefined>();
  const [owner, setOwner] = useState<string | undefined>();
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");

  const summary  = usePrPoSummary();
  const register = usePrPoRegister({
    stage, owner, q, rag: onlyOverdue ? "red" : undefined,
  });

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

  const s    = summary.data;
  const rows = register.data?.rows ?? [];
  const byStage = new Map((s?.by_stage ?? []).map((b: PrPoStageBucket) => [b.stage, b]));
  const peak = Math.max(1, ...(s?.by_stage ?? []).map((b) => b.count));
  const filtering = Boolean(stage || owner || q || onlyOverdue);

  const clear = () => { setStage(undefined); setOwner(undefined);
                        setOnlyOverdue(false); setQ(""); setTyped(""); };

  const money = s?.cards.find((c) => c.key === "outstanding");
  const overdueDelivery = s?.cards.find((c) => c.key === "delivery_overdue");
  const pastTarget = s?.cards.find((c) => c.key === "overdue_stage");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5" /> PR to Payment
        </h2>
        <p className="text-xs text-slate-500">
          {s ? `${s.totals.pr_items.toLocaleString("en-IN")} PR items · ${s.totals.pr_numbers} PRs · ${s.totals.po_numbers} POs · released in the last year · as on ${String(s.as_on)}` : ""}
        </p>
      </header>

      {/* ── the three figures worth a headline ─────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          onClick={() => { clear(); setOnlyOverdue(true); }}
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-left
                     hover:border-rose-400 dark:border-rose-900 dark:bg-rose-950/40"
        >
          <div className="text-3xl font-semibold tabular-nums text-rose-900 dark:text-rose-200">
            {pastTarget?.count ?? "—"}
          </div>
          <div className="mt-1 text-sm font-medium">Past stage target</div>
          <div className="text-xs text-slate-600 dark:text-slate-400">
            of {s?.totals.pr_items.toLocaleString("en-IN")} open items · click to list them
          </div>
        </button>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-3xl font-semibold tabular-nums" title={exact(money?.amount)}>
            {crore(money?.amount)}
          </div>
          <div className="mt-1 text-sm font-medium">Outstanding payable</div>
          <div className="text-xs text-slate-600 dark:text-slate-400">
            invoiced and not yet paid, counted once per PO
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-3xl font-semibold tabular-nums">{overdueDelivery?.count ?? "—"}</div>
          <div className="mt-1 text-sm font-medium">Delivery overdue</div>
          <div className="text-xs text-slate-600 dark:text-slate-400">
            PO delivery date passed, not marked complete
          </div>
        </div>
      </div>

      {/* ── the pipeline ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Where the work is sitting</h3>
          <p className="text-xs text-slate-500">height is the count · red is past target · click a stage to filter</p>
        </div>
        <div className="flex items-end gap-1 overflow-x-auto pb-1">
          {PIPELINE.map(({ stage: code, short }, i) => {
            const b = byStage.get(code);
            const count = b?.count ?? 0;
            const red = b?.red ?? 0;
            const active = stage === code;
            const h = Math.round((count / peak) * 72) + 4;
            return (
              <div key={code} className="flex items-end gap-1">
                <button
                  onClick={() => { setOwner(undefined); setOnlyOverdue(false);
                                   setStage(active ? undefined : code); }}
                  disabled={!count}
                  title={b ? `${b.label}: ${count} items, ${red} past target, oldest ${b.oldest_days ?? "?"} days`
                           : `${short}: nothing here`}
                  className={`flex min-w-[64px] flex-col items-center rounded-lg px-1.5 py-2 transition
                    ${active ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                             : count ? "hover:bg-slate-100 dark:hover:bg-slate-800"
                                     : "opacity-40"}`}
                >
                  <span className="text-sm font-semibold tabular-nums">{count}</span>
                  <span
                    className="mt-1 w-7 rounded-sm bg-slate-300 dark:bg-slate-600"
                    style={{ height: `${h}px` }}
                  >
                    {/* the overdue share, drawn inside the same bar so the
                        eye compares it against the whole and not against
                        a second chart somewhere else */}
                    <span
                      className="block w-full rounded-sm bg-rose-500"
                      style={{ height: count ? `${Math.round((red / count) * h)}px` : 0 }}
                    />
                  </span>
                  <span className="mt-1 text-[10px] leading-tight">{short}</span>
                </button>
                {i < PIPELINE.length - 1 && (
                  <ChevronRight className="mb-6 h-3 w-3 shrink-0 text-slate-300 dark:text-slate-600" />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        {/* ── who is holding it ────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-1 text-sm font-semibold">Pending with</h3>
          <p className="mb-3 text-xs text-slate-500">worst queue first</p>
          <ul className="space-y-1">
            {(s?.by_owner ?? []).slice(0, 10).map((o: PrPoOwnerBucket) => {
              const active = owner === o.owner;
              return (
                <li key={o.owner}>
                  <button
                    onClick={() => { setStage(undefined); setOnlyOverdue(false);
                                     setOwner(active ? undefined : o.owner); }}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs
                      ${active ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                               : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                  >
                    <span className="truncate" title={o.owner}>{o.owner}</span>
                    <span className="shrink-0 tabular-nums">
                      {o.count}
                      {o.red > 0 && (
                        <span className={active ? "ml-1" : "ml-1 text-rose-600 dark:text-rose-400"}>
                          ({o.red} late)
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── the register ─────────────────────────────────────────────── */}
        <section className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1.5 h-4 w-4 text-slate-400" />
              <input
                id="pr-po-search"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setQ(typed); }}
                onBlur={() => setQ(typed)}
                placeholder="PR, PO, vendor, description…"
                className="w-64 rounded border border-slate-300 py-1 pl-8 pr-2 text-sm
                           dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={onlyOverdue}
                     onChange={(e) => setOnlyOverdue(e.target.checked)} />
              Overdue only
            </label>
            {filtering && (
              <button onClick={clear}
                      className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-xs
                                 dark:bg-slate-700">
                <X className="h-3 w-3" /> Clear filters
              </button>
            )}
            <span className="ml-auto text-xs text-slate-500">
              {register.isFetching ? "loading…"
                : `${(register.data?.total ?? 0).toLocaleString("en-IN")} items`}
              {register.data?.truncated && " · first 500"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide
                                text-slate-500 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2">Age</th>
                  <th className="px-3 py-2">PR / item</th>
                  <th className="px-3 py-2">What it is</th>
                  <th className="px-3 py-2">Next action</th>
                  <th className="px-3 py-2">Pending with</th>
                  <th className="px-3 py-2">Requested by</th>
                  <th className="px-3 py-2">PO / vendor</th>
                  <th className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: PrPoRow) => (
                  <tr key={`${r.pr_number}-${r.pr_item}`}
                      className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ring-1 ${RAG_STYLE[r.rag] ?? RAG_STYLE.unknown}`}>
                        {r.stage_age_days === null ? "—" : `${r.stage_age_days}d`} · {RAG_WORD[r.rag] ?? "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {r.pr_number}
                      <span className="text-slate-400">/{r.pr_item}</span>
                    </td>
                    <td className="max-w-[18rem] px-3 py-2">
                      <div className="truncate" title={r.description ?? ""}>
                        {r.description || <Dash />}
                      </div>
                      <div className="text-xs text-slate-500">{r.stage_label}</div>
                    </td>
                    <td className="px-3 py-2">{r.next_action || <Dash />}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2" title={r.pending_with ?? ""}>
                      {r.pending_with || <Dash />}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.requisitioner || r.created_by || <Dash />}
                    </td>
                    <td className="max-w-[14rem] px-3 py-2">
                      {r.po_no ? (
                        <>
                          <div className="font-medium">{r.po_no}</div>
                          <div className="truncate text-xs text-slate-500" title={r.vendor ?? ""}>
                            {r.vendor || "vendor not named"}
                          </div>
                        </>
                      ) : <Dash />}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      <div title={exact(r.po_value)}>{crore(r.po_value)}</div>
                      {r.outstanding !== null && r.outstanding > 0 && (
                        <div className="text-xs text-slate-500" title={exact(r.outstanding)}>
                          {crore(r.outstanding)} due
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && !register.isFetching && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    Nothing matches this filter.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {s?.targets_provisional && (
            <p className="text-xs text-slate-500">
              Stage targets are provisional pending SCM agreement, so
              &ldquo;overdue&rdquo; is measured against a working assumption,
              not an agreed service level.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
