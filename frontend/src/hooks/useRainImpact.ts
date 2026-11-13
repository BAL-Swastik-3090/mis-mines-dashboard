"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { LCMByEquipmentResponse } from "@/types";

/** The loss head the mine deducts from its plan. Keyed on the COLUMN, never
 *  the label: "Rain & slippery problem" is a display string in lcm.py's
 *  LABEL_OVERRIDES and renaming it must not silently zero this row. */
const RAIN_COLUMN = "rain_slippery";

/**
 * Ore tonnage the mine lost to rain, for one window.
 *
 * THE SAME FIGURE THE LCM PAGE PRINTS, from the same endpoint, because it is
 * read off that page and typed into this one. /oee/lcm/by-equipment gives
 * each loss head a `planned_ore_loss`, and the Equipment Wise matrix is the
 * one the LCM screen shows -- its rain row reads 1,346.2 MT where the OVERALL
 * matrix reads 1,231.4, and a summary quoting the second while the detail
 * shows the first is a reconciliation nobody can win.
 *
 * IT TAKES ITS OWN WINDOW rather than the global date filter. The Executive
 * Summary sends only an end date and the server derives the month from it, so
 * a filter starting mid-month would otherwise pair a month's plan with a
 * fortnight's rain. Passing the summary's own mtd_from/report_day makes the
 * deduction correspond to the plan it is deducted from, and on the usual case
 * -- a filter covering the month -- the key matches useLCMByEquipment's and
 * the two share one cached response rather than fetching twice.
 *
 * SEPARATE FROM THE SUMMARY'S OWN REQUEST, deliberately. This matrix costs
 * six to nine seconds to compute; folding it into /executive-summary would
 * put that in front of the stock position, the despatch tables and every
 * other block on the page. Fetched here, the row fills in when it arrives and
 * nothing else waits for it.
 */
export function useRainImpact(from?: string | null, to?: string | null) {
  const q = useQuery<LCMByEquipmentResponse>({
    queryKey: ["oee", "lcm", "by-equipment", from, to],
    queryFn: async () => {
      const res = await api.get("/oee/lcm/by-equipment", {
        params: { from_date: from, to_date: to },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(from && to),
  });

  const row = q.data?.rows?.find((r) => r.column === RAIN_COLUMN);
  return {
    /** MT of ore the rain cost. Null while loading, and null if the matrix
     *  carries no rain row at all -- which is not the same as nought and must
     *  not print as a deduction of zero. */
    mt: row?.planned_ore_loss ?? null,
    loading: q.isLoading,
    failed: q.isError,
  };
}
