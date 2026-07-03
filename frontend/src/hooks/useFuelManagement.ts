import { useState, useEffect, useCallback, useRef } from "react";
import type { FuelOverviewResponse } from "@/types";

const POLL_INTERVAL_MS = 180_000; // 3-minute polling

interface UseFuelManagementResult {
  data:        FuelOverviewResponse | null;
  loading:     boolean;
  error:       string | null;
  lastUpdated: Date | null;
  refetch:     () => void;
}

export function useFuelManagement(): UseFuelManagementResult {
  const [data,        setData]        = useState<FuelOverviewResponse | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/fuel-management");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: FuelOverviewResponse = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  return { data, loading, error, lastUpdated, refetch: fetchData };
}
