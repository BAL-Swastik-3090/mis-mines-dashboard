"use client";
import { formatIndian } from "@/lib/utils";
import { useStockPosition } from "@/hooks/useStock";

const GRADE_ORDER = ["HG", "MG", "LG", "LUMP_H", "LUMP_L", "COB"] as const;

const GRADE_COLOR: Record<string, string> = {
  HG:     "text-[#c8960c] font-bold",
  MG:     "text-accent font-bold",
  LG:     "text-[#e65100] font-bold",
  LUMP_H: "text-[#00695c] font-bold",
  LUMP_L: "text-[#5e35b1] font-bold",
  COB:    "text-[#2e7d32] font-bold",
};

// Short display labels for long location names in table columns
const LOC_SHORT: Record<string, string> = {
  RYRD: "Remaining after Despatch",
  DY01: "Despatch Stock",
  ROM1: "ROM Stock",
  LGCR: "Low Grade ROM",
  CST1: "COB Production",
};

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

export default function StockLocationTable() {
  const { data, isLoading } = useStockPosition();

  // Build unique sorted location list from response
  const locations = (data?.by_location ?? []).map((l) => l.store_loc);
  const locDescMap = Object.fromEntries(
    (data?.by_location ?? []).map((l) => [l.store_loc, l.store_loc_desc])
  );
  const gradeMap = Object.fromEntries(
    (data?.items ?? []).map((g) => [g.grade_key, g])
  );
  const locTotals = Object.fromEntries(
    (data?.by_location ?? []).map((l) => [l.store_loc, l.stock])
  );

  const colCount = locations.length + 2; // Date col + location cols + total col

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      {/* Header bar */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Stock by Grade × Location
        </span>
        {!isLoading && data && (
          <span className="text-[11px] text-txt-muted font-mono">
            {data.by_location.length} locations · {data.items.length} grades
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="bg-bg-section border-b border-border">
              <th className="px-4 py-2.5 text-left font-bold text-txt-secondary tracking-wide text-[12px] min-w-[140px]">
                Grade
              </th>
              {isLoading ? (
                <th colSpan={4} className="px-3 py-2.5" />
              ) : (
                locations.map((loc) => (
                  <th
                    key={loc}
                    className="px-3 py-2.5 text-right font-bold text-txt-secondary tracking-wide text-[11px] min-w-[110px]"
                    title={locDescMap[loc]}
                  >
                    <div className="text-navy">{LOC_SHORT[loc] ?? loc}</div>
                    <div className="text-[10px] font-normal text-txt-light tracking-normal">({loc})</div>
                  </th>
                ))
              )}
              <th className="px-3 py-2.5 text-right font-bold text-navy text-[12px] border-l border-border-light min-w-[100px]">
                Total (TON)
              </th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={colCount} />)
            ) : (
              GRADE_ORDER.map((gk) => {
                const grade = gradeMap[gk];
                if (!grade) return null;
                const locMap = Object.fromEntries(
                  grade.locations.map((l) => [l.store_loc, l.stock])
                );
                return (
                  <tr
                    key={gk}
                    className="border-b border-border-light hover:bg-bg-light transition-colors"
                  >
                    {/* Grade label */}
                    <td className="px-4 py-2.5">
                      <div className={`text-[12px] ${GRADE_COLOR[gk] ?? ""}`}>
                        {gk.replace("_", " ")}
                      </div>
                      <div className="text-[10px] text-txt-light">{grade.grade_label}</div>
                    </td>

                    {/* Per-location stock */}
                    {locations.map((loc) => {
                      const v = locMap[loc];
                      return (
                        <td key={loc} className="px-3 py-2.5 text-right font-mono">
                          {v != null && v > 0 ? (
                            <span className="text-txt-primary">{formatIndian(v)}</span>
                          ) : (
                            <span className="text-txt-light/50">—</span>
                          )}
                        </td>
                      );
                    })}

                    {/* Grade total */}
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-navy border-l border-border-light">
                      {formatIndian(grade.total_stock)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Footer: location totals */}
          {!isLoading && data && (
            <tfoot>
              <tr className="bg-[#1a2744]">
                <td className="px-4 py-3 font-condensed font-bold text-[12px] text-white tracking-widest uppercase">
                  Total
                </td>
                {locations.map((loc) => (
                  <td key={loc} className="px-3 py-3 text-right font-mono font-bold text-white text-[12px]">
                    {formatIndian(locTotals[loc])}
                  </td>
                ))}
                <td className="px-3 py-3 text-right font-mono font-bold text-[#f5a623] text-[13px] border-l border-white/10">
                  {formatIndian(data.grand_total)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
