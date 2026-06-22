"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { DewateringSummaryResponse } from "@/types";

export function useDewatering() {
  const { apiFrom, apiTo } = useDateFilter();

  const t = new Date();
  const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const live = apiTo === todayStr;

  return useQuery<DewateringSummaryResponse>({
    queryKey:        ["dewatering", "summary", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/dewatering/summary", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime:       live ? 55_000 : 5 * 60_000,
    refetchInterval: live ? 60_000 : false,
    placeholderData: keepPreviousData,
    enabled:         Boolean(apiFrom && apiTo),
  });
}
