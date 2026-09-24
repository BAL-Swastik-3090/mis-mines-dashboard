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
import DateField from "./DateField";
import { Plus, Trash2, Check, Loader2, Info, ArrowLeft, Send, CheckCircle2, Undo2, Copy, Pencil } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Alert, Button, Chip, type Tone } from "./ui";
import Toast from "./Toast";
import Dialog from "./Dialog";
import RevisionPanel, { type Revision } from "./RevisionPanel";
import Combobox from "./Combobox";
import AssetFiles, { Paperclip } from "./AssetFiles";
import ComplianceHistory from "./ComplianceHistory";
import { ExpiryInput, NumberInput, Th, trimNumber, expiryOf } from "./cells";

interface AssetType { asset_type_id: number; name: string; category: string }
interface Party {
  party_id: number; display_name: string; legal_name: string;
  org_category?: string | null;
}
interface Plant { plant_id: number; code: string; name: string; is_default: boolean }
interface OrgUnit { org_unit_id: number; code: string; name: string }
interface Location { location_id: number; name: string; location_type: string }

interface DocRow {
  document_type: string; document_no: string; provider: string;
  valid_from: string; valid_upto: string; amount: string;
  /** Present once the row exists on file. Absent on a row being added. */
  asset_compliance_id?: number;
  /** What moving the date means. Asked for, never guessed: a renewal
   *  backdated to close a gap looks exactly like a correction, and getting
   *  it wrong either loses last year's cover or invents a renewal that
   *  never happened. */
  change_type?: "CORRECTION" | "RENEWAL";
  change_reason?: string;
  /** What it looked like when the form loaded, so the row can tell whether
   *  it has actually been touched. */
  original?: { valid_from: string; valid_upto: string; document_no: string };
}
interface SchedRow {
  schedule_type: string; name: string; interval_value: string; interval_uom: string;
  last_done_on: string; last_done_reading: string;
}
interface IdentRow { system: string; external_code: string }

// How the known codes are spelled for a person. Not the set of possibilities —
// that lives in the lookup table and the mine adds to it. Anything not here is
// shown as itself, which is why a new type works without touching this file.
const DOC_TYPES: [string, string][] = [
  ["INSURANCE", "Insurance"], ["FITNESS", "Fitness certificate"], ["PUC", "PUC"],
  ["ROAD_TAX", "Road tax"], ["PERMIT", "Permit"], ["NATIONAL_PERMIT", "National permit"],
  ["STATUTORY_INSPECTION", "Statutory inspection"], ["EXPLOSIVE_LICENCE", "Explosive licence"],
  ["POLLUTION_NOC", "Pollution NOC"],
];

/** A stored code as a person would say it. Unknown codes read as themselves. */
const docLabel = (code: string): string =>
  DOC_TYPES.find(([v]) => v === code)?.[1]
  ?? code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** What the mine types back into a code the column can group by. */
const docCode = (label: string): string =>
  DOC_TYPES.find(([, l]) => l.toLowerCase() === label.trim().toLowerCase())?.[0]
  ?? label.trim().toUpperCase().replace(/\s+/g, "_");
/** Where a machine is in its life, in the mine's own words. Changing this is
 *  a decision, not an edit — see migration 036. */
const STAGES: [string, string][] = [
  ["ACTIVE", "Working"],
  ["MAINTENANCE", "In workshop"],
  ["STANDBY", "Standby"],
  ["IDLE", "Idle"],
  ["OFF_ROAD", "Off road"],
  ["CANNIBALISED", "Cannibalised"],
  ["SCRAPPED", "Scrapped"],
  ["DISPOSED", "Disposed"],
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
  plant_id: "af-plant", org_unit_id: "af-dept",
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

  // A machine that already exists opens as a record, not as a form. Landing in
  // an editable sheet makes every visit look like a change in progress, and it
  // is how a field gets nudged by a stray scroll over a number input and saved
  // by somebody who never meant to touch it. A new machine still opens ready to
  // type, because there is nothing to read yet.
  const [mode, setMode] = useState<"view" | "edit">(assetId ? "view" : "edit");
  const reading = mode === "view";

  // Mark the fields that are empty, so read mode can hide what the browser
  // draws into them.
  //
  // A date input with no value renders "dd-mm-yyyy" as shadow-DOM text, not as
  // a placeholder, and CSS cannot select it: an empty optional date is :valid,
  // and there is no :empty for form controls. So the sheet says which are
  // empty and the stylesheet hides those. One effect covers every input on the
  // page, including any added later, which is why it is done here rather than
  // per field.
  const sheetRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = sheetRef.current;
    if (!root) return;
    root.querySelectorAll("input").forEach((el) => {
      if (el.value === "") el.setAttribute("data-empty", "true");
      else el.removeAttribute("data-empty");
    });
  });
  const [types, setTypes] = useState<AssetType[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);

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
  // Opening an existing machine used to render the whole sheet from an empty
  // form for the two seconds the fetch takes: "Machine", "v1", "0 of 14
  // filled", every field blank. None of that was true — MAN-14 is v4 with 11
  // filled — and a page that states facts it has not read yet is worse than
  // one that admits it is still reading. A new machine has nothing to fetch,
  // so it starts ready.
  const [fetching, setFetching] = useState(Boolean(assetId));
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
  // The covering notes already live in the revision trail — SUBMITTED and
  // APPROVED each carry their remark. Reading them from there rather than
  // adding columns to asset keeps one account of what happened, and it is the
  // account the history panel already shows.
  const submittedNote = React.useMemo(
    () => revisions.find((r) => r.action === "SUBMITTED" && r.remarks)?.remarks ?? "",
    [revisions]);
  const approvedNote = React.useMemo(
    () => revisions.find((r) => r.action === "APPROVED" && r.remarks)?.remarks ?? "",
    [revisions]);

  const [ask, setAsk] = useState<
    null | "discard" | "revert" | "leave" | "send-back" | "submit" | "approve">(null);
  const [sendBackWhy, setSendBackWhy] = useState("");
  // What the submitter wants the approver to know, and what the approver wants
  // on the record. Both optional: a machine registered from the plate needs no
  // covering note, and demanding one would only teach people to type a full
  // stop.
  const [submitNote, setSubmitNote] = useState("");
  const [approveNote, setApproveNote] = useState("");
  // Whether this person may accept entries onto the register. Asked rather than
  // assumed, so the button is absent instead of present and refused.
  const [mayApprove, setMayApprove] = useState(false);
  // Read here rather than trusted from the parent: the form is only opened by
  // someone who may manage, but an attach button that appears for a reader is
  // a button that 403s, which reads as broken rather than as forbidden.
  const mayManage = useAuth((state) => state.can)("platform.registry.manage");

  useEffect(() => {
    void (async () => {
      try {
        const [t, p, l, pl, ou] = await Promise.all([
          api.get("/minehub/asset-types"),
          api.get("/minehub/parties", { params: { party_type: "ORGANISATION" } }),
          api.get("/minehub/locations"),
          api.get("/minehub/plants"),
          api.get("/minehub/org-units"),
        ]);
        setTypes(t.data ?? []); setParties(p.data ?? []); setLocations(l.data ?? []);
        setPlants(pl.data ?? []); setOrgUnits(ou.data ?? []);

        // A new machine starts at the default plant — almost every machine
        // registered here is Kaliapani's. It goes into the baseline too, so a
        // value nobody chose does not make the sheet look unsaved.
        if (!assetId) {
          const fallback = (pl.data ?? []).find((x: Plant) => x.is_default);
          if (fallback) {
            setF((prev) => {
              if (prev.plant_id) return prev;
              const next = { ...prev, plant_id: String(fallback.plant_id) };
              setSaved((was) => {
                try {
                  const parts = JSON.parse(was || "[]");
                  if (!parts.length) return was;
                  parts[0] = { ...parts[0], plant_id: String(fallback.plant_id) };
                  return JSON.stringify(parts);
                } catch { return was; }
              });
              return next;
            });
          }
        }
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
      setFetching(true);
      const r = await api.get(`/minehub/assets/${id}`);
      const a = r.data ?? {};
      setLoaded(a);
      // Dates arrive as ISO and the inputs want yyyy-mm-dd; everything else
      // becomes a string because that is what a form field holds.
      //
      // Numbers go through trimNumber on the way in. capacity is
      // numeric(10,3), so 280 comes back as "280.000" and the form showed the
      // scale of the column instead of the value. The scale is right — a
      // capacity can be 2.5 — so it is the display that had to change, here,
      // once, for every numeric field rather than per input.
      const asForm: Record<string, string> = {};
      Object.entries(a).forEach(([k, v]) => {
        if (v === null || v === undefined || typeof v === "object") return;
        asForm[k] = typeof v === "number" ? trimNumber(v) : trimNumber(String(v));
      });
      setF(asForm);
      setDocs((a.documents ?? []).map((d: Record<string, unknown>) => {
        const row = {
          document_type: String(d.document_type ?? "INSURANCE"),
          document_no: String(d.document_no ?? ""), provider: String(d.provider ?? ""),
          valid_from: String(d.valid_from ?? ""), valid_upto: String(d.valid_upto ?? ""),
          amount: trimNumber(d.amount ?? ""),
          asset_compliance_id: d.asset_compliance_id
            ? Number(d.asset_compliance_id) : undefined,
        };
        return {
          ...row,
          original: { valid_from: row.valid_from, valid_upto: row.valid_upto,
                      document_no: row.document_no },
        };
      }));
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
    } finally {
      setFetching(false);
    }
  }, [id]);

  useEffect(() => { void loadAsset(); void loadRevisions(); }, [loadAsset, loadRevisions]);

  useEffect(() => {
    void api.get("/minehub/me")
      .then((r) => setMayApprove(Boolean(r.data?.may_approve)))
      .catch(() => setMayApprove(false));
  }, []);

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
  const chosenType = types.find((t) => String(t.asset_type_id) === f.asset_type_id);
  const typeName = chosenType?.name ?? "";
  const isHired = f.ownership === "HIRED";
  // Haulage is the category that carries something across a weighbridge — the
  // tippers, trailers and dumpers. An excavator's load is in its bucket and is
  // never weighed, and a drill has no load at all.
  const carriesALoad = chosenType?.category === "HAULAGE";

  // The stage only needs explaining when it actually moves. Asking for a
  // reason on every save would train people to type a full stop.
  const stageMoved = editing
    && Boolean(loaded?.status)
    && (f.status ?? "") !== String(loaded?.status ?? "");

  // The combobox speaks in names and the record stores an id, so the two are
  // kept in step here rather than by making either of them pretend.
  const contractorName = React.useMemo(() => {
    const match = parties.find((p) => String(p.party_id) === String(f.owner_party_id ?? ""));
    return match ? (match.display_name || match.legal_name) : "";
  }, [parties, f.owner_party_id]);

  const supplierName = React.useMemo(() => {
    const match = parties.find(
      (p) => String(p.party_id) === String(f.supplier_party_id ?? ""));
    return match ? (match.display_name || match.legal_name) : "";
  }, [parties, f.supplier_party_id]);

  /** Register an organisation that is not on the list yet, without leaving the
   *  form. Refusing would not stop the machine being hired or bought — it would
   *  only mean somebody picks the nearest wrong name, which is how a register
   *  quietly stops being able to answer what a contractor costs.
   *
   *  A name already on file is reused rather than added a second time, matched
   *  without case. "Dashmesh" and "DASHMESH" being two companies is exactly the
   *  fragmentation this field exists to prevent.
   */
  const addOrganisation = async (
    name: string, category: string,
    field: "owner_party_id" | "supplier_party_id",
  ): Promise<string> => {
    const clean = name.trim();
    if (!clean) return "";

    const existing = parties.find(
      (p) => (p.display_name || p.legal_name).toLowerCase() === clean.toLowerCase());
    if (existing) {
      set(field, String(existing.party_id));
      return existing.display_name || existing.legal_name;
    }

    const created = await api.post("/minehub/parties", {
      legal_name: clean, display_name: clean,
      party_type: "ORGANISATION", org_category: category,
    });
    const party: Party = {
      party_id: created.data.party_id, display_name: clean, legal_name: clean,
      org_category: category,
    };
    setParties((was) => [...was, party].sort((a, b) =>
      (a.display_name || a.legal_name).localeCompare(b.display_name || b.legal_name)));
    set(field, String(party.party_id));
    return clean;
  };

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
      { label: "Plant",           done: has("plant_id"),        needed: true },
      { label: "Department",      done: has("org_unit_id"),     needed: true },
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
    // Only for things that carry a load. A drill has no payload and listing it
    // as outstanding on every rig teaches people to ignore the checklist. On a
    // tipper it is the number the weighbridge needs to call a trip overloaded,
    // so its absence is worth showing.
    if (carriesALoad) {
      items.push({ label: "Max load", done: has("payload_capacity_kg"), needed: false });
    }
    return items;
  }, [f, isHired, isElectric, carriesALoad]);

  const doneCount = checklist.filter((i) => i.done).length;
  const filled = Math.round((doneCount / checklist.length) * 100);
  const outstanding = checklist.filter((i) => !i.done).map((i) => i.label);

  /** Raise a message that finds the reader wherever they are on the sheet. */
  const raise = (msg: string) => { setNotice(null); setError(msg); };

  const submit = async (then: "stay" | "submit" = "stay"): Promise<boolean> => {
    if (stageMoved && !(f.stage_reason ?? "").trim()) {
      setInvalid(new Set(["stage_reason"]));
      raise("Say why the stage changed. It is kept against the machine for as "
        + "long as it exists, and it is the sentence somebody will be asked for.");
      return false;
    }

    // A moved date with no answer cannot be saved, because the two answers do
    // different things to the record and neither is a safe default. Guessing
    // would either lose last year's cover or invent a renewal nobody made.
    const unanswered = docs.filter((d) => d.asset_compliance_id && d.original
      && (d.valid_upto !== d.original.valid_upto
          || d.valid_from !== d.original.valid_from
          || d.document_no !== d.original.document_no)
      && !d.change_type);
    if (unanswered.length > 0) {
      raise(`Say whether the ${unanswered.length === 1 ? "change" : "changes"} to `
        + unanswered.map((d) => docLabel(d.document_type).toLowerCase()).join(", ")
        + ` ${unanswered.length === 1 ? "is" : "are"} a renewal or a correction. `
        + "A renewal keeps the old dates on file; a correction replaces them.");
      return false;
    }

    // Only the path that puts this in front of someone else checks for
    // completeness. Saving a draft takes whatever has been typed so far — the
    // rest can be filled in after a walk to the machine.
    if (then === "submit") {
      const needed: [string, string, boolean][] = [
        ["fleet_code",     "a fleet code",                Boolean(f.fleet_code?.trim())],
        ["asset_type_id",  "an equipment type",           Boolean(f.asset_type_id)],
        ["owner_party_id", "the contractor that owns it", !isHired || Boolean(f.owner_party_id)],
        ["plant_id",       "a plant",                     Boolean(f.plant_id)],
        ["org_unit_id",    "a department",                Boolean(f.org_unit_id)],
      ];
      const short = needed.filter(([, , ok]) => !ok);
      if (short.length) {
        setInvalid(new Set(short.map(([k]) => k)));
        raise(`Before this can go for approval it needs ${short.map(([, t]) => t).join(", ")}. `
            + "They are marked below. Save it as a draft meanwhile — nothing typed is lost.");
        // Take the person to the first one; a mark they cannot see helps nobody.
        document.getElementById(FIELD_INPUT[short[0][0]])
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }
      setInvalid(new Set());
    }

    setSaving(true); setError(null);
    try {
      if (editing) {
        // Documents go with the save. They were not being sent at all, so a
        // renewed date enabled the button, posted nothing, and came back
        // "nothing changed" — the edit lost and the message technically true.
        const r = await api.put(`/minehub/assets/${id}`, { ...f, documents: docs });
        setSaved(snapshot);
        const papers = r.data?.documents?.touched
          ? " " + r.data.documents.message : "";
        setNotice(r.data?.changed
          ? `Saved — ${r.data.changed} field${r.data.changed === 1 ? "" : "s"} changed, now v${r.data.version}.${papers}`
             + (r.data.approval_reset ? " Approval was reset, because what was approved is no longer what is on file." : "")
          : papers.trim() || "Nothing had changed.");
        await loadAsset(); await loadRevisions();
        setSaving(false);
        // Back to reading once it is saved. The sheet stops looking like work
        // in progress the moment it stops being any.
        setMode("view");
        return true;
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
      if (!newId) { onDone(); return true; }   // nothing to stay on
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
      return true;
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not register the machine.");
      return false;
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

  /** The answer most people want: keep the work, then go. Leaving is held back
   *  until the save actually lands, or a failed write would take the changes
   *  with it. */
  const saveAndLeave = async () => {
    setBusy("save-leave");
    const stored = await submit("stay");
    setBusy(null);
    if (!stored) { setAsk(null); return; }   // the message says what went wrong
    setAsk(null);
    onSaved?.();
    onDone();
  };

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

      <Dialog open={ask === "submit"} tone="info" title="Submit for approval"
        confirmLabel="Submit it" cancelLabel="Not yet"
        busy={busy === "submit"}
        onConfirm={() => { setAsk(null); void act("submit", submitNote.trim() || undefined); }}
        onCancel={() => { setAsk(null); setSubmitNote(""); }}>
        Whoever approves this sees the note. Say anything they would otherwise
        have to ask — where the papers came from, what is still missing and why,
        which figures were taken from the plate rather than the invoice.
        <textarea id="af-submitnote" value={submitNote} rows={3}
          onChange={(e) => setSubmitNote(e.target.value)}
          placeholder="Chassis and engine read off the machine; insurance copy to follow from the contractor"
          className="mt-2.5 w-full bg-bg-base border border-border rounded-lg px-3 py-2
                     text-[13px] text-txt-primary placeholder:text-txt-light
                     focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15" />
        <span className="block mt-1 text-[11.5px] text-txt-light">
          Optional — a machine registered from the plate needs no covering note.
        </span>
      </Dialog>

      <Dialog open={ask === "approve"} tone="info" title="Accept onto the register"
        confirmLabel="Approve it" cancelLabel="Cancel"
        busy={busy === "approve"}
        onConfirm={() => { setAsk(null); void act("approve", approveNote.trim() || undefined); }}
        onCancel={() => { setAsk(null); setApproveNote(""); }}>
        {submittedNote && (
          <span className="block rounded-lg border border-gold/30 bg-gold/[0.06]
                           px-3 py-2 mb-2.5 text-[12.5px] text-txt-primary">
            <span className="block text-[10.5px] font-bold uppercase tracking-[.1em]
                             text-gold-dark mb-1">They said</span>
            “{submittedNote}”
          </span>
        )}
        Once approved this is what contractor billing and statutory compliance
        are read from. Anything worth knowing later goes on the record now.
        <textarea id="af-approvenote" value={approveNote} rows={2}
          onChange={(e) => setApproveNote(e.target.value)}
          placeholder="Checked against the RC book and the hire agreement"
          className="mt-2.5 w-full bg-bg-base border border-border rounded-lg px-3 py-2
                     text-[13px] text-txt-primary placeholder:text-txt-light
                     focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15" />
        <span className="block mt-1 text-[11.5px] text-txt-light">
          Optional, and kept with the approval.
        </span>
      </Dialog>

      <Dialog open={ask === "leave"} tone="warning" title="Leave without saving?"
        confirmLabel={editing ? "Save and leave" : "Save as draft and leave"}
        cancelLabel="Stay here"
        busy={busy === "save-leave"}
        onConfirm={saveAndLeave}
        onCancel={() => setAsk(null)}
        secondary={{ label: "Leave, lose the changes", tone: "danger",
                     onClick: () => { setAsk(null); onCancel(); } }}>
        This sheet has changes that have not been saved. Keeping them costs
        nothing — a draft does not have to be complete.
      </Dialog>
    </>
  );

  const messages = (
    <>
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />
    </>
  );

  /** The shape of the sheet while it is still being read.
   *
   *  Built to the same proportions as the real thing — the same bands, the
   *  same two columns, the same row height — so nothing moves when the data
   *  arrives. A spinner in the middle of an empty page would also be honest,
   *  but the layout settling under the reader's eyes is the part that feels
   *  broken, and a skeleton costs nothing to avoid it.
   */
  const skeleton = (
    <div className="space-y-4" aria-busy="true" aria-label="Loading this machine">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="h-7 w-28 rounded bg-slate-200/70 animate-pulse mb-2" />
          <div className="h-6 w-56 rounded bg-slate-200/70 animate-pulse" />
          <div className="h-3 w-80 rounded bg-slate-100 animate-pulse mt-2.5" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-16 rounded-full bg-slate-200/70 animate-pulse" />
          <div className="h-6 w-24 rounded-full bg-slate-200/70 animate-pulse" />
          <div className="h-8 w-20 rounded-lg bg-slate-200/70 animate-pulse" />
        </div>
      </div>

      {["Identity", "Ownership & cost", "Capability & fuel"].map((band) => (
        <div key={band}>
          <div className="h-9 rounded-t-xl bg-navy/90" />
          <div className="border border-t-0 border-border rounded-b-xl bg-bg-base">
            {[0, 1, 2, 3].map((row) => (
              <div key={row}
                   className="grid grid-cols-2 border-b border-border-light last:border-0">
                {[0, 1].map((col) => (
                  <div key={col} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-3 w-24 rounded bg-slate-100 animate-pulse" />
                    <div className="h-3 flex-1 max-w-[180px] rounded bg-slate-200/60
                                    animate-pulse" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const sheet = (
    <div className="space-y-4" ref={sheetRef} data-read={reading ? "true" : undefined}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={leave}
            className="inline-flex items-center gap-1.5 mb-2.5 rounded-lg border border-border
                       bg-bg-base px-3 py-1.5 text-[12px] font-bold text-navy shadow-sm
                       hover:border-gold hover:bg-gold/[0.06] hover:shadow
                       focus:outline-none focus:ring-2 focus:ring-gold/25 transition-all">
            <ArrowLeft className="w-4 h-4 text-gold-dark" /> Back to registry
          </button>
          {editing && loaded?.asset_ref ? (
            <button type="button"
              onClick={() => { void navigator.clipboard?.writeText(String(loaded.asset_ref)); 
                               setNotice(`${loaded.asset_ref} copied.`); }}
              title="Our own reference for this machine — copy it"
              className="inline-flex items-center gap-1.5 mb-2 ml-2 rounded-md bg-violet-bg
                         border border-violet-ring px-2 py-1 font-mono text-[11.5px] font-bold
                         text-violet hover:bg-violet/10 transition-colors">
              {String(loaded.asset_ref)} <Copy className="w-3 h-3" />
            </button>
          ) : null}
          <h2 className="font-condensed font-extrabold text-[24px] leading-none text-navy">
            {editing
              ? <>{String(f.nickname || f.fleet_code || "Machine")}<span className="text-gold-dark ml-2 text-[16px] font-mono">v{String(loaded?.version ?? 1)}</span></>
              : <>Register a <span className="text-gold-dark">machine</span></>}
          </h2>
          <p className="text-[12px] text-txt-muted mt-1.5">
            {!editing
              ? "Only fleet code and type are required. What is left blank shows up under Alerts rather than blocking the registration."
              : reading
              ? "Read only. Press Edit to change anything — every change is recorded with its old and new value."
              : "Every change is recorded with its old and new value. Editing an approved machine returns it to draft."}
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
          {reading ? (
            <Button size="sm" variant="primary" onClick={() => setMode("edit")}
              title="Make changes to this machine">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => submit("stay")}
              disabled={saving || !dirty}
              title={dirty ? undefined : "Nothing has changed since the last save"}>
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                      : dirty ? <><Check className="w-3.5 h-3.5" /> {editing ? "Save changes" : "Save as draft"}</>
                      : <><Check className="w-3.5 h-3.5" /> Saved</>}
            </Button>
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


      {/* Disabled for real, not only by appearance. A fieldset turns off every
          control inside it the way the platform expects — keyboard, screen
          reader and autofill all agree the record is not being edited — and
          the CSS above takes away the chrome so it reads as a document rather
          than as a form somebody has greyed out. */}
      <fieldset disabled={reading} className="contents">

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
          <Row label="Category" required
               hint="How the fleet is counted and reported. Diesel, CNG and unpowered all sit under Not electric">
            <div className="flex gap-1.5 px-1.5 py-1">
              {[
                { id: "NON_EV", label: "Not electric" },
                { id: "EV", label: "Electric" },
                { id: "HYBRID", label: "Hybrid" },
              ].map((option) => {
                const chosen = (f.propulsion ?? "NON_EV") === option.id;
                return (
                  <button key={option.id} type="button"
                    onClick={() => {
                      set("propulsion", option.id);
                      // Fuel type follows the first time it is set, so the two
                      // never start out contradicting each other — after that
                      // each is edited on its own.
                      if (option.id === "EV" && !f.fuel_type) set("fuel_type", "ELECTRIC");
                      if (option.id === "HYBRID" && !f.fuel_type) set("fuel_type", "HYBRID");
                    }}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition
                      ${chosen
                        ? option.id === "EV"
                          ? "bg-emerald/10 text-emerald border-emerald/40"
                          : option.id === "HYBRID"
                          ? "bg-sky/10 text-sky border-sky/40"
                          : "bg-navy text-white border-navy"
                        : "bg-white text-txt-muted border-slate-200 hover:bg-slate-50"}`}>
                    {option.label}
                  </button>
                );
              })}
            </div>
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
            <DateField id="af-comm" className={cellInput} value={f.commissioned_on ?? ""} onChange={(v) => set("commissioned_on", v)} />
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
                <div className="px-1.5 py-1">
                  <Combobox id="af-owner"
                    options={parties.map((p) => ({
                      value: p.display_name || p.legal_name,
                      hint: p.org_category ?? undefined,
                    }))}
                    value={contractorName}
                    onChange={(name) => {
                      const match = parties.find(
                        (p) => (p.display_name || p.legal_name) === name);
                      set("owner_party_id", match ? String(match.party_id) : "");
                    }}
                    onAddNew={(name) => addOrganisation(name, "CONTRACTOR", "owner_party_id")}
                    placeholder="Search or add…" />
                </div>
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
                <DateField id="af-povf" className={cellInput} value={f.po_valid_from ?? ""} onChange={(v) => set("po_valid_from", v)} />
              </Row>
              <Row label="PO valid to" hint="Expiry is flagged alongside insurance and fitness">
                <DateField id="af-povt" className={cellInput} value={f.po_valid_to ?? ""} onChange={(v) => set("po_valid_to", v)} />
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
                <DateField id="af-pdate" className={cellInput} value={f.purchase_date ?? ""} onChange={(v) => set("purchase_date", v)} />
              </Row>
              <Row label="Purchase cost (₹)">
                <input id="af-pcost" type="number" className={cellInput} value={f.purchase_cost ?? ""}
                  onChange={(e) => set("purchase_cost", e.target.value)} />
              </Row>
              <Row label="Supplier" hint="Who it was bought from. Not listed? Type it">
                <div className="px-1.5 py-1">
                  <Combobox id="af-supplier"
                    options={parties.map((p) => ({
                      value: p.display_name || p.legal_name,
                      hint: p.org_category ?? undefined,
                    }))}
                    value={supplierName}
                    onChange={(name) => {
                      const match = parties.find(
                        (p) => (p.display_name || p.legal_name) === name);
                      set("supplier_party_id", match ? String(match.party_id) : "");
                    }}
                    onAddNew={(name) => addOrganisation(name, "SUPPLIER",
                                                        "supplier_party_id")}
                    placeholder="Search or add…" />
                </div>
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
          <Row label="Capacity" hint="What the machine is rated at — 320 HP, or 25 MT for a bucket. What a truck carries goes in Max load below.">
            <input id="af-cap" type="number" className={cellInput} value={f.capacity ?? ""}
              onChange={(e) => set("capacity", e.target.value)} placeholder="25" />
          </Row>
          <Row label="Capacity unit">
            <div className="px-1.5 py-1">
              <Combobox id="af-capuom" category="CAPACITY_UOM" value={f.capacity_uom ?? ""}
                onChange={(v) => set("capacity_uom", v)} placeholder="MT, m³…" />
            </div>
          </Row>
          {/* Separate from Capacity on purpose. Both are "capacity" in English
              and they are not the same number: a tipper rated 320 HP carries 25
              tonnes. With nowhere to put the load, people typed the horsepower
              into Capacity, and the weighbridge's overload check — which reads
              this and nothing else — could never fire. */}
          <Row label="Max load (kg)"
               hint="What it may carry, not what the engine makes. The weighbridge flags any trip heavier than this.">
            <div className="flex items-center gap-2">
              <input id="af-payload" type="number" className={cellInput}
                value={f.payload_capacity_kg ?? ""}
                onChange={(e) => set("payload_capacity_kg", e.target.value)}
                placeholder="25000" />
              {/* A mine talks in tonnes and this column is kilograms. Showing
                  the conversion as it is typed is what catches the missing
                  nought before it becomes a tipper rated 25kg. */}
              {Number(f.payload_capacity_kg) > 0 && (
                <span className="text-[11.5px] text-txt-light whitespace-nowrap tabular-nums">
                  = {(Number(f.payload_capacity_kg) / 1000).toLocaleString("en-IN",
                      { maximumFractionDigits: 2 })} tonnes
                </span>
              )}
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
          <Row label="Plant" required invalid={invalid.has("plant_id")}
               hint="The SAP plant this machine belongs to. Kaliapani machines are 1200">
            <select id="af-plant" className={cellInput} value={f.plant_id ?? ""}
              onChange={(e) => set("plant_id", e.target.value)}>
              <option value="">Select…</option>
              {plants.map((pl) => (
                <option key={pl.plant_id} value={pl.plant_id}>{pl.code} · {pl.name}</option>
              ))}
            </select>
          </Row>
          <Row label="Department" required invalid={invalid.has("org_unit_id")}
               hint="Who answers for it day to day. Not on the list? Type it and it is added">
            <div className="px-1.5 py-1">
              <Combobox
                id="af-dept"
                options={orgUnits.map((o) => ({ value: o.name }))}
                value={orgUnits.find((o) => String(o.org_unit_id) === f.org_unit_id)?.name ?? ""}
                placeholder="Type the department — it joins the list"
                onChange={(name) => {
                  const hit = orgUnits.find((o) => o.name === name);
                  set("org_unit_id", hit ? String(hit.org_unit_id) : "");
                }}
                onAddNew={async (name) => {
                  const r = await api.post("/minehub/org-units", { name });
                  const made = { org_unit_id: r.data.org_unit_id, code: r.data.code, name: r.data.name };
                  setOrgUnits((prev) => prev.some((o) => o.org_unit_id === made.org_unit_id)
                    ? prev : [...prev, made]);
                  set("org_unit_id", String(made.org_unit_id));
                  return made.name;
                }} />
            </div>
          </Row>
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
          <Row label="Stage" required
               hint="Where this machine is in its life. Moving it is recorded with a reason — the register has to be able to explain why a tipper stopped working">
            <select id="af-status" className={cellInput} value={f.status ?? "ACTIVE"}
              onChange={(e) => set("status", e.target.value)}>
              {STAGES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Row>
          {stageMoved && (
            <Row label="Why the stage changed" required
                 invalid={invalid.has("stage_reason")}
                 hint="Kept against the machine for as long as it exists. An auditor asking why it was scrapped is asking for this sentence">
              <input id="af-stagewhy" className={cellInput}
                value={f.stage_reason ?? ""}
                placeholder="Engine seized; quote exceeds residual value"
                onChange={(e) => set("stage_reason", e.target.value)} />
            </Row>
          )}
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
            <DateField id="af-readon" className={cellInput} value={f.reading_as_on ?? ""} onChange={(v) => set("reading_as_on", v)} />
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
          right={!reading && <Button size="sm" variant="secondary" onClick={() => setDocs([...docs, emptyDoc("PERMIT")])}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>} />
        <div className="border border-t-0 border-border-light rounded-b-lg overflow-x-auto overflow-y-visible">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="bg-bg-light">
                {([
                  ["Document", "Insurance, fitness…"],
                  ["Number", "e.g. POL/2026/8841"],
                  ["Provider / office", "e.g. New India / Jajpur RTO"],
                  ["Valid from", "dd-mm-yyyy"],
                  ["Valid upto", "dd-mm-yyyy · colour shows expiry"],
                  ["Amount ₹", "e.g. 45000"],
                  ["", ""],
                ] as [string, string][]).map(([h, eg]) => (
                  <Th key={h || "actions"} label={h} example={eg}
                      className="font-condensed" />
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => {
                const onFile = Boolean(d.asset_compliance_id);
                const moved = onFile && d.original
                  && (d.valid_upto !== d.original.valid_upto
                      || d.valid_from !== d.original.valid_from
                      || d.document_no !== d.original.document_no);
                return (
                <React.Fragment key={i}>
                <tr className="border-b border-border-light last:border-0">
                  <td className="w-[190px] px-1.5 py-1">
                    <Combobox category="DOCUMENT_TYPE"
                      value={docLabel(d.document_type)}
                      placeholder="Insurance, fitness…"
                      onChange={(v) => setDocs(docs.map((x, j) => j === i
                        ? { ...x, document_type: docCode(v) } : x))} />
                  </td>
                  <td><input className={cellInput} value={d.document_no} placeholder="Policy / certificate no."
                    onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, document_no: e.target.value } : x))} /></td>
                  <td className="w-[210px] px-1.5 py-1">
                    <Combobox category={d.document_type === "INSURANCE" ? "INSURER" : "ISSUING_AUTHORITY"}
                      value={d.provider} placeholder="Insurer / RTO…"
                      onChange={(v) => setDocs(docs.map((x, j) => j === i ? { ...x, provider: v } : x))} />
                  </td>
                  <td className="w-[140px]"><DateField className={cellInput} value={d.valid_from} onChange={(v) => setDocs(docs.map((x, j) => j === i ? { ...x, valid_from: v } : x))} /></td>
                  {/* The one column people actually read. Red once it has
                      passed, amber inside thirty days, green beyond. */}
                  <td className="w-[150px] px-1.5 py-1">
                    <ExpiryInput value={d.valid_upto}
                      onChange={(v) => setDocs(docs.map((x, j) => j === i
                        ? { ...x, valid_upto: v } : x))} />
                  </td>
                  <td className="w-[110px]">
                    <NumberInput value={d.amount} placeholder="45000"
                      onChange={(v) => setDocs(docs.map((x, j) => j === i
                        ? { ...x, amount: v } : x))} />
                  </td>
                  <td className="w-[46px] text-center">
                    <button onClick={() => setDocs(docs.filter((_, j) => j !== i))}
                      className="text-txt-light hover:text-rose" aria-label="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>

                {/* The question only appears once something has actually moved,
                    and it has to be answered: overwriting on a renewal loses
                    the record that the machine was covered last year, which is
                    the answer an inspector asks for after an incident. */}
                {moved && (
                  <tr className="bg-amber-bg/40 border-b border-border-light">
                    <td colSpan={7} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold text-txt-primary">
                          What kind of change is this?
                        </span>
                        <button type="button"
                          onClick={() => setDocs(docs.map((x, j) => j === i
                            ? { ...x, change_type: "RENEWAL" } : x))}
                          className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition
                            ${d.change_type === "RENEWAL"
                              ? "bg-emerald/10 text-emerald border-emerald/40"
                              : "bg-white text-txt-muted border-slate-200 hover:bg-slate-50"}`}>
                          Renewed
                        </button>
                        <button type="button"
                          onClick={() => setDocs(docs.map((x, j) => j === i
                            ? { ...x, change_type: "CORRECTION" } : x))}
                          className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition
                            ${d.change_type === "CORRECTION"
                              ? "bg-sky/10 text-sky border-sky/40"
                              : "bg-white text-txt-muted border-slate-200 hover:bg-slate-50"}`}>
                          Correcting a mistake
                        </button>
                        {d.change_type === "RENEWAL" && (
                          <span className="text-[11.5px] text-txt-muted">
                            The old certificate is kept, valid until{" "}
                            {d.original?.valid_upto || "—"}.
                          </span>
                        )}
                        {d.change_type === "CORRECTION" && (
                          <input className="flex-1 min-w-[180px] rounded-lg border border-slate-200
                                            px-2 py-1 text-[12px]"
                            placeholder="What was wrong with it? (optional)"
                            value={d.change_reason ?? ""}
                            onChange={(e) => setDocs(docs.map((x, j) => j === i
                              ? { ...x, change_reason: e.target.value } : x))} />
                        )}
                        {!d.change_type && (
                          <span className="text-[11.5px] text-amber font-medium">
                            Choose one — it decides whether the old dates are kept.
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>

      </fieldset>

      {/* Files and history sit outside the disabled fieldset deliberately.
          Everything that accepts typing is switched off while reading, but
          downloading last year's certificate is the main reason to open a
          record at all — and a disabled button cannot be clicked however its
          cursor is styled. They render as their own bordered blocks, so they
          still read as the foot of the documents band. */}
      <div className="-mt-4">
        <div className="border border-t-0 border-border rounded-b-xl bg-bg-base">
          <div className="px-3 pt-2 flex items-center gap-1.5">
            <Paperclip className="w-3.5 h-3.5 text-txt-light" />
            <span className="text-[10.5px] font-bold uppercase tracking-[.12em]
                             text-txt-light font-condensed">Attached files</span>
          </div>
          <AssetFiles assetId={editing ? Number(id) : createdId}
            mayManage={mayManage && !reading}
            attachments={docs
              .filter((d) => d.asset_compliance_id)
              .map((d) => ({ asset_compliance_id: d.asset_compliance_id,
                             document_type: d.document_type,
                             valid_upto: d.valid_upto }))} />
        </div>

        {/* What the certificates used to say. The renewal history was being
            kept and shown nowhere, which is a history nobody trusts is there. */}
        <ComplianceHistory assetId={editing ? Number(id) : createdId} />
      </div>

      <fieldset disabled={reading} className="contents">

      {/* ── Maintenance ──────────────────────────────────────── */}
      <div>
        <Band title="Maintenance schedule"
          hint="Next due is calculated from the interval and the last one done"
          right={!reading && <Button size="sm" variant="secondary" onClick={() => setScheds([...scheds, emptySched()])}>
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
                        <DateField className={cellInput} value={sc.last_done_on} onChange={(v) => setScheds(scheds.map((x, j) => j === i ? { ...x, last_done_on: v } : x))} />
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
          right={!reading && <Button size="sm" variant="secondary"
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

      </fieldset>

      <div className="flex flex-wrap gap-2 pt-1 sticky bottom-0 bg-bg-base/95 backdrop-blur py-3 -mx-1 px-1
                      border-t border-border-light">
        {reading ? (
          <Button variant="primary" size="lg" onClick={() => setMode("edit")}>
            <Pencil className="w-4 h-4" /> Edit this machine
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={() => submit("stay")}
            disabled={saving || !dirty}
            title={dirty ? undefined : "Nothing has changed since the last save"}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                    : dirty ? <><Check className="w-4 h-4" /> {editing ? "Save changes" : "Save as draft"}</>
                    : <><Check className="w-4 h-4" /> Saved</>}
          </Button>
        )}
        {editing && !reading && (
          <Button variant="ghost" size="lg" disabled={saving || dirty}
            onClick={() => setMode("view")}
            title={dirty
              ? "Save the changes first — or leave the sheet to discard them"
              : "Go back to reading this record"}>
            Done editing
          </Button>
        )}
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

  // Nothing about an existing machine is known until it has been read, so
  // nothing about it is claimed until then.
  if (fetching) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_272px] gap-4 items-start">
        {messages}
        {skeleton}
        <div className="xl:sticky xl:top-[86px] space-y-4">
          <div className="h-[120px] rounded-xl bg-bg-base border border-border-light
                          animate-pulse" />
          <div className="h-[200px] rounded-xl bg-bg-base border border-border-light
                          animate-pulse" />
        </div>
      </div>
    );
  }

  if (!editing) return <>{messages}{dialogs}{sheet}</>;

  // Editing shows the trail beside the sheet: the history is the reason to open
  // an existing machine at all, and putting it below would hide it under a long
  // form.
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_272px] gap-4 items-start">
      {messages}
      {dialogs}
      {sheet}
      <div className="xl:sticky xl:top-[86px] space-y-4">
        {/* Above the trail, because approving and reading the history are the
            same job: you look at what changed, then you decide. */}
        <div className="bg-bg-base border border-border-light rounded-xl shadow-sm overflow-hidden">
          <header className="px-3 py-2.5 border-b border-border-light flex items-center justify-between gap-2">
            <h3 className="font-condensed font-bold text-[11.5px] uppercase tracking-[.09em] text-navy
                           flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-gold" /> Approval
            </h3>
            <Chip tone={statusTone}>{status.replace("_", " ").toLowerCase()}</Chip>
          </header>

          <div className="p-3 space-y-2">
            <p className="text-[11.5px] text-txt-muted leading-relaxed">
              {status === "APPROVED"
                ? "On the register. Editing it returns it to draft, since what was approved would no longer be what is on file."
                : status === "SUBMITTED"
                ? "Waiting for someone other than whoever submitted it."
                : status === "SENT_BACK"
                ? "Sent back for correction — the reason is in the trail below."
                : "A draft. It stays off the register until it is approved."}
            </p>

            {(status === "DRAFT" || status === "SENT_BACK") && (
              <Button variant="accent" size="md" disabled={busy !== null}
                className="w-full justify-center" onClick={() => setAsk("submit")}>
                <Send className="w-4 h-4" /> Submit for approval
              </Button>
            )}

            {/* The covering note, in front of the person deciding. Reading it
                in the trail below means scrolling past it, and a note nobody
                reads is a note nobody writes. */}
            {status === "SUBMITTED" && submittedNote && (
              <div className="rounded-lg border border-gold/30 bg-gold/[0.06] px-3 py-2">
                <p className="text-[10.5px] font-bold uppercase tracking-[.1em]
                              text-gold-dark mb-1">
                  From whoever submitted it
                </p>
                <p className="text-[12.5px] text-txt-primary leading-relaxed">
                  “{submittedNote}”
                </p>
              </div>
            )}

            {status === "APPROVED" && approvedNote && (
              <div className="rounded-lg border border-emerald/25 bg-emerald/[0.06] px-3 py-2">
                <p className="text-[10.5px] font-bold uppercase tracking-[.1em]
                              text-emerald mb-1">
                  Noted on approval
                </p>
                <p className="text-[12.5px] text-txt-primary leading-relaxed">
                  “{approvedNote}”
                </p>
              </div>
            )}

            {status === "SUBMITTED" && !mayApprove && (
              <p className="text-[12px] text-txt-light border-t border-border-light pt-2.5">
                Approving is a separate permission, which you do not hold. An
                Access Manager grants it under Access Control.
              </p>
            )}

            {status === "SUBMITTED" && mayApprove && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="success" size="md" disabled={busy !== null}
                  className="justify-center" onClick={() => setAsk("approve")}>
                  <CheckCircle2 className="w-4 h-4" /> Approve
                </Button>
                <Button variant="danger" size="md" disabled={busy !== null}
                  className="justify-center" onClick={() => setAsk("send-back")}>
                  <Undo2 className="w-4 h-4" /> Send back
                </Button>
              </div>
            )}
          </div>
        </div>

        <RevisionPanel revisions={revisions} loading={loadingRev} />
      </div>
    </div>
  );
}
