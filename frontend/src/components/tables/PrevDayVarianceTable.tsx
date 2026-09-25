"use client";
/**
 * Previous day — Plan vs Actual, one row per KPI.
 *
 * TWO ANSWERS TO THE SAME QUESTION, ONE AT A TIME. The radio chooses which:
 *
 *   Actual      what SAP and the gate record say. Authoritative, and LATE —
 *               on the morning of 24 September, 23 September's ore and OB both
 *               still read zero from pp_production against a plan of 207 MT and
 *               1,091 CuM, because the goods movements had not been posted.
 *   Est Actual  what the mine entered by hand that morning, hours before SAP
 *               caught up. Available immediately, and an estimate.
 *
 * They are never shown side by side. The question a reader has is "what
 * happened yesterday", and two answers to it in one row invites the wrong one
 * to be quoted. Variance follows whichever column is showing, and the footer
 * names which it is.
 *
 * READ-ONLY. Entry happens in PrevDayEntryModal, opened from "Enter Est Actual"
 * in the three-dot menu in the header.
 *
 * THE DAY IS ALWAYS YESTERDAY, rolling over at 00:01 — see lib/prevDay.ts. It
 * fetches its own single day rather than following the global date filter, so
 * figures can never be entered against a date somebody is merely browsing, and
 * a stale set never lingers into a new day pretending to be current.
 *
 * UNITS follow DaywiseTable: ore, COB and despatch in MT; OB and total
 * excavation in CuM. VARIANCE = shown value - Plan; positive is ahead of plan.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import PrevDayEntryModal, { type StoredValue } from "@/components/tables/PrevDayEntryModal";
import { useEntryDialog } from "@/contexts/useEntryDialog";
import {
  ORE_T_PER_M3, buildRows, dayLabel, targetDayISO, type KpiRow,
} from "@/lib/prevDay";
import type { ProductionDaywiseResponse, DespatchDaywiseResponse } from "@/types";

type View = "actual" | "est";

function Num({ v, bold = false }: { v: number | null; bold?: boolean }) {
  if (v == null) return <span className="text-txt-light/50">—</span>;
  return (
    <span className={`font-mono text-navy${bold ? " font-bold" : ""}`}>
      {formatIndian(v)}
    </span>
  );
}

function Variance({ plan, value }: { plan: number | null; value: number | null }) {
  // Either side missing means the variance is unknown, not zero.
  if (plan == null || value == null) return <span className="text-txt-light/50">—</span>;
  const v = value - plan;
  const cls =
    v > 0 ? "text-success font-mono font-bold"
      : v < 0 ? "text-danger font-mono font-bold"
        : "text-txt-muted font-mono";
  return <span className={cls}>{v > 0 ? "+" : ""}{formatIndian(v)}</span>;
}

export default function PrevDayVarianceTable() {
  const qc = useQueryClient();
  const [day, setDay] = useState(targetDayISO);
  const [view, setView] = useState<View>("actual");
  const dialog = useEntryDialog((s) => s.which);
  const closeDialog = useEntryDialog((s) => s.close);

  // Roll over without a reload. Polling beats a timeout to midnight: background
  // tabs have their timers throttled and a sleeping laptop stops them
  // altogether, so a timeout set at 09:00 cannot be trusted to fire at 00:01.
  // The visibility listener makes the correction immediate on return to the tab
  // rather than up to a minute later.
  useEffect(() => {
    const check = () => setDay((prev) => {
      const now = targetDayISO();
      return prev === now ? prev : now;
    });
    const id = window.setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const prod = useQuery<ProductionDaywiseResponse>({
    queryKey: ["prev-day", "production", day],
    queryFn: async () => (await api.get("/production/daywise", {
      params: { from_date: day, to_date: day },
    })).data,
    staleTime: 5 * 60 * 1000,
  });
  const desp = useQuery<DespatchDaywiseResponse>({
    queryKey: ["prev-day", "despatch", day],
    queryFn: async () => (await api.get("/despatch/daywise", {
      params: { from_date: day, to_date: day },
    })).data,
    staleTime: 5 * 60 * 1000,
  });
  const entries = useQuery<{ values: Record<string, StoredValue> }>({
    queryKey: ["prev-day", "entered", day],
    queryFn: async () => (await api.get("/prev-day-actual", {
      params: { on_date: day },
    })).data,
    staleTime: 30 * 1000,
  });

  const rows: KpiRow[] = useMemo(
    () => buildRows(
      prod.data?.rows?.find((r) => r.date === day),
      desp.data?.rows?.find((r) => r.date === day),
    ),
    [prod.data, desp.data, day],
  );

  const stored = entries.data?.values;

  // Invalidate the day that was actually saved — the dialog may have been on a
  // different date from the one this table is showing.
  const refetchEntries = useCallback(
    (savedDay: string) =>
      qc.invalidateQueries({ queryKey: ["prev-day", "entered", savedDay] }),
    [qc],
  );

  const loading = prod.isLoading || desp.isLoading || entries.isLoading;
  const lastEntry = stored
    ? Object.values(stored).sort((a, b) =>
      (b.entered_at ?? "").localeCompare(a.entered_at ?? ""))[0]
    : undefined;

  /** The figure the selected view is asking for. */
  const shown = (r: KpiRow): number | null =>
    view === "actual" ? r.actual : (stored?.[r.key]?.value ?? null);

  return (
    <section className="space-y-2">
      <div className="section-title">
        <CalendarCheck size={13} />
        Previous Day — Plan vs Actual
        <span className="text-[10px] text-txt-light font-medium normal-case tracking-normal ml-1">
          {dayLabel(day)}
        </span>
      </div>

      <div className="rounded-xl overflow-hidden border border-border shadow-md bg-white">
        {/* ── which figure to show ──────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-3 py-2 border-b border-border-light bg-bg-soft flex-wrap">
          {([
            ["actual", "Actual",
              "Posted to SAP and the gate record — authoritative, but lags by a day or more"],
            ["est", "Est Actual",
              "Entered by hand on the morning — available immediately, an estimate"],
          ] as const).map(([val, label, hint]) => (
            <label
              key={val}
              title={hint}
              className="flex items-center gap-1.5 cursor-pointer select-none"
            >
              <input
                type="radio"
                name="prev-day-view"
                value={val}
                checked={view === val}
                onChange={() => setView(val)}
                className="accent-navy cursor-pointer"
              />
              <span className={`text-[11px] font-bold tracking-wide uppercase
                ${view === val ? "text-navy" : "text-txt-muted"}`}>
                {label}
              </span>
            </label>
          ))}
          <span className="text-[10px] text-txt-light/70 ml-auto">
            {view === "actual"
              ? "Posted figures — may still be incomplete for yesterday"
              : "Hand-entered — three-dot menu, Enter Est Actual"}
          </span>
        </div>

        {loading ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 bg-bg-section animate-pulse rounded" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[560px]">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="px-3 py-2 text-left font-condensed font-extrabold text-[12px] tracking-[.14em]">
                    KPI
                  </th>
                  <th className="px-3 py-2 text-right font-condensed font-extrabold text-[12px] tracking-[.14em]">
                    Plan
                  </th>
                  <th className="px-3 py-2 text-right font-condensed font-extrabold text-[12px] tracking-[.14em]">
                    {view === "actual" ? "Actual" : "Est Actual"}
                  </th>
                  <th className="px-3 py-2 text-right font-condensed font-extrabold text-[12px] tracking-[.14em]">
                    Variance
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const value = shown(r);
                  return (
                    <tr
                      key={r.key}
                      className="border-b border-border-light last:border-0 hover:bg-bg-soft/60"
                    >
                      <td className="px-3 py-2.5">
                        <span className="text-[12px] font-bold text-txt-primary">{r.label}</span>
                        <span className="ml-1.5 text-[10px] text-txt-light">{r.unit}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[13px]">
                        <Num v={r.plan} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-[13px]">
                        <Num v={value} bold />
                      </td>
                      <td className="px-3 py-2.5 text-right text-[13px]">
                        <Variance plan={r.plan} value={value} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-border-light px-3 py-1 flex items-center justify-between flex-wrap gap-1">
          <span className="text-[10px] text-txt-light/60">
            Variance = {view === "actual" ? "Actual" : "Est Actual"} − Plan · positive is ahead of plan
            {view === "est" && lastEntry && (
              <> · last entered by {lastEntry.entered_by}
                {lastEntry.entered_at
                  ? ` on ${new Date(lastEntry.entered_at).toLocaleString("en-IN")}`
                  : ""}
              </>
            )}
          </span>
          <span className="text-[9px] text-txt-light/50">
            Total Excavation = OB + Ore ÷ {ORE_T_PER_M3} t/m³, on both sides
          </span>
        </div>
      </div>

      <PrevDayEntryModal
        open={dialog === "prev-day"}
        onClose={closeDialog}
        defaultDay={day}
        onSaved={refetchEntries}
      />
    </section>
  );
}
