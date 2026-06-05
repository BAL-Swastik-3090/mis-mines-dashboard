"use client";
import { useProductionDaywise } from "@/hooks/useProduction";
import { formatIndian, formatPct, pctBgClass } from "@/lib/utils";

function pctOf(a: number | null, p: number | null): number | null {
  if (a == null || p == null || p === 0) return null;
  return Math.round((a / p) * 1000) / 10;
}

function dateLabel(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short",
  });
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-border-light">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
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

export default function DaywiseTable() {
  const { data, isLoading } = useProductionDaywise();
  const rows       = data?.rows ?? [];
  const sortedRows = rows;   // ascending order — backend already sorts by date ASC

  const mtdOrePct  = pctOf(data?.mtd_ore_actual ?? null, data?.mtd_ore_plan ?? null);
  const mtdObPct   = pctOf(data?.mtd_ob_actual  ?? null, data?.mtd_ob_plan  ?? null);
  const mtdCobPct  = pctOf(data?.mtd_cob_actual ?? null, data?.mtd_cob_plan ?? null);
  const mtdSilt    = rows.reduce((s, r) => s + (r.silt_actual ?? 0), 0);

  // ── Future columns (pending data source) ───────────────────
  // TODO: add Despatch (MT) — TGT + ACT — when SAP Despatch API is ready

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      {/* Header bar */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Day-wise Production
        </span>
        <span className="text-[12px] text-txt-muted font-mono">
          {isLoading ? "…" : `${rows.length} days`}
        </span>
      </div>

      {/* Scrollable table — max ~10 rows visible, auto-shrinks for fewer rows */}
      <div className="overflow-y-auto" style={{ maxHeight: "400px" }}>
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-section border-b border-border">
              <th className="px-3 py-2.5 text-left font-bold text-txt-secondary tracking-wide text-[12px]" rowSpan={2}>
                Date
              </th>
              <th className="px-2 py-2 text-center font-bold text-accent tracking-wide text-[12px] border-l border-border-light" colSpan={3}>
                ORE (MT)
              </th>
              <th className="px-2 py-2 text-center font-bold text-steel tracking-wide text-[12px] border-l border-border-light" colSpan={3}>
                OB (CuM)
              </th>
              <th className="px-2 py-2 text-center font-bold text-success tracking-wide text-[12px] border-l border-border-light" colSpan={3}>
                COB (MT)
              </th>
              {/* Silt — single column, no plan available */}
              <th className="px-3 py-2.5 text-right font-bold text-[#00695c] tracking-wide text-[12px] border-l border-border-light" rowSpan={2}>
                SILT (CuM)
              </th>
            </tr>
            <tr className="bg-bg-soft border-b border-border-light text-[11px] text-txt-light font-semibold">
              <th className="px-3 py-1.5 text-right border-l border-border-light">Act</th>
              <th className="px-3 py-1.5 text-right">Plan</th>
              <th className="px-3 py-1.5 text-right">%</th>
              <th className="px-3 py-1.5 text-right border-l border-border-light">Act</th>
              <th className="px-3 py-1.5 text-right">Plan</th>
              <th className="px-3 py-1.5 text-right">%</th>
              <th className="px-3 py-1.5 text-right border-l border-border-light">Act</th>
              <th className="px-3 py-1.5 text-right">Plan</th>
              <th className="px-3 py-1.5 text-right">%</th>
              {/* Silt sub-header omitted — rowSpan={2} on parent covers it */}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={11} />)
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-txt-muted text-sm">
                  No production data for the selected period
                </td>
              </tr>
            ) : (
              sortedRows.map((r, i) => {
                const orePct = pctOf(r.ore_actual, r.ore_plan);
                const obPct  = pctOf(r.ob_actual,  r.ob_plan);
                const cobPct = pctOf(r.cob_actual, r.cob_plan);
                const isLatest = i === sortedRows.length - 1;  // last row = most recent

                return (
                  <tr
                    key={r.date}
                    className={`border-b border-border-light hover:bg-bg-light transition-colors ${
                      isLatest ? "bg-accent/[0.03] font-medium" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-[12px] text-txt-secondary whitespace-nowrap">
                      {dateLabel(r.date)}
                      {isLatest && (
                        <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-success align-middle" />
                      )}
                    </td>
                    {/* ORE */}
                    <td className="px-3 py-2 text-right font-mono text-navy border-l border-border-light">
                      {formatIndian(r.ore_actual)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-txt-muted">{formatIndian(r.ore_plan)}</td>
                    <td className="px-3 py-2 text-right"><PctPill pct={orePct} /></td>
                    {/* OB */}
                    <td className="px-3 py-2 text-right font-mono text-navy border-l border-border-light">
                      {formatIndian(r.ob_actual)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-txt-muted">{formatIndian(r.ob_plan)}</td>
                    <td className="px-3 py-2 text-right"><PctPill pct={obPct} /></td>
                    {/* COB */}
                    <td className="px-3 py-2 text-right font-mono text-navy border-l border-border-light">
                      {formatIndian(r.cob_actual)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-txt-muted">{formatIndian(r.cob_plan)}</td>
                    <td className="px-3 py-2 text-right"><PctPill pct={cobPct} /></td>
                    {/* SILT — actual only, no plan */}
                    <td className="px-3 py-2 text-right font-mono border-l border-border-light text-[#00695c]">
                      {r.silt_actual != null && r.silt_actual > 0
                        ? formatIndian(r.silt_actual)
                        : <span className="text-txt-light/40">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* MTD footer */}
          {!isLoading && data && rows.length > 0 && (
            <tfoot>
              <tr className="bg-navy-2">
                <td className="px-3 py-3 font-condensed font-bold text-[12px] text-white tracking-widest uppercase">
                  MTD TOTAL
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-white text-[12px] border-l border-white/10">
                  {formatIndian(data.mtd_ore_actual)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-white/50 text-[12px]">
                  {formatIndian(data.mtd_ore_plan)}
                </td>
                <td className="px-3 py-3 text-right"><PctPill pct={mtdOrePct} /></td>
                <td className="px-3 py-3 text-right font-mono font-bold text-white text-[12px] border-l border-white/10">
                  {formatIndian(data.mtd_ob_actual)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-white/50 text-[12px]">
                  {formatIndian(data.mtd_ob_plan)}
                </td>
                <td className="px-3 py-3 text-right"><PctPill pct={mtdObPct} /></td>
                <td className="px-3 py-3 text-right font-mono font-bold text-white text-[12px] border-l border-white/10">
                  {formatIndian(data.mtd_cob_actual)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-white/50 text-[12px]">
                  {formatIndian(data.mtd_cob_plan)}
                </td>
                <td className="px-3 py-3 text-right"><PctPill pct={mtdCobPct} /></td>
                {/* SILT MTD total */}
                <td className="px-3 py-3 text-right font-mono font-bold text-[#43d4bb] text-[12px] border-l border-white/10">
                  {mtdSilt > 0 ? formatIndian(mtdSilt) : <span className="text-white/30">—</span>}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
