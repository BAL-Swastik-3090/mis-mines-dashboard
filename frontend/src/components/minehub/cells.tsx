"use client";
/**
 * How a cell behaves, decided once.
 *
 * Three things kept being got wrong a row at a time, so they live here and
 * every sheet draws from them:
 *
 *   NUMBERS   280 came back from the database as "280.000", because the column
 *             is numeric(10,3). The scale is right — a capacity can be 2.5 —
 *             and the display was wrong. Stripping the zeros at the edge of
 *             every input is the fix; storing fewer decimals is not.
 *
 *   DATES     a validity date is not just a date. It is expired, expiring, or
 *             fine, and which one is the only thing anybody reads the column
 *             for. Working that out per screen is how one screen says amber at
 *             thirty days and another at sixty.
 *
 *   HEADERS   a column called "Valid upto" with an empty cell under it does not
 *             say what it wants. The example does.
 */
import React from "react";
import DateField from "./DateField";

/** 280.000 -> "280", 2.500 -> "2.5". Leaves everything else exactly as it is.
 *
 *  Only the fractional part is touched, and only when there is one. An earlier
 *  version ran the value through Number(), which also ate leading zeros — so a
 *  SAP equipment number of 0700019 would have been shown as 700019, and an
 *  operator looking for it would not have found it. A display helper that
 *  quietly alters an identifier is worse than the trailing zeros it was
 *  written to remove.
 *
 *  Nothing without a decimal point is changed at all, which is what makes it
 *  safe to run over every field on a sheet rather than a chosen list.
 */
export function trimNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw.includes(".")) return raw;
  // A number, and nothing else — "12.5 (est)" is somebody's text and survives.
  if (!/^-?\d+\.\d+$/.test(raw)) return raw;
  return raw.replace(/\.?0+$/, "") || "0";
}

export type ExpiryState = "EXPIRED" | "DUE" | "SOON" | "VALID" | "NONE";

export interface Expiry {
  state: ExpiryState;
  days: number | null;      // negative once it has passed
  label: string;
  /** Tailwind classes for the cell itself, so the whole box carries the state
   *  rather than a dot somebody has to notice. */
  cell: string;
  dot: string;
}

// Thirty and sixty days. A fitness certificate takes about a fortnight to
// renew at the RTO and an insurance renewal takes a week, so thirty days is
// "start now" and sixty is "it is on the horizon". One definition, because two
// screens disagreeing about what amber means is worse than no colour.
const DUE_DAYS = 30;
const SOON_DAYS = 60;

export function expiryOf(date: string | null | undefined): Expiry {
  if (!date) {
    return { state: "NONE", days: null, label: "not recorded",
             cell: "", dot: "bg-slate-300" };
  }
  const on = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(on.getTime())) {
    return { state: "NONE", days: null, label: "not a date",
             cell: "", dot: "bg-slate-300" };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((on.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) {
    return {
      state: "EXPIRED", days,
      label: `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`,
      cell: "bg-rose-bg text-rose ring-1 ring-inset ring-rose/30",
      dot: "bg-rose",
    };
  }
  if (days === 0) {
    return { state: "DUE", days, label: "expires today",
             cell: "bg-rose-bg text-rose ring-1 ring-inset ring-rose/30",
             dot: "bg-rose" };
  }
  if (days <= DUE_DAYS) {
    return { state: "DUE", days, label: `${days} day${days === 1 ? "" : "s"} left`,
             cell: "bg-amber-bg text-amber ring-1 ring-inset ring-amber/30",
             dot: "bg-amber" };
  }
  if (days <= SOON_DAYS) {
    return { state: "SOON", days, label: `${days} days left`,
             cell: "bg-amber-bg/40 text-txt-primary", dot: "bg-amber" };
  }
  return { state: "VALID", days, label: `valid, ${days} days left`,
           cell: "bg-emerald/[0.07] text-txt-primary", dot: "bg-emerald" };
}

/** A date input that shows what its value means. */
export function ExpiryInput({ value, onChange, id, disabled }: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const state = expiryOf(value);
  return (
    <span className="block relative" title={state.label}>
      {/* The marker moved to the left edge when this stopped being a native
          input: the field now carries its own clear and calendar buttons on
          the right, and a status dot underneath them is a status dot nobody
          sees. */}
      {state.state !== "NONE" && (
        <span aria-hidden
              className={`absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5
                          rounded-full z-10 ${state.dot}`} />
      )}
      <DateField id={id} value={value} disabled={disabled} padded={false}
        onChange={(v) => onChange(v)}
        className={`w-full bg-transparent py-2 text-[13px] rounded-md
                    ${state.state !== "NONE" ? "pl-4" : "pl-3"}
                    transition-colors disabled:opacity-60 ${state.cell}`} />
    </span>
  );
}

/** A number input that never shows 280.000 for 280. */
export function NumberInput({ value, onChange, id, placeholder, disabled, step }: {
  value: unknown;
  onChange: (v: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  step?: string;
}) {
  return (
    <input id={id} type="number" step={step} disabled={disabled}
      value={trimNumber(value)} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent px-3 py-2 text-[13px] text-txt-primary
                 placeholder:text-txt-light tabular-nums
                 focus:outline-none focus:bg-gold/[0.05] focus:ring-1
                 focus:ring-inset focus:ring-gold/30 transition-colors
                 disabled:opacity-60" />
  );
}

/** A column heading that shows the shape of what goes under it. */
export function Th({ label, example, className = "" }: {
  label: string; example?: string; className?: string;
}) {
  return (
    <th className={`text-left text-[10.5px] font-bold uppercase tracking-[.1em]
                    text-txt-light px-3 py-2 border-b border-border-light
                    align-bottom ${className}`}>
      <span className="block">{label}</span>
      {example && (
        <span className="block font-normal normal-case tracking-normal
                         text-[10px] text-txt-light/70 mt-0.5">
          {example}
        </span>
      )}
    </th>
  );
}

/** The state as a word, for lists and summaries rather than inputs. */
export function ExpiryChip({ date }: { date: string | null | undefined }) {
  const state = expiryOf(date);
  if (state.state === "NONE") {
    return <span className="text-[11px] text-txt-light">not recorded</span>;
  }
  const tone = state.state === "EXPIRED" || state.state === "DUE"
    ? "text-rose bg-rose-bg"
    : state.state === "SOON" ? "text-amber bg-amber-bg"
    : "text-emerald bg-emerald/10";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5
                      text-[11px] font-semibold ${tone}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${state.dot}`} />
      {state.label}
    </span>
  );
}
