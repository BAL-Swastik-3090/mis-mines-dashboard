"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { LossStructureResponse } from "@/types";

/**
 * The KAM Wise Loss Structure — the mine's own layout.
 *
 * Under the same `["oee", …]` key prefix as the matrix and the tree, so one
 * invalidation after a change on the OEE Master Selector refetches all of
 * them. A loss head moved to Head Electrical, a KAM changed, a machine
 * deactivated — each moves this section, and it must never be the one screen
 * still showing the previous answer.
 */
export function useLossStructure() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<LossStructureResponse>({
    queryKey: ["oee", "lcm", "loss-structure", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/oee/lcm/loss-structure", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
