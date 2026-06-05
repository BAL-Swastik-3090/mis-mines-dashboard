"use client";
import dynamic from "next/dynamic";
import { useProductionGrade } from "@/hooks/useProduction";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function shortDay(dateStr: string): string {
  return String(new Date(dateStr + "T00:00:00").getDate()).padStart(2, "0");
}

export default function GradeChart() {
  const { data, isLoading } = useProductionGrade();
  const rows = data?.rows ?? [];

  const option = {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 50, right: 12, bottom: 36, left: 12, containLabel: true },
    legend: {
      data: ["HG >52%", "MG 40–52%", "LG <40%"],
      top: 6,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 12, itemHeight: 8,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#0f1c35",
      borderColor:     "#2c4a7c",
      borderWidth:     1,
      padding:         [8, 12],
      textStyle:       { color: "#e8eef8", fontSize: 13, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number; color: string; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        let total = 0;
        let html = `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0">Day ${day} — Grade</div>`;
        params.forEach((p) => {
          const val = p.value ?? 0;
          if (val > 0) {
            total += val;
            html += `<div style="display:flex;justify-content:space-between;gap:14px;color:${p.color}">
              <span>${p.seriesName}</span>
              <span style="font-weight:700;font-family:'IBM Plex Mono'">${formatIndian(val)} MT</span>
            </div>`;
          }
        });
        if (total > 0) {
          html += `<div style="border-top:1px solid #2c4a7c;margin-top:5px;padding-top:5px;display:flex;justify-content:space-between;gap:14px;color:#fff;font-weight:700">
            <span>Total</span>
            <span style="font-family:'IBM Plex Mono'">${formatIndian(total)} MT</span>
          </div>`;
        }
        return html;
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((r) => shortDay(r.date)),
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 11, color: "#8899bb",
        formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
      },
      splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      axisLine:  { show: false },
      axisTick:  { show: false },
    },
    series: [
      {
        name: "HG >52%",   type: "bar", stack: "grade",
        data: rows.map((r) => r.hg_actual ?? 0),
        barMaxWidth: 26, itemStyle: { color: "#c8960c" },
      },
      {
        name: "MG 40–52%", type: "bar", stack: "grade",
        data: rows.map((r) => r.mg_actual ?? 0),
        barMaxWidth: 26, itemStyle: { color: "#1565c0" },
      },
      {
        name: "LG <40%",   type: "bar", stack: "grade",
        data: rows.map((r) => r.lg_actual ?? 0),
        barMaxWidth: 26,
        itemStyle: { color: "#e65100", borderRadius: [3, 3, 0, 0] },
      },
    ],
  };

  const mtdHg    = data?.mtd_hg    ?? 0;
  const mtdMg    = data?.mtd_mg    ?? 0;
  const mtdLg    = data?.mtd_lg    ?? 0;
  const mtdTotal = data?.mtd_total ?? 0;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2 shrink-0">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Grade-wise Ore
        </span>
        {!isLoading && mtdTotal > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="bg-amber-50 text-gold    text-[11px] font-bold px-2 py-0.5 rounded">
              HG {formatIndian(mtdHg)}
            </span>
            <span className="bg-blue-50  text-accent  text-[11px] font-bold px-2 py-0.5 rounded">
              MG {formatIndian(mtdMg)}
            </span>
            <span className="bg-warning-bg text-warning text-[11px] font-bold px-2 py-0.5 rounded">
              LG {formatIndian(mtdLg)}
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[240px]">
          <div className="text-txt-muted text-sm animate-pulse">Loading grade data…</div>
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
