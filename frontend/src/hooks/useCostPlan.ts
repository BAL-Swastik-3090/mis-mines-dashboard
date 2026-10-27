"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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

export interface PlanSummary {
  fiscal_year: number;
  period: number;
  section: string | null;
  plan_month: string | null;
  totals: { amount: number; rows: number };
  by_section: { section: string; rows: number; amount: number }[];
  by_element: { cost_element: string; cost_element_desc: string; centres: number; amount: number }[];
  by_centre: { cost_centre: string; cost_centre_desc: string; section: string; elements: number; amount: number }[];
}

export function useCostPlanPeriods() {
  return useQuery<{ periods: PlanPeriod[]; masters: MasterStatus }>({
    queryKey: ["cost-plan", "periods"],
    queryFn: async () => (await api.get("/cost-plan/periods")).data,
    staleTime: 60_000,
  });
}

export function useCostPlanSummary(
  fiscalYear: number | null,
  period: number | null,
  section: string | null,
) {
  return useQuery<PlanSummary>({
    queryKey: ["cost-plan", "summary", fiscalYear, period, section],
    queryFn: async () => {
      const res = await api.get("/cost-plan/summary", {
        params: { fiscal_year: fiscalYear, period, section: section || undefined },
      });
      return res.data;
    },
    enabled: Boolean(fiscalYear && period),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
