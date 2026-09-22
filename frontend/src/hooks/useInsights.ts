"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { RealityCheckResponse, InsightsResponse,
              WhyWhyResponse, WhyWhyNarrativeResponse,
              WhyWhyTrainingResponse } from "@/types";

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

// ── Why-Why: computed analysis points (fast, always answers) ──
export function useWhyWhy() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<WhyWhyResponse>({
    queryKey: ["insights", "why-why", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/insights/why-why", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime:       10 * 60_000,
    placeholderData: keepPreviousData,
    enabled:         Boolean(apiFrom && apiTo),
  });
}

// ── Why-Why: BAL-AI narrative (slow, may fail, on demand) ─────
// UNUSED since 2026-09-22 — the "AI reading of these figures" card was removed
// because it interpreted rather than investigated. Kept because the endpoint is
// live and the wiring is correct if a use for it appears; delete both together.
// Separate query on purpose. The charts must not wait ~9s for prose, and a
// gateway outage must cost the narrative card only, never the section.
export function useWhyWhyNarrative(enabled: boolean) {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<WhyWhyNarrativeResponse>({
    queryKey: ["insights", "why-why", "narrative", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/insights/why-why/narrative", {
        params:  { from_date: apiFrom, to_date: apiTo },
        timeout: 120000,   // backend allows the model 90s; leave headroom
      });
      return res.data;
    },
    staleTime:       30 * 60_000,
    refetchInterval: false,
    placeholderData: keepPreviousData,
    enabled:         enabled && Boolean(apiFrom && apiTo),
    retry:           1,
  });
}

// ── Why-Why: training topics from the operating-error breakdowns ──
// Slower than the narrative (~18s) because the incident text goes in the
// prompt. On demand only, and its failure is contained to its own card.
export function useWhyWhyTraining(enabled: boolean) {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<WhyWhyTrainingResponse>({
    queryKey: ["insights", "why-why", "training", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/insights/why-why/training", {
        params:  { from_date: apiFrom, to_date: apiTo },
        timeout: 150000,
      });
      return res.data;
    },
    staleTime:       30 * 60_000,
    refetchInterval: false,
    placeholderData: keepPreviousData,
    enabled:         enabled && Boolean(apiFrom && apiTo),
    retry:           1,
  });
}
