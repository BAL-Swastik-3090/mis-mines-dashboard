"use client";
/**
 * Plan against deployment against what the machines actually did.
 *
 * The chain is only worth having if the end of it can be checked against the
 * start, and this is that check. Disagreement is the output rather than a
 * failure of it: a machine that ran six hours with nobody deployed on it is the
 * most useful line on the screen, because somebody operated it and the register
 * does not know who.
 *
 * The unlinked feeds sit at the top when there are any, because until a
 * telematics name is joined to a machine none of the rest of this can work —
 * and linking is one click from here rather than a trip to another screen.
 */
import SearchSelect from "@/components/minehub/SearchSelect";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "@/components/minehub/DateField";
import {
  GitCompare, Loader2, Radio, Link2, AlertTriangle, Fuel, Clock, Gauge, Flag,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Card, CardHeader, Chip, EmptyRow, Td, Th, Tile, type Tone }
  from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import Toast from "@/components/minehub/Toast";
import { SEVERITY } from "./state";

interface Reading {
  vehicle_desc: string; feed: string; engine_hours: number; moving_hours: number;
  idle_hours: number; distance: number; fuel_consumed: number; readings: number;
}

interface Finding { kind: string; severity: string; detail: string }

interface Row {
  asset_id: number; asset_ref: string | null; fleet_code: string; nickname: string | null;
  asset_type: string | null; linked: boolean;
  planned: { activity: string | null; shift_code: string; planned_operator: string | null }[];
  deployments: { deployment_ref: string; operator_name: string | null; status: string;
                 shift_code: string }[];
  deployed_hours: number; telematics: Reading | null;
  holds: { state: string; reason: string | null; hours: number }[];
  findings: Finding[];
}

interface Data {
  day: string;
  totals: Record<string, number>;
  machines: Row[];
  unlinked: Reading[];
}

const FINDING_LABEL: Record<string, string> = {
  RAN_WITHOUT_DEPLOYMENT: "Ran with nobody deployed",
  DEPLOYED_BUT_IDLE: "Deployed, no engine time",
  TELEMATICS_SILENT: "Box sent nothing",
  HOURS_DISAGREE: "Hours disagree",
  MULTIPLE_READINGS: "Several readings",
  MOSTLY_IDLING: "Mostly idling",
};

export default function Reconciliation({ rights, onChanged }: {
  rights: { may_manage: boolean; may_hoto: boolean; may_override: boolean };
  onChanged?: () => void;
}) {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linking, setLinking] = useState<Reading | null>(null);
  const [linkTo, setLinkTo] = useState("");
  const [machines, setMachines] = useState<{ asset_id: number; fleet_code: string;
                                             nickname: string | null }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, m] = await Promise.all([
        api.get("/ops/reconcile", { params: { day } }),
        api.get("/minehub/assets").catch(() => ({ data: [] })),
      ]);
      setData(r.data);
      setMachines(m.data ?? []);
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not reconcile that day.");
    } finally { setLoading(false); }
  }, [day]);

  useEffect(() => { void load(); }, [load]);

  const link = async () => {
    if (!linking || !linkTo) return;
    setBusy("link");
    try {
      await api.post(`/minehub/assets/${linkTo}/identities`, {
        system: "TELEMATICS", external_code: linking.vehicle_desc,
      });
      setNotice(`${linking.vehicle_desc} now belongs to a machine — its hours will reconcile from here.`);
      setLinking(null); setLinkTo("");
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not link that name.");
    } finally { setBusy(null); }
  };

  const raise = async () => {
    setBusy("raise");
    try {
      const r = await api.post("/ops/reconcile/raise", { day });
      setNotice(r.data.raised
        ? `${r.data.raised} put on the exception queue.`
        : "Nothing worth chasing — the notes stay here.");
      await load(); onChanged?.();
    } catch { setError("Could not raise those."); }
    finally { setBusy(null); }
  };

  const withFindings = useMemo(
    () => (data?.machines ?? []).filter((m) => m.findings.length > 0), [data]);
  const working = useMemo(
    () => (data?.machines ?? []).filter((m) => m.telematics || m.deployments.length), [data]);

  const totals = data?.totals ?? {};
  const idleShare = totals.engine_hours
    ? Math.round((Number(totals.idle_hours) / Number(totals.engine_hours)) * 100) : 0;

  return (
    <div className="space-y-4">
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-txt-muted max-w-2xl">
          What was planned, who was deployed, and what the boxes on the machines
          actually saw. Where those three disagree is the point of the screen.
        </p>
        <span className="flex items-center gap-2">
          <DateField value={day} max={new Date().toISOString().slice(0, 10)} onChange={(v) => setDay(v)} className="bg-bg-base border border-border rounded-lg px-3 py-1.5 text-[12.5px]" />
          {rights.may_manage && withFindings.length > 0 && (
            <Button size="sm" variant="secondary" disabled={busy === "raise"}
              onClick={() => void raise()}>
              <Flag className="w-3.5 h-3.5" /> Raise as exceptions
            </Button>
          )}
        </span>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Deployed" value={totals.deployed ?? 0} tone="sky" icon={Clock}
                  hint={`${totals.deployed_hours ?? 0} recorded hours`} />
            <Tile label="Transmitting" value={totals.transmitting ?? 0} tone="violet" icon={Radio}
                  hint={`${totals.engine_hours ?? 0} engine hours seen`} />
            <Tile label="Idling" value={`${idleShare}%`}
                  tone={idleShare > 50 ? "rose" : idleShare > 30 ? "amber" : "emerald"}
                  icon={Gauge} hint={`${totals.idle_hours ?? 0} of ${totals.engine_hours ?? 0} hours`} />
            <Tile label="Disagreements" value={totals.findings ?? 0}
                  tone={totals.findings ? "amber" : "emerald"} icon={AlertTriangle}
                  hint={`${totals.unlinked_feeds ?? 0} feeds not linked to a machine`} />
          </div>

          {/* Until a name is linked, nothing else can join */}
          {(data?.unlinked.length ?? 0) > 0 && (
            <Card tone="amber">
              <CardHeader title={`${data!.unlinked.length} machines transmitting under a name nobody has linked`}
                icon={Radio} tone="amber"
                subtitle="Their hours cannot join a deployment until somebody says which machine each one is. Not guessed at: MAN18 and MAN-18 are the same machine, MAN18 and MAN81 are not, and only a person knows which case this is." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr><Th>Telematics name</Th><Th>Feed</Th><Th className="text-right">Engine</Th>
                        <Th className="text-right">Idle</Th><Th className="text-right">Fuel</Th>
                        <Th className="text-right">Action</Th></tr>
                  </thead>
                  <tbody>
                    {data!.unlinked.slice(0, 12).map((u) => (
                      <tr key={u.vehicle_desc} className="hover:bg-bg-light transition-colors">
                        <Td className="font-mono text-[12px] text-navy font-semibold">
                          {u.vehicle_desc}
                        </Td>
                        <Td><Chip tone={u.feed === "MAN" ? "sky" : "violet"} dot={false}>{u.feed}</Chip></Td>
                        <Td className="text-right tabular-nums">{u.engine_hours.toFixed(1)} h</Td>
                        <Td className="text-right tabular-nums text-txt-muted">
                          {u.idle_hours.toFixed(1)} h
                        </Td>
                        <Td className="text-right tabular-nums text-txt-muted">
                          {u.fuel_consumed.toFixed(1)} L
                        </Td>
                        <Td className="text-right">
                          {rights.may_manage && (
                            <Button size="sm" variant="primary" onClick={() => setLinking(u)}>
                              <Link2 className="w-3.5 h-3.5" /> Link
                            </Button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data!.unlinked.length > 12 && (
                <p className="px-5 py-2.5 text-[12px] text-txt-light border-t border-border-light">
                  and {data!.unlinked.length - 12} more.
                </p>
              )}
            </Card>
          )}

          {/* The comparison itself */}
          <Card tone="sky">
            <CardHeader title={`Plan against actual · ${working.length}`} icon={GitCompare} tone="sky"
              subtitle="Machines that were planned, deployed or seen working on this day. The rest are left out rather than padding the screen with zeroes." />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Machine</Th><Th>Planned</Th><Th>Deployed to</Th>
                    <Th className="text-right">Deployed h</Th><Th className="text-right">Engine h</Th>
                    <Th className="text-right">Idle</Th><Th className="text-right">Fuel</Th>
                    <Th>What disagrees</Th>
                  </tr>
                </thead>
                <tbody>
                  {working.length === 0 ? (
                    <EmptyRow colSpan={8}>
                      Nothing planned, deployed or transmitting on this day — or no
                      telematics name has been linked to a machine yet, which is the
                      first thing to fix.
                    </EmptyRow>
                  ) : working.map((m) => {
                    const t = m.telematics;
                    const idle = t && t.engine_hours > 0
                      ? Math.round((t.idle_hours / t.engine_hours) * 100) : null;
                    return (
                      <tr key={m.asset_id}
                          className={`transition-colors ${m.findings.some((f) => f.severity === "HIGH")
                            ? "bg-rose-bg/40 hover:bg-rose-bg" : "hover:bg-bg-light"}`}>
                        <Td>
                          <span className="font-semibold text-navy">{m.nickname || m.fleet_code}</span>
                          <span className="block font-mono text-[11px] text-txt-light">
                            {m.fleet_code}
                          </span>
                        </Td>
                        <Td className="text-txt-muted text-[12px]">
                          {m.planned.length
                            ? m.planned.map((p) => `${p.shift_code}${p.activity ? ` · ${p.activity}` : ""}`).join(", ")
                            : "—"}
                        </Td>
                        <Td className="text-[12px]">
                          {m.deployments.length ? (
                            <>
                              {m.deployments.map((d) => d.operator_name ?? "unassigned").join(", ")}
                              <span className="block font-mono text-[10.5px] text-txt-light">
                                {m.deployments.map((d) => d.deployment_ref).join(" ")}
                              </span>
                            </>
                          ) : <span className="text-txt-light">nobody</span>}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {m.deployed_hours ? m.deployed_hours.toFixed(1) : "—"}
                        </Td>
                        <Td className="text-right tabular-nums font-semibold text-navy">
                          {t ? t.engine_hours.toFixed(1) : m.linked ? "0.0" : "—"}
                        </Td>
                        <Td className="text-right">
                          {idle === null ? "—" : (
                            <Chip tone={idle > 60 ? "rose" : idle > 35 ? "amber" : "emerald"} dot={false}>
                              {idle}%
                            </Chip>
                          )}
                        </Td>
                        <Td className="text-right tabular-nums text-txt-muted">
                          {t ? `${t.fuel_consumed.toFixed(1)} L` : "—"}
                        </Td>
                        <Td>
                          {m.findings.length === 0 ? (
                            <span className="text-[12px] text-emerald">agrees</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {m.findings.map((f, i) => (
                                <Chip key={i} tone={SEVERITY[f.severity] ?? "slate"} dot={false}
                                      title={f.detail}>
                                  {FINDING_LABEL[f.kind] ?? f.kind}
                                </Chip>
                              ))}
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* The findings, in words */}
          {withFindings.length > 0 && (
            <Card tone="rose">
              <CardHeader title={`What disagrees · ${totals.findings ?? 0}`} icon={AlertTriangle}
                tone="rose" subtitle="Said in full, because a chip nobody hovers over is a finding nobody reads." />
              <ul className="divide-y divide-border-light">
                {withFindings.map((m) => (
                  <li key={m.asset_id} className="px-5 py-3">
                    <span className="font-semibold text-navy text-[13px]">
                      {m.nickname || m.fleet_code}
                    </span>
                    <ul className="mt-1 space-y-1">
                      {m.findings.map((f, i) => (
                        <li key={i} className="text-[12.5px] leading-snug">
                          <Chip tone={SEVERITY[f.severity] ?? "slate"} dot={false}>
                            {f.severity.toLowerCase()}
                          </Chip>
                          <span className="text-txt-secondary ml-2">{f.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {/* Link a feed to a machine */}
      <Dialog open={Boolean(linking)} tone="info"
        title={linking ? `Which machine is ${linking.vehicle_desc}?` : ""}
        confirmLabel="Link it" cancelLabel="Cancel" busy={busy === "link" || !linkTo}
        onConfirm={() => void link()} onCancel={() => { setLinking(null); setLinkTo(""); }}>
        Once linked, this feed's hours join that machine everywhere — reconciliation,
        utilisation, and the meter reading at handover. The link is a statement of
        fact, so it is worth being sure.
        <div className="mt-2.5">
          <SearchSelect field value={linkTo} onChange={setLinkTo}
            placeholder="Choose the machine…"
            searchPlaceholder="Type a fleet code…"
            options={machines.map((m) => ({
              value: String(m.asset_id), label: m.fleet_code,
              hint: m.nickname ?? undefined,
            }))} />
        </div>
      </Dialog>
    </div>
  );
}
