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
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, Td, Th, Tile, type Tone,
} from "./ui";
import OperatorForm from "./OperatorForm";

interface Operator {
  operator_id: number; operator_ref: string | null; display_name: string;
  approval_status: string; profile_status: string; employment_type: string | null;
  designation: string | null; phone: string | null; blood_group: string | null;
  employer: string | null; department: string | null; plant: string | null;
  exp_total_months: number | null; exp_hemm_months: number | null;
  machines_competent: number; expired_documents: number; assigned_to: string | null;
  last_assessed: string | null; last_assessed_by: string | null; next_due: string | null;
}

interface Due {
  operator_id: number; operator_ref: string | null; display_name: string;
  designation: string | null; asset_type: string | null; fleet_code: string | null;
  level: number | null; rating: number | null; assessed_on: string | null;
  last_assessed_by_name: string | null; next_assessment_due: string;
  days_left: number;
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
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, queue, sum, pl, dueList] = await Promise.all([
        api.get("/operators", { params: plantId ? { plant_id: plantId } : {} }),
        api.get("/operators/unregistered"),
        api.get("/operators/summary"),
        api.get("/minehub/plants").catch(() => ({ data: [] })),
        api.get("/operators/meta/due").catch(() => ({ data: [] })),
      ]);
      setOperators(list.data ?? []);
      setWaiting(queue.data ?? []);
      setSummary(sum.data ?? null);
      setPlants(pl.data ?? []);
      setDue(dueList.data ?? []);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return operators;
    return operators.filter((o) => [o.display_name, o.operator_ref, o.designation, o.employer]
      .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [operators, query]);

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
                hint="machine classes people can run" />
          <Tile label="Expiring" value={(summary.expired ?? 0) + (summary.due ?? 0)}
                tone={summary.expired ? "rose" : summary.due ? "amber" : "emerald"}
                icon={AlertTriangle}
                hint={`${summary.expired ?? 0} already expired`} />
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
              {mayManage && (
                <Button size="sm" variant="primary" onClick={() => startRegister()}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              )}
            </>
          } />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr>
                <Th>Operator</Th><Th>Employment</Th><Th>Can run</Th>
                <Th>Last assessed</Th><Th>Next due</Th>
                <Th className="text-right">Status</Th><Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={7}>
                  {operators.length === 0
                    ? "Nobody registered yet — start from the list below, those names are already in mine records."
                    : "Nobody matches that search."}
                </EmptyRow>
              ) : filtered.map((o) => (
                <tr key={o.operator_id} className="hover:bg-bg-light transition-colors">
                  <Td>
                    <button onClick={() => setEditingId(o.operator_id)} className="text-left group">
                      <div className="font-semibold text-navy text-[13px] group-hover:text-gold-dark
                                      group-hover:underline underline-offset-2 transition-colors">
                        {o.display_name}
                      </div>
                      <div className="text-[11px] font-mono text-txt-light flex flex-wrap items-center gap-1.5">
                        {o.operator_ref && <span className="text-violet font-bold">{o.operator_ref}</span>}
                        <span>{o.designation || "role not set"}</span>
                      </div>
                    </button>
                  </Td>
                  <Td>
                    <Chip tone={EMPLOYMENT_TONE[o.employment_type ?? "OTHER"] ?? "slate"} dot={false}>
                      {(o.employment_type ?? "—").toLowerCase()}
                    </Chip>
                    {o.employer && (
                      <span className="text-[11.5px] text-txt-muted ml-2">{o.employer}</span>
                    )}
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
