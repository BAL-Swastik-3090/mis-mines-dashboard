"use client";
/**
 * Where the mine's total resource reserve is declared.
 *
 * SIX BOXES. A tonnage and an in-situ Cr2O3% for each of High, Medium and Low
 * Grade, against the date the survey declares them for. Everything else on the
 * form — the total tonnage, the weighted total grade, the present value — is
 * computed and is NOT entered and NOT stored.
 *
 * THE TOTAL GRADE IS WEIGHTED, NOT AVERAGED, and it is not carried over. The
 * mine's spreadsheet prints 46.26 against both its opening and its closing
 * position, which cannot both be true: that cell was not refreshed when the
 * depletion row was filled in. Here it is recomputed from whatever is in the
 * boxes, so it cannot go stale.
 *
 * THE VALUE IS PRICED ON THE SERVER, not here. The IBM rates live in
 * minehub.mineral_price and follow the monthly bulletin on their own; a rate
 * copied into this file is a rate that goes stale the month after it is
 * written, which is exactly how the three loss rates in services/lcm.py ended
 * up a month behind. The form asks the API what a position is worth and shows
 * the answer, so the figure seen before saving is produced by the same code,
 * and the same bulletin issue, as the figure the dashboard shows afterwards.
 *
 * ONE FIGURE, GROSS, AND THE RATES IT WAS STRUCK AT. Royalty, DMF and NMET
 * are not on this form by the mine's instruction: it answers what the reserve
 * is worth, and the deduction is a separate question the Executive Summary's
 * read-out answers. The service still returns both — nothing was taken out of
 * the calculation to take them off the screen.
 *
 * Gross is also what the mine's own sheet holds, despite its column being
 * headed "Present Value (Net of Royalty)": checked against every issue on
 * file, its 7,223.14 Cr is the tonnage at May 2026 rates with nothing
 * deducted. So this figure and that column are the same kind of number.
 *
 * EDITING IS NORMAL. A reserve is restated whenever a survey restates it, and
 * corrected whenever a typo is spotted. Picking a date that already has a
 * declaration loads it for editing; picking a new one starts a new survey and
 * leaves every earlier declaration where it is. Both go through one endpoint.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Save, Loader2, AlertTriangle, Mountain } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { dayLabel, todayISO } from "@/lib/prevDay";
import DateField from "@/components/minehub/DateField";
import LastChanged from "@/components/ui/LastChanged";
import FormShell from "@/components/ui/FormShell";

/**
 * THE BAND ASSAYS THE MINE WORKS TO, given by the mine itself. They are the
 * starting point of a new survey, not a constraint on it: the boxes are
 * ordinary editable fields and a resurvey that restates a band simply types
 * over them. What is SAVED is always what is in the box, never this constant —
 * nothing downstream reads these figures.
 *
 * They are prefilled rather than hardcoded because an assay that is right
 * today is a figure somebody must be able to correct without a deployment,
 * which is the whole reason the loss rates in services/lcm.py had to be moved
 * out of Python and into a table.
 */
const GRADES = [
  { key: "HG", label: "High Grade", cr2o3: "54.90" },
  { key: "MG", label: "Medium Grade", cr2o3: "46.56" },
  { key: "LG", label: "Low Grade", cr2o3: "32.88" },
] as const;

type GradeKey = (typeof GRADES)[number]["key"];
type Draft = Record<string, { tonnage: string; cr2o3: string }>;

/** One survey as the API returns it — the shape both the "which survey is in
 *  force" lookup and the per-date reload read. */
type DeclarationResponse = {
  as_on_date: string | null;
  exists: boolean;
  grades: { grade: string; label: string; tonnage: number | null; cr2o3: number | null }[];
  remarks: string | null;
  entry_id: string | null;
  entry_date: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

const EMPTY: Draft = Object.fromEntries(
  GRADES.map((g) => [g.key, { tonnage: "", cr2o3: g.cr2o3 }]),
);

/** A typed figure as a number. Commas are fine — the mine pastes from Excel,
 *  where 14,01,756 is what the cell looks like. */
function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}
function filled(v: string | undefined): boolean {
  return String(v ?? "").trim() !== "";
}
function bad(v: string | undefined): boolean {
  if (!filled(v)) return false;
  const n = Number(String(v).replace(/,/g, "").trim());
  return !Number.isFinite(n) || n < 0;
}

const TH =
  "px-2 py-1.5 text-[10px] font-extrabold tracking-[.1em] text-txt-secondary uppercase";
const BOX =
  "w-full px-2 py-1 text-[12px] font-mono tabular-nums text-right rounded " +
  "border border-border focus:border-accent focus:outline-none " +
  "focus:ring-1 focus:ring-accent/40";

/** `dp` is not cosmetic. formatIndian defaults to whole numbers, so a
 *  weighted assay of 46.34 printed as "46" and a value of 3,989.68 as
 *  "3,990" -- a grade rounded to the tonne is a different grade, and the
 *  Executive Summary block shows both to two places. */
function Derived({ v, unit, strong, dp = 0 }: {
  v: number | null; unit?: string; strong?: boolean; dp?: number;
}) {
  return (
    <span className={`text-[12px] font-mono tabular-nums ${
      strong ? "font-extrabold text-navy" : "text-txt-primary"}`}>
      {v == null ? "—" : formatIndian(Number(v.toFixed(dp)), dp)}
      {unit && v != null && <span className="text-txt-light font-sans"> {unit}</span>}
    </span>
  );
}

export default function MinesReserveEntryModal({
  open, onClose, onSaved, inline,
}: {
  open: boolean;
  /** True on its own screen under Daily Entry Hub: no backdrop, no
   *  click-to-dismiss, no close button. See FormShell. */
  inline?: boolean;
  onClose: () => void;
  onSaved: (day: string) => void | Promise<void>;
}) {
  // The date the SURVEY declares the reserve for — not the day it is typed,
  // and not necessarily today. A survey dated the 1st is routinely entered in
  // the second week, so no maximum is imposed beyond today.
  // EMPTY UNTIL THE LATEST SURVEY ANSWERS. A reserve is filed a few times a
  // year, so today is almost never the date being worked on and opening the
  // form on it meant six blank boxes and a date nobody wanted. The dialog
  // opens on the survey that is actually in force.
  const [day, setDay] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxDay = todayISO();

  // Cleared on every open so the bootstrap below runs again: a survey filed
  // since the dialog was last closed should be the one it comes back to.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDay("");
  }, [open]);

  /* ── which survey the form opens on ───────────────────────────────────── */
  // The latest declaration on or before today, asked for with no date at all.
  // Separate from the per-date query below because that one is deliberately
  // EXACT — it must never fall back — and this one is deliberately a fallback.
  const latest = useQuery<DeclarationResponse>({
    queryKey: ["resource-reserve-entry", "latest"],
    queryFn: async () => (await api.get("/resource-reserve/declaration")).data,
    enabled: open,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!open || day || !latest.data) return;
    // Nothing on file at all: a blank form dated today, which is the only
    // sensible thing to offer somebody filing the first survey.
    setDay(latest.data.as_on_date ?? todayISO());
  }, [open, day, latest.data]);

  // ── what is already on file for that exact date ───────────────────────────
  // Asked for an EXACT date, never "latest on or before". Falling back would
  // paint the previous survey's figures under a new date, which reads as
  // though that date already had a declaration — and a Save would then file
  // last quarter's tonnage as this quarter's survey.
  const existing = useQuery<DeclarationResponse>({
    queryKey: ["resource-reserve-entry", day],
    queryFn: async () =>
      (await api.get("/resource-reserve/declaration", {
        params: { as_on_date: day },
      })).data,
    enabled: open && Boolean(day),
    staleTime: 30 * 1000,
  });

  // Keyed on the day as well, so changing the date replaces the draft rather
  // than carrying one survey's typing onto another's date.
  useEffect(() => {
    if (!open || !day || !existing.data) return;
    if (!existing.data.exists) {
      setDraft(EMPTY);
      return;
    }
    // A SAVED SURVEY SHOWS ITS OWN ASSAYS, never the prefilled ones. The
    // default is the opening value of a blank form and nothing more; a
    // declaration that was filed at a different grade must come back reading
    // exactly as it was filed.
    const next: Draft = { ...EMPTY };
    for (const g of existing.data.grades) {
      next[g.grade] = {
        tonnage: g.tonnage == null ? "" : String(g.tonnage),
        cr2o3: g.cr2o3 == null ? next[g.grade]?.cr2o3 ?? "" : String(g.cr2o3),
      };
    }
    setDraft(next);
  }, [open, existing.data, day]);

  const set = (g: GradeKey, field: "tonnage" | "cr2o3", v: string) =>
    setDraft((d) => ({ ...d, [g]: { ...d[g], [field]: v } }));

  /**
   * Paste a block straight out of the reserve spreadsheet.
   *
   * The sheet lays the grades ACROSS — HG tonnes, HG Cr2O3, MG tonnes, … — so
   * a copied row arrives as one line of six values, while a column-wise copy
   * arrives as three lines of two. Both are accepted, decided by shape, and
   * anything past the edge is discarded rather than wrapping: a copied range
   * nearly always carries a trailing Total column, and that must not land in
   * the Low Grade boxes.
   */
  const onPaste = useCallback((e: React.ClipboardEvent, atRow: number) => {
    const raw = e.clipboardData.getData("text/plain");
    if (!raw || !/[\t\n]/.test(raw)) return;      // a single value: let it be
    e.preventDefault();
    const grid = raw.replace(/\r/g, "").replace(/\n+$/, "")
      .split("\n").map((r) => r.split("\t"));

    setDraft((prev) => {
      const next: Draft = { ...prev };
      const put = (gi: number, tonnage?: string, cr?: string) => {
        const g = GRADES[gi];
        if (!g) return;
        next[g.key] = {
          tonnage: tonnage !== undefined && tonnage.trim() !== ""
            ? tonnage.trim() : next[g.key].tonnage,
          cr2o3: cr !== undefined && cr.trim() !== "" ? cr.trim() : next[g.key].cr2o3,
        };
      };
      if (grid.length === 1 && grid[0].length >= 4) {
        // One row of the sheet: pairs across, starting at the pasted grade.
        for (let i = 0; i * 2 < grid[0].length; i++) {
          put(atRow + i, grid[0][i * 2], grid[0][i * 2 + 1]);
        }
      } else {
        // Grades down, tonnage and grade across.
        grid.forEach((row, i) => put(atRow + i, row[0], row[1]));
      }
      return next;
    });
  }, []);

  // ── what the boxes add up to ──────────────────────────────────────────────
  const totals = useMemo(() => {
    const rows = GRADES.map((g) => ({
      t: num(draft[g.key]?.tonnage),
      c: num(draft[g.key]?.cr2o3),
    }));
    const t = rows.reduce((s, r) => s + r.t, 0);
    // NOTHING TYPED IS NOT AN ASSAY OF ZERO. With tonnages in and the grade
    // boxes still empty the weighted mean is arithmetically 0, and a bare "0"
    // under a Cr2O3% heading reads as a real measurement of nought rather than
    // a figure nobody has entered yet. Blank until at least one is typed.
    const anyGrade = GRADES.some((g) => filled(draft[g.key]?.cr2o3));
    return {
      tonnage: t,
      // Weighted by tonnage, which is the only meaning a combined assay has.
      cr2o3: t > 0 && anyGrade
        ? rows.reduce((s, r) => s + r.t * r.c, 0) / t : null,
    };
  }, [draft]);

  // A FRESH FORM IS NOT A HALF-FILLED ONE. The grade boxes arrive prefilled,
  // so only a typed tonnage means somebody has started — otherwise opening the
  // form would greet them with a warning about what is still missing.
  const anyTyped = GRADES.some((g) => filled(draft[g.key]?.tonnage));
  const anyInvalid = GRADES.some(
    (g) => bad(draft[g.key]?.tonnage) || bad(draft[g.key]?.cr2o3)
        || num(draft[g.key]?.cr2o3) > 100);
  const incomplete = GRADES.filter(
    (g) => !filled(draft[g.key]?.tonnage) || !filled(draft[g.key]?.cr2o3));
  const futureDay = day > maxDay;

  // ── what it is worth, priced by the server ────────────────────────────────
  // Debounced, because this runs while somebody is still typing a tonnage and
  // every keystroke would otherwise be a round trip.
  const [priced, setPriced] = useState({ hg: 0, mg: 0, lg: 0 });
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setPriced({
      hg: num(draft.HG?.tonnage), mg: num(draft.MG?.tonnage),
      lg: num(draft.LG?.tonnage),
    }), 400);
    return () => clearTimeout(id);
  }, [open, draft]);

  const valuation = useQuery<{
    as_on: string;
    tonnage: number;
    valuation: {
      gross_cr: number; net_cr: number | null; charges_cr: number | null;
      charge_pct: number | null; rate_period: string | null;
      rate_source: string; rate_stale: boolean; rates_available: boolean;
      unpriced: string[];
      lines: { grade: string; label: string; tonnage: number;
               rate: number | null; value_cr: number | null }[];
    };
  }>({
    queryKey: ["resource-reserve-value", priced.hg, priced.mg, priced.lg, day],
    queryFn: async () =>
      (await api.get("/resource-reserve/valuation", {
        params: { ...priced, as_on: day },
      })).data,
    enabled: open && !futureDay && (priced.hg + priced.mg + priced.lg) > 0,
    staleTime: 5 * 60 * 1000,
  });
  const val = valuation.data?.valuation;

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put("/resource-reserve", {
        as_on_date: day,
        grades: GRADES.map((g) => ({
          grade: g.key,
          tonnage: num(draft[g.key]?.tonnage),
          cr2o3: num(draft[g.key]?.cr2o3),
        })),
      });
      await onSaved(day);
      // CLOSING IS A DIALOG'S WAY OF SAYING "SAVED". Inline there is nothing to
      // close, and remounting the form here would reset the date box and wipe
      // the screen with no sign the save had worked -- which reads exactly
      // like a save that silently failed. The form stays where it is; its own
      // queries were just invalidated by onSaved, so it refetches and shows
      // what was stored, and EntryHubSection prints the confirmation.
      if (!inline) onClose();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Could not save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [draft, day, onSaved, onClose]);

  /* NEITHER OF THESE APPLIES INLINE, and both would be bugs there.
     Escape means "put back what I was covering", and inline there is nothing
     covered -- it would silently throw away a half-typed form. And the scroll
     lock is held on document.body so the page BEHIND a dialog cannot move;
     inline that body is the page the form itself sits on, so a form taller
     than the window could not be scrolled to its own Submit button. */
  useEffect(() => {
    if (!open || inline) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, inline, onClose]);

  if (!open) return null;

  return (
    <FormShell inline={inline} maxW="max-w-3xl" inlineMax="max-w-[1000px]"
               label="Enter mines resource reserve" onClose={onClose}>
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Mountain size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Mines Resource Reserve
          </span>
          {!inline && (<button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors"
          >
            <X size={16} />
          </button>)}
        </div>

        {/* ── which survey ───────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-center gap-2 flex-wrap">
          <label htmlFor="reserve-date" className={TH.replace("px-2 py-1.5 ", "")}>
            Reserve as on
          </label>
          <DateField id="reserve-date" value={day} max={maxDay}
                     onChange={setDay} className="w-[140px]" />
          {day
            ? <span className="text-[11px] text-txt-muted">{dayLabel(day)}</span>
            : <span className="text-[11px] text-txt-light">Pick the date the survey declares the reserve for</span>}
          {(existing.isFetching || latest.isFetching)
            && <Loader2 size={12} className="animate-spin text-txt-light" />}
          {existing.data?.exists && (
            <span className="text-[10px] text-txt-light flex items-center gap-1.5">
              filed by {existing.data.entry_id}
              {existing.data.updated_at
                && existing.data.updated_at !== existing.data.entry_date && (
                <LastChanged
                  at={existing.data.updated_at}
                  by={existing.data.updated_by}
                  tone="light"
                  prefix="· edited"
                />
              )}
            </span>
          )}
          {futureDay && (
            <span className="text-[11px] font-semibold text-danger">
              Cannot declare a reserve for a future date
            </span>
          )}
          {/* EDITING vs FILING, said plainly. The two are one keystroke apart
              on this form and have very different consequences. */}
          <span className={`ml-auto text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${
            existing.data?.exists
              ? "bg-amber-50 text-amber-700 border border-amber-200"
              : "bg-bg-section text-txt-muted border border-border"}`}>
            {existing.data?.exists ? "Editing this survey" : "New survey"}
          </span>
        </div>

        <div className="px-4 py-3 space-y-4">
          {/* ── the six boxes ────────────────────────────────────────────── */}
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-light">
                <th className={`${TH} text-left`}>Grade</th>
                <th className={`${TH} text-right w-[170px]`}>Tonnes (MT)</th>
                <th className={`${TH} text-right w-[130px]`}>Cr<sub>2</sub>O<sub>3</sub>%</th>
                <th className={`${TH} text-right w-[150px]`}>Value (Rs Cr)</th>
              </tr>
            </thead>
            <tbody>
              {GRADES.map((g, i) => {
                const line = val?.lines.find((l) => l.grade === g.key);
                return (
                  <tr key={g.key} className="border-b border-border-light/60">
                    <td className="py-2 text-[12px] font-semibold text-navy">
                      {g.label}
                    </td>
                    <td className="py-1.5 pl-2">
                      <input
                        className={BOX}
                        inputMode="decimal"
                        aria-label={`${g.label} tonnage`}
                        value={draft[g.key]?.tonnage ?? ""}
                        onChange={(e) => set(g.key, "tonnage", e.target.value)}
                        onPaste={(e) => onPaste(e, i)}
                      />
                    </td>
                    <td className="py-1.5 pl-2">
                      <input
                        className={`${BOX} ${num(draft[g.key]?.cr2o3) > 100
                          ? "border-danger" : ""}`}
                        inputMode="decimal"
                        aria-label={`${g.label} Cr2O3 percent`}
                        value={draft[g.key]?.cr2o3 ?? ""}
                        onChange={(e) => set(g.key, "cr2o3", e.target.value)}
                        onPaste={(e) => onPaste(e, i)}
                      />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <Derived v={line?.value_cr ?? null} dp={2} />
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-bg-soft">
                <td className="py-2 text-[12px] font-extrabold text-navy">Total</td>
                <td className="py-2 pl-2 text-right">
                  <Derived v={totals.tonnage || null} strong />
                </td>
                <td className="py-2 pl-2 text-right">
                  <Derived v={totals.cr2o3} strong dp={2} />
                </td>
                <td className="py-2 pl-3 text-right">
                  <Derived v={val?.gross_cr ?? null} strong dp={2} />
                </td>
              </tr>
            </tbody>
          </table>

          {/* ── present value ───────────────────────────────────────────── */}
          <div className="rounded border border-border bg-bg-soft px-3 py-2.5">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={TH.replace("px-2 py-1.5 ", "")}>Present Value</span>
              {valuation.isFetching && (
                <Loader2 size={11} className="animate-spin text-txt-light" />
              )}
              {val?.rate_stale && (
                <span className="text-[10px] font-bold text-amber-700">
                  last known rates
                </span>
              )}
            </div>

            {val && val.rates_available ? (
              <>
                {/* THE FIGURE, AND THE RATES IT WAS STRUCK AT. Royalty, DMF
                    and NMET are not shown here by the mine's instruction: this
                    panel answers what the reserve is worth, and the deduction
                    is a separate question asked on the Executive Summary. The
                    server still returns both — see resource_reserve.value —
                    so nothing had to be removed from the calculation to take
                    them off the screen.

                    The per-band rates are printed beside the total because
                    this is the one figure on the form nobody typed, and
                    "where did 7,188 come from" is otherwise a question only
                    the API can answer. */}
                <div className="mt-1.5 flex items-end gap-4 flex-wrap">
                  <div>
                    <div className="text-[15px] font-mono tabular-nums font-extrabold text-navy">
                      {formatIndian(Number(val.gross_cr.toFixed(2)), 2)}
                      <span className="text-[10px] font-sans text-txt-light"> Cr</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pb-0.5">
                    {val.lines.map((l) => (
                      <span key={l.grade} className="text-[10px] text-txt-light">
                        {l.grade}{" "}
                        <span className="font-mono tabular-nums text-txt-secondary">
                          {l.rate == null ? "—" : `₹${formatIndian(l.rate, 0)}`}
                        </span>
                        <span className="text-txt-light">/MT</span>
                      </span>
                    ))}
                  </div>
                </div>
                <p className="mt-1.5 text-[10px] text-txt-light leading-relaxed">
                  {val.rate_source}. Rates follow the monthly bulletin on their
                  own — nothing here is typed.{" "}
                  {val.unpriced.length > 0 && (
                    <strong className="text-danger">
                      No rate on file for {val.unpriced.join(", ")} — that
                      tonnage is not in the figure.
                    </strong>
                  )}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[11px] text-txt-muted">
                {totals.tonnage > 0
                  ? "No IBM rate is on file for this month, so the reserve cannot be valued."
                  : "Enter a tonnage to see what the reserve is worth."}
              </p>
            )}
          </div>

          <p className="text-[10px] text-txt-light leading-relaxed">
            Tonnes in MT, Cr<sub>2</sub>O<sub>3</sub> as a percentage.{" "}
            <strong>Paste straight from the reserve sheet</strong> — a copied
            row or column both work, and commas in numbers are fine. The total
            tonnage, the weighted total grade and the value are worked out from
            the six boxes and are never stored, so no total can disagree with
            its parts. The band grades arrive at the mine&apos;s standing
            assays — <strong>54.90 / 46.56 / 32.88</strong> — and are editable:
            type over any of them and the survey is saved at what you typed.
            Each band&apos;s grade is then held fixed as it depletes, while the
            total is re-weighted by tonnage, so it moves as the mix moves.
            Saving replaces the whole declaration for this date — earlier
            surveys on other dates are untouched, and every change is logged.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-border-light flex items-center justify-end gap-2 bg-bg-soft">
          {error && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-danger mr-auto">
              <AlertTriangle size={12} />
              {error}
            </span>
          )}
          {!error && anyInvalid && (
            <span className="text-[11px] font-semibold text-danger mr-auto">
              A figure is not valid — a grade must be between 0 and 100
            </span>
          )}
          {!error && !anyInvalid && anyTyped && incomplete.length > 0 && (
            <span className="text-[11px] font-semibold text-amber-700 mr-auto">
              {incomplete.map((g) => g.label).join(", ")} still needs a tonnage
              and a grade — enter 0 for an exhausted band
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-border text-[12px] font-bold
              text-txt-secondary hover:bg-bg-section"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !day || anyInvalid || futureDay
                      || incomplete.length > 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded text-[12px] font-bold
              bg-navy text-white shadow-sm transition-colors
              hover:bg-navy-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
    </FormShell>
  );
}
