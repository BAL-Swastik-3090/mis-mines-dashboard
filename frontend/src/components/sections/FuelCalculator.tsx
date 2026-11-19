"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, Loader2, RotateCcw, Sparkles, Truck,
         AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, Chip } from "@/components/minehub/ui";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

/**
 * The diesel calculator: how much of the plan the diesel can carry.
 *
 * The mine's own workbook (Diesel_Stock_Monitoring.xlsx) asks a better
 * question than "when does the tank run dry": HOW MUCH PRODUCTION CAN THE
 * DIESEL WE HAVE SUPPORT, and what has to arrive, by when, to run the whole
 * plan. This is that workbook, worked day by day in the browser:
 *
 *   available  = opening + tanker × yield − dead stock
 *   needed     = (ore t ÷ t per Cum + OB Cum) × litres per Cum
 *   supported  = min(1, available ÷ needed)           -- share of the plan
 *   closing    = opening + tanker × yield − what was actually burnt
 *
 * Every input starts at what SAP and the production records MEASURED --
 * the workbook types 2 L/Cum and 2.5 t/Cum by hand; the mine actually ran at
 * whatever the last thirty days say -- and every input can be changed. Nothing
 * here is saved: it is a what-if, not a record.
 */
interface CalcData {
  plant: string; name: string; ready: boolean; as_on: string; days: number;
  opening_l: number; dead_stock_l: number; capacity_l: number | null;
  reorder_l: number | null; min_l: number | null;
  burn_per_day_l: number; consumed_l: number; burn_window_days: number;
  rhythm: { arrivals: number; avg_arrival_l: number | null; every_days: number | null;
            last_arrival: string | null; next_expected: string | null;
            yield: number | null };
  receipts: { day: string; litres: number }[];
  production: null | {
    ore_t_per_cum: number;
    actual: null | { ore_mt: number; ore_cum: number; ob_cum: number; silt_cum: number;
                     total_cum: number; per_day_cum: number; l_per_cum: number | null };
    plan: { day: string; ore_mt: number; ob_cum: number }[];
  };
  inbound_open_l: number;
}

interface Inputs {
  horizon: number;
  opening: number; dead: number; capacity: number;     // capacity 0 = no limit
  basis: "plan" | "burn";
  lPerCum: number; tPerCum: number; planPct: number;
  burn: number;
  tanker: number; every: number; next: string; yieldPct: number;
  leadDays: number;
}

interface Row {
  day: string; opening: number; receipt: number; overflow: number;
  available: number; needed: number; supported: number; burnt: number;
  closing: number; shortL: number;
  oreMt: number; obCum: number; supOreMt: number; supObCum: number;
  scheduled: boolean; extra: boolean; skipped: boolean;
}

const L = (n: number) => Math.round(n).toLocaleString("en-IN");
const short = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const wk = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 864e5);

function liveInputs(c: CalcData): Inputs {
  const a = c.production?.actual;
  const hasPlan = !!c.production && (c.production.plan.length > 0 || !!a?.per_day_cum);
  return {
    horizon: 14,
    opening: Math.round(c.opening_l),
    dead: Math.round(c.dead_stock_l),
    capacity: Math.round(c.capacity_l ?? 0),
    basis: hasPlan && a?.l_per_cum ? "plan" : "burn",
    lPerCum: a?.l_per_cum ?? 2,
    tPerCum: c.production?.ore_t_per_cum ?? 3,
    planPct: 100,
    burn: Math.round(c.burn_per_day_l),
    tanker: Math.round(c.rhythm.avg_arrival_l ?? 18000),
    every: Math.max(1, Math.round(c.rhythm.every_days ?? 5)),
    next: c.rhythm.next_expected ?? addDays(c.as_on, 1),
    yieldPct: Math.round((c.rhythm.yield ?? 1) * 100),
    leadDays: 2,
  };
}

/** Work the days out. Pure, so the auto-planner can call it again. */
function simulate(c: CalcData, x: Inputs, extra: Record<string, number>,
                  skipped: Set<string>): Row[] {
  const plan = new Map((c.production?.plan ?? []).map((p) => [p.day, p]));
  const fallbackCum = c.production?.actual?.per_day_cum ?? 0;
  const rows: Row[] = [];
  let level = x.opening;
  for (let n = 1; n <= x.horizon; n++) {
    const day = addDays(c.as_on, n);
    const sinceNext = daysBetween(x.next, day);
    const scheduled = sinceNext >= 0 && x.every > 0 && sinceNext % x.every === 0;
    const isSkipped = skipped.has(day);
    const extraL = extra[day] ?? 0;
    const gross = ((scheduled && !isSkipped) ? x.tanker : 0) + extraL;
    let receipt = gross * x.yieldPct / 100;
    let overflow = 0;
    if (x.capacity > 0 && level + receipt > x.capacity) {
      overflow = level + receipt - x.capacity;
      receipt -= overflow;
    }
    const opening = level;
    const available = Math.max(opening + receipt - x.dead, 0);

    let oreMt = 0, obCum = 0, needed: number;
    if (x.basis === "plan" && c.production) {
      const p = plan.get(day);
      const k = x.planPct / 100;
      if (p) { oreMt = p.ore_mt * k; obCum = p.ob_cum * k; }
      else { obCum = fallbackCum * k; }        // no plan row: last month's pace
      needed = (oreMt / x.tPerCum + obCum) * x.lPerCum;
    } else {
      needed = x.burn * x.planPct / 100;
    }
    const supported = needed > 0 ? Math.min(1, available / needed) : 1;
    const burnt = Math.min(needed, available);
    level = opening + receipt - burnt;
    rows.push({
      day, opening, receipt, overflow, available, needed, supported, burnt,
      closing: level, shortL: Math.max(needed - available, 0),
      oreMt, obCum, supOreMt: oreMt * supported, supObCum: obCum * supported,
      scheduled, extra: extraL > 0, skipped: isSkipped,
    });
  }
  return rows;
}

function Num({ id, label, value, onChange, unit, step = 1, hint, measured }: {
  id: string; label: string; value: number; onChange: (v: number) => void;
  unit?: string; step?: number; hint?: string; measured?: number | null;
}) {
  const changed = measured !== undefined && measured !== null
    && Math.abs(measured - value) > step / 2;
  return (
    <label htmlFor={id} className="block">
      <span className="flex items-center justify-between gap-2 text-[10.5px] font-semibold
                       text-txt-secondary uppercase tracking-wide">
        {label}
        {changed && (
          <button type="button" onClick={(e) => { e.preventDefault(); onChange(measured!); }}
                  className="normal-case tracking-normal font-medium text-sky hover:underline">
            measured {measured!.toLocaleString("en-IN")}
          </button>
        )}
      </span>
      <span className={`mt-1 flex items-center rounded-lg border bg-bg-base transition-colors
                        ${changed ? "border-gold" : "border-border"} focus-within:border-navy`}>
        <input id={id} type="number" step={step} value={Number.isFinite(value) ? value : 0}
               onChange={(e) => onChange(Number(e.target.value))}
               className="w-full bg-transparent px-2.5 py-1.5 text-[13px] font-semibold
                          tabular-nums text-navy outline-none" />
        {unit && <span className="pr-2.5 text-[10.5px] text-txt-light whitespace-nowrap">{unit}</span>}
      </span>
      {hint && <span className="block mt-0.5 text-[10px] text-txt-light leading-snug">{hint}</span>}
    </label>
  );
}

export default function FuelCalculator({ plant }: { plant: string }) {
  const [c, setC] = useState<CalcData | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [x, setX] = useState<Inputs | null>(null);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setBusy(true); setFailed(false);
    api.get(`/fuel-management/stock/${plant}/calculator`, { params: { days: 30 } })
      .then((r) => {
        if (!alive) return;
        const data: CalcData = r.data;
        if (!data?.ready) { setFailed(true); return; }
        setC(data); setX(liveInputs(data)); setExtra({}); setSkipped(new Set());
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [plant]);

  const set = useCallback(<K extends keyof Inputs>(k: K, v: Inputs[K]) =>
    setX((p) => (p ? { ...p, [k]: v } : p)), []);

  const rows = useMemo(() => (c && x ? simulate(c, x, extra, skipped) : []),
                       [c, x, extra, skipped]);

  const summary = useMemo(() => {
    if (!rows.length || !x) return null;
    const needed = rows.reduce((s, r) => s + r.needed, 0);
    const burnt = rows.reduce((s, r) => s + r.burnt, 0);
    const shortL = rows.reduce((s, r) => s + r.shortL, 0);
    const firstShort = rows.find((r) => r.supported < 0.999);
    const planOre = rows.reduce((s, r) => s + r.oreMt, 0);
    const planOb = rows.reduce((s, r) => s + r.obCum, 0);
    const supOre = rows.reduce((s, r) => s + r.supOreMt, 0);
    const supOb = rows.reduce((s, r) => s + r.supObCum, 0);
    const received = rows.reduce((s, r) => s + r.receipt, 0);
    const overflow = rows.reduce((s, r) => s + r.overflow, 0);
    const perTanker = x.tanker * x.yieldPct / 100;
    return {
      needed, burnt, shortL, firstShort, planOre, planOb, supOre, supOb,
      received, overflow,
      pct: needed > 0 ? burnt / needed : 1,
      tankersShort: perTanker > 0 ? Math.ceil(shortL / perTanker) : 0,
      orderBy: firstShort ? addDays(firstShort.day, -x.leadDays) : null,
      end: rows[rows.length - 1].closing,
    };
  }, [rows, x]);

  /** Add tankers, earliest short day first, until the plan runs in full. */
  const autoPlan = useCallback(() => {
    if (!c || !x) return;
    const ex = { ...extra };
    for (let i = 0; i < 40; i++) {
      const r = simulate(c, x, ex, skipped).find((q) => q.supported < 0.999);
      if (!r) break;
      // Land it on the short day itself; earlier wastes tank space.
      ex[r.day] = (ex[r.day] ?? 0) + x.tanker;
    }
    setExtra(ex);
  }, [c, x, extra, skipped]);

  const toggleDay = useCallback((r: Row) => {
    if (!x) return;
    if (r.extra) {
      setExtra((p) => { const q = { ...p }; delete q[r.day]; return q; });
    } else if (r.scheduled && !r.skipped) {
      setSkipped((p) => new Set(p).add(r.day));
    } else if (r.skipped) {
      setSkipped((p) => { const q = new Set(p); q.delete(r.day); return q; });
    } else {
      setExtra((p) => ({ ...p, [r.day]: x.tanker }));
    }
  }, [x]);

  const chart = useMemo(() => {
    if (!rows.length || !x) return null;
    return {
      grid: { left: 52, right: 16, top: 30, bottom: 44 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number | null) =>
          v === null || v === undefined ? "—" : `${Math.round(v).toLocaleString("en-IN")} L`,
      },
      legend: {
        data: ["Needed", "Can be burnt", "In tank at close", "Tanker"],
        bottom: 0, itemWidth: 12, itemHeight: 8,
        textStyle: { fontSize: 10, color: "#64748b" },
      },
      xAxis: {
        type: "category", data: rows.map((r) => short(r.day)),
        axisLabel: { fontSize: 9, color: "#94a3b8" },
        axisLine: { lineStyle: { color: "#e2e8f0" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { fontSize: 9, color: "#94a3b8",
          formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)) },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
      },
      animationDuration: 500,
      series: [
        { name: "Needed", type: "bar", data: rows.map((r) => Math.round(r.needed)),
          barGap: "-100%", barMaxWidth: 22,
          itemStyle: { color: "rgba(225,29,72,0.18)", borderRadius: [3, 3, 0, 0] } },
        { name: "Can be burnt", type: "bar", data: rows.map((r) => Math.round(r.burnt)),
          barMaxWidth: 22,
          itemStyle: { color: "#10b981", borderRadius: [3, 3, 0, 0] } },
        { name: "In tank at close", type: "line", data: rows.map((r) => Math.round(r.closing)),
          symbol: "circle", symbolSize: 4, smooth: false,
          lineStyle: { width: 2.2, color: "#1e3a5f" }, itemStyle: { color: "#1e3a5f" },
          markLine: x.dead > 0 ? {
            symbol: "none", silent: true,
            data: [{ yAxis: x.dead, lineStyle: { color: "#f59e0b", type: "dotted", width: 1.5 },
                     label: { formatter: "dead stock", fontSize: 9, color: "#b45309",
                              position: "insideStartTop" } }],
          } : undefined },
        { name: "Tanker", type: "scatter",
          data: rows.map((r) => (r.receipt > 0 ? Math.round(r.receipt) : null)),
          symbol: "triangle", symbolSize: 10, itemStyle: { color: "#0ea5e9" } },
      ],
    };
  }, [rows, x]);

  if (busy) {
    return (
      <Card>
        <CardHeader icon={Calculator} tone="gold" title="Diesel calculator" />
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>
      </Card>
    );
  }
  if (failed || !c || !x || !summary) {
    return (
      <Card>
        <CardHeader icon={Calculator} tone="gold" title="Diesel calculator"
                    subtitle="The starting figures for this plant could not be read. Try again in a minute." />
      </Card>
    );
  }

  const live = liveInputs(c);
  const prod = c.production;
  const hasProd = !!prod && x.basis === "plan";
  const ok = summary.shortL < 1;
  const shown = showAll ? rows : rows.slice(0, Math.min(rows.length, 14));
  const scenario = (patch: Partial<Inputs>) => setX({ ...x, ...patch });

  return (
    <Card>
      <CardHeader
        icon={Calculator} tone="gold"
        title={`Diesel calculator — ${c.name}`}
        subtitle={hasProd
          ? "How much of the production plan the diesel can carry, day by day, and what has to arrive to run all of it. Every figure starts at what was measured; change any of them."
          : "How long the diesel lasts at the rate it is being used, and what has to arrive to keep it running. Every figure starts at what was measured; change any of them."}
        actions={
          <button type="button"
                  onClick={() => { setX(live); setExtra({}); setSkipped(new Set()); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5
                             text-[11.5px] font-semibold text-txt-secondary hover:border-gold hover:text-navy
                             transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /> Back to live figures
          </button>
        }
      />

      {/* ── The answer first ─────────────────────────────────────────── */}
      <div className={`mx-5 mt-1 rounded-xl border px-4 py-3 flex flex-wrap items-start gap-3
                       transition-colors duration-300
                       ${ok ? "border-emerald/40 bg-emerald/5" : "border-rose/40 bg-rose/5"}`}>
        {ok ? <CheckCircle2 className="w-5 h-5 text-emerald shrink-0 mt-0.5" />
            : <AlertTriangle className="w-5 h-5 text-rose shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-navy text-balance">
            {ok
              ? `The diesel carries the whole ${hasProd ? "plan" : "requirement"} for the next ${x.horizon} days.`
              : `Diesel runs short on ${short(summary.firstShort!.day)} — ${L(summary.shortL)} L short over ${x.horizon} days.`}
          </p>
          <p className="mt-0.5 text-[12px] text-txt-muted leading-relaxed">
            {ok
              ? <>Closing stock on {short(rows[rows.length - 1].day)}: <b className="text-navy">{L(summary.end)} L</b>
                  {summary.overflow > 0 && <> · {L(summary.overflow)} L would not fit in the tank</>}.</>
              : <>To run it in full: <b className="text-navy">{summary.tankersShort} more tanker{summary.tankersShort === 1 ? "" : "s"}</b>
                  {" "}of {L(x.tanker)} L, the first landing by <b className="text-navy">{short(summary.firstShort!.day)}</b>
                  {summary.orderBy && <> — arrange it by <b className="text-rose">{short(summary.orderBy)}</b> at {x.leadDays} days&rsquo; lead</>}.</>}
          </p>
        </div>
        {!ok && (
          <button type="button" onClick={autoPlan}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-[12px]
                             font-semibold text-white hover:bg-navy/90 active:scale-[0.98] transition">
            <Sparkles className="w-3.5 h-3.5" /> Plan the tankers for me
          </button>
        )}
      </div>

      {/* ── Headline figures ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 pt-4">
        {[
          { k: hasProd ? "Plan the diesel carries" : "Requirement covered",
            v: `${Math.round(summary.pct * 100)}%`,
            tone: summary.pct >= 0.999 ? "text-emerald" : summary.pct >= 0.8 ? "text-amber" : "text-rose",
            bar: summary.pct },
          { k: "Diesel needed", v: `${L(summary.needed)} L`, sub: `${x.horizon} days` },
          { k: "Arriving", v: `${L(summary.received)} L`,
            sub: `${rows.filter((r) => r.receipt > 0).length} tanker${rows.filter((r) => r.receipt > 0).length === 1 ? "" : "s"}` },
          hasProd
            ? { k: "Production supported",
                v: `${L(summary.supOre)} t ore`,
                sub: `${L(summary.supOb)} Cum OB · plan ${L(summary.planOre)} t / ${L(summary.planOb)} Cum` }
            : { k: "Closing stock", v: `${L(summary.end)} L`, sub: short(rows[rows.length - 1].day) },
        ].map((t) => (
          <div key={t.k} className="rounded-xl border border-border-light px-3.5 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-txt-light">{t.k}</p>
            <p className={`mt-0.5 text-[18px] font-bold tabular-nums ${t.tone ?? "text-navy"}`}>{t.v}</p>
            {"bar" in t && t.bar !== undefined ? (
              <span className="mt-1.5 block h-1.5 rounded-full bg-bg-soft overflow-hidden">
                <span className={`block h-full rounded-full transition-all duration-500
                                  ${t.bar >= 0.999 ? "bg-emerald" : t.bar >= 0.8 ? "bg-amber" : "bg-rose"}`}
                      style={{ width: `${Math.round(t.bar * 100)}%` }} />
              </span>
            ) : t.sub ? <p className="text-[10.5px] text-txt-muted truncate">{t.sub}</p> : null}
          </div>
        ))}
      </div>

      {/* ── One-click what-ifs ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 px-5 pt-4">
        <span className="text-[11px] font-semibold text-txt-secondary mr-1">What if</span>
        {[
          { t: "One more tanker tomorrow", f: () => setExtra((p) => {
              const d = addDays(c.as_on, 1); return { ...p, [d]: (p[d] ?? 0) + x.tanker }; }) },
          { t: "Next tanker does not come", f: () => {
              const r = rows.find((q) => q.scheduled && !q.skipped);
              if (r) setSkipped((p) => new Set(p).add(r.day)); } },
          { t: "Tankers a day late", f: () => scenario({ next: addDays(x.next, 1) }) },
          ...(hasProd || x.basis === "burn" ? [
            { t: "Plan +10%", f: () => scenario({ planPct: x.planPct + 10 }) },
            { t: "Plan −10%", f: () => scenario({ planPct: Math.max(10, x.planPct - 10) }) },
          ] : []),
          ...(prod ? [{ t: "The workbook's factors", f: () => scenario({
              basis: "plan", lPerCum: 2, tPerCum: 2.5, yieldPct: 90 }) }] : []),
        ].map((s) => (
          <button key={s.t} type="button" onClick={s.f}
                  className="px-2.5 py-1 rounded-full border border-border bg-bg-base text-[11.5px]
                             font-medium text-txt-secondary hover:border-gold hover:text-navy
                             active:scale-[0.97] transition">
            {s.t}
          </button>
        ))}
      </div>

      <div className="grid gap-5 px-5 py-4 lg:grid-cols-[320px_1fr]">
        {/* ── Inputs ─────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-bold text-navy mb-2">Look ahead</p>
            <div className="flex gap-1">
              {[7, 14, 21, 30].map((h) => (
                <button key={h} type="button" onClick={() => set("horizon", h)}
                        className={`flex-1 rounded-lg border py-1.5 text-[12px] font-semibold transition-colors
                                    ${x.horizon === h ? "bg-navy text-white border-navy"
                                      : "border-border text-txt-secondary hover:border-gold"}`}>
                  {h} days
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-navy mb-2">The tank</p>
            <div className="grid grid-cols-2 gap-2.5">
              <Num id="calc-opening" label="In tank now" unit="L" value={x.opening}
                   measured={live.opening} onChange={(v) => set("opening", v)} step={100} />
              <Num id="calc-dead" label="Dead stock" unit="L" value={x.dead}
                   measured={live.dead} onChange={(v) => set("dead", v)} step={100} />
              <Num id="calc-cap" label="Tank holds" unit="L" value={x.capacity}
                   measured={live.capacity} onChange={(v) => set("capacity", v)} step={1000}
                   hint={x.capacity ? undefined : "0 = no limit"} />
              <Num id="calc-lead" label="Lead time" unit="days" value={x.leadDays}
                   onChange={(v) => set("leadDays", Math.max(0, v))} />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-navy mb-2">Supply</p>
            <div className="grid grid-cols-2 gap-2.5">
              <Num id="calc-tanker" label="Each tanker" unit="L" value={x.tanker}
                   measured={live.tanker} onChange={(v) => set("tanker", v)} step={500} />
              <Num id="calc-every" label="Every" unit="days" value={x.every}
                   measured={live.every} onChange={(v) => set("every", Math.max(1, v))} />
              <Num id="calc-yield" label="Received" unit="% of challan" value={x.yieldPct}
                   measured={live.yieldPct} onChange={(v) => set("yieldPct", v)}
                   hint="The workbook assumes 90%" />
              <label htmlFor="calc-next" className="block">
                <span className="text-[10.5px] font-semibold text-txt-secondary uppercase tracking-wide">
                  Next tanker
                </span>
                <input id="calc-next" type="date" value={x.next}
                       onChange={(e) => e.target.value && set("next", e.target.value)}
                       className="mt-1 w-full rounded-lg border border-border bg-bg-base px-2.5 py-1.5
                                  text-[12.5px] font-semibold text-navy outline-none focus:border-navy" />
              </label>
            </div>
            {c.rhythm.arrivals > 0 && (
              <p className="mt-1.5 text-[10.5px] text-txt-light leading-snug">
                Measured from {c.rhythm.arrivals} arrivals in SAP over 60 days; the last on {short(c.rhythm.last_arrival!)}.
              </p>
            )}
          </div>

          <div>
            <p className="text-[11px] font-bold text-navy mb-2">What the diesel is for</p>
            {prod && (
              <div className="flex gap-1 mb-2.5">
                {([["plan", "Production plan"], ["burn", "Usage rate"]] as const).map(([k, t]) => (
                  <button key={k} type="button" onClick={() => set("basis", k)}
                          className={`flex-1 rounded-lg border py-1.5 text-[12px] font-semibold transition-colors
                                      ${x.basis === k ? "bg-navy text-white border-navy"
                                        : "border-border text-txt-secondary hover:border-gold"}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              {hasProd ? <>
                <Num id="calc-lpc" label="Litres per Cum" value={x.lPerCum} step={0.05}
                     measured={live.lPerCum} onChange={(v) => set("lPerCum", v)}
                     hint="All diesel ÷ all Cum moved, last 30 days" />
                <Num id="calc-tpc" label="Ore t per Cum" value={x.tPerCum} step={0.05}
                     measured={live.tPerCum} onChange={(v) => set("tPerCum", v)} />
              </> : (
                <Num id="calc-burn" label="Usage" unit="L / day" value={x.burn}
                     measured={live.burn} onChange={(v) => set("burn", v)} step={50}
                     hint={`Average of the last ${c.burn_window_days} days`} />
              )}
              <Num id="calc-pct" label={hasProd ? "Plan at" : "Usage at"} unit="%" value={x.planPct}
                   measured={100} onChange={(v) => set("planPct", Math.max(0, v))} step={5} />
            </div>
            {hasProd && prod?.plan.length === 0 && (
              <p className="mt-1.5 text-[10.5px] text-amber leading-snug">
                No daily plan for these days — last month&rsquo;s pace is used instead.
              </p>
            )}
          </div>
        </div>

        {/* ── Chart and day table ─────────────────────────────────────── */}
        <div className="min-w-0 space-y-3">
          {chart && <ReactECharts option={chart} style={{ height: 230 }} notMerge
                                  opts={{ renderer: "canvas" }} />}
          <div className="overflow-x-auto rounded-xl border border-border-light">
            <table className="w-full min-w-[640px] text-[11.5px]">
              <thead className="bg-bg-soft text-[10px] uppercase tracking-wide text-txt-light">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Day</th>
                  <th className="px-2 py-2 text-right font-semibold">Opening</th>
                  <th className="px-2 py-2 text-center font-semibold">Tanker</th>
                  <th className="px-2 py-2 text-right font-semibold">Needed</th>
                  {hasProd && <th className="px-2 py-2 text-right font-semibold">Plan</th>}
                  <th className="px-2 py-2 text-left font-semibold w-[120px]">Carried</th>
                  <th className="px-3 py-2 text-right font-semibold">Closing</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const pct = Math.round(r.supported * 100);
                  return (
                    <tr key={r.day} className={`border-t border-border-light transition-colors
                                                ${r.supported < 0.999 ? "bg-rose/5" : ""}`}>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="font-semibold text-navy tabular-nums">{short(r.day)}</span>
                        <span className="ml-1.5 text-txt-light">{wk(r.day)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-txt-muted">{L(r.opening)}</td>
                      <td className="px-2 py-1.5 text-center">
                        {/* One click adds a tanker, removes one, or skips the expected one. */}
                        <button type="button" onClick={() => toggleDay(r)}
                                title={r.receipt > 0 ? "Click to take this tanker off" : r.skipped
                                  ? "Click to bring the expected tanker back" : "Click to add a tanker on this day"}
                                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums
                                            transition active:scale-95
                                            ${r.receipt > 0 ? (r.extra ? "bg-violet/15 text-violet font-semibold"
                                                                      : "bg-sky/15 text-sky font-semibold")
                                              : r.skipped ? "text-rose line-through"
                                              : "text-txt-light/60 hover:text-navy hover:bg-bg-soft"}`}>
                          <Truck className="w-3 h-3" />
                          {r.receipt > 0 ? `+${L(r.receipt)}` : r.skipped ? "skipped" : "+"}
                        </button>
                        {r.overflow > 0 && (
                          <span className="block text-[9.5px] text-amber">{L(r.overflow)} L won&rsquo;t fit</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-txt">{L(r.needed)}</td>
                      {hasProd && (
                        <td className="px-2 py-1.5 text-right tabular-nums text-txt-muted whitespace-nowrap">
                          {L(r.oreMt)} t · {L(r.obCum)} Cum
                        </td>
                      )}
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1.5">
                          <span className="h-1.5 flex-1 rounded-full bg-bg-soft overflow-hidden">
                            <span className={`block h-full rounded-full transition-all duration-500
                                              ${pct >= 100 ? "bg-emerald" : pct >= 60 ? "bg-amber" : "bg-rose"}`}
                                  style={{ width: `${pct}%` }} />
                          </span>
                          <span className={`w-9 text-right tabular-nums font-semibold
                                            ${pct >= 100 ? "text-emerald" : pct >= 60 ? "text-amber" : "text-rose"}`}>
                            {pct}%
                          </span>
                        </span>
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-semibold
                                      ${r.closing <= x.dead + 1 ? "text-rose" : "text-navy"}`}>
                        {L(r.closing)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-txt-light">
            <span className="flex flex-wrap items-center gap-2">
              <Chip tone="sky" dot={false}>expected</Chip>
              <Chip tone="violet" dot={false}>added</Chip>
              Click a day&rsquo;s tanker to add, remove or skip it.
            </span>
            {rows.length > 14 && (
              <button type="button" onClick={() => setShowAll((v) => !v)}
                      className="font-semibold text-sky hover:underline">
                {showAll ? "Show two weeks" : `Show all ${rows.length} days`}
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
