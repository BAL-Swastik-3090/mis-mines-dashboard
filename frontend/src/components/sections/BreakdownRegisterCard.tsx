"use client";
import { useMemo, useState } from "react";
import {
  ListTree, Search, ChevronRight, RefreshCw, AlertTriangle, X,
} from "lucide-react";
import { useWhyWhyRegister } from "@/hooks/useInsights";
import { formatIndian } from "@/lib/utils";
import type { WhyWhyRegisterRow } from "@/types";

/**
 * The breakdown register — every recorded breakdown, its cause and its 5-Why.
 *
 * The rest of the section aggregates. This is the opposite: it exists so a
 * figure can be traced back to the rows behind it, and so the maintenance team
 * can read what they actually wrote. Everything here is recorded data; nothing
 * is derived except the failure family, which is a keyword grouping of the
 * free-text defect.
 *
 * Loaded on demand. At ~220 KB for 345 records it would otherwise be refetched
 * on every date change alongside the analysis payload, which is read far more
 * often and needs to stay quick.
 */

const CAUSE_TONE: Record<string, string> = {
  "Operator Error":      "bg-[#e65100]/10 text-[#e65100]",
  "Ageing":              "bg-[#5e7fb8]/10 text-[#3f5f96]",
  "Tyre / Haul Road":    "bg-[#c8960c]/10 text-[#8a6708]",
  "Diesel & Electrical": "bg-[#5e35b1]/10 text-[#5e35b1]",
  "Electrical":          "bg-[#00897b]/10 text-[#00695c]",
};
const CAUSE_FALLBACK = "bg-bg-subtle text-txt-muted";

const PAGE = 25;

function Row({ r }: { r: WhyWhyRegisterRow }) {
  const [open, setOpen] = useState(false);
  const hasWhy = r.why.length > 0;

  return (
    <div className="border-b border-border-light last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 px-1 py-2 text-left hover:bg-bg-subtle/50"
      >
        <ChevronRight
          size={13}
          className={`mt-[3px] shrink-0 transition-transform ${
            open ? "rotate-90 text-navy" : "text-txt-muted"
          } ${hasWhy ? "" : "opacity-30"}`}
        />
        <span className="w-[86px] shrink-0 font-mono text-[11.5px] text-txt-muted">
          {r.date}
          {r.shift ? <span className="ml-1 text-txt-muted/70">{r.shift}</span> : null}
        </span>
        <span className="w-[74px] shrink-0 font-mono text-[12px] text-navy">{r.machine}</span>
        <span className="min-w-0 flex-1 text-[12px] text-txt-primary">
          {r.defect ?? <span className="text-txt-muted">defect not described</span>}
          {/* Said plainly rather than left as an empty expander: 198 of 345
              records have no ladder, and that absence is itself a finding. */}
          {!hasWhy ? (
            <span className="ml-2 text-[10.5px] text-txt-muted">no Why-Why recorded</span>
          ) : null}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-[1px] text-[10.5px] font-semibold ${
            r.cause ? CAUSE_TONE[r.cause] ?? CAUSE_FALLBACK : CAUSE_FALLBACK
          }`}
        >
          {r.cause ?? "cause not recorded"}
        </span>
        <span className="w-[54px] shrink-0 text-right font-mono text-[11.5px] text-txt-muted">
          {r.hours} h
        </span>
        <span className="w-[74px] shrink-0 text-right font-mono text-[11.5px] text-txt-muted">
          {r.cost ? `₹${formatIndian(r.cost)}` : "—"}
        </span>
      </button>

      {open ? (
        <div className="px-1 pb-3 pl-[22px]">
          <div className="rounded-lg border border-border bg-bg-subtle/40 px-3.5 py-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-txt-muted">
              {r.notification_no ? <span>SAP {r.notification_no}</span> : null}
              {r.component ? <span>Component: {r.component}</span> : null}
              {r.cause_detail ? <span>Recorded as: {r.cause_detail}</span> : null}
              <span>{r.family}</span>
              {r.operator ? <span>Operator on record: {r.operator}</span> : null}
            </div>

            {hasWhy ? (
              <ol className="mt-2.5 space-y-2">
                {r.why.map((p) => (
                  <li key={p.level} className="border-l-2 border-accent/30 pl-2.5">
                    <div className="text-[11.5px] font-semibold text-txt-secondary">
                      Why {p.level}
                      {p.question ? (
                        <span className="ml-1.5 font-normal text-txt-muted">{p.question}</span>
                      ) : null}
                    </div>
                    {p.answer ? (
                      <div className="mt-[2px] text-[12px] leading-snug text-txt-primary">
                        {p.answer}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2.5 text-[11.5px] text-txt-muted">
                No Why-Why analysis was raised against this breakdown.
              </p>
            )}

            {r.root_cause ? (
              <div className="mt-2.5 border-t border-border-light pt-2">
                <span className="font-condensed text-[10.5px] font-bold uppercase tracking-widest text-txt-muted">
                  Root cause
                </span>
                <p className="mt-0.5 text-[12px] text-txt-primary">{r.root_cause}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function BreakdownRegisterCard() {
  // Loaded with the section. It was behind a button because it is ~220 KB and
  // that felt worth a click; in use the click was pure friction — the register
  // is the thing people came to read.
  const { data, isLoading, isFetching } = useWhyWhyRegister(true);
  const [q, setQ] = useState("");
  const [machine, setMachine] = useState("");
  const [cause, setCause] = useState("");
  const [onlyWhy, setOnlyWhy] = useState(false);
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (machine && r.machine !== machine) return false;
      if (cause && r.cause !== cause) return false;
      if (onlyWhy && r.why.length === 0) return false;
      if (!needle) return true;
      // Search the Why text too — "haul road" should find the breakdowns whose
      // ladder blames the road, not only those whose defect names it.
      return (
        r.defect?.toLowerCase().includes(needle) ||
        r.machine.toLowerCase().includes(needle) ||
        r.operator?.toLowerCase().includes(needle) ||
        r.notification_no?.toLowerCase().includes(needle) ||
        r.component?.toLowerCase().includes(needle) ||
        r.root_cause?.toLowerCase().includes(needle) ||
        r.why.some((p) => (p.answer ?? "").toLowerCase().includes(needle))
      ) ?? false;
    });
  }, [data, q, machine, cause, onlyWhy]);

  const shown = rows.slice(0, page * PAGE);
  const filtered = Boolean(q || machine || cause || onlyWhy);

  const reset = () => {
    setQ(""); setMachine(""); setCause(""); setOnlyWhy(false); setPage(1);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-border-light px-4 pb-2 pt-3">
        <ListTree size={15} className="text-navy" />
        <span className="font-condensed text-[12px] font-bold uppercase tracking-widest text-txt-secondary">
          Breakdown register
        </span>
        <span className="ml-auto text-[11px] text-txt-muted">
          {data
            ? `${data.with_why} of ${data.rows.length} have a Why-Why`
            : "every breakdown, its cause and its 5-Why"}
        </span>
      </div>

      <div className="px-4 py-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12.5px] text-txt-muted">
            <RefreshCw size={14} className="animate-spin" /> Loading the register…
          </div>
        ) : !data || data.rows.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-txt-muted">
            No breakdowns recorded for the selected dates.
          </p>
        ) : (
          <>
            {/* filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-muted" />
                <input
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(1); }}
                  placeholder="Search defect, machine, operator, Why text, SAP no…"
                  className="w-full rounded border border-border bg-white py-1.5 pl-8 pr-2 text-[12px]
                             text-txt-primary placeholder:text-txt-muted focus:border-navy focus:outline-none"
                />
              </div>
              <select
                value={machine}
                onChange={(e) => { setMachine(e.target.value); setPage(1); }}
                className="rounded border border-border bg-white px-2 py-1.5 text-[12px] text-txt-secondary focus:border-navy focus:outline-none"
              >
                <option value="">All machines</option>
                {data.machines.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select
                value={cause}
                onChange={(e) => { setCause(e.target.value); setPage(1); }}
                className="rounded border border-border bg-white px-2 py-1.5 text-[12px] text-txt-secondary focus:border-navy focus:outline-none"
              >
                <option value="">All causes</option>
                {data.causes.map((cz) => <option key={cz} value={cz}>{cz}</option>)}
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-txt-secondary">
                <input
                  type="checkbox"
                  checked={onlyWhy}
                  onChange={(e) => { setOnlyWhy(e.target.checked); setPage(1); }}
                  className="accent-navy"
                />
                With Why-Why only
              </label>
              {filtered ? (
                <button onClick={reset}
                        className="flex items-center gap-1 text-[11.5px] text-txt-muted hover:text-navy">
                  <X size={12} /> Clear
                </button>
              ) : null}
            </div>

            <div className="mt-2 flex items-center gap-2 text-[11px] text-txt-muted">
              <span>
                {rows.length} of {data.rows.length} breakdowns
                {filtered ? " match" : ""}
              </span>
              {isFetching ? (
                <span className="flex items-center gap-1">
                  <RefreshCw size={11} className="animate-spin" /> refreshing
                </span>
              ) : null}
              {data.without_why > 0 && !onlyWhy ? (
                <span className="ml-auto flex items-center gap-1">
                  <AlertTriangle size={11} className="text-[#c8960c]" />
                  {data.without_why} have no Why-Why raised against them
                </span>
              ) : null}
            </div>

            <div className="mt-2 border-t border-border-light">
              {shown.map((r) => <Row key={r.id} r={r} />)}
            </div>

            {shown.length < rows.length ? (
              <button
                onClick={() => setPage(page + 1)}
                className="mt-2.5 w-full rounded border border-border py-1.5 text-[12px] font-semibold text-navy hover:bg-bg-subtle"
              >
                Show {Math.min(PAGE, rows.length - shown.length)} more
                <span className="ml-1.5 font-normal text-txt-muted">
                  ({rows.length - shown.length} remaining)
                </span>
              </button>
            ) : null}

            {rows.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-txt-muted">
                Nothing matches those filters.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
