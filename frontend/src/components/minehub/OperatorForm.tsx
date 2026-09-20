"use client";
/**
 * Operator 360 — one person, one scroll.
 *
 * This was tabs. Tabs hide how much is left to fill in, and someone entering a
 * new operator does not think in tabs — they work down the person: who they
 * are, what they know, what they hold, what they can run. So the sections run
 * one after another and a rail on the left follows the scroll, which also gives
 * a way to jump straight to Documents when that is all you came for.
 *
 * Saving sits at the top, where it stays visible however far down the page has
 * gone.
 *
 * The rules are the equipment form's rules: save a draft with almost nothing,
 * check completeness only at submission, mark the fields that blocked it, keep
 * the trail beside the sheet, and never let one person both submit and approve.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, Loader2, ArrowLeft, Send, CheckCircle2, Undo2, Trash2, Plus, Copy,
  User, Briefcase, FileText, ShieldCheck, Cpu, Link2, Upload, Paperclip,
  GraduationCap, Languages as LanguagesIcon, Award, History,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Chip, type Tone } from "./ui";
import { Band, Row, Sheet, cellInput } from "./sheet";
import Combobox from "./Combobox";
import Toast from "./Toast";
import Dialog from "./Dialog";
import RevisionPanel, { type Revision } from "./RevisionPanel";

/* ── the sections, in the order a person is described ───────────────────── */
const SECTIONS = [
  { id: "personal",   label: "Personal",     icon: User },
  { id: "employment", label: "Employment",   icon: Briefcase },
  { id: "background", label: "Background",   icon: GraduationCap },
  { id: "languages",  label: "Languages",    icon: LanguagesIcon },
  { id: "documents",  label: "Documents",    icon: FileText },
  { id: "skills",     label: "Skills",       icon: Award },
  { id: "competency", label: "Competency",   icon: ShieldCheck },
  { id: "machines",   label: "Machines",     icon: Cpu },
  { id: "identity",   label: "Identity",     icon: Link2 },
  { id: "files",      label: "Files",        icon: Paperclip },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

interface Rec {
  operator_record_id?: number;
  record_type: string; title?: string | null; category?: string | null;
  asset_type_id?: number | null; document_no?: string | null; issuer?: string | null;
  issued_on?: string | null; valid_from?: string | null; valid_upto?: string | null;
  refresher_due?: string | null; result?: string | null; score?: number | null;
  restrictions?: string | null; verification_status?: string; verified_by?: string | null;
  document_ref?: string | null; details?: Record<string, unknown>;
}

interface Comp {
  operator_competency_id?: number; asset_type_id: number | null; asset_type?: string | null;
  asset_id?: number | null; fleet_code?: string | null; nickname?: string | null;
  dimension: string; level: number | null; previous_level?: number | null;
  rating?: number | null; assessment_count?: number;
  assessed_on?: string | null; valid_upto?: string | null;
  next_assessment_due?: string | null; last_assessed_by?: string | null;
}

interface Assignment {
  operator_assignment_id: number; asset_id: number; fleet_code: string;
  nickname?: string | null; shift?: string | null; role: string;
  valid_from: string; valid_to?: string | null; status: string;
}

interface Doc {
  operator_document_id: number; operator_record_id?: number | null; kind: string;
  file_name: string; content_type?: string | null; size_bytes?: number | null;
  uploaded_by?: string | null; uploaded_at: string;
}

/** One assessment: a day, an assessor, a method, and the scores it produced. */
interface Sitting {
  assessment_ref: string | null;
  assessed_on: string | null;
  assessor: string | null;
  assessor_name: string | null;
  assessment_type: string | null;
  asset_type: string | null;
  fleet_code: string | null;
  remarks: string | null;
  level?: number | null;
  previous_level?: number | null;
  rating?: number | null;
  scores: { dimension: string; title: string; level: number | null;
            previous_level: number | null; result: string | null }[];
}

interface Ident { party_identity_id: number; system: string; external_code: string }
interface AssetType { asset_type_id: number; name: string }
interface Asset {
  asset_id: number; fleet_code: string; nickname?: string | null; asset_type_id?: number | null;
}
interface Plant { plant_id: number; code: string; name: string; is_default: boolean }
interface OrgUnit { org_unit_id: number; code: string; name: string }
interface Party { party_id: number; display_name: string }
interface Skill {
  skill_id: number; code: string; name: string; nsqf_level: number | null;
  category: string | null; asset_type_id?: number | null; asset_type?: string | null;
}

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
const CAPABILITY = ["No knowledge", "Basic", "Functional", "Good", "Advanced"];
const LANGUAGE_LEVELS = ["", "No knowledge", "Basic", "Functional", "Good", "Fluent"];
const CORE_LANGUAGES = ["Hindi", "Odia", "English"];

const DOC_KINDS = [
  { kind: "LICENCE",              label: "Driving licence",
    hint: "Every row here has an expiry, and every expiry reaches the Alerts screen before it passes" },
  { kind: "MEDICAL",              label: "Medical fitness",
    hint: "Periodical examination, and any restriction it carries" },
  { kind: "CERTIFICATE",          label: "Certificates" },
  { kind: "AUTHORISATION",        label: "Internal authorisation",
    hint: "The mine's own permission to operate, which is not the same as a licence" },
  { kind: "TRAINING",             label: "Training" },
  { kind: "SPECIALIZED_TRAINING", label: "Specialised training" },
];

const emptyRecord = (kind: string): Rec => ({
  record_type: kind, title: "", document_no: "", issuer: "",
  valid_from: "", valid_upto: "", verification_status: "PENDING",
});

export default function OperatorForm({ operatorId, openAt, prefill, onSaved, onDone, onCancel }: {
  operatorId?: number;
  /** Land on this section rather than at the top. */
  openAt?: string;
  prefill?: { display_name?: string; code?: string };
  onSaved?: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [createdId, setCreatedId] = useState<number | null>(null);
  const id = operatorId ?? createdId;
  const editing = Boolean(id);

  const [f, setF] = useState<Record<string, string>>({
    display_name: prefill?.display_name ?? "", employment_type: "OWN", profile_status: "ACTIVE",
  });
  const [loaded, setLoaded] = useState<Record<string, unknown> | null>(null);
  // Opening somebody rendered the whole sheet from an empty form for the two
  // seconds the fetch takes: the title read "this profile", the counter said
  // "1 of 16", and every field was blank. None of it was true — it is Bhaba
  // Nayak, 6 of 16 — and a page that states facts it has not read yet is worse
  // than one that admits it is still reading. A new profile has nothing to
  // fetch, so it starts ready. Same fix as the machine sheet.
  const [fetching, setFetching] = useState(Boolean(operatorId));
  const [records, setRecords] = useState<Rec[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [idents, setIdents] = useState<Ident[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [history, setHistory] = useState<Sitting[]>([]);

  const [types, setTypes] = useState<AssetType[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [rights, setRights] = useState({ may_manage: false, may_assess: false, may_approve: false });

  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState("");
  const [ask, setAsk] = useState<null | "discard" | "leave" | "send-back">(null);
  const [sendBackWhy, setSendBackWhy] = useState("");
  const [compType, setCompType] = useState<string>("");
  // Optional: the particular machine being assessed. A level against the class
  // is what clearance means; a level against ZX470 is how they are on that
  // machine, which the mine knows even when the certificate does not.
  const [compAsset, setCompAsset] = useState<string>("");
  // Set once for the sitting rather than per click: an assessment is one event
  // that produced fifteen scores, not fifteen events.
  const [assessedOn, setAssessedOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("PRACTICAL");
  const [assessNote, setAssessNote] = useState("");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [here, setHere] = useState<SectionId>("personal");

  const raise = (msg: string) => { setNotice(null); setError(msg); };
  const snapshot = useMemo(() => JSON.stringify(f), [f]);
  const dirty = snapshot !== saved;

  /* ── the rail follows the scroll ──────────────────────────────────────── */
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const register = useCallback(
    (key: SectionId) => (el: HTMLElement | null) => { sectionRefs.current[key] = el; }, []);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      // The line just under the two sticky bars. A section counts as the one
      // being read once its top has crossed it.
      const line = 210;
      let current: SectionId = SECTIONS[0].id;
      for (const sec of SECTIONS) {
        const el = sectionRefs.current[sec.id];
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = sec.id;
      }
      // At the very bottom the last section may be too short to reach the line,
      // and the strip would sit on whatever came before it.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        const last = [...SECTIONS].reverse().find((x) => sectionRefs.current[x.id]);
        if (last) current = last.id;
      }
      setHere((was) => (was === current ? was : current));
    };

    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    measure();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editing, records.length, documents.length]);

  const goTo = (key: SectionId) => {
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHere(key);
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* ── reference data ───────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const [t, a, pl, ou, pa, sk, me] = await Promise.all([
          api.get("/minehub/asset-types"),
          api.get("/minehub/assets"),
          api.get("/minehub/plants"),
          api.get("/minehub/org-units"),
          api.get("/minehub/parties", { params: { party_type: "ORGANISATION" } }),
          api.get("/operators/meta/skills"),
          api.get("/operators/meta/me"),
        ]);
        setTypes(t.data ?? []); setAssets(a.data ?? []); setPlants(pl.data ?? []);
        setOrgUnits(ou.data ?? []); setParties(pa.data ?? []); setSkills(sk.data ?? []);
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

  useEffect(() => {
    if (!operatorId && !prefill?.display_name) {
      setSaved(JSON.stringify({ display_name: "", employment_type: "OWN", profile_status: "ACTIVE" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProfile = useCallback(async () => {
    if (!id) return;
    try {
      setFetching(true);
      const [r, d, h] = await Promise.all([
        api.get(`/operators/${id}`),
        api.get(`/operators/${id}/documents`).catch(() => ({ data: [] })),
        api.get(`/operators/${id}/assessments`).catch(() => ({ data: [] })),
      ]);
      const p = r.data ?? {};
      setLoaded(p);
      const asForm: Record<string, string> = {};
      Object.entries(p).forEach(([k, v]) => {
        if (v === null || v === undefined || typeof v === "object") return;
        asForm[k] = String(v);
      });
      setF(asForm); setSaved(JSON.stringify(asForm));
      setRecords(p.records ?? []); setComps(p.competencies ?? []);
      setAssignments(p.assignments ?? []); setIdents(p.identities ?? []);
      setDocuments(d.data ?? []); setHistory(h.data ?? []);
    } catch {
      raise("Could not load this profile.");
    } finally {
      setFetching(false);
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

  // Jump once, after the sections exist to jump to.
  const jumped = useRef(false);
  useEffect(() => {
    if (!openAt || jumped.current || !loaded) return;
    jumped.current = true;
    const t = setTimeout(() => goTo(openAt as SectionId), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt, loaded]);

  /** Ten digits, optionally with +91 or a leading 0, and nothing else. Checked
   *  as it is typed rather than only at submission, because a number is wrong
   *  the moment it is wrong and the person is still looking at it. */
  const phoneProblem = (v?: string): string | null => {
    const raw = (v ?? "").trim();
    if (!raw) return null;
    const digits = raw.replace(/[\s-]/g, "").replace(/^(\+91|0)/, "");
    if (!/^\d+$/.test(digits)) return "Digits only";
    if (digits.length !== 10) return `${digits.length} digits — an Indian mobile has 10`;
    if (!/^[6-9]/.test(digits)) return "An Indian mobile starts 6, 7, 8 or 9";
    return null;
  };

  const set = (k: string, v: string) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setInvalid((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev); next.delete(k); return next;
    });
  };

  /* ── saving ───────────────────────────────────────────────────────────── */
  const REQUIRED: [string, string, SectionId][] = [
    ["display_name",    "a name",             "personal"],
    ["employment_type", "an employment type", "employment"],
    ["plant_id",        "a plant",            "employment"],
  ];

  const submit = async (then: "stay" | "submit" = "stay"): Promise<boolean> => {
    if (then === "submit") {
      const badPhone = (["phone", "alternate_phone", "emergency_contact_phone"] as const)
        .map((k) => [k, phoneProblem(f[k])] as const)
        .find(([, problem]) => problem);
      if (badPhone) {
        setInvalid(new Set([badPhone[0]]));
        goTo("personal");
        raise(`That phone number is not right — ${badPhone[1]}. `
            + "A contact nobody can ring is worse than a blank one.");
        return false;
      }

      const short = REQUIRED.filter(([k]) => !(f[k] ?? "").toString().trim());
      if (short.length) {
        setInvalid(new Set(short.map(([k]) => k)));
        goTo(short[0][2]);
        raise(`Before this can go for approval it needs ${short.map(([, t]) => t).join(", ")}. `
            + "They are marked in red. Save it as a draft meanwhile — nothing typed is lost.");
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
      setCreatedId(newId); setSaved(snapshot); onSaved?.();
      if (then === "submit") {
        await api.post(`/operators/${newId}/submit`, {});
        setNotice("Saved and submitted for approval.");
      } else {
        setNotice(`Saved as draft — ${created.data.operator_ref}. `
                + "Documents, skills, competency and assignment can be filled in now.");
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
    setBusy(null); setAsk(null);
    if (stored) { onSaved?.(); onDone(); }
  };

  const act = async (what: "submit" | "approve" | "send-back", remarks?: string) => {
    setBusy(what); setError(null);
    try {
      await api.post(`/operators/${id}/${what}`, { remarks });
      setNotice(what === "approve" ? "Approved onto the register."
        : what === "submit" ? "Submitted for approval." : "Sent back for correction.");
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

  /* ── the repeating pieces ─────────────────────────────────────────────── */
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
    if (!id || !recordId) return;
    try {
      await api.delete(`/operators/${id}/records/${recordId}`);
      await loadProfile();
    } catch { raise("Could not remove that record."); }
  };

  /** Each click is written immediately — there is no separate save for
   *  assessments, and pretending otherwise leaves people wondering whether the
   *  score they just set survived. The confirmation says so plainly. */
  const assess = async (payload: Record<string, unknown>, said: string) => {
    if (!id) { raise("Save the profile first."); return; }
    try {
      await api.post(`/operators/${id}/competency`, {
        asset_type_id: Number(compType),
        asset_id: compAsset ? Number(compAsset) : null,
        assessment_type: method,
        assessed_on: assessedOn,
        remarks: assessNote || undefined,
        ...payload,
      });
      await loadProfile();
      setLastSaved(new Date().toLocaleTimeString("en-IN",
        { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
      setNotice(`${said} — recorded against ${assessedOn}.`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not record that assessment.");
    }
  };

  const setLevel = (dimension: string, level: number, label: string) =>
    assess({ dimension, level, result: level >= 2 ? "PASS" : "PENDING" },
           `${label} set to ${LEVELS[level].toLowerCase()}`);

  const setRating = (rating: number) =>
    assess({ dimension: "OVERALL", rating }, `Expertise rated ${rating} of 5`);

  const assign = async (assetId: number, shift: string, role: string) => {
    if (!id) return;
    try {
      const r = await api.post(`/operators/${id}/assignments`, { asset_id: assetId, shift, role });
      const el = r.data?.eligibility;
      await loadProfile();
      setNotice(el?.status === "ELIGIBLE" ? "Assigned."
        : `Assigned, and noted: ${[...(el?.blockers ?? []), ...(el?.warnings ?? [])].join("; ")}`);
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

  const uploadFor = async (file: File, kind: string, recordId?: number) => {
    if (!id) { raise("Save the profile first — a file has to belong to somebody."); return; }
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    if (recordId) form.append("record_id", String(recordId));
    try {
      await api.post(`/operators/${id}/documents`, form,
        { headers: { "Content-Type": "multipart/form-data" } });
      await loadProfile();
      setNotice(`${file.name} attached.`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      raise(d ?? "Could not attach that file.");
    }
  };

  const openDocument = (documentId: number) => {
    window.open(`/api/operators/${id}/documents/${documentId}`, "_blank", "noopener");
  };

  const removeDocument = async (documentId: number) => {
    if (!id) return;
    try {
      await api.delete(`/operators/${id}/documents/${documentId}`);
      await loadProfile();
    } catch { raise("Could not withdraw that document."); }
  };

  /* ── derived ──────────────────────────────────────────────────────────── */
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
      { label: "Language", done: records.some((r) => r.record_type === "LANGUAGE") },
      { label: "Licence", done: records.some((r) => r.record_type === "LICENCE") },
      { label: "Medical", done: records.some((r) => r.record_type === "MEDICAL") },
      { label: "Skill", done: records.some((r) => r.record_type === "SKILL") },
      { label: "Competency", done: comps.some((c) => c.dimension === "OVERALL" && (c.level ?? 0) >= 2) },
      { label: "Document uploaded", done: documents.length > 0 },
    ];
  }, [f, records, comps, documents]);

  const done = checklist.filter((c) => c.done).length;
  const outstanding = checklist.filter((c) => !c.done).map((c) => c.label);
  const rowFor = (dimension: string): Comp | undefined =>
    comps.find((c) => c.asset_type_id === Number(compType)
      && String(c.asset_id ?? "") === compAsset
      && c.dimension === dimension);
  const levelFor = (dimension: string): number => rowFor(dimension)?.level ?? 0;
  const name = String(f.display_name || "this profile");

  /* ── messages and questions ───────────────────────────────────────────── */
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

  /* ── the page ─────────────────────────────────────────────────────────── */
  // Nothing about an existing person is claimed until it has been read.
  if (fetching) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading this profile">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="h-8 w-24 rounded-lg bg-slate-200/70 animate-pulse mb-3" />
            <div className="h-7 w-52 rounded bg-slate-200/70 animate-pulse" />
            <div className="flex gap-2 mt-2.5">
              <div className="h-6 w-28 rounded-full bg-slate-200/60 animate-pulse" />
              <div className="h-6 w-16 rounded-full bg-slate-200/60 animate-pulse" />
              <div className="h-6 w-20 rounded-full bg-slate-200/60 animate-pulse" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-28 rounded-lg bg-slate-200/70 animate-pulse" />
            <div className="h-9 w-36 rounded-lg bg-slate-200/70 animate-pulse" />
          </div>
        </div>
        {/* The tab strip, at its real height, so nothing jumps when it lands. */}
        <div className="h-11 rounded-xl bg-slate-100 animate-pulse" />
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_296px] gap-4 items-start">
          <div>
            <div className="h-10 rounded-t-xl bg-navy/90" />
            <div className="border border-t-0 border-border rounded-b-xl bg-bg-base">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="grid grid-cols-2 border-b border-border-light last:border-0">
                  {[0, 1].map((col) => (
                    <div key={col} className="flex items-center gap-3 px-4 py-3.5">
                      <div className="h-3 w-24 rounded bg-slate-100 animate-pulse" />
                      <div className="h-3 flex-1 max-w-[190px] rounded bg-slate-200/60 animate-pulse" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="h-[128px] rounded-xl bg-bg-base border border-border-light animate-pulse" />
            <div className="h-[168px] rounded-xl bg-bg-base border border-border-light animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {messages}
      {dialogs}

      {/* Everything that must stay reachable however far the page has scrolled */}
      <div className="sticky top-[71px] z-[15] pt-1 pb-2.5 bg-bg-base">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <button onClick={leave}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-base
                         px-3 py-1.5 text-[12px] font-bold text-navy shadow-sm hover:border-gold
                         hover:bg-gold/[0.06] transition-all shrink-0">
              <ArrowLeft className="w-4 h-4 text-gold-dark" /> Back
            </button>
            <div className="min-w-0">
              <h2 className="font-condensed font-extrabold text-[20px] leading-tight text-navy truncate">
                {editing ? name : <>Register an <span className="text-gold-dark">operator</span></>}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                {editing && loaded?.operator_ref ? (
                  <button type="button" title="Our own reference — copy it"
                    onClick={() => { void navigator.clipboard?.writeText(String(loaded.operator_ref));
                                     setNotice(`${loaded.operator_ref} copied.`); }}
                    className="inline-flex items-center gap-1 rounded bg-violet-bg border border-violet-ring
                               px-1.5 py-0.5 font-mono text-[11px] font-bold text-violet">
                    {String(loaded.operator_ref)} <Copy className="w-3 h-3" />
                  </button>
                ) : null}
                {editing && <Chip tone={statusTone}>{status.replace("_", " ").toLowerCase()}</Chip>}
                <Chip tone={done > 11 ? "emerald" : done > 5 ? "amber" : "slate"}
                      title={outstanding.length ? `Still blank: ${outstanding.join(", ")}` : "Nothing outstanding"}>
                  {done} of {checklist.length}
                </Chip>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => submit("stay")}
              disabled={saving || !dirty}
              title={dirty ? undefined : "Nothing has changed since the last save"}>
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                      : dirty ? <><Check className="w-3.5 h-3.5" /> {editing ? "Save changes" : "Save as draft"}</>
                      : <><Check className="w-3.5 h-3.5" /> Saved</>}
            </Button>
            {(!editing || status === "DRAFT" || status === "SENT_BACK") && (
              <Button size="sm" variant="accent" onClick={() => submit("submit")} disabled={saving}>
                <Send className="w-3.5 h-3.5" /> Submit for approval
              </Button>
            )}
            {editing && status === "SUBMITTED" && rights.may_approve && (
              <>
                <Button size="sm" variant="success" disabled={busy !== null}
                  onClick={() => void act("approve")}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                </Button>
                <Button size="sm" variant="danger" disabled={busy !== null}
                  onClick={() => setAsk("send-back")}>
                  <Undo2 className="w-3.5 h-3.5" /> Send back
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* The section strip: where in the profile you are, and a way to jump.
          It follows the scroll rather than replacing it — every section is on
          the page, one under the other. */}
      <nav className="sticky top-[136px] z-[14] py-2 bg-bg-base border-b border-border
                      shadow-[0_6px_10px_-8px_rgba(15,28,54,.35)] overflow-x-auto">
        <div className="flex gap-1.5 w-max">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const on = here === sec.id;
            return (
              <button key={sec.id} onClick={() => goTo(sec.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] whitespace-nowrap
                            transition-colors
                            ${on ? "bg-navy text-white font-bold shadow-sm"
                                 : "text-txt-muted hover:bg-bg-section hover:text-navy"}`}>
                <Icon className={`w-4 h-4 ${on ? "text-gold" : "text-txt-light"}`} />
                {sec.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className={`grid grid-cols-1 gap-5 items-start mt-4
                       ${editing ? "xl:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
        {/* The sheet */}
        <div className="space-y-5 min-w-0">
          {!editing && (
            <Alert tone="info">
              Save the profile first — documents, skills, competency and assignments
              hang off a person, so there has to be one to hang them on. Everything
              below becomes editable the moment it is saved.
            </Alert>
          )}

          {/* Personal */}
          <section id="sec-personal" ref={register("personal")} className="scroll-mt-[210px]">
            <Band title="Personal details"
                  hint="Blood group and date of birth are what the first aid post asks for" />
            <Sheet>
              <Row label="Full name" required invalid={invalid.has("display_name")}>
                <input id="op-name" className={cellInput} value={f.display_name ?? ""}
                  onChange={(e) => set("display_name", e.target.value)}
                  placeholder="As written on the licence" />
              </Row>
              <Row label="Date of birth">
                <input id="op-dob" type="date" className={cellInput} value={f.date_of_birth ?? ""}
                  onChange={(e) => set("date_of_birth", e.target.value)} />
              </Row>
              <Row label="Gender">
                <select id="op-gender" className={cellInput} value={f.gender ?? ""}
                  onChange={(e) => set("gender", e.target.value)}>
                  <option value="">Select…</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </Row>
              <Row label="Blood group">
                <div className="px-1.5 py-1">
                  <Combobox id="op-blood" category="BLOOD_GROUP" value={f.blood_group ?? ""}
                    onChange={(v) => set("blood_group", v)} placeholder="B+, O−…" />
                </div>
              </Row>
              <Row label="Mobile" invalid={Boolean(phoneProblem(f.phone))}
                   note={phoneProblem(f.phone) ?? undefined}>
                <input id="op-phone" inputMode="numeric" className={cellInput} value={f.phone ?? ""}
                  onChange={(e) => set("phone", e.target.value)} placeholder="10 digits" />
              </Row>
              <Row label="Alternate contact" invalid={Boolean(phoneProblem(f.alternate_phone))}
                   note={phoneProblem(f.alternate_phone) ?? undefined}>
                <input id="op-phone2" inputMode="numeric" className={cellInput} value={f.alternate_phone ?? ""}
                  onChange={(e) => set("alternate_phone", e.target.value)} />
              </Row>
              <Row label="Emergency contact">
                <input id="op-ec" className={cellInput} value={f.emergency_contact_name ?? ""}
                  onChange={(e) => set("emergency_contact_name", e.target.value)} placeholder="Name" />
              </Row>
              <Row label="Emergency number" invalid={Boolean(phoneProblem(f.emergency_contact_phone))}
                   note={phoneProblem(f.emergency_contact_phone) ?? undefined}>
                <input id="op-ecp" inputMode="numeric" className={cellInput} value={f.emergency_contact_phone ?? ""}
                  onChange={(e) => set("emergency_contact_phone", e.target.value)} />
              </Row>
              <Row label="Relationship">
                <div className="px-1.5 py-1">
                  <Combobox id="op-ecr" category="RELATIONSHIP"
                    value={f.emergency_contact_relation ?? ""}
                    onChange={(v) => set("emergency_contact_relation", v)}
                    placeholder="Wife, brother…" />
                </div>
              </Row>
              <Row label="Profile status">
                <select id="op-status" className={cellInput} value={f.profile_status ?? "ACTIVE"}
                  onChange={(e) => set("profile_status", e.target.value)}>
                  {["ACTIVE", "INACTIVE", "SUSPENDED", "RETIRED"].map((x) => (
                    <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()}</option>
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
                    hint="Apart from education on purpose: a diploma says nothing about whether someone can read a safety sign" />
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
          </section>

          {/* Employment */}
          <section id="sec-employment" ref={register("employment")} className="scroll-mt-[210px]">
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
              <Row label="Employer / agency"
                   hint="BAL for own staff, the agency for contract staff. Not listed? Type it">
                <div className="px-1.5 py-1">
                  <Combobox id="op-employer"
                    options={parties.map((p) => ({ value: p.display_name }))}
                    value={parties.find((p) => String(p.party_id) === f.employer_party_id)?.display_name ?? ""}
                    placeholder="BAL, DASHMESH, SANY…"
                    onChange={(n) => {
                      const hit = parties.find((p) => p.display_name === n);
                      set("employer_party_id", hit ? String(hit.party_id) : "");
                    }}
                    onAddNew={async (n) => {
                      const r = await api.post("/minehub/parties", {
                        legal_name: n, display_name: n,
                        party_type: "ORGANISATION", org_category: "CONTRACTOR",
                      });
                      const made = { party_id: r.data.party_id, display_name: r.data.display_name ?? n };
                      setParties((prev) => [...prev, made]);
                      set("employer_party_id", String(made.party_id));
                      return made.display_name;
                    }} />
                </div>
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
                    onChange={(v) => set("designation", v)}
                    placeholder="Excavator Operator, Tipper Driver…" />
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
              <Row label="Employment end" hint="Blank while they are still working here">
                <input id="op-end" type="date" className={cellInput} value={f.employment_end ?? ""}
                  onChange={(e) => set("employment_end", e.target.value)} />
              </Row>
            </Sheet>

            <div className="mt-4">
              <Band title="Experience"
                    hint="In months so it can be added up. Declared is what they say; verified is what someone checked" />
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
          </section>

          {/* Background */}
          <section id="sec-background" ref={register("background")} className="scroll-mt-[210px] space-y-4">
            <RecordSection kind="EXPERIENCE" title="Previous employers"
              hint="Where they worked before, and on what"
              records={records} onSave={saveRecord} onRemove={removeRecord}
              disabled={!editing || !rights.may_manage}
              documents={documents} onUpload={uploadFor} onOpenDoc={openDocument} />
            <RecordSection kind="EDUCATION" title="Education"
              hint="Schooling and technical qualifications — separate from literacy"
              records={records} onSave={saveRecord} onRemove={removeRecord}
              disabled={!editing || !rights.may_manage}
              documents={documents} onUpload={uploadFor} onOpenDoc={openDocument} />
          </section>

          {/* Languages */}
          <section id="sec-languages" ref={register("languages")} className="scroll-mt-[210px]">
            <LanguageSection records={records} onSave={saveRecord} onRemove={removeRecord}
              disabled={!editing || !rights.may_manage} />
          </section>

          {/* Documents */}
          <section id="sec-documents" ref={register("documents")} className="scroll-mt-[210px] space-y-4">
            {DOC_KINDS.map((d) => (
              <RecordSection key={d.kind} kind={d.kind} title={d.label} hint={d.hint}
                records={records} onSave={saveRecord} onRemove={removeRecord}
                disabled={!editing || !rights.may_manage}
                documents={documents} onUpload={uploadFor} onOpenDoc={openDocument} />
            ))}
          </section>

          {/* Skills */}
          <section id="sec-skills" ref={register("skills")} className="scroll-mt-[210px]">
            <SkillSection skills={skills} records={records}
              disabled={!editing || !rights.may_manage}
              onSave={saveRecord} onRemove={removeRecord} />
          </section>

          {/* Competency */}
          <section id="sec-competency" ref={register("competency")} className="scroll-mt-[210px]">
            <Band title="What they can run, and how well they understand it"
                  hint="Training is not competency. A level here means someone assessed them, and every assessment is kept"
                  right={
                    <select value={compType} onChange={(e) => setCompType(e.target.value)}
                      className="bg-white/10 border border-white/20 rounded-lg px-2.5 py-1 text-[12px] text-white">
                      <option value="" className="text-navy">Choose equipment class…</option>
                      {types.map((t) => (
                        <option key={t.asset_type_id} value={t.asset_type_id} className="text-navy">
                          {t.name}
                        </option>
                      ))}
                    </select>
                  } />
            <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base p-4">
              {compType && rights.may_assess && editing && (
                <div className="mb-3 rounded-xl border border-gold/30 bg-gold/[0.05] px-3 py-2.5
                                flex flex-wrap items-end gap-3">
                  <label className="text-[12px]">
                    <span className="block font-semibold text-txt-secondary mb-1">Assessed on</span>
                    <input type="date" value={assessedOn} max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setAssessedOn(e.target.value)}
                      className="bg-bg-base border border-border rounded-lg px-3 py-1.5 text-[12.5px]" />
                  </label>
                  <label className="text-[12px]">
                    <span className="block font-semibold text-txt-secondary mb-1">How</span>
                    <select value={method} onChange={(e) => setMethod(e.target.value)}
                      className="bg-bg-base border border-border rounded-lg px-3 py-1.5 text-[12.5px]">
                      <option value="PRACTICAL">Practical</option>
                      <option value="WRITTEN">Written</option>
                      <option value="OBSERVATION">Observation</option>
                    </select>
                  </label>
                  <label className="text-[12px] flex-1 min-w-[200px]">
                    <span className="block font-semibold text-txt-secondary mb-1">Note (optional)</span>
                    <input value={assessNote} onChange={(e) => setAssessNote(e.target.value)}
                      placeholder="Handled the face well; slow on reversing"
                      className="w-full bg-bg-base border border-border rounded-lg px-3 py-1.5 text-[12.5px]" />
                  </label>
                  <p className="text-[11.5px] text-txt-muted basis-full">
                    Every score below is saved the moment it is clicked — there is no separate
                    save for assessments.
                    {lastSaved && <span className="text-emerald font-semibold"> Last saved {lastSaved}.</span>}
                  </p>
                </div>
              )}

              {compType && (
                <div className="flex flex-wrap items-center gap-3 pb-3 mb-3 border-b border-border-light">
                  <label className="flex items-center gap-2 text-[12.5px] text-txt-muted">
                    Machine
                    <select value={compAsset} onChange={(e) => setCompAsset(e.target.value)}
                      className="bg-bg-base border border-border rounded-lg px-3 py-1.5 text-[12.5px]">
                      <option value="">The class as a whole</option>
                      {assets
                        .filter((a) => !a.asset_type_id || String(a.asset_type_id) === compType)
                        .map((a) => (
                        <option key={a.asset_id} value={a.asset_id}>
                          {a.fleet_code}{a.nickname ? ` · ${a.nickname}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="text-[11.5px] text-txt-light max-w-[420px]">
                    {compAsset
                      ? "Recorded against this machine. Eligibility still reads the class."
                      : "Recorded against the class — this is what decides whether they can be assigned."}
                  </span>

                  {rights.may_assess && editing && (
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-[12.5px] text-txt-muted">Expertise</span>
                      {[1, 2, 3, 4, 5].map((n) => {
                        const on = (rowFor("OVERALL")?.rating ?? 0) >= n;
                        return (
                          <button key={n} type="button" onClick={() => void setRating(n)}
                            aria-label={`${n} out of 5`} title={`${n} out of 5`}
                            className={`text-[17px] leading-none transition-colors
                                        ${on ? "text-gold" : "text-border hover:text-gold/60"}`}>
                            ★
                          </button>
                        );
                      })}
                      <span className="text-[11.5px] text-txt-light">
                        {rowFor("OVERALL")?.rating
                          ? `${rowFor("OVERALL")?.rating} of 5`
                          : "not rated"}
                      </span>
                    </span>
                  )}
                </div>
              )}

              {!compType ? (
                <p className="text-[12.5px] text-txt-muted py-6 text-center">
                  Choose an equipment class above. Overall competency decides eligibility;
                  the rest are what the person actually understands about the machine.
                </p>
              ) : !rights.may_assess ? (
                <Alert tone="info">
                  Assessing is a separate permission, held by training rather than by
                  whoever keeps the register. You can see the levels but not set them.
                </Alert>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                  {DIMENSIONS.map((d) => {
                    const lvl = levelFor(d.id);
                    return (
                      <div key={d.id}
                        className={`flex items-center justify-between gap-3 py-1.5 border-b border-border-light
                                    ${d.id === "OVERALL" ? "md:col-span-2 bg-gold/[0.06] px-2 rounded" : ""}`}>
                        <span className={`text-[12.5px] ${d.id === "OVERALL" ? "font-bold text-navy" : "text-txt-secondary"}`}>
                          {d.label}
                        </span>
                        <span className="flex items-center gap-1">
                          {d.id === "OVERALL" && (() => {
                            const row = rowFor("OVERALL");
                            const was = row?.previous_level;
                            if (was === null || was === undefined || was === row?.level) return null;
                            const up = (row?.level ?? 0) > was;
                            return (
                              <Chip tone={up ? "emerald" : "rose"} dot={false}>
                                {up ? "↑" : "↓"} was L{was}
                              </Chip>
                            );
                          })()}
                          {[0, 1, 2, 3, 4].map((n) => (
                            <button key={n} type="button" disabled={!editing}
                              onClick={() => void setLevel(d.id, n, d.label)}
                              title={LEVELS[n]}
                              className={`w-7 h-7 rounded-md text-[11px] font-bold border transition-colors
                                ${lvl === n ? "bg-navy text-white border-navy"
                                            : "bg-bg-base text-txt-light border-border hover:border-gold hover:text-navy"}`}>
                              {n}
                            </button>
                          ))}
                          <Chip tone={LEVEL_TONE[lvl]} dot={false} className="ml-2 hidden xl:inline-flex">
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
              <div className="mt-3 rounded-xl border border-border-light bg-bg-base p-3 flex flex-wrap gap-2">
                {comps.filter((c) => c.dimension === "OVERALL").map((c) => (
                  <Chip key={c.operator_competency_id} tone={LEVEL_TONE[c.level ?? 0]}>
                    {c.fleet_code ? `${c.fleet_code}` : c.asset_type} · L{c.level ?? 0}
                    {c.rating ? ` · ${"★".repeat(c.rating)}` : ""}
                    {c.assessment_count && c.assessment_count > 1 ? ` · ${c.assessment_count}×` : ""}
                  </Chip>
                ))}
              </div>
            )}

            {history.length > 0 && (
              <div className="mt-3 rounded-xl border border-border-light bg-bg-base overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border-light text-[12px] font-bold
                                uppercase tracking-[.1em] text-navy flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-gold" /> Assessments · {history.length}
                </div>
                <ul className="max-h-[340px] overflow-y-auto divide-y divide-border-light">
                  {history.map((h, i) => {
                    const to = h.level ?? null;
                    const from = h.previous_level;
                    return (
                      <li key={h.assessment_ref ?? i} className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2 min-w-0">
                            {h.assessment_ref && (
                              <button type="button" title="Copy this assessment number"
                                onClick={() => { void navigator.clipboard?.writeText(h.assessment_ref ?? "");
                                                 setNotice(`${h.assessment_ref} copied.`); }}
                                className="font-mono text-[11px] font-bold text-violet bg-violet-bg
                                           border border-violet-ring rounded px-1.5 py-0.5">
                                {h.assessment_ref}
                              </button>
                            )}
                            <span className="text-[12.5px] font-semibold text-navy truncate">
                              {h.fleet_code ?? h.asset_type ?? "Equipment"}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            {from !== null && from !== undefined && from !== to && (
                              <span className="text-[11.5px] text-txt-light">L{from} →</span>
                            )}
                            {to !== null && <Chip tone={LEVEL_TONE[to]} dot={false}>L{to}</Chip>}
                            {h.rating ? (
                              <span className="text-[11.5px] text-gold-dark font-bold">
                                {"★".repeat(h.rating)}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <div className="text-[11.5px] text-txt-light mt-0.5">
                          {h.assessed_on} · {(h.assessment_type ?? "").toLowerCase() || "method not recorded"}
                          {h.assessor_name ? ` · by ${h.assessor_name}` : ""}
                          {h.scores.length > 1 ? ` · ${h.scores.length} scores` : ""}
                        </div>
                        {h.remarks && (
                          <p className="text-[11.5px] text-txt-secondary italic mt-1">“{h.remarks}”</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          {/* Machines */}
          <section id="sec-machines" ref={register("machines")} className="scroll-mt-[210px]">
            <AssignmentSection assets={assets} assignments={assignments}
              disabled={!editing || !rights.may_manage} onAssign={assign} />
          </section>

          {/* Identity */}
          <section id="sec-identity" ref={register("identity")} className="scroll-mt-[210px]">
            <IdentitySection idents={idents} disabled={!editing || !rights.may_manage}
              onAdd={addIdentity}
              onRemove={async (identityId) => {
                if (!id) return;
                await api.delete(`/operators/${id}/identities/${identityId}`);
                await loadProfile();
              }} />
          </section>

          {/* Files */}
          <section id="sec-files" ref={register("files")} className="scroll-mt-[210px]">
            <FileSection documents={documents} disabled={!editing || !rights.may_manage}
              onUpload={(file, kind) => uploadFor(file, kind)}
              onOpen={openDocument} onRemove={removeDocument} />
          </section>

          {/* Foot */}
          <div className="flex flex-wrap gap-2 py-3 border-t border-border-light">
            <Button variant="primary" size="lg" onClick={() => submit("stay")} disabled={saving || !dirty}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                      : dirty ? <><Check className="w-4 h-4" /> {editing ? "Save changes" : "Save as draft"}</>
                      : <><Check className="w-4 h-4" /> Saved</>}
            </Button>
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

        {/* Approval, alerts, trail */}
        {editing && (
          <div className="hidden xl:block sticky top-[200px] space-y-4">
            <div className="bg-bg-base border border-border-light rounded-xl shadow-sm overflow-hidden">
              <header className="px-4 py-3 border-b border-border-light flex items-center justify-between gap-2">
                <h3 className="font-condensed font-bold text-[12.5px] uppercase tracking-[.1em] text-navy
                               flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-gold" /> Approval
                </h3>
                <Chip tone={statusTone}>{status.replace("_", " ").toLowerCase()}</Chip>
              </header>
              <div className="p-4">
                <p className="text-[12px] text-txt-muted leading-relaxed">
                  {status === "APPROVED"
                    ? "On the register. Editing returns it to draft, since what was approved would no longer be what is on file."
                    : status === "SUBMITTED"
                    ? rights.may_approve
                      ? "Waiting for someone other than whoever submitted it. Approve or send back from the top of the page."
                      : "Waiting for approval. That is a separate permission, which you do not hold."
                    : status === "SENT_BACK"
                    ? "Sent back for correction — the reason is in the trail below."
                    : "A draft. It stays off the register until it is approved."}
                </p>
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
                  {(loaded.alerts as { alert_type: string; days_left: number; severity: string }[])
                    .map((a, i) => (
                    <li key={i} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[12.5px] text-txt-secondary min-w-0 truncate">{a.alert_type}</span>
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
        )}
      </div>
    </>
  );
}

/* ── a repeating group of records of one kind ───────────────────────────── */
function RecordSection({ kind, title, hint, records, onSave, onRemove, disabled,
                         documents, onUpload, onOpenDoc }: {
  kind: string; title: string; hint?: string;
  records: Rec[];
  onSave: (r: Rec) => Promise<void>;
  onRemove: (id?: number) => Promise<void>;
  disabled: boolean;
  documents: Doc[];
  onUpload: (file: File, kind: string, recordId?: number) => Promise<void>;
  onOpenDoc: (documentId: number) => void;
}) {
  const mine = records.filter((r) => r.record_type === kind);
  const [draft, setDraft] = useState<Rec | null>(null);

  const fileFor = (recordId?: number) =>
    documents.find((d) => d.operator_record_id === recordId);

  return (
    <div>
      <Band title={title} hint={hint}
        right={!disabled && (
          <Button size="sm" variant="secondary" onClick={() => setDraft(emptyRecord(kind))}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        )} />
      <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="text-left">
              {["Title", kind === "EXPERIENCE" ? "Employer" : "Number", "Issuer",
                "From", "Upto", "Verified", "File", ""].map((h, i) => (
                <th key={i} className="px-3 py-2 text-[10.5px] font-bold uppercase tracking-[.1em]
                                       text-txt-light border-b border-border-light">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mine.length === 0 && !draft && (
              <tr><td colSpan={8} className="px-3 py-5 text-center text-[12.5px] text-txt-light">
                Nothing recorded.
              </td></tr>
            )}
            {mine.map((r) => {
              const doc = fileFor(r.operator_record_id);
              const lapsed = r.valid_upto && r.valid_upto < new Date().toISOString().slice(0, 10);
              return (
                <tr key={r.operator_record_id} className="border-b border-border-light last:border-0">
                  <td className="px-3 py-2 text-[12.5px] font-semibold text-navy">{r.title || "—"}</td>
                  <td className="px-3 py-2 text-[12.5px] font-mono">{r.document_no || "—"}</td>
                  <td className="px-3 py-2 text-[12.5px] text-txt-secondary">{r.issuer || "—"}</td>
                  <td className="px-3 py-2 text-[12.5px] tabular-nums">{r.valid_from || "—"}</td>
                  <td className={`px-3 py-2 text-[12.5px] tabular-nums ${lapsed ? "text-rose font-semibold" : ""}`}>
                    {r.valid_upto || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={r.verification_status === "VERIFIED" ? "emerald"
                              : r.verification_status === "REJECTED" ? "rose" : "amber"} dot={false}>
                      {(r.verification_status ?? "PENDING").toLowerCase()}
                    </Chip>
                  </td>
                  <td className="px-3 py-2">
                    {doc ? (
                      <button onClick={() => onOpenDoc(doc.operator_document_id)}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold
                                   text-sky hover:underline">
                        <Paperclip className="w-3.5 h-3.5" /> open
                      </button>
                    ) : disabled ? (
                      <span className="text-[12px] text-txt-light">—</span>
                    ) : (
                      <label className="inline-flex items-center gap-1 text-[12px] text-txt-muted
                                        hover:text-gold-dark cursor-pointer">
                        <Upload className="w-3.5 h-3.5" /> attach
                        <input type="file" className="hidden"
                          accept=".pdf,image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void onUpload(file, kind, r.operator_record_id);
                            e.target.value = "";
                          }} />
                      </label>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!disabled && (
                      <button onClick={() => void onRemove(r.operator_record_id)} aria-label="Remove"
                        className="text-txt-light hover:text-rose transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {draft && (
              <tr className="bg-gold/[0.04]">
                <td className="px-2 py-1.5">
                  <input autoFocus className={cellInput} placeholder="Title"
                    value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={cellInput} placeholder="Number"
                    value={draft.document_no ?? ""}
                    onChange={(e) => setDraft({ ...draft, document_no: e.target.value })} />
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
                <td className="px-2 py-1.5 text-[11.5px] text-txt-light">after saving</td>
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

/* ── languages: the three the mine works in, plus whatever else ─────────── */
function LanguageSection({ records, onSave, onRemove, disabled }: {
  records: Rec[];
  onSave: (r: Rec) => Promise<void>;
  onRemove: (id?: number) => Promise<void>;
  disabled: boolean;
}) {
  const mine = records.filter((r) => r.record_type === "LANGUAGE");
  const [extra, setExtra] = useState("");

  const rowFor = (language: string) =>
    mine.find((r) => (r.title ?? "").toLowerCase() === language.toLowerCase());

  const listed = [
    ...CORE_LANGUAGES,
    ...mine.map((r) => r.title ?? "").filter((t) => t && !CORE_LANGUAGES
      .some((c) => c.toLowerCase() === t.toLowerCase())),
  ];

  const setSkillLevel = async (language: string, which: "speak" | "read" | "write", level: string) => {
    const existing = rowFor(language);
    const details = { ...(existing?.details ?? {}), [which]: level };
    await onSave({ ...(existing ?? { record_type: "LANGUAGE", title: language }), details });
  };

  return (
    <div>
      <Band title="Languages"
            hint="Which languages a toolbox talk, an SOP or an emergency instruction can actually be given in" />
      <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="text-left">
              {["Language", "Speak", "Read", "Write", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-[10.5px] font-bold uppercase tracking-[.1em]
                                       text-txt-light border-b border-border-light">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listed.map((language) => {
              const row = rowFor(language);
              const details = (row?.details ?? {}) as Record<string, string>;
              const core = CORE_LANGUAGES.some((c) => c.toLowerCase() === language.toLowerCase());
              return (
                <tr key={language} className="border-b border-border-light last:border-0">
                  <td className="px-3 py-2 text-[12.5px] font-semibold text-navy">{language}</td>
                  {(["speak", "read", "write"] as const).map((which) => (
                    <td key={which} className="px-2 py-1.5">
                      <select className={cellInput} disabled={disabled}
                        value={details[which] ?? ""}
                        onChange={(e) => void setSkillLevel(language, which, e.target.value)}>
                        {LANGUAGE_LEVELS.map((l) => (
                          <option key={l || "blank"} value={l}>{l || "Not recorded"}</option>
                        ))}
                      </select>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    {!disabled && !core && row && (
                      <button onClick={() => void onRemove(row.operator_record_id)} aria-label="Remove"
                        className="text-txt-light hover:text-rose transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!disabled && (
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border-light">
            <input value={extra} onChange={(e) => setExtra(e.target.value)}
              placeholder="Another language — Santali, Bengali, Telugu…"
              className="bg-bg-base border border-border rounded-lg px-3 py-1.5 text-[12.5px] w-[280px]" />
            <Button size="sm" variant="secondary" disabled={!extra.trim()}
              onClick={async () => {
                await onSave({ record_type: "LANGUAGE", title: extra.trim(), details: {} });
                setExtra("");
              }}>
              <Plus className="w-3.5 h-3.5" /> Add language
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── skills: the country's names for what a person can do ───────────────── */
function SkillSection({ skills, records, disabled, onSave, onRemove }: {
  skills: Skill[]; records: Rec[]; disabled: boolean;
  onSave: (r: Rec) => Promise<void>;
  onRemove: (id?: number) => Promise<void>;
}) {
  const held = records.filter((r) => r.record_type === "SKILL");
  const [picked, setPicked] = useState("");
  const [validUpto, setValidUpto] = useState("");

  const has = (code: string) => held.some((h) => h.document_no === code);
  const byCategory = useMemo(() => {
    const out: Record<string, Skill[]> = {};
    skills.forEach((s) => { (out[s.category ?? "OTHER"] ??= []).push(s); });
    return out;
  }, [skills]);

  return (
    <div>
      <Band title="Skills held"
            hint="Qualification packs from the Skill Council for Mining Sector — the country's names, so this register can be read against training records and NCVET certificates" />
      <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base p-4 space-y-3">
        {!disabled && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={picked} onChange={(e) => setPicked(e.target.value)}
              className="bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px] min-w-[320px]">
              <option value="">Choose a qualification…</option>
              {Object.entries(byCategory).map(([cat, list]) => (
                <optgroup key={cat} label={cat[0] + cat.slice(1).toLowerCase()}>
                  {list.map((s) => (
                    <option key={s.skill_id} value={s.code} disabled={has(s.code)}>
                      {s.name} · {s.code}{s.nsqf_level ? ` · NSQF ${s.nsqf_level}` : ""}
                      {has(s.code) ? " — already held" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input type="date" value={validUpto} onChange={(e) => setValidUpto(e.target.value)}
              title="Valid until, if the certificate has an expiry"
              className="bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]" />
            <Button variant="primary" disabled={!picked}
              onClick={async () => {
                const s = skills.find((x) => x.code === picked);
                if (!s) return;
                await onSave({
                  record_type: "SKILL", title: s.name, document_no: s.code,
                  category: s.category, asset_type_id: s.asset_type_id ?? null,
                  valid_upto: validUpto || null, verification_status: "PENDING",
                  details: { nsqf_level: s.nsqf_level, source: "SCMS" },
                });
                setPicked(""); setValidUpto("");
              }}>
              <Plus className="w-4 h-4" /> Add skill
            </Button>
          </div>
        )}

        {held.length === 0 ? (
          <p className="text-[12.5px] text-txt-light">
            No qualifications recorded. Until they are, nothing can answer how many
            people at this mine hold a given skill.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {held.map((h) => {
              const lapsed = h.valid_upto && h.valid_upto < new Date().toISOString().slice(0, 10);
              return (
                <span key={h.operator_record_id}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px]
                              ${lapsed ? "border-rose-ring bg-rose-bg" : "border-emerald-ring bg-emerald-bg"}`}>
                  <Award className={`w-3.5 h-3.5 ${lapsed ? "text-rose" : "text-emerald"}`} />
                  <span className="font-semibold text-navy">{h.title}</span>
                  <span className="font-mono text-[11px] text-txt-muted">{h.document_no}</span>
                  {h.valid_upto && (
                    <span className={`text-[11px] ${lapsed ? "text-rose font-semibold" : "text-txt-light"}`}>
                      {lapsed ? "lapsed" : "to"} {h.valid_upto}
                    </span>
                  )}
                  {!disabled && (
                    <button onClick={() => void onRemove(h.operator_record_id)} aria-label="Remove"
                      className="text-txt-light hover:text-rose transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
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
            hint="Being assigned is not being competent — eligibility is checked and recorded, not enforced" />
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
          <p className="text-[12.5px] text-txt-light">Not assigned to any machine.</p>
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim()) { void onAdd(system, code.trim()); setCode(""); }
              }}
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

/* ── everything that was scanned or photographed ────────────────────────── */
function FileSection({ documents, disabled, onUpload, onOpen, onRemove }: {
  documents: Doc[]; disabled: boolean;
  onUpload: (file: File, kind: string) => Promise<void>;
  onOpen: (documentId: number) => void;
  onRemove: (documentId: number) => Promise<void>;
}) {
  const [kind, setKind] = useState("PHOTO");
  const [dragging, setDragging] = useState(false);

  const size = (bytes?: number | null) =>
    !bytes ? "" : bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

  return (
    <div>
      <Band title="Files"
            hint="PDFs and photographs up to 10 MB. A licence that can be looked at is worth more than a number somebody typed" />
      <div className="border border-t-0 border-border-light rounded-b-xl bg-bg-base p-4 space-y-3">
        {!disabled && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void onUpload(file, kind);
            }}
            className={`rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors
                        ${dragging ? "border-gold bg-gold/[0.06]" : "border-border"}`}>
            <Upload className="w-5 h-5 mx-auto text-txt-light mb-2" />
            <div className="flex flex-wrap items-center justify-center gap-2">
              <select value={kind} onChange={(e) => setKind(e.target.value)}
                className="bg-bg-base border border-border rounded-lg px-2.5 py-1.5 text-[12.5px]">
                {["PHOTO", "LICENCE", "MEDICAL", "CERTIFICATE", "TRAINING", "OTHER"].map((k) => (
                  <option key={k} value={k}>{k[0] + k.slice(1).toLowerCase()}</option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 rounded-lg bg-grad-gold text-white
                                px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer shadow-sm">
                <Upload className="w-3.5 h-3.5" /> Choose a file
                <input type="file" className="hidden" accept=".pdf,image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onUpload(file, kind);
                    e.target.value = "";
                  }} />
              </label>
            </div>
            <p className="text-[11.5px] text-txt-light mt-2">or drop one here</p>
          </div>
        )}

        {documents.length === 0 ? (
          <p className="text-[12.5px] text-txt-light">Nothing attached yet.</p>
        ) : (
          <ul className="divide-y divide-border-light">
            {documents.map((d) => (
              <li key={d.operator_document_id} className="py-2 flex items-center justify-between gap-3">
                <button onClick={() => onOpen(d.operator_document_id)}
                  className="flex items-center gap-2 min-w-0 text-left group">
                  <Paperclip className="w-3.5 h-3.5 text-txt-light shrink-0" />
                  <span className="text-[12.5px] text-navy font-medium truncate group-hover:underline">
                    {d.file_name}
                  </span>
                  <Chip tone="slate" dot={false}>{d.kind.toLowerCase()}</Chip>
                </button>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="text-[11.5px] text-txt-light">{size(d.size_bytes)}</span>
                  {!disabled && (
                    <button onClick={() => void onRemove(d.operator_document_id)} aria-label="Withdraw"
                      className="text-txt-light hover:text-rose transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
