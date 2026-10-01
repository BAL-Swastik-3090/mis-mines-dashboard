"use client";

/* The flow, as it actually happens.
 *
 *   a tanker arrives against a purchase order
 *        -> checked, sealed, sampled, dipped, decanted, dipped again, signed
 *   somebody raises an order for a machine
 *        -> the machine comes to a nozzle, or the tanker goes to the machine
 *        -> a quantity is actually put in, at a time, by a person
 *
 * Three records with three owners. The workbook held only the last number and
 * none of the working, which is why a 2,154 litre gap could sit in it for a
 * month without anybody being able to say where it came from.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Truck, ClipboardCheck, ChevronRight, Paperclip, ShieldCheck,
         Upload, FlaskConical } from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, Th, Td, EmptyRow, Chip, Button, Field,
         inputClass, Alert } from "@/components/minehub/ui";
import DateField from "@/components/minehub/DateField";

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
interface Spec {
  density_min: number | null; density_max: number | null;
  density_ref_temp_c: number | null; temp_max_c: number | null;
  water_sediment_allowed: boolean;
}
interface ReceiptMasters {
  materials: { material_id: number; code: string; label: string; uom: string }[];
  specs: Record<string, Spec>;
  parties: { party_id: number; name: string; gstin: string | null }[];
  drivers: string[]; tankers: string[]; transporters: string[];
  storage_locations: string[];
  seal_conditions: string[]; quality_statuses: string[]; document_kinds: string[];
}
interface TankerRow {
  receipt_id: number; receipt_no?: string | null; on_date: string;
  point: string; po_no: string | null; challan_no: string | null;
  tanker_no: string | null; transporter: string | null;
  litres: number; invoice_litres: number | null; dip_gain: number | null;
  rate_per_l: number | null; arrived_at: string | null;
  decanted_at: string | null; received_by: string | null;
  flagged: boolean; reason: string | null;
}

const L = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : n.toLocaleString("en-IN",
    { minimumFractionDigits: dp, maximumFractionDigits: dp });

/* A group of fields with a heading, so a fourteen-box form becomes six
 * questions somebody can answer in order. */
function Group({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border-light px-3 py-2.5 first:border-t-0">
      <p className="text-[10.5px] uppercase tracking-wide text-txt-light font-semibold">
        {title}
      </p>
      {hint && <p className="text-[10.5px] text-txt-muted mt-0.5 mb-1.5">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end mt-1.5">
        {children}
      </div>
    </div>
  );
}

/* A text box that offers what has come through this gate before. Not a master:
 * a tanker driver changes week to week and a master nobody maintains goes
 * stale, so past receipts are the suggestion list. */
function Suggest({ id, value, onChange, options, disabled, placeholder }: {
  id: string; value: string; onChange: (v: string) => void;
  options: string[]; disabled?: boolean; placeholder?: string;
}) {
  return (
    <>
      <input list={id} value={value} disabled={disabled} className={inputClass}
        placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

/* ── 1. the delivery ─────────────────────────────────────────────────── */
export function TankerPanel({ points, busy, write, onSaved }: {
  points: PointLite[];
  busy: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  onSaved?: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const blank = {
    issuing_point_id: "" as number | "", on_date: today,
    material_id: "" as number | "", po_no: "", po_line: "", po_litres: "",
    challan_no: "", storage_location: "", supplier_party_id: "" as number | "",
    transporter_party_id: "" as number | "", transporter: "",
    tanker_no: "", driver_name: "", driver_mobile: "", driver_licence: "",
    seal_no: "", seal_condition: "", invoice_litres: "", litres: "",
    dip_before: "", dip_after: "", rate_per_l: "",
    arrived_at: "", decanted_at: "",
    density: "", temperature_c: "", water_sediment: false,
    sample_ref: "", quality_status: "", quality_remarks: "",
    received_by: "",
  };
  const [f, setF] = useState(blank);
  const [m, setM] = useState<ReceiptMasters | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    void api.get<ReceiptMasters>("/fuel-control/receipt-masters")
      .then((r) => setM(r.data)).catch(() => { /* reported above */ });
  }, []);

  /* Default to diesel once the materials arrive: everything that comes
   * through this gate is HSD until somebody says otherwise. */
  useEffect(() => {
    if (m && f.material_id === "") {
      const hsd = m.materials.find((x) => x.code === "HSD") ?? m.materials[0];
      if (hsd) set("material_id", hsd.material_id);
    }
  }, [m]);   // eslint-disable-line react-hooks/exhaustive-deps

  const spec = m && f.material_id !== ""
    ? m.specs[String(f.material_id)] : undefined;

  /* The same checks the server runs, shown while the form is still open so
   * nothing is a surprise after Save. The server decides; this only warns. */
  const dipGain = f.dip_before !== "" && f.dip_after !== ""
    ? Number(f.dip_after) - Number(f.dip_before) : null;
  const warn: string[] = [];
  if (f.invoice_litres !== "" && f.litres !== "") {
    const d = Number(f.invoice_litres) - Number(f.litres);
    if (Math.abs(d) > Math.max(Number(f.litres) * 0.005, 20)) {
      warn.push(`the invoice is ${L(Math.abs(d), 2)} L ${
        d > 0 ? "more" : "less"} than you are accepting`);
    }
  }
  if (dipGain != null && f.litres !== ""
      && Math.abs(dipGain - Number(f.litres)) > Math.max(Number(f.litres) * 0.01, 25)) {
    warn.push(`the dips say ${L(dipGain)} L but ${L(Number(f.litres))} is being accepted`);
  }
  if (f.seal_condition === "BROKEN" || f.seal_condition === "MISSING") {
    warn.push(`the seal was ${f.seal_condition.toLowerCase()} on arrival`);
  }
  if (spec && f.density !== "" && spec.density_min != null && spec.density_max != null
      && (Number(f.density) < spec.density_min || Number(f.density) > spec.density_max)) {
    warn.push(`density is outside the ${spec.density_min}–${spec.density_max} range`);
  }
  if (spec?.temp_max_c != null && f.temperature_c !== ""
      && Number(f.temperature_c) > spec.temp_max_c) {
    warn.push(`temperature is above the ${spec.temp_max_c} °C limit`);
  }
  if (f.water_sediment && spec && !spec.water_sediment_allowed) {
    warn.push("water or sediment was found");
  }

  const num = (v: string) => (v === "" ? null : Number(v));
  const submit = () =>
    write(async () => {
      const r = await api.post<{ receipt_no: string; questions: string[] }>(
        "/fuel-control/tanker", {
          issuing_point_id: f.issuing_point_id, on_date: f.on_date,
          material_id: f.material_id || null,
          litres: Number(f.litres), invoice_litres: num(f.invoice_litres),
          po_litres: num(f.po_litres), rate_per_l: num(f.rate_per_l),
          po_no: f.po_no || null, po_line: f.po_line || null,
          challan_no: f.challan_no || null,
          storage_location: f.storage_location || null,
          supplier_party_id: f.supplier_party_id || null,
          transporter_party_id: f.transporter_party_id || null,
          transporter: f.transporter || null,
          tanker_no: f.tanker_no || null, driver_name: f.driver_name || null,
          driver_mobile: f.driver_mobile || null,
          driver_licence: f.driver_licence || null,
          seal_no: f.seal_no || null, seal_condition: f.seal_condition || null,
          dip_before: num(f.dip_before), dip_after: num(f.dip_after),
          arrived_at: f.arrived_at || null, decanted_at: f.decanted_at || null,
          density: num(f.density), temperature_c: num(f.temperature_c),
          water_sediment: f.water_sediment,
          sample_ref: f.sample_ref || null,
          quality_status: f.quality_status || null,
          quality_remarks: f.quality_remarks || null,
          received_by: f.received_by || null,
        });
      setQuestions(r.data.questions ?? []);
      setF({ ...blank, issuing_point_id: f.issuing_point_id,
             material_id: f.material_id });
      onSaved?.();
      return r;
    }, "Delivery recorded.");

  return (
    <Card>
      <CardHeader icon={Truck} tone="emerald" subtitleOnIcon
        title="A tanker arrives"
        subtitle="A delivery somebody puts their name to. SAP owns the purchase order and the GRN — the numbers here are references, so a litre in the tank traces to the documents around it."
        actions={warn.length > 0
          ? <Chip tone="amber">{warn.length} to ask about</Chip> : undefined} />

      <Group title="What, and against which document"
        hint="The material decides which quality specification the readings below are checked against.">
        <Field label="Into which tank" required>
          <select value={f.issuing_point_id} disabled={busy} className={inputClass}
            onChange={(e) => set("issuing_point_id",
              e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose…</option>
            {points.filter((p) => p.is_active).map((p) => (
              <option key={p.issuing_point_id} value={p.issuing_point_id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Material" required>
          <select value={f.material_id} disabled={busy} className={inputClass}
            onChange={(e) => set("material_id",
              e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose…</option>
            {(m?.materials ?? []).map((x) => (
              <option key={x.material_id} value={x.material_id}>
                {x.code} · {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" required>
          <DateField value={f.on_date} disabled={busy}
                     onChange={(v) => set("on_date", v)} />
        </Field>
        <Field label="Storage location">
          <Suggest id="fuel-storeloc" value={f.storage_location} disabled={busy}
            options={m?.storage_locations ?? []} placeholder="e.g. UG-TANK-01"
            onChange={(v) => set("storage_location", v)} />
        </Field>

        <Field label="Purchase order" hint="the SAP PO number">
          <input value={f.po_no} disabled={busy} className={inputClass}
            placeholder="e.g. 4500123456"
            onChange={(e) => set("po_no", e.target.value)} />
        </Field>
        <Field label="PO line">
          <input value={f.po_line} disabled={busy} className={inputClass}
            onChange={(e) => set("po_line", e.target.value)} />
        </Field>
        <Field label="PO quantity" hint="litres the order allows">
          <input type="number" step="0.01" value={f.po_litres} disabled={busy}
            className={inputClass}
            onChange={(e) => set("po_litres", e.target.value)} />
        </Field>
        <Field label="Challan / invoice no.">
          <input value={f.challan_no} disabled={busy} className={inputClass}
            onChange={(e) => set("challan_no", e.target.value)} />
        </Field>

        <Field label="Vendor" hint="who supplied it">
          <select value={f.supplier_party_id} disabled={busy} className={inputClass}
            onChange={(e) => set("supplier_party_id",
              e.target.value ? Number(e.target.value) : "")}>
            <option value="">not recorded</option>
            {(m?.parties ?? []).map((x) => (
              <option key={x.party_id} value={x.party_id}>{x.name}</option>
            ))}
          </select>
        </Field>
      </Group>

      <Group title="Who brought it"
        hint="A tanker number with no driver behind it is a vehicle, not a person — and when litres are short the question is asked of a driver.">
        <Field label="Tanker number">
          <Suggest id="fuel-tankers" value={f.tanker_no} disabled={busy}
            options={m?.tankers ?? []} placeholder="OD02 AB 1234"
            onChange={(v) => set("tanker_no", v)} />
        </Field>
        <Field label="Transporter">
          <Suggest id="fuel-transporters" value={f.transporter} disabled={busy}
            options={m?.transporters ?? []}
            onChange={(v) => set("transporter", v)} />
        </Field>
        <Field label="Driver name">
          <Suggest id="fuel-drivers" value={f.driver_name} disabled={busy}
            options={m?.drivers ?? []}
            onChange={(v) => set("driver_name", v)} />
        </Field>
        <Field label="Driver mobile">
          <input value={f.driver_mobile} disabled={busy} className={inputClass}
            inputMode="tel" placeholder="10 digits"
            onChange={(e) => set("driver_mobile", e.target.value)} />
        </Field>
        <Field label="Driver licence">
          <input value={f.driver_licence} disabled={busy} className={inputClass}
            onChange={(e) => set("driver_licence", e.target.value)} />
        </Field>
        <Field label="Seal number">
          <input value={f.seal_no} disabled={busy} className={inputClass}
            onChange={(e) => set("seal_no", e.target.value)} />
        </Field>
        <Field label="Seal condition"
          hint="the difference between short delivered and opened on the road">
          <select value={f.seal_condition} disabled={busy}
            className={`${inputClass} ${
              f.seal_condition === "BROKEN" || f.seal_condition === "MISSING"
                ? "border-amber" : ""}`}
            onChange={(e) => set("seal_condition", e.target.value)}>
            <option value="">not recorded</option>
            {(m?.seal_conditions ?? []).map((x) => (
              <option key={x} value={x}>{x.replace("_", " ").toLowerCase()}</option>
            ))}
          </select>
        </Field>
      </Group>

      <Group title="How much"
        hint="Four quantities, and the differences between them are the only things here worth escalating.">
        <Field label="Invoice litres" hint="what the vendor billed">
          <input type="number" step="0.01" value={f.invoice_litres} disabled={busy}
            className={inputClass}
            onChange={(e) => set("invoice_litres", e.target.value)} />
        </Field>
        <Field label="Accepted litres" required hint="what you signed for">
          <input type="number" step="0.01" value={f.litres} disabled={busy}
            className={inputClass}
            onChange={(e) => set("litres", e.target.value)} />
        </Field>
        <Field label="Dip before">
          <input type="number" step="0.01" value={f.dip_before} disabled={busy}
            className={inputClass}
            onChange={(e) => set("dip_before", e.target.value)} />
        </Field>
        <Field label="Dip after"
          hint={dipGain == null ? "the tank gained" : `the tank gained ${L(dipGain)} L`}>
          <input type="number" step="0.01" value={f.dip_after} disabled={busy}
            className={inputClass}
            onChange={(e) => set("dip_after", e.target.value)} />
        </Field>
        <Field label="Rate per litre" hint="what makes cost per Cum possible">
          <input type="number" step="0.01" value={f.rate_per_l} disabled={busy}
            className={inputClass} placeholder="₹"
            onChange={(e) => set("rate_per_l", e.target.value)} />
        </Field>
        <Field label="Arrived at">
          <input type="datetime-local" value={f.arrived_at} disabled={busy}
            className={inputClass}
            onChange={(e) => set("arrived_at", e.target.value)} />
        </Field>
        <Field label="Decanted at">
          <input type="datetime-local" value={f.decanted_at} disabled={busy}
            className={inputClass}
            onChange={(e) => set("decanted_at", e.target.value)} />
        </Field>
      </Group>

      <Group title="Was it diesel"
        hint={spec
          ? `Checked against the specification in force: density ${
              spec.density_min}–${spec.density_max} kg/m³ at ${
              spec.density_ref_temp_c} °C, temperature up to ${spec.temp_max_c} °C.`
          : "Pick a material and the specification it is checked against appears here."}>
        <Field label="Density" hint="kg/m³">
          <input type="number" step="0.01" value={f.density} disabled={busy}
            className={`${inputClass} ${
              spec && f.density !== "" && spec.density_min != null
              && spec.density_max != null
              && (Number(f.density) < spec.density_min
                  || Number(f.density) > spec.density_max) ? "border-amber" : ""}`}
            onChange={(e) => set("density", e.target.value)} />
        </Field>
        <Field label="Temperature" hint="°C at the time of dipping">
          <input type="number" step="0.1" value={f.temperature_c} disabled={busy}
            className={`${inputClass} ${
              spec?.temp_max_c != null && f.temperature_c !== ""
              && Number(f.temperature_c) > spec.temp_max_c ? "border-amber" : ""}`}
            onChange={(e) => set("temperature_c", e.target.value)} />
        </Field>
        <Field label="Water or sediment">
          <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg
                            bg-bg-soft text-[12px] cursor-pointer">
            <input type="checkbox" checked={f.water_sediment} disabled={busy}
              onChange={(e) => set("water_sediment", e.target.checked)} />
            found in the sample
          </label>
        </Field>
        <Field label="Sample reference">
          <input value={f.sample_ref} disabled={busy} className={inputClass}
            onChange={(e) => set("sample_ref", e.target.value)} />
        </Field>
        <Field label="Quality status">
          <select value={f.quality_status} disabled={busy} className={inputClass}
            onChange={(e) => set("quality_status", e.target.value)}>
            <option value="">not recorded</option>
            {(m?.quality_statuses ?? []).map((x) => (
              <option key={x} value={x}>{x.replace("_", " ").toLowerCase()}</option>
            ))}
          </select>
        </Field>
        <Field label="Quality remarks">
          <input value={f.quality_remarks} disabled={busy} className={inputClass}
            onChange={(e) => set("quality_remarks", e.target.value)} />
        </Field>
        <Field label="Received by" hint="a second person verifies it afterwards">
          <input value={f.received_by} disabled={busy} className={inputClass}
            onChange={(e) => set("received_by", e.target.value)} />
        </Field>
      </Group>

      {warn.length > 0 && (
        <div className="px-3 pb-2">
          <Alert tone="warning">
            <strong>Worth asking about before the tanker leaves:</strong>
            <ul className="mt-1 ml-3 list-disc space-y-0.5">
              {warn.map((w) => <li key={w}>{w}</li>)}
            </ul>
            It will be recorded either way — nothing here refuses a delivery.
            The person at the gate is not the one who decides to turn a tanker
            away.
          </Alert>
        </div>
      )}
      {questions.length > 0 && (
        <div className="px-3 pb-2">
          <Alert tone="info">
            Recorded, with {questions.length} question
            {questions.length === 1 ? "" : "s"} kept against it. Attach the
            challan and the seal photograph below, then somebody else verifies it.
          </Alert>
        </div>
      )}

      <div className="px-3 pb-3 flex items-center gap-2">
        <Button variant="primary" size="sm"
          disabled={busy || !f.issuing_point_id || !f.litres || Number(f.litres) <= 0}
          onClick={submit}>
          <Truck className="w-3.5 h-3.5" /> Take into tank
        </Button>
        <span className="text-[10.5px] text-txt-light">
          Saved as a draft. It counts towards stock once a second person
          verifies it.
        </span>
      </div>
    </Card>
  );
}

/* ── the deliveries, with their paperwork and the second check ───────── */
export function TankerListPanel({ apiFrom, apiTo, canRecord, busy, write, reload }: {
  apiFrom: string; apiTo: string; canRecord: boolean; busy: boolean;
  write: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  reload: number;
}) {
  const [rows, setRows] = useState<TankerRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [kind, setKind] = useState("CHALLAN");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<TankerRow[]>("/fuel-control/tankers",
        { params: { day_from: apiFrom, day_to: apiTo } });
      setRows(r.data);
    } catch { /* reported above */ }
  }, [apiFrom, apiTo]);
  useEffect(() => { void load(); }, [load, reload]);

  const openRow = async (id: number) => {
    setOpen(id); setDetail(null);
    try {
      const r = await api.get(`/fuel-control/receipt/${id}`);
      setDetail(r.data as Record<string, unknown>);
    } catch { /* reported above */ }
  };

  const upload = async (id: number) => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    await write(() => api.post(
      `/fuel-control/receipt/${id}/document?kind=${kind}`, fd,
      { headers: { "Content-Type": "multipart/form-data" } }),
      `${file.name} attached.`);
    if (fileRef.current) fileRef.current.value = "";
    void openRow(id);
  };

  return (
    <Card>
      <CardHeader icon={Paperclip} tone="slate" subtitleOnIcon
        title="Deliveries"
        subtitle="Every tanker in the range, with the invoice-against-dip question visible and the paperwork attached to the row it belongs to." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <Th>Delivery</Th><Th>Tanker</Th><Th>Into</Th>
              <Th className="text-right">Invoice</Th>
              <Th className="text-right">Accepted</Th>
              <Th className="text-right">Dip gain</Th>
              <Th className="text-right">Rate</Th><Th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={8}>No deliveries recorded in this range.</EmptyRow>
            )}
            {rows.map((r) => (
              <tr key={r.receipt_id}
                className={`border-t border-border-light hover:bg-bg-soft/50
                            ${r.flagged ? "bg-amber-bg/30" : ""}`}>
                <Td>
                  <span className="font-mono text-[11.5px] font-semibold text-navy">
                    {r.receipt_no ?? `#${r.receipt_id}`}
                  </span>
                  <span className="block text-[10px] text-txt-light">
                    {r.on_date}{r.po_no ? ` · PO ${r.po_no}` : ""}
                  </span>
                </Td>
                <Td className="text-[11.5px]">
                  {r.tanker_no ?? "—"}
                  {r.transporter && (
                    <span className="block text-[10px] text-txt-light">
                      {r.transporter}
                    </span>
                  )}
                </Td>
                <Td className="text-[11.5px] text-txt-muted">{r.point}</Td>
                <Td className="text-right font-mono text-[12px] text-txt-muted">
                  {L(r.invoice_litres)}
                </Td>
                <Td className="text-right font-mono text-[12px] font-semibold">
                  {L(r.litres)}
                </Td>
                <Td className="text-right font-mono text-[12px] text-txt-muted">
                  {L(r.dip_gain)}
                </Td>
                <Td className="text-right font-mono text-[11.5px] text-txt-muted">
                  {r.rate_per_l == null ? "—" : `₹${L(r.rate_per_l, 2)}`}
                </Td>
                <Td className="text-right">
                  {r.flagged && (
                    <Chip tone="amber" title={r.reason ?? ""}>questions</Chip>
                  )}
                  <Button variant="secondary" size="sm"
                    onClick={() => void openRow(r.receipt_id)}>
                    Open <ChevronRight className="w-3 h-3" />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open != null && (
        <div className="border-t border-border-light px-3 py-3 space-y-3">
          {!detail && <p className="text-[11.5px] text-txt-muted">Reading…</p>}
          {detail && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] font-semibold text-navy">
                  {String(detail.receipt_no ?? "")}
                </span>
                <Chip tone={detail.approval_status === "APPROVED" ? "emerald"
                  : detail.approval_status === "REJECTED" ? "rose"
                  : detail.approval_status === "VERIFIED" ? "sky" : "slate"}>
                  {String(detail.approval_status ?? "").toLowerCase()}
                </Chip>
                {detail.seal_condition != null && (
                  <Chip tone={["BROKEN", "MISSING"].includes(String(detail.seal_condition))
                    ? "amber" : "slate"} dot={false}>
                    seal {String(detail.seal_condition).toLowerCase()}
                  </Chip>
                )}
                {detail.density != null && (
                  <Chip tone="slate" dot={false}>
                    <FlaskConical className="w-3 h-3" /> {String(detail.density)} kg/m³
                  </Chip>
                )}
                <button type="button" onClick={() => setOpen(null)}
                  className="ml-auto text-[11px] underline text-txt-light hover:text-navy">
                  close
                </button>
              </div>

              {typeof detail.suspect_reason === "string" && detail.suspect_reason && (
                <Alert tone="warning">{detail.suspect_reason}</Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {([
                  ["Driver", `${detail.driver_name ?? "—"}${
                    detail.driver_mobile ? ` · ${detail.driver_mobile}` : ""}`],
                  ["Licence", detail.driver_licence ?? "—"],
                  ["Seal no.", detail.seal_no ?? "—"],
                  ["Sample", detail.sample_ref ?? "—"],
                  ["Quality", detail.quality_status ?? "—"],
                  ["Received / verified",
                   `${detail.received_by ?? "—"} / ${detail.verified_by ?? "—"}`],
                ] as [string, unknown][]).map(([k, v]) => (
                  <div key={k} className="text-[11.5px]">
                    <span className="text-txt-light">{k}: </span>
                    <span className="text-navy">{String(v)}</span>
                  </div>
                ))}
              </div>

              {/* the paperwork */}
              <div>
                <p className="text-[10.5px] uppercase tracking-wide text-txt-light mb-1">
                  Documents
                </p>
                {Array.isArray(detail.documents) && detail.documents.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(detail.documents as { fuel_document_id: number; kind: string;
                                            file_name: string }[]).map((d) => (
                      <a key={d.fuel_document_id}
                        href={`/api/fuel-control/receipt/${open}/document/${d.fuel_document_id}`}
                        target="_blank" rel="noreferrer"
                        className="text-[11px] px-2 py-1 rounded-lg bg-bg-soft
                                   hover:bg-bg-light text-navy">
                        {d.kind.toLowerCase().replace("_", " ")} · {d.file_name}
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-txt-muted mb-2">
                    Nothing attached. A challan number is a promise that a
                    document exists; the document is what settles an argument
                    months later.
                  </p>
                )}
                {canRecord && (
                  <div className="flex flex-wrap items-end gap-2">
                    <select value={kind} className={`${inputClass} w-[150px] py-1`}
                      onChange={(e) => setKind(e.target.value)}>
                      {["CHALLAN", "INVOICE", "EWAY_BILL", "DELIVERY_NOTE",
                        "TANKER_PHOTO", "SEAL_PHOTO", "DIP_EVIDENCE",
                        "QUALITY_REPORT", "OTHER"].map((k) => (
                        <option key={k} value={k}>
                          {k.toLowerCase().replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <input ref={fileRef} type="file"
                      className="text-[11px]" disabled={busy} />
                    <Button variant="secondary" size="sm" disabled={busy}
                      onClick={() => void upload(open)}>
                      <Upload className="w-3.5 h-3.5" /> Attach
                    </Button>
                  </div>
                )}
              </div>

              {/* the second check */}
              {canRecord && detail.approval_status === "DRAFT" && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button variant="primary" size="sm" disabled={busy}
                    onClick={() => void write(
                      () => api.put(`/fuel-control/receipt/${open}/verify`,
                        { approval_status: "VERIFIED" }),
                      "Verified.").then(() => void openRow(open))}>
                    <ShieldCheck className="w-3.5 h-3.5" /> Verify this delivery
                  </Button>
                  <span className="text-[10.5px] text-txt-light">
                    The person who recorded it cannot verify it — that is the
                    whole point of the second check.
                  </span>
                </div>
              )}
              {canRecord && detail.approval_status === "VERIFIED" && (
                <Button variant="primary" size="sm" disabled={busy}
                  onClick={() => void write(
                    () => api.put(`/fuel-control/receipt/${open}/verify`,
                      { approval_status: "APPROVED" }),
                    "Accepted into stock.").then(() => void openRow(open))}>
                  <ShieldCheck className="w-3.5 h-3.5" /> Accept into stock
                </Button>
              )}
            </>
          )}
        </div>
      )}
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
    } catch { /* reported above */ }
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
        <Field label="Expected nozzle"
          hint="not binding — the fill records where it really happened">
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
              <EmptyRow colSpan={7}>No orders are waiting for fuel.</EmptyRow>
            )}
            {pending.map((o) => (
              <tr key={o.order_id}
                className="border-t border-border-light hover:bg-bg-soft/50">
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
