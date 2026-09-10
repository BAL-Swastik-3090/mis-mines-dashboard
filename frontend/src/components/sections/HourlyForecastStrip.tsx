"use client";
/**
 * Next 24 hours — rain probability with temperature over it.
 *
 * Rain leads deliberately. "Rain & slippery problem" is a real LCM loss head
 * (non-controllable, under Head Mines Operation), so knowing which hours carry
 * rain is a shift-planning input rather than decoration. Temperature rides on
 * top as context.
 *
 * Data comes from the SAME Open-Meteo request the rest of the section already
 * makes — an extra `hourly=` parameter on a call that was happening anyway. No
 * second request, no key, no cost.
 *
 * Open-Meteo returns whole days starting 00:00 local, so the window is sliced
 * from the current hour by useHourlyWindow rather than taken from the top of
 * the array.
 *
 * Drawn as plain divs, not a chart library: 24 bars with a label each need no
 * layout engine, it stays crisp at any zoom, and it avoids pulling ECharts into
 * a section that otherwise has no charts.
 */
import type { WeatherHourly } from "@/hooks/useWeather";
import { useHourlyWindow } from "@/hooks/useWeather";

interface Props {
  hourly:  WeatherHourly | undefined;
  loading: boolean;
  /** Shared with the 7-day strip so one rain scale reads across the section. */
  rainStyle:    (pct: number) => { text: string; bg: string; bar: string };
  tempColor:    (t: number, dark?: boolean) => string;
  weatherEmoji: (code: number, isDay?: number) => string;
}

/** Bar height as a share of the plot area. A floor of 2% keeps a 0% hour as a
 *  visible baseline tick rather than nothing at all — an absent bar reads as
 *  missing data, not as "no rain". */
function barHeight(pct: number | null) {
  if (pct == null) return "2%";
  return `${Math.max(2, pct)}%`;
}

export default function HourlyForecastStrip({
  hourly, loading, rainStyle, tempColor, weatherEmoji,
}: Props) {
  const hours = useHourlyWindow(hourly, 24);

  if (loading) {
    return (
      <div className="border-t border-border-light bg-white px-3 py-3">
        <div className="h-[120px] bg-bg-section animate-pulse rounded" />
      </div>
    );
  }
  if (!hours.length) return null;

  const temps   = hours.map((h) => h.temperature).filter((t): t is number => t != null);
  const tMin    = Math.min(...temps);
  const tMax    = Math.max(...temps);
  const tSpan   = tMax - tMin || 1;

  const peak     = hours.reduce((a, h) => ((h.rainChance ?? 0) > (a.rainChance ?? 0) ? h : a), hours[0]);
  const totalMm  = hours.reduce((a, h) => a + (h.rainMm ?? 0), 0);
  const wetHours = hours.filter((h) => (h.rainChance ?? 0) >= 70).length;

  return (
    <div className="border-t border-border-light bg-white">
      {/* Header — the summary a shift in-charge reads before the bars */}
      <div className="px-3 pt-2 pb-1.5 flex items-center gap-2 flex-wrap">
        <span className="font-condensed font-bold text-[11px] text-navy tracking-widest uppercase">
          Next 24 Hours
        </span>
        <span className="text-[9.5px] font-mono text-txt-light">· rain probability &amp; temperature</span>
        <span className="ml-auto text-[9.5px] font-mono text-txt-muted">
          {wetHours > 0 && (
            <span className="text-[#1565c0] font-bold">{wetHours} h at 70%+ rain</span>
          )}
          {wetHours > 0 && <span className="mx-1.5">·</span>}
          peak <span className="font-bold text-navy">{peak.rainChance ?? 0}%</span> at {peak.hour}
          <span className="mx-1.5">·</span>
          {totalMm.toFixed(1)} mm expected
        </span>
      </div>

      <div className="px-3 pb-2 overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Temperature line, positioned over the bars by relative height */}
          <div className="relative h-[26px] mb-0.5">
            {hours.map((h, i) => {
              if (h.temperature == null) return null;
              const top = 100 - ((h.temperature - tMin) / tSpan) * 100;
              return (
                <div
                  key={h.time}
                  className="absolute flex justify-center"
                  style={{
                    left: `${(i / hours.length) * 100}%`,
                    width: `${100 / hours.length}%`,
                    top: `${top * 0.62}%`,
                  }}
                >
                  <span className={`text-[8.5px] font-mono font-bold ${tempColor(h.temperature, false)}`}>
                    {h.temperature.toFixed(0)}°
                  </span>
                </div>
              );
            })}
          </div>

          {/* Rain probability bars */}
          <div className="flex items-end gap-[2px] h-[70px] border-b border-border-light">
            {hours.map((h) => {
              const pct = h.rainChance ?? 0;
              const rs  = rainStyle(pct);
              return (
                <div
                  key={h.time}
                  className="flex-1 flex flex-col justify-end items-center h-full group relative"
                  title={`${h.hour} · ${pct}% rain · ${(h.rainMm ?? 0).toFixed(1)} mm · ${h.temperature?.toFixed(0)}°C`}
                >
                  <span className="text-[8px] font-mono text-txt-light mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {pct}%
                  </span>
                  <div
                    className="w-full rounded-t-sm transition-all"
                    style={{ height: barHeight(pct), background: rs.bar, minHeight: 2 }}
                  />
                </div>
              );
            })}
          </div>

          {/* Hour labels — every 3rd, so 24 columns stay legible */}
          <div className="flex gap-[2px] mt-1">
            {hours.map((h, i) => (
              <div key={h.time} className="flex-1 text-center">
                {i % 3 === 0 ? (
                  <>
                    <div className="text-[10px] leading-none">{weatherEmoji(h.code ?? 0)}</div>
                    <div className="text-[8.5px] font-mono text-txt-light mt-0.5">{h.hour}</div>
                  </>
                ) : (
                  <div className="h-[18px]" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
