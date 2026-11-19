"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { OEEResponse } from "@/types";

/**
 * The excavator OEE roll-up the Executive Summary's equipment block reads.
 *
 * IT TAKES A WINDOW rather than reading the global date filter, exactly as
 * useExecLossStructure does and for the same reason. The summary sends only
 * an end date and the server derives the month from it, so a filter starting
 * mid-month would otherwise put a fortnight's machine hours beside a month's
 * production. Passing the summary's own mtd_from/report_day makes the hours
 * correspond to the tonnage they produced.
 *
 * THE SAME QUERY KEY THE OEE PAGE USES, deliberately. A filter covering the
 * whole month asks for the identical window, so the two pages share one
 * cached response instead of computing the roster twice — and invalidating
 * ["oee"] after a change on the Equipment Status Selector moves both.
 *
 * NOT FOLDED INTO /executive-summary. The roster has to be resolved and the
 * shift log scanned machine by machine; putting that in front of the stock
 * position would delay every other block on the page for a figure that can
 * perfectly well arrive a moment later.
 */
export function useExecOee(from?: string | null, to?: string | null) {
  return useQuery<OEEResponse>({
    queryKey: ["oee", from, to],
    queryFn: async () =>
      (await api.get("/oee", { params: { from_date: from, to_date: to } })).data,
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(from && to),
  });
}
