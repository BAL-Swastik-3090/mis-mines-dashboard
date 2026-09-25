"use client";
/**
 * Weather Forecast — its own screen.
 *
 * Moved off the MIS dashboard because it is consulted before a shift is
 * planned, often by people who are not reading production figures at all, and
 * because a map wants the whole window rather than a strip between two tables.
 *
 * Carries no date filter and no section tab bar: the forecast is always "now
 * forward", so the global date range has nothing to say to it.
 */
import WeatherMapSection from "@/components/sections/WeatherMapSection";

export default function WeatherForecastPage() {
  return (
    <div className="space-y-8">
      <section id="weather-map" className="scroll-mt-[90px]">
        <WeatherMapSection />
      </section>
    </div>
  );
}
