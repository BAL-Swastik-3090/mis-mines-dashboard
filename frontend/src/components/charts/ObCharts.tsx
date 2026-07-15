"use client";
import dynamic from "next/dynamic";
import { useObSummary } from "@/hooks/useOb";
import { formatIndian, formatPct, pctBgClass } from "@/lib/utils";
import type { ObVendorDataAPI } from "@/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// ── Date label: show "06 Jan", "14 Feb" etc. so cross-month ranges are clear
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// ── Shared config ─────────────────────────────────────────────
function makeXAxis(labels: string[], total: number) {
  return {
    type:      "category" as const,
    data:      labels,
    axisLine:  { lineStyle: { color: "#d0d9e8" } },
    axisTick:  { show: false },
    axisLabel: {
      fontSize: 9,
      color:    "#8899bb",
      fontFamily: "IBM Plex Mono",
      rotate:   total > 20 ? 40 : 0,
      interval: total > 25 ? Math.floor(total / 12) : 0,
    },
  };
}

const yAxis = {
  type:      "value" as const,
  axisLabel: {
    fontSize: 11, color: "#8899bb",
    formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
  },
  splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
  axisLine:  { show: false },
  axisTick:  { show: false },
};

const tooltipBase = {
  trigger:         "axis" as const,
  axisPointer:     { type: "shadow" as const },
  backgroundColor: "#0f1c35",
  borderColor:     "#2c4a7c",
  borderWidth:     1,
  padding:         [8, 12],
  textStyle:       { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
};

const VENDOR_COLORS = ["#c62828", "#e65100", "#5e35b1", "#00695c", "#006064"];

// ── Shimmer skeleton ──────────────────────────────────────────
function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

// ── MTD Badge ─────────────────────────────────────────────────
function MtdBadge({
  color, dotColor, bgColor, borderColor, label, value, unit,
}: {
  color: string; dotColor: string; bgColor: string; borderColor: string;
  label: string; value: number | null | undefined; unit: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded border"
      style={{ color, backgroundColor: bgColor, borderColor }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      {label} {formatIndian(value)} {unit}
    </span>
  );
}

// ── BAL OWN chart — stretches to fill left column height ───────
function BalChart() {
  const { data, isLoading } = useObSummary();
  const rows   = data?.rows ?? [];
  const labels = rows.map((r) => dayLabel(r.date));
  const pct    = data?.mtd_bal_pct ?? null;

  const option = {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 36, right: 14, bottom: labels.length > 20 ? 52 : 36, left: 12, containLabel: true },
    legend: {
      data: ["BAL Plan", "BAL Actual"], top: 6,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 12, itemHeight: 8,
    },
    tooltip: {
      ...tooltipBase,
      formatter(params: Array<{ seriesName: string; value: number; color: string; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        let html = `<div style="font-weight:700;margin-bottom:5px;color:#c8d8f0">${day} — BAL OWN</div>`;
        params.forEach((p) => {
          if (p.value > 0)
            html += `<div style="display:flex;justify-content:space-between;gap:12px;color:${p.color}">
              <span>${p.seriesName}</span>
              <span style="font-weight:700;font-family:'IBM Plex Mono'">${formatIndian(p.value)} CuM</span>
            </div>`;
        });
        return html;
      },
    },
    xAxis: makeXAxis(labels, labels.length),
    yAxis,
    series: [
      {
        name: "BAL Plan", type: "bar",
        data: rows.map((r) => r.ob_plan ?? 0),
        barMaxWidth: 18,
        itemStyle: { color: "rgba(21,101,192,0.22)", borderRadius: [2, 2, 0, 0] },
      },
      {
        name: "BAL Actual", type: "bar",
        data: rows.map((r) => r.bal_actual ?? 0),
        barMaxWidth: 18,
        itemStyle: { color: "#1565c0", borderRadius: [2, 2, 0, 0] },
      },
    ],
  };

  return (
    /* h-full + flex-col so the chart stretches to match right column height */
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col h-full">
      <div className="px-4 pt-3 pb-2 border-b border-border-light flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div>
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            BAL OWN · Plan vs Actual
          </span>
          <span className="ml-2 text-[10px] text-txt-muted">CuM</span>
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && (
            <>
              <span className="bg-blue-50 text-accent text-[11px] font-bold px-2 py-0.5 rounded">
                MTD {formatIndian(data?.mtd_bal_actual ?? null)}
              </span>
              <span className="text-[11px] text-txt-muted font-mono">
                / {formatIndian(data?.mtd_ob_plan ?? null)}
              </span>
              {pct != null && <span className={pctBgClass(pct)}>{formatPct(pct)}</span>}
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-light min-h-[240px]">
          <div className="text-txt-muted text-sm animate-pulse">Loading…</div>
        </div>
      ) : (
        /* flex-1 makes ECharts fill the remaining height of the card */
        <div className="flex-1 min-h-[240px]">
          <ReactECharts
            option={option}
            style={{ height: "100%", minHeight: 240 }}
            opts={{ renderer: "canvas" }}
            notMerge
          />
        </div>
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

// ── Single vendor chart ────────────────────────────────────────
function VendorChart({ vendor, colorIdx }: { vendor: ObVendorDataAPI; colorIdx: number }) {
  const { data: obData, isLoading } = useObSummary();

  // Align with BAL x-axis (same dates)
  const allRows  = obData?.rows ?? [];
  const labels   = allRows.map((r) => dayLabel(r.date));
  const actualMap = Object.fromEntries(
    vendor.rows.map((r) => [dayLabel(r.date), r.actual ?? 0])
  );
  const barData = labels.map((d) => actualMap[d] ?? 0);
  const color   = VENDOR_COLORS[colorIdx % VENDOR_COLORS.length];

  const option = {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 36, right: 14, bottom: labels.length > 20 ? 52 : 36, left: 12, containLabel: true },
    legend: {
      data: [`${vendor.agency_desc} Actual`], top: 6,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 12, itemHeight: 8,
    },
    tooltip: {
      ...tooltipBase,
      formatter(params: Array<{ value: number; axisValue: string }>) {
        const day = params[0]?.axisValue ?? "";
        const val = params[0]?.value;
        return `<div style="font-weight:700;margin-bottom:5px;color:#c8d8f0">${day} — ${vendor.agency_desc}</div>` +
          `<div style="color:${color};font-family:'IBM Plex Mono';font-weight:700">` +
          `${val > 0 ? formatIndian(val) + " CuM" : "No activity"}</div>`;
      },
    },
    xAxis: makeXAxis(labels, labels.length),
    yAxis,
    series: [
      {
        name: `${vendor.agency_desc} Actual`,
        type: "bar",
        data: barData,
        barMaxWidth: 18,
        itemStyle: { color, borderRadius: [2, 2, 0, 0] },
      },
    ],
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            {vendor.agency_desc} (Vendor) · Actual
          </span>
          <span className="ml-2 text-[10px] text-txt-muted">CuM · No plan available</span>
        </div>
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded"
          style={{ background: `${color}18`, color }}
        >
          MTD {formatIndian(vendor.mtd_actual)}
        </span>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center bg-bg-light" style={{ height: 240 }}>
          <div className="text-txt-muted text-sm animate-pulse">Loading…</div>
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 240 }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ACTUAL · </span>IMOS
        </p>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────
export default function ObCharts() {
  const { data, isLoading } = useObSummary();
  const vendors = data?.vendors ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="bg-white border border-border rounded-lg shadow-sm flex items-center justify-center" style={{ height: 280 }}>
            <div className="text-txt-muted text-sm animate-pulse">Loading chart…</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3 xl:space-y-4">

      {/* BAL OWN + Vendor breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4 items-stretch">

        {/* Left: BAL OWN */}
        <BalChart />

        {/* Right: vendor charts stacked */}
        <div className="flex flex-col gap-3">
          {vendors.length === 0 ? (
            <div className="bg-white border border-border rounded-lg shadow-sm flex items-center justify-center flex-1 min-h-[280px]">
              <p className="text-txt-muted text-sm">No vendor excavation in this period</p>
            </div>
          ) : (
            vendors.map((v, i) => (
              <VendorChart key={v.agency_id} vendor={v} colorIdx={i} />
            ))
          )}
        </div>
      </div>

    </div>
  );
}
