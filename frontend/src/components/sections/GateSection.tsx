"use client";
/**
 * The gate.
 *
 * Its own screen, because it is its own job. The security officer at the
 * boundary admits vehicles and signs them out; the weighbridge operator weighs
 * loads. Different people, different hours, different permission — and a gate
 * that only opens from inside a weighbridge screen is one the security officer
 * has to be given the weighbridge to reach.
 *
 * It also has nothing to do with weighing. A vehicle comes through this gate
 * whether or not it will ever go on a deck: a visitor's car, a fuel bowser, a
 * fitter's van. Admitting them belongs here.
 *
 * NOTHING IS TYPED THAT IS ALREADY KNOWN. A vehicle is picked from the
 * equipment register or from the visiting vehicles seen before. Only a truck
 * neither register has ever seen is described, once, and it is found by its
 * number every time after.
 */
import { matchesSearch } from "@/lib/search";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRightLeft, Clock, DoorOpen, IdCard, Loader2, LogIn,
  LogOut, Search, ShieldAlert, Trash2, Truck, Users, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, Field, PageHeader,
  StatBar, Tabs, Td, Th, inputClass, type Tone,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";

interface Vehicle {
  gate_pass_id: number; gate_pass_no: string; purpose: string;
  visiting_vehicle_id: number | null; previous_visits: number | null;
  contract_ref: string | null; entry_at: string; expected_until: string | null;
  vehicle: string | null; asset_id: number | null; fleet_code: string | null;
  vehicle_type: string | null; transporter: string | null;
  standing_tare_kg: number | null; tare_age_days: number | null;
  tare_is_stale: boolean; has_tare: boolean;
  days_inside: number; trips_today: number; trips_total: number;
}
interface Found {
  kind: "ASSET" | "VISITOR";
  asset_id: number | null; visiting_vehicle_id: number | null;
  registration_no: string; fleet_code: string | null; vehicle_type: string | null;
  make: string | null; model: string | null;
  payload_capacity_kg: number | null; standing_tare_kg: number | null;
  owner: string | null; ownership: string | null;
  inside_on: string | null; previous_visits: number | null;
}
interface Driver {
  kind: "OPERATOR" | "VISITOR";
  operator_id: number | null; visiting_driver_id: number | null;
  full_name: string; reference: string | null;
  licence_no: string | null; licence_valid_upto: string | null;
  licence_days_left: number | null; licence_expired: boolean;
  licence_expiring: boolean; licence_recorded: boolean;
  employer: string | null;
}

const kg = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const errorOf = (e: unknown, f: string): string =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? f;

const PURPOSE_LABEL: Record<string, string> = {
  MINING_CONTRACT: "Mining contract", DESPATCH: "Despatch",
  DELIVERY: "Delivery", VISIT: "Visit",
};

type Tab = "inside" | "vehicles" | "drivers";

/* ════════════════════════════════════════════════════════════════════════ */
export default function GateSection() {
  const can = useAuth((s) => s.can);
  const mayGate = can("wb.gate");

  const [tab, setTab] = useState<Tab>("inside");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [admitting, setAdmitting] = useState(false);
  const [exiting, setExiting] = useState<Vehicle | null>(null);
  const [removing, setRemoving] = useState<Vehicle | null>(null);
  const [q, setQ] = useState("");
  const [purpose, setPurpose] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/weighbridge/inside");
      setVehicles(r.data?.vehicles ?? []);
      setError(null);
    } catch (e) { setError(errorOf(e, "Could not read the gate.")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return vehicles.filter((v) =>
      (!purpose || v.purpose === purpose)
      && matchesSearch(s, [v.vehicle, v.fleet_code, v.transporter,
                           v.gate_pass_no, v.contract_ref]));
  }, [vehicles, q, purpose]);

  const longStays = vehicles.filter((v) => v.days_inside >= 90).length;
  const overdue = vehicles.filter((v) =>
    v.expected_until && new Date(v.expected_until) < new Date()).length;
  const idle = vehicles.filter((v) => v.trips_today === 0
    && v.purpose === "MINING_CONTRACT").length;

  const stats = [
    { label: "Inside the mine", value: vehicles.length, tone: "indigo" as Tone, icon: Truck },
    { label: "On contract", value: vehicles.filter((v) => v.purpose === "MINING_CONTRACT").length,
      tone: "navy" as Tone, icon: ArrowRightLeft },
    { label: "Here today only", value: vehicles.filter((v) => v.days_inside < 1).length,
      tone: "teal" as Tone, icon: DoorOpen },
    { label: "No trip today", value: idle, tone: idle ? "amber" as Tone : "slate" as Tone,
      icon: Clock, hint: "On contract but has not hauled" },
    { label: "Past expected date", value: overdue,
      tone: overdue ? "rose" as Tone : "slate" as Tone, icon: AlertTriangle,
      hint: "Contract end has passed" },
    { label: "Inside 90 days+", value: longStays, tone: "slate" as Tone, icon: Clock },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        lead="The" rest="Gate" tone="teal" icon={DoorOpen} tuck
        subtitle={
          "Who is inside the mine, and admitting or signing out a vehicle. A vehicle is "
          + "admitted once and stays on its gate pass for the length of its contract — "
          + "this is not something that happens per load. Vehicles and drivers are picked "
          + "from the registers, never described again."
        }
        actions={mayGate ? (
          <Button variant="primary" onClick={() => setAdmitting(true)}>
            <LogIn className="w-4 h-4" /> Admit a vehicle
          </Button>
        ) : undefined}
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <StatBar items={stats} />

      <Tabs<Tab>
        value={tab} onChange={setTab}
        tabs={[
          { id: "inside", label: "Inside the mine", icon: Truck, tone: "teal" },
          { id: "vehicles", label: "Vehicle registers", icon: Search, tone: "indigo" },
          { id: "drivers", label: "Driver registers", icon: Users, tone: "violet" },
        ]}
      />

      {loading ? (
        <Card><div className="py-20 flex items-center justify-center gap-2 text-txt-light text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading the gate…
        </div></Card>
      ) : tab === "inside" ? (
        <Card>
          <CardHeader
            title="Inside the mine" tone="teal" icon={Truck}
            subtitle={`${rows.length} of ${vehicles.length} shown`}
            actions={
              <div className="flex gap-2">
                <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
                        className={`${inputClass} w-[180px]`}>
                  <option value="">Every purpose</option>
                  {Object.entries(PURPOSE_LABEL).map(([v, l]) =>
                    <option key={v} value={v}>{l}</option>)}
                </select>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
                  <input value={q} onChange={(e) => setQ(e.target.value)}
                         placeholder="Vehicle, contractor, pass or contract"
                         className={`${inputClass} pl-8 w-full sm:w-[320px] lg:w-[440px] xl:w-[520px]`} />
                </div>
              </div>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead><tr>
                <Th>Vehicle</Th><Th>Gate pass</Th><Th>Purpose</Th><Th>Contractor</Th>
                <Th>Contract</Th><Th className="text-right">Days in</Th>
                <Th className="text-right">Trips today</Th><Th>Expected until</Th><Th></Th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && (
                  <EmptyRow colSpan={9}>
                    {vehicles.length === 0
                      ? "Nothing inside. Admit a vehicle and it stays on that pass until it leaves."
                      : "Nothing matches those filters."}
                  </EmptyRow>
                )}
                {rows.map((v) => {
                  const late = v.expected_until && new Date(v.expected_until) < new Date();
                  return (
                    <tr key={v.gate_pass_id} className="hover:bg-bg-section">
                      <Td>
                        <span className="font-semibold text-txt-primary">{v.vehicle}</span>
                        <span className="block text-[11px] text-txt-light">
                          {[v.fleet_code, v.vehicle_type].filter(Boolean).join(" · ")
                           || (v.visiting_vehicle_id ? "visiting vehicle" : "")}
                        </span>
                      </Td>
                      <Td className="tabular-nums">{v.gate_pass_no}</Td>
                      <Td><Chip tone={v.purpose === "MINING_CONTRACT" ? "indigo" : "slate"} dot={false}>
                        {PURPOSE_LABEL[v.purpose] ?? v.purpose}
                      </Chip></Td>
                      <Td>{v.transporter ?? "—"}</Td>
                      <Td className="text-[11.5px]">{v.contract_ref ?? "—"}</Td>
                      <Td className="text-right tabular-nums">{v.days_inside}</Td>
                      <Td className="text-right tabular-nums">
                        {v.trips_today || <span className="text-txt-light">0</span>}
                      </Td>
                      <Td className="tabular-nums">
                        {v.expected_until
                          ? late ? <Chip tone="rose">{v.expected_until}</Chip> : v.expected_until
                          : "—"}
                      </Td>
                      <Td>
                        {mayGate && (
                          <div className="flex justify-end gap-1.5">
                            {/* Only for a pass that has recorded nothing. Once a
                                load has been hauled under it the stay is part of
                                the record and the vehicle is signed out instead,
                                so the button is not offered at all rather than
                                offered and refused. */}
                            {v.trips_total === 0 && (
                              <Button size="sm" onClick={() => setRemoving(v)}
                                      title="Remove this admission — nothing has been hauled under it">
                                <Trash2 className="w-3.5 h-3.5" /> Remove
                              </Button>
                            )}
                            <Button size="sm" onClick={() => setExiting(v)}>
                              <LogOut className="w-3.5 h-3.5" /> Sign out
                            </Button>
                          </div>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : tab === "vehicles" ? (
        <VehicleRegisters />
      ) : (
        <DriverRegisters />
      )}

      {admitting && (
        <AdmitDialog onClose={() => setAdmitting(false)}
          onDone={(m) => { setAdmitting(false); setNotice(m); void load(); }}
          onError={setError} />
      )}
      {removing && (
        <RemoveDialog vehicle={removing} onClose={() => setRemoving(null)}
          onDone={(m) => { setRemoving(null); setNotice(m); void load(); }}
          onError={(m) => { setRemoving(null); setError(m); }} />
      )}
      {exiting && (
        <ExitDialog vehicle={exiting} onClose={() => setExiting(null)}
          onDone={(m) => { setExiting(null); setNotice(m); void load(); }}
          onError={setError} />
      )}
    </div>
  );
}

/* ── Looking up what the registers hold ──────────────────────────────────── */
function VehicleRegisters() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/weighbridge/vehicles/search", { params: { q, limit: 60 } });
        setRows(r.data ?? []);
      } catch { /* the list simply stays as it was */ }
      finally { setBusy(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Card>
      <CardHeader
        title="Vehicles the gate can admit" tone="indigo" icon={Truck}
        subtitle="The equipment register, and outside vehicles seen before."
        actions={
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Number — with or without spaces — fleet code or owner"
                   className={`${inputClass} pl-8 w-full sm:w-[320px] lg:w-[440px] xl:w-[520px]`} />
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead><tr>
            <Th>Number</Th><Th>Register</Th><Th>Fleet code</Th><Th>Type</Th>
            <Th>Make</Th><Th>Owner</Th><Th className="text-right">Tare</Th><Th>State</Th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={8}>{busy ? "Searching…" : "Nothing matches."}</EmptyRow>
            )}
            {rows.map((v) => (
              <tr key={`${v.kind}-${v.asset_id ?? v.visiting_vehicle_id}`} className="hover:bg-bg-section">
                <Td><span className="font-semibold text-txt-primary">{v.registration_no}</span></Td>
                <Td><Chip tone={v.kind === "ASSET" ? "emerald" : "amber"} dot={false}>
                  {v.kind === "ASSET" ? "equipment" : `visitor${v.previous_visits ? ` · ${v.previous_visits}` : ""}`}
                </Chip></Td>
                <Td>{v.fleet_code ?? "—"}</Td>
                <Td>{v.vehicle_type ?? "—"}</Td>
                <Td>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</Td>
                <Td>{v.owner ?? "—"}</Td>
                <Td className="text-right tabular-nums">
                  {v.standing_tare_kg ? kg(v.standing_tare_kg) : <span className="text-txt-light">not taken</span>}
                </Td>
                <Td>{v.inside_on
                  ? <Chip tone="sky">inside on {v.inside_on}</Chip>
                  : <span className="text-txt-light text-[11.5px]">outside</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DriverRegisters() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Driver[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/weighbridge/drivers/search", { params: { q, limit: 60 } });
        setRows(r.data ?? []);
      } catch { /* the list simply stays as it was */ }
      finally { setBusy(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const noLicence = rows.filter((d) => d.kind === "OPERATOR" && !d.licence_recorded).length;

  return (
    <Card>
      <CardHeader
        title="Drivers the gate can name" tone="violet" icon={IdCard}
        subtitle="The operator register, and one-time drivers seen before."
        actions={
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Name, operator number or licence"
                   className={`${inputClass} pl-8 w-full sm:w-[320px] lg:w-[440px] xl:w-[520px]`} />
          </div>
        }
      />
      {noLicence > 0 && (
        <div className="px-5 pt-3">
          <Alert tone="warning">
            {noLicence} of the operators shown have no driving licence recorded against
            them. The gate can only check what the register holds.
          </Alert>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead><tr>
            <Th>Name</Th><Th>Register</Th><Th>Reference</Th><Th>Licence</Th>
            <Th>Valid until</Th><Th>Employer</Th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={6}>{busy ? "Searching…" : "Nothing matches."}</EmptyRow>
            )}
            {rows.map((d) => (
              <tr key={`${d.kind}-${d.operator_id ?? d.visiting_driver_id}`} className="hover:bg-bg-section">
                <Td><span className="font-semibold text-txt-primary">{d.full_name}</span></Td>
                <Td><Chip tone={d.kind === "OPERATOR" ? "emerald" : "amber"} dot={false}>
                  {d.kind === "OPERATOR" ? "operator" : "one-time"}
                </Chip></Td>
                <Td className="tabular-nums">{d.reference ?? "—"}</Td>
                <Td className="tabular-nums">
                  {d.licence_no ?? <span className="text-amber">not recorded</span>}
                </Td>
                <Td className="tabular-nums">
                  {!d.licence_valid_upto ? "—"
                    : d.licence_expired
                      ? <Chip tone="rose">expired {d.licence_valid_upto}</Chip>
                      : d.licence_expiring
                        ? <Chip tone="amber">{d.licence_valid_upto}</Chip>
                        : d.licence_valid_upto}
                </Td>
                <Td>{d.employer ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── Admitting ───────────────────────────────────────────────────────────── */
function AdmitDialog({ onClose, onDone, onError }: {
  onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [searching, setSearching] = useState(false);

  const [newVisitor, setNewVisitor] = useState(false);
  const [reg, setReg] = useState("");
  const [vType, setVType] = useState("Tipper");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [owner, setOwner] = useState("");

  const [purpose, setPurpose] = useState("MINING_CONTRACT");
  const [contract, setContract] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/weighbridge/vehicles/search", { params: { q, limit: 30 } });
        if (live) setHits(r.data ?? []);
      } catch { /* the form still works without suggestions */ }
      finally { if (live) setSearching(false); }
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        purpose, contract_ref: contract.trim(), expected_until: until || null,
      };
      if (newVisitor) {
        body.visitor = {
          registration_no: reg.trim(), vehicle_type: vType.trim(),
          make: make.trim(), model: model.trim(),
          payload_capacity_kg: capacity ? Number(capacity) : null,
          owner_name_text: owner.trim(),
        };
      } else if (picked?.kind === "ASSET") { body.asset_id = picked.asset_id; }
      else if (picked?.kind === "VISITOR") { body.visiting_vehicle_id = picked.visiting_vehicle_id; }

      const r = await api.post("/weighbridge/gate/entry", body);
      onDone(`${r.data?.gate_pass_no} — ${newVisitor ? reg.trim() : picked?.registration_no} admitted.`);
    } catch (e) { onError(errorOf(e, "Could not admit that vehicle.")); }
    finally { setBusy(false); }
  };

  const blocked = busy || (newVisitor ? !reg.trim() : !picked || !!picked.inside_on);

  return (
    <Dialog open tone="info" width={880} bare title="Admit a vehicle to the mine"
            confirmLabel="Admit" onCancel={onClose}
            onConfirm={() => void save()} busy={blocked}>
      <p className="text-[12px] text-txt-light -mt-1 mb-4">
        Once. The vehicle stays on this gate pass until it leaves the mine for
        good — every load it carries in between is a trip.
      </p>

      {/* Two columns: a laptop screen is wide and short, and this had ten
       *  fields stacked in one narrow column running well past the bottom of
       *  a 768-high display. Which vehicle goes on the left, because that is
       *  the question; why it is here goes on the right. */}
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]
                      items-start md:min-h-[330px]">

        {/* ── left: which vehicle ───────────────────────────────────── */}
        <div className="space-y-3">
          {!newVisitor ? (
            <>
              <Field label="Vehicle" required
                     hint="From the equipment register, or a visitor seen before.">
                {picked ? (
                  <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg
                                  bg-indigo-bg ring-1 ring-indigo-ring">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-navy">
                          {picked.registration_no}
                        </span>
                        {picked.fleet_code && (
                          <Chip tone="slate" dot={false}>{picked.fleet_code}</Chip>
                        )}
                        <Chip tone={picked.kind === "ASSET" ? "emerald" : "amber"} dot={false}>
                          {picked.kind === "ASSET" ? "equipment register" : "visiting vehicle"}
                        </Chip>
                      </div>
                      <p className="text-[11px] text-txt-muted mt-0.5">
                        {[picked.vehicle_type, picked.make, picked.owner]
                          .filter(Boolean).join(" · ") || "—"}
                        {picked.standing_tare_kg
                          ? ` · tare ${kg(picked.standing_tare_kg)} kg`
                          : " · no tare yet"}
                      </p>
                    </div>
                    <button onClick={() => setPicked(null)}
                            className="text-txt-light hover:text-navy shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-txt-light absolute left-3
                                       top-1/2 -translate-y-1/2" />
                    <input value={q} onChange={(e) => setQ(e.target.value)}
                           placeholder="Number, fleet code or owner"
                           className={`${inputClass} pl-8`} autoFocus />
                  </div>
                )}
              </Field>

              {picked?.inside_on && (
                <Alert tone="error">
                  {picked.registration_no} is already inside on {picked.inside_on}.
                </Alert>
              )}

              {!picked && (
                <div className="max-h-[228px] overflow-y-auto scrollbar-thin
                                rounded-lg border border-border-light">
                  {searching && hits.length === 0 && (
                    <p className="px-3 py-6 text-center text-[12px] text-txt-light">
                      Searching…
                    </p>
                  )}
                  {!searching && hits.length === 0 && (
                    <p className="px-3 py-6 text-center text-[12px] text-txt-light">
                      Nothing on either register matches that.
                    </p>
                  )}
                  {hits.map((h) => (
                    <button key={`${h.kind}-${h.asset_id ?? h.visiting_vehicle_id}`}
                            onClick={() => setPicked(h)} disabled={!!h.inside_on}
                            className={`w-full text-left px-3 py-2 border-b border-border-light
                                        last:border-0 ${h.inside_on
                                          ? "opacity-40 cursor-not-allowed"
                                          : "hover:bg-bg-section"}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12.5px] font-semibold text-txt-primary">
                          {h.registration_no}
                        </span>
                        {h.fleet_code && (
                          <span className="text-[11px] text-txt-light">{h.fleet_code}</span>
                        )}
                        {h.kind === "VISITOR" && (
                          <Chip tone="amber" dot={false}>
                            visitor{h.previous_visits ? ` · ${h.previous_visits}` : ""}
                          </Chip>
                        )}
                        {h.inside_on && (
                          <Chip tone="slate" dot={false}>inside on {h.inside_on}</Chip>
                        )}
                      </div>
                      <span className="block text-[11px] text-txt-light truncate">
                        {[h.vehicle_type, h.make, h.owner].filter(Boolean).join(" · ")
                         || "no details recorded"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <button onClick={() => { setNewVisitor(true); setPicked(null); setReg(q.toUpperCase()); }}
                      className="text-[11.5px] text-txt-muted hover:text-navy
                                 underline underline-offset-2">
                Not on either register — a one-time vehicle
              </button>
            </>
          ) : (
            <>
              <Alert tone="warning">
                Recorded once and found by its number every time after. Not the
                equipment register — it is not BAL plant.
              </Alert>
              <Field label="Registration number" required>
                <input value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())}
                       className={inputClass} autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select value={vType} onChange={(e) => setVType(e.target.value)}
                          className={inputClass}>
                    <option>Tipper</option><option>Truck</option><option>Trailer</option>
                    <option>Tanker</option><option>Hyva</option><option>Car</option>
                    <option>Other</option>
                  </select>
                </Field>
                <Field label="Payload (kg)" hint="Flags an overloaded trip.">
                  <input value={capacity} onChange={(e) => setCapacity(e.target.value)}
                         inputMode="numeric" className={inputClass} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Make">
                  <input value={make} onChange={(e) => setMake(e.target.value)}
                         className={inputClass} placeholder="Tata, Ashok Leyland…" />
                </Field>
                <Field label="Model">
                  <input value={model} onChange={(e) => setModel(e.target.value)}
                         className={inputClass} />
                </Field>
              </div>
              <Field label="Transporter or owner">
                <input value={owner} onChange={(e) => setOwner(e.target.value)}
                       className={inputClass} />
              </Field>
              <button onClick={() => setNewVisitor(false)}
                      className="text-[11.5px] text-txt-muted hover:text-navy
                                 underline underline-offset-2">
                Back to searching the registers
              </button>
            </>
          )}
        </div>

        {/* ── right: why it is here ─────────────────────────────────── */}
        <div className="space-y-4">
          <Field label="Why it is here" required>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
                    className={inputClass}>
              <option value="MINING_CONTRACT">Mining contract — staying to work</option>
              <option value="DESPATCH">Despatch — collecting and leaving</option>
              <option value="DELIVERY">Delivery — bringing something in</option>
              <option value="VISIT">Visit</option>
            </select>
          </Field>

          <Field label="Contract reference">
            <input value={contract} onChange={(e) => setContract(e.target.value)}
                   className={inputClass} />
          </Field>

          <Field label="Expected until" hint="When the contract ends, if known.">
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)}
                   className={inputClass} />
          </Field>

          <p className="text-[11px] text-txt-light leading-relaxed border-t
                        border-border-light pt-3">
            A contractor&apos;s tipper admitted today is still on this pass in
            March. Sign it out only when it actually leaves the mine — the trips
            it made stay on the record either way.
          </p>
        </div>
      </div>
    </Dialog>
  );
}

function RemoveDialog({ vehicle, onClose, onDone, onError }: {
  vehicle: Vehicle | null; onClose: () => void;
  onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!vehicle) return null;

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/weighbridge/gate/${vehicle.gate_pass_id}`);
      onDone(`${vehicle.gate_pass_no} removed. ${vehicle.vehicle} was never `
             + `recorded as being inside.`);
    } catch (e) { onError(errorOf(e, "Could not remove the gate pass.")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open tone="danger" title={`Remove ${vehicle.gate_pass_no}`}
            confirmLabel="Remove the admission" cancelLabel="Keep it"
            onCancel={onClose} onConfirm={() => void remove()} busy={busy}>
      <div className="space-y-2 text-[13px] text-txt-secondary">
        <p>
          Nothing has been hauled under this pass, so there is nothing to keep.
          It goes entirely, and the gate log will not show that
          <span className="text-txt-primary"> {vehicle.vehicle} </span>
          was ever inside.
        </p>
        <p>
          If the vehicle really did come in and has now left, sign it out
          instead — that keeps the stay on the record.
        </p>
      </div>
    </Dialog>
  );
}

function ExitDialog({ vehicle, onClose, onDone, onError }: {
  vehicle: Vehicle; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/weighbridge/gate/${vehicle.gate_pass_id}/exit`, { reason });
      onDone(`${vehicle.vehicle} signed out after ${vehicle.days_inside} days `
             + `and ${r.data?.trips_recorded ?? 0} trips.`);
    } catch (e) { onError(errorOf(e, "Could not sign the vehicle out.")); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open tone="warning" title={`Sign out — ${vehicle.vehicle}`}
            confirmLabel="Sign out of the mine" onCancel={onClose}
            onConfirm={() => void save()} busy={busy}>
      <div className="space-y-3.5">
        <Alert tone="warning">
          This closes the vehicle&apos;s stay — it has been inside {vehicle.days_inside} days.
          Only do this when the vehicle is actually leaving; its trips stay on the record.
        </Alert>
        <Field label="Reason" hint="Contract ended, going out for repair, replaced.">
          <input value={reason} onChange={(e) => setReason(e.target.value)}
                 className={inputClass} autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}
