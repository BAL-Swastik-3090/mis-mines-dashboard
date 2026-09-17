"use client";
/**
 * Equipment Registry — a tab of the MineHub Platform screen.
 *
 * Phase 0 of the platform: give every machine one identity. The mine has no
 * authoritative fleet list today — four partial lists exist, none complete —
 * and telematics calls a truck MAN18 where the handover register calls it
 * MAN-18, so no query joins them.
 *
 * The screen is built around the work rather than around the tables: the first
 * thing it shows is the list of machines that are transmitting data nobody can
 * attribute to anything, because clearing that list IS the task. Registering a
 * machine straight from that row takes one click and pre-fills the alias, so
 * the common path never involves typing a code twice.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes, Search, Plus, Link2, Trash2, Check, AlertCircle, Loader2,
  Radio, X, ChevronDown, ChevronRight,
} from "lucide-react";
import api from "@/lib/api";

interface Summary {
  assets: number; assets_active: number; aliases: number; asset_types: number;
  people: number; organisations: number; locations: number; materials: number;
  competencies: number; events: number;
}
interface AssetType {
  asset_type_id: number; code: string; name: string; category: string;
  rated_output_per_hr: number | null; rated_fuel_lph: number | null;
  standard_crew: number | null; asset_count: number;
}
interface Asset {
  asset_id: number; fleet_code: string; registration_no: string | null;
  make: string | null; model: string | null; capacity: number | null;
  capacity_uom: string | null; ownership: string; status: string;
  asset_type_id: number; asset_type: string; category: string;
  owner: string | null; alias_count: number; alias_systems: string | null;
}
interface Identity {
  asset_identity_id: number; system: string; external_code: string;
}
interface Unmapped {
  vehicle_desc: string; feed: string; rows_: number; last_seen: string;
}
interface Party { party_id: number; display_name: string; legal_name: string }

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  MAINTENANCE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  STANDBY:     "bg-sky-500/15 text-sky-300 border-sky-500/30",
  IDLE:        "bg-white/10 text-white/55 border-white/15",
  DISPOSED:    "bg-red-500/15 text-red-300 border-red-500/30",
};

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0e1c33]/60 px-4 py-3">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/40 font-condensed">
        {label}
      </div>
      <div className="text-[22px] font-semibold text-white leading-tight mt-1 tabular-nums">
        {value}
      </div>
      {hint && <div className="text-[11px] text-white/35 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function EquipmentPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [types, setTypes] = useState<AssetType[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [unmapped, setUnmapped] = useState<Unmapped[]>([]);
  const [parties, setParties] = useState<Party[]>([]);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, t, a, u, p] = await Promise.all([
        api.get("/minehub/summary"),
        api.get("/minehub/asset-types"),
        api.get("/minehub/assets"),
        api.get("/minehub/unmapped-telematics"),
        api.get("/minehub/parties", { params: { party_type: "ORGANISATION" } }),
      ]);
      setSummary(s.data); setTypes(t.data ?? []); setAssets(a.data ?? []);
      setUnmapped(u.data ?? []); setParties(p.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not reach the MineHub platform database.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) =>
      [a.fleet_code, a.registration_no, a.make, a.model, a.asset_type]
        .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [assets, query]);

  const openIdentities = async (assetId: number) => {
    if (expanded === assetId) { setExpanded(null); return; }
    setExpanded(assetId);
    try {
      const r = await api.get(`/minehub/assets/${assetId}/identities`);
      setIdentities(r.data ?? []);
    } catch { setIdentities([]); }
  };

  const startRegister = (u?: Unmapped) => {
    setForm(u
      ? { fleet_code: u.vehicle_desc, telematics_code: u.vehicle_desc, ownership: "OWN" }
      : { ownership: "OWN" });
    setShowForm(true);
    setError(null);
  };

  const saveAsset = async () => {
    if (!form.fleet_code?.trim()) { setError("Fleet code is required."); return; }
    if (!form.asset_type_id) { setError("Choose an equipment type."); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.post("/minehub/assets", {
        fleet_code: form.fleet_code.trim(),
        registration_no: form.registration_no,
        asset_type_id: Number(form.asset_type_id),
        make: form.make, model: form.model,
        capacity: form.capacity ? Number(form.capacity) : null,
        capacity_uom: form.capacity_uom,
        ownership: form.ownership || "OWN",
        owner_party_id: form.owner_party_id ? Number(form.owner_party_id) : null,
      });
      // Registering from an unmapped row carries the telematics name across, so
      // the machine is joined to its data in the same action.
      if (form.telematics_code) {
        await api.post(`/minehub/assets/${res.data.asset_id}/identities`, {
          system: "TELEMATICS", external_code: form.telematics_code,
        });
      }
      setNotice(`${form.fleet_code} registered.`);
      setShowForm(false); setForm({});
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not register the machine.");
    } finally { setSaving(false); }
  };

  const addAlias = async (assetId: number, system: string, code: string) => {
    if (!code.trim()) return;
    try {
      await api.post(`/minehub/assets/${assetId}/identities`, {
        system, external_code: code.trim(),
      });
      setNotice("Identity linked.");
      await openIdentities(assetId); await openIdentities(assetId);
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not link that identity.");
    }
  };

  const removeAlias = async (id: number, assetId: number) => {
    try {
      await api.delete(`/minehub/assets/identities/${id}`);
      const r = await api.get(`/minehub/assets/${assetId}/identities`);
      setIdentities(r.data ?? []);
      await load();
    } catch { setError("Could not remove that identity."); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-[#c8960c]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[12.5px] text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" /><span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[12.5px] text-emerald-300">
          <Check className="w-4 h-4 shrink-0 mt-px" /><span>{notice}</span>
        </div>
      )}

      {/* Registry state */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Tile label="Machines" value={summary.assets} hint={`${summary.assets_active} active`} />
          <Tile label="Identities linked" value={summary.aliases} hint="across all systems" />
          <Tile label="Equipment types" value={summary.asset_types} />
          <Tile label="People" value={summary.people} hint={`${summary.organisations} organisations`} />
          <Tile label="Events" value={summary.events} hint="platform log" />
        </div>
      )}

      {/* ── The working list ─────────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-[#0e1c33]/60">
        <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2.5">
          <Radio className="w-4 h-4 text-amber-300 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-white/90 text-[13px] font-semibold tracking-wide">
              Transmitting but unregistered
              {unmapped.length > 0 && (
                <span className="ml-2 text-amber-300">{unmapped.length}</span>
              )}
            </h2>
            <p className="text-white/45 text-[11.5px] mt-0.5">
              These machines are sending telematics that the platform cannot attribute
              to anything. Registering one links its history in the same action.
            </p>
          </div>
        </header>

        <div className="p-4">
          {unmapped.length === 0 ? (
            <div className="text-center py-6 text-emerald-300/80 text-[13px]">
              <Check className="w-5 h-5 mx-auto mb-1.5" />
              Every transmitting machine is registered.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12.5px]">
                <thead className="text-white/45">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Telematics name</th>
                    <th className="text-left font-medium px-3 py-2">Feed</th>
                    <th className="text-right font-medium px-3 py-2">Records</th>
                    <th className="text-left font-medium px-3 py-2">Last seen</th>
                    <th className="text-right font-medium px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {unmapped.map((u) => (
                    <tr key={`${u.feed}-${u.vehicle_desc}`} className="text-white/80">
                      <td className="px-3 py-2.5 font-mono text-[12px]">{u.vehicle_desc}</td>
                      <td className="px-3 py-2.5 text-white/50">{u.feed}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white/60">
                        {u.rows_.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-white/50">
                        {u.last_seen ? String(u.last_seen).slice(0, 16).replace("T", " ") : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => startRegister(u)}
                          className="px-2.5 py-1 rounded border border-[#c8960c]/40 bg-[#c8960c]/15 text-[#c8960c] text-[11px] font-medium hover:brightness-125"
                        >
                          Register
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Register form ────────────────────────────────────── */}
      {showForm && (
        <section className="rounded-lg border border-[#c8960c]/30 bg-[#0e1c33]/80">
          <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-white/90 text-[13px] font-semibold tracking-wide">Register a machine</h2>
            <button onClick={() => { setShowForm(false); setForm({}); }}
                    className="text-white/40 hover:text-white/80" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </header>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { k: "fleet_code", label: "Fleet code *", ph: "MAN-18" },
              { k: "registration_no", label: "Registration no.", ph: "OD04L0327" },
              { k: "make", label: "Make", ph: "Tata / CAT / Volvo" },
              { k: "model", label: "Model", ph: "" },
              { k: "capacity", label: "Capacity", ph: "e.g. 25" },
              { k: "capacity_uom", label: "Capacity unit", ph: "MT / m³" },
            ].map((f) => (
              <label key={f.k} className="block">
                <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45 mb-1 font-condensed">
                  {f.label}
                </span>
                <input
                  id={`mh-${f.k}`}
                  value={form[f.k] ?? ""}
                  placeholder={f.ph}
                  onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
                  className="w-full bg-[#0a1526] border border-white/12 rounded-md px-3 py-2 text-[13px] text-white/90 placeholder:text-white/25 focus:outline-none focus:border-[#c8960c]/50"
                />
              </label>
            ))}

            <label className="block">
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45 mb-1 font-condensed">
                Equipment type *
              </span>
              <select
                id="mh-asset_type_id"
                value={form.asset_type_id ?? ""}
                onChange={(e) => setForm({ ...form, asset_type_id: e.target.value })}
                className="w-full bg-[#0a1526] border border-white/12 rounded-md px-3 py-2 text-[13px] text-white/90 focus:outline-none focus:border-[#c8960c]/50"
              >
                <option value="">Select…</option>
                {types.map((t) => (
                  <option key={t.asset_type_id} value={t.asset_type_id}>{t.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45 mb-1 font-condensed">
                Ownership
              </span>
              <select
                id="mh-ownership"
                value={form.ownership ?? "OWN"}
                onChange={(e) => setForm({ ...form, ownership: e.target.value })}
                className="w-full bg-[#0a1526] border border-white/12 rounded-md px-3 py-2 text-[13px] text-white/90 focus:outline-none focus:border-[#c8960c]/50"
              >
                <option value="OWN">Own (BAL)</option>
                <option value="HIRED">Hired (contractor)</option>
              </select>
            </label>

            {form.ownership === "HIRED" && (
              <label className="block">
                <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45 mb-1 font-condensed">
                  Contractor *
                </span>
                <select
                  id="mh-owner_party_id"
                  value={form.owner_party_id ?? ""}
                  onChange={(e) => setForm({ ...form, owner_party_id: e.target.value })}
                  className="w-full bg-[#0a1526] border border-white/12 rounded-md px-3 py-2 text-[13px] text-white/90 focus:outline-none focus:border-[#c8960c]/50"
                >
                  <option value="">Select…</option>
                  {parties.map((p) => (
                    <option key={p.party_id} value={p.party_id}>
                      {p.display_name || p.legal_name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {form.telematics_code && (
              <div className="sm:col-span-2 lg:col-span-3 text-[12px] text-white/55 bg-white/[0.04] rounded-md px-3 py-2 flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5 text-[#c8960c] shrink-0" />
                Telematics name <span className="font-mono text-white/80">{form.telematics_code}</span>
                {" "}will be linked to this machine automatically.
              </div>
            )}

            <div className="sm:col-span-2 lg:col-span-3 flex gap-2 pt-1">
              <button
                onClick={saveAsset}
                disabled={saving}
                className="px-4 py-2 rounded-md text-[12.5px] font-semibold bg-[#c8960c] text-[#0b1b33] hover:brightness-110 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Register machine"}
              </button>
              <button
                onClick={() => { setShowForm(false); setForm({}); }}
                className="px-4 py-2 rounded-md text-[12.5px] font-medium text-white/60 hover:text-white/90 border border-white/12"
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── The registry ─────────────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-[#0e1c33]/60">
        <header className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-white/90 text-[13px] font-semibold tracking-wide">Fleet register</h2>
            <p className="text-white/45 text-[11.5px] mt-0.5">
              Own and hired machines. Expand a row to link the names other systems use.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
              <input
                id="mh-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search fleet…"
                className="bg-[#0a1526] border border-white/12 rounded-md pl-8 pr-3 py-1.5 text-[12.5px] text-white/90 placeholder:text-white/30 focus:outline-none focus:border-[#c8960c]/50 w-[170px]"
              />
            </div>
            <button
              onClick={() => startRegister()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#c8960c] text-[#0b1b33] hover:brightness-110"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </header>

        <div className="p-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="text-white/45">
              <tr>
                <th className="w-6" />
                <th className="text-left font-medium px-3 py-2">Fleet code</th>
                <th className="text-left font-medium px-3 py-2">Type</th>
                <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Make / model</th>
                <th className="text-left font-medium px-3 py-2">Ownership</th>
                <th className="text-left font-medium px-3 py-2">Linked</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-white/35">
                    {assets.length === 0
                      ? "No machine registered yet. Start from the list above — those are transmitting already."
                      : "No machine matches that search."}
                  </td>
                </tr>
              )}
              {filtered.map((a) => (
                <React.Fragment key={a.asset_id}>
                  <tr className="text-white/80 hover:bg-white/[0.03]">
                    <td className="px-1 py-2.5">
                      <button onClick={() => openIdentities(a.asset_id)}
                              className="text-white/40 hover:text-white/80"
                              aria-label="Show identities">
                        {expanded === a.asset_id
                          ? <ChevronDown className="w-4 h-4" />
                          : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-white/90">
                      {a.fleet_code}
                      {a.registration_no && (
                        <span className="text-white/35 font-mono text-[11px] ml-2">{a.registration_no}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-white/60">{a.asset_type}</td>
                    <td className="px-3 py-2.5 text-white/50 hidden md:table-cell">
                      {[a.make, a.model].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-white/60">
                      {a.ownership === "HIRED" ? (a.owner ?? "Hired") : "BAL"}
                    </td>
                    <td className="px-3 py-2.5">
                      {a.alias_count === 0 ? (
                        <span className="text-amber-300/80 text-[11.5px]">none</span>
                      ) : (
                        <span className="text-white/55 text-[11px] font-mono">{a.alias_systems}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded border text-[11px] font-medium ${STATUS_STYLE[a.status] ?? STATUS_STYLE.IDLE}`}>
                        {a.status.toLowerCase()}
                      </span>
                    </td>
                  </tr>

                  {expanded === a.asset_id && (
                    <tr className="bg-[#0a1526]/60">
                      <td />
                      <td colSpan={6} className="px-3 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2 font-condensed">
                          What other systems call this machine
                        </div>
                        {identities.length === 0 ? (
                          <p className="text-white/40 text-[12px] mb-2">
                            Nothing linked yet — this machine&apos;s telematics, handover and
                            weighbridge records cannot be joined to it.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {identities.map((i) => (
                              <span key={i.asset_identity_id}
                                    className="inline-flex items-center gap-2 rounded border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11.5px]">
                                <span className="text-white/45">{i.system}</span>
                                <span className="font-mono text-white/85">{i.external_code}</span>
                                <button onClick={() => removeAlias(i.asset_identity_id, a.asset_id)}
                                        className="text-white/30 hover:text-red-400" aria-label="Remove">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        <AliasAdder onAdd={(sys, code) => addAlias(a.asset_id, sys, code)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Ideal operating model ────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-[#0e1c33]/60">
        <header className="px-4 py-3 border-b border-white/10">
          <h2 className="text-white/90 text-[13px] font-semibold tracking-wide">Rated capacity by type</h2>
          <p className="text-white/45 text-[11.5px] mt-0.5">
            These set every capacity-gap figure the platform reports. Left blank until
            someone signs them off — a guess here quietly becomes fact everywhere.
          </p>
        </header>
        <div className="p-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead className="text-white/45">
              <tr>
                <th className="text-left font-medium px-3 py-2">Type</th>
                <th className="text-left font-medium px-3 py-2">Category</th>
                <th className="text-right font-medium px-3 py-2">Machines</th>
                <th className="text-right font-medium px-3 py-2">Output / hr</th>
                <th className="text-right font-medium px-3 py-2">Fuel L/hr</th>
                <th className="text-right font-medium px-3 py-2">Crew</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {types.map((t) => (
                <tr key={t.asset_type_id} className="text-white/80">
                  <td className="px-3 py-2.5">{t.name}</td>
                  <td className="px-3 py-2.5 text-white/45 text-[11.5px]">{t.category}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-white/60">{t.asset_count}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {t.rated_output_per_hr ?? <span className="text-amber-300/70">not set</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {t.rated_fuel_lph ?? <span className="text-amber-300/70">not set</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {t.standard_crew ?? <span className="text-amber-300/70">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Small inline form for linking one more external name to a machine. */
function AliasAdder({ onAdd }: { onAdd: (system: string, code: string) => void }) {
  const [system, setSystem] = useState("TELEMATICS");
  const [code, setCode] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={system}
        onChange={(e) => setSystem(e.target.value)}
        className="bg-[#0a1526] border border-white/12 rounded-md px-2.5 py-1.5 text-[12px] text-white/85 focus:outline-none focus:border-[#c8960c]/50"
      >
        {["TELEMATICS", "HOTO", "WEIGHBRIDGE", "RFID", "SAP", "SECURITY", "LEGACY"].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) { onAdd(system, code); setCode(""); } }}
        placeholder="The name that system uses, e.g. MAN18"
        className="bg-[#0a1526] border border-white/12 rounded-md px-3 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 focus:outline-none focus:border-[#c8960c]/50 w-[260px] max-w-full font-mono"
      />
      <button
        onClick={() => { if (code.trim()) { onAdd(system, code); setCode(""); } }}
        disabled={!code.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border border-white/12 text-white/70 hover:text-white hover:border-white/25 disabled:opacity-30"
      >
        <Link2 className="w-3.5 h-3.5" /> Link
      </button>
    </div>
  );
}
