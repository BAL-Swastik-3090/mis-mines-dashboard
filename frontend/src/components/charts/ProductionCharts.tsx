"use client";
import dynamic from "next/dynamic";
import { useProductionDaywise } from "@/hooks/useProduction";
import { useObSummary }         from "@/hooks/useOb";
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

// ── Day Wise Total Excavation — stacked (Ore + OB + De-Silting) ─
function buildStackedExcavationOption(
  dates:    string[],
  oreData:  (number | null)[],
  obData:   (number | null)[],
  siltData: (number | null)[],
) {
  return {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 48, right: 12, bottom: 36, left: 12, containLabel: true },
    legend: {
      data: ["Ore Production (CuM)", "OB Excavation (CuM)", "De-Silting (CuM)"],
      top: 6, right: 8,
      textStyle: { fontSize: 10, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 10, itemHeight: 7,
    },
    tooltip: {
      ...tooltipBase,
      formatter(
        params: Array<{ seriesName: string; value: number; color: string; axisValue: string }>
      ) {
        const day = params[0]?.axisValue ?? "";
        // Sum all series for that day to show total in title
        const total = params.reduce((sum, p) => sum + (p.value ?? 0), 0);
        let html = `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0;font-size:13px;">Day ${day} — Total Excavation = ${formatIndian(Math.round(total))} CuM</div>`;
        let hasData = false;
        params.forEach((p) => {
          if ((p.value ?? 0) > 0) {
            hasData = true;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:3px;">
              <span style="color:${p.color};display:flex;align-items:center;gap:5px;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0"></span>
                ${p.seriesName}
              </span>
              <span style="font-weight:700;font-family:'IBM Plex Mono',monospace;color:#fff;">
                ${formatIndian(p.value)} CuM
              </span>
            </div>`;
          }
        });
        if (!hasData)
          html += `<div style="color:#6b7ea8;font-style:italic;margin-top:4px;">No excavation recorded</div>`;
        return html;
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
        name: "Ore Production (CuM)",
        type: "bar", stack: "excavation",
        data: oreData.map((v) => v ?? 0),
        barMaxWidth: 24,
        itemStyle: { color: "#2e7d32", borderRadius: [0, 0, 0, 0] },
        emphasis: { itemStyle: { color: "#43a047" } },
      },
      {
        name: "OB Excavation (CuM)",
        type: "bar", stack: "excavation",
        data: obData.map((v) => v ?? 0),
        barMaxWidth: 24,
        itemStyle: { color: "#e65100", borderRadius: [0, 0, 0, 0] },
        emphasis: { itemStyle: { color: "#fb8c00" } },
      },
      {
        name: "De-Silting (CuM)",
        type: "bar", stack: "excavation",
        data: siltData.map((v) => v ?? 0),
        barMaxWidth: 24,
        // Top segment gets rounded top corners
        itemStyle: { color: "#00897b", borderRadius: [2, 2, 0, 0] },
        emphasis: { itemStyle: { color: "#26a69a" } },
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

// ── Day Wise Total Excavation Panel ───────────────────────────
interface StackedExcavationPanelProps {
  dates:    string[];
  oreData:  (number | null)[];
  obData:   (number | null)[];
  siltData: (number | null)[];
  loading:  boolean;
  mtdOre:   number | undefined;
  mtdOb:    number | undefined;
  mtdSilt:  number;
}

function StackedExcavationPanel({
  dates, oreData, obData, siltData, loading, mtdOre, mtdOb, mtdSilt,
}: StackedExcavationPanelProps) {
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Day Wise Total Excavation
        </span>
        {/* MTD badges */}
        {!loading && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border"
              style={{ color: "#2e7d32", backgroundColor: "#e8f5e9", borderColor: "#a5d6a7" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#2e7d32]" />
              Ore {formatIndian(mtdOre != null ? Math.round(mtdOre / 3) : null)} CuM
            </span>
            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border"
              style={{ color: "#e65100", backgroundColor: "#fff3e0", borderColor: "#ffcc80" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#e65100]" />
              OB {formatIndian(mtdOb)} CuM
            </span>
            {mtdSilt > 0 && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border"
                style={{ color: "#00695c", backgroundColor: "#e0f2f1", borderColor: "#80cbc4" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#00897b]" />
                Silt {formatIndian(mtdSilt)} CuM
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-[220px] flex items-center justify-center bg-bg-light">
          <div className="text-txt-muted text-sm animate-pulse">Loading chart…</div>
        </div>
      ) : (
        <ReactECharts
          option={buildStackedExcavationOption(dates, oreData, obData, siltData)}
          style={{ height: "220px" }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}

      {/* Data source footer */}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ORE · </span>SAP
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">OB · </span>SAP
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">DE-SILT · </span>IMOS
        </p>
      </div>
    </div>
  );
}

export default function ProductionCharts() {
  const { data,   isLoading }   = useProductionDaywise();
  const { data: obData, isLoading: obLoading } = useObSummary();

  const rows  = data?.rows ?? [];
  const dates = rows.map((r) => r.date);

  // OB from SAP (pp_production) — keyed by date string (YYYY-MM-DD)
  const obMap = Object.fromEntries(
    (obData?.rows ?? []).map((r) => [r.date, r.bal_actual ?? 0])
  );

  // MTD De-Silt — sum from rows (no dedicated MTD field)
  const mtdSilt = rows.reduce((sum, r) => sum + (r.silt_actual ?? 0), 0);

  const combinedLoading = isLoading || obLoading;

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
      {/* ── Replaced "Ore vs OB (CuM)" with Day Wise Total Excavation ── */}
      <StackedExcavationPanel
        dates={dates}
        oreData={rows.map((r) => r.ore_actual != null ? Math.round(r.ore_actual / 3) : null)}
        obData={rows.map((r) => obMap[r.date] ?? 0)}
        siltData={rows.map((r) => r.silt_actual)}
        loading={combinedLoading}
        mtdOre={data?.mtd_ore_actual}
        mtdOb={obData?.mtd_bal_actual}
        mtdSilt={mtdSilt}
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
