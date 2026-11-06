"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";
import type { PrPoRegisterResponse, PrPoSummaryResponse } from "@/types";

/* THE GLOBAL DATE FILTER IS NOT USED HERE, DELIBERATELY. Every other section
   reports a period of mine production; this one reports a backlog. A PR
   released in March still waiting on an NFA is exactly what a daily meeting
   needs to see, and a from/to set to this week would hide it. This page
   carries its own "released between" filter instead, which defaults wide. */

/* ONE REQUEST PER WINDOW. The register is fetched whole and every stage,
   status, owner, buyer, search and sort is applied in the browser.

   It used to send all of them to the server, so each one rebuilt a query
   across eleven tables -- 1.4s warm, 4.3s cold -- and the table sat on the
   previous answer until it returned, which is why sorting a column looked
   like nothing happening followed by the figures rearranging themselves.
   The full window is 2,190 rows and about 3.5MB uncompressed; fetching that
   once beats fetching a slice of it per click.

   Only `from` is in the key, because only `from` changes which rows exist.
   `to` narrows what is already here and is applied in the table. */
export interface PrPoFilter {
  from?: string;
  to?: string;
  stage?: string;
  rag?: string;
  owner?: string;
  buyer?: string;
  requester?: string;
  q?: string;
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

export function usePrPoRegister(f: Pick<PrPoFilter, "from">) {
  return useQuery<PrPoRegisterResponse>({
    queryKey: ["pr-po", "register", f.from ?? ""],
    queryFn: async () =>
      (await api.get("/pr-po/register", {
        params: {
          ...(f.from ? { from_date: f.from } : {}),
          limit: 5000,
        },
      })).data,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
