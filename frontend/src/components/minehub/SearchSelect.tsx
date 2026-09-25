"use client";
/**
 * A dropdown you can type into.
 *
 * A native <select> is fine for three options and wrong for forty. Picking a
 * trade meant scrolling an operating-system list past "Grader Operator",
 * "Housekeeping", "Hydra Operator" to reach "Time Keeper", with no way to type
 * what you already know the name of. Contractors, departments, machines and
 * people are all lists of that length in this application.
 *
 * So: the closed control still looks like every other filter on the screen —
 * this replaces a select, it does not introduce a new kind of thing — and
 * opening it gives you a search box over the same options.
 *
 * TWO THINGS IT DOES DELIBERATELY
 *
 * The list is rendered in a portal, positioned in viewport coordinates. Nearly
 * every one of these sits inside a table that scrolls sideways, and an overflow
 * container crops anything positioned inside it: a panel rendered in place gets
 * its search box and its footer cut away. A portal is outside every such
 * container, so the same control works in a card, in a dialog and in a
 * scrolling table without knowing which it is in.
 *
 * And it matches the way the rest of the application searches: `matchesSearch`
 * ignores case, spaces and punctuation, so "timekeeper", "time keeper" and
 * "TIME-KEEPER" all find the same man, and "man19" finds MAN-19.
 *
 * NOT `Combobox`, which sits next to it in this folder
 *
 * Combobox is a text field that standardises itself: you type freely, and what
 * is not on the list can be added without leaving the form. It is for values
 * that grow — a make, a model, a department nobody has entered yet.
 *
 * This one is a select. The list is closed, and choosing something that is not
 * on it is not a thing you can do, because the list is rows of a table: an
 * operator, a machine, a bridge, a plant.
 */
import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { matchesSearch } from "@/lib/search";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** A second line — a trade under a name, a code under a machine. */
  hint?: string;
  /** Right-aligned, for a rating or a count. */
  meta?: React.ReactNode;
  disabled?: boolean;
}

/** Strings are the common case, so they are accepted as they are. */
function normalise(options: (string | SearchSelectOption)[]): SearchSelectOption[] {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

const PANEL_MAX_H = 288;   // 18rem of list, plus the search box above it
const PANEL_MIN_W = 220;

export default function SearchSelect({
  value, onChange, options, allLabel, allValue = "", placeholder = "Choose…",
  narrow = false, field = false, disabled = false, className = "", searchPlaceholder,
  emptyLabel = "Nothing matches.", width,
}: {
  value: string;
  onChange: (value: string) => void;
  options: (string | SearchSelectOption)[];
  /** The "no choice" row, e.g. "Any trade". Omit to make a choice required. */
  allLabel?: string;
  /** What "no choice" is worth. Empty everywhere but the few filters that
   *  spell it "all", which is theirs to keep — a control should not quietly
   *  change the value a screen has always sent. */
  allValue?: string;
  placeholder?: string;
  /** Tighter, for a row of filters above a table. */
  narrow?: boolean;
  /** Sized like a form input rather than a filter: full width, roomier, and
   *  bordered whether or not something is chosen — a field in a form reads as
   *  empty-and-waiting, not as an inactive filter. */
  field?: boolean;
  disabled?: boolean;
  className?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Fixed panel width. By default it matches the control, floored at 220px. */
  width?: number;
}) {
  const all = useMemo(() => normalise(options), [options]);
  const chosen = all.find((o) => o.value === value) ?? null;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; w: number; up: boolean } | null>(null);

  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const shown = useMemo(
    () => all.filter((o) => matchesSearch(q, [o.label, o.hint, o.value])),
    [all, q]);

  /** Where the panel goes, in viewport coordinates. It opens downwards unless
   *  the control is low enough on the screen that the list would run off it. */
  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    if (!a) return;
    const w = Math.max(width ?? a.width, PANEL_MIN_W);
    const room = window.innerHeight - a.bottom;
    const up = room < PANEL_MAX_H + 24 && a.top > room;
    setBox({
      top: up ? a.top - 4 : a.bottom + 4,
      left: Math.min(Math.max(8, a.left), window.innerWidth - w - 8),
      w, up,
    });
  }, [width]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  // Anything that moves the control moves the panel with it. Capture, because
  // the scroll that matters is usually a container's, not the window's.
  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

  // Outside click and Escape both mean "leave it as it was".
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  useEffect(() => {
    if (open) { setQ(""); setCursor(0); search.current?.focus(); }
  }, [open]);

  useEffect(() => { setCursor(0); }, [q]);

  // Keep the highlighted row in view when the arrow keys walk past the edge.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  const take = useCallback((v: string) => {
    onChange(v); setOpen(false); anchor.current?.focus();
  }, [onChange]);

  // The keys this control uses are handled on the document, in the capture
  // phase, and stopped there.
  //
  // Escape is the reason. Several of these sit inside a Dialog, and Dialog
  // closes itself on Escape through its own window listener. A React handler
  // cannot stop that — React delegates at the root and the window listener
  // runs afterwards — so Escape to close the dropdown closed the whole dialog
  // with it, losing everything that had been typed into it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const keys = ["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter"];
      if (!keys.includes(e.key)) return;
      // Home and End belong to the caret while somebody is typing in the
      // search box; they only walk the list when the box is not focused.
      if ((e.key === "Home" || e.key === "End") && e.target === search.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setOpen(false); anchor.current?.focus(); }
      else if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, shown.length - 1));
      else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "Home") setCursor(0);
      else if (e.key === "End") setCursor(shown.length - 1);
      else if (e.key === "Enter") {
        const o = shown[cursor];
        if (o && !o.disabled) take(o.value);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, shown, cursor, take]);

  const active = Boolean(value) && value !== allValue;

  return (
    <>
      <button ref={anchor} type="button" disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault(); setOpen(true);
          }
        }}
        aria-haspopup="listbox" aria-expanded={open}
        title={chosen?.label ?? allLabel ?? placeholder}
        className={twMerge([
          "inline-flex items-center justify-between gap-1 rounded-lg border bg-bg-base",
          "text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          "focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15",
          field ? "w-full px-3 py-2 text-[13px]"
                : narrow ? "pl-2 pr-1.5 py-1 text-[11.5px] min-w-[7.5rem]"
                         : "pl-2.5 pr-2 py-1.5 text-[12px] min-w-[9.5rem]",
          open ? "border-gold ring-2 ring-gold/15"
               : field ? (active ? "border-border text-txt-primary"
                                 : "border-border text-txt-light hover:border-slate-300")
               : active ? "border-gold font-semibold text-txt-primary"
                        : "border-border text-txt-muted hover:border-slate-300",
        ].join(" "), className)}>
        <span className="truncate">{chosen?.label ?? allLabel ?? placeholder}</span>
        <ChevronDown className={`shrink-0 ${narrow ? "w-3 h-3" : "w-3.5 h-3.5"}
                                 text-txt-light transition-transform
                                 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && box && typeof document !== "undefined" && createPortal(
        <div ref={panel} role="listbox"
          style={{
            position: "fixed", top: box.up ? undefined : box.top,
            bottom: box.up ? window.innerHeight - box.top : undefined,
            left: box.left, width: box.w, zIndex: 10050,
          }}
          className="rounded-xl border border-gold/50 bg-white shadow-xl overflow-hidden">

          <div className="relative border-b border-border-light">
            <Search className="w-3.5 h-3.5 text-txt-light absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder ?? "Type to narrow…"}
              className="w-full pl-8 pr-7 py-2 text-[12px] text-txt-primary bg-white
                         placeholder:text-txt-light focus:outline-none" />
            {q && (
              <button type="button" onClick={() => { setQ(""); search.current?.focus(); }}
                title="Clear"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5
                           text-txt-light hover:text-txt-primary hover:bg-bg-base">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="overflow-auto" style={{ maxHeight: PANEL_MAX_H }}>
            {allLabel && !q && (
              <button type="button" onClick={() => take(allValue)}
                className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center
                            justify-between gap-2 border-b border-border-light
                            hover:bg-gold/[0.07] ${
                  value === allValue ? "text-navy font-semibold" : "text-txt-muted"}`}>
                {allLabel}
                {value === allValue && <Check className="w-3.5 h-3.5 text-gold" />}
              </button>
            )}

            {shown.length === 0 && (
              <p className="px-3 py-3 text-[11.5px] text-txt-light">{emptyLabel}</p>
            )}

            {shown.map((o, i) => (
              <button key={o.value} type="button" data-row={i} disabled={o.disabled}
                onMouseEnter={() => setCursor(i)}
                onClick={() => !o.disabled && take(o.value)}
                className={`w-full text-left px-3 py-1.5 flex items-center justify-between
                            gap-2 border-b border-border-light last:border-0
                            disabled:opacity-40 disabled:cursor-not-allowed
                            ${i === cursor ? "bg-gold/[0.07]" : ""}`}>
                <span className="min-w-0">
                  <span className={`block text-[12px] truncate ${
                    o.value === value ? "text-navy font-semibold" : "text-txt-primary"}`}>
                    {o.label}
                  </span>
                  {o.hint && (
                    <span className="block text-[10.5px] text-txt-light truncate">{o.hint}</span>
                  )}
                </span>
                <span className="shrink-0 flex items-center gap-1.5 text-[10.5px]">
                  {o.meta}
                  {o.value === value && <Check className="w-3.5 h-3.5 text-gold" />}
                </span>
              </button>
            ))}
          </div>

          {all.length > 8 && (
            <p className="px-3 py-1 border-t border-border-light text-[10.5px] text-txt-light">
              {shown.length} of {all.length}
              {shown.length > 0 && " · ↑↓ to move, Enter to choose"}
            </p>
          )}
        </div>,
        document.body)}
    </>
  );
}
