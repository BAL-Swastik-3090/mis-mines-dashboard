"use client";
/**
 * A hover card, for the detail a cell has no room for.
 *
 * The browser's own `title` attribute was doing this job. It works, and it is
 * the wrong tool the moment the detail is worth reading: it waits a second
 * before appearing, renders in the operating system's font at the operating
 * system's size, collapses newlines differently on every platform, cannot
 * hold a chip or a colour, and vanishes if the pointer moves a few pixels.
 * A punch record with two times, two gate names and a state is a small table,
 * not a sentence.
 *
 * So this is the platform's own. It is deliberately general — anything can
 * hang detail off anything — and the shape of what goes inside is left to the
 * caller, because a machine, a person and a punch are not the same card.
 *
 * WHY A PORTAL. These live inside tables that scroll horizontally, and
 * anything positioned inside a scrolling ancestor is clipped by it. The same
 * reason the column filters and the date picker are portalled.
 *
 * IT IS NOT A DIALOG. Hover cards are for detail somebody may want, never for
 * detail they need or for anything they must click: a touch screen has no
 * hover and a keyboard reaches this only on focus. Anything essential belongs
 * on the row.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Long enough that sweeping the pointer across a table of six thousand cells
 *  does not strobe; short enough that pausing on one feels answered. */
const OPEN_AFTER = 120;
const CLOSE_AFTER = 80;

export default function HoverCard({
  children, card, width = 280, disabled, className = "",
}: {
  /** What is hovered. */
  children: React.ReactNode;
  /** What appears. Null or undefined means nothing does. */
  card: React.ReactNode;
  width?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [at, setAt] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  };

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    // Above when there is no room below, so a card on the last row of a long
    // table is not half off the screen.
    const above = room < 190 && r.top > 190;
    setAt({
      top: above ? r.top - 8 : r.bottom + 8,
      // Clamped to the viewport: the cells at the right-hand edge of a month
      // are exactly the ones whose card would otherwise hang off it.
      left: Math.max(8, Math.min(r.left + r.width / 2 - width / 2,
                                 window.innerWidth - width - 8)),
      above,
    });
  }, [width]);

  const open = () => {
    if (disabled || !card) return;
    clear();
    openTimer.current = setTimeout(() => { place(); }, OPEN_AFTER);
  };
  const close = () => {
    clear();
    closeTimer.current = setTimeout(() => setAt(null), CLOSE_AFTER);
  };

  useEffect(() => {
    if (!at) return;
    const move = () => setAt(null);      // scrolling under a card is a stale card
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setAt(null); };
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
      window.removeEventListener("keydown", key);
    };
  }, [at]);

  useEffect(() => clear, []);

  return (
    <>
      <span ref={anchor} className={className}
        onMouseEnter={open} onMouseLeave={close}
        onFocus={open} onBlur={close}>
        {children}
      </span>

      {at && card && typeof document !== "undefined" && createPortal(
        <div role="tooltip"
          style={{
            top: at.top, left: at.left, width,
            transform: at.above ? "translateY(-100%)" : undefined,
          }}
          onMouseEnter={clear} onMouseLeave={close}
          className="fixed z-[80] rounded-xl border border-slate-200 bg-white
                     shadow-xl text-left animate-[cardIn_.12s_ease-out]">
          {card}
        </div>, document.body)}
    </>
  );
}

/* ── the pieces a card is usually built from ──────────────────────────────
   Exported so every card on the platform has the same rhythm, rather than
   each one inventing its own padding. */

export function CardHead({ title, sub, right }: {
  title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2 border-b border-slate-100 flex items-start justify-between gap-2">
      <span className="min-w-0">
        <span className="block text-[12.5px] font-bold text-navy leading-tight truncate">
          {title}
        </span>
        {sub && <span className="block text-[11px] text-txt-light mt-0.5 truncate">{sub}</span>}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </div>
  );
}

export function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 space-y-1.5">{children}</div>;
}

/** A labelled fact. The label is small and quiet; the value is the thing. */
export function Fact({ label, value, sub, tone }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-[.08em]
                       text-txt-light w-[64px] shrink-0">{label}</span>
      <span className="min-w-0">
        <span className={`block text-[12.5px] font-semibold tabular-nums
                          ${tone ?? "text-txt-primary"}`}>{value}</span>
        {sub && <span className="block text-[10.5px] text-txt-light truncate">{sub}</span>}
      </span>
    </div>
  );
}

export function CardNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 border-t border-slate-100 bg-bg-light/60
                    text-[11px] text-txt-muted leading-snug rounded-b-xl">
      {children}
    </div>
  );
}
