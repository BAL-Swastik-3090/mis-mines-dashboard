"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";
import type { PrPoRegisterResponse, PrPoSummaryResponse } from "@/types";

/* THE DATE FILTER IS NOT USED HERE, DELIBERATELY. Every other section reports
   a period of mine production; this one reports a backlog. A PR released in
   March that is still waiting on an NFA is exactly what a daily meeting needs
   to see, and a from/to filter set to this week would hide it. The window is
   "released in the last year", set by the server, and the reporting date is
   today. */

export function usePrPoSummary() {
  return useQuery<PrPoSummaryResponse>({
    queryKey: ["pr-po", "summary"],
    queryFn: async () => (await api.get("/pr-po/summary")).data,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function usePrPoRegister(filter: {
  stage?: string; rag?: string; owner?: string; q?: string;
}) {
  const { stage, rag, owner, q } = filter;
  return useQuery<PrPoRegisterResponse>({
    queryKey: ["pr-po", "register", stage ?? "", rag ?? "", owner ?? "", q ?? ""],
    queryFn: async () =>
      (await api.get("/pr-po/register", {
        params: {
          ...(stage ? { stage } : {}),
          ...(rag ? { rag } : {}),
          ...(owner ? { owner } : {}),
          ...(q ? { q } : {}),
          limit: 500,
        },
      })).data,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
