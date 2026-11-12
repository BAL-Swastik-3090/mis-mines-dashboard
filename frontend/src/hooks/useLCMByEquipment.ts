"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { LCMByEquipmentResponse } from "@/types";

/**
 * The Equipment Wise Lost Cost Matrix.
 *
 * Under the SAME `["oee", …]` query-key prefix as every other block on this
 * page, so invalidating `["oee"]` after a change on the OEE Master Selector
 * refetches this table along with the matrix below it. A machine deactivated,
 * a capacity corrected or the excavation plan re-entered all move this table,
 * and it must never be the one screen still showing the old answer.
 */
export function useLCMByEquipment() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<LCMByEquipmentResponse>({
    queryKey: ["oee", "lcm", "by-equipment", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/oee/lcm/by-equipment", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });
}
