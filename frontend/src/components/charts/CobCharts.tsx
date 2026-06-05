"use client";
import dynamic from "next/dynamic";
import { useCobSummary } from "@/hooks/useCob";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function shortDay(dateStr: string): string {
  return String(new Date(dateStr + "T00:00:00").getDate()).padStart(2, "0");
}

function fmt(v: number | null, dec = 0) {
  if (v == null) return "—";
  return dec > 0 ? v.toFixed(dec) : formatIndian(v);
}

export default function CobCharts() {
  const { data, isLoading } = useCobSummary();
  const rows = data?.rows ?? [];
  const days = rows.map((r) => shortDay(r.date));

  // ── Chart 1: Quantity (Feed / COB / Tailings) ─────────────
  const qtyOption = {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 52, right: 14, bottom: 36, left: 12, containLabel: true },
    legend: {
      data: ["Feed", "COB", "Tailings", "COB Plan"],
      top: 6,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 12, itemHeight: 8,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number | null; color: string; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        let html = `<div style="font-weight:700;margin-bottom:5px;color:#c8d8f0">Day ${day}</div>`;
        params.forEach((p) => {
          if (p.value != null && p.value > 0) {
            html += `<div style="display:flex;justify-content:space-between;gap:12px;color:${p.color}">
              <span>${p.seriesName}</span>
              <span style="font-weight:700;font-family:'IBM Plex Mono'">${formatIndian(p.value)} MT</span>
            </div>`;
          }
        });
        return html;
      },
    },
    xAxis: {
      type: "category", data: days,
      axisLine: { lineStyle: { color: "#d0d9e8" } },
      axisTick: { show: false },
      axisLabel: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 11, color: "#8899bb",
        formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
      },
      splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [
      {
        name: "Feed", type: "bar",
        data: rows.map((r) => r.feed_actual ?? 0),
        barMaxWidth: 24,
        itemStyle: { color: "#1565c0", opacity: 0.75 },
      },
      {
        name: "COB", type: "bar",
        data: rows.map((r) => r.cob_actual ?? 0),
        barMaxWidth: 24,
        itemStyle: { color: "#c8960c" },
      },
      {
        name: "Tailings", type: "bar",
        data: rows.map((r) => r.tailings_actual ?? 0),
        barMaxWidth: 24,
        itemStyle: { color: "#e65100", opacity: 0.8 },
      },
      {
        name: "COB Plan", type: "line",
        data: rows.map((r) => r.cob_plan ?? null),
        lineStyle: { color: "#f5a623", width: 2, type: "dashed" as const },
        itemStyle: { color: "#f5a623" },
        symbol: "none",
      },
    ],
  };

  // ── Chart 2: Cr₂O₃ Grade Trend ───────────────────────────
  const gradeOption = {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 52, right: 14, bottom: 36, left: 12, containLabel: true },
    legend: {
      data: ["Input Cr₂O₃", "Output Cr₂O₃", "Tailings Cr₂O₃"],
      top: 6,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 12, itemHeight: 8,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number | null; color: string; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        let html = `<div style="font-weight:700;margin-bottom:5px;color:#c8d8f0">Day ${day} — Cr₂O₃ %</div>`;
        params.forEach((p) => {
          if (p.value != null) {
            html += `<div style="display:flex;justify-content:space-between;gap:12px;color:${p.color}">
              <span>${p.seriesName}</span>
              <span style="font-weight:700;font-family:'IBM Plex Mono'">${p.value.toFixed(2)}%</span>
            </div>`;
          }
        });
        return html;
      },
    },
    xAxis: {
      type: "category", data: days,
      axisLine: { lineStyle: { color: "#d0d9e8" } },
      axisTick: { show: false },
      axisLabel: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 11, color: "#8899bb",
        formatter: (v: number) => `${v}%`,
      },
      splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [
      {
        name: "Input Cr₂O₃", type: "line",
        data: rows.map((r) => r.input_cr2o3 ?? null),
        smooth: true,
        lineStyle: { color: "#1565c0", width: 2 },
        itemStyle: { color: "#1565c0" },
        areaStyle: { color: "rgba(21,101,192,0.06)" },
        symbol: "circle", symbolSize: 4,
      },
      {
        name: "Output Cr₂O₃", type: "line",
        data: rows.map((r) => r.output_cr2o3 ?? null),
        smooth: true,
        lineStyle: { color: "#c8960c", width: 2 },
        itemStyle: { color: "#c8960c" },
        areaStyle: { color: "rgba(200,150,12,0.06)" },
        symbol: "circle", symbolSize: 4,
      },
      {
        name: "Tailings Cr₂O₃", type: "line",
        data: rows.map((r) => r.tailings_cr2o3 ?? null),
        smooth: true,
        lineStyle: { color: "#e65100", width: 2, type: "dashed" as const },
        itemStyle: { color: "#e65100" },
        symbol: "circle", symbolSize: 4,
      },
    ],
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 xl:gap-4">
        {[3, 2].map((span, i) => (
          <div key={i} className={`lg:col-span-${span} bg-white border border-border rounded-lg shadow-sm flex items-center justify-center`} style={{ height: 240 }}>
            <div className="text-txt-muted text-sm animate-pulse">Loading chart…</div>
          </div>
        ))}
      </div>
    );
  }

  // Quality badge strip
  const { avg_input_cr2o3, avg_output_cr2o3, avg_tailings_cr2o3 } = data ?? {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 xl:gap-4">

      {/* Quantity chart — 3/5 */}
      <div className="lg:col-span-3 bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-border-light flex items-center justify-between">
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Feed · COB · Tailings
          </span>
          <span className="text-[11px] text-txt-muted font-mono">{rows.length} days</span>
        </div>
        <ReactECharts option={qtyOption} style={{ height: 220 }} opts={{ renderer: "canvas" }} notMerge />
      </div>

      {/* Grade chart — 2/5 */}
      <div className="lg:col-span-2 bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Cr₂O₃ Grade Trend
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {avg_input_cr2o3 != null && (
              <span className="bg-blue-50 text-accent text-[11px] font-bold px-2 py-0.5 rounded">
                In {avg_input_cr2o3.toFixed(1)}%
              </span>
            )}
            {avg_output_cr2o3 != null && (
              <span className="bg-amber-50 text-[#c8960c] text-[11px] font-bold px-2 py-0.5 rounded">
                Out {avg_output_cr2o3.toFixed(1)}%
              </span>
            )}
            {avg_tailings_cr2o3 != null && (
              <span className="bg-orange-50 text-[#e65100] text-[11px] font-bold px-2 py-0.5 rounded">
                Tail {avg_tailings_cr2o3.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <ReactECharts option={gradeOption} style={{ height: 220 }} opts={{ renderer: "canvas" }} notMerge />
      </div>
    </div>
  );
}
