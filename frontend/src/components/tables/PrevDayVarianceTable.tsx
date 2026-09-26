"use client";
/**
 * Previous day — Plan vs Actual, one row per KPI.
 *
 * TWO ANSWERS TO THE SAME QUESTION. The radio chooses which:
 *
 *   Actual      what SAP and the gate record say. Authoritative, and LATE —
 *               on the morning of 24 September, 23 September's ore and OB both
 *               still read zero from pp_production against a plan of 207 MT and
 *               1,091 CuM, because the goods movements had not been posted.
 *   Est Actual  what the mine entered by hand that morning, hours before SAP
 *               caught up. Available immediately, and an estimate.
 *
 * For ONE day they are not shown together. The question a reader has is "what
 * happened yesterday", and two answers to it in one row invites the wrong one
 * to be quoted. Variance follows whichever column is showing, and the footer
 * names which it is.
 *
 * THE THIRD VIEW, "Both Days", is the exception, and it is a different
 * question. Est Actual is asserted at nine in the morning, hours before SAP
 * has anything; whether it can be trusted is answerable only afterwards. So
 * the day before last is shown beside it with BOTH its figures — what was
 * estimated, and what was eventually posted. That is the estimate being
 * marked, which is the one place the two belong in the same row.
 *
 * The older day carries no Plan and no Variance. Its plan is already history
 * and repeating it invites the reader to measure this day's variance against
 * the wrong row.
 *
 * READ-ONLY. Entry happens in PrevDayEntryModal, opened from "Enter Est Actual"
 * in the three-dot menu in the header.
 *
 * THE DAY FOLLOWS THE HEADER. It is the day before "report as on" — the
 * header's own date, the one every other screen on this dashboard obeys.
 *
 * It used to fetch yesterday and only yesterday, on the argument that a figure
 * could then never be entered against a date somebody was merely browsing.
 * That protection belongs where the writing happens, and it is there: the
 * entry dialog carries its own date and saves against that, not against
 * whatever this table is showing. What the argument cost was the ordinary
 * thing: the morning meeting could not look back at the day before last
 * without the panel snapping to yesterday.
 *
 * Two dates on one page is two answers to "which day am I looking at", and the
 * header's is the one that wins.
 *
 * UNITS follow DaywiseTable: ore, COB and despatch in MT; OB and total
 * excavation in CuM. VARIANCE = shown value - Plan; positive is ahead of plan.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import PrevDayEntryModal, { type StoredValue } from "@/components/tables/PrevDayEntryModal";
import { useEntryDialog } from "@/contexts/useEntryDialog";
import { useDateFilter } from "@/contexts/useDateFilter";
import {
  ORE_T_PER_M3, buildRows, dayBefore, dayLabel, type KpiRow,
} from "@/lib/prevDay";
import type { ProductionDaywiseResponse, DespatchDaywiseResponse } from "@/types";

type View = "actual" | "est" | "both";

function Num({ v, bold = false }: { v: number | null; bold?: boolean }) {
  if (v == null) return <span className="text-txt-light/50">—</span>;
  return (
    <span className={`font-mono text-navy${bold ? " font-bold" : ""}`}>
      {formatIndian(v)}
    </span>
  );
}

/** The four the two labs report on, and what to head the column. */
const QUALITY = [
  ["moisture", "Mois%"], ["cr2o3", "Cr2O3%"],
  ["feo", "FeO%"], ["cr_fe", "Cr/Fe"],
] as const;

/**
 * The mine's figure, with the plant's underneath where it differs.
 *
 * Only where it differs: printing both on every row doubles the ink to say
 * "the labs agree", which is the ordinary case and not news. A dash means
 * nobody has assayed it yet — the plant posts its receipt one to three days
 * after the trucks leave — and a dash is not a zero.
 */
function Assay({ mine, plant }: { mine: number | null; plant: number | null }) {
  if (mine == null && plant == null) {
    return <span className="text-txt-light/40">—</span>;
  }
  const differs = mine != null && plant != null && Math.abs(plant - mine) >= 0.05;
  return (
    <span className="inline-block leading-tight">
      <span className="font-mono text-navy">
        {mine == null ? "—" : formatIndian(mine, 2)}
      </span>
      {differs && (
        <span className="block text-[9.5px] font-mono text-txt-light"
          title={`Plant ${formatIndian(plant, 2)} · ${plant > mine ? "+" : ""}`
                 + `${formatIndian(plant - mine, 2)} against the mine`}>
          {formatIndian(plant, 2)}
        </span>
      )}
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
  // "Report as on" is the end of the header's range. This panel is about the
  // day before it — that is what "previous day" means, whichever day is being
  // reported on.
  const asOn = useDateFilter((s) => s.apiTo);
  const day = useMemo(() => dayBefore(asOn), [asOn]);
  /** The day before that, for the "Both Days" view. */
  const older = useMemo(() => dayBefore(day), [day]);
  const [view, setView] = useState<View>("actual");
  const dialog = useEntryDialog((s) => s.which);
  const closeDialog = useEntryDialog((s) => s.close);

  // The midnight rollover timer that used to live here has gone with the
  // hard-coded day. Rolling this one panel over at 00:01 while the header
  // above it still said yesterday would have put two different days on one
  // screen, which is the thing this change exists to stop.

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
  /**
   * The assay of what went out that day, weighted by quantity.
   *
   * Straight from /quality-e2e with one day on both ends, rather than a second
   * query written here: that service is verified against the mine's own
   * workbook, and a second path to the same figure is a second path to a
   * different figure.
   *
   * Both halves come back blank for a despatch the labs have not finished
   * with — the plant posts its receipt one to three days later — and blank is
   * the honest answer, not zero.
   */
  const assay = useQuery<{ totals: Record<string, number | null> }>({
    queryKey: ["prev-day", "assay", day],
    queryFn: async () => (await api.get("/quality-e2e", {
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

  // The same three requests for the older day. They are only needed by one of
  // the three views, so they are not made until it is chosen — a panel that
  // opens on Actual should not be fetching six things to show three.
  const wantOlder = view === "both";
  const olderProd = useQuery<ProductionDaywiseResponse>({
    queryKey: ["prev-day", "production", older],
    queryFn: async () => (await api.get("/production/daywise", {
      params: { from_date: older, to_date: older },
    })).data,
    staleTime: 5 * 60 * 1000,
    enabled: wantOlder,
  });
  const olderDesp = useQuery<DespatchDaywiseResponse>({
    queryKey: ["prev-day", "despatch", older],
    queryFn: async () => (await api.get("/despatch/daywise", {
      params: { from_date: older, to_date: older },
    })).data,
    staleTime: 5 * 60 * 1000,
    enabled: wantOlder,
  });
  const olderEntries = useQuery<{ values: Record<string, StoredValue> }>({
    queryKey: ["prev-day", "entered", older],
    queryFn: async () => (await api.get("/prev-day-actual", {
      params: { on_date: older },
    })).data,
    staleTime: 30 * 1000,
    enabled: wantOlder,
  });

  const rows: KpiRow[] = useMemo(
    () => buildRows(
      prod.data?.rows?.find((r) => r.date === day),
      desp.data?.rows?.find((r) => r.date === day),
    ),
    [prod.data, desp.data, day],
  );

  const olderRows: KpiRow[] = useMemo(
    () => buildRows(
      olderProd.data?.rows?.find((r) => r.date === older),
      olderDesp.data?.rows?.find((r) => r.date === older),
    ),
    [olderProd.data, olderDesp.data, older],
  );

  const stored = entries.data?.values;
  const q = assay.data?.totals;
  const olderStored = olderEntries.data?.values;

  // Invalidate the day that was actually saved — the dialog may have been on a
  // different date from the one this table is showing.
  const refetchEntries = useCallback(
    (savedDay: string) =>
      qc.invalidateQueries({ queryKey: ["prev-day", "entered", savedDay] }),
    [qc],
  );

  const loading = prod.isLoading || desp.isLoading || entries.isLoading
    || (wantOlder && (olderProd.isLoading || olderDesp.isLoading
                      || olderEntries.isLoading));
  const lastEntry = stored
    ? Object.values(stored).sort((a, b) =>
      (b.entered_at ?? "").localeCompare(a.entered_at ?? ""))[0]
    : undefined;

  /** The figure the selected view is asking for. In "Both Days" the estimate
   *  is the figure on the left, because it is the one being marked. */
  const shown = (r: KpiRow): number | null =>
    view === "actual" ? r.actual : (stored?.[r.key]?.value ?? null);

  const valueLabel = view === "actual" ? "Actual" : "Est Actual";

  return (
    <section className="space-y-2">
      <div className="section-title">
        <CalendarCheck size={13} />
        Previous Day — Plan vs Actual
      </div>

      <div className="rounded-xl overflow-hidden border border-border shadow-md bg-white">
        {/* ── which figure to show ──────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-border-light bg-bg-soft flex-wrap">
          {/* The day this table is about, in the row somebody reads immediately
              before the figures.

              It was beside the title in ten-pixel light grey, which on the
              meeting-room screen was not readable at all — and a table of
              yesterday's production whose date cannot be read is a table that
              gets quoted for the wrong day. It says where to change it, since
              the control is at the top of the page and not next to it. */}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[12px] font-bold text-navy">{dayLabel(day)}</span>
            <span className="text-[10px] text-txt-light">· from the date at the top</span>
          </span>
          <span className="h-4 w-px bg-border" />
          {([
            ["actual", "Actual",
              "Posted to SAP and the gate record — authoritative, but lags by a day or more"],
            ["est", "Est Actual",
              "Entered by hand on the morning — available immediately, an estimate"],
            ["both", "Both Days",
              "This day against the day before it, with that day's estimate beside "
              + "what was eventually posted — how close the estimate turned out to be"],
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
              : view === "est"
                ? "Hand-entered — three-dot menu, Enter Est Actual"
                : `${dayLabel(older)} on the right — estimate against what was posted`}
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
            <table className={`w-full border-collapse ${view === "both" ? "min-w-[800px]" : "min-w-[760px]"}`}>
              <thead>
                {/* In "Both Days" the columns belong to two different dates, so
                    the dates are a header row of their own. Five unlabelled
                    columns, two of them about a day the reader has not been
                    told about, is a table that gets misread. */}
                {view === "both" && (
                  <tr className="bg-navy text-white/90">
                    <th className="px-3 pt-2 pb-0.5" />
                    <th colSpan={3}
                      className="px-3 pt-2 pb-0.5 text-center font-condensed font-bold
                                 text-[11px] tracking-[.1em] border-b border-white/20">
                      {dayLabel(day)}
                    </th>
                    <th colSpan={2}
                      className="px-3 pt-2 pb-0.5 text-center font-condensed font-bold
                                 text-[11px] tracking-[.1em] border-b border-white/20
                                 border-l border-l-white/30">
                      {dayLabel(older)}
                    </th>
                  </tr>
                )}
                <tr className="bg-navy text-white">
                  <th className="px-3 py-2 text-left font-condensed font-extrabold
                                 text-[12px] tracking-[.14em] w-[24%]">
                    KPI
                  </th>
                  <th className="px-3 py-2 text-right font-condensed font-extrabold text-[12px] tracking-[.14em]">Plan</th>
                  <th className="px-3 py-2 text-right font-condensed font-extrabold text-[12px] tracking-[.14em]">
                    {view === "both" ? "Est Actual" : valueLabel}
                  </th>
                  <th className="px-3 py-2 text-right font-condensed font-extrabold text-[12px] tracking-[.14em]">Variance</th>
                  {/* The assay of the day's despatch. Not in Both Days: that
                      view already carries two date groups, and four more
                      columns would push the comparison off the screen. */}
                  {view !== "both" && QUALITY.map(([, label]) => (
                    <th key={label}
                      className="px-2 py-2 text-right font-condensed font-extrabold
                                 text-[11px] tracking-[.08em] w-[76px]
                                 first:border-l first:border-white/20">
                      {label}
                    </th>
                  ))}
                  {view === "both" && (
                    <>
                      <th className="px-3 py-2 text-right font-condensed font-extrabold text-[12px] tracking-[.14em] border-l border-l-white/30">
                        Est Actual
                      </th>
                      <th className="px-3 py-2 text-right font-condensed font-extrabold text-[12px] tracking-[.14em]">Actual</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const value = shown(r);
                  // Matched by KPI key, not by position: buildRows returns the
                  // five in a fixed order today, and a lookup that quietly
                  // depends on that would put OB's figure on the ore row the
                  // day somebody inserts a sixth.
                  const old = olderRows.find((o) => o.key === r.key);
                  const oldEst = olderStored?.[r.key]?.value ?? null;
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
                        <Num v={view === "both" ? (stored?.[r.key]?.value ?? null) : value}
                             bold />
                      </td>
                      <td className="px-3 py-2.5 text-right text-[13px]">
                        <Variance plan={r.plan}
                          value={view === "both" ? (stored?.[r.key]?.value ?? null) : value} />
                      </td>
                      {view !== "both" && QUALITY.map(([key, label], i) => (
                        <td key={label}
                          className={`px-2 py-2.5 text-right text-[12px] ${
                            i === 0 ? "border-l border-border-light" : ""}`}>
                          {r.key === "despatch" ? (
                            <Assay mine={q?.[`mines_${key}`] ?? null}
                                   plant={q?.[`plant_${key}`] ?? null} />
                          ) : (
                            <span className="text-txt-light/30">·</span>
                          )}
                        </td>
                      ))}
                      {view === "both" && (
                        <>
                          <td className="px-3 py-2.5 text-right text-[13px]
                                         border-l border-border">
                            <Num v={oldEst} />
                          </td>
                          <td className="px-3 py-2.5 text-right text-[13px]"
                              title={oldEst != null && old?.actual != null
                                ? `Estimate was out by ${formatIndian(
                                    Math.abs(oldEst - old.actual))} ${r.unit}`
                                : undefined}>
                            <Num v={old?.actual ?? null} bold />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-border-light px-3 py-1 flex items-center justify-between flex-wrap gap-1">
          <span className="text-[10px] text-txt-light/60">
            Variance = {view === "both" ? "Est Actual" : valueLabel} − Plan · positive is ahead of plan
            {view === "both" && " · the right-hand pair is the estimate against what was posted"}
            {view === "est" && lastEntry && (
              <> · last entered by {lastEntry.entered_by}
                {lastEntry.entered_at
                  ? ` on ${new Date(lastEntry.entered_at).toLocaleString("en-IN")}`
                  : ""}
              </>
            )}
          </span>
          <span className="text-[9px] text-txt-light/50">
            {/* Where the assay comes from, because a figure whose source is
                not stated is a figure somebody will re-derive differently. */}
            {view !== "both" && (
              <>Assay is the mine's, weighted by quantity, of that day&apos;s
                despatch; a second line is the plant&apos;s where it differs · </>
            )}
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
