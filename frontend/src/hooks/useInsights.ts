"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { RealityCheckResponse, InsightsResponse } from "@/types";

// ── Reality Check (pure computation, polls every 5 min) ───────
export function useRealityCheck() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<RealityCheckResponse>({
    queryKey:        ["insights", "reality-check", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/insights/reality-check", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime:       5 * 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
    enabled:         Boolean(apiFrom && apiTo),
  });
}

// ── AI Insights (manual trigger via refetch, cached 10 min) ───
export function useInsightsGenerate(enabled: boolean) {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<InsightsResponse>({
    queryKey:        ["insights", "generate", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/insights/generate", {
        params:  { from_date: apiFrom, to_date: apiTo },
        timeout: 30000,   // LiteLLM capped at 25s backend; give 30s here
      });
      return res.data;
    },
    staleTime:       10 * 60_000,
    refetchInterval: false,
    placeholderData: keepPreviousData,
    enabled:         enabled && Boolean(apiFrom && apiTo),
    retry:           1,
  });
}
