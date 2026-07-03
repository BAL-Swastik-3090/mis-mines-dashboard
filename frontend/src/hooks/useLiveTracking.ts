import { useState, useEffect, useCallback, useRef } from 'react';
import type { LiveTrackingResponse, VehicleData } from '@/types';

const POLL_INTERVAL_MS = 180_000;  // 3-min display interval (sensor syncs every 1 min)

interface UseLiveTrackingResult {
  data:        LiveTrackingResponse | null;
  loading:     boolean;
  error:       string | null;
  lastUpdated: Date | null;
  refetch:     () => void;
}

export function useLiveTracking(): UseLiveTrackingResult {
  const [data, setData]               = useState<LiveTrackingResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef                      = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/live-tracking');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LiveTrackingResponse = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchData]);

  return { data, loading, error, lastUpdated, refetch: fetchData };
}

// ── Helper: derive sensor wave opts from a VehicleData row ──────
export function vehicleWaveOpts(v: VehicleData) {
  return {
    avgSpeed:        v.avg_speed,
    maxSpeed:        Math.max(v.max_speed || 0, v.avg_speed || 0, 60),
    fuelConsumed:    v.fuel_consumed,
    maxFuelConsumed: 500,   // raised — MAN tippers can consume 300-400L/day
    engOn:           v.engine_hours > 0,
    filling:         false,
    draining:        false,
  };
}

// ── Helper: group vehicles by category ──────────────────────────
export function groupByCategory(vehicles: VehicleData[]): Record<string, VehicleData[]> {
  return vehicles.reduce<Record<string, VehicleData[]>>((acc, v) => {
    (acc[v.category] ??= []).push(v);
    return acc;
  }, {});
}
