"use client";
/**
 * Equipment Utilization hooks.
 *
 * Live mode  (to_date = today) → all endpoints poll every 60 s.
 * History mode (to_date < today) → fetch once, no polling.
 * placeholderData keeps the previous result visible during re-fetches
 * so the UI never shows a loading blank on a live refresh.
 */
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type {
  ExcavatorSummaryResponse,
  ExcavatorTrendResponse,
  ExcavatorFuelResponse,
  TipperSummaryResponse,
  TipperFuelResponse,
} from "@/types";

/** Returns true when the selected end-date is today → live sensor mode. */
function useIsLive(): boolean {
  const { apiTo } = useDateFilter();
  const t = new Date();
  const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return apiTo === todayStr;
}

// ── Excavator summary (live: 60 s) ───────────────────────────
export function useExcavatorSummary() {
  const { apiFrom, apiTo } = useDateFilter();
  const live = useIsLive();
  return useQuery<ExcavatorSummaryResponse>({
    queryKey:        ["equipment", "excavator", "summary", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/equipment/excavator/summary", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime:       live ? 55_000       : 5 * 60_000,
    refetchInterval: live ? 60_000       : false,
    placeholderData: keepPreviousData,
    enabled:         Boolean(apiFrom && apiTo),
  });
}

// ── Excavator trend (live: 60 s — today's partial-day value updates each minute) ─
export function useExcavatorTrend() {
  const { apiFrom, apiTo } = useDateFilter();
  const live = useIsLive();
  return useQuery<ExcavatorTrendResponse>({
    queryKey:        ["equipment", "excavator", "trend", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/equipment/excavator/trend", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime:       live ? 55_000       : 5 * 60_000,
    refetchInterval: live ? 60_000       : false,
    placeholderData: keepPreviousData,
    enabled:         Boolean(apiFrom && apiTo),
  });
}

// ── Tipper summary (live: 60 s) ───────────────────────────────
export function useTipperSummary() {
  const { apiFrom, apiTo } = useDateFilter();
  const live = useIsLive();
  return useQuery<TipperSummaryResponse>({
    queryKey:        ["equipment", "tipper", "summary", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/equipment/tipper/summary", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime:       live ? 55_000 : 5 * 60_000,
    refetchInterval: live ? 60_000 : false,
    placeholderData: keepPreviousData,
    enabled:         Boolean(apiFrom && apiTo),
  });
}

// ── Excavator fuel (live: 60 s) ──────────────────────────────
export function useExcavatorFuel() {
  const { apiFrom, apiTo } = useDateFilter();
  const live = useIsLive();
  return useQuery<ExcavatorFuelResponse>({
    queryKey:        ["equipment", "excavator", "fuel", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/equipment/excavator/fuel", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime:       live ? 55_000 : 5 * 60_000,
    refetchInterval: live ? 60_000 : false,
    placeholderData: keepPreviousData,
    enabled:         Boolean(apiFrom && apiTo),
  });
}

// ── Tipper fuel/KMPL (live: 60 s) ────────────────────────────
export function useTipperFuel() {
  const { apiFrom, apiTo } = useDateFilter();
  const live = useIsLive();
  return useQuery<TipperFuelResponse>({
    queryKey:        ["equipment", "tipper", "fuel", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/equipment/tipper/fuel", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime:       live ? 55_000 : 5 * 60_000,
    refetchInterval: live ? 60_000 : false,
    placeholderData: keepPreviousData,
    enabled:         Boolean(apiFrom && apiTo),
  });
}
