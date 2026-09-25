// ── Weather configuration — Kaliapani Mines ───────────────────
export const WEATHER_CONFIG = {
  lat:      20.99,
  lon:      85.67,
  location: "Kaliapani Mines, Sukinda",
  district: "Jajpur Dist.",
  timezone: "Asia/Kolkata",
} as const;

// WEATHER_CONFIG is still the single source for the mine's coordinates: the
// Windy embed centres on them and labels itself from them. The Open-Meteo
// endpoint that used to live here went with the compact forecast strip, which
// the Windy page replaced.
