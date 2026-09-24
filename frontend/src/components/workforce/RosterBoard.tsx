"use client";
/**
 * The roster grid: everybody down the side, every day across the top.
 *
 * This is the shape a roster has been drawn in for a century, on paper, on a
 * whiteboard, in the spreadsheet this replaces — and it is the right shape,
 * because the question people bring to it is spatial. "Who is off on the 14th"
 * is a column. "When is Ramesh next resting" is a row. Anything cleverer makes
 * both of those harder.
 *
 * The name column is frozen and the header sticks, because a roster is read by
 * running a finger across a row, and a grid that loses the name at column nine
 * is a grid people print out instead of using.
 *
 * Cells are editable in place, and for a long time deliberately were not. The
 * objection was that a grid you can drag across invites a roster made of
 * exceptions that nothing can explain afterwards, and it was a fair one — the
 * answer was not to forbid the exceptions but to make them explain themselves.
 *
 * Every day set by hand is one row in roster_day and one event saying who set
 * it, when, and what it was before. A cell that was set by hand is marked as
 * such on the board, so a roster full of exceptions looks like one. And an
 * override never touches the pattern underneath: the pattern still says what
 * somebody normally works, and clearing the day gives it back.
 *
 * This is what makes rostering possible at all before any pattern exists,
 * which is the state this mine is actually in: 204 people on no pattern.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "@/components/minehub/DateField";
import {
  CalendarRange, ChevronLeft, ChevronRight, Loader2, Users, UserPlus, Search,
  CalendarOff, Plane, Sun, Download, Upload, Check, X, TriangleAlert,
} from "lucide-react";
import api from "@/lib/api";
import {
  Button, Card, CardHeader, Chip, Field, inputClass, Tile,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import ColumnFilter, { optionsFrom, matches } from "@/components/minehub/ColumnFilter";
import StarterPatterns from "./StarterPatterns";
import {
  DAY_STATE, SHIFT_LOOK, shiftBand, shortShift, UNROSTERED, dayLabel, isoDay, addDays, span, prettyDate,
  type DayCell,
} from "./state";

interface Person {
  operator_id: number; operator_ref: string | null; display_name: string;
  designation: string | null; department: string | null;
  employer: string | null; trade: string | null; trade_group: string | null;
  pattern_id: number | null; pattern_code: string | null; pattern_name: string | null;
  days: Record<string, DayCell>;
}

interface ShiftOption {
  code: string; name: string; start_time: string; end_time: string;
  planned_hours: number; crosses_midnight: boolean;
}

interface Pattern {
  pattern_id: number; code: string; name: string; cycle_days: number;
  slots: string[]; is_active: boolean; people: number;
}

interface Board {
  from: string; to: string;
  people: Person[];
  holidays: Record<string, { name: string; kind: string; stops_work: boolean }>;
  shifts: { code: string; name: string; start_time: string; end_time: string }[];
}

/** What an import would do, before it does any of it. */
interface ImportReport {
  dry_run: boolean; file: string; sheet: string;
  changes: { row: number; ref: string; display_name: string;
             from_pattern: string | null; to_pattern: string;
             effective_from: string }[];
  problems: { row: number; ref: string; why: string }[];
  unchanged: number;
  summary: Record<string, number>;
}

const WINDOWS = [
  { days: 13, label: "Fortnight" },
  { days: 29, label: "Month" },
  { days: 6, label: "Week" },
];

export default function RosterBoard({ mayManage, onChanged, onOpenOperator }: {
  mayManage: boolean; onChanged?: () => void; onOpenOperator?: (id: number) => void;
}) {
  const [start, setStart] = useState(() => isoDay(new Date()));
  const [length, setLength] = useState(13);
  const [board, setBoard] = useState<Board | null>(null);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);
  // Department, contractor and trade. A planner rosters a crew, and a crew is
  // picked out by who they work for and what they do, not by typing names.
  const [by, setBy] = useState({ department: "", employer: "", trade: "" });
  const setFilter = (k: keyof typeof by) => (v: string) =>
    setBy((was) => ({ ...was, [k]: v }));

  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [assigning, setAssigning] = useState(false);

  // Cells picked on the grid, as `${operator_id}|${iso}`. Separate from the
  // row checkboxes, which choose people for a pattern: this chooses squares.
  const [cells, setCells] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [lastCell, setLastCell] = useState<{ op: number; iso: string } | null>(null);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [cellBusy, setCellBusy] = useState(false);
  const [shiftsError, setShiftsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ pattern_id: "", effective_from: isoDay(new Date()) });

  const end = useMemo(() => addDays(start, length), [start, length]);
  const dates = useMemo(() => span(start, end), [start, end]);

  // Hands back the patterns as well as storing them. A caller that has just
  // created one needs it now, and reading the state it also sets would give it
  // the render before this one.
  const load = useCallback(async (): Promise<Pattern[]> => {
    setLoading(true);
    try {
      const [b, p] = await Promise.all([
        api.get("/workforce/board", { params: { from_date: start, to_date: end } }),
        api.get("/workforce/patterns"),
      ]);
      setBoard(b.data);
      const list: Pattern[] = p.data ?? [];
      setPatterns(list);
      setError(null);
      return list;
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The roster could not be loaded.");
      return [];
    } finally { setLoading(false); }
  }, [start, end]);

  useEffect(() => { void load(); }, [load]);

  // The shifts a cell may be set to come from the mine's own calendar, so one
  // that stops running stops being offered without anybody editing this file.
  //
  // The failure is kept, not swallowed. Catching it and carrying on left a bar
  // offering "Rest" and nothing else, with no way to tell that the shifts were
  // missing rather than nonexistent — which is precisely what happened the
  // first time this shipped, against a backend that did not yet have the route.
  const loadShifts = useCallback(async () => {
    try {
      setShifts((await api.get("/workforce/shifts")).data ?? []);
      setShiftsError(null);
    } catch {
      setShiftsError("The shifts this mine runs could not be read.");
    }
  }, []);

  useEffect(() => { void loadShifts(); }, [loadShifts]);

  // And tried again when the bar opens, so a backend that was restarting when
  // the page loaded does not leave the screen half-useful until somebody
  // thinks to reload it.
  useEffect(() => {
    if (cells.size > 0 && shifts.length === 0) void loadShifts();
  }, [cells.size, shifts.length, loadShifts]);

  // A drag ends wherever the mouse is let go, which is frequently not over the
  // grid. Without this the board stays in drag mode and the next click selects
  // a rectangle nobody asked for.
  useEffect(() => {
    const stop = () => setDragging(false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const cellKey = (op: number, iso: string) => `${op}|${iso}`;

  /** A shift code that fits the square it has to be read in.
   *
   *  The grid gives a day 28 pixels, which is right for A, B and C and hopeless
   *  for GENERAL — and GENERAL is exactly the one a fitter or a clerk is on.
   *  The mine calls it G when it is speaking, so the board does too, and the
   *  full name stays on the hover. */

  /** Pick a square, or extend from the last one.
   *
   *  Shift held, same row: everything between. That is how a fortnight of one
   *  man gets set, and clicking fourteen squares to do it is how people decide
   *  the screen is not worth using. */
  const touchCell = useCallback((op: number, iso: string, extend: boolean) => {
    setCells((was) => {
      const next = new Set(was);
      if (extend && lastCell && lastCell.op === op) {
        const a = dates.indexOf(lastCell.iso);
        const b = dates.indexOf(iso);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
            next.add(cellKey(op, dates[i]));
          }
          return next;
        }
      }
      const key = cellKey(op, iso);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setLastCell({ op, iso });
  }, [dates, lastCell]);

  /** Everything the pointer passes over while the button is down. */
  const dragOver = useCallback((op: number, iso: string) => {
    if (!dragging) return;
    setCells((was) => new Set(was).add(cellKey(op, iso)));
  }, [dragging]);

  // When each shift starts, by code. The colour of a square follows the clock,
  // and the board only knows the code.
  const startOf = useMemo(() => Object.fromEntries(
    shifts.map((sh) => [sh.code, sh.start_time])), [shifts]);

  const chosenCells = useMemo(() => [...cells].map((k) => {
    const [op, iso] = k.split("|");
    return { operator_id: Number(op), date: iso };
  }), [cells]);

  /** Set every chosen square to one shift, to rest, or back to the pattern. */
  const applyToCells = useCallback(async (shift: string | null | "CLEAR") => {
    if (chosenCells.length === 0) return;
    setCellBusy(true);
    try {
      if (shift === "CLEAR") {
        await api.delete("/workforce/days", { data: { cells: chosenCells } });
      } else {
        await api.put("/workforce/days", { cells: chosenCells, shift });
      }
      setCells(new Set());
      setLastCell(null);
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Those days could not be set.");
    } finally { setCellBusy(false); }
  }, [chosenCells, load]);

  const people = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (board?.people ?? []).filter((p) => {
      if (onlyGaps && p.pattern_id) return false;
      if (!matches(p.department, by.department)) return false;
      if (!matches(p.employer, by.employer)) return false;
      if (!matches(p.trade, by.trade)) return false;
      if (!term) return true;
      return [p.display_name, p.operator_ref, p.designation, p.trade,
              p.employer, p.department, p.pattern_code]
        .some((v) => String(v ?? "").toLowerCase().includes(term));
    });
  }, [board, query, onlyGaps, by]);

  // Built from everybody, not from the rows currently shown: a menu that
  // shrinks as you use it is a menu you cannot use to widen the selection
  // again without clearing it first.
  const menus = useMemo(() => {
    const all = board?.people ?? [];
    return {
      department: optionsFrom(all, (p) => p.department, (v) => v, "No department"),
      employer: optionsFrom(all, (p) => p.employer, (v) => v, "Own workforce"),
      trade: optionsFrom(all, (p) => p.trade, (v) => v, "No trade set"),
    };
  }, [board]);

  // What the window adds up to, which is the thing a planner actually reads
  // before deciding whether the roster is covered.
  const totals = useMemo(() => {
    let onDuty = 0, leave = 0, unrostered = 0;
    const byDay: Record<string, number> = {};
    for (const p of board?.people ?? []) {
      if (!p.pattern_id) unrostered += 1;
      for (const iso of dates) {
        const cell = p.days?.[iso];
        if (cell?.state === "ON") { onDuty += 1; byDay[iso] = (byDay[iso] ?? 0) + 1; }
        if (cell?.state === "LEAVE") leave += 1;
      }
    }
    const counts = dates.map((d) => byDay[d] ?? 0);
    return {
      headcount: board?.people.length ?? 0,
      unrostered,
      leave,
      thinnest: counts.length ? Math.min(...counts) : 0,
      average: counts.length ? Math.round(onDuty / counts.length) : 0,
      thinnestDay: dates[counts.indexOf(Math.min(...counts))] ?? null,
    };
  }, [board, dates]);

  const toggle = (id: number) => setPicked((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // "All" means all of what the filters are showing, not all 211. Filter to a
  // contractor, tick the box, and that crew goes on a pattern in one go —
  // which is the whole reason the filters are here.
  // The selection outlives the filters, so a planner can gather two crews
  // before rostering them. That also means some picked rows can be off screen,
  // which the dialog has to say out loud before anybody confirms.
  const pickedPeople = useMemo(
    () => (board?.people ?? []).filter((p) => picked.has(p.operator_id)),
    [board, picked]);
  const hiddenPicked = useMemo(() => {
    const shown = new Set(people.map((p) => p.operator_id));
    return pickedPeople.filter((p) => !shown.has(p.operator_id));
  }, [pickedPeople, people]);
  const pickedSpread = useMemo(() => {
    const tally = (get: (p: Person) => string | null) => {
      const m = new Map<string, number>();
      for (const p of pickedPeople) {
        const k = get(p) || "—";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return { employer: tally((p) => p.employer), trade: tally((p) => p.trade) };
  }, [pickedPeople]);

  const allShown = people.length > 0 && people.every((p) => picked.has(p.operator_id));
  const someShown = people.some((p) => picked.has(p.operator_id));
  const toggleAllShown = () => setPicked((was) => {
    const next = new Set(was);
    if (allShown) people.forEach((p) => next.delete(p.operator_id));
    else people.forEach((p) => next.add(p.operator_id));
    return next;
  });

  const assign = async () => {
    if (!form.pattern_id || picked.size === 0) return;
    setBusy(true);
    try {
      await api.post("/workforce/assignments", {
        operator_ids: [...picked],
        pattern_id: Number(form.pattern_id),
        effective_from: form.effective_from,
        anchor_date: form.effective_from,
      });
      setAssigning(false);
      setPicked(new Set());
      await load();
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The roster could not be saved.");
    } finally { setBusy(false); }
  };

  /** The workbook, as the browser downloads anything: a blob and a click. */
  const exportRoster = async () => {
    setBusy(true);
    try {
      const r = await api.get("/workforce/export", {
        params: { from_date: start, to_date: end },
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Kaliapani-roster-${start}-${end}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("The roster could not be exported.");
    } finally { setBusy(false); }
  };

  /** Always read first. Nothing is written until somebody has seen what would
   *  change — a spreadsheet that has been round the office is never something
   *  anybody is certain about. */
  const readFile = async (file: File) => {
    setBusy(true);
    setPendingFile(file);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.post("/workforce/import?dry_run=true", form);
      setPreview(r.data);
      setImporting(true);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That file could not be read.");
      setPendingFile(null);
    } finally { setBusy(false); }
  };

  const applyImport = async () => {
    if (!pendingFile) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", pendingFile);
      const r = await api.post("/workforce/import?dry_run=false", form);
      setNotice(`${r.data.changes.length} roster change(s) applied from ${r.data.file}.`);
      setImporting(false);
      setPreview(null);
      setPendingFile(null);
      await load();
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The import could not be applied.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="On the register" value={totals.headcount} icon={Users} tone="navy"
              hint="Active operators" />
        <Tile label="Typical day" value={totals.average} icon={Sun} tone="emerald"
              hint="On duty, averaged over the window" />
        <Tile label="Thinnest day" value={totals.thinnest} icon={CalendarOff}
              tone={totals.thinnest < totals.average * 0.7 ? "rose" : "slate"}
              hint={totals.thinnestDay ? prettyDate(totals.thinnestDay) : "—"} />
        <Tile label="Leave days" value={totals.leave} icon={Plane} tone="amber"
              hint="Across this window" />
        <Tile label="Not on a roster" value={totals.unrostered} icon={UserPlus}
              tone={totals.unrostered ? "rose" : "slate"}
              hint={totals.unrostered ? "Nobody knows when they work" : "Everybody is placed"}
              onClick={() => setOnlyGaps((v) => !v)} active={onlyGaps} />
      </div>

      <Card>
        <CardHeader
          title="Roster" icon={CalendarRange} tone="violet"
          subtitle={board ? `${prettyDate(board.from)} to ${prettyDate(board.to)}` : "Loading"}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-light" />
                {/* This header is the busiest in the app, so its search takes
                    what is left rather than a fixed width it has to be given. */}
                <input className={`${inputClass} pl-8 w-full sm:w-[260px] lg:w-[340px]`}
                       placeholder="Find somebody"
                       value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {/* A menu with one value in it cannot narrow anything, and today
                  every workman is CLL's. It appears the day a second
                  contractor does. */}
              {menus.department.length > 1 && (
                <ColumnFilter variant="control" label="Department" allLabel="All departments"
                  value={by.department} options={menus.department}
                  onChange={setFilter("department")} />
              )}
              {menus.employer.length > 1 && (
                <ColumnFilter variant="control" label="Contractor" allLabel="All contractors"
                  value={by.employer} options={menus.employer}
                  onChange={setFilter("employer")} />
              )}
              {menus.trade.length > 1 && (
                <ColumnFilter variant="control" label="Job" allLabel="All jobs"
                  value={by.trade} options={menus.trade} onChange={setFilter("trade")} />
              )}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                {WINDOWS.map((w) => (
                  <button key={w.days} onClick={() => setLength(w.days)}
                    className={`px-2.5 py-1.5 text-[11px] font-semibold transition
                      ${length === w.days ? "bg-navy text-white" : "bg-white text-txt-muted hover:bg-slate-50"}`}>
                    {w.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="secondary"
                        onClick={() => setStart(addDays(start, -(length + 1)))}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setStart(isoDay(new Date()))}>
                  Today
                </Button>
                <Button size="sm" variant="secondary"
                        onClick={() => setStart(addDays(start, length + 1))}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
              <Button size="sm" variant="secondary" disabled={busy}
                      onClick={() => void exportRoster()} title="Download this window as Excel">
                <Download className="w-3.5 h-3.5" /> Excel
              </Button>
              {mayManage && (
                <label className="inline-flex items-center gap-1.5 rounded-lg border
                                  border-slate-200 bg-white px-2.5 py-1.5 text-[11px]
                                  font-semibold text-txt-muted hover:bg-slate-50
                                  cursor-pointer transition"
                       title="Bring an edited Assignments sheet back">
                  <Upload className="w-3.5 h-3.5" /> Import
                  <input type="file" className="hidden"
                         accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                         onChange={(e) => {
                           const f = e.target.files?.[0];
                           e.target.value = "";
                           if (f) void readFile(f);
                         }} />
                </label>
              )}
              {mayManage && picked.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}
                        title="Clear the selection">
                  Clear {picked.size}
                </Button>
              )}
              {mayManage && (
                <Button size="sm" variant="primary" disabled={picked.size === 0}
                        onClick={() => setAssigning(true)}>
                  <UserPlus className="w-3.5 h-3.5" />
                  {picked.size ? `Roster ${picked.size}` : "Select to roster"}
                </Button>
              )}
            </div>
          }
        />

        {error && (
          <div className="px-5 py-3 text-[12px] text-rose bg-rose-bg border-b border-rose/20">
            {error}
          </div>
        )}
        {notice && (
          <div className="px-5 py-3 text-[12px] text-sky bg-sky-bg border-b border-sky/20
                          flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-3">
          {/* The shifts first, because they are what the board is mostly made
              of, and a legend that leads with "on duty" explains the one thing
              nobody needed explaining. */}
          {shifts.map((sh) => {
            const look = SHIFT_LOOK[shiftBand(sh.code, sh.start_time)];
            return (
              <span key={sh.code} className="inline-flex items-center gap-1.5 text-[11.5px] text-txt-muted"
                    title={`${sh.name} · ${sh.start_time?.slice(0, 5)}–${sh.end_time?.slice(0, 5)}`}>
                <span className={`w-3.5 h-3.5 rounded border ${look.cell}
                                  inline-flex items-center justify-center text-[8px] font-bold`}>
                  {shortShift(sh.code)}
                </span>
                {sh.name}
              </span>
            );
          })}
          {Object.entries(DAY_STATE).filter(([key]) => key !== "ON").map(([key, look]) => (
            <span key={key} className="inline-flex items-center gap-1.5 text-[11px] text-txt-muted">
              <span className={`w-3.5 h-3.5 rounded border ${look.cell}`} />
              {look.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-txt-muted">
            <span className={`w-3.5 h-3.5 rounded border ${UNROSTERED.cell}`} />
            {UNROSTERED.label}
          </span>
          <span className="ml-auto text-[11px] text-txt-light">
            {mayManage
              ? "A letter is the shift they work that day. Click a square to change it — drag, or shift-click, for a run of days."
              : "A letter is the shift they work that day."}
          </span>
        </div>

        {/* The bar only exists while squares are chosen, and it names every
            shift rather than hiding them behind a dropdown: choosing a shift is
            the whole action, and a dropdown would make it two clicks and a read.

            It sticks to the bottom because the selection is usually made by
            dragging down a long list, and a bar at the top of a two-hundred-row
            grid is a bar nobody can reach without losing what they selected. */}
        {mayManage && cells.size > 0 && (
          <div className="sticky bottom-0 z-20 border-t border-gold/30 bg-gold/[0.06]
                          backdrop-blur px-4 py-2.5 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold text-txt-primary tabular-nums">
              {cells.size} day{cells.size === 1 ? "" : "s"} selected
            </span>
            <span className="text-[11.5px] text-txt-muted">set to</span>

            {shifts.map((sh) => (
              <Button key={sh.code} size="sm" disabled={cellBusy}
                      onClick={() => void applyToCells(sh.code)}
                      title={`${sh.name} · ${sh.start_time?.slice(0, 5)}–${sh.end_time?.slice(0, 5)}`}>
                {/* The same colour the square will take, so the button and the
                    result are recognisably the same thing. */}
                <span className={`w-2 h-2 rounded-full
                                  ${SHIFT_LOOK[shiftBand(sh.code, sh.start_time)].dot}`} />
                {shortShift(sh.code)}
                <span className="text-[10.5px] font-normal text-txt-muted ml-0.5">
                  {sh.start_time?.slice(0, 5)}
                </span>
              </Button>
            ))}

            {shifts.length === 0 && (
              <span className="inline-flex items-center gap-2 text-[12px] text-rose">
                {shiftsError ?? "No shifts are defined in the shift calendar."}
                <Button size="sm" variant="ghost" onClick={() => void loadShifts()}>
                  Try again
                </Button>
              </span>
            )}

            <Button size="sm" disabled={cellBusy} onClick={() => void applyToCells(null)}
                    title="A rest day given on purpose — it stays on the record">
              Rest
            </Button>

            {/* Named for what it does to the square, not for the mechanism
                underneath. "Back to pattern" is meaningless on a mine where
                nobody is on a pattern — which is this one, all 204 of them —
                and somebody looking for the way to make a day blank had no
                reason to think this was it. */}
            <Button size="sm" variant="ghost" disabled={cellBusy}
                    onClick={() => void applyToCells("CLEAR")}
                    title="Take the decision off these days. They go back to the person's pattern, or blank if they are not on one.">
              Make blank
            </Button>

            <Button size="sm" variant="ghost" disabled={cellBusy}
                    onClick={() => { setCells(new Set()); setLastCell(null); }}
                    className="ml-auto"
                    title="Let go of these squares without changing anything">
              Deselect
            </Button>
            {cellBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-txt-light" />}
          </div>
        )}

        {loading ? (
          <div className="px-5 py-16 text-center text-[13px] text-txt-muted">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Working out the roster…
          </div>
        ) : people.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-txt-muted">
            {onlyGaps ? "Everybody on the register is on a roster."
                      : "No operators match that."}
          </div>
        ) : (
          <div className="overflow-auto max-h-[62vh]">
            <table className="w-full border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-white border-b border-r border-slate-200
                                 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide
                                 text-txt-light min-w-[220px]">
                    <span className="flex items-center gap-2">
                      {mayManage && (
                        <input type="checkbox" checked={allShown}
                               ref={(el) => { if (el) el.indeterminate = !allShown && someShown; }}
                               onChange={toggleAllShown}
                               disabled={people.length === 0}
                               title={allShown ? "Clear these" : `Select all ${people.length} shown`}
                               className="w-3.5 h-3.5 rounded border-slate-300 cursor-pointer" />
                      )}
                      <span>Operator</span>
                      <span className="ml-auto normal-case tracking-normal font-semibold
                                       text-[10.5px] text-txt-light">
                        {people.length === (board?.people.length ?? 0)
                          ? `${people.length}`
                          : `${people.length} of ${board?.people.length ?? 0}`}
                        {picked.size > 0 && (
                          <span className="text-gold-dark"> · {picked.size} picked</span>
                        )}
                      </span>
                    </span>
                  </th>
                  {dates.map((iso) => {
                    const { weekday, day, weekend } = dayLabel(iso);
                    const hol = board?.holidays?.[iso];
                    return (
                      <th key={iso} title={hol?.name}
                          className={`sticky top-0 z-20 border-b border-slate-200 px-1 py-2
                            text-center text-[10px] font-semibold min-w-[40px]
                            ${hol ? "bg-violet/10 text-violet"
                                  : weekend ? "bg-slate-50 text-txt-light" : "bg-white text-txt-muted"}`}>
                        <span className="block">{weekday}</span>
                        <span className="block text-[13px] text-navy font-bold">{day}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.operator_id} className="group">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50
                                   border-b border-r border-slate-100 px-3 py-1.5">
                      <label className="flex items-center gap-2 cursor-pointer">
                        {mayManage && (
                          <input type="checkbox" checked={picked.has(p.operator_id)}
                                 onChange={() => toggle(p.operator_id)}
                                 className="w-3.5 h-3.5 rounded border-slate-300" />
                        )}
                        <span className="min-w-0">
                          <span role="button" tabIndex={0}
                            onClick={(e) => { e.preventDefault(); onOpenOperator?.(p.operator_id); }}
                            onKeyDown={(e) => { if (e.key === "Enter") onOpenOperator?.(p.operator_id); }}
                            className="block text-[12.5px] font-semibold text-navy truncate
                                       hover:text-gold hover:underline cursor-pointer">
                            {p.display_name}
                          </span>
                          {/* The job first, always. It used to appear only for
                              somebody already on a pattern, so on a mine where
                              nobody is — this one — the column was two hundred
                              names and no way to tell a driver from a fitter.
                              Which crew you are rostering is the first thing
                              you need and the last thing it was showing. */}
                          <span className="block text-[10.5px] text-txt-light truncate">
                            <span className="text-txt-muted">
                              {p.trade || p.designation || "job not set"}
                            </span>
                            {" · "}
                            {p.pattern_code
                              ? p.pattern_code
                              : <span className="text-rose font-semibold">not on a roster</span>}
                          </span>
                        </span>
                      </label>
                    </td>
                    {dates.map((iso) => {
                      const cell = p.days?.[iso];
                      // A working day is coloured by which shift it is; every
                      // other kind of day keeps the colour of its state, because
                      // "resting" and "on leave" are not shifts and drawing them
                      // as one would undo the distinction the palette exists for.
                      const look = cell?.state === "ON"
                        ? SHIFT_LOOK[shiftBand(cell.shift, startOf[cell.shift ?? ""])]
                        : cell?.state ? DAY_STATE[cell.state] : UNROSTERED;
                      const on = cells.has(cellKey(p.operator_id, iso));
                      // Leave and closures are not this screen's to overrule,
                      // so those squares are not offered for selection at all.
                      const fixed = cell?.state === "LEAVE" || cell?.state === "HOLIDAY";
                      // "G" on the square, "GENERAL shift" on the hover.
                      const label = (cell?.label || UNROSTERED.label)
                        + (cell?.by_hand ? " · set by hand" : "")
                        + (cell?.reason ? ` — ${cell.reason}` : "");
                      return (
                        <td key={iso} className="border-b border-slate-100 px-0.5 py-1 text-center">
                          <button type="button" title={label}
                            disabled={!mayManage || fixed}
                            onMouseDown={(e) => {
                              if (!mayManage || fixed) return;
                              e.preventDefault();
                              setDragging(true);
                              touchCell(p.operator_id, iso, e.shiftKey);
                            }}
                            onMouseEnter={() => { if (!fixed) dragOver(p.operator_id, iso); }}
                            className={`relative inline-flex items-center justify-center w-7 h-6
                                        rounded border text-[10.5px] font-bold transition-shadow
                                        ${look.cell}
                                        ${mayManage && !fixed ? "cursor-pointer hover:ring-1 hover:ring-gold/60" : ""}
                                        ${on ? "ring-2 ring-gold ring-offset-1" : ""}`}>
                            {cell?.state === "ON" ? shortShift(cell.shift)
                              : cell?.state === "LEAVE" ? (cell.half_day ? "½" : "L")
                              : cell?.state === "HOLIDAY" ? "H"
                              : cell?.state === "REST" ? "·" : ""}
                            {/* A day somebody typed, as against a day a pattern
                                produced. Without this the two are the same
                                square and the roster cannot be read back. */}
                            {cell?.by_hand && (
                              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5
                                               rounded-full bg-gold" />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Wide, and two columns on a laptop. Stacked at 560px this was a column
          eight blocks tall — who it covers, two paragraphs, a picker, a date, a
          cycle preview and four starter patterns — so the button that does the
          thing sat below the fold and the starters could only be reached by
          scrolling inside a modal. The decision is: these people, this pattern,
          from this date. It fits side by side. */}
      <Dialog open={assigning} tone="info" title={`Put ${picked.size} on a pattern`}
        confirmLabel="Roster them" busy={busy} width={980}
        onConfirm={() => void assign()} onCancel={() => setAssigning(false)}>
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {/* Who it affects */}
          <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-[11px] text-txt-light mb-1.5">Who this covers</p>
            <div className="flex flex-wrap gap-1.5">
              {pickedSpread.employer.map(([k, n]) => (
                <Chip key={`e-${k}`} tone="violet" dot={false}>{k} · {n}</Chip>
              ))}
              {pickedSpread.trade.slice(0, 6).map(([k, n]) => (
                <Chip key={`t-${k}`} tone="slate" dot={false}>{k} · {n}</Chip>
              ))}
              {pickedSpread.trade.length > 6 && (
                <Chip tone="slate" dot={false}>
                  +{pickedSpread.trade.length - 6} more trades
                </Chip>
              )}
            </div>
          </div>
          {hiddenPicked.length > 0 && (
            <div className="rounded-lg border border-amber/30 bg-amber-bg/40 px-3 py-2">
              <p className="text-[12px] text-txt-primary">
                <strong>{hiddenPicked.length}</strong> of these are hidden by the
                filters you have set — they were picked earlier and are still
                selected. They will be rostered too.
              </p>
            </div>
          )}
            <p className="text-[12px] text-txt-muted">
              Anybody already on a pattern is moved off it the day before this
              one starts, rather than having their old roster erased — last
              month still has to be explainable.
            </p>
          </div>

          {/* What is being decided */}
          <div className="space-y-3">
          <Field label="Pattern" required>
            <select className={inputClass} value={form.pattern_id}
                    onChange={(e) => setForm({ ...form, pattern_id: e.target.value })}>
              <option value="">Choose a pattern</option>
              {patterns.filter((p) => p.is_active).map((p) => (
                <option key={p.pattern_id} value={p.pattern_id}>
                  {p.code} — {p.name} ({p.cycle_days}-day cycle)
                </option>
              ))}
            </select>
          </Field>
          <Field label="From" required
                 hint="They start at the first day of the cycle on this date.">
            <DateField className={inputClass} value={form.effective_from} onChange={(v) => setForm({ ...form, effective_from: v })} />
          </Field>
          {form.pattern_id && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-[11px] text-txt-light mb-1.5">The cycle they will follow</p>
              <div className="flex flex-wrap gap-1">
                {(patterns.find((p) => String(p.pattern_id) === form.pattern_id)?.slots ?? [])
                  .map((slot, i) => (
                    <span key={i} className={`w-7 h-6 rounded border text-[10.5px] font-bold
                      inline-flex items-center justify-center
                      ${slot === "REST" ? DAY_STATE.REST.cell : DAY_STATE.ON.cell}`}>
                      {slot === "REST" ? "·" : shortShift(slot)}
                    </span>
                  ))}
              </div>
            </div>
          )}
          </div>

          {patterns.length === 0 && (
            <div className="lg:col-span-2 rounded-lg border border-amber/30 bg-amber-bg/40 px-3 py-3">
              <p className="text-[12.5px] text-txt-primary font-semibold mb-1">
                No patterns exist yet, which is why the list above is empty.
              </p>
              <p className="text-[11.5px] text-txt-muted mb-3">
                A pattern says which days somebody works and which they rest.
                Here is how mines like this one usually work — take one and the
                list fills in.
              </p>
              {mayManage && (
                /* Creating a pattern here is not the errand — rostering these
                   people is, and the pattern is only missing because nobody
                   had defined one yet. So the one just created is chosen, and
                   the dialog carries on where it left off rather than handing
                   back an empty picker and a list that has changed behind it. */
                <StarterPatterns compact onAdopted={(created) => {
                  void (async () => {
                    const fresh = await load();
                    const first = (fresh ?? []).find((p) => created.includes(p.code));
                    if (first) setForm((was) => ({ ...was, pattern_id: String(first.pattern_id) }));
                  })();
                }} />
              )}
            </div>
          )}
        </div>
      </Dialog>

      <Dialog open={importing} tone="warning"
        title={`Import ${preview?.changes.length ?? 0} roster change(s)`}
        confirmLabel="Apply these changes" busy={busy}
        onConfirm={() => void applyImport()}
        onCancel={() => { setImporting(false); setPreview(null); setPendingFile(null); }}>
        {preview && (
          <div className="space-y-3">
            <p className="text-[12px] text-txt-muted">
              Read from <strong>{preview.sheet}</strong> in {preview.file}. Nothing
              has been written yet. Rows are matched on the operator reference,
              never the name — two people called Sahoo is not a hypothetical.
            </p>

            <div className="flex flex-wrap gap-2">
              <Chip tone={preview.changes.length ? "emerald" : "slate"} dot={false}>
                {preview.changes.length} would change
              </Chip>
              <Chip tone={preview.problems.length ? "rose" : "slate"} dot={false}>
                {preview.problems.length} rejected
              </Chip>
              <Chip tone="slate" dot={false}>{preview.unchanged} already right</Chip>
            </div>

            {preview.changes.length > 0 && (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100
                              max-h-48 overflow-auto">
                {preview.changes.map((c) => (
                  <div key={c.row} className="px-3 py-1.5 flex items-center gap-2 text-[12px]">
                    <Check className="w-3.5 h-3.5 text-emerald shrink-0" />
                    <span className="font-semibold text-navy">{c.display_name}</span>
                    <span className="text-txt-light">
                      {c.from_pattern || "not rostered"} → {c.to_pattern}
                    </span>
                    <span className="ml-auto text-[11px] text-txt-light">
                      from {c.effective_from}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {preview.problems.length > 0 && (
              <div className="rounded-lg border border-rose/30 bg-rose-bg/40 divide-y
                              divide-rose/10 max-h-40 overflow-auto">
                {preview.problems.map((p) => (
                  <div key={p.row} className="px-3 py-1.5 flex items-start gap-2 text-[12px]">
                    <TriangleAlert className="w-3.5 h-3.5 text-rose shrink-0 mt-0.5" />
                    <span className="text-txt-light">row {p.row}</span>
                    <span className="font-mono text-[11px] text-navy">{p.ref}</span>
                    <span className="text-rose">{p.why}</span>
                  </div>
                ))}
                <p className="px-3 py-1.5 text-[11px] text-txt-muted">
                  Rejected rows are skipped. The rest still apply.
                </p>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
