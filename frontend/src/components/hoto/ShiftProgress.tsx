"use client";

/**
 * How far through the shift, and how this shift compares with the last week.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * The board could say "61 machines, nobody filled it in" and give the reader
 * no way to act on it or judge it. Two things were missing, and they are
 * different questions:
 *
 *   HOW URGENT — a handover missing ten minutes into the shift is normal; the
 *   same one missing with forty minutes left is a shift that will end unsigned.
 *   The board read identically at both.
 *
 *   HOW UNUSUAL — 61 is a disaster if yesterday was 3 and a rollout that never
 *   happened if yesterday was also 61. Those call for opposite actions, and the
 *   first instinct on meeting an unjudgeable number is to disbelieve the screen.
 *
 * The bars are drawn to one scale with the tallest day as the top, and every
 * day in the window appears even when it is zero: dropping empty days would
 * draw a flat line straight through the days most worth noticing.
 */

import { Clock } from "lucide-react";

export interface TrendDay {
  day: string;
  filed: number;
  machines: number;
}

export default function ShiftProgress({
  clock, trend, startsAt, endsAt,
}: {
  clock: { through: number; elapsed: number; leftMs: number; over: boolean } | null;
  trend: TrendDay[];
  startsAt?: string;
  endsAt?: string;
}) {
  if (!clock && trend.length === 0) return null;

  const hhmm = (ms: number) => {
    const mins = Math.round(Math.abs(ms) / 60_000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  };
  const time = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString("en-IN",
      { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

  // One scale for every bar. A floor of 1 keeps an all-zero week from
  // dividing by nothing.
  const peak = Math.max(1, ...trend.map((d) => d.filed));
  const today = trend[trend.length - 1];
  const before = trend.slice(0, -1);
  const typical = before.length
    ? Math.round(before.reduce((a, d) => a + d.filed, 0) / before.length)
    : null;

  return (
    <div className="grid gap-2 md:grid-cols-[1fr_auto] items-stretch">
      {/* ── where we are in the shift ── */}
      {clock && (
        <div className="rounded border border-border px-3 py-2">
          <div className="flex items-center gap-2 text-[11px]">
            <Clock size={12} className="text-muted-foreground shrink-0" />
            <span className="font-medium">
              {clock.over
                ? `Shift ended ${hhmm(clock.leftMs)} ago`
                : `${hhmm(clock.leftMs)} left in the shift`}
            </span>
            <span className="text-muted-foreground">
              {time(startsAt)}–{time(endsAt)}
            </span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {Math.round(clock.through * 100)}% through
            </span>
          </div>

          <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              /* Amber past halfway, red in the last fifth: a handover not
                 filed in by then will not be filed in at all without
                 somebody being asked. */
              className={`h-full rounded-full transition-[width] duration-700 ${
                clock.through >= 0.8 ? "bg-red-500"
                  : clock.through >= 0.5 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.max(2, clock.through * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── the last week, so today can be judged ── */}
      {trend.length > 1 && (
        <div className="rounded border border-border px-3 py-2">
          <div className="flex items-end gap-[3px] h-[26px]">
            {trend.map((d) => {
              const isToday = d === today;
              return (
                <div
                  key={d.day}
                  title={`${new Date(d.day).toLocaleDateString("en-IN",
                    { day: "2-digit", month: "short" })} — ${d.filed} handover${
                    d.filed === 1 ? "" : "s"} on ${d.machines} machine${
                    d.machines === 1 ? "" : "s"}`}
                  className={`w-3 rounded-sm ${isToday
                    ? "bg-sky-500"
                    : "bg-muted-foreground/30"}`}
                  /* A zero day still draws a sliver, so the gap is visibly a
                     zero rather than a missing bar. */
                  style={{ height: `${Math.max(2, (d.filed / peak) * 26)}px` }}
                />
              );
            })}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground whitespace-nowrap">
            {today?.filed ?? 0} filed today
            {typical != null && <> · {typical}/day over the last week</>}
          </div>
        </div>
      )}
    </div>
  );
}
