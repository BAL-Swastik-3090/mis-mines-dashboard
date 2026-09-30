"use client";

/* Fuel Control — the comparison nobody was making.
 *
 * Litres booked to machines against what the pump totaliser says it
 * dispensed. In September three of the four issuing points agreed to within a
 * litre and one was out by 2,154 — and the evidence sat in the workbook all
 * month, because checking it by hand across four sheets of 190 rows is not a
 * thing a person does.
 *
 * Nothing on this screen concludes anything. A gap is a question, shown as a
 * question, with somewhere to write the answer. There are a dozen honest
 * reasons for one — a misread digit, an entry made the next morning, a
 * transfer booked on one side — and the screen must never imply otherwise.
 *
 * SAP is deliberately absent. It keeps procurement and posts late; linking
 * the two is a later job, and a figure here must not be mistaken for a figure
 * in the ledger.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gauge, Fuel, WifiOff, ClipboardList, Settings2, Truck,
         ClipboardCheck, BookOpen, TrendingDown, Scale } from "lucide-react";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import { Card, CardHeader, Th, Td, EmptyRow, Chip, Button, Field,
         inputClass, Alert, SortTh, sortRows, Tabs } from "@/components/minehub/ui";
import type { SortWay } from "@/components/minehub/ui";
import { IssuePanel, MachineMeterPanel, DayBookPanel,
         ChainPanel } from "./FuelCapture";
import type { FillTarget } from "./FuelCapture";
import { TankerPanel, TankerListPanel, OrdersPanel } from "./FuelErp";
import type { PendingOrder } from "./FuelErp";

/* ── what the endpoints return ───────────────────────────────────────── */
interface Point {
  issuing_point_id: number; code: string; label: string; kind: string;
  has_totaliser: boolean; booked_l: number; issues: number;
  totaliser_l: number | null; gap_l: number | null; gap_flagged: boolean;
  readings: number; suspect_readings: number;
  receipts_l: number; transfer_in_l: number; transfer_out_l: number;
  why_no_gap: string | null;
}
interface Consumer {
  consumer_id: number; code: string; label: string; kind: string;
  asset_id: number | null; meter_kind: "HMR" | "KM" | "NONE";
  capture_mode: "A" | "B" | "C"; tank_capacity_l: number | null;
  is_active: boolean; asset_type: string | null; fleet_code: string | null;
  sensor_name: string | null; register_name: string | null;
}
interface Overview {
  from: string; to: string; days: number;
  points: Point[];
  headline: {
    booked_l: number; receipts_l: number; transfers_l: number; issues: number;
    points_reconciled: number; points_flagged: number; points_unchecked: number;
  };
  coverage: {
    active_consumers: number; on_register: number; manual_capture: number;
    no_meter_kind: number; sensor_mapped: number; sensor_unmapped: number;
  };
  silent_sensors: { sensor_name: string; last_seen: string; days: number }[];
  open_exceptions: Record<string, number>;
}
interface Masters {
  points: { issuing_point_id: number; code: string; label: string;
            kind: string; has_totaliser: boolean; is_active: boolean }[];
  nozzles: { nozzle_id: number; issuing_point_id: number; code: string;
             label: string; kind: "FIXED" | "MOBILE"; is_active: boolean }[];
  consumers: Consumer[];
  tolerances: { scope: string; pct: number | null; absolute_l: number | null;
                is_active: boolean; note: string | null }[];
  can_record: boolean; can_manage: boolean;
}

const L = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const CAPTURE: Record<string, string> = {
  A: "sensor + dispenser", B: "dispenser + typed meter", C: "by hand",
};

type Stage = "receipts" | "orders" | "issue" | "daybook" | "reconcile"
           | "intelligence" | "masters";

/* In the order the work happens: diesel arrives, somebody asks for it, it
 * goes into a machine, and only then is there anything to reconcile or
 * reason about. */
const STAGES: { id: Stage; label: string; icon: React.ElementType }[] = [
  { id: "receipts",     label: "Deliveries",     icon: Truck },
  { id: "orders",       label: "Orders",         icon: ClipboardCheck },
  { id: "issue",        label: "Issue fuel",     icon: Fuel },
  { id: "daybook",      label: "Day book",       icon: BookOpen },
  { id: "reconcile",    label: "Reconciliation", icon: Scale },
  { id: "intelligence", label: "Per cubic metre", icon: TrendingDown },
  { id: "masters",      label: "Machines",       icon: Settings2 },
];

export default function FuelControlSection() {
  const { apiFrom, apiTo } = useDateFilter();
  const [data, setData] = useState<Overview | null>(null);
  const [masters, setMasters] = useState<Masters | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showMasters, setShowMasters] = useState(false);
  /* Clicking Fill on a pending order carries it up to the issue form rather
   * than making somebody re-key what the order already says. */
  const [target, setTarget] = useState<FillTarget | null>(null);
  /* One page per stage. These are separate jobs done by different people at
   * different times, and seven panels on one scroll is a page nobody reads
   * to the bottom of. */
  const [stage, setStage] = useState<Stage>("receipts");
  /* Bumped when a delivery is saved, so the list below it refreshes without
   * reloading the masters the forms are built from. */
  const [savedTick, setSavedTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { day_from: apiFrom, day_to: apiTo };
      const [o, m] = await Promise.all([
        api.get<Overview>("/fuel-control/overview", { params }),
        api.get<Masters>("/fuel-control/masters"),
      ]);
      setData(o.data); setMasters(m.data); setErr(null);
    } catch (e) {
      /* A request the browser abandoned is not a failure of ours — switching
       * tab mid-flight aborts it and painting an error over a working screen
       * sends the next person looking in the wrong place. */
      const x = e as { code?: string; message?: string;
                       response?: { data?: { detail?: string } } };
      const aborted = x?.code === "ERR_CANCELED" || x?.code === "ECONNABORTED"
        || /abort|cancel/i.test(x?.message ?? "");
      if (!aborted) setErr(x?.response?.data?.detail ?? "Could not read the fuel records.");
    } finally { setLoading(false); }
  }, [apiFrom, apiTo]);

  useEffect(() => { void load(); }, [load]);

  const write = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote(null);
    try { await fn(); setNote(ok); await load(); }
    catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setNote(d ?? "That did not save.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {err && <Alert tone="error">{err}</Alert>}
      {note && <Alert tone="info">{note}</Alert>}

      {/* One page per stage, in the order the work happens. */}
      <Tabs tabs={STAGES} value={stage} onChange={setStage} />

      {/* ── a tanker arrives ─────────────────────────────────────────── */}
      {stage === "receipts" && (
        <>
          {masters?.can_record && (
            <TankerPanel points={masters.points} busy={busy} write={write}
              onSaved={() => setSavedTick((t) => t + 1)} />
          )}
          <TankerListPanel apiFrom={apiFrom} apiTo={apiTo}
            canRecord={!!masters?.can_record} busy={busy} write={write}
            reload={savedTick} />
        </>
      )}

      {/* ── an order is raised, then filled ──────────────────────────── */}
      {stage === "orders" && masters?.can_record && (
        <OrdersPanel points={masters.points} nozzles={masters.nozzles}
          consumers={masters.consumers} busy={busy} write={write}
          onPick={(o: PendingOrder) => {
            setTarget({
              order_id: o.order_id, order_no: o.order_no,
              consumer_id: o.consumer_id, outstanding_l: o.outstanding_l,
              issuing_point_id: null,
            });
            setStage("issue");
          }} />
      )}
      {stage === "orders" && !masters?.can_record && (
        <Alert tone="info">
          Raising orders needs the fuel recording permission.
        </Alert>
      )}

      {/* ── fuel goes in ─────────────────────────────────────────────── */}
      {stage === "issue" && masters?.can_record && (
        <>
          {target && (
            <p className="text-[11px] text-txt-muted flex items-center gap-2">
              <span>
                Filling against <strong className="text-navy">{target.order_no}</strong>.
              </span>
              <button type="button" onClick={() => setTarget(null)}
                className="underline text-txt-light hover:text-navy">
                book a fill with no order instead
              </button>
            </p>
          )}
          <IssuePanel points={masters.points} nozzles={masters.nozzles}
            consumers={masters.consumers} busy={busy} write={write}
            target={target} />
          <MachineMeterPanel consumers={masters.consumers} busy={busy}
            write={write} />
        </>
      )}
      {stage === "issue" && !masters?.can_record && (
        <Alert tone="info">
          Booking issues needs the fuel recording permission.
        </Alert>
      )}

      {/* ── what the portal captured ─────────────────────────────────── */}
      {stage === "daybook" && <DayBookPanel />}

      {/* ── does it reconcile ────────────────────────────────────────── */}
      {stage === "reconcile" && (
        <>
          <ReconcilePanel data={data} loading={loading} />
          {masters?.can_record && (
            <RecordPanel masters={masters} busy={busy} write={write} />
          )}
          <CoveragePanel data={data} />
        </>
      )}

      {/* ── a litre, and the rock it moved ───────────────────────────── */}
      {stage === "intelligence" && <ChainPanel apiFrom={apiFrom} apiTo={apiTo} />}

      {/* ── the masters, because none of this is constant ────────────── */}
      {stage === "masters" && (
        <Card>
          <CardHeader icon={Settings2} tone="violet" subtitleOnIcon
            title="Machines, meters and names"
            subtitle="What each machine is measured in, how its fuel is captured, and what the other systems call it. All of it editable — a fleet that can only be changed by a developer is a fleet that goes stale."
            actions={
              <Button variant="secondary" size="sm"
                onClick={() => setShowMasters((v) => !v)}>
                {showMasters ? "Hide" : `Show ${masters?.consumers.length ?? 0}`}
              </Button>
            } />
          {showMasters && masters && (
            <ConsumerTable masters={masters} busy={busy} write={write} />
          )}
        </Card>
      )}
</div>
  );
}

/* ── recording: two numbers and a timestamp ──────────────────────────── */
function RecordPanel({ masters, busy, write }: {
  masters: Masters;
  busy: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [pid, setPid] = useState<number | "">("");
  const [on, setOn] = useState(today);
  const [shift, setShift] = useState("GEN");
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [paper, setPaper] = useState("");

  /* Warned, never blocked. Security has kept these readings in a notebook for
   * years and that notebook is the only independent check the mine has; a form
   * that refuses a figure means the notebook wins and we get nothing. */
  const backwards = opening !== "" && closing !== ""
    && Number(closing) < Number(opening);

  const submit = () =>
    write(() => api.post("/fuel-control/meter-reading", {
      issuing_point_id: pid, on_date: on, shift,
      opening_reading: opening === "" ? null : Number(opening),
      closing_reading: closing === "" ? null : Number(closing),
      paper_ref: paper || null,
    }), backwards
      ? "Recorded, and flagged for somebody to look at."
      : "Reading recorded.");

  return (
    <Card>
      <CardHeader icon={ClipboardList} tone="sky" subtitleOnIcon
        title="Record a pump reading"
        subtitle="Opening and closing on the totaliser, per shift. The paper notebook stays — this is a second copy, taken while the person who read the meter is still standing there." />
      <div className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
        <Field label="Issuing point" required>
          <select value={pid} disabled={busy} className={inputClass}
            onChange={(e) => setPid(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose…</option>
            {masters.points.filter((p) => p.is_active && p.has_totaliser).map((p) => (
              <option key={p.issuing_point_id} value={p.issuing_point_id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" value={on} disabled={busy} className={inputClass}
            onChange={(e) => setOn(e.target.value)} />
        </Field>
        <Field label="Shift">
          <select value={shift} disabled={busy} className={inputClass}
            onChange={(e) => setShift(e.target.value)}>
            {["GEN", "A", "B", "C"].map((s) => (
              <option key={s} value={s}>{s === "GEN" ? "Whole day" : `Shift ${s}`}</option>
            ))}
          </select>
        </Field>
        <Field label="Opening">
          <input type="number" step="0.01" value={opening} disabled={busy}
            className={inputClass} placeholder="totaliser"
            onChange={(e) => setOpening(e.target.value)} />
        </Field>
        <Field label="Closing">
          <input type="number" step="0.01" value={closing} disabled={busy}
            className={`${inputClass} ${backwards ? "border-amber" : ""}`}
            placeholder="totaliser"
            onChange={(e) => setClosing(e.target.value)} />
        </Field>
        <Field label="Notebook page" hint="so the paper and this can be tied together">
          <input value={paper} disabled={busy} className={inputClass}
            placeholder="optional"
            onChange={(e) => setPaper(e.target.value)} />
        </Field>
      </div>
      {backwards && (
        <div className="px-3 pb-2">
          <Alert tone="warning">
            The closing reading is below the opening. That is usually a slip of
            the pen, and occasionally a meter that has been replaced — either
            way it will be saved and flagged for somebody to look at, not
            refused.
          </Alert>
        </div>
      )}
      <div className="px-3 pb-3 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={busy || !pid || (!opening && !closing)}
          onClick={submit}>
          <Fuel className="w-3.5 h-3.5" /> Record reading
        </Button>
        <span className="text-[10.5px] text-txt-light">
          Both readings are optional on their own — one now and one at the end
          of the shift is how it is actually read.
        </span>
      </div>
    </Card>
  );
}

/* ── the fleet, and what everything else calls it ────────────────────── */
function ConsumerTable({ masters, busy, write }: {
  masters: Masters;
  busy: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [key, setKey] = useState<keyof Consumer | null>("code");
  const [dir, setDir] = useState<SortWay | null>("asc");
  const [onlyGaps, setOnlyGaps] = useState(false);

  const rows = useMemo(() => {
    const base = onlyGaps
      ? masters.consumers.filter((c) => c.is_active && !c.sensor_name)
      : masters.consumers;
    return sortRows(base, key, dir);
  }, [masters.consumers, key, dir, onlyGaps]);

  const sort = (k: keyof Consumer) => {
    if (key !== k) { setKey(k); setDir("asc"); return; }
    setDir(dir === "asc" ? "desc" : dir === "desc" ? null : "asc");
    if (dir === "desc") setKey(null);
  };

  return (
    <>
      <div className="px-3 py-2 border-b border-border-light flex items-center gap-2">
        <Button variant={onlyGaps ? "primary" : "secondary"} size="sm"
          onClick={() => setOnlyGaps((v) => !v)}>
          {onlyGaps ? "Showing unmapped only" : "Show unmapped only"}
        </Button>
        <span className="text-[10.5px] text-txt-light">
          {rows.length} of {masters.consumers.length}
        </span>
      </div>
      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 bg-white z-10">
            <tr>
              <SortTh active={key === "code"} dir={dir ?? undefined}
                onSort={() => sort("code")}>
                Machine
              </SortTh>
              <SortTh active={key === "asset_type"} dir={dir ?? undefined}
                onSort={() => sort("asset_type")}>
                Type
              </SortTh>
              <Th>Measured in</Th>
              <Th>How fuel is captured</Th>
              <Th>Fuel sensor calls it</Th>
              <Th>Diesel register calls it</Th>
              <Th className="text-right">In use</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={7}>Nothing to show.</EmptyRow>}
            {rows.map((c) => (
              <tr key={c.consumer_id}
                className={`border-t border-border-light hover:bg-bg-soft/50 ${
                  c.is_active ? "" : "opacity-55"}`}>
                <Td>
                  <span className="font-semibold text-navy">{c.code}</span>
                  {c.label !== c.code && (
                    <span className="block text-[10px] text-txt-light truncate max-w-[200px]">
                      {c.label}
                    </span>
                  )}
                  {c.kind !== "ASSET" && (
                    <Chip tone="slate" dot={false}>
                      {c.kind === "FIXTURE" ? "fixture" : "cost head"}
                    </Chip>
                  )}
                </Td>
                <Td className="text-[11.5px] text-txt-muted">{c.asset_type ?? "—"}</Td>
                {/* The one that matters most. The register says HOURS for all
                    97 machines including the ambulance, so anything still on
                    the seeded value is a guess until somebody confirms it. */}
                <Td>
                  <select value={c.meter_kind} disabled={busy || !masters.can_manage}
                    className={`${inputClass} w-[92px] py-1 text-[11.5px]`}
                    title="Litres per hour on a machine measured in kilometres is not a smaller error than a missing figure."
                    onChange={(e) => void write(
                      () => api.put(`/fuel-control/consumer/${c.consumer_id}`,
                        { meter_kind: e.target.value }),
                      `${c.code} is now measured in ${
                        e.target.value === "HMR" ? "hours" :
                        e.target.value === "KM" ? "kilometres" : "nothing"}.`)}>
                    <option value="HMR">hours</option>
                    <option value="KM">kilometres</option>
                    <option value="NONE">neither</option>
                  </select>
                </Td>
                <Td>
                  <select value={c.capture_mode} disabled={busy || !masters.can_manage}
                    className={`${inputClass} w-[168px] py-1 text-[11.5px]`}
                    onChange={(e) => void write(
                      () => api.put(`/fuel-control/consumer/${c.consumer_id}`,
                        { capture_mode: e.target.value }),
                      `${c.code}: ${CAPTURE[e.target.value]}.`)}>
                    {(["C", "B", "A"] as const).map((m) => (
                      <option key={m} value={m}>{CAPTURE[m]}</option>
                    ))}
                  </select>
                </Td>
                <IdentityCell consumer={c} system="FUEL_SENSOR"
                  value={c.sensor_name} busy={busy}
                  canEdit={masters.can_manage} write={write} />
                <IdentityCell consumer={c} system="FUEL_REGISTER"
                  value={c.register_name} busy={busy}
                  canEdit={masters.can_manage} write={write} />
                <Td className="text-right">
                  <Chip tone={c.is_active ? "emerald" : "slate"}>
                    {c.is_active ? "yes" : "no"}
                  </Chip>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* One machine, five names. Typed once by somebody who knows the machines,
 * because matching on a cleaned-up string guesses wrong silently. */
function IdentityCell({ consumer, system, value, busy, canEdit, write }: {
  consumer: Consumer;
  system: "FUEL_SENSOR" | "FUEL_REGISTER";
  value: string | null;
  busy: boolean;
  canEdit: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  return (
    <Td>
      <input defaultValue={value ?? ""} disabled={busy || !canEdit || !consumer.asset_id}
        placeholder={consumer.asset_id ? "not mapped" : "not a machine"}
        title={system === "FUEL_SENSOR"
          ? "The name the Technoton feed uses, e.g. BAL_Z AXIS 470-2(Excavator)"
          : "What the diesel register writes on the row — a plate, or something like PC - 200"}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v === (value ?? "")) return;
          void write(
            () => api.put(`/fuel-control/identity/${consumer.consumer_id}`,
              { system, external_code: v }),
            v ? `${consumer.code} is also known as ${v}.`
              : `Cleared that name for ${consumer.code}.`);
        }}
        className={`${inputClass} w-[190px] py-1 text-[11px] font-mono ${
          value ? "" : "placeholder:text-txt-light"}`} />
    </Td>
  );
}


/* ── does the pump agree with the register ───────────────────────────── */
function ReconcilePanel({ data, loading }: {
  data: Overview | null; loading: boolean;
}) {
  return (
    <Card>
      <CardHeader icon={Gauge} tone="gold" subtitleOnIcon
        title="Issued against the pump"
        subtitle="What was booked to machines, against what the totaliser says was dispensed. The gap is a question, not a finding — a misread digit, a late entry or a transfer booked on one side will all show here."
        actions={
          <span className="flex items-center gap-2 text-[11px] text-txt-muted">
            {data && (
              <>
                <Chip tone="emerald">{data.headline.points_reconciled} reconciled</Chip>
                {data.headline.points_flagged > 0 && (
                  <Chip tone="amber">{data.headline.points_flagged} to ask about</Chip>
                )}
                {data.headline.points_unchecked > 0 && (
                  <Chip tone="slate">{data.headline.points_unchecked} unchecked</Chip>
                )}
              </>
            )}
          </span>
        } />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr>
              <Th>Issuing point</Th>
              <Th className="text-right">Booked</Th>
              <Th className="text-right">Pump says</Th>
              <Th className="text-right">Gap</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Transferred</Th>
              <Th className="text-right">Readings</Th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <EmptyRow colSpan={7}>Reading the fuel records…</EmptyRow>}
            {data?.points.length === 0 && (
              <EmptyRow colSpan={7}>No issuing points are set up.</EmptyRow>
            )}
            {data?.points.map((p) => (
              <tr key={p.issuing_point_id}
                className={`border-t border-border-light ${
                  p.gap_flagged ? "bg-amber-bg/30" : ""}`}>
                <Td>
                  <span className="font-semibold text-navy">{p.label}</span>
                  <span className="block text-[10px] text-txt-light">
                    {p.kind.toLowerCase()} · {p.issues} issue{p.issues === 1 ? "" : "s"}
                  </span>
                </Td>
                <Td className="text-right font-mono text-[12px]">{L(p.booked_l)}</Td>
                <Td className="text-right font-mono text-[12px] text-txt-muted">
                  {L(p.totaliser_l)}
                </Td>
                <Td className="text-right">
                  {p.gap_l == null ? (
                    /* Why there is nothing to show, said plainly. A blank cell
                     * reads as "no gap", which is a different claim. */
                    <span className="text-[10.5px] text-txt-light"
                      title={p.why_no_gap ?? ""}>{p.why_no_gap}</span>
                  ) : (
                    <span className={`font-mono text-[12px] font-semibold ${
                      p.gap_flagged ? "text-amber-dark" : "text-emerald"}`}>
                      {p.gap_l > 0 ? "+" : ""}{L(p.gap_l)}
                    </span>
                  )}
                </Td>
                <Td className="text-right font-mono text-[12px] text-txt-muted">
                  {L(p.receipts_l)}
                </Td>
                <Td className="text-right font-mono text-[11.5px] text-txt-muted">
                  {p.transfer_out_l || p.transfer_in_l
                    ? `−${L(p.transfer_out_l)} / +${L(p.transfer_in_l)}`
                    : "—"}
                </Td>
                <Td className="text-right text-[11.5px] text-txt-muted">
                  {p.readings}
                  {p.suspect_readings > 0 && (
                    <span className="block text-[9.5px] text-amber"
                      title="Recorded, and flagged for review">
                      {p.suspect_readings} flagged
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── what this screen cannot see ─────────────────────────────────────── */
function CoveragePanel({ data }: { data: Overview | null }) {
  return (
    <Card>
      <CardHeader icon={WifiOff} tone="slate" subtitleOnIcon
        title="What is not covered"
        subtitle="Every screen has blind spots. These are ours, named rather than left for somebody to discover." />
      <div className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data && ([
          ["Machines drawing fuel", data.coverage.active_consumers, null],
          ["Entered by hand", data.coverage.manual_capture,
           "No metered dispenser exists yet, so every issue is typed. Each machine moves off this count as hardware arrives."],
          ["No fuel sensor mapped", data.coverage.sensor_unmapped,
           "A sensor may exist and simply not be matched to the machine yet. Mapping is done under Machines."],
          ["Nothing to measure by", data.coverage.no_meter_kind,
           "Neither an hour meter nor an odometer, so consumption cannot be worked out for these."],
        ] as [string, number, string | null][]).map(([label, n, hint]) => (
          <div key={label} className="rounded-lg bg-bg-soft px-3 py-2" title={hint ?? ""}>
            <div className="text-[18px] font-bold text-navy font-mono">{n}</div>
            <div className="text-[10.5px] text-txt-muted leading-tight">{label}</div>
          </div>
        ))}
      </div>
      {data && data.silent_sensors.length > 0 && (
        <div className="border-t border-border-light px-3 py-2">
          <p className="text-[11px] text-txt-muted mb-1.5">
            Sensors that have stopped reporting. A quiet sensor is not a machine
            that stopped working, and the two need different answers.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.silent_sensors.map((s) => (
              <Chip key={s.sensor_name} tone={s.days >= 7 ? "amber" : "slate"}
                title={`Last reported ${s.last_seen}`}>
                {s.sensor_name} · {s.days}d
              </Chip>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
