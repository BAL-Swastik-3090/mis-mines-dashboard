"use client";
import { Waves } from "lucide-react";
import { useDateFilter } from "@/contexts/useDateFilter";
import { useDewatering } from "@/hooks/useDewatering";
import { formatIndian, formatPct, pctBgClass } from "@/lib/utils";
import type {
  DewateringTodayKpi,
  DewateringMtdKpi,
  DewateringDayRow,
} from "@/types";

// ── Helpers ───────────────────────────────────────────────────

function tillLabel(apiTo: string): string {
  const d = new Date(apiTo + "T00:00:00");
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const yr  = d.getFullYear();
  return `${day}-${mon} ${yr}`;
}

function dateShort(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short",
  });
}

function Shimmer({ w = "w-24", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

// ── KPI card: Actual vs Plan (Daily & MTD) ────────────────────
interface PairCardProps {
  label:        string;
  sub?:         string;
  accentClass:  string;
  iconBg:       string;
  iconColor:    string;
  actual:       number | null;
  plan:         number | null;
  pct:          number | null;
  unit:         string;
  loading:      boolean;
  sourcePlan?:  string;
  sourceActual?: string;
}

function PairCard({
  label, sub, accentClass, iconBg, iconColor,
  actual, plan, pct, unit, loading,
  sourcePlan, sourceActual,
}: PairCardProps) {
  const variance = actual != null && plan != null ? actual - plan : null;

  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm ${accentClass} flex flex-col overflow-hidden`}>
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
        <div>
          <div className={`text-[11px] font-bold tracking-widest uppercase font-condensed ${iconColor}`}>
            {label}
          </div>
          {sub && (
            <div className="text-[10px] text-txt-light tracking-wider font-condensed uppercase mt-0.5">
              {sub}
            </div>
          )}
        </div>
        {loading ? (
          <Shimmer w="w-14" h="h-5" />
        ) : (
          <span className={pctBgClass(pct)}>{formatPct(pct)}</span>
        )}
      </div>

      <div className="px-4 pb-3 flex-1">
        {loading ? (
          <>
            <Shimmer w="w-32" h="h-8" />
            <div className="mt-1.5"><Shimmer w="w-44" h="h-3.5" /></div>
          </>
        ) : (
          <>
            <div className="font-condensed font-extrabold text-[26px] xl:text-[30px] text-navy tracking-tight leading-none">
              {formatIndian(actual)}
              <span className="text-xs font-normal text-txt-muted ml-1.5">{unit}</span>
            </div>
            <div className="text-[11px] text-txt-muted mt-1.5 flex items-center gap-2 flex-wrap">
              <span>Plan: <span className="text-txt-secondary font-semibold">{formatIndian(plan)}</span></span>
              {variance != null && (
                <>
                  <span className="text-border-strong">·</span>
                  <span>
                    Var:{" "}
                    <span className={variance >= 0 ? "text-success font-semibold" : "text-danger font-semibold"}>
                      {variance >= 0 ? "+" : ""}{formatIndian(variance)}
                    </span>
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {(sourcePlan || sourceActual) && (
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          {sourcePlan && (
            <p className="text-[9px] font-mono text-success/70 leading-tight">
              <span className="font-semibold text-success/60">PLAN · </span>{sourcePlan}
            </p>
          )}
          {sourceActual && (
            <p className="text-[9px] font-mono text-success/70 leading-tight">
              <span className="font-semibold text-success/60">ACTUAL · </span>{sourceActual}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── KPI card: Single value stat ───────────────────────────────
interface StatCardProps {
  label:        string;
  sub?:         string;
  accentClass:  string;
  valueColor:   string;
  value:        number | null;
  unit:         string;
  note?:        string | null;
  loading:      boolean;
  sourceActual?: string;
}

function StatCard({
  label, sub, accentClass, valueColor,
  value, unit, note, loading,
  sourceActual,
}: StatCardProps) {
  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm ${accentClass} flex flex-col overflow-hidden`}>
      <div className="px-4 pt-3.5 pb-1">
        <div className="text-[11px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
          {label}
        </div>
        {sub && (
          <div className="text-[10px] text-txt-light tracking-wider font-condensed uppercase mt-0.5">
            {sub}
          </div>
        )}
      </div>

      <div className="px-4 pb-3 flex-1 flex flex-col justify-center">
        {loading ? (
          <Shimmer w="w-28" h="h-8" />
        ) : (
          <div className={`font-condensed font-extrabold text-[26px] xl:text-[30px] tracking-tight leading-none ${valueColor}`}>
            {formatIndian(value)}
            <span className="text-xs font-normal text-txt-muted ml-1.5">{unit}</span>
          </div>
        )}
        {!loading && note != null && (
          <div className={`text-[11px] mt-1.5 font-semibold ${
            typeof note === "string" && note.startsWith("+")
              ? "text-success"
              : typeof note === "string" && note.startsWith("-")
              ? "text-danger"
              : "text-txt-muted"
          }`}>
            {note}
          </div>
        )}
      </div>
      {sourceActual && (
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">ACTUAL · </span>{sourceActual}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Daily KPI Row ─────────────────────────────────────────────
function DailyKpiRow({ today, loading }: { today: DewateringTodayKpi; loading: boolean }) {
  const dn = today?.day_num ?? 1;
  const delta = today?.stock_delta ?? null;
  const deltaNote = delta != null
    ? `${delta >= 0 ? "+" : ""}${formatIndian(delta, 0)} M³ vs prev`
    : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 xl:gap-4">
      <PairCard
        label="Water Disposal"
        sub={`Day ${dn}`}
        accentClass="accent-bar-teal"
        iconBg="bg-teal-50"
        iconColor="text-info"
        actual={today?.disposal_actual ?? null}
        plan={today?.disposal_plan ?? null}
        pct={today?.disposal_pct ?? null}
        unit="M³"
        loading={loading}
        sourcePlan="IMOS"
        sourceActual="IMOS"
      />
      <PairCard
        label="Pump Run Hours"
        sub={`Day ${dn}`}
        accentClass="accent-bar-blue"
        iconBg="bg-blue-50"
        iconColor="text-accent"
        actual={today?.pump_actual_hr ?? null}
        plan={today?.pump_plan_hr ?? null}
        pct={today?.pump_pct ?? null}
        unit="Hrs"
        loading={loading}
        sourcePlan="IMOS"
        sourceActual="IMOS"
      />
      <StatCard
        label="Closing Stock"
        sub={`Day ${dn}`}
        accentClass="accent-bar-purple"
        valueColor="text-navy"
        value={today?.closing_stock ?? null}
        unit="M³"
        note={deltaNote}
        loading={loading}
        sourceActual="IMOS"
      />
      <StatCard
        label="Pump Capacity"
        sub="Design Rate"
        accentClass="accent-bar-gold"
        valueColor="text-navy"
        value={today?.pump_capacity ?? null}
        unit="M³/Hr"
        note={null}
        loading={loading}
        sourceActual="IMOS"
      />
      <StatCard
        label="Eddy Pump"
        sub="Daily Mins"
        accentClass="accent-bar-orange"
        valueColor="text-navy"
        value={today?.eddy_pump_mins ?? null}
        unit="Mins"
        note={null}
        loading={loading}
        sourceActual="IMOS"
      />
    </div>
  );
}

// ── MTD KPI Row ───────────────────────────────────────────────
function MtdKpiRow({ mtd, loading }: { mtd: DewateringMtdKpi; loading: boolean }) {
  const netChg = mtd?.net_stock_change ?? null;
  const netColor =
    netChg == null ? "text-txt-muted" :
    netChg >= 0    ? "text-success"   : "text-danger";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 xl:gap-4">
      <PairCard
        label="MTD Water Disposal"
        accentClass="accent-bar-teal"
        iconBg="bg-teal-50"
        iconColor="text-info"
        actual={mtd?.mtd_disposal_actual ?? null}
        plan={mtd?.mtd_disposal_plan ?? null}
        pct={mtd?.mtd_disposal_pct ?? null}
        unit="M³"
        loading={loading}
        sourcePlan="IMOS"
        sourceActual="IMOS"
      />
      <PairCard
        label="MTD Pump Hours"
        accentClass="accent-bar-blue"
        iconBg="bg-blue-50"
        iconColor="text-accent"
        actual={mtd?.mtd_pump_actual_hr ?? null}
        plan={mtd?.mtd_pump_plan_hr ?? null}
        pct={mtd?.mtd_pump_pct ?? null}
        unit="Hrs"
        loading={loading}
        sourcePlan="IMOS"
        sourceActual="IMOS"
      />
      <StatCard
        label="Rain Inflow MTD"
        sub="Collected Water"
        accentClass="accent-bar-purple"
        valueColor="text-purple-700"
        value={mtd?.mtd_rain_inflow ?? null}
        unit="M³"
        note={null}
        loading={loading}
        sourceActual="IMOS"
      />
      <StatCard
        label="Net Stock Change"
        sub={`${mtd?.days ?? 0}-Day Period`}
        accentClass={netChg != null && netChg >= 0 ? "accent-bar-green" : "accent-bar-red"}
        valueColor={netColor}
        value={netChg}
        unit="M³"
        note={null}
        loading={loading}
        sourceActual="IMOS"
      />
    </div>
  );
}

// ── Day-wise Table ────────────────────────────────────────────
function DewateringTable({ rows, loading }: { rows: DewateringDayRow[]; loading: boolean }) {
  const COLS = 10;

  const thCls =
    "px-3 py-2 text-left text-[10px] xl:text-[11px] font-bold text-txt-muted uppercase tracking-widest whitespace-nowrap select-none";

  function numCls(actual: number | null, plan: number | null): string {
    if (actual == null) return "text-txt-light/40";
    if (plan == null) return "font-mono text-navy";
    return actual >= plan ? "font-mono text-success font-semibold" : "font-mono text-danger font-semibold";
  }

  function varCls(v: number | null): string {
    if (v == null) return "text-txt-light/40";
    return v >= 0 ? "font-mono text-success font-semibold" : "font-mono text-danger font-semibold";
  }

  // Precompute footer totals
  const totDispPlan = rows.reduce((s, r) => s + (r.disposal_plan ?? 0), 0);
  const totDispAct  = rows.reduce((s, r) => s + (r.disposal_act  ?? 0), 0);
  const totPumpPlan = rows.reduce((s, r) => s + (r.pump_plan_hr  ?? 0), 0);
  const totPumpAct  = rows.reduce((s, r) => s + (r.pump_act_hr   ?? 0), 0);
  const totVariance = rows.reduce((s, r) => s + (r.variance      ?? 0), 0);
  const totRain     = rows.reduce((s, r) => s + (r.rain_added    ?? 0), 0);
  const totSeepage  = rows.reduce((s, r) => s + (r.seepage       ?? 0), 0);
  const showFooter  = !loading && rows.length > 0;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: "400px" }}>
        <table className="w-full text-[11px] xl:text-[12px] border-collapse">
          <thead className="sticky top-0 z-10 bg-bg-section">
            <tr>
              <th className={thCls}>Date</th>
              <th className={`${thCls} text-right`}>Open Stock</th>
              <th className={`${thCls} text-right`}>Rain Added</th>
              <th className={`${thCls} text-right`}>Day Water Seepage</th>
              <th className={`${thCls} text-right`}>Pump Plan Hr</th>
              <th className={`${thCls} text-right`}>Pump Act Hr</th>
              <th className={`${thCls} text-right`}>Disposal Plan</th>
              <th className={`${thCls} text-right`}>Disposal Act</th>
              <th className={`${thCls} text-right`}>Variance</th>
              <th className={`${thCls} text-right`}>Closing Stock</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border-light">
                  {Array.from({ length: COLS }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <div className="h-3.5 bg-bg-section animate-pulse rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="px-4 py-8 text-center text-txt-muted text-sm">
                  No data for selected period
                </td>
              </tr>
            ) : (
              [...rows].reverse().map((r, idx) => {
                const isLatest = idx === 0;
                return (
                  <tr
                    key={r.date}
                    className={`border-b border-border-light hover:bg-bg-light/60 transition-colors ${
                      isLatest ? "bg-teal-50/30" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5 font-semibold text-txt-secondary whitespace-nowrap">
                      {dateShort(r.date)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-navy">
                      {r.open_stock != null ? formatIndian(r.open_stock) : <span className="text-txt-light/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-txt-muted">
                      {r.rain_added != null ? formatIndian(r.rain_added) : <span className="text-txt-light/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-txt-muted">
                      {r.seepage != null ? formatIndian(r.seepage) : <span className="text-txt-light/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-txt-muted">
                      {r.pump_plan_hr != null ? formatIndian(r.pump_plan_hr, 1) : <span className="text-txt-light/40">—</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right ${numCls(r.pump_act_hr, r.pump_plan_hr)}`}>
                      {r.pump_act_hr != null ? formatIndian(r.pump_act_hr, 1) : <span className="text-txt-light/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-txt-muted">
                      {r.disposal_plan != null ? formatIndian(r.disposal_plan) : <span className="text-txt-light/40">—</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right ${numCls(r.disposal_act, r.disposal_plan)}`}>
                      {r.disposal_act != null ? formatIndian(r.disposal_act) : <span className="text-txt-light/40">—</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right ${varCls(r.variance)}`}>
                      {r.variance != null
                        ? `${r.variance >= 0 ? "+" : ""}${formatIndian(r.variance)}`
                        : <span className="text-txt-light/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-navy">
                      {r.closing_stock != null ? formatIndian(r.closing_stock) : <span className="text-txt-light/40">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* MTD summary footer */}
          {showFooter && (
            <tfoot>
              <tr className="bg-navy/5 border-t-2 border-steel/30 font-bold">
                <td className="px-3 py-2.5 font-bold text-navy text-[11px] uppercase tracking-widest font-condensed">
                  MTD Total
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-txt-muted">—</td>
                <td className="px-3 py-2.5 text-right font-mono text-txt-muted">
                  {totRain > 0 ? formatIndian(totRain) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-txt-muted">
                  {totSeepage > 0 ? formatIndian(totSeepage) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-txt-secondary">
                  {formatIndian(totPumpPlan, 1)}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono font-bold ${totPumpAct >= totPumpPlan ? "text-success" : "text-danger"}`}>
                  {formatIndian(totPumpAct, 1)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-txt-secondary">
                  {formatIndian(totDispPlan)}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono font-bold ${totDispAct >= totDispPlan ? "text-success" : "text-danger"}`}>
                  {formatIndian(totDispAct)}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono font-bold ${totVariance >= 0 ? "text-success" : "text-danger"}`}>
                  {totVariance >= 0 ? "+" : ""}{formatIndian(totVariance)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-txt-muted">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Main Section ──────────────────────────────────────────────
export default function DewateringSection() {
  const { apiTo } = useDateFilter();
  const { data, isLoading, isError } = useDewatering();

  if (isError && !data) {
    return (
      <section className="space-y-4">
        <div className="section-title">
          <Waves size={13} />
          Dewatering Operations
        </div>
        <div className="bg-white border border-border rounded-lg shadow-sm px-6 py-8 text-center text-txt-muted text-sm">
          Data unavailable for selected period. Backend may be loading — auto-retrying.
        </div>
      </section>
    );
  }

  const today = data?.today;
  const mtd   = data?.mtd;
  const rows  = data?.rows ?? [];

  return (
    <section className="space-y-4">

      {/* Section title */}
      <div className="section-title">
        <Waves size={13} />
        Dewatering Operations

        <span className="ml-auto flex items-center gap-2 normal-case tracking-normal font-normal text-[11px]">
          <span className="bg-navy text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-wider">
            TILL {tillLabel(apiTo)}
          </span>
          <span className="bg-teal-700 text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-wider">
            MTD TREND
          </span>
        </span>
      </div>

      {/* Row 1 — Daily KPIs */}
      {today && (
        <DailyKpiRow today={today} loading={isLoading} />
      )}
      {!today && isLoading && (
        <DailyKpiRow
          today={{
            latest_date: "", day_num: 1,
            disposal_actual: null, disposal_plan: null, disposal_variance: null, disposal_pct: null,
            pump_actual_hr: null, pump_plan_hr: null, pump_pct: null,
            closing_stock: null, prev_closing_stock: null, stock_delta: null,
            pump_capacity: null, eddy_pump_mins: null,
          }}
          loading
        />
      )}

      {/* Row 2 — MTD KPIs */}
      {mtd && (
        <MtdKpiRow mtd={mtd} loading={isLoading} />
      )}
      {!mtd && isLoading && (
        <MtdKpiRow
          mtd={{
            days: 0,
            mtd_disposal_actual: 0, mtd_disposal_plan: 0, mtd_disposal_pct: null,
            mtd_pump_actual_hr: 0, mtd_pump_plan_hr: 0, mtd_pump_pct: null,
            mtd_rain_inflow: 0, net_stock_change: null,
            d1_open_stock: null, d_last_close_stock: null,
          }}
          loading
        />
      )}

      {/* Row 3 — Day-wise performance table */}
      <DewateringTable rows={rows} loading={isLoading} />

    </section>
  );
}
