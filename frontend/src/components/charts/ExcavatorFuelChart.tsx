"use client";
import dynamic from "next/dynamic";
import { useExcavatorFuel } from "@/hooks/useEquipment";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const LPH_COLOR  = "#1565c0";  // navy-blue for L/Hr bars
const FUEL_COLOR = "#f5a623";  // amber-gold for Total Fuel bars

export default function ExcavatorFuelChart() {
  const { data, isLoading } = useExcavatorFuel();
  const machines = (data?.machines ?? []).filter((m) => m.fuel_mtd > 0);

  const labels   = machines.map((m) => m.vehicle_desc);
  const lphBars  = machines.map((m) => m.lph_avg ?? 0);
  const fuelBars = machines.map((m) => m.fuel_mtd);

  const xRotate    = labels.length > 5 ? 30 : 0;
  const gridBottom = xRotate > 0 ? 76 : 52;

  const option = {
    backgroundColor: "transparent",
    animation: true,

    legend: {
      bottom: 0,
      left: "center",
      type: "scroll",
      data: [
        { name: "L/Hr (Avg)",    icon: "roundRect" },
        { name: "Total Fuel (L)", icon: "roundRect" },
      ],
      textStyle: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Sans" },
      itemWidth: 14, itemHeight: 8, itemGap: 18,
    },

    grid: {
      top: 16, right: 52, bottom: gridBottom, left: 10,
      containLabel: true,
    },

    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c", borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number | null; axisValue: string }>) {
        const machine = params[0]?.axisValue ?? "";
        const lph     = params.find((p) => p.seriesName === "L/Hr (Avg)");
        const fuel    = params.find((p) => p.seriesName === "Total Fuel (L)");
        const lphVal  = lph?.value  != null ? Number(lph.value).toFixed(2)  : "—";
        const fuelVal = fuel?.value != null ? Number(fuel.value).toFixed(0) : "—";
        return `
          <div style="font-weight:700;margin-bottom:6px;color:#c8d8f0;font-size:13px">${machine}</div>
          <div style="display:flex;justify-content:space-between;gap:20px;margin-bottom:3px">
            <span style="color:#8899bb">Avg L/Hr</span>
            <span style="font-family:'IBM Plex Mono';font-weight:700;color:${LPH_COLOR}">${lphVal} L/Hr</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#8899bb">Total Fuel</span>
            <span style="font-family:'IBM Plex Mono';font-weight:700;color:${FUEL_COLOR}">${fuelVal} L</span>
          </div>`;
      },
    },

    xAxis: {
      type: "category",
      data: labels,
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: {
        fontSize: 9, color: "#8899bb", fontFamily: "IBM Plex Mono",
        rotate: xRotate, interval: 0,
        margin: xRotate > 0 ? 6 : 8,
      },
    },

    yAxis: [
      {
        type: "value",
        name: "L/Hr",
        nameTextStyle: { color: "#8899bb", fontSize: 10 },
        min: 0,
        axisLabel: { fontSize: 10, color: "#8899bb", formatter: (v: number) => `${v}` },
        splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
        axisLine: { show: false }, axisTick: { show: false },
      },
      {
        type: "value",
        name: "Litres",
        nameTextStyle: { color: "#8899bb", fontSize: 10 },
        min: 0,
        axisLabel: { fontSize: 10, color: "#8899bb", formatter: (v: number) => `${(v / 1000).toFixed(1)}k` },
        splitLine: { show: false },
        axisLine: { show: false }, axisTick: { show: false },
      },
    ],

    series: [
      {
        name: "L/Hr (Avg)",
        type: "bar",
        yAxisIndex: 0,
        data: lphBars,
        barMaxWidth: 22,
        itemStyle: { color: LPH_COLOR, borderRadius: [2, 2, 0, 0] },
      },
      {
        name: "Total Fuel (L)",
        type: "bar",
        yAxisIndex: 1,
        data: fuelBars,
        barMaxWidth: 22,
        itemStyle: { color: FUEL_COLOR, borderRadius: [2, 2, 0, 0] },
        barGap: "10%",
      },
    ],
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0 flex-wrap gap-2">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Excavator Fleet · Fuel Consumption (L/Hr)
        </span>

        {!isLoading && data && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-txt-muted flex-wrap">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: LPH_COLOR }} />
              Avg L/Hr: <strong style={{ color: LPH_COLOR }} className="ml-0.5">{data.avg_lph?.toFixed(2) ?? "—"}</strong>
            </span>
            <span className="text-border-strong">·</span>
            <span>Fleet: <strong className="text-navy">{data.fleet_count} reporting</strong></span>
            <span className="text-border-strong">·</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: FUEL_COLOR }} />
              Total: <strong style={{ color: FUEL_COLOR }} className="ml-0.5">{data.total_fuel.toLocaleString("en-IN")} L</strong>
            </span>
          </div>
        )}
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[300px]">
          <div className="text-txt-muted text-sm animate-pulse">Loading excavator fuel data…</div>
        </div>
      ) : machines.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[300px]">
          <span className="text-txt-muted text-sm">No fuel data for selected period</span>
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
