"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { GradeDespatchResponse } from "@/types";

/** Grade-wise despatch — tonnage banded by assayed Cr₂O₃ over the global filter. */
export function useGradeDespatch() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<GradeDespatchResponse>({
    queryKey: ["despatch", "grade-wise", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/despatch/grade-wise", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
