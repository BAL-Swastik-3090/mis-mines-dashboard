"use client";
/**
 * Production against quality, furnace by furnace — tonnes made and how they assayed.
 *
 * BARS FOR TONNES, A LINE FOR THE ASSAY, ON TWO AXES. Production is a sum and
 * quality is a weighted mean; they are different kinds of quantity and their
 * ranges are unrelated — tonnes in the hundreds against Cr% in a 47–54 band. On
 * one axis the assay flattens into a straight line at the bottom. As two lines
 * on two axes, a reader is invited to compare the shapes as though they shared
 * a scale. Bars read as "how much" and a line reads as "what level", which is
 * the distinction being drawn.
 *
 * WHY BOTH IN ONE CHART AT ALL: a dip to 47% on a 335 t day and the same dip on
 * a 40 t day are not the same event, and nobody can tell which they are looking
 * at from a quality line alone.
 *
 * THE SAME REQUEST THE MIS PLANT OUTPUT TABLE MAKES, under the same query key,
 * so whichever is on screen first pays for it and the other reads the cache.
 * Deriving these averages from a second endpoint is how two screens come to
 * disagree about one assay.
 *
 * WEIGHTED BY YIELD, exactly as the table's footer is:
 *
 *     avg = Σ(yield × value) / Σ(yield), over rows that carry a value
 *
 * Verified against the mine's own worked example for 31.10.2026 — Balasore
 * F1–F5, 335.00 t, Cr 52.43037582% — which this reproduces to eight decimals.
 *
 * THE FURNACE LIST FOLLOWS THE PLANT, because both plants have a furnace coded
 * F1 in SAP and there is no F6 anywhere in it. A flat F1–F6 list would offer
 * one entry meaning two different furnaces; picking the plant first removes the
 * ambiguity and keeps every name matching SAP.
 *
 * SUKINDA PRODUCES BUT IS NOT PLOTTED FOR QUALITY. It files its composite as the
 * literal identity 'COMPOSITE METAL' with no date in it, and has 29 chromium
 * readings against 601 production days — nothing at all between May and August.
 * Its tonnage is in the bars; the line covers assayed tonnage only, and the
 * coverage figure under the chart says what share that is. An average over part
 * of the output is a different claim from one over all of it.
 */
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Factory } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface Row {
  date: string;
  plant: string;
  plant_label: string;
  furnace: string;
  yield_t: number;
  taps: number;
  cr: number | null;
  si: number | null;
  c: number | null;
  p: number | null;
  s: number | null;
}
interface Plant { key: string; label: string }
interface Resp { from: string; to: string; plants: Plant[]; rows: Row[] }

/** Which analysis, and how it is written. Cr first: it is the figure that gets
 *  argued about, and the only one measured on nearly every furnace-day. */
const PARAMS = [
  { key: "cr" as const, title: "Cr%", dp: 2 },
  { key: "si" as const, title: "Si%", dp: 2 },
  { key: "c"  as const, title: "C%",  dp: 2 },
  { key: "p"  as const, title: "P%",  dp: 4 },
  { key: "s"  as const, title: "S%",  dp: 4 },
];
type ParamKey = (typeof PARAMS)[number]["key"];

const BAL = "1100";
const SUK = "1110";
const ALL = "ALL";

/* WARM BARS, COOL LINE. The bars were a pale blue-grey, which is the same
   family as the page's steel and navy and sat too close to the teal line —
   two cool tones competing at similar lightness. A warm sand is the opposite
   side of the wheel from the teal, so the line separates from the tonnage at
   a glance, and it stays light enough to read as background rather than as a
   second subject. */
const BAR  = "#f0dcb4";
const BAR_HI = "#e3c88e";   // hover only
const LINE = "#15a0a0";   // the same teal the plant's assay carries elsewhere

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")} ${
    d.toLocaleString("en-GB", { month: "short" })}`;
}

export default function PlantOutputTrendChart({ from, to }: {
  /** The report's own window, so this agrees with the tables above it. */
  from?: string;
  to?: string;
}) {
  const [loc, setLoc] = useState<string>(ALL);
  /* A LIST, NOT ONE CHOICE. The question asked of this chart is usually about
     a few furnaces together — F1 and F2 against the rest — so the selection is
     a set. Empty means every furnace the location has, which is also what the
     chart opens on. Keyed "plant:furnace" because both plants have an F1. */
  const [picked, setPicked] = useState<string[]>([]);
  const [param, setParam] = useState<ParamKey>("cr");

  const { data, isLoading } = useQuery<Resp>({
    // Identical to the MIS Plant Output table's key, deliberately.
    queryKey: ["plant-output", from, to],
    queryFn: async () =>
      (await api.get("/plant-output", {
        params: { from_date: from, to_date: to },
      })).data,
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(from && to),
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  /* WHICH FURNACES THE CHOSEN PLANT ACTUALLY HAS, read from the data rather
     than hardcoded — a sixth furnace at Balasore would appear here the day it
     starts confirming, and a furnace that never ran in this window does not
     offer an option that draws an empty chart. */
  const groups = useMemo(() => {
    const plants = loc === ALL ? [BAL, SUK] : [loc];
    return plants.map((k) => ({
      plant: k,
      label: data?.plants.find((x) => x.key === k)?.label ?? k,
      furnaces: Array.from(new Set(
        rows.filter((r) => r.plant === k).map((r) => r.furnace))).sort(),
    })).filter((g) => g.furnaces.length > 0);
  }, [rows, loc, data]);

  const available = useMemo(
    () => groups.flatMap((g) => g.furnaces.map((f) => `${g.plant}:${f}`)),
    [groups]);

  /* Changing plant can strand a selection on a furnace that plant does not
     have, which would otherwise silently draw an empty chart. Pruned on read
     rather than in an effect, so the chart and the chips never disagree about
     what is selected even for one render. */
  const sel = useMemo(
    () => picked.filter((k) => available.includes(k)), [picked, available]);

  const toggle = (k: string) => setPicked((cur) => {
    const now = cur.filter((x) => available.includes(x));
    return now.includes(k) ? now.filter((x) => x !== k) : [...now, k];
  });

  const filtered = useMemo(() => {
    let out = rows;
    if (loc !== ALL) out = out.filter((r) => r.plant === loc);
    /* Nothing picked means every furnace of the chosen location, not none. */
    if (sel.length) out = out.filter((r) => sel.includes(`${r.plant}:${r.furnace}`));
    return out;
  }, [rows, loc, sel]);

  const p = PARAMS.find((x) => x.key === param)!;

  const series = useMemo(() => {
    const days = Array.from(new Set(filtered.map((r) => r.date))).sort();
    const yieldT: number[] = [];
    const value: (number | null)[] = [];
    let covered = 0, total = 0;
    for (const d of days) {
      const g = filtered.filter((r) => r.date === d);
      /* EVERY tonne the selection produced — assayed or not. Dropping the
         unassayed rows here would under-report production, which is the one
         figure on this chart that is complete. */
      const y = g.reduce((s, r) => s + r.yield_t, 0);
      yieldT.push(Math.round(y * 100) / 100);
      total += y;
      let num = 0, den = 0;
      for (const r of g) {
        const v = r[p.key];
        if (v != null && r.yield_t > 0) { num += v * r.yield_t; den += r.yield_t; }
      }
      covered += den;
      value.push(den ? num / den : null);
    }
    /* The period average is taken on the totals, never as a mean of the daily
       means: a 40 t day would otherwise weigh the same as a 335 t one. */
    let pnum = 0, pden = 0;
    for (const r of filtered) {
      const v = r[p.key];
      if (v != null && r.yield_t > 0) { pnum += v * r.yield_t; pden += r.yield_t; }
    }
    return {
      days, yieldT, value,
      periodAvg: pden ? pnum / pden : null,
      periodYield: Math.round(total * 100) / 100,
      coveredPct: total ? (covered / total) * 100 : 0,
    };
  }, [filtered, p]);

  const present = series.value.filter((v): v is number => v != null);
  const lo = present.length ? Math.min(...present) : 0;
  const hi = present.length ? Math.max(...present) : 1;
  const pad = Math.max((hi - lo) * 0.2, p.dp === 4 ? 0.002 : 0.5);

  const option = {
    backgroundColor: "transparent",
    grid: { top: 34, right: 8, bottom: 52, left: 8, containLabel: true },
    legend: {
      top: 0, left: 0, itemWidth: 12, itemHeight: 12, itemGap: 18,
      textStyle: { fontSize: 11, color: "#4a5a76", fontFamily: "IBM Plex Sans" },
      data: ["Yield (t)", p.title],
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f1c35", borderColor: "#2c4a7c", borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(ps: Array<{ axisValue: string; seriesName: string;
                            value: number | null; color: string }>) {
        const head = `<div style="font-weight:700;margin-bottom:4px;color:#c8d8f0">`
          + `${ps[0]?.axisValue ?? ""}</div>`;
        return head + ps.map((x) => {
          const v = x.value == null
            ? "not assayed"
            : x.seriesName === "Yield (t)"
              ? `${formatIndian(Number(x.value), 2)} t`
              : Number(x.value).toFixed(p.dp) + "%";
          return `<div style="font-family:'IBM Plex Mono'">`
            + `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;`
            + `background:${x.color};margin-right:6px"></span>`
            + `${x.seriesName}: ${v}</div>`;
        }).join("");
      },
    },
    xAxis: {
      type: "category",
      data: series.days.map(dayLabel),
      axisLabel: { fontSize: 10, color: "#8899bb", rotate: 45,
                   fontFamily: "IBM Plex Mono" },
      axisLine: { lineStyle: { color: "#d0d9e8" } },
      axisTick: { show: false },
    },
    /* NO AXIS NAMES. They would read "Yield (t)" and "Cr%" — the same two
       strings the legend already carries, and an axis name sits in the same
       top corner the legend does, so the two print on top of each other. The
       legend keeps them, since it also carries the colour that says which
       series belongs to which side. */
    yAxis: [
      {
        type: "value",
        axisLabel: { fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono" },
        splitLine: { lineStyle: { color: "#eef2f8" } },
      },
      {
        type: "value",
        min: Number((lo - pad).toFixed(4)),
        max: Number((hi + pad).toFixed(4)),
        axisLabel: { fontSize: 10, color: "#15a0a0", fontFamily: "IBM Plex Mono",
                     formatter: (v: number) => v.toFixed(p.dp === 4 ? 3 : 1) },
        splitLine: { show: false },
      },
    ],
    series: [
      { name: "Yield (t)", type: "bar", yAxisIndex: 0, data: series.yieldT,
        barMaxWidth: 22,
        itemStyle: { color: BAR, borderRadius: [2, 2, 0, 0] },
        emphasis: { itemStyle: { color: BAR_HI } } },
      /* A GAP IS A GAP. connectNulls would draw a straight run between two real
         readings and invite somebody to read a trend off pure interpolation. */
      { name: p.title, type: "line", yAxisIndex: 1, data: series.value,
        connectNulls: false, symbol: "circle", symbolSize: 6, z: 3,
        lineStyle: { width: 2, color: LINE }, itemStyle: { color: LINE } },
    ],
  };

  const SEL = "text-[11px] border border-border rounded px-2 py-1 bg-white "
    + "text-txt-primary focus:outline-none focus:border-steel";

  /** On and off have to be told apart at a glance, not by a tick in a list. */
  const chip = (on: boolean) =>
    `text-[11px] px-2 py-1 rounded border transition-colors ${
      on ? "border-steel bg-[#eef3fb] text-navy font-bold"
         : "border-border bg-white text-txt-secondary hover:bg-bg-light"}`;

  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-steel"><Factory size={14} /></span>
        <h3 className="font-condensed font-bold text-[13px] text-navy
                       tracking-widest uppercase">
          Plant Output Quality Trend
        </h3>
      </div>

      <div className="bg-white rounded-lg border border-border shadow-sm p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <label className="text-[10px] font-condensed font-bold tracking-widest
                            uppercase text-txt-secondary">Location</label>
          <select className={SEL} value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value={ALL}>Both plants</option>
            <option value={BAL}>Balasore</option>
            <option value={SUK}>Sukinda</option>
          </select>

          {/* FURNACES ARE CHIPS, NOT A DROPDOWN. Any combination is valid —
              F1 and F2 against the rest is the usual question — and a list
              where each item is visibly on or off says what is selected
              without being opened. There are at most six. */}
          <label className="text-[10px] font-condensed font-bold tracking-widest
                            uppercase text-txt-secondary ml-2">Furnace</label>
          <button type="button" onClick={() => setPicked([])} className={chip(!sel.length)}>
            All
          </button>
          {groups.map((g) => (
            <span key={g.plant} className="flex items-center gap-1">
              {/* Named only when both plants are in play, because then "F1"
                  alone would not say whose. */}
              {groups.length > 1 && (
                <span className="text-[10px] text-txt-light ml-1">{g.label}</span>
              )}
              {g.furnaces.map((f) => {
                const k = `${g.plant}:${f}`;
                return (
                  <button key={k} type="button" onClick={() => toggle(k)}
                          className={chip(sel.includes(k))}>{f}</button>
                );
              })}
            </span>
          ))}

          {/* The analysis is a switch, not five lines: P and S sit near 0.03
              while Cr sits near 52, so drawn together the low ones collapse
              onto the axis. */}
          <div className="ml-auto flex items-center gap-1">
            {PARAMS.map((x) => (
              <button key={x.key} type="button" onClick={() => setParam(x.key)}
                className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                  x.key === param
                    ? "border-[#15a0a0] bg-[#e6f6f6] text-[#0f7272] font-bold"
                    : "border-border bg-white text-txt-secondary hover:bg-bg-light"}`}>
                {x.title}
              </button>
            ))}
          </div>
        </div>

        {/* ABOVE THE CHART, NOT UNDER IT. Somebody who selects Sukinda and
            finds no line needs to know why BEFORE they read the picture —
            a caveat printed below the figure is reached only by a reader who
            already drew their own conclusion from it. */}
        {(loc === SUK || loc === ALL) && !isLoading && data && (
          <p className="mb-3 text-[10px] text-txt-light leading-relaxed">
            <span className="font-semibold">Sukinda files no regular composite
            analysis</span>
            {loc === SUK
              ? <> — its tonnage is shown, but there is no chemistry to plot,
                  so no {p.title} line appears.</>
              : <> — its tonnage is in the bars, but it contributes no chemistry,
                  so the {p.title} line covers Balasore&apos;s output only.</>}
          </p>
        )}

        {isLoading || !data ? (
          <div className="h-[300px] bg-bg-section animate-pulse rounded" />
        ) : series.days.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center
                          text-[12px] text-txt-light">
            No production for this selection in the period.
          </div>
        ) : (
          <ReactECharts option={option} style={{ height: 300, width: "100%" }} notMerge />
        )}

        {/* WHAT THE AVERAGE COVERS, under the figure rather than in a footnote
            somewhere else: a reader who takes the number and leaves still sees
            it. The same disclosure the table's footer carries. */}
        {!isLoading && data && series.days.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-light flex flex-wrap
                          items-center gap-x-4 gap-y-1 text-[10px] text-txt-light">
            <span className="tabular-nums">
              Period yield{" "}
              <span className="font-bold text-txt-secondary">
                {formatIndian(series.periodYield, 2)} t
              </span>
            </span>
            <span className="tabular-nums">
              Weighted {p.title}{" "}
              <span className="font-bold text-[#0f7272]">
                {series.periodAvg == null ? "—" : series.periodAvg.toFixed(p.dp)}
              </span>
            </span>
            <span className="tabular-nums">
              assayed share of tonnage {series.coveredPct.toFixed(1)}%
            </span>
            <span className="ml-auto">
              Averages weighted by yield · analysis is the day&apos;s composite sample
            </span>
          </div>
        )}

      </div>
    </section>
  );
}
