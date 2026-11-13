"use client";

/**
 * The paragraph under a page title, folded into the title.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Every handover screen opened with three or four lines explaining itself.
 * Each line earned its place when it was written — they say WHY the screen
 * works as it does, which is the thing nobody can reconstruct from the table
 * below — but a reader meets them every single visit, and by the third visit
 * they are a wall between the title and the data the reader came for.
 *
 * So the words are kept and the wall is not: an icon beside the title, and the
 * explanation on hover or focus. The reader who needs it once can find it, and
 * the reader who has read it is not charged for it again.
 *
 * ── IT IS NOT A TITLE ATTRIBUTE ──────────────────────────────────────────────
 * A native tooltip waits a second, cannot be styled, truncates, and never
 * appears for a keyboard user at all. These texts are two or three sentences
 * of reasoning, which is exactly what a native tooltip handles worst.
 */

import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";

export default function Explainer({
  children,
  label = "Why this screen works this way",
}: {
  children: React.ReactNode;
  /** What a screen reader announces, since an icon alone says nothing. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  // Escape closes it, and so does a click anywhere else: a panel that can only
  // be dismissed by finding the icon again is a panel in the way.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <span
      ref={box}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        /* Click as well as hover. Hover does not exist on the tablet, and
           somebody reading this on one needs the reasoning more than the
           person at a desk, not less. */
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-muted-foreground/60 hover:text-foreground focus:text-foreground
                   transition-colors rounded-full focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-sky-500/50"
      >
        <Info size={15} />
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full mt-1.5 z-30 w-[min(30rem,80vw)]
                     rounded-md border border-black/10 dark:border-white/15
                     bg-white dark:bg-neutral-900 shadow-lg
                     p-3 text-[12px] font-normal leading-relaxed
                     text-neutral-700 dark:text-neutral-200
                     normal-case tracking-normal text-left"
        >
          {children}
        </span>
      )}
    </span>
  );
}
