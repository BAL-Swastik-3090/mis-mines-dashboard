"use client";
import dynamic from "next/dynamic";
import { useCostCurve } from "@/hooks/useCosting";
import { formatIndian } from "@/lib/utils";
import type { CostSection } from "@/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const C = {
  daily: "#1565c0",     // posted, continuous
  form:  "#c8960c",     // posted, lumpy (contractor bills)
  feed:  "#00695c",     // posted, ore into COB
  month: "#8899bb",     // ACCRUED from plan — deliberately grey, not a brand colour
  rate:  "#c62828",
};

function lakh(v: number): string {
  if (Math.abs(v) >= 1e7) return `${(v / 1e7).toFixed(1)} Cr`;
  if (Math.abs(v) >= 1e5) return `${(v / 1e5).toFixed(0)} L`;
  return formatIndian(v);
}

export default function CostCurveChart({
  period, section,
}: { period: string; section: CostSection }) {
  const { data, isLoading } = useCostCurve(period, section);
  const s = data?.series ?? [];

  const days = s.map((p) => String(p.day).padStart(2, "0"));
  const stack = (key: "daily" | "form" | "feed" | "month_end_used") =>
    s.map((p) => Math.round(p[key]));

  const option = {
    backgroundColor: "transparent",
    grid: { top: 54, right: 58, bottom: 34, left: 12, containLabel: true },
    legend: {
      top: 6,
      data: ["Daily actuals", "Excavation / OB / Power", "Feed", "Month-end (accrued)", "Rs./MT"],
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 12, itemHeight: 8,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", label: { backgroundColor: "#1a2744" } },
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number; color: string; dataIndex: number }>) {
        const i = params[0]?.dataIndex ?? 0;
        const pt = s[i];
        if (!pt) return "";
        let html = `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0">Day ${pt.day} — ${pt.date}</div>`;
        params.forEach((p) => {
          if (p.seriesName === "Rs./MT") return;
          html += `<div style="display:flex;justify-content:space-between;gap:16px;color:${p.color}">
            <span>${p.seriesName}</span>
            <span style="font-weight:700;font-family:'IBM Plex Mono'">${lakh(p.value ?? 0)}</span></div>`;
        });
        html += `<div style="border-top:1px solid #2c4a7c;margin-top:5px;padding-top:5px;
            display:flex;justify-content:space-between;gap:16px;color:#fff;font-weight:700">
            <span>Total cost</span>
            <span style="font-family:'IBM Plex Mono'">${lakh(pt.total_cost)}</span></div>`;
        html += `<div style="display:flex;justify-content:space-between;gap:16px;color:#f5a623">
            <span>${formatIndian(pt.cum_qty_mt)} MT</span>
            <span style="font-weight:700;font-family:'IBM Plex Mono'">
            ${pt.rs_per_mt != null ? formatIndian(pt.rs_per_mt) : "—"} Rs./MT</span></div>`;
        return html;
      },
    },
    xAxis: {
      type: "category",
      data: days,
      axisLine: { lineStyle: { color: "#d0d9e8" } },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: [
      {
        type: "value",
        name: "Cumulative cost",
        nameTextStyle: { fontSize: 10, color: "#8899bb", align: "left" },
        axisLabel: {
          fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono",
          formatter: (v: number) => lakh(v),
        },
        splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      },
      {
        type: "value",
        name: "Rs./MT",
        nameTextStyle: { fontSize: 10, color: "#c62828", align: "right" },
        axisLabel: {
          fontSize: 10, color: "#c62828", fontFamily: "IBM Plex Mono",
          formatter: (v: number) => formatIndian(v),
        },
        splitLine: { show: false },
      },
    ],
    series: [
      area("Daily actuals", stack("daily"), C.daily),
      area("Excavation / OB / Power", stack("form"), C.form),
      area("Feed", stack("feed"), C.feed),
      {
        // Accrued, not posted — flat grey fill and a dashed edge so the
        // estimated portion of the stack is visible at a glance.
        name: "Month-end (accrued)",
        type: "line",
        stack: "cost",
        smooth: false,
        symbol: "none",
        lineStyle: { width: 1, color: C.month, type: "dashed" as const },
        areaStyle: { color: C.month, opacity: 0.28 },
        itemStyle: { color: C.month },
        data: stack("month_end_used"),
      },
      {
        name: "Rs./MT",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { width: 2, color: C.rate },
        itemStyle: { color: C.rate },
        data: s.map((p) => (p.rs_per_mt != null ? Math.round(p.rs_per_mt) : null)),
      },
    ],
  };

  return (
    <div className="bg-white border border-[#d0d9e8] rounded shadow-sm p-4 accent-bar-blue">
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="font-condensed text-[12px] font-bold tracking-[.14em] uppercase text-steel">
            Cost accumulation
          </div>
          <div className="text-[11px] text-txt-muted mt-0.5">
            Cumulative cost by source, with cost per tonne — grey band is accrued from plan, not posted
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="h-[340px] flex items-center justify-center text-[13px] text-txt-muted">
          Loading…
        </div>
      ) : s.length === 0 ? (
        <div className="h-[340px] flex items-center justify-center text-[13px] text-txt-muted">
          No cost recorded for this period.
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 340 }} notMerge lazyUpdate />
      )}
    </div>
  );
}

function area(name: string, data: number[], color: string) {
  return {
    name,
    type: "line" as const,
    stack: "cost",
    smooth: false,
    symbol: "none",
    lineStyle: { width: 1, color },
    areaStyle: { color, opacity: 0.75 },
    itemStyle: { color },
    data,
  };
}
