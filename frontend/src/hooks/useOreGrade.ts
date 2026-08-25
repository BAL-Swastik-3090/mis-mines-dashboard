"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { OreGradeResponse } from "@/types";

/** Grade-wise weighted average Cr2O3 of ore production, over the global filter. */
export function useOreGrade() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<OreGradeResponse>({
    queryKey: ["production", "ore-grade", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/production/ore-grade", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
