"use client";
import { useMemo } from "react";
import { Chip } from "@/components/minehub/ui";

/**
 * Every day as a square, coloured by how long the fuel would have lasted.
 *
 * ── WHAT A SQUARE CAN HONESTLY SAY ──────────────────────────────────────
 * Closing stock is stated every day, including days nothing moved, so the
 * colour is a real figure for that date.
 *
 * Consumption is not. SAP posts issues in batches — 10,409 litres on the 5th
 * covering days the mine was certainly working — so a zero on the 3rd means
 * "nothing was posted", not "nothing was burned". The word used throughout is
 * POSTED, because a calendar implying the mine stood still for two days would
 * be read as a fact about the mine rather than about the posting run.
 *
 * ── AND THE FUTURE CARRIES NO CONSUMPTION ───────────────────────────────
 * There is none to carry. A forward square shows only the projected level —
 * the past burn rate carried on — hatched so it cannot be mistaken for a
 * measurement. "What was consumed on the 8th" has no answer on the 6th, and
 * inventing one is how a dashboard starts lying quietly.
 */
interface Day {
  day: string; actual: boolean;
  closing_l: number; issued_l: number | null; received_l: number;
  days_cover: number | null; dry?: boolean;
}

const L = (n: number) => Math.round(n).toLocaleString("en-IN");

/** The colour of a day is how long it would have lasted, not how full it was:
 *  8,000 litres is comfortable at one plant and a day and a half at another. */
function tone(cover: number | null, actual: boolean): string {
  if (cover === null) return "bg-bg-soft";
  const base = cover < 2 ? "bg-rose" : cover < 4 ? "bg-amber"
             : cover < 8 ? "bg-gold" : "bg-emerald";
  const shade = cover < 2 ? "" : cover < 4 ? "/70" : cover < 8 ? "/50" : "/60";
  return `${base}${shade}${actual ? "" : " opacity-50"}`;
}

export default function FuelCalendar({ days, today, burnPerDay }: {
  days: Day[]; today: string; burnPerDay: number;
}) {
  /* Laid out in weeks so the eye can compare one Monday with the next —
   * fuel at a mine runs on a weekly rhythm of deliveries and shifts. */
  const weeks = useMemo(() => {
    if (!days.length) return [];
    const out: (Day | null)[][] = [];
    let week: (Day | null)[] = [];
    const first = new Date(days[0].day + "T00:00:00").getDay();   // 0 = Sunday
    const lead = (first + 6) % 7;                                  // Monday first
    for (let i = 0; i < lead; i++) week.push(null);
    for (const d of days) {
      week.push(d);
      if (week.length === 7) { out.push(week); week = []; }
    }
    if (week.length) {
      while (week.length < 7) week.push(null);
      out.push(week);
    }
    return out;
  }, [days]);

  const short = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
      { day: "2-digit", month: "short" });

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[620px]">
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="text-[10px] font-semibold text-txt-light text-center">
                {d}
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1.5">
                {week.map((d, di) => {
                  if (!d) return <div key={di} />;
                  const isToday = d.day === today;
                  return (
                    <div key={d.day}
                      title={d.actual
                        ? `${short(d.day)} — ${L(d.closing_l)} L in tank`
                          + `, ${L(d.issued_l ?? 0)} L posted out`
                          + `, ${L(d.received_l)} L arrived`
                          + (d.days_cover !== null ? ` · ${d.days_cover} days of cover` : "")
                        : `${short(d.day)} — projected ${L(d.closing_l)} L. `
                          + `This day has not happened, so there is no consumption figure for it.`}
                      className={`relative rounded-lg px-2 py-2 min-h-[64px] text-white
                                  ${tone(d.days_cover, d.actual)}
                                  ${isToday ? "ring-2 ring-navy ring-offset-1" : ""}`}>
                      {/* A projected square is hatched, so it never reads as
                          something that was measured. */}
                      {!d.actual && (
                        <span className="absolute inset-0 rounded-lg pointer-events-none"
                              style={{ backgroundImage:
                                "repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 3px, transparent 3px 7px)" }} />
                      )}
                      <span className="relative block text-[9.5px] opacity-90">
                        {short(d.day)}
                      </span>
                      <span className="relative block text-[12.5px] font-bold tabular-nums leading-tight">
                        {L(d.closing_l)}
                      </span>
                      <span className="relative block text-[9px] leading-tight">
                        {d.actual
                          ? <>
                              {d.received_l > 0 && <span className="font-semibold">+{L(d.received_l)} </span>}
                              {(d.issued_l ?? 0) > 0 ? `−${L(d.issued_l ?? 0)}` : null}
                              {(d.issued_l ?? 0) === 0 && d.received_l === 0 ? "nothing posted" : null}
                            </>
                          : d.dry ? "dry" : "projected"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-[10.5px] text-txt-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-rose inline-block" /> under 2 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-amber/70 inline-block" /> 2–4 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-gold/50 inline-block" /> 4–8 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald/60 inline-block" /> over 8 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald/60 opacity-50 inline-block"
                style={{ backgroundImage:
                  "repeating-linear-gradient(45deg, rgba(255,255,255,.5) 0 2px, transparent 2px 5px)" }} />
          projected
        </span>
        <Chip tone="slate" dot={false}>at {L(burnPerDay)} L a day</Chip>
      </div>

      <p className="mt-2 text-[11px] text-txt-muted leading-relaxed">
        The colour is how many days the fuel would have lasted at the current
        rate, not how full the tank was. <strong>&ldquo;Posted&rdquo; is not
        &ldquo;burned&rdquo;</strong> — SAP books issues in batches, so a day
        showing nothing usually means the paperwork landed on another day, not
        that the mine stood still. Hatched squares are projections: those days
        have not happened, so there is no consumption figure for them and none
        is shown.
      </p>
    </div>
  );
}
