"use client";
/**
 * The fleet, as it is right now.
 *
 * Cards rather than a table, because the question this screen answers is asked
 * standing up: which machines can work, which cannot, and what is stopping the
 * ones that cannot. A row of thirty identical lines answers that badly; a wall
 * of colour answers it from across the room, and the detail is one click away
 * for the one machine that matters.
 *
 * Machine state and readiness are shown separately on every card. They are
 * different facts — a machine can be perfectly available and undeployable
 * because nobody is cleared to sit in it — and merging them hides which of the
 * two problems the supervisor actually has.
 */
import { matchesSearch } from "@/lib/search";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu, Loader2, Search, RefreshCw, AlertTriangle, Wrench, UserPlus, ArrowLeftRight,
  CheckCircle2, Play, Square, Users,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Card, CardHeader, Chip, Tile, type Tone } from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import Toast from "@/components/minehub/Toast";
import { MACHINE_STATE, READINESS, MACHINE_HOLDS, ago } from "./state";

export interface FleetMachine {
  asset_id: number; asset_ref: string | null; fleet_code: string; nickname: string | null;
  asset_type: string | null; asset_type_id: number | null; plant: string | null;
  register_status: string; approval_status: string;
  state: string; holds: { availability_event_id: number; state: string; reason: string | null;
                          started_at: string }[];
  expired_documents: { alert_type: string; days_left: number }[];
  operator: string | null; operator_id: number | null;
  deployment_ref: string | null; deployment_status: string | null;
  open_hoto: { hoto_id: number; hoto_ref: string; status: string } | null;
  readiness: string; blockers: string[]; warnings: string[];
  current_reading: number | null; reading_uom: string | null;
}

interface Candidate {
  operator_id: number; display_name: string; operator_ref: string | null;
  level: number | null; rating: number | null; readiness: string;
  blockers: string[]; warnings: string[]; last_operated: string | null;
}

export default function LiveFleet({ shiftInstanceId, rights, onChanged, onHandover }: {
  shiftInstanceId: number | null;
  rights: { may_manage: boolean; may_hoto: boolean; may_override: boolean };
  onChanged?: () => void;
  onHandover?: (hotoId: number) => void;
}) {
  const [fleet, setFleet] = useState<FleetMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "working" | "blocked" | "down">("all");
  const [open, setOpen] = useState<FleetMachine | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [holdFor, setHoldFor] = useState<FleetMachine | null>(null);
  const [holdState, setHoldState] = useState("BREAKDOWN");
  const [holdReason, setHoldReason] = useState("");
  const [override, setOverride] = useState<{ machine: FleetMachine; operator: Candidate } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/ops/fleet");
      setFleet(r.data ?? []);
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not load the fleet.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The board is only useful if it is current, but every poll is a round trip to
  // another site, and a screen that refreshes while somebody is reading it is
  // its own kind of useless. A minute, and only while the tab is in front.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const counts = useMemo(() => ({
    total: fleet.length,
    running: fleet.filter((m) => m.state === "RUNNING").length,
    available: fleet.filter((m) => m.state === "AVAILABLE").length,
    down: fleet.filter((m) => ["BREAKDOWN", "MAINTENANCE", "INSPECTION_HOLD",
                               "COMPLIANCE_HOLD", "PLANNED_DOWN"].includes(m.state)).length,
    blocked: fleet.filter((m) => m.readiness === "BLOCKED").length,
  }), [fleet]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fleet
      .filter((m) => {
        if (only === "working") return m.state === "RUNNING" || m.state === "ASSIGNED";
        if (only === "blocked") return m.readiness === "BLOCKED";
        if (only === "down") return ["BREAKDOWN", "MAINTENANCE", "INSPECTION_HOLD",
                                     "COMPLIANCE_HOLD", "PLANNED_DOWN"].includes(m.state);
        return true;
      })
      .filter((m) => !q || matchesSearch(q, [m.fleet_code, m.nickname, m.asset_type, m.operator, m.asset_ref]))
      .sort((a, b) => (MACHINE_STATE[a.state]?.rank ?? 99) - (MACHINE_STATE[b.state]?.rank ?? 99)
        || a.fleet_code.localeCompare(b.fleet_code));
  }, [fleet, query, only]);

  const openMachine = async (machine: FleetMachine) => {
    setOpen(machine);
    setCandidates([]);
    try {
      const r = await api.get(`/ops/assets/${machine.asset_id}/candidates`);
      setCandidates(r.data ?? []);
    } catch { setCandidates([]); }
  };

  const deploy = async (machine: FleetMachine, operator: Candidate, reason?: string) => {
    if (!shiftInstanceId) { setError("Open a shift first — a deployment belongs to one."); return; }
    setBusy(`deploy-${operator.operator_id}`);
    try {
      await api.post("/ops/deployments", {
        asset_id: machine.asset_id, operator_id: operator.operator_id,
        shift_instance_id: shiftInstanceId, start_reading: machine.current_reading,
        override_reason: reason,
      });
      setNotice(`${operator.display_name} deployed to ${machine.fleet_code}.`);
      setOpen(null); setOverride(null); setOverrideReason("");
      await load(); onChanged?.();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      if (detail && typeof detail === "object" && "blockers" in detail && rights.may_override) {
        setOverride({ machine, operator });
      } else {
        const blockers = detail && typeof detail === "object" && "blockers" in detail
          ? (detail as { blockers: string[] }).blockers.join("; ")
          : typeof detail === "string" ? detail : "Could not deploy.";
        setError(blockers);
      }
    } finally { setBusy(null); }
  };

  const act = async (path: string, said: string) => {
    setBusy(path);
    try {
      await api.post(path, {});
      setNotice(said);
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That did not work.");
    } finally { setBusy(null); }
  };

  const placeHold = async () => {
    if (!holdFor) return;
    setBusy("hold");
    try {
      await api.post("/ops/availability", {
        asset_id: holdFor.asset_id, state: holdState, reason: holdReason || undefined,
        shift_instance_id: shiftInstanceId,
      });
      setNotice(`${holdFor.fleet_code} marked ${holdState.replace("_", " ").toLowerCase()}.`);
      setHoldFor(null); setHoldReason("");
      await load(); onChanged?.();
    } catch { setError("Could not record that."); }
    finally { setBusy(null); }
  };

  const release = async (machine: FleetMachine, holdId: number) => {
    setBusy(`release-${holdId}`);
    try {
      await api.post(`/ops/availability/${holdId}/release`, {});
      setNotice(`${machine.fleet_code} released.`);
      await load(); onChanged?.();
    } catch { setError("Could not release it."); }
    finally { setBusy(null); }
  };

  const startHandover = async (machine: FleetMachine) => {
    setBusy("hoto");
    try {
      const r = await api.post("/ops/hoto", {
        asset_id: machine.asset_id, shift_instance_id: shiftInstanceId,
        meter_reading: machine.current_reading,
      });
      setNotice(`Handover ${r.data.hoto_ref} started.`);
      setOpen(null);
      onHandover?.(r.data.hoto_id);
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not start the handover.");
    } finally { setBusy(null); }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  return (
    <div className="space-y-4">
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Running" value={counts.running} tone="emerald" icon={Play}
              hint={`of ${counts.total} machines`} onClick={() => setOnly("working")}
              active={only === "working"} />
        <Tile label="Available" value={counts.available} tone="teal" icon={CheckCircle2}
              hint="no hold against them" onClick={() => setOnly("all")} active={only === "all"} />
        <Tile label="Down" value={counts.down} tone={counts.down ? "rose" : "slate"} icon={Wrench}
              hint="breakdown, maintenance, hold" onClick={() => setOnly("down")}
              active={only === "down"} />
        <Tile label="Blocked" value={counts.blocked} tone={counts.blocked ? "amber" : "emerald"}
              icon={AlertTriangle} hint="cannot start work as things stand"
              onClick={() => setOnly("blocked")} active={only === "blocked"} />
      </div>

      <Card tone="sky">
        <CardHeader title={`Live fleet · ${shown.length}`} icon={Cpu} tone="sky"
          subtitle="What each machine is doing, who has it, and what is stopping the rest. Refreshes itself every half minute."
          actions={
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
                <input value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Machine, operator, type…"
                  className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5 text-[12px]
                             w-full sm:w-[320px] lg:w-[440px] xl:w-[520px] focus:outline-none focus:border-gold" />
              </div>
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </>
          } />

        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {shown.length === 0 && (
            <p className="col-span-full text-center py-10 text-[13px] text-txt-muted">
              Nothing matches. {only !== "all" && "Try All machines."}
            </p>
          )}
          {shown.map((m) => {
            const state = MACHINE_STATE[m.state] ?? { label: m.state, tone: "slate" as Tone, rank: 99 };
            const ready = READINESS[m.readiness] ?? { label: m.readiness, tone: "slate" as Tone };
            return (
              <button key={m.asset_id} onClick={() => void openMachine(m)}
                className={`text-left rounded-xl border bg-bg-base p-3.5 transition-all
                            hover:shadow-md hover:-translate-y-0.5
                            ${m.readiness === "BLOCKED" ? "border-rose-ring" :
                              m.state === "RUNNING" ? "border-emerald-ring" : "border-border-light"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-condensed font-extrabold text-[15px] text-navy truncate">
                      {m.nickname || m.fleet_code}
                    </div>
                    <div className="font-mono text-[10.5px] text-txt-light truncate">
                      {m.asset_ref} · {m.fleet_code}
                    </div>
                  </div>
                  <Chip tone={state.tone}>{state.label}</Chip>
                </div>

                <div className="mt-2.5 flex items-center gap-2 text-[12px]">
                  <Users className="w-3.5 h-3.5 text-txt-light shrink-0" />
                  <span className={m.operator ? "text-txt-primary font-medium truncate" : "text-txt-light"}>
                    {m.operator ?? "no operator"}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <Chip tone={ready.tone} dot={false}>{ready.label}</Chip>
                  {m.open_hoto && (
                    <span className="text-[10.5px] font-mono text-amber">{m.open_hoto.hoto_ref}</span>
                  )}
                </div>

                {(m.blockers.length > 0 || m.holds.length > 0) && (
                  <p className="mt-2 text-[11px] text-rose leading-snug line-clamp-2">
                    {m.blockers[0] ?? m.holds[0]?.reason ?? ""}
                    {m.blockers.length > 1 && ` +${m.blockers.length - 1} more`}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* One machine, in full */}
      <Dialog open={Boolean(open)} tone="info"
        title={open ? `${open.nickname || open.fleet_code} · ${MACHINE_STATE[open.state]?.label ?? open.state}` : ""}
        confirmLabel="Close" cancelLabel="" onConfirm={() => setOpen(null)} onCancel={() => setOpen(null)}>
        {open && (
          <div className="space-y-3 text-left">
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={READINESS[open.readiness]?.tone ?? "slate"}>
                {READINESS[open.readiness]?.label ?? open.readiness}
              </Chip>
              {open.asset_type && <Chip tone="slate" dot={false}>{open.asset_type}</Chip>}
              {open.current_reading !== null && (
                <Chip tone="slate" dot={false}>
                  {open.current_reading} {open.reading_uom?.toLowerCase()}
                </Chip>
              )}
            </div>

            {open.blockers.length > 0 && (
              <div className="rounded-lg border border-rose-ring bg-rose-bg px-3 py-2">
                <div className="text-[11px] font-bold uppercase tracking-[.08em] text-rose mb-1">
                  Stopping work
                </div>
                <ul className="text-[12.5px] text-txt-primary space-y-0.5">
                  {open.blockers.map((b, i) => <li key={i}>· {b}</li>)}
                </ul>
              </div>
            )}
            {open.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-ring bg-amber-bg px-3 py-2">
                <div className="text-[11px] font-bold uppercase tracking-[.08em] text-amber mb-1">
                  Worth knowing
                </div>
                <ul className="text-[12.5px] text-txt-primary space-y-0.5">
                  {open.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                </ul>
              </div>
            )}

            {open.holds.length > 0 && (
              <div className="space-y-1.5">
                {open.holds.map((h) => (
                  <div key={h.availability_event_id}
                    className="flex items-center justify-between gap-2 rounded-lg border
                               border-border-light bg-bg-light px-3 py-2">
                    <span className="text-[12.5px] min-w-0">
                      <span className="font-semibold text-navy">
                        {h.state.replace("_", " ").toLowerCase()}
                      </span>
                      {h.reason && <span className="text-txt-muted"> — {h.reason}</span>}
                      <span className="block text-[11px] text-txt-light">{ago(h.started_at)}</span>
                    </span>
                    {rights.may_manage && (
                      <Button size="sm" variant="secondary"
                        disabled={busy === `release-${h.availability_event_id}`}
                        onClick={() => void release(open, h.availability_event_id)}>
                        Release
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {rights.may_manage && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="secondary" onClick={() => { setHoldFor(open); setOpen(null); }}>
                  <Wrench className="w-3.5 h-3.5" /> Mark unavailable
                </Button>
                {open.deployment_ref && open.deployment_status !== "RUNNING" && (
                  <Button size="sm" variant="success" disabled={busy !== null}
                    onClick={() => void act(`/ops/deployments/${open.deployment_ref}/start`, "Started.")}>
                    <Play className="w-3.5 h-3.5" /> Start work
                  </Button>
                )}
                {rights.may_hoto && open.operator && (
                  <Button size="sm" variant="accent" disabled={busy === "hoto"}
                    onClick={() => void startHandover(open)}>
                    <ArrowLeftRight className="w-3.5 h-3.5" /> Hand over
                  </Button>
                )}
              </div>
            )}

            {/* Who could take it */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.08em] text-txt-light mb-1.5">
                Who can run this {candidates.length ? `· ${candidates.length}` : ""}
              </div>
              {candidates.length === 0 ? (
                <p className="text-[12.5px] text-txt-muted">
                  Nobody is assessed on this class yet. Competency is recorded on the
                  operator profile.
                </p>
              ) : (
                <ul className="space-y-1.5 max-h-[220px] overflow-y-auto">
                  {candidates.map((c) => (
                    <li key={c.operator_id}
                      className="flex items-center justify-between gap-2 rounded-lg border
                                 border-border-light px-3 py-2">
                      <span className="min-w-0">
                        <span className="text-[13px] font-semibold text-navy">{c.display_name}</span>
                        <span className="block text-[11px] text-txt-light">
                          L{c.level ?? 0}{c.rating ? ` · ★${c.rating}` : ""}
                          {c.last_operated ? ` · last ran ${ago(c.last_operated)}` : " · never on this class"}
                        </span>
                        {c.blockers.length > 0 && (
                          <span className="block text-[11px] text-rose">{c.blockers[0]}</span>
                        )}
                      </span>
                      {rights.may_manage && (
                        <Button size="sm"
                          variant={c.readiness === "READY" ? "primary" : "secondary"}
                          disabled={busy === `deploy-${c.operator_id}`}
                          onClick={() => void deploy(open, c)}>
                          <UserPlus className="w-3.5 h-3.5" /> Deploy
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* Mark unavailable */}
      <Dialog open={Boolean(holdFor)} tone="warning"
        title={holdFor ? `Mark ${holdFor.fleet_code} unavailable` : ""}
        confirmLabel="Record it" cancelLabel="Cancel" busy={busy === "hold"}
        onConfirm={() => void placeHold()} onCancel={() => { setHoldFor(null); setHoldReason(""); }}>
        A machine marked unavailable stops being deployable, and any live
        deployment on it is closed rather than left looking like production.
        <div className="mt-3 space-y-2">
          <select value={holdState} onChange={(e) => setHoldState(e.target.value)}
            className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]">
            {MACHINE_HOLDS.map((h) => <option key={h.state} value={h.state}>{h.label}</option>)}
          </select>
          <input value={holdReason} onChange={(e) => setHoldReason(e.target.value)}
            placeholder="What happened — hydraulic hose burst at the face"
            className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]" />
        </div>
      </Dialog>

      {/* Override */}
      <Dialog open={Boolean(override)} tone="danger" title="Deploy against a block?"
        confirmLabel="Deploy and record it" cancelLabel="Do not"
        busy={busy !== null || !overrideReason.trim()}
        onConfirm={() => override && void deploy(override.machine, override.operator, overrideReason.trim())}
        onCancel={() => { setOverride(null); setOverrideReason(""); }}>
        {override && (
          <>
            <p>
              {override.operator.display_name} on {override.machine.fleet_code} is blocked:
            </p>
            <ul className="mt-1.5 text-[12.5px] text-rose space-y-0.5">
              {override.machine.blockers.map((b, i) => <li key={i}>· {b}</li>)}
              {override.operator.blockers.map((b, i) => <li key={`o${i}`}>· {b}</li>)}
            </ul>
            <p className="mt-2 text-[12px] text-txt-muted">
              Overriding is allowed and recorded: the reason goes on the deployment
              and raises a critical exception against this shift.
            </p>
            <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why this is going ahead anyway"
              className="mt-2 w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]" />
          </>
        )}
      </Dialog>
    </div>
  );
}
