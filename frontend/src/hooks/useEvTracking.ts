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
