"use client";
/**
 * The people who run the machines.
 *
 * The register first, then the queue of people the mine's own records name who
 * have no profile here yet — the same arrangement as equipment, for the same
 * reason: the register is what the screen is for, the queue is work to get
 * through.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, Search, Plus, Loader2, HardHat, ShieldCheck, AlertTriangle,
  ClipboardList, Pencil, Grid3x3, Award, CalendarClock, Settings2, Check,
  GraduationCap, TrendingUp, TrendingDown, Star, Download, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, Td, Th, Tile, type Tone,
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

interface Plant { plant_id: number; code: string; name: string; is_default: boolean }

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

interface Waiting {
  name: string; code: string | null; machine: string | null;
  grade: string | null; last_seen: string | null; source: string;
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

export default function OperatorPanel({ addOpen, onAddOpenChange, onFormOpenChange, onChanged }: {
  addOpen?: boolean;
  onAddOpenChange?: (v: boolean) => void;
  onFormOpenChange?: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const can = useAuth((s) => s.can);
  const mayManage = can("platform.operators.manage");
  const mayAssess = can("platform.operators.assess");
  const maySchedule = can("platform.operators.approve");

  const [operators, setOperators] = useState<Operator[]>([]);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
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
  const [allWaiting, setAllWaiting] = useState(false);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState<string>("");
  const [view, setView] = useState<"register" | "capability">("register");
  // Every column both filters and orders, as the machine register does. With
  // 211 people the difference between "find the excavator operators in
  // Automobile" and "scroll" is the difference between a register and a list.
  const [by, setBy] = useState({ trade: "", group: "", department: "",
                                 employer: "", employment: "", approval: "" });
  const setF = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));
  const [sort, setSort] = useState<{ key: OpSortKey; dir: SortDir }>(
    { key: "name", dir: "asc" });
  const sortBy = (key: OpSortKey) => (dir: SortDir) => setSort({ key, dir });
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [needs, setNeeds] = useState<Need[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, queue, sum, pl, dueList, needList] = await Promise.all([
        api.get("/operators", { params: plantId ? { plant_id: plantId } : {} }),
        api.get("/operators/unregistered"),
        api.get("/operators/summary"),
        api.get("/minehub/plants").catch(() => ({ data: [] })),
        api.get("/operators/meta/due").catch(() => ({ data: [] })),
        api.get("/operators/meta/training-needs").catch(() => ({ data: [] })),
      ]);
      setOperators(list.data ?? []);
      setWaiting(queue.data ?? []);
      setSummary(sum.data ?? null);
      setPlants(pl.data ?? []);
      setDue(dueList.data ?? []);
      setNeeds(needList.data ?? []);
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load the operator register.");
    } finally { setLoading(false); }
  }, [plantId]);

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
      // The attendance id is searched because it is the number written on
      // everything else in the mine, and looking somebody up by it is the
      // commonest reason to open this screen.
      return [o.display_name, o.operator_ref, o.attendance_id, o.designation,
              o.trade, o.employer]
        .some((v) => (v ?? "").toLowerCase().includes(q));
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

  const exportRegister = () => {
    download(toCsv(
      ["Attendance ID", "Reference", "Name", "Trade", "Group", "Designation",
       "Machine", "Skill class", "Employment", "Employer", "Department",
       "Plant", "Joined", "Years served", "Age", "Classes cleared",
       "Last assessed", "Next due", "Approval"],
      sorted.map((o) => [
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

  const startRegister = (from?: Waiting) => {
    setPrefill(from ? { display_name: from.name, code: from.code ?? undefined } : {});
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5 p-1 bg-bg-section rounded-xl w-fit">
          {([["register", "Register", Users], ["capability", "Capability", Grid3x3]] as const)
            .map(([key, label, Icon]) => (
            <button key={key} onClick={() => setView(key)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold
                          transition-colors
                          ${view === key ? "bg-bg-base text-navy shadow-sm" : "text-txt-muted hover:text-navy"}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-[12px] text-txt-muted">
          Plant
          <select value={plantId} onChange={(e) => setPlantId(e.target.value)}
            className="bg-bg-base border border-border rounded-lg px-3 py-1.5 text-[12.5px] text-txt-primary">
            <option value="">All plants</option>
            {plants.map((p) => (
              <option key={p.plant_id} value={p.plant_id}>{p.code} · {p.name}</option>
            ))}
          </select>
        </label>
      </div>

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

      {view === "register" && summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Operators" value={summary.operators ?? 0} tone="sky" icon={Users}
                hint={`${summary.approved ?? 0} approved`} />
          <Tile label="Awaiting approval" value={summary.awaiting ?? 0}
                tone={summary.awaiting ? "amber" : "emerald"} icon={ClipboardList}
                hint="submitted profiles" />
          <Tile label="Competencies" value={summary.competencies ?? 0} tone="violet" icon={ShieldCheck}
                hint={summary.avg_rating
                  ? `${summary.avg_rating} of 5 average expertise`
                  : "machine classes people can run"} />
          <Tile label="Needs action" value={needs.filter((n) => n.urgency === "NOW").length}
                tone={needs.some((n) => n.urgency === "NOW") ? "rose" : "emerald"}
                icon={GraduationCap} onClick={() => setView("capability")}
                hint={summary.declined
                  ? `${summary.declined} fell at last assessment`
                  : `${(summary.expired ?? 0) + (summary.due ?? 0)} documents expiring`} />
        </div>
      )}

      {view === "register" && due.length > 0 && (
        <Card tone="amber">
          <CardHeader title={`${due.length} assessment${due.length === 1 ? "" : "s"} due`}
            icon={CalendarClock} tone="amber"
            subtitle="Overdue first. The register says who is on the books; this says what has to happen this month." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr><Th>Operator</Th><Th>On</Th><Th>Last assessed</Th>
                    <Th>Due</Th><Th className="text-right">Action</Th></tr>
              </thead>
              <tbody>
                {due.map((d) => (
                  <tr key={`${d.operator_id}-${d.asset_type}-${d.fleet_code ?? ""}`}
                      className="hover:bg-bg-light transition-colors">
                    <Td>
                      <span className="font-semibold text-navy">{d.display_name}</span>
                      {d.operator_ref && (
                        <span className="block font-mono text-[11px] text-violet">{d.operator_ref}</span>
                      )}
                    </Td>
                    <Td className="text-txt-secondary">
                      {d.fleet_code ?? d.asset_type ?? "—"}
                      {d.level !== null && (
                        <span className="text-[11px] text-txt-light ml-1.5">L{d.level}</span>
                      )}
                    </Td>
                    <Td>
                      <span className="tabular-nums text-[12.5px]">{d.assessed_on ?? "—"}</span>
                      {d.last_assessed_by_name && (
                        <span className="block text-[11px] text-txt-light">
                          by {d.last_assessed_by_name}
                        </span>
                      )}
                    </Td>
                    <Td>{dueChip(d.next_assessment_due)}</Td>
                    <Td className="text-right">
                      {mayAssess && (
                        <Button size="sm" variant="primary"
                          onClick={() => { setOpenAt("competency"); setEditingId(d.operator_id); }}>
                          <ShieldCheck className="w-3.5 h-3.5" /> Assess now
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
                  placeholder="Name, reference, role…"
                  className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5 text-[12px]
                             text-txt-primary placeholder:text-txt-light focus:outline-none
                             focus:border-gold w-[190px]" />
              </div>
              <Button size="sm" variant="secondary" onClick={exportRegister}
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
                <Th className="w-[104px]">
                  <SortHeader label="Attendance ID"
                    sort={sort.key === "attendance" ? sort.dir : null}
                    onSort={sortBy("attendance")} sortLabels={OP_SORT_WORDS.attendance} /></Th>
                <Th><SortHeader label="Person" sort={sort.key === "name" ? sort.dir : null}
                      onSort={sortBy("name")} sortLabels={OP_SORT_WORDS.name} /></Th>
                <Th><ColumnFilter label="Trade" value={by.trade} options={menus.trade}
                      onChange={setF("trade")} sort={sort.key === "trade" ? sort.dir : null}
                      onSort={sortBy("trade")} sortLabels={OP_SORT_WORDS.trade} /></Th>
                <Th className="hidden xl:table-cell">
                  <ColumnFilter label="Group" value={by.group} options={menus.group}
                    onChange={setF("group")} /></Th>
                <Th><ColumnFilter label="Employment" value={by.employment}
                      options={menus.employment} onChange={setF("employment")} /></Th>
                <Th className="hidden lg:table-cell">
                  <ColumnFilter label="Department" value={by.department}
                    options={menus.department} onChange={setF("department")}
                    sort={sort.key === "department" ? sort.dir : null}
                    onSort={sortBy("department")} sortLabels={OP_SORT_WORDS.department} /></Th>
                <Th className="hidden xl:table-cell text-right">
                  <SortHeader label="Served" align="right"
                    sort={sort.key === "service" ? sort.dir : null}
                    onSort={sortBy("service")} sortLabels={OP_SORT_WORDS.service} /></Th>
                <Th><SortHeader label="Can run" sort={sort.key === "classes" ? sort.dir : null}
                      onSort={sortBy("classes")} sortLabels={OP_SORT_WORDS.classes} /></Th>
                <Th className="hidden lg:table-cell">
                  <SortHeader label="Last assessed"
                    sort={sort.key === "assessed" ? sort.dir : null}
                    onSort={sortBy("assessed")} sortLabels={OP_SORT_WORDS.assessed} /></Th>
                <Th className="hidden lg:table-cell">Next due</Th>
                <Th className="text-right">
                  <ColumnFilter label="Status" value={by.approval} align="right"
                    options={menus.approval} onChange={setF("approval")} /></Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <EmptyRow colSpan={12}>
                  {operators.length === 0
                    ? "Nobody registered yet — start from the list below, those names are already in mine records."
                    : narrowed ? "Nobody matches that." : "Nobody on the register."}
                </EmptyRow>
              ) : sorted.map((o) => (
                <tr key={o.operator_id} className="hover:bg-bg-light transition-colors">
                  <Td className="font-mono text-[12px] font-bold text-violet">
                    {o.attendance_id
                      ?? <span className="text-txt-light font-normal text-[11.5px]">not linked</span>}
                  </Td>
                  <Td>
                    <button onClick={() => setEditingId(o.operator_id)} className="text-left group">
                      <div className="font-semibold text-navy text-[13px] group-hover:text-gold-dark
                                      group-hover:underline underline-offset-2 transition-colors">
                        {o.display_name}
                      </div>
                      <div className="text-[11px] font-mono text-txt-light flex flex-wrap items-center gap-1.5">
                        {o.operator_ref && <span className="text-violet font-bold">{o.operator_ref}</span>}
                        {o.age ? <span>{o.age} yrs</span> : null}
                      </div>
                    </button>
                  </Td>
                  {/* The classified job, with what the employer actually wrote
                      underneath: the second is evidence about their paperwork
                      and the first is the thing anything hangs off. */}
                  <Td>
                    <Chip tone={o.operates_equipment ? "emerald" : "sky"} dot={false}>
                      {o.trade ?? "no trade"}
                    </Chip>
                    {o.designation && o.designation.toUpperCase() !== (o.trade ?? "").toUpperCase() && (
                      <span className="block text-[10.5px] font-mono text-txt-light mt-0.5
                                       truncate max-w-[20ch]" title={o.designation}>
                        {o.designation}
                      </span>
                    )}
                  </Td>
                  <Td className="hidden xl:table-cell text-txt-muted">{o.trade_group ?? "—"}</Td>
                  <Td>
                    <Chip tone={EMPLOYMENT_TONE[o.employment_type ?? "OTHER"] ?? "slate"} dot={false}>
                      {(o.employment_type ?? "—").toLowerCase()}
                    </Chip>
                    {o.employer && (
                      <span className="block text-[11.5px] text-txt-muted mt-0.5">{o.employer}</span>
                    )}
                  </Td>
                  <Td className="hidden lg:table-cell text-txt-muted">{o.department ?? "—"}</Td>
                  <Td className="hidden xl:table-cell text-right tabular-nums text-txt-muted">
                    {o.years_served != null ? `${o.years_served} yr` : "—"}
                  </Td>
                  <Td>
                    {o.machines_competent > 0 ? (
                      <Chip tone="violet" dot={false}>
                        {o.machines_competent} class{o.machines_competent === 1 ? "" : "es"}
                      </Chip>
                    ) : <span className="text-[12px] text-txt-light">not assessed</span>}
                    {o.assigned_to && (
                      <span className="block font-mono text-[11px] text-txt-light mt-0.5">
                        on {o.assigned_to}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {o.last_assessed ? (
                      <>
                        <span className="text-[12.5px] tabular-nums text-txt-secondary">
                          {o.last_assessed}
                        </span>
                        {(o.declined_count > 0 || o.improved_count > 0) && (
                          <span className="inline-flex items-center gap-1 ml-1.5 align-middle">
                            {o.declined_count > 0 && (
                              <span title={`${o.declined_count} level(s) fell at the last assessment`}
                                className="inline-flex items-center gap-0.5 text-[11px] font-bold text-rose">
                                <TrendingDown className="w-3 h-3" />{o.declined_count}
                              </span>
                            )}
                            {o.improved_count > 0 && (
                              <span title={`${o.improved_count} level(s) rose at the last assessment`}
                                className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald">
                                <TrendingUp className="w-3 h-3" />{o.improved_count}
                              </span>
                            )}
                          </span>
                        )}
                        {o.avg_rating && (
                          <span title="Average expertise rating"
                            className="inline-flex items-center gap-0.5 ml-1.5 text-[11px] font-bold text-gold-dark">
                            <Star className="w-3 h-3 fill-current" />{o.avg_rating}
                          </span>
                        )}
                        {o.last_assessed_by && (
                          <span className="block text-[11px] text-txt-light">
                            by {o.last_assessed_by}
                          </span>
                        )}
                      </>
                    ) : <span className="text-[12px] text-txt-light">never</span>}
                  </Td>
                  <Td>{dueChip(o.next_due)}</Td>
                  <Td className="text-right">
                    <span className="inline-flex items-center gap-1.5 justify-end flex-wrap">
                      {o.expired_documents > 0 && (
                        <Chip tone="rose">{o.expired_documents} expired</Chip>
                      )}
                      <Chip tone={APPROVAL_TONE[o.approval_status] ?? "slate"}>
                        {o.approval_status.replace("_", " ").toLowerCase()}
                      </Chip>
                    </span>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {mayAssess && (
                      <Button size="sm" variant="secondary"
                        onClick={() => { setOpenAt("competency"); setEditingId(o.operator_id); }}>
                        <ShieldCheck className="w-3.5 h-3.5" /> Assess
                      </Button>
                    )}
                    <button onClick={() => { setOpenAt(undefined); setEditingId(o.operator_id); }}
                      aria-label={`Open ${o.display_name}`}
                      className="ml-1.5 p-1 text-txt-light hover:text-gold-dark transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* The queue */}
      {waiting.length > 0 && (
        <Card tone="amber">
          <CardHeader title={`${waiting.length} people in mine records with no profile`}
            icon={HardHat} tone="amber"
            subtitle="From the driver master. Registering one carries their name and code into the form, so the list is worked through rather than imported blind."
            actions={waiting.length > 8 && (
              <Button size="sm" variant="secondary" onClick={() => setAllWaiting((v) => !v)}>
                {allWaiting ? "Show fewer" : `Show all ${waiting.length}`}
              </Button>
            )} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr><Th>Name</Th><Th>Code</Th><Th>Recorded against</Th>
                    <Th>Last seen</Th><Th className="text-right">Action</Th></tr>
              </thead>
              <tbody>
                {(allWaiting ? waiting : waiting.slice(0, 8)).map((w, i) => (
                  <tr key={`${w.code ?? w.name}-${i}`} className="hover:bg-bg-light transition-colors">
                    <Td className="font-semibold text-navy">{w.name}</Td>
                    <Td className="font-mono text-[12px]">
                      {w.code ?? <span className="text-rose">no code</span>}
                    </Td>
                    <Td className="text-txt-muted font-mono text-[12px]">{w.machine || "—"}</Td>
                    <Td className="text-txt-muted">{String(w.last_seen ?? "").slice(0, 10)}</Td>
                    <Td className="text-right">
                      {mayManage && (
                        <Button size="sm" variant="primary" onClick={() => startRegister(w)}>
                          <Plus className="w-3.5 h-3.5" /> Register
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!allWaiting && waiting.length > 8 && (
            <button type="button" onClick={() => setAllWaiting(true)}
              className="w-full px-5 py-3 text-[12.5px] font-semibold text-gold-dark
                         border-t border-border-light hover:bg-gold/[0.05] transition-colors">
              {waiting.length - 8} more waiting
            </button>
          )}
        </Card>
      )}
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
