// ── Weather configuration — Kaliapani Mines ───────────────────
export const WEATHER_CONFIG = {
  lat:      20.99,
  lon:      85.67,
  location: "Kaliapani Mines, Sukinda",
  district: "Jajpur Dist.",
  timezone: "Asia/Kolkata",
} as const;

// Open-Meteo API — free, no key required, CORS enabled
export const WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast";
