"use client";
/**
 * Filing one of the mine's three plans: a month of days, in a grid.
 *
 * ── IT IS A GRID BECAUSE THE MINE KEEPS A SHEET ────────────────────────────
 * PPIC and Geology both prepare these in Excel and have done for years. A
 * form with one day per screen would be thirty submissions against a sheet
 * they already have, so the grid takes a PASTE: select the block in Excel,
 * click a cell here, press Ctrl+V, and the rows land where they were aimed.
 *
 * NOTHING IS WRITTEN UNTIL IT HAS BEEN LOOKED AT. A paste fills the grid and
 * marks what it touched; the count of changed cells is on the Save button and
 * nothing reaches the server until that is pressed.
 *
 * ── WHAT THE FIRST VERSION GOT WRONG ───────────────────────────────────────
 * It drew twenty-two columns in one flat run and was unreadable. Three things
 * were actually broken, and each is worth knowing because each is easy to
 * repeat:
 *
 *   `position: sticky` DOES NOTHING ON <thead>. It has to be on the cells.
 *   The header scrolled away under nothing and the first row was drawn
 *   straight through it.
 *
 *   A STICKY CELL NEEDS ITS OWN OPAQUE BACKGROUND. The class used was
 *   bg-bg-subtle, which is not a token this app defines, so it painted
 *   nothing at all and the rows showed through.
 *
 *   AN <input> HAS NO INTRINSIC WIDTH. Set to w-full inside a table cell it
 *   collapses to the header's width, and 1178.14 renders as 1178.1 with the
 *   last digit clipped. Numeric cells are now sized for the figures the mine
 *   actually files.
 *
 * ── AND THE COLUMNS ARE BANDED ─────────────────────────────────────────────
 * The sheet is read as Balasore, then Sukinda, then the totals. The grid says
 * so, in a header row above the column names, with the computed block set
 * apart on a grey ground behind a heavier rule. The date column is frozen,
 * because a figure in the middle of twenty-two columns means nothing if you
 * cannot see which day it belongs to.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import {
  ClipboardPaste, History, Loader2, RotateCcw, Save, Trash2,
} from "lucide-react";
import {
  usePlanEntry, type PlanColumn, type PlanKind, type PlanRow,
} from "@/hooks/usePlanEntry";
import { Alert, Button, Card, Chip } from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import Toast from "@/components/minehub/Toast";

type Edits = Record<string, Record<string, string>>;

const cellKey = (r: PlanRow, keys: string[]) =>
  keys.map((k) => String(r[k] ?? "")).join("|");

/** 2026-11-04 → "Wed 04". The year and month are in the picker above. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("en-IN", { weekday: "short" })} ${String(d.getDate()).padStart(2, "0")}`;
}

/** A computed column's name, short enough for a heading. */
const shortGen = (c: string) =>
  c.replace(/_qty$/, "").replace(/_hr$/, " hr").replace(/_/g, " ");

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/**
 * A pale ground per block, so Balasore and Sukinda are told apart before they
 * are read.
 *
 * TAKEN FROM THE PLATFORM PALETTE, not invented: every family here carries a
 * `bg` that is already used for tinted chips, so the grid matches the rest of
 * the dashboard rather than introducing two more colours. Cycled by position
 * because the COB plan has five blocks and the despatch plan two — a fixed
 * map would have to be extended every time a plan gains a column.
 */
const BANDS = [
  { head: "bg-sky-bg",     cell: "bg-sky-bg/45",     rule: "border-sky-ring",     text: "text-sky" },
  { head: "bg-violet-bg",  cell: "bg-violet-bg/45",  rule: "border-violet-ring",  text: "text-violet" },
  { head: "bg-teal-bg",    cell: "bg-teal-bg/45",    rule: "border-teal-ring",    text: "text-teal" },
  { head: "bg-amber-bg",   cell: "bg-amber-bg/45",   rule: "border-amber-ring",   text: "text-amber" },
  { head: "bg-emerald-bg", cell: "bg-emerald-bg/45", rule: "border-emerald-ring", text: "text-emerald" },
  { head: "bg-indigo-bg",  cell: "bg-indigo-bg/45",  rule: "border-indigo-ring",  text: "text-indigo" },
];
const band = (i: number) => BANDS[i % BANDS.length];

function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = -3; i <= 6; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      value: v,
      label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

export default function PlanEntrySection({ kind }: { kind: PlanKind }) {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[3]?.value ?? months[0].value);
  const [edits, setEdits] = useState<Edits>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showComputed, setShowComputed] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * How far down the second header row sits.
   *
   * MEASURED, NOT GUESSED. Both header rows are sticky, and the lower one
   * needs the exact height of the upper one as its offset. The first version
   * hard-coded 30px; the row is not 30px, so a sliver of the table showed
   * through the gap between them and figures appeared to float behind the
   * headings. Font, padding and zoom all move that number, so it is read off
   * the rendered row instead.
   */
  const bandRowRef = useRef<HTMLTableRowElement>(null);
  const [bandHeight, setBandHeight] = useState(0);

  const { data, isLoading, error: loadError, history, save, removeDay } =
    usePlanEntry(kind, month);

  useEffect(() => { setEdits({}); setFocus(null); }, [month, kind]);

  // Re-measured whenever the grid's shape changes: hiding the computed block
  // or switching plan can rewrap a heading and change the row's height.
  useLayoutEffect(() => {
    const el = bandRowRef.current;
    if (!el) return;
    const read = () => setBandHeight(el.getBoundingClientRect().height);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [kind, month, showComputed, data?.columns?.length]);

  const keys = useMemo(() => data?.key_columns ?? [], [data]);
  const keyHeading = useCallback((name: string) =>
    data?.key_headings?.find((h) => h.name === name)?.heading
      ?? name.replace(/_/g, " "), [data]);
  const cols = useMemo(() => data?.columns ?? [], [data]);
  const rows = data?.rows ?? [];
  const genCols = useMemo(
    () => (showComputed ? data?.generated ?? [] : []), [data, showComputed]);

  /** The editable columns, banded by the block the mine's sheet calls them. */
  const groups = useMemo(() => {
    const out: { name: string; cols: PlanColumn[] }[] = [];
    cols.forEach((c) => {
      const g = c.group || "";
      const last = out[out.length - 1];
      if (last && last.name === g) last.cols.push(c);
      else out.push({ name: g, cols: [c] });
    });
    return out;
  }, [cols]);

  const genGroups = useMemo(
    () => (genCols.length
      ? [{ name: data?.generated_group ?? "Computed", cols: genCols }]
      : []),
    [genCols, data?.generated_group]);

  /** Where each column sits in the flat order, for paste to walk across. */
  const colIndex = useMemo(() => {
    const m: Record<string, number> = {};
    cols.forEach((c, i) => { m[c.name] = i; });
    return m;
  }, [cols]);

  const touched = useMemo(
    () => Object.values(edits).reduce((n, r) => n + Object.keys(r).length, 0),
    [edits],
  );

  const valueOf = useCallback((r: PlanRow, col: string): string => {
    const k = cellKey(r, keys);
    const e = edits[k]?.[col];
    if (e !== undefined) return e;
    const v = r[col];
    return v === null || v === undefined ? "" : String(v);
  }, [edits, keys]);

  const setCell = useCallback((r: PlanRow, col: string, v: string) => {
    const k = cellKey(r, keys);
    setEdits((prev) => {
      const row = { ...(prev[k] ?? {}) };
      const stored = r[col];
      const asStored = stored === null || stored === undefined ? "" : String(stored);
      // Typing a value back to what is stored is not a change. Without this
      // the Save count climbs as somebody tabs through the grid.
      if (v === asStored) {
        delete row[col];
        if (Object.keys(row).length === 0) {
          const next = { ...prev };
          delete next[k];
          return next;
        }
        return { ...prev, [k]: row };
      }
      return { ...prev, [k]: { ...row, [col]: v } };
    });
  }, [keys]);

  /**
   * Lay a clipboard block into the grid from the focused cell.
   *
   * TAB AND NEWLINE ARE THE ONLY SEPARATORS — that is what Excel,
   * LibreOffice and Google Sheets all put on the clipboard for a range, so
   * there is nothing to configure. A COMMA IS NOT ONE: Indian figures are
   * written 1,24,500 and splitting on commas would make three numbers of one.
   */
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    if (!focus || !data?.may_edit) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();

    const block = text.replace(/\r/g, "").replace(/\n+$/, "")
      .split("\n").map((line) => line.split("\t"));
    let filled = 0, skipped = 0;
    setEdits((prev) => {
      const next: Edits = { ...prev };
      block.forEach((line, dr) => {
        const r = rows[focus.row + dr];
        if (!r) { skipped += line.length; return; }
        const k = cellKey(r, keys);
        const row = { ...(next[k] ?? {}) };
        line.forEach((raw, dc) => {
          const col = cols[focus.col + dc];
          if (!col) { skipped += 1; return; }
          // Strip the thousands separators a sheet puts in, and nothing else.
          // A unit left in the cell stays, and the server refuses it by name —
          // which is how '292 cum' got into the old MySQL column unnoticed.
          const v = col.kind === "number"
            ? raw.trim().replace(/,/g, "")
            : raw.trim();
          const stored = r[col.name];
          const asStored = stored === null || stored === undefined ? "" : String(stored);
          if (v === asStored) { delete row[col.name]; return; }
          row[col.name] = v;
          filled += 1;
        });
        if (Object.keys(row).length) next[k] = row; else delete next[k];
      });
      return next;
    });
    setNotice(
      skipped
        ? `Pasted ${filled} cell${filled === 1 ? "" : "s"}. ${skipped} fell outside the grid and were ignored.`
        : `Pasted ${filled} cell${filled === 1 ? "" : "s"}. Nothing is filed until you press Save.`,
    );
  }, [focus, rows, cols, keys, data?.may_edit]);

  const onSave = async () => {
    const payload = Object.entries(edits).map(([k, changed]) => {
      const parts = k.split("|");
      const rec: Record<string, unknown> = {};
      keys.forEach((kc, i) => { rec[kc] = parts[i]; });
      return { ...rec, ...changed };
    });
    if (!payload.length) return;
    setError(null);
    try {
      const res = await save.mutateAsync(payload);
      setEdits({});
      setNotice(`Filed ${res.saved} day${res.saved === 1 ? "" : "s"}, `
        + `${res.fields_changed} figure${res.fields_changed === 1 ? "" : "s"} changed.`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That could not be filed.");
    }
  };

  if (loadError) {
    return (
      <Alert tone="error">
        This plan could not be read. The platform database may be unreachable —
        the figures are not lost, they are simply not visible.
      </Alert>
    );
  }

  return (
    <div>
      <Card>
        {/* ONE ROW, NOT THREE.
            The strip above already says DESPATCH, so a card header repeating
            it is a second heading for the same thing and two more rules
            across the screen. Everything that steers the grid — which month,
            what is in it, what is unsaved, and the three buttons — belongs on
            one line, and the table starts that much higher.

            THE INSTRUCTION IS BEHIND THE ICON. It is read once by each person
            and then costs a line every day afterwards saying what they know.
            Hover it and it is there. */}
        <div className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2
                        border-b border-border-light">
          <span
            title={
              "Click a cell, then paste a block straight from Excel — tab and "
              + "newline separate the cells, exactly as a spreadsheet copies "
              + "them.\n\nChanged cells turn amber, and nothing is filed until "
              + "you press Save.\n\nThe grey columns are worked out by the "
              + "database from the figures beside them and cannot be typed."
            }
            className="shrink-0 w-7 h-7 rounded-lg bg-slate-bg ring-1 ring-slate-ring
                       flex items-center justify-center cursor-help"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-slate" />
          </span>

          {/* WHICH PLAN, beside the month it applies to. The strip above says
              it too, but the strip is a navigation bar — this line is the one
              somebody reads when they are about to type, and a month with no
              subject on it is how November's despatch gets filed into
              November's excavation. */}
          <span className="font-semibold text-[13px] text-navy whitespace-nowrap">
            {data?.label ?? "Plan"}
          </span>
          <span className="text-txt-light">·</span>

          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Month"
            className="bg-bg-base border border-border rounded-lg px-2.5 py-1
                       text-[12.5px] font-semibold text-navy"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>

          <span className="text-[11.5px] text-txt-muted whitespace-nowrap">
            {isLoading ? "reading…" : `${rows.length} day${rows.length === 1 ? "" : "s"} filed`}
          </span>

          {touched > 0 && (
            <Chip tone="amber" dot={false}>
              {touched} unsaved
            </Chip>
          )}

          <label className="text-[11.5px] flex items-center gap-1.5 text-txt-muted
                            cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" checked={showComputed}
                   onChange={(e) => setShowComputed(e.target.checked)} />
            Computed
          </label>

          <span className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowHistory(true)}>
              <History className="w-3.5 h-3.5" /> History
            </Button>
            {touched > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setEdits({})}>
                <RotateCcw className="w-3.5 h-3.5" /> Discard
              </Button>
            )}
            <Button
              size="sm"
              disabled={!touched || save.isPending || !data?.may_edit}
              onClick={() => void onSave()}
            >
              {save.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Save className="w-3.5 h-3.5" />}
              {touched ? `Save ${touched}` : "Save"}
            </Button>
          </span>
        </div>

        {data && !data.may_edit && (
          <div className="px-5 pt-3">
            <Alert tone="info">
              You can read this plan but not file it. Filing is held by the
              department that owns it — ask an Access Manager if that is wrong.
            </Alert>
          </div>
        )}
        {error && <div className="px-5 pt-3"><Alert tone="error">{error}</Alert></div>}

        {/* FLUSH TO THE BOTTOM OF THE CARD. The grid is the screen; a band of
            card padding under the last row is a band of nothing, and the
            scrollbar then sits inside a margin instead of on the edge.
            rounded-b matches the card so the corners are not squared off. */}
        <div ref={gridRef} onPaste={onPaste}
             className="overflow-auto max-h-[calc(100vh-215px)] rounded-b-xl">
          <table className="text-[12px] border-collapse">
            <thead>
              {/* The block names. Its height is measured, not assumed — the
                  row below offsets by exactly this. */}
              <tr ref={bandRowRef}>
                <th rowSpan={2}
                    className="sticky left-0 top-0 z-30 bg-bg-section border-b border-r
                               border-border px-3 text-left font-semibold
                               text-txt-secondary whitespace-nowrap align-bottom pb-2">
                  {keyHeading(keys[0] ?? "")}
                </th>
                {keys.slice(1).map((k) => (
                  <th key={k} rowSpan={2}
                      className="sticky left-0 top-0 z-20 bg-bg-section border-b border-r
                                 border-border px-2 text-left font-semibold
                                 text-txt-secondary whitespace-nowrap align-bottom pb-2">
                    {keyHeading(k)}
                  </th>
                ))}
                {groups.map((g, gi) => {
                  const b = band(gi);
                  return (
                    <th key={g.name} colSpan={g.cols.length}
                        className={`sticky top-0 z-20 ${b.head} border-b border-border
                                    border-l-2 ${b.rule} px-2 pt-2 pb-1 text-center
                                    text-[10px] font-bold uppercase tracking-wider
                                    ${b.text} whitespace-nowrap`}>
                      {g.name}
                    </th>
                  );
                })}
                {genGroups.map((g) => (
                  <th key={g.name} colSpan={g.cols.length}
                      className="sticky top-0 z-20 bg-slate-bg border-b border-border
                                 border-l-2 border-l-border-strong px-2 pt-2 pb-1
                                 text-center text-[10px] font-bold uppercase
                                 tracking-wider text-txt-light whitespace-nowrap">
                    {g.name} · worked out by the database
                  </th>
                ))}
                {data?.may_delete && (
                  <th rowSpan={2}
                      className="sticky top-0 z-20 bg-bg-section border-b border-border" />
                )}
              </tr>
              <tr>
                {groups.flatMap((g, gi) =>
                  g.cols.map((c, i) => {
                    const b = band(gi);
                    return (
                      <th key={c.name}
                          style={{ top: bandHeight }}
                          className={`sticky z-20 ${b.head} border-b border-border
                                      px-2 pb-2 pt-0 text-[11px] font-semibold
                                      text-txt-secondary whitespace-nowrap
                                      ${c.kind === "number" ? "text-right" : "text-left"}
                                      ${i === 0 ? `border-l-2 ${b.rule}` : ""}`}>
                        {c.heading}
                      </th>
                    );
                  }))}
                {genGroups.flatMap((g) =>
                  g.cols.map((c, i) => (
                    <th key={c}
                        style={{ top: bandHeight }}
                        className={`sticky z-20 bg-slate-bg border-b border-border
                                    px-2 pb-2 pt-0 text-[11px] font-semibold
                                    text-txt-light text-right whitespace-nowrap
                                    ${i === 0 ? "border-l-2 border-l-border-strong" : ""}`}>
                      {shortGen(c)}
                    </th>
                  )))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => {
                const k = cellKey(r, keys);
                const rowTouched = Boolean(edits[k]);
                return (
                  <tr key={k} className={rowTouched ? "bg-amber/5" : "even:bg-bg-light"}>
                    <td className={`sticky left-0 z-10 border-b border-r border-border
                                    px-3 py-1 whitespace-nowrap font-mono text-[11.5px]
                                    text-txt-secondary
                                    ${rowTouched ? "bg-[#fdf3dd]" : "bg-bg-base"}`}>
                      {dayLabel(String(r[keys[0]] ?? ""))}
                    </td>
                    {keys.slice(1).map((kc) => {
                      // THE FACE NUMBER SHOWS AS ITS NAME. loc_id is what
                      // every row refers to and cannot change — it is the
                      // row's identity — but a number means nothing to the
                      // person reading the plan, so the master's name is what
                      // is drawn, with the number kept small beside it.
                      const isFace = kc === "loc_id";
                      const name = isFace ? (r.face_name as string | null) : null;
                      const typed = isFace ? (r.face_typed as string | null) : null;
                      // What was typed before the master existed, shown only
                      // when it disagrees — that is the row saying it was
                      // filed under a different name, which is worth seeing
                      // and not worth shouting about.
                      const drifted = Boolean(
                        isFace && typed && name
                        && typed.trim().toLowerCase() !== name.trim().toLowerCase());
                      return (
                        <td key={kc} className="border-b border-r border-border-light px-2 py-1
                                                whitespace-nowrap text-txt-secondary">
                          {isFace ? (
                            <span className="flex items-baseline gap-1.5">
                              <span className={r.face_status === "INACTIVE"
                                ? "text-txt-light italic" : ""}>
                                {name ?? `Face ${String(r[kc] ?? "")}`}
                              </span>
                              <span className="text-[10px] text-txt-light tabular-nums">
                                #{String(r[kc] ?? "")}
                              </span>
                              {drifted && (
                                <span title={`Filed as “${typed}” before the faces were a list`}
                                      className="text-[10px] text-amber cursor-help">●</span>
                              )}
                            </span>
                          ) : String(r[kc] ?? "")}
                        </td>
                      );
                    })}
                    {groups.flatMap((g, gi) =>
                      g.cols.map((c, i) => {
                        const ci = colIndex[c.name];
                        const changed = edits[k]?.[c.name] !== undefined;
                        const b = band(gi);
                        return (
                          <td key={c.name}
                              className={`border-b border-border-light p-0
                                          ${changed ? "" : b.cell}
                                          ${i === 0 ? `border-l-2 ${b.rule}` : ""}`}>
                            <input
                              value={valueOf(r, c.name)}
                              onFocus={() => setFocus({ row: ri, col: ci })}
                              onChange={(e) => setCell(r, c.name, e.target.value)}
                              readOnly={!data?.may_edit}
                              inputMode={c.kind === "number" ? "decimal" : undefined}
                              className={`px-2 py-1.5 bg-transparent tabular-nums
                                ${c.kind === "number" ? "text-right w-[92px]" : "text-left w-[160px]"}
                                ${changed ? "bg-amber/30 font-bold text-navy" : ""}
                                focus:outline-none focus:ring-1 focus:ring-inset focus:ring-navy`}
                            />
                          </td>
                        );
                      }))}
                    {genGroups.flatMap((g) =>
                      g.cols.map((c, i) => (
                        <td key={c}
                            className={`border-b border-border-light bg-slate-bg/70 px-2 py-1
                                        text-right tabular-nums text-txt-muted whitespace-nowrap
                                        ${i === 0 ? "border-l-2 border-l-border-strong" : ""}`}>
                          {fmt(r.computed?.[c])}
                        </td>
                      )))}
                    {data?.may_delete && (
                      <td className="border-b border-border-light px-2 py-1">
                        <button onClick={() => setConfirmDelete(String(r[keys[0]]))}
                                className="text-txt-light hover:text-rose"
                                title="Remove this day">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={keys.length + cols.length + genCols.length + 2}
                      className="px-5 py-10 text-center text-txt-muted">
                    No day of this month has been filed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </Card>

      <Dialog
        open={showHistory}
        title={`${data?.label ?? "Plan"} — what changed`}
        confirmLabel="Close"
        cancelLabel=""
        onConfirm={() => setShowHistory(false)}
        onCancel={() => setShowHistory(false)}
      >
        {history.data?.entries?.length ? (
          <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border-light text-left">
            {history.data.entries.map((e, i) => (
              <li key={i} className="py-1.5 text-[12px]">
                <span className="font-mono text-violet">{e.plan_date}</span>
                <span className="ml-2 font-semibold text-navy">{e.field}</span>
                <span className="ml-2 text-txt-muted">
                  {e.old_value ?? "blank"} → {e.new_value ?? "blank"}
                </span>
                <span className="ml-2 text-txt-light">
                  rev {e.revision} · {e.entry_id}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-txt-muted">
            Nothing has been changed in this month since the plan moved onto
            this platform.
          </p>
        )}
      </Dialog>

      <Dialog
        open={Boolean(confirmDelete)}
        tone="danger"
        title="Remove this day from the plan?"
        confirmLabel="Remove it"
        cancelLabel="Keep it"
        onConfirm={() => {
          const d = confirmDelete;
          setConfirmDelete(null);
          if (d) {
            removeDay.mutate(d, {
              onSuccess: () => setNotice(`${d} removed from the plan.`),
              onError: () => setError("That day could not be removed."),
            });
          }
        }}
        onCancel={() => setConfirmDelete(null)}
      >
        <p className="text-[12.5px]">
          <span className="font-semibold">{confirmDelete}</span> will no longer
          have a plan. Every achievement for that day is then measured against
          nothing, and the screens show it as no plan rather than as a gap.
        </p>
        <p className="mt-2 text-[12px] text-txt-muted">
          What it said is kept in the history. Correcting a figure is usually
          what is wanted instead.
        </p>
      </Dialog>

      <Toast tone="success" message={notice} onClose={() => setNotice(null)} />
    </div>
  );
}
