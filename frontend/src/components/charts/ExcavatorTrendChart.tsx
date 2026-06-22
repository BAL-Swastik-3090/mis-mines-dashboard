"use client";
import dynamic from "next/dynamic";
import { useExcavatorSummary, useExcavatorTrend } from "@/hooks/useEquipment";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// One distinct colour per excavator line (up to 7)
const EXC_COLORS = [
  "#1565c0", "#f5a623", "#2e7d32", "#c62828",
  "#7b1fa2", "#00695c", "#e65100",
];

function dayLabel(dateStr: string): string {
  return `D${new Date(dateStr + "T00:00:00").getDate()}`;
}

export default function ExcavatorTrendChart() {
  const { data: summary, isLoading: sumL } = useExcavatorSummary();
  const { data: trend,   isLoading: trendL } = useExcavatorTrend();
  const isLoading = sumL || trendL;

  const machines = trend?.machine_names ?? [];
  const dates    = (trend?.dates ?? []).map(dayLabel);

  const series = machines.map((name, i) => ({
    name,
    type:        "line",
    data:        trend?.series[name] ?? [],
    smooth:      true,
    symbol:      "circle",
    symbolSize:  5,
    lineStyle:   { width: 2,  color: EXC_COLORS[i % EXC_COLORS.length] },
    itemStyle:   { color: EXC_COLORS[i % EXC_COLORS.length] },
    connectNulls: false,
  }));

  const option = {
    backgroundColor: "transparent",
    animation: true,
    legend: {
      bottom: 2, left: "center",
      type: "scroll",
      textStyle: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Sans" },
      itemWidth: 20, itemHeight: 2, itemGap: 14,
    },
    grid: { top: 12, right: 14, bottom: 48, left: 14, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c", borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number | null; axisValue: string; color: string }>) {
        const day  = params[0]?.axisValue ?? "";
        const lines = params
          .filter((p) => p.value != null)
          .map((p) =>
            `<div style="display:flex;justify-content:space-between;gap:16px;">
               <span style="color:${p.color}">${p.seriesName}</span>
               <span style="font-family:'IBM Plex Mono';font-weight:600;color:#e8eef8">
                 ${Number(p.value).toFixed(1)} h
               </span>
             </div>`
          ).join("");
        return `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0">${day}</div>
                ${lines || "<span style='color:#6b8ca8'>No data</span>"}`;
      },
    },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: { fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: {
      type: "value",
      min: 0, max: 24, interval: 4,
      axisLabel: {
        fontSize: 11, color: "#8899bb",
        formatter: (v: number) => `${v}h`,
      },
      splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series,
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0 flex-wrap gap-2">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Excavator-wise · Day-wise Running Hours Trend
        </span>
        {!isLoading && summary && (
          <div className="flex items-center gap-2 text-[11px] text-txt-muted font-mono">
            <span>
              Active Fleet{" "}
              <strong className="text-navy">{summary.active_count} of {summary.total_count}</strong>
            </span>
            <span className="text-border-strong">·</span>
            <span>
              Total{" "}
              <strong className="text-navy">{summary.total_eng_hr.toFixed(1)} h</strong>
            </span>
          </div>
        )}
      </div>

      {/* Chart body */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[300px]">
          <div className="text-txt-muted text-sm animate-pulse">Loading excavator data…</div>
        </div>
      ) : machines.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[300px]">
          <span className="text-txt-muted text-sm">No trend data for selected period</span>
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: "340px" }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}
    </div>
  );
}
