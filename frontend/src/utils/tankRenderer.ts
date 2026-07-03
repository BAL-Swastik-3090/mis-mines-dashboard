export interface TankSensorOpts {
  /** Current average speed km/h — drives wave amplitude */
  avgSpeed?: number;
  /** Max speed for normalisation (default 120) */
  maxSpeed?: number;
  /** Active fill event → inward turbulence burst */
  filling?: boolean;
  /** Active drain event → outward ripple burst */
  draining?: boolean;
  /** Engine running → idle micro-vibration */
  engOn?: boolean;
  /** Fuel consumed today (L) — adds turbulence proportional to consumption rate */
  fuelConsumed?: number;
  /** Max expected fuel consumed for normalisation (default 300) */
  maxFuelConsumed?: number;
  /** Show support legs below tank */
  legs?: boolean;
}

// ────────────────────────────────────────────────
//  Colour helpers
// ────────────────────────────────────────────────
function fuelColor(p: number): string {
  return p > 0.62 ? '#20904a' : p > 0.28 ? '#c87820' : '#c04040';
}
function fuelColorDark(p: number): string {
  return p > 0.62 ? '#155e30' : p > 0.28 ? '#8a5010' : '#8a2020';
}
function fuelColorLight(p: number): string {
  return p > 0.62 ? '#36d870' : p > 0.28 ? '#f0a830' : '#e85050';
}

// ────────────────────────────────────────────────
//  Rounded-rect path helper
// ────────────────────────────────────────────────
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ────────────────────────────────────────────────
//  Hatch / manhole detail
// ────────────────────────────────────────────────
function drawHatch(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  // Flange ring
  const fg = ctx.createRadialGradient(cx - size * 0.2, cy - size * 0.25, size * 0.05, cx, cy, size * 1.1);
  fg.addColorStop(0, '#d8eaf8');
  fg.addColorStop(0.4, '#a0b8cc');
  fg.addColorStop(1, '#5a7890');
  ctx.beginPath(); ctx.ellipse(cx, cy, size, size * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = fg; ctx.fill();
  ctx.strokeStyle = 'rgba(28,48,70,0.4)'; ctx.lineWidth = 0.8; ctx.stroke();

  // Bolt ring
  ctx.strokeStyle = 'rgba(40,60,80,0.5)';
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.ellipse(cx, cy, size * 0.85, size * 0.34, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Bolts
  ctx.fillStyle = '#4a6070';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * size * 0.75, cy + Math.sin(a) * size * 0.33, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Raised dome
  const dg = ctx.createRadialGradient(cx - size * 0.12, cy - size * 0.16, 0.5, cx, cy, size * 0.68);
  dg.addColorStop(0, '#dce8f6');
  dg.addColorStop(0.3, '#b0c2d4');
  dg.addColorStop(1, '#6a7e90');
  ctx.beginPath(); ctx.ellipse(cx, cy, size * 0.68, size * 0.30, 0, 0, Math.PI * 2);
  ctx.fillStyle = dg; ctx.fill();
  ctx.strokeStyle = 'rgba(28,48,70,0.3)'; ctx.lineWidth = 0.6; ctx.stroke();

  // Center nut
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = '#58687a'; ctx.fill();

  // Dome shine
  ctx.beginPath(); ctx.ellipse(cx - size * 0.12, cy - size * 0.1, size * 0.22, size * 0.08, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
}

// ────────────────────────────────────────────────
//  Main tank renderer
// ────────────────────────────────────────────────
export function drawTank(
  canvas: HTMLCanvasElement,
  pct: number,
  phase: number,
  opts: TankSensorOpts = {}
) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  pct = Math.max(0, Math.min(1, pct));

  // ── Wave parameters from sensor data ──────────────────
  const avgSpeed       = opts.avgSpeed ?? 0;
  const maxSpd         = opts.maxSpeed ?? 120;
  const spdN           = Math.min(avgSpeed / maxSpd, 1);
  const fuelConsumed   = opts.fuelConsumed ?? 0;
  const maxFuelCons    = opts.maxFuelConsumed ?? 300;
  const consumeN       = Math.min(fuelConsumed / maxFuelCons, 1);  // fuel consumption drives turbulence
  const filling        = !!opts.filling;
  const draining       = !!opts.draining;
  const engOn          = opts.engOn !== false;

  const baseAmp  = Math.min(9, H * 0.075);
  const idleAmp  = engOn ? baseAmp * 0.08 : baseAmp * 0.02;
  const spdAmp   = baseAmp * spdN * 0.6;
  const consAmp  = baseAmp * consumeN * 0.4;   // fuel consumed → extra choppiness
  const evtAmp   = (filling || draining) ? baseAmp * 0.55 : 0;
  const wAmp     = idleAmp + spdAmp + consAmp + evtAmp;

  const wFreq1   = 0.20 + spdN * 0.14;
  const wFreq2   = 0.09 + spdN * 0.06 + consumeN * 0.04;
  const phOff    = filling ? phase * 1.6 : draining ? phase * 2.1 : phase;

  // ── Geometry ───────────────────────────────────────────
  const pX = W * 0.065, pY = H * (opts.legs ? 0.06 : 0.10);
  const bX = pX, bY = pY;
  const bW = W - pX * 2, bH = H - pY * (opts.legs ? 2.4 : 2.0);
  const cx = bX + bW / 2, cy = bY + bH / 2;
  const cRx = bH * 0.21;
  const cRy = bH / 2;

  // ── Left cap ───────────────────────────────────────────
  const lg = ctx.createRadialGradient(bX - cRx * 0.3, cy - cRy * 0.35, cRy * 0.04, bX, cy, cRy * 1.05);
  lg.addColorStop(0, '#eef4fc');
  lg.addColorStop(0.25, '#d2e2f0');
  lg.addColorStop(0.6, '#94aec0');
  lg.addColorStop(1, '#587890');
  ctx.save();
  ctx.beginPath(); ctx.ellipse(bX, cy, cRx, cRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = lg; ctx.fill();
  ctx.strokeStyle = 'rgba(35,60,88,.5)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();

  // ── Right cap ──────────────────────────────────────────
  const rg = ctx.createRadialGradient(bX + bW + cRx * 0.2, cy - cRy * 0.3, cRy * 0.04, bX + bW, cy, cRy);
  rg.addColorStop(0, '#7898b0');
  rg.addColorStop(0.5, '#506888');
  rg.addColorStop(1, '#304858');
  ctx.save();
  ctx.beginPath(); ctx.ellipse(bX + bW, cy, cRx, cRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = rg; ctx.fill();
  ctx.strokeStyle = 'rgba(35,60,88,.5)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();

  // ── Clipped body ───────────────────────────────────────
  ctx.save();
  ctx.beginPath(); rrect(ctx, bX, bY, bW, bH, cRx); ctx.clip();

  // Empty space
  const eG = ctx.createLinearGradient(0, bY, 0, bY + bH);
  eG.addColorStop(0, 'rgba(18,26,40,0.95)');
  eG.addColorStop(1, 'rgba(10,16,28,0.98)');
  ctx.fillStyle = eG;
  ctx.fillRect(bX - cRx, bY, bW + cRx * 2, bH);

  // Fuel fill + wave
  if (pct > 0.01) {
    const fTY  = bY + bH * (1 - pct);
    const col  = fuelColor(pct);
    const colB = fuelColorDark(pct);
    const colT = fuelColorLight(pct);

    // Fuel body
    const fg2 = ctx.createLinearGradient(0, fTY, 0, bY + bH);
    fg2.addColorStop(0, colT);
    fg2.addColorStop(0.15, col);
    fg2.addColorStop(0.75, colB);
    fg2.addColorStop(1, colB);
    ctx.fillStyle = fg2;
    ctx.fillRect(bX - cRx, fTY + 4, bW + cRx * 2, bH * pct + 4);

    // Wave surface — driven by sensor data
    const wX0 = bX - cRx - 30, wX1 = bX + bW + cRx + 30;
    ctx.beginPath();
    for (let i = 0, x = wX0; x <= wX1; x += 1.5, i++) {
      const y = fTY
        + Math.sin(x / (bW * wFreq1) + phOff) * wAmp
        + Math.sin(x / (bW * wFreq2) + phOff * 1.8 + 1.2) * (wAmp * 0.35)
        + ((filling || draining)
          ? Math.sin(x / (bW * 0.05) + phOff * 3.5) * (wAmp * 0.2)
          : 0);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(wX1, bY + bH + 4);
    ctx.lineTo(wX0, bY + bH + 4);
    ctx.closePath();
    const wg2 = ctx.createLinearGradient(0, fTY - wAmp, 0, fTY + wAmp * 5);
    wg2.addColorStop(0, colT + 'bb');
    wg2.addColorStop(0.3, col);
    wg2.addColorStop(1, colB);
    ctx.fillStyle = wg2; ctx.fill();

    // Caustic shimmer
    const shimX = cx + Math.sin(phOff * 0.7) * bW * (0.08 + spdN * 0.16);
    const shimA = Math.min(0.4, 0.12 + spdN * 0.22 + consumeN * 0.08 + (filling || draining ? 0.14 : 0));
    const shG = ctx.createRadialGradient(shimX, fTY, 0, shimX, fTY, bW * (0.14 + spdN * 0.12));
    shG.addColorStop(0, `rgba(255,220,120,${shimA.toFixed(2)})`);
    shG.addColorStop(0.5, `rgba(255,200,80,${(shimA * 0.38).toFixed(2)})`);
    shG.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.beginPath(); ctx.ellipse(shimX, fTY, bW * 0.22, bH * 0.06, 0, 0, Math.PI * 2);
    ctx.fillStyle = shG; ctx.fill();
  }

  // Metallic overlay — semi-transparent chrome effect (reveals fuel through the body)
  const bodyOv = ctx.createLinearGradient(0, bY, 0, bY + bH);
  bodyOv.addColorStop(0,    'rgba(228,240,252,0.94)');
  bodyOv.addColorStop(0.30, 'rgba(175,200,222,0.42)');
  bodyOv.addColorStop(0.44, 'rgba(150,178,205,0.10)');
  bodyOv.addColorStop(0.56, 'rgba(150,178,205,0.10)');
  bodyOv.addColorStop(0.85, 'rgba(90,120,148,0.72)');
  bodyOv.addColorStop(1,    'rgba(60,88,112,0.90)');
  ctx.fillStyle = bodyOv;
  ctx.fillRect(bX - cRx, bY, bW + cRx * 2, bH);

  // Circumferential bands
  for (let xi = 0; xi < 2; xi++) {
    const bndX = bX + bW * (xi === 0 ? 0.28 : 0.72);
    const bandGr = ctx.createLinearGradient(0, bY, 0, bY + bH);
    bandGr.addColorStop(0, 'rgba(200,220,240,0.18)');
    bandGr.addColorStop(0.5, 'rgba(80,110,140,0.38)');
    bandGr.addColorStop(1, 'rgba(40,70,100,0.28)');
    ctx.fillStyle = bandGr;
    ctx.fillRect(bndX - 3, bY, 6, bH);
  }

  ctx.restore();

  // Body outline
  ctx.save();
  ctx.beginPath(); rrect(ctx, bX, bY, bW, bH, cRx);
  ctx.strokeStyle = 'rgba(180,210,240,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();

  // Top specular highlight
  const specG = ctx.createRadialGradient(cx, bY + bH * 0.12, 0, cx, bY + bH * 0.2, bW * 0.38);
  specG.addColorStop(0, 'rgba(255,255,255,0.32)');
  specG.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.ellipse(cx, bY + bH * 0.18, bW * 0.38, bH * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = specG; ctx.fill();

  // Hatches
  const hY = bY - bH * 0.04;
  const hSz = Math.max(10, bH * 0.16);
  for (let hi = 0; hi < 3; hi++) {
    drawHatch(ctx, bX + bW * (0.25 + hi * 0.25), hY, hSz);
  }

  // Support legs
  if (opts.legs) {
    const legY = bY + bH;
    const legH = H - legY - 4;
    const legW = bW * 0.06;
    ctx.fillStyle = 'rgba(60,90,120,0.8)';
    for (const lx of [bX + bW * 0.22, bX + bW * 0.78]) {
      ctx.beginPath();
      ctx.moveTo(lx - legW / 2, legY);
      ctx.lineTo(lx + legW / 2, legY);
      ctx.lineTo(lx + legW * 0.7, legY + legH);
      ctx.lineTo(lx - legW * 0.7, legY + legH);
      ctx.closePath();
      ctx.fill();
    }
    // Base rail
    ctx.fillStyle = 'rgba(80,110,140,0.6)';
    ctx.fillRect(bX + bW * 0.15, legY + legH - 3, bW * 0.7, 5);
  }
}

