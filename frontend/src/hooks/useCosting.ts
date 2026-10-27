"use client";
/**
 * TanStack Query hooks for the product-costing endpoints.
 *
 * Costing is period-based (a whole month) while the header filter is a
 * range, so the two are reconciled in one place: the month is the month the
 * range ENDS in, and that end date is also the as-of day the month-end
 * accrual is pro-rated to. Two date controls on one screen is how a sheet
 * ends up reading December while the header says October.
 */
import { useQuery } from "@tanstack/react-query";
import { useDateFilter } from "@/contexts/useDateFilter";
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

/**
 * The month and day the cost sheet should answer for, taken from the header.
 *
 * A range that ends on 27 Oct asks for October's sheet as at the 27th. A
 * range spanning months answers for the one it ends in - a cost sheet is a
 * monthly document and cannot straddle two.
 */
export function useCostingPeriod(): { period: string; asOf: string } {
  const apiTo = useDateFilter((s) => s.apiTo);
  return { period: apiTo.slice(0, 7), asOf: apiTo };
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

export function useCostSummary(period: string, section: CostSection, asOf?: string) {
  return useQuery<CostSummaryResponse>({
    queryKey: ["costing", "summary", period, section, asOf ?? null],
    queryFn: async () =>
      (await api.get("/costing/summary", {
        params: { period, section, as_of: asOf || undefined },
      })).data,
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
