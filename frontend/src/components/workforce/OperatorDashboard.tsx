"use client";
/**
 * One person, everything about them, and the things you would then want to do.
 *
 * Until now the answer to "tell me about Ramesh" was spread over four screens:
 * his profile in the register, his assessments in a tab of it, his shifts on
 * the board, his leave somewhere else. Nobody assembled it, so nobody asked —
 * and an appraisal, a training decision or a posting was made on whichever
 * screen happened to be open.
 *
 * This assembles it, and then puts the actions next to the evidence for them.
 * Seeing that somebody has run nothing for six weeks is only useful on a screen
 * where you can do something about it, so leave is raised here, the roster is
 * set here, and the assessment and deployment screens are one click away with
 * this person already chosen.
 *
 * It reads two endpoints and no more. The register owns who somebody is; the
 * roster owns what they have been doing. Deliberately separate — rostering a
 * person should not need the right to read their medical record — and joined
 * here, at the only place that wants both.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "@/components/minehub/DateField";
import {
  X, Loader2, Star, Cpu, CalendarRange, Plane, Award, Clock, Activity,
  Plus, TrendingDown, ShieldAlert,
} from "lucide-react";
import api from "@/lib/api";
import {
  Button, Card, CardHeader, Chip, Field, inputClass, Tile, Avatar, type Tone,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import CommentThread from "@/components/comments/CommentThread";
import { DAY_STATE, SHIFT_LOOK, shiftBand, shortShift, UNROSTERED, LEAVE_STATUS, prettyDate, shortDate, isoDay,
         type DayCell } from "./state";

interface Worklife {
  operator: {
    operator_id: number; operator_ref: string | null; display_name: string;
    designation: string | null; approval_status: string; profile_status: string;
    joined_on: string | null; phone: string | null;
    plant: string | null; department: string | null;
  };
  roster: Record<string, DayCell>;
  today: DayCell | null;
  on_machine_now: { deployment_ref: string; status: string; started_at: string;
                    fleet_code: string; asset_type: string } | null;
  classes: { asset_type_id: number; asset_type: string; level: number | null;
             rating: number | null; valid_upto: string | null;
             next_assessment_due: string | null; machines: number }[];
  deployments: { deployment_id: number; deployment_ref: string; status: string;
                 production_day: string | null; shift_code: string | null;
                 fleet_code: string; asset_type: string; activity: string | null }[];
  machines: { fleet_code: string; asset_type: string; shifts: number; last: string | null }[];
  leave: { leave_request_id: number; leave_ref: string; from_date: string; to_date: string;
           days: number; status: string; type_name: string; type_code: string;
           reason: string | null }[];
  leave_used: Record<string, { name: string; quota: number | null; taken: number }>;
  window_days: number;
  summary: Record<string, number>;
}

interface LeaveType {
  leave_type_id: number; code: string; name: string; is_active: boolean;
}

const LEVEL_WORD: Record<number, string> = {
  0: "No knowledge", 1: "Assisted only", 2: "Can operate",
  3: "Independent", 4: "Can train others", 5: "Reference operator",
};

export default function OperatorDashboard({ operatorId, onClose, mayApply, onChanged }: {
  operatorId: number | null;
  onClose: () => void;
  mayApply: boolean;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<Worklife | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    leave_type_id: "", from_date: isoDay(new Date()), to_date: isoDay(new Date()), reason: "",
  });

  const load = useCallback(async () => {
    if (!operatorId) return;
    setLoading(true);
    try {
      const [w, t] = await Promise.all([
        api.get(`/workforce/operators/${operatorId}/worklife`),
        api.get("/workforce/leave-types"),
      ]);
      setData(w.data);
      setTypes(t.data ?? []);
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "This person's record could not be read.");
    } finally { setLoading(false); }
  }, [operatorId]);

  useEffect(() => { void load(); }, [load]);

  // Escape closes, because a full-screen panel with only a small X in the
  // corner is a panel people get stuck in.
  useEffect(() => {
    if (!operatorId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [operatorId, onClose]);

  const rosterDays = useMemo(() => Object.keys(data?.roster ?? {}).sort(), [data]);
  const today = isoDay(new Date());

  // Somebody qualified on machines they have not touched in months is the thing
  // this screen exists to surface: it is invisible on every other one.
  const rusty = useMemo(() => {
    if (!data) return [];
    const ran = new Set(data.machines.map((m) => m.asset_type));
    return data.classes.filter((c) => (c.level ?? 0) >= 2 && !ran.has(c.asset_type));
  }, [data]);

  const overdue = (data?.classes ?? []).filter(
    (c) => c.next_assessment_due && c.next_assessment_due < today);

  const apply = async () => {
    if (!operatorId || !form.leave_type_id) return;
    setBusy(true);
    try {
      const r = await api.post("/workforce/leave", {
        ...form, operator_id: operatorId, leave_type_id: Number(form.leave_type_id),
      });
      setApplying(false);
      setNotice(`${r.data.leave_ref} raised — ${r.data.days} day(s), ${
        r.data.status === "APPROVED" ? "approved straight away" : "waiting for a decision"}.`);
      await load();
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The request could not be raised.");
    } finally { setBusy(false); }
  };

  if (!operatorId) return null;

  const o = data?.operator;
  const s = data?.summary ?? {};

  return (
    <div className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-sm overflow-y-auto"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="min-h-full flex items-start justify-center p-3 sm:p-6">
        <div className="w-full max-w-[1200px] rounded-2xl bg-bg-page shadow-2xl overflow-hidden">

          <div className="bg-navy text-white px-5 py-4 flex flex-wrap items-center gap-4">
            <Avatar name={o?.display_name ?? "?"} />
            <div className="min-w-0">
              <h2 className="text-[18px] font-bold leading-tight">
                {o?.display_name ?? (loading ? "Loading…" : "Not found")}
              </h2>
              <p className="text-[12px] text-white/65">
                {/* Nothing is asserted about somebody whose record has not
                    arrived. "no reference · role not set" under "Loading…" says
                    two things about a man the screen has not read yet, and both
                    of them turned out to be false — he has a reference and he
                    is a welder. */}
                {loading && !o ? "Reading their record…" : <>
                  {o?.operator_ref || "no reference"} · {o?.designation || "role not set"}
                  {o?.department ? ` · ${o.department}` : ""}
                  {o?.plant ? ` · ${o.plant}` : ""}
                </>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data?.on_machine_now ? (
                <Chip tone="emerald">
                  On {data.on_machine_now.fleet_code} now
                </Chip>
              ) : data?.today ? (
                <Chip tone={(DAY_STATE[data.today.state ?? ""]?.tone ?? "slate") as Tone}>
                  {data.today.state === "ON" ? `${data.today.shift} shift today`
                                             : data.today.label}
                </Chip>
              ) : null}
              {o && o.approval_status !== "APPROVED" && (
                <Chip tone="amber">Profile {o.approval_status.toLowerCase()}</Chip>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {mayApply && (
                <Button size="sm" variant="secondary" onClick={() => setApplying(true)}
                        disabled={types.length === 0}>
                  <Plus className="w-3.5 h-3.5" /> Raise leave
                </Button>
              )}
              <button onClick={onClose}
                      className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {error && (
            <div className="px-5 py-3 text-[12px] text-rose bg-rose-bg">{error}</div>
          )}
          {notice && (
            <div className="px-5 py-3 text-[12px] text-sky bg-sky-bg">{notice}</div>
          )}

          {loading && !data ? (
            <div className="px-5 py-20 text-center text-[13px] text-txt-muted">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Reading their record…
            </div>
          ) : !data ? null : (
            <div className="p-4 sm:p-5 space-y-4">

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Tile label="Shifts worked" value={s.shifts_worked ?? 0} icon={Clock}
                      tone="navy" hint={`In the last ${data.window_days} days`} />
                <Tile label="Machines run" value={s.machines_run ?? 0} icon={Cpu}
                      tone="sky" hint="Actual machines, not classes" />
                <Tile label="Classes signed off" value={s.classes_competent ?? 0} icon={Award}
                      tone="emerald" hint="Assessed at level 2 or better" />
                <Tile label="Leave this year" value={s.leave_days_this_year ?? 0} icon={Plane}
                      tone="amber"
                      hint={s.leave_waiting ? `${s.leave_waiting} waiting for a decision` : "Approved days"} />
                <Tile label="Reassessments overdue" value={overdue.length} icon={ShieldAlert}
                      tone={overdue.length ? "rose" : "slate"}
                      hint={overdue.length ? "Competency has gone stale" : "All current"} />
              </div>

              <Card>
                <CardHeader title="The month around today" icon={CalendarRange} tone="violet"
                  subtitle="A fortnight behind, a fortnight ahead" />
                <div className="px-5 py-4 flex flex-wrap gap-1">
                  {rosterDays.map((iso) => {
                    const cell = data.roster[iso];
                    // Coloured by shift, the same as the board. A month strip
                    // that draws every working day alike cannot answer the
                    // question it exists for — which shifts this man has been
                    // put on, and whether they rotate.
                    const look = cell?.state === "ON"
                      ? SHIFT_LOOK[shiftBand(cell.shift)]
                      : cell?.state ? DAY_STATE[cell.state] : UNROSTERED;
                    const isToday = iso === today;
                    return (
                      <span key={iso}
                        title={`${prettyDate(iso)} — ${cell?.label ?? UNROSTERED.label}`
                               + (cell?.hol && cell?.state !== "HOLIDAY" ? ` · ${cell.hol}` : "")
                               + (cell?.earns_comp_off ? " · earns a comp off" : "")}
                        className={`inline-flex flex-col items-center justify-center w-9 h-11
                                    rounded-lg text-[10px] font-bold ${look.cell}
                                    ${/* Same rule as the board: the fill is what
                                          he is doing, the border is what kind of
                                          day it is. A man's own record and the
                                          roster disagreeing about how a worked
                                          holiday looks is worse than either
                                          drawing it badly. */
                                      cell?.hol && cell?.state !== "HOLIDAY"
                                        ? "border-2 border-violet border-dashed"
                                        : "border"}
                                    ${isToday ? "ring-2 ring-navy ring-offset-1" : ""}`}>
                        <span className="text-[9px] opacity-70">{iso.slice(8, 10)}</span>
                        <span className="text-[12px]">
                          {/* Empty, not "?". A day nobody has rostered is not
                              an unknown or a fault — it is a gap, and the
                              dashed square already says so. A question mark
                              reads as something having gone wrong, which is
                              what a month of them looked like. */}
                          {cell?.state === "ON" ? shortShift(cell.shift)
                            : cell?.state === "LEAVE" ? "L"
                            : cell?.state === "HOLIDAY" ? "H"
                            : cell?.state === "REST" ? "·" : ""}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </Card>

              <div className="grid lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader title="What they can run" icon={Award} tone="emerald"
                    subtitle="Assessed competency, by class" />
                  {data.classes.length === 0 ? (
                    <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
                      Nothing assessed yet. Until a class is signed off, this person
                      cannot be deployed on anything.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {data.classes.map((c) => {
                        const level = c.level ?? 0;
                        const stale = c.next_assessment_due && c.next_assessment_due < today;
                        return (
                          <div key={c.asset_type_id}
                               className="px-5 py-2.5 flex flex-wrap items-center gap-3">
                            <div className="min-w-[150px]">
                              <p className="text-[12.5px] font-semibold text-navy">{c.asset_type}</p>
                              <p className="text-[11px] text-txt-light">
                                {LEVEL_WORD[level] ?? `Level ${level}`}
                                {c.machines ? ` · ${c.machines} in the fleet` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star key={n}
                                  className={`w-3.5 h-3.5 ${n <= (c.rating ?? 0)
                                    ? "text-gold fill-gold" : "text-slate-200"}`} />
                              ))}
                            </div>
                            <div className="ml-auto flex items-center gap-1.5">
                              <Chip tone={level >= 3 ? "emerald" : level >= 2 ? "sky" : "amber"}
                                    dot={false}>
                                Level {level}
                              </Chip>
                              {stale && <Chip tone="rose">Reassessment due</Chip>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card>
                  <CardHeader title="What they have actually run" icon={Cpu} tone="sky"
                    subtitle={`Machines, over the last ${data.window_days} days`} />
                  {data.machines.length === 0 ? (
                    <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
                      No deployments on record in this window.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {data.machines.slice(0, 8).map((m) => (
                        <div key={m.fleet_code}
                             className="px-5 py-2.5 flex items-center gap-3">
                          <div className="min-w-[140px]">
                            <p className="text-[12.5px] font-semibold text-navy">{m.fleet_code}</p>
                            <p className="text-[11px] text-txt-light">{m.asset_type}</p>
                          </div>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-sky"
                                 style={{ width: `${Math.min(100, 100 * m.shifts
                                   / (data.machines[0]?.shifts || 1))}%` }} />
                          </div>
                          <span className="text-[12px] font-semibold text-navy tabular-nums w-14 text-right">
                            {m.shifts} {m.shifts === 1 ? "shift" : "shifts"}
                          </span>
                          <span className="text-[11px] text-txt-light w-16 text-right">
                            {shortDate(m.last)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <CommentThread entityType="OPERATOR" entityId={operatorId}
                             title={`Notes on ${o?.display_name ?? "this person"}`} />

              {rusty.length > 0 && (
                <Card tone="amber">
                  <CardHeader title="Signed off, but not used" icon={TrendingDown} tone="amber"
                    subtitle="Competency the mine has paid for and is not drawing on. Skill fades, and this is where it fades quietly." />
                  <div className="px-5 py-3 flex flex-wrap gap-2">
                    {rusty.map((c) => (
                      <Chip key={c.asset_type_id} tone="amber" dot={false}>
                        {c.asset_type} · level {c.level}
                      </Chip>
                    ))}
                  </div>
                </Card>
              )}

              <div className="grid lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader title="Recent shifts" icon={Activity} tone="navy"
                    subtitle="What they were put on, and when" />
                  {data.deployments.length === 0 ? (
                    <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
                      Nothing in this window.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-72 overflow-auto">
                      {data.deployments.slice(0, 25).map((d) => (
                        <div key={d.deployment_id}
                             className="px-5 py-2 flex items-center gap-3 text-[12px]">
                          <span className="text-txt-light w-16">
                            {shortDate(d.production_day)}
                          </span>
                          {d.shift_code && (
                            <Chip tone="slate" dot={false}>{d.shift_code}</Chip>
                          )}
                          <span className="font-semibold text-navy">{d.fleet_code}</span>
                          <span className="text-txt-light truncate">{d.asset_type}</span>
                          <span className="ml-auto text-[10.5px] text-txt-light font-mono">
                            {d.deployment_ref}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Leave this year" icon={Plane} tone="amber"
                    subtitle="Taken against what the mine allows. Planning only — SAP owns the payroll figure." />
                  {Object.keys(data.leave_used).length > 0 && (
                    <div className="px-5 py-3 space-y-2 border-b border-slate-100">
                      {Object.entries(data.leave_used).map(([code, b]) => (
                        <div key={code} className="flex items-center gap-3">
                          <span className="text-[12px] text-txt-muted w-32 truncate">{b.name}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className={`h-full rounded-full
                              ${b.quota && b.taken > b.quota ? "bg-rose" : "bg-amber"}`}
                              style={{ width: `${b.quota
                                ? Math.min(100, 100 * b.taken / b.quota) : 25}%` }} />
                          </div>
                          <span className="text-[12px] font-semibold text-navy tabular-nums w-16 text-right">
                            {b.taken}{b.quota ? ` / ${b.quota}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {data.leave.length === 0 ? (
                    <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
                      No leave taken or asked for this year.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-56 overflow-auto">
                      {data.leave.map((l) => {
                        const look = LEAVE_STATUS[l.status] ?? LEAVE_STATUS.DRAFT;
                        return (
                          <div key={l.leave_request_id}
                               className="px-5 py-2 flex items-center gap-3 text-[12px]">
                            <span className="text-txt-muted w-28">
                              {shortDate(l.from_date)}
                              {l.to_date !== l.from_date && `–${shortDate(l.to_date)}`}
                            </span>
                            <span className="font-semibold text-navy">{l.type_name}</span>
                            <span className="text-txt-light">{l.days}d</span>
                            <Chip tone={look.tone}>{look.label}</Chip>
                            <span className="ml-auto text-[10.5px] text-txt-light font-mono">
                              {l.leave_ref}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={applying} tone="info" title={`Raise leave for ${o?.display_name ?? ""}`}
        confirmLabel="Raise it" busy={busy}
        onConfirm={() => void apply()} onCancel={() => setApplying(false)}>
        <div className="space-y-3">
          <Field label="Kind of leave" required>
            <select className={inputClass} value={form.leave_type_id}
                    onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}>
              <option value="">Choose</option>
              {types.filter((t) => t.is_active).map((t) => (
                <option key={t.leave_type_id} value={t.leave_type_id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="From" required>
              <DateField className={inputClass} value={form.from_date} onChange={(v) => setForm({ ...form, from_date: v, to_date: v > form.to_date ? v : form.to_date })} />
            </Field>
            <Field label="To" required>
              <DateField className={inputClass} value={form.to_date} min={form.from_date} onChange={(v) => setForm({ ...form, to_date: v })} />
            </Field>
          </div>
          <Field label="Reason">
            <input className={inputClass} value={form.reason} placeholder="Optional"
                   onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          {data?.on_machine_now && (
            <p className="text-[12px] text-amber">
              They are on {data.on_machine_now.fleet_code} right now. Approving leave
              does not release them — that stays a decision for the shift board.
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
