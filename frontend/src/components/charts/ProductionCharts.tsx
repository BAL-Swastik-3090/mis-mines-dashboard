"use client";
import dynamic from "next/dynamic";
import { useProductionDaywise, useRehandlingDaywise } from "@/hooks/useProduction";
import { formatIndian }         from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function shortDay(dateStr: string): string {
  return String(new Date(dateStr + "T00:00:00").getDate()).padStart(2, "0");
}

function yAxisFormatter(v: number): string {
  if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)   return `${(v / 1000).toFixed(0)}k`;
  return String(v);
}

const tooltipBase = {
  trigger:         "axis" as const,
  axisPointer:     { type: "shadow" as const },
  backgroundColor: "#0f1c35",
  borderColor:     "#2c4a7c",
  borderWidth:     1,
  padding:         [8, 12],
  textStyle:       { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
};

// ── Day Wise Total Excavation (Re-Handling) — single series ───
function buildRehandlingOption(
  dates: string[],
  data:  (number | null)[],
) {
  return {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 32, right: 12, bottom: 36, left: 12, containLabel: true },
    tooltip: {
      ...tooltipBase,
      formatter(
        params: Array<{ value: number; axisValue: string }>
      ) {
        const day = params[0]?.axisValue ?? "";
        const val = params[0]?.value ?? 0;
        if (!val)
          return `<div style="font-weight:700;color:#c8d8f0;">Day ${day}</div><div style="color:#6b7ea8;font-style:italic;margin-top:4px;">No data recorded</div>`;
        return `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0;font-size:13px;">Day ${day}</div>
          <div style="display:flex;justify-content:space-between;gap:16px;">
            <span style="color:#64b5f6;">Total Excavation</span>
            <span style="font-weight:700;font-family:'IBM Plex Mono';color:#fff;">${formatIndian(Math.round(val))} M³</span>
          </div>`;
      },
    },
    xAxis: {
      type: "category",
      data: dates.map(shortDay),
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: { fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 11, color: "#8899bb", formatter: yAxisFormatter },
      splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      axisLine:  { show: false },
      axisTick:  { show: false },
    },
    series: [
      {
        name: "Total Excavation (M³)",
        type: "bar",
        data: data.map((v) => v ?? 0),
        barMaxWidth: 26,
        itemStyle: { color: "#1565c0", borderRadius: [3, 3, 0, 0] },
        emphasis: { itemStyle: { color: "#1e88e5" } },
      },
    ],
  };
}

// ── Single-series chart ───────────────────────────────────────
function buildOption(
  dates:    string[],
  actuals:  (number | null)[],
  plans:    (number | null)[],
  unit:     string,
  barColor: string,
) {
  return {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 42, right: 12, bottom: 36, left: 12, containLabel: true },
    legend: {
      data: ["Actual", "Plan"],
      top: 6, right: 8,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 12, itemHeight: 8,
    },
    tooltip: {
      ...tooltipBase,
      textStyle: { color: "#e8eef8", fontSize: 13, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number; color: string; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        let html = `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0">Day ${day}</div>`;
        params.forEach((p) => {
          html += `<div style="display:flex;justify-content:space-between;gap:14px;color:${p.color}">
            <span>${p.seriesName}</span>
            <span style="font-weight:700;font-family:'IBM Plex Mono'">${formatIndian(p.value ?? 0)} ${unit}</span>
          </div>`;
        });
        return html;
      },
    },
    xAxis: {
      type: "category",
      data: dates.map(shortDay),
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Mono" },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 11, color: "#8899bb", formatter: yAxisFormatter },
      splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      axisLine:  { show: false },
      axisTick:  { show: false },
    },
    series: [
      {
        name: "Actual", type: "bar",
        data: actuals.map((v) => v ?? 0),
        barMaxWidth: 26,
        itemStyle: { color: barColor, borderRadius: [3, 3, 0, 0] },
      },
      {
        name: "Plan", type: "line",
        data: plans.map((v) => v ?? 0),
        lineStyle:  { color: "#c8960c", width: 2, type: "dashed" as const },
        itemStyle:  { color: "#c8960c" },
        symbol: "circle", symbolSize: 4,
      },
    ],
  };
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">{title}</span>
      </div>
      <div className="h-[220px] flex items-center justify-center bg-bg-light">
        <div className="text-txt-muted text-sm animate-pulse">Loading chart…</div>
      </div>
    </div>
  );
}

interface PanelProps {
  title:        string;
  dates:        string[];
  actuals:      (number | null)[];
  plans:        (number | null)[];
  unit:         string;
  barColor:     string;
  loading:      boolean;
  planSource:   string;
  actualSource: string;
}

function ChartPanel({ title, dates, actuals, plans, unit, barColor, loading, planSource, actualSource }: PanelProps) {
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">{title}</span>
      </div>
      {loading ? (
        <div className="h-[220px] flex items-center justify-center bg-bg-light">
          <div className="text-txt-muted text-sm animate-pulse">Loading chart…</div>
        </div>
      ) : (
        <ReactECharts
          option={buildOption(dates, actuals, plans, unit, barColor)}
          style={{ height: "220px" }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">PLAN · </span>{planSource}
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ACTUAL · </span>{actualSource}
        </p>
      </div>
    </div>
  );
}

// ── Day Wise Total Excavation (Re-Handling) Panel ─────────────
interface RehandlingPanelProps {
  dates:    string[];
  data:     (number | null)[];
  loading:  boolean;
  mtdTotal: number;
}

function RehandlingExcavationPanel({ dates, data, loading, mtdTotal }: RehandlingPanelProps) {
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Day Wise Total Excavation (Re-Handling)
        </span>
        {!loading && mtdTotal > 0 && (
          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border"
            style={{ color: "#1565c0", backgroundColor: "#e3f2fd", borderColor: "#90caf9" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#1565c0]" />
            MTD {formatIndian(Math.round(mtdTotal))} M³
          </span>
        )}
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-[220px] flex items-center justify-center bg-bg-light">
          <div className="text-txt-muted text-sm animate-pulse">Loading chart…</div>
        </div>
      ) : (
        <ReactECharts
          option={buildRehandlingOption(dates, data)}
          style={{ height: "220px" }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}

      {/* Data source footer */}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">SOURCE · </span>pp_prod_order_confirmation (MINE_EXV)
        </p>
      </div>
    </div>
  );
}

export default function ProductionCharts() {
  const { data, isLoading }                              = useProductionDaywise();
  const { data: rehandlingData, isLoading: rhLoading }   = useRehandlingDaywise();

  const rows  = data?.rows ?? [];
  const dates = rows.map((r) => r.date);

  const rhRows  = rehandlingData?.rows ?? [];
  const rhDates = rhRows.map((r) => r.date);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
      <ChartPanel
        title="Ore Production (MT)"
        dates={dates} actuals={rows.map((r) => r.ore_actual)} plans={rows.map((r) => r.ore_plan)}
        unit="MT" barColor="#1565c0" loading={isLoading}
        planSource="IMOS"
        actualSource="SAP"
      />
      <RehandlingExcavationPanel
        dates={rhDates}
        data={rhRows.map((r) => r.total_m3)}
        loading={rhLoading}
        mtdTotal={rehandlingData?.mtd_total ?? 0}
      />
      <ChartPanel
        title="OB (CuM)"
        dates={dates} actuals={rows.map((r) => r.ob_actual)} plans={rows.map((r) => r.ob_plan)}
        unit="CuM" barColor="#2c4a7c" loading={isLoading}
        planSource="IMOS"
        actualSource="SAP"
      />
      <ChartPanel
        title="COB Production (MT)"
        dates={dates} actuals={rows.map((r) => r.cob_actual)} plans={rows.map((r) => r.cob_plan)}
        unit="MT" barColor="#2e7d32" loading={isLoading}
        planSource="IMOS"
        actualSource="SAP"
      />
    </div>
  );
}
