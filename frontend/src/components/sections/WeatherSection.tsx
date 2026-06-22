"use client";
import { Cloud, AlertTriangle } from "lucide-react";
import { useWeather } from "@/hooks/useWeather";
import { WEATHER_CONFIG } from "@/lib/weatherConfig";

// ── WMO helpers ───────────────────────────────────────────────
function weatherEmoji(code: number, isDay = 1): string {
  if (code === 0)                      return isDay ? "☀️" : "🌙";
  if ([1, 2].includes(code))           return isDay ? "🌤️" : "🌙";
  if (code === 3)                      return "☁️";
  if ([45, 48].includes(code))         return "🌫️";
  if ([51, 53, 55].includes(code))     return "🌦️";
  if ([61, 63, 65].includes(code))     return "🌧️";
  if ([80, 81, 82].includes(code))     return "🌦️";
  if (code === 95)                     return "⛈️";
  if ([96, 99].includes(code))         return "⛈️";
  return "🌡️";
}

function weatherDesc(code: number): string {
  const m: Record<number, string> = {
    0:"Clear Sky", 1:"Mainly Clear", 2:"Partly Cloudy", 3:"Overcast",
    45:"Foggy", 48:"Icy Fog",
    51:"Light Drizzle", 53:"Drizzle", 55:"Heavy Drizzle",
    61:"Light Rain", 63:"Moderate Rain", 65:"Heavy Rain",
    80:"Rain Showers", 81:"Heavy Showers", 82:"Violent Showers",
    95:"Thunderstorm", 96:"Thunderstorm+Hail", 99:"Thunderstorm+Hail",
  };
  return m[code] ?? "—";
}

function windDir(deg: number): string {
  const d = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return d[Math.round(deg / 22.5) % 16];
}

function dayLabel(s: string) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" }).toUpperCase();
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " IST";
}

// dark=true  → bright/vivid tones for dark glass panel
// dark=false → dark/saturated tones visible on white forecast cards
function tempColor(t: number, dark = false): string {
  if (t >= 42) return dark ? "text-[#ff1744]" : "text-[#b71c1c]";
  if (t >= 38) return dark ? "text-[#ff6d00]" : "text-[#c62828]";
  if (t >= 35) return dark ? "text-[#ffa726]" : "text-[#e65100]";
  if (t >= 30) return dark ? "text-[#ffca28]" : "text-[#c8960c]";
  return dark ? "text-[#81d4fa]" : "text-[#1565c0]";
}

function windColor(spd: number, dark = false): string {
  if (spd >= 30) return dark ? "text-[#ff5252]" : "text-[#c62828]";
  if (spd >= 20) return dark ? "text-[#ffa726]" : "text-[#e65100]";
  if (spd >= 10) return dark ? "text-[#ffca28]" : "text-[#c8960c]";
  return dark ? "text-[#69f0ae]" : "text-[#2e7d32]";
}

function rainStyle(pct: number) {
  if (pct >= 70) return { text: "text-[#1565c0]", bg: "bg-blue-100",  bar: "#1565c0" };
  if (pct >= 50) return { text: "text-[#1976d2]", bg: "bg-blue-50",   bar: "#1976d2" };
  if (pct >= 30) return { text: "text-[#0277bd]", bg: "bg-sky-50",    bar: "#0277bd" };
  if (pct >= 10) return { text: "text-[#00796b]", bg: "bg-teal-50",   bar: "#00897b" };
  return           { text: "text-txt-light",       bg: "bg-bg-section",bar: "#cdd7e8" };
}

function getAlert(code: number, windMax: number, rainPct: number): string | null {
  if ([95, 96, 99].includes(code)) return "⚠️ Thunderstorm — Suspend blasting operations";
  if (windMax >= 40)               return "⚠️ High wind — Review heavy equipment safety";
  if ([65, 82].includes(code))     return "⚠️ Heavy rain — Monitor sump & dewatering levels";
  if (rainPct >= 70)               return "⚠️ High rain probability — Prepare dewatering operations";
  return null;
}

// ── Weather category → animated glass background ──────────────
type WxCategory = "clear_day"|"clear_night"|"partly_cloudy"|"overcast"|"foggy"|"drizzle"|"rainy"|"stormy";

function getCategory(code: number, isDay: number): WxCategory {
  if (code === 0)                      return isDay ? "clear_day" : "clear_night";
  if ([1, 2].includes(code))           return "partly_cloudy";
  if (code === 3)                      return "overcast";
  if ([45, 48].includes(code))         return "foggy";
  if ([51, 53, 55].includes(code))     return "drizzle";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "rainy";
  if ([95, 96, 99].includes(code))     return "stormy";
  return "overcast";
}

const BG: Record<WxCategory, { gradient: string; glass: string; label: string }> = {
  clear_day:    { gradient: "linear-gradient(160deg,#FF8C00,#FFA500,#FF6B35)", glass: "rgba(255,140,0,0.12)",   label: "#ffe0b2" },
  clear_night:  { gradient: "linear-gradient(160deg,#0d0d2b,#1a1a4a,#0a0a20)", glass: "rgba(100,120,200,0.12)", label: "#c5cae9" },
  partly_cloudy:{ gradient: "linear-gradient(160deg,#1565c0,#1976d2,#42a5f5)", glass: "rgba(30,100,200,0.12)",  label: "#bbdefb" },
  overcast:     { gradient: "linear-gradient(160deg,#37474f,#546e7a,#455a64)", glass: "rgba(80,110,130,0.12)",  label: "#cfd8dc" },
  foggy:        { gradient: "linear-gradient(160deg,#78909c,#90a4ae,#607d8b)", glass: "rgba(180,200,210,0.12)", label: "#eceff1" },
  drizzle:      { gradient: "linear-gradient(160deg,#1565c0,#1976d2,#0d47a1)", glass: "rgba(20,80,160,0.12)",   label: "#bbdefb" },
  rainy:        { gradient: "linear-gradient(160deg,#0d2b4e,#1565c0,#0a1f3c)", glass: "rgba(10,50,120,0.15)",   label: "#90caf9" },
  stormy:       { gradient: "linear-gradient(160deg,#12002e,#311b92,#1a0050)", glass: "rgba(60,20,120,0.18)",   label: "#d1c4e9" },
};

// ── Deterministic rain drops (no Math.random → no SSR mismatch) ──
const RAIN_DROPS = Array.from({ length: 16 }, (_, i) => ({
  left:     `${(i * 6.25).toFixed(1)}%`,
  height:   `${10 + (i % 5) * 4}px`,
  width:    i % 3 === 0 ? "2px" : "1.5px",
  delay:    `${((i * 0.11) % 1.5).toFixed(2)}s`,
  duration: `${(0.6 + (i % 4) * 0.13).toFixed(2)}s`,
  opacity:  0.3 + (i % 4) * 0.15,
}));

// Deterministic clouds
const CLOUDS = [
  { top: "10%",  left: "-5%",  width: "100px", height: "28px", duration: "9s",  delay: "0s",  blur: "5px" },
  { top: "38%",  left: "45%",  width: "80px",  height: "22px", duration: "13s", delay: "-4s", blur: "4px" },
  { top: "62%",  left: "5%",   width: "90px",  height: "26px", duration: "11s", delay: "-2s", blur: "6px" },
];

// Stars for clear night
const STARS = Array.from({ length: 12 }, (_, i) => ({
  top:      `${(i * 17 + 5) % 90}%`,
  left:     `${(i * 23 + 8) % 90}%`,
  size:     i % 3 === 0 ? "3px" : "2px",
  duration: `${2 + (i % 3) * 0.8}s`,
  delay:    `${(i * 0.3) % 2}s`,
}));

// ── Animated background elements ─────────────────────────────
function WxBackground({ cat }: { cat: WxCategory }) {
  // Rain drops — shown for drizzle, rainy, stormy
  if (["drizzle", "rainy", "stormy"].includes(cat)) {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {RAIN_DROPS.map((d, i) => (
          <div
            key={i}
            className="absolute top-0 rounded-full"
            style={{
              left: d.left,
              height: d.height,
              width: d.width,
              opacity: d.opacity,
              background: cat === "stormy" ? "rgba(200,210,255,0.8)" : "rgba(180,220,255,0.9)",
              animation: `wx-rain ${d.duration} linear ${d.delay} infinite`,
            }}
          />
        ))}
        {/* Lightning for stormy */}
        {cat === "stormy" && (
          <div
            className="absolute inset-0"
            style={{
              background: "rgba(180,160,255,0.15)",
              animation: "wx-lightning 4s ease-in-out 0s infinite",
            }}
          />
        )}
      </div>
    );
  }

  // Clouds — for cloudy states
  if (["partly_cloudy", "overcast", "foggy"].includes(cat)) {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {CLOUDS.map((c, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              top: c.top, left: c.left,
              width: c.width, height: c.height,
              background: cat === "foggy" ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.18)",
              filter: `blur(${c.blur})`,
              animation: `wx-cloud ${c.duration} ease-in-out ${c.delay} infinite alternate`,
            }}
          />
        ))}
      </div>
    );
  }

  // Sun glow for clear day
  if (cat === "clear_day") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center">
        <div
          className="absolute rounded-full"
          style={{
            width: "180px", height: "180px",
            top: "-40px", right: "-20px",
            background: "rgba(255,220,100,0.25)",
            filter: "blur(20px)",
            animation: "wx-sun-glow 4s ease-in-out infinite",
          }}
        />
        {/* Sun rays */}
        {[0,30,60,90,120,150].map((rot, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              width: "2px", height: "60px",
              top: "-10px", right: "30px",
              background: "rgba(255,220,100,0.2)",
              transformOrigin: "bottom center",
              transform: `rotate(${rot}deg) translateY(-50px)`,
              animation: `wx-sun-ray 3s ease-in-out ${i * 0.5}s infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  // Stars for clear night
  if (cat === "clear_night") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {STARS.map((s, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              top: s.top, left: s.left,
              width: s.size, height: s.size,
              animation: `wx-star ${s.duration} ease-in-out ${s.delay} infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  return null;
}

// ── Main section ──────────────────────────────────────────────
export default function WeatherSection() {
  const { data, isLoading } = useWeather();
  const c  = data?.current;
  const d  = data?.daily;

  const cat     = (!isLoading && c) ? getCategory(c.weather_code, c.is_day) : "overcast";
  const bg      = BG[cat];
  const alert   = (!isLoading && c && d)
    ? getAlert(c.weather_code, d.wind_speed_10m_max[0], d.precipitation_probability_max[0])
    : null;

  return (
    <section className="space-y-2">
      <div className="section-title">
        <Cloud size={13} />
        Weather Forecast — {WEATHER_CONFIG.location}
        <span className="text-[10px] text-txt-light font-medium normal-case tracking-normal ml-1">
          {WEATHER_CONFIG.district}
        </span>
      </div>

      {/* Operational alert */}
      {alert && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="text-warning shrink-0" />
          <span className="text-[12px] font-semibold text-[#a07a07]">{alert}</span>
        </div>
      )}

      <div className="flex rounded-xl overflow-hidden border border-border shadow-md">

        {/* ── LEFT: Glass UI with animated weather background ─── */}
        <div
          className="relative w-[290px] xl:w-[310px] shrink-0 overflow-hidden"
          style={{ background: bg.gradient }}
        >
          {/* Animated weather background */}
          <WxBackground cat={cat} />

          {/* Glass content layer */}
          <div
            className="relative z-10 h-full px-4 py-3 flex flex-col gap-2.5"
            style={{
              background: bg.glass,
              backdropFilter: "blur(3px)",
              WebkitBackdropFilter: "blur(3px)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] font-extrabold tracking-[.16em] uppercase"
                style={{ color: bg.label }}
              >
                Current Conditions
              </span>
              <span className="text-[10px] text-white/40 font-mono">
                {isLoading ? "—" : c ? timeLabel(c.time) : "—"}
              </span>
            </div>

            {/* Big temp + condition */}
            <div className="flex items-center gap-3">
              <span className="text-[38px] leading-none drop-shadow-md">
                {isLoading ? "🌡️" : c ? weatherEmoji(c.weather_code, c.is_day) : "—"}
              </span>
              <div>
                {isLoading ? (
                  <div className="h-7 w-24 bg-white/15 animate-pulse rounded" />
                ) : c ? (
                  <>
                    <div className={`font-condensed font-extrabold text-[30px] xl:text-[34px] leading-none tracking-tight drop-shadow ${tempColor(c.temperature_2m, true)}`}>
                      {c.temperature_2m.toFixed(1)}
                      <span className="text-[13px] font-normal text-white/50 ml-1">°C</span>
                    </div>
                    <div className="text-[11px] text-white/55 mt-0.5">
                      Feels <span className={tempColor(c.apparent_temperature, true)}>{c.apparent_temperature.toFixed(1)}°C</span>
                      <span className="mx-1 text-white/25">·</span>
                      {weatherDesc(c.weather_code)}
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-white/15" />

            {/* Stats — 2-col grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
              <div>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Temp Max</div>
                <div className={`font-mono font-bold ${isLoading ? "text-white/20" : tempColor(d?.temperature_2m_max[0] ?? 0, true)}`}>
                  {isLoading ? "…" : d ? `${d.temperature_2m_max[0].toFixed(1)}°C` : "—"}
                </div>
              </div>
              <div>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Temp Min</div>
                <div className="font-mono font-bold text-[#81d4fa]">
                  {isLoading ? "…" : d ? `${d.temperature_2m_min[0].toFixed(1)}°C` : "—"}
                </div>
              </div>
              <div>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Wind Max</div>
                <div className={`font-mono font-bold ${isLoading ? "text-white/20" : windColor(d?.wind_speed_10m_max[0] ?? 0, true)}`}>
                  {isLoading ? "…" : d ? `${d.wind_speed_10m_max[0].toFixed(0)} km/h` : "—"}
                </div>
              </div>
              <div>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Wind Min</div>
                <div className="font-mono font-bold text-[#69f0ae]">
                  {isLoading ? "…" : d ? `${d.wind_speed_10m_min[0].toFixed(0)} km/h` : "—"}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Wind Now</div>
                <div className="font-mono font-bold text-white">
                  {isLoading ? "…" : c ? `${c.wind_speed_10m.toFixed(1)} km/h  ${windDir(c.wind_direction_10m)}` : "—"}
                </div>
              </div>
              <div>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Humidity</div>
                <div className="font-mono font-bold text-[#40c4ff]">
                  {isLoading ? "…" : c ? `${c.relative_humidity_2m}%` : "—"}
                </div>
              </div>
              <div>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Precip.</div>
                <div className="font-mono font-bold text-white">
                  {isLoading ? "…" : c ? `${c.precipitation.toFixed(1)} mm` : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: 7-day Forecast ─────────────────────────── */}
        <div className="flex-1 flex flex-col bg-white">
          <div className="flex flex-1 divide-x divide-border-light">
            {isLoading ? (
              Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2 px-2 py-3">
                  {[14, 24, 16, 16, 20, 16].map((w, j) => (
                    <div key={j} className="h-3 bg-bg-section animate-pulse rounded w-full max-w-[48px]" />
                  ))}
                </div>
              ))
            ) : d ? (
              d.time.map((date, i) => {
                const isToday = i === 0;
                const rs      = rainStyle(d.precipitation_probability_max[i]);
                return (
                  <div
                    key={date}
                    className={`flex-1 flex flex-col items-center justify-between px-1.5 py-2.5 transition-colors
                      ${isToday ? "bg-bg-section border-b-2 border-b-[#1a2744]" : "hover:bg-bg-soft"}`}
                  >
                    <div className={`text-[10px] font-extrabold tracking-widest ${isToday ? "text-navy" : "text-txt-light"}`}>
                      {isToday ? "TODAY" : dayLabel(date)}
                    </div>
                    <div className="text-[22px] leading-none my-1">
                      {weatherEmoji(d.weather_code[i])}
                    </div>
                    {/* Temperature */}
                    <div className="w-full text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-[9px] text-txt-light uppercase tracking-wider">H</span>
                        <span className={`text-[13px] font-extrabold font-condensed ${tempColor(d.temperature_2m_max[i], false)}`}>
                          {d.temperature_2m_max[i].toFixed(0)}°
                        </span>
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-[9px] text-txt-light uppercase tracking-wider">L</span>
                        <span className="text-[11px] text-txt-muted font-mono">
                          {d.temperature_2m_min[i].toFixed(0)}°
                        </span>
                      </div>
                    </div>

                    {/* Wind */}
                    <div className="w-full border-t border-border-light pt-1 mt-1">
                      <div className="text-[9px] text-txt-light uppercase tracking-wider text-center mb-0.5">Wind</div>
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[9px] text-txt-light">Max</span>
                        <span className={`text-[11px] font-bold font-mono ${windColor(d.wind_speed_10m_max[i], false)}`}>
                          {d.wind_speed_10m_max[i].toFixed(0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[9px] text-txt-light">Min</span>
                        <span className="text-[10px] text-txt-light font-mono">
                          {d.wind_speed_10m_min[i].toFixed(0)}
                        </span>
                      </div>
                      <div className="text-[9px] text-txt-light text-center">km/h</div>
                    </div>

                    {/* Rain probability */}
                    <div className={`w-full rounded px-1 py-0.5 text-center ${rs.bg}`}>
                      <div className="text-[9px] text-txt-light uppercase tracking-wider mb-0.5">Rain</div>
                      <div className={`text-[11px] font-extrabold ${rs.text}`}>
                        {d.precipitation_probability_max[i]}%
                      </div>
                      <div className="h-[3px] rounded-full bg-border-light mt-0.5 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${d.precipitation_probability_max[i]}%`, background: rs.bar }} />
                      </div>
                    </div>
                  </div>
                );
              })
            ) : null}
          </div>
          <div className="border-t border-border-light px-3 py-1 flex items-center justify-between">
            <span className="text-[10px] text-txt-light/50">
              Open-Meteo · Auto-refresh 30 min · {WEATHER_CONFIG.lat}°N {WEATHER_CONFIG.lon}°E
            </span>
            <span className="text-[9px] text-txt-light/40 font-mono">↑ Wind Max  ↓ Min · Rain %</span>
          </div>
        </div>
      </div>
    </section>
  );
}
