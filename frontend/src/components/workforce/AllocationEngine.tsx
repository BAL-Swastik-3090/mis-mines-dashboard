"use client";
/**
 * The allocation the engine would make, with its reasoning on the page.
 *
 * Every line says why, in words, before it says who. A supervisor who cannot
 * see the reasoning has two choices — accept everything or accept nothing — and
 * both of those are worse than the whiteboard this replaces. So the reasons are
 * not behind a tooltip: they are the row.
 *
 * Accepting is per-line, and nothing is pre-ticked except the strong matches.
 * Machines the engine could not fill are shown with as much prominence as the
 * ones it could, because the excavator nobody in the mine can legally run is
 * the single most useful thing on this screen.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles, Loader2, Check, AlertTriangle, Users, Cpu, Star, RefreshCw,
  UserX, CircleSlash, ChevronDown, ChevronRight,
} from "lucide-react";
import api from "@/lib/api";
import {
  Button, Card, CardHeader, Chip, Tile, Avatar, Alert,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import { CONFIDENCE } from "./state";

interface Proposal {
  asset_id: number; fleet_code: string; asset_ref: string; asset_type: string;
  machine_state: string;
  operator_id: number; operator_ref: string | null; display_name: string;
  designation: string | null;
  score: number; level: number; rating: number | null;
  reasons: string[]; warnings: string[]; confidence: string;
  alternatives: { operator_id: number; display_name: string; score: number;
                  level: number }[];
}

interface Plan {
  found: boolean;
  shift: { shift_code: string; shift_name: string; production_day: string;
           plant_name: string | null; status: string };
  proposals: Proposal[];
  unfilled: { asset_id: number; fleet_code: string; asset_type: string;
              why: string; qualified_on_duty: number }[];
  idle_operators: { operator_id: number; display_name: string; designation: string | null;
                    classes: number; why: string }[];
  already_deployed: { operator_id: number; display_name: string }[];
  withheld_machines: { asset_id: number; fleet_code: string; asset_type: string;
                       state: string; why: string }[];
  on_leave: number;
  summary: Record<string, number>;
}

export default function AllocationEngine({ shiftInstanceId, mayDeploy, onChanged }: {
  shiftInstanceId: number | null; mayDeploy: boolean; onChanged?: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!shiftInstanceId) { setPlan(null); return; }
    setLoading(true);
    try {
      const r = await api.get(`/workforce/allocate/${shiftInstanceId}`);
      setPlan(r.data);
      // Strong matches start ticked; anything the engine is unsure about waits
      // to be read. A screen that pre-accepts its own doubts is a screen that
      // trains people to click through it.
      setPicked(new Set((r.data?.proposals ?? [])
        .filter((p: Proposal) => p.confidence === "high")
        .map((p: Proposal) => p.asset_id)));
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The allocation could not be worked out.");
      setPlan(null);
    } finally { setLoading(false); }
  }, [shiftInstanceId]);

  useEffect(() => { void load(); }, [load]);

  const chosen = useMemo(
    () => (plan?.proposals ?? []).filter((p) => picked.has(p.asset_id)), [plan, picked]);

  const toggle = (id: number) => setPicked((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const expand = (id: number) => setExpanded((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const accept = async () => {
    if (!shiftInstanceId || chosen.length === 0) return;
    setBusy(true);
    try {
      const r = await api.post(`/workforce/allocate/${shiftInstanceId}`, {
        pairs: chosen.map((p) => ({ asset_id: p.asset_id, operator_id: p.operator_id })),
      });
      const refused = r.data?.refused ?? [];
      setNotice(`${r.data?.deployed?.length ?? 0} deployed.`
        + (refused.length
          ? ` ${refused.length} refused — something changed since the plan was worked out: `
            + refused.map((x: { blockers: string[] }) => x.blockers[0]).join("; ")
          : ""));
      setConfirming(false);
      await load();
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The deployments could not be made.");
    } finally { setBusy(false); }
  };

  if (!shiftInstanceId) {
    return (
      <Card><div className="px-5 py-12 text-center text-[13px] text-txt-muted">
        Choose a shift at the top. An allocation belongs to one shift — who is on
        duty, which machines are free and what is blocking them all change with it.
      </div></Card>
    );
  }

  const s = plan?.summary ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Machines needing a crew" value={s.machines_needing_an_operator ?? 0}
              icon={Cpu} tone="navy" hint="Free, working, and nobody on them" />
        <Tile label="Can be crewed" value={s.proposed ?? 0} icon={Sparkles} tone="emerald"
              hint={`${s.coverage_pct ?? 0}% of what needs an operator`} />
        <Tile label="Cannot be crewed" value={s.could_not_fill ?? 0} icon={CircleSlash}
              tone={(s.could_not_fill ?? 0) ? "rose" : "slate"}
              hint={(s.could_not_fill ?? 0) ? "Nobody on duty can run them" : "Everything is covered"} />
        <Tile label="On duty" value={s.operators_on_duty ?? 0} icon={Users} tone="sky"
              hint={`${plan?.on_leave ?? 0} on leave today`} />
        <Tile label="Left over" value={s.operators_unused ?? 0} icon={UserX} tone="amber"
              hint="On duty with no machine to take" />
      </div>

      <Card>
        <CardHeader
          title="What the engine would do" icon={Sparkles} tone="violet"
          subtitle={plan?.shift
            ? `${plan.shift.shift_code} shift · ${plan.shift.production_day}`
            : "Working it out"}
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                Work it out again
              </Button>
              {mayDeploy && (
                <Button size="sm" variant="primary" disabled={chosen.length === 0}
                        onClick={() => setConfirming(true)}>
                  <Check className="w-3.5 h-3.5" />
                  Deploy {chosen.length || ""}
                </Button>
              )}
            </div>
          }
        />

        {error && (
          <div className="px-5 py-3 text-[12px] text-rose bg-rose-bg border-b border-rose/20">
            {error}
          </div>
        )}
        {notice && (
          <div className="px-5 py-3 text-[12px] text-sky bg-sky-bg border-b border-sky/20">
            {notice}
          </div>
        )}

        <div className="px-5 py-3 border-b border-slate-100 text-[11.5px] text-txt-muted">
          Scarce machines are crewed first — the one two people can run before the
          one forty can. Within that: competency, expertise rating, whether they
          have been assessed on that exact machine, how recently they ran the
          class, and how little they have worked this week.
        </div>

        {loading ? (
          <div className="px-5 py-16 text-center text-[13px] text-txt-muted">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Scoring every operator against every machine…
          </div>
        ) : !plan?.proposals.length ? (
          <div className="px-5 py-12 text-center text-[13px] text-txt-muted">
            Nothing to propose. Either every machine already has somebody, or
            nobody rostered onto this shift is assessed on what is free.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {plan.proposals.map((p) => {
              const look = CONFIDENCE[p.confidence] ?? CONFIDENCE.fair;
              const open = expanded.has(p.asset_id);
              return (
                <div key={p.asset_id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {mayDeploy && (
                      <input type="checkbox" checked={picked.has(p.asset_id)}
                             onChange={() => toggle(p.asset_id)}
                             className="w-4 h-4 rounded border-slate-300" />
                    )}
                    <div className="min-w-[150px]">
                      <p className="text-[13px] font-bold text-navy">{p.fleet_code}</p>
                      <p className="text-[11px] text-txt-light">{p.asset_type}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-txt-light shrink-0" />
                    <Avatar name={p.display_name} />
                    <div className="min-w-[170px]">
                      <p className="text-[13px] font-semibold text-navy">{p.display_name}</p>
                      <p className="text-[11px] text-txt-light">
                        {p.operator_ref || "—"} · {p.designation || "role not set"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Chip tone={look.tone}>{look.label}</Chip>
                      <Chip tone="navy" dot={false}>Level {p.level}</Chip>
                      {p.rating && (
                        <Chip tone="gold" dot={false}>
                          <Star className="w-3 h-3 fill-current" /> {p.rating}
                        </Chip>
                      )}
                      {p.warnings.length > 0 && (
                        <Chip tone="amber" dot={false}>
                          <AlertTriangle className="w-3 h-3" /> {p.warnings.length}
                        </Chip>
                      )}
                    </div>
                    <button onClick={() => expand(p.asset_id)}
                      className="ml-auto text-[11.5px] text-txt-muted hover:text-navy
                                 inline-flex items-center gap-1">
                      {open ? "Less" : "Why"}
                      <ChevronDown className={`w-3.5 h-3.5 transition ${open ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  <div className="mt-1.5 ml-7 flex flex-wrap gap-x-3 gap-y-1">
                    {p.reasons.map((r, i) => (
                      <span key={i} className="text-[11.5px] text-txt-muted">• {r}</span>
                    ))}
                  </div>

                  {p.warnings.length > 0 && (
                    <div className="mt-1.5 ml-7 flex flex-wrap gap-x-3 gap-y-1">
                      {p.warnings.map((w, i) => (
                        <span key={i} className="text-[11.5px] text-amber font-medium">⚠ {w}</span>
                      ))}
                    </div>
                  )}

                  {open && (
                    <div className="mt-2 ml-7 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-txt-light mb-1.5">
                        Who else could take it
                      </p>
                      {p.alternatives.length === 0 ? (
                        <p className="text-[11.5px] text-rose">
                          Nobody else on duty is assessed on this class. If this
                          person cannot take it, the machine stands.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {p.alternatives.map((a) => (
                            <span key={a.operator_id}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-white
                                         border border-slate-200 px-2 py-1 text-[11.5px]">
                              <span className="font-semibold text-navy">{a.display_name}</span>
                              <span className="text-txt-light">level {a.level}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {(plan?.unfilled.length ?? 0) > 0 && (
        <Card tone="rose">
          <CardHeader title="Machines nobody on duty can run" icon={CircleSlash} tone="rose"
            subtitle="The most useful thing on this page — each of these is a machine standing for a reason you can fix" />
          <div className="divide-y divide-slate-100">
            {plan!.unfilled.map((u) => (
              <div key={u.asset_id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-[150px]">
                  <p className="text-[13px] font-bold text-navy">{u.fleet_code}</p>
                  <p className="text-[11px] text-txt-light">{u.asset_type}</p>
                </div>
                <p className="text-[12.5px] text-rose flex-1">{u.why}</p>
                <Chip tone={u.qualified_on_duty ? "amber" : "rose"} dot={false}>
                  {u.qualified_on_duty} qualified on duty
                </Chip>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(plan?.idle_operators.length ?? 0) > 0 && (
        <Card>
          <CardHeader title="On duty with nothing to run" icon={UserX} tone="amber"
            subtitle="Qualified, present, and no machine left needing them" />
          <div className="px-5 py-3 flex flex-wrap gap-2">
            {plan!.idle_operators.map((o) => (
              <span key={o.operator_id}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200
                           bg-white px-2.5 py-1.5">
                <Avatar name={o.display_name} size="sm" />
                <span>
                  <span className="block text-[12px] font-semibold text-navy">{o.display_name}</span>
                  <span className="block text-[10.5px] text-txt-light">
                    {o.classes} class{o.classes === 1 ? "" : "es"} · {o.designation || "role not set"}
                  </span>
                </span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <Dialog open={confirming} tone="warning" title={`Deploy ${chosen.length}`}
        confirmLabel="Deploy them" busy={busy}
        onConfirm={() => void accept()} onCancel={() => setConfirming(false)}>
        <div className="space-y-2">
          <p>
            Each line is checked again at this moment rather than trusted from when
            the plan was worked out — a page open since six o&apos;clock is not
            evidence about half past seven. Anything that has since become blocked
            comes back unwritten.
          </p>
          {chosen.some((p) => p.warnings.length > 0) && (
            <Alert tone="warning">
              {chosen.filter((p) => p.warnings.length).length} of these carry warnings.
              They are deployable, but somebody should know.
            </Alert>
          )}
        </div>
      </Dialog>
    </div>
  );
}
