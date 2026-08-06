"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { OEEResponse } from "@/types";

export function useOEE() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<OEEResponse>({
    queryKey: ["oee", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/oee", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
