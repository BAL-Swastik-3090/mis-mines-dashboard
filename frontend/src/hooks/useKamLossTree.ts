"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { KamLossTreeResponse } from "@/types";

/** KAM Wise Loss Tree. Derived server-side from the same LCM computation as the
 *  table above it, so the two can never disagree. Mirrors useLCM's caching. */
export function useKamLossTree() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<KamLossTreeResponse>({
    queryKey: ["oee", "lcm", "kam-tree", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/oee/lcm/kam-tree", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
