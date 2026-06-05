"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { StockPositionResponse } from "@/types";

/**
 * Stock position — no date params needed (SAP snapshot, always current).
 * Cached for 10 minutes since stock doesn't change every second.
 */
export function useStockPosition() {
  return useQuery<StockPositionResponse>({
    queryKey: ["stock", "position"],
    queryFn: async () => {
      const res = await api.get("/stock/position");
      return res.data;
    },
    staleTime: 10 * 60 * 1000,
  });
}
