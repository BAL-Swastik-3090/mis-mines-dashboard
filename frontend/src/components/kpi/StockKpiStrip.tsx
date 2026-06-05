"use client";
import { formatIndian } from "@/lib/utils";
import { useStockPosition } from "@/hooks/useStock";
import type { StockGradeAPI } from "@/types";

// ── Grade visual config ────────────────────────────────────────
const GRADE_CFG: Record<string, {
  accentBar: string; dotColor: string; labelColor: string; bg: string;
}> = {
  HG:     { accentBar: "border-t-[3px] border-[#c8960c]", dotColor: "bg-[#c8960c]", labelColor: "text-[#c8960c]", bg: "bg-amber-50/60"  },
  MG:     { accentBar: "border-t-[3px] border-accent",    dotColor: "bg-accent",     labelColor: "text-accent",    bg: "bg-blue-50/60"   },
  LG:     { accentBar: "border-t-[3px] border-[#e65100]", dotColor: "bg-[#e65100]", labelColor: "text-[#e65100]", bg: "bg-orange-50/60" },
  LUMP_H: { accentBar: "border-t-[3px] border-[#00695c]", dotColor: "bg-[#00695c]", labelColor: "text-[#00695c]", bg: "bg-teal-50/60"   },
  LUMP_L: { accentBar: "border-t-[3px] border-[#5e35b1]", dotColor: "bg-[#5e35b1]", labelColor: "text-[#5e35b1]", bg: "bg-purple-50/40" },
  COB:    { accentBar: "border-t-[3px] border-[#2e7d32]", dotColor: "bg-[#2e7d32]", labelColor: "text-[#2e7d32]", bg: "bg-green-50/60"  },
};

// ── Skeleton ───────────────────────────────────────────────────
function Shimmer({ w = "w-24", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

// ── Individual grade card ──────────────────────────────────────
function GradeCard({ item, loading }: { item?: StockGradeAPI; loading: boolean }) {
  const cfg = GRADE_CFG[item?.grade_key ?? "HG"] ?? GRADE_CFG.HG;
  const [mainLabel, subLabel] = (item?.grade_label ?? "").split(" ").reduce<[string, string]>(
    (acc, word, i) => i === 0 ? [word, acc[1]] : [acc[0], (acc[1] + " " + word).trim()],
    ["", ""]
  );

  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col ${cfg.accentBar}`}>
      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dotColor}`} />
          <span className={`font-condensed font-extrabold text-[13px] uppercase tracking-widest leading-tight ${cfg.labelColor}`}>
            {item?.grade_key ?? "—"}
          </span>
        </div>
        <div className="text-[10px] text-txt-light font-medium leading-tight pl-3.5">
          {item?.grade_label ?? "—"}
        </div>
      </div>

      {/* Stock number */}
      <div className="px-3 pb-2.5">
        {loading ? (
          <Shimmer w="w-28" h="h-8" />
        ) : (
          <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-navy leading-none tracking-tight">
            {formatIndian(item?.total_stock ?? null)}
            <span className="text-xs font-normal text-txt-muted ml-1.5">TON</span>
          </div>
        )}
      </div>

      {/* Location breakdown */}
      <div className={`px-3 py-2 border-t border-border-light mt-auto ${cfg.bg} flex flex-wrap gap-x-3 gap-y-1 min-h-[36px]`}>
        {loading ? (
          <Shimmer w="w-full" h="h-4" />
        ) : (
          item?.locations.map((loc) => (
            <div key={loc.store_loc} className="flex items-center gap-1" title={loc.store_loc_desc}>
              <span className="text-[10px] font-bold text-txt-light uppercase tracking-wider">
                {loc.store_loc}
              </span>
              <span className="text-[11px] font-mono font-semibold text-txt-secondary">
                {formatIndian(loc.stock)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Total card ─────────────────────────────────────────────────
function TotalCard({ total, loading }: { total: number; loading: boolean }) {
  return (
    <div className="bg-[#1a2744] border border-[#1a2744] rounded-lg shadow-sm overflow-hidden flex flex-col border-t-[3px] border-t-[#f5a623]">
      <div className="px-3 pt-3 pb-2">
        <div className="text-[9px] font-extrabold tracking-[.18em] text-[#f5a623] uppercase mb-0.5">
          Total Stock
        </div>
        <div className="text-[10px] text-white/40 font-medium">All grades combined</div>
      </div>
      <div className="px-3 pb-2.5">
        {loading ? (
          <div className="h-8 w-28 bg-white/10 animate-pulse rounded" />
        ) : (
          <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-white leading-none tracking-tight">
            {formatIndian(total)}
            <span className="text-xs font-normal text-white/50 ml-1.5">TON</span>
          </div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-white/10 mt-auto bg-white/5 min-h-[36px] flex items-center">
      </div>
    </div>
  );
}

// ── Main strip ─────────────────────────────────────────────────
export default function StockKpiStrip() {
  const { data, isLoading } = useStockPosition();

  // Build a lookup map for easy access
  const gradeMap = Object.fromEntries(
    (data?.items ?? []).map((g) => [g.grade_key, g])
  );

  const GRADE_ORDER = ["HG", "MG", "LG", "LUMP_H", "LUMP_L", "COB"] as const;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 xl:gap-4">
      {/* Total card first */}
      <TotalCard total={data?.grand_total ?? 0} loading={isLoading} />

      {/* Grade cards */}
      {GRADE_ORDER.map((gk) => (
        <GradeCard
          key={gk}
          item={gradeMap[gk]}
          loading={isLoading}
        />
      ))}
    </div>
  );
}
