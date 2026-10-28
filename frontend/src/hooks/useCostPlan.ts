"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface PlanPeriod {
  fiscal_year: number;
  period: number;
  plan_month: string;
  rows: number;
  mines_rows: number;
  amount_total: number;
  mines_amount: number;
  files: number;
  last_upload: string;
}

export interface MasterStatus {
  elements: number;
  centres: number;
  unmapped_elements: number;
  unmapped_centres: number;
}

export function useCostPlanPeriods() {
  return useQuery<{ periods: PlanPeriod[]; masters: MasterStatus }>({
    queryKey: ["cost-plan", "periods"],
    queryFn: async () => (await api.get("/cost-plan/periods")).data,
    staleTime: 60_000,
  });
}

export interface PlanCoverageFile {
  name: string;
  present: boolean;
  source_file: string | null;
  fills: string[];
  amount: number;
  /** Lines this export carries that nothing else has supplied either. */
  missing_lines: string[];
}

export interface PlanCoverage {
  fiscal_year: number;
  period: number;
  plan_month: string;
  files_loaded: number;
  files_expected: number;
  complete: boolean;
  files: PlanCoverageFile[];
  unrecognised_files: string[];
  amount_total: number;
  amount_unmapped: number;
}

/** Which of the month's four plan exports are in. Null fiscal year = latest. */
export function usePlanCoverage(fiscalYear?: number | null, period?: number | null) {
  return useQuery<PlanCoverage>({
    queryKey: ["cost-plan", "coverage", fiscalYear ?? null, period ?? null],
    queryFn: async () => {
      const res = await api.get("/cost-plan/coverage", {
        params: { fiscal_year: fiscalYear ?? undefined, period: period ?? undefined },
      });
      return res.data;
    },
    staleTime: 30_000,
  });
}
