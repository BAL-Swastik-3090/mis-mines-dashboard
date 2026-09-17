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
  ClipboardList, Pencil, Grid3x3, Award,
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

  const [operators, setOperators] = useState<Operator[]>([]);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [prefill, setPrefill] = useState<{ display_name?: string; code?: string }>({});
  const [allWaiting, setAllWaiting] = useState(false);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState<string>("");
  const [view, setView] = useState<"register" | "capability">("register");
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, queue, sum, pl] = await Promise.all([
        api.get("/operators", { params: plantId ? { plant_id: plantId } : {} }),
        api.get("/operators/unregistered"),
        api.get("/operators/summary"),
        api.get("/minehub/plants").catch(() => ({ data: [] })),
      ]);
      setOperators(list.data ?? []);
      setWaiting(queue.data ?? []);
      setSummary(sum.data ?? null);
      setPlants(pl.data ?? []);
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
        const [m, c] = await Promise.all([
          api.get("/operators/matrix", { params: plantId ? { plant_id: plantId } : {} }),
          api.get("/operators/meta/skill-coverage"),
        ]);
        setMatrix(m.data ?? null);
        setCoverage(c.data ?? []);
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
            prefill={prefill}
            onSaved={() => { void load(); onChanged?.(); }}
            onDone={() => {
              onAddOpenChange?.(false); setEditingId(null); setPrefill({});
              void load(); onChanged?.();
            }}
            onCancel={() => { onAddOpenChange?.(false); setEditingId(null); setPrefill({}); }} />
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
        <CapabilityView matrix={matrix} coverage={coverage} />
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
                <Th>Operator</Th><Th>Employment</Th><Th>Experience</Th>
                <Th>Can run</Th><Th>Assigned to</Th><Th className="text-right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={6}>
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
                  <Td className="tabular-nums text-txt-secondary">
                    {years(o.exp_hemm_months)}
                    <span className="text-[11px] text-txt-light ml-1">HEMM</span>
                  </Td>
                  <Td>
                    {o.machines_competent > 0 ? (
                      <Chip tone="violet" dot={false}>
                        {o.machines_competent} class{o.machines_competent === 1 ? "" : "es"}
                      </Chip>
                    ) : <span className="text-[12px] text-txt-light">not assessed</span>}
                  </Td>
                  <Td className="font-mono text-[12px] text-txt-secondary">{o.assigned_to || "—"}</Td>
                  <Td className="text-right">
                    <span className="inline-flex items-center gap-1.5 justify-end flex-wrap">
                      {o.expired_documents > 0 && (
                        <Chip tone="rose">{o.expired_documents} expired</Chip>
                      )}
                      <Chip tone={APPROVAL_TONE[o.approval_status] ?? "slate"}>
                        {o.approval_status.replace("_", " ").toLowerCase()}
                      </Chip>
                      {mayManage && (
                        <button onClick={() => setEditingId(o.operator_id)}
                          aria-label={`Open ${o.display_name}`}
                          className="p-1 text-txt-light hover:text-gold-dark transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </span>
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
