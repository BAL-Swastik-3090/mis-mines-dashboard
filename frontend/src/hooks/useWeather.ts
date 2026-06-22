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

export interface WeatherData {
  current: WeatherCurrent;
  daily:   WeatherDaily;
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
});

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
