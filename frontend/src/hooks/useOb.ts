"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { ObSummaryResponse } from "@/types";

export function useObSummary() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<ObSummaryResponse>({
    queryKey: ["ob", "summary", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/ob/summary", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
