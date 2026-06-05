"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { PlantPerformanceResponse } from "@/types";

export function usePlantPerformance() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<PlantPerformanceResponse>({
    queryKey: ["plant", "performance", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/plant/performance", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
