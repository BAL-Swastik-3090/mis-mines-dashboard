"use client";
/**
 * Single home for every formula used anywhere in the OEE / LCM section.
 *
 * The formulae previously sat in a card under the OEE table and in footnotes
 * beneath the LCM cards. They are gathered here so the section reads as data
 * rather than as a derivation, and so there is exactly one place to look when
 * someone asks how a number was arrived at.
 *
 * Data-source labels and interpretation caveats deliberately stay on the page:
 * they qualify the numbers being displayed rather than explain how to compute
 * them, and hiding a caveat behind a click would be the wrong trade.
 */
import { useEffect } from "react";
import { X, Calculator } from "lucide-react";

type Row = { label: string; formula: string; note?: string };

const OEE_ROWS: Row[] = [
  { label: "Availability",   formula: "Operating Hrs ÷ Ideal Time × 100",
    note: "Divided by Ideal Time, not God Hours — planned loss is excluded before the ratio is taken" },
  { label: "Performance",    formula: "Actual CuM ÷ (Ideal Capacity × Operating Hrs) × 100",
    note: "Capped at 100%" },
  { label: "Quality",        formula: "100% (fixed)",
    note: "No quality losses are tracked at the excavation stage" },
  { label: "OEE",            formula: "Availability × Performance × Quality",
    note: "Target ≥ 75%" },
];

const OEE_SUPPORT: Row[] = [
  { label: "God Hrs",        formula: "Days in period × 24" },
  { label: "Ideal Time",     formula: "God Hrs − (Weekly Off + No Plan + Planned Shutdown)" },
  { label: "Operating Hrs",  formula: "Ideal Time − (Breakdown + PM)" },
  { label: "Actual CuM",     formula: "(ore + lg + ob + boulder + tailing + feed_to_cobp) × 6  +  silt × 4",
    note: "Trip counts converted to volume" },
  { label: "Fleet figures",  formula: "Σ Operating ÷ Σ Ideal Time   ·   Σ Actual ÷ Σ Ideal CuM",
    note: "Weighted across machines, never an average of the per-machine percentages" },
  { label: "Deviation Hrs",  formula: "Shift Hours − Operating Hrs",
    note: "Reporting only — feeds no other formula" },
];

const LCM_ROWS: Row[] = [
  { label: "Ore Deviation",     formula: "Plan Ore − Actual Ore            (MT)",
    note: "Clamped at 0 — a period where actual beats plan has no production loss to distribute" },
  { label: "OB Deviation",      formula: "Plan OB − Actual OB              (CuM)" },
  { label: "Ore Factor",        formula: "Ore Deviation ÷ Σ Ore Loss Hours   (MT/hr)" },
  { label: "OB Factor",         formula: "OB Deviation ÷ Σ OB Loss Hours     (CuM/hr)" },
  { label: "Planned Ore Loss",  formula: "Ore Loss Hours (head) × Ore Factor",
    note: "Because each factor is derived from the hour total it divides, this column sums back to the Deviation by construction" },
  { label: "Planned OB Loss",   formula: "OB Loss Hours (head) × OB Factor" },
];

const COST_ROWS: Row[] = [
  { label: "Weighted Rate",  formula: "Σ(Plan Qty[grade] × IBM Rate[grade]) ÷ Σ Plan Qty[grade]",
    note: "Weighted on the planned grade mix, not the actual mix — the loss being valued is ore that was planned and never excavated. Being a ratio it is scale-invariant" },
  { label: "Plan Value",     formula: "Σ(Plan Qty[grade] × IBM Rate[grade])",
    note: "The whole planned ore valued at these rates — the Loss Amount is a slice of it, not a total of it" },
  { label: "Loss Amount",    formula: "Planned Ore Loss (MT) × Weighted Rate",
    note: "Costed off the rounded tonnage the page prints, so each row is reproducible by hand" },
  { label: "Loss Share",     formula: "Loss Amount (head) ÷ Total Loss Amount × 100",
    note: "Numerically identical to the share of planned ore loss and of ore loss hours — planned loss is hours × one factor and rupees is that × one rate, so both constants cancel" },
];

function Group({ title, rows, accent }: { title: string; rows: Row[]; accent: string }) {
  return (
    <div>
      <div className="font-condensed font-bold text-[11px] tracking-widest uppercase mb-2"
           style={{ color: accent }}>
        {title}
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="border-l-2 pl-3" style={{ borderLeftColor: accent }}>
            <div className="font-condensed font-bold text-[11.5px] text-navy">{r.label}</div>
            <div className="font-mono text-[11px] text-navy leading-relaxed whitespace-pre-wrap break-words">
              {r.formula}
            </div>
            {r.note && (
              <div className="text-[9.5px] text-txt-muted leading-snug mt-0.5">{r.note}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FormulaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Esc to close, and stop the page behind from scrolling while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/45"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="OEE and LCM formula reference"
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-border w-full max-w-4xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2 shrink-0">
          <Calculator size={15} className="text-[#6a1b9a]" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Calculation Reference — OEE / LCM
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Group title="OEE — the four factors" rows={OEE_ROWS}    accent="#1565c0" />
            <Group title="OEE — supporting terms" rows={OEE_SUPPORT} accent="#c8960c" />
          </div>
          <div className="border-t border-border-light pt-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Group title="LCM — loss distribution" rows={LCM_ROWS}  accent="#2e7d32" />
            <Group title="LCM — costing"           rows={COST_ROWS} accent="#ad1457" />
          </div>
        </div>

        <div className="px-4 py-2 border-t border-border-light bg-bg-section/40 shrink-0">
          <p className="text-[9px] font-mono text-txt-muted leading-tight">
            Loss hours come from the IMOS shift log; Breakdown and PM from SAP. OB carries no
            rupee value — it is waste rock moved to expose ore, so OB loss stays a volume in CuM.
          </p>
        </div>
      </div>
    </div>
  );
}
