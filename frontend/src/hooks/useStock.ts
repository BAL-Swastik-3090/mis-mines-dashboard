"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import { stockAsOn } from "@/lib/prevDay";
import type { StockPositionResponse } from "@/types";

/**
 * Mines stock position from `mines_stock_entry`, filled in on this dashboard.
 *
 * ── WHICH DAY IT ASKS FOR ───────────────────────────────────────────────────
 * The morning AFTER the day the dashboard is reporting on — see stockAsOn in
 * lib/prevDay, which both this and the Plan vs Actual panel now derive from.
 *
 * It used to pass the filter's end date straight through. That read as the
 * obvious thing to do and it was wrong in the way nobody notices until it is
 * pointed out: the stock form is filled in at the start of a day and dated
 * that day, so the snapshot dated 30 September describes the morning of the
 * 30th — before the 30th's production, which is what the panel above it is
 * showing. Asking for the next morning's snapshot puts the two panels on the
 * same day's work.
 *
 * The table is a snapshot per Stock_Date rather than a daily series, so the
 * server returns the latest snapshot on or before this date and reports how
 * stale it is — a morning before anyone has filed still shows the real last
 * position, labelled with its own date.
 */
export function useStockPosition() {
  const { apiTo } = useDateFilter();
  const asOn = stockAsOn(apiTo);
  return useQuery<StockPositionResponse>({
    queryKey: ["stock", "position", asOn],
    queryFn: async () => {
      const res = await api.get("/stock/position", { params: { as_on: asOn } });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
