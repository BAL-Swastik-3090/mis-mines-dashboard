"use client";
/**
 * TanStack Query hooks for Production KPI endpoints.
 * Each hook reads apiFrom / apiTo from the global Zustand date filter
 * and uses them as React Query cache keys — auto-refetches on filter change.
 */
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type {
  ProductionSummaryResponse,
  ProductionDaywiseResponse,
  GradeBreakdownResponse,
} from "@/types";

// ── /api/production/summary ───────────────────────────────────
export function useProductionSummary() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<ProductionSummaryResponse>({
    queryKey: ["production", "summary", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/production/summary", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}

// ── /api/production/daywise ───────────────────────────────────
export function useProductionDaywise() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<ProductionDaywiseResponse>({
    queryKey: ["production", "daywise", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/production/daywise", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}

// ── /api/production/grade ─────────────────────────────────────
export function useProductionGrade() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<GradeBreakdownResponse>({
    queryKey: ["production", "grade", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/production/grade", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
