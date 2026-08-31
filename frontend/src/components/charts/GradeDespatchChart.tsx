"use client";
/**
 * Grade-wise Despatch — two charts.
 *
 *   DISTRIBUTION  2% bands. The HG/MG/LG scheme in the table keeps this section
 *                 consistent with the LCM and the IBM schedule, but it barely
 *                 discriminates here: nothing reaches HG in most months and MG
 *                 holds around three quarters of tonnage, so a three-bar chart
 *                 would say almost nothing. At 2% steps the same tonnage
 *                 resolves into a real shape — August 2026 peaks hard at 42-44%.
 *
 *   DAILY TREND   Stacked by HG/MG/LG plus Unassayed, so a drift in despatched
 *                 grade across the month is visible, and so the Unassayed slice
 *                 can be seen concentrating at the end of the period where the
 *                 assay lag actually is.
 */
import dynamic from "next/dynamic";
import { BarChart3, TrendingUp } from "lucide-react";
import { useGradeDespatch } from "@/hooks/useGradeDespatch";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const BAND_COLOR: Record<string, string> = {
  HG: "#2e7d32",
  MG: "#1565c0",
  LG: "#e65100",
  UNASSAYED: "#b0bdd4",
};
const BAND_LABEL: Record<string, string> = {
  HG: "HG ≥52%",
  MG: "MG 40–52%",
  LG: "LG <40%",
  UNASSAYED: "Unassayed",
};

const TOOLTIP = {
  backgroundColor: "#0f1c35",
  borderColor: "#2c4a7c",
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
};
const AXIS_LABEL = { fontSize: 10, color: "#6b7ea8", fontFamily: "IBM Plex Mono" };

function Card({ icon, title, right, children }: {
  icon: React.ReactNode; title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
        {icon}
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          {title}
        </span>
        {right && <span className="ml-auto text-[10px] font-mono text-txt-light">{right}</span>}
      </div>
      {children}
    </div>
  );
}

export default function GradeDespatchChart() {
  const { data, isLoading } = useGradeDespatch();

  if (isLoading || !data || data.totals.tonnage === 0) return null;

  const fine = data.fine_bands.filter((f) => f.tonnage > 0);

  /** Colour each 2% bar by the HG/MG/LG band its midpoint falls in, so the two
   *  charts and the table read as one system rather than three palettes. */
  const fineColor = (label: string) =>
    label.includes("≥ 52") ? BAND_COLOR.HG
      : (label.includes("< 38") || label.includes("38 – 40")) ? BAND_COLOR.LG
      : BAND_COLOR.MG;

  const distribution = {
    backgroundColor: "transparent",
    grid: { left: 8, right: 16, top: 24, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP,
      formatter: (ps: { name: string; value: number; dataIndex: number }[]) => {
        const p = ps[0];
        const row = fine[p.dataIndex];
        return `<div style="font-weight:700;margin-bottom:4px">Cr₂O₃ ${p.name}</div>` +
          `<div style="font-family:'IBM Plex Mono'">${formatIndian(Math.round(p.value))} MT` +
          `<span style="color:#8fa8d0"> · ${row.share_pct?.toFixed(1)}% of assayed</span></div>` +
          `<div style="font-family:'IBM Plex Mono';color:#8fa8d0">${formatIndian(row.trips)} trips</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: fine.map((f) => f.label),
      axisLabel: { ...AXIS_LABEL, interval: 0 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#d0d9e8" } },
    },
    yAxis: {
      type: "value",
      name: "MT",
      nameTextStyle: { ...AXIS_LABEL, align: "right" },
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => formatIndian(v) },
      splitLine: { lineStyle: { color: "#eef2f8" } },
    },
    series: [{
      type: "bar",
      barMaxWidth: 46,
      data: fine.map((f) => ({
        value: f.tonnage,
        itemStyle: { color: fineColor(f.label), borderRadius: [3, 3, 0, 0] },
      })),
      label: {
        show: true, position: "top", fontSize: 9.5, fontFamily: "IBM Plex Mono",
        color: "#3a4a6b", formatter: (p: { value: number }) => formatIndian(Math.round(p.value)),
      },
    }],
  };

  const bandKeys = ["LG", "MG", "HG", "UNASSAYED"] as const;
  const trend = {
    backgroundColor: "transparent",
    grid: { left: 8, right: 16, top: 34, bottom: 4, containLabel: true },
    legend: {
      top: 0, itemWidth: 11, itemHeight: 8,
      textStyle: { fontSize: 10, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      data: bandKeys.map((k) => BAND_LABEL[k]),
    },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP },
    xAxis: {
      type: "category",
      data: data.daily.map((d) => d.date.slice(8, 10)),
      axisLabel: AXIS_LABEL,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#d0d9e8" } },
    },
    yAxis: {
      type: "value",
      name: "MT",
      nameTextStyle: { ...AXIS_LABEL, align: "right" },
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => formatIndian(v) },
      splitLine: { lineStyle: { color: "#eef2f8" } },
    },
    series: bandKeys.map((k) => ({
      name: BAND_LABEL[k],
      type: "bar",
      stack: "grade",
      barMaxWidth: 22,
      itemStyle: { color: BAND_COLOR[k] },
      data: data.daily.map((d) => d[k]),
    })),
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 xl:gap-4">
      <Card
        icon={<BarChart3 size={14} className="text-accent" />}
        title="Despatch Grade Distribution"
        right={`${formatIndian(Math.round(fine.reduce((s, f) => s + f.tonnage, 0)))} MT assayed`}
      >
        <div className="px-2 pt-2">
          <ReactECharts option={distribution} style={{ height: 280, width: "100%" }} notMerge />
        </div>
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          <p className="text-[9px] font-mono text-txt-muted leading-tight">
            Assayed tonnage only, in 2% Cr₂O₃ steps. Bars are coloured by the HG/MG/LG band
            they belong to. Shares are of assayed tonnage, not of total despatch.
          </p>
        </div>
      </Card>

      <Card
        icon={<TrendingUp size={14} className="text-[#6a1b9a]" />}
        title="Day-wise Despatch by Grade"
        right={`${data.daily.length} despatch days`}
      >
        <div className="px-2 pt-2">
          <ReactECharts option={trend} style={{ height: 280, width: "100%" }} notMerge />
        </div>
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          <p className="text-[9px] font-mono text-txt-muted leading-tight">
            Only days with despatch appear. Unassayed tonnage clusters at the end of a period —
            that is assay lag, not a change in what was shipped.
          </p>
        </div>
      </Card>
    </div>
  );
}
