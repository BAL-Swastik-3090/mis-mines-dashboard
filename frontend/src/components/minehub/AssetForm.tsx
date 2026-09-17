"use client";
/**
 * Equipment registration.
 *
 * Laid out as a dense sheet rather than a wizard: a registration is reference
 * work, done with the papers on the desk, and someone filling it needs to see
 * what is still blank without clicking through steps.
 *
 * Every repeated value — make, unit, insurer, service name — is a Combobox
 * backed by the lookup table, so the second person to register a Tata tipper
 * picks "Tata" rather than inventing "TATA". Adding a missing value is one
 * click and never refused; the aim is that picking is easier than typing, not
 * that typing is blocked.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Check, AlertCircle, Loader2, Info, ArrowLeft, Send, CheckCircle2, Undo2 } from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Chip, type Tone } from "./ui";
import RevisionPanel, { type Revision } from "./RevisionPanel";
import Combobox from "./Combobox";

interface AssetType { asset_type_id: number; name: string; category: string }
interface Party { party_id: number; display_name: string; legal_name: string }
interface Location { location_id: number; name: string; location_type: string }

interface DocRow {
  document_type: string; document_no: string; provider: string;
  valid_from: string; valid_upto: string; amount: string;
}
interface SchedRow {
  schedule_type: string; name: string; interval_value: string; interval_uom: string;
  last_done_on: string; last_done_reading: string;
}
interface IdentRow { system: string; external_code: string }

const DOC_TYPES: [string, string][] = [
  ["INSURANCE", "Insurance"], ["FITNESS", "Fitness certificate"], ["PUC", "PUC"],
  ["ROAD_TAX", "Road tax"], ["PERMIT", "Permit"], ["NATIONAL_PERMIT", "National permit"],
  ["STATUTORY_INSPECTION", "Statutory inspection"], ["EXPLOSIVE_LICENCE", "Explosive licence"],
  ["POLLUTION_NOC", "Pollution NOC"], ["OTHER", "Other"],
];
const SCHED_TYPES: [string, string][] = [
  ["SERVICE", "Service"], ["PREVENTIVE", "Preventive"], ["OIL_CHANGE", "Oil change"],
  ["INSPECTION", "Inspection"], ["OVERHAUL", "Overhaul"], ["TYRE_ROTATION", "Tyre rotation"],
  ["OTHER", "Other"],
];
const IDENT_SYSTEMS = ["TELEMATICS", "HOTO", "WEIGHBRIDGE", "RFID", "SAP", "SECURITY", "LEGACY"];

const emptyDoc = (t: string): DocRow => ({
  document_type: t, document_no: "", provider: "", valid_from: "", valid_upto: "", amount: "",
});
const emptySched = (): SchedRow => ({
  schedule_type: "SERVICE", name: "", interval_value: "", interval_uom: "HOURS",
  last_done_on: "", last_done_reading: "",
});

const cellInput =
  "w-full bg-transparent px-3 py-2 text-[13px] text-txt-primary placeholder:text-txt-light " +
  "focus:outline-none focus:bg-sky-bg/60 rounded transition-colors";

/** A dark banded section header, as on the cost sheet. */
function Band({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="bg-navy px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 rounded-t-lg">
      <div className="flex items-center gap-2 min-w-0">
        <h3 className="font-condensed font-bold text-[13px] uppercase tracking-[.1em] text-white">
          {title}
        </h3>
        {hint && (
          <span title={hint} className="text-white/40 hover:text-white/70 cursor-help">
            <Info className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      {right}
    </div>
  );
}

/** One label/value row of the sheet. */
function Row({ label, required, hint, children, wide }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <>
      <div className="bg-bg-light px-3 py-2 flex items-center gap-1.5 border-b border-r border-border-light">
        <span className="text-[12px] font-medium text-txt-secondary">{label}</span>
        {required && <span className="text-rose text-[12px]">*</span>}
        {hint && (
          <span title={hint} className="text-txt-light hover:text-navy cursor-help">
            <Info className="w-3 h-3" />
          </span>
        )}
      </div>
      <div className={`border-b border-border-light ${wide ? "col-span-3" : ""}`}>{children}</div>
    </>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  // label / value / label / value — collapses to two columns on a narrow screen.
  return (
    <div className="grid grid-cols-[minmax(120px,170px)_1fr] lg:grid-cols-[minmax(120px,190px)_1fr_minmax(120px,190px)_1fr]
                    border-l border-t border-border-light rounded-b-lg overflow-hidden">
      {children}
    </div>
  );
}

export default function AssetForm({ assetId, prefill, onDone, onCancel }: {
  /** Editing an existing machine rather than registering a new one. */
  assetId?: number;
  prefill?: { fleet_code?: string; telematics_code?: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(assetId);
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
      ? [{ system: "TELEMATICS", external_code: prefill.telematics_code }] : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, unknown> | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loadingRev, setLoadingRev] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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

  const loadRevisions = useCallback(async () => {
    if (!assetId) return;
    setLoadingRev(true);
    try {
      const r = await api.get(`/minehub/assets/${assetId}/revisions`);
      setRevisions(r.data ?? []);
    } catch { setRevisions([]); } finally { setLoadingRev(false); }
  }, [assetId]);

  const loadAsset = useCallback(async () => {
    if (!assetId) return;
    try {
      const r = await api.get(`/minehub/assets/${assetId}`);
      const a = r.data ?? {};
      setLoaded(a);
      // Dates arrive as ISO and the inputs want yyyy-mm-dd; everything else
      // becomes a string because that is what a form field holds.
      const asForm: Record<string, string> = {};
      Object.entries(a).forEach(([k, v]) => {
        if (v === null || v === undefined || typeof v === "object") return;
        asForm[k] = String(v);
      });
      setF(asForm);
      setDocs((a.documents ?? []).map((d: Record<string, unknown>) => ({
        document_type: String(d.document_type ?? "INSURANCE"),
        document_no: String(d.document_no ?? ""), provider: String(d.provider ?? ""),
        valid_from: String(d.valid_from ?? ""), valid_upto: String(d.valid_upto ?? ""),
        amount: String(d.amount ?? ""),
      })));
      setScheds((a.schedules ?? []).map((x: Record<string, unknown>) => ({
        schedule_type: String(x.schedule_type ?? "SERVICE"), name: String(x.name ?? ""),
        interval_value: String(x.interval_value ?? ""), interval_uom: String(x.interval_uom ?? "HOURS"),
        last_done_on: String(x.last_done_on ?? ""), last_done_reading: String(x.last_done_reading ?? ""),
      })));
      setIdents((a.identities ?? []).map((i: Record<string, unknown>) => ({
        system: String(i.system ?? "TELEMATICS"), external_code: String(i.external_code ?? ""),
      })));
    } catch {
      setError("Could not load this machine.");
    }
  }, [assetId]);

  useEffect(() => { void loadAsset(); void loadRevisions(); }, [loadAsset, loadRevisions]);

  const set = (k: string, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const isElectric = f.fuel_type === "ELECTRIC" || f.fuel_type === "HYBRID";
  // The picker shows a name; the form stores the id it resolves to.
  const typeName = types.find((t) => String(t.asset_type_id) === f.asset_type_id)?.name ?? "";
  const isHired = f.ownership === "HIRED";

  const filled = useMemo(() => {
    const total = 12;
    const done = ["fleet_code", "nickname", "asset_type_id", "registration_no", "make", "model",
      "capacity", "current_reading", "home_location_id", "fuel_type", "purchase_date",
      "commissioned_on"].filter((k) => (f[k] ?? "").toString().trim()).length;
    return Math.round((done / total) * 100);
  }, [f]);

  const submit = async () => {
    if (!f.fleet_code?.trim()) { setError("Fleet code is required."); return; }
    if (!f.asset_type_id) { setError("Choose an equipment type."); return; }
    if (isHired && !f.owner_party_id) { setError("A hired machine must record its contractor."); return; }

    setSaving(true); setError(null);
    try {
      if (editing) {
        const r = await api.put(`/minehub/assets/${assetId}`, f);
        setNotice(r.data?.changed
          ? `Saved — ${r.data.changed} field${r.data.changed === 1 ? "" : "s"} changed, now v${r.data.version}.`
             + (r.data.approval_reset ? " Approval was reset, because what was approved is no longer what is on file." : "")
          : "Nothing had changed.");
        await loadAsset(); await loadRevisions();
        setSaving(false);
        return;
      }
      await api.post("/minehub/assets", {
        ...f, documents: docs, schedules: scheds,
        identities: idents.filter((i) => i.external_code.trim()),
      });
      // Teach the lists what was chosen, so the next person sees it first.
      void api.post("/minehub/lookups/used", {
        values: [
          { category: "MAKE", value: f.make },
          { category: "CAPACITY_UOM", value: f.capacity_uom },
          { category: "RATE_UOM", value: f.hire_rate_uom },
          { category: "CHARGING_TYPE", value: f.charging_type },
          ...docs.map((d) => ({ category: "INSURER", value: d.provider })),
          ...scheds.map((s) => ({ category: "SERVICE_NAME", value: s.name })),
        ].filter((v) => v.value),
      }).catch(() => {});
      onDone();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not register the machine.");
    } finally { setSaving(false); }
  };

  const act = async (what: "submit" | "approve" | "send-back") => {
    let remarks: string | undefined;
    if (what === "send-back") {
      const said = window.prompt("What needs correcting?");
      if (!said?.trim()) return;      // a bare rejection helps nobody
      remarks = said.trim();
    }
    setBusy(what); setError(null);
    try {
      await api.post(`/minehub/assets/${assetId}/${what}`, { remarks });
      setNotice(what === "approve" ? "Approved onto the register."
        : what === "submit" ? "Submitted for approval."
        : "Sent back for correction.");
      await loadAsset(); await loadRevisions();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not complete that.");
    } finally { setBusy(null); }
  };

  const status = String(loaded?.approval_status ?? "DRAFT");
  const statusTone: Tone =
    status === "APPROVED" ? "emerald" : status === "SUBMITTED" ? "amber"
    : status === "SENT_BACK" ? "rose" : "slate";

  const sheet = (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onCancel}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-txt-muted
                       hover:text-navy transition-colors mb-2">
            <ArrowLeft className="w-4 h-4" /> Back to registry
          </button>
          <h2 className="font-condensed font-extrabold text-[24px] leading-none text-navy">
            {editing
              ? <>{String(f.nickname || f.fleet_code || "Machine")}<span className="text-gold-dark ml-2 text-[16px] font-mono">v{String(loaded?.version ?? 1)}</span></>
              : <>Register a <span className="text-gold-dark">machine</span></>}
          </h2>
          <p className="text-[12px] text-txt-muted mt-1.5">
            {editing
              ? "Every change is recorded with its old and new value. Editing an approved machine returns it to draft."
              : "Only fleet code and type are required. What is left blank shows up under Alerts rather than blocking the registration."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editing && <Chip tone={statusTone}>{status.replace("_", " ").toLowerCase()}</Chip>}
          <Chip tone={filled > 70 ? "emerald" : filled > 35 ? "amber" : "slate"}>
            {filled}% filled
          </Chip>
          {editing && (status === "DRAFT" || status === "SENT_BACK") && (
            <Button size="sm" variant="accent" disabled={busy !== null} onClick={() => act("submit")}>
              <Send className="w-3.5 h-3.5" /> Submit for approval
            </Button>
          )}
          {editing && status === "SUBMITTED" && (
            <>
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => act("approve")}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
              </Button>
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => act("send-back")}>
                <Undo2 className="w-3.5 h-3.5" /> Send back
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <Alert tone="error">
          <span className="inline-flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</span>
        </Alert>
      )}
      {notice && (
        <Alert tone="success">
          <span className="inline-flex items-center gap-2"><Check className="w-4 h-4" />{notice}</span>
        </Alert>
      )}

      {/* ── Identity ─────────────────────────────────────────── */}
      <div>
        <Band title="Identity" hint="The fleet code is the system key; the nickname is what the mine says out loud" />
        <Sheet>
          <Row label="Fleet code" required hint="Unique. MAN-18, EX-04, DZ-02">
            <input id="af-fleet" className={cellInput} value={f.fleet_code ?? ""}
              onChange={(e) => set("fleet_code", e.target.value)} placeholder="MAN-18" />
          </Row>
          <Row label="Nickname" hint="Shown on handover and operational screens">
            <input id="af-nick" className={cellInput} value={f.nickname ?? ""}
              onChange={(e) => set("nickname", e.target.value)} placeholder="Bada Tipper" />
          </Row>
          <Row label="Equipment type" required
               hint="Not on the list? Type it and add it — a near-enough type carries the wrong rated figures into every calculation">
            <div className="px-1.5 py-1">
              <Combobox id="af-type"
                options={types.map((t) => ({ value: t.name, hint: t.category.toLowerCase() }))}
                value={typeName}
                placeholder="Excavator, Tipper, Drill…"
                onChange={(name) => {
                  const hit = types.find((t) => t.name === name);
                  if (hit) set("asset_type_id", String(hit.asset_type_id));
                }}
                onAddNew={async (name) => {
                  const r = await api.post("/minehub/asset-types", { name });
                  const created = { asset_type_id: r.data.asset_type_id, name: r.data.name, category: "OTHER" };
                  setTypes((prev) => prev.some((t) => t.asset_type_id === created.asset_type_id)
                    ? prev : [...prev, created]);
                  set("asset_type_id", String(created.asset_type_id));
                  return created.name;
                }} />
            </div>
          </Row>
          <Row label="Registration no.">
            <input id="af-reg" className={cellInput} value={f.registration_no ?? ""}
              onChange={(e) => set("registration_no", e.target.value)} placeholder="OD04L0327" />
          </Row>
          <Row label="Make">
            <div className="px-1.5 py-1">
              <Combobox id="af-make" category="MAKE" value={f.make ?? ""}
                onChange={(v) => set("make", v)} placeholder="Tata, CAT, Volvo…" />
            </div>
          </Row>
          <Row label="Model">
            <input id="af-model" className={cellInput} value={f.model ?? ""}
              onChange={(e) => set("model", e.target.value)} />
          </Row>
          <Row label="Year of make">
            <input id="af-year" type="number" className={cellInput} value={f.year_of_make ?? ""}
              onChange={(e) => set("year_of_make", e.target.value)} placeholder="2022" />
          </Row>
          <Row label="Chassis no.">
            <input id="af-chassis" className={cellInput} value={f.chassis_no ?? ""}
              onChange={(e) => set("chassis_no", e.target.value)} />
          </Row>
          <Row label="Engine no.">
            <input id="af-engine" className={cellInput} value={f.engine_no ?? ""}
              onChange={(e) => set("engine_no", e.target.value)} />
          </Row>
          <Row label="Commissioned on">
            <input id="af-comm" type="date" className={cellInput} value={f.commissioned_on ?? ""}
              onChange={(e) => set("commissioned_on", e.target.value)} />
          </Row>
        </Sheet>
      </div>

      {/* ── Ownership ────────────────────────────────────────── */}
      <div>
        <Band title="Ownership & cost"
          hint="Own or hired — this is what makes contractor performance measurable"
          right={<Chip tone={isHired ? "amber" : "sky"}>{isHired ? "Hired" : "Own · BAL"}</Chip>} />
        <Sheet>
          <Row label="Ownership" required>
            <select id="af-own" className={cellInput} value={f.ownership ?? "OWN"}
              onChange={(e) => set("ownership", e.target.value)}>
              <option value="OWN">Own (BAL)</option>
              <option value="HIRED">Hired (contractor)</option>
            </select>
          </Row>
          {isHired ? (
            <>
              <Row label="Contractor" required>
                <select id="af-owner" className={cellInput} value={f.owner_party_id ?? ""}
                  onChange={(e) => set("owner_party_id", e.target.value)}>
                  <option value="">Select…</option>
                  {parties.map((p) => (
                    <option key={p.party_id} value={p.party_id}>{p.display_name || p.legal_name}</option>
                  ))}
                </select>
              </Row>
              <Row label="Hire rate (₹)">
                <input id="af-hire" type="number" className={cellInput} value={f.hire_rate ?? ""}
                  onChange={(e) => set("hire_rate", e.target.value)} />
              </Row>
              <Row label="Rate basis">
                <div className="px-1.5 py-1">
                  <Combobox id="af-hireuom" category="RATE_UOM" value={f.hire_rate_uom ?? ""}
                    onChange={(v) => set("hire_rate_uom", v)} placeholder="per hour, per tonne…" />
                </div>
              </Row>
            </>
          ) : (
            <>
              <Row label="SAP asset no." hint="Blank for hired machines — SAP is an identity, not the key">
                <div className="px-1.5 py-1">
                  <Combobox id="af-sap" category="SAP_ASSET" value={f.sap_asset_no ?? ""}
                    onChange={(v) => set("sap_asset_no", v)} placeholder="Search or add…" />
                </div>
              </Row>
              <Row label="Purchase date">
                <input id="af-pdate" type="date" className={cellInput} value={f.purchase_date ?? ""}
                  onChange={(e) => set("purchase_date", e.target.value)} />
              </Row>
              <Row label="Purchase cost (₹)">
                <input id="af-pcost" type="number" className={cellInput} value={f.purchase_cost ?? ""}
                  onChange={(e) => set("purchase_cost", e.target.value)} />
              </Row>
              <Row label="Supplier">
                <select id="af-supplier" className={cellInput} value={f.supplier_party_id ?? ""}
                  onChange={(e) => set("supplier_party_id", e.target.value)}>
                  <option value="">Select…</option>
                  {parties.map((p) => (
                    <option key={p.party_id} value={p.party_id}>{p.display_name || p.legal_name}</option>
                  ))}
                </select>
              </Row>
            </>
          )}
        </Sheet>
      </div>

      {/* ── Capability ───────────────────────────────────────── */}
      <div>
        <Band title="Capability & fuel"
          hint="Rated figures drive every utilisation and capacity-gap number the platform reports"
          right={isElectric ? <Chip tone="emerald">Electric</Chip> : undefined} />
        <Sheet>
          <Row label="Capacity">
            <input id="af-cap" type="number" className={cellInput} value={f.capacity ?? ""}
              onChange={(e) => set("capacity", e.target.value)} placeholder="25" />
          </Row>
          <Row label="Capacity unit">
            <div className="px-1.5 py-1">
              <Combobox id="af-capuom" category="CAPACITY_UOM" value={f.capacity_uom ?? ""}
                onChange={(v) => set("capacity_uom", v)} placeholder="MT, m³…" />
            </div>
          </Row>
          <Row label="Rated output / hr" hint="Sets every capacity-gap figure — leave blank until signed off">
            <input id="af-rout" type="number" className={cellInput} value={f.rated_output_per_hr ?? ""}
              onChange={(e) => set("rated_output_per_hr", e.target.value)} />
          </Row>
          <Row label="Fuel type">
            <select id="af-fuel" className={cellInput} value={f.fuel_type ?? "DIESEL"}
              onChange={(e) => set("fuel_type", e.target.value)}>
              {["DIESEL", "PETROL", "ELECTRIC", "HYBRID", "CNG", "NONE"].map((x) => (
                <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </Row>
          {!isElectric ? (
            <>
              <Row label="Rated fuel (L/hr)">
                <input id="af-lph" type="number" className={cellInput} value={f.rated_fuel_lph ?? ""}
                  onChange={(e) => set("rated_fuel_lph", e.target.value)} />
              </Row>
              <Row label="Tank capacity (L)">
                <input id="af-tank" type="number" className={cellInput} value={f.tank_capacity_l ?? ""}
                  onChange={(e) => set("tank_capacity_l", e.target.value)} />
              </Row>
            </>
          ) : (
            <>
              <Row label="Battery (kWh)">
                <input id="af-kwh" type="number" className={cellInput} value={f.battery_kwh ?? ""}
                  onChange={(e) => set("battery_kwh", e.target.value)} />
              </Row>
              <Row label="Range (km)">
                <input id="af-range" type="number" className={cellInput} value={f.range_km ?? ""}
                  onChange={(e) => set("range_km", e.target.value)} />
              </Row>
              <Row label="Charging type">
                <div className="px-1.5 py-1">
                  <Combobox id="af-charge" category="CHARGING_TYPE" value={f.charging_type ?? ""}
                    onChange={(v) => set("charging_type", v)} placeholder="DC fast…" />
                </div>
              </Row>
              <Row label="Charge time (hrs)">
                <input id="af-chargetime" type="number" className={cellInput} value={f.charge_time_hrs ?? ""}
                  onChange={(e) => set("charge_time_hrs", e.target.value)} />
              </Row>
            </>
          )}
          <Row label="Tyres">
            <input id="af-tyres" type="number" className={cellInput} value={f.tyre_count ?? ""}
              onChange={(e) => set("tyre_count", e.target.value)} />
          </Row>
          <Row label="Seats">
            <input id="af-seats" type="number" className={cellInput} value={f.seating_capacity ?? ""}
              onChange={(e) => set("seating_capacity", e.target.value)} />
          </Row>
        </Sheet>
      </div>

      {/* ── Deployment ───────────────────────────────────────── */}
      <div>
        <Band title="Deployment & meter"
          hint="The reading every handover and service interval counts from" />
        <Sheet>
          <Row label="Home location">
            <select id="af-loc" className={cellInput} value={f.home_location_id ?? ""}
              onChange={(e) => set("home_location_id", e.target.value)}>
              <option value="">Select…</option>
              {locations.map((l) => (
                <option key={l.location_id} value={l.location_id}>{l.name} · {l.location_type}</option>
              ))}
            </select>
          </Row>
          <Row label="Status">
            <select id="af-status" className={cellInput} value={f.status ?? "ACTIVE"}
              onChange={(e) => set("status", e.target.value)}>
              {["ACTIVE", "MAINTENANCE", "STANDBY", "IDLE", "DISPOSED"].map((x) => (
                <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </Row>
          <Row label="Meter reads in">
            <select id="af-ruom" className={cellInput} value={f.reading_uom ?? "HOURS"}
              onChange={(e) => set("reading_uom", e.target.value)}>
              <option value="HOURS">Hours (HMR)</option>
              <option value="KM">Kilometres</option>
            </select>
          </Row>
          <Row label="Current reading">
            <input id="af-reading" type="number" className={cellInput} value={f.current_reading ?? ""}
              onChange={(e) => set("current_reading", e.target.value)} />
          </Row>
          <Row label="Reading as on">
            <input id="af-readon" type="date" className={cellInput} value={f.reading_as_on ?? ""}
              onChange={(e) => set("reading_as_on", e.target.value)} />
          </Row>
          <Row label="Remarks">
            <input id="af-remarks" className={cellInput} value={f.remarks ?? ""}
              onChange={(e) => set("remarks", e.target.value)} />
          </Row>
        </Sheet>
      </div>

      {/* ── Documents ────────────────────────────────────────── */}
      <div>
        <Band title="Insurance, tax & statutory documents"
          hint="Expiry drives the alerts — an expired fitness certificate on a running machine is a statutory exposure"
          right={<Button size="sm" variant="secondary" onClick={() => setDocs([...docs, emptyDoc("PERMIT")])}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>} />
        <div className="border border-t-0 border-border-light rounded-b-lg overflow-x-auto overflow-y-visible">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="bg-bg-light">
                {["Document", "Number", "Provider / office", "Valid from", "Valid upto", "Amount ₹", ""].map((h) => (
                  <th key={h} className="text-left font-condensed text-[10.5px] font-bold uppercase
                                         tracking-[.1em] text-txt-light px-3 py-2 border-b border-border-light">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => (
                <tr key={i} className="border-b border-border-light last:border-0">
                  <td className="w-[180px]">
                    <select className={cellInput} value={d.document_type}
                      onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, document_type: e.target.value } : x))}>
                      {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td><input className={cellInput} value={d.document_no} placeholder="Policy / certificate no."
                    onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, document_no: e.target.value } : x))} /></td>
                  <td className="w-[210px] px-1.5 py-1">
                    <Combobox category={d.document_type === "INSURANCE" ? "INSURER" : "ISSUING_AUTHORITY"}
                      value={d.provider} placeholder="Insurer / RTO…"
                      onChange={(v) => setDocs(docs.map((x, j) => j === i ? { ...x, provider: v } : x))} />
                  </td>
                  <td className="w-[140px]"><input type="date" className={cellInput} value={d.valid_from}
                    onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, valid_from: e.target.value } : x))} /></td>
                  <td className="w-[140px]"><input type="date" className={cellInput} value={d.valid_upto}
                    onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, valid_upto: e.target.value } : x))} /></td>
                  <td className="w-[110px]"><input type="number" className={cellInput} value={d.amount}
                    onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} /></td>
                  <td className="w-[46px] text-center">
                    <button onClick={() => setDocs(docs.filter((_, j) => j !== i))}
                      className="text-txt-light hover:text-rose" aria-label="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Maintenance ──────────────────────────────────────── */}
      <div>
        <Band title="Maintenance schedule"
          hint="Next due is calculated from the interval and the last one done"
          right={<Button size="sm" variant="secondary" onClick={() => setScheds([...scheds, emptySched()])}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>} />
        <div className="border border-t-0 border-border-light rounded-b-lg overflow-x-auto overflow-y-visible">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="bg-bg-light">
                {["Type", "Name", "Every", "Unit", "Last done", ""].map((h) => (
                  <th key={h} className="text-left font-condensed text-[10.5px] font-bold uppercase
                                         tracking-[.1em] text-txt-light px-3 py-2 border-b border-border-light">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scheds.map((sc, i) => {
                const byUsage = sc.interval_uom === "HOURS" || sc.interval_uom === "KM";
                return (
                  <tr key={i} className="border-b border-border-light last:border-0">
                    <td className="w-[150px]">
                      <select className={cellInput} value={sc.schedule_type}
                        onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, schedule_type: e.target.value } : x))}>
                        {SCHED_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-1.5 py-1">
                      <Combobox category="SERVICE_NAME" value={sc.name} placeholder="250 hr service…"
                        onChange={(v) => setScheds(scheds.map((x, j) => j === i ? { ...x, name: v } : x))} />
                    </td>
                    <td className="w-[110px]"><input type="number" className={cellInput} value={sc.interval_value}
                      onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, interval_value: e.target.value } : x))} /></td>
                    <td className="w-[120px]">
                      <select className={cellInput} value={sc.interval_uom}
                        onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, interval_uom: e.target.value } : x))}>
                        {["HOURS", "KM", "DAYS", "MONTHS"].map((x) => (
                          <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()}</option>
                        ))}
                      </select>
                    </td>
                    <td className="w-[160px]">
                      {byUsage ? (
                        <input type="number" className={cellInput} value={sc.last_done_reading}
                          placeholder="at reading"
                          onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, last_done_reading: e.target.value } : x))} />
                      ) : (
                        <input type="date" className={cellInput} value={sc.last_done_on}
                          onChange={(e) => setScheds(scheds.map((x, j) => j === i ? { ...x, last_done_on: e.target.value } : x))} />
                      )}
                    </td>
                    <td className="w-[46px] text-center">
                      <button onClick={() => setScheds(scheds.filter((_, j) => j !== i))}
                        className="text-txt-light hover:text-rose" aria-label="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Identities ───────────────────────────────────────── */}
      <div>
        <Band title="What other systems call it"
          hint="Telematics says MAN18 where the handover register says MAN-18 — link them and every query joins"
          right={<Button size="sm" variant="secondary"
            onClick={() => setIdents([...idents, { system: "HOTO", external_code: "" }])}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>} />
        <div className="border border-t-0 border-border-light rounded-b-lg overflow-x-auto overflow-y-visible">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="bg-bg-light">
                {["System", "Name in that system", ""].map((h) => (
                  <th key={h} className="text-left font-condensed text-[10.5px] font-bold uppercase
                                         tracking-[.1em] text-txt-light px-3 py-2 border-b border-border-light">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {idents.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-5 text-center text-[12px] text-txt-light">
                  Nothing linked — this machine&apos;s telematics and handover records will not join to it.
                </td></tr>
              )}
              {idents.map((it, i) => (
                <tr key={i} className="border-b border-border-light last:border-0">
                  <td className="w-[180px]">
                    <select className={cellInput} value={it.system}
                      onChange={(e) => setIdents(idents.map((x, j) => j === i ? { ...x, system: e.target.value } : x))}>
                      {IDENT_SYSTEMS.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </td>
                  <td><input className={`${cellInput} font-mono`} value={it.external_code} placeholder="MAN18"
                    onChange={(e) => setIdents(idents.map((x, j) => j === i ? { ...x, external_code: e.target.value } : x))} /></td>
                  <td className="w-[46px] text-center">
                    <button onClick={() => setIdents(idents.filter((_, j) => j !== i))}
                      className="text-txt-light hover:text-rose" aria-label="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1 sticky bottom-0 bg-bg-base/95 backdrop-blur py-3 -mx-1 px-1
                      border-t border-border-light">
        <Button variant="primary" size="lg" onClick={submit} disabled={saving}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : <><Check className="w-4 h-4" /> {editing ? "Save changes" : "Register machine"}</>}
        </Button>
        <Button variant="ghost" size="lg" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );

  if (!editing) return sheet;

  // Editing shows the trail beside the sheet: the history is the reason to open
  // an existing machine at all, and putting it below would hide it under a long
  // form.
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
      {sheet}
      <div className="xl:sticky xl:top-[86px]">
        <RevisionPanel revisions={revisions} loading={loadingRev} />
      </div>
    </div>
  );
}
