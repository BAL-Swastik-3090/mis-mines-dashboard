"use client";
/**
 * Grade-wise weighted average Cr₂O₃ of ore production.
 *
 *     Weighted Avg = Σ(Grade Value × Qty) ÷ Σ Qty
 *
 * Tonnage as stacked bars per grade, the weighted average as a line on its own
 * axis — the point is to read the grade against the mix that produced it.
 *
 * Two deliberate choices:
 *   - Days with no inspection are gaps, not zeros. A zero would draw a line
 *     plunging to the axis and read as ore assaying at 0% Cr₂O₃.
 *   - The percentage axis does not start at zero. Grade moves in a narrow band
 *     (40–52%) and a zero-based axis would flatten every real movement into a
 *     straight line. It is bounded to the data with a small margin instead, which
 *     is the correct call for a ratio that never approaches zero.
 */
import dynamic from "next/dynamic";
import { FlaskConical } from "lucide-react";
import { useOreGrade } from "@/hooks/useOreGrade";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const GRADE_COLOR: Record<string, string> = {
  HG:  "#c8960c",
  MG:  "#1565c0",
  LG:  "#e65100",
};

function dayNum(iso: string) {
  return String(Number(iso.split("-")[2])).padStart(2, "0");
}

export default function OreGradeChart() {
  const { data, isLoading, isError, error } = useOreGrade();
  const rows = data?.rows ?? [];

  const days   = rows.map((r) => dayNum(r.date));
  const series = (data?.period_grades ?? []).map((g) => ({
    name: g.grade_label,
    type: "bar" as const,
    stack: "qty",
    yAxisIndex: 0,
    barMaxWidth: 26,
    itemStyle: { color: GRADE_COLOR[g.grade_key] ?? "#8899bb" },
    data: rows.map((r) => r.grades.find((x) => x.grade_key === g.grade_key)?.qty ?? 0),
  }));

  // Bound the percentage axis to the data, not to zero.
  const crs = rows.map((r) => r.weighted_cr).filter((v): v is number => v != null);
  const crMin = crs.length ? Math.floor(Math.min(...crs) - 2) : 0;
  const crMax = crs.length ? Math.ceil(Math.max(...crs) + 2)  : 60;

  const option = {
    backgroundColor: "transparent",
    grid: { top: 46, right: 52, bottom: 34, left: 12, containLabel: true },
    legend: {
      top: 4,
      itemWidth: 12, itemHeight: 8,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c", borderWidth: 1, padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 13, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number; color: string; axisValue: string; seriesType: string }>) {
        const day = params[0]?.axisValue ?? "";
        let html = `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0">Day ${day}</div>`;
        let qty = 0;
        params.filter((p) => p.seriesType === "bar").forEach((p) => {
          if (p.value > 0) {
            qty += p.value;
            html += `<div style="display:flex;justify-content:space-between;gap:14px;color:${p.color}">
              <span>${p.seriesName}</span>
              <span style="font-weight:700;font-family:'IBM Plex Mono'">${formatIndian(p.value)} TO</span></div>`;
          }
        });
        const line = params.find((p) => p.seriesType === "line");
        if (qty > 0) {
          html += `<div style="border-top:1px solid #2c4a7c;margin-top:5px;padding-top:5px;
                    display:flex;justify-content:space-between;gap:14px;color:#fff;font-weight:700">
            <span>Total</span><span style="font-family:'IBM Plex Mono'">${formatIndian(qty)} TO</span></div>`;
        }
        if (line && line.value != null) {
          html += `<div style="display:flex;justify-content:space-between;gap:14px;color:#00bfa5;font-weight:700">
            <span>Weighted Cr₂O₃</span>
            <span style="font-family:'IBM Plex Mono'">${Number(line.value).toFixed(2)}%</span></div>`;
        } else if (qty === 0) {
          html += `<div style="color:#8fa8d0">No inspection this day</div>`;
        }
        return html;
      },
    },
    xAxis: {
      type: "category", data: days,
      axisLine: { lineStyle: { color: "#d0d9e8" } },
      axisTick: { show: false },
      axisLabel: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: [
      {
        type: "value", name: "TO",
        nameTextStyle: { fontSize: 10, color: "#8899bb" },
        axisLabel: {
          fontSize: 11, color: "#8899bb",
          formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)),
        },
        splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
        axisLine: { show: false }, axisTick: { show: false },
      },
      {
        type: "value", name: "Cr₂O₃ %",
        min: crMin, max: crMax,
        nameTextStyle: { fontSize: 10, color: "#00897b" },
        axisLabel: { fontSize: 11, color: "#00897b", formatter: "{value}%" },
        splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
      },
    ],
    series: [
      ...series,
      {
        name: "Weighted Cr₂O₃",
        type: "line" as const,
        yAxisIndex: 1,
        // connectNulls false: a day without inspection breaks the line rather
        // than being bridged, so a gap in sampling is visible as a gap.
        connectNulls: false,
        symbol: "circle", symbolSize: 6,
        lineStyle: { width: 2.5, color: "#00897b" },
        itemStyle: { color: "#00897b" },
        data: rows.map((r) => r.weighted_cr),
      },
    ],
  };

  if (isError) {
    return (
      <div className="bg-white border border-border rounded-lg shadow-sm p-4">
        <span className="text-[12px] text-[#c62828]">
          {error instanceof Error ? error.message : "Failed to load grade data"}
        </span>
      </div>
    );
  }

  const pg = data?.period_grades ?? [];
  const active = pg.filter((g) => g.qty > 0);

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskConical size={14} className="text-[#00897b] shrink-0" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Ore Grade — Weighted Average Cr₂O₃
          </span>
        </div>
        {!isLoading && data?.period_weighted_cr != null && (
          <span className="text-[11px] font-mono text-txt-muted whitespace-nowrap">
            <span className="font-bold text-[#00897b] text-[15px]">
              {data.period_weighted_cr.toFixed(2)}%
            </span>
            <span className="ml-1.5">on {formatIndian(Math.round(data.period_total_qty))} TO</span>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-[300px] m-4 bg-bg-section animate-pulse rounded" />
      ) : (
        <ReactECharts option={option} style={{ height: 300, width: "100%" }} notMerge />
      )}

      {/* Per-grade contribution for the period */}
      {!isLoading && active.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {active.map((g) => (
            <span key={g.grade_key} className="flex items-center gap-1.5 text-[11px] font-mono">
              <span className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: GRADE_COLOR[g.grade_key] ?? "#8899bb" }} />
              <span className="text-txt-muted">{g.grade_label}</span>
              <span className="font-semibold text-navy">{g.cr2o3?.toFixed(2)}%</span>
              <span className="text-txt-light">
                · {formatIndian(Math.round(g.qty))} TO · {g.share_pct.toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 space-y-0.5">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">GRADE &amp; QTY · </span>
          {data?.source ?? "SAP quality inspection"}
        </p>
        {!isLoading && data && data.days_with_data < data.days_in_period && (
          <p className="text-[9px] font-mono text-txt-muted leading-tight">
            Inspected on {data.days_with_data} of {data.days_in_period} days — uninspected days
            break the line rather than reading as 0%. The period figure is Σ(grade × qty) ÷ Σ qty,
            not the average of the daily figures, so a heavy day counts for more than a light one.
          </p>
        )}
      </div>
    </div>
  );
}
