"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCostSummary, useCostGlDetail } from "@/hooks/useCosting";
import { formatIndian } from "@/lib/utils";
import type { CostSection, CostBucket } from "@/types";

const BUCKET_PILL: Record<CostBucket, { label: string; cls: string }> = {
  DAILY:     { label: "posted daily",  cls: "pill-blue"   },
  FORM:      { label: "contractor",    cls: "pill-orange" },
  FEED:      { label: "feed",          cls: "pill-green"  },
  MONTH_END: { label: "month-end",     cls: "pill-red"    },
};

export default function CostSummaryTable({
  period, section, asOf,
}: { period: string; section: CostSection; asOf?: string }) {
  const { data, isLoading } = useCostSummary(period, section, asOf);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useCostGlDetail(period, section, open);

  if (isLoading) {
    return <div className="bg-white border border-[#d0d9e8] rounded h-[360px] animate-pulse" />;
  }
  if (!data || data.lines.length === 0) {
    return (
      <div className="bg-white border border-[#d0d9e8] rounded p-8 text-center text-[13px] text-txt-muted">
        No cost recorded for this period.
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#d0d9e8] rounded shadow-sm accent-bar-gold">
      <div className="px-4 pt-4 pb-3 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="font-condensed text-[12px] font-bold tracking-[.14em] uppercase text-steel">
            Cost sheet — {section === "MINES" ? "Mines" : "COB Plant"}
          </div>
          <div className="text-[11px] text-txt-muted mt-0.5">
            Click any line to see the GLs behind it
          </div>
        </div>
        <div className="font-mono text-[12px] text-txt-secondary tabular-nums">
          {formatIndian(data.production_mt, 2)} MT produced
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[720px]">
          <thead>
            <tr className="border-y border-[#d0d9e8] bg-bg-soft">
              <Th className="text-left pl-4">Line</Th>
              <Th className="text-right">Actual (Rs.)</Th>
              <Th className="text-right">Plan (Rs.)</Th>
              <Th className="text-right">Variance</Th>
              <Th className="text-right pr-4">Rs./MT</Th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              const isOpen = open === l.line;
              const clickable = !l.is_total;
              return (
                <>
                  <tr
                    key={l.line}
                    onClick={() => clickable && setOpen(isOpen ? null : l.line)}
                    className={[
                      "border-b border-[#eef2f8]",
                      l.is_total
                        ? "bg-bg-section font-bold text-txt-primary"
                        : "hover:bg-bg-light cursor-pointer",
                    ].join(" ")}
                  >
                    <td className="py-2 pl-4">
                      <div className="flex items-center gap-2">
                        {clickable &&
                          (isOpen ? <ChevronDown size={13} className="text-txt-light" />
                                  : <ChevronRight size={13} className="text-txt-light" />)}
                        {!clickable && <span className="w-[13px]" />}
                        <span>{l.line}</span>
                        {l.bucket && !l.is_total && (
                          <span className={BUCKET_PILL[l.bucket].cls}>
                            {BUCKET_PILL[l.bucket].label}
                          </span>
                        )}
                      </div>
                    </td>
                    <Td>{formatIndian(l.actual)}</Td>
                    <Td muted={l.plan === 0}>{l.plan ? formatIndian(l.plan) : "no plan"}</Td>
                    <Td
                      className={
                        l.is_total ? "" : l.variance > 0 ? "text-danger" : "text-success"
                      }
                    >
                      {l.is_total || !l.plan ? "—" : formatIndian(l.variance)}
                    </Td>
                    <Td className="pr-4">
                      {l.rs_per_mt != null ? formatIndian(l.rs_per_mt) : "—"}
                    </Td>
                  </tr>

                  {isOpen && (
                    <tr key={`${l.line}-detail`} className="bg-bg-light">
                      <td colSpan={5} className="px-4 py-3">
                        {detail.isLoading ? (
                          <div className="text-[12px] text-txt-muted">Loading GLs…</div>
                        ) : (detail.data?.rows.length ?? 0) === 0 ? (
                          <div className="text-[12px] text-txt-muted">No GL detail.</div>
                        ) : (
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="text-txt-muted">
                                <th className="text-left font-medium pb-1">GL</th>
                                <th className="text-left font-medium pb-1">Description</th>
                                <th className="text-left font-medium pb-1">Cost centre</th>
                                <th className="text-right font-medium pb-1">Lines</th>
                                <th className="text-right font-medium pb-1">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.data!.rows.map((r) => (
                                <tr key={`${r.gl_account}-${r.cost_centre}`}
                                    className="border-t border-[#e2e8f0]">
                                  <td className="py-1 font-mono text-txt-secondary">{r.gl_account}</td>
                                  <td className="py-1 text-txt-secondary">{r.gl_description}</td>
                                  <td className="py-1 font-mono text-txt-light">
                                    {r.cost_centre || "—"}
                                  </td>
                                  <td className="py-1 text-right font-mono text-txt-light tabular-nums">
                                    {r.lines}
                                  </td>
                                  <td className="py-1 text-right font-mono text-txt-primary tabular-nums">
                                    {formatIndian(r.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`py-2 px-2 font-condensed text-[10px] font-bold tracking-[.1em] uppercase text-txt-muted ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children, className = "", muted = false,
}: { children: React.ReactNode; className?: string; muted?: boolean }) {
  return (
    <td className={`py-2 px-2 text-right font-mono tabular-nums ${muted ? "text-txt-light" : ""} ${className}`}>
      {children}
    </td>
  );
}
