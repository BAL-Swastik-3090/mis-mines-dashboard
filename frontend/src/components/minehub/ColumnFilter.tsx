"use client";
/**
 * A filter that lives in the column it filters.
 *
 * The register was using a native <select> in the header, which draws the
 * operating system's own dropdown: a grey list in the wrong typeface, with the
 * options shouting in capitals because the header is. It worked and it looked
 * like a mistake.
 *
 * This is the same idea done properly — the heading is a button, it shows what
 * the column is currently filtered to, and the menu lists the values actually
 * present with how many rows each one has. A filter that does not say "17" next
 * to Off road makes people click it to find out.
 *
 * Rendered in a portal for the same reason Combobox is: the table scrolls
 * horizontally, and anything inside a scrolling ancestor gets clipped by it.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export default function ColumnFilter({
  label, value, options, onChange, align = "left", allLabel = "All",
}: {
  /** The column heading. Shown when nothing is selected. */
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
  align?: "left" | "right";
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: align === "right" ? r.right - 224 : r.left });
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

  const chosen = options.find((o) => o.value === value);
  const active = Boolean(value);

  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((v) => !v)}
        title={`Filter by ${label.toLowerCase()}`}
        className={`group inline-flex items-center gap-1 max-w-full rounded
                    px-1 -mx-1 py-0.5 transition-colors
                    ${align === "right" ? "flex-row-reverse" : ""}
                    ${active ? "text-gold-dark" : "text-txt-light hover:text-navy"}`}>
        <ChevronDown className={`w-3 h-3 shrink-0 transition ${open ? "rotate-180" : ""}
                                 ${active ? "" : "opacity-0 group-hover:opacity-100"}`} />
        <span className="truncate text-[10.5px] font-bold uppercase tracking-[.1em]">
          {active ? chosen?.label ?? value : label}
        </span>
        {active && (
          <span role="button" tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
            className="shrink-0 rounded-full p-0.5 hover:bg-rose-bg hover:text-rose">
            <X className="w-2.5 h-2.5" />
          </span>
        )}
      </button>

      {open && rect && typeof document !== "undefined" && createPortal(
        <div ref={menu} style={{ top: rect.top, left: rect.left }}
          className="fixed z-[60] w-56 max-h-72 overflow-y-auto rounded-xl border
                     border-slate-200 bg-white shadow-xl py-1">
          <button type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left
                        text-[12.5px] hover:bg-gold/[0.07]
                        ${!value ? "font-semibold text-navy" : "text-txt-muted"}`}>
            <Check className={`w-3.5 h-3.5 ${!value ? "text-gold" : "opacity-0"}`} />
            {allLabel}
          </button>
          <div className="my-1 border-t border-slate-100" />
          {options.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-txt-light">Nothing to filter by.</p>
          ) : options.map((o) => (
            <button key={o.value} type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left
                          text-[12.5px] hover:bg-gold/[0.07]
                          ${o.value === value ? "font-semibold text-navy" : "text-txt-muted"}`}>
              <Check className={`w-3.5 h-3.5 shrink-0
                                 ${o.value === value ? "text-gold" : "opacity-0"}`} />
              <span className="flex-1 truncate">{o.label}</span>
              {o.count !== undefined && (
                <span className="text-[11px] text-txt-light tabular-nums">{o.count}</span>
              )}
            </button>
          ))}
        </div>, document.body)}
    </>
  );
}

/** Count the distinct values in a column, for the menu to show. */
export function optionsFrom<T>(
  rows: T[], get: (row: T) => string | null | undefined,
  label: (value: string) => string = (v) => v,
): FilterOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = (get(row) ?? "").toString().trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
