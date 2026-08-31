"use client";
/**
 * Grade-wise Despatch — day-wise, as a chart.
 *
 * This replaced a grade-band table. The table carried the same four numbers every
 * month and said nothing about WHEN grade moved; the mine asked for the day-wise
 * view instead, which is the question a despatch page should answer. The band
 * totals survive as a summary strip beneath the bars — the weighted Cr₂O₃ and
 * Cr/Fe per band are worth keeping and read fine as chart context rather than as
 * rows.
 *
 * The day-wise chart used to sit as a second card further down; it is now the
 * primary view, so that duplicate is gone.
 *
 * Second card is the 2% distribution. HG/MG/LG keeps this consistent with the LCM
 * and the IBM schedule but discriminates poorly — nothing reaches HG in most
 * months and MG holds around three quarters — so the shape only appears at
 * finer steps.
 */
import dynamic from "next/dynamic";
import { Layers, BarChart3 } from "lucide-react";
import { useGradeDespatch } from "@/hooks/useGradeDespatch";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

/** HG/MG/LG follow the grade palette used elsewhere on the page. Unassayed is
 *  deliberately grey — it is an absence of information, not a grade, and must
 *  not look like one. */
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
/** Stacked bottom-up: lowest grade at the base, Unassayed on top where it reads
 *  as the residual it is. */
const STACK_ORDER = ["LG", "MG", "HG", "UNASSAYED"] as const;

const TOOLTIP = {
  backgroundColor: "#0f1c35",
  borderColor: "#2c4a7c",
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
};
const AXIS_LABEL = { fontSize: 10, color: "#6b7ea8", fontFamily: "IBM Plex Mono" };

function n1(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function n0(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}
function g(v: number | null | undefined, dp = 2) {
  return v == null ? "—" : v.toFixed(dp);
}

function Card({ icon, title, right, children, foot }: {
  icon: React.ReactNode; title: string; right?: React.ReactNode;
  children: React.ReactNode; foot?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2 flex-wrap">
        {icon}
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          {title}
        </span>
        {right && <span className="ml-auto text-[10px] font-mono text-txt-muted">{right}</span>}
      </div>
      {children}
      {foot}
    </div>
  );
}

export default function GradeDespatchChart() {
  const { data, isLoading } = useGradeDespatch();

  if (isLoading) {
    return (
      <div className="bg-white border border-border rounded-lg shadow-sm p-4">
        <div className="h-[300px] bg-bg-section animate-pulse rounded" />
      </div>
    );
  }
  if (!data || data.totals.tonnage === 0) return null;

  const t = data.totals;
  const cov = data.coverage;
  const fine = data.fine_bands.filter((f) => f.tonnage > 0);
  const assayed = fine.reduce((s, f) => s + f.tonnage, 0);

  // ── Day-wise stacked bars ──────────────────────────────────────────────
  const dayWise = {
    backgroundColor: "transparent",
    grid: { left: 8, right: 16, top: 36, bottom: 4, containLabel: true },
    legend: {
      top: 0, itemWidth: 11, itemHeight: 8,
      textStyle: { fontSize: 10, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      data: STACK_ORDER.map((k) => BAND_LABEL[k]),
    },
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP,
      formatter: (ps: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
        const total = ps.reduce((s, p) => s + (p.value || 0), 0);
        const lines = ps
          .filter((p) => p.value > 0)
          .map((p) =>
            `<div style="font-family:'IBM Plex Mono'">` +
            `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${p.color};margin-right:6px"></span>` +
            `${p.seriesName} <span style="float:right;padding-left:14px">${formatIndian(Math.round(p.value))} MT</span></div>`)
          .join("");
        return `<div style="font-weight:700;margin-bottom:5px">${ps[0].axisValue}</div>${lines}` +
          `<div style="font-family:'IBM Plex Mono';border-top:1px solid #2c4a7c;margin-top:5px;padding-top:4px">` +
          `Total <span style="float:right;padding-left:14px;font-weight:700">${formatIndian(Math.round(total))} MT</span></div>`;
      },
    },
    xAxis: {
      type: "category",
      // Day number only. The period is already stated in the header and the
      // filter, and full dates at 31 categories collide.
      data: data.daily.map((d) => d.date.slice(8, 10)),
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
    series: STACK_ORDER.map((k) => ({
      name: BAND_LABEL[k],
      type: "bar",
      stack: "grade",
      barMaxWidth: 26,
      itemStyle: { color: BAND_COLOR[k] },
      data: data.daily.map((d) => d[k]),
    })),
  };

  // ── 2% distribution ────────────────────────────────────────────────────
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
      barMaxWidth: 52,
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

  return (
    <div className="space-y-3">

      <Card
        icon={<Layers size={14} className="text-accent shrink-0" />}
        title="Grade-wise Despatch"
        right={
          <>
            <span className="font-bold text-navy text-[13px]">{n0(t.tonnage)}</span> MT
            <span className="ml-1.5">· {n0(t.trips)} trips</span>
            {cov.assayed_pct != null && <span className="ml-1.5">· {cov.assayed_pct.toFixed(1)}% assayed</span>}
          </>
        }
        foot={
          <>
            {/* Band totals. Kept because the weighted Cr₂O₃ and Cr/Fe per band are
                the two numbers the chart cannot show, and they read as chart
                context rather than as a table. */}
            <div className="px-4 py-2.5 border-t border-border-light bg-bg-light/40
                            flex flex-wrap items-baseline gap-x-6 gap-y-2">
              {data.bands.filter((b) => b.tonnage > 0).map((b) => (
                <div key={b.key} className="flex items-baseline gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0 translate-y-[1px]"
                        style={{ background: BAND_COLOR[b.key] }} />
                  <span className="text-[9.5px] font-condensed font-bold tracking-widest
                                   uppercase text-txt-secondary">{b.label}</span>
                  <span className="font-mono text-[12px] font-semibold text-navy tabular-nums">
                    {n1(b.tonnage)} MT
                  </span>
                  <span className="font-mono text-[10px] text-txt-light">
                    · {b.share_pct?.toFixed(1)}%
                    {b.cr2o3 != null && <> · Cr₂O₃ {g(b.cr2o3)} · Cr/Fe {g(b.cr_fe, 3)}</>}
                  </span>
                </div>
              ))}
            </div>

            {/* Customer split */}
            {data.customers.length > 0 && (
              <div className="px-4 py-2.5 border-t border-border-light
                              flex flex-wrap items-baseline gap-x-6 gap-y-2">
                {data.customers.map((c) => (
                  <div key={c.code} className="flex items-baseline gap-2">
                    <span className="text-[9.5px] font-condensed font-bold tracking-widest
                                     uppercase text-txt-secondary">{c.name}</span>
                    <span className="font-mono text-[12px] font-semibold text-navy tabular-nums">
                      {n1(c.tonnage)} MT
                    </span>
                    <span className="font-mono text-[10px] text-txt-light">
                      · {n0(c.trips)} trips · Cr₂O₃ {g(c.cr2o3)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 space-y-0.5">
              <p className="text-[9px] font-mono text-success/70 leading-tight">
                <span className="font-semibold text-success/60">TONNAGE · </span>SAP outbound despatch
                &nbsp;·&nbsp;<span className="font-semibold text-success/60">GRADE · </span>
                SAP quality inspection, joined on PO + batch
              </p>
              <p className="text-[9px] font-mono text-txt-muted leading-tight">
                Bars are on the ASSAYED Cr₂O₃, not the billed material code. Grades are
                tonnage-weighted, never an average of per-trip readings. Unassayed tonnage is
                stacked rather than dropped, so the bars total the Despatch figures above.
                Only days with despatch appear.
              </p>
            </div>
          </>
        }
      >
        <div className="px-2 pt-2">
          <ReactECharts option={dayWise} style={{ height: 320, width: "100%" }} notMerge />
        </div>
      </Card>

      <Card
        icon={<BarChart3 size={14} className="text-[#6a1b9a] shrink-0" />}
        title="Despatch Grade Distribution"
        right={`${formatIndian(Math.round(assayed))} MT assayed`}
        foot={
          <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
            <p className="text-[9px] font-mono text-txt-muted leading-tight">
              Assayed tonnage only, in 2% Cr₂O₃ steps — the HG/MG/LG split above holds most of
              the month in one band, so the shape only shows at finer steps. Bars are coloured
              by the band they belong to. Shares are of assayed tonnage, not of total despatch.
            </p>
          </div>
        }
      >
        <div className="px-2 pt-2">
          <ReactECharts option={distribution} style={{ height: 260, width: "100%" }} notMerge />
        </div>
      </Card>

    </div>
  );
}
