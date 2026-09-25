"use client";
/**
 * Capacity — what the fleet can move today, and what is stopping it.
 *
 * This replaces a workbook, and it is built to be argued with rather than
 * quoted. Every number on it is derived from parameters that are on the
 * screen and editable, because a capacity figure nobody can take apart is a
 * capacity figure nobody believes.
 *
 * THE ONE LINE THAT MATTERS
 *
 *   effective at a face = MIN(what the excavator can dig,
 *                             what the tippers under it can carry away)
 *
 * WHY THE ANSWER IS NOT A TOTAL
 *
 * The workbook totals excavator capacity against tipper capacity across the
 * whole mine, and concludes there is no shortage — total tipper capacity does
 * exceed total excavator capacity. That is true and it is useless. What is
 * actually happening is that some faces have more trucks than they can load
 * and others have fewer, so the answer is nearly always to move trucks rather
 * than to buy them. This screen leads with which faces and how many.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Gauge, Loader2, Truck, Settings2, AlertTriangle, ArrowRight,
  TrendingDown, Boxes, Copy, X, Plus,
} from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { useDateFilter } from "@/contexts/useDateFilter";
import {
  Card, CardHeader, Chip, EmptyRow, Td, Th, Button, PageHeader, Tabs,
  inputClass, type Tone,
} from "@/components/minehub/ui";
import SearchSelect from "@/components/minehub/SearchSelect";

interface Face {
  face_plan_id: number; asset_id: number; fleet_code: string;
  plan_name: string | null; location: string; material: string;
  running_hours: number; tippers: number; tipper_class: string | null;
  bucket_cum: number; bucket_is_fitted: boolean;
  cycle_sec: number; cycle_is_overridden: boolean;
  cum_per_hour: number; excavator_cum_day: number; tipper_cum_day: number;
  effective_cum_day: number; limited_by: string; lost_cum_day: number;
}
interface Where {
  fleet_code: string; location: string; material: string;
  gap_cum_day: number; tippers_short?: number; tippers_spare?: number;
}
interface Summary {
  excavator_cum_day: number; tipper_cum_day: number; effective_cum_day: number;
  lost_cum_day: number; tippers_deployed: number; tippers_needed: number;
  tippers_spare: number; short_of_tippers: Where[]; short_of_digging: Where[];
  by_material: Record<string, number>; ore_mt: number;
}
interface TipperClass {
  tipper_class_id: number; code: string; label: string; payload_t: number;
  effective_cum: number; loading_min: number; travel_min: number;
  cycle_min: number; trips_per_hour: number; trips_per_day: number;
  cum_per_day: number;
}
interface Machine {
  asset_id: number; fleet_code: string; nickname: string | null;
  ownership: string | null; plan_name: string | null;
  standard_bucket: number | null; capacity_uom: string | null;
  fitted_bucket_cum: number | null; bucket_used: number | null;
  bucket_is_fitted: boolean; fill_factor: number; swell_factor: number;
  cycle_sec: number; cycles_per_hour: number; cum_per_scoop: number;
  cum_per_hour: number; cycle_is_overridden: boolean;
  override_reason: string | null; needs_bucket: boolean;
}
interface Assumptions {
  productivity_assumption_id: number;
  fill_factor: number; swell_factor: number;
  dig_sec: number; lift_sec: number; swing_sec: number; lower_sec: number;
  tilt_sec: number; wait_sec: number; unload_sec: number; return_sec: number;
  operating_hours: number; ore_t_per_cum: number;
  cycle_sec: number; cycles_per_hour: number; overrides: number;
}
interface Quality {
  no_bucket: { fleet_code: string; nickname: string | null; ownership: string | null }[];
  same_machine_twice: { ex: string; rows: { asset_id: number; fleet_code: string;
    nickname: string | null; make: string | null }[] }[];
  not_in_the_plan: { fleet_code: string; nickname: string | null }[];
  plan_names_with_no_machine: string[];
}

const LIMIT_TONE: Record<string, Tone> = {
  TIPPERS: "amber", EXCAVATOR: "sky", NEITHER: "emerald",
};
const LIMIT_WORD: Record<string, string> = {
  TIPPERS: "short of trucks", EXCAVATOR: "trucks to spare", NEITHER: "matched",
};

function Cum({ v, bold }: { v: number; bold?: boolean }) {
  return (
    <span className={`font-mono tabular-nums ${bold ? "font-bold text-navy" : "text-txt-primary"}`}>
      {formatIndian(Math.round(v * 100) / 100)}
    </span>
  );
}

type TabId = "plan" | "machines" | "model";

export default function CapacitySection() {
  const day = useDateFilter((s) => s.apiTo);
  const [tab, setTab] = useState<TabId>("plan");
  const [faces, setFaces] = useState<Face[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [classes, setClasses] = useState<TipperClass[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [model, setModel] = useState<Assumptions | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m, a, q] = await Promise.all([
        api.get("/productivity/plan", { params: { on: day } }),
        api.get("/productivity/machines"),
        api.get("/productivity/assumptions"),
        api.get("/productivity/data-quality").catch(() => ({ data: null })),
      ]);
      // The API is a claim, not a guarantee: a missing faces array would
      // otherwise take the whole page down on .map.
      setFaces(p.data?.faces ?? []);
      setSummary(p.data?.summary ?? null);
      setClasses(p.data?.tipper_classes ?? []);
      setMachines(m.data ?? []);
      setModel(a.data ?? null);
      setQuality(q.data ?? null);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => { void load(); }, [load]);

  /** Change one number on a face and reload. The reload is the point — every
   *  total on the screen moves, which is what makes this a calculator rather
   *  than a table. */
  const edit = async (id: number, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.put(`/productivity/plan/${id}`, patch);
      await load();
    } finally { setBusy(false); }
  };

  const setBucket = async (assetId: number, cum: number | null) => {
    setBusy(true);
    try {
      await api.put(`/productivity/machines/${assetId}/bucket`,
        { fitted_bucket_cum: cum });
      await load();
    } finally { setBusy(false); }
  };

  const saveModel = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.put("/productivity/assumptions", patch);
      await load();
    } finally { setBusy(false); }
  };

  const problems = useMemo(() => {
    if (!quality) return 0;
    return quality.no_bucket.length + quality.same_machine_twice.length
      + quality.plan_names_with_no_machine.length;
  }, [quality]);

  const TABS = [
    { id: "plan", label: "Today's faces", icon: Truck, tone: "gold" as Tone,
      hint: "Where each excavator is, how long it works and how many trucks are under it." },
    { id: "machines", label: "Machines", icon: Boxes, tone: "sky" as Tone,
      hint: "The bucket each machine is running, and what that comes to per hour." },
    { id: "model", label: "The model", icon: Settings2, tone: "violet" as Tone,
      hint: "Fill factor, swell and the eight parts of a cycle. Change one and every figure moves." },
  ];
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="py-6 space-y-5 max-w-[1500px]">
      <PageHeader
        lead="Capa" rest="city" joined tone="gold" icon={Gauge} tuck
        subtitle={active?.hint}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-gold" />}
            <span className="text-[12px] text-txt-muted">
              {day.split("-").reverse().join("-")}
              <span className="text-[10px] text-txt-light ml-1">
                · from the date at the top
              </span>
            </span>
          </span>
        } />

      {/* ── the answer, before the working ──────────────────────────────── */}
      {summary && (
        <Card>
          <div className="grid md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border-light">
            {([
              ["Effective excavation", summary.effective_cum_day, "Cum/day",
               "what actually moves — the smaller of the two sides, at every face"],
              ["Excavator capacity", summary.excavator_cum_day, "Cum/day",
               "what the machines could dig if trucks were never the limit"],
              ["Tipper capacity", summary.tipper_cum_day, "Cum/day",
               `${summary.tippers_deployed} trucks, where they are standing today`],
              ["Not moved", summary.lost_cum_day, "Cum/day",
               "digging capacity with no truck under it"],
            ] as const).map(([label, value, uom, hint], i) => (
              <div key={label} className="px-4 py-3">
                <div className={`text-[22px] font-bold tabular-nums ${
                  i === 0 ? "text-navy" : i === 3 ? "text-amber" : "text-txt-primary"}`}>
                  {formatIndian(Math.round(value))}
                  <span className="text-[11px] font-normal text-txt-light ml-1">{uom}</span>
                </div>
                <div className="text-[11.5px] font-semibold text-txt-secondary">{label}</div>
                <div className="text-[10.5px] text-txt-light leading-snug mt-0.5">{hint}</div>
              </div>
            ))}
          </div>

          {/* The part the workbook's total hides. Trucks standing where they
              cannot be loaded, against faces that could use them. */}
          {(summary.short_of_tippers.length > 0 || summary.short_of_digging.length > 0) && (
            <div className="border-t border-border-light px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-amber" />
                <span className="text-[12.5px] font-bold text-navy">
                  {summary.tippers_needed > 0 && summary.tippers_spare > 0
                    ? `${Math.min(summary.tippers_needed, summary.tippers_spare)} truck`
                      + `${Math.min(summary.tippers_needed, summary.tippers_spare) === 1 ? "" : "s"}`
                      + " could be moved rather than hired"
                    : "Where the two sides disagree"}
                </span>
                <span className="text-[11px] text-txt-light">
                  {summary.tippers_needed} needed · {summary.tippers_spare} standing spare
                </span>
              </div>
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                <div>
                  {summary.short_of_tippers.map((w) => (
                    <div key={`${w.fleet_code}-${w.location}`}
                      className="flex items-center justify-between gap-2 text-[11.5px] py-0.5">
                      <span className="min-w-0 truncate">
                        <Chip tone="amber" dot={false}>needs {w.tippers_short}</Chip>
                        <span className="ml-1.5 font-semibold text-navy">{w.fleet_code}</span>
                        <span className="text-txt-light"> · {w.location}</span>
                      </span>
                      <span className="shrink-0 font-mono text-txt-muted">
                        {formatIndian(w.gap_cum_day)}
                      </span>
                    </div>
                  ))}
                </div>
                <div>
                  {summary.short_of_digging.filter((w) => (w.tippers_spare ?? 0) > 0).map((w) => (
                    <div key={`${w.fleet_code}-${w.location}`}
                      className="flex items-center justify-between gap-2 text-[11.5px] py-0.5">
                      <span className="min-w-0 truncate">
                        <Chip tone="sky" dot={false}>{w.tippers_spare} spare</Chip>
                        <span className="ml-1.5 font-semibold text-navy">{w.fleet_code}</span>
                        <span className="text-txt-light"> · {w.location}</span>
                      </span>
                      <span className="shrink-0 font-mono text-txt-muted">
                        {formatIndian(w.gap_cum_day)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── what would make these numbers wrong ─────────────────────────── */}
      {quality && problems > 0 && (
        <Card tone="amber">
          <CardHeader icon={AlertTriangle} tone="amber" subtitleOnIcon
            title={`${problems} thing${problems === 1 ? "" : "s"} that would make these figures wrong`}
            subtitle="Reported rather than fixed: each one is a decision about the mine, not about the screen." />
          <div className="px-4 py-3 space-y-2 text-[11.5px]">
            {quality.same_machine_twice.map((t) => (
              <div key={t.ex}>
                <span className="font-semibold text-navy">
                  Ex-{t.ex} is on the register twice
                </span>
                <span className="text-txt-muted">
                  {" — "}{t.rows.map((r) => r.fleet_code).join(" and ")}. Capacity
                  counted against one of them is invisible to whatever reads the other.
                </span>
              </div>
            ))}
            {quality.plan_names_with_no_machine.length > 0 && (
              <div>
                <span className="font-semibold text-navy">
                  The plan works {quality.plan_names_with_no_machine.join(", ")},
                  and the register has no such machine
                </span>
                <span className="text-txt-muted">
                  {" — "}left out of the totals above rather than attributed to a guess.
                </span>
              </div>
            )}
            {quality.no_bucket.length > 0 && (
              <div>
                <span className="font-semibold text-navy">
                  {quality.no_bucket.length} excavator
                  {quality.no_bucket.length === 1 ? " has" : "s have"} no bucket recorded
                </span>
                <span className="text-txt-muted">
                  {" — "}{quality.no_bucket.slice(0, 6).map((m) => m.fleet_code).join(", ")}
                  {quality.no_bucket.length > 6 && ` and ${quality.no_bucket.length - 6} more`}.
                  They can be planned for nothing until somebody says.
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      <Tabs tabs={TABS} value={tab} onChange={(id: string) => setTab(id as TabId)} />

      {loading && (
        <Card><div className="p-6 flex items-center gap-2 text-txt-muted text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Working it out…
        </div></Card>
      )}

      {/* ── the calculator ─────────────────────────────────────────────── */}
      {!loading && tab === "plan" && (
        <Card>
          <CardHeader icon={Truck} tone="gold" title="Today's faces"
            subtitleOnIcon
            subtitle="Change the hours or the trucks on any row and every figure above moves. This is the sheet's 'edit current tippers to model scenarios', with the machines named properly."
            actions={
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => setAdding(true)}>
                <Plus className="w-3.5 h-3.5" /> Add a face
              </Button>
            } />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <Th>Machine</Th><Th>Where</Th><Th>What</Th>
                  <Th className="text-right">Bucket</Th>
                  <Th className="text-right">Cum/hr</Th>
                  <Th className="text-right">Hours</Th>
                  <Th className="text-right">Can dig</Th>
                  <Th className="text-right">Trucks</Th>
                  <Th className="text-right">Can carry</Th>
                  <Th className="text-right">Moves</Th>
                  <Th>Limited by</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {faces.length === 0 && (
                  <EmptyRow colSpan={12}>
                    No machine is planned onto a face for this day.
                  </EmptyRow>
                )}
                {faces.map((f) => (
                  <tr key={f.face_plan_id}
                    className="border-t border-border-light hover:bg-bg-soft/50">
                    <Td>
                      <span className="font-semibold text-navy">{f.fleet_code}</span>
                      {f.plan_name && (
                        <span className="block text-[10.5px] text-txt-light">
                          plan calls it {f.plan_name}
                        </span>
                      )}
                    </Td>
                    <Td className="text-[12px]">{f.location}</Td>
                    <Td className="text-[12px] text-txt-muted">{f.material}</Td>
                    <Td className="text-right text-[12px]">
                      <span className="font-mono">{f.bucket_cum}</span>
                      {/* A bucket that is not the machine's standard one is
                          worth marking: it is the single number every figure
                          on the row multiplies out from. */}
                      {f.bucket_is_fitted && (
                        <span className="block text-[9.5px] text-gold-dark">fitted</span>
                      )}
                    </Td>
                    <Td className="text-right text-[12px]"><Cum v={f.cum_per_hour} /></Td>
                    <Td className="text-right">
                      <input type="number" min={0.5} max={24} step={0.5}
                        defaultValue={f.running_hours} disabled={busy}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== f.running_hours && v > 0 && v <= 24) {
                            void edit(f.face_plan_id, { running_hours: v });
                          }
                        }}
                        className={`${inputClass} w-[62px] py-1 text-[12px] text-right`} />
                    </Td>
                    <Td className="text-right text-[12px]"><Cum v={f.excavator_cum_day} /></Td>
                    <Td className="text-right">
                      <input type="number" min={0} max={99} step={1}
                        defaultValue={f.tippers} disabled={busy}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== f.tippers && v >= 0) {
                            void edit(f.face_plan_id, { tippers: v });
                          }
                        }}
                        className={`${inputClass} w-[54px] py-1 text-[12px] text-right`} />
                      {f.tipper_class && (
                        <span className="block text-[9.5px] text-txt-light">
                          {f.tipper_class.toLowerCase()}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right text-[12px]"><Cum v={f.tipper_cum_day} /></Td>
                    <Td className="text-right text-[12px]">
                      <Cum v={f.effective_cum_day} bold />
                    </Td>
                    <Td>
                      <Chip tone={LIMIT_TONE[f.limited_by] ?? "slate"}>
                        {LIMIT_WORD[f.limited_by] ?? f.limited_by.toLowerCase()}
                      </Chip>
                      {f.lost_cum_day > 0 && (
                        <span className="block text-[10px] text-amber">
                          −{formatIndian(Math.round(f.lost_cum_day))} Cum
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <button type="button" disabled={busy}
                        title={`Take ${f.fleet_code} off ${f.location}`}
                        onClick={() => {
                          setBusy(true);
                          void api.delete(`/productivity/plan/${f.face_plan_id}`)
                            .then(load).finally(() => setBusy(false));
                        }}
                        className="rounded p-1 text-txt-light hover:text-rose hover:bg-rose-bg">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {faces.length === 0 && (
            <div className="border-t border-border-light px-4 py-2">
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => {
                  setBusy(true);
                  const y = new Date(day + "T00:00:00");
                  y.setDate(y.getDate() - 1);
                  void api.post("/productivity/plan/copy", {
                    from_date: y.toISOString().slice(0, 10), to_date: day,
                  }).then(load).finally(() => setBusy(false));
                }}>
                <Copy className="w-3.5 h-3.5" /> Start from yesterday's plan
              </Button>
            </div>
          )}
        </Card>
      )}

      {!loading && tab === "machines" && (
        <MachinesTab machines={machines} onBucket={setBucket} busy={busy} />
      )}

      {!loading && tab === "model" && model && (
        <ModelTab model={model} classes={classes} onSave={saveModel} busy={busy} />
      )}

      {adding && (
        <AddFace day={day} machines={machines} classes={classes}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load(); }} />
      )}
    </div>
  );
}

/* ── the machines, and the bucket each is running ──────────────────────── */

function MachinesTab({ machines, onBucket, busy }: {
  machines: Machine[];
  onBucket: (assetId: number, cum: number | null) => void;
  busy: boolean;
}) {
  return (
    <Card>
      <CardHeader icon={Boxes} tone="sky" title="What each machine moves in an hour"
        subtitleOnIcon
        subtitle="The standard bucket is the machine's. The fitted bucket is what is on it now — a long boom reaching deep runs a smaller one, and productivity is worked out from that." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <Th>Machine</Th><Th>Plan calls it</Th><Th>Owned</Th>
              <Th className="text-right">Standard</Th>
              <Th className="text-right">Fitted</Th>
              <Th className="text-right">Per scoop</Th>
              <Th className="text-right">Cycle</Th>
              <Th className="text-right">Cum/hr</Th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => (
              <tr key={m.asset_id}
                className={`border-t border-border-light hover:bg-bg-soft/50 ${
                  m.needs_bucket ? "bg-amber-bg/30" : ""}`}>
                <Td>
                  <span className="font-semibold text-navy">{m.fleet_code}</span>
                  {m.nickname && (
                    <span className="block text-[10.5px] text-txt-light truncate max-w-[220px]">
                      {m.nickname}
                    </span>
                  )}
                </Td>
                <Td className="text-[12px]">
                  {m.plan_name
                    ? <Chip tone="violet" dot={false}>{m.plan_name}</Chip>
                    : <span className="text-txt-light text-[11px]">not in the plan</span>}
                </Td>
                <Td className="text-[11.5px] text-txt-muted">
                  {(m.ownership ?? "").toLowerCase() || "—"}
                </Td>
                <Td className="text-right text-[12px] font-mono text-txt-muted">
                  {m.standard_bucket ?? "—"}
                </Td>
                <Td className="text-right">
                  <input type="number" min={0} max={50} step={0.05}
                    defaultValue={m.fitted_bucket_cum ?? ""} disabled={busy}
                    placeholder={m.standard_bucket != null ? String(m.standard_bucket) : "—"}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const v = raw === "" ? null : Number(raw);
                      if (v !== (m.fitted_bucket_cum ?? null)) onBucket(m.asset_id, v);
                    }}
                    className={`${inputClass} w-[76px] py-1 text-[12px] text-right`} />
                </Td>
                <Td className="text-right text-[12px] font-mono">
                  {m.needs_bucket ? "—" : m.cum_per_scoop.toFixed(3)}
                </Td>
                <Td className="text-right text-[12px] font-mono text-txt-muted">
                  {m.cycle_sec}s
                  {m.cycle_is_overridden && (
                    <span className="block text-[9.5px] text-violet" title={m.override_reason ?? ""}>
                      its own
                    </span>
                  )}
                </Td>
                <Td className="text-right text-[12px]">
                  {m.needs_bucket
                    ? <span className="text-amber text-[11px]">no bucket recorded</span>
                    : <Cum v={m.cum_per_hour} bold />}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── the assumptions everything is derived from ────────────────────────── */

function ModelTab({ model, classes, onSave, busy }: {
  model: Assumptions;
  classes: TipperClass[];
  onSave: (patch: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, number>>({});
  const v = (k: keyof Assumptions) =>
    draft[k as string] ?? (model[k] as number);
  const dirty = Object.keys(draft).length > 0;

  const CYCLE: [keyof Assumptions, string][] = [
    ["dig_sec", "Digging"], ["lift_sec", "Lifting up"], ["swing_sec", "Swing"],
    ["lower_sec", "Lowering"], ["tilt_sec", "Bucket tilting"],
    ["wait_sec", "Waiting"], ["unload_sec", "Unloading"],
    ["return_sec", "Back to digging"],
  ];
  const cycleSec = CYCLE.reduce((n, [k]) => n + Number(v(k)), 0);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader icon={Settings2} tone="violet" title="The excavator cycle"
          subtitleOnIcon
          subtitle="Eight parts a supervisor can stand at the face and time. A single hundred seconds would be a number nobody can check."
          actions={dirty && (
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={busy}
                onClick={() => setDraft({})}>Cancel</Button>
              <Button size="sm" variant="primary" disabled={busy}
                onClick={() => { onSave(draft); setDraft({}); }}>
                Save — supersedes the current set
              </Button>
            </span>
          )} />
        <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {CYCLE.map(([k, label]) => (
            <label key={k} className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                {label} <span className="text-txt-light font-normal">sec</span>
              </span>
              <input type="number" min={0} max={600} disabled={busy}
                value={v(k)}
                onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })}
                className={`${inputClass} py-1.5 text-[13px]`} />
            </label>
          ))}
        </div>
        <div className="border-t border-border-light px-4 py-2.5 flex flex-wrap
                        items-center gap-x-6 gap-y-1 text-[12px]">
          <span><span className="text-txt-muted">One cycle</span>{" "}
            <span className="font-mono font-bold text-navy">{cycleSec}s</span></span>
          <ArrowRight className="w-3.5 h-3.5 text-txt-light" />
          <span><span className="text-txt-muted">Cycles an hour</span>{" "}
            <span className="font-mono font-bold text-navy">
              {cycleSec > 0 ? (3600 / cycleSec).toFixed(2) : "—"}
            </span></span>
          {model.overrides > 0 && (
            <span className="text-[11px] text-violet ml-auto">
              {model.overrides} machine{model.overrides === 1 ? "" : "s"} run a cycle of their own
            </span>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader icon={Gauge} tone="gold" title="The rest of it" subtitleOnIcon
          subtitle="How full the bucket comes up, how much the material swells, and the length of the day every figure is built on." />
        <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {([
            ["fill_factor", "Bucket fill factor", "of the bucket, 0 to 1", 0.01],
            ["swell_factor", "Swell factor", "loose against in situ", 0.01],
            ["operating_hours", "Operating hours", "hours in the planned day", 0.5],
            ["ore_t_per_cum", "Ore density", "tonnes per cubic metre", 0.05],
          ] as const).map(([k, label, hint, step]) => (
            <label key={k} className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                {label}
              </span>
              <input type="number" step={step} disabled={busy} value={v(k)}
                onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })}
                className={`${inputClass} py-1.5 text-[13px]`} />
              <span className="block text-[10px] text-txt-light mt-0.5">{hint}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader icon={Truck} tone="teal" title="What a truck carries in a day"
          subtitleOnIcon
          subtitle="The fleet is not one kind of tipper, and the difference decides how many a face needs." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <Th>Class</Th>
                <Th className="text-right">Payload</Th>
                <Th className="text-right">Effective</Th>
                <Th className="text-right">Loading</Th>
                <Th className="text-right">Road</Th>
                <Th className="text-right">Cycle</Th>
                <Th className="text-right">Trips/day</Th>
                <Th className="text-right">Cum/day</Th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.tipper_class_id} className="border-t border-border-light">
                  <Td className="font-semibold text-navy text-[12px]">{c.label}</Td>
                  <Td className="text-right text-[12px] font-mono">{c.payload_t} t</Td>
                  <Td className="text-right text-[12px] font-mono">{c.effective_cum} Cum</Td>
                  <Td className="text-right text-[12px] font-mono text-txt-muted">{c.loading_min} min</Td>
                  <Td className="text-right text-[12px] font-mono text-txt-muted">{c.travel_min} min</Td>
                  <Td className="text-right text-[12px] font-mono text-txt-muted">{c.cycle_min} min</Td>
                  <Td className="text-right text-[12px] font-mono">{c.trips_per_day}</Td>
                  <Td className="text-right text-[12px]"><Cum v={c.cum_per_day} bold /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ── putting a machine on a face ───────────────────────────────────────── */

function AddFace({ day, machines, classes, onClose, onSaved }: {
  day: string; machines: Machine[]; classes: TipperClass[];
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    asset_id: "", location: "", material: "", running_hours: "20",
    tippers: "0", tipper_class_id: String(classes[0]?.tipper_class_id ?? ""),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ok = f.asset_id && f.location.trim() && f.material.trim()
    && Number(f.running_hours) > 0;

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-navy/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[520px] bg-bg-base rounded-2xl shadow-xl
                      border border-border-light overflow-hidden">
        <div className="px-5 py-3 border-b border-border-light">
          <h2 className="text-[14px] font-bold text-navy">Put a machine on a face</h2>
          <p className="text-[11.5px] text-txt-muted">
            For {day.split("-").reverse().join("-")}. One machine can work more than
            one face in a day — the workbook splits a long boom across bund
            preparation and ore.
          </p>
        </div>
        <div className="p-5 space-y-3">
          {err && (
            <p className="text-[12px] text-rose bg-rose-bg border border-rose-ring
                          rounded-lg px-3 py-2">{err}</p>
          )}
          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
              Machine
            </span>
            <SearchSelect field value={f.asset_id} placeholder="Choose an excavator…"
              searchPlaceholder="Type a fleet code…"
              onChange={(v) => setF({ ...f, asset_id: v })}
              options={machines.map((m) => ({
                value: String(m.asset_id), label: m.fleet_code,
                hint: m.plan_name ? `plan calls it ${m.plan_name}` : (m.nickname ?? undefined),
                meta: m.needs_bucket
                  ? <span className="text-amber">no bucket</span>
                  : <span className="text-txt-light">{m.cum_per_hour} Cum/hr</span>,
              }))} />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                Where
              </span>
              <input className={inputClass} value={f.location}
                placeholder="Bottom, North East, Stack Yard…"
                onChange={(e) => setF({ ...f, location: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                What
              </span>
              <input className={inputClass} value={f.material}
                placeholder="Ore, OB, Rehandling…"
                onChange={(e) => setF({ ...f, material: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                Hours at this face
              </span>
              <input type="number" min={0.5} max={24} step={0.5} className={inputClass}
                value={f.running_hours}
                onChange={(e) => setF({ ...f, running_hours: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                Trucks under it
              </span>
              <input type="number" min={0} max={99} className={inputClass}
                value={f.tippers}
                onChange={(e) => setF({ ...f, tippers: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
              Kind of truck
            </span>
            <SearchSelect field value={f.tipper_class_id}
              onChange={(v) => setF({ ...f, tipper_class_id: v })}
              options={classes.map((c) => ({
                value: String(c.tipper_class_id), label: c.label,
                hint: `${c.effective_cum} Cum a trip`,
                meta: <span className="text-txt-light">{c.cum_per_day} Cum/day</span>,
              }))} />
          </label>
        </div>
        <div className="px-5 py-3 border-t border-border-light flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={!ok || busy}
            onClick={async () => {
              setBusy(true); setErr(null);
              try {
                await api.post("/productivity/plan", {
                  on_date: day, asset_id: Number(f.asset_id),
                  location: f.location.trim(), material: f.material.trim(),
                  running_hours: Number(f.running_hours),
                  tippers: Number(f.tippers),
                  tipper_class_id: f.tipper_class_id ? Number(f.tipper_class_id) : null,
                });
                onSaved();
              } catch (e) {
                const detail = (e as { response?: { data?: { detail?: string } } })
                  ?.response?.data?.detail;
                setErr(detail ?? "That could not be saved.");
              } finally { setBusy(false); }
            }}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Add it"}
          </Button>
        </div>
      </div>
    </div>
  );
}
