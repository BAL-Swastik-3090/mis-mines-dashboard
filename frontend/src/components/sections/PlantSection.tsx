"use client";
import { Factory } from "lucide-react";
import { format } from "date-fns";
import { formatIndian } from "@/lib/utils";
import { usePlantPerformance } from "@/hooks/usePlant";
import type { PlantUnitAPI } from "@/types";

function Shimmer({ w = "w-24", h = "h-6" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} animate-pulse rounded`} />;
}

// ── Individual plant panel ─────────────────────────────────────
function PlantPanel({
  name, data, loading, isLast,
}: {
  name: string;
  data?: PlantUnitAPI;
  loading: boolean;
  isLast: boolean;
}) {
  return (
    <div className={`flex-1 bg-bg-soft ${!isLast ? "border-r border-border-light" : ""} flex flex-col`}>
      <div className="px-5 py-3.5 flex-1">
        {/* Label */}
        <div className="text-[10px] font-extrabold tracking-[.18em] text-txt-light uppercase mb-2">
          {name}
        </div>

        {/* Total */}
        {loading ? (
          <Shimmer w="w-32" h="h-8 bg-bg-section" />
        ) : (
          <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-navy leading-none tracking-tight">
            {formatIndian(data?.total ?? null)}
            <span className="text-sm font-normal text-txt-muted ml-1.5">MT</span>
          </div>
        )}

        {/* MT/day */}
        {loading ? (
          <div className="mt-1.5"><Shimmer w="w-24" h="h-4 bg-bg-section" /></div>
        ) : (
          <div className="mt-1 font-condensed font-bold text-[15px] text-txt-secondary leading-tight">
            {data?.per_day != null ? data.per_day.toFixed(1) : "—"}
            <span className="text-[12px] font-normal text-txt-muted ml-1">MT/day</span>
          </div>
        )}

        {/* Share % */}
        {!loading && data && (
          <div className="mt-2 text-[11px] text-txt-muted flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 rounded-full shrink-0"
              style={{ width: `${Math.max(data.share_pct, 4)}%`, maxWidth: "72px", background: name.includes("BAL") ? "#1565c0" : "#c8960c" }}
            />
            {data.share_pct.toFixed(1)}% share of total output
          </div>
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ACTUAL · </span>SAP
        </p>
      </div>
    </div>
  );
}

// ── Main section ───────────────────────────────────────────────
export default function PlantSection() {
  const { data, isLoading } = usePlantPerformance();

  const fromLabel = data?.from_date
    ? format(new Date(data.from_date + "T00:00:00"), "d-MMM-yyyy")
    : "—";
  const toLabel = data?.to_date
    ? format(new Date(data.to_date + "T00:00:00"), "d-MMM-yyyy")
    : "—";

  return (
    <section className="space-y-2">

      {/* Section title */}
      <div className="section-title">
        <Factory size={13} />
        Plant Performance — Ferro Chrome
      </div>

      {/* 3-panel card */}
      <div className="flex flex-col lg:flex-row rounded-xl overflow-hidden border border-border shadow-sm">

        {/* ── Left: Combined (navy) ────────────────────────── */}
        <div className="lg:w-[38%] bg-[#1a2744] px-5 py-3.5 flex flex-col justify-center gap-1.5">
          {/* Header */}
          <div>
            <div className="text-[10px] font-extrabold tracking-[.18em] text-[#f5a623] uppercase">
              Plant Performance (Ferro Chrome)
            </div>
            <div className="text-[11px] text-white/40 font-medium mt-0.5">
              {isLoading ? "Loading…" : `${fromLabel} – ${toLabel} · Both plants combined`}
            </div>
          </div>

          {/* Combined total */}
          <div>
            {isLoading ? (
              <div className="h-10 w-36 bg-white/10 animate-pulse rounded" />
            ) : (
              <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-white leading-none tracking-tight">
                {formatIndian(data?.combined_total ?? null)}
                <span className="text-xs font-normal text-white/50 ml-1.5">MT</span>
              </div>
            )}

            {!isLoading && data && (
              <div className="mt-0.5 font-condensed font-bold text-[15px] text-[#f5a623] leading-tight">
                {data.combined_per_day.toFixed(1)}
                <span className="text-[12px] font-normal text-white/50 ml-1.5">MT/day combined</span>
              </div>
            )}
          </div>

          {!isLoading && data && (
            <span className="text-[10px] text-white/25 font-medium">
              {data.days} production day{data.days !== 1 ? "s" : ""} in period
            </span>
          )}
        </div>

        {/* ── Middle: BAL Plant ────────────────────────────── */}
        <PlantPanel
          name="BAL Plant"
          data={data?.bal}
          loading={isLoading}
          isLast={false}
        />

        {/* ── Right: SUK Plant ─────────────────────────────── */}
        <PlantPanel
          name="SUK Plant"
          data={data?.suk}
          loading={isLoading}
          isLast={true}
        />
      </div>
    </section>
  );
}
