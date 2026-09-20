"use client";
/**
 * Assessment, as a job rather than as a button on a row.
 *
 * The register carries an "Assess" button per person, which is right when you
 * have opened somebody's record and decided to assess them. It is the wrong
 * shape for the actual work: a training officer sits down with a list of
 * people who need looking at, works through it, and wants to know at the end
 * how much of it is left.
 *
 * So this screen is the list, in the order the work happens:
 *
 *   NEVER ASSESSED  people employed to run a machine with no clearance on
 *                   anything. The register cannot say they are allowed to
 *                   work, so this is first. It is also the whole population
 *                   on a register that has just been loaded.
 *   OVERDUE         a clearance that has run out. The person is working; the
 *                   paperwork says they should not be.
 *   DUE SOON        inside the reassessment window, so it can be planned
 *                   rather than chased.
 *
 * Every queue filters and sorts on every column, because "the excavator
 * operators in Automobile" is how the work is actually divided up, and
 * exports, because some of it gets done on paper in the workshop.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Download, Loader2, Search,
  ShieldCheck, ShieldX, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import ColumnFilter, { optionsFrom, matches, SortHeader, type SortDir } from "./ColumnFilter";
import AssessmentSheet from "./AssessmentSheet";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, StatBar, Td, Th,
  type Stat, type Tone,
} from "./ui";
import { toCsv, download } from "./spreadsheet";
import { ago, exactly } from "./when";

interface Person {
  operator_id: number; operator_ref: string | null; display_name: string;
  designation: string | null; attendance_id: string | null;
  trade: string | null; trade_group: string | null; trade_machine: string | null;
  operates_equipment: boolean | null; employer: string | null;
  department: string | null; plant: string | null; approval_status: string;
  profile_status: string; machines_competent: number;
  last_assessed: string | null; next_due: string | null;
  avg_rating: number | null; years_served: number | null;
}

type Queue = "never" | "overdue" | "soon" | "done";

const QUEUES: { id: Queue; label: string; tone: Tone; icon: React.ElementType; hint: string }[] = [
  { id: "never", label: "Never assessed", tone: "rose", icon: ShieldX,
    hint: "Employed to run a machine, with no clearance on anything." },
  { id: "overdue", label: "Overdue", tone: "amber", icon: AlertTriangle,
    hint: "The clearance has run out. They are working; the record says they should not be." },
  { id: "soon", label: "Due soon", tone: "sky", icon: CalendarClock,
    hint: "Inside the reassessment window — plannable rather than chased." },
  { id: "done", label: "Current", tone: "emerald", icon: CheckCircle2,
    hint: "Assessed and in date. Here so the list can be checked, not chased." },
];

/** How many days until the clearance runs out. Negative is overdue. */
function daysTo(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}

function queueOf(p: Person): Queue {
  if (p.machines_competent === 0) return "never";
  const left = daysTo(p.next_due);
  if (left === null) return "done";
  if (left < 0) return "overdue";
  if (left <= 60) return "soon";
  return "done";
}

type SortKey = "name" | "attendance" | "trade" | "department" | "assessed" | "due" | "service";

const SORT_WORDS: Record<SortKey, [string, string]> = {
  name: ["A to Z", "Z to A"],
  attendance: ["Lowest first", "Highest first"],
  trade: ["A to Z", "Z to A"],
  department: ["A to Z", "Z to A"],
  assessed: ["Longest ago first", "Most recent first"],
  due: ["Soonest first", "Latest first"],
  service: ["Newest first", "Longest serving first"],
};

export default function AssessmentPanel({ onChanged }: { onChanged?: () => void }) {
  const can = useAuth((s) => s.can);
  const mayAssess = can("platform.operators.assess");

  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Queue>("never");
  const [query, setQuery] = useState("");
  const [by, setBy] = useState({ trade: "", group: "", department: "", employer: "" });
  const set = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(
    { key: "name", dir: "asc" });
  const sortBy = (key: SortKey) => (dir: SortDir) => setSort({ key, dir });
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPeople((await api.get("/operators")).data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not read the register.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Only people employed to operate something. A welder has no machine
  // clearance to be overdue for, and putting 68 of them in a queue called
  // "never assessed" is how a real finding gets buried.
  const operators = useMemo(
    () => people.filter((p) => p.operates_equipment && p.profile_status === "ACTIVE"),
    [people]);

  const counts = useMemo(() => {
    const c: Record<Queue, number> = { never: 0, overdue: 0, soon: 0, done: 0 };
    for (const p of operators) c[queueOf(p)] += 1;
    return c;
  }, [operators]);

  const pool = useMemo(
    () => operators.filter((p) => queueOf(p) === queue), [operators, queue]);

  const menus = useMemo(() => ({
    trade: optionsFrom(pool, (p) => p.trade, (v) => v, "No trade set"),
    group: optionsFrom(pool, (p) => p.trade_group, (v) => v, null),
    department: optionsFrom(pool, (p) => p.department, (v) => v, "Not posted"),
    employer: optionsFrom(pool, (p) => p.employer, (v) => v, "Not recorded"),
  }), [pool]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool.filter((p) => {
      if (!matches(p.trade, by.trade)) return false;
      if (!matches(p.trade_group, by.group)) return false;
      if (!matches(p.department, by.department)) return false;
      if (!matches(p.employer, by.employer)) return false;
      if (!q) return true;
      return [p.display_name, p.operator_ref, p.attendance_id, p.trade, p.designation]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [pool, by, query]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const keyOf = (p: Person): string | number => {
      switch (sort.key) {
        case "name":       return p.display_name.toLowerCase();
        case "attendance": return Number(p.attendance_id ?? Number.MAX_SAFE_INTEGER);
        case "trade":      return (p.trade ?? "").toLowerCase();
        case "department": return (p.department ?? "").toLowerCase();
        case "assessed":   return p.last_assessed ? new Date(p.last_assessed).getTime() : 0;
        case "due":        return p.next_due ? new Date(p.next_due).getTime() : Number.MAX_SAFE_INTEGER;
        case "service":    return p.years_served ?? 0;
      }
    };
    const rank = (v: string | number) => (typeof v === "string" && v === "" ? "￿" : v);
    return [...filtered].sort((x, y) => {
      const a = rank(keyOf(x)), b = rank(keyOf(y));
      if (a === b) return x.display_name.localeCompare(y.display_name);
      const cmp = typeof a === "number" && typeof b === "number"
        ? a - b : String(a).localeCompare(String(b));
      return cmp * dir;
    });
  }, [filtered, sort]);

  const active: { label: string; clear: () => void }[] = [
    ...(by.group ? [{ label: by.group, clear: () => set("group")("") }] : []),
    ...(by.trade ? [{ label: by.trade, clear: () => set("trade")("") }] : []),
    ...(by.department ? [{ label: by.department, clear: () => set("department")("") }] : []),
    ...(by.employer ? [{ label: by.employer, clear: () => set("employer")("") }] : []),
    ...(query.trim() ? [{ label: `“${query.trim()}”`, clear: () => setQuery("") }] : []),
  ];

  const exportQueue = () => {
    download(toCsv(
      ["Attendance ID", "Reference", "Name", "Trade", "Machine", "Department",
       "Employer", "Years served", "Classes cleared", "Last assessed", "Next due"],
      sorted.map((p) => [
        p.attendance_id ?? "", p.operator_ref ?? "", p.display_name,
        p.trade ?? "", p.trade_machine ?? "", p.department ?? "", p.employer ?? "",
        p.years_served ?? "", p.machines_competent,
        (p.last_assessed ?? "").slice(0, 10), (p.next_due ?? "").slice(0, 10),
      ])),
      `assessment-${queue}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // The focused sheet, not the ten-tab profile. Assessing is one job and the
  // screen for it should offer one job.
  if (editingId) {
    return (
      <AssessmentSheet operatorId={editingId}
        onSaved={() => onChanged?.()}
        onDone={() => { setEditingId(null); void load(); onChanged?.(); }} />
    );
  }

  if (loading) {
    return <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }
  if (error) return <Alert tone="error">{error}</Alert>;

  const q = QUEUES.find((x) => x.id === queue)!;

  return (
    <div className="space-y-4">
      {/* The queues are the figures. Clicking one is how you move between
          them, because the number and the list are the same thing. */}
      <StatBar items={([...QUEUES.map((x): Stat => ({
        label: x.label,
        value: counts[x.id],
        tone: counts[x.id] === 0 && x.id !== "done" ? "emerald" : x.tone,
        icon: x.icon,
        hint: x.id === "never" ? "no clearance on any machine"
             : x.id === "overdue" ? "clearance has run out"
             : x.id === "soon" ? "within sixty days"
             : "assessed and in date",
        title: `Show the ${x.label.toLowerCase()} list`,
        onClick: () => setQueue(x.id),
        active: queue === x.id,
      })),
        { label: "Machine operators", value: operators.length, tone: "slate",
          icon: ShieldCheck, hint: "everyone this screen covers" },
        { label: "Cleared", value: operators.length - counts.never,
          tone: operators.length - counts.never ? "emerald" : "rose",
          icon: CheckCircle2, hint: "assessed on at least one machine" },
      ])} />

      <Card tone={q.tone}>
        <CardHeader title={`${q.label} · ${filtered.length}`} icon={q.icon} tone={q.tone}
          subtitle={q.hint}
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={exportQueue}
                disabled={sorted.length === 0}
                title="Download this queue — some of this gets done on paper in the workshop">
                <Download className="w-3.5 h-3.5" /> Export
              </Button>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
                <input id="as-search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, attendance ID, trade…"
                  className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5 text-[12px]
                             text-txt-primary placeholder:text-txt-light focus:outline-none
                             focus:border-gold w-[200px]" />
              </div>
            </>
          } />

        {active.length > 0 && (
          <div className="px-5 py-2.5 border-b border-border-light bg-bg-light/60
                          flex flex-wrap items-center gap-1.5">
            <span className="font-condensed text-[9.5px] font-bold uppercase
                             tracking-[.13em] text-txt-light mr-0.5">Showing only</span>
            {active.map((c) => (
              <button key={c.label} type="button" onClick={c.clear}
                className="group inline-flex items-center gap-1.5 rounded-full border
                           border-gold/40 bg-gold/[0.07] pl-2.5 pr-1.5 py-1 text-[11px]
                           font-semibold text-gold-dark hover:bg-gold/15 transition">
                {c.label}<X className="w-3 h-3 opacity-60 group-hover:opacity-100" />
              </button>
            ))}
            <button type="button"
              onClick={() => { setBy({ trade: "", group: "", department: "", employer: "" }); setQuery(""); }}
              className="ml-1 text-[11px] font-semibold text-txt-muted hover:text-navy
                         underline underline-offset-2">Clear all</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                <Th className="w-[110px]">
                  <SortHeader label="Attendance ID"
                    sort={sort.key === "attendance" ? sort.dir : null}
                    onSort={sortBy("attendance")} sortLabels={SORT_WORDS.attendance} /></Th>
                <Th><SortHeader label="Person" sort={sort.key === "name" ? sort.dir : null}
                      onSort={sortBy("name")} sortLabels={SORT_WORDS.name} /></Th>
                <Th><ColumnFilter label="Trade" value={by.trade} options={menus.trade}
                      onChange={set("trade")} sort={sort.key === "trade" ? sort.dir : null}
                      onSort={sortBy("trade")} sortLabels={SORT_WORDS.trade} /></Th>
                <Th className="hidden lg:table-cell">
                  <ColumnFilter label="Group" value={by.group} options={menus.group}
                    onChange={set("group")} /></Th>
                <Th className="hidden md:table-cell">
                  <ColumnFilter label="Department" value={by.department}
                    options={menus.department} onChange={set("department")}
                    sort={sort.key === "department" ? sort.dir : null}
                    onSort={sortBy("department")} sortLabels={SORT_WORDS.department} /></Th>
                <Th className="hidden xl:table-cell text-right">
                  <SortHeader label="Served" align="right"
                    sort={sort.key === "service" ? sort.dir : null}
                    onSort={sortBy("service")} sortLabels={SORT_WORDS.service} /></Th>
                <Th className="text-right">
                  <SortHeader label="Last assessed" align="right"
                    sort={sort.key === "assessed" ? sort.dir : null}
                    onSort={sortBy("assessed")} sortLabels={SORT_WORDS.assessed} /></Th>
                <Th className="text-right">
                  <SortHeader label="Due" align="right"
                    sort={sort.key === "due" ? sort.dir : null}
                    onSort={sortBy("due")} sortLabels={SORT_WORDS.due} /></Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <EmptyRow colSpan={9}>
                  {pool.length === 0
                    ? `Nobody is ${q.label.toLowerCase()}.`
                    : "Nobody in this queue matches that search."}
                </EmptyRow>
              )}
              {sorted.map((p) => {
                const left = daysTo(p.next_due);
                return (
                  <tr key={p.operator_id} className="hover:bg-bg-light transition-colors">
                    <Td className="font-mono text-[12px] font-bold text-violet">
                      {p.attendance_id ?? <span className="text-txt-light font-normal">not linked</span>}
                    </Td>
                    <Td>
                      <button onClick={() => setEditingId(p.operator_id)} className="text-left group">
                        <div className="font-semibold text-navy text-[13px] group-hover:text-gold-dark
                                        group-hover:underline underline-offset-2 transition-colors">
                          {p.display_name}
                        </div>
                        <div className="text-[11px] font-mono text-txt-light">
                          {p.operator_ref}
                        </div>
                      </button>
                    </Td>
                    <Td>
                      <Chip tone="sky" dot={false}>{p.trade ?? "no trade"}</Chip>
                      {p.trade_machine && (
                        <span className="block text-[11px] text-txt-light mt-0.5">
                          on {p.trade_machine}
                        </span>
                      )}
                    </Td>
                    <Td className="hidden lg:table-cell text-txt-muted">{p.trade_group ?? "—"}</Td>
                    <Td className="hidden md:table-cell text-txt-muted">{p.department ?? "—"}</Td>
                    <Td className="hidden xl:table-cell text-right tabular-nums text-txt-muted">
                      {p.years_served != null ? `${p.years_served} yr` : "—"}
                    </Td>
                    <Td className="text-right">
                      {p.last_assessed ? (
                        <span className="text-[11.5px] text-txt-muted"
                          title={exactly(p.last_assessed)}>{ago(p.last_assessed)}</span>
                      ) : <Chip tone="rose" dot={false}>never</Chip>}
                    </Td>
                    <Td className="text-right">
                      {left === null ? <span className="text-[12px] text-txt-light">—</span>
                       : left < 0 ? <Chip tone="rose">{-left} days over</Chip>
                       : left <= 30 ? <Chip tone="amber">{left} days</Chip>
                       : <span className="text-[11.5px] text-txt-muted">{left} days</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {mayAssess ? (
                        <Button size="sm" variant={queue === "never" ? "primary" : "secondary"}
                          onClick={() => setEditingId(p.operator_id)}>
                          <ShieldCheck className="w-3.5 h-3.5" /> Assess
                        </Button>
                      ) : (
                        <span className="text-[11.5px] text-txt-light">read only</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {queue === "never" && counts.never > 0 && (
        <p className="text-[12px] text-txt-muted px-1">
          {counts.never} of {operators.length} machine operators have no clearance
          on anything. Until they are assessed, the register cannot say any of
          them is allowed to work — which is the same as saying it cannot yet be
          used to crew a shift.
        </p>
      )}
    </div>
  );
}
