"use client";
import { useQuery } from "@tanstack/react-query";
import { WEATHER_CONFIG, WEATHER_API_URL } from "@/lib/weatherConfig";

export interface WeatherCurrent {
  time:                string;
  temperature_2m:      number;
  apparent_temperature:number;
  relative_humidity_2m:number;
  is_day:              number;
  precipitation:       number;
  weather_code:        number;
  wind_speed_10m:      number;
  wind_direction_10m:  number;
}

export interface WeatherDaily {
  time:                        string[];
  weather_code:                number[];
  temperature_2m_max:          number[];
  temperature_2m_min:          number[];
  precipitation_sum:           number[];
  precipitation_probability_max:number[];
  wind_speed_10m_max:          number[];
  wind_speed_10m_min:          number[];
}

/** Hourly block. Open-Meteo returns whole days of hourly values starting at
 *  00:00 local, so the array covers today onward and must be sliced from the
 *  current hour — see useHourlyWindow. */
export interface WeatherHourly {
  time:                      string[];
  temperature_2m:            number[];
  precipitation_probability: number[];
  precipitation:             number[];
  weather_code:              number[];
}

export interface WeatherData {
  current: WeatherCurrent;
  daily:   WeatherDaily;
  hourly:  WeatherHourly;
}

const PARAMS = new URLSearchParams({
  latitude:  String(WEATHER_CONFIG.lat),
  longitude: String(WEATHER_CONFIG.lon),
  timezone:  WEATHER_CONFIG.timezone,
  forecast_days: "7",
  current:  [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "is_day",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
  ].join(","),
  daily: [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "precipitation_probability_max",
    "wind_speed_10m_max",
    "wind_speed_10m_min",
  ].join(","),
  // Hourly rides on the SAME request — no extra call, no key, no cost.
  // Rain is the lead here: 'Rain & slippery problem' is a real LCM loss head,
  // so an hourly view of it is a shift-planning input, not decoration.
  hourly: [
    "temperature_2m",
    "precipitation_probability",
    "precipitation",
    "weather_code",
  ].join(","),
});

/** The next N hours starting from the current hour.
 *
 *  Open-Meteo's hourly arrays begin at 00:00 today in the requested timezone,
 *  so roughly the first third of them are already in the past by mid-afternoon.
 *  Matching on the local "YYYY-MM-DDTHH" prefix rather than parsing to a Date
 *  avoids the browser reinterpreting a timezone-less local timestamp as UTC,
 *  which on IST would shift every reading by 5.5 hours.
 *
 *  forecast_days is 7, so a 24-hour window is always fully covered; the slice
 *  is still bounded rather than assumed. */
export function useHourlyWindow(hourly: WeatherHourly | undefined, hours = 24) {
  if (!hourly?.time?.length) return [];

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}`;

  let start = hourly.time.findIndex((t) => t.slice(0, 13) >= stamp);
  if (start < 0) start = 0;          // clock ahead of the forecast — show from the top

  return hourly.time.slice(start, start + hours).map((t, i) => ({
    time:        t,
    hour:        t.slice(11, 16),
    temperature: hourly.temperature_2m?.[start + i] ?? null,
    rainChance:  hourly.precipitation_probability?.[start + i] ?? null,
    rainMm:      hourly.precipitation?.[start + i] ?? null,
    code:        hourly.weather_code?.[start + i] ?? null,
  }));
}

export function useWeather() {
  return useQuery<WeatherData>({
    queryKey: ["weather", WEATHER_CONFIG.lat, WEATHER_CONFIG.lon],
    queryFn: async () => {
      const res = await fetch(`${WEATHER_API_URL}?${PARAMS}`);
      if (!res.ok) throw new Error("Weather API error");
      return res.json();
    },
    staleTime:    30 * 60 * 1000,   // refresh every 30 minutes
    gcTime:       60 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    retry: 2,
  });
}
