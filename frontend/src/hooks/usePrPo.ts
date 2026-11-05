"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";
import type { PrPoRegisterResponse, PrPoSummaryResponse } from "@/types";

/* THE GLOBAL DATE FILTER IS NOT USED HERE, DELIBERATELY. Every other section
   reports a period of mine production; this one reports a backlog. A PR
   released in March still waiting on an NFA is exactly what a daily meeting
   needs to see, and a from/to set to this week would hide it. This page
   carries its own "released between" filter instead, which defaults wide. */

export interface PrPoFilter {
  from?: string;
  to?: string;
  stage?: string;
  rag?: string;
  owner?: string;
  buyer?: string;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
}

export function usePrPoSummary(filter: Pick<PrPoFilter, "from"> = {}) {
  const { from } = filter;
  return useQuery<PrPoSummaryResponse>({
    queryKey: ["pr-po", "summary", from ?? ""],
    queryFn: async () =>
      (await api.get("/pr-po/summary", {
        params: { ...(from ? { from_date: from } : {}) },
      })).data,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function usePrPoRegister(f: PrPoFilter) {
  return useQuery<PrPoRegisterResponse>({
    queryKey: ["pr-po", "register", f.from ?? "", f.to ?? "", f.stage ?? "",
               f.rag ?? "", f.owner ?? "", f.buyer ?? "", f.q ?? "",
               f.sort ?? "", f.dir ?? ""],
    queryFn: async () =>
      (await api.get("/pr-po/register", {
        params: {
          ...(f.from  ? { from_date: f.from } : {}),
          ...(f.to    ? { to_date: f.to }     : {}),
          ...(f.stage ? { stage: f.stage }    : {}),
          ...(f.rag   ? { rag: f.rag }        : {}),
          ...(f.owner ? { owner: f.owner }    : {}),
          ...(f.buyer ? { buyer: f.buyer }    : {}),
          ...(f.q     ? { q: f.q }            : {}),
          ...(f.sort  ? { sort: f.sort, dir: f.dir ?? "desc" } : {}),
          limit: 500,
        },
      })).data,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
