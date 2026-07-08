"use client";
import { useEffect, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { X, Zap, Clock, Droplets, AlertTriangle } from "lucide-react";
import { equipPhoto } from "@/lib/equip-photo";
import type { FuelVehicle } from "@/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface IntradayReading {
  time:          string;
  fuel_level_l:  number;
  fuel_pct:      number;
  fuel_consumed: number;
  lph:           number;
  engine_hours:  number;
}

interface IntradayResponse {
  vehicle_desc:  string;
  display_name:  string;
  category:      string;
  tank_capacity: number;
  date:          string;
  reading_count: number;
  latest:        IntradayReading | null;
  readings:      IntradayReading[];
}

// ── Auto-refresh hook: fetches today's intraday readings, refreshes every 60s ──
function useLive(vehicleDesc: string | null) {
  const [data,      setData]      = useState<IntradayResponse | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [countdown, setCountdown] = useState(60);

  const poll = useCallback(async (desc: string) => {
    try {
      const res = await fetch(
        `/api/fuel-management/vehicle/${encodeURIComponent(desc)}/intraday`,
      );
      if (!res.ok) return;
      setData(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!vehicleDesc) return;
    let alive = true;
    setData(null); setCountdown(60); setLoading(true);
    poll(vehicleDesc).finally(() => { if (alive) setLoading(false); });
    const ri = setInterval(() => { if (alive) { poll(vehicleDesc); setCountdown(60); } }, 60_000);
    const ti = setInterval(() => { if (alive) setCountdown(c => Math.max(0, c - 1)); }, 1_000);
    return () => { alive = false; clearInterval(ri); clearInterval(ti); };
  }, [vehicleDesc, poll]);

  return { data, loading, countdown };
}

// ── Animated SVG arc gauge ────────────────────────────────────────
function FuelGauge({ pct, capacity }: { pct: number; capacity: number }) {
  const cx = 90, cy = 85, r = 68;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const coord = (deg: number) => {
    const a = ((deg % 360) + 360) % 360;
    return `${(cx + r * Math.cos(toRad(a))).toFixed(1)} ${(cy + r * Math.sin(toRad(a))).toFixed(1)}`;
  };
  const arcPath  = `M ${coord(135)} A ${r} ${r} 0 1 1 ${coord(45)}`;
  const totalLen = 2 * Math.PI * r * 0.75;
  const c   = Math.min(Math.max(pct, 0), 100);
  const col = c >= 50 ? "#2e7d32" : c >= 20 ? "#e65100" : "#c62828";
  const rem = Math.round((c / 100) * capacity);

  return (
    <svg viewBox="0 0 180 150" width={190} height={150} aria-hidden>
      <path d={arcPath} fill="none" stroke="#e8eef8" strokeWidth="13" strokeLinecap="round" />
      <path
        d={arcPath} fill="none"
        stroke={col} strokeWidth="13" strokeLinecap="round"
        strokeDasharray={`${totalLen.toFixed(1)} ${totalLen.toFixed(1)}`}
        strokeDashoffset={(totalLen * (1 - c / 100)).toFixed(1)}
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.5s" }}
      />
      <text x={cx} y={cy - 8}  textAnchor="middle" fill="#0f1c35" fontSize="28" fontWeight="700" fontFamily="'IBM Plex Mono',monospace">
        {Math.round(c)}%
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill={col} fontSize="11" fontWeight="600" fontFamily="'IBM Plex Mono',monospace">
        ~{rem.toLocaleString("en-IN")} L
      </text>
      <text x={cx} y={cy + 29} textAnchor="middle" fill="#b0bdd4" fontSize="8" fontFamily="sans-serif" letterSpacing="2">
        REMAINING
      </text>
    </svg>
  );
}

function statusColor(status: FuelVehicle["status"]) {
  return status === "good" ? "#2e7d32" : status === "medium" ? "#e65100" : status === "low" ? "#c62828" : "#8899bb";
}

// ── Main modal ────────────────────────────────────────────────────
export default function VehicleDrawer({
  vehicle,
  onClose,
}: {
  vehicle: FuelVehicle | null;
  onClose: () => void;
}) {
  const { data, loading, countdown } = useLive(vehicle?.vehicle_desc ?? null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    if (vehicle) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [vehicle]);

  if (!vehicle) return null;

  const readings = data?.readings ?? [];
  const latest   = data?.latest ?? null;
  const sc       = statusColor(vehicle.status);

  // ── Intraday fuel-level chart ─────────────────────────────────
  const times      = readings.map(r => r.time);
  const fuelLevels = readings.map(r => r.fuel_level_l);
  const lphSeries  = readings.map(r => r.lph);
  const maxLevel   = Math.max(...fuelLevels, vehicle.tank_capacity, 1);

  const chartOption = {
    backgroundColor: "transparent",
    animation: true,
    grid: { top: 40, right: 52, bottom: 32, left: 8, containLabel: true },
    legend: {
      data: ["Fuel Level (L)", "LPH"],
      top: 8, right: 8,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
      itemWidth: 12, itemHeight: 8,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", crossStyle: { color: "#c0cce0" } },
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c",
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(params: Array<{ seriesName: string; value: number; color: string; axisValue: string }>) {
        const t = params[0]?.axisValue ?? "";
        let html = `<div style="font-weight:700;margin-bottom:6px;color:#c8d8f0;font-size:13px">${t}</div>`;
        params.forEach(p => {
          const unit = p.seriesName === "Fuel Level (L)" ? " L" : " L/hr";
          html += `<div style="display:flex;justify-content:space-between;gap:20px;margin-top:3px">
            <span style="color:${p.color}">${p.seriesName}</span>
            <span style="font-weight:700;font-family:'IBM Plex Mono';color:#e8eef8">${(p.value ?? 0).toFixed(1)}${unit}</span>
          </div>`;
        });
        return html;
      },
    },
    xAxis: {
      type: "category",
      data: times,
      axisLine:  { lineStyle: { color: "#d0d9e8" } },
      axisTick:  { show: false },
      axisLabel: {
        fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono",
        // Show every Nth label to avoid overlap
        interval: Math.max(0, Math.floor(times.length / 8) - 1),
      },
      boundaryGap: false,
    },
    yAxis: [
      {
        type: "value",
        name: "Litres",
        max: Math.ceil(maxLevel * 1.05),
        nameTextStyle: { color: "#8899bb", fontSize: 10 },
        axisLabel: { fontSize: 10, color: "#8899bb", formatter: (v: number) => `${v}L` },
        splitLine: { lineStyle: { color: "#eef2f8", type: "dashed" as const } },
        axisLine:  { show: false },
        axisTick:  { show: false },
      },
      {
        type: "value",
        name: "L/hr",
        nameTextStyle: { color: "#8899bb", fontSize: 10 },
        axisLabel: { fontSize: 10, color: "#8899bb", formatter: (v: number) => v.toFixed(1) },
        splitLine: { show: false },
        axisLine:  { show: false },
        axisTick:  { show: false },
      },
    ],
    series: [
      {
        name: "Fuel Level (L)",
        type: "line",
        yAxisIndex: 0,
        data: fuelLevels,
        smooth: 0.3,
        symbol: readings.length <= 30 ? "circle" : "none",
        symbolSize: 5,
        lineStyle: { color: "#1565c0", width: 2.5 },
        itemStyle: { color: "#1565c0" },
        areaStyle: {
          color: {
            type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(21,101,192,0.22)" },
              { offset: 1, color: "rgba(21,101,192,0.02)" },
            ],
          },
        },
      },
      {
        name: "LPH",
        type: "line",
        yAxisIndex: 1,
        data: lphSeries,
        smooth: 0.3,
        symbol: "none",
        lineStyle: { color: "#c8960c", width: 2, type: "dashed" as const },
        itemStyle: { color: "#c8960c" },
      },
    ],
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Centered modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${vehicle.display_name} live fuel data`}
          className="bg-white rounded-xl shadow-2xl flex flex-col w-full overflow-hidden"
          style={{ maxWidth: 820, maxHeight: "90vh", border: "1px solid #d0d9e8" }}
        >

          {/* ── Header ── */}
          <div className="flex items-center gap-4 px-6 py-4 border-b border-[#eef2f8] shrink-0 bg-[#f8fafd]">
            <span className="flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-widest bg-green-50 border border-green-200 text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              LIVE
            </span>

            <div className="w-[64px] h-[48px] rounded-lg bg-[#f0f3f8] flex items-center justify-center shrink-0 overflow-hidden">
              <img src={equipPhoto(vehicle.category)} alt={vehicle.category} className="w-full h-full object-contain" draggable={false} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-bold tracking-[.18em] uppercase text-[#8899bb] mb-0.5">
                {vehicle.category} · Fuel Monitor
              </div>
              <h2 className="font-mono text-[18px] font-bold text-[#0f1c35] truncate leading-tight">
                {vehicle.display_name}
              </h2>
              <p className="text-[11px] text-[#8899bb] font-mono">
                Tank {vehicle.tank_capacity.toLocaleString("en-IN")} L
                &nbsp;·&nbsp;
                {vehicle.source === "man" ? "MAN Fleet" : "Equipment Fleet"}
                {data && <span className="ml-2 text-[#b0bdd4]">· {data.reading_count} readings today</span>}
              </p>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[8px] font-mono tracking-widest text-[#b0bdd4] uppercase">Refresh in</span>
                <span className="font-mono text-[22px] font-bold text-[#c8960c] leading-none tabular-nums">
                  {String(countdown).padStart(2, "0")}s
                </span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8899bb] hover:text-[#0f1c35] hover:bg-[#eef2f8] transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto">

            {loading && (
              <div className="flex flex-col items-center justify-center gap-3 py-20">
                <div className="w-8 h-8 border-2 border-[#d0d9e8] border-t-[#c8960c] rounded-full animate-spin" />
                <span className="text-[12px] text-[#8899bb] font-mono">Fetching live data…</span>
              </div>
            )}

            {!loading && (
              <div className="px-6 py-5 flex flex-col gap-5">

                {/* ── Gauge + Stat cards ── */}
                <div className="flex items-stretch gap-4">
                  <div className="shrink-0 flex items-center justify-center border border-[#eef2f8] rounded-xl bg-[#f8fafd] px-3 py-2">
                    <FuelGauge
                      pct={latest?.fuel_pct ?? vehicle.fuel_pct}
                      capacity={vehicle.tank_capacity}
                    />
                  </div>

                  <div className="flex-1 grid grid-cols-2 gap-3">
                    {([
                      {
                        icon: Zap, label: "Consumed Today",
                        val: latest ? `${latest.fuel_consumed.toLocaleString("en-IN")} L` : "—",
                        color: "#1565c0",
                      },
                      {
                        icon: Clock, label: "Engine Hours",
                        val: latest && latest.engine_hours > 0 ? `${latest.engine_hours.toFixed(1)} h` : "—",
                        color: "#6a1b9a",
                      },
                      {
                        icon: Droplets, label: "Live LPH",
                        val: latest && latest.lph > 0 ? latest.lph.toFixed(1) : "—",
                        color: "#c8960c",
                      },
                      {
                        icon: AlertTriangle, label: "Status",
                        val: vehicle.status.toUpperCase(),
                        color: sc,
                      },
                    ] as const).map(({ icon: Icon, label, val, color }) => (
                      <div key={label} className="bg-[#f8fafd] border border-[#eef2f8] rounded-lg px-4 py-3 flex flex-col">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Icon size={11} style={{ color }} />
                          <span className="text-[9px] font-bold tracking-[.15em] uppercase font-mono text-[#8899bb]">{label}</span>
                        </div>
                        <span
                          className="font-mono text-[17px] font-bold text-[#0f1c35] mt-auto"
                          style={label === "Status" ? { color } : {}}
                        >
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Intraday fuel level chart ── */}
                <div className="border border-[#eef2f8] rounded-lg overflow-hidden">
                  <div className="px-4 pt-3 pb-2 border-b border-[#eef2f8] bg-[#f8fafd] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#1565c0] animate-pulse" />
                      <span className="font-condensed text-[11px] font-bold tracking-[.14em] uppercase text-[#8899bb]">
                        Fuel Level · Today (Live 24h)
                      </span>
                    </div>
                    {readings.length > 0 && (
                      <span className="text-[10px] font-mono text-[#b0bdd4]">
                        {readings[0].time} – {readings[readings.length - 1].time}
                      </span>
                    )}
                  </div>
                  {readings.length === 0 ? (
                    <div className="h-[200px] flex items-center justify-center">
                      <span className="text-[12px] text-[#b0bdd4] font-mono">No readings for today yet</span>
                    </div>
                  ) : (
                    <ReactECharts
                      option={chartOption}
                      style={{ height: "220px" }}
                      opts={{ renderer: "canvas" }}
                      notMerge
                    />
                  )}
                </div>

              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="shrink-0 px-6 py-3 border-t border-[#eef2f8] bg-[#f8fafd] flex items-center justify-between gap-4">
            <p className="text-[9px] font-mono text-[#b0bdd4] truncate">
              <span className="font-semibold text-[#c8d0e0]">SOURCE · </span>
              Technoton GPS-fuel sensor · intraday snapshots · auto-refreshes every 60s
            </p>
            <button
              onClick={onClose}
              className="shrink-0 px-4 py-1.5 rounded-lg border border-[#d0d9e8] bg-white hover:bg-[#eef2f8] text-[11px] font-semibold text-[#3a4a6b] transition-colors"
            >
              Close
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
