"use client";
/**
 * Windy.com, embedded.
 *
 * ── LICENSING, ON THE RECORD ─────────────────────────────────────────────────
 * Windy's terms state the embed is "intended to be used by media companies, not
 * for commercial users", and that the widgets are "not allowed to be used by
 * weather apps and other commercial websites". This dashboard is a commercial
 * website. The position was put to the product owner twice, in writing, with
 * the licensed alternative priced (Windy Map Forecast API, EUR 990/yr, which
 * permits corporate use). They chose the embed. This comment exists so that
 * whoever finds this next does not have to rediscover any of it.
 *
 * If a licence is later bought, the Map Forecast API renders Windy's own layers
 * inside a Leaflet map you control. Note that there is no longer a fallback map
 * in this repo: a MapLibre wind field built from Open-Meteo was removed on
 * request, so if this embed has to come out, that work starts again.
 *
 * ── WHAT IS ACHIEVABLE ───────────────────────────────────────────────────────
 * The full windy.com screen CANNOT be embedded. www.windy.com sends
 *     Content-Security-Policy: frame-ancestors 'self' *.windy.com:*
 * so every browser refuses to render it in our frame. That is a hard block, not
 * a configuration we can change. embed.windy.com sends no such header and is
 * the supported surface, so that is what this uses — with every switch Windy
 * exposes turned on, which gets the layer menu, the forecast timeline, the
 * particle animation, isobars and the point-detail readout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Map as MapIcon, Loader2, Maximize2 } from "lucide-react";
import { WEATHER_CONFIG } from "@/lib/weatherConfig";

/** Overlays worth putting one click away. Windy's own menu carries the rest. */
const OVERLAYS = [
  { key: "wind", label: "Wind" },
  { key: "rain", label: "Rain & Thunder" },
  { key: "temp", label: "Temperature" },
  { key: "clouds", label: "Clouds" },
  { key: "gust", label: "Gusts" },
  { key: "pressure", label: "Pressure" },
  { key: "rainAccu", label: "Rain Accum." },
  { key: "radar", label: "Radar" },
] as const;

type OverlayKey = (typeof OVERLAYS)[number]["key"];

interface Props {
  /** Defaults to the mine. */
  lat?: number;
  lon?: number;
  zoom?: number;
  /** Panel height. Windy needs real room — its own UI eats ~120px of chrome. */
  height?: number;
}

export default function WindyEmbed({
  lat = WEATHER_CONFIG.lat,
  lon = WEATHER_CONFIG.lon,
  zoom = 7,
  height = 620,
}: Props) {
  const [overlay, setOverlay] = useState<OverlayKey>("wind");
  const [loaded, setLoaded] = useState(false);
  const frameBox = useRef<HTMLDivElement | null>(null);
  const [isFull, setIsFull] = useState(false);

  // The panel carries an explicit pixel height, which would cap the element at
  // 620px in the middle of an otherwise black screen once it goes fullscreen.
  // Tracking the state and switching to 100% is what actually fills the screen.
  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === frameBox.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Full screen without leaving the dashboard. This matters because it works
  // wherever the EMBED works, which is not the same set of conditions as
  // www.windy.com loading — the main site pulls a much larger asset bundle and
  // is the thing more likely to be blocked on a corporate network.
  const goFullscreen = useCallback(() => {
    const el = frameBox.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => { /* denied by policy */ });
  }, []);

  const src = useMemo(() => {
    // Every documented embed2 switch, set for the fullest UI Windy will give.
    const p = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      // detailLat/detailLon drive the point-forecast panel, so it opens on the
      // mine rather than wherever the map happens to be centred.
      detailLat: String(lat),
      detailLon: String(lon),
      zoom: String(zoom),
      level: "surface",
      overlay,
      product: "ecmwf",
      menu: "true",       // the layer rail
      message: "true",
      marker: "true",     // pin at the mine
      calendar: "now",    // the forecast timeline along the bottom
      pressure: "true",   // isobars
      type: "map",
      location: "coordinates",
      // The expanded point-forecast table is OFF: measured at 1600x900 it took
      // roughly two thirds of the panel and squeezed the map to ~210px, which
      // defeats the point of embedding a map. Clicking the marker still opens
      // it, and the compact timeline scrubber stays either way.
      detail: "false",
      metricWind: "km/h",
      metricTemp: "°C",
      radarRange: "-1",
    });
    return `https://embed.windy.com/embed2.html?${p}`;
  }, [lat, lon, zoom, overlay]);

  /**
   * The real site, opened on the SAME layer the user is looking at.
   *
   * Windy accepts `?<overlay>,<lat>,<lon>,<zoom>` — verified live against the
   * site for several layers (`?gust,...` loads "Windy: Wind gusts",
   * `?rain,...` loads "Windy: Rain, thunder"). The previous link omitted the
   * overlay and so always landed on the default layer. Using the query form
   * also avoids Windy's per-layer path slugs, which differ per overlay and
   * would be eight separate things to get wrong.
   */
  const fullSite =
    `https://www.windy.com/?${overlay},${lat.toFixed(3)},${lon.toFixed(3)},${zoom}`;

  return (
    <div className="rounded-xl overflow-hidden border border-border shadow-md bg-white">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border-light bg-bg-soft flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {OVERLAYS.map((o) => {
            const on = o.key === overlay;
            return (
              <button
                key={o.key}
                onClick={() => setOverlay(o.key)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold tracking-wide transition-colors
                  ${on ? "bg-navy text-white shadow-sm"
                       : "text-txt-muted hover:bg-bg-section hover:text-txt-secondary"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={goFullscreen}
          className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] font-bold text-txt-secondary hover:bg-bg-section"
          title="Expand the map to full screen"
        >
          <Maximize2 size={11} />
          Full Screen
        </button>
        <a
          href={fullSite}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] font-bold text-txt-secondary hover:bg-bg-section shrink-0"
          title="Open the full Windy site — model selector and 10-day timeline"
        >
          <ExternalLink size={11} />
          Windy.com
        </a>
        </div>
      </div>

      <div
        ref={frameBox}
        className="relative bg-bg-section"
        style={{ height: isFull ? "100%" : height }}
      >
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-txt-muted z-10">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-[12px] font-semibold">Loading Windy…</span>
          </div>
        )}
        <iframe
          // Re-mount on overlay change: embed2 reads its overlay from the query
          // string at boot and does not react to a later src swap.
          key={overlay}
          src={src}
          title="Windy weather map"
          width="100%"
          height="100%"
          frameBorder="0"
          onLoad={() => setLoaded(true)}
          // Windy needs scripts and its own origin; geolocation is declined so
          // the embed cannot prompt users for their position.
          allow="geolocation 'none'"
          className="absolute inset-0 w-full h-full"
        />
      </div>

      <div className="border-t border-border-light px-3 py-1 flex items-center justify-between flex-wrap gap-1">
        <span className="text-[10px] text-txt-light/60 flex items-center gap-1">
          <MapIcon size={9} />
          {WEATHER_CONFIG.location} · {lat.toFixed(3)}°N {lon.toFixed(3)}°E
        </span>
        <span className="text-[9px] text-txt-light/50">
          Weather map &amp; data © Windy.com
        </span>
      </div>
    </div>
  );
}
