"use client";
import dynamic from "next/dynamic";
import { useDespatchDaywise } from "@/hooks/useDespatch";
import { formatIndian, formatPct, pctBgClass } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const CHART_GRID  = { top: 32, right: 14, bottom: 36, left: 14, containLabel: true };
const AXIS_LABEL  = { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Mono" };
const SPLIT_LINE  = { lineStyle: { color: "#eef2f8", type: "dashed" as const } };
const TOOLTIP_BASE = {
  trigger: "axis" as const,
  axisPointer: { type: "shadow" as const },
  backgroundColor: "#0f1c35",
  borderColor: "#2c4a7c",
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
};

function pctOf(a: number | null, p: number | null): number | null {
  if (a == null || p == null || p === 0) return null;
  return Math.round((a / p) * 1000) / 10;
}

/* ── Chart 1: Overall Despatch — Plan vs Actual ─────────────── */
function OverallDespatchChart() {
  const { data, isLoading } = useDespatchDaywise();
  const rows   = data?.rows ?? [];
  const labels = rows.map((r) => dayLabel(r.date));
  const plan   = rows.map((r) => r.total_plan ?? null);
  const actual = rows.map((r) => r.total_actual ?? null);

  const mtdPct = pctOf(data?.mtd_total_actual ?? null, data?.mtd_total_plan ?? null);

  const option = {
    backgroundColor: "transparent",
    animation: true,
    grid: CHART_GRID,
    legend: {
      top: 4, right: 8,
      data: [{ name: "Plan", icon: "rect" }, { name: "Actual", icon: "rect" }],
      textStyle: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Sans" },
      itemWidth: 10, itemHeight: 10,
    },
    tooltip: {
      ...TOOLTIP_BASE,
      formatter(params: Array<{ seriesName: string; value: number | null; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        const lines = params.map((p) =>
          `<div style="display:flex;justify-content:space-between;gap:20px;">
            <span style="color:#8899bb">${p.seriesName}</span>
            <span style="font-family:'IBM Plex Mono';font-weight:600;color:#b39ddb">
              ${p.value != null ? formatIndian(p.value) + " MT" : "—"}
            </span>
           </div>`
        ).join("");
        return `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0">${day}</div>${lines}`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: "#d0d9e8" } },
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, rotate: labels.length > 15 ? 30 : 0 },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        ...AXIS_LABEL,
        formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
      },
      splitLine: SPLIT_LINE,
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "Plan",
        type: "bar",
        data: plan,
        barMaxWidth: 28,
        itemStyle: { color: "#5e35b1", borderRadius: [3, 3, 0, 0], opacity: 0.60 },
        emphasis: { itemStyle: { color: "#7e57c2", opacity: 0.85 } },
      },
      {
        name: "Actual",
        type: "bar",
        data: actual,
        barMaxWidth: 28,
        itemStyle: { color: "#f5a623", borderRadius: [3, 3, 0, 0] },
        emphasis: { itemStyle: { color: "#ffb74d" } },
      },
    ],
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Despatch — Plan vs Actual (MT)
        </span>
        {!isLoading && data && (
          <div className="flex items-center gap-2 text-[11px] font-mono">
            {data.mtd_total_actual != null && (
              <>
                <span className="text-orange font-bold">{formatIndian(data.mtd_total_actual)} MT</span>
                <span className="text-txt-light">vs plan {formatIndian(data.mtd_total_plan)}</span>
                {mtdPct != null && <span className={pctBgClass(mtdPct)}>{formatPct(mtdPct)}</span>}
              </>
            )}
            {data.mtd_total_actual == null && (
              <span className="text-txt-muted">Plan {formatIndian(data.mtd_total_plan)} MT</span>
            )}
            {(data.mtd_unsynced_count ?? 0) > 0 && (
              <span className="text-[10px] text-orange bg-orange-50 px-2 py-0.5 rounded-full font-bold border border-orange/20">
                {data.mtd_unsynced_count} unsynced
              </span>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[220px]">
          <div className="text-txt-muted text-sm animate-pulse">Loading despatch data…</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[220px]">
          <span className="text-txt-muted text-sm">No data for selected period</span>
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: "260px" }} opts={{ renderer: "canvas" }} notMerge />
      )}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">PLAN · </span>IMOS
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ACTUAL · </span>SAP
        </p>
      </div>
    </div>
  );
}

/* ── Chart 2: Location-wise Despatch — Plan vs Actual ──────── */
function LocationDespatchChart() {
  const { data, isLoading } = useDespatchDaywise();
  const rows    = data?.rows ?? [];
  const labels  = rows.map((r) => dayLabel(r.date));
  const balPlan = rows.map((r) => r.bal_plan ?? null);
  const sukPlan = rows.map((r) => r.suk_plan ?? null);
  const balAct  = rows.map((r) => r.bal_actual ?? null);
  const sukAct  = rows.map((r) => r.suk_actual ?? null);

  const hasActuals = rows.some((r) => r.bal_actual != null || r.suk_actual != null);

  const option = {
    backgroundColor: "transparent",
    animation: true,
    grid: CHART_GRID,
    legend: {
      top: 4, right: 8,
      data: [
        { name: "BAL Plan", icon: "rect" },
        { name: "SUK Plan", icon: "rect" },
        ...(hasActuals ? [{ name: "BAL Act", icon: "rect" }, { name: "SUK Act", icon: "rect" }] : []),
      ],
      textStyle: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Sans" },
      itemWidth: 10, itemHeight: 10,
    },
    tooltip: {
      ...TOOLTIP_BASE,
      formatter(params: Array<{ seriesName: string; value: number | null; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        const colors: Record<string, string> = {
          "BAL Plan": "#1565c080", "SUK Plan": "#c8960c80",
          "BAL Act":  "#1565c0",   "SUK Act":  "#c8960c",
        };
        const lines = params.map((p) =>
          `<div style="display:flex;justify-content:space-between;gap:20px;">
            <span style="color:${colors[p.seriesName] ?? "#8899bb"}">${p.seriesName}</span>
            <span style="font-family:'IBM Plex Mono';font-weight:600;color:#e8eef8">
              ${p.value != null ? formatIndian(p.value) + " MT" : "—"}
            </span>
           </div>`
        ).join("");
        return `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0">${day}</div>${lines}`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: "#d0d9e8" } },
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, rotate: labels.length > 15 ? 30 : 0 },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        ...AXIS_LABEL,
        formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
      },
      splitLine: SPLIT_LINE,
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "BAL Plan",
        type: "bar",
        stack: "plan",
        data: balPlan,
        barMaxWidth: 28,
        itemStyle: { color: "#1565c0", opacity: 0.45, borderRadius: [0, 0, 0, 0] },
      },
      {
        name: "SUK Plan",
        type: "bar",
        stack: "plan",
        data: sukPlan,
        barMaxWidth: 28,
        itemStyle: { color: "#c8960c", opacity: 0.45, borderRadius: [3, 3, 0, 0] },
      },
      ...(hasActuals ? [
        {
          name: "BAL Act",
          type: "bar" as const,
          stack: "actual",
          data: balAct,
          barMaxWidth: 28,
          itemStyle: { color: "#1565c0", borderRadius: [0, 0, 0, 0] },
          emphasis: { itemStyle: { color: "#1e88e5" } },
        },
        {
          name: "SUK Act",
          type: "bar" as const,
          stack: "actual",
          data: sukAct,
          barMaxWidth: 28,
          itemStyle: { color: "#c8960c", borderRadius: [3, 3, 0, 0] },
          emphasis: { itemStyle: { color: "#f5a623" } },
        },
      ] : []),
    ],
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Location-wise Despatch (MT)
        </span>
        {!isLoading && data && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-txt-muted">
            {data.mtd_bal_actual != null ? (
              <>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-accent inline-block" />
                  BAL Act {formatIndian(data.mtd_bal_actual)}
                </span>
                <span className="text-border-strong">·</span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-gold inline-block" />
                  SUK Act {formatIndian(data.mtd_suk_actual ?? 0)}
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-accent inline-block" />
                  BAL {formatIndian(data.mtd_bal_plan)}
                </span>
                <span className="text-border-strong">·</span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-gold inline-block" />
                  SUK {formatIndian(data.mtd_suk_plan)}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[220px]">
          <div className="text-txt-muted text-sm animate-pulse">Loading despatch data…</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[220px]">
          <span className="text-txt-muted text-sm">No data for selected period</span>
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: "260px" }} opts={{ renderer: "canvas" }} notMerge />
      )}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">PLAN · </span>IMOS
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ACTUAL · </span>SAP
        </p>
      </div>
    </div>
  );
}

/* ── Export ──────────────────────────────────────────────────── */
export default function DespatchCharts() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
      <OverallDespatchChart />
      <LocationDespatchChart />
    </div>
  );
}
