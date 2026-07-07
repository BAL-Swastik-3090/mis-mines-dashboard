"use client";
import { useMemo } from "react";
import { useProductionDaywise } from "@/hooks/useProduction";
import { useDespatchDaywise }   from "@/hooks/useDespatch";
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

function NumCell({ v, dim = false }: { v: number | null; dim?: boolean }) {
  if (v == null || v === 0) return <span className="text-txt-light/40">—</span>;
  return (
    <span className={dim ? "font-mono text-txt-muted" : "font-mono text-navy"}>
      {formatIndian(v)}
    </span>
  );
}

const TOTAL_COLS = 14; // Date + Ore(3) + OB(3) + COB(3) + Silt(1) + Despatch(Plan+Act+%)

export default function DaywiseTable() {
  const { data: prodData, isLoading: prodLoading } = useProductionDaywise();
  const { data: dspData,  isLoading: dspLoading  } = useDespatchDaywise();

  const isLoading = prodLoading || dspLoading;

  // ── Merge production rows + despatch (plan + actual) by date ─
  const mergedRows = useMemo(() => {
    const prodRows = prodData?.rows ?? [];
    const dspMap = new Map(
      (dspData?.rows ?? []).map((r) => [r.date, r])
    );

    return prodRows.map((r) => {
      const dsp = dspMap.get(r.date);
      return {
        ...r,
        desp_total_plan:   dsp?.total_plan     ?? null,
        desp_total_actual: dsp?.total_actual   ?? null,
        desp_unsynced:     dsp?.unsynced_count ?? 0,
      };
    });
  }, [prodData, dspData]);

  const mtdOrePct = pctOf(prodData?.mtd_ore_actual ?? null, prodData?.mtd_ore_plan ?? null);
  const mtdObPct  = pctOf(prodData?.mtd_ob_actual  ?? null, prodData?.mtd_ob_plan  ?? null);
  const mtdCobPct = pctOf(prodData?.mtd_cob_actual ?? null, prodData?.mtd_cob_plan ?? null);
  const mtdSilt          = mergedRows.reduce((s, r) => s + (r.silt_actual ?? 0), 0);
  const mtdDespPlan      = dspData?.mtd_total_plan   ?? 0;
  const mtdDespActual    = dspData?.mtd_total_actual ?? null;
  const mtdDespPct       = pctOf(mtdDespActual, mtdDespPlan);
  const mtdUnsyncedTotal = dspData?.mtd_unsynced_count ?? 0;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      {/* Header bar */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Day-wise Production & Despatch
        </span>
        <span className="text-[12px] text-txt-muted font-mono">
          {isLoading ? "…" : `${mergedRows.length} days`}
        </span>
      </div>

      {/* Scrollable table — max ~10 rows visible */}
      <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: "400px" }}>
        <table className="w-full text-[12px] border-collapse" style={{ minWidth: "900px" }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-section border-b border-border">
              {/* Date */}
              <th className="px-3 py-2.5 text-left font-bold text-txt-secondary tracking-wide text-[12px]" rowSpan={2}>
                Date
              </th>
              {/* ORE */}
              <th className="px-2 py-2 text-center font-bold text-accent tracking-wide text-[12px] border-l border-border-light" colSpan={3}>
                ORE (MT)
              </th>
              {/* OB */}
              <th className="px-2 py-2 text-center font-bold text-steel tracking-wide text-[12px] border-l border-border-light" colSpan={3}>
                OB (CuM)
              </th>
              {/* COB */}
              <th className="px-2 py-2 text-center font-bold text-success tracking-wide text-[12px] border-l border-border-light" colSpan={3}>
                COB (MT)
              </th>
              {/* Silt */}
              <th className="px-3 py-2.5 text-right font-bold text-[#00695c] tracking-wide text-[12px] border-l border-border-light" rowSpan={2}>
                SILT (CuM)
              </th>
              {/* Despatch */}
              <th className="px-2 py-2 text-center font-bold text-orange tracking-wide text-[12px] border-l border-border-light" colSpan={3}>
                DESPATCH (MT)
              </th>
            </tr>
            <tr className="bg-bg-soft border-b border-border-light text-[11px] text-txt-light font-semibold">
              {/* ORE sub */}
              <th className="px-3 py-1.5 text-right border-l border-border-light">Plan</th>
              <th className="px-3 py-1.5 text-right">Act</th>
              <th className="px-3 py-1.5 text-right">Achieved %</th>
              {/* OB sub */}
              <th className="px-3 py-1.5 text-right border-l border-border-light">Plan</th>
              <th className="px-3 py-1.5 text-right">Act</th>
              <th className="px-3 py-1.5 text-right">Achieved %</th>
              {/* COB sub */}
              <th className="px-3 py-1.5 text-right border-l border-border-light">Plan</th>
              <th className="px-3 py-1.5 text-right">Act</th>
              <th className="px-3 py-1.5 text-right">Achieved %</th>
              {/* Silt — rowSpan covers sub-header row */}
              {/* Despatch sub */}
              <th className="px-3 py-1.5 text-right border-l border-border-light">Plan</th>
              <th className="px-3 py-1.5 text-right">Actual</th>
              <th className="px-3 py-1.5 text-right text-orange">Achieved %</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={TOTAL_COLS} />)
            ) : mergedRows.length === 0 ? (
              <tr>
                <td colSpan={TOTAL_COLS} className="px-4 py-10 text-center text-txt-muted text-sm">
                  No production data for the selected period
                </td>
              </tr>
            ) : (
              mergedRows.map((r, i) => {
                const orePct = pctOf(r.ore_actual, r.ore_plan);
                const obPct  = pctOf(r.ob_actual,  r.ob_plan);
                const cobPct = pctOf(r.cob_actual, r.cob_plan);
                const isLatest = i === mergedRows.length - 1;

                return (
                  <tr
                    key={r.date}
                    className={`border-b border-border-light hover:bg-bg-light transition-colors ${
                      isLatest ? "bg-accent/[0.03] font-medium" : ""
                    }`}
                  >
                    {/* Date */}
                    <td className="px-3 py-2 font-mono text-[12px] text-txt-secondary whitespace-nowrap">
                      {dateLabel(r.date)}
                      {isLatest && (
                        <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-success align-middle" />
                      )}
                    </td>

                    {/* ORE */}
                    <td className="px-3 py-2 text-right border-l border-border-light">
                      <NumCell v={r.ore_plan} dim />
                    </td>
                    <td className="px-3 py-2 text-right"><NumCell v={r.ore_actual} /></td>
                    <td className="px-3 py-2 text-right"><PctPill pct={orePct} /></td>

                    {/* OB */}
                    <td className="px-3 py-2 text-right border-l border-border-light">
                      <NumCell v={r.ob_plan} dim />
                    </td>
                    <td className="px-3 py-2 text-right"><NumCell v={r.ob_actual} /></td>
                    <td className="px-3 py-2 text-right"><PctPill pct={obPct} /></td>

                    {/* COB */}
                    <td className="px-3 py-2 text-right border-l border-border-light">
                      <NumCell v={r.cob_plan} dim />
                    </td>
                    <td className="px-3 py-2 text-right"><NumCell v={r.cob_actual} /></td>
                    <td className="px-3 py-2 text-right"><PctPill pct={cobPct} /></td>

                    {/* SILT */}
                    <td className="px-3 py-2 text-right border-l border-border-light font-mono text-[#00695c]">
                      {r.silt_actual != null && r.silt_actual > 0
                        ? formatIndian(r.silt_actual)
                        : <span className="text-txt-light/40">—</span>}
                    </td>

                    {/* DESPATCH */}
                    <td className="px-3 py-2 text-right border-l border-border-light">
                      <NumCell v={r.desp_total_plan} dim />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.desp_total_actual != null ? (
                        <span className="font-mono text-navy">
                          {formatIndian(r.desp_total_actual)}
                          {r.desp_unsynced > 0 && (
                            <span className="ml-1 text-[9px] text-orange font-bold">
                              +{r.desp_unsynced}?
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-txt-light/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <PctPill pct={pctOf(r.desp_total_actual, r.desp_total_plan)} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* MTD footer — sticky at bottom, mirrors sticky thead at top */}
          {!isLoading && prodData && mergedRows.length > 0 && (
            <tfoot className="sticky bottom-0 z-[5]">
              <tr className="bg-navy-2">
                <td className="px-3 py-3 font-condensed font-bold text-[12px] text-white tracking-widest uppercase">
                  MTD TOTAL
                </td>
                {/* ORE */}
                <td className="px-3 py-3 text-right font-mono text-white/50 text-[12px] border-l border-white/10">
                  {formatIndian(prodData.mtd_ore_plan)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-white text-[12px]">
                  {formatIndian(prodData.mtd_ore_actual)}
                </td>
                <td className="px-3 py-3 text-right"><PctPill pct={mtdOrePct} /></td>
                {/* OB */}
                <td className="px-3 py-3 text-right font-mono text-white/50 text-[12px] border-l border-white/10">
                  {formatIndian(prodData.mtd_ob_plan)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-white text-[12px]">
                  {formatIndian(prodData.mtd_ob_actual)}
                </td>
                <td className="px-3 py-3 text-right"><PctPill pct={mtdObPct} /></td>
                {/* COB */}
                <td className="px-3 py-3 text-right font-mono text-white/50 text-[12px] border-l border-white/10">
                  {formatIndian(prodData.mtd_cob_plan)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-white text-[12px]">
                  {formatIndian(prodData.mtd_cob_actual)}
                </td>
                <td className="px-3 py-3 text-right"><PctPill pct={mtdCobPct} /></td>
                {/* SILT */}
                <td className="px-3 py-3 text-right font-mono font-bold text-[#43d4bb] text-[12px] border-l border-white/10">
                  {mtdSilt > 0 ? formatIndian(mtdSilt) : <span className="text-white/30">—</span>}
                </td>
                {/* DESPATCH */}
                <td className="px-3 py-3 text-right font-mono text-white/60 text-[12px] border-l border-white/10">
                  {formatIndian(mtdDespPlan)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-[#ffa726] text-[12px]">
                  {mtdDespActual != null ? (
                    <>
                      {formatIndian(mtdDespActual)}
                      {mtdUnsyncedTotal > 0 && (
                        <span className="ml-1 text-[9px] text-orange-300 font-bold">
                          +{mtdUnsyncedTotal}?
                        </span>
                      )}
                    </>
                  ) : <span className="text-white/30">—</span>}
                </td>
                <td className="px-3 py-3 text-right">
                  <PctPill pct={mtdDespPct} />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
