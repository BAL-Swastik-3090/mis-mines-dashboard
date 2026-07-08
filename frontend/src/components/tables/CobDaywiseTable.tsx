"use client";
import { useCobSummary } from "@/hooks/useCob";
import { formatIndian, formatPct, pctBgClass } from "@/lib/utils";

function pctOf(a: number | null, p: number | null): number | null {
  if (a == null || p == null || p === 0) return null;
  return Math.round((a / p) * 1000) / 10;
}

function dateLabel(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short",
  });
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-border-light">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-2 py-2.5">
          <div className="h-3.5 bg-bg-section animate-pulse rounded" />
        </td>
      ))}
    </tr>
  );
}

function PctPill({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-txt-light text-[11px]">—</span>;
  return <span className={pctBgClass(pct)}>{formatPct(pct)}</span>;
}

function Num({ v, dec = 0 }: { v: number | null; dec?: number }) {
  if (v == null) return <span className="text-txt-light/50">—</span>;
  return <span>{dec > 0 ? v.toFixed(dec) : formatIndian(v)}</span>;
}

export default function CobDaywiseTable() {
  const { data, isLoading } = useCobSummary();
  const rows = data?.rows ?? []; // ascending: oldest → newest (most recent at bottom)

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Day-wise COB Plant Analysis
        </span>
        <span className="text-[12px] text-txt-muted font-mono">
          {isLoading ? "…" : `${data?.rows.length ?? 0} days`}
        </span>
      </div>

      {/* maxHeight = 2 header rows (~66px) + 10 body rows (~36px each) = ~426px */}
      <div className="overflow-auto" style={{ maxHeight: "426px" }}>
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-section border-b border-border">
              <th className="px-3 py-2.5 text-left font-bold text-txt-secondary text-[12px]" rowSpan={2}>Date</th>
              {/* Feed */}
              <th className="px-2 py-2 text-center font-bold text-accent text-[12px] border-l border-border-light" colSpan={3}>
                Feed (MT)
              </th>
              {/* COB */}
              <th className="px-2 py-2 text-center font-bold text-[#c8960c] text-[12px] border-l border-border-light" colSpan={3}>
                COB (MT)
              </th>
              {/* Tailings */}
              <th className="px-2 py-2 text-center font-bold text-[#e65100] text-[12px] border-l border-border-light" colSpan={2}>
                Tailings (MT)
              </th>
              {/* Yield */}
              <th className="px-2 py-2 text-center font-bold text-success text-[12px] border-l border-border-light" colSpan={2}>
                Yield %
              </th>
              {/* Quality */}
              <th className="px-2 py-2 text-center font-bold text-[#5e35b1] text-[12px] border-l border-border-light" colSpan={3}>
                Cr₂O₃ %
              </th>
            </tr>
            <tr className="bg-bg-soft border-b border-border-light text-[11px] text-txt-light font-semibold">
              <th className="px-2 py-1.5 text-right border-l border-border-light">Plan</th>
              <th className="px-2 py-1.5 text-right">Act</th>
              <th className="px-2 py-1.5 text-right">Achieved %</th>
              <th className="px-2 py-1.5 text-right border-l border-border-light">Plan</th>
              <th className="px-2 py-1.5 text-right">Act</th>
              <th className="px-2 py-1.5 text-right">Achieved %</th>
              <th className="px-2 py-1.5 text-right border-l border-border-light">Act</th>
              <th className="px-2 py-1.5 text-right">Plan</th>
              <th className="px-2 py-1.5 text-right border-l border-border-light">Act</th>
              <th className="px-2 py-1.5 text-right">Plan</th>
              <th className="px-2 py-1.5 text-right border-l border-border-light">Input</th>
              <th className="px-2 py-1.5 text-right">Output</th>
              <th className="px-2 py-1.5 text-right">Tail.</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={14} />)
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-4 py-10 text-center text-txt-muted text-sm">
                  No COB plant data for the selected period
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const isLatest = i === rows.length - 1; // last row = most recent date
                return (
                  <tr
                    key={r.date}
                    className={`border-b border-border-light hover:bg-bg-light transition-colors ${
                      isLatest ? "bg-accent/[0.03] font-medium" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-[12px] text-txt-secondary whitespace-nowrap">
                      {dateLabel(r.date)}
                      {isLatest && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-success align-middle" />}
                    </td>
                    {/* Feed */}
                    <td className="px-2 py-2 text-right font-mono text-txt-muted border-l border-border-light">
                      <Num v={r.feed_plan} />
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-navy"><Num v={r.feed_actual} /></td>
                    <td className="px-2 py-2 text-right"><PctPill pct={pctOf(r.feed_actual, r.feed_plan)} /></td>
                    {/* COB */}
                    <td className="px-2 py-2 text-right font-mono text-txt-muted border-l border-border-light">
                      <Num v={r.cob_plan} />
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-navy"><Num v={r.cob_actual} /></td>
                    <td className="px-2 py-2 text-right"><PctPill pct={pctOf(r.cob_actual, r.cob_plan)} /></td>
                    {/* Tailings */}
                    <td className="px-2 py-2 text-right font-mono text-navy border-l border-border-light">
                      <Num v={r.tailings_actual} />
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-txt-muted"><Num v={r.tailings_plan} /></td>
                    {/* Yield */}
                    <td className="px-2 py-2 text-right font-mono text-navy border-l border-border-light">
                      <Num v={r.yield_pct} dec={1} />
                      {r.yield_pct != null && <span className="text-txt-muted text-[10px]">%</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-txt-muted">
                      <Num v={r.yield_plan} dec={1} />
                      {r.yield_plan != null && <span className="text-[10px]">%</span>}
                    </td>
                    {/* Cr₂O₃ */}
                    <td className="px-2 py-2 text-right font-mono text-accent border-l border-border-light">
                      <Num v={r.input_cr2o3} dec={2} />
                      {r.input_cr2o3 != null && <span className="text-[10px] text-txt-muted">%</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[#c8960c]">
                      <Num v={r.output_cr2o3} dec={2} />
                      {r.output_cr2o3 != null && <span className="text-[10px] text-txt-muted">%</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[#e65100]">
                      <Num v={r.tailings_cr2o3} dec={2} />
                      {r.tailings_cr2o3 != null && <span className="text-[10px] text-txt-muted">%</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* MTD Footer — sticky at bottom, mirrors sticky thead at top */}
          {!isLoading && data && rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-[5]">
              <tr className="bg-[#0f1c35]">
                <td className="px-3 py-3 font-condensed font-bold text-[12px] text-white tracking-widest uppercase">
                  MTD
                </td>
                {/* Feed MTD */}
                <td className="px-2 py-3 text-right font-mono text-white/50 text-[12px] border-l border-white/10">
                  {formatIndian(data.mtd_feed_plan)}
                </td>
                <td className="px-2 py-3 text-right font-mono font-bold text-white text-[12px]">
                  {formatIndian(data.mtd_feed_actual)}
                </td>
                <td className="px-2 py-3 text-right">
                  <PctPill pct={pctOf(data.mtd_feed_actual, data.mtd_feed_plan)} />
                </td>
                {/* COB MTD */}
                <td className="px-2 py-3 text-right font-mono text-white/50 text-[12px] border-l border-white/10">
                  {formatIndian(data.mtd_cob_plan)}
                </td>
                <td className="px-2 py-3 text-right font-mono font-bold text-white text-[12px]">
                  {formatIndian(data.mtd_cob_actual)}
                </td>
                <td className="px-2 py-3 text-right">
                  <PctPill pct={pctOf(data.mtd_cob_actual, data.mtd_cob_plan)} />
                </td>
                {/* Tailings MTD */}
                <td className="px-2 py-3 text-right font-mono font-bold text-white text-[12px] border-l border-white/10">
                  {formatIndian(data.mtd_tailings_actual)}
                </td>
                <td className="px-2 py-3 text-right font-mono text-white/50 text-[12px]">
                  {formatIndian(data.mtd_tailings_plan)}
                </td>
                {/* Yield MTD */}
                <td className="px-2 py-3 text-right font-mono font-bold text-[#43a047] text-[12px] border-l border-white/10">
                  {data.mtd_yield_pct != null ? `${data.mtd_yield_pct.toFixed(1)}%` : "—"}
                </td>
                <td className="px-2 py-3 text-right font-mono text-white/50 text-[12px]">
                  {data.mtd_yield_plan != null ? `${data.mtd_yield_plan.toFixed(1)}%` : "—"}
                </td>
                {/* Quality MTD averages */}
                <td className="px-2 py-3 text-right font-mono text-accent text-[12px] border-l border-white/10">
                  {data.avg_input_cr2o3 != null ? `${data.avg_input_cr2o3.toFixed(1)}%` : "—"}
                </td>
                <td className="px-2 py-3 text-right font-mono text-[#f5a623] text-[12px]">
                  {data.avg_output_cr2o3 != null ? `${data.avg_output_cr2o3.toFixed(1)}%` : "—"}
                </td>
                <td className="px-2 py-3 text-right font-mono text-[#fb8c00] text-[12px]">
                  {data.avg_tailings_cr2o3 != null ? `${data.avg_tailings_cr2o3.toFixed(1)}%` : "—"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Data source attribution */}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">PLAN · </span>IMOS
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ACTUAL · </span>Feed/COB/Tailings Qty → SAP · Input &amp; Output Cr₂O₃ → SAP · Tailings Cr₂O₃ → IMOS
        </p>
      </div>
    </div>
  );
}
