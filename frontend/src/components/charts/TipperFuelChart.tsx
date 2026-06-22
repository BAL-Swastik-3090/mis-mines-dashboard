"use client";
import dynamic from "next/dynamic";
import { useTipperFuel } from "@/hooks/useEquipment";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

/** Bar colour: red > OEM, blue = near-OEM (7–8), green = efficient (<7) */
function lphColor(lph: number | null, oem: number): string {
  if (lph == null) return "#b0bdd4";
  if (lph > oem)  return "#c62828";   // exceeds OEM → red
  if (lph >= 7)   return "#1565c0";   // near OEM    → blue
  return "#2e7d32";                    // below 7     → green (efficient)
}

export default function TipperFuelChart() {
  const { data, isLoading } = useTipperFuel();
  const machines = data?.machines ?? [];
  const oem      = data?.oem_lph ?? 8.0;

  const labels   = machines.map((m) => m.vehicle_desc);
  const lphBars  = machines.map((m) => ({
    value:     m.lph_avg ?? 0,
    itemStyle: { color: lphColor(m.lph_avg, oem) },
  }));
  const kmplLine = machines.map((m) => m.kmpl_avg ?? null);

  // Rotate x-labels based on fleet size to prevent overlap
  const xRotate   = labels.length > 12 ? 45 : labels.length > 8 ? 30 : 0;
  // More bottom padding when labels are rotated (space for labels + legend)
  const gridBottom = xRotate > 0 ? 80 : 56;

  const option = {
    backgroundColor: "transparent",
    animation: true,

    // ── Legend — bottom centre, scrollable, NO overlap with axis labels ──
    legend: {
      bottom: 0,
      left: "center",
      type: "scroll",
      data: [
        { name: "Fuel (L/Hr)", icon: "roundRect" },
        { name: "Mileage (KMPL)", icon: "circle"    },
        { name: "OEM Limit",   icon: "line"      },
      ],
      textStyle: { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Sans" },
      itemWidth: 14, itemHeight: 8, itemGap: 18,
      // OEM legend item styled with dashed line colour
      formatter: (name: string) => name,
    },

    grid: {
      top: 16,
      right: 52,
      bottom: gridBottom,
      left: 10,
      containLabel: true,
    },

    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c", borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number | null; axisValue: string }>) {
        const vehicle  = params[0]?.axisValue ?? "";
        const fuel     = params.find((p) => p.seriesName === "Fuel (L/Hr)");
        const kmpl     = params.find((p) => p.seriesName === "Mileage (KMPL)");
        const fuelVal  = fuel?.value != null ? Number(fuel.value).toFixed(2) : "—";
        const kmplVal  = kmpl?.value != null ? Number(kmpl.value).toFixed(3) : "—";
        const fuelClr  = fuel?.value != null && fuel.value > oem ? "#ff5252" : "#69f0ae";
        return `
          <div style="font-weight:700;margin-bottom:6px;color:#c8d8f0;font-size:13px">${vehicle}</div>
          <div style="display:flex;justify-content:space-between;gap:20px;margin-bottom:3px">
            <span style="color:#8899bb">Fuel Consumption</span>
            <span style="font-family:'IBM Plex Mono';font-weight:700;color:${fuelClr}">${fuelVal} L/Hr</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:20px;margin-bottom:3px">
            <span style="color:#8899bb">Mileage</span>
            <span style="font-family:'IBM Plex Mono';font-weight:700;color:#f5a623">${kmplVal} KMPL</span>
          </div>
          <div style="margin-top:5px;padding-top:5px;border-top:1px solid #2c4a7c;
               display:flex;justify-content:space-between;gap:20px">
            <span style="color:#6b8ca8;font-size:10px">OEM Limit</span>
            <span style="font-family:'IBM Plex Mono';font-size:10px;color:#a5d6a7">${oem} L/Hr</span>
          </div>`;
      },
    },

    xAxis: {
      type: "category",
      data: labels,
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: {
        fontSize:       9,
        color:          "#8899bb",
        fontFamily:     "IBM Plex Mono",
        rotate:         xRotate,
        interval:       0,
        // Pull rotated labels slightly closer to axis
        margin:         xRotate > 0 ? 6 : 8,
      },
    },

    yAxis: [
      {
        // Left axis — Fuel L/Hr  (name removed; header chip explains it)
        type: "value",
        min: 0,
        axisLabel: {
          fontSize: 10, color: "#8899bb",
          formatter: (v: number) => `${v}`,
        },
        splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      {
        // Right axis — KMPL  (name removed; legend explains it)
        type: "value",
        min: 0,
        axisLabel: {
          fontSize: 10, color: "#8899bb",
          formatter: (v: number) => v.toFixed(2),
        },
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ],

    series: [
      {
        name: "Fuel (L/Hr)",
        type: "bar",
        yAxisIndex: 0,
        data: lphBars,
        barMaxWidth: 20,
        itemStyle: { borderRadius: [2, 2, 0, 0] },
      },
      {
        // OEM reference — dashed red line, excluded from default tooltip
        name: "OEM Limit",
        type: "line",
        yAxisIndex: 0,
        data: Array(labels.length).fill(oem),
        lineStyle: { color: "#1b5e20", type: "dashed" as const, width: 1.5 },
        itemStyle: { color: "#1b5e20" },
        symbol: "none",
        silent: true,
        tooltip: { show: false },
      },
      {
        name: "Mileage (KMPL)",
        type: "line",
        yAxisIndex: 1,
        data: kmplLine,
        smooth: false,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: "#f5a623", width: 2 },
        itemStyle: { color: "#f5a623" },
        connectNulls: false,
      },
    ],
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0 flex-wrap gap-2">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          Tipper Fleet · Fuel Consumption (L/Hr) &amp; Mileage (KMPL)
        </span>

        {!isLoading && data && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-txt-muted flex-wrap">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-danger" />
              Avg L/Hr: <strong className="text-danger ml-0.5">{data.avg_lph?.toFixed(2) ?? "—"}</strong>
            </span>
            <span className="text-border-strong">·</span>
            <span>Fleet: <strong className="text-navy">{data.fleet_count} reporting</strong></span>
            <span className="text-border-strong">·</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-gold" />
              Avg KMPL: <strong className="text-gold ml-0.5">{data.avg_kmpl?.toFixed(3) ?? "—"}</strong>
            </span>
            <span className="text-border-strong">·</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 border-t-2 border-dashed border-danger" />
              OEM: <strong className="text-danger ml-0.5">{data.oem_lph} L/Hr</strong>
            </span>
          </div>
        )}
      </div>

      {/* ── Chart body ─────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[300px]">
          <div className="text-txt-muted text-sm animate-pulse">Loading tipper fuel data…</div>
        </div>
      ) : machines.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[300px]">
          <span className="text-txt-muted text-sm">No tipper data for selected period</span>
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
