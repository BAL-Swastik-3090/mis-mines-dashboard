'use client';
import { useEffect, useRef } from 'react';
import type { VehicleData } from '@/types';
import { drawTank } from '@/utils/tankRenderer';
import { vehicleWaveOpts } from '@/hooks/useLiveTracking';

interface Props {
  vehicle: VehicleData;
  phase:   number;
  onClick: (v: VehicleData) => void;
}

// Accent colour per category
const CATEGORY_COLOR: Record<string, string> = {
  'Tipper':        '#c88018',
  'Diesel Tanker': '#c88018',
  'Excavator':     '#28a08c',
  'Grader':        '#3880c0',
  'Dozer':         '#8060c0',
  'JCB':           '#c05838',
  'Compactor':     '#409850',
  'Hydra':         '#2898c0',
  'Drill':         '#b04060',
};

function fuelLevelColor(pct: number): string {
  return pct > 0.62 ? '#20904a' : pct > 0.28 ? '#c87820' : '#c04040';
}

function timeSince(isoString: string | null): string {
  if (!isoString) return '—';
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function VehicleKpiCard({ vehicle: v, phase, onClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accent    = CATEGORY_COLOR[v.category] ?? '#c88018';
  const tankPct   = v.tank_capacity > 0
    ? Math.min(1, v.final_fuel_level / v.tank_capacity)
    : 0;
  const engPct    = Math.min(1, v.engine_hours / 16);
  const engColor  = engPct > 0.85 ? '#c04040' : engPct > 0.65 ? '#c87820' : '#3880c0';
  const fuelColor = fuelLevelColor(tankPct);
  const isActive  = v.engine_hours > 0 && v.has_data;

  // Draw tank on every phase change
  useEffect(() => {
    if (!canvasRef.current || !v.has_data) return;
    drawTank(canvasRef.current, tankPct, phase, vehicleWaveOpts(v));
  }, [phase, tankPct, v]);

  // ── NO DATA card ──────────────────────────────────────────────
  if (!v.has_data) {
    return (
      <div
        className="vehicle-card vehicle-card--nodata"
        style={{ '--accent': accent } as React.CSSProperties}
      >
        <div className="vc-top">
          <span className="vc-name">{v.display_name}</span>
          <span className="vc-tag" style={{ borderColor: `${accent}55`, color: accent }}>
            {v.category}
          </span>
        </div>
        <div className="vc-nodata-body">
          <span className="vc-nodata-icon">📡</span>
          <span className="vc-nodata-txt">NO DATA</span>
          <span className="vc-nodata-sub">No sensor sync today</span>
        </div>
      </div>
    );
  }

  // ── DATA card ─────────────────────────────────────────────────
  return (
    <div
      className="vehicle-card"
      style={{ '--accent': accent } as React.CSSProperties}
      onClick={() => onClick(v)}
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(v)}
      role="button"
      aria-label={`Open ${v.display_name} details`}
    >
      <div className="vc-top">
        <span className="vc-name">{v.display_name}</span>
        <span className="vc-tag" style={{ borderColor: `${accent}55`, color: accent }}>
          {v.category}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={360}
        height={100}
        className="vc-tank"
        style={{ width: '100%', height: 80 }}
      />

      {/* Engine hours bar */}
      <div className="vc-eng">
        <div className="vc-eng-label">Engine Hours</div>
        <div className="vc-eng-track">
          <div
            className="vc-eng-fill"
            style={{ width: `${(engPct * 100).toFixed(1)}%`, background: engColor }}
          />
        </div>
        <div className="vc-eng-val" style={{ color: engColor }}>
          {v.engine_hours.toFixed(1)} / 16 hrs
        </div>
      </div>

      {/* Footer */}
      <div className="vc-footer">
        <span
          className="vc-dot"
          style={{
            background: isActive ? '#20904a' : '#3d5870',
            animation: isActive ? 'vcPulse 2s ease-in-out infinite' : 'none',
          }}
        />
        <span className="vc-status-txt">
          {isActive ? `Active · ${timeSince(v.last_seen)}` : 'Parked'}
        </span>
        <span className="vc-fuel-val" style={{ color: fuelColor }}>
          {v.final_fuel_level.toFixed(0)} L
        </span>
        <span className="vc-details-link">Details →</span>
      </div>
    </div>
  );
}
