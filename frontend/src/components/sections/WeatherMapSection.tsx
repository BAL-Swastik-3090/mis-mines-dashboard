"use client";
/**
 * The weather map section.
 *
 * Windy only. A "Mine View" toggle used to sit here, switching to a MapLibre
 * wind field we rendered ourselves from Open-Meteo; both the toggle and that
 * map were removed on request.
 */
import { Wind } from "lucide-react";
import WindyEmbed from "@/components/sections/WindyEmbed";
import { WEATHER_CONFIG } from "@/lib/weatherConfig";

export default function WeatherMapSection() {
  return (
    <section className="space-y-2">
      <div className="section-title">
        <Wind size={13} />
        Weather Map — {WEATHER_CONFIG.location}
        <span className="text-[10px] text-txt-light font-medium normal-case tracking-normal ml-1">
          Windy.com live
        </span>
      </div>

      <WindyEmbed />
    </section>
  );
}
