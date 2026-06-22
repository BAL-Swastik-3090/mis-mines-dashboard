"use client";
/**
 * TanStack Query hooks for Despatch endpoints.
 * Returns plan + actuals (hybrid: synced via sd_outbound_delivery, unsynced via transporter).
 */
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { DespatchSummaryResponse, DespatchDaywiseResponse } from "@/types";

// ── /api/despatch/summary ─────────────────────────────────────
export function useDespatchSummary() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<DespatchSummaryResponse>({
    queryKey: ["despatch", "summary", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/despatch/summary", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}

// ── /api/despatch/daywise ─────────────────────────────────────
export function useDespatchDaywise() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<DespatchDaywiseResponse>({
    queryKey: ["despatch", "daywise", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/despatch/daywise", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
