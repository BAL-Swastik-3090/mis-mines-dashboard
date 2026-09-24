"use client";
/**
 * The weighbridge.
 *
 * The screen is built around what actually happens all day: a tipper rolls
 * onto the deck, somebody says where it came from and what is in it, and the
 * weight is taken. That is the whole job, three hundred times a shift, and it
 * gets the main tab.
 *
 * The gate is somewhere else, because it happens twice in a vehicle's life —
 * once when the contractor brings it in, once when it finally leaves. Putting
 * gate entry on the same screen as weighing implies a truck arrives and departs
 * for every load, which is what the first version of this got wrong.
 *
 * THE LIVE WEIGHT IS NOT A FORM FIELD. It is what the bridge is showing, and
 * it cannot be typed into. Capture sends which bridge, never which number —
 * the server reads the indicator's own last settled reading. Typing a weight is
 * a different button, a different permission, and has to say why.
 *
 * A NET IS NOT ALWAYS A MEASUREMENT. Most hauls weigh only the loaded truck and
 * subtract the vehicle's standing tare. That is a sound way to run a bridge and
 * a bad thing to hide: where the tare is old, the screen says so, because a
 * three-week-old tare quietly inflates every tonne recorded against it.
 */
import { matchesSearch, rank } from "@/lib/search";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Clock, Gauge, Hand, Loader2, Plus, Radio, Scale, Search,
  SlidersHorizontal, Truck, Weight, Wifi, WifiOff, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, Field, PageHeader,
  StatBar, Tabs, Td, Th, inputClass, type Tone,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";

/* ── Shapes ──────────────────────────────────────────────────────────────── */
interface Bridge {
  weighbridge_id: number; code: string; name: string; status: string;
  capacity_kg: number | null; verification_due_on: string | null;
  weight_kg: number | null; is_stable: boolean; raw_line: string | null;
  is_live: boolean; seconds_since_reading: number | null;
  machine_name: string | null; last_error: string | null;
}
interface Vehicle {
  gate_pass_id: number; gate_pass_no: string; purpose: string;
  visiting_vehicle_id: number | null; previous_visits: number | null;
  contract_ref: string | null; entry_at: string; expected_until: string | null;
  vehicle: string | null; asset_id: number | null; fleet_code: string | null;
  vehicle_type: string | null; transporter: string | null;
  payload_capacity_kg: number | null; standing_tare_kg: number | null;
  tare_taken_at: string | null; tare_age_days: number | null;
  tare_is_stale: boolean; has_tare: boolean;
  days_inside: number; trips_today: number; open_trip_id: number | null;
}
interface Trip {
  trip_id: number; trip_no: string; status: string; production_date: string;
  shift_code: string | null; gate_pass_no: string;
  vehicle: string | null; fleet_code: string | null; asset_id: number | null;
  driver: string | null; driver_licence: string | null;
  driver_is_visitor: boolean; transporter: string | null; material: string | null;
  source: string | null; destination: string | null; bridge: string | null;
  gross_kg: number | null; tare_kg: number | null; net_kg: number | null;
  tare_source: string | null; tare_age_days: number | null;
  tare_is_stale: boolean; has_manual: boolean; overload_kg: number | null;
  created_by: string | null; gross_at: string | null;
}
interface Mat {
  material_id: number; code: string; name: string; material_class: string;
  is_saleable: boolean; material_category_id: number; sort_order: number;
}
interface Category {
  material_category_id: number; code: string; name: string;
  sort_order: number; materials: Mat[];
}
interface Place {
  location_id: number; code: string; name: string; location_type: string;
  movement_group_id: number; sort_order: number;
}
interface MoveGroup {
  movement_group_id: number; code: string; name: string;
  is_source: boolean; is_destination: boolean; sort_order: number;
  needs_choice: boolean; places: Place[];
}
interface Driver {
  kind: "OPERATOR" | "VISITOR";
  operator_id: number | null; visiting_driver_id: number | null;
  full_name: string; reference: string | null;
  licence_no: string | null; licence_valid_upto: string | null;
  licence_days_left: number | null; licence_expired: boolean;
  licence_expiring: boolean; licence_recorded: boolean;
  phone: string | null; employer: string | null; designation: string | null;
  visits: number | null;
}

const kg = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const errorOf = (e: unknown, f: string): string =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? f;

const ago = (s: number | null) =>
  s === null ? "never" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago`
    : `${Math.round(s / 3600)} h ago`;

type Tab = "weigh" | "trips" | "bridges" | "customise";

/* ════════════════════════════════════════════════════════════════════════ */
export default function WeighbridgeSection() {
  const can = useAuth((s) => s.can);
  const mayWeigh = can("wb.weigh");
  const mayManual = can("wb.manual");
  const mayTare = can("wb.tare");
  const mayManage = can("wb.manage");
  const mayMasters = can("wb.masters");

  const [tab, setTab] = useState<Tab>("weigh");
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [sources, setSources] = useState<MoveGroup[]>([]);
  const [destinations, setDestinations] = useState<MoveGroup[]>([]);
  const [agents, setAgents] = useState<{ agent_id: number; machine_name: string; bridge: string;
    watch_path: string; is_up: boolean; seconds_since_seen: number | null;
    readings_last_hour: number; last_error: string | null; status: string; version: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);   // actions, not loads
  const [notice, setNotice] = useState<string | null>(null);

  const [weighing, setWeighing] = useState<Vehicle | null>(null);
  const [taring, setTaring] = useState<Vehicle | null>(null);

  /* Each panel loads on its own, and each keeps its own error.
   *
   * These were one Promise.all with one shared error string, and it failed
   * badly: /trips broke, the whole batch rejected, so the vehicle list — which
   * had loaded perfectly well — was never set either. The screen showed an
   * empty weighbridge with a vehicle sitting inside the mine. Then the live
   * poll, which was succeeding, cleared the error a second and a half later
   * and there was nothing on screen to say anything had gone wrong at all.
   *
   * One broken endpoint should cost you that endpoint's panel, and should say
   * so where that panel is. It should not blank the screen and then go quiet.
   */
  const [liveError, setLiveError] = useState<string | null>(null);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [tripsError, setTripsError] = useState<string | null>(null);

  const loadLive = useCallback(async () => {
    try {
      const r = await api.get("/weighbridge/live");
      setBridges(r.data?.bridges ?? []);
      setLiveError(null);
    } catch (e) { setLiveError(errorOf(e, "Could not reach the weighbridge.")); }
  }, []);

  const loadRest = useCallback(async () => {
    const settle = async <T,>(call: Promise<{ data: T }>,
                              apply: (d: T) => void,
                              fail: (m: string | null) => void,
                              what: string) => {
      try { apply((await call).data); fail(null); }
      catch (e) { fail(errorOf(e, `Could not load ${what}.`)); }
    };

    await Promise.all([
      settle(api.get("/weighbridge/inside"),
             (d: { vehicles?: Vehicle[] }) => setVehicles(d?.vehicles ?? []),
             setVehiclesError, "the vehicles inside the mine"),
      settle(api.get("/weighbridge/trips", { params: { limit: 400 } }),
             (d: { trips?: Trip[]; summary?: Record<string, number> }) => {
               setTrips(d?.trips ?? []); setSummary(d?.summary ?? {});
             },
             setTripsError, "the trip record"),
      settle(api.get("/weighbridge/masters"),
             (d: { categories?: Category[]; sources?: MoveGroup[]; destinations?: MoveGroup[] }) => {
               setCategories(d?.categories ?? []);
               setSources(d?.sources ?? []);
               setDestinations(d?.destinations ?? []);
             },
             () => {}, "the categories, sources and destinations"),
      settle(api.get("/weighbridge/agents"),
             (d: { agents?: typeof agents }) => setAgents(d?.agents ?? []),
             () => {}, "the agents"),
    ]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadLive(); void loadRest(); }, [loadLive, loadRest]);
  useEffect(() => {
    const t = setInterval(() => { void loadLive(); }, 1500);
    return () => clearInterval(t);
  }, [loadLive]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const refresh = useCallback(async () => { await Promise.all([loadLive(), loadRest()]); },
                              [loadLive, loadRest]);

  const today = new Date().toISOString().slice(0, 10);
  const todayTrips = useMemo(() => trips.filter((t) => t.production_date === today), [trips, today]);
  const tonnes = useMemo(
    () => todayTrips.reduce((s, t) => s + (t.net_kg ?? 0), 0) / 1000, [todayTrips]);
  const staleTares = useMemo(() => vehicles.filter((v) => v.tare_is_stale || !v.has_tare).length,
                             [vehicles]);

  const stats = [
    { label: "Inside the mine", value: vehicles.length, tone: "indigo" as Tone, icon: Truck,
      hint: "On an open gate pass — managed at the Gate" },
    { label: "Trips today", value: todayTrips.length, tone: "navy" as Tone, icon: ArrowRight,
      onClick: () => setTab("trips"), title: "Show the record" },
    { label: "Tonnes today", value: tonnes.toFixed(1), tone: "gold" as Tone, icon: Scale,
      hint: "Net, gross less tare" },
    { label: "On standing tare", value: todayTrips.filter((t) => t.tare_source === "STANDING").length,
      tone: "slate" as Tone, icon: Weight, hint: "Empty weight not re-taken today" },
    { label: "Tare stale or unset", value: staleTares,
      tone: staleTares ? "amber" as Tone : "emerald" as Tone, icon: Clock,
      hint: "Their nets are estimates" },
    { label: "Typed by hand", value: todayTrips.filter((t) => t.has_manual).length,
      tone: todayTrips.some((t) => t.has_manual) ? "rose" as Tone : "slate" as Tone,
      icon: Hand, hint: "Not taken from the bridge" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        lead="Weigh" rest="bridge" joined tone="gold" icon={Scale} tuck
        subtitle={
          "One point of capture. A vehicle is admitted to the mine once and stays for the "
          + "contract; every load it carries is a trip recorded here as it is weighed — "
          + "vehicle, driver, the pit it came out of, where it is going, and what it is. "
          + "The live weight comes from the indicator and cannot be typed into."
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {liveError && <Alert tone="error">{liveError}</Alert>}
      {vehiclesError && <Alert tone="error">{vehiclesError}</Alert>}
      {tripsError && <Alert tone="error">{tripsError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <StatBar items={stats} />

      <Tabs<Tab>
        value={tab} onChange={setTab}
        tabs={[
          { id: "weigh", label: "Weigh a load", icon: Gauge, tone: "gold" },
          { id: "trips", label: "Trips", icon: ArrowRight, tone: "indigo" },
          { id: "bridges", label: "Bridges & agents", icon: Radio, tone: "slate" },
          { id: "customise", label: "Customise lists", icon: SlidersHorizontal, tone: "violet" },
        ]}
      />

      {loading ? (
        <Card><div className="py-20 flex items-center justify-center gap-2 text-txt-light text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading the weighbridge…
        </div></Card>
      ) : tab === "weigh" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-start">
          <div className="space-y-4">
            {bridges.map((b) => <Deck key={b.weighbridge_id} bridge={b} />)}
            {bridges.length === 0 && (
              <Card><div className="py-14 text-center px-6">
                <Scale className="w-8 h-8 text-txt-light mx-auto mb-3" />
                <p className="text-[13px] text-txt-muted">No weighbridge is set up yet.</p>
              </div></Card>
            )}
          </div>

          <Card>
            <CardHeader
              title="On the deck now" tone="gold" icon={Truck}
              subtitle="Pick the vehicle that has just driven on, then say where the load came from."
            />
            <VehiclePicker
              vehicles={vehicles}
              onPick={(v) => setWeighing(v)}
              onTare={mayTare ? (v) => setTaring(v) : undefined}
              disabled={!mayWeigh && !mayManual}
            />
          </Card>
        </div>
      ) : tab === "trips" ? (
        <TripTable trips={trips} summary={summary}
                   sources={sources} categories={categories} />
      ) : tab === "customise" ? (
        <Customise mayEdit={mayMasters}
                   onChanged={(m) => { setNotice(m); void refresh(); }} onError={setError} />
      ) : (
        <BridgesAndAgents
          bridges={bridges} agents={agents} mayManage={mayManage}
          onChanged={(m) => { setNotice(m); void refresh(); }} onError={setError}
        />
      )}

      {weighing && (
        <CaptureDialog
          vehicle={weighing} bridges={bridges}
          categories={categories} sources={sources} destinations={destinations}
          mayManual={mayManual} mayWeigh={mayWeigh}
          onClose={() => setWeighing(null)}
          onDone={(m) => { setWeighing(null); setNotice(m); void refresh(); }}
          onError={setError}
        />
      )}
      {taring && (
        <TareDialog
          vehicle={taring} bridges={bridges}
          onClose={() => setTaring(null)}
          onDone={(m) => { setTaring(null); setNotice(m); void refresh(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

/* ── The deck ────────────────────────────────────────────────────────────── */
function Deck({ bridge: b }: { bridge: Bridge }) {
  const live = b.is_live && b.weight_kg !== null;
  const over = live && b.capacity_kg && b.weight_kg! > b.capacity_kg;
  return (
    <Card>
      <div className="px-5 py-4 bg-[#0f1c35]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-bold tracking-wide text-[#f5a623] font-condensed">
            {b.name}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold">
            {b.is_live
              ? <><Wifi className="w-3.5 h-3.5 text-emerald-light" /><span className="text-emerald-light">live</span></>
              : <><WifiOff className="w-3.5 h-3.5 text-rose-light" /><span className="text-rose-light">no signal</span></>}
          </span>
        </div>
        <div className="mt-3 text-center">
          <span className={`font-condensed font-extrabold leading-none tabular-nums text-[60px]
                            ${!live ? "text-white/25" : over ? "text-rose-light"
                              : b.is_stable ? "text-emerald-light" : "text-white"}`}>
            {live ? kg(b.weight_kg) : "—"}
          </span>
          <span className="block text-[11px] text-white/40 mt-1 tracking-[.14em] uppercase">
            kilograms
          </span>
        </div>
        <div className="mt-3 text-center min-h-[18px]">
          {live ? (
            <span className={`text-[11.5px] font-semibold
                              ${b.is_stable ? "text-emerald-light" : "text-white/50"}`}>
              {b.is_stable ? "settled — ready to capture" : "weighing…"}
              {over ? " · over the bridge's rated capacity" : ""}
            </span>
          ) : (
            <span className="text-[11.5px] text-rose-light">
              {b.last_error ?? `last reading ${ago(b.seconds_since_reading)}`}
              {b.machine_name ? ` · ${b.machine_name}` : " · no agent registered"}
            </span>
          )}
        </div>
      </div>
      {b.raw_line && (
        <div className="px-5 py-2 text-[11px] text-txt-light font-mono truncate">{b.raw_line}</div>
      )}
    </Card>
  );
}

/* ── Picking the vehicle on the deck ─────────────────────────────────────── */
function VehiclePicker({ vehicles, onPick, onTare, disabled }: {
  vehicles: Vehicle[]; onPick: (v: Vehicle) => void;
  onTare?: (v: Vehicle) => void; disabled: boolean;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return vehicles;
    // Closest match first. Typing a whole fleet code means that truck, so it
    // should not sit below one that merely contains the same characters.
    return vehicles
      .filter((v) => matchesSearch(s, [v.vehicle, v.fleet_code, v.transporter]))
      .sort((a, b) => rank(s, [a.fleet_code, a.vehicle])
                    - rank(s, [b.fleet_code, b.vehicle]));
  }, [vehicles, q]);

  return (
    <>
      <div className="px-4 pt-3 pb-2 border-b border-border-light">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Vehicle number, fleet code or contractor"
                 className={`${inputClass} pl-8`} />
        </div>
      </div>
      <div className="max-h-[520px] overflow-y-auto scrollbar-thin divide-y divide-border-light">
        {rows.length === 0 && (
          <p className="px-5 py-14 text-center text-[13px] text-txt-light">
            {vehicles.length === 0
              ? "No vehicle is inside the mine yet. Admit one on the Gate screen — it then stays on that pass and hauls under it."
              : `No vehicle inside the mine matches “${q}”. This list is only what is inside the gate, not the whole register.`}
          </p>
        )}
        {rows.map((v) => (
          <div key={v.gate_pass_id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13.5px] font-semibold text-txt-primary">{v.vehicle}</span>
                {v.fleet_code && <Chip tone="slate" dot={false}>{v.fleet_code}</Chip>}
                {v.vehicle_type && <Chip tone="indigo" dot={false}>{v.vehicle_type}</Chip>}
                {!v.has_tare
                  ? <Chip tone="rose">no tare</Chip>
                  : v.tare_is_stale
                    ? <Chip tone="amber">tare {v.tare_age_days}d old</Chip>
                    : null}
              </div>
              <p className="text-[11px] text-txt-light mt-0.5">
                {v.transporter ? `${v.transporter} · ` : ""}
                inside {v.days_inside}d · {v.trips_today} trips today
                {v.has_tare ? ` · tare ${kg(v.standing_tare_kg)} kg` : ""}
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {onTare && v.asset_id && (
                <Button size="sm" onClick={() => onTare(v)}>Tare</Button>
              )}
              <Button size="sm" variant="primary" disabled={disabled}
                      onClick={() => onPick(v)}>
                Weigh
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Capturing a load: the one screen the whole module is for ────────────── */
function CaptureDialog({ vehicle, bridges, categories, sources, destinations,
                         mayManual, mayWeigh, onClose, onDone, onError }: {
  vehicle: Vehicle; bridges: Bridge[];
  categories: Category[]; sources: MoveGroup[]; destinations: MoveGroup[];
  mayManual: boolean; mayWeigh: boolean;
  onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const usable = bridges.filter((b) => b.status === "ACTIVE");
  const [bridgeId, setBridgeId] = useState<number | null>(usable[0]?.weighbridge_id ?? null);
  // Each choice narrows the next, and clears whatever it invalidated —
  // leaving a stale material selected under a new category is how a load of
  // overburden gets recorded as high grade ore.
  const [catId, setCatId] = useState<number | null>(null);
  const [material, setMaterial] = useState<string>("");
  const [srcGroupId, setSrcGroupId] = useState<number | null>(null);
  const [source, setSource] = useState<string>("");
  const [dstGroupId, setDstGroupId] = useState<number | null>(null);
  const [dest, setDest] = useState<string>("");

  const category = categories.find((c) => c.material_category_id === catId) ?? null;
  const srcGroup = sources.find((g) => g.movement_group_id === srcGroupId) ?? null;
  const dstGroup = destinations.find((g) => g.movement_group_id === dstGroupId) ?? null;

  const pickCategory = (c: Category) => {
    setCatId(c.material_category_id);
    // One material type under a category is not a choice — take it.
    setMaterial(c.materials.length === 1 ? String(c.materials[0].material_id) : "");
  };
  const pickSource = (g: MoveGroup) => {
    setSrcGroupId(g.movement_group_id);
    setSource(g.places.length === 1 ? String(g.places[0].location_id) : "");
  };
  const pickDest = (g: MoveGroup) => {
    setDstGroupId(g.movement_group_id);
    setDest(g.places.length === 1 ? String(g.places[0].location_id) : "");
  };
  const [driverQ, setDriverQ] = useState("");
  const [driver, setDriver] = useState<Driver | null>(null);
  const [hits, setHits] = useState<Driver[]>([]);
  // Only when the operator register genuinely does not have him.
  const [newDriver, setNewDriver] = useState(false);
  const [dName, setDName] = useState("");
  const [dLicence, setDLicence] = useState("");
  const [dPhone, setDPhone] = useState("");
  const [dValid, setDValid] = useState("");
  const [shift, setShift] = useState("A");
  const [manual, setManual] = useState(!mayWeigh);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/weighbridge/drivers/search",
                                { params: { q: driverQ, limit: 20 } });
        setHits(r.data ?? []);
      } catch { /* the form still works without suggestions */ }
    }, 250);
    return () => clearTimeout(t);
  }, [driverQ]);

  const bridge = bridges.find((b) => b.weighbridge_id === bridgeId) ?? null;
  const ready = bridge?.is_live && bridge.is_stable;


  const save = async () => {
    if (!bridgeId) return;
    setBusy(true);
    try {
      // A driver the register does not have is recorded once, keyed on his
      // licence, and found by it every time after.
      let visitingDriverId: number | null = driver?.visiting_driver_id ?? null;
      if (newDriver) {
        const d = await api.post("/weighbridge/drivers", {
          full_name: dName.trim(), licence_no: dLicence.trim(),
          phone: dPhone.trim(), licence_valid_upto: dValid || null,
        });
        visitingDriverId = d.data?.visiting_driver_id ?? null;
      }
      const created = await api.post("/weighbridge/trips", {
        gate_pass_id: vehicle.gate_pass_id,
        operator_id: newDriver ? null : (driver?.operator_id ?? null),
        visiting_driver_id: visitingDriverId,
        source_location_id: source ? Number(source) : null,
        dest_location_id: dest ? Number(dest) : null,
        material_id: material ? Number(material) : null,
        shift_code: shift, weighbridge_id: bridgeId,
        capture: !manual,
      });
      let net: number | null = created.data?.gross?.net_kg ?? null;
      if (manual) {
        const w = await api.post(`/weighbridge/trips/${created.data.trip_id}/weigh`, {
          kind: "GROSS", weighbridge_id: bridgeId, capture_mode: "MANUAL",
          weight_kg: Number(typed), manual_reason: reason,
        });
        net = w.data?.net_kg ?? null;
      }
      onDone(`${created.data.trip_no} — ${vehicle.vehicle}`
             + (net !== null ? `, net ${kg(net)} kg` : " recorded"));
    } catch (e) { onError(errorOf(e, "Could not record that load.")); }
    finally { setBusy(false); }
  };

  // Every step of the cascade has to be answered. A group with one place
  // behind it fills its own choice, so this never blocks on a question the
  // operator was not asked.
  const blocked = busy || !bridgeId || !material
    || !srcGroupId || (srcGroup?.needs_choice && !source)
    || !dstGroupId || (dstGroup?.needs_choice && !dest)
    || (newDriver ? (!dName.trim() || !dLicence.trim()) : !driver)
    || (manual && (!typed || Number.isNaN(Number(typed)) || reason.trim().length < 5))
    || (!manual && !ready);

  return (
    <Dialog
      open tone={manual ? "warning" : "info"} width={960} bare
      title={`Weigh a load — ${vehicle.vehicle}`}
      confirmLabel={manual ? "Record typed weight" : "Capture and record trip"}
      onCancel={onClose} onConfirm={() => void save()} busy={blocked}
    >
      <p className="text-[12px] text-txt-light -mt-1 mb-4">
        Capture the weighment against this vehicle&apos;s gate pass.
      </p>

      {/* Two columns and a floor under them.
       *
       * One column ran to nine stacked blocks and the operator scrolled past
       * the live weight to reach the confirm button — backwards for a screen
       * used with a truck on the deck. min-height keeps the panel from
       * jumping as the cascade opens and closes beneath the cursor. */}
      <div className="grid gap-5 md:grid-cols-[286px_minmax(0,1fr)] items-start
                      md:min-h-[430px]">

        {/* ── left: the deck, and what is standing on it ────────────── */}
        <div className="space-y-3">
          {!manual ? (
            <div className="rounded-xl bg-[#0f1c35] overflow-hidden">
              <div className="px-4 pt-3.5 flex items-center justify-between">
                <span className="flex items-center gap-2 text-[10.5px] font-bold
                                 tracking-[.14em] uppercase text-white/50">
                  <Radio className="w-3.5 h-3.5" /> Live weighing
                </span>
                <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full
                                  text-[10px] font-bold uppercase tracking-wide
                                  ${bridge?.is_live ? "bg-emerald/20 text-emerald-light"
                                                    : "bg-rose/20 text-rose-light"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full
                                    ${bridge?.is_live ? "bg-emerald-light" : "bg-rose-light"}`} />
                  {bridge?.is_live ? "online" : "offline"}
                </span>
              </div>

              <div className="px-4 py-4 text-center">
                <span className={`font-condensed font-extrabold text-[44px] leading-none
                                  tabular-nums tracking-tight
                                  ${!bridge?.is_live ? "text-white/20"
                                    : bridge.is_stable ? "text-emerald-light" : "text-white"}`}>
                  {bridge?.is_live ? kg(bridge.weight_kg) : "— — —"}
                  <span className="text-[16px] text-white/40 ml-2 font-bold">KG</span>
                </span>
                <span className="block text-[9.5px] text-white/35 mt-1.5
                                 uppercase tracking-[.16em]">
                  kilograms on the deck
                </span>
                <span className={`block text-[11px] mt-2.5 font-semibold
                                  ${ready ? "text-emerald-light" : "text-white/45"}`}>
                  {!bridge?.is_live ? "the bridge is not reporting"
                    : bridge.is_stable ? "settled — ready to capture"
                    : "wait for the load to steady"}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-ring bg-amber-bg/40 p-3.5 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-[.12em] text-amber">
                Weight typed by hand
              </p>
              <Field label="Gross weight in kilograms" required>
                <input value={typed} onChange={(e) => setTyped(e.target.value)}
                       inputMode="numeric" className={inputClass} />
              </Field>
              <Field label="Why not from the bridge?" required
                     hint="A failed indicator, a power cut, weighed elsewhere.">
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                       className={inputClass} />
              </Field>
            </div>
          )}

          <div className="rounded-xl border border-border-light overflow-hidden">
            <div className="px-3.5 py-3 flex items-start gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-indigo-bg ring-1 ring-indigo-ring
                               flex items-center justify-center shrink-0">
                <Truck className="w-4 h-4 text-indigo" />
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-txt-primary leading-tight">
                  {vehicle.vehicle}
                </p>
                <p className="text-[11px] text-txt-light mt-0.5">
                  {[vehicle.fleet_code, vehicle.vehicle_type].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
            </div>
            <div className={`px-3.5 py-2 text-[11.5px] border-t
                             ${!vehicle.has_tare ? "bg-rose-bg border-rose-ring text-rose"
                               : vehicle.tare_is_stale ? "bg-amber-bg border-amber-ring text-amber"
                               : "bg-bg-section border-border-light text-txt-muted"}`}>
              {!vehicle.has_tare
                ? "No standing tare — no net can be worked out"
                : vehicle.tare_is_stale
                  ? `Tare ${kg(vehicle.standing_tare_kg)} kg · ${vehicle.tare_age_days} days old`
                  : `Tare ${kg(vehicle.standing_tare_kg)} kg`}
            </div>
          </div>

          {usable.length > 1 && (
            <Choices label="Bridge"
                     options={usable.map((b) => ({ id: b.weighbridge_id, name: b.code }))}
                     value={bridgeId} onChange={setBridgeId} />
          )}

          {mayManual && mayWeigh && (
            <button onClick={() => setManual((m) => !m)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl
                         bg-sky-bg ring-1 ring-sky-ring text-[11.5px] text-sky
                         hover:bg-sky-bg/70 transition-colors text-left">
              <Hand className="w-3.5 h-3.5 shrink-0" />
              {manual ? "Capture from the bridge instead"
                      : "The bridge is not working — type the weight"}
            </button>
          )}
        </div>

        {/* ── right: what the load is, and where it moved ───────────── */}
        <div className="space-y-4">
          <Choices label="Category" required
                   options={categories.map((c) => ({ id: c.material_category_id, name: c.name }))}
                   value={catId}
                   onChange={(id) => pickCategory(categories.find((c) => c.material_category_id === id)!)} />

          {category && category.materials.length > 1 && (
            <Choices label={`${category.name} type`} required tone="gold"
                     options={category.materials.map((m) => ({ id: m.material_id, name: m.name }))}
                     value={material ? Number(material) : null}
                     onChange={(id) => setMaterial(String(id))} />
          )}
          {category && category.materials.length === 1 && (
            <p className="text-[11.5px] text-txt-muted">
              {category.name} type:{" "}
              <span className="font-semibold text-txt-primary">{category.materials[0].name}</span>
            </p>
          )}
          {category && category.materials.length === 0 && (
            <Alert tone="warning">
              No material type under {category.name}. Add one under Customise lists.
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2.5 rounded-xl bg-bg-section p-3">
              <Choices label="Source" required
                       options={sources.map((g) => ({ id: g.movement_group_id, name: g.name }))}
                       value={srcGroupId}
                       onChange={(id) => pickSource(sources.find((g) => g.movement_group_id === id)!)} />
              {srcGroup?.needs_choice && (
                <Choices label={`${srcGroup.name} location`} required tone="gold"
                         options={srcGroup.places.map((l) => ({ id: l.location_id, name: l.name }))}
                         value={source ? Number(source) : null}
                         onChange={(id) => setSource(String(id))} />
              )}
            </div>

            <div className="space-y-2.5 rounded-xl bg-bg-section p-3">
              <Choices label="Destination" required
                       options={destinations.map((g) => ({ id: g.movement_group_id, name: g.name }))}
                       value={dstGroupId}
                       onChange={(id) => pickDest(destinations.find((g) => g.movement_group_id === id)!)} />
              {dstGroup?.needs_choice && (
                <Choices label={`${dstGroup.name} location`} required tone="gold"
                         options={dstGroup.places.map((l) => ({ id: l.location_id, name: l.name }))}
                         value={dest ? Number(dest) : null}
                         onChange={(id) => setDest(String(id))} />
              )}
            </div>
          </div>

          <Choices label="Shift" required
                   options={[{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }]}
                   value={{ A: 1, B: 2, C: 3 }[shift] ?? 1}
                   onChange={(id) => setShift(["A", "B", "C"][id - 1])} />

          {!newDriver ? (
            <div>
              <Field label="Driver" required
                     hint="From the operator register — all 211 are contractors' drivers.">
                {driver ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg
                                  bg-indigo-bg ring-1 ring-indigo-ring">
                    <span className="text-[12.5px] font-semibold text-navy flex-1 truncate">
                      {driver.full_name}
                      {driver.reference && (
                        <span className="font-normal text-txt-muted"> · {driver.reference}</span>
                      )}
                    </span>
                    {driver.licence_expired && <Chip tone="rose" dot={false}>licence expired</Chip>}
                    <button onClick={() => { setDriver(null); setDriverQ(""); }}
                            className="text-txt-light hover:text-navy shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-txt-light absolute left-3
                                         top-1/2 -translate-y-1/2" />
                      <input value={driverQ} onChange={(e) => setDriverQ(e.target.value)}
                             placeholder="Name, operator number or licence"
                             className={`${inputClass} pl-8`} />
                    </div>
                    {driverQ && hits.length > 0 && (
                      <div className="mt-1 max-h-[116px] overflow-y-auto scrollbar-thin
                                      rounded-lg border border-border-light">
                        {hits.map((d) => (
                          <button key={`${d.kind}-${d.operator_id ?? d.visiting_driver_id}`}
                                  onClick={() => setDriver(d)}
                                  className="w-full text-left px-3 py-1.5 hover:bg-bg-section
                                             border-b border-border-light last:border-0">
                            <span className="text-[12.5px] text-txt-primary">{d.full_name}</span>
                            {d.reference && (
                              <span className="text-[11px] text-txt-light"> · {d.reference}</span>
                            )}
                            {d.licence_expired && (
                              <Chip tone="rose" dot={false} className="ml-1.5">expired</Chip>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Field>
              <button onClick={() => { setNewDriver(true); setDriver(null); setDName(driverQ); }}
                      className="mt-1.5 text-[11.5px] text-txt-muted hover:text-navy
                                 underline underline-offset-2">
                Not on the register — a one-time driver
              </button>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-amber-ring bg-amber-bg/40 p-3">
              <p className="text-[11px] text-amber leading-relaxed">
                Recorded once against the licence number and found by it every time after.
                Not the operator register — no competency or medical behind it.
              </p>
              <Field label="Driver's name" required>
                <input value={dName} onChange={(e) => setDName(e.target.value)} className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Licence number" required>
                  <input value={dLicence} onChange={(e) => setDLicence(e.target.value.toUpperCase())}
                         className={inputClass} />
                </Field>
                <Field label="Valid until">
                  <input type="date" value={dValid} onChange={(e) => setDValid(e.target.value)}
                         className={inputClass} />
                </Field>
              </div>
              <button onClick={() => setNewDriver(false)}
                      className="text-[11.5px] text-amber hover:text-navy underline underline-offset-2">
                Back to searching the operator register
              </button>
            </div>
          )}

          {!vehicle.has_tare && (
            <Alert tone="warning">
              This vehicle has no standing tare, so no net weight can be worked out
              from a gross alone. Take its tare first.
            </Alert>
          )}
          {driver?.licence_expired && (
            <Alert tone="error">
              {driver.full_name}&apos;s licence expired
              {driver.licence_valid_upto ? ` on ${driver.licence_valid_upto}` : ""}. The load
              is still recorded — refusing it would only mean it goes unrecorded — but it
              is marked on the trip.
            </Alert>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ── Standing tare ───────────────────────────────────────────────────────── */
function TareDialog({ vehicle, bridges, onClose, onDone, onError }: {
  vehicle: Vehicle; bridges: Bridge[];
  onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const usable = bridges.filter((b) => b.status === "ACTIVE");
  const [bridgeId, setBridgeId] = useState<number | null>(usable[0]?.weighbridge_id ?? null);
  const [busy, setBusy] = useState(false);
  const bridge = bridges.find((b) => b.weighbridge_id === bridgeId) ?? null;
  const ready = bridge?.is_live && bridge.is_stable;

  const save = async () => {
    if (!bridgeId || !vehicle.asset_id) return;
    setBusy(true);
    try {
      const r = await api.post(`/weighbridge/vehicles/${vehicle.asset_id}/tare`,
                               { weighbridge_id: bridgeId });
      const d = r.data?.change_kg;
      onDone(`${vehicle.vehicle} tare set to ${kg(r.data?.standing_tare_kg)} kg`
             + (d ? ` (${d > 0 ? "+" : ""}${kg(d)} kg on the last one)` : ""));
    } catch (e) { onError(errorOf(e, "Could not set the tare.")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open tone="warning" title={`Standing tare — ${vehicle.vehicle}`}
            confirmLabel="Take this as the tare" onCancel={onClose}
            onConfirm={() => void save()} busy={busy || !ready}>
      <div className="space-y-3.5">
        <Alert tone="warning">
          Every net weight for this vehicle is worked out from this figure until
          it is taken again. Make sure the vehicle is empty and on the deck.
        </Alert>
        <div className="rounded-xl bg-[#0f1c35] px-5 py-5 text-center">
          <span className={`font-condensed font-extrabold text-[44px] leading-none tabular-nums
                            ${!bridge?.is_live ? "text-white/25"
                              : bridge.is_stable ? "text-emerald-light" : "text-white"}`}>
            {bridge?.is_live ? kg(bridge.weight_kg) : "—"}
          </span>
          <span className="block text-[10.5px] text-white/40 mt-1 uppercase tracking-[.14em]">
            kilograms, empty
          </span>
        </div>
        {vehicle.has_tare && (
          <p className="text-[12px] text-txt-muted">
            Current tare {kg(vehicle.standing_tare_kg)} kg, taken{" "}
            {vehicle.tare_age_days === null ? "at some point" : `${vehicle.tare_age_days} days ago`}.
          </p>
        )}
        {usable.length > 1 && (
          <Field label="Bridge">
            <select value={bridgeId ?? ""} onChange={(e) => setBridgeId(Number(e.target.value))}
                    className={inputClass}>
              {usable.map((b) => <option key={b.weighbridge_id} value={b.weighbridge_id}>{b.name}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/* ── The record ──────────────────────────────────────────────────────────── */
/**
 * Filtered on the things a shift actually gets asked about: which day, which
 * shift, which pit, which material, which vehicle — and the three exceptions
 * worth pulling out on their own, because "show me every load that was typed
 * in by hand" is the question an auditor opens with.
 */
function TripTable({ trips, summary, sources, categories }: {
  trips: Trip[]; summary: Record<string, number>;
  sources: MoveGroup[]; categories: Category[];
}) {
  const [q, setQ] = useState("");
  const [day, setDay] = useState("");
  const [shift, setShift] = useState("");
  const [source, setSource] = useState("");
  const [material, setMaterial] = useState("");
  const [flag, setFlag] = useState("");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return trips.filter((t) =>
      (!day || t.production_date === day)
      && (!shift || t.shift_code === shift)
      && (!source || t.source === source)
      && (!material || t.material === material)
      && (flag !== "MANUAL" || t.has_manual)
      && (flag !== "STALE" || t.tare_is_stale)
      && (flag !== "OVER" || !!t.overload_kg)
      && (flag !== "STANDING" || t.tare_source === "STANDING")
      && matchesSearch(s, [t.trip_no, t.vehicle, t.fleet_code, t.driver,
                           t.material, t.source, t.destination]));
  }, [trips, q, day, shift, source, material, flag]);

  const net = rows.reduce((a, t) => a + (t.net_kg ?? 0), 0) / 1000;
  const filtered = rows.length !== trips.length;
  const clear = () => { setQ(""); setDay(""); setShift(""); setSource(""); setMaterial(""); setFlag(""); };

  // Every place a load can come from, flattened out of the source groups.
  const sourcePlaces = useMemo(
    () => sources.flatMap((g) => g.places.map((pl) => ({ ...pl, group: g.name }))),
    [sources]);
  const materialNames = useMemo(
    () => categories.flatMap((c) => c.materials.map((m) => `${c.name} · ${m.name}`)),
    [categories]);

  return (
    <Card>
      <CardHeader
        title="Trips" tone="indigo" icon={ArrowRight}
        subtitle={`${rows.length}${filtered ? ` of ${trips.length}` : ""} trips · `
                  + `${net.toFixed(1)} t net`
                  + (summary.stale_tare ? ` · ${summary.stale_tare} on a stale tare` : "")}
        actions={filtered
          ? <Button size="sm" onClick={clear}><X className="w-3.5 h-3.5" /> Clear filters</Button>
          : undefined}
      />

      <div className="px-4 py-3 border-b border-border-light flex flex-wrap gap-2">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
               className={`${inputClass} w-[150px]`} />
        <select value={shift} onChange={(e) => setShift(e.target.value)}
                className={`${inputClass} w-[120px]`}>
          <option value="">Every shift</option>
          <option value="A">Shift A</option><option value="B">Shift B</option>
          <option value="C">Shift C</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}
                className={`${inputClass} w-[180px]`}>
          <option value="">Every source</option>
          {sourcePlaces.map((l) =>
            <option key={l.location_id} value={l.name}>{l.group} — {l.name}</option>)}
        </select>
        <select value={material} onChange={(e) => setMaterial(e.target.value)}
                className={`${inputClass} w-[190px]`}>
          <option value="">Every material</option>
          {materialNames.map((n) => {
            const name = n.split(" · ")[1];
            return <option key={n} value={name}>{n}</option>;
          })}
        </select>
        <select value={flag} onChange={(e) => setFlag(e.target.value)}
                className={`${inputClass} w-[210px]`}>
          <option value="">Everything</option>
          <option value="MANUAL">Typed by hand only</option>
          <option value="STALE">On a stale tare only</option>
          <option value="STANDING">On a standing tare only</option>
          <option value="OVER">Over capacity only</option>
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Trip, vehicle, driver" className={`${inputClass} pl-8`} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px]">
          <thead><tr>
            <Th>Trip</Th><Th>Vehicle</Th><Th>Driver</Th><Th>Material</Th>
            <Th>From → to</Th>
            <Th className="text-right">Gross</Th><Th className="text-right">Tare</Th>
            <Th className="text-right">Net</Th><Th>Flags</Th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={9}>
                {trips.length === 0 ? "No trips recorded yet." : "Nothing matches those filters."}
              </EmptyRow>
            )}
            {rows.map((t) => (
              <tr key={t.trip_id} className="hover:bg-bg-section">
                <Td>
                  <span className="font-semibold tabular-nums text-txt-primary">{t.trip_no}</span>
                  <span className="block text-[11px] text-txt-light">
                    {t.production_date}{t.shift_code ? ` · shift ${t.shift_code}` : ""}
                  </span>
                </Td>
                <Td>
                  <span className="text-txt-primary">{t.vehicle ?? "—"}</span>
                  {t.fleet_code && <span className="block text-[11px] text-txt-light">{t.fleet_code}</span>}
                </Td>
                <Td>
                  {t.driver ?? "—"}
                  {t.driver_is_visitor && (
                    <span className="block text-[10px] text-txt-light">one-time driver</span>
                  )}
                </Td>
                <Td>{t.material ?? "—"}</Td>
                <Td className="text-[11.5px]">
                  {t.source || t.destination ? `${t.source ?? "?"} → ${t.destination ?? "?"}` : "—"}
                </Td>
                <Td className="text-right tabular-nums">{kg(t.gross_kg)}</Td>
                <Td className="text-right tabular-nums">
                  {kg(t.tare_kg)}
                  {t.tare_source === "STANDING" && (
                    <span className="block text-[10px] text-txt-light">standing</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums font-semibold text-navy">{kg(t.net_kg)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {t.has_manual && <Chip tone="rose" dot={false}>typed</Chip>}
                    {t.tare_is_stale && <Chip tone="amber" dot={false}>tare {t.tare_age_days}d</Chip>}
                    {t.overload_kg ? <Chip tone="rose" dot={false}>over</Chip> : null}
                    {t.status === "CANCELLED" && <Chip tone="slate">cancelled</Chip>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── Bridges and agents ──────────────────────────────────────────────────── */
function BridgesAndAgents({ bridges, agents, mayManage, onChanged, onError }: {
  bridges: Bridge[];
  agents: { agent_id: number; machine_name: string; bridge: string; watch_path: string;
            is_up: boolean; seconds_since_seen: number | null; readings_last_hour: number;
            last_error: string | null; status: string; version: string | null }[];
  mayManage: boolean; onChanged: (m: string) => void; onError: (m: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Agents" tone="teal" icon={Radio}
          subtitle="One per weighbridge PC. It reads the indicator's file and sends what it sees."
          actions={mayManage
            ? <Button size="sm" onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5" /> Register a PC</Button>
            : undefined}
        />
        <table className="w-full">
          <thead><tr>
            <Th>PC</Th><Th>Bridge</Th><Th>Watching</Th><Th>Last heard</Th>
            <Th className="text-right">Readings / hr</Th><Th>State</Th>
          </tr></thead>
          <tbody>
            {agents.length === 0 && (
              <EmptyRow colSpan={6}>
                No agent registered. Register the weighbridge PC here, then put the
                token it gives you into wbagent.ini on that machine.
              </EmptyRow>
            )}
            {agents.map((a) => (
              <tr key={a.agent_id}>
                <Td><span className="font-semibold text-txt-primary">{a.machine_name}</span>
                    {a.version && <span className="block text-[11px] text-txt-light">v{a.version}</span>}</Td>
                <Td>{a.bridge}</Td>
                <Td className="font-mono text-[11.5px]">{a.watch_path}</Td>
                <Td className="tabular-nums">{ago(a.seconds_since_seen)}</Td>
                <Td className="text-right tabular-nums">{a.readings_last_hour}</Td>
                <Td>
                  {a.status !== "ACTIVE" ? <Chip tone="slate">disabled</Chip>
                    : a.is_up ? <Chip tone="emerald">up</Chip> : <Chip tone="rose">silent</Chip>}
                  {a.last_error && <span className="block text-[11px] text-rose mt-1">{a.last_error}</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardHeader title="Bridges" tone="gold" icon={Scale} />
        <table className="w-full">
          <thead><tr>
            <Th>Code</Th><Th>Name</Th><Th className="text-right">Capacity</Th>
            <Th>Stamp due</Th><Th>State</Th>
          </tr></thead>
          <tbody>
            {bridges.map((b) => (
              <tr key={b.weighbridge_id}>
                <Td><span className="font-semibold text-txt-primary">{b.code}</span></Td>
                <Td>{b.name}</Td>
                <Td className="text-right tabular-nums">{b.capacity_kg ? kg(b.capacity_kg) : "—"}</Td>
                <Td className="tabular-nums">{b.verification_due_on ?? "not recorded"}</Td>
                <Td><Chip tone={b.status === "ACTIVE" ? "emerald" : "amber"}>{b.status.toLowerCase()}</Chip></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {adding && (
        <RegisterAgent bridges={bridges} onClose={() => setAdding(false)}
          onIssued={(t) => { setAdding(false); setIssued(t); onChanged("Agent registered."); }}
          onError={onError} />
      )}
      {issued && (
        <Dialog open tone="warning" title="The agent's token"
                confirmLabel="I have copied it" cancelLabel="Close"
                onCancel={() => setIssued(null)} onConfirm={() => setIssued(null)}>
          <div className="space-y-3">
            <Alert tone="warning">
              Shown once, and stored nowhere it can be read back. Copy it into
              wbagent.ini on the weighbridge PC now.
            </Alert>
            <pre className="bg-bg-section rounded-lg p-3 text-[12px] font-mono break-all whitespace-pre-wrap">
              {issued}
            </pre>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function RegisterAgent({ bridges, onClose, onIssued, onError }: {
  bridges: Bridge[]; onClose: () => void;
  onIssued: (token: string) => void; onError: (m: string) => void;
}) {
  const [machine, setMachine] = useState("");
  const [bridgeId, setBridgeId] = useState<number | null>(bridges[0]?.weighbridge_id ?? null);
  const [path, setPath] = useState("C:\\WB3\\wbdata.txt");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!bridgeId) return;
    setBusy(true);
    try {
      const r = await api.post("/weighbridge/agents", {
        machine_name: machine.trim(), weighbridge_id: bridgeId, watch_path: path.trim(),
      });
      onIssued(r.data?.token ?? "");
    } catch (e) { onError(errorOf(e, "Could not register that PC.")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open tone="info" title="Register a weighbridge PC" confirmLabel="Issue a token"
            onCancel={onClose} onConfirm={() => void save()}
            busy={busy || !machine.trim() || !path.trim() || !bridgeId}>
      <div className="space-y-3.5">
        <Field label="PC name" required>
          <input value={machine} onChange={(e) => setMachine(e.target.value)}
                 className={inputClass} autoFocus />
        </Field>
        <Field label="Bridge" required>
          <select value={bridgeId ?? ""} onChange={(e) => setBridgeId(Number(e.target.value))}
                  className={inputClass}>
            {bridges.map((b) => <option key={b.weighbridge_id} value={b.weighbridge_id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="File the indicator writes" required
               hint="The same file SAP GUI asks permission to read. The agent only reads it.">
          <input value={path} onChange={(e) => setPath(e.target.value)}
                 className={`${inputClass} font-mono`} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ── Choices as buttons, never as a dropdown ─────────────────────────────── */
/**
 * Every choice on the capture screen is a button, including the second-level
 * ones — which pit face, which dump yard.
 *
 * A dropdown costs two taps and hides its options until the first one. A row
 * of buttons costs one tap and shows everything, which is what a weighbridge
 * operator needs standing up with a truck on the deck. None of these lists is
 * longer than six, so none of them earns the dropdown's compactness.
 */
function Choices({ label, options, value, onChange, required, hint, tone = "navy" }: {
  label: string;
  options: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number) => void;
  required?: boolean;
  hint?: string;
  tone?: "navy" | "gold";
}) {
  const on = tone === "gold"
    ? "bg-gold text-navy border-gold shadow-sm"
    : "bg-navy text-white border-navy shadow-sm";
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[11px] font-semibold text-txt-secondary">
          {label}{required && <span className="text-rose ml-0.5">*</span>}
        </span>
        {hint && <span className="text-[10.5px] text-txt-light">{hint}</span>}
      </div>
      {options.length === 0 ? (
        <p className="text-[11.5px] text-amber py-1">
          Nothing set up — add one under Customise lists.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const picked = o.id === value;
            return (
              <button key={o.id} type="button" onClick={() => onChange(o.id)}
                className={`px-3 py-2 rounded-lg text-[12.5px] font-semibold border
                            transition-all duration-100 leading-none
                            ${picked ? on
                              : "bg-bg-base text-txt-secondary border-border "
                                + "hover:border-gold hover:text-navy"}`}>
                {o.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Customising the lists ───────────────────────────────────────────────── */
/**
 * Everything the capture screen offers is a row, and this is where the rows
 * are kept. A new dump yard or a new COB fraction is added here and appears at
 * the bridge on the next load — no code change, no deployment.
 *
 * Entries are retired, never deleted. A material that disappears takes every
 * past trip's description with it; one marked inactive stops being offered and
 * leaves the record readable. Where something has already been used, the count
 * is shown so nobody retires it without knowing.
 */
interface MasterRow {
  code: string; name: string; status: string; sort_order: number;
  used_by_trips?: number; material_count?: number; place_count?: number;
  category?: string | null; group_name?: string | null;
  material_category_id?: number; movement_group_id?: number;
  material_id?: number; location_id?: number;
  is_source?: boolean; is_destination?: boolean;
}

function Customise({ mayEdit, onChanged, onError }: {
  mayEdit: boolean; onChanged: (m: string) => void; onError: (m: string) => void;
}) {
  const [data, setData] = useState<{
    categories: MasterRow[]; materials: MasterRow[];
    groups: MasterRow[]; places: MasterRow[];
  } | null>(null);
  const [adding, setAdding] = useState<null | "categories" | "materials" | "groups" | "places">(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/weighbridge/masters/all");
      setData(r.data);
    } catch (e) { onError(errorOf(e, "Could not load the lists.")); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (kind: string, id: number, name: string, to: string) => {
    setBusy(true);
    try {
      await api.patch(`/weighbridge/masters/${kind}/${id}`, { status: to });
      onChanged(`${name} ${to === "ACTIVE" ? "brought back" : "retired"}.`);
      await load();
    } catch (e) { onError(errorOf(e, "Could not change that.")); }
    finally { setBusy(false); }
  };

  if (!data) {
    return <Card><div className="py-16 flex items-center justify-center gap-2 text-txt-light text-[13px]">
      <Loader2 className="w-4 h-4 animate-spin" /> Reading the lists…
    </div></Card>;
  }

  const section = (
    title: string, subtitle: string, kind: "categories" | "materials" | "groups" | "places",
    rows: MasterRow[], idKey: keyof MasterRow, extra: (r: MasterRow) => React.ReactNode,
  ) => (
    <Card>
      <CardHeader
        title={title} subtitle={subtitle} tone="violet" icon={SlidersHorizontal}
        actions={mayEdit
          ? <Button size="sm" onClick={() => setAdding(kind)}><Plus className="w-3.5 h-3.5" /> Add</Button>
          : undefined}
      />
      <table className="w-full">
        <thead><tr><Th>Name</Th><Th>Code</Th><Th></Th><Th>Used</Th><Th>State</Th><Th></Th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={6}>Nothing yet.</EmptyRow>}
          {rows.map((r) => {
            const id = r[idKey] as number;
            const live = r.status === "ACTIVE";
            return (
              <tr key={`${kind}-${id}`} className={live ? "" : "opacity-55"}>
                <Td><span className="font-semibold text-txt-primary">{r.name}</span></Td>
                <Td className="font-mono text-[11.5px] text-txt-light">{r.code}</Td>
                <Td className="text-[11.5px]">{extra(r)}</Td>
                <Td className="tabular-nums text-[11.5px]">
                  {r.used_by_trips ? `${r.used_by_trips} trips` : "—"}
                </Td>
                <Td><Chip tone={live ? "emerald" : "slate"}>{live ? "in use" : "retired"}</Chip></Td>
                <Td>
                  {mayEdit && (
                    <div className="flex justify-end">
                      <Button size="sm" disabled={busy}
                              onClick={() => void toggle(kind, id, r.name, live ? "INACTIVE" : "ACTIVE")}>
                        {live ? "Retire" : "Bring back"}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );

  return (
    <div className="space-y-4">
      {!mayEdit && (
        <Alert tone="info">
          You can see these lists but not change them. Adding a material type or
          a dump yard changes what every operator records from then on, so it
          needs the &lsquo;Change the weighbridge lists&rsquo; permission.
        </Alert>
      )}

      {section("Categories", "The radio buttons on the capture screen.", "categories",
               data.categories, "material_category_id",
               (r) => `${r.material_count ?? 0} material types`)}

      {section("Material types", "What each category offers.", "materials",
               data.materials, "material_id",
               (r) => r.category ?? <span className="text-amber">no category — not offered</span>)}

      {section("Source & destination types", "The radio buttons for where a load came from and went.",
               "groups", data.groups, "movement_group_id",
               (r) => [r.is_source ? "source" : null, r.is_destination ? "destination" : null]
                        .filter(Boolean).join(" + ") + ` · ${r.place_count ?? 0} places`)}

      {section("Places", "Pit faces, stockpiles, dump yards, plots.", "places",
               data.places, "location_id",
               (r) => r.group_name ?? <span className="text-amber">not in a group — not offered</span>)}

      {adding && (
        <AddMaster kind={adding} data={data} onClose={() => setAdding(null)}
          onDone={(m) => { setAdding(null); onChanged(m); void load(); }} onError={onError} />
      )}
    </div>
  );
}

function AddMaster({ kind, data, onClose, onDone, onError }: {
  kind: "categories" | "materials" | "groups" | "places";
  data: { categories: MasterRow[]; groups: MasterRow[] };
  onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [isSource, setIsSource] = useState(true);
  const [isDest, setIsDest] = useState(false);
  const [busy, setBusy] = useState(false);

  const TITLE = {
    categories: "New category", materials: "New material type",
    groups: "New source or destination type", places: "New place",
  }[kind];

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (kind === "materials") body.material_category_id = Number(parent);
      if (kind === "places") body.movement_group_id = Number(parent);
      if (kind === "groups") { body.is_source = isSource; body.is_destination = isDest; }
      await api.post(`/weighbridge/masters/${kind}`, body);
      onDone(`${name.trim()} added — it is offered at the bridge from the next load.`);
    } catch (e) { onError(errorOf(e, "Could not add that.")); }
    finally { setBusy(false); }
  };

  const needsParent = kind === "materials" || kind === "places";
  const parents = kind === "materials" ? data.categories : data.groups;
  const parentKey = kind === "materials" ? "material_category_id" : "movement_group_id";

  return (
    <Dialog open tone="info" title={TITLE} confirmLabel="Add" onCancel={onClose}
            onConfirm={() => void save()}
            busy={busy || !name.trim() || (needsParent && !parent)
                  || (kind === "groups" && !isSource && !isDest)}>
      <div className="space-y-3.5">
        <Field label="Name" required hint="What the operator will see. The code is generated.">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
        </Field>

        {needsParent && (
          <Field label={kind === "materials" ? "Category" : "Source or destination type"} required>
            <select value={parent} onChange={(e) => setParent(e.target.value)} className={inputClass}>
              <option value="">Choose…</option>
              {parents.filter((r) => r.status === "ACTIVE").map((r) => (
                <option key={r[parentKey] as number} value={r[parentKey] as number}>{r.name}</option>
              ))}
            </select>
          </Field>
        )}

        {kind === "groups" && (
          <Field label="Loads can" required hint="A dump yard is usually both.">
            <div className="flex gap-4 pt-1">
              <label className="flex items-center gap-2 text-[12.5px] text-txt-secondary">
                <input type="checkbox" checked={isSource} onChange={(e) => setIsSource(e.target.checked)} />
                come from here
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-txt-secondary">
                <input type="checkbox" checked={isDest} onChange={(e) => setIsDest(e.target.checked)} />
                go to here
              </label>
            </div>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
