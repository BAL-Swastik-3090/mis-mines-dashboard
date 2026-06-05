"use client";
import dynamic from "next/dynamic";
import { useProductionDaywise } from "@/hooks/useProduction";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function shortDay(dateStr: string): string {
  return String(new Date(dateStr + "T00:00:00").getDate()).padStart(2, "0");
}

export default function DeSiltingChart() {
  const { data, isLoading } = useProductionDaywise();
  const rows    = data?.rows ?? [];
  const days    = rows.map((r) => shortDay(r.date));
  const siltQty = rows.map((r) => r.silt_actual ?? 0);

  // MTD silt total computed from rows
  const mtdSilt  = siltQty.reduce((s, v) => s + v, 0);
  // Active days (days where silt > 0)
  const activeDays = siltQty.filter((v) => v > 0).length;

  const option = {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 28, right: 12, bottom: 36, left: 12, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#0f1c35",
      borderColor:     "#2c4a7c",
      borderWidth:     1,
      padding:         [8, 12],
      textStyle:       { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ value: number; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        const val = params[0]?.value ?? 0;
        return `<div style="font-weight:700;margin-bottom:4px;color:#c8d8f0">Day ${day} — De-Silting</div>` +
          `<div style="font-family:'IBM Plex Mono';color:${val > 0 ? "#43d4bb" : "#6b8ca8"}">` +
          `${val > 0 ? formatIndian(val) + " CuM" : "No activity"}</div>`;
      },
    },
    xAxis: {
      type:      "category",
      data:      days,
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: {
      type:  "value",
      axisLabel: {
        fontSize: 11, color: "#8899bb",
        formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
      },
      splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      axisLine:  { show: false },
      axisTick:  { show: false },
      minInterval: 1,
    },
    series: [
      {
        name:       "De-Silt",
        type:       "bar",
        data:       siltQty,
        barMaxWidth: 28,
        itemStyle:  {
          color: "#00695c",
          borderRadius: [3, 3, 0, 0],
        },
        emphasis: {
          itemStyle: { color: "#00897b" },
        },
      },
    ],
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden h-full flex flex-col">

      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          De-Silting
        </span>
        <div className="flex items-center gap-2">
          {!isLoading && mtdSilt > 0 ? (
            <>
              <span className="bg-teal-50 text-[#00695c] text-[11px] font-bold px-2 py-0.5 rounded">
                MTD {formatIndian(mtdSilt)} CuM
              </span>
              <span className="text-[10px] text-txt-light font-mono">
                {activeDays} active day{activeDays !== 1 ? "s" : ""}
              </span>
            </>
          ) : !isLoading ? (
            <span className="text-[11px] text-txt-muted font-mono">No activity in period</span>
          ) : null}
        </div>
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[240px]">
          <div className="text-txt-muted text-sm animate-pulse">Loading de-silting data…</div>
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: "260px" }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}
    </div>
  );
}
