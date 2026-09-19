"use client";
/**
 * Equipment Registry.
 *
 * Opens with the machines that are transmitting telematics nobody can attribute
 * to anything, because clearing that list IS the task — 42 machines currently
 * send data under names no register claims. Registering from one of those rows
 * carries the telematics name across, so the common path never involves typing
 * a code twice and then wondering why the join does not work.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Link2, Trash2, Check, Loader2, Radio, ChevronDown, ChevronRight,
  Cpu, Fuel, Zap, Wrench, Plus, Building2,
} from "lucide-react";
import api from "@/lib/api";
import CommentThread from "@/components/comments/CommentThread";
import { useAuth } from "@/contexts/useAuth";
import AssetForm from "./AssetForm";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, Td, Th, Tile, inputClass, type Tone,
} from "./ui";

interface Summary {
  assets: number; assets_active: number; aliases: number; asset_types: number;
  people: number; organisations: number; events: number;
}
interface Asset {
  asset_id: number; asset_ref?: string | null; fleet_code: string; nickname?: string | null;
  registration_no: string | null; make: string | null; model: string | null;
  ownership: string; status: string; asset_type: string; category: string;
  propulsion?: string | null; fuel_type?: string | null;
  owner: string | null; alias_count: number; alias_systems: string | null;
  version?: number; approval_status?: string;
}
interface Identity { asset_identity_id: number; system: string; external_code: string }
interface Unmapped { vehicle_desc: string; feed: string; rows_: number; last_seen: string }

/** Approval state is separate from operating state — a machine can be running
    while its record is still awaiting review. */
const APPROVAL_TONE: Record<string, Tone> = {
  DRAFT: "slate", SUBMITTED: "amber", SENT_BACK: "rose", APPROVED: "emerald",
};

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "emerald", MAINTENANCE: "amber", STANDBY: "sky",
  IDLE: "slate", DISPOSED: "rose",
};

/** Equipment categories get their own hue so a long register stays scannable. */
const CATEGORY_TONE: Record<string, Tone> = {
  EXCAVATION: "violet", HAULAGE: "sky", DRILLING: "indigo", DOZING: "teal",
  GRADING: "emerald", LIFTING: "amber", WATER: "sky", PUMP: "teal",
  SUPPORT: "slate", LIGHTING: "amber", LMV: "slate", OTHER: "slate",
};

export default function EquipmentPanel({ addOpen, onAddOpenChange, onFormOpenChange, onChanged }: {
  addOpen?: boolean; onAddOpenChange?: (v: boolean) => void;
  /** The registration sheet is on screen — editing counts, not just adding. */
  onFormOpenChange?: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const can = useAuth((s) => s.can);
  const mayManage = can("platform.registry.manage");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [unmapped, setUnmapped] = useState<Unmapped[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [propulsion, setPropulsion] = useState("");

  // Hybrids count as electric here. A fleet that is going electric is asked
  // "how far along are we", and a machine that runs on a battery half the time
  // is part of the answer rather than neither.
  const evCount = React.useMemo(
    () => assets.filter((a) => a.propulsion === "EV" || a.propulsion === "HYBRID").length,
    [assets]);

  const [identities, setIdentities] = useState<Identity[]>([]);
  const [prefill, setPrefill] = useState<{ fleet_code?: string; telematics_code?: string }>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  // Forty-two rows of telematics names is a queue, not a reading list. It opens
  // showing enough to judge the size of the job.
  const [allUnmapped, setAllUnmapped] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, a, u] = await Promise.all([
        api.get("/minehub/summary"),
        api.get("/minehub/assets"),
        api.get("/minehub/unmapped-telematics"),
      ]);
      setSummary(s.data); setAssets(a.data ?? []); setUnmapped(u.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not reach the platform database.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Whether the registration sheet is on screen. Declared with the other hooks
  // rather than beside the branch that uses it: a hook placed after an early
  // return runs on some renders and not others, and React counts them.
  const formOpen = Boolean(addOpen || editingId);
  useEffect(() => { onFormOpenChange?.(formOpen); }, [formOpen, onFormOpenChange]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (propulsion === "EV" && a.propulsion !== "EV" && a.propulsion !== "HYBRID") return false;
      if (propulsion === "NON_EV" && a.propulsion === "EV") return false;
      if (!q) return true;
      return [a.fleet_code, a.nickname, a.registration_no, a.make, a.model, a.asset_type]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [assets, query, propulsion]);

  const openIdentities = async (id: number) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    try { setIdentities((await api.get(`/minehub/assets/${id}/identities`)).data ?? []); }
    catch { setIdentities([]); }
  };

  const startRegister = (u?: Unmapped) => {
    setPrefill(u ? { fleet_code: u.vehicle_desc, telematics_code: u.vehicle_desc } : {});
    onAddOpenChange?.(true);
  };

  const addAlias = async (assetId: number, system: string, code: string) => {
    try {
      await api.post(`/minehub/assets/${assetId}/identities`, { system, external_code: code.trim() });
      setNotice("Identity linked.");
      setIdentities((await api.get(`/minehub/assets/${assetId}/identities`)).data ?? []);
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not link that identity.");
    }
  };

  const removeAlias = async (id: number, assetId: number) => {
    try {
      await api.delete(`/minehub/assets/identities/${id}`);
      setIdentities((await api.get(`/minehub/assets/${assetId}/identities`)).data ?? []);
      await load();
    } catch { setError("Could not remove that identity."); }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  // Registration takes the whole panel rather than sitting above the tiles and
  // the unregistered list. Filling a long form beneath a dashboard made it
  // unclear what the screen was for, and left the save button a scroll away
  // from anything explaining it.
  if (formOpen) {
    return (
      <Card tone="gold">
        <div className="p-5">
          <AssetForm
            assetId={editingId ?? undefined}
            prefill={prefill}
            onSaved={() => { void load(); onChanged?.(); }}
            onDone={() => {
              onAddOpenChange?.(false); setEditingId(null); setPrefill({});
              setNotice("Machine registered."); void load(); onChanged?.();
            }}
            onCancel={() => { onAddOpenChange?.(false); setEditingId(null); setPrefill({}); void load(); }} />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && (
        <Alert tone="success"><span className="inline-flex items-center gap-2"><Check className="w-4 h-4" />{notice}</span></Alert>
      )}


      {/* Registry state */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Machines" value={summary.assets} tone="sky" icon={Cpu}
                hint={`${summary.assets_active} active`} />
          <Tile label="Electric" value={evCount}
                tone={evCount ? "emerald" : "slate"} icon={Zap}
                hint={assets.length
                  ? `${Math.round(100 * evCount / assets.length)}% of the register`
                  : "Nothing registered yet"}
                onClick={() => setPropulsion(propulsion === "EV" ? "" : "EV")}
                active={propulsion === "EV"} />
          <Tile label="Identities linked" value={summary.aliases} tone="violet" icon={Link2}
                hint="across all systems" />
          <Tile label="Unregistered" value={unmapped.length} tone={unmapped.length ? "amber" : "emerald"}
                icon={Radio} hint="transmitting telematics" />
          <Tile label="Contractors" value={summary.organisations} tone="teal" icon={Building2}
                hint="owning hired machines" />
        </div>
      )}

      {/* The register */}
      <Card tone="sky">
        <CardHeader title={`Fleet register · ${filtered.length}`} icon={Cpu} tone="sky"
          subtitle="Own and hired machines. Expand a row to link the names other systems use."
          actions={
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
                <input id="eq-search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by reference, code, make…"
                  className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5 text-[12px]
                             text-txt-primary placeholder:text-txt-light focus:outline-none focus:border-gold w-[180px]" />
              </div>
              {mayManage && (
                <Button size="sm" variant="primary" onClick={() => startRegister()}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              )}
            </>
          } />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <Th className="w-8" /><Th>Machine</Th><Th>Type</Th>
                <Th className="hidden md:table-cell">Make / model</Th>
                <Th>Owner</Th><Th>Linked</Th><Th className="text-right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <EmptyRow colSpan={7}>
                  {assets.length === 0
                    ? "No machine registered yet — start from the list above, those are transmitting already."
                    : "No machine matches that search."}
                </EmptyRow>
              )}
              {filtered.map((a) => (
                <React.Fragment key={a.asset_id}>
                  <tr className="hover:bg-bg-light transition-colors">
                    <Td className="pr-0">
                      <button onClick={() => openIdentities(a.asset_id)} aria-label="Show identities"
                        className="text-txt-light hover:text-navy">
                        {expanded === a.asset_id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </Td>
                    <Td>
                      <button onClick={() => setEditingId(a.asset_id)}
                        className="text-left group">
                        <div className="font-semibold text-navy text-[13px] group-hover:text-gold-dark
                                        group-hover:underline underline-offset-2 transition-colors">
                          {a.nickname || a.fleet_code}
                        </div>
                        <div className="text-[11px] text-txt-light font-mono flex flex-wrap items-center gap-1.5">
                          {a.asset_ref && (
                            <span className="text-violet font-bold">{a.asset_ref}</span>
                          )}
                          <span>{a.fleet_code}{a.registration_no ? ` · ${a.registration_no}` : ""}</span>
                        </div>
                      </button>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <Chip tone={CATEGORY_TONE[a.category] ?? "slate"} dot={false}>{a.asset_type}</Chip>
                        {/* Only the electric ones are marked. Badging every
                            diesel machine as "not electric" is noise on a fleet
                            that is mostly diesel. */}
                        {(a.propulsion === "EV" || a.propulsion === "HYBRID") && (
                          <Chip tone={a.propulsion === "EV" ? "emerald" : "sky"} dot={false}
                                title={a.propulsion === "EV" ? "Electric" : "Hybrid"}>
                            <Zap className="w-3 h-3" />
                            {a.propulsion === "EV" ? "EV" : "Hybrid"}
                          </Chip>
                        )}
                      </span>
                    </Td>
                    <Td className="hidden md:table-cell text-txt-muted">
                      {[a.make, a.model].filter(Boolean).join(" ") || "—"}
                    </Td>
                    <Td>
                      {a.ownership === "HIRED"
                        ? <Chip tone="amber" dot={false}>{a.owner ?? "Hired"}</Chip>
                        : <span className="text-txt-muted">BAL</span>}
                    </Td>
                    <Td>
                      {a.alias_count === 0
                        ? <Chip tone="amber">none</Chip>
                        : <span className="text-[11px] font-mono text-txt-muted">{a.alias_systems}</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {a.approval_status && a.approval_status !== "APPROVED" && (
                        <Chip tone={APPROVAL_TONE[a.approval_status] ?? "slate"} className="mr-1.5">
                          {a.approval_status.replace("_", " ").toLowerCase()}
                        </Chip>
                      )}
                      <Chip tone={STATUS_TONE[a.status] ?? "slate"}>{a.status.toLowerCase()}</Chip>
                    </Td>
                  </tr>

                  {expanded === a.asset_id && (
                    <tr className="bg-bg-light">
                      <Td /><Td colSpan={6} className="pb-4">
                        <div className="text-[10.5px] font-bold uppercase tracking-[.12em] text-txt-light mb-2 font-condensed">
                          What other systems call this machine
                        </div>
                        {identities.length === 0 ? (
                          <p className="text-txt-muted text-[12px] mb-3">
                            Nothing linked yet — this machine&apos;s telematics, handover and
                            weighbridge records cannot be joined to it.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {identities.map((i) => (
                              <span key={i.asset_identity_id}
                                className="inline-flex items-center gap-2 rounded-lg bg-bg-base ring-1 ring-border px-2.5 py-1 text-[11.5px]">
                                <span className="text-txt-light font-semibold">{i.system}</span>
                                <span className="font-mono text-navy">{i.external_code}</span>
                                {mayManage && (
                                  <button onClick={() => removeAlias(i.asset_identity_id, a.asset_id)}
                                    className="text-txt-light hover:text-rose" aria-label="Remove">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        {mayManage && <AliasAdder onAdd={(s, c) => addAlias(a.asset_id, s, c)} />}

                        {/* Notes live where the machine is, not on a screen
                            somebody has to remember to open. */}
                        <div className="mt-4">
                          <CommentThread entityType="ASSET" entityId={a.asset_id}
                            title={`Notes on ${a.fleet_code || a.asset_ref || "this machine"}`} />
                        </div>
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {/* The queue: telematics with nothing to attribute it to */}
      {unmapped.length > 0 && (
        <Card tone="amber">
          <CardHeader title={`${unmapped.length} machines transmitting but unregistered`}
            icon={Radio} tone="amber"
            subtitle="These send telematics the platform cannot attribute to anything. Registering one links its history in the same action."
            actions={unmapped.length > 8 && (
              <Button size="sm" variant="secondary" onClick={() => setAllUnmapped((v) => !v)}>
                {allUnmapped ? "Show fewer" : `Show all ${unmapped.length}`}
              </Button>
            )} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr><Th>Telematics name</Th><Th>Feed</Th><Th className="text-right">Records</Th>
                    <Th>Last seen</Th><Th className="text-right">Action</Th></tr>
              </thead>
              <tbody>
                {(allUnmapped ? unmapped : unmapped.slice(0, 8)).map((u) => (
                  <tr key={`${u.feed}-${u.vehicle_desc}`} className="hover:bg-bg-light transition-colors">
                    <Td className="font-mono text-[12px] text-navy font-semibold">{u.vehicle_desc}</Td>
                    <Td><Chip tone={u.feed === "MAN" ? "sky" : "violet"} dot={false}>{u.feed}</Chip></Td>
                    <Td className="text-right tabular-nums">{u.rows_.toLocaleString()}</Td>
                    <Td className="text-txt-muted">{String(u.last_seen ?? "").slice(0, 16).replace("T", " ")}</Td>
                    <Td className="text-right">
                      {mayManage && (
                        <Button size="sm" variant="primary" onClick={() => startRegister(u)}>
                          <Plus className="w-3.5 h-3.5" /> Register
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!allUnmapped && unmapped.length > 8 && (
            <button type="button" onClick={() => setAllUnmapped(true)}
              className="w-full px-5 py-3 text-[12.5px] font-semibold text-gold-dark
                         border-t border-border-light hover:bg-gold/[0.05] transition-colors">
              {unmapped.length - 8} more waiting to be registered
            </button>
          )}
        </Card>
      )}


    </div>
  );
}

function AliasAdder({ onAdd }: { onAdd: (system: string, code: string) => void }) {
  const [system, setSystem] = useState("TELEMATICS");
  const [code, setCode] = useState("");
  const submit = () => { if (code.trim()) { onAdd(system, code); setCode(""); } };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={system} onChange={(e) => setSystem(e.target.value)}
        className="bg-bg-base border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-txt-primary focus:outline-none focus:border-gold">
        {["TELEMATICS", "HOTO", "WEIGHBRIDGE", "RFID", "SAP", "SECURITY", "LEGACY"].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <input value={code} onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="The name that system uses, e.g. MAN18"
        className={`${inputClass} font-mono w-[280px] max-w-full py-1.5`} />
      <Button size="sm" variant="secondary" onClick={submit} disabled={!code.trim()}>
        <Link2 className="w-3.5 h-3.5" /> Link
      </Button>
    </div>
  );
}
