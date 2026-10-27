"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { TipperOEEResponse } from "@/types";

/** Both tipper tables in one call — old (MAN) and new (PRIMA) come back
 *  together so the two cards cannot end up showing different periods. */
export function useTipperOEE() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<TipperOEEResponse>({
    queryKey: ["oee", "tippers", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/oee/tippers", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
