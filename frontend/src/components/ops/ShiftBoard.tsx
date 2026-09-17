"use client";
/**
 * The shift, from before it starts to after it closes.
 *
 * A supervisor's morning is a sequence — open the shift, mark who came, look at
 * what is short, deploy, deal with what is blocked — so the screen is that
 * sequence rather than a set of panels in an arbitrary order.
 *
 * Shortages are counted rather than left to the eye. "Five tippers planned,
 * three available, two short" is the sentence somebody has to act on, and it
 * should not depend on anyone counting rows correctly at half past five in the
 * morning.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock, Loader2, Play, Square, Users, Cpu, AlertTriangle, TriangleAlert,
  ClipboardList, Check, X, Plus, ArrowLeftRight,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Card, CardHeader, Chip, EmptyRow, Td, Th, Tile, type Tone }
  from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import Toast from "@/components/minehub/Toast";
import { SEVERITY, EXCEPTION_LABEL, OPERATOR_STATE, clock, ago } from "./state";

interface ShiftRow {
  shift_instance_id: number; shift_id: number; shift_code: string; shift_name: string;
  production_day: string; status: string; plant: string | null;
  supervisor_emp_id: string | null; supervisor_name: string | null;
  start_time: string; end_time: string;
  planned: number; live: number; open_exceptions: number;
}

interface Board {
  shift: ShiftRow;
  counts: Record<string, number>;
  plans: Record<string, unknown>[];
  deployments: Record<string, unknown>[];
  hoto: Record<string, unknown>[];
  exceptions: Record<string, unknown>[];
  shortages: { asset_type: string; wanted: number; machines_available: number;
               operators_eligible: number; machine_short: number; operator_short: number }[];
}

interface Op {
  operator_id: number; display_name: string; operator_ref: string | null;
  designation: string | null; machines_competent: number;
}

export default function ShiftBoard({ shift, shifts, onShiftChange, rights, onChanged }: {
  shift: ShiftRow | null;
  shifts: ShiftRow[];
  onShiftChange: (shiftInstanceId: number | null) => void;
  rights: { may_manage: boolean; may_hoto: boolean; may_override: boolean };
  onChanged?: () => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [operators, setOperators] = useState<Op[]>([]);
  const [attendance, setAttendance] = useState<Record<number, boolean | undefined>>({});
  const [showAttendance, setShowAttendance] = useState(false);
  const [closing, setClosing] = useState(false);
  const [resolving, setResolving] = useState<Record<string, unknown> | null>(null);
  const [resolution, setResolution] = useState("");

  const load = useCallback(async () => {
    if (!shift) { setBoard(null); return; }
    setLoading(true);
    try {
      const [b, ops] = await Promise.all([
        api.get(`/ops/shifts/${shift.shift_instance_id}/board`),
        api.get("/operators").catch(() => ({ data: [] })),
      ]);
      setBoard(b.data);
      setOperators(ops.data ?? []);
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not load the shift.");
    } finally { setLoading(false); }
  }, [shift]);

  useEffect(() => { void load(); }, [load]);

  const markAttendance = async () => {
    if (!shift) return;
    const entries = Object.entries(attendance)
      .filter(([, present]) => present !== undefined)
      .map(([id, present]) => ({ operator_id: Number(id), present }));
    if (!entries.length) { setShowAttendance(false); return; }
    setBusy("attendance");
    try {
      const r = await api.post("/ops/attendance", {
        shift_instance_id: shift.shift_instance_id, operators: entries,
      });
      setNotice(`${r.data.marked} marked. Anyone not marked reads as "not marked", never as present.`);
      setShowAttendance(false); setAttendance({});
      await load(); onChanged?.();
    } catch { setError("Could not record attendance."); }
    finally { setBusy(null); }
  };

  const closeShift = async () => {
    if (!shift) return;
    setBusy("close");
    try {
      const r = await api.post(`/ops/shifts/${shift.shift_instance_id}/close`, {});
      setNotice(`Shift closed. ${r.data.released} deployment(s) released`
        + (r.data.cancelled_hoto ? `, ${r.data.cancelled_hoto} unfinished handover(s) cancelled.` : "."));
      setClosing(false);
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not close the shift.");
    } finally { setBusy(null); }
  };

  const resolve = async () => {
    if (!resolving) return;
    setBusy("resolve");
    try {
      await api.post(`/ops/exceptions/${resolving.ops_exception_id}/resolve`,
        { resolution: resolution.trim() });
      setNotice("Exception closed.");
      setResolving(null); setResolution("");
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not close it.");
    } finally { setBusy(null); }
  };

  if (!shift) {
    return (
      <Card>
        <div className="px-5 py-14 text-center">
          <CalendarClock className="w-7 h-7 mx-auto text-txt-light mb-3" />
          <p className="text-[14px] font-semibold text-navy">No shift open</p>
          <p className="text-[12.5px] text-txt-muted mt-1 max-w-md mx-auto">
            Everything operational hangs off a shift — deployments, handovers,
            exceptions. Open one from the bar above to start.
          </p>
        </div>
      </Card>
    );
  }

  if (loading && !board) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  const counts = board?.counts ?? {};
  const shortages = board?.shortages ?? [];

  return (
    <div className="space-y-4">
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />

      {/* Where the shift stands */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Planned" value={counts.planned ?? 0} tone="slate" icon={ClipboardList}
              hint="lines on the plan" />
        <Tile label="Deployed" value={counts.deployed ?? 0} tone="sky" icon={Cpu}
              hint={`${counts.running ?? 0} running`} />
        <Tile label="Handovers" value={(counts.hoto_pending ?? 0) + (counts.hoto_blocked ?? 0)}
              tone={counts.hoto_blocked ? "rose" : counts.hoto_pending ? "amber" : "emerald"}
              icon={ArrowLeftRight} hint={`${counts.hoto_blocked ?? 0} blocked`} />
        <Tile label="Exceptions" value={counts.exceptions ?? 0}
              tone={counts.exceptions ? "rose" : "emerald"} icon={AlertTriangle}
              hint="stopping planned work" />
      </div>

      {/* Shortages — before the shift starts, while it can still be fixed */}
      {shortages.length > 0 && (
        <Card tone="amber">
          <CardHeader title="Short for this shift" icon={TriangleAlert} tone="amber"
            subtitle="Counted from the plan against what is actually available and who is actually cleared. Worth seeing before production starts, not after." />
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shortages.map((s) => (
              <div key={s.asset_type}
                className="rounded-xl border border-amber-ring bg-amber-bg px-4 py-3">
                <div className="font-condensed font-bold text-[14px] text-navy">{s.asset_type}</div>
                <div className="mt-1.5 grid grid-cols-3 gap-2 text-center">
                  {[["Wanted", s.wanted, "text-navy"],
                    ["Machines", s.machines_available, s.machine_short ? "text-rose" : "text-emerald"],
                    ["Operators", s.operators_eligible, s.operator_short ? "text-rose" : "text-emerald"],
                  ].map(([label, value, tone]) => (
                    <div key={String(label)}>
                      <div className={`text-[19px] font-extrabold tabular-nums ${tone}`}>{value}</div>
                      <div className="text-[10.5px] uppercase tracking-[.08em] text-txt-light">{label}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[12px] font-semibold text-rose">
                  {s.machine_short > 0 && `${s.machine_short} machine${s.machine_short > 1 ? "s" : ""} short`}
                  {s.machine_short > 0 && s.operator_short > 0 && " · "}
                  {s.operator_short > 0 && `${s.operator_short} operator${s.operator_short > 1 ? "s" : ""} short`}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Exceptions */}
      {(board?.exceptions.length ?? 0) > 0 && (
        <Card tone="rose">
          <CardHeader title={`Stopping work · ${board!.exceptions.length}`} icon={AlertTriangle}
            tone="rose" subtitle="Each one has a reason and somebody who can close it." />
          <ul className="divide-y divide-border-light">
            {board!.exceptions.map((e) => (
              <li key={String(e.ops_exception_id)} className="px-5 py-3 flex flex-wrap items-center
                                                              justify-between gap-3">
                <span className="min-w-0">
                  <span className="inline-flex items-center gap-2">
                    <Chip tone={SEVERITY[String(e.severity)] ?? "slate"}>
                      {String(e.severity).toLowerCase()}
                    </Chip>
                    <span className="font-semibold text-navy text-[13px]">
                      {EXCEPTION_LABEL[String(e.kind)] ?? String(e.kind)}
                    </span>
                    {e.fleet_code ? (
                      <span className="font-mono text-[11.5px] text-txt-light">{String(e.fleet_code)}</span>
                    ) : null}
                  </span>
                  <span className="block text-[12.5px] text-txt-secondary mt-0.5">{String(e.detail)}</span>
                  <span className="block text-[11px] text-txt-light">
                    {ago(String(e.created_at))}
                    {e.operator_name ? ` · ${String(e.operator_name)}` : ""}
                  </span>
                </span>
                {rights.may_manage && (
                  <Button size="sm" variant="secondary" onClick={() => setResolving(e)}>
                    <Check className="w-3.5 h-3.5" /> Close it
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Who is on what */}
      <Card tone="sky">
        <CardHeader title="Deployments" icon={Cpu} tone="sky"
          subtitle="Machine, operator and the hours they ran. Released ones stay on the list — the shift is what happened, not only what is happening."
          actions={rights.may_manage && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setShowAttendance(true)}>
                <Users className="w-3.5 h-3.5" /> Attendance
              </Button>
              {shift.status === "OPEN" && (
                <Button size="sm" variant="danger" onClick={() => setClosing(true)}>
                  <Square className="w-3.5 h-3.5" /> Close shift
                </Button>
              )}
            </>
          )} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr><Th>Machine</Th><Th>Operator</Th><Th>Activity</Th>
                  <Th>Started</Th><Th>Hours</Th><Th className="text-right">Status</Th></tr>
            </thead>
            <tbody>
              {(board?.deployments.length ?? 0) === 0 ? (
                <EmptyRow colSpan={6}>
                  Nothing deployed yet. Deploy from the Live fleet — the readiness check
                  runs there and says what is blocking each machine.
                </EmptyRow>
              ) : board!.deployments.map((d) => {
                const start = d.start_reading as number | null;
                const end = d.end_reading as number | null;
                const hours = start !== null && end !== null ? (end - start).toFixed(1) : null;
                const live = ["READY", "RUNNING", "PAUSED"].includes(String(d.status));
                return (
                  <tr key={String(d.deployment_id)} className="hover:bg-bg-light transition-colors">
                    <Td>
                      <span className="font-semibold text-navy">
                        {String(d.nickname || d.fleet_code)}
                      </span>
                      <span className="block font-mono text-[11px] text-txt-light">
                        {String(d.deployment_ref)}
                      </span>
                    </Td>
                    <Td className="text-txt-secondary">{String(d.operator_name ?? "—")}</Td>
                    <Td className="text-txt-muted">{String(d.activity ?? "—")}</Td>
                    <Td className="tabular-nums text-[12.5px]">{clock(d.started_at as string)}</Td>
                    <Td className="tabular-nums">{hours ?? "—"}</Td>
                    <Td className="text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {d.override_reason ? (
                          <Chip tone="rose" title={String(d.override_reason)}>overridden</Chip>
                        ) : null}
                        <Chip tone={live ? (d.status === "RUNNING" ? "emerald" : "sky") : "slate"}>
                          {String(d.status).toLowerCase()}
                        </Chip>
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Attendance */}
      <Dialog open={showAttendance} tone="info" title="Who came in"
        confirmLabel="Record attendance" cancelLabel="Cancel" busy={busy === "attendance"}
        onConfirm={() => void markAttendance()}
        onCancel={() => { setShowAttendance(false); setAttendance({}); }}>
        Anyone left unmarked stays "not marked" rather than being assumed present —
        silence is not an answer, and a machine will say so when somebody tries to
        deploy them.
        <ul className="mt-3 max-h-[320px] overflow-y-auto divide-y divide-border-light">
          {operators.map((o) => (
            <li key={o.operator_id} className="py-2 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-navy">{o.display_name}</span>
                <span className="block text-[11px] text-txt-light">
                  {o.designation || "role not set"}
                  {o.machines_competent ? ` · ${o.machines_competent} class` : ""}
                </span>
              </span>
              <span className="flex gap-1.5 shrink-0">
                <button onClick={() => setAttendance((p) => ({ ...p, [o.operator_id]: true }))}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors
                    ${attendance[o.operator_id] === true
                      ? "bg-emerald text-white border-emerald"
                      : "bg-bg-base text-txt-muted border-border hover:border-emerald"}`}>
                  Present
                </button>
                <button onClick={() => setAttendance((p) => ({ ...p, [o.operator_id]: false }))}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors
                    ${attendance[o.operator_id] === false
                      ? "bg-rose text-white border-rose"
                      : "bg-bg-base text-txt-muted border-border hover:border-rose"}`}>
                  Absent
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Dialog>

      {/* Close */}
      <Dialog open={closing} tone="warning" title="Close this shift?"
        confirmLabel="Close it" cancelLabel="Not yet" busy={busy === "close"}
        onConfirm={() => void closeShift()} onCancel={() => setClosing(false)}>
        Anything still running is released and any unfinished handover is
        cancelled. No deployment should stay open past its shift — an operator
        still recorded as running a machine tomorrow makes every utilisation
        figure wrong.
      </Dialog>

      {/* Resolve */}
      <Dialog open={Boolean(resolving)} tone="info" title="Close this exception"
        confirmLabel="Close it" cancelLabel="Cancel"
        busy={busy === "resolve" || !resolution.trim()}
        onConfirm={() => void resolve()}
        onCancel={() => { setResolving(null); setResolution(""); }}>
        Say what was done about it. A queue of silently closed exceptions teaches
        people to close them silently.
        <input value={resolution} onChange={(e) => setResolution(e.target.value)}
          placeholder="Replacement operator deployed; hose replaced at the workshop"
          className="mt-2.5 w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]" />
      </Dialog>
    </div>
  );
}
