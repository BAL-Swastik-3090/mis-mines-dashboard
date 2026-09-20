"use client";
/**
 * The attendance master table — who the gate readers saw, day by day.
 *
 * READ-ONLY, AND NOTHING IS STORED. Every row is read from SmartFace when it
 * is asked for and joined to the manpower register in memory. The mine has not
 * yet decided how much punch history MineHub should hold, whether a missing
 * punch means absent, or how a manual correction gets approved — and a table
 * built before those are settled bakes the wrong answer into a schema.
 *
 * So this is the master table and only the master table. It is also what makes
 * those decisions easier to take, because it puts the real data in front of
 * the people taking them.
 *
 * SILENCE IS NOT ABSENCE. A worker with no punch is shown as "not clocked",
 * not as absent: the mine has gates people walk through without punching, and
 * a register that asserts absence it cannot evidence is a register that should
 * not be anywhere near a contractor's bill.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock, Download, Grid3x3, Loader2,
  LogIn, LogOut, Rows3, Search, Users, X,
} from "lucide-react";
import api from "@/lib/api";
import ColumnFilter, { optionsFrom, matches, SortHeader, type SortDir } from "./ColumnFilter";
import ActivityMatrix from "./ActivityMatrix";
import DateField, { toDisplay } from "./DateField";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, StatBar, Td, Th, type Tone,
} from "./ui";
import { toCsv, download } from "./spreadsheet";

interface Row {
  operator_id: number; operator_ref: string | null; name: string; emp_no: string;
  trade: string | null; trade_group: string | null; employer: string | null;
  department: string | null; designation: string | null;
  on_date: string; first_in: string | null; last_out: string | null;
  minutes: number | null; punches: number; devices: number;
  in_gate: string | null; out_gate: string | null;
  state: "COMPLETE" | "IN_ONLY" | "OUT_ONLY" | "NOT_CLOCKED"; running: boolean;
}
interface Punch { at: string; direction: "IN" | "OUT"; device: string }

const STATE: Record<Row["state"], { label: string; tone: Tone }> = {
  COMPLETE: { label: "in and out", tone: "emerald" },
  IN_ONLY: { label: "in, no out", tone: "amber" },
  OUT_ONLY: { label: "out, no in", tone: "rose" },
  NOT_CLOCKED: { label: "not clocked", tone: "slate" },
};

/** 05:15:16 on an ISO timestamp, in the 24-hour clock a gate log is read in. */
const hhmm = (iso: string | null) => (iso ? iso.slice(11, 16) : "");

/** 456 minutes as 7h 36m. Deliberately not "hours worked": it is the gap
 *  between the first punch in and the last punch out, break included, because
 *  the readers record two punches a day for most people and subtracting a
 *  break nobody recorded would be inventing a number. */
function span(mins: number | null): string {
  if (mins === null || mins === undefined) return "";
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

const today = () => new Date().toISOString().slice(0, 10);

type SortKey = "date" | "emp" | "name" | "trade" | "in" | "out" | "span" | "state";
const SORT_WORDS: Record<SortKey, [string, string]> = {
  date: ["Oldest first", "Newest first"],
  emp: ["Lowest first", "Highest first"],
  name: ["A to Z", "Z to A"],
  trade: ["A to Z", "Z to A"],
  in: ["Earliest first", "Latest first"],
  out: ["Earliest first", "Latest first"],
  span: ["Shortest first", "Longest first"],
  state: ["In and out first", "Not clocked first"],
};

export default function AttendancePanel() {
  // Two readings of the same data. The day log answers "what happened on this
  // date"; the matrix answers "what does this person's month look like", which
  // is a different question and a different shape.
  const [view, setView] = useState<"log" | "matrix">("log");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [by, setBy] = useState({ trade: "", group: "", employer: "", department: "", state: "" });
  const set = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(
    { key: "name", dir: "asc" });
  const sortBy = (key: SortKey) => (dir: SortDir) => setSort({ key, dir });

  // Which day row is expanded, and the punches behind it. Fetched per row
  // rather than up front: a month's table is six thousand rows and nobody
  // wants the individual punches for all of them.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [punchBusy, setPunchBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNote(null);
    try {
      const r = await api.get("/attendance/register", {
        params: { day_from: from, day_to: to },
      });
      setRows(r.data?.rows ?? []);
      setDays(r.data?.days ?? []);
      if (r.data?.note) setNote(r.data.note);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not read the attendance readers.");
      setRows([]);
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const openPunches = async (r: Row) => {
    const key = `${r.emp_no}|${r.on_date}`;
    if (openRow === key) { setOpenRow(null); return; }
    setOpenRow(key); setPunches([]); setPunchBusy(true);
    try {
      const res = await api.get("/attendance/punches",
        { params: { day: r.on_date, emp_no: r.emp_no } });
      setPunches(res.data ?? []);
    } catch { setPunches([]); } finally { setPunchBusy(false); }
  };

  const menus = useMemo(() => ({
    trade: optionsFrom(rows, (r) => r.trade, (v) => v, "No trade set"),
    group: optionsFrom(rows, (r) => r.trade_group, (v) => v, null),
    employer: optionsFrom(rows, (r) => r.employer, (v) => v, "Not recorded"),
    department: optionsFrom(rows, (r) => r.department, (v) => v, "Not posted"),
    state: (Object.keys(STATE) as Row["state"][]).map((s) => ({
      value: s, label: STATE[s].label,
      count: rows.filter((r) => r.state === s).length,
    })).filter((o) => o.count > 0),
  }), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matches(r.trade, by.trade)) return false;
      if (!matches(r.trade_group, by.group)) return false;
      if (!matches(r.employer, by.employer)) return false;
      if (!matches(r.department, by.department)) return false;
      if (by.state && r.state !== by.state) return false;
      if (!q) return true;
      return [r.name, r.emp_no, r.operator_ref, r.trade]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, by, query]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const rank: Record<Row["state"], number> =
      { COMPLETE: 0, IN_ONLY: 1, OUT_ONLY: 2, NOT_CLOCKED: 3 };
    const keyOf = (r: Row): string | number => {
      switch (sort.key) {
        case "date":  return r.on_date;
        case "emp":   return Number(r.emp_no) || Number.MAX_SAFE_INTEGER;
        case "name":  return r.name.toLowerCase();
        case "trade": return (r.trade ?? "").toLowerCase();
        // A missing punch sorts last whichever way the column points: it is a
        // gap in the record, not the earliest time of day.
        case "in":    return r.first_in ?? "￿";
        case "out":   return r.last_out ?? "￿";
        case "span":  return r.minutes ?? -1;
        case "state": return rank[r.state];
      }
    };
    return [...filtered].sort((x, y) => {
      const a = keyOf(x), b = keyOf(y);
      if (a === b) return x.on_date.localeCompare(y.on_date)
                       || x.name.localeCompare(y.name);
      const cmp = typeof a === "number" && typeof b === "number"
        ? a - b : String(a).localeCompare(String(b));
      return cmp * dir;
    });
  }, [filtered, sort]);

  const narrowed = Object.values(by).some(Boolean) || Boolean(query.trim());
  const count = (s: Row["state"]) => rows.filter((r) => r.state === s).length;
  const withSpan = rows.filter((r) => r.minutes !== null);
  const avgSpan = withSpan.length
    ? Math.round(withSpan.reduce((n, r) => n + (r.minutes ?? 0), 0) / withSpan.length)
    : null;

  const exportRows = () => {
    download(toCsv(
      ["Date", "Attendance ID", "Worker", "Reference", "Trade", "Group",
       "Contractor", "Department", "First in", "In gate", "Last out", "Out gate",
       "Span", "Punches", "Readers", "State"],
      sorted.map((r) => [
        toDisplay(r.on_date), r.emp_no, r.name, r.operator_ref ?? "",
        r.trade ?? "", r.trade_group ?? "", r.employer ?? "", r.department ?? "",
        hhmm(r.first_in), r.in_gate ?? "", hhmm(r.last_out), r.out_gate ?? "",
        span(r.minutes), r.punches, r.devices, STATE[r.state].label,
      ])),
      `attendance-${from}${from === to ? "" : `-to-${to}`}.csv`);
  };

  const jump = (by_: number) => {
    const shift = (d: string) => {
      const x = new Date(d); x.setDate(x.getDate() + by_);
      return x.toISOString().slice(0, 10);
    };
    setFrom(shift(from)); setTo(shift(to));
  };
  const spanDays = days.length || 1;

  return (
    <div className="space-y-4">
      {/* The range, and the shortcuts people actually use. */}
      <Card tone="sky">
        <div className="px-4 py-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1">From</span>
            <DateField id="at-from" value={from} onChange={(v) => { if (v) setFrom(v); }}
              max={today()}
              className="w-[150px] bg-bg-base border border-border rounded-lg" />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1">To</span>
            <DateField id="at-to" value={to} onChange={(v) => { if (v) setTo(v); }}
              min={from} max={today()}
              className="w-[150px] bg-bg-base border border-border rounded-lg" />
          </label>

          <span className="flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => jump(-spanDays)}
              title="The same length of time, just before this">&larr;</Button>
            <Button size="sm" variant="secondary" onClick={() => jump(spanDays)}
              disabled={to >= today()}>&rarr;</Button>
          </span>

          <span className="flex flex-wrap items-center gap-1.5">
            {([["Today", 0], ["Yesterday", 1], ["Last 7 days", 6], ["Last 30 days", 29]] as const)
              .map(([label, back]) => (
              <button key={label} type="button"
                onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() - back);
                  const iso = d.toISOString().slice(0, 10);
                  if (label === "Yesterday") { setFrom(iso); setTo(iso); }
                  else if (back === 0) { setFrom(iso); setTo(iso); }
                  else { setFrom(iso); setTo(today()); }
                }}
                className="rounded-lg border border-border bg-bg-base px-2.5 py-1.5
                           text-[11.5px] font-semibold text-txt-secondary
                           hover:border-gold hover:text-navy transition-colors">
                {label}
              </button>
            ))}
          </span>

          <span className="flex-1" />
          <span className="text-[11.5px] text-txt-muted">
            {spanDays === 1 ? toDisplay(from) : `${toDisplay(from)} to ${toDisplay(to)} · ${spanDays} days`}
          </span>

          <span className="inline-flex rounded-lg border border-border bg-bg-light p-0.5">
            {([["log", Rows3, "One row per worker per day"],
               ["matrix", Grid3x3, "One row per worker, one column per day"]] as const)
              .map(([id, Icon, why]) => (
              <button key={id} type="button" onClick={() => setView(id)}
                title={why} aria-pressed={view === id}
                className={`inline-flex items-center justify-center rounded-[6px] px-2 py-1
                            transition-colors ${view === id
                              ? "bg-bg-base text-navy shadow-sm ring-1 ring-border-light"
                              : "text-txt-light hover:text-navy"}`}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </span>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}
      {note && <Alert tone="warning">{note}</Alert>}

      {loading ? (
        <div className="flex flex-col items-center gap-2 py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gold" />
          <p className="text-[12px] text-txt-light">
            Reading the gate readers{spanDays > 1 ? ` for ${spanDays} days` : ""}…
          </p>
        </div>
      ) : view === "matrix" ? (
        <ActivityMatrix rows={rows} days={days} />
      ) : (
        <>
          <StatBar items={[
            { label: "Worker-days", value: rows.length, tone: "sky", icon: CalendarDays,
              hint: `${rows.length / spanDays} workers over ${spanDays} day${spanDays === 1 ? "" : "s"}` },
            { label: "In and out", value: count("COMPLETE"), tone: "emerald", icon: CheckCircle2,
              hint: "a first punch in and a last punch out",
              title: "Show only these", active: by.state === "COMPLETE",
              onClick: () => set("state")(by.state === "COMPLETE" ? "" : "COMPLETE") },
            { label: "In, no out", value: count("IN_ONLY"),
              tone: count("IN_ONLY") ? "amber" : "slate", icon: LogIn,
              hint: "still inside, or never punched out",
              title: "Show only these", active: by.state === "IN_ONLY",
              onClick: () => set("state")(by.state === "IN_ONLY" ? "" : "IN_ONLY") },
            { label: "Out, no in", value: count("OUT_ONLY"),
              tone: count("OUT_ONLY") ? "rose" : "slate", icon: LogOut,
              hint: "a night shift that began the day before",
              title: "Show only these", active: by.state === "OUT_ONLY",
              onClick: () => set("state")(by.state === "OUT_ONLY" ? "" : "OUT_ONLY") },
            { label: "Not clocked", value: count("NOT_CLOCKED"),
              tone: count("NOT_CLOCKED") ? "slate" : "emerald", icon: AlertTriangle,
              hint: "no punch — not the same as absent",
              title: "Show only these", active: by.state === "NOT_CLOCKED",
              onClick: () => set("state")(by.state === "NOT_CLOCKED" ? "" : "NOT_CLOCKED") },
            { label: "Average span", value: avgSpan ? span(avgSpan) : "—",
              tone: "violet", icon: Clock, hint: "first in to last out, break included" },
          ]} />

          <Card tone="emerald">
            <CardHeader title={`Attendance · ${filtered.length}`} icon={Users} tone="emerald"
              subtitle="Read from the gate readers as the table is drawn; nothing is stored here yet. A worker with no punch is shown as not clocked, which is a gap in the record rather than a claim that they were absent."
              actions={
                <>
                  <Button size="sm" variant="secondary" onClick={exportRows}
                    disabled={sorted.length === 0}>
                    <Download className="w-3.5 h-3.5" /> Export
                  </Button>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
                    <input id="at-search" value={query} onChange={(e) => setQuery(e.target.value)}
                      placeholder="Name, attendance ID, trade…"
                      className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5
                                 text-[12px] text-txt-primary placeholder:text-txt-light
                                 focus:outline-none focus:border-gold w-[200px]" />
                  </div>
                </>
              } />

            {narrowed && (
              <div className="px-5 py-2 border-b border-border-light bg-bg-light/60
                              flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className="text-txt-light font-semibold">
                  {filtered.length} of {rows.length} rows
                </span>
                <button type="button"
                  onClick={() => { setBy({ trade: "", group: "", employer: "", department: "", state: "" });
                                   setQuery(""); }}
                  className="inline-flex items-center gap-1 font-semibold text-gold-dark
                             hover:underline underline-offset-2">
                  <X className="w-3 h-3" /> Clear
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr>
                    <Th className="w-[104px]">
                      <SortHeader label="Date" sort={sort.key === "date" ? sort.dir : null}
                        onSort={sortBy("date")} sortLabels={SORT_WORDS.date} /></Th>
                    <Th className="w-[84px]">
                      <SortHeader label="ID" sort={sort.key === "emp" ? sort.dir : null}
                        onSort={sortBy("emp")} sortLabels={SORT_WORDS.emp} /></Th>
                    <Th><SortHeader label="Worker" sort={sort.key === "name" ? sort.dir : null}
                          onSort={sortBy("name")} sortLabels={SORT_WORDS.name} /></Th>
                    <Th><ColumnFilter label="Trade" value={by.trade} options={menus.trade}
                          onChange={set("trade")} sort={sort.key === "trade" ? sort.dir : null}
                          onSort={sortBy("trade")} sortLabels={SORT_WORDS.trade} /></Th>
                    <Th className="hidden xl:table-cell">
                      <ColumnFilter label="Contractor" value={by.employer}
                        options={menus.employer} onChange={set("employer")} /></Th>
                    <Th className="hidden lg:table-cell">
                      <ColumnFilter label="Department" value={by.department}
                        options={menus.department} onChange={set("department")} /></Th>
                    <Th className="text-right w-[76px]">
                      <SortHeader label="In" align="right"
                        sort={sort.key === "in" ? sort.dir : null}
                        onSort={sortBy("in")} sortLabels={SORT_WORDS.in} /></Th>
                    <Th className="text-right w-[76px]">
                      <SortHeader label="Out" align="right"
                        sort={sort.key === "out" ? sort.dir : null}
                        onSort={sortBy("out")} sortLabels={SORT_WORDS.out} /></Th>
                    <Th className="text-right w-[84px]">
                      <SortHeader label="Span" align="right"
                        sort={sort.key === "span" ? sort.dir : null}
                        onSort={sortBy("span")} sortLabels={SORT_WORDS.span} /></Th>
                    <Th className="text-right w-[124px]">
                      <ColumnFilter label="State" value={by.state} align="right"
                        options={menus.state} onChange={set("state")}
                        sort={sort.key === "state" ? sort.dir : null}
                        onSort={sortBy("state")} sortLabels={SORT_WORDS.state} /></Th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <EmptyRow colSpan={10}>
                      {rows.length === 0
                        ? "No attendance for that range."
                        : "Nothing matches that."}
                    </EmptyRow>
                  )}
                  {sorted.map((r) => {
                    const key = `${r.emp_no}|${r.on_date}`;
                    const open = openRow === key;
                    return (
                      <React.Fragment key={key}>
                        <tr onClick={() => r.punches && openPunches(r)}
                          className={`transition-colors ${r.punches
                            ? "cursor-pointer hover:bg-bg-light" : ""}
                            ${open ? "bg-gold/[0.06]" : ""}`}>
                          <Td className="tabular-nums whitespace-nowrap">{toDisplay(r.on_date)}</Td>
                          <Td className="font-mono text-[12px] font-bold text-violet">{r.emp_no}</Td>
                          <Td>
                            <span className="font-semibold text-navy text-[12.5px]">{r.name}</span>
                            <span className="block text-[10.5px] font-mono text-txt-light">
                              {r.operator_ref}
                            </span>
                          </Td>
                          <Td>
                            <Chip tone="sky" dot={false}>{r.trade ?? "no trade"}</Chip>
                          </Td>
                          <Td className="hidden xl:table-cell text-txt-muted">{r.employer ?? "—"}</Td>
                          <Td className="hidden lg:table-cell text-txt-muted">
                            <span className="block truncate max-w-[15ch]" title={r.department ?? ""}>
                              {r.department ?? "—"}
                            </span>
                          </Td>
                          <Td className="text-right tabular-nums font-semibold text-navy">
                            {hhmm(r.first_in) || <span className="text-txt-light font-normal">—</span>}
                            {r.in_gate && (
                              <span className="block text-[9.5px] text-txt-light font-normal
                                               truncate max-w-[9ch]" title={r.in_gate}>
                                {r.in_gate.replace(/^.*_/, "")}
                              </span>
                            )}
                          </Td>
                          <Td className="text-right tabular-nums font-semibold text-navy">
                            {hhmm(r.last_out) || <span className="text-txt-light font-normal">—</span>}
                            {r.out_gate && (
                              <span className="block text-[9.5px] text-txt-light font-normal
                                               truncate max-w-[9ch]" title={r.out_gate}>
                                {r.out_gate.replace(/^.*_/, "")}
                              </span>
                            )}
                          </Td>
                          <Td className="text-right tabular-nums text-txt-secondary">
                            {span(r.minutes) || "—"}
                          </Td>
                          <Td className="text-right">
                            <Chip tone={r.running ? "sky" : STATE[r.state].tone}>
                              {r.running ? "still in" : STATE[r.state].label}
                            </Chip>
                            {r.punches > 1 && (
                              <span className="block text-[10.5px] text-txt-light mt-0.5">
                                {r.punches} punches
                              </span>
                            )}
                          </Td>
                        </tr>

                        {open && (
                          <tr className="bg-bg-light">
                            <Td colSpan={10} className="py-3">
                              <span className="block text-[10.5px] font-bold uppercase
                                               tracking-[.12em] text-txt-light mb-2">
                                Every punch on {toDisplay(r.on_date)}
                              </span>
                              {punchBusy ? (
                                <Loader2 className="w-4 h-4 animate-spin text-gold" />
                              ) : punches.length === 0 ? (
                                <span className="text-[12px] text-txt-muted">
                                  Nothing came back for this day.
                                </span>
                              ) : (
                                <span className="flex flex-wrap gap-2">
                                  {punches.map((p, i) => (
                                    <span key={i}
                                      className="inline-flex items-center gap-2 rounded-lg
                                                 bg-bg-base ring-1 ring-border px-2.5 py-1">
                                      {p.direction === "IN"
                                        ? <LogIn className="w-3 h-3 text-emerald" />
                                        : <LogOut className="w-3 h-3 text-rose" />}
                                      <span className="font-mono text-[12px] font-bold text-navy
                                                       tabular-nums">
                                        {p.at.slice(11, 19)}
                                      </span>
                                      <span className="text-[11px] text-txt-light">{p.device}</span>
                                    </span>
                                  ))}
                                </span>
                              )}
                            </Td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
