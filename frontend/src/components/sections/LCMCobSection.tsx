"use client";
/**
 * LCM for COB — the concentrate deviation, attributed to its causes.
 *
 * This deliberately does not look like the mines LCM matrix, because it is not
 * the same kind of object. The mines matrix lists LOSS HEADS taken from the
 * shift log's own columns; the plant has no downtime log, so there are no heads
 * to list. What it has instead is a plan and an actual on both tonnage and
 * grade, which is enough to say how much concentrate was lost and why:
 *
 *   Feed volume     — ore that never reached the plant
 *   Recovery/yield  — ore that reached it but did not report to concentrate
 *
 * The two sum to the deviation by algebra, so the total cannot drift.
 *
 * The section shows the basis, the headline figures, the composition and the
 * costing rate. The API also returns a level-2 split of Recovery (feed grade vs
 * plant efficiency) and an inferred running-hours figure; both were displayed
 * until the user asked for them removed on 2026-08-29. They are still computed
 * and still validated, so re-adding either is a UI-only change — nothing has to
 * be rebuilt on the server.
 */
import { useMemo } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, TrendingDown, Gauge, IndianRupee } from "lucide-react";
import { useCobLcm } from "@/hooks/useCobLcm";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function fmt(v: number | null | undefined, dp = 2) {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function f0(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}
function rs(v: number | null | undefined) {
  return v == null ? "—" : `₹${formatIndian(Math.round(v))}`;
}
/** Large rupee figures read better in lakhs, matching the mines LCM. */
function rsLakh(v: number | null | undefined) {
  return v == null ? "—" : `₹${(v / 100000).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;
}
/** A loss is red. A NEGATIVE loss is not a loss — the plant beat plan — so it
 *  flips to green. */
function lossColor(v: number | null | undefined) {
  if (v == null) return "text-txt-muted";
  return v < 0 ? "text-[#2e7d32]" : "text-[#c62828]";
}

function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

export default function LCMCobSection() {
  const { data, isLoading, isError, error } = useCobLcm();
  const p = data?.plan;
  const a = data?.actual;
  const t = data?.totals;
  const rows = data?.rows ?? [];

  // Level 1 only — the pie shows parts of one whole, and the level-2 rows are
  // already inside Recovery.
  const pieRows = useMemo(
    () => rows.filter((r) => r.level === 1 && (r.loss_mt ?? 0) > 0),
    [rows],
  );

  if (isError) {
    return (
      <div className="mx-1 mt-4 p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3">
        <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
        <span className="text-[12px] text-[#c62828]">
          {error instanceof Error ? error.message : "Failed to load LCM for COB"}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* No plan for the window — every figure below would be measured against
          zero, so nothing is shown rather than a fabricated deviation. */}
      {!isLoading && data && !data.has_plan && (
        <div className="p-3 rounded-lg bg-[#fff8e1] border border-[#ffe082] border-l-[3px] border-l-[#c8960c] flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">No COB plan entered for this period.</span>{" "}
            Deviation is measured against plan, so it cannot be calculated without one.
            The plan begins April 2026 — pick a later period to see the loss.
          </div>
        </div>
      )}

      {/* SAP posting lag — trailing plan days with no actual read as loss */}
      {!isLoading && data?.has_plan && data.posting.unposted_days > 0 && (
        <div className="p-3 rounded-lg bg-[#fff8e1] border border-[#ffe082] border-l-[3px] border-l-[#c8960c] flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">
              SAP has posted through {data.posting.last_posted_date}, but the period runs{" "}
              {data.posting.unposted_days} day{data.posting.unposted_days > 1 ? "s" : ""} beyond that.
            </span>{" "}
            Those days carry a plan with no actual against it, so their whole plan lands in
            Feed volume as loss that may not have happened. End the period at the last posted
            date for a clean comparison.
          </div>
        </div>
      )}

      {/* ── Plan vs actual, the basis of everything below ─────────────── */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
          <Gauge size={14} className="text-[#6a1b9a]" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Basis — Plan vs Actual
          </span>
          {!isLoading && a && (
            <span className="ml-auto text-[10px] font-mono text-txt-light">
              {a.grade_lots} quality lots · {a.grade_weighted ? "tonnage-weighted" : "unweighted"}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="bg-bg-section border-b border-border-light">
                <th className="px-3 py-2 text-left  text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Measure</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#1565c0]">Plan</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#2e7d32]">Actual</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/60">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 4 }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5"><Shimmer w="w-16" h="h-4" /></td>
                  ))}</tr>
                ))
              ) : p && a ? ([
                { k: "Feed (MT)",            pv: p.feed,        av: a.feed,        dp: 0 },
                { k: "Concentrate (MT)",     pv: p.concentrate, av: a.concentrate, dp: 0 },
                { k: "Weight recovery (%)",  pv: p.recovery_pct, av: a.recovery_pct, dp: 2, isPct: true },
                { k: "Feed grade Cr₂O₃ (%)", pv: p.feed_grade,  av: a.feed_grade,  dp: 3, isPct: true },
                { k: "Conc. grade Cr₂O₃ (%)",pv: p.conc_grade,  av: a.conc_grade,  dp: 3, isPct: true },
                { k: "Chrome recovery (%)",  pv: p.chrome_recovery_pct, av: a.chrome_recovery_pct, dp: 2, isPct: true },
              ].map((r) => {
                const variance = r.pv != null && r.av != null ? r.av - r.pv : null;
                return (
                  <tr key={r.k} className="hover:bg-bg-section/50 transition-colors">
                    <td className="px-3 py-2 font-condensed font-bold text-[12px] text-navy whitespace-nowrap">{r.k}</td>
                    <td className="px-3 py-2 text-right text-navy tabular-nums">
                      {r.isPct ? fmt(r.pv, r.dp) : f0(r.pv)}
                    </td>
                    <td className="px-3 py-2 text-right text-navy tabular-nums">
                      {r.isPct ? fmt(r.av, r.dp) : f0(r.av)}
                    </td>
                    {/* Actual above plan is good on every row here — more feed,
                        better recovery, richer grade. So the sign convention is
                        the reverse of the loss columns and is stated in the
                        header rather than inferred from colour alone. */}
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      variance == null ? "text-txt-muted" : variance >= 0 ? "text-[#2e7d32]" : "text-[#c62828]"
                    }`}>
                      {variance == null ? "—"
                        : `${variance >= 0 ? "+" : ""}${r.isPct ? fmt(variance, r.dp) : f0(variance)}`}
                    </td>
                  </tr>
                );
              })) : null}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 space-y-0.5">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">PLAN · </span>mines_cobp_plan
            &nbsp;·&nbsp;<span className="font-semibold text-success/60">ACTUAL · </span>SAP plant 1210
          </p>
          <p className="text-[9px] font-mono text-txt-muted leading-tight">
            Grades are tonnage-weighted, never an average of daily percentages. Recovery is
            derived from the summed quantities so plan and actual are on the same footing.
            A positive variance is favourable on every row above.
          </p>
        </div>
      </div>

      {/* ── Period headline ───────────────────────────────────────────── */}
      {!isLoading && data?.has_plan && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: "Concentrate Deviation", value: `${f0(data.deviation_mt)} MT`,
              sub: "planned concentrate not produced", accent: "#1565c0" },
            { label: "Total Loss Value",      value: rsLakh(t?.loss_amount),
              sub: `${f0(t?.loss_mt)} MT × ${rs(data.costing.rate)}/MT`, accent: "#ad1457",
              color: lossColor(t?.loss_amount) },
          ].map((k) => (
            <div key={k.label} className="bg-white border border-border rounded-lg shadow-sm overflow-hidden border-t-2"
                 style={{ borderTopColor: k.accent }}>
              <div className="px-3 pt-2.5 pb-1">
                <div className="text-[9.5px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
                  {k.label}
                </div>
              </div>
              <div className="px-3 pb-2.5">
                <div className={`font-condensed font-extrabold text-[20px] leading-none break-words ${k.color ?? "text-navy"}`}>
                  {k.value}
                </div>
                <div className="text-[9.5px] text-txt-light font-mono mt-0.5">{k.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Composition ───────────────────────────────────────────────── */}
      {!isLoading && pieRows.length > 0 && t?.loss_mt != null && (
        <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
            <TrendingDown size={14} className="text-[#c62828]" />
            <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
              Loss Composition — Concentrate
            </span>
            <span className="ml-auto text-[10px] font-mono text-txt-light">
              {f0(t.loss_mt)} MT total
            </span>
          </div>
          <LossPie rows={pieRows.map((r) => ({ name: r.loss_description, value: r.loss_mt ?? 0 }))} />
        </div>
      )}

      {/* ── Costing basis ─────────────────────────────────────────────── */}
      {!isLoading && data && (
        <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
            <IndianRupee size={14} className="text-[#ad1457]" />
            <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
              Costing Basis
            </span>
          </div>
          <div className="px-4 py-3 flex items-baseline gap-3 flex-wrap">
            <span className="font-condensed font-extrabold text-[22px] text-[#ad1457] leading-none">
              {rs(data.costing.rate)}
            </span>
            <span className="text-[11px] font-mono text-txt-secondary">per MT · {data.costing.basis}</span>
            <span className="ml-auto text-[10px] font-mono text-txt-light">{data.costing.source}</span>
          </div>
          <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
            <p className="text-[9px] font-mono text-txt-muted leading-tight">
              COB output is valued on IBM&apos;s CONCENTRATES line, not the Cr₂O₃-banded fines
              schedule the mines LCM uses — a beneficiated product is not run-of-mine fines.
              One product, one rate, so no weighting is required. Tailings are not costed
              separately: chrome reporting to tailings is already inside the Recovery head.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}

/** Two-slice composition. No grouping threshold — there are only ever two
 *  level-1 causes, and neither can be a sliver worth folding away. */
function LossPie({ rows }: { rows: { name: string; value: number }[] }) {
  const option = {
    backgroundColor: "transparent",
    color: ["#1565c0", "#c62828"],
    tooltip: {
      trigger: "item",
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 13, fontFamily: "IBM Plex Sans" },
      formatter: (p: { name: string; value: number; percent: number; color: string }) =>
        `<div style="font-weight:700;margin-bottom:4px;color:${p.color}">${p.name}</div>` +
        `<div style="font-family:'IBM Plex Mono'">${formatIndian(Math.round(p.value))} MT` +
        `<span style="color:#8fa8d0"> · ${p.percent.toFixed(1)}%</span></div>`,
    },
    legend: {
      orient: "vertical",
      right: 8,
      top: "middle",
      itemWidth: 11,
      itemHeight: 8,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
    },
    series: [{
      type: "pie",
      radius: ["42%", "72%"],
      center: ["31%", "50%"],
      avoidLabelOverlap: true,
      minAngle: 3,
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: {
        show: true, formatter: "{d}%", fontSize: 11,
        fontFamily: "IBM Plex Mono", color: "#31415f",
      },
      labelLine: { length: 8, length2: 8 },
      emphasis: { scaleSize: 6, label: { show: true, fontSize: 12, fontWeight: "bold" as const } },
      data: rows,
    }],
  };

  return (
    <>
      <div className="px-2 pt-2">
        <ReactECharts option={option} style={{ height: 280, width: "100%" }} notMerge />
      </div>
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-txt-muted leading-tight">
          Share of the concentrate deviation for the period
        </p>
      </div>
    </>
  );
}
