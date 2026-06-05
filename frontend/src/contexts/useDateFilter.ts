"use client";
import { create } from "zustand";
import { format, startOfMonth } from "date-fns";

// ── Helpers ────────────────────────────────────────────────────────

function toApi(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function rangeLabel(from: Date, to: Date): string {
  const f = format(from, "d MMM yyyy");
  const t = format(to,   "d MMM yyyy");
  return f === t ? f : `${f} – ${t}`;
}

// ── Store ──────────────────────────────────────────────────────────

export interface DateFilterStore {
  from:        Date;
  to:          Date;
  label:       string;   // Human-readable display, e.g. "1 May 2026 – 29 May 2026"
  periodLabel: string;   // Short tag: "MTD" | "YTD" | "QTD" | "FY" | "PERIOD" | "TODAY"
  apiFrom:     string;   // "yyyy-MM-dd" for query params
  apiTo:       string;
  setRange: (
    from:        Date,
    to:          Date,
    label?:      string,
    periodLabel?: string
  ) => void;
}

// Default: current month-to-date (MTD)
const _today = new Date();
const _from  = startOfMonth(_today);
const _to    = _today;

export const useDateFilter = create<DateFilterStore>((set) => ({
  from:        _from,
  to:          _to,
  label:       rangeLabel(_from, _to),
  periodLabel: "MTD",
  apiFrom:     toApi(_from),
  apiTo:       toApi(_to),

  setRange: (from, to, label, periodLabel = "PERIOD") => {
    set({
      from,
      to,
      label:       label ?? rangeLabel(from, to),
      periodLabel,
      apiFrom:     toApi(from),
      apiTo:       toApi(to),
    });
  },
}));
