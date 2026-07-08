"use client";
import dynamic from "next/dynamic";
import { useProductionDaywise } from "@/hooks/useProduction";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function shortDay(dateStr: string): string {
  return String(new Date(dateStr + "T00:00:00").getDate()).padStart(2, "0");
}

function yAxisFormatter(v: number): string {
  if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)   return `${(v / 1000).toFixed(0)}k`;
  return String(v);
}

// ── Ore vs OB comparison (actuals only, both in CuM) ─────────
function buildCompareOption(
  dates:      string[],
  oreActuals: (number | null)[],
  obActuals:  (number | null)[],
) {
  return {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 42, right: 12, bottom: 36, left: 12, containLabel: true },
    legend: {
      data: ["Ore (CuM)", "OB (CuM)"],
      top: 6, right: 8,
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
      formatter(params: Array<{ seriesName: string; value: number; color: string; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        let html = `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0">Day ${day}</div>`;
        params.forEach((p) => {
          html += `<div style="display:flex;justify-content:space-between;gap:14px;color:${p.color}">
            <span>${p.seriesName}</span>
            <span style="font-weight:700;font-family:'IBM Plex Mono'">${formatIndian(p.value ?? 0)} CuM</span>
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
        name: "Ore (CuM)", type: "bar",
        data: oreActuals.map((v) => v ?? 0),
        barMaxWidth: 18,
        itemStyle: { color: "#00838f", borderRadius: [3, 3, 0, 0] },
      },
      {
        name: "OB (CuM)", type: "bar",
        data: obActuals.map((v) => v ?? 0),
        barMaxWidth: 18,
        itemStyle: { color: "#e65100", borderRadius: [3, 3, 0, 0] },
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
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c",
      borderWidth: 1,
      padding: [8, 12],
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

interface ComparePanelProps {
  title:          string;
  dates:          string[];
  oreActuals:     (number | null)[];
  obActuals:      (number | null)[];
  loading:        boolean;
  sourceOre:      string;
  sourceOb:       string;
}

function CompareChartPanel({ title, dates, oreActuals, obActuals, loading, sourceOre, sourceOb }: ComparePanelProps) {
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
          option={buildCompareOption(dates, oreActuals, obActuals)}
          style={{ height: "220px" }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-txt-light/40">ORE · </span>{sourceOre}
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-txt-light/40">OB · </span>{sourceOb}
        </p>
      </div>
    </div>
  );
}

export default function ProductionCharts() {
  const { data, isLoading } = useProductionDaywise();
  const rows  = data?.rows ?? [];
  const dates = rows.map((r) => r.date);

  return (
    /* Single column on phones/tablets → 2 columns on wide desktop */
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
      <ChartPanel
        title="Ore Production (MT)"
        dates={dates} actuals={rows.map((r) => r.ore_actual)} plans={rows.map((r) => r.ore_plan)}
        unit="MT" barColor="#1565c0" loading={isLoading}
        planSource="IMOS"
        actualSource="SAP"
      />
      <CompareChartPanel
        title="Ore vs OB (CuM)"
        dates={dates}
        oreActuals={rows.map((r) => r.ore_actual != null ? Math.round(r.ore_actual / 3) : null)}
        obActuals={rows.map((r) => r.ob_actual)}
        loading={isLoading}
        sourceOre="SAP"
        sourceOb="IMOS"
      />
      <ChartPanel
        title="OB (CuM)"
        dates={dates} actuals={rows.map((r) => r.ob_actual)} plans={rows.map((r) => r.ob_plan)}
        unit="CuM" barColor="#2c4a7c" loading={isLoading}
        planSource="IMOS"
        actualSource="IMOS"
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
