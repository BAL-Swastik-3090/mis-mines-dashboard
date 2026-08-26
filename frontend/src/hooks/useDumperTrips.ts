"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { DumperTripResponse } from "@/types";

/** Dumper-wise trip count (MAN / PRIMA) over the global date filter. */
export function useDumperTrips() {
  const { apiFrom, apiTo } = useDateFilter();
  return useQuery<DumperTripResponse>({
    queryKey: ["equipment", "dumper-trips", apiFrom, apiTo],
    queryFn: async () => {
      const res = await api.get("/equipment/dumper/trips", {
        params: { from_date: apiFrom, to_date: apiTo },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
