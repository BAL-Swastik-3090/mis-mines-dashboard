"use client";
/**
 * Where the mines stock position is entered — replacing the IMOS portal form.
 *
 * TWENTY-FIVE BOXES, AND NOTHING ELSE. Four grades in each of six buckets, plus
 * LG for COB which applies to Low Grade only. Every other figure on this form —
 * Total Stock, the per-status totals, the Mines column, the row totals, the
 * grand total — is computed live from those twenty-five and is NOT entered and
 * NOT stored. The IMOS table stored its totals and they drifted: its Total
 * Stock row disagreed with the sum of its own status rows on 2 of 22 dates,
 * once by 2,841 MT. A figure that cannot be typed cannot be typed wrongly.
 *
 * "MINES (ORE)" IS NOT A SECOND SET OF NUMBERS. In the IMOS form it looks like
 * a column of the location table; it is the mine buckets for that grade, which
 * is why the same 1,120 MG appears in both halves of their screen. Here it is
 * shown as a computed column, so the two can never be entered differently.
 *
 * A ZERO IS AN ANSWER. Unlike the Est Actual dialog, where an empty box means
 * "not known", a stock position is a complete statement: zero means there is
 * none of that grade in that bucket. Every cell is therefore submitted, empty
 * boxes included, as zero.
 *
 * ONE TRANSACTION. The whole day replaces the previous one in a single
 * request. A position that is part yesterday and part today is worse than one
 * that is simply yesterday's, because it looks current.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Save, Loader2, AlertTriangle, Boxes } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { dayLabel, todayISO } from "@/lib/prevDay";
import DateField from "@/components/minehub/DateField";
import LastChanged from "@/components/ui/LastChanged";

const GRADES = [
  { key: "HG", label: "High Grade" },
  { key: "MG", label: "Medium Grade" },
  { key: "COB", label: "COB / COB Mix Grade" },
  { key: "LG", label: "Low Grade" },
] as const;

/**
 * The location table lists Low Grade before COB, the clearance table the other
 * way round. That is how the mine's own sheet has it, and the read-only section
 * already follows the same two orders — so the form a figure is typed into and
 * the panel it is read back from agree.
 *
 * Order only. Both are the same four grades, so nothing can be entered into one
 * that has nowhere to go in the other.
 */
const LOCATION_GRADES = [
  GRADES[0],  // High Grade
  GRADES[1],  // Medium Grade
  GRADES[3],  // Low Grade
  GRADES[2],  // COB / COB Mix Grade
] as const;

/** The four positions at the mine, in the order the IMOS form lists them.
 *  These four, and only these four, sum to Total Stock. */
const MINE_BUCKETS = [
  { key: "MINE_PERMISSION_IN_HAND", label: "Permission in Hand" },
  { key: "MINE_AWAITING_PERMISSION", label: "Awaiting Permission" },
  { key: "MINE_AWAITING_VERIFICATION", label: "Awaiting Verification" },
  { key: "MINE_AWAITING_STACKING", label: "Awaiting Stacking" },
] as const;

const AWAITING_PERMISSION = "MINE_AWAITING_PERMISSION";

/** Rows 8A and 8B: WHY the permission is still awaited. A breakdown of the row
 *  above, never a fifth position — the mine's rule is that the two add up to
 *  Awaiting Permission, so Awaiting Permission is no longer typed at all. */
const AWAITING_PARTS = [
  { key: "MINE_AWAIT_ANALYSIS_REPORT", label: "— Awaiting Analysis Report" },
  { key: "MINE_AWAIT_ROYALTY_PAYMENT", label: "— Awaiting Royalty Payment" },
] as const;

type BucketRow = { key: string; label: string; lgOnly?: boolean };

/** What the user types into. Awaiting Permission is absent on purpose: it is
 *  derived, so the two figures and their parent can never disagree. */
const ENTRY_ROWS: BucketRow[] = MINE_BUCKETS.flatMap((b): BucketRow[] =>
  b.key === AWAITING_PERMISSION
    ? AWAITING_PARTS.map((p) => ({ key: p.key, label: p.label }))
    : [{ key: b.key, label: b.label }]);

/** What the table draws: the parent in its place, derived, with its two
 *  reasons indented underneath. */
const MINE_ROWS: (BucketRow & { derived: boolean; child: boolean })[] =
  MINE_BUCKETS.flatMap((b): (BucketRow & { derived: boolean; child: boolean })[] =>
    b.key === AWAITING_PERMISSION
      ? [{ key: b.key, label: b.label, derived: true, child: false },
         ...AWAITING_PARTS.map((p) => ({
           key: p.key, label: p.label, derived: false, child: true }))]
      : [{ key: b.key, label: b.label, derived: false, child: false }]);

/** Where a proposed despatch can go. Qty is SKD + BLS and is never entered. */
const DESPATCH_TO = [
  { key: "SKD", label: "SKD" },
  { key: "BLS", label: "BLS" },
] as const;

const PLANT_BUCKETS = [
  { key: "BAL_PLANT", label: "BAL Plant (Ore & Briq)", lgOnly: false },
  { key: "SUK_PLANT", label: "Suk Plant (Ore & Briq)", lgOnly: false },
  { key: "LG_FOR_COB", label: "LG for COB", lgOnly: true },
] as const;

type Cells = Record<string, string>;
const cellKey = (grade: string, bucket: string) => `${grade}|${bucket}`;

/** Strip what a spreadsheet adds to a number.
 *
 *  Excel copies what is DISPLAYED, so "1,234.50" arrives with the thousands
 *  separators in it and Number() would read that as NaN. Commas, spaces and
 *  non-breaking spaces are removed; anything else is left alone so genuinely
 *  wrong input still shows as wrong rather than being silently mangled into a
 *  number that was never entered. */
function clean(raw: string | undefined): string {
  return (raw ?? "").replace(/[,\s\u00a0]/g, "").trim();
}

/** A box holds a number or nothing; nothing counts as zero when submitted. */
function num(raw: string | undefined): number {
  const t = clean(raw);
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}
function bad(raw: string | undefined): boolean {
  const t = clean(raw);
  if (t === "") return false;
  const n = Number(t);
  return !Number.isFinite(n) || n < 0;
}

/** A clipboard payload as a grid of cells.
 *
 *  Excel, Google Sheets and every other spreadsheet put tab-separated columns
 *  and newline-separated rows on the clipboard, so this is all that is needed
 *  to accept a pasted block. Trailing blank lines are dropped — selecting a
 *  range in Excel usually leaves one behind, and it would otherwise blank the
 *  row below whatever was pasted. */
function parseGrid(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line, i, all) => line.trim() !== "" || i < all.length - 1)
    .map((line) => line.split("\t"));
}

function Cell({
  value, invalid, onChange, onPasteGrid,
}: {
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
  /** Given the pasted block, anchored at THIS cell. */
  onPasteGrid: (grid: string[][]) => void;
}) {
  return (
    <input
      value={value}
      inputMode="decimal"
      placeholder="0"
      onPaste={(e) => {
        const text = e.clipboardData.getData("text/plain");
        // A single value is an ordinary paste into one box; let the browser do
        // it so undo, selection and caret position all behave normally.
        if (!/[\t\n\r]/.test(text)) return;
        e.preventDefault();
        onPasteGrid(parseGrid(text));
      }}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full text-right font-mono text-[12px] rounded px-2 py-1 border bg-white
        transition-colors ${invalid ? "border-danger text-danger" : "border-border text-navy"}
        focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30`}
    />
  );
}

/** A figure the form works out rather than asks for. */
function Derived({ v, strong = false }: { v: number; strong?: boolean }) {
  return (
    <span className={`font-mono ${strong ? "text-[13px] font-bold text-navy" : "text-[12px] text-txt-muted"}`}>
      {formatIndian(Math.round(v * 100) / 100)}
    </span>
  );
}

export default function MinesStockEntryModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (day: string) => void | Promise<void>;
}) {
  // TODAY, not yesterday. The stock position is the mine's standing at the
  // moment it is filed, and the proposed despatch above it is for the day
  // ahead — both belong to today. Defaulting to yesterday filed each day's
  // figures one day back. Any past date can still be picked.
  const [day, setDay] = useState(todayISO);
  const [cells, setCells] = useState<Cells>({});
  /** Tonnage carried into Awaiting Royalty Payment because the day was filed
   *  before the two reasons existed. 0 on every normal day. */
  const [legacySplit, setLegacySplit] = useState(0);
  /** The day's proposed despatch, keyed by destination. Qty is never held —
   *  it is SKD + BLS, worked out where it is shown. */
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxDay = todayISO();

  useEffect(() => {
    if (!open) return;
    setDay(todayISO());
    setError(null);
  }, [open]);

  const existing = useQuery<{
    has_data: boolean;
    cells: Record<string, number>;
    proposed_despatch?: Record<string, number>;
    entered_by: string | null;
    entered_at: string | null;
    updated_by: string | null;
    updated_at: string | null;
  }>({
    queryKey: ["stock-entry", day],
    queryFn: async () => (await api.get("/stock-entry", {
      params: { on_date: day },
    })).data,
    enabled: open && Boolean(day),
    staleTime: 30 * 1000,
  });

  // Load whatever is stored for the selected day. Keyed on the day too, so
  // changing date replaces the draft rather than carrying one day's typing
  // onto another.
  useEffect(() => {
    if (!open || !existing.data) return;
    const next: Cells = {};
    for (const [k, v] of Object.entries(existing.data.cells)) next[k] = String(v);

    // ── A DAY FILED BEFORE THE SPLIT EXISTED ────────────────────────────────
    // It has an Awaiting Permission figure and neither of its two reasons.
    // Awaiting Permission is now derived, so leaving the reasons blank would
    // redraw that tonnage as nought and write the zero on the next save — the
    // user would have destroyed the figure by opening the day and pressing
    // Save. Nobody can know the split retrospectively, so the whole of it is
    // carried into Awaiting Royalty Payment, where the mine's own sheet of 26
    // October puts all of it, and the banner says so and asks them to correct
    // it. The total is preserved either way, which is the part that must not
    // be lost to a guess.
    let carried = 0;
    for (const g of GRADES) {
      const parent = num(next[cellKey(g.key, AWAITING_PERMISSION)]);
      const hasSplit = AWAITING_PARTS.some(
        (p) => next[cellKey(g.key, p.key)] !== undefined);
      if (parent > 0 && !hasSplit) {
        next[cellKey(g.key, "MINE_AWAIT_ROYALTY_PAYMENT")] = String(parent);
        next[cellKey(g.key, "MINE_AWAIT_ANALYSIS_REPORT")] = "0";
        carried += parent;
      }
    }
    setLegacySplit(carried);
    setCells(next);
    const pd: Record<string, string> = {};
    for (const [k, v] of Object.entries(existing.data.proposed_despatch ?? {})) {
      pd[k] = String(v);
    }
    setProposed(pd);
  }, [open, existing.data, day]);

  const get = (g: string, b: string) => cells[cellKey(g, b)] ?? "";
  const set = (g: string, b: string, v: string) =>
    setCells((c) => ({ ...c, [cellKey(g, b)]: v }));

  /**
   * Spread a pasted block across a grid, anchored at the cell pasted into.
   *
   * WHY ANCHORED RATHER THAN ALWAYS TOP-LEFT. Somebody copying only the two
   * plant columns out of a spreadsheet should be able to drop them into the
   * plant columns, not have them land on Mines. Pasting into the first cell
   * fills the whole grid, which is the common case.
   *
   * Anything past the edge of the grid is discarded rather than wrapping, and
   * cells the grid does not have — LG for COB on anything but Low Grade — are
   * skipped. A spreadsheet range almost always carries a trailing total column
   * or a blank line, and neither should corrupt a neighbouring figure.
   */
  const pasteInto = useCallback((
    grid: string[][],
    rowAt: number,
    colAt: number,
    cellOf: (r: number, c: number) => { grade: string; bucket: string } | null,
    rows: number,
    cols: number,
  ) => {
    setCells((prev) => {
      const next = { ...prev };
      grid.forEach((line, dr) => {
        const r = rowAt + dr;
        if (r >= rows) return;
        line.forEach((raw, dc) => {
          const c = colAt + dc;
          if (c >= cols) return;
          const cell = cellOf(r, c);
          if (!cell) return;                 // not a box on this grid
          next[cellKey(cell.grade, cell.bucket)] = raw.trim();
        });
      });
      return next;
    });
  }, []);

  const pasteMine = useCallback((r: number, c: number, grid: string[][]) =>
    pasteInto(grid, r, c,
      // ENTRY_ROWS, not MINE_BUCKETS: a pasted block lands on the rows that
      // have inputs, and Awaiting Permission no longer does.
      (rr, cc) => ({ grade: GRADES[cc].key, bucket: ENTRY_ROWS[rr].key }),
      ENTRY_ROWS.length, GRADES.length),
    [pasteInto]);

  const pastePlant = useCallback((r: number, c: number, grid: string[][]) =>
    pasteInto(grid, r, c,
      (rr, cc) => {
        const g = LOCATION_GRADES[rr], b = PLANT_BUCKETS[cc];
        if (b.lgOnly && g.key !== "LG") return null;
        return { grade: g.key, bucket: b.key };
      },
      LOCATION_GRADES.length, PLANT_BUCKETS.length),
    [pasteInto]);

  // ── everything derived ───────────────────────────────────────────────────
  const d = useMemo(() => {
    // Awaiting Permission is never typed — it is its two reasons added up.
    // Everything that needs its value goes through here, so the figure the
    // totals use is the same one drawn on its row.
    const mineVal = (grade: string, bucket: string): number =>
      bucket === AWAITING_PERMISSION
        ? AWAITING_PARTS.reduce((s, p) => s + num(get(grade, p.key)), 0)
        : num(get(grade, bucket));

    const mineByGrade: Record<string, number> = {};
    for (const g of GRADES) {
      mineByGrade[g.key] = MINE_BUCKETS.reduce(
        (s, b) => s + mineVal(g.key, b.key), 0);
    }
    const statusTotal: Record<string, number> = {};
    for (const b of [...MINE_BUCKETS, ...AWAITING_PARTS]) {
      statusTotal[b.key] = GRADES.reduce(
        (s, g) => s + mineVal(g.key, b.key), 0);
    }
    // Over the FOUR buckets only. statusTotal also carries rows 8A and 8B, and
    // those already sit inside Awaiting Permission — summing its values would
    // add the whole of row 8 to Total Stock a second time.
    const totalStock = MINE_BUCKETS.reduce((s, b) => s + statusTotal[b.key], 0);

    const plantTotal: Record<string, number> = {};
    for (const b of PLANT_BUCKETS) {
      plantTotal[b.key] = GRADES.reduce(
        (s, g) => s + (b.lgOnly && g.key !== "LG" ? 0 : num(get(g.key, b.key))), 0);
    }
    const rowTotal: Record<string, number> = {};
    for (const g of GRADES) {
      rowTotal[g.key] = mineByGrade[g.key] + PLANT_BUCKETS.reduce(
        (s, b) => s + (b.lgOnly && g.key !== "LG" ? 0 : num(get(g.key, b.key))), 0);
    }
    const grand = totalStock + Object.values(plantTotal).reduce((s, v) => s + v, 0);
    // Awaiting Permission per grade — the derived cells on its row.
    const permByGrade: Record<string, number> = {};
    for (const g of GRADES) {
      permByGrade[g.key] = mineVal(g.key, AWAITING_PERMISSION);
    }
    return { mineByGrade, statusTotal, totalStock, plantTotal, rowTotal, grand,
             permByGrade, mineVal };
    // `cells` is what actually changes; get() closes over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  const anyInvalid = useMemo(() => Object.values(cells).some(bad), [cells]);
  const futureDay = day > maxDay;

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: { grade: string; bucket: string; qty: number }[] = [];
      for (const g of GRADES) {
        // Awaiting Permission is sent as the sum of its two reasons — the same
        // figure the screen showed — so the stored parent and children always
        // agree. The API checks this again per grade and refuses the day if
        // they do not.
        payload.push({
          grade: g.key, bucket: AWAITING_PERMISSION,
          qty: AWAITING_PARTS.reduce(
            (s, p) => s + num(cells[cellKey(g.key, p.key)]), 0),
        });
        const everyTypedRow: BucketRow[] = [...ENTRY_ROWS, ...PLANT_BUCKETS];
        for (const b of everyTypedRow) {
          const lgOnly = Boolean(b.lgOnly);
          if (lgOnly && g.key !== "LG") continue;   // the database refuses it too
          // Read `cells` directly rather than through get(), which closes over
          // it. Everything this callback sends must come from a value named in
          // the dependency list below, or it sends a stale one.
          payload.push({
            grade: g.key, bucket: b.key,
            qty: num(cells[cellKey(g.key, b.key)]),
          });
        }
      }
      await api.put("/stock-entry", {
        on_date: day,
        cells: payload,
        proposed_despatch: Object.fromEntries(
          DESPATCH_TO.map((d) => [d.key, num(proposed[d.key] ?? "")])),
      });
      await onSaved(day);
      onClose();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Could not save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
    // `proposed` MUST be here. It was missing, and the omission was invisible
    // on the way in and silent on the way out: this callback is rebuilt only
    // when something in this list changes, so editing ONLY the proposed
    // despatch — reopening a day whose stock is already filed and typing a
    // destination — left it holding the proposed values from the last time a
    // stock cell moved. The screen showed 830 because the inputs render from
    // state; the request carried 0, and the server dutifully stored 0.
    //
    // No eslint-disable here. The rule was being suppressed for get(), and it
    // was right about this one the whole time.
  }, [cells, proposed, day, onSaved, onClose]);

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

  const th = "px-2 py-1.5 text-[10px] font-extrabold tracking-[.1em] text-txt-secondary uppercase";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/45 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enter mines stock position"
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-border w-full max-w-4xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Boxes size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Mines Stock Position
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── which day ─────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-center gap-2 flex-wrap">
          <label htmlFor="stock-date" className={th.replace("px-2 py-1.5 ", "")}>
            Stock Date
          </label>
          <DateField id="stock-date" value={day} max={maxDay}
                     onChange={setDay} className="w-[140px]" />
          <span className="text-[11px] text-txt-muted">{dayLabel(day)}</span>
          {existing.isFetching && <Loader2 size={12} className="animate-spin text-txt-light" />}
          {existing.data?.has_data && (
            <span className="text-[10px] text-txt-light flex items-center gap-1.5">
              {/* WHO FILED IT vs WHO LAST TOUCHED IT. This used to say "last
                  by" and show Entry_Id, which was neither: the day was rewritten
                  on every save, so the name belonged to the most recent writer
                  while the label claimed it was the entry. Both are now shown,
                  and the second only appears once they differ. */}
              filed by {existing.data.entered_by}
              {existing.data.updated_at
                && existing.data.updated_at !== existing.data.entered_at && (
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
              Cannot record a future date
            </span>
          )}
        </div>

        <div className="px-4 py-3 space-y-5">
          {/* ── proposed despatch ───────────────────────────────────────────
              What the mine intends to send today, split by plant. It sits above
              the stock because it is the decision the stock is read in order to
              make, and it is entered against the same date so the proposal and
              the position it was judged against stay together.

              Qty is SKD + BLS and is never typed or stored — the same rule as
              every other total on this form, which is why none of them can
              disagree with their parts. */}
          <div>
            <div className="text-[11px] font-extrabold tracking-[.14em] text-navy uppercase mb-1.5">
              Proposed Today&apos;s Despatch
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-bg-section">
                  <th className={`${th} text-left`}>Destination</th>
                  {DESPATCH_TO.map((d) => (
                    <th key={d.key} className={`${th} text-right`}>{d.label}</th>
                  ))}
                  <th className={`${th} text-right`} title="SKD + BLS — worked out, not entered">
                    Qty (MT)
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border-light/70">
                  <td className="py-1.5 text-[12px] font-semibold text-txt-primary">
                    Proposed despatch
                  </td>
                  {DESPATCH_TO.map((d) => (
                    <td key={d.key} className="py-1.5 pl-2 w-[110px]">
                      <Cell
                        value={proposed[d.key] ?? ""}
                        invalid={bad(proposed[d.key] ?? "")}
                        onChange={(v) =>
                          setProposed((prev) => ({ ...prev, [d.key]: v }))}
                        onPasteGrid={(grid) => {
                          // One row, two boxes — a pasted block fills across
                          // from wherever it landed and the rest is ignored.
                          const line = grid[0] ?? [];
                          const from = DESPATCH_TO.findIndex((x) => x.key === d.key);
                          setProposed((prev) => {
                            const next = { ...prev };
                            line.forEach((raw, i) => {
                              const t = DESPATCH_TO[from + i];
                              if (t) next[t.key] = raw.trim();
                            });
                            return next;
                          });
                        }}
                      />
                    </td>
                  ))}
                  <td className="py-1.5 pl-2 text-right w-[110px]">
                    <Derived
                      v={DESPATCH_TO.reduce((t, d) => t + num(proposed[d.key] ?? ""), 0)}
                      strong
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── at the mine ─────────────────────────────────────────────── */}
          <div>
            <div className="text-[11px] font-extrabold tracking-[.14em] text-navy uppercase mb-1.5">
              Stock at the Mine — by clearance status
            </div>
            {legacySplit > 0 && (
              <div className="mb-2 px-2.5 py-1.5 rounded border border-[#ffe082] bg-[#fff8e1]
                              text-[11px] leading-snug text-txt-primary">
                <span className="font-bold">This day was filed before the split existed. </span>
                Its {legacySplit.toLocaleString("en-IN")} MT of Awaiting Permission has been
                placed under <span className="font-semibold">Awaiting Royalty Payment</span> so
                the total is not lost. Move whatever is actually awaiting an analysis report to
                the row above before saving.
              </div>
            )}
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-bg-section">
                  <th className={`${th} text-left`}>Clearance Status</th>
                  {GRADES.map((g) => (
                    <th key={g.key} className={`${th} text-right`}>{g.key}</th>
                  ))}
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {MINE_ROWS.map((b) => {
                  // Index into the TYPED rows, which is what a pasted grid
                  // lands on — Awaiting Permission has no inputs to paste into.
                  const ri = ENTRY_ROWS.findIndex((e) => e.key === b.key);
                  return (
                    <tr key={b.key} className="border-b border-border-light/70">
                      <td className={`py-1.5 text-[12px] ${b.child
                        ? "pl-4 font-normal text-txt-secondary"
                        : "font-semibold text-txt-primary"}`}>
                        {b.label}
                      </td>
                      {GRADES.map((g, ci) => (
                        <td key={g.key} className="py-1.5 pl-2 w-[110px]">
                          {b.derived ? (
                            // Not an input. The mine's rule is that this row IS
                            // its two reasons added up, so letting it be typed
                            // would create a figure that could contradict them.
                            <div className="text-right pr-2"
                                 title="Awaiting Analysis Report + Awaiting Royalty Payment">
                              <Derived v={d.permByGrade[g.key]} />
                            </div>
                          ) : (
                            <Cell
                              value={get(g.key, b.key)}
                              invalid={bad(get(g.key, b.key))}
                              onChange={(v) => set(g.key, b.key, v)}
                              onPasteGrid={(grid) => pasteMine(ri, ci, grid)}
                            />
                          )}
                        </td>
                      ))}
                      <td className="py-1.5 pl-3 text-right w-[90px]">
                        <Derived v={d.statusTotal[b.key]} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-bg-soft">
                  <td className="py-2 text-[12px] font-extrabold text-navy">Total Stock</td>
                  {GRADES.map((g) => (
                    <td key={g.key} className="py-2 pl-2 text-right">
                      <Derived v={d.mineByGrade[g.key]} strong />
                    </td>
                  ))}
                  <td className="py-2 pl-3 text-right">
                    <Derived v={d.totalStock} strong />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── elsewhere ───────────────────────────────────────────────── */}
          <div>
            <div className="text-[11px] font-extrabold tracking-[.14em] text-navy uppercase mb-1.5">
              Location &amp; Grade wise Stock
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-bg-section">
                  <th className={`${th} text-left`}>Grade</th>
                  <th className={`${th} text-right`} title="Computed from the mine table above — not entered">
                    Mines (Ore) · auto
                  </th>
                  {PLANT_BUCKETS.map((b) => (
                    <th key={b.key} className={`${th} text-right`}>{b.label}</th>
                  ))}
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {LOCATION_GRADES.map((g, ri) => (
                  <tr key={g.key} className="border-b border-border-light/70">
                    <td className="py-1.5 text-[12px] font-semibold text-txt-primary">{g.label}</td>
                    <td className="py-1.5 pl-2 text-right w-[110px]">
                      <Derived v={d.mineByGrade[g.key]} />
                    </td>
                    {PLANT_BUCKETS.map((b, ci) => (
                      <td key={b.key} className="py-1.5 pl-2 w-[110px]">
                        {b.lgOnly && g.key !== "LG" ? (
                          <span className="block text-right text-[12px] text-txt-light/50">—</span>
                        ) : (
                          <Cell
                            value={get(g.key, b.key)}
                            invalid={bad(get(g.key, b.key))}
                            onChange={(v) => set(g.key, b.key, v)}
                            onPasteGrid={(grid) => pastePlant(ri, ci, grid)}
                          />
                        )}
                      </td>
                    ))}
                    <td className="py-1.5 pl-3 text-right w-[90px]">
                      <Derived v={d.rowTotal[g.key]} />
                    </td>
                  </tr>
                ))}
                <tr className="bg-bg-soft">
                  <td className="py-2 text-[12px] font-extrabold text-navy">
                    Total Stock at Diff. Location
                  </td>
                  <td className="py-2 pl-2 text-right"><Derived v={d.totalStock} strong /></td>
                  {PLANT_BUCKETS.map((b) => (
                    <td key={b.key} className="py-2 pl-2 text-right">
                      <Derived v={d.plantTotal[b.key]} strong />
                    </td>
                  ))}
                  <td className="py-2 pl-3 text-right"><Derived v={d.grand} strong /></td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-txt-light leading-relaxed">
            All figures in MT. <strong>Paste straight from Excel</strong> — copy a
            block of cells and paste into the box where it should start; extra
            rows or columns are ignored, and commas in numbers are fine.
            Only the boxes are entered — every total, and the Mines (Ore) column,
            is worked out from them and is never stored, so a total cannot
            disagree with its parts. An empty box is saved as 0. Saving replaces
            the whole position for this date.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-border-light flex items-center justify-end gap-2 bg-bg-soft">
          {error && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-danger mr-auto">
              <AlertTriangle size={12} />
              {error}
            </span>
          )}
          {anyInvalid && !error && (
            <span className="text-[11px] font-semibold text-danger mr-auto">
              One of the boxes is not a valid quantity
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
            disabled={saving || anyInvalid || futureDay}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded text-[12px] font-bold
              bg-navy text-white shadow-sm transition-colors
              hover:bg-navy-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
