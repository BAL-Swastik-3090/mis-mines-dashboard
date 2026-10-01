"use client";

/* Capture, and the intelligence built on it.
 *
 * The portal is the record. Diesel is booked here as it is handed out, the
 * machine's meter is read here, and every figure downstream — litres per hour,
 * litres per cubic metre, cost per cubic metre — is worked out from what was
 * captured rather than transcribed from a workbook at month end.
 *
 * That is the difference that matters. A monthly return is somebody's memory
 * of a fortnight ago; this is a running record with a timestamp and a name
 * against every line.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Fuel, Gauge, BookOpen, TrendingDown, Droplets, Mountain } from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, Th, Td, EmptyRow, Chip, Button, Field,
         inputClass, Alert } from "@/components/minehub/ui";
import DateField from "@/components/minehub/DateField";

interface ConsumerLite {
  consumer_id: number; code: string; label: string;
  meter_kind: "HMR" | "KM" | "NONE"; is_active: boolean;
  asset_type: string | null;
}
interface PointLite {
  issuing_point_id: number; label: string; is_active: boolean;
}
interface NozzleLite {
  nozzle_id: number; issuing_point_id: number; code: string; label: string;
  kind: "FIXED" | "MOBILE"; is_active: boolean;
}
/* The order this fill answers, handed down when somebody clicks Fill on the
 * pending list. Null for a fill nobody indented, which happens. */
export interface FillTarget {
  order_id: number; order_no: string; consumer_id: number;
  outstanding_l: number; issuing_point_id?: number | null;
}

const L = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : n.toLocaleString("en-IN",
    { minimumFractionDigits: dp, maximumFractionDigits: dp });

/* ── booking an issue: the screen the fuel point actually uses ─────────── */
export function IssuePanel({ points, nozzles, consumers, busy, write, target }: {
  points: PointLite[];
  nozzles: NozzleLite[];
  consumers: ConsumerLite[];
  busy: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  target: FillTarget | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [pid, setPid] = useState<number | "">("");
  const [nid, setNid] = useState<number | "">("");
  const [cid, setCid] = useState<number | "">("");
  const [on, setOn] = useState(today);
  const [shift, setShift] = useState("A");
  const [litres, setLitres] = useState("");
  const [meter, setMeter] = useState("");
  const [filledAt, setFilledAt] = useState("");
  const [where, setWhere] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [receivedBy, setReceivedBy] = useState("");

  /* Clicking Fill on a pending order fills this form in rather than making
   * somebody re-type what the order already says. */
  useEffect(() => {
    if (!target) return;
    setCid(target.consumer_id);
    if (target.issuing_point_id) setPid(target.issuing_point_id);
    setLitres(String(target.outstanding_l));
  }, [target]);

  const machine = consumers.find((c) => c.consumer_id === cid);
  const forPoint = nozzles.filter(
    (n) => n.is_active && (pid === "" || n.issuing_point_id === pid));
  const nozzle = nozzles.find((n) => n.nozzle_id === nid);
  const unit = machine?.meter_kind === "KM" ? "odometer, km"
    : machine?.meter_kind === "HMR" ? "hour meter" : null;

  const submit = () =>
    write(() => api.post("/fuel-control/issue", {
      issuing_point_id: pid, nozzle_id: nid || null, consumer_id: cid,
      on_date: on, shift, litres: Number(litres),
      meter_reading: meter === "" ? null : Number(meter),
      order_id: target?.order_id ?? null,
      // Left blank, the server stamps now — right at the nozzle, wrong when
      // it is keyed in next morning, so the form offers the field.
      filled_at: filledAt || null,
      filled_location: where || null,
      issued_by: issuedBy || null, received_by: receivedBy || null,
    }), `${litres} litres booked to ${machine?.code ?? "the machine"}${
      target ? " against " + target.order_no : ""}.`)
      .then(() => { setLitres(""); setMeter(""); setWhere(""); });

  return (
    <Card>
      <CardHeader icon={Fuel} tone="gold" subtitleOnIcon
        title={target ? "Fill against " + target.order_no : "Issue diesel"}
        subtitle="Booked here as it is handed over, not written on a sheet and typed up later. The meter reading is what turns these litres into litres per hour."
        actions={target
          ? <Chip tone="amber">{L(target.outstanding_l)} L still due</Chip>
          : undefined} />
      <div className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <Field label="From" required>
          <select value={pid} disabled={busy} className={inputClass}
            onChange={(e) => { setPid(e.target.value ? Number(e.target.value) : ""); setNid(""); }}>
            <option value="">Choose…</option>
            {points.filter((p) => p.is_active).map((p) => (
              <option key={p.issuing_point_id} value={p.issuing_point_id}>{p.label}</option>
            ))}
          </select>
        </Field>
        {/* Which nozzle, because two machines filled at the same tank on the
            same shift may have come off different ones — and that is the
            first thing worth knowing when a totaliser disagrees. */}
        <Field label="Nozzle" hint={pid === "" ? "pick a point first" : undefined}>
          <select value={nid} disabled={busy || pid === ""} className={inputClass}
            onChange={(e) => setNid(e.target.value ? Number(e.target.value) : "")}>
            <option value="">not recorded</option>
            {forPoint.map((n) => (
              <option key={n.nozzle_id} value={n.nozzle_id}>{n.label}</option>
            ))}
          </select>
        </Field>
        <Field label="To which machine" required>
          <select value={cid} disabled={busy} className={inputClass}
            onChange={(e) => setCid(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose…</option>
            {consumers.filter((c) => c.is_active).map((c) => (
              <option key={c.consumer_id} value={c.consumer_id}>
                {c.code}{c.asset_type ? ` · ${c.asset_type}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Litres" required>
          <input type="number" step="0.01" min="0" value={litres} disabled={busy}
            className={inputClass} placeholder="e.g. 200"
            onChange={(e) => setLitres(e.target.value)} />
        </Field>
        <Field label={unit ? `Reading (${unit})` : "Reading"}
          hint={unit ? undefined : "this machine has no meter recorded"}>
          <input type="number" step="0.01" value={meter}
            disabled={busy || !unit} className={inputClass}
            placeholder={unit ? "at the moment of filling" : "—"}
            onChange={(e) => setMeter(e.target.value)} />
        </Field>
        <Field label="Date" required>
          <DateField value={on} onChange={setOn} disabled={busy} />
        </Field>
        <Field label="Shift">
          <select value={shift} disabled={busy} className={inputClass}
            onChange={(e) => setShift(e.target.value)}>
            {["A", "B", "C", "GEN"].map((s) => (
              <option key={s} value={s}>{s === "GEN" ? "Whole day" : `Shift ${s}`}</option>
            ))}
          </select>
        </Field>
        {/* The actual time, distinct from the production day it is booked to
            and from when somebody typed it. */}
        <Field label="Filled at" hint="blank means now">
          <input type="datetime-local" value={filledAt} disabled={busy}
            className={inputClass} onChange={(e) => setFilledAt(e.target.value)} />
        </Field>
        {nozzle?.kind === "MOBILE" && (
          <Field label="Where" hint="the tanker went to the machine">
            <input value={where} disabled={busy} className={inputClass}
              placeholder="e.g. Pit Bottom, LG Dump"
              onChange={(e) => setWhere(e.target.value)} />
          </Field>
        )}
        <Field label="Issued by">
          <input value={issuedBy} disabled={busy} className={inputClass}
            placeholder="who handed it over"
            onChange={(e) => setIssuedBy(e.target.value)} />
        </Field>
        <Field label="Received by">
          <input value={receivedBy} disabled={busy} className={inputClass}
            placeholder="who took it"
            onChange={(e) => setReceivedBy(e.target.value)} />
        </Field>
      </div>
      {machine && machine.meter_kind === "NONE" && (
        <div className="px-3 pb-2">
          <Alert tone="info">
            {machine.code} has no hour meter or odometer recorded, so this
            issue will count towards totals and cost but not towards a
            consumption rate. Set what it is measured in below and the rate
            starts working.
          </Alert>
        </div>
      )}
      <div className="px-3 pb-3">
        <Button variant="primary" size="sm"
          disabled={busy || !pid || !cid || !litres || Number(litres) <= 0}
          onClick={submit}>
          <Fuel className="w-3.5 h-3.5" /> Book this issue
        </Button>
      </div>
    </Card>
  );
}

/* ── the machine's own meter ──────────────────────────────────────────── */
export function MachineMeterPanel({ consumers, busy, write }: {
  consumers: ConsumerLite[];
  busy: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [cid, setCid] = useState<number | "">("");
  const [on, setOn] = useState(today);
  const [shift, setShift] = useState("A");
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [idle, setIdle] = useState("");
  const [bd, setBd] = useState("");

  const machine = consumers.find((c) => c.consumer_id === cid);
  const kind = machine?.meter_kind;
  const unit = kind === "KM" ? "km" : "hours";
  const backwards = opening !== "" && closing !== ""
    && Number(closing) < Number(opening);
  const worked = !backwards && opening !== "" && closing !== ""
    ? Number(closing) - Number(opening) : null;

  const submit = () =>
    write(() => api.post("/fuel-control/consumer-meter", {
      consumer_id: cid, on_date: on, shift,
      opening_reading: opening === "" ? null : Number(opening),
      closing_reading: closing === "" ? null : Number(closing),
      idle_hours: idle === "" ? null : Number(idle),
      breakdown_hours: bd === "" ? null : Number(bd),
    }), backwards ? "Recorded, and flagged for somebody to look at."
                  : "Reading recorded.")
      .then(() => { setOpening(""); setClosing(""); setIdle(""); setBd(""); });

  return (
    <Card>
      <CardHeader icon={Gauge} tone="sky" subtitleOnIcon
        title="Read a machine's meter"
        subtitle="Both readings, and the difference is worked out here. The old sheets subtracted a blank cell when a shift ended without a closing figure, and carried the negative forward all month." />
      <div className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <Field label="Machine" required>
          <select value={cid} disabled={busy} className={inputClass}
            onChange={(e) => setCid(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose…</option>
            {consumers.filter((c) => c.is_active && c.meter_kind !== "NONE").map((c) => (
              <option key={c.consumer_id} value={c.consumer_id}>
                {c.code} · {c.meter_kind === "KM" ? "km" : "hours"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" required>
          <DateField value={on} onChange={setOn} disabled={busy} />
        </Field>
        <Field label="Shift">
          <select value={shift} disabled={busy} className={inputClass}
            onChange={(e) => setShift(e.target.value)}>
            {["A", "B", "C", "GEN"].map((s) => (
              <option key={s} value={s}>{s === "GEN" ? "Whole day" : `Shift ${s}`}</option>
            ))}
          </select>
        </Field>
        <Field label={`Worked (${unit})`} hint="worked out, not typed">
          <div className="px-2 py-1.5 rounded-lg bg-bg-soft font-mono text-[13px]
                          font-semibold text-navy">
            {worked == null ? "—" : L(worked, 2)}
          </div>
        </Field>
        <Field label={`Opening (${unit})`}>
          <input type="number" step="0.01" value={opening} disabled={busy || !cid}
            className={inputClass} placeholder="start of shift"
            onChange={(e) => setOpening(e.target.value)} />
        </Field>
        <Field label={`Closing (${unit})`}>
          <input type="number" step="0.01" value={closing} disabled={busy || !cid}
            className={`${inputClass} ${backwards ? "border-amber" : ""}`}
            placeholder="end of shift"
            onChange={(e) => setClosing(e.target.value)} />
        </Field>
        <Field label="Idle hours">
          <input type="number" step="0.1" value={idle} disabled={busy || !cid}
            className={inputClass} placeholder="optional"
            onChange={(e) => setIdle(e.target.value)} />
        </Field>
        <Field label="Breakdown hours">
          <input type="number" step="0.1" value={bd} disabled={busy || !cid}
            className={inputClass} placeholder="optional"
            onChange={(e) => setBd(e.target.value)} />
        </Field>
      </div>
      {backwards && (
        <div className="px-3 pb-2">
          <Alert tone="warning">
            The closing reading is below the opening. Usually a slip of the pen,
            occasionally a meter that has been replaced — it will be saved and
            flagged for review, not refused.
          </Alert>
        </div>
      )}
      <div className="px-3 pb-3">
        <Button variant="primary" size="sm"
          disabled={busy || !cid || (!opening && !closing)} onClick={submit}>
          <Gauge className="w-3.5 h-3.5" /> Record reading
        </Button>
      </div>
    </Card>
  );
}

/* ── the day book ─────────────────────────────────────────────────────── */
interface DayBook {
  on: string;
  issues: { issue_id: number; shift: string; point: string; consumer: string;
            code: string; litres: number; meter_reading: number | null;
            meter_kind: string | null; capture_mode: string; source: string;
            issued_by: string | null; received_by: string | null;
            entered_by: string | null }[];
  meter_readings: { point: string; shift: string; opening: number | null;
                    closing: number | null; dispensed: number | null;
                    flagged: boolean; reason: string | null;
                    by: string | null; paper_ref: string | null }[];
  machine_meters: { code: string; consumer: string; shift: string;
                    meter_kind: string; opening: number | null;
                    closing: number | null; worked: number | null;
                    flagged: boolean; reason: string | null }[];
  rates: { code: string; consumer: string; litres: number; worked: number;
           meter_kind: string; per_unit: number | null }[];
  totals: { litres: number; issues: number; machines: number; flagged: number };
}

export function DayBookPanel() {
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<DayBook | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<DayBook>("/fuel-control/daybook", { params: { on: day } });
      setData(r.data);
    } catch { /* the panels above report failures; this one stays quiet */ }
    finally { setLoading(false); }
  }, [day]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader icon={BookOpen} tone="navy" subtitleOnIcon
        title="The day book"
        subtitle="Everything the portal captured on one day, with a name and a time against each line. This is the record — there is no sheet behind it."
        actions={
          <span className="flex items-center gap-2">
            {data && (
              <>
                <Chip tone="gold">{L(data.totals.litres)} L</Chip>
                <Chip tone="slate">{data.totals.issues} issues</Chip>
                {data.totals.flagged > 0 && (
                  <Chip tone="amber">{data.totals.flagged} flagged</Chip>
                )}
              </>
            )}
            <DateField value={day} onChange={setDay} className="w-[140px]" />
          </span>
        } />

      {/* consumption, from what was captured today and nowhere else */}
      {data && data.rates.length > 0 && (
        <div className="px-3 py-2 border-b border-border-light">
          <p className="text-[11px] text-txt-muted mb-1.5">
            What each machine burnt per unit of work — from today&apos;s own
            litres and today&apos;s own meter, shown only where both were
            captured.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.rates.map((r) => (
              <Chip key={r.code} tone="emerald"
                title={`${L(r.litres)} L over ${L(r.worked, 1)} ${
                  r.meter_kind === "KM" ? "km" : "hours"}`}>
                {r.code} · {r.per_unit == null ? "—" : L(r.per_unit, 2)}
                {r.meter_kind === "KM" ? " L/km" : " L/hr"}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <Th>Machine</Th><Th>From</Th><Th>Shift</Th>
              <Th className="text-right">Litres</Th>
              <Th className="text-right">Meter</Th>
              <Th>Captured</Th><Th>Issued / received by</Th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <EmptyRow colSpan={7}>Reading the day book…</EmptyRow>}
            {data?.issues.length === 0 && (
              <EmptyRow colSpan={7}>
                Nothing issued through the portal on this day yet.
              </EmptyRow>
            )}
            {data?.issues.map((i) => (
              <tr key={i.issue_id} className="border-t border-border-light">
                <Td>
                  <span className="font-semibold text-navy">{i.code}</span>
                  {i.consumer !== i.code && (
                    <span className="block text-[10px] text-txt-light truncate max-w-[180px]">
                      {i.consumer}
                    </span>
                  )}
                </Td>
                <Td className="text-[11.5px] text-txt-muted">{i.point}</Td>
                <Td className="text-[11.5px]">{i.shift}</Td>
                <Td className="text-right font-mono text-[12px] font-semibold">
                  {L(i.litres)}
                </Td>
                <Td className="text-right font-mono text-[11.5px] text-txt-muted">
                  {i.meter_reading == null ? "—" : L(i.meter_reading, 1)}
                  {i.meter_kind && (
                    <span className="block text-[9px] text-txt-light">
                      {i.meter_kind === "KM" ? "km" : "hrs"}
                    </span>
                  )}
                </Td>
                {/* Where the figure came from. A litre from a sensor and a
                    litre typed at the pump are not equally certain. */}
                <Td>
                  <Chip tone={i.source === "SENSOR" ? "emerald"
                    : i.source === "DISPENSER" ? "sky" : "slate"} dot={false}>
                    {i.source.toLowerCase()}
                  </Chip>
                </Td>
                <Td className="text-[10.5px] text-txt-muted">
                  {i.issued_by || "—"} / {i.received_by || "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && (data.meter_readings.length > 0 || data.machine_meters.length > 0) && (
        <div className="border-t border-border-light px-3 py-2 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[10.5px] uppercase tracking-wide text-txt-light mb-1">
              Pump readings
            </p>
            {data.meter_readings.map((m, ix) => (
              <div key={ix} className="text-[11.5px] flex items-center gap-1.5 py-0.5">
                <span className="text-txt-muted">{m.point} {m.shift}</span>
                <span className="font-mono">
                  {L(m.opening)} → {L(m.closing)}
                </span>
                {m.dispensed != null && (
                  <span className="font-mono font-semibold text-navy">
                    = {L(m.dispensed)} L
                  </span>
                )}
                {m.flagged && <Chip tone="amber" title={m.reason ?? ""}>flagged</Chip>}
              </div>
            ))}
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-wide text-txt-light mb-1">
              Machine meters
            </p>
            {data.machine_meters.map((m, ix) => (
              <div key={ix} className="text-[11.5px] flex items-center gap-1.5 py-0.5">
                <span className="text-txt-muted">{m.code} {m.shift}</span>
                <span className="font-mono">{L(m.opening, 1)} → {L(m.closing, 1)}</span>
                {m.worked != null && (
                  <span className="font-mono font-semibold text-navy">
                    = {L(m.worked, 1)} {m.meter_kind === "KM" ? "km" : "hrs"}
                  </span>
                )}
                {m.flagged && <Chip tone="amber" title={m.reason ?? ""}>flagged</Chip>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── the intelligence: a litre, and the rock it moved ────────────────── */
interface Chain {
  from: string; to: string;
  flow: { received_l: number; transferred_l: number; issued_l: number;
          issue_count: number; rate_per_l: number | null;
          by_consumer_kind: Record<string, { litres: number; consumers: number }>;
          top_consumers: { code: string; label: string; type: string | null;
                           litres: number; issues: number }[] };
  excavation: { silt_cum: number; ob_cum: number; ore_cum: number;
                ore_mt: number; total_cum: number; ore_t_per_cum: number;
                ok: boolean; problem: string | null };
  plan: { months: number; cum: number; l_per_cum: number; rate_per_l: number;
          total_cost: number; litres: number; cost_per_cum: number } | null;
  actual: { litres: number | null; cost: number | null;
            l_per_cum: number | null; cost_per_cum: number | null };
  variance: { litres_pct_of_plan: number | null; cum_pct_of_plan: number | null;
              l_per_cum_pct_of_plan: number | null;
              rate_pct_of_plan: number | null };
  gaps: string[];
}

export function ChainPanel({ apiFrom, apiTo }: { apiFrom: string; apiTo: string }) {
  const [d, setD] = useState<Chain | null>(null);
  useEffect(() => {
    let live = true;
    void api.get<Chain>("/fuel-control/chain",
      { params: { day_from: apiFrom, day_to: apiTo } })
      .then((r) => { if (live) setD(r.data); })
      .catch(() => { /* reported by the panels above */ });
    return () => { live = false; };
  }, [apiFrom, apiTo]);

  const steps = useMemo(() => d ? [
    { label: "Delivered", value: d.flow.received_l, unit: "L", icon: Droplets,
      hint: "into the tanks" },
    { label: "Moved between points", value: d.flow.transferred_l, unit: "L",
      icon: Fuel,
      hint: "tank to bowser — counted once, never as consumption" },
    { label: "Issued to machines", value: d.flow.issued_l, unit: "L", icon: Gauge,
      hint: `${d.flow.issue_count} issues booked through the portal` },
    { label: "Rock moved", value: d.excavation.total_cum, unit: "Cum",
      icon: Mountain,
      hint: `silt ${L(d.excavation.silt_cum)} · OB ${L(d.excavation.ob_cum)} · ore ${
        L(d.excavation.ore_cum)} (from ${L(d.excavation.ore_mt)} Mt at ${
        d.excavation.ore_t_per_cum} t/Cum)` },
  ] : [], [d]);

  return (
    <Card>
      <CardHeader icon={TrendingDown} tone="violet" subtitleOnIcon
        title="A litre, and the rock it moved"
        subtitle="Delivered, held, moved, issued, and what came out of the ground for it. Both halves of litres-per-cubic-metre move, so the screen shows both instead of only the ratio." />

      {/* the chain, left to right */}
      <div className="p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, ix) => (
          <div key={s.label} className="relative rounded-lg bg-bg-soft px-3 py-2"
            title={s.hint}>
            <div className="flex items-center gap-1.5 text-txt-light">
              <s.icon className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-wide">{s.label}</span>
            </div>
            <div className="text-[19px] font-bold text-navy font-mono leading-tight">
              {L(s.value)}
              <span className="text-[11px] font-normal text-txt-light ml-1">{s.unit}</span>
            </div>
            <div className="text-[10px] text-txt-muted leading-tight mt-0.5 line-clamp-2">
              {s.hint}
            </div>
            {ix < steps.length - 1 && (
              <span className="hidden lg:block absolute -right-[9px] top-1/2 -translate-y-1/2
                               text-txt-light text-[13px]">→</span>
            )}
          </div>
        ))}
      </div>

      {/* plan against actual, decomposed */}
      {d?.plan && (
        <div className="border-t border-border-light px-3 py-3">
          <p className="text-[11px] text-txt-muted mb-2">
            Against the business plan on file for this range. <strong>Read both
            rows before the ratio:</strong> if output fell further than fuel
            did, litres per cubic metre rises without any machine burning more.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <Th /><Th className="text-right">Plan</Th>
                  <Th className="text-right">Actual</Th>
                  <Th className="text-right">Share of plan</Th>
                </tr>
              </thead>
              <tbody>
                <Row label="Diesel, litres" plan={d.plan.litres}
                  actual={d.actual.litres} pct={d.variance.litres_pct_of_plan} />
                <Row label="Rock moved, Cum" plan={d.plan.cum}
                  actual={d.excavation.total_cum} pct={d.variance.cum_pct_of_plan} />
                <Row label="Litres per Cum" plan={d.plan.l_per_cum}
                  actual={d.actual.l_per_cum} pct={d.variance.l_per_cum_pct_of_plan}
                  dp={2} emphasise />
                <Row label="Rate per litre" plan={d.plan.rate_per_l}
                  actual={d.flow.rate_per_l} pct={d.variance.rate_pct_of_plan} dp={2} />
                <Row label="Cost per Cum" plan={d.plan.cost_per_cum}
                  actual={d.actual.cost_per_cum} pct={null} dp={2} />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d && d.gaps.length > 0 && (
        <div className="border-t border-border-light px-3 py-2 space-y-1.5">
          {d.gaps.map((g) => (
            <p key={g} className="text-[11px] text-txt-muted flex items-start gap-1.5">
              <span className="text-amber mt-[1px]">•</span><span>{g}</span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function Row({ label, plan, actual, pct, dp = 0, emphasise }: {
  label: string; plan: number | null; actual: number | null;
  pct: number | null; dp?: number; emphasise?: boolean;
}) {
  return (
    <tr className={`border-t border-border-light ${emphasise ? "bg-bg-soft/60" : ""}`}>
      <Td className={emphasise ? "font-semibold text-navy" : ""}>{label}</Td>
      <Td className="text-right font-mono text-[12px] text-txt-muted">{L(plan, dp)}</Td>
      <Td className={`text-right font-mono text-[12px] ${
        emphasise ? "font-semibold text-navy" : ""}`}>{L(actual, dp)}</Td>
      <Td className="text-right font-mono text-[12px]">
        {pct == null ? <span className="text-txt-light">—</span> : (
          <span className={pct > 115 ? "text-amber-dark"
            : pct < 85 ? "text-sky-dark" : "text-emerald"}>{L(pct, 1)}%</span>
        )}
      </Td>
    </tr>
  );
}
