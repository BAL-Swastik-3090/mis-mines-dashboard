"use client";
import { useState } from "react";
import {
  format, subDays, startOfMonth, endOfMonth, addMonths, subMonths,
  isSameDay, isAfter, isBefore, getDay, getDaysInMonth,
} from "date-fns";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDateFilter } from "@/contexts/useDateFilter";

// ── Date helpers ───────────────────────────────────────────────────

function tod(): Date { return new Date(); }

function thisFYStart(): Date {
  const t  = tod();
  const y  = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
  return new Date(y, 3, 1);   // April 1
}
function lastFYStart(): Date { return new Date(thisFYStart().getFullYear() - 1, 3, 1); }
function lastFYEnd():   Date { return new Date(thisFYStart().getFullYear(), 2, 31); }

function thisQStart(): Date {
  const t = tod();
  const m = t.getMonth(); // 0-indexed
  const qs = m >= 9 ? 9 : m >= 6 ? 6 : m >= 3 ? 3 : 0;
  return new Date(t.getFullYear(), qs, 1);
}
function thisQEnd(): Date {
  const s = thisQStart();
  return endOfMonth(new Date(s.getFullYear(), s.getMonth() + 2, 1));
}
function lastQStart(): Date { return subMonths(thisQStart(), 3); }
function lastQEnd():   Date {
  const s = thisQStart();
  return new Date(s.getFullYear(), s.getMonth(), 0); // day 0 = last of prev month
}

// ── Calendar grid builder ──────────────────────────────────────────

type CalCell = { date: Date; otherMonth: boolean };

function buildGrid(year: number, month: number): CalCell[] {
  const first      = new Date(year, month, 1);
  const offset     = getDay(first);
  const daysInCurr = getDaysInMonth(first);
  const daysInPrev = getDaysInMonth(new Date(year, month - 1, 1));
  const cells: CalCell[] = [];

  // Previous-month padding
  for (let i = offset - 1; i >= 0; i--)
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), otherMonth: true });

  // Current month
  for (let d = 1; d <= daysInCurr; d++)
    cells.push({ date: new Date(year, month, d), otherMonth: false });

  // Next-month padding to complete 5 or 6 rows
  const total = cells.length <= 35 ? 35 : 42;
  for (let d = 1; cells.length < total; d++)
    cells.push({ date: new Date(year, month + 1, d), otherMonth: true });

  return cells;
}

// ── Quick-select groups ────────────────────────────────────────────

type QuickItem  = { label: string; pl: string; get: () => [Date, Date] };
type QuickGroup = { heading: string; items: QuickItem[] };

const GROUPS: QuickGroup[] = [
  {
    heading: "QUICK SELECT",
    items: [
      { label: "Today",         pl: "TODAY",  get: () => [tod(),              tod()] },
      { label: "Yesterday",     pl: "PERIOD", get: () => [subDays(tod(), 1),  subDays(tod(), 1)] },
      { label: "Last 7 Days",   pl: "PERIOD", get: () => [subDays(tod(), 6),  tod()] },
      { label: "Last 15 Days",  pl: "PERIOD", get: () => [subDays(tod(), 14), tod()] },
      { label: "Last 30 Days",  pl: "PERIOD", get: () => [subDays(tod(), 29), tod()] },
      { label: "Last 90 Days",  pl: "PERIOD", get: () => [subDays(tod(), 89), tod()] },
    ],
  },
  {
    heading: "MONTHLY",
    items: [
      { label: "This Month", pl: "MTD", get: () => [startOfMonth(tod()), tod()] },
      { label: "Last Month", pl: "MTD", get: () => {
        const lm = subMonths(tod(), 1);
        return [startOfMonth(lm), endOfMonth(lm)];
      }},
    ],
  },
  {
    heading: "QUARTERLY",
    items: [
      { label: "This Quarter", pl: "QTD", get: () => [thisQStart(), tod()] },
      { label: "Last Quarter", pl: "QTD", get: () => [lastQStart(), lastQEnd()] },
    ],
  },
  {
    heading: "FINANCIAL YEAR",
    items: [
      { label: "This FY", pl: "YTD", get: () => [thisFYStart(), tod()] },
      { label: "Last FY", pl: "FY",  get: () => [lastFYStart(), lastFYEnd()] },
    ],
  },
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// ── Component ──────────────────────────────────────────────────────

export default function DateFilter() {
  const { from, to, label, setRange } = useDateFilter();

  const [open, setOpen]               = useState(false);
  const [viewYear, setViewYear]       = useState(from.getFullYear());
  const [viewMonth, setViewMonth]     = useState(from.getMonth());
  const [pendingStart, setPending]    = useState<Date | null>(null);
  const [hoverDate, setHover]         = useState<Date | null>(null);

  const cells = buildGrid(viewYear, viewMonth);

  // ── Navigation ──────────────────────────────────────────────────
  const gotoPrev = () => {
    const d = subMonths(new Date(viewYear, viewMonth, 1), 1);
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
  };
  const gotoNext = () => {
    const d = addMonths(new Date(viewYear, viewMonth, 1), 1);
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
  };

  // ── Interaction ─────────────────────────────────────────────────
  const handleDayClick = (date: Date, otherMonth: boolean) => {
    if (otherMonth) return;
    if (!pendingStart) {
      // First click — start of range
      setPending(date);
      setHover(date);
    } else {
      // Second click — end of range; always make start ≤ end
      const fwd = isAfter(date, pendingStart) || isSameDay(date, pendingStart);
      const [s, e] = fwd ? [pendingStart, date] : [date, pendingStart];
      setRange(s, e, undefined, "PERIOD");
      setPending(null); setHover(null); setOpen(false);
    }
  };

  const handleQuick = (item: QuickItem) => {
    const [s, e] = item.get();
    setRange(s, e, undefined, item.pl);
    setPending(null); setHover(null); setOpen(false);
  };

  const handleOpen = () => {
    if (!open) {
      // Reset calendar view to current selection month when opening
      setPending(null); setHover(null);
      setViewYear(from.getFullYear()); setViewMonth(from.getMonth());
    }
    setOpen((o) => !o);
  };

  const handleClose = () => {
    setOpen(false); setPending(null); setHover(null);
  };

  // ── Display range (preview while hovering, else confirmed) ──────
  const dFrom = (pendingStart && hoverDate)
    ? (isAfter(hoverDate, pendingStart) ? pendingStart : hoverDate)
    : from;
  const dTo = (pendingStart && hoverDate)
    ? (isAfter(hoverDate, pendingStart) ? hoverDate   : pendingStart)
    : to;
  const single = isSameDay(dFrom, dTo);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="relative">

      {/* ── Trigger ─────────────────────────────────────────────── */}
      <button
        onClick={handleOpen}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded border font-medium transition-all",
          "bg-white border-border text-txt-primary hover:border-accent hover:text-accent",
          open && "border-accent text-accent ring-1 ring-accent/20"
        )}
      >
        <CalendarDays size={14} className="text-accent shrink-0" />
        <span className="font-condensed font-bold text-[15px] leading-none whitespace-nowrap">
          {label}
        </span>
        <ChevronDown size={13} className={cn("transition-transform shrink-0", open && "rotate-180")} />
      </button>

      {/* ── Click-away overlay ──────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={handleClose} />
      )}

      {/* ── Dropdown ────────────────────────────────────────────── */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-border rounded-xl shadow-xl
                        flex flex-col sm:flex-row overflow-hidden
                        w-[calc(100vw-1.5rem)] sm:w-auto sm:min-w-[500px] max-w-[calc(100vw-1.5rem)]
                        max-h-[calc(100vh-6rem)] overflow-y-auto">

          {/* ── Left sidebar: Quick selects ──────────────────────── */}
          <div className="w-full sm:w-44 shrink-0 bg-bg-soft border-b sm:border-b-0 sm:border-r border-border-light py-2 overflow-y-auto max-h-[180px] sm:max-h-[420px]">
            {GROUPS.map((group) => (
              <div key={group.heading}>
                <div className="px-3 pt-3 pb-1 text-[9px] font-extrabold tracking-[.16em] text-txt-light uppercase">
                  {group.heading}
                </div>
                {group.items.map((item) => {
                  const [s, e] = item.get();
                  const active = isSameDay(from, s) && isSameDay(to, e);
                  return (
                    <button
                      key={item.label}
                      onClick={() => handleQuick(item)}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-[12px] font-medium transition-colors",
                        active
                          ? "bg-accent text-white font-semibold"
                          : "text-txt-secondary hover:bg-bg-section hover:text-txt-primary"
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* ── Right panel: Calendar ────────────────────────────── */}
          <div className="flex-1 p-4 min-w-0 flex flex-col">

            {/* Month navigator */}
            <div className="flex items-center justify-between mb-3 shrink-0">
              <button
                onClick={gotoPrev}
                className="p-1.5 rounded hover:bg-bg-section text-txt-muted hover:text-txt-primary transition-colors"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="font-condensed font-bold text-[15px] text-txt-primary tracking-wide">
                {format(new Date(viewYear, viewMonth, 1), "MMMM yyyy")}
              </span>
              <button
                onClick={gotoNext}
                className="p-1.5 rounded hover:bg-bg-section text-txt-muted hover:text-txt-primary transition-colors"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-0.5 shrink-0">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center text-[11px] font-bold text-txt-light/70 py-1">
                  {w}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div
              className="grid grid-cols-7"
              onMouseLeave={() => pendingStart && setHover(pendingStart)}
            >
              {cells.map((cell, idx) => {
                const { date, otherMonth } = cell;

                const isStart   = isSameDay(date, dFrom);
                const isEnd     = isSameDay(date, dTo);
                const isMiddle  = !single && !isStart && !isEnd
                                  && isAfter(date, dFrom) && isBefore(date, dTo);
                const isToday   = isSameDay(date, tod());
                const endpoint  = (isStart || isEnd) && !otherMonth;

                // Band: half for endpoints, full for middle days
                let bandL = "", bandR = "";
                if (!single && !otherMonth) {
                  if (isStart)  { bandL = "50%"; bandR = "0"; }
                  if (isEnd)    { bandL = "0";   bandR = "50%"; }
                  if (isMiddle) { bandL = "0";   bandR = "0"; }
                }
                const hasBand = bandL !== "" || isMiddle;

                return (
                  <div
                    key={idx}
                    onClick={() => handleDayClick(date, otherMonth)}
                    onMouseEnter={() => {
                      if (pendingStart && !otherMonth) setHover(date);
                    }}
                    className={cn(
                      "relative h-9 flex items-center justify-center select-none",
                      otherMonth ? "cursor-default" : "cursor-pointer group"
                    )}
                  >
                    {/* ── Band layer ─────────────────────────────── */}
                    {hasBand && (
                      <div
                        className="absolute top-1 bottom-1 bg-accent/[0.12] pointer-events-none"
                        style={{ left: bandL, right: bandR }}
                      />
                    )}

                    {/* ── Circle layer (endpoints) ──────────────── */}
                    {endpoint && (
                      <div className="absolute inset-0 m-auto w-7 h-7 rounded-full bg-[#1a2744] pointer-events-none" />
                    )}

                    {/* ── Hover ghost (non-selected, non-other) ──── */}
                    {!endpoint && !isMiddle && !otherMonth && (
                      <div className="absolute inset-0 m-auto w-7 h-7 rounded-full bg-bg-section opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    )}

                    {/* ── Day number ─────────────────────────────── */}
                    <span className={cn(
                      "relative z-10 text-[12.5px] leading-none font-medium",
                      otherMonth  ? "text-txt-light/40"
                      : endpoint  ? "text-white font-bold"
                      : isMiddle  ? "text-accent font-semibold"
                      : isToday   ? "text-accent font-bold"
                      :             "text-txt-primary"
                    )}>
                      {date.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* ── Footer ───────────────────────────────────────── */}
            <div className="mt-3 pt-3 border-t border-border-light shrink-0 min-h-[28px] flex items-center justify-center">
              {pendingStart ? (
                <p className="text-[11px] text-center">
                  <span className="text-accent font-semibold">
                    {format(pendingStart, "d MMM yyyy")}
                  </span>
                  <span className="text-txt-muted ml-1">— click end date to complete</span>
                </p>
              ) : (
                <p className="font-mono text-[11px] text-txt-muted text-center">
                  {format(from, "d MMM yyyy")}
                  {!isSameDay(from, to) && (
                    <> &mdash; {format(to, "d MMM yyyy")}</>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
