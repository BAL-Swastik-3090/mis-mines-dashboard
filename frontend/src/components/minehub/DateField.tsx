"use client";
/**
 * A date, written and picked the way the mine writes and picks dates.
 *
 * The browser's own `<input type="date">` was doing this job, and it looks
 * like what it is: Chrome's calendar in Chrome's typeface, with its own
 * behaviour, its own language, and a format that follows the machine's locale
 * rather than the mine's. It also decides on its own what a year selector
 * looks like — the screenshot that prompted this shows a grid where clicking
 * the year does nothing useful and getting to 2019 is thirty clicks of an
 * arrow.
 *
 * ONE FORMAT, EVERYWHERE: dd-mm-yyyy. That is how the mine writes a date on
 * paper, on a gate pass and in every spreadsheet it already keeps. ISO stays
 * on the wire, because that is what the database and every API take, and the
 * conversion happens here rather than in fifteen callers.
 *
 * WHAT IT DOES THAT THE NATIVE ONE DOES NOT
 *
 *   Typing works and is forgiving. 5/3/26, 05-03-2026 and 05032026 are the
 *   same date. A two-digit year is read against a sixty-year window, so an
 *   expiry in 26 is 2026 and a date of birth in 75 is 1975 — the guess people
 *   actually mean.
 *
 *   The header is the navigation. Clicking the month opens twelve months;
 *   clicking the year opens twelve years, and again for a decade. Getting to
 *   a licence issued in 1998 is three clicks rather than three hundred.
 *
 *   Out-of-range days are shown and refused rather than hidden, so a date you
 *   cannot pick still tells you the calendar is on the right month.
 *
 * Rendered in a portal for the same reason the column filters are: these sit
 * inside tables that scroll, and anything inside a scrolling ancestor gets
 * clipped by it.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** ISO (yyyy-mm-dd, what the wire uses) to dd-mm-yyyy (what people read). */
export function toDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * What somebody typed, to ISO, or "" when it is not a date yet.
 *
 * Deliberately generous about separators and about the year, because a person
 * filling in eighty machines types 5/3/26 and is not wrong.
 */
export function parseTyped(text: string): string {
  const t = (text || "").trim();
  if (!t) return "";

  // Already ISO — pasted from a spreadsheet or an export.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return check(+iso[1], +iso[2], +iso[3]);

  const parts = t.split(/[^\d]+/).filter(Boolean);
  if (parts.length === 3) {
    return check(year(parts[2]), +parts[1], +parts[0]);
  }
  // 05032026 or 050326, typed without separators.
  if (parts.length === 1 && (parts[0].length === 8 || parts[0].length === 6)) {
    const d = parts[0];
    const y = d.length === 8 ? d.slice(4) : d.slice(4, 6);
    return check(year(y), +d.slice(2, 4), +d.slice(0, 2));
  }
  return "";
}

/** A two-digit year against a sixty-year window: 26 is 2026, 75 is 1975. The
 *  alternative is asking somebody to type the century on a licence renewal. */
function year(raw: string): number {
  const n = Number(raw);
  if (raw.length > 2) return n;
  const nowShort = new Date().getFullYear() % 100;
  return n <= nowShort + 40 ? 2000 + n : 1900 + n;
}

/** Real dates only. 31-02 is not a date, and a calendar that silently rolls it
 *  to 3 March is a calendar that records the wrong day. */
function check(y: number, m: number, d: number): string {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return "";
  if (y < 1900 || y > 2200) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function DateField({
  value, onChange, id, disabled, min, max, placeholder = "dd-mm-yyyy",
  className = "", invalid, align = "left", title, padded = true,
}: {
  /** ISO, yyyy-mm-dd. "" for empty. */
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  disabled?: boolean;
  /** ISO bounds. A day outside them is shown and refused. */
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  align?: "left" | "right";
  title?: string;
  /** False when the caller has put its own padding on the wrapper. Explicit
   *  rather than sniffed out of the class string: the first version guessed by
   *  looking for "px-" and quietly double-padded a caller that used pl- and
   *  py- instead. */
  padded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(() => toDisplay(value));
  const [zoom, setZoom] = useState<"day" | "month" | "year">("day");
  const [cursor, setCursor] = useState(() => {
    const d = value ? new Date(value) : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  });
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // The field follows the value when it changes underneath — a form loading a
  // record, or a revision being reverted.
  useEffect(() => { setTyped(toDisplay(value)); }, [value]);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 268;
    const below = window.innerHeight - r.bottom;
    // Above when there is no room below, so the calendar is never half off the
    // bottom of a long form.
    const top = below < 330 && r.top > 330 ? r.top - 326 : r.bottom + 4;
    const left = align === "right" ? r.right - width : r.left;
    setRect({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  }, [align]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const move = () => place();
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor.current?.contains(t) || menu.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open, place]);

  const commit = (text: string) => {
    const iso = parseTyped(text);
    if (iso) {
      onChange(iso);
      setTyped(toDisplay(iso));
      setCursor(new Date(iso));
    } else if (!text.trim()) {
      onChange("");
      setTyped("");
    } else {
      // Not a date: put back what was there rather than leaving a half-typed
      // string that looks saved and is not.
      setTyped(toDisplay(value));
    }
  };

  const blocked = (iso: string) =>
    (min ? iso < min : false) || (max ? iso > max : false);

  const choose = (iso: string) => {
    if (blocked(iso)) return;
    onChange(iso);
    setTyped(toDisplay(iso));
    setOpen(false);
  };

  const step = (by: number) => {
    const d = new Date(cursor);
    if (zoom === "day") d.setMonth(d.getMonth() + by);
    else if (zoom === "month") d.setFullYear(d.getFullYear() + by);
    else d.setFullYear(d.getFullYear() + by * 12);
    setCursor(d);
  };

  // Monday first, which is how a shift roster reads.
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - lead);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const todayIso = isoOf(new Date());
  const decade = Math.floor(cursor.getFullYear() / 12) * 12;

  const cell = "h-8 rounded-md text-[12.5px] font-semibold transition-colors "
    + "disabled:cursor-not-allowed";

  return (
    <>
      <div ref={anchor} title={title}
        className={`relative flex items-center ${className || ""}`}>
        <input id={id} value={typed} disabled={disabled} inputMode="numeric"
          placeholder={placeholder}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(typed); setOpen(false); }
            if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); }
          }}
          aria-invalid={invalid || undefined}
          className={`w-full bg-transparent pr-7 text-[13px] focus:outline-none
                      disabled:opacity-60 ${padded ? "px-3 py-2" : ""}`} />
        <span className="absolute right-1 flex items-center">
          {typed && !disabled && (
            <button type="button" tabIndex={-1} aria-label="Clear the date"
              onClick={() => { onChange(""); setTyped(""); }}
              className="p-0.5 text-txt-light hover:text-rose">
              <X className="w-3 h-3" />
            </button>
          )}
          <button type="button" tabIndex={-1} disabled={disabled}
            aria-label="Open the calendar" aria-expanded={open}
            onClick={() => { if (!disabled) { setZoom("day"); setOpen((v) => !v); } }}
            className="p-0.5 text-txt-light hover:text-gold-dark disabled:opacity-40">
            <CalendarDays className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>

      {open && rect && typeof document !== "undefined" && createPortal(
        <div ref={menu} style={{ top: rect.top, left: rect.left, width: 268 }}
          className="fixed z-[70] rounded-xl border border-slate-200 bg-white shadow-xl p-2.5">

          {/* The header IS the navigation: the month and the year are buttons,
              because the thing people want when a date is years away is to
              jump, not to press an arrow four hundred times. */}
          <div className="flex items-center gap-1 mb-2">
            <button type="button" onClick={() => step(-1)} aria-label="Back"
              className="p-1.5 rounded-md text-txt-muted hover:bg-bg-light hover:text-navy">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="flex-1 flex items-center justify-center gap-1">
              {zoom === "day" && (
                <button type="button" onClick={() => setZoom("month")}
                  className="px-2 py-1 rounded-md text-[13px] font-bold text-navy
                             hover:bg-gold/10">
                  {MONTHS[cursor.getMonth()]}
                </button>
              )}
              <button type="button"
                onClick={() => setZoom(zoom === "year" ? "day" : "year")}
                className="px-2 py-1 rounded-md text-[13px] font-bold text-navy
                           hover:bg-gold/10 tabular-nums">
                {zoom === "year" ? `${decade}–${decade + 11}` : cursor.getFullYear()}
              </button>
            </span>
            <button type="button" onClick={() => step(1)} aria-label="Forward"
              className="p-1.5 rounded-md text-txt-muted hover:bg-bg-light hover:text-navy">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {zoom === "day" && (
            <>
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map((d) => (
                  <span key={d} className="h-6 flex items-center justify-center text-[10.5px]
                                           font-bold text-txt-light">{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {days.map((d) => {
                  const iso = isoOf(d);
                  const outside = d.getMonth() !== cursor.getMonth();
                  const off = blocked(iso);
                  const chosen = iso === value;
                  return (
                    <button key={iso} type="button" disabled={off}
                      onClick={() => choose(iso)}
                      title={off ? "Outside the range this field allows" : undefined}
                      className={`${cell} tabular-nums
                        ${chosen ? "bg-navy text-white ring-2 ring-gold/40"
                          : off ? "text-txt-light/30"
                          : outside ? "text-txt-light hover:bg-bg-light"
                          : "text-txt-primary hover:bg-gold/15"}
                        ${!chosen && iso === todayIso ? "ring-1 ring-gold" : ""}`}>
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {zoom === "month" && (
            <div className="grid grid-cols-3 gap-1">
              {SHORT.map((m, i) => (
                <button key={m} type="button"
                  onClick={() => {
                    const d = new Date(cursor); d.setMonth(i); setCursor(d); setZoom("day");
                  }}
                  className={`${cell} ${i === cursor.getMonth()
                    ? "bg-navy text-white" : "text-txt-primary hover:bg-gold/15"}`}>
                  {m}
                </button>
              ))}
            </div>
          )}

          {zoom === "year" && (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, i) => decade + i).map((y) => (
                <button key={y} type="button"
                  onClick={() => {
                    const d = new Date(cursor); d.setFullYear(y); setCursor(d); setZoom("month");
                  }}
                  className={`${cell} tabular-nums ${y === cursor.getFullYear()
                    ? "bg-navy text-white" : "text-txt-primary hover:bg-gold/15"}`}>
                  {y}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <button type="button"
              onClick={() => { onChange(""); setTyped(""); setOpen(false); }}
              className="text-[12px] font-semibold text-txt-muted hover:text-rose">
              Clear
            </button>
            <button type="button" disabled={blocked(todayIso)}
              onClick={() => choose(todayIso)}
              className="text-[12px] font-semibold text-gold-dark hover:underline
                         disabled:opacity-40 disabled:no-underline">
              Today
            </button>
          </div>
        </div>, document.body)}
    </>
  );
}
