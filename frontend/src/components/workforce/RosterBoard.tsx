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
 * Nothing here is editable in place. Rostering is a decision about a crew and a
 * date, not about one square, and a grid that lets somebody drag a single cell
 * invites a roster made of exceptions that nothing can explain afterwards.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange, ChevronLeft, ChevronRight, Loader2, Users, UserPlus, Search,
  CalendarOff, Plane, Sun,
} from "lucide-react";
import api from "@/lib/api";
import {
  Button, Card, CardHeader, Field, inputClass, Tile,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import {
  DAY_STATE, UNROSTERED, dayLabel, isoDay, addDays, span, prettyDate,
  type DayCell,
} from "./state";

interface Person {
  operator_id: number; operator_ref: string | null; display_name: string;
  designation: string | null; department: string | null;
  pattern_id: number | null; pattern_code: string | null; pattern_name: string | null;
  days: Record<string, DayCell>;
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

const WINDOWS = [
  { days: 13, label: "Fortnight" },
  { days: 29, label: "Month" },
  { days: 6, label: "Week" },
];

export default function RosterBoard({ mayManage, onChanged }: {
  mayManage: boolean; onChanged?: () => void;
}) {
  const [start, setStart] = useState(() => isoDay(new Date()));
  const [length, setLength] = useState(13);
  const [board, setBoard] = useState<Board | null>(null);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);

  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ pattern_id: "", effective_from: isoDay(new Date()) });

  const end = useMemo(() => addDays(start, length), [start, length]);
  const dates = useMemo(() => span(start, end), [start, end]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, p] = await Promise.all([
        api.get("/workforce/board", { params: { from_date: start, to_date: end } }),
        api.get("/workforce/patterns"),
      ]);
      setBoard(b.data);
      setPatterns(p.data ?? []);
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The roster could not be loaded.");
    } finally { setLoading(false); }
  }, [start, end]);

  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (board?.people ?? []).filter((p) => {
      if (onlyGaps && p.pattern_id) return false;
      if (!term) return true;
      return [p.display_name, p.operator_ref, p.designation, p.pattern_code]
        .some((v) => String(v ?? "").toLowerCase().includes(term));
    });
  }, [board, query, onlyGaps]);

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
                <input className={`${inputClass} pl-8 w-48`} placeholder="Find somebody"
                       value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
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

        <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-3">
          {Object.entries(DAY_STATE).map(([key, look]) => (
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
            A letter is the shift they work that day.
          </span>
        </div>

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
                    Operator
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
                          <span className="block text-[12.5px] font-semibold text-navy truncate">
                            {p.display_name}
                          </span>
                          <span className="block text-[10.5px] text-txt-light truncate">
                            {p.pattern_code
                              ? `${p.pattern_code} · ${p.designation || "role not set"}`
                              : <span className="text-rose font-semibold">not on a roster</span>}
                          </span>
                        </span>
                      </label>
                    </td>
                    {dates.map((iso) => {
                      const cell = p.days?.[iso];
                      const look = cell?.state ? DAY_STATE[cell.state] : UNROSTERED;
                      return (
                        <td key={iso} className="border-b border-slate-100 px-0.5 py-1 text-center">
                          <span title={cell?.label || UNROSTERED.label}
                                className={`inline-flex items-center justify-center w-7 h-6 rounded
                                            border text-[10.5px] font-bold ${look.cell}`}>
                            {cell?.state === "ON" ? cell.shift
                              : cell?.state === "LEAVE" ? (cell.half_day ? "½" : "L")
                              : cell?.state === "HOLIDAY" ? "H"
                              : cell?.state === "REST" ? "·" : ""}
                          </span>
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

      <Dialog open={assigning} tone="info" title={`Put ${picked.size} on a pattern`}
        confirmLabel="Roster them" busy={busy}
        onConfirm={() => void assign()} onCancel={() => setAssigning(false)}>
        <div className="space-y-3">
          <p className="text-[12px] text-txt-muted">
            Anybody already on a pattern is moved off it the day before this one
            starts, rather than having their old roster erased — last month still
            has to be explainable.
          </p>
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
            <input type="date" className={inputClass} value={form.effective_from}
                   onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
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
                      {slot === "REST" ? "·" : slot}
                    </span>
                  ))}
              </div>
            </div>
          )}
          {patterns.length === 0 && (
            <p className="text-[12px] text-amber">
              No patterns have been defined yet. Create one under Patterns first.
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
