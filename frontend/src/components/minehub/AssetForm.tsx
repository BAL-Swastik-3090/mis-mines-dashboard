"use client";
/**
 * Equipment registration.
 *
 * Registering a machine happens once and everything downstream reads it — HOTO
 * needs the hour meter and the name people use, compliance needs the expiry
 * dates, maintenance needs the service interval, OEE needs the ratings. Chasing
 * those later, once the machine is in the pit and the papers are in a drawer,
 * costs far more than asking now.
 *
 * So the form is long, and organised so it does not feel long: sections that
 * collapse, only Identity open to begin with, and everything except three
 * fields optional. A registration is never blocked because a document is not
 * to hand — it is saved, and the gap shows up in Alerts.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, Plus, Trash2, X, Check, AlertCircle, Loader2,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Field, inputClass } from "./ui";

interface AssetType { asset_type_id: number; name: string; category: string }
interface Party { party_id: number; display_name: string; legal_name: string }
interface Location { location_id: number; name: string; location_type: string }

interface DocRow {
  document_type: string; document_no: string; provider: string;
  valid_from: string; valid_upto: string; amount: string; reminder_days: string;
}
interface SchedRow {
  schedule_type: string; name: string; interval_value: string; interval_uom: string;
  last_done_on: string; last_done_reading: string;
}
interface IdentRow { system: string; external_code: string }

const DOC_TYPES = [
  ["INSURANCE", "Insurance"], ["FITNESS", "Fitness certificate"], ["PUC", "PUC"],
  ["ROAD_TAX", "Road tax"], ["PERMIT", "Permit"], ["NATIONAL_PERMIT", "National permit"],
  ["STATUTORY_INSPECTION", "Statutory inspection"], ["EXPLOSIVE_LICENCE", "Explosive licence"],
  ["POLLUTION_NOC", "Pollution NOC"], ["OTHER", "Other"],
];
const SCHED_TYPES = [
  ["SERVICE", "Service"], ["PREVENTIVE", "Preventive maintenance"], ["OIL_CHANGE", "Oil change"],
  ["INSPECTION", "Inspection"], ["OVERHAUL", "Overhaul"], ["TYRE_ROTATION", "Tyre rotation"],
  ["OTHER", "Other"],
];
const IDENT_SYSTEMS = ["TELEMATICS", "HOTO", "WEIGHBRIDGE", "RFID", "SAP", "SECURITY", "LEGACY"];

const emptyDoc = (t = "INSURANCE"): DocRow => ({
  document_type: t, document_no: "", provider: "", valid_from: "", valid_upto: "",
  amount: "", reminder_days: "30",
});
const emptySched = (): SchedRow => ({
  schedule_type: "SERVICE", name: "", interval_value: "", interval_uom: "HOURS",
  last_done_on: "", last_done_reading: "",
});

function Section({ title, hint, open, onToggle, children, badge }: {
  title: string; hint?: string; open: boolean; onToggle: () => void;
  children: React.ReactNode; badge?: string;
}) {
  return (
    <div className="border border-border-light rounded-lg bg-bg-base overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-light transition-colors">
        {open ? <ChevronDown className="w-4 h-4 text-gold shrink-0" />
              : <ChevronRight className="w-4 h-4 text-txt-light shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="font-condensed font-bold text-[13.5px] uppercase tracking-wide text-navy">
            {title}
          </span>
          {hint && <span className="block text-[11.5px] text-txt-muted mt-0.5">{hint}</span>}
        </span>
        {badge && (
          <span className="shrink-0 px-2 py-0.5 rounded border border-gold/30 bg-gold/10 text-gold-dark text-[11px] font-semibold">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-border-light">{children}</div>}
    </div>
  );
}

export default function AssetForm({ prefill, onDone, onCancel }: {
  prefill?: { fleet_code?: string; telematics_code?: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const [types, setTypes] = useState<AssetType[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [f, setF] = useState<Record<string, string>>({
    fleet_code: prefill?.fleet_code ?? "",
    ownership: "OWN", status: "ACTIVE", reading_uom: "HOURS", fuel_type: "DIESEL",
  });
  const [docs, setDocs] = useState<DocRow[]>([
    emptyDoc("INSURANCE"), emptyDoc("FITNESS"), emptyDoc("ROAD_TAX"),
  ]);
  const [scheds, setScheds] = useState<SchedRow[]>([emptySched()]);
  const [idents, setIdents] = useState<IdentRow[]>(
    prefill?.telematics_code
      ? [{ system: "TELEMATICS", external_code: prefill.telematics_code }]
      : [],
  );

  const [open, setOpen] = useState<Record<string, boolean>>({ identity: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [t, p, l] = await Promise.all([
          api.get("/minehub/asset-types"),
          api.get("/minehub/parties", { params: { party_type: "ORGANISATION" } }),
          api.get("/minehub/locations"),
        ]);
        setTypes(t.data ?? []); setParties(p.data ?? []); setLocations(l.data ?? []);
      } catch { /* the form still works; the pickers are simply empty */ }
    })();
  }, []);

  const set = (k: string, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const isElectric = f.fuel_type === "ELECTRIC" || f.fuel_type === "HYBRID";
  const isHired = f.ownership === "HIRED";

  const filledDocs = useMemo(
    () => docs.filter((d) => d.document_no || d.valid_upto || d.provider || d.amount).length,
    [docs],
  );
  const filledScheds = useMemo(
    () => scheds.filter((s) => s.name || s.interval_value).length, [scheds]);
  const filledIdents = useMemo(
    () => idents.filter((i) => i.external_code.trim()).length, [idents]);

  const submit = async () => {
    if (!f.fleet_code?.trim()) { setError("Fleet code is required."); setOpen((o) => ({ ...o, identity: true })); return; }
    if (!f.asset_type_id) { setError("Choose an equipment type."); setOpen((o) => ({ ...o, identity: true })); return; }
    if (isHired && !f.owner_party_id) { setError("A hired machine must record its contractor."); setOpen((o) => ({ ...o, ownership: true })); return; }

    setSaving(true); setError(null);
    try {
      await api.post("/minehub/assets", {
        ...f,
        documents: docs, schedules: scheds,
        identities: idents.filter((i) => i.external_code.trim()),
      });
      onDone();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not register the machine.");
    } finally { setSaving(false); }
  };

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-condensed font-bold text-[16px] uppercase tracking-wide text-navy">
            Register a machine
          </h2>
          <p className="text-[12px] text-txt-muted mt-0.5">
            Only fleet code and type are required — everything else can be filled in later,
            and what is missing shows up under Alerts.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="w-4 h-4" /></Button>
      </div>

      {error && (
        <Alert tone="error">
          <span className="inline-flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</span>
        </Alert>
      )}

      {/* ── Identity ─────────────────────────────────────────── */}
      <Section title="Identity" open={!!open.identity} onToggle={() => toggle("identity")}
        hint="What it is, and what people call it">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
          <Field label="Fleet code *" hint="The system key — MAN-18">
            <input id="af-fleet" className={inputClass} value={f.fleet_code ?? ""}
              onChange={(e) => set("fleet_code", e.target.value)} placeholder="MAN-18" />
          </Field>
          <Field label="Nickname" hint="What the mine calls it out loud">
            <input id="af-nick" className={inputClass} value={f.nickname ?? ""}
              onChange={(e) => set("nickname", e.target.value)} placeholder="Bada Tipper" />
          </Field>
          <Field label="Equipment type *">
            <select id="af-type" className={inputClass} value={f.asset_type_id ?? ""}
              onChange={(e) => set("asset_type_id", e.target.value)}>
              <option value="">Select…</option>
              {types.map((t) => <option key={t.asset_type_id} value={t.asset_type_id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Registration no."><input id="af-reg" className={inputClass}
            value={f.registration_no ?? ""} onChange={(e) => set("registration_no", e.target.value)}
            placeholder="OD04L0327" /></Field>
          <Field label="Make"><input id="af-make" className={inputClass} value={f.make ?? ""}
            onChange={(e) => set("make", e.target.value)} placeholder="Tata / CAT / Volvo" /></Field>
          <Field label="Model"><input id="af-model" className={inputClass} value={f.model ?? ""}
            onChange={(e) => set("model", e.target.value)} /></Field>
          <Field label="Year of make"><input id="af-year" className={inputClass} type="number"
            value={f.year_of_make ?? ""} onChange={(e) => set("year_of_make", e.target.value)} /></Field>
          <Field label="Chassis no."><input id="af-chassis" className={inputClass}
            value={f.chassis_no ?? ""} onChange={(e) => set("chassis_no", e.target.value)} /></Field>
          <Field label="Engine no."><input id="af-engine" className={inputClass}
            value={f.engine_no ?? ""} onChange={(e) => set("engine_no", e.target.value)} /></Field>
        </div>
      </Section>

      {/* ── Ownership ────────────────────────────────────────── */}
      <Section title="Ownership & cost" open={!!open.ownership} onToggle={() => toggle("ownership")}
        hint="Own or hired — this is what makes contractor performance measurable"
        badge={isHired ? "Hired" : "Own"}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
          <Field label="Ownership">
            <select id="af-own" className={inputClass} value={f.ownership ?? "OWN"}
              onChange={(e) => set("ownership", e.target.value)}>
              <option value="OWN">Own (BAL)</option>
              <option value="HIRED">Hired (contractor)</option>
            </select>
          </Field>
          {isHired && (
            <>
              <Field label="Contractor *">
                <select id="af-owner" className={inputClass} value={f.owner_party_id ?? ""}
                  onChange={(e) => set("owner_party_id", e.target.value)}>
                  <option value="">Select…</option>
                  {parties.map((p) => (
                    <option key={p.party_id} value={p.party_id}>{p.display_name || p.legal_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Hire rate"><input id="af-hire" className={inputClass} type="number"
                value={f.hire_rate ?? ""} onChange={(e) => set("hire_rate", e.target.value)} /></Field>
              <Field label="Rate per"><input id="af-hireuom" className={inputClass}
                value={f.hire_rate_uom ?? ""} onChange={(e) => set("hire_rate_uom", e.target.value)}
                placeholder="hour / day / month / tonne" /></Field>
            </>
          )}
          {!isHired && (
            <>
              <Field label="SAP asset no."><input id="af-sap" className={inputClass}
                value={f.sap_asset_no ?? ""} onChange={(e) => set("sap_asset_no", e.target.value)} /></Field>
              <Field label="Purchase date"><input id="af-pdate" className={inputClass} type="date"
                value={f.purchase_date ?? ""} onChange={(e) => set("purchase_date", e.target.value)} /></Field>
              <Field label="Purchase cost (₹)"><input id="af-pcost" className={inputClass} type="number"
                value={f.purchase_cost ?? ""} onChange={(e) => set("purchase_cost", e.target.value)} /></Field>
              <Field label="Supplier">
                <select id="af-supplier" className={inputClass} value={f.supplier_party_id ?? ""}
                  onChange={(e) => set("supplier_party_id", e.target.value)}>
                  <option value="">Select…</option>
                  {parties.map((p) => (
                    <option key={p.party_id} value={p.party_id}>{p.display_name || p.legal_name}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field label="Commissioned on"><input id="af-comm" className={inputClass} type="date"
            value={f.commissioned_on ?? ""} onChange={(e) => set("commissioned_on", e.target.value)} /></Field>
        </div>
      </Section>

      {/* ── Capability ───────────────────────────────────────── */}
      <Section title="Capability & fuel" open={!!open.capability} onToggle={() => toggle("capability")}
        hint="Rated figures drive every utilisation and capacity-gap number"
        badge={isElectric ? "Electric" : undefined}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
          <Field label="Capacity"><input id="af-cap" className={inputClass} type="number"
            value={f.capacity ?? ""} onChange={(e) => set("capacity", e.target.value)} /></Field>
          <Field label="Capacity unit"><input id="af-capuom" className={inputClass}
            value={f.capacity_uom ?? ""} onChange={(e) => set("capacity_uom", e.target.value)}
            placeholder="MT / m³ / litre" /></Field>
          <Field label="Rated output / hour" hint="Sets the capacity-gap figures">
            <input id="af-rout" className={inputClass} type="number" value={f.rated_output_per_hr ?? ""}
              onChange={(e) => set("rated_output_per_hr", e.target.value)} /></Field>
          <Field label="Fuel type">
            <select id="af-fuel" className={inputClass} value={f.fuel_type ?? "DIESEL"}
              onChange={(e) => set("fuel_type", e.target.value)}>
              {["DIESEL", "PETROL", "ELECTRIC", "HYBRID", "CNG", "NONE"].map((x) => (
                <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </Field>
          {!isElectric && (
            <>
              <Field label="Rated fuel (L/hr)"><input id="af-lph" className={inputClass} type="number"
                value={f.rated_fuel_lph ?? ""} onChange={(e) => set("rated_fuel_lph", e.target.value)} /></Field>
              <Field label="Tank capacity (L)"><input id="af-tank" className={inputClass} type="number"
                value={f.tank_capacity_l ?? ""} onChange={(e) => set("tank_capacity_l", e.target.value)} /></Field>
            </>
          )}
          {isElectric && (
            <>
              <Field label="Battery (kWh)"><input id="af-kwh" className={inputClass} type="number"
                value={f.battery_kwh ?? ""} onChange={(e) => set("battery_kwh", e.target.value)} /></Field>
              <Field label="Range (km)"><input id="af-range" className={inputClass} type="number"
                value={f.range_km ?? ""} onChange={(e) => set("range_km", e.target.value)} /></Field>
              <Field label="Charging type"><input id="af-charge" className={inputClass}
                value={f.charging_type ?? ""} onChange={(e) => set("charging_type", e.target.value)}
                placeholder="AC / DC fast / swap" /></Field>
              <Field label="Charge time (hrs)"><input id="af-chargetime" className={inputClass} type="number"
                value={f.charge_time_hrs ?? ""} onChange={(e) => set("charge_time_hrs", e.target.value)} /></Field>
            </>
          )}
          <Field label="Tyres"><input id="af-tyres" className={inputClass} type="number"
            value={f.tyre_count ?? ""} onChange={(e) => set("tyre_count", e.target.value)} /></Field>
          <Field label="Seats"><input id="af-seats" className={inputClass} type="number"
            value={f.seating_capacity ?? ""} onChange={(e) => set("seating_capacity", e.target.value)} /></Field>
        </div>
      </Section>

      {/* ── Deployment & reading ─────────────────────────────── */}
      <Section title="Deployment & meter" open={!!open.deploy} onToggle={() => toggle("deploy")}
        hint="Where it works, and the reading every handover and service counts from">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
          <Field label="Home location / plant">
            <select id="af-loc" className={inputClass} value={f.home_location_id ?? ""}
              onChange={(e) => set("home_location_id", e.target.value)}>
              <option value="">Select…</option>
              {locations.map((l) => (
                <option key={l.location_id} value={l.location_id}>{l.name} · {l.location_type}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select id="af-status" className={inputClass} value={f.status ?? "ACTIVE"}
              onChange={(e) => set("status", e.target.value)}>
              {["ACTIVE", "MAINTENANCE", "STANDBY", "IDLE", "DISPOSED"].map((x) => (
                <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </Field>
          <Field label="Meter reads in">
            <select id="af-ruom" className={inputClass} value={f.reading_uom ?? "HOURS"}
              onChange={(e) => set("reading_uom", e.target.value)}>
              <option value="HOURS">Hours (HMR)</option>
              <option value="KM">Kilometres</option>
            </select>
          </Field>
          <Field label="Current reading"><input id="af-reading" className={inputClass} type="number"
            value={f.current_reading ?? ""} onChange={(e) => set("current_reading", e.target.value)} /></Field>
          <Field label="Reading as on"><input id="af-readon" className={inputClass} type="date"
            value={f.reading_as_on ?? ""} onChange={(e) => set("reading_as_on", e.target.value)} /></Field>
          <Field label="Remarks"><input id="af-remarks" className={inputClass}
            value={f.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} /></Field>
        </div>
      </Section>

      {/* ── Documents ────────────────────────────────────────── */}
      <Section title="Insurance, tax & statutory documents" open={!!open.docs}
        onToggle={() => toggle("docs")} badge={filledDocs ? `${filledDocs} filled` : undefined}
        hint="Expiry dates drive the alerts — an expired fitness certificate on a running machine is a statutory exposure">
        <div className="space-y-2 pt-3">
          {docs.map((d, i) => (
            <div key={i} className="grid grid-cols-2 lg:grid-cols-6 gap-2 items-end
                                    bg-bg-light border border-border-light rounded p-2.5">
              <Field label="Document">
                <select className={inputClass} value={d.document_type}
                  onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, document_type: e.target.value } : x))}>
                  {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Number">
                <input className={inputClass} value={d.document_no}
                  onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, document_no: e.target.value } : x))} />
              </Field>
              <Field label="Provider / office">
                <input className={inputClass} value={d.provider} placeholder="Insurer, RTO…"
                  onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, provider: e.target.value } : x))} />
              </Field>
              <Field label="Valid upto">
                <input className={inputClass} type="date" value={d.valid_upto}
                  onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, valid_upto: e.target.value } : x))} />
              </Field>
              <Field label="Amount (₹)">
                <input className={inputClass} type="number" value={d.amount}
                  onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              </Field>
              <div className="flex justify-end pb-1">
                <Button variant="danger" size="sm" onClick={() => setDocs(docs.filter((_, j) => j !== i))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setDocs([...docs, emptyDoc("PERMIT")])}>
            <Plus className="w-3.5 h-3.5" /> Add document
          </Button>
        </div>
      </Section>

      {/* ── Maintenance ──────────────────────────────────────── */}
      <Section title="Maintenance schedule" open={!!open.maint} onToggle={() => toggle("maint")}
        badge={filledScheds ? `${filledScheds} set` : undefined}
        hint="Next due is calculated from the interval and the last one done">
        <div className="space-y-2 pt-3">
          {scheds.map((sc, i) => (
            <div key={i} className="grid grid-cols-2 lg:grid-cols-6 gap-2 items-end
                                    bg-bg-light border border-border-light rounded p-2.5">
              <Field label="Type">
                <select className={inputClass} value={sc.schedule_type}
                  onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, schedule_type: e.target.value } : x))}>
                  {SCHED_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Name">
                <input className={inputClass} value={sc.name} placeholder="250 hr service"
                  onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              </Field>
              <Field label="Every">
                <input className={inputClass} type="number" value={sc.interval_value}
                  onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, interval_value: e.target.value } : x))} />
              </Field>
              <Field label="Unit">
                <select className={inputClass} value={sc.interval_uom}
                  onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, interval_uom: e.target.value } : x))}>
                  {["HOURS", "KM", "DAYS", "MONTHS"].map((x) => (
                    <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </Field>
              <Field label={sc.interval_uom === "HOURS" || sc.interval_uom === "KM"
                ? "Last done at reading" : "Last done on"}>
                {sc.interval_uom === "HOURS" || sc.interval_uom === "KM" ? (
                  <input className={inputClass} type="number" value={sc.last_done_reading}
                    onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, last_done_reading: e.target.value } : x))} />
                ) : (
                  <input className={inputClass} type="date" value={sc.last_done_on}
                    onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, last_done_on: e.target.value } : x))} />
                )}
              </Field>
              <div className="flex justify-end pb-1">
                <Button variant="danger" size="sm" onClick={() => setScheds(scheds.filter((_, j) => j !== i))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setScheds([...scheds, emptySched()])}>
            <Plus className="w-3.5 h-3.5" /> Add schedule
          </Button>
        </div>
      </Section>

      {/* ── System names ─────────────────────────────────────── */}
      <Section title="What other systems call it" open={!!open.idents} onToggle={() => toggle("idents")}
        badge={filledIdents ? `${filledIdents} linked` : undefined}
        hint="Telematics says MAN18 where the handover register says MAN-18 — link them here and every query joins">
        <div className="space-y-2 pt-3">
          {idents.map((it, i) => (
            <div key={i} className="grid grid-cols-2 lg:grid-cols-3 gap-2 items-end
                                    bg-bg-light border border-border-light rounded p-2.5">
              <Field label="System">
                <select className={inputClass} value={it.system}
                  onChange={(e) => setIdents(idents.map((x, j) => j === i ? { ...x, system: e.target.value } : x))}>
                  {IDENT_SYSTEMS.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Name in that system">
                <input className={`${inputClass} font-mono`} value={it.external_code} placeholder="MAN18"
                  onChange={(e) => setIdents(idents.map((x, j) => j === i ? { ...x, external_code: e.target.value } : x))} />
              </Field>
              <div className="flex justify-end pb-1">
                <Button variant="danger" size="sm" onClick={() => setIdents(idents.filter((_, j) => j !== i))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm"
            onClick={() => setIdents([...idents, { system: "HOTO", external_code: "" }])}>
            <Plus className="w-3.5 h-3.5" /> Link another system
          </Button>
        </div>
      </Section>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</>
                  : <><Check className="w-4 h-4" /> Register machine</>}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
