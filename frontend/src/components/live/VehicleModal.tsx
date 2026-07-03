'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import type { VehicleData } from '@/types';
import { drawTank }        from '@/utils/tankRenderer';
import { vehicleWaveOpts } from '@/hooks/useLiveTracking';

interface GraphPoint  { t: number; level: number; fill: boolean; }
interface TooltipState { x: number; y: number; t: number; level: number; fill: boolean; }

interface Props {
  vehicle: VehicleData;
  phase:   number;
  onClose: () => void;
}

function fuelColor(pct: number): string {
  return pct > 0.62 ? '#20904a' : pct > 0.28 ? '#c87820' : '#c04040';
}

// Compute actual clock time for a graph point.
// last_seen = tripDate (DATETIME from DB, e.g. "2025-06-27T14:35:00")
// shiftStart = last_seen − engine_hours
// pointTime  = shiftStart + t hours
function pointClockTime(lastSeen: string | null, engineHours: number, t: number): string {
  if (!lastSeen) return '';
  const lastMs     = new Date(lastSeen).getTime();
  if (isNaN(lastMs)) return '';
  const shiftStart = lastMs - engineHours * 3_600_000;
  const pointMs    = shiftStart + t * 3_600_000;
  return new Date(pointMs).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// tripDate is a DATE column (no time part) — show day label, not misleading relative time
function formatLastSeen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dt    = new Date(d); dt.setHours(0, 0, 0, 0);
  const diff  = Math.round((today.getTime() - dt.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// Build intra-day simulated graph. Returns [] if no engine time recorded.
function buildHistory(v: VehicleData): GraphPoint[] {
  const hrNow = v.engine_hours;
  if (!hrNow || hrNow <= 0) return [];
  const pts: GraphPoint[] = [];
  const steps = Math.max(12, Math.round(hrNow * 12)); // 5-min intervals
  let level   = v.initial_fuel_level;
  const drop  = v.fuel_consumed > 0
    ? v.fuel_consumed / steps
    : Math.max(0, v.initial_fuel_level - v.final_fuel_level) / steps;

  for (let i = 0; i <= steps; i++) {
    const t      = (hrNow / steps) * i;
    const isFill = v.total_fillings > 0 && i === Math.round(steps * 0.32);
    if (isFill) level = Math.min(v.tank_capacity, level + v.filled_litres);
    else        level = Math.max(0, level - drop);
    pts.push({ t, level: parseFloat(level.toFixed(1)), fill: isFill });
  }
  pts[pts.length - 1].level = v.final_fuel_level;
  return pts;
}

// Pick a human-friendly tick interval for the x axis
function niceXTicks(dataMax: number, xMax: number): number[] {
  const candidates = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12];
  const rawStep = dataMax / 5;
  const step    = candidates.find(c => c >= rawStep) ?? 12;
  const ticks: number[] = [];
  for (let t = 0; t <= xMax + 0.001; t += step)
    ticks.push(parseFloat(t.toFixed(6)));
  return ticks;
}

function drawGraph(
  canvas: HTMLCanvasElement,
  history: GraphPoint[],
  tank: number,
  highlight?: { nx: number; ny: number } | null
) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || history.length < 2) return;
  ctx.clearRect(0, 0, W, H);

  const pad  = { l: 42, r: 14, t: 10, b: 28 };
  const gW   = W - pad.l - pad.r;
  const gH   = H - pad.t - pad.b;
  const dataMax = history[history.length - 1].t;
  const xMax = Math.max(dataMax * 1.05, 1);
  const yMax = tank || 300;
  const xS   = (pt: GraphPoint) => pad.l + (pt.t / xMax) * gW;
  const yS   = (pt: GraphPoint) => pad.t + gH - (pt.level / yMax) * gH;
  const xTicks = niceXTicks(dataMax, xMax);

  // Grid
  ctx.strokeStyle = 'rgba(15,28,53,0.06)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (gH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + gW, y); ctx.stroke();
  }
  xTicks.forEach(t => {
    const x = pad.l + (t / xMax) * gW;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + gH); ctx.stroke();
  });

  // Fill event markers
  history.forEach(pt => {
    if (!pt.fill) return;
    const x = xS(pt);
    ctx.strokeStyle = 'rgba(40,160,140,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + gH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(40,160,140,0.85)';
    ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('+FILL', x + 3, pad.t + 10);
  });

  // Area fill
  const aG = ctx.createLinearGradient(0, pad.t, 0, pad.t + gH);
  aG.addColorStop(0,   'rgba(200,128,24,0.28)');
  aG.addColorStop(0.6, 'rgba(200,128,24,0.08)');
  aG.addColorStop(1,   'rgba(200,128,24,0.01)');
  ctx.beginPath();
  ctx.moveTo(xS(history[0]), pad.t + gH);
  history.forEach(pt => ctx.lineTo(xS(pt), yS(pt)));
  ctx.lineTo(xS(history[history.length - 1]), pad.t + gH);
  ctx.closePath(); ctx.fillStyle = aG; ctx.fill();

  // Line
  ctx.beginPath();
  history.forEach((pt, i) => i === 0 ? ctx.moveTo(xS(pt), yS(pt)) : ctx.lineTo(xS(pt), yS(pt)));
  ctx.strokeStyle = '#c88018'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.setLineDash([]); ctx.stroke();

  // Y labels
  ctx.fillStyle = '#94a3b8'; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    ctx.fillText(
      String(Math.round((yMax / 4) * (4 - i))),
      pad.l - 4, pad.t + (gH / 4) * i + 3
    );
  }

  // X labels
  ctx.textAlign = 'center';
  xTicks.forEach(t => {
    const x = pad.l + (t / xMax) * gW;
    const label = Number.isInteger(t) ? `${t}h` : `${t.toFixed(1)}h`;
    ctx.fillText(label, x, pad.t + gH + 14);
  });

  // Crosshair / endpoint
  if (highlight) {
    const { nx, ny } = highlight;
    ctx.strokeStyle = 'rgba(15,28,53,0.22)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(nx, pad.t); ctx.lineTo(nx, pad.t + gH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad.l, ny); ctx.lineTo(pad.l + gW, ny); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(nx, ny, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#c88018'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  } else {
    const last = history[history.length - 1];
    ctx.beginPath(); ctx.arc(xS(last), yS(last), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f0a830'; ctx.fill();
    const nx = xS(last);
    ctx.strokeStyle = 'rgba(15,28,53,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(nx, pad.t); ctx.lineTo(nx, pad.t + gH); ctx.stroke();
    ctx.setLineDash([]);
  }
}

export default function VehicleModal({ vehicle: v, phase, onClose }: Props) {
  const tankRef  = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<HTMLCanvasElement>(null);
  // Initialise synchronously so first render can show the graph
  const histRef  = useRef<GraphPoint[]>(buildHistory(v));
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Rebuild history if a different vehicle is opened
  useEffect(() => {
    histRef.current = buildHistory(v);
  }, [v.vehicle_desc]);

  // Animate tank hero
  useEffect(() => {
    if (!tankRef.current) return;
    const pct = v.tank_capacity > 0 ? Math.min(1, v.final_fuel_level / v.tank_capacity) : 0;
    drawTank(tankRef.current, pct, phase, { ...vehicleWaveOpts(v), legs: true });
  }, [phase, v]);

  // Draw graph (resize canvas to container width first)
  useEffect(() => {
    const canvas = graphRef.current;
    if (!canvas) return;
    const w = canvas.offsetWidth;
    if (w > 0) { canvas.width = w; canvas.height = 130; }
    drawGraph(canvas, histRef.current, v.tank_capacity);
  }, [v]);

  // ── Graph hover ──────────────────────────────────────────────────
  const onGraphMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = graphRef.current;
    if (!canvas || histRef.current.length < 2) return;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx     = (e.clientX - rect.left) * scaleX;

    const pad = { l: 42, r: 14, t: 10, b: 28 };
    const gW  = canvas.width  - pad.l - pad.r;
    const gH  = canvas.height - pad.t - pad.b;
    const dataMax = histRef.current[histRef.current.length - 1].t;
    const xMax    = Math.max(dataMax * 1.05, 1);
    const yMax    = v.tank_capacity || 300;

    if (mx < pad.l || mx > pad.l + gW) { setTooltip(null); return; }

    const tCursor = (mx - pad.l) / gW * xMax;
    const nearest = histRef.current.reduce((prev, cur) =>
      Math.abs(cur.t - tCursor) < Math.abs(prev.t - tCursor) ? cur : prev
    );

    const nx = pad.l + (nearest.t / xMax) * gW;
    const ny = pad.t + gH - (nearest.level / yMax) * gH;

    drawGraph(canvas, histRef.current, v.tank_capacity, { nx, ny });

    // Flip tooltip to left if near right edge
    const dispX = nx / scaleX;
    const dispY = ny / scaleY;
    setTooltip({
      x:     dispX > rect.width * 0.65 ? dispX - 132 : dispX + 14,
      y:     Math.max(4, dispY - 42),
      t:     nearest.t,
      level: nearest.level,
      fill:  nearest.fill,
    });
  }, [v]);

  const onGraphLeave = useCallback(() => {
    setTooltip(null);
    const canvas = graphRef.current;
    if (canvas) drawGraph(canvas, histRef.current, v.tank_capacity);
  }, [v]);

  // Keyboard / backdrop close
  const onBackdrop = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const tankPct  = v.tank_capacity > 0 ? Math.min(1, v.final_fuel_level / v.tank_capacity) : 0;
  const engPct   = Math.min(1, v.engine_hours / 16);
  const engColor = engPct > 0.85 ? '#c04040' : engPct > 0.65 ? '#c87820' : '#3880c0';
  const fCol     = fuelColor(tankPct);
  const hasGraph = histRef.current.length >= 2;

  return (
    <div className="modal-overlay" onClick={onBackdrop} role="dialog" aria-modal="true">
      <div className="modal-box">

        {/* ── Header ── */}
        <div className="modal-header">
          <div className="modal-accent" style={{ background: '#c88018' }} />
          <div className="modal-header-text">
            <div className="modal-title">{v.display_name}</div>
            <div className="modal-subtitle">
              {v.category} · {formatLastSeen(v.last_seen)}
            </div>
          </div>
          <div className="modal-live-badge"><span className="live-dot" />Live</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">

          {/* ── ROW 1: Tank + side cards ── */}
          <div className="modal-top">
            <div className="modal-tank-wrap">
              <div className="modal-section-label">⛽ Fuel Tank — Current Level</div>
              <canvas ref={tankRef} width={680} height={190} className="modal-tank-canvas" />
              <div className="modal-tank-vals">
                <div>
                  <div className="mtv-val" style={{ color: fCol }}>{v.final_fuel_level.toFixed(0)} L</div>
                  <div className="mtv-unit">remaining</div>
                </div>
                <div className="mtv-divider" />
                <div>
                  <div className="mtv-val" style={{ color: fCol }}>{v.fuel_consumed.toFixed(1)} L</div>
                  <div className="mtv-unit">consumed today</div>
                </div>
                <div className="mtv-divider" />
                <div>
                  <div className="mtv-val" style={{ color: fCol }}>{Math.round(tankPct * 100)}%</div>
                  <div className="mtv-unit">tank level</div>
                </div>
              </div>
            </div>

            <div className="modal-side">
              <div className="side-card">
                <div className="side-card-icon">⏱</div>
                <div className="side-card-label">Engine Hours</div>
                <div className="side-card-val" style={{ color: engColor }}>
                  {v.engine_hours.toFixed(1)}
                </div>
                <div className="side-card-unit">hrs today</div>
                <div className="side-eng-track">
                  <div className="side-eng-fill"
                    style={{ width: `${(engPct * 100).toFixed(1)}%`, background: engColor }} />
                </div>
                <div className="side-eng-sub">of 16 hr shift</div>
              </div>
              <div className="side-card">
                <div className="side-card-icon">🏎</div>
                <div className="side-card-label">Avg Speed</div>
                <div className="side-card-val" style={{ color: '#28a08c' }}>
                  {v.avg_speed.toFixed(0)}
                </div>
                <div className="side-card-unit">km / h</div>
              </div>
            </div>
          </div>

          {/* ── ROW 2: Graph ── */}
          <div className="modal-graph-wrap">
            <div className="modal-graph-header">
              <span className="modal-section-label">
                📈 Fuel Level — Today
                <span className="graph-est-label">(estimated trend)</span>
              </span>
              <div className="graph-legend">
                <span className="legend-item">
                  <span className="legend-dot" style={{ background: '#c88018' }} />Fuel Level (L)
                </span>
                <span className="legend-item">
                  <span className="legend-line" style={{ background: '#28a08c' }} />Fill Event
                </span>
              </div>
            </div>

            {hasGraph ? (
              <div className="graph-hover-wrap">
                <canvas
                  ref={graphRef}
                  width={740} height={130}
                  className="modal-graph-canvas"
                  style={{ width: '100%', height: 130, cursor: 'crosshair' }}
                  onMouseMove={onGraphMove}
                  onMouseLeave={onGraphLeave}
                />
                {tooltip && (
                  <div className="graph-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
                    <div className="gt-time">
                      {pointClockTime(v.last_seen, v.engine_hours, tooltip.t)}
                    </div>
                    <div className="gt-level">{tooltip.level.toFixed(0)} L</div>
                    {tooltip.fill && <div className="gt-fill">⛽ Fill event</div>}
                  </div>
                )}
              </div>
            ) : (
              <div className="graph-no-data">No engine hours recorded today</div>
            )}
          </div>

          {/* ── ROW 3: 4 stats ── */}
          <div className="stat-grid-4">
            <div className="stat-box">
              <span className="stat-icon">🛣</span>
              <div className="stat-val" style={{ color: '#c88018' }}>{v.distance_km.toFixed(0)} km</div>
              <div className="stat-label">Distance</div>
            </div>
            <div className="stat-box">
              <span className="stat-icon">⛽</span>
              <div className="stat-val" style={{ color: '#28a08c' }}>{v.lph.toFixed(1)} L/hr</div>
              <div className="stat-label">Mileage</div>
            </div>
            <div className="stat-box">
              <span className="stat-icon">🟢</span>
              <div className="stat-val" style={{ color: '#20904a' }}>{v.initial_fuel_level.toFixed(0)} L</div>
              <div className="stat-label">Initial<br />Fuel Level</div>
            </div>
            <div className="stat-box">
              <span className="stat-icon">🔴</span>
              <div className="stat-val" style={{ color: fCol }}>{v.final_fuel_level.toFixed(0)} L</div>
              <div className="stat-label">Final<br />Fuel Level</div>
            </div>
          </div>

          {/* ── ROW 4: 3 stats ── */}
          <div className="stat-grid-3">
            <div className="stat-box">
              <span className="stat-icon">🔋</span>
              <div className="stat-val" style={{ color: '#28a08c' }}>{v.total_fillings} times</div>
              <div className="stat-label">Total<br />Fillings</div>
            </div>
            <div className="stat-box">
              <span className="stat-icon">🪣</span>
              <div className="stat-val" style={{ color: '#c04040' }}>{v.total_drains} times</div>
              <div className="stat-label">Total<br />Drained</div>
            </div>
            <div className="stat-box">
              <span className="stat-icon">💧</span>
              <div className="stat-val" style={{ color: '#3880c0' }}>
                {v.filled_litres > 0 ? `${v.filled_litres.toFixed(0)} L` : '—'}
              </div>
              <div className="stat-label">Filled<br />Amount</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
