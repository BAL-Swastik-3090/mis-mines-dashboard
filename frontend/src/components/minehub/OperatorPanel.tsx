"use client";
/**
 * The people who run the machines.
 *
 * The register, and nothing else. It used to carry a queue underneath it — the
 * people the driver master names who have no profile here yet — on the
 * argument that the register is what the screen is for and the queue is work
 * to get through. It was removed on request: fourteen rows of somebody else's
 * list sitting under the register read as part of it.
 *
 * /api/operators/unregistered still answers, so the comparison between the
 * driver master and the register is not lost, only unshown.
 */
import { matchesSearch } from "@/lib/search";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toDisplay } from "./DateField";
import {
  Users, Search, Plus, Loader2, HardHat, ShieldCheck, AlertTriangle,
  ClipboardList, Pencil, Grid3x3, Award, CalendarClock, Settings2, Check,
  GraduationCap, TrendingUp, TrendingDown, Star, Download, X, CheckSquare,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import type { ManpowerFilter } from "@/components/sections/ManpowerSection";

import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, StatBar, Td, Th, Tile, type Tone,
} from "./ui";
import OperatorForm from "./OperatorForm";
import ColumnFilter, {
  optionsFrom, matches, SortHeader, type SortDir,
} from "./ColumnFilter";
import { toCsv, download } from "./spreadsheet";

type OpSortKey = "name" | "attendance" | "trade" | "department" | "employer"
               | "service" | "assessed" | "classes";

const OP_SORT_WORDS: Record<OpSortKey, [string, string]> = {
  name:       ["A to Z", "Z to A"],
  attendance: ["Lowest first", "Highest first"],
  trade:      ["A to Z", "Z to A"],
  department: ["A to Z", "Z to A"],
  employer:   ["A to Z", "Z to A"],
  service:    ["Newest first", "Longest serving first"],
  assessed:   ["Longest ago first", "Most recent first"],
  classes:    ["Fewest first", "Most first"],
};

interface Operator {
  operator_id: number; operator_ref: string | null; display_name: string;
  approval_status: string; profile_status: string; employment_type: string | null;
  /** The day employment ended. Null for everybody still on the rolls. */
  employment_end?: string | null;
  designation: string | null; phone: string | null; blood_group: string | null;
  employer: string | null; department: string | null; plant: string | null;
  exp_total_months: number | null; exp_hemm_months: number | null;
  machines_competent: number; expired_documents: number; assigned_to: string | null;
  last_assessed: string | null; last_assessed_by: string | null; next_due: string | null;
  declined_count: number; improved_count: number; avg_rating: number | null;
  // Added with the CLL load: the number the gate, the muster and the face
  // reader know this person by, and the classified job behind the words the
  // employer wrote.
  attendance_id: string | null; biometric_id: string | null;
  trade: string | null; trade_group: string | null; trade_machine: string | null;
  skill_class: string | null; operates_equipment: boolean | null;
  years_served: number | null; age: number | null; joined_on: string | null;
}

interface Due {
  operator_id: number; operator_ref: string | null; display_name: string;
  designation: string | null; asset_type: string | null; fleet_code: string | null;
  level: number | null; rating: number | null; assessed_on: string | null;
  last_assessed_by_name: string | null; next_assessment_due: string;
  days_left: number;
}

interface Need {
  operator_id: number; operator_ref: string | null; display_name: string;
  designation: string | null; employment_type: string | null; plant: string | null;
  next_due: string | null; avg_rating: number | null; urgency: string;
  needs: { need: string; urgency: string; because: string }[];
}

interface Schedule {
  default_interval_months: number;
  settings: { key: string; value: string; description: string | null;
              updated_by: string | null; updated_at: string }[];
  classes: { asset_type_id: number; name: string; assessment_interval_months: number | null }[];
}


interface Matrix {
  asset_types: { asset_type_id: number; name: string }[];
  operators: { operator_id: number; operator_ref: string | null; name: string;
               levels: Record<string, { level: number | null; lapsed: boolean }> }[];
  competent_per_type: Record<string, number>;
}

interface Coverage {
  skill_id: number; code: string; name: string; nsqf_level: number | null;
  category: string | null; asset_type: string | null; holders: number; lapsed: number;
}

const APPROVAL_TONE: Record<string, Tone> = {
  DRAFT: "slate", SUBMITTED: "amber", SENT_BACK: "rose", APPROVED: "emerald",
};

const EMPLOYMENT_TONE: Record<string, Tone> = {
  OWN: "sky", CONTRACT: "violet", TRAINEE: "amber", OTHER: "slate",
};

/** A due date, said the way people ask about it: how long have I got. */
function dueChip(on: string | null | undefined) {
  if (!on) return <span className="text-[12px] text-txt-light">not scheduled</span>;
  const days = Math.round((new Date(on).getTime() - Date.now()) / 86400000);
  const tone: Tone = days < 0 ? "rose" : days <= 30 ? "amber" : "emerald";
  const label = days < 0 ? `overdue ${-days}d` : days === 0 ? "due today" : `in ${days}d`;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Chip tone={tone}>{label}</Chip>
      <span className="text-[11px] text-txt-light tabular-nums">{on}</span>
    </span>
  );
}

/** Months read as years by everyone who talks about experience. */
function years(months: number | null): string {
  if (!months) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y ? `${y}y${m ? ` ${m}m` : ""}` : `${m}m`;
}

export default function OperatorPanel({ view: viewProp = "register", addOpen,
                                        onAddOpenChange, onFormOpenChange, onChanged,
                                        filter }: {
  /** Which of the section's two register tabs is showing. */
  view?: "register" | "capability";
  addOpen?: boolean;
  onAddOpenChange?: (v: boolean) => void;
  onFormOpenChange?: (v: boolean) => void;
  onChanged?: () => void;
  /** Chosen once for the whole Manpower screen, not per tab. */
  filter?: ManpowerFilter;
}) {
  const plantId = filter?.plantId ?? "";
  const standing = filter?.standing ?? "ON_ROLL";
  const can = useAuth((s) => s.can);
  const mayManage = can("platform.operators.manage");
  const mayAssess = can("platform.operators.assess");
  const maySchedule = can("platform.operators.approve");

  const [allOperators, setOperators] = useState<Operator[]>([]);

  // The Manpower screen's bar narrows the source list before this panel's own
  // column menus see it, so the two compose instead of competing. Plant is
  // already applied at the server by the request above.
  const keep = <T extends { display_name: string; employer: string | null;
                            department: string | null; trade: string | null }>(xs: T[]) => {
    const f = filter;
    if (!f) return xs;
    return xs.filter((x) =>
      (!f.employer   || x.employer === f.employer) &&
      (!f.department || x.department === f.department) &&
      (!f.trade      || x.trade === f.trade) &&
      (!f.worker     || x.display_name === f.worker));
  };
  const operators = useMemo(() => keep(allOperators), [allOperators, filter]);

  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [prefill, setPrefill] = useState<{ display_name?: string; code?: string }>({});
  // Which part of the profile to land on. "Assess this person" and "look at
  // this person" are different errands, and the first one should not begin with
  // a scroll past nine sections.
  const [openAt, setOpenAt] = useState<string | undefined>(undefined);

  // Which of the section's two register tabs is showing. It used to be local
  // state with its own switcher directly under the section's tab strip — two
  // tab bars, both starting with the word Register, one inside the other.
  const view = viewProp;
  // Every column both filters and orders, as the machine register does. With
  // 211 people the difference between "find the excavator operators in
  // Automobile" and "scroll" is the difference between a register and a list.
  const [by, setBy] = useState({ trade: "", group: "", department: "",
                                 employer: "", employment: "", approval: "" });
  const setF = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));
  const [sort, setSort] = useState<{ key: OpSortKey; dir: SortDir }>(
    { key: "name", dir: "asc" });
  const sortBy = (key: OpSortKey) => (dir: SortDir) => setSort({ key, dir });
  // Ids rather than rows, so a selection survives re-sorting and reloading.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const anchor = React.useRef<number | null>(null);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [needs, setNeeds] = useState<Need[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum, dueList, needList] = await Promise.all([
        api.get("/operators", { params: { standing,
          ...(plantId ? { plant_id: plantId } : {}) } }),
        api.get("/operators/summary", { params: { standing } }),
        api.get("/operators/meta/due").catch(() => ({ data: [] })),
        api.get("/operators/meta/training-needs").catch(() => ({ data: [] })),
      ]);
      setOperators(list.data ?? []);
      setSummary(sum.data ?? null);
      setDue(dueList.data ?? []);
      setNeeds(needList.data ?? []);
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load the operator register.");
    } finally { setLoading(false); }
  }, [plantId, standing]);

  useEffect(() => { void load(); }, [load]);

  // The capability view is a different question — how many people can run each
  // class — so it is fetched only when someone asks it.
  useEffect(() => {
    if (view !== "capability") return;
    (async () => {
      try {
        const [m, c, sch] = await Promise.all([
          api.get("/operators/matrix", { params: plantId ? { plant_id: plantId } : {} }),
          api.get("/operators/meta/skill-coverage"),
          api.get("/operators/meta/settings").catch(() => ({ data: null })),
        ]);
        setMatrix(m.data ?? null);
        setCoverage(c.data ?? []);
        setSchedule(sch.data ?? null);
      } catch { setMatrix(null); setCoverage([]); }
    })();
  }, [view, plantId]);

  const formOpen = Boolean(addOpen || editingId);
  useEffect(() => { onFormOpenChange?.(formOpen); }, [formOpen, onFormOpenChange]);

  const menus = useMemo(() => ({
    trade: optionsFrom(operators, (o) => o.trade, (v) => v, "No trade set"),
    group: optionsFrom(operators, (o) => o.trade_group, (v) => v, null),
    department: optionsFrom(operators, (o) => o.department, (v) => v, "Not posted"),
    employer: optionsFrom(operators, (o) => o.employer, (v) => v, "Not recorded"),
    employment: optionsFrom(operators, (o) => o.employment_type,
      (v) => v[0] + v.slice(1).toLowerCase(), null),
    approval: optionsFrom(operators, (o) => o.approval_status,
      (v) => v.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), null),
  }), [operators]);


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return operators.filter((o) => {
      if (!matches(o.trade, by.trade)) return false;
      if (!matches(o.trade_group, by.group)) return false;
      if (!matches(o.department, by.department)) return false;
      if (!matches(o.employer, by.employer)) return false;
      if (!matches(o.employment_type, by.employment)) return false;
      if (!matches(o.approval_status, by.approval)) return false;
      if (!q) return true;
      // Everything the register shows about a person, plus the numbers that
      // identify one.
      //
      // The attendance id is the number written on everything else in the
      // mine — the muster, the gate, the face reader — and looking somebody up
      // by it is the commonest reason to open this screen. The mobile number
      // is how a supervisor identifies a man he cannot name: it is on the
      // contractor's list and on nothing else here.
      //
      // The rule is that a column you can see is a column you can search by.
      // Department, group and employer are on screen, and a search that
      // ignores them teaches people the box does not work.
      return matchesSearch(q, [
        o.display_name, o.operator_ref, o.attendance_id, o.biometric_id,
        o.phone,
        // A number given with the country code still finds the man whose
        // number is stored without it. Matching runs one way — does the field
        // contain what was typed — so the variant has to be on this side.
        o.phone ? `91${o.phone}` : null,
        o.designation, o.trade, o.trade_group, o.trade_machine, o.skill_class,
        o.department, o.plant, o.employer, o.blood_group,
      ]);
    });
  }, [operators, query, by]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const keyOf = (o: Operator): string | number => {
      switch (sort.key) {
        case "name":       return o.display_name.toLowerCase();
        // Numeric, so 17100 does not sort between 1710 and 172.
        case "attendance": return Number(o.attendance_id ?? Number.MAX_SAFE_INTEGER);
        case "trade":      return (o.trade ?? "").toLowerCase();
        case "department": return (o.department ?? "").toLowerCase();
        case "employer":   return (o.employer ?? "").toLowerCase();
        case "service":    return o.years_served ?? 0;
        case "assessed":   return o.last_assessed ? new Date(o.last_assessed).getTime() : 0;
        case "classes":    return o.machines_competent;
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

  const narrowed = Boolean(by.trade || by.group || by.department || by.employer
    || by.employment || by.approval || query.trim());

  const said = (menu: { value: string; label: string }[], v: string) =>
    menu.find((o) => o.value === v)?.label ?? v;

  const activeFilters: { label: string; clear: () => void }[] = [
    ...(by.group ? [{ label: said(menus.group, by.group), clear: () => setF("group")("") }] : []),
    ...(by.trade ? [{ label: said(menus.trade, by.trade), clear: () => setF("trade")("") }] : []),
    ...(by.department ? [{ label: said(menus.department, by.department),
                          clear: () => setF("department")("") }] : []),
    ...(by.employer ? [{ label: said(menus.employer, by.employer),
                         clear: () => setF("employer")("") }] : []),
    ...(by.employment ? [{ label: said(menus.employment, by.employment),
                           clear: () => setF("employment")("") }] : []),
    ...(by.approval ? [{ label: said(menus.approval, by.approval),
                         clear: () => setF("approval")("") }] : []),
    ...(query.trim() ? [{ label: `“${query.trim()}”`, clear: () => setQuery("") }] : []),
  ];

  const clearFilters = () => {
    setBy({ trade: "", group: "", department: "", employer: "", employment: "", approval: "" });
    setQuery("");
  };

  const pickedHere = useMemo(
    () => sorted.filter((o) => picked.has(o.operator_id)), [sorted, picked]);
  const allPicked = sorted.length > 0 && pickedHere.length === sorted.length;

  const pick = (o: Operator, shift: boolean) => {
    setPicked((was) => {
      const next = new Set(was);
      const at = sorted.findIndex((r) => r.operator_id === o.operator_id);
      const from = anchor.current === null
        ? at : sorted.findIndex((r) => r.operator_id === anchor.current);
      const span = shift && from >= 0 && at >= 0
        ? sorted.slice(Math.min(from, at), Math.max(from, at) + 1)
        : [o];
      const turningOn = !was.has(o.operator_id);
      for (const r of span) {
        if (turningOn) next.add(r.operator_id); else next.delete(r.operator_id);
      }
      return next;
    });
    anchor.current = o.operator_id;
  };

  const pickAll = () => {
    setPicked(allPicked ? new Set() : new Set(sorted.map((o) => o.operator_id)));
    anchor.current = null;
  };

  // Acting on people who have scrolled out of the filter is the bug that makes
  // bulk actions frightening, so narrowing the list drops whoever fell out.
  useEffect(() => {
    setPicked((was) => {
      if (was.size === 0) return was;
      const here = new Set(sorted.map((o) => o.operator_id));
      const kept = [...was].filter((id) => here.has(id));
      return kept.length === was.size ? was : new Set(kept);
    });
  }, [sorted]);

  const exportRegister = (rows: Operator[] = sorted) => {
    download(toCsv(
      ["Attendance ID", "Reference", "Name", "Trade", "Group", "Designation",
       "Machine", "Skill class", "Employment", "Employer", "Department",
       "Plant", "Joined", "Years served", "Age", "Classes cleared",
       "Last assessed", "Next due", "Approval"],
      rows.map((o) => [
        o.attendance_id ?? "", o.operator_ref ?? "", o.display_name,
        o.trade ?? "", o.trade_group ?? "", o.designation ?? "",
        o.trade_machine ?? "", o.skill_class ?? "", o.employment_type ?? "",
        o.employer ?? "", o.department ?? "", o.plant ?? "",
        (o.joined_on ?? "").slice(0, 10), o.years_served ?? "", o.age ?? "",
        o.machines_competent, (o.last_assessed ?? "").slice(0, 10),
        (o.next_due ?? "").slice(0, 10), o.approval_status,
      ])),
      `manpower-register-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const startRegister = () => {
    setPrefill({});
    setEditingId(null);
    onAddOpenChange?.(true);
  };

  if (formOpen) {
    return (
      <div className="pb-8">
          <OperatorForm
            operatorId={editingId ?? undefined}
            openAt={openAt}
            prefill={prefill}
            onSaved={() => { void load(); onChanged?.(); }}
            onDone={() => {
              onAddOpenChange?.(false); setEditingId(null); setPrefill({});
              void load(); onChanged?.();
            }}
            onCancel={() => { onAddOpenChange?.(false); setEditingId(null); setPrefill({});
                              setOpenAt(undefined); }} />
      </div>
    );
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      {view === "capability" && (
        <>
          <NeedsPanel needs={needs} onOpen={(operatorId, section) => {
            setOpenAt(section); setEditingId(operatorId);
          }} />
          <CapabilityView matrix={matrix} coverage={coverage} />
          {schedule && (
            <SchedulePanel schedule={schedule} disabled={!maySchedule} saving={savingSchedule}
              onSave={async (settings, classes) => {
                setSavingSchedule(true);
                try {
                  await api.put("/operators/meta/settings", { settings, classes });
                  const r = await api.get("/operators/meta/settings");
                  setSchedule(r.data);
                  await load();
                } catch (e: unknown) {
                  const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                  setError(d ?? "Could not change the schedule.");
                } finally { setSavingSchedule(false); }
              }} />
          )}
        </>
      )}

      {/* The register's own figures. Competency counts moved to Assessment,
          which is the tab that is about them. */}
      {view === "register" && summary && (
        <StatBar items={[
          { label: standing === "OFF_ROLL" ? "Off the rolls"
                 : standing === "ALL" ? "Ever registered" : "On strength",
            value: operators.length,
            tone: standing === "ON_ROLL" ? "sky" : "slate", icon: Users,
            hint: standing === "ON_ROLL"
              ? `${new Set(operators.map((o) => o.employer ?? "BAL")).size} employer(s)`
              : "change this in the bar above" },
          { label: "Approved", value: summary.approved ?? 0,
            tone: (summary.approved ?? 0) ? "emerald" : "amber", icon: Check,
            hint: `${operators.length - (summary.approved ?? 0)} still draft`,
            title: "Show only the approved records",
            onClick: () => setF("approval")(by.approval === "APPROVED" ? "" : "APPROVED"),
            active: by.approval === "APPROVED" },
          { label: "Awaiting approval", value: summary.awaiting ?? 0,
            tone: (summary.awaiting ?? 0) ? "amber" : "emerald", icon: ClipboardList,
            hint: "submitted, waiting on somebody",
            title: "Show only the submitted records",
            onClick: () => setF("approval")(by.approval === "SUBMITTED" ? "" : "SUBMITTED"),
            active: by.approval === "SUBMITTED" },
          { label: "Machine operators", value: operators.filter((o) => o.operates_equipment).length,
            tone: "emerald", icon: HardHat,
            hint: "the rest are trades and support" },
          { label: "Trades", value: new Set(operators.map((o) => o.trade).filter(Boolean)).size,
            tone: "violet", icon: Grid3x3, hint: "distinct jobs on the register" },
          { label: "Showing", value: sorted.length,
            tone: narrowed ? "gold" : "slate", icon: Search,
            hint: narrowed ? "after filters" : "no filters applied" },
        ]} />
      )}

      {view === "register" && (<>
      <Card tone="sky">
        <CardHeader title={`Operator register · ${filtered.length}`} icon={Users} tone="sky"
          subtitle="Everyone cleared to work on the mine's machines, and what they are cleared for."
          actions={
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
                <input id="op-search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, ID, mobile, trade, department…"
                  className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5 text-[12px]
                             text-txt-primary placeholder:text-txt-light focus:outline-none
                             focus:border-gold w-full sm:w-[320px] lg:w-[440px] xl:w-[520px]" />
              </div>
              <Button size="sm" variant="secondary" onClick={() => exportRegister()}
                disabled={sorted.length === 0}
                title="Download this list as a spreadsheet, filters and order and all">
                <Download className="w-3.5 h-3.5" /> Export
              </Button>
              {mayManage && (
                <Button size="sm" variant="primary" onClick={() => startRegister()}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              )}
            </>
          } />

        {picked.size > 0 && (
          <div className="px-5 py-2.5 border-b border-border-light bg-navy/[0.04]
                          flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[12.5px]
                             font-semibold text-navy">
              <CheckSquare className="w-3.5 h-3.5 text-gold-dark" />
              {picked.size} selected
            </span>
            {!allPicked && (
              <button type="button" onClick={pickAll}
                className="text-[11.5px] font-semibold text-gold-dark hover:underline
                           underline-offset-2">Select all {sorted.length}</button>
            )}
            <span className="flex-1" />
            <Button size="sm" variant="secondary"
              onClick={() => exportRegister(pickedHere)}>
              <Download className="w-3.5 h-3.5" /> Export these
            </Button>
            <button type="button"
              onClick={() => { setPicked(new Set()); anchor.current = null; }}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold
                         text-txt-muted hover:text-navy">
              <X className="w-3 h-3" /> Clear
            </button>
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="px-5 py-2.5 border-b border-border-light bg-bg-light/60
                          flex flex-wrap items-center gap-1.5">
            <span className="font-condensed text-[9.5px] font-bold uppercase
                             tracking-[.13em] text-txt-light mr-0.5">Showing only</span>
            {activeFilters.map((c) => (
              <button key={c.label} type="button" onClick={c.clear}
                className="group inline-flex items-center gap-1.5 rounded-full border
                           border-gold/40 bg-gold/[0.07] pl-2.5 pr-1.5 py-1 text-[11px]
                           font-semibold text-gold-dark hover:bg-gold/15 transition">
                {c.label}<X className="w-3 h-3 opacity-60 group-hover:opacity-100" />
              </button>
            ))}
            <button type="button" onClick={clearFilters}
              className="ml-1 text-[11px] font-semibold text-txt-muted hover:text-navy
                         underline underline-offset-2">Clear all</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr>
                {/* First, because it is the number the gate, the muster and
                    the face reader all know this person by, and looking
                    somebody up by it is the commonest reason to open this. */}
                <Th className="w-9 pr-0">
                  <input type="checkbox" aria-label="Select everyone in this list"
                    title={allPicked ? "Clear the selection" : "Select all in this list"}
                    checked={allPicked} onChange={pickAll}
                    className="accent-gold w-3.5 h-3.5 align-middle cursor-pointer" />
                </Th>
                <Th className="w-[86px]">
                  <SortHeader label="ID"
                    sort={sort.key === "attendance" ? sort.dir : null}
                    onSort={sortBy("attendance")} sortLabels={OP_SORT_WORDS.attendance} /></Th>
                <Th><SortHeader label="Person" sort={sort.key === "name" ? sort.dir : null}
                      onSort={sortBy("name")} sortLabels={OP_SORT_WORDS.name} /></Th>
                <Th className="hidden lg:table-cell w-[118px]">Mobile</Th>
                {/* Trade carries its group underneath rather than taking a
                    column of its own; the group filter still lives here. */}
                <Th><ColumnFilter label="Trade" value={by.trade} options={menus.trade}
                      onChange={setF("trade")} sort={sort.key === "trade" ? sort.dir : null}
                      onSort={sortBy("trade")} sortLabels={OP_SORT_WORDS.trade} /></Th>
                <Th className="hidden xl:table-cell">
                  <ColumnFilter label="Group" value={by.group} options={menus.group}
                    onChange={setF("group")} /></Th>
                <Th className="hidden md:table-cell">
                  <ColumnFilter label="Department" value={by.department}
                    options={menus.department} onChange={setF("department")}
                    sort={sort.key === "department" ? sort.dir : null}
                    onSort={sortBy("department")} sortLabels={OP_SORT_WORDS.department} /></Th>
                <Th><ColumnFilter label="Employer" value={by.employer}
                      options={menus.employer} onChange={setF("employer")}
                      sort={sort.key === "employer" ? sort.dir : null}
                      onSort={sortBy("employer")} sortLabels={OP_SORT_WORDS.employer} /></Th>
                <Th className="hidden xl:table-cell text-right w-[76px]">
                  <SortHeader label="Served" align="right"
                    sort={sort.key === "service" ? sort.dir : null}
                    onSort={sortBy("service")} sortLabels={OP_SORT_WORDS.service} /></Th>
                {/* Assessment lives on its own tab now. A register that leads
                    with three "not assessed" columns is a register arguing
                    about something else. */}
                <Th className="text-right w-[92px]">
                  <ColumnFilter label="Status" value={by.approval} align="right"
                    options={menus.approval} onChange={setF("approval")} /></Th>
                <Th className="text-right w-[52px]" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <EmptyRow colSpan={11}>
                  {operators.length === 0
                    ? "Nobody registered yet — start from the list below, those names are already in mine records."
                    : narrowed ? "Nobody matches that." : "Nobody on the register."}
                </EmptyRow>
              ) : sorted.map((o) => (
                <tr key={o.operator_id} className="hover:bg-bg-light transition-colors">
                  <Td className="pr-0">
                    <input type="checkbox" checked={picked.has(o.operator_id)}
                      aria-label={`Select ${o.display_name}`}
                      onChange={() => undefined}
                      onClick={(e) => pick(o, e.shiftKey)}
                      className="accent-gold w-3.5 h-3.5 align-middle cursor-pointer" />
                  </Td>
                  <Td className="font-mono text-[12px] font-bold text-violet">
                    {o.attendance_id
                      ?? <span className="text-txt-light font-normal text-[11px]">—</span>}
                  </Td>
                  <Td>
                    <button onClick={() => setEditingId(o.operator_id)} className="text-left group">
                      <div className="font-semibold text-navy text-[12.5px] leading-tight
                                      group-hover:text-gold-dark group-hover:underline
                                      underline-offset-2 transition-colors">
                        {o.display_name}
                      </div>
                      <div className="text-[10.5px] font-mono text-txt-light leading-tight mt-0.5">
                        {o.operator_ref}{o.age ? ` · ${o.age} yrs` : ""}
                      </div>
                    </button>
                  </Td>
                  <Td className="hidden lg:table-cell font-mono text-[12px] text-txt-secondary">
                    {o.phone || <span className="text-txt-light">—</span>}
                  </Td>
                  {/* The trade chip carried the employer's own words beneath
                      it, which on a Tipper Driver read "DRIVER-TIPPER" — the
                      same fact twice. It is on the profile, where it belongs
                      as evidence rather than as a second label. */}
                  <Td>
                    <Chip tone={o.operates_equipment ? "emerald" : "sky"} dot={false}>
                      {o.trade ?? "no trade"}
                    </Chip>
                  </Td>
                  <Td className="hidden xl:table-cell text-txt-muted whitespace-nowrap">
                    {o.trade_group ?? "—"}
                  </Td>
                  <Td className="hidden md:table-cell text-txt-muted">
                    <span className="block truncate max-w-[16ch]" title={o.department ?? ""}>
                      {o.department ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <Chip tone="amber" dot={false}>{o.employer ?? "BAL"}</Chip>
                    <span className="block text-[10.5px] text-txt-light mt-0.5">
                      {(o.employment_type ?? "").toLowerCase()}
                    </span>
                  </Td>
                  <Td className="hidden xl:table-cell text-right tabular-nums text-txt-muted
                                 whitespace-nowrap">
                    {o.years_served != null ? `${o.years_served} yr` : "—"}
                  </Td>
                  <Td className="text-right">
                    {/* Why this person is off the rolls, above the approval
                        state of their paperwork. Those are two different
                        things and the column used to show only the second, so
                        a man who died in January and a man who started on
                        Monday both read "draft" and nothing else. */}
                    {o.profile_status !== "ACTIVE" && (
                      <span className="block mb-0.5">
                        <Chip tone={o.profile_status === "SUSPENDED" ? "rose" : "slate"}>
                          {o.profile_status.toLowerCase()}
                        </Chip>
                        {o.employment_end && (
                          <span className="block text-[10px] text-txt-light">
                            {o.employment_end.slice(0, 10).split("-").reverse().join("-")}
                          </span>
                        )}
                      </span>
                    )}
                    <Chip tone={APPROVAL_TONE[o.approval_status] ?? "slate"}>
                      {o.approval_status.replace("_", " ").toLowerCase()}
                    </Chip>
                    {o.expired_documents > 0 && (
                      <span className="block text-[10.5px] text-rose font-semibold mt-0.5">
                        {o.expired_documents} expired
                      </span>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <button onClick={() => { setOpenAt(undefined); setEditingId(o.operator_id); }}
                      aria-label={`Open ${o.display_name}`}
                      className="p-1 text-txt-light hover:text-gold-dark transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      </>)}
    </div>
  );
}

/* ── what to do about each person, derived rather than typed ────────────── */
const URGENCY: Record<string, { label: string; tone: Tone }> = {
  NOW:       { label: "now",        tone: "rose" },
  SOON:      { label: "soon",       tone: "amber" },
  WHEN_ABLE: { label: "when able",  tone: "slate" },
};

function NeedsPanel({ needs, onOpen }: {
  needs: Need[];
  onOpen: (operatorId: number, section: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? needs : needs.filter((n) => n.urgency === "NOW");

  return (
    <Card tone="amber">
      <CardHeader title={`Training and action needed · ${needs.length}`} icon={GraduationCap} tone="amber"
        subtitle="Read from the register rather than kept by hand, so it cannot drift from the facts behind it. Each line says why it was raised."
        actions={needs.length > shown.length || showAll ? (
          <Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Only what is urgent" : `Show all ${needs.length}`}
          </Button>
        ) : undefined} />

      {shown.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
          {needs.length === 0
            ? "Nothing outstanding — every active operator has their documents, an assessment and a schedule."
            : "Nothing urgent. The rest can wait; press Show all to see them."}
        </div>
      ) : (
        <ul className="divide-y divide-border-light">
          {shown.map((n) => (
            <li key={n.operator_id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-semibold text-navy text-[13.5px]">{n.display_name}</span>
                  <span className="text-[11.5px] text-txt-light ml-2">
                    {n.designation || "role not set"}
                    {n.plant ? ` · ${n.plant}` : ""}
                  </span>
                  <ul className="mt-1.5 space-y-1">
                    {n.needs.map((x, i) => (
                      <li key={i} className="text-[12.5px] leading-snug">
                        <Chip tone={URGENCY[x.urgency]?.tone ?? "slate"} dot={false}>
                          {URGENCY[x.urgency]?.label ?? x.urgency}
                        </Chip>
                        <span className="font-medium text-txt-primary ml-2">{x.need}</span>
                        <span className="text-txt-muted"> — {x.because}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <span className="flex items-center gap-2 shrink-0">
                  {n.avg_rating && (
                    <Chip tone={n.avg_rating >= 4 ? "emerald" : n.avg_rating >= 3 ? "amber" : "rose"}
                          dot={false}>
                      ★ {n.avg_rating.toFixed(1)}
                    </Chip>
                  )}
                  <Button size="sm" variant="secondary"
                    onClick={() => onOpen(n.operator_id, "documents")}>
                    Documents
                  </Button>
                  <Button size="sm" variant="primary"
                    onClick={() => onOpen(n.operator_id, "competency")}>
                    <ShieldCheck className="w-3.5 h-3.5" /> Assess
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── how often the mine reassesses its people ───────────────────────────── */
function SchedulePanel({ schedule, disabled, saving, onSave }: {
  schedule: Schedule; disabled: boolean; saving: boolean;
  onSave: (settings: Record<string, number>, classes: Record<string, string>) => Promise<void>;
}) {
  const value = (key: string) =>
    schedule.settings.find((x) => x.key === key)?.value ?? "";

  const [interval, setInterval] = useState(value("assessment.interval_months"));
  const [window, setWindow] = useState(value("assessment.due_window_days"));
  const [backdate, setBackdate] = useState(value("assessment.backdate_limit_days"));
  const [classes, setClasses] = useState<Record<string, string>>(() =>
    Object.fromEntries(schedule.classes.map((c) =>
      [String(c.asset_type_id), c.assessment_interval_months?.toString() ?? ""])));

  const changed =
    interval !== value("assessment.interval_months")
    || window !== value("assessment.due_window_days")
    || backdate !== value("assessment.backdate_limit_days")
    || schedule.classes.some((c) =>
        (classes[String(c.asset_type_id)] ?? "") !== (c.assessment_interval_months?.toString() ?? ""));

  const updated = schedule.settings
    .map((x) => x.updated_at).sort().slice(-1)[0];

  return (
    <Card tone="slate">
      <CardHeader title="Assessment schedule" icon={Settings2} tone="slate"
        subtitle="How often people are reassessed, and how much warning the register gives. Changing it moves every future due date — the ones already set stay where they are."
        actions={!disabled && (
          <Button size="sm" variant="primary" disabled={!changed || saving}
            onClick={() => onSave(
              { "assessment.interval_months": Number(interval),
                "assessment.due_window_days": Number(window),
                "assessment.backdate_limit_days": Number(backdate) },
              classes)}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    : <><Check className="w-3.5 h-3.5" /> Save schedule</>}
          </Button>
        )} />

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {([
            ["Reassess every", interval, setInterval, "months",
             "The default. An equipment class can be set shorter or longer below."],
            ["Warn ahead by", window, setWindow, "days",
             "How long before the date it shows as due, so there is time to arrange it. Zero makes the date hard."],
            ["Allow backdating", backdate, setBackdate, "days",
             "How far back an assessment may be dated. Stops a register being caught up months later."],
          ] as const).map(([label, v, setV, unit, hint]) => (
            <label key={label} className="block">
              <span className="block text-[12px] font-semibold text-txt-secondary mb-1">{label}</span>
              <span className="flex items-center gap-2">
                <input type="number" min={0} max={120} value={v} disabled={disabled}
                  onChange={(e) => setV(e.target.value)}
                  className="w-20 bg-bg-base border border-border rounded-lg px-3 py-1.5
                             text-[13px] tabular-nums disabled:opacity-60" />
                <span className="text-[12px] text-txt-muted">{unit}</span>
              </span>
              <span className="block text-[11px] text-txt-light mt-1 leading-snug">{hint}</span>
            </label>
          ))}
        </div>

        <div>
          <div className="text-[12px] font-semibold text-txt-secondary mb-2">
            By equipment class
            <span className="font-normal text-txt-light ml-2">
              blank follows the default of {schedule.default_interval_months} months
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {schedule.classes.map((c) => (
              <label key={c.asset_type_id}
                className="inline-flex items-center gap-2 rounded-lg border border-border
                           bg-bg-light px-3 py-1.5 text-[12.5px]">
                <span className="text-txt-secondary">{c.name}</span>
                <input type="number" min={0} max={120} placeholder="—" disabled={disabled}
                  value={classes[String(c.asset_type_id)] ?? ""}
                  onChange={(e) => setClasses((prev) =>
                    ({ ...prev, [String(c.asset_type_id)]: e.target.value }))}
                  className="w-14 bg-bg-base border border-border rounded px-2 py-1
                             text-[12px] tabular-nums disabled:opacity-60" />
                <span className="text-txt-light">mo</span>
              </label>
            ))}
          </div>
        </div>

        {disabled && (
          <Alert tone="info">
            Changing how often the mine checks its operators is a decision about
            assurance rather than data entry, so it sits with the approval
            permission. You can see the schedule but not move it.
          </Alert>
        )}

        {updated && (
          <p className="text-[11.5px] text-txt-light">
            Last changed {String(updated).slice(0, 16).replace("T", " ")}.
            Every change is written to the activity log with both values.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ── how many people can run what ───────────────────────────────────────── */
const LEVEL_COLOUR = [
  "bg-bg-light text-txt-light",          // 0 not assessed
  "bg-rose-bg text-rose",                // 1 assisted
  "bg-amber-bg text-amber",              // 2 operational
  "bg-emerald-bg text-emerald",          // 3 independent
  "bg-violet-bg text-violet",            // 4 trainer
];

function CapabilityView({ matrix, coverage }: { matrix: Matrix | null; coverage: Coverage[] }) {
  if (!matrix) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>;
  }

  const held = coverage.filter((c) => c.holders > 0 || c.lapsed > 0);

  return (
    <div className="space-y-4">
      <Card tone="violet">
        <CardHeader title="Who can run what" icon={Grid3x3} tone="violet"
          subtitle="Assessed levels, nought to four. The count under each class is how many people are at level 2 or better with a current assessment — the number that decides whether a shift can be crewed." />
        {matrix.operators.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
            Nobody assessed yet. Levels set on an operator profile appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr>
                  <Th>Operator</Th>
                  {matrix.asset_types.map((t) => (
                    <Th key={t.asset_type_id} className="text-center">
                      <span className="block">{t.name}</span>
                      <span className="block text-[10px] font-normal text-violet">
                        {matrix.competent_per_type?.[String(t.asset_type_id)] ?? 0} can run
                      </span>
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.operators.map((o) => (
                  <tr key={o.operator_id} className="hover:bg-bg-light transition-colors">
                    <Td>
                      <span className="font-semibold text-navy text-[13px]">{o.name}</span>
                      {o.operator_ref && (
                        <span className="block font-mono text-[11px] text-violet">{o.operator_ref}</span>
                      )}
                    </Td>
                    {matrix.asset_types.map((t) => {
                      const cell = o.levels[String(t.asset_type_id)];
                      const lvl = cell?.level ?? 0;
                      return (
                        <td key={t.asset_type_id} className="px-2 py-2 text-center">
                          <span title={cell?.lapsed ? "Assessment has lapsed" : undefined}
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg
                                        text-[12px] font-bold ${LEVEL_COLOUR[lvl]}
                                        ${cell?.lapsed ? "ring-2 ring-rose-ring" : ""}`}>
                            {lvl || "—"}
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

      <Card tone="emerald">
        <CardHeader title="Qualifications held across the mine" icon={Award} tone="emerald"
          subtitle="Skill Council for Mining Sector qualification packs. Only those somebody holds are listed — the rest of the sixty are available on a profile." />
        {held.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
            No qualifications recorded yet. Until they are, nothing can say how thin
            the mine is on any given skill.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr><Th>Qualification</Th><Th>Code</Th><Th>NSQF</Th><Th>Equipment</Th>
                    <Th className="text-right">Holders</Th><Th className="text-right">Lapsed</Th></tr>
              </thead>
              <tbody>
                {held.map((c) => (
                  <tr key={c.skill_id} className="hover:bg-bg-light transition-colors">
                    <Td className="font-semibold text-navy">{c.name}</Td>
                    <Td className="font-mono text-[12px]">{c.code}</Td>
                    <Td>{c.nsqf_level ?? "—"}</Td>
                    <Td className="text-txt-muted">{c.asset_type ?? "—"}</Td>
                    <Td className="text-right">
                      <Chip tone={c.holders > 0 ? "emerald" : "slate"} dot={false}>{c.holders}</Chip>
                    </Td>
                    <Td className="text-right">
                      {c.lapsed > 0 ? <Chip tone="rose" dot={false}>{c.lapsed}</Chip>
                                    : <span className="text-txt-light">—</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
