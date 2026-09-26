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
import { dayLabel, todayISO, targetDayISO } from "@/lib/prevDay";

const GRADES = [
  { key: "HG", label: "High Grade" },
  { key: "MG", label: "Medium Grade" },
  { key: "COB", label: "COB / COB Mix Grade" },
  { key: "LG", label: "Low Grade" },
] as const;

/** The four positions at the mine, in the order the IMOS form lists them. */
const MINE_BUCKETS = [
  { key: "MINE_PERMISSION_IN_HAND", label: "Permission in Hand" },
  { key: "MINE_AWAITING_PERMISSION", label: "Awaiting Permission" },
  { key: "MINE_AWAITING_VERIFICATION", label: "Awaiting Verification" },
  { key: "MINE_AWAITING_STACKING", label: "Awaiting Stacking" },
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
  // Stock is filed for a day that has finished, so yesterday is the useful
  // default; any past date can be picked.
  const [day, setDay] = useState(targetDayISO);
  const [cells, setCells] = useState<Cells>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxDay = todayISO();

  useEffect(() => {
    if (!open) return;
    setDay(targetDayISO());
    setError(null);
  }, [open]);

  const existing = useQuery<{
    has_data: boolean;
    cells: Record<string, number>;
    entered_by: string | null;
    entered_at: string | null;
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
    setCells(next);
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
      (rr, cc) => ({ grade: GRADES[cc].key, bucket: MINE_BUCKETS[rr].key }),
      MINE_BUCKETS.length, GRADES.length),
    [pasteInto]);

  const pastePlant = useCallback((r: number, c: number, grid: string[][]) =>
    pasteInto(grid, r, c,
      (rr, cc) => {
        const g = GRADES[rr], b = PLANT_BUCKETS[cc];
        if (b.lgOnly && g.key !== "LG") return null;
        return { grade: g.key, bucket: b.key };
      },
      GRADES.length, PLANT_BUCKETS.length),
    [pasteInto]);

  // ── everything derived ───────────────────────────────────────────────────
  const d = useMemo(() => {
    const mineByGrade: Record<string, number> = {};
    for (const g of GRADES) {
      mineByGrade[g.key] = MINE_BUCKETS.reduce(
        (s, b) => s + num(get(g.key, b.key)), 0);
    }
    const statusTotal: Record<string, number> = {};
    for (const b of MINE_BUCKETS) {
      statusTotal[b.key] = GRADES.reduce((s, g) => s + num(get(g.key, b.key)), 0);
    }
    const totalStock = Object.values(statusTotal).reduce((s, v) => s + v, 0);

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
    return { mineByGrade, statusTotal, totalStock, plantTotal, rowTotal, grand };
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
        for (const b of [...MINE_BUCKETS, ...PLANT_BUCKETS]) {
          const lgOnly = "lgOnly" in b && b.lgOnly;
          if (lgOnly && g.key !== "LG") continue;   // the database refuses it too
          payload.push({ grade: g.key, bucket: b.key, qty: num(get(g.key, b.key)) });
        }
      }
      await api.put("/stock-entry", { on_date: day, cells: payload });
      await onSaved(day);
      onClose();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Could not save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, day, onSaved, onClose]);

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
          <input
            id="stock-date"
            type="date"
            value={day}
            max={maxDay}
            onChange={(e) => setDay(e.target.value)}
            className="rounded border border-border bg-white px-2 py-1 text-[12px] font-mono text-navy
              focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
          <span className="text-[11px] text-txt-muted">{dayLabel(day)}</span>
          {existing.isFetching && <Loader2 size={12} className="animate-spin text-txt-light" />}
          {existing.data?.has_data && (
            <span className="text-[10px] text-txt-light">
              loaded for editing{existing.data.entered_by ? ` · last by ${existing.data.entered_by}` : ""}
            </span>
          )}
          {futureDay && (
            <span className="text-[11px] font-semibold text-danger">
              Cannot record a future date
            </span>
          )}
        </div>

        <div className="px-4 py-3 space-y-5">
          {/* ── at the mine ─────────────────────────────────────────────── */}
          <div>
            <div className="text-[11px] font-extrabold tracking-[.14em] text-navy uppercase mb-1.5">
              Stock at the Mine — by clearance status
            </div>
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
                {MINE_BUCKETS.map((b, ri) => (
                  <tr key={b.key} className="border-b border-border-light/70">
                    <td className="py-1.5 text-[12px] font-semibold text-txt-primary">{b.label}</td>
                    {GRADES.map((g, ci) => (
                      <td key={g.key} className="py-1.5 pl-2 w-[110px]">
                        <Cell
                          value={get(g.key, b.key)}
                          invalid={bad(get(g.key, b.key))}
                          onChange={(v) => set(g.key, b.key, v)}
                          onPasteGrid={(grid) => pasteMine(ri, ci, grid)}
                        />
                      </td>
                    ))}
                    <td className="py-1.5 pl-3 text-right w-[90px]">
                      <Derived v={d.statusTotal[b.key]} />
                    </td>
                  </tr>
                ))}
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
                {GRADES.map((g, ri) => (
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
