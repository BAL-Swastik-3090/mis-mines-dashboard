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
import { matchesSearch } from "@/lib/search";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, Clock, Download,
  ChevronLeft, ChevronRight, Grid3x3, Loader2, LogIn, LogOut, Rows3, Search,
  SlidersHorizontal, Users, X,
} from "lucide-react";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { ManpowerFilter } from "@/components/sections/ManpowerSection";

import ColumnFilter, { optionsFrom, matches, SortHeader, type SortDir } from "./ColumnFilter";
import ActivityMatrix from "./ActivityMatrix";
import CorrectionsPanel from "./CorrectionsPanel";
import HoverCard, { CardBody, CardHead, CardNote, Fact } from "./HoverCard";
import DateField, { toDisplay } from "./DateField";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, StatBar, Td, Th, type Tone,
} from "./ui";
import { toCsv, download } from "./spreadsheet";

interface Row {
  operator_id: number; operator_ref: string | null; name: string; emp_no: string;
  trade: string | null; trade_group: string | null; employer: string | null;
  department: string | null; designation: string | null; plant: string | null;
  on_date: string; first_in: string | null; last_out: string | null;
  minutes: number | null; punches: number; devices: number;
  in_gate: string | null; out_gate: string | null;
  state: "COMPLETE" | "IN_ONLY" | "OUT_ONLY" | "NOT_CLOCKED" | "ABSENT" | "PRESENT";
  running: boolean;
  corrections: { kind: string; reason: string | null; by: string | null;
                 remarks: string | null }[];
}
interface Punch { at: string; direction: "IN" | "OUT"; device: string }

const STATE: Record<Row["state"], { label: string; tone: Tone }> = {
  COMPLETE: { label: "in and out", tone: "emerald" },
  IN_ONLY: { label: "in, no out", tone: "amber" },
  OUT_ONLY: { label: "out, no in", tone: "rose" },
  NOT_CLOCKED: { label: "not clocked", tone: "slate" },
  // Only ever reached through an approved correction. A reader cannot say
  // somebody was absent; only a person can.
  ABSENT: { label: "absent", tone: "rose" },
  PRESENT: { label: "present", tone: "sky" },
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

const PAGE_SIZES = [50, 100, 200, 500, 1000, 0];
const sizeLabel = (n: number) => (n === 0 ? "All" : String(n));

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

export default function AttendancePanel({ filter }: {
  /** Chosen once for the whole Manpower screen. The register endpoint takes
   *  none of these, so they narrow the rows here instead — same result to the
   *  reader, and it keeps one bar for the screen. */
  filter?: ManpowerFilter;
}) {
  // Two readings of the same data. The day log answers "what happened on this
  // date"; the matrix answers "what does this person's month look like", which
  // is a different question and a different shape.
  const [view, setView] = useState<"log" | "matrix" | "fix">("log");
  // Opening the correction form from a day row carries the worker and date
  // across, because retyping what is already on screen is how the wrong day
  // gets corrected.
  const [prefill, setPrefill] = useState<
    { emp_no: string; name: string; on_date: string; kind?: string } | undefined>();
  // The range comes from the platform's own date filter in the page header —
  // the one every other screen already obeys, which opens on month-to-date.
  // This screen had its own From and To underneath it, which is two calendars
  // disagreeing about what "the period" means.
  const { apiFrom: from, apiTo: to, label: rangeLabel, periodLabel } = useDateFilter();
  const [allRows, setAllRows] = useState<Row[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [trimmed, setTrimmed] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  // One set of filters for the screen, not one per view. Plant, contractor,
  // department and trade sit in the bar at the top and narrow both shapes;
  // state is the day log's own because a matrix cell already shows it.
  //
  // The column headings in the day log write to this same object, so filtering
  // from a heading and filtering from the bar are two doors to one room rather
  // than two filters that can disagree.
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(100);
  const [by, setBy] = useState({ plant: "", trade: "", group: "", employer: "", worker: "",
                                 department: "", state: "" });
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
      setAllRows(r.data?.rows ?? []);
      setDays(r.data?.days ?? []);
      setTrimmed(r.data?.trimmed ?? null);
      if (r.data?.note) setNote(r.data.note);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not read the attendance readers.");
      setAllRows([]);
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

  // The screen's plant narrows everything below it, including the menus —
  // offering a contractor who has nobody at the chosen plant is offering a
  // filter that returns nothing.
  const rows = useMemo(() => {
    const f = filter;
    if (!f) return allRows;
    return allRows.filter((r) =>
      (!f.plantName   || r.plant === f.plantName) &&
      (!f.employer    || r.employer === f.employer) &&
      (!f.department  || r.department === f.department) &&
      (!f.trade       || r.trade === f.trade) &&
      (!f.worker      || r.name === f.worker));
  }, [allRows, filter]);

  const menus = useMemo(() => ({
    plant: optionsFrom(rows, (r) => r.plant, (v) => v, null),
    trade: optionsFrom(rows, (r) => r.trade, (v) => v, "No trade set"),
    group: optionsFrom(rows, (r) => r.trade_group, (v) => v, null),
    employer: optionsFrom(rows, (r) => r.employer, (v) => v, "Not recorded"),
    department: optionsFrom(rows, (r) => r.department, (v) => v, "Not posted"),
    // Person-wise. The count beside each name is that worker's days in the
    // window, which is the number somebody scanning this list wants.
    worker: optionsFrom(rows, (r) => r.name, (v) => v, null),
    state: (Object.keys(STATE) as Row["state"][]).map((s) => ({
      value: s, label: STATE[s].label,
      count: rows.filter((r) => r.state === s).length,
    })).filter((o) => o.count > 0),
  }), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matches(r.plant, by.plant)) return false;
      if (!matches(r.trade, by.trade)) return false;
      if (!matches(r.trade_group, by.group)) return false;
      if (!matches(r.employer, by.employer)) return false;
      if (!matches(r.department, by.department)) return false;
      if (!matches(r.name, by.worker)) return false;
      if (by.state && r.state !== by.state) return false;
      if (!q) return true;
      return matchesSearch(q, [r.name, r.emp_no, r.operator_ref, r.trade]);
    });
  }, [rows, by, query]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    // Ordered by how settled the day is: a clean day, then a day somebody
    // decided, then the gaps.
    const rank: Record<Row["state"], number> =
      { COMPLETE: 0, PRESENT: 1, ABSENT: 2, IN_ONLY: 3, OUT_ONLY: 4, NOT_CLOCKED: 5 };
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

  // 4,431 rows in one table is what made the browser struggle. Slice, and
  // clamp the page so narrowing the filters never leaves somebody looking at
  // an empty page 12 with no way back.
  const showAll = perPage === 0;
  const pages = showAll ? 1 : Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = Math.min(page, pages - 1);
  const shown = showAll ? sorted
                        : sorted.slice(safePage * perPage, (safePage + 1) * perPage);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  // Narrowing the list should put you back at the top of it, not leave you on
  // page 7 of a result that now has three pages.
  useEffect(() => { setPage(0); }, [by, query, from, to]);
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

  const spanDays = days.length || 1;

  return (
    <div className="space-y-4">
      {/* The range comes from the page header. This says what it resolved to
          and offers the two shapes; it does not offer a second calendar. */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <span className="inline-flex items-center gap-2 text-[12.5px] text-txt-secondary">
          <CalendarDays className="w-4 h-4 text-txt-light" />
          <span className="font-semibold text-navy">{rangeLabel}</span>
          <Chip tone="slate" dot={false}>{periodLabel}</Chip>
          <span className="text-txt-light">
            {spanDays} day{spanDays === 1 ? "" : "s"}
          </span>
        </span>
        <span className="w-px self-stretch bg-border-light mx-1" />

        {/* Contractor, department, trade, worker and plant used to be drawn
            here as well. They live in the Manpower screen's own bar now, so
            one choice covers the register, capability, this screen, the
            assessments and the analytics. The per-column menus inside the
            table below stay, for narrowing within what the bar has already
            chosen. */}

        <span className="flex-1" />
        <span className="inline-flex rounded-lg border border-border bg-bg-light p-0.5">
          {([["log", Rows3, "One row per worker per day"],
             ["matrix", Grid3x3, "One row per worker, one column per day"],
             ["fix", ClipboardCheck, "Corrections raised, and the approval queue"]] as const)
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

      {error && <Alert tone="error">{error}</Alert>}
      {note && <Alert tone="warning">{note}</Alert>}
      {trimmed && <Alert tone="warning">{trimmed}</Alert>}

      {loading ? (
        <div className="flex flex-col items-center gap-2 py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gold" />
          <p className="text-[12px] text-txt-light">
            Reading the gate readers{spanDays > 1 ? ` for ${spanDays} days` : ""}…
          </p>
        </div>
      ) : view === "fix" ? (
        <CorrectionsPanel prefill={prefill}
          onDone={() => { setPrefill(undefined); void load(); }} />
      ) : view === "matrix" ? (
        <ActivityMatrix rows={filtered} days={days} narrowed={narrowed} />
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
                                 focus:outline-none focus:border-gold w-full sm:w-[320px] lg:w-[440px] xl:w-[520px]" />
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
                  onClick={() => { setBy({ plant: "", trade: "", group: "", employer: "",
                                           department: "", worker: "", state: "" });
                                   setQuery(""); setPage(0); }}
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
                  {shown.map((r) => {
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
                            <HoverCard width={288} card={
                              <>
                                <CardHead title={r.name}
                                  sub={`${r.emp_no}${r.trade ? ` · ${r.trade}` : ""}`}
                                  right={
                                    <span className="text-[10.5px] font-bold text-txt-light">
                                      {toDisplay(r.on_date)}
                                    </span>
                                  } />
                                <CardBody>
                                  <Fact label="In" value={hhmm(r.first_in) || "—"}
                                    sub={r.in_gate ?? (r.first_in ? "gate not recorded" : "no punch in")}
                                    tone={r.first_in ? "text-emerald" : "text-txt-light"} />
                                  <Fact label="Out" value={hhmm(r.last_out) || "—"}
                                    sub={r.out_gate ?? (r.running ? "still inside" : "no punch out")}
                                    tone={r.last_out ? "text-rose" : "text-txt-light"} />
                                  {r.minutes != null && (
                                    <Fact label="Span" value={span(r.minutes)}
                                      sub="first in to last out, break included" />
                                  )}
                                  <Fact label="Punches" value={String(r.punches)}
                                    sub={r.devices ? `${r.devices} reader${r.devices === 1 ? "" : "s"}` : undefined} />
                                  <Fact label="Posted" value={r.employer ?? "—"}
                                    sub={[r.department, r.designation].filter(Boolean).join(" · ") || undefined} />
                                  <Fact label="Reference" value={r.operator_ref ?? "—"} />
                                </CardBody>
                                {r.state === "NOT_CLOCKED" && (
                                  <CardNote>
                                    No punch either way. A gap in the record — it does not
                                    say they were absent.
                                  </CardNote>
                                )}
                              </>
                            }>
                              <span className="font-semibold text-navy text-[12.5px] cursor-help
                                               decoration-dotted underline-offset-2 hover:underline">
                                {r.name}
                              </span>
                            </HoverCard>
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

            {/* Pager. Export above stays the whole filtered set, not this
                page — somebody exporting wants the month, not the screen. */}
            <div className="px-5 py-3 border-t border-border-light bg-bg-light/60
                            flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-3 text-[11.5px] text-txt-muted">
                <span className="tabular-nums">
                  {sorted.length === 0 ? "Nothing to show"
                    : showAll ? `All ${sorted.length} rows`
                    : `${safePage * perPage + 1}–${Math.min((safePage + 1) * perPage, sorted.length)} of ${sorted.length}`}
                </span>
                <label className="inline-flex items-center gap-1.5">
                  Show
                  <select value={perPage}
                    onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}
                    className="bg-bg-base border border-border rounded-lg px-2 py-1
                               text-[11.5px] font-semibold text-txt-secondary
                               focus:outline-none focus:border-gold">
                    {PAGE_SIZES.map((v) => (
                      <option key={v} value={v}>{sizeLabel(v)}</option>
                    ))}
                  </select>
                  at a time
                </label>
                {showAll && sorted.length > 1000 && (
                  <span className="text-amber">
                    {sorted.length.toLocaleString("en-IN")} rows at once will be slow.
                  </span>
                )}
              </span>
              {pages > 1 && (
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" disabled={safePage === 0}
                    onClick={() => setPage(0)} title="First page">1</Button>
                  <Button size="sm" variant="secondary" disabled={safePage === 0}
                    onClick={() => setPage((v) => v - 1)}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="text-[11.5px] text-txt-muted px-1 tabular-nums">
                    {safePage + 1} / {pages}
                  </span>
                  <Button size="sm" variant="secondary" disabled={safePage >= pages - 1}
                    onClick={() => setPage((v) => v + 1)}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="secondary" disabled={safePage >= pages - 1}
                    onClick={() => setPage(pages - 1)} title="Last page">{pages}</Button>
                </span>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
