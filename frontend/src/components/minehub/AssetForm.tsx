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
import { Plus, Trash2, Check, Loader2, Info, ArrowLeft, Send, CheckCircle2, Undo2 } from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Chip, type Tone } from "./ui";
import Toast from "./Toast";
import Dialog from "./Dialog";
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
/** Where each refused field lives on the page, for taking someone to it. */
const FIELD_INPUT: Record<string, string> = {
  fleet_code: "af-fleet", asset_type_id: "af-type", owner_party_id: "af-owner",
};

function Row({ label, required, hint, children, wide, invalid }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
  wide?: boolean;
  /** Submission refused on this one — say so on the label as well as the field,
   *  since a red outline alone is invisible to anyone who cannot see colour. */
  invalid?: boolean;
}) {
  return (
    <>
      <div className={`px-3 py-2 flex items-center gap-1.5 border-b border-r border-border-light
                       ${invalid ? "bg-rose-bg" : "bg-bg-light"}`}>
        <span className={`text-[12px] font-medium ${invalid ? "text-rose font-semibold" : "text-txt-secondary"}`}>
          {label}
        </span>
        {required && <span className="text-rose text-[12px]">*</span>}
        {hint && (
          <span title={hint} className="text-txt-light hover:text-navy cursor-help">
            <Info className="w-3 h-3" />
          </span>
        )}
      </div>
      <div className={`border-b border-border-light ${wide ? "col-span-3" : ""}
                       ${invalid ? "bg-rose-bg/40 ring-1 ring-inset ring-rose-ring" : ""}`}>
        {children}
        {invalid && (
          <p className="px-3 pb-1.5 -mt-0.5 text-[11px] font-semibold text-rose">Needed to submit</p>
        )}
      </div>
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

export default function AssetForm({ assetId, prefill, onSaved, onDone, onCancel }: {
  /** Editing an existing machine rather than registering a new one. */
  assetId?: number;
  prefill?: { fleet_code?: string; telematics_code?: string };
  /** A save happened — the register behind this form is out of date. */
  onSaved?: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  // A machine just created in this session. Keeping its id turns the form into
  // the edit form for what was saved, so the draft status, the approval button
  // and the trail appear where the person is already looking — rather than
  // after they find the row again in the register and reopen it.
  const [createdId, setCreatedId] = useState<number | null>(null);
  const id = assetId ?? createdId;
  const editing = Boolean(id);
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
  const [showMissing, setShowMissing] = useState(false);
  // The fields a submission would reject, marked after an attempt rather than
  // while someone is still typing — a form that turns red as you fill it in is
  // nagging, not helping.
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  // What was last written to the database. Anything different is unsaved work.
  const [saved, setSaved] = useState("");
  const [ask, setAsk] = useState<null | "discard" | "revert" | "leave" | "send-back">(null);
  const [sendBackWhy, setSendBackWhy] = useState("");

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
    if (!id) return;
    setLoadingRev(true);
    try {
      const r = await api.get(`/minehub/assets/${id}/revisions`);
      setRevisions(r.data ?? []);
    } catch { setRevisions([]); } finally { setLoadingRev(false); }
  }, [id]);

  const loadAsset = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get(`/minehub/assets/${id}`);
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
  }, [id]);

  useEffect(() => { void loadAsset(); void loadRevisions(); }, [loadAsset, loadRevisions]);

  // A blank new form is not unsaved work, so the baseline is the untouched
  // sheet. Prefill is deliberately NOT part of it: registering a machine from
  // the telematics queue arrives with its code already filled, and that is
  // exactly the work someone came to save — treating it as "no changes" would
  // leave the save button dead on the one path that needs it most.
  useEffect(() => {
    if (assetId) return;
    setSaved(JSON.stringify([
      { fleet_code: "", ownership: "OWN", status: "ACTIVE", reading_uom: "HOURS", fuel_type: "DIESEL" },
      [emptyDoc("INSURANCE"), emptyDoc("FITNESS"), emptyDoc("ROAD_TAX")],
      [emptySched()],
      [],
    ]));
    // Only on mount: after this the baseline moves when something is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One string standing for everything on the sheet, cheap to compare. */
  const snapshot = useMemo(
    () => JSON.stringify([f, docs, scheds, idents]), [f, docs, scheds, idents]);
  const dirty = snapshot !== saved;

  // The browser's own guard, for a closed tab or a typed URL — the in-app one
  // cannot run then.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);


  const set = (k: string, v: string) => {
    setF((prev) => ({ ...prev, [k]: v }));
    // Correcting a field clears its mark; the message about it survives until
    // the next attempt, which is when it can be true again.
    setInvalid((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev); next.delete(k); return next;
    });
  };
  const isElectric = f.fuel_type === "ELECTRIC" || f.fuel_type === "HYBRID";
  // The picker shows a name; the form stores the id it resolves to.
  const typeName = types.find((t) => String(t.asset_type_id) === f.asset_type_id)?.name ?? "";
  const isHired = f.ownership === "HIRED";

  /** What this particular machine still needs.
   *
   *  A fixed list of twelve fields counted a hired tipper against a purchase
   *  date it will never have, and a diesel excavator against a battery size —
   *  so the figure moved for reasons nobody could act on. The checklist now
   *  depends on what kind of machine is being described, and says which items
   *  are outstanding rather than only how many. */
  const checklist = useMemo(() => {
    const has = (k: string) => Boolean((f[k] ?? "").toString().trim());
    const items: { label: string; done: boolean; needed: boolean }[] = [
      { label: "Fleet code",      done: has("fleet_code"),      needed: true },
      { label: "Equipment type",  done: has("asset_type_id"),   needed: true },
      { label: "Make",            done: has("make"),            needed: false },
      { label: "Model",           done: has("model"),           needed: false },
      { label: "Registration no.", done: has("registration_no"), needed: false },
      { label: "Capacity",        done: has("capacity"),        needed: false },
      { label: "Home location",   done: has("home_location_id"), needed: false },
      { label: "Meter reading",   done: has("current_reading"), needed: false },
      { label: "Commissioned on", done: has("commissioned_on"), needed: false },
    ];
    if (isHired) {
      items.push(
        { label: "Contractor",     done: has("owner_party_id"), needed: true },
        { label: "Contract no.",   done: has("contract_no"),    needed: false },
        { label: "Service PO no.", done: has("service_po_no"),  needed: false },
      );
    } else {
      items.push(
        { label: "SAP equipment no.", done: has("sap_equipment_no"), needed: false },
        { label: "Purchase date",     done: has("purchase_date"),    needed: false },
      );
    }
    items.push(isElectric
      ? { label: "Battery kWh", done: has("battery_kwh"), needed: false }
      : { label: "Tank capacity", done: has("tank_capacity_l"), needed: false });
    return items;
  }, [f, isHired, isElectric]);

  const doneCount = checklist.filter((i) => i.done).length;
  const filled = Math.round((doneCount / checklist.length) * 100);
  const outstanding = checklist.filter((i) => !i.done).map((i) => i.label);

  /** Raise a message that finds the reader wherever they are on the sheet. */
  const raise = (msg: string) => { setNotice(null); setError(msg); };

  const submit = async (then: "stay" | "submit" = "stay") => {
    // Only the path that puts this in front of someone else checks for
    // completeness. Saving a draft takes whatever has been typed so far — the
    // rest can be filled in after a walk to the machine.
    if (then === "submit") {
      const needed: [string, string, boolean][] = [
        ["fleet_code",     "a fleet code",                Boolean(f.fleet_code?.trim())],
        ["asset_type_id",  "an equipment type",           Boolean(f.asset_type_id)],
        ["owner_party_id", "the contractor that owns it", !isHired || Boolean(f.owner_party_id)],
      ];
      const short = needed.filter(([, , ok]) => !ok);
      if (short.length) {
        setInvalid(new Set(short.map(([k]) => k)));
        raise(`Before this can go for approval it needs ${short.map(([, t]) => t).join(", ")}. `
            + "They are marked below. Save it as a draft meanwhile — nothing typed is lost.");
        // Take the person to the first one; a mark they cannot see helps nobody.
        document.getElementById(FIELD_INPUT[short[0][0]])
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      setInvalid(new Set());
    }

    setSaving(true); setError(null);
    try {
      if (editing) {
        const r = await api.put(`/minehub/assets/${id}`, f);
        setSaved(snapshot);
        setNotice(r.data?.changed
          ? `Saved — ${r.data.changed} field${r.data.changed === 1 ? "" : "s"} changed, now v${r.data.version}.`
             + (r.data.approval_reset ? " Approval was reset, because what was approved is no longer what is on file." : "")
          : "Nothing had changed.");
        await loadAsset(); await loadRevisions();
        setSaving(false);
        return;
      }
      const created = await api.post("/minehub/assets", {
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

      const newId = created.data?.asset_id as number | undefined;
      if (!newId) { onDone(); return; }      // nothing to stay on
      setCreatedId(newId);
      setSaved(snapshot);
      onSaved?.();                           // the register behind is now stale
      if (then === "submit") {
        await api.post(`/minehub/assets/${newId}/submit`, {});
        setNotice("Saved and submitted for approval. Someone else has to approve it.");
      } else {
        setNotice("Saved as draft. Nothing is on the register until it is approved — "
                + "submit it when the details are complete.");
      }
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not register the machine.");
    } finally { setSaving(false); }
  };

  const act = async (what: "submit" | "approve" | "send-back", remarks?: string) => {
    setBusy(what); setError(null);
    try {
      await api.post(`/minehub/assets/${id}/${what}`, { remarks });
      setNotice(what === "approve" ? "Approved onto the register."
        : what === "submit" ? "Submitted for approval."
        : "Sent back for correction.");
      await loadAsset(); await loadRevisions();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not complete that.");
    } finally { setBusy(null); }
  };

  /** Going back, with whatever is unsaved accounted for. */
  const leave = () => { if (dirty) setAsk("leave"); else onCancel(); };

  const discard = async () => {
    setAsk(null);
    setBusy("discard"); setError(null);
    try {
      await api.delete(`/minehub/assets/${id}`);
      onSaved?.();
      onDone();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not discard it.");
    } finally { setBusy(null); }
  };

  const revert = async () => {
    setAsk(null);
    setBusy("revert"); setError(null);
    try {
      const r = await api.post(`/minehub/assets/${id}/revert`, {});
      setNotice(r.data?.changed
        ? `Put back to v${r.data.reverted_to} — ${r.data.changed} field${r.data.changed === 1 ? "" : "s"} restored.`
        : "It already looked like that.");
      await loadAsset(); await loadRevisions(); onSaved?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not undo that.");
    } finally { setBusy(null); }
  };

  const status = String(loaded?.approval_status ?? "DRAFT");
  const statusTone: Tone =
    status === "APPROVED" ? "emerald" : status === "SUBMITTED" ? "amber"
    : status === "SENT_BACK" ? "rose" : "slate";

  const name = String(f.nickname || f.fleet_code || "this draft");

  const dialogs = (
    <>
      <Dialog open={ask === "discard"} tone="danger" title={`Discard ${name}?`}
        confirmLabel="Discard it" cancelLabel="Keep it" busy={busy === "discard"}
        onConfirm={discard} onCancel={() => setAsk(null)}>
        Everything typed into it goes, and it cannot be brought back. The activity
        log keeps the fact that this machine was registered and discarded, so the
        register can still account for the fleet code.
      </Dialog>

      <Dialog open={ask === "revert"} tone="warning" title="Undo the last change?"
        confirmLabel="Put it back" cancelLabel="Leave as is" busy={busy === "revert"}
        onConfirm={revert} onCancel={() => setAsk(null)}>
        The machine goes back to how it was before the most recent edit. The undo
        is itself recorded, so the trail keeps both the change and its reversal.
      </Dialog>

      <Dialog open={ask === "send-back"} tone="warning" title="Send it back for correction"
        confirmLabel="Send it back" cancelLabel="Cancel"
        busy={busy === "send-back" || !sendBackWhy.trim()}
        onConfirm={() => { const why = sendBackWhy.trim(); setAsk(null); setSendBackWhy("");
                           void act("send-back", why); }}
        onCancel={() => { setAsk(null); setSendBackWhy(""); }}>
        Say what needs correcting. Whoever filled this in sees the reason in the
        trail, and a bare rejection only sends the machine round again.
        <textarea id="af-sendback" value={sendBackWhy} rows={3}
          onChange={(e) => setSendBackWhy(e.target.value)}
          placeholder="Chassis number does not match the plate on the machine"
          className="mt-2.5 w-full bg-bg-base border border-border rounded-lg px-3 py-2
                     text-[13px] text-txt-primary placeholder:text-txt-light
                     focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15" />
      </Dialog>

      <Dialog open={ask === "leave"} tone="warning" title="Leave without saving?"
        confirmLabel="Leave, lose the changes" cancelLabel="Stay here"
        onConfirm={() => { setAsk(null); onCancel(); }} onCancel={() => setAsk(null)}>
        This sheet has changes that have not been saved. Saving as a draft keeps
        them — nothing has to be complete for that.
      </Dialog>
    </>
  );

  const messages = (
    <>
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />
    </>
  );

  const sheet = (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={leave}
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
          <button type="button" onClick={() => setShowMissing((v) => !v)}
            title={outstanding.length ? `Still blank: ${outstanding.join(", ")}` : "Nothing outstanding"}>
            <Chip tone={filled > 70 ? "emerald" : filled > 35 ? "amber" : "slate"}>
              {doneCount} of {checklist.length} filled
            </Chip>
          </button>
          <Button size="sm" variant="primary" onClick={() => submit("stay")}
            disabled={saving || !dirty}
            title={dirty ? undefined : "Nothing has changed since the last save"}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    : dirty ? <><Check className="w-3.5 h-3.5" /> {editing ? "Save changes" : "Save as draft"}</>
                    : <><Check className="w-3.5 h-3.5" /> Saved</>}
          </Button>
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
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setAsk("send-back")}>
                <Undo2 className="w-3.5 h-3.5" /> Send back
              </Button>
            </>
          )}
        </div>
      </div>

      {showMissing && outstanding.length > 0 && (
        <Alert tone="info">
          <span className="font-semibold">Still blank:</span>{" "}
          {outstanding.join(" · ")}
          <span className="block text-[11.5px] text-txt-muted mt-1">
            None of these stop you saving a draft. Only a fleet code
            {isHired ? ", an equipment type and the contractor" : " and an equipment type"} are
            needed to send it for approval.
          </span>
        </Alert>
      )}


      {/* ── Identity ─────────────────────────────────────────── */}
      <div>
        <Band title="Identity" hint="The fleet code is the system key; the nickname is what the mine says out loud" />
        <Sheet>
          <Row label="Fleet code" required invalid={invalid.has("fleet_code")}
               hint="Unique. MAN-18, EX-04, DZ-02">
            <input id="af-fleet" className={cellInput} value={f.fleet_code ?? ""}
              onChange={(e) => set("fleet_code", e.target.value)} placeholder="MAN-18" />
          </Row>
          <Row label="Nickname" hint="Shown on handover and operational screens">
            <input id="af-nick" className={cellInput} value={f.nickname ?? ""}
              onChange={(e) => set("nickname", e.target.value)} placeholder="Bada Tipper" />
          </Row>
          <Row label="Equipment type" required invalid={invalid.has("asset_type_id")}
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
              <Row label="Contractor" required invalid={invalid.has("owner_party_id")}>
                <select id="af-owner" className={cellInput} value={f.owner_party_id ?? ""}
                  onChange={(e) => set("owner_party_id", e.target.value)}>
                  <option value="">Select…</option>
                  {parties.map((p) => (
                    <option key={p.party_id} value={p.party_id}>{p.display_name || p.legal_name}</option>
                  ))}
                </select>
              </Row>
              <Row label="Contract no."
                   hint="The contract this machine is engaged under">
                <div className="px-1.5 py-1">
                  <Combobox id="af-contract" category="CONTRACT" value={f.contract_no ?? ""}
                    onChange={(v) => set("contract_no", v)} placeholder="Search or add…" />
                </div>
              </Row>
              <Row label="Service PO no."
                   hint="Work on this machine is billed against this PO — contractor billing reads it">
                <div className="px-1.5 py-1">
                  <Combobox id="af-po" category="SERVICE_PO" value={f.service_po_no ?? ""}
                    onChange={(v) => set("service_po_no", v)} placeholder="Search or add…" />
                </div>
              </Row>
              <Row label="PO valid from">
                <input id="af-povf" type="date" className={cellInput} value={f.po_valid_from ?? ""}
                  onChange={(e) => set("po_valid_from", e.target.value)} />
              </Row>
              <Row label="PO valid to" hint="Expiry is flagged alongside insurance and fitness">
                <input id="af-povt" type="date" className={cellInput} value={f.po_valid_to ?? ""}
                  onChange={(e) => set("po_valid_to", e.target.value)} />
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
              <Row label="SAP equipment no."
                   hint="What SAP calls this machine. A hired machine has a contract and a service PO instead">
                <div className="px-1.5 py-1">
                  <Combobox id="af-sap" category="SAP_EQUIPMENT" value={f.sap_equipment_no ?? ""}
                    onChange={(v) => set("sap_equipment_no", v)}
                    placeholder="Type the number — it is added to the list" />
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
          <Row label="Home location"
               hint="Add a pit, workshop or stockyard here if it is not on the list yet">
            <div className="px-1.5 py-1">
              <Combobox
                id="af-loc"
                options={locations.map((l) => ({ value: l.name, hint: l.location_type }))}
                value={locations.find((l) => String(l.location_id) === f.home_location_id)?.name ?? ""}
                placeholder="Kaliapani, a pit, the workshop…"
                onChange={(name) => {
                  const hit = locations.find((l) => l.name === name);
                  set("home_location_id", hit ? String(hit.location_id) : "");
                }}
                onAddNew={async (name) => {
                  const r = await api.post("/minehub/locations", { name, location_type: "PIT" });
                  const made = { location_id: r.data.location_id, code: r.data.code,
                                 name: r.data.name, location_type: r.data.location_type };
                  setLocations((prev) => prev.some((l) => l.location_id === made.location_id)
                    ? prev : [...prev, made]);
                  set("home_location_id", String(made.location_id));
                  return made.name;
                }} />
            </div>
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
        <Button variant="primary" size="lg" onClick={() => submit("stay")}
          disabled={saving || !dirty}
          title={dirty ? undefined : "Nothing has changed since the last save"}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : dirty ? <><Check className="w-4 h-4" /> {editing ? "Save changes" : "Save as draft"}</>
                  : <><Check className="w-4 h-4" /> Saved</>}
        </Button>
        {!editing && (
          <Button variant="accent" size="lg" onClick={() => submit("submit")} disabled={saving}>
            <Send className="w-4 h-4" /> Save and submit for approval
          </Button>
        )}
        <Button variant="ghost" size="lg" onClick={leave}>
          {editing ? "Back to registry" : "Cancel"}
        </Button>

        {editing && (
          <span className="ml-auto flex flex-wrap gap-2">
            {revisions.length > 1 && (
              <Button variant="secondary" size="lg" disabled={busy !== null} onClick={() => setAsk("revert")}>
                <Undo2 className="w-4 h-4" /> Undo last change
              </Button>
            )}
            {(status === "DRAFT" || status === "SENT_BACK") && (
              <Button variant="danger" size="lg" disabled={busy !== null} onClick={() => setAsk("discard")}>
                <Trash2 className="w-4 h-4" /> Discard draft
              </Button>
            )}
          </span>
        )}
        <p className="w-full text-[11.5px] text-txt-light pt-0.5">
          {editing
            ? "Each save records what changed, against your name, in the trail on the right."
            : "A draft is yours to finish — it stays off the register until someone else approves it."}
        </p>
      </div>
    </div>
  );

  if (!editing) return <>{messages}{dialogs}{sheet}</>;

  // Editing shows the trail beside the sheet: the history is the reason to open
  // an existing machine at all, and putting it below would hide it under a long
  // form.
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
      {messages}
      {dialogs}
      {sheet}
      <div className="xl:sticky xl:top-[86px]">
        <RevisionPanel revisions={revisions} loading={loadingRev} />
      </div>
    </div>
  );
}
