"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { StockPositionResponse } from "@/types";

/**
 * Mines stock position from IMOS entry (`mines_stock`).
 *
 * Passes the filter's end date as `as_on`: the table is a snapshot per
 * Stock_Date rather than a daily series, so the server returns the latest
 * snapshot on or before that date and reports how stale it is.
 */
export function useStockPosition() {
  const { apiTo } = useDateFilter();
  return useQuery<StockPositionResponse>({
    queryKey: ["stock", "position", apiTo],
    queryFn: async () => {
      const res = await api.get("/stock/position", { params: { as_on: apiTo } });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
