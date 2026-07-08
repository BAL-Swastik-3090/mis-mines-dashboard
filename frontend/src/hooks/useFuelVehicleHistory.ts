import { useState, useEffect } from "react";
import type { FuelVehicleHistoryResponse } from "@/types";

interface UseVehicleHistoryResult {
  data:    FuelVehicleHistoryResponse | null;
  loading: boolean;
  error:   string | null;
}

export function useFuelVehicleHistory(vehicleDesc: string | null): UseVehicleHistoryResult {
  const [data,    setData]    = useState<FuelVehicleHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleDesc) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/fuel-management/vehicle/${encodeURIComponent(vehicleDesc)}/history?days=7`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FuelVehicleHistoryResponse>;
      })
      .then(json => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Fetch failed");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [vehicleDesc]);

  return { data, loading, error };
}
