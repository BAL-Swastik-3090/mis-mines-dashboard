"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { FuelSummaryResponse } from "@/types";

/** Historical fleet fuel aggregates for the globally-selected date range.
 *  No polling — historical data does not move; it refetches when the date changes. */
export function useFuelSummary() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<FuelSummaryResponse>({
    queryKey: ["fuel-management", "summary", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/fuel-management/summary", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
