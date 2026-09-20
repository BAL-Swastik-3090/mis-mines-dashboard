"use client";
/**
 * Assessing one person on one machine class.
 *
 * Clicking "Assess" used to open the full profile: ten tabs covering personal
 * details, employment, schooling, languages, documents, skills, competency,
 * machines, identity and files, with a Save and a Submit-for-approval in the
 * corner. All of that is right when you are keeping somebody's record. It is
 * wrong when you are stood at a machine with a tipper driver deciding whether
 * he may run it — most of it is not your business, none of it is the job in
 * hand, and a screen offering to change a phone number invites somebody to.
 *
 * So this is the assessment and only the assessment: who, on what, at what
 * level, how it was judged, when. The identifying details are shown and not
 * editable, because you need to know you have the right person and you do not
 * need to change them to answer that.
 *
 * Each click writes immediately. There is no draft here — an assessment is a
 * decision about whether somebody may work, and holding one in a form waiting
 * for a Save button is how it gets lost when the tab closes.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CalendarClock, Check, CheckCircle2, ClipboardCheck, Clock,
  Cpu, Loader2, ShieldCheck, Star, User,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Alert, Button, Card, CardHeader, Chip, type Tone } from "./ui";
import Toast from "./Toast";
import { ago, exactly } from "./when";

interface Comp {
  operator_competency_id: number; asset_type_id: number | null;
  asset_type?: string | null; dimension: string; level: number | null;
  previous_level?: number | null; rating?: number | null;
  assessed_on?: string | null; next_assessment_due?: string | null;
  assessor?: string | null; status?: string;
}
interface Profile {
  operator_id: number; operator_ref: string | null; display_name: string;
  designation: string | null; trade?: string | null; trade_machine?: string | null;
  employer?: string | null; department?: string | null; plant?: string | null;
  joined_on?: string | null; phone?: string | null; blood_group?: string | null;
  competencies?: Comp[];
  identities?: { system: string; external_code: string }[];
  records?: { kind?: string; record_type?: string; number?: string | null;
              valid_upto?: string | null; status?: string }[];
}
interface AssetType { asset_type_id: number; name: string; category?: string }

/** The one that decides whether somebody may work, and the fourteen that say
 *  what they actually understand about the machine. Kept in this order because
 *  it is the order an assessor works through them. */
const DIMENSIONS: { id: string; label: string; why: string }[] = [
  { id: "OVERALL", label: "Overall competency",
    why: "The clearance decision. Level 2 or better is what lets this person be crewed onto the machine." },
  { id: "FAMILIARITY", label: "Machine familiarity", why: "Knows this make and model, not just the class." },
  { id: "CONTROLS", label: "Controls", why: "Every control, without looking for it." },
  { id: "OPERATING_PROCEDURE", label: "Operating procedure", why: "The sequence, start to park." },
  { id: "PRE_START", label: "Pre-start inspection", why: "The walk-round, and what stops the machine going out." },
  { id: "SAFETY_SYSTEMS", label: "Safety systems", why: "Interlocks, alarms, isolators — what they are for." },
  { id: "EMERGENCY_SHUTDOWN", label: "Emergency shutdown", why: "Where it is and when to use it." },
  { id: "RATED_CAPACITY", label: "Rated capacity", why: "What the machine is rated to move or lift." },
  { id: "OPERATING_LIMITS", label: "Operating limits", why: "Gradient, reach, weather, ground conditions." },
  { id: "ATTACHMENTS", label: "Attachments", why: "Changing them, and what each is for." },
  { id: "FLUID_CHECKS", label: "Fuel and fluid checks", why: "Levels, and what a change in them means." },
  { id: "FAULT_RECOGNITION", label: "Fault recognition", why: "Knows a fault from a noise, and what to do." },
  { id: "TELEMATICS", label: "Display and telematics", why: "Reads the display and acts on it." },
  { id: "PARKING_SHUTDOWN", label: "Safe parking and shutdown", why: "Where, how, and left safe for the next shift." },
  { id: "SITE_SOP", label: "Mine-specific SOP", why: "Kaliapani's own rules for this machine." },
];

const LEVELS = ["Not assessed", "Basic / assisted", "Operational",
                "Competent / independent", "Advanced / trainer"];
const LEVEL_TONE: Tone[] = ["slate", "rose", "amber", "emerald", "violet"];

const METHODS: { id: string; label: string; why: string }[] = [
  { id: "PRACTICAL", label: "Practical", why: "Watched operating the machine" },
  { id: "OBSERVATION", label: "Observation", why: "Seen at work over a period" },
  { id: "WRITTEN", label: "Written", why: "Answered on paper" },
  { id: "ORAL", label: "Oral", why: "Questioned face to face" },
];

export default function AssessmentSheet({ operatorId, onDone, onSaved }: {
  operatorId: number;
  onDone: () => void;
  onSaved?: () => void;
}) {
  const can = useAuth((s) => s.can);
  const mayAssess = can("platform.operators.assess");

  const [p, setP] = useState<Profile | null>(null);
  const [types, setTypes] = useState<AssetType[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [typeId, setTypeId] = useState<string>("");
  const [method, setMethod] = useState("PRACTICAL");
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [prof, ts] = await Promise.all([
        api.get(`/operators/${operatorId}`),
        api.get("/minehub/asset-types").catch(() => ({ data: [] })),
      ]);
      setP(prof.data ?? null);
      setTypes(ts.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not open this assessment.");
    } finally { setFetching(false); }
  }, [operatorId]);

  useEffect(() => { void load(); }, [load]);

  // The machine class this person is employed to run, chosen for them. An
  // assessor opening a tipper driver should not have to find "Tipper" in a
  // list of twenty-four before they can start.
  useEffect(() => {
    if (typeId || !p || types.length === 0) return;
    const already = (p.competencies ?? []).find((c) => c.dimension === "OVERALL")?.asset_type_id;
    const byTrade = types.find((t) => t.name === p.trade_machine);
    const pick = already ?? byTrade?.asset_type_id;
    if (pick) setTypeId(String(pick));
  }, [p, types, typeId]);

  const comps = p?.competencies ?? [];
  const rowFor = (dimension: string) =>
    comps.find((c) => String(c.asset_type_id ?? "") === typeId && c.dimension === dimension);
  const levelFor = (dimension: string) => rowFor(dimension)?.level ?? 0;
  const overall = rowFor("OVERALL");

  const attendanceId = useMemo(
    () => (p?.identities ?? []).find((i) => i.system === "CONTRACTOR")?.external_code,
    [p]);

  const cleared = (overall?.level ?? 0) >= 2;
  const doneCount = DIMENSIONS.filter((d) => levelFor(d.id) > 0).length;

  const write = async (payload: Record<string, unknown>, said: string) => {
    if (!typeId) { setError("Choose the machine class being assessed."); return; }
    setBusy(String(payload.dimension ?? "rating"));
    setError(null);
    try {
      await api.post(`/operators/${operatorId}/competency`, {
        asset_type_id: Number(typeId),
        assessment_type: method,
        assessed_on: on,
        remarks: note || undefined,
        ...payload,
      });
      await load();
      onSaved?.();
      setNotice(`${said} — recorded against ${on}.`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not record that.");
    } finally { setBusy(null); }
  };

  const setLevel = (dimension: string, level: number, label: string) =>
    write({ dimension, level, result: level >= 2 ? "PASS" : "PENDING" },
          `${label} set to ${LEVELS[level].toLowerCase()}`);

  if (fetching) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Opening this assessment">
        <div className="h-9 w-28 rounded-lg bg-slate-200/70 animate-pulse" />
        <div className="h-[104px] rounded-xl bg-bg-base border border-border-light animate-pulse" />
        <div className="h-[120px] rounded-xl bg-bg-base border border-border-light animate-pulse" />
        <div className="h-[420px] rounded-xl bg-bg-base border border-border-light animate-pulse" />
      </div>
    );
  }
  if (!p) return <Alert tone="error">{error ?? "That person could not be opened."}</Alert>;

  const chosenType = types.find((t) => String(t.asset_type_id) === typeId);

  return (
    <div className="space-y-4 pb-10">
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />

      <Button variant="secondary" onClick={onDone}>
        <ArrowLeft className="w-4 h-4 text-gold-dark" /> Back to the list
      </Button>

      {/* WHO. Shown, not editable: you need to know you have the right person,
          and you do not need to change anything about them to decide that. */}
      <Card tone="emerald">
        <div className="p-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <span className="shrink-0 w-12 h-12 rounded-xl bg-emerald-bg ring-1 ring-emerald-ring
                             flex items-center justify-center">
              <User className="w-6 h-6 text-emerald" />
            </span>
            <div className="min-w-0">
              <h2 className="font-condensed font-extrabold text-[24px] leading-none text-navy">
                {p.display_name}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                {attendanceId && (
                  <Chip tone="violet" dot={false}>
                    <span className="font-mono font-bold">{attendanceId}</span>
                  </Chip>
                )}
                {p.operator_ref && (
                  <span className="font-mono text-[11.5px] text-txt-light">{p.operator_ref}</span>
                )}
                {p.trade && <Chip tone="sky" dot={false}>{p.trade}</Chip>}
                {p.employer && <Chip tone="amber" dot={false}>{p.employer}</Chip>}
              </div>
              <p className="text-[12px] text-txt-muted mt-2">
                {[p.department, p.plant].filter(Boolean).join(" · ")}
                {p.joined_on ? ` · joined ${String(p.joined_on).slice(0, 10)}` : ""}
              </p>
            </div>
          </div>

          {/* Where they stand right now, in one line. */}
          <div className="text-right shrink-0">
            <div className="font-condensed text-[9.5px] font-bold uppercase tracking-[.13em]
                            text-txt-light mb-1.5">Currently</div>
            {overall ? (
              <>
                <Chip tone={LEVEL_TONE[overall.level ?? 0]}>
                  {LEVELS[overall.level ?? 0]}
                </Chip>
                <p className="text-[11.5px] text-txt-muted mt-1.5"
                   title={exactly(overall.assessed_on)}>
                  assessed {ago(overall.assessed_on)}
                </p>
              </>
            ) : (
              <Chip tone="rose">never assessed on this machine</Chip>
            )}
          </div>
        </div>
      </Card>

      {/* WHAT, HOW, WHEN. Three answers, then the assessment itself. */}
      <Card tone="violet">
        <CardHeader title="This assessment" icon={ClipboardCheck} tone="violet"
          subtitle="Set these once. Every level below is recorded against them, and each one is written the moment you click it — there is no Save." />
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1.5">
              Machine class <span className="text-rose">*</span>
            </span>
            <select id="as-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}
              className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]
                         text-txt-primary focus:outline-none focus:border-gold
                         focus:ring-2 focus:ring-gold/15">
              <option value="">Choose a machine class…</option>
              {types.map((t) => (
                <option key={t.asset_type_id} value={t.asset_type_id}>{t.name}</option>
              ))}
            </select>
            <span className="block text-[11px] text-txt-light mt-1">
              {p.trade_machine
                ? `Employed as ${p.trade}, which runs ${p.trade_machine}.`
                : "Their trade does not name a machine, so choose it here."}
            </span>
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1.5">
              How it was judged <span className="text-rose">*</span>
            </span>
            <select id="as-method" value={method} onChange={(e) => setMethod(e.target.value)}
              className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]
                         text-txt-primary focus:outline-none focus:border-gold
                         focus:ring-2 focus:ring-gold/15">
              {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <span className="block text-[11px] text-txt-light mt-1">
              {METHODS.find((m) => m.id === method)?.why}
            </span>
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1.5">
              The day it happened <span className="text-rose">*</span>
            </span>
            <input id="as-on" type="date" value={on} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setOn(e.target.value)}
              className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]
                         text-txt-primary focus:outline-none focus:border-gold
                         focus:ring-2 focus:ring-gold/15" />
            <span className="block text-[11px] text-txt-light mt-1">
              Not today by default if it was not today. The mine limits how far
              back an assessment may be dated.
            </span>
          </label>

          <label className="block md:col-span-3">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1.5">
              Note (kept with every level set below)
            </span>
            <input id="as-note" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Confident on the bench; slow on the ramp, to be re-checked in a month"
              className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]
                         text-txt-primary placeholder:text-txt-light focus:outline-none
                         focus:border-gold focus:ring-2 focus:ring-gold/15" />
          </label>
        </div>
      </Card>

      {!typeId ? (
        <Card>
          <p className="px-5 py-10 text-center text-[13px] text-txt-muted">
            Choose the machine class above to begin. Competency is held per
            class, because being cleared on a tipper says nothing about an
            excavator.
          </p>
        </Card>
      ) : (
        <Card tone={cleared ? "emerald" : "amber"}>
          <CardHeader
            title={`${chosenType?.name ?? "Machine"} · ${doneCount} of ${DIMENSIONS.length} judged`}
            icon={Cpu} tone={cleared ? "emerald" : "amber"}
            subtitle="Overall decides whether this person may be crewed onto the machine. The rest say what they actually understand about it, and are what a re-assessment is compared against."
            actions={
              <Chip tone={cleared ? "emerald" : "amber"}>
                {cleared ? "cleared to work" : "not cleared"}
              </Chip>
            } />

          <div className="divide-y divide-border-light">
            {DIMENSIONS.map((d) => {
              const lvl = levelFor(d.id);
              const row = rowFor(d.id);
              const isOverall = d.id === "OVERALL";
              return (
                <div key={d.id}
                  className={`px-4 py-3 ${isOverall ? "bg-gold/[0.05]" : ""}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[210px] flex-1">
                      <div className="flex items-center gap-2">
                        {isOverall && <ShieldCheck className="w-3.5 h-3.5 text-gold-dark shrink-0" />}
                        <span className={`text-[13px] ${isOverall
                          ? "font-bold text-navy" : "font-semibold text-txt-secondary"}`}>
                          {d.label}
                        </span>
                        {busy === d.id && <Loader2 className="w-3 h-3 animate-spin text-gold" />}
                      </div>
                      <p className="text-[11px] text-txt-light mt-0.5">{d.why}</p>
                    </div>

                    {/* Five buttons rather than a dropdown: the whole scale is
                        visible, the current point is obvious, and setting one
                        is a single click on a screen used standing up. */}
                    <div className="flex items-center gap-1">
                      {[0, 1, 2, 3, 4].map((n) => (
                        <button key={n} type="button" disabled={!mayAssess || busy !== null}
                          onClick={() => setLevel(d.id, n, d.label)}
                          title={`${LEVELS[n]}${n >= 2 && isOverall ? " — cleared to work" : ""}`}
                          aria-pressed={lvl === n}
                          className={`w-8 h-8 rounded-lg text-[12px] font-bold transition-all
                            disabled:opacity-40 disabled:cursor-not-allowed
                            ${lvl === n
                              ? "bg-navy text-white shadow-sm ring-2 ring-gold/40"
                              : "bg-bg-light text-txt-light hover:bg-gold/10 hover:text-navy"}`}>
                          {n}
                        </button>
                      ))}
                    </div>

                    <span className="w-[150px] text-right">
                      <Chip tone={LEVEL_TONE[lvl]} dot={false}>{LEVELS[lvl]}</Chip>
                    </span>
                  </div>

                  {/* Whether it moved. The point of assessing again is the
                      trend, so a level that fell is said out loud. */}
                  {row?.previous_level != null && row.previous_level !== row.level && (
                    <p className={`text-[11px] mt-1.5 ml-1 font-semibold ${
                      (row.level ?? 0) > row.previous_level ? "text-emerald" : "text-rose"}`}>
                      {(row.level ?? 0) > row.previous_level ? "Improved" : "Declined"} from{" "}
                      {LEVELS[row.previous_level].toLowerCase()}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Expertise, separate from clearance: a level says whether they may
              work, a rating says how well, and conflating the two makes the
              first one soft. */}
          <div className="px-4 py-3.5 border-t border-border flex flex-wrap items-center gap-3">
            <span className="text-[13px] font-semibold text-txt-secondary flex items-center gap-2">
              <Star className="w-3.5 h-3.5 text-gold" /> Expertise, out of five
            </span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" disabled={!mayAssess || busy !== null}
                  onClick={() => write({ dimension: "OVERALL", rating: n },
                                       `Expertise rated ${n} of 5`)}
                  aria-label={`Rate ${n} of 5`}
                  className="p-0.5 disabled:opacity-40 disabled:cursor-not-allowed">
                  <Star className={`w-5 h-5 transition-colors ${
                    n <= (overall?.rating ?? 0)
                      ? "text-gold fill-gold" : "text-txt-light/40 hover:text-gold"}`} />
                </button>
              ))}
            </div>
            <span className="text-[11.5px] text-txt-light">
              How well they do it, which is not the same question as whether
              they may.
            </span>
          </div>

          {overall?.next_assessment_due && (
            <div className="px-4 py-3 border-t border-border-light bg-bg-light/60
                            flex items-center gap-2 text-[12px] text-txt-muted">
              <CalendarClock className="w-3.5 h-3.5 text-txt-light" />
              Due again on {String(overall.next_assessment_due).slice(0, 10)}
              {overall.assessor ? ` · last assessed by ${overall.assessor}` : ""}
            </div>
          )}
        </Card>
      )}

      {/* What else this person is already cleared on, so an assessor can see
          the whole picture without leaving the screen. */}
      {comps.filter((c) => c.dimension === "OVERALL" && String(c.asset_type_id ?? "") !== typeId)
            .length > 0 && (
        <Card tone="slate">
          <CardHeader title="Already cleared on" icon={CheckCircle2} tone="slate"
            subtitle="Other machine classes this person has been assessed on." />
          <div className="p-4 flex flex-wrap gap-2">
            {comps.filter((c) => c.dimension === "OVERALL"
                              && String(c.asset_type_id ?? "") !== typeId).map((c) => (
              <button key={c.operator_competency_id} type="button"
                onClick={() => setTypeId(String(c.asset_type_id ?? ""))}
                title="Assess them on this instead"
                className="inline-flex items-center gap-2 rounded-lg border border-border
                           bg-bg-base px-3 py-2 hover:border-gold transition-colors">
                <Cpu className="w-3.5 h-3.5 text-txt-light" />
                <span className="text-[12.5px] font-semibold text-navy">{c.asset_type}</span>
                <Chip tone={LEVEL_TONE[c.level ?? 0]} dot={false}>{LEVELS[c.level ?? 0]}</Chip>
                <span className="text-[11px] text-txt-light inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />{ago(c.assessed_on)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {!mayAssess && (
        <Alert tone="warning">
          You can read this but not record an assessment. An Access Manager
          grants <code>platform.operators.assess</code>.
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={onDone}>
          <Check className="w-4 h-4" /> Done
        </Button>
        <span className="text-[12px] text-txt-muted">
          Everything above is already saved. There is nothing waiting.
        </span>
      </div>
    </div>
  );
}
