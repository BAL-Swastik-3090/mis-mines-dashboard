"use client";
import { useMemo, useState } from "react";
import {
  Fuel, Droplet, AlertTriangle, Gauge, Clock, Route,
  Search, TrendingDown, CalendarRange,
} from "lucide-react";
import { useFuelSummary } from "@/hooks/useFuelSummary";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { FuelSummaryVehicle } from "@/types";

// ── helpers ───────────────────────────────────────────────────
function fmt(n: number | null | undefined, dp = 0) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function Shimmer({ w = "w-20", h = "h-6" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

// ── KPI card ──────────────────────────────────────────────────
interface KpiProps {
  icon:   React.ElementType;
  label:  string;
  value:  string;
  unit?:  string;
  sub?:   string;
  accent: string;
  loading: boolean;
}

function Kpi({ icon: Icon, label, value, unit, sub, accent, loading }: KpiProps) {
  return (
    <div
      className="bg-white border border-border rounded-lg shadow-sm overflow-hidden border-t-2"
      style={{ borderTopColor: accent }}
    >
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        <span className="w-6 h-6 rounded grid place-items-center shrink-0" style={{ backgroundColor: `${accent}1a` }}>
          <Icon size={13} style={{ color: accent }} />
        </span>
        <span className="text-[10px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
          {label}
        </span>
      </div>
      <div className="px-4 pb-3">
        {loading ? (
          <Shimmer w="w-24" h="h-7" />
        ) : (
          <>
            <div className="font-condensed font-extrabold text-[24px] tracking-tight leading-none text-navy">
              {value}
              {unit && <span className="text-[11px] font-normal text-txt-muted ml-1">{unit}</span>}
            </div>
            {sub && <div className="text-[10px] text-txt-light mt-1 font-mono">{sub}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ── Day-wise bar chart (pure CSS, no chart lib) ───────────────
function DailyBars({ days }: { days: { date: string; consumed_l: number }[] }) {
  const max = Math.max(...days.map((d) => d.consumed_l), 1);
  const avg = days.reduce((s, d) => s + d.consumed_l, 0) / (days.length || 1);
  const avgPct = (avg / max) * 100;

  return (
    <div className="px-3">
      {/* plot area */}
      <div className="relative h-[150px]">
        {/* average reference line */}
        <div
          className="absolute left-0 right-0 border-t border-dashed border-[#c8960c]/50 z-[1]"
          style={{ bottom: `${avgPct}%` }}
        >
          <span className="absolute right-0 -top-3.5 text-[8px] font-mono text-[#c8960c] bg-white px-1">
            avg {fmt(avg, 0)} L
          </span>
        </div>

        <div className="flex items-end gap-2 h-full">
          {days.map((d) => {
            const pct = (d.consumed_l / max) * 100;
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <span className="text-[8px] font-mono text-txt-light mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {fmt(d.consumed_l, 0)}
                </span>
                <div
                  className="w-full max-w-[46px] rounded-t bg-[#1565c0] hover:bg-[#1976d2] transition-colors min-h-[2px] z-[2]"
                  style={{ height: `${pct}%` }}
                />
                {/* tooltip */}
                <div className="pointer-events-none absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 transition-opacity z-20
                                bg-[#0f1c35] text-white text-[10px] font-mono px-2 py-1 rounded whitespace-nowrap shadow-lg">
                  {fmtDate(d.date)} · {fmt(d.consumed_l, 1)} L
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* x-axis */}
      <div className="flex gap-2 border-t border-border-light pt-1.5 mt-0.5">
        {days.map((d) => (
          <span key={d.date} className="flex-1 text-center text-[9px] text-txt-light font-mono whitespace-nowrap">
            {fmtDate(d.date)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function FuelSummarySection() {
  const { data, isLoading, isError, error } = useFuelSummary();
  const { periodLabel } = useDateFilter();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof FuelSummaryVehicle>("consumed_l");

  const k = data?.kpis;

  const vehicles = useMemo(() => {
    const list = (data?.vehicles ?? []).filter((v) =>
      query.trim() === ""
        ? true
        : `${v.display_name} ${v.category}`.toLowerCase().includes(query.toLowerCase())
    );
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return bv - av;
      return String(av).localeCompare(String(bv));
    });
  }, [data, query, sortKey]);

  if (isError) {
    return (
      <div className="mx-1 mt-4 p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3">
        <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
        <span className="text-[12px] text-[#c62828]">
          {error instanceof Error ? error.message : "Failed to load fuel summary"}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">

      {/* Period banner */}
      <div className="flex items-center gap-2 px-1">
        <CalendarRange size={13} className="text-txt-light" />
        <span className="text-[11px] text-txt-secondary font-mono">
          {data ? `${fmtDate(data.from_date)} – ${fmtDate(data.to_date)}` : periodLabel}
        </span>
        {k && (
          <span className="text-[10px] text-txt-light font-mono">
            · {k.days_with_data} of {k.days_in_range} days with data
          </span>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi icon={Fuel} label="Total Consumed" accent="#1565c0" loading={isLoading}
             value={fmt(k?.total_consumed_l, 1)} unit="L"
             sub={k ? `${fmt(k.avg_consumed_per_day, 1)} L/day avg` : undefined} />
        <Kpi icon={Droplet} label="Total Filled" accent="#2e7d32" loading={isLoading}
             value={fmt(k?.total_filled_l, 1)} unit="L"
             sub={k ? `${k.fill_events} refill events` : undefined} />
        <Kpi icon={TrendingDown} label="Total Drained" accent="#c62828" loading={isLoading}
             value={fmt(k?.total_drained_l, 1)} unit="L"
             sub={k ? `${k.drain_events} drain events` : undefined} />
        <Kpi icon={Gauge} label="Avg LPH" accent="#c8960c" loading={isLoading}
             value={k?.avg_lph != null ? String(k.avg_lph) : "—"} unit="L/hr"
             sub="fleet, consumption ÷ engine hrs" />
        <Kpi icon={Clock} label="Engine Hours" accent="#6a1b9a" loading={isLoading}
             value={fmt(k?.total_engine_hours, 1)} unit="hrs"
             sub={k ? `${k.active_vehicles} of ${k.total_vehicles} active` : undefined} />
        <Kpi icon={Route} label="Distance" accent="#00838f" loading={isLoading}
             value={fmt(k?.total_distance_km, 1)} unit="km"
             sub="tippers only" />
      </div>

      {/* ── Day-wise · chart ─────────────────────────────── */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Day-wise Fuel Consumption
          </span>
          {data && data.daily.length > 0 && (
            <div className="flex items-center gap-3 text-[10px] font-mono text-txt-light">
              <span>peak {fmt(Math.max(...data.daily.map((d) => d.consumed_l)), 1)} L</span>
              <span className="text-txt-light/40">|</span>
              <span>avg {fmt(k?.avg_consumed_per_day, 1)} L/day</span>
              <span className="text-txt-light/40">|</span>
              <span className="font-bold text-[#1565c0]">Σ {fmt(k?.total_consumed_l, 1)} L</span>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="h-[190px] flex items-center justify-center bg-bg-light">
            <span className="text-txt-muted text-sm animate-pulse">Loading…</span>
          </div>
        ) : !data || data.daily.length === 0 ? (
          <div className="py-12 text-center text-txt-muted text-sm">No fuel data in this period</div>
        ) : (
          <div className="pt-5 pb-3 px-2">
            <DailyBars days={data.daily} />
          </div>
        )}

        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">ACTUAL · </span>Technoton
          </p>
        </div>
      </div>

      {/* ── Day-wise · table ─────────────────────────────── */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Day-wise Breakdown
          </span>
          {data && data.daily.length > 0 && (
            <span className="text-[10px] font-mono text-txt-light">
              {data.daily.length} day{data.daily.length !== 1 ? "s" : ""} with data
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="h-[160px] flex items-center justify-center bg-bg-light">
            <span className="text-txt-muted text-sm animate-pulse">Loading…</span>
          </div>
        ) : !data || data.daily.length === 0 ? (
          <div className="py-12 text-center text-txt-muted text-sm">No fuel data in this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="bg-bg-section border-b border-border-light">
                  {["Date", "Consumed (L)", "Filled (L)", "Drained (L)", "Engine Hrs", "Distance (km)", "Vehicles"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light/60">
                {data.daily.map((d) => (
                  <tr key={d.date} className="hover:bg-bg-section/50 transition-colors">
                    <td className="px-3 py-2 font-condensed font-bold text-navy whitespace-nowrap">{fmtDate(d.date)}</td>
                    <td className="px-3 py-2 text-[#1565c0] font-semibold">{fmt(d.consumed_l, 1)}</td>
                    <td className="px-3 py-2 text-[#2e7d32]">{fmt(d.filled_l, 1)}</td>
                    <td className={`px-3 py-2 ${d.drained_l > 0 ? "text-[#c62828] font-semibold" : "text-txt-light"}`}>
                      {fmt(d.drained_l, 1)}
                    </td>
                    <td className="px-3 py-2 text-txt-secondary">{fmt(d.engine_hours, 1)}</td>
                    <td className="px-3 py-2 text-txt-secondary">{fmt(d.distance_km, 1)}</td>
                    <td className="px-3 py-2 text-txt-light">{d.vehicles_reporting}</td>
                  </tr>
                ))}
              </tbody>
              {/* period totals */}
              <tfoot>
                <tr className="bg-navy text-white border-t-2 border-navy">
                  <td className="px-3 py-2 font-condensed font-bold tracking-widest uppercase text-[11px]">Total</td>
                  <td className="px-3 py-2 font-bold">{fmt(k?.total_consumed_l, 1)}</td>
                  <td className="px-3 py-2 font-bold">{fmt(k?.total_filled_l, 1)}</td>
                  <td className="px-3 py-2 font-bold">{fmt(k?.total_drained_l, 1)}</td>
                  <td className="px-3 py-2 font-bold">{fmt(k?.total_engine_hours, 1)}</td>
                  <td className="px-3 py-2 font-bold">{fmt(k?.total_distance_km, 1)}</td>
                  <td className="px-3 py-2 text-white/50">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">ACTUAL · </span>Technoton
          </p>
        </div>
      </div>

      {/* Drain panel — only when there is something to show */}
      {data && data.drainers.length > 0 && (
        <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden border-l-[3px] border-l-[#c62828]">
          <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
            <AlertTriangle size={14} className="text-[#c62828]" />
            <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
              Fuel Drain Events
            </span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-[#ffebee] text-[#c62828] border-[#ef9a9a] font-mono">
              {data.drainers.length} vehicle{data.drainers.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="divide-y divide-border-light/60">
            {data.drainers.map((v) => (
              <div key={v.vehicle_desc} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="font-condensed font-bold text-[12px] text-navy">{v.display_name}</div>
                  <div className="text-[10px] text-txt-light">{v.category}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-[13px] text-[#c62828]">{fmt(v.drained_l, 1)} L</div>
                  <div className="text-[10px] text-txt-light font-mono">{v.drain_events} event{v.drain_events !== 1 ? "s" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-vehicle */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Vehicle-wise Summary {data && `(${vehicles.length})`}
          </span>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-txt-light" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search vehicle / type"
                className="pl-7 pr-3 py-1.5 text-[11px] border border-border rounded bg-white text-txt-secondary
                           focus:outline-none focus:border-[#c8960c] w-[190px]"
              />
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as keyof FuelSummaryVehicle)}
              className="px-2 py-1.5 text-[11px] border border-border rounded bg-white text-txt-secondary focus:outline-none focus:border-[#c8960c]"
            >
              <option value="consumed_l">Sort: Consumed</option>
              <option value="engine_hours">Sort: Engine hrs</option>
              <option value="avg_lph">Sort: Avg LPH</option>
              <option value="filled_l">Sort: Filled</option>
              <option value="distance_km">Sort: Distance</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="bg-bg-section border-b border-border-light">
                {["Vehicle", "Type", "Consumed (L)", "Engine Hrs", "Avg LPH", "Filled (L)", "Drained (L)", "Distance (km)", "km/L", "Days"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/60">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j} className="px-3 py-3"><Shimmer w="w-14" h="h-4" /></td>
                    ))}
                  </tr>
                ))
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-txt-muted text-sm font-sans">
                    {query ? "No vehicle matches your search" : "No vehicle data in this period"}
                  </td>
                </tr>
              ) : (
                vehicles.map((v) => (
                  <tr key={v.vehicle_desc} className="hover:bg-bg-section/50 transition-colors">
                    <td className="px-3 py-2.5 font-condensed font-bold text-[12px] text-navy whitespace-nowrap">
                      {v.display_name}
                    </td>
                    <td className="px-3 py-2.5 text-txt-light whitespace-nowrap">{v.category}</td>
                    <td className="px-3 py-2.5 text-[#1565c0] font-semibold">{fmt(v.consumed_l, 1)}</td>
                    <td className="px-3 py-2.5 text-txt-secondary">{fmt(v.engine_hours, 1)}</td>
                    <td className="px-3 py-2.5 text-txt-secondary">{v.avg_lph ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[#2e7d32]">{fmt(v.filled_l, 1)}</td>
                    <td className={`px-3 py-2.5 ${v.drained_l > 0 ? "text-[#c62828] font-semibold" : "text-txt-light"}`}>
                      {fmt(v.drained_l, 1)}
                    </td>
                    <td className="px-3 py-2.5 text-txt-secondary">
                      {v.distance_km != null ? fmt(v.distance_km, 1) : <span className="text-txt-light/50">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-txt-secondary">
                      {v.kmpl != null ? v.kmpl : <span className="text-txt-light/50">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-txt-light">{v.days_reported}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 flex flex-wrap gap-x-4">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">ACTUAL · </span>Technoton
          </p>
          <p className="text-[9px] font-mono text-txt-light leading-tight">
            Distance and km/L are recorded for MAN tippers only
          </p>
        </div>
      </div>

    </div>
  );
}
