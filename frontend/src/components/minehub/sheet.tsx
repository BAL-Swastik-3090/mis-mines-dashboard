"use client";
/**
 * The cost-sheet form primitives, shared.
 *
 * A dense label/value grid rather than stacked cards: the people filling these
 * in read cost sheets all day, and a form that looks like one can be scanned
 * for what is still blank instead of scrolled through.
 *
 * Lifted out of the equipment form so the operator profile is the same object
 * rather than a near-copy that drifts.
 */
import React from "react";
import { Info } from "lucide-react";

/** The input class every cell uses — borderless until focused, so the grid
 *  reads as a sheet and not as a stack of boxes. */
export const cellInput =
  "w-full bg-transparent px-3 py-2 text-[13px] text-txt-primary placeholder:text-txt-light " +
  "focus:outline-none focus:bg-gold/[0.05] focus:ring-1 focus:ring-inset focus:ring-gold/30 " +
  "transition-colors disabled:opacity-60";

export function Band({ title, hint, right }: {
  title: string; hint?: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-navy text-white px-4 py-2.5
                    rounded-t-xl border border-navy">
      <h3 className="font-condensed font-bold text-[12.5px] uppercase tracking-[.11em]
                     flex items-center gap-2">
        {title}
        {hint && (
          <span title={hint} className="text-white/50 hover:text-white cursor-help">
            <Info className="w-3.5 h-3.5" />
          </span>
        )}
      </h3>
      {right}
    </div>
  );
}

export function Row({ label, required, hint, children, wide, invalid }: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
  /** Submission refused on this one. Said on the label as well as the field,
   *  since a colour alone is invisible to anyone who cannot see it. */
  invalid?: boolean;
}) {
  return (
    <>
      <div className={`px-3 py-2 flex items-center gap-1.5 border-b border-r border-border-light
                       ${invalid ? "bg-rose-bg" : "bg-bg-light"}`}>
        <span className={`text-[12px] font-medium ${invalid ? "text-rose font-semibold" : "text-txt-secondary"}`}>
          {label}
        </span>
        {required && <span className="text-rose text-[12px]">*</span>}
        {hint && (
          <span title={hint} className="text-txt-light hover:text-navy cursor-help">
            <Info className="w-3 h-3" />
          </span>
        )}
      </div>
      <div className={`border-b border-border-light ${wide ? "lg:col-span-3" : ""}
                       ${invalid ? "bg-rose-bg/40 ring-1 ring-inset ring-rose-ring" : ""}`}>
        {children}
        {invalid && (
          <p className="px-3 pb-1.5 -mt-0.5 text-[11px] font-semibold text-rose">Needed to submit</p>
        )}
      </div>
    </>
  );
}

export function Sheet({ children }: { children: React.ReactNode }) {
  // label / value / label / value — collapses to two columns when narrow.
  return (
    <div className="grid grid-cols-[minmax(110px,160px)_1fr] lg:grid-cols-[minmax(120px,190px)_1fr_minmax(120px,190px)_1fr]
                    border border-t-0 border-border-light rounded-b-xl overflow-hidden bg-bg-base">
      {children}
    </div>
  );
}
