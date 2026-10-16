"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";
import type { EvOverviewResponse, EvVehicleHistoryResponse } from "@/types";

export function useEvOverview(fromDate: string | null, toDate: string | null) {
  return useQuery<EvOverviewResponse>({
    queryKey: ["ev-tracking", "overview", fromDate, toDate],
    queryFn: async () => {
      const res = await api.get("/ev-tracking/overview", {
        params: { from_date: fromDate, to_date: toDate }
      });
      return res.data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    enabled: Boolean(fromDate && toDate),
  });
}

export function useEvVehicleHistory(
  evEquipmentId: number | null, 
  fromDate: string | null, 
  toDate: string | null
) {
  return useQuery<EvVehicleHistoryResponse>({
    queryKey: ["ev-tracking", "history", evEquipmentId, fromDate, toDate],
    queryFn: async () => {
      const res = await api.get(`/ev-tracking/vehicle/${evEquipmentId}/history`, {
        params: { from_date: fromDate, to_date: toDate },
      });
      return res.data;
    },
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    enabled: Boolean(evEquipmentId && fromDate && toDate),
  });
}

/* ── THE REST OF THE EV PAGE, ON THE SAME CACHE ─────────────────────────────
   These four panels each fetched in their own useEffect, which means they
   refetched from scratch every time they mounted — and they mount on every tab
   switch, because the tab body is keyed so it can fade in. Switching to Work
   Analysis and back paid for the whole page again: four requests, each of them
   several hundred milliseconds of waiting on a database across the VPN, to
   redraw figures that had not changed.

   On the query cache the second visit is instant and the data still refreshes
   when it is genuinely stale. staleTime is set per panel by how fast the thing
   underneath actually moves: telemetry arrives once a day, so a minute of
   staleness on a figure is not a risk, while freshness — whose whole job is to
   be right about the clock — refetches on its own schedule as it did before.  */

export function useEvAnalytics(fromDate: string | null, toDate: string | null) {
  return useQuery({
    queryKey: ["ev", "analytics", fromDate, toDate],
    queryFn: async () => (await api.get("/ev/analytics",
      { params: { from_date: fromDate, to_date: toDate } })).data,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useEvFreshness() {
  return useQuery({
    queryKey: ["ev", "freshness"],
    queryFn: async () => (await api.get("/ev/freshness")).data,
    /* The answer changes at 09:30 whether or not anybody reloads, and a badge
       that is stale about staleness is worse than no badge. */
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useEvCoverage() {
  return useQuery({
    queryKey: ["ev", "coverage"],
    queryFn: async () => (await api.get("/ev/coverage")).data,
    staleTime: 5 * 60_000,
  });
}

export function useEvHistoryAll(fromDate: string | null, toDate: string | null) {
  return useQuery({
    queryKey: ["ev-tracking", "history-all", fromDate, toDate],
    queryFn: async () => (await api.get("/ev-tracking/history",
      { params: { from_date: fromDate, to_date: toDate } })).data,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    enabled: Boolean(fromDate && toDate),
  });
}
