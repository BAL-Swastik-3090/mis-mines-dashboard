"use client";
/**
 * TanStack Query hooks for the product-costing endpoints.
 *
 * Costing is period-based (a whole month), not range-based like the other
 * sections, so period is passed in explicitly rather than read from the
 * global date filter — that filter is only rendered on the MIS page.
 */
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type {
  CostSection,
  CostSummaryResponse,
  CostCurveResponse,
  CostCoverageResponse,
  CostGlDetailResponse,
} from "@/types";

const STALE = 5 * 60 * 1000;

/** "2026-10" for the current month. */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Months the backend actually holds data for. */
export function usePeriods() {
  return useQuery<{ source: string; default_basis: string; periods: string[] }>({
    queryKey: ["costing", "periods"],
    queryFn: async () => (await api.get("/costing/periods")).data,
    staleTime: 30 * 60 * 1000,
  });
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function useCostSummary(period: string, section: CostSection) {
  return useQuery<CostSummaryResponse>({
    queryKey: ["costing", "summary", period, section],
    queryFn: async () =>
      (await api.get("/costing/summary", { params: { period, section } })).data,
    staleTime: STALE,
    enabled: Boolean(period),
  });
}

export function useCostCurve(period: string, section: CostSection) {
  return useQuery<CostCurveResponse>({
    queryKey: ["costing", "daily", period, section],
    queryFn: async () =>
      (await api.get("/costing/daily", { params: { period, section } })).data,
    staleTime: STALE,
    enabled: Boolean(period),
  });
}

export function useCostCoverage(period: string, section: CostSection) {
  return useQuery<CostCoverageResponse>({
    queryKey: ["costing", "coverage", period, section],
    queryFn: async () =>
      (await api.get("/costing/coverage", { params: { period, section } })).data,
    staleTime: STALE,
    enabled: Boolean(period),
  });
}

/** GL-level backing for one cost-sheet line. Idle until a line is picked. */
export function useCostGlDetail(
  period: string,
  section: CostSection,
  summaryLine: string | null,
) {
  return useQuery<CostGlDetailResponse>({
    queryKey: ["costing", "gl", period, section, summaryLine],
    queryFn: async () =>
      (
        await api.get("/costing/gl-detail", {
          params: { period, section, summary_line: summaryLine },
        })
      ).data,
    staleTime: STALE,
    enabled: Boolean(period && summaryLine),
  });
}

/** The GL Wise Summary sheet - the detailed half of the workbook. */
export interface GlWiseRow {
  gl_account: string;
  gl_description: string;
  costing_group: string;
  summary_line: string | null;
  bucket: string;
  included: boolean;
  remark: string;
  total: number;
  mines: number;
  cob: number;
}

export interface GlWiseResponse {
  period: string;
  basis: string;
  rows: GlWiseRow[];
  totals: {
    included: { rows: number; mines: number; cob: number; total: number };
    excluded: { rows: number; mines: number; cob: number; total: number };
  };
}

export function useGlWise(period: string) {
  return useQuery<GlWiseResponse>({
    queryKey: ["costing", "gl-wise", period],
    queryFn: async () => (await api.get("/costing/gl-wise", { params: { period } })).data,
    enabled: Boolean(period),
    staleTime: STALE,
  });
}
