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
