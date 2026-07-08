"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import {
  RefreshCw, Fuel, Truck, Droplets, AlertTriangle,
  TrendingUp, TrendingDown, Minus, Search, Activity,
  CheckCircle, Clock,
} from "lucide-react";
import { useFuelManagement } from "@/hooks/useFuelManagement";
import VehicleDrawer from "@/components/fuel/VehicleDrawer";
import { equipPhoto } from "@/lib/equip-photo";
import type { FuelVehicle, FuelOverviewResponse } from "@/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// ── Helpers ────────────────────────────────────────────────────
function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function statusColor(status: FuelVehicle["status"]) {
  switch (status) {
    case "good":   return "#2e7d32";
    case "medium": return "#e65100";
    case "low":    return "#c62828";
    default:       return "#8899bb";
  }
}

function statusLabel(status: FuelVehicle["status"]) {
  switch (status) {
    case "good":   return "Good";
    case "medium": return "Medium";
    case "low":    return "Low";
    default:       return "No Data";
  }
}

// ── KPI card ───────────────────────────────────────────────────
interface KpiCardProps {
  icon:        React.ElementType;
  label:       string;
  value:       string;
  sub?:        string;
  delta?:      number | null;
  deltaLabel?: string;
  accentColor?: string;
}
function KpiCard({ icon: Icon, label, value, sub, delta, deltaLabel, accentColor = "#c8960c" }: KpiCardProps) {
  const hasDelta = delta != null && delta !== 0;
  const isUp     = (delta ?? 0) > 0;

  return (
    <div
      className="bg-white border border-border rounded-lg shadow-sm p-4 flex flex-col gap-2 min-w-0"
      style={{ borderTop: `3px solid ${accentColor}` }}
    >
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded flex items-center justify-center shrink-0"
             style={{ background: `${accentColor}18` }}>
          <Icon size={13} style={{ color: accentColor }} />
        </div>
        <span className="font-condensed text-[12px] font-bold tracking-widest uppercase text-txt-muted truncate">
          {label}
        </span>
      </div>

      <div className="font-condensed text-[26px] xl:text-[28px] font-extrabold text-navy-2 leading-none truncate tracking-tight">
        {value}
      </div>

      <div className="flex items-center gap-2 min-h-[16px]">
        {sub && <span className="text-[11px] text-txt-muted font-condensed truncate">{sub}</span>}
        {hasDelta && (
          <span className={`flex items-center gap-0.5 text-[10px] font-mono font-semibold ml-auto shrink-0
            ${isUp ? "text-[#c62828]" : "text-[#2e7d32]"}`}>
            {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {Math.abs(delta!).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            {deltaLabel && <span className="text-txt-light ml-0.5 font-normal">{deltaLabel}</span>}
          </span>
        )}
        {delta === 0 && (
          <span className="flex items-center gap-0.5 text-[10px] font-mono text-txt-light ml-auto shrink-0">
            <Minus size={10} /> Same as yesterday
          </span>
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 -mx-4 -mb-4 mt-2 rounded-b-lg">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ACTUAL · </span>Technoton
        </p>
      </div>
    </div>
  );
}

// ── Donut chart ────────────────────────────────────────────────
function FuelDonutChart({ data }: { data: FuelOverviewResponse["distribution"] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return (
    <div className="flex-1 flex items-center justify-center text-txt-light text-sm">No vehicle data</div>
  );

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      backgroundColor: "#fff",
      borderColor: "#d0d9e8",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#0f1c35", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter: (p: { name: string; value: number; percent: number }) =>
        `<span style="font-weight:700">${p.name}</span><br/>${p.value} vehicles (${p.percent.toFixed(1)}%)`,
    },
    legend: {
      orient: "vertical",
      right: 4,
      top: "center",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 10,
      textStyle: { color: "#3a4a6b", fontSize: 11, fontFamily: "IBM Plex Sans" },
      formatter: (name: string) => {
        const item = data.find(d => d.band === name);
        return item ? `${name}  ${item.count}` : name;
      },
    },
    series: [{
      type: "pie",
      radius: ["48%", "72%"],
      center: ["38%", "50%"],
      avoidLabelOverlap: false,
      label: {
        show: true,
        position: "center",
        formatter: () => `{total|${total}}\n{sub|vehicles}`,
        rich: {
          total: { fontSize: 22, fontWeight: "bold", color: "#0f1c35", fontFamily: "IBM Plex Mono", lineHeight: 28 },
          sub:   { fontSize: 11, color: "#8899bb", fontFamily: "IBM Plex Sans", lineHeight: 18 },
        },
      },
      emphasis: {
        label: { show: true },
        itemStyle: { shadowBlur: 8, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,.15)" },
      },
      labelLine: { show: false },
      data: data.map(d => ({
        name:      d.band,
        value:     d.count,
        itemStyle: { color: d.color, borderRadius: 3, borderColor: "#fff", borderWidth: 2 },
      })),
    }],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: "200px" }}
      opts={{ renderer: "canvas" }}
      notMerge
    />
  );
}

// ── 7-day trend chart ──────────────────────────────────────────
function TrendChart({ data }: { data: FuelOverviewResponse["trend"] }) {
  if (data.length === 0) return (
    <div className="h-[160px] flex items-center justify-center text-txt-light text-xs">
      No trend data available
    </div>
  );

  const option = {
    backgroundColor: "transparent",
    grid: { top: 12, right: 12, bottom: 28, left: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#fff",
      borderColor: "#d0d9e8",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#0f1c35", fontSize: 11, fontFamily: "IBM Plex Sans" },
      formatter: (params: Array<{ axisValue: string; value: number }>) => {
        const p = params[0];
        return `<span style="color:#8899bb">${fmtDate(p.axisValue)}</span><br/>
                <span style="font-family:'IBM Plex Mono';font-weight:700;color:#1565c0">${fmt(p.value)} L</span>`;
      },
    },
    xAxis: {
      type: "category",
      data: data.map(d => d.date),
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: {
        fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono",
        formatter: (v: string) => fmtDate(v),
      },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono",
        formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`,
      },
      splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
      axisLine:  { show: false },
      axisTick:  { show: false },
    },
    series: [{
      type: "line",
      data: data.map(d => d.total_consumed_l),
      smooth: true,
      symbol: "circle",
      symbolSize: 5,
      lineStyle:  { color: "#1565c0", width: 2 },
      itemStyle:  { color: "#1565c0" },
      areaStyle: {
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(21,101,192,0.18)" },
            { offset: 1, color: "rgba(21,101,192,0.02)" },
          ],
        },
      },
    }],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: "160px" }}
      opts={{ renderer: "canvas" }}
      notMerge
    />
  );
}

// ── Equipment photo icon ───────────────────────────────────────
function VehicleIcon({ category }: { category: string }) {
  return (
    <img
      src={equipPhoto(category)}
      alt={category}
      className="w-full h-full object-contain"
      draggable={false}
    />
  );
}

// ── Horizontal tank SVG (3D cylindrical) ──────────────────────
function HorizontalTank({ pct, status, uid }: { pct: number; status: FuelVehicle["status"]; uid: string }) {
  const W = 140, H = 38, rx = 19;

  const colors: Record<string, { hi: string; mid: string; lo: string }> = {
    good:    { hi: "#69c96d", mid: "#2e7d32", lo: "#1b5e20" },
    medium:  { hi: "#ffb74d", mid: "#ef6c00", lo: "#e65100" },
    low:     { hi: "#ef5350", mid: "#c62828", lo: "#b71c1c" },
    no_data: { hi: "#78909c", mid: "#546e7a", lo: "#37474f" },
  };
  const c    = colors[status] ?? colors.no_data;
  const pct2 = Math.max(0, Math.min(100, pct));
  const fillW = (pct2 / 100) * W;
  const safe  = uid.replace(/[^a-zA-Z0-9]/g, "_");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 140, height: 38, display: "block", flexShrink: 0 }}>
      <defs>
        <clipPath id={`tc_${safe}`}>
          <rect x="0.5" y="0.5" width={W-1} height={H-1} rx={rx}/>
        </clipPath>
        <linearGradient id={`fbg_${safe}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#232f42"/>
          <stop offset="100%" stopColor="#141e2e"/>
        </linearGradient>
        <linearGradient id={`flq_${safe}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={c.hi} stopOpacity="0.95"/>
          <stop offset="50%"  stopColor={c.mid}/>
          <stop offset="100%" stopColor={c.lo}/>
        </linearGradient>
        <linearGradient id={`fsh_${safe}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.30)"/>
          <stop offset="45%"  stopColor="rgba(255,255,255,0.04)"/>
          <stop offset="100%" stopColor="rgba(0,0,0,0.08)"/>
        </linearGradient>
      </defs>

      <rect x="0.5" y="0.5" width={W-1} height={H-1} rx={rx}
            fill={`url(#fbg_${safe})`} stroke="#2a3c54" strokeWidth="1"/>

      {pct2 > 0 && (
        <rect x="0.5" y="0.5" width={fillW} height={H-1}
              fill={`url(#flq_${safe})`} clipPath={`url(#tc_${safe})`}/>
      )}

      {pct2 > 2 && pct2 < 98 && (
        <line x1={fillW} y1={5} x2={fillW} y2={H-5}
              stroke="rgba(255,255,255,0.45)" strokeWidth="1.5"
              clipPath={`url(#tc_${safe})`}/>
      )}

      {[0.25, 0.5, 0.75].map((q, i) => (
        <line key={i} x1={W*q} y1={3} x2={W*q} y2={H-3}
              stroke="rgba(255,255,255,0.08)" strokeWidth="2.5"/>
      ))}

      {[0.08,0.16,0.24,0.32,0.40,0.48,0.56,0.64,0.72,0.80,0.88,0.96].map((q, i) => (
        <line key={i} x1={W*q} y1={6} x2={W*q} y2={15}
              stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>
      ))}

      <rect x="0.5" y="0.5" width={W-1} height={(H-1)*0.38} rx={rx}
            fill={`url(#fsh_${safe})`} clipPath={`url(#tc_${safe})`}/>

      <rect x="0.5" y="0.5" width={W-1} height={H-1} rx={rx}
            fill="none" stroke="#364e6a" strokeWidth="1"/>
    </svg>
  );
}

// ── Circular fuel ring ─────────────────────────────────────────
function FuelRing({ pct, status, estHrs }: { pct: number; status: FuelVehicle["status"]; estHrs: number | null }) {
  const R = 24, stroke = 5;
  const C = 2 * Math.PI * R;
  const filled = (pct / 100) * C;
  const sc = statusColor(status);

  return (
    <div className="flex flex-col items-center gap-0.5" style={{ minWidth: 72 }}>
      <div className="relative" style={{ width: 64, height: 64 }}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={R} fill="none" stroke="#eef2f8" strokeWidth={stroke} />
          <circle cx="32" cy="32" r={R} fill="none"
                  stroke={sc} strokeWidth={stroke}
                  strokeDasharray={`${filled} ${C}`}
                  strokeLinecap="round"
                  transform="rotate(-90 32 32)" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[13px] font-bold" style={{ color: "#0f1c35" }}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc }} />
        <span className="font-condensed text-[10px] font-bold tracking-wide" style={{ color: sc }}>
          {statusLabel(status)}
        </span>
      </div>
      {estHrs != null ? (
        <span className="text-[9px] text-txt-light font-mono">Est. {estHrs} Hrs</span>
      ) : (
        <span className="text-[9px] text-[#c0cce0] font-mono">— Hrs</span>
      )}
    </div>
  );
}

// ── Visual vehicle row ─────────────────────────────────────────
function VehicleRow({ v, onSelect }: { v: FuelVehicle; onSelect: (v: FuelVehicle) => void }) {
  const sc = statusColor(v.status);
  return (
    <tr
      className="border-b border-[#eef2f8] hover:bg-[#eef6ff] transition-colors cursor-pointer"
      onClick={() => onSelect(v)}
      title={`Click to view ${v.display_name} fuel history`}
    >

      {/* Vehicle thumbnail + name + active badge */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <div className="flex items-center gap-2.5">
          <div className="w-[80px] h-[60px] rounded-lg bg-[#f5f7fb] flex items-center justify-center shrink-0 overflow-hidden">
            <VehicleIcon category={v.category} />
          </div>
          <div>
            <div className="font-bold text-[12px] text-navy leading-tight font-mono tracking-wide">
              {v.display_name}
            </div>
            <span
              className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold font-condensed tracking-wide uppercase"
              style={{
                background: v.engine_hours > 0 ? "#e8f5e9" : "#f5f7fb",
                color:      v.engine_hours > 0 ? "#2e7d32" : "#8899bb",
                border:     `1px solid ${v.engine_hours > 0 ? "#c8e6c9" : "#d0d9e8"}`,
              }}
            >
              {v.engine_hours > 0 && <span className="w-1 h-1 rounded-full bg-[#2e7d32]"/>}
              {v.engine_hours > 0 ? "Active" : "Idle"}
            </span>
          </div>
        </div>
      </td>

      {/* Type */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <span className="text-[11px] text-txt-secondary">{v.category}</span>
      </td>

      {/* Horizontal tank + F/½/E markers */}
      <td className="py-2.5 px-3">
        {v.has_data ? (
          <div className="flex items-center gap-2">
            <HorizontalTank pct={v.fuel_pct} status={v.status} uid={v.vehicle_desc} />
            <div className="flex flex-col justify-between text-[8px] font-mono font-semibold text-txt-light select-none"
                 style={{ height: 38, paddingTop: 3, paddingBottom: 3 }}>
              <span>F</span>
              <span>½</span>
              <span>E</span>
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-[#c0cce0] italic">No sensor data</span>
        )}
      </td>

      {/* Fuel ring */}
      <td className="py-2.5 px-3">
        {v.has_data
          ? <FuelRing pct={v.fuel_pct} status={v.status} estHrs={v.est_hours_remaining} />
          : <span className="text-[11px] text-[#c0cce0]">—</span>
        }
      </td>

      {/* Fuel in Tank */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <span className="font-mono text-[13px] font-bold text-navy">
          {v.has_data ? `${fmt(v.fuel_level_l)} L` : "—"}
        </span>
      </td>

      {/* Capacity */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <span className="font-mono text-[11px] text-txt-light">{fmt(v.tank_capacity)} L</span>
      </td>

      {/* Last Updated + Live badge */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-txt-secondary font-mono">
            {v.last_seen ? fmtDate(v.last_seen) : "Today"}
          </span>
          {v.has_data && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold font-condensed tracking-wide uppercase bg-green-50 text-[#2e7d32] border border-green-200"
              style={{ width: "fit-content" }}
            >
              <span className="w-1 h-1 rounded-full bg-[#2e7d32] animate-pulse"/>
              Live
            </span>
          )}
        </div>
      </td>

      {/* Status badge */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <span
          className="inline-block px-2.5 py-1 rounded text-[10px] font-bold font-condensed tracking-wide uppercase border"
          style={{ color: sc, background: `${sc}14`, borderColor: `${sc}30` }}
        >
          {statusLabel(v.status)}
        </span>
      </td>

      {/* Actions: fill summary + icon buttons */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            {v.total_fillings > 0 ? (
              <>
                <Droplets size={9} className="text-[#0288d1] shrink-0"/>
                <span className="text-[10px] font-mono text-[#0288d1] font-semibold">
                  {v.total_fillings} fill{v.total_fillings > 1 ? "s" : ""}
                </span>
                <span className="text-[9px] text-txt-light font-mono">
                  +{fmt(v.filled_litres)} L
                </span>
              </>
            ) : (
              <span className="text-[10px] text-[#c0cce0] font-mono">No fills</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <span className="flex items-center gap-1 text-[9px] font-mono text-[#b0bdd4]">
              <TrendingUp size={9} />
              View history
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────
export default function FuelManagementSection() {
  const { data, loading, error, lastUpdated, refetch } = useFuelManagement();
  const [search,          setSearch]          = useState("");
  const [filterStatus,    setFilterStatus]    = useState<string>("all");
  const [filterCategory,  setFilterCategory]  = useState<string>("all");
  const [selectedVehicle, setSelectedVehicle] = useState<FuelVehicle | null>(null);

  const kpis     = data?.kpis;
  const vehicles = data?.vehicles ?? [];

  const categories = Array.from(new Set(vehicles.map(v => v.category))).sort();

  const filtered = vehicles.filter(v => {
    const matchSearch   = v.display_name.toLowerCase().includes(search.toLowerCase()) ||
                          v.category.toLowerCase().includes(search.toLowerCase());
    const matchStatus   = filterStatus === "all"   || v.status   === filterStatus;
    const matchCategory = filterCategory === "all" || v.category === filterCategory;
    return matchSearch && matchStatus && matchCategory;
  });

  const lowFuelVehicles = vehicles.filter(v => v.status === "low");

  const consumedDelta = (kpis && kpis.fuel_consumed_yesterday > 0)
    ? kpis.fuel_consumed_today - kpis.fuel_consumed_yesterday
    : null;

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <VehicleDrawer
        vehicle={selectedVehicle}
        onClose={() => setSelectedVehicle(null)}
      />

      {/* ── Page header ──────────────────────────────────── */}
      <div className="flex items-center justify-between py-3 px-1 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <Fuel size={18} className="text-gold" />
            <h1 className="font-condensed text-[22px] font-black tracking-[.04em] uppercase text-navy">
              Fuel Management
            </h1>
          </div>
          <p className="text-[11px] text-txt-light mt-0.5 ml-[26px]">
            Kaliapani Chromite Mines — Real-time Fleet Fuel Overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-txt-light font-mono">
              <Activity size={10} />
              {fmtTime(lastUpdated)}
            </span>
          )}
          <button
            onClick={refetch}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white hover:bg-bg-section text-txt-secondary hover:text-navy transition text-[11px] font-condensed font-bold tracking-widest border border-border shadow-sm"
          >
            <RefreshCw size={11} />
            REFRESH
          </button>
        </div>
      </div>

      {/* ── Loading / Error ───────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-border border-t-[#c8960c] rounded-full animate-spin" />
            <span className="text-[12px] text-txt-light font-condensed tracking-wide">
              Loading fuel data…
            </span>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="mx-1 mt-4 p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3">
          <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
          <span className="text-[12px] text-[#c62828]">{error}</span>
          <button
            onClick={refetch}
            className="ml-auto text-[11px] text-[#c62828] hover:text-navy underline"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── KPI Strip ──────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
            <KpiCard
              icon={Truck}
              label="Total Fleet"
              value={fmt(kpis!.total_vehicles)}
              sub={`${kpis!.active_vehicles} active today`}
              accentColor="#c8960c"
            />
            <KpiCard
              icon={Fuel}
              label="Avg Fuel Level"
              value={`${kpis!.avg_fuel_pct.toFixed(1)}%`}
              sub={`${kpis!.vehicles_with_data} with sensor data`}
              accentColor={kpis!.avg_fuel_pct >= 50 ? "#2e7d32" : kpis!.avg_fuel_pct >= 20 ? "#e65100" : "#c62828"}
            />
            <KpiCard
              icon={Droplets}
              label="Total Fuel in Tanks"
              value={`${fmt(kpis!.total_fuel_l)} L`}
              sub={`of ${fmt(kpis!.total_capacity_l)} L capacity`}
              accentColor="#1565c0"
            />
            <KpiCard
              icon={Activity}
              label="Consumed Today"
              value={`${fmt(kpis!.fuel_consumed_today)} L`}
              delta={consumedDelta}
              deltaLabel="vs yest"
              accentColor="#e65100"
            />
            <KpiCard
              icon={CheckCircle}
              label="Refills Today"
              value={fmt(kpis!.vehicles_refilled)}
              sub={kpis!.total_filled_today > 0 ? `${fmt(kpis!.total_filled_today)} L filled` : "No refills recorded"}
              accentColor="#00695c"
            />
          </div>

          {/* ── Middle Row ─────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">

            {/* Donut: Fuel level distribution */}
            <div className="bg-white border border-border rounded-lg shadow-sm p-4">
              <div className="px-0 pb-2.5 border-b border-[#eef2f8] mb-3">
                <span className="font-condensed text-[13px] font-bold tracking-widest uppercase text-steel">
                  Fuel Level Distribution
                </span>
              </div>
              <FuelDonutChart data={data.distribution} />
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                {data.distribution.map(d => (
                  <div key={d.key} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-[10px] text-txt-light">{d.band}</span>
                    <span className="text-[10px] font-mono font-bold text-navy">{d.count}</span>
                  </div>
                ))}
              </div>
              <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 -mx-4 -mb-4 mt-3 rounded-b-lg">
                <p className="text-[9px] font-mono text-success/70 leading-tight">
                  <span className="font-semibold text-success/60">ACTUAL · </span>Technoton
                </p>
              </div>
            </div>

            {/* Alerts */}
            <div className="bg-white border border-border rounded-lg shadow-sm p-4 flex flex-col">
              <div className="pb-2.5 border-b border-[#eef2f8] mb-3">
                <span className="font-condensed text-[13px] font-bold tracking-widest uppercase text-steel">
                  Fuel Alerts
                </span>
              </div>

              {lowFuelVehicles.length > 0 ? (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle size={12} className="text-[#c62828]" />
                    <span className="text-[11px] font-semibold text-[#c62828]">
                      {lowFuelVehicles.length} vehicle{lowFuelVehicles.length > 1 ? "s" : ""} below 20%
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-[120px] overflow-y-auto">
                    {lowFuelVehicles.map(v => (
                      <div key={v.vehicle_desc}
                           className="flex items-center justify-between bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
                        <span className="text-[11px] text-navy font-semibold">{v.display_name}</span>
                        <span className="font-mono text-[10px] text-[#c62828] font-bold">{v.fuel_pct.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-3 p-2.5 bg-green-50 border border-green-200 rounded">
                  <CheckCircle size={12} className="text-[#2e7d32]" />
                  <span className="text-[11px] text-[#2e7d32] font-semibold">All vehicles above 20%</span>
                </div>
              )}

              <div className="border-t border-[#eef2f8] pt-3 mt-auto">
                <div className="flex items-center gap-1.5 mb-2">
                  <Droplets size={12} className="text-[#00697c]" />
                  <span className="text-[11px] font-semibold text-[#00697c]">
                    {data.refills_today.length > 0
                      ? `${data.refills_today.length} refill event${data.refills_today.length > 1 ? "s" : ""} today`
                      : "No refill events today"}
                  </span>
                </div>
                {data.refills_today.slice(0, 4).map(v => (
                  <div key={v.vehicle_desc}
                       className="flex items-center justify-between py-1 border-b border-[#eef2f8] last:border-0">
                    <span className="text-[10px] text-txt-light">{v.display_name}</span>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono">
                      <span className="text-[#00697c] font-semibold">+{fmt(v.filled_litres)} L</span>
                      <span className="text-[#b0bdd4]">×{v.total_fillings}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Trend + Top Consumers Row ──────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">

            {/* 7-day trend */}
            <div className="bg-white border border-border rounded-lg shadow-sm p-4">
              <div className="flex items-center justify-between pb-2.5 border-b border-[#eef2f8] mb-3">
                <span className="font-condensed text-[13px] font-bold tracking-widest uppercase text-steel">
                  7-Day Consumption Trend
                </span>
                {data.trend.length > 0 && (
                  <span className="text-[10px] font-mono text-txt-light">
                    Σ {fmt(data.trend.reduce((s, d) => s + d.total_consumed_l, 0))} L
                  </span>
                )}
              </div>
              <TrendChart data={data.trend} />
              {data.trend.length === 0 && (
                <p className="text-[10px] text-txt-light mt-1">
                  Historical data will appear as the fleet operates over multiple days.
                </p>
              )}
              <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 -mx-4 -mb-4 mt-3 rounded-b-lg">
                <p className="text-[9px] font-mono text-success/70 leading-tight">
                  <span className="font-semibold text-success/60">ACTUAL · </span>Technoton
                </p>
              </div>
            </div>

            {/* Top 5 consumers */}
            <div className="bg-white border border-border rounded-lg shadow-sm p-4">
              <div className="pb-2.5 border-b border-[#eef2f8] mb-3">
                <span className="font-condensed text-[13px] font-bold tracking-widest uppercase text-steel">
                  Top Fuel Consumers Today
                </span>
              </div>
              {data.top_consumers.length === 0 ? (
                <p className="text-[11px] text-txt-light">No consumption data yet</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.top_consumers.map((v, i) => {
                    const maxConsumed = data.top_consumers[0]?.fuel_consumed ?? 1;
                    const barPct      = (v.fuel_consumed / maxConsumed) * 100;
                    const rankColors  = ["#c8960c", "#3a4a6b", "#3a4a6b", "#8899bb", "#8899bb"];
                    const barColors   = ["#c8960c", "#1565c0", "#1565c0", "#8899bb", "#8899bb"];
                    return (
                      <div key={v.vehicle_desc}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-bold w-4 text-right"
                                  style={{ color: rankColors[i] }}>
                              #{i + 1}
                            </span>
                            <span className="text-[11px] text-navy font-semibold">{v.display_name}</span>
                            <span className="text-[10px] text-txt-light">{v.category}</span>
                          </div>
                          <span className="font-mono text-[11px] text-navy font-bold">
                            {fmt(v.fuel_consumed)} L
                          </span>
                        </div>
                        <div className="h-1.5 bg-bg-section rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${barPct}%`, background: barColors[i] }}
                          />
                        </div>
                        {v.lph > 0 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Clock size={9} className="text-[#b0bdd4]" />
                            <span className="text-[9px] text-[#b0bdd4] font-mono">{v.lph.toFixed(1)} L/h avg</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 -mx-4 -mb-4 mt-3 rounded-b-lg">
                <p className="text-[9px] font-mono text-success/70 leading-tight">
                  <span className="font-semibold text-success/60">ACTUAL · </span>Technoton
                </p>
              </div>
            </div>
          </div>

          {/* ── Vehicle Table Row ───────────────────────────── */}
          <div className="mt-3 bg-white border border-border rounded-lg shadow-sm overflow-hidden">

              {/* Table toolbar */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#eef2f8]">
                <span className="font-condensed text-[13px] font-bold tracking-widest uppercase text-navy mr-1">
                  All Vehicles ({filtered.length})
                </span>

                {/* Search */}
                <div className="relative flex items-center">
                  <Search size={11} className="absolute left-2.5 text-[#b0bdd4]" />
                  <input
                    type="text"
                    placeholder="Search Vehicle / Type"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="bg-bg-section border border-border rounded text-[11px] text-navy placeholder-[#b0bdd4] pl-7 pr-3 py-1.5 outline-none focus:border-[#c8960c] w-44 transition-colors"
                  />
                </div>

                {/* Category filter */}
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="bg-bg-section border border-border rounded text-[11px] text-txt-secondary px-2.5 py-1.5 outline-none focus:border-[#c8960c] transition-colors cursor-pointer"
                >
                  <option value="all">All Types</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                {/* Status filter */}
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="bg-bg-section border border-border rounded text-[11px] text-txt-secondary px-2.5 py-1.5 outline-none focus:border-[#c8960c] transition-colors cursor-pointer"
                >
                  <option value="all">All Status</option>
                  <option value="good">Good (&gt;50%)</option>
                  <option value="medium">Medium (20–50%)</option>
                  <option value="low">Low (&lt;20%)</option>
                  <option value="no_data">No Data</option>
                </select>

                {/* Legend */}
                <div className="ml-auto hidden xl:flex items-center gap-3 text-[10px]">
                  {[["#2e7d32","Good (>50%)"],["#e65100","Medium (20–50%)"],["#c62828","Low (<20%)"]].map(([c,l]) => (
                    <span key={l} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}
                    </span>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr className="border-b border-[#eef2f8] bg-[#f8fafd]">
                      {["Vehicle", "Type", "Fuel Tank", "Fuel Level", "Fuel in Tank", "Capacity", "Last Updated", "Status", "Actions"].map(h => (
                        <th key={h}
                            className="px-4 py-2.5 font-condensed text-[11px] font-bold tracking-widest uppercase text-txt-light whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-[12px] text-txt-light">
                          {search || filterStatus !== "all" || filterCategory !== "all"
                            ? "No vehicles match the current filters"
                            : "No vehicle data for today"}
                        </td>
                      </tr>
                    ) : (
                      filtered.map(v => <VehicleRow key={v.vehicle_desc} v={v} onSelect={setSelectedVehicle} />)
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table footer */}
              <div className="px-4 py-2.5 border-t border-[#eef2f8] bg-[#f8fafd] flex items-center gap-2 text-[10px] text-txt-light">
                <span>Showing {filtered.length} of {vehicles.length} vehicles</span>
                <span className="flex items-center gap-2 ml-auto xl:hidden">
                  {[["#2e7d32","Good"],["#e65100","Medium"],["#c62828","Low"]].map(([c,l]) => (
                    <span key={l} className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />{l}
                    </span>
                  ))}
                </span>
              </div>
              <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
                <p className="text-[9px] font-mono text-success/70 leading-tight">
                  <span className="font-semibold text-success/60">ACTUAL · </span>Technoton
                </p>
              </div>
            </div>


          {/* ── Footer note ────────────────────────────────── */}
          <div className="flex items-center gap-2 mt-4 pb-2 text-[10px] text-[#b0bdd4]">
            <Activity size={10} />
            <span>
              Technoton GPS-fuel sensors · Synced every ~1 min · Last full read: {data.as_of}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
