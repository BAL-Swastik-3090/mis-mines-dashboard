"use client";
/**
 * Workforce behaviour — the month at a glance, one row per worker.
 *
 * NOT AN ATTENDANCE SHEET, and the difference matters. An attendance sheet
 * says who was present and gets paid; this says what the gate readers
 * recorded. They are not the same document and confusing them is how a reader
 * fault becomes a deduction from somebody's wages.
 *
 * So the cells say what was seen — in and out, one punch only, nothing — and
 * the totals count punch days rather than working days. Where a pattern looks
 * like a person it is shown against the person; where it looks like a machine
 * it is shown against the day, because a column of single punches is a reader
 * that stopped, not forty people who forgot.
 *
 * REST DAYS ARE DERIVED, NOT ASSUMED. Sunday is quiet at Kaliapani — 99 and 59
 * clocked on the two Sundays in this month against about 162 on a weekday —
 * but the platform has no holiday calendar loaded, and assuming the week's
 * shape would be asserting something nobody told it. A day where the whole
 * site is quiet is found by comparing it with the rest of the period, and
 * shaded so that one rest day does not read as two hundred absences.
 */
import React, { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownUp, CalendarDays, ChevronLeft, ChevronRight,
  Download, Search, TrendingDown, X,
} from "lucide-react";
import ColumnFilter, { optionsFrom, matches } from "./ColumnFilter";
import { toDisplay } from "./DateField";
import { Button, Card, CardHeader, Chip, StatBar, type Tone } from "./ui";
import { toCsv, download } from "./spreadsheet";

export interface Row {
  operator_id: number; operator_ref: string | null; name: string; emp_no: string;
  trade: string | null; trade_group: string | null; employer: string | null;
  department: string | null;
  on_date: string; first_in: string | null; last_out: string | null;
  minutes: number | null; punches: number;
  in_gate: string | null; out_gate: string | null;
  state: "COMPLETE" | "IN_ONLY" | "OUT_ONLY" | "NOT_CLOCKED"; running: boolean;
}

/** What a cell says, and what it looks like. Four states, because that is how
 *  many the readers can produce — a fifth for "we asked about a day that has
 *  not happened yet" would be inventing one. */
const CELL: Record<Row["state"], { short: string; cls: string; label: string }> = {
  COMPLETE:    { short: "IO", cls: "bg-emerald-bg text-emerald ring-emerald-ring",
                 label: "in and out" },
  IN_ONLY:     { short: "I",  cls: "bg-amber-bg text-amber ring-amber-ring",
                 label: "in only, no out" },
  OUT_ONLY:    { short: "O",  cls: "bg-violet-bg text-violet ring-violet-ring",
                 label: "out only, no in" },
  NOT_CLOCKED: { short: "–", cls: "bg-rose-bg text-rose/70 ring-rose-ring",
                 label: "no punch" },
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PER_PAGE = 20;

/** Today is half a day. Everyone on shift is still inside and has not punched
 *  out, so it looks like a quiet day with a broken reader — and it is neither.
 *  It is drawn, and left out of anything that compares days with each other. */
const TODAY = new Date().toISOString().slice(0, 10);
const settled = (days: string[]) => days.filter((d) => d < TODAY);

const hhmm = (iso: string | null) => (iso ? iso.slice(11, 16) : "");

export default function ActivityMatrix({ rows, days }: { rows: Row[]; days: string[] }) {
  const [query, setQuery] = useState("");
  const [by, setBy] = useState({ trade: "", employer: "", department: "" });
  const set = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));
  const [order, setOrder] = useState<"name" | "irregular" | "quiet">("name");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Row | null>(null);

  // One row per worker, their days keyed by date.
  const people = useMemo(() => {
    const byWorker = new Map<string, { head: Row; cells: Map<string, Row> }>();
    for (const r of rows) {
      let w = byWorker.get(r.emp_no);
      if (!w) { w = { head: r, cells: new Map() }; byWorker.set(r.emp_no, w); }
      w.cells.set(r.on_date, r);
    }
    return [...byWorker.values()].map(({ head, cells }) => {
      const got = days.map((d) => cells.get(d));
      const count = (s: Row["state"]) => got.filter((c) => c?.state === s).length;
      const single = count("IN_ONLY") + count("OUT_ONLY");
      return {
        ...head, cells,
        active: count("COMPLETE") + single,
        complete: count("COMPLETE"),
        single,
        none: days.length - count("COMPLETE") - single,
      };
    });
  }, [rows, days]);

  // A day the whole site was quiet, found by comparing it with the others
  // rather than by assuming Sunday. Below 55% of the median turning up is a
  // rest day; two hundred people did not each decide to stay at home.
  const quiet = useMemo(() => {
    const done = settled(days);
    const active = done.map((d) =>
      rows.filter((r) => r.on_date === d && r.state !== "NOT_CLOCKED").length);
    const sorted = [...active].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    return new Set(done.filter((_, i) => median > 0 && active[i] < median * 0.55));
  }, [rows, days]);

  // A day where single punches spiked is a reader that stopped, not a hundred
  // people who forgot. Flagged against the day so nobody goes looking for a
  // hundred explanations.
  const readerTrouble = useMemo(() => {
    const done = settled(days);
    const single = done.map((d) =>
      rows.filter((r) => r.on_date === d
        && (r.state === "IN_ONLY" || r.state === "OUT_ONLY")).length);
    const sorted = [...single].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    return new Set(done.filter((_, i) => single[i] >= Math.max(8, median * 4)));
  }, [rows, days]);

  const menus = useMemo(() => ({
    trade: optionsFrom(people, (p) => p.trade, (v) => v, "No trade set"),
    employer: optionsFrom(people, (p) => p.employer, (v) => v, null),
    department: optionsFrom(people, (p) => p.department, (v) => v, "Not posted"),
  }), [people]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = people.filter((p) => {
      if (!matches(p.trade, by.trade)) return false;
      if (!matches(p.employer, by.employer)) return false;
      if (!matches(p.department, by.department)) return false;
      if (!q) return true;
      return [p.name, p.emp_no, p.trade].some((v) => (v ?? "").toLowerCase().includes(q));
    });
    return out.sort((a, b) =>
      order === "irregular" ? b.single - a.single || a.name.localeCompare(b.name)
      : order === "quiet" ? b.none - a.none || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name));
  }, [people, by, query, order]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const shown = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const narrowed = Object.values(by).some(Boolean) || Boolean(query.trim());

  const totals = (s: Row["state"]) => rows.filter((r) => r.state === s).length;
  const workingDays = days.filter((d) => !quiet.has(d)).length;

  const exportMatrix = () => {
    download(toCsv(
      ["Attendance ID", "Worker", "Trade", "Contractor", "Department",
       ...days.map(toDisplay), "Both punches", "Single punch", "No punch"],
      filtered.map((p) => [
        p.emp_no, p.name, p.trade ?? "", p.employer ?? "", p.department ?? "",
        ...days.map((d) => CELL[p.cells.get(d)?.state ?? "NOT_CLOCKED"].short),
        p.complete, p.single, p.none,
      ])),
      `workforce-activity-${days[0]}-to-${days[days.length - 1]}.csv`);
  };

  return (
    <div className="space-y-4">
      <StatBar items={[
        { label: "Workers", value: people.length, tone: "sky", icon: CalendarDays,
          hint: `${days.length} days, ${workingDays} of them busy`
                + (days.includes(TODAY) ? " · today still running" : "") },
        { label: "Both punches", value: totals("COMPLETE"), tone: "emerald",
          icon: ArrowDownUp, hint: "a clean day at the gate" },
        { label: "Single punch", value: totals("IN_ONLY") + totals("OUT_ONLY"),
          tone: totals("IN_ONLY") + totals("OUT_ONLY") ? "amber" : "emerald",
          icon: AlertTriangle, hint: "in without out, or out without in" },
        { label: "No punch", value: totals("NOT_CLOCKED"), tone: "slate",
          icon: X, hint: "rest days included — not absence" },
        { label: "Reader trouble", value: readerTrouble.size,
          tone: readerTrouble.size ? "rose" : "emerald", icon: TrendingDown,
          hint: readerTrouble.size ? "days when single punches spiked" : "no bad days" },
        { label: "Quiet days", value: quiet.size, tone: "violet", icon: CalendarDays,
          hint: "the whole site, not individuals" },
      ]} />

      {readerTrouble.size > 0 && (
        <Card tone="rose">
          <div className="px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-txt-secondary">
              Single punches spiked on{" "}
              <strong className="text-rose">
                {[...readerTrouble].map(toDisplay).join(", ")}
              </strong>. When dozens of people have an in without an out on the
              same day, that is a reader that stopped rather than dozens of
              people who forgot — worth checking the gate before anybody is
              asked to explain themselves.
            </p>
          </div>
        </Card>
      )}

      <Card tone="sky">
        <CardHeader title={`Workforce activity · ${filtered.length}`}
          icon={ArrowDownUp} tone="sky"
          subtitle="What the readers recorded, worker by worker. This is punch behaviour, not an attendance sheet: a missing punch is a gap in the record, and a rest day is not an absence."
          actions={
            <>
              <select value={order} onChange={(e) => { setOrder(e.target.value as typeof order); setPage(0); }}
                className="bg-bg-base border border-border rounded-lg px-2.5 py-1.5
                           text-[12px] font-semibold text-txt-secondary
                           focus:outline-none focus:border-gold">
                <option value="name">By name</option>
                <option value="irregular">Most single punches first</option>
                <option value="quiet">Most days with no punch first</option>
              </select>
              <Button size="sm" variant="secondary" onClick={exportMatrix}
                disabled={filtered.length === 0}>
                <Download className="w-3.5 h-3.5" /> Export
              </Button>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
                <input id="am-search" value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                  placeholder="Name, ID, trade…"
                  className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5
                             text-[12px] focus:outline-none focus:border-gold w-[170px]" />
              </div>
            </>
          } />

        {/* The key, next to the thing it explains. */}
        <div className="px-4 py-2 border-b border-border-light bg-bg-light/60
                        flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="flex flex-wrap items-center gap-2">
            {(Object.keys(CELL) as Row["state"][]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`w-6 h-6 rounded ring-1 flex items-center justify-center
                                  text-[10.5px] font-bold ${CELL[s].cls}`}>
                  {CELL[s].short}
                </span>
                <span className="text-[11px] text-txt-muted">{CELL[s].label}</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="w-6 h-6 rounded ring-1 ring-border bg-slate-100" />
              <span className="text-[11px] text-txt-muted">site quiet that day</span>
            </span>
          </span>
          <span className="flex-1" />
          <span className="flex flex-wrap items-center gap-2">
            <ColumnFilter variant="control" label="Trade" allLabel="Any trade"
              value={by.trade} options={menus.trade} onChange={(v) => { set("trade")(v); setPage(0); }} />
            {menus.department.length > 1 && (
              <ColumnFilter variant="control" label="Department" allLabel="Any department"
                value={by.department} options={menus.department}
                onChange={(v) => { set("department")(v); setPage(0); }} />
            )}
            {narrowed && (
              <button type="button"
                onClick={() => { setBy({ trade: "", employer: "", department: "" }); setQuery(""); }}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold
                           text-gold-dark hover:underline">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="border-collapse">
            <thead>
              <tr>
                {/* The identity columns stay put while the month scrolls. */}
                <th className="sticky left-0 z-20 bg-bg-light text-left text-[11.5px]
                               font-semibold text-txt-secondary px-3 py-2
                               border-b border-r border-border w-[190px]">
                  Worker
                </th>
                <th className="sticky left-[190px] z-20 bg-bg-light text-left text-[11.5px]
                               font-semibold text-txt-secondary px-2 py-2
                               border-b border-r border-border w-[120px]">
                  Trade
                </th>
                {days.map((d) => {
                  const dt = new Date(d);
                  return (
                    <th key={d}
                      title={d === TODAY
                        ? `${toDisplay(d)} — today, still running`
                        : `${DOW[dt.getDay()]} ${toDisplay(d)}`}
                      className={`px-0 py-1.5 border-b border-border text-center w-[30px]
                                  ${d === TODAY ? "bg-gold/10"
                                    : quiet.has(d) ? "bg-slate-100" : "bg-bg-light"}
                                  ${readerTrouble.has(d) ? "border-b-2 border-b-rose" : ""}`}>
                      <span className="block text-[11px] font-bold text-navy tabular-nums">
                        {d.slice(8, 10)}
                      </span>
                      <span className="block text-[9px] text-txt-light">
                        {DOW[dt.getDay()].slice(0, 2)}
                      </span>
                    </th>
                  );
                })}
                {["Both", "Single", "None"].map((h) => (
                  <th key={h} className="bg-bg-light text-[11px] font-semibold
                                         text-txt-secondary px-2 py-2 border-b border-l
                                         border-border text-center w-[56px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.emp_no} className="hover:bg-bg-light/60">
                  <td className="sticky left-0 z-10 bg-bg-base px-3 py-1.5
                                 border-b border-r border-border-light">
                    <span className="block text-[12.5px] font-semibold text-navy truncate">
                      {p.name}
                    </span>
                    <span className="block text-[10.5px] font-mono text-violet font-bold">
                      {p.emp_no}
                    </span>
                  </td>
                  <td className="sticky left-[190px] z-10 bg-bg-base px-2 py-1.5
                                 border-b border-r border-border-light">
                    <span className="text-[11.5px] text-txt-muted truncate block">
                      {p.trade ?? "—"}
                    </span>
                  </td>
                  {days.map((d) => {
                    const c = p.cells.get(d);
                    const state = c?.state ?? "NOT_CLOCKED";
                    const look = CELL[state];
                    const isQuiet = quiet.has(d);
                    return (
                      <td key={d}
                        className={`border-b border-border-light p-[2px] text-center
                                    ${isQuiet ? "bg-slate-100/70" : ""}`}>
                        <button type="button"
                          onClick={() => c && c.punches > 0 && setOpen(c)}
                          title={`${toDisplay(d)} — ${look.label}`
                            + (c?.first_in ? `\nin ${hhmm(c.first_in)}` : "")
                            + (c?.last_out ? `\nout ${hhmm(c.last_out)}` : "")
                            + (c?.in_gate ? `\n${c.in_gate}` : "")}
                          className={`w-[26px] h-[24px] rounded ring-1 text-[10px] font-bold
                                      transition-transform hover:scale-110
                                      ${state === "NOT_CLOCKED" && isQuiet
                                        ? "bg-transparent ring-transparent text-txt-light/50"
                                        : look.cls}
                                      ${c && c.punches > 0 ? "cursor-pointer" : "cursor-default"}`}>
                          {look.short}
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-border-light text-center
                                 text-[12px] font-bold text-emerald tabular-nums">
                    {p.complete}
                  </td>
                  <td className={`border-b border-border-light text-center text-[12px]
                                  font-bold tabular-nums
                                  ${p.single ? "text-amber" : "text-txt-light"}`}>
                    {p.single}
                  </td>
                  <td className="border-b border-border-light text-center text-[12px]
                                 text-txt-muted tabular-nums">
                    {p.none}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-bg-light">
                <td className="sticky left-0 z-10 bg-bg-light px-3 py-2 border-t border-r
                               border-border text-[11.5px] font-semibold text-txt-secondary">
                  Clocked that day
                </td>
                <td className="sticky left-[190px] z-10 bg-bg-light border-t border-r border-border" />
                {days.map((d) => {
                  const n = rows.filter((r) => r.on_date === d && r.state !== "NOT_CLOCKED").length;
                  return (
                    <td key={d} className={`border-t border-border text-center text-[11px]
                                            font-bold tabular-nums py-1.5
                                            ${quiet.has(d) ? "bg-slate-100 text-txt-light"
                                                           : "text-navy"}`}>
                      {n}
                    </td>
                  );
                })}
                <td colSpan={3} className="border-t border-l border-border" />
              </tr>
            </tfoot>
          </table>
        </div>

        {pages > 1 && (
          <div className="px-4 py-2.5 border-t border-border-light flex items-center
                          justify-between gap-2">
            <span className="text-[11.5px] text-txt-muted">
              {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, filtered.length)} of{" "}
              {filtered.length}
            </span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="secondary" disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[11.5px] text-txt-muted px-1 tabular-nums">
                {page + 1} / {pages}
              </span>
              <Button size="sm" variant="secondary" disabled={page >= pages - 1}
                onClick={() => setPage((n) => n + 1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </span>
          </div>
        )}
      </Card>

      {/* One cell, opened. */}
      {open && (
        <Card tone="violet">
          <CardHeader title={`${open.name} · ${toDisplay(open.on_date)}`}
            icon={CalendarDays} tone="violet"
            subtitle={CELL[open.state].label}
            actions={
              <Button size="sm" variant="secondary" onClick={() => setOpen(null)}>
                <X className="w-3.5 h-3.5" /> Close
              </Button>
            } />
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            {([["First in", hhmm(open.first_in), open.in_gate],
               ["Last out", hhmm(open.last_out), open.out_gate],
               ["Punches", String(open.punches), null],
               ["Attendance ID", open.emp_no, open.trade]] as const).map(([k, v, sub]) => (
              <span key={k} className="block">
                <span className="block text-[10.5px] font-bold uppercase tracking-[.12em]
                                 text-txt-light">{k}</span>
                <span className="block text-[15px] font-bold text-navy tabular-nums mt-0.5">
                  {v || "—"}
                </span>
                {sub && <span className="block text-[11px] text-txt-muted mt-0.5">{sub}</span>}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
