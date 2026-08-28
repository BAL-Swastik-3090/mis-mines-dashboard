"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { CobLcmResponse } from "@/types";

/** LCM for COB — concentrate deviation attributed to feed volume and recovery. */
export function useCobLcm() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<CobLcmResponse>({
    queryKey: ["oee", "lcm-cob", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/oee/lcm/cob", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
