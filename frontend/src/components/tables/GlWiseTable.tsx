"use client";
/**
 * The GL Wise Summary sheet - phase two of the workbook.
 *
 * One row per GL with Mines and COB side by side, the group it rolls into,
 * and the department's note on how that cost should be captured. GLs costing
 * excludes are listed rather than hidden: "is anything material sitting
 * outside the cost sheet?" is the question this sheet is read to answer.
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useGlWise, type GlWiseRow } from "@/hooks/useCosting";
import { formatIndian } from "@/lib/utils";

export default function GlWiseTable({ period }: { period: string }) {
  const { data, isLoading } = useGlWise(period);
  const [query, setQuery] = useState("");
  const [showExcluded, setShowExcluded] = useState(true);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (!showExcluded && !r.included) return false;
      if (!q) return true;
      return (
        r.gl_account.includes(q) ||
        r.gl_description.toLowerCase().includes(q) ||
        (r.costing_group ?? "").toLowerCase().includes(q) ||
        (r.summary_line ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, query, showExcluded]);

  if (isLoading) {
    return <div className="bg-white border border-[#d0d9e8] rounded h-[420px] animate-pulse" />;
  }
  if (!data) {
    return (
      <div className="bg-white border border-[#d0d9e8] rounded p-8 text-center text-[13px] text-txt-muted">
        No GL detail for this period.
      </div>
    );
  }

  const inc = data.totals.included;
  const exc = data.totals.excluded;

  return (
    <div className="bg-white border border-[#d0d9e8] rounded shadow-sm accent-bar-teal">
      <div className="px-4 pt-4 pb-3 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="font-condensed text-[12px] font-bold tracking-[.14em] uppercase text-steel">
            GL wise summary
          </div>
          <div className="text-[11px] text-txt-muted mt-0.5">
            {inc.rows} GLs in the cost sheet · {exc.rows} outside it
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-txt-secondary">
            <input type="checkbox" checked={showExcluded}
              onChange={(e) => setShowExcluded(e.target.checked)} />
            Show excluded GLs
          </label>
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-txt-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="GL, description or group"
              className="border border-[#d0d9e8] rounded pl-7 pr-2 py-1.5 text-[12px]
                         text-txt-secondary bg-white focus:outline-none focus:border-accent w-[220px]"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
        <table className="w-full text-[12px] min-w-[940px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-y border-[#d0d9e8] bg-bg-soft text-txt-muted">
              <Th className="text-left pl-4">Account Number</Th>
              <Th className="text-left">GL Description</Th>
              <Th className="text-left">Group</Th>
              <Th className="text-right">Total As per Accounts</Th>
              <Th className="text-right">Accounts - Mines</Th>
              <Th className="text-right">Accounts - COB</Th>
              <Th className="text-left pr-4">Remarks</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.gl_account} r={r} />)}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-txt-muted">
                  Nothing matches that search.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0">
            <tr className="border-t-2 border-[#d0d9e8] bg-bg-soft font-semibold text-txt-primary">
              <td className="py-2 pl-4" colSpan={3}>In the cost sheet</td>
              <Td>{formatIndian(inc.total)}</Td>
              <Td>{formatIndian(inc.mines)}</Td>
              <Td>{formatIndian(inc.cob)}</Td>
              <td />
            </tr>
            <tr className="border-t border-[#eef2f8] bg-bg-soft text-txt-muted">
              <td className="py-2 pl-4" colSpan={3}>Outside the cost sheet</td>
              <Td>{formatIndian(exc.total)}</Td>
              <Td>{formatIndian(exc.mines)}</Td>
              <Td>{formatIndian(exc.cob)}</Td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Nil reads as a dash on the sheet, not as a measured zero. */
function dash(n: number) {
  return n === 0 ? "-" : formatIndian(n);
}

function Row({ r }: { r: GlWiseRow }) {
  return (
    <tr className={`border-b border-[#eef2f8] ${r.included ? "" : "bg-[#fbfbfc] text-txt-muted"}`}>
      <td className="py-1.5 pl-4 font-mono tabular-nums text-txt-secondary">{r.gl_account}</td>
      <td className="py-1.5 pr-3">{r.gl_description}</td>
      {/* The workbook's Group column verbatim - "Not Required", "Feed Cost",
          "Excavation Cost" and so on. Not summary_line: the two differ, and
          that difference is the mapping defect this sheet exists to expose. */}
      <td className="py-1.5 pr-3">{r.costing_group || "—"}</td>
      <Td mono>{dash(r.total)}</Td>
      <Td mono>{dash(r.mines)}</Td>
      <Td mono>{dash(r.cob)}</Td>
      <td className="py-1.5 pr-4 text-[11px] text-txt-muted max-w-[300px]">{r.remark}</td>
    </tr>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`py-2 font-condensed text-[11px] font-bold tracking-wider uppercase ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`py-1.5 pr-3 text-right tabular-nums ${mono ? "font-mono" : ""}`}>{children}</td>
  );
}
