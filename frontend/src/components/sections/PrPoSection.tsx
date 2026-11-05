"use client";
import { useState } from "react";
import { ClipboardList, AlertTriangle } from "lucide-react";
import { usePrPoSummary, usePrPoRegister } from "@/hooks/usePrPo";
import { formatIndian } from "@/lib/utils";
import type { PrPoCard, PrPoRow } from "@/types";

/* PR to Payment.

   A released requisition's progress, who it is sitting with, and for how
   long. One card per thing somebody has to chase; clicking a card filters
   the register below it to exactly the rows that card counted -- the count
   and the list come from one read on the server, so the two cannot drift.  */

const RAG: Record<string, string> = {
  red:     "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  amber:   "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  green:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  unknown: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

/* The words matter more than the colour: a colour alone is unreadable to
   anybody who cannot distinguish them, and this screen is read in a meeting
   off a projector. */
const RAG_LABEL: Record<string, string> = {
  red: "Overdue", amber: "Due soon", green: "On track", unknown: "No target",
};

function Dash() {
  /* Missing information reads as unavailable, never as zero or complete. */
  return <span className="text-slate-400">—</span>;
}

function Cell({ v }: { v: string | number | null | undefined }) {
  return v === null || v === undefined || v === "" ? <Dash /> : <>{v}</>;
}

export default function PrPoSection() {
  const [stage, setStage] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");

  const summary = usePrPoSummary();
  const register = usePrPoRegister({ stage, q });

  if (summary.isError) {
    const status = (summary.error as { response?: { status?: number } })
      ?.response?.status;
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm
                      text-amber-900 dark:border-amber-800 dark:bg-amber-950
                      dark:text-amber-100">
        <AlertTriangle className="mb-1 inline h-4 w-4" />{" "}
        {status === 403
          ? "You do not have access to procurement data."
          : "Procurement data could not be read. The figures below are not shown rather than shown wrong."}
      </div>
    );
  }

  const s = summary.data;
  const rows = register.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5" /> PR to Payment
        </h2>
        {s && (
          <p className="text-xs text-slate-500">
            {s.totals.pr_items} PR items · {s.totals.pr_numbers} PRs ·{" "}
            {s.totals.po_numbers} POs · as on {String(s.as_on)}
          </p>
        )}
      </header>

      {s?.targets_provisional && (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs
                      text-slate-600 dark:border-slate-700 dark:bg-slate-900
                      dark:text-slate-300">
          Stage targets are provisional pending SCM agreement, so
          &ldquo;overdue&rdquo; below is against a working assumption rather
          than an agreed service level.
        </p>
      )}

      {/* ── the cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {(s?.cards ?? []).map((c: PrPoCard) => {
          const active = stage === c.filter?.stage;
          return (
            <button
              key={c.key}
              onClick={() => setStage(active ? undefined : c.filter?.stage)}
              className={`rounded-lg border p-3 text-left transition
                ${active
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200 bg-white hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900"}`}
            >
              <div className="text-2xl font-semibold tabular-nums">{c.count}</div>
              <div className="mt-0.5 text-xs leading-snug">{c.label}</div>
              {c.amount !== undefined && c.amount !== null && (
                <div className="mt-1 text-xs tabular-nums opacity-75">
                  ₹ {formatIndian(c.amount, 0)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── search and the active filter ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="pr-po-search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setQ(typed); }}
          onBlur={() => setQ(typed)}
          placeholder="PR, PO, vendor, description…"
          className="w-64 rounded border border-slate-300 px-2 py-1 text-sm
                     dark:border-slate-700 dark:bg-slate-900"
        />
        {stage && (
          <button onClick={() => setStage(undefined)}
                  className="rounded bg-slate-200 px-2 py-1 text-xs dark:bg-slate-700">
            Showing {stage} · clear
          </button>
        )}
        <span className="text-xs text-slate-500">
          {register.isFetching ? "loading…" : `${register.data?.total ?? 0} rows`}
          {register.data?.truncated && " (first 500 shown)"}
        </span>
      </div>

      {/* ── the register ──────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide
                            text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2">PR / item</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Requested by</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Pending with</th>
              <th className="px-3 py-2 text-right">Stage age</th>
              <th className="px-3 py-2">PO</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2 text-right">PO value</th>
              <th className="px-3 py-2 text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: PrPoRow) => (
              <tr key={`${r.pr_number}-${r.pr_item}`}
                  className="border-t border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  {r.pr_number}/{r.pr_item}
                </td>
                <td className="max-w-xs truncate px-3 py-2" title={r.description ?? ""}>
                  <Cell v={r.description} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Cell v={r.requisitioner || r.created_by} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">{r.stage_label}</td>
                <td className="whitespace-nowrap px-3 py-2"><Cell v={r.pending_with} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {r.stage_age_days === null ? <Dash /> : (
                    <span className={`rounded px-1.5 py-0.5 ${RAG[r.rag] ?? RAG.unknown}`}>
                      {r.stage_age_days}d · {RAG_LABEL[r.rag] ?? "—"}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2"><Cell v={r.po_no} /></td>
                <td className="max-w-[12rem] truncate px-3 py-2" title={r.vendor ?? ""}>
                  <Cell v={r.vendor} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {r.po_value === null ? <Dash /> : formatIndian(r.po_value, 0)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {r.outstanding === null ? <Dash /> : formatIndian(r.outstanding, 0)}
                </td>
              </tr>
            ))}
            {!rows.length && !register.isFetching && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                Nothing matches this filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
