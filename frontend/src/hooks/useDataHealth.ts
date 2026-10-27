"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { DataHealthResponse, DataHealthFeed, DataHealthStatus } from "@/types";

/** Worst first. Mirrors SEVERITY in backend/app/services/data_health.py. */
const SEVERITY: Record<DataHealthStatus, number> = {
  ok: 0, unknown: 1, warn: 2, stale: 3,
};

/**
 * Freshness of every monitored feed, for the whole application.
 *
 * ONE QUERY KEY, SHARED. The page banner, the sidebar dots and the Data Health
 * page all call this hook, and TanStack dedupes them onto a single request —
 * which matters because the probe behind it is a full scan of several large
 * tables. Three independent fetches would cost three of those.
 *
 * Polled every five minutes against a server cache of ten. The underlying fact
 * changes a handful of times a day, when a sync runs or somebody files a form,
 * so anything faster is load without information.
 */
export function useDataHealth() {
  return useQuery<DataHealthResponse>({
    queryKey: ["data-health"],
    queryFn: async () => (await api.get("/data-health")).data,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    // A freshness warning that itself fails must stay silent rather than
    // showing an error banner over a page that is working. Absence of the
    // warning is the safe direction here: the page still renders its figures.
    retry: 1,
  });
}

/**
 * The feeds behind one section, worst first — and whether the section is
 * watched at all.
 *
 * `monitored: false` is NOT the same as healthy, and the two must not collapse
 * into one green state. Weather has no feed to be late; Equipment 360 holds
 * master data with no daily cadence. Saying "all current" about those would be
 * claiming an assurance nobody checked.
 */
export function useSectionHealth(section: string) {
  const { data, isLoading } = useDataHealth();

  const sec = data?.sections?.[section];
  const byKey = new Map((data?.feeds ?? []).map((f) => [f.key, f]));
  const feeds: DataHealthFeed[] = (sec?.feeds ?? [])
    .map((k) => byKey.get(k))
    .filter((f): f is DataHealthFeed => Boolean(f))
    .sort((a, b) =>
      SEVERITY[b.status] - SEVERITY[a.status] ||
      (b.days_behind ?? 0) - (a.days_behind ?? 0));

  return {
    isLoading,
    monitored: Boolean(sec),
    unmonitoredReason: data?.unmonitored?.[section] ?? null,
    status: sec?.status ?? "ok",
    /** Only the ones worth showing — an OK feed has nothing to say. */
    problems: feeds.filter((f) => f.status !== "ok"),
    feeds,
    expectedDate: data?.expected_date ?? null,
  };
}
