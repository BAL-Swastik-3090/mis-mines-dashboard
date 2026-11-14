"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { LCMByEquipmentResponse, LossStructureResponse } from "@/types";

/**
 * The two LCM payloads the Executive Summary's loss blocks are built from.
 *
 * THEY TAKE A WINDOW rather than reading the global date filter themselves.
 * The Executive Summary sends only an end date and the server derives the
 * month from it, so a filter starting mid-month would otherwise pair a
 * month's plan with a fortnight's loss. Passing the summary's own
 * mtd_from/report_day makes the loss correspond to the production it explains
 * -- and because the keys are the same ones the LCM page uses, a filter
 * covering the month shares one cached response instead of fetching twice.
 *
 * THEY ARE SEPARATE REQUESTS FROM THE PAGE ITSELF. Either matrix costs six to
 * nine seconds to compute; folding them into /executive-summary would put
 * that delay in front of the stock position, the production tables and every
 * other block. Fetched here, the loss blocks fill in when they arrive and
 * nothing else waits for them.
 */
export function useExecLossStructure(from?: string | null, to?: string | null) {
  return useQuery<LossStructureResponse>({
    queryKey: ["oee", "lcm", "loss-structure", from, to],
    queryFn: async () =>
      (await api.get("/oee/lcm/loss-structure",
        { params: { from_date: from, to_date: to } })).data,
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(from && to),
  });
}

export function useExecLcmByEquipment(from?: string | null, to?: string | null) {
  return useQuery<LCMByEquipmentResponse>({
    queryKey: ["oee", "lcm", "by-equipment", from, to],
    queryFn: async () =>
      (await api.get("/oee/lcm/by-equipment",
        { params: { from_date: from, to_date: to } })).data,
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(from && to),
  });
}
