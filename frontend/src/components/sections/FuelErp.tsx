"use client";

/* The flow, as it actually happens.
 *
 *   a tanker arrives against a purchase order
 *        -> dipped, decanted, dipped again
 *   somebody raises an order for a machine
 *        -> the machine comes to a nozzle, or the tanker goes to the machine
 *        -> a quantity is actually put in, at a time, by a person
 *
 * Three records with three owners. The workbook held only the last number and
 * none of the working, which is why a 2,154 litre gap could sit in it for a
 * month without anybody being able to say where it came from.
 */
import { useCallback, useEffect, useState } from "react";
import { Truck, ClipboardCheck, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, Th, Td, EmptyRow, Chip, Button, Field,
         inputClass, Alert } from "@/components/minehub/ui";

interface PointLite { issuing_point_id: number; label: string; is_active: boolean }
interface NozzleLite {
  nozzle_id: number; issuing_point_id: number; code: string;
  label: string; kind: "FIXED" | "MOBILE"; is_active: boolean;
}
interface ConsumerLite {
  consumer_id: number; code: string; label: string;
  meter_kind: "HMR" | "KM" | "NONE"; is_active: boolean; asset_type: string | null;
}
export interface PendingOrder {
  order_id: number; order_no: string; on_date: string; shift: string | null;
  status: string; consumer_id: number; code: string; consumer: string;
  meter_kind: string; point: string | null; nozzle: string | null;
  requested_l: number; filled_l: number; outstanding_l: number; fills: number;
  purpose: string | null; requested_by: string | null;
}

const L = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : n.toLocaleString("en-IN",
    { minimumFractionDigits: dp, maximumFractionDigits: dp });

/* ── 1. the tanker, against a purchase order ─────────────────────────── */
export function TankerPanel({ points, busy, write }: {
  points: PointLite[];
  busy: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    issuing_point_id: "" as number | "", on_date: today, po_no: "",
    challan_no: "", tanker_no: "", transporter: "", invoice_litres: "",
    litres: "", rate_per_l: "", dip_before: "", dip_after: "",
    arrived_at: "", decanted_at: "", received_by: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  const dipGain = f.dip_before !== "" && f.dip_after !== ""
    ? Number(f.dip_after) - Number(f.dip_before) : null;
  const short = f.invoice_litres !== "" && f.litres !== ""
    ? Number(f.invoice_litres) - Number(f.litres) : null;

  const submit = () =>
    write(() => api.post("/fuel-control/tanker", {
      issuing_point_id: f.issuing_point_id, on_date: f.on_date,
      litres: Number(f.litres),
      invoice_litres: f.invoice_litres === "" ? null : Number(f.invoice_litres),
      rate_per_l: f.rate_per_l === "" ? null : Number(f.rate_per_l),
      po_no: f.po_no || null, challan_no: f.challan_no || null,
      tanker_no: f.tanker_no || null, transporter: f.transporter || null,
      dip_before: f.dip_before === "" ? null : Number(f.dip_before),
      dip_after: f.dip_after === "" ? null : Number(f.dip_after),
      arrived_at: f.arrived_at || null, decanted_at: f.decanted_at || null,
      received_by: f.received_by || null,
    }), `${f.litres} litres taken into the tank.`)
      .then(() => setF((v) => ({ ...v, litres: "", invoice_litres: "",
        dip_before: "", dip_after: "", po_no: "", challan_no: "", tanker_no: "" })));

  return (
    <Card>
      <CardHeader icon={Truck} tone="emerald" subtitleOnIcon
        title="A tanker arrives"
        subtitle="Against a purchase order, dipped before and after. SAP owns the order — the number here is a reference so a litre in the tank can be traced to the document that bought it." />
      <div className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <Field label="Into which tank" required>
          <select value={f.issuing_point_id} disabled={busy} className={inputClass}
            onChange={(e) => setF((v) => ({ ...v,
              issuing_point_id: e.target.value ? Number(e.target.value) : "" }))}>
            <option value="">Choose…</option>
            {points.filter((p) => p.is_active).map((p) => (
              <option key={p.issuing_point_id} value={p.issuing_point_id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" value={f.on_date} disabled={busy}
            className={inputClass} onChange={set("on_date")} />
        </Field>
        <Field label="Purchase order" hint="the SAP PO number">
          <input value={f.po_no} disabled={busy} className={inputClass}
            placeholder="e.g. 4500123456" onChange={set("po_no")} />
        </Field>
        <Field label="Challan / invoice no.">
          <input value={f.challan_no} disabled={busy} className={inputClass}
            onChange={set("challan_no")} />
        </Field>

        <Field label="Tanker number">
          <input value={f.tanker_no} disabled={busy} className={inputClass}
            placeholder="OD02 AB 1234" onChange={set("tanker_no")} />
        </Field>
        <Field label="Transporter">
          <input value={f.transporter} disabled={busy} className={inputClass}
            onChange={set("transporter")} />
        </Field>
        <Field label="Arrived at">
          <input type="datetime-local" value={f.arrived_at} disabled={busy}
            className={inputClass} onChange={set("arrived_at")} />
        </Field>
        <Field label="Decanted at">
          <input type="datetime-local" value={f.decanted_at} disabled={busy}
            className={inputClass} onChange={set("decanted_at")} />
        </Field>

        {/* The three quantities. They disagree more often than not, and the
            difference is the only thing on this form worth escalating. */}
        <Field label="Invoice litres" hint="what the vendor billed">
          <input type="number" step="0.01" value={f.invoice_litres} disabled={busy}
            className={inputClass} onChange={set("invoice_litres")} />
        </Field>
        <Field label="Accepted litres" required hint="what you signed for">
          <input type="number" step="0.01" value={f.litres} disabled={busy}
            className={inputClass} onChange={set("litres")} />
        </Field>
        <Field label="Dip before">
          <input type="number" step="0.01" value={f.dip_before} disabled={busy}
            className={inputClass} onChange={set("dip_before")} />
        </Field>
        <Field label="Dip after" hint={dipGain == null ? "the tank gained" : `gained ${L(dipGain)} L`}>
          <input type="number" step="0.01" value={f.dip_after} disabled={busy}
            className={inputClass} onChange={set("dip_after")} />
        </Field>

        <Field label="Rate per litre" hint="what makes cost per Cum possible">
          <input type="number" step="0.01" value={f.rate_per_l} disabled={busy}
            className={inputClass} placeholder="₹" onChange={set("rate_per_l")} />
        </Field>
        <Field label="Received by">
          <input value={f.received_by} disabled={busy} className={inputClass}
            onChange={set("received_by")} />
        </Field>
      </div>

      {short != null && Math.abs(short) > 0.5 && (
        <div className="px-3 pb-2">
          <Alert tone={Math.abs(short) > Number(f.litres) * 0.005 ? "warning" : "info"}>
            The invoice is {L(Math.abs(short), 2)} litres{" "}
            {short > 0 ? "more" : "less"} than you are accepting. That is
            normal within a small margin — temperature, a hose left part full —
            and worth a question beyond it. It will be recorded either way,
            with the difference kept.
          </Alert>
        </div>
      )}
      <div className="px-3 pb-3">
        <Button variant="primary" size="sm"
          disabled={busy || !f.issuing_point_id || !f.litres || Number(f.litres) <= 0}
          onClick={submit}>
          <Truck className="w-3.5 h-3.5" /> Take into tank
        </Button>
      </div>
    </Card>
  );
}

/* ── 2. an order, and what is still outstanding on it ────────────────── */
export function OrdersPanel({ points, nozzles, consumers, busy, write, onPick }: {
  points: PointLite[];
  nozzles: NozzleLite[];
  consumers: ConsumerLite[];
  busy: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  onPick: (o: PendingOrder) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [cid, setCid] = useState<number | "">("");
  const [pid, setPid] = useState<number | "">("");
  const [nid, setNid] = useState<number | "">("");
  const [want, setWant] = useState("");
  const [shift, setShift] = useState("A");
  const [purpose, setPurpose] = useState("");
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api.get<PendingOrder[]>("/fuel-control/orders",
        { params: { status: "PENDING" } });
      setPending(r.data);
    } catch { /* the panels above report failures */ }
  }, []);
  useEffect(() => { void load(); }, [load, tick]);

  const forPoint = nozzles.filter(
    (n) => n.is_active && (pid === "" || n.issuing_point_id === pid));

  const submit = () =>
    write(() => api.post("/fuel-control/order", {
      consumer_id: cid, requested_l: Number(want), on_date: today, shift,
      issuing_point_id: pid || null, nozzle_id: nid || null,
      purpose: purpose || null,
    }), "Order raised.").then(() => { setWant(""); setTick((t) => t + 1); });

  return (
    <Card>
      <CardHeader icon={ClipboardCheck} tone="sky" subtitleOnIcon
        title="Orders for fuel"
        subtitle="Raise an indent, then book the fill against it. Ordered and filled are different numbers — a tipper indented for 200 takes what its tank has room for — so the order closes on what actually went in, not on somebody remembering to close it."
        actions={pending.length > 0
          ? <Chip tone="amber">{pending.length} awaiting fuel</Chip>
          : <Chip tone="emerald">nothing outstanding</Chip>} />

      <div className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end
                      border-b border-border-light">
        <Field label="Machine" required>
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
          <input type="number" step="1" min="0" value={want} disabled={busy}
            className={inputClass} onChange={(e) => setWant(e.target.value)} />
        </Field>
        <Field label="Shift">
          <select value={shift} disabled={busy} className={inputClass}
            onChange={(e) => setShift(e.target.value)}>
            {["A", "B", "C", "GEN"].map((s) => (
              <option key={s} value={s}>{s === "GEN" ? "Whole day" : `Shift ${s}`}</option>
            ))}
          </select>
        </Field>
        <Field label="Expected point">
          <select value={pid} disabled={busy} className={inputClass}
            onChange={(e) => { setPid(e.target.value ? Number(e.target.value) : ""); setNid(""); }}>
            <option value="">any</option>
            {points.filter((p) => p.is_active).map((p) => (
              <option key={p.issuing_point_id} value={p.issuing_point_id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Expected nozzle" hint="not binding — the fill records where it really happened">
          <select value={nid} disabled={busy || pid === ""} className={inputClass}
            onChange={(e) => setNid(e.target.value ? Number(e.target.value) : "")}>
            <option value="">any</option>
            {forPoint.map((n) => (
              <option key={n.nozzle_id} value={n.nozzle_id}>
                {n.label}{n.kind === "MOBILE" ? " (goes to the machine)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Button variant="secondary" size="sm"
          disabled={busy || !cid || !want || Number(want) <= 0} onClick={submit}>
          <ClipboardCheck className="w-3.5 h-3.5" /> Raise order
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <Th>Order</Th><Th>Machine</Th><Th>Expected at</Th>
              <Th className="text-right">Ordered</Th>
              <Th className="text-right">Filled</Th>
              <Th className="text-right">Still due</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 && (
              <EmptyRow colSpan={7}>
                No orders are waiting for fuel.
              </EmptyRow>
            )}
            {pending.map((o) => (
              <tr key={o.order_id} className="border-t border-border-light
                                              hover:bg-bg-soft/50">
                <Td>
                  <span className="font-mono text-[11.5px] font-semibold text-navy">
                    {o.order_no}
                  </span>
                  <span className="block text-[10px] text-txt-light">
                    {o.on_date} · {o.shift ?? "—"}
                  </span>
                </Td>
                <Td>
                  <span className="font-semibold text-navy">{o.code}</span>
                  {o.purpose && (
                    <span className="block text-[10px] text-txt-light truncate max-w-[150px]">
                      {o.purpose}
                    </span>
                  )}
                </Td>
                <Td className="text-[11.5px] text-txt-muted">
                  {o.point ?? "any"}{o.nozzle ? ` · ${o.nozzle}` : ""}
                </Td>
                <Td className="text-right font-mono text-[12px]">{L(o.requested_l)}</Td>
                <Td className="text-right font-mono text-[12px] text-txt-muted">
                  {L(o.filled_l)}
                  {o.fills > 1 && (
                    <span className="block text-[9px] text-txt-light">
                      {o.fills} fills
                    </span>
                  )}
                </Td>
                <Td className="text-right font-mono text-[12px] font-semibold text-amber-dark">
                  {L(o.outstanding_l)}
                </Td>
                <Td className="text-right">
                  <Button variant="secondary" size="sm" onClick={() => onPick(o)}
                    title="Book a fill against this order">
                    Fill <ChevronRight className="w-3 h-3" />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
