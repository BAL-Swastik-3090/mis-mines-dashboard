"use client";
/**
 * Operator 360 — one person, on one screen.
 *
 * The profile has twenty-odd sections and nobody fills them in one sitting, so
 * they are tabs rather than a single scroll: someone entering licences works in
 * Documents, a training officer works in Competency, and neither has to walk
 * past the other's fields. What they share is the header — name, reference,
 * status, what is outstanding — which stays put whichever tab is open.
 *
 * The rules are the equipment form's rules, because they were right there too:
 * save a draft with almost nothing, check completeness only at submission, mark
 * the fields that blocked it, keep the trail beside the sheet, and never let
 * one person both submit and approve.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check, Loader2, ArrowLeft, Send, CheckCircle2, Undo2, Trash2, Plus, Copy,
  User, Briefcase, FileText, ShieldCheck, Cpu, Link2,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Chip, Tabs, type Tone } from "./ui";
import { Band, Row, Sheet, cellInput } from "./sheet";
import Combobox from "./Combobox";
import Toast from "./Toast";
import Dialog from "./Dialog";
import RevisionPanel, { type Revision } from "./RevisionPanel";

type TabId = "personal" | "employment" | "documents" | "competency" | "machines" | "identity";

const TABS: { id: TabId; label: string; icon: React.ElementType; tone: Tone }[] = [
  { id: "personal",   label: "Personal",   icon: User,        tone: "sky" },
  { id: "employment", label: "Employment", icon: Briefcase,   tone: "violet" },
  { id: "documents",  label: "Documents",  icon: FileText,    tone: "amber" },
  { id: "competency", label: "Competency", icon: ShieldCheck, tone: "emerald" },
  { id: "machines",   label: "Machines",   icon: Cpu,         tone: "teal" },
  { id: "identity",   label: "Identity",   icon: Link2,       tone: "rose" },
];

interface Rec {
  operator_record_id?: number;
  record_type: string; title?: string | null; category?: string | null;
  document_no?: string | null; issuer?: string | null; issued_on?: string | null;
  valid_from?: string | null; valid_upto?: string | null; refresher_due?: string | null;
  result?: string | null; score?: number | null; restrictions?: string | null;
  verification_status?: string; verified_by?: string | null; document_ref?: string | null;
  details?: Record<string, unknown>;
}

interface Comp {
  operator_competency_id?: number; asset_type_id: number | null; asset_type?: string | null;
  dimension: string; level: number | null; assessment_type?: string | null;
  assessor?: string | null; assessed_on?: string | null; result?: string | null;
  valid_upto?: string | null;
}

interface Assignment {
  operator_assignment_id: number; asset_id: number; fleet_code: string;
  nickname?: string | null; asset_type?: string | null; shift?: string | null;
  role: string; valid_from: string; valid_to?: string | null; status: string;
}

interface Ident { party_identity_id: number; system: string; external_code: string }
interface AssetType { asset_type_id: number; name: string }
interface Asset { asset_id: number; fleet_code: string; nickname?: string | null; asset_type?: string | null }
interface Plant { plant_id: number; code: string; name: string; is_default: boolean }
interface OrgUnit { org_unit_id: number; code: string; name: string }
interface Party { party_id: number; display_name: string }

/** The record kinds the form offers, grouped as people think of them. */
const RECORD_KINDS: { value: string; label: string; group: string }[] = [
  { value: "LICENCE",              label: "Driving licence",      group: "Statutory" },
  { value: "MEDICAL",              label: "Medical fitness",      group: "Statutory" },
  { value: "AUTHORISATION",        label: "Internal authorisation", group: "Statutory" },
  { value: "CERTIFICATE",          label: "Certificate",          group: "Statutory" },
  { value: "TRAINING",             label: "Training",             group: "Training" },
  { value: "SPECIALIZED_TRAINING", label: "Specialised training", group: "Training" },
  { value: "EDUCATION",            label: "Education",            group: "Background" },
  { value: "LANGUAGE",             label: "Language",             group: "Background" },
  { value: "EXPERIENCE",           label: "Previous experience",  group: "Background" },
  { value: "SAFETY_OBSERVATION",   label: "Safety observation",   group: "Safety" },
  { value: "SAFETY_INCIDENT",      label: "Safety incident",      group: "Safety" },
];

/** The fourteen understanding questions, beside the competency level itself. */
const DIMENSIONS: { id: string; label: string }[] = [
  { id: "OVERALL",             label: "Overall competency" },
  { id: "FAMILIARITY",         label: "Machine familiarity" },
  { id: "CONTROLS",            label: "Controls" },
  { id: "OPERATING_PROCEDURE", label: "Operating procedure" },
  { id: "PRE_START",           label: "Pre-start inspection" },
  { id: "SAFETY_SYSTEMS",      label: "Safety systems" },
  { id: "EMERGENCY_SHUTDOWN",  label: "Emergency shutdown" },
  { id: "RATED_CAPACITY",      label: "Rated capacity" },
  { id: "OPERATING_LIMITS",    label: "Operating limits" },
  { id: "ATTACHMENTS",         label: "Attachments" },
  { id: "FLUID_CHECKS",        label: "Fuel and fluid checks" },
  { id: "FAULT_RECOGNITION",   label: "Fault recognition" },
  { id: "TELEMATICS",          label: "Display and telematics" },
  { id: "PARKING_SHUTDOWN",    label: "Safe parking and shutdown" },
  { id: "SITE_SOP",            label: "Mine-specific SOP" },
];

const LEVELS = ["Not assessed", "Basic / assisted", "Operational", "Competent / independent", "Advanced / trainer"];
const LEVEL_TONE: Tone[] = ["slate", "rose", "amber", "emerald", "violet"];
const CAPABILITY = ["Cannot", "Basic", "Functional", "Good", "Advanced"];

const emptyRecord = (kind: string): Rec => ({
  record_type: kind, title: "", document_no: "", issuer: "",
  valid_from: "", valid_upto: "", verification_status: "PENDING",
});

export default function OperatorForm({ operatorId, prefill, onSaved, onDone, onCancel }: {
  operatorId?: number;
  prefill?: { display_name?: string; code?: string };
  onSaved?: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [createdId, setCreatedId] = useState<number | null>(null);
  const id = operatorId ?? createdId;
  const editing = Boolean(id);

  const [tab, setTab] = useState<TabId>("personal");
  const [f, setF] = useState<Record<string, string>>({
    display_name: prefill?.display_name ?? "", employment_type: "OWN", profile_status: "ACTIVE",
  });
  const [loaded, setLoaded] = useState<Record<string, unknown> | null>(null);
  const [records, setRecords] = useState<Rec[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [idents, setIdents] = useState<Ident[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);

  const [types, setTypes] = useState<AssetType[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [rights, setRights] = useState({ may_manage: false, may_assess: false, may_approve: false });

  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState("");
  const [ask, setAsk] = useState<null | "discard" | "leave" | "send-back">(null);
  const [sendBackWhy, setSendBackWhy] = useState("");

  // Which equipment class the competency tab is showing.
  const [compType, setCompType] = useState<string>("");

  const raise = (msg: string) => { setNotice(null); setError(msg); };

  const snapshot = useMemo(() => JSON.stringify(f), [f]);
  const dirty = snapshot !== saved;

  useEffect(() => {
    if (dirty) {
      const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
      window.addEventListener("beforeunload", warn);
      return () => window.removeEventListener("beforeunload", warn);
    }
  }, [dirty]);

  // ── reference data ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [t, a, pl, ou, pa, me] = await Promise.all([
          api.get("/minehub/asset-types"),
          api.get("/minehub/assets"),
          api.get("/minehub/plants"),
          api.get("/minehub/org-units"),
          api.get("/minehub/parties", { params: { party_type: "ORGANISATION" } }),
          api.get("/operators/meta/me"),
        ]);
        setTypes(t.data ?? []); setAssets(a.data ?? []); setPlants(pl.data ?? []);
        setOrgUnits(ou.data ?? []); setParties(pa.data ?? []);
        setRights({ may_manage: Boolean(me.data?.may_manage),
                    may_assess: Boolean(me.data?.may_assess),
                    may_approve: Boolean(me.data?.may_approve) });

        if (!operatorId) {
          const fallback = (pl.data ?? []).find((x: Plant) => x.is_default);
          if (fallback) setF((prev) => prev.plant_id ? prev : { ...prev, plant_id: String(fallback.plant_id) });
        }
      } catch { /* the pickers are simply empty */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A blank new form is not unsaved work; a prefilled one is.
  useEffect(() => {
    if (!operatorId && !prefill?.display_name) {
      setSaved(JSON.stringify({ display_name: "", employment_type: "OWN", profile_status: "ACTIVE" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProfile = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get(`/operators/${id}`);
      const p = r.data ?? {};
      setLoaded(p);
      const asForm: Record<string, string> = {};
      Object.entries(p).forEach(([k, v]) => {
        if (v === null || v === undefined || typeof v === "object") return;
        asForm[k] = String(v);
      });
      setF(asForm);
      setSaved(JSON.stringify(asForm));
      setRecords(p.records ?? []);
      setComps(p.competencies ?? []);
      setAssignments(p.assignments ?? []);
      setIdents(p.identities ?? []);
    } catch {
      raise("Could not load this profile.");
    }
  }, [id]);

  const loadRevisions = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get(`/operators/${id}/revisions`);
      setRevisions(r.data ?? []);
    } catch { setRevisions([]); }
  }, [id]);

  useEffect(() => { void loadProfile(); void loadRevisions(); }, [loadProfile, loadRevisions]);

  const set = (k: string, v: string) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setInvalid((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev); next.delete(k); return next;
    });
  };

  // ── saving ─────────────────────────────────────────────────────────────────
  const submit = async (then: "stay" | "submit" = "stay"): Promise<boolean> => {
    if (then === "submit") {
      const needed: [string, string, boolean][] = [
        ["display_name",    "a name",              Boolean(f.display_name?.trim())],
        ["employment_type", "an employment type",  Boolean(f.employment_type)],
        ["plant_id",        "a plant",             Boolean(f.plant_id)],
      ];
      const short = needed.filter(([, , ok]) => !ok);
      if (short.length) {
        setInvalid(new Set(short.map(([k]) => k)));
        setTab("personal");
        raise(`Before this can go for approval it needs ${short.map(([, t]) => t).join(", ")}. `
            + "They are marked below. Save it as a draft meanwhile — nothing typed is lost.");
        return false;
      }
      setInvalid(new Set());
    }

    setSaving(true); setError(null);
    try {
      if (editing) {
        const r = await api.put(`/operators/${id}`, f);
        setSaved(snapshot);
        setNotice(r.data?.changed
          ? `Saved — ${r.data.changed} field${r.data.changed === 1 ? "" : "s"} changed.`
            + (r.data.approval_reset ? " Approval was reset, because what was approved is no longer what is on file." : "")
          : "Nothing had changed.");
        if (then === "submit") {
          await api.post(`/operators/${id}/submit`, {});
          setNotice("Submitted for approval. Someone else has to approve it.");
        }
        await loadProfile(); await loadRevisions(); onSaved?.();
        return true;
      }

      const created = await api.post("/operators", {
        ...f,
        identities: prefill?.code ? [{ system: "DRIVER_MASTER", external_code: prefill.code }] : [],
      });
      const newId = created.data?.operator_id as number | undefined;
      if (!newId) { onDone(); return true; }
      setCreatedId(newId);
      setSaved(snapshot);
      onSaved?.();
      if (then === "submit") {
        await api.post(`/operators/${newId}/submit`, {});
        setNotice("Saved and submitted for approval.");
      } else {
        setNotice(`Saved as draft — ${created.data.operator_ref}. `
                + "Documents, competency and assignment can be added from the tabs above.");
      }
      return true;
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not save this profile.");
      return false;
    } finally { setSaving(false); }
  };

  const leave = () => { if (dirty) setAsk("leave"); else onCancel(); };

  const saveAndLeave = async () => {
    setBusy("save-leave");
    const stored = await submit("stay");
    setBusy(null);
    setAsk(null);
    if (stored) { onSaved?.(); onDone(); }
  };

  const act = async (what: "submit" | "approve" | "send-back", remarks?: string) => {
    setBusy(what); setError(null);
    try {
      await api.post(`/operators/${id}/${what}`, { remarks });
      setNotice(what === "approve" ? "Approved onto the register."
        : what === "submit" ? "Submitted for approval."
        : "Sent back for correction.");
      await loadProfile(); await loadRevisions(); onSaved?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not complete that.");
    } finally { setBusy(null); }
  };

  const discard = async () => {
    setAsk(null); setBusy("discard");
    try {
      await api.delete(`/operators/${id}`);
      onSaved?.(); onDone();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not discard it.");
    } finally { setBusy(null); }
  };

  // ── the repeating pieces ───────────────────────────────────────────────────
  const saveRecord = async (rec: Rec) => {
    if (!id) { raise("Save the profile first — records hang off a person."); return; }
    try {
      if (rec.operator_record_id) {
        await api.put(`/operators/${id}/records/${rec.operator_record_id}`, rec);
      } else {
        await api.post(`/operators/${id}/records`, rec);
      }
      await loadProfile();
      setNotice("Record saved.");
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not save that record.");
    }
  };

  const removeRecord = async (recordId?: number) => {
    if (!id || !recordId) { setRecords((prev) => prev.filter((r) => r.operator_record_id)); return; }
    try {
      await api.delete(`/operators/${id}/records/${recordId}`);
      await loadProfile();
    } catch { raise("Could not remove that record."); }
  };

  const setLevel = async (assetTypeId: number, dimension: string, level: number) => {
    if (!id) { raise("Save the profile first."); return; }
    try {
      await api.post(`/operators/${id}/competency`, {
        asset_type_id: assetTypeId, dimension, level,
        assessment_type: "PRACTICAL", result: level >= 2 ? "PASS" : "PENDING",
        assessed_on: new Date().toISOString().slice(0, 10),
      });
      await loadProfile();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not record that assessment.");
    }
  };

  const assign = async (assetId: number, shift: string, role: string) => {
    if (!id) return;
    try {
      const r = await api.post(`/operators/${id}/assignments`, { asset_id: assetId, shift, role });
      const el = r.data?.eligibility;
      await loadProfile();
      setNotice(el?.status === "ELIGIBLE"
        ? "Assigned."
        : `Assigned, but noted: ${[...(el?.blockers ?? []), ...(el?.warnings ?? [])].join("; ")}`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not assign.");
    }
  };

  const addIdentity = async (system: string, code: string) => {
    if (!id) return;
    try {
      await api.post(`/operators/${id}/identities`, { system, external_code: code });
      await loadProfile();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not link that code.");
    }
  };

  // ── derived ────────────────────────────────────────────────────────────────
  const status = String(loaded?.approval_status ?? "DRAFT");
  const statusTone: Tone =
    status === "APPROVED" ? "emerald" : status === "SUBMITTED" ? "amber"
    : status === "SENT_BACK" ? "rose" : "slate";

  const checklist = useMemo(() => {
    const has = (k: string) => Boolean((f[k] ?? "").toString().trim());
    return [
      { label: "Name", done: has("display_name") },
      { label: "Employment type", done: has("employment_type") },
      { label: "Plant", done: has("plant_id") },
      { label: "Department", done: has("org_unit_id") },
      { label: "Designation", done: has("designation") },
      { label: "Date of birth", done: has("date_of_birth") },
      { label: "Blood group", done: has("blood_group") },
      { label: "Phone", done: has("phone") },
      { label: "Emergency contact", done: has("emergency_contact_phone") },
      { label: "HEMM experience", done: has("exp_hemm_months") },
      { label: "Licence", done: records.some((r) => r.record_type === "LICENCE") },
      { label: "Medical", done: records.some((r) => r.record_type === "MEDICAL") },
      { label: "Competency", done: comps.some((c) => c.dimension === "OVERALL" && (c.level ?? 0) >= 2) },
    ];
  }, [f, records, comps]);

  const done = checklist.filter((c) => c.done).length;
  const outstanding = checklist.filter((c) => !c.done).map((c) => c.label);

  const levelFor = (assetTypeId: number, dimension: string): number =>
    comps.find((c) => c.asset_type_id === assetTypeId && c.dimension === dimension)?.level ?? 0;

  const name = String(f.display_name || "this profile");

  // ── the messages and the questions ────────────────────────────────────────
  const messages = (
    <>
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />
    </>
  );

  const dialogs = (
    <>
      <Dialog open={ask === "discard"} tone="danger" title={`Discard ${name}?`}
        confirmLabel="Discard it" cancelLabel="Keep it" busy={busy === "discard"}
        onConfirm={discard} onCancel={() => setAsk(null)}>
        Everything typed into this profile goes, including documents and
        assessments. The activity log keeps the fact that it existed.
      </Dialog>

      <Dialog open={ask === "send-back"} tone="warning" title="Send it back for correction"
        confirmLabel="Send it back" cancelLabel="Cancel"
        busy={busy === "send-back" || !sendBackWhy.trim()}
        onConfirm={() => { const why = sendBackWhy.trim(); setAsk(null); setSendBackWhy("");
                           void act("send-back", why); }}
        onCancel={() => { setAsk(null); setSendBackWhy(""); }}>
        Say what needs correcting. Whoever filled this in sees the reason in the
        trail, and a bare rejection only sends it round again.
        <textarea id="op-sendback" rows={3} value={sendBackWhy}
          onChange={(e) => setSendBackWhy(e.target.value)}
          placeholder="Licence number does not match the document attached"
          className="mt-2.5 w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]
                     text-txt-primary placeholder:text-txt-light focus:outline-none
                     focus:border-gold focus:ring-2 focus:ring-gold/15" />
      </Dialog>

      <Dialog open={ask === "leave"} tone="warning" title="Leave without saving?"
        confirmLabel={editing ? "Save and leave" : "Save as draft and leave"}
        cancelLabel="Stay here" busy={busy === "save-leave"}
        onConfirm={saveAndLeave} onCancel={() => setAsk(null)}
        secondary={{ label: "Leave, lose the changes", tone: "danger",
                     onClick: () => { setAsk(null); onCancel(); } }}>
        This profile has changes that have not been saved. Keeping them costs
        nothing — a draft does not have to be complete.
      </Dialog>
    </>
  );

  // ── the sheet ──────────────────────────────────────────────────────────────
  const sheet = (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={leave}
            className="inline-flex items-center gap-1.5 mb-2.5 rounded-lg border border-border
                       bg-bg-base px-3 py-1.5 text-[12px] font-bold text-navy shadow-sm
                       hover:border-gold hover:bg-gold/[0.06] transition-all">
            <ArrowLeft className="w-4 h-4 text-gold-dark" /> Back to register
          </button>
          {editing && loaded?.operator_ref ? (
            <button type="button" title="Our own reference for this person — copy it"
              onClick={() => { void navigator.clipboard?.writeText(String(loaded.operator_ref));
                               setNotice(`${loaded.operator_ref} copied.`); }}
              className="inline-flex items-center gap-1.5 mb-2 ml-2 rounded-md bg-violet-bg
                         border border-violet-ring px-2 py-1 font-mono text-[11.5px] font-bold
                         text-violet hover:bg-violet/10 transition-colors">
              {String(loaded.operator_ref)} <Copy className="w-3 h-3" />
            </button>
          ) : null}
          <h2 className="font-condensed font-extrabold text-[24px] leading-none text-navy">
            {editing ? name : <>Register an <span className="text-gold-dark">operator</span></>}
          </h2>
          <p className="text-[12px] text-txt-muted mt-1.5">
            {editing
              ? "Every change is recorded with its old and new value. Editing an approved profile returns it to draft."
              : "A name is enough to start. Documents, competency and assignment follow once the profile exists."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {editing && <Chip tone={statusTone}>{status.replace("_", " ").toLowerCase()}</Chip>}
          <Chip tone={done > 9 ? "emerald" : done > 4 ? "amber" : "slate"}
                title={outstanding.length ? `Still blank: ${outstanding.join(", ")}` : "Nothing outstanding"}>
            {done} of {checklist.length} filled
          </Chip>
          <Button size="sm" variant="primary" onClick={() => submit("stay")}
            disabled={saving || !dirty}
            title={dirty ? undefined : "Nothing has changed since the last save"}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    : dirty ? <><Check className="w-3.5 h-3.5" /> {editing ? "Save changes" : "Save as draft"}</>
                    : <><Check className="w-3.5 h-3.5" /> Saved</>}
          </Button>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={(t) => setTab(t as TabId)} />

      {!editing && tab !== "personal" && (
        <Alert tone="info">
          Save the profile first — documents, competency and assignments hang off
          a person, so there has to be one to hang them on.
        </Alert>
      )}

      {/* ── Personal ─────────────────────────────────────────────────── */}
      {tab === "personal" && (
        <div>
          <Band title="Who they are"
                hint="Blood group and date of birth are asked for at the first aid post, not for decoration" />
          <Sheet>
            <Row label="Full name" required invalid={invalid.has("display_name")}>
              <input id="op-name" className={cellInput} value={f.display_name ?? ""}
                onChange={(e) => set("display_name", e.target.value)} placeholder="As written on the licence" />
            </Row>
            <Row label="Date of birth">
              <input id="op-dob" type="date" className={cellInput} value={f.date_of_birth ?? ""}
                onChange={(e) => set("date_of_birth", e.target.value)} />
            </Row>
            <Row label="Gender">
              <select id="op-gender" className={cellInput} value={f.gender ?? ""}
                onChange={(e) => set("gender", e.target.value)}>
                <option value="">Select…</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </Row>
            <Row label="Blood group" hint="Asked for first, in the event nobody wants">
              <div className="px-1.5 py-1">
                <Combobox id="op-blood" category="BLOOD_GROUP" value={f.blood_group ?? ""}
                  onChange={(v) => set("blood_group", v)} placeholder="B+, O−…" />
              </div>
            </Row>
            <Row label="Mobile">
              <input id="op-phone" className={cellInput} value={f.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)} placeholder="10 digits" />
            </Row>
            <Row label="Alternate contact">
              <input id="op-phone2" className={cellInput} value={f.alternate_phone ?? ""}
                onChange={(e) => set("alternate_phone", e.target.value)} />
            </Row>
            <Row label="Emergency contact">
              <input id="op-ec" className={cellInput} value={f.emergency_contact_name ?? ""}
                onChange={(e) => set("emergency_contact_name", e.target.value)} placeholder="Name" />
            </Row>
            <Row label="Emergency number">
              <input id="op-ecp" className={cellInput} value={f.emergency_contact_phone ?? ""}
                onChange={(e) => set("emergency_contact_phone", e.target.value)} />
            </Row>
            <Row label="Relationship">
              <input id="op-ecr" className={cellInput} value={f.emergency_contact_relation ?? ""}
                onChange={(e) => set("emergency_contact_relation", e.target.value)} placeholder="Wife, brother…" />
            </Row>
            <Row label="Profile status">
              <select id="op-status" className={cellInput} value={f.profile_status ?? "ACTIVE"}
                onChange={(e) => set("profile_status", e.target.value)}>
                {["ACTIVE", "INACTIVE", "SUSPENDED", "RETIRED"].map((s) => (
                  <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </Row>
            <Row label="Current address" wide>
              <input id="op-addr" className={cellInput} value={f.current_address ?? ""}
                onChange={(e) => set("current_address", e.target.value)} />
            </Row>
            <Row label="Permanent address" wide>
              <input id="op-addr2" className={cellInput} value={f.permanent_address ?? ""}
                onChange={(e) => set("permanent_address", e.target.value)} />
            </Row>
          </Sheet>

          <div className="mt-4">
            <Band title="Literacy"
                  hint="Kept apart from education on purpose: a diploma says nothing about whether someone can read a safety sign" />
            <Sheet>
              {[
                ["reading_level", "Reading"], ["writing_level", "Writing"],
                ["numeracy_level", "Numbers"], ["digital_level", "Digital"],
                ["safety_sign_level", "Safety signs"], ["record_keeping_level", "Forms and records"],
              ].map(([key, label]) => (
                <Row key={key} label={label}>
                  <select id={`op-${key}`} className={cellInput} value={f[key] ?? ""}
                    onChange={(e) => set(key, e.target.value)}>
                    <option value="">Not recorded</option>
                    {CAPABILITY.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Row>
              ))}
            </Sheet>
          </div>
        </div>
      )}

      {/* ── Employment and experience ───────────────────────────────── */}
      {tab === "employment" && (
        <div>
          <Band title="Employment" hint="An attribute of the person, not the shape of the record" />
          <Sheet>
            <Row label="Employment type" required invalid={invalid.has("employment_type")}>
              <select id="op-emptype" className={cellInput} value={f.employment_type ?? "OWN"}
                onChange={(e) => set("employment_type", e.target.value)}>
                <option value="OWN">Own (BAL)</option>
                <option value="CONTRACT">Contractor</option>
                <option value="TRAINEE">Trainee</option>
                <option value="OTHER">Other</option>
              </select>
            </Row>
            <Row label="Employer / agency">
              <select id="op-employer" className={cellInput} value={f.employer_party_id ?? ""}
                onChange={(e) => set("employer_party_id", e.target.value)}>
                <option value="">Select…</option>
                {parties.map((p) => (
                  <option key={p.party_id} value={p.party_id}>{p.display_name}</option>
                ))}
              </select>
            </Row>
            <Row label="Plant" required invalid={invalid.has("plant_id")}>
              <select id="op-plant" className={cellInput} value={f.plant_id ?? ""}
                onChange={(e) => set("plant_id", e.target.value)}>
                <option value="">Select…</option>
                {plants.map((p) => (
                  <option key={p.plant_id} value={p.plant_id}>{p.code} · {p.name}</option>
                ))}
              </select>
            </Row>
            <Row label="Department" hint="Not on the list? Type it and it is added">
              <div className="px-1.5 py-1">
                <Combobox id="op-dept"
                  options={orgUnits.map((o) => ({ value: o.name }))}
                  value={orgUnits.find((o) => String(o.org_unit_id) === f.org_unit_id)?.name ?? ""}
                  placeholder="Mining Operations…"
                  onChange={(n) => {
                    const hit = orgUnits.find((o) => o.name === n);
                    set("org_unit_id", hit ? String(hit.org_unit_id) : "");
                  }}
                  onAddNew={async (n) => {
                    const r = await api.post("/minehub/org-units", { name: n });
                    setOrgUnits((prev) => [...prev, r.data]);
                    set("org_unit_id", String(r.data.org_unit_id));
                    return r.data.name;
                  }} />
              </div>
            </Row>
            <Row label="Designation">
              <div className="px-1.5 py-1">
                <Combobox id="op-desig" category="DESIGNATION" value={f.designation ?? ""}
                  onChange={(v) => set("designation", v)} placeholder="Excavator Operator, Tipper Driver…" />
              </div>
            </Row>
            <Row label="Shift pattern">
              <div className="px-1.5 py-1">
                <Combobox id="op-shift" category="SHIFT_PATTERN" value={f.shift_pattern ?? ""}
                  onChange={(v) => set("shift_pattern", v)} placeholder="Rotating A/B/C, General…" />
              </div>
            </Row>
            <Row label="Joined on">
              <input id="op-joined" type="date" className={cellInput} value={f.joined_on ?? ""}
                onChange={(e) => set("joined_on", e.target.value)} />
            </Row>
            <Row label="Employment end" hint="Leave blank while they are still working here">
              <input id="op-end" type="date" className={cellInput} value={f.employment_end ?? ""}
                onChange={(e) => set("employment_end", e.target.value)} />
            </Row>
          </Sheet>

          <div className="mt-4">
            <Band title="Experience"
                  hint="In months, so it can be added up. Declared is what they say; verified is what someone checked" />
            <Sheet>
              {[
                ["exp_total_months", "Total work"], ["exp_mining_months", "Mining"],
                ["exp_hemm_months", "HEMM"], ["exp_operator_months", "As operator"],
                ["exp_kaliapani_months", "At Kaliapani"], ["exp_current_role_months", "Current role"],
                ["exp_verified_months", "Verified"],
              ].map(([key, label]) => (
                <Row key={key} label={`${label} (months)`}>
                  <input id={`op-${key}`} type="number" className={cellInput} value={f[key] ?? ""}
                    onChange={(e) => set(key, e.target.value)} placeholder="0" />
                </Row>
              ))}
              <Row label="Verified by">
                <input id="op-expby" className={cellInput} value={f.exp_verified_by ?? ""}
                  onChange={(e) => set("exp_verified_by", e.target.value)} />
              </Row>
            </Sheet>
          </div>

          <div className="mt-4">
            <RecordSection kind="EXPERIENCE" title="Previous employers"
              hint="Where they worked before, and on what"
              records={records} onSave={saveRecord} onRemove={removeRecord}
              disabled={!editing || !rights.may_manage} types={types} />
          </div>

          <div className="mt-4">
            <RecordSection kind="EDUCATION" title="Education"
              hint="Schooling and technical qualifications — separate from literacy"
              records={records} onSave={saveRecord} onRemove={removeRecord}
              disabled={!editing || !rights.may_manage} types={types} />
          </div>

          <div className="mt-4">
            <RecordSection kind="LANGUAGE" title="Languages"
              hint="Which languages a toolbox talk or an emergency instruction can be given in"
              records={records} onSave={saveRecord} onRemove={removeRecord}
              disabled={!editing || !rights.may_manage} types={types} />
          </div>
        </div>
      )}

      {/* ── Documents ────────────────────────────────────────────────── */}
      {tab === "documents" && (
        <div className="space-y-4">
          {["LICENCE", "MEDICAL", "CERTIFICATE", "AUTHORISATION", "TRAINING", "SPECIALIZED_TRAINING"].map((kind) => (
            <RecordSection key={kind} kind={kind}
              title={RECORD_KINDS.find((k) => k.value === kind)?.label ?? kind}
              hint={kind === "LICENCE" ? "Every row here has an expiry, and every expiry reaches the Alerts screen before it passes"
                  : kind === "MEDICAL" ? "Periodical medical examination and any restriction it carries"
                  : undefined}
              records={records} onSave={saveRecord} onRemove={removeRecord}
              disabled={!editing || !rights.may_manage} types={types} />
          ))}
        </div>
      )}

      {/* ── Competency ───────────────────────────────────────────────── */}
      {tab === "competency" && (
        <div>
          <Band title="What they can run, and how well they understand it"
                hint="Training is not competency. A level here means someone assessed them, and the evidence is kept"
                right={
                  <select value={compType} onChange={(e) => setCompType(e.target.value)}
                    className="bg-white/10 border border-white/20 rounded-lg px-2.5 py-1 text-[12px] text-white">
                    <option value="" className="text-navy">Choose equipment class…</option>
                    {types.map((t) => (
                      <option key={t.asset_type_id} value={t.asset_type_id} className="text-navy">{t.name}</option>
                    ))}
                  </select>
                } />
          <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base p-4">
            {!compType ? (
              <p className="text-[12.5px] text-txt-muted py-6 text-center">
                Choose an equipment class above. Overall competency is the level that
                decides eligibility; the rest are what the person actually understands
                about the machine.
              </p>
            ) : !rights.may_assess ? (
              <Alert tone="info">
                Assessing competency is a separate permission, held by training rather
                than by whoever keeps the register. You can see the levels but not set them.
              </Alert>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                {DIMENSIONS.map((d) => {
                  const lvl = levelFor(Number(compType), d.id);
                  return (
                    <div key={d.id}
                      className={`flex items-center justify-between gap-3 py-1.5 border-b border-border-light
                                  ${d.id === "OVERALL" ? "md:col-span-2 bg-gold/[0.05] px-2 rounded" : ""}`}>
                      <span className={`text-[12.5px] ${d.id === "OVERALL" ? "font-bold text-navy" : "text-txt-secondary"}`}>
                        {d.label}
                      </span>
                      <span className="flex items-center gap-1">
                        {[0, 1, 2, 3, 4].map((n) => (
                          <button key={n} type="button" disabled={!editing}
                            onClick={() => void setLevel(Number(compType), d.id, n)}
                            title={LEVELS[n]}
                            className={`w-7 h-7 rounded-md text-[11px] font-bold border transition-colors
                              ${lvl === n
                                ? "bg-navy text-white border-navy"
                                : "bg-bg-base text-txt-light border-border hover:border-gold hover:text-navy"}`}>
                            {n}
                          </button>
                        ))}
                        <Chip tone={LEVEL_TONE[lvl]} dot={false} className="ml-2 hidden lg:inline-flex">
                          {LEVELS[lvl]}
                        </Chip>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {comps.filter((c) => c.dimension === "OVERALL").length > 0 && (
            <div className="mt-4 rounded-xl border border-border-light bg-bg-base overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-light text-[12px] font-bold
                              uppercase tracking-[.1em] text-navy">
                Assessed classes
              </div>
              <div className="p-3 flex flex-wrap gap-2">
                {comps.filter((c) => c.dimension === "OVERALL").map((c) => (
                  <Chip key={c.operator_competency_id} tone={LEVEL_TONE[c.level ?? 0]}>
                    {c.asset_type} · L{c.level ?? 0}
                    {c.valid_upto ? ` · to ${c.valid_upto}` : ""}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Machines ─────────────────────────────────────────────────── */}
      {tab === "machines" && (
        <AssignmentSection assets={assets} assignments={assignments}
          disabled={!editing || !rights.may_manage} onAssign={assign} />
      )}

      {/* ── Identity ─────────────────────────────────────────────────── */}
      {tab === "identity" && (
        <IdentitySection idents={idents} disabled={!editing || !rights.may_manage}
          onAdd={addIdentity}
          onRemove={async (identityId) => {
            if (!id) return;
            await api.delete(`/operators/${id}/identities/${identityId}`);
            await loadProfile();
          }} />
      )}

      {/* Footer */}
      <div className="flex flex-wrap gap-2 pt-1 sticky bottom-0 bg-bg-base/95 backdrop-blur py-3
                      -mx-1 px-1 border-t border-border-light">
        <Button variant="primary" size="lg" onClick={() => submit("stay")}
          disabled={saving || !dirty}>
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
          {editing ? "Back to register" : "Cancel"}
        </Button>
        {editing && (status === "DRAFT" || status === "SENT_BACK") && rights.may_manage && (
          <span className="ml-auto">
            <Button variant="danger" size="lg" disabled={busy !== null} onClick={() => setAsk("discard")}>
              <Trash2 className="w-4 h-4" /> Discard profile
            </Button>
          </span>
        )}
      </div>
    </div>
  );

  if (!editing) return <>{messages}{dialogs}{sheet}</>;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
      {messages}
      {dialogs}
      {sheet}
      <div className="xl:sticky xl:top-[86px] space-y-4">
        <div className="bg-bg-base border border-border-light rounded-xl shadow-sm overflow-hidden">
          <header className="px-4 py-3 border-b border-border-light flex items-center justify-between gap-2">
            <h3 className="font-condensed font-bold text-[12.5px] uppercase tracking-[.1em] text-navy
                           flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-gold" /> Approval
            </h3>
            <Chip tone={statusTone}>{status.replace("_", " ").toLowerCase()}</Chip>
          </header>
          <div className="p-4 space-y-2.5">
            <p className="text-[12px] text-txt-muted leading-relaxed">
              {status === "APPROVED"
                ? "On the register. Editing returns it to draft, since what was approved would no longer be what is on file."
                : status === "SUBMITTED"
                ? "Waiting for someone other than whoever submitted it."
                : status === "SENT_BACK"
                ? "Sent back for correction — the reason is in the trail below."
                : "A draft. It stays off the register until it is approved."}
            </p>

            {(status === "DRAFT" || status === "SENT_BACK") && rights.may_manage && (
              <Button variant="accent" size="md" disabled={busy !== null}
                className="w-full justify-center" onClick={() => void act("submit")}>
                <Send className="w-4 h-4" /> Submit for approval
              </Button>
            )}

            {status === "SUBMITTED" && !rights.may_approve && (
              <p className="text-[12px] text-txt-light border-t border-border-light pt-2.5">
                Approving is a separate permission, which you do not hold. An Access
                Manager grants it under Access Control.
              </p>
            )}

            {status === "SUBMITTED" && rights.may_approve && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="success" size="md" disabled={busy !== null}
                  className="justify-center" onClick={() => void act("approve")}>
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

        {Array.isArray(loaded?.alerts) && (loaded.alerts as unknown[]).length > 0 && (
          <div className="bg-bg-base border border-rose-ring rounded-xl shadow-sm overflow-hidden">
            <header className="px-4 py-3 border-b border-border-light bg-rose-bg">
              <h3 className="font-condensed font-bold text-[12.5px] uppercase tracking-[.1em] text-rose">
                Expiring
              </h3>
            </header>
            <ul className="divide-y divide-border-light">
              {(loaded.alerts as { alert_type: string; due_on: string; days_left: number; severity: string }[])
                .map((a, i) => (
                <li key={i} className="px-4 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-[12.5px] text-txt-secondary">{a.alert_type}</span>
                  <Chip tone={a.severity === "EXPIRED" ? "rose" : "amber"}>
                    {a.days_left < 0 ? `${-a.days_left}d ago` : `${a.days_left}d`}
                  </Chip>
                </li>
              ))}
            </ul>
          </div>
        )}

        <RevisionPanel revisions={revisions} />
      </div>
    </div>
  );
}

/* ── a repeating group of records of one kind ───────────────────────────── */
function RecordSection({ kind, title, hint, records, onSave, onRemove, disabled, types }: {
  kind: string; title: string; hint?: string;
  records: Rec[];
  onSave: (r: Rec) => Promise<void>;
  onRemove: (id?: number) => Promise<void>;
  disabled: boolean;
  types: AssetType[];
}) {
  const mine = records.filter((r) => r.record_type === kind);
  const [draft, setDraft] = useState<Rec | null>(null);

  const dated = kind !== "LANGUAGE" && kind !== "EDUCATION" && kind !== "EXPERIENCE";

  return (
    <div>
      <Band title={title} hint={hint}
        right={!disabled && (
          <Button size="sm" variant="secondary" onClick={() => setDraft(emptyRecord(kind))}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        )} />
      <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="text-left">
              {["Title", kind === "EXPERIENCE" ? "Employer" : "Number", "Issuer / provider",
                dated ? "Valid from" : "From", dated ? "Valid upto" : "To", "Verified", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-[10.5px] font-bold uppercase tracking-[.1em]
                                       text-txt-light border-b border-border-light">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mine.length === 0 && !draft && (
              <tr><td colSpan={7} className="px-3 py-5 text-center text-[12.5px] text-txt-light">
                Nothing recorded. {disabled ? "" : "Add takes one row at a time."}
              </td></tr>
            )}
            {mine.map((r) => (
              <tr key={r.operator_record_id} className="border-b border-border-light last:border-0">
                <td className="px-3 py-2 text-[12.5px] font-semibold text-navy">{r.title || "—"}</td>
                <td className="px-3 py-2 text-[12.5px] font-mono">{r.document_no || "—"}</td>
                <td className="px-3 py-2 text-[12.5px] text-txt-secondary">{r.issuer || "—"}</td>
                <td className="px-3 py-2 text-[12.5px] tabular-nums">{r.valid_from || "—"}</td>
                <td className="px-3 py-2 text-[12.5px] tabular-nums">{r.valid_upto || "—"}</td>
                <td className="px-3 py-2">
                  <Chip tone={r.verification_status === "VERIFIED" ? "emerald"
                            : r.verification_status === "REJECTED" ? "rose" : "amber"} dot={false}>
                    {(r.verification_status ?? "PENDING").toLowerCase()}
                  </Chip>
                </td>
                <td className="px-3 py-2 text-right">
                  {!disabled && (
                    <button onClick={() => void onRemove(r.operator_record_id)}
                      aria-label="Remove" className="text-txt-light hover:text-rose transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {draft && (
              <tr className="bg-gold/[0.04]">
                <td className="px-2 py-1.5">
                  <input autoFocus className={cellInput} placeholder={kind === "LANGUAGE" ? "Odia" : "Title"}
                    value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={cellInput} placeholder="Number"
                    value={draft.document_no ?? ""} onChange={(e) => setDraft({ ...draft, document_no: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={cellInput} placeholder="Issuer"
                    value={draft.issuer ?? ""} onChange={(e) => setDraft({ ...draft, issuer: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <input type="date" className={cellInput} value={draft.valid_from ?? ""}
                    onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <input type="date" className={cellInput} value={draft.valid_upto ?? ""}
                    onChange={(e) => setDraft({ ...draft, valid_upto: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <select className={cellInput} value={draft.verification_status ?? "PENDING"}
                    onChange={(e) => setDraft({ ...draft, verification_status: e.target.value })}>
                    <option value="PENDING">Pending</option>
                    <option value="VERIFIED">Verified</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <Button size="sm" variant="primary"
                    onClick={async () => { await onSave(draft); setDraft(null); }}>
                    <Check className="w-3.5 h-3.5" /> Save
                  </Button>
                  <button onClick={() => setDraft(null)}
                    className="ml-1.5 text-[12px] text-txt-light hover:text-navy">Cancel</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── which machine, which shift ─────────────────────────────────────────── */
function AssignmentSection({ assets, assignments, disabled, onAssign }: {
  assets: Asset[]; assignments: Assignment[]; disabled: boolean;
  onAssign: (assetId: number, shift: string, role: string) => Promise<void>;
}) {
  const [assetId, setAssetId] = useState("");
  const [shift, setShift] = useState("A");
  const [role, setRole] = useState("PRIMARY");

  const active = assignments.filter((a) => a.status === "ACTIVE");
  const past = assignments.filter((a) => a.status !== "ACTIVE");

  return (
    <div>
      <Band title="Machines they are assigned to"
            hint="Being assigned is not the same as being competent — eligibility is checked and recorded, not enforced" />
      <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base p-4 space-y-3">
        {!disabled && (
          <div className="flex flex-wrap items-end gap-2">
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}
              className="bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px] min-w-[220px]">
              <option value="">Choose a machine…</option>
              {assets.map((a) => (
                <option key={a.asset_id} value={a.asset_id}>
                  {a.fleet_code}{a.nickname ? ` · ${a.nickname}` : ""}
                </option>
              ))}
            </select>
            <select value={shift} onChange={(e) => setShift(e.target.value)}
              className="bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]">
              {["A", "B", "C", "GENERAL"].map((s) => <option key={s} value={s}>Shift {s}</option>)}
            </select>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]">
              {["PRIMARY", "SECONDARY", "RELIEVER"].map((r) => (
                <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()}</option>
              ))}
            </select>
            <Button variant="primary" disabled={!assetId}
              onClick={async () => { await onAssign(Number(assetId), shift, role); setAssetId(""); }}>
              <Plus className="w-4 h-4" /> Assign
            </Button>
          </div>
        )}

        {active.length === 0 ? (
          <p className="text-[12.5px] text-txt-light py-3">Not assigned to any machine.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {active.map((a) => (
              <span key={a.operator_assignment_id}
                className="inline-flex items-center gap-2 rounded-lg border border-teal-ring
                           bg-teal-bg px-3 py-1.5 text-[12.5px]">
                <Cpu className="w-3.5 h-3.5 text-teal" />
                <span className="font-semibold text-navy">{a.fleet_code}</span>
                <span className="text-txt-muted">
                  shift {a.shift ?? "—"} · {a.role.toLowerCase()} · since {a.valid_from}
                </span>
              </span>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-txt-muted hover:text-navy">
              {past.length} earlier assignment{past.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 space-y-1 text-txt-light">
              {past.map((a) => (
                <li key={a.operator_assignment_id}>
                  {a.fleet_code} · {a.valid_from} to {a.valid_to ?? "—"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

/* ── what other systems call this person ────────────────────────────────── */
function IdentitySection({ idents, disabled, onAdd, onRemove }: {
  idents: Ident[]; disabled: boolean;
  onAdd: (system: string, code: string) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}) {
  const [system, setSystem] = useState("SAP");
  const [code, setCode] = useState("");

  return (
    <div>
      <Band title="What other systems call them"
            hint="One person, every code that refers to them — which is how the driver master, handover and SAP ever join up" />
      <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base p-4 space-y-3">
        {!disabled && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={system} onChange={(e) => setSystem(e.target.value)}
              className="bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]">
              {["SAP", "HRMS", "DRIVER_MASTER", "CONTRACTOR", "GATE_PASS", "BIOMETRIC", "RFID", "OTHER"]
                .map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
            <input value={code} onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) { void onAdd(system, code.trim()); setCode(""); } }}
              placeholder="The code that system uses"
              className="bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px] font-mono w-[240px]" />
            <Button variant="secondary" disabled={!code.trim()}
              onClick={async () => { await onAdd(system, code.trim()); setCode(""); }}>
              <Link2 className="w-4 h-4" /> Link
            </Button>
          </div>
        )}

        {idents.length === 0 ? (
          <p className="text-[12.5px] text-txt-light">
            Nothing linked — this person will not join to driver, handover or SAP records.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {idents.map((i) => (
              <span key={i.party_identity_id}
                className="inline-flex items-center gap-2 rounded-lg border border-border
                           bg-bg-light px-3 py-1.5 text-[12.5px]">
                <span className="font-bold text-navy">{i.system.replace("_", " ")}</span>
                <span className="font-mono">{i.external_code}</span>
                {!disabled && (
                  <button onClick={() => void onRemove(i.party_identity_id)} aria-label="Unlink"
                    className="text-txt-light hover:text-rose transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
