"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { LCMResponse } from "@/types";

export function useLCM() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<LCMResponse>({
    queryKey: ["oee", "lcm", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/oee/lcm", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
