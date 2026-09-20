"use client";
/**
 * Assessing one person on one machine class.
 *
 * Clicking "Assess" used to open the full profile: ten tabs, a Save and a
 * Submit-for-approval in the corner. That is right when you are keeping
 * somebody's record and wrong when you are stood at a machine deciding whether
 * a driver may run it. This is the assessment and only the assessment.
 *
 * IT STAGES, THEN SUBMITS. The first version wrote every click straight to the
 * server: fifteen requests and fifteen entries in the trail for one sitting,
 * no chance to look the whole thing over before committing it, and no way to
 * attach a remark to the assessment as a whole — the remark had to be typed
 * before the first click or not at all. Levels are now held until Submit,
 * which sends them together with one remark. What is unsent is said plainly,
 * and leaving with work in hand asks first.
 *
 * THE DIMENSIONS ARE DATA. They were an array in this file; they are rows in
 * checklist_item now, read from the server, so the mine can add one the first
 * time an auditor asks for it without waiting for a deploy.
 *
 * TWO COLUMNS, because fifteen rows in one is a screen and a half, and an
 * assessor works down a page rather than scrolling it.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CheckCircle2, Clock, Cpu, Loader2, RotateCcw, Send,
  Settings2, ShieldCheck, Star, User,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Alert, Button, Card, CardHeader, Chip, type Tone } from "./ui";
import Dialog from "./Dialog";
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
  joined_on?: string | null;
  competencies?: Comp[];
  identities?: { system: string; external_code: string }[];
}
interface AssetType { asset_type_id: number; name: string }
interface Item {
  checklist_item_id: number; code: string; label: string; help: string | null;
  asset_type_id: number | null; is_decisive: boolean; is_required: boolean;
  sort_order: number;
}

const LEVELS = ["Not assessed", "Basic / assisted", "Operational",
                "Competent / independent", "Advanced / trainer"];
const LEVEL_TONE: Tone[] = ["slate", "rose", "amber", "emerald", "violet"];

const METHODS: { id: string; label: string; why: string }[] = [
  { id: "PRACTICAL", label: "Practical", why: "Watched operating the machine" },
  { id: "OBSERVATION", label: "Observation", why: "Seen at work over a period" },
  { id: "WRITTEN", label: "Written", why: "Answered on paper" },
  { id: "ORAL", label: "Oral", why: "Questioned face to face" },
];

export default function AssessmentSheet({ operatorId, onDone, onSaved, onManageFields }: {
  operatorId: number;
  onDone: () => void;
  onSaved?: () => void;
  /** Open the screen that edits the dimensions themselves. */
  onManageFields?: () => void;
}) {
  const can = useAuth((s) => s.can);
  const mayAssess = can("platform.operators.assess");
  const mayManageFields = can("platform.operators.manage");

  const [p, setP] = useState<Profile | null>(null);
  const [types, setTypes] = useState<AssetType[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<"leave" | "submit" | null>(null);

  const [typeId, setTypeId] = useState<string>("");
  const [method, setMethod] = useState("PRACTICAL");
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [remark, setRemark] = useState("");

  // What has been set in this sitting but not yet sent. Keyed by dimension
  // code, so it survives the list being reordered underneath it.
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [draftRating, setDraftRating] = useState<number | null>(null);

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

  // The dimensions for the chosen class: the general ones, plus any this class
  // has of its own.
  const loadItems = useCallback(async () => {
    try {
      const r = await api.get("/checklists", {
        params: { kind: "COMPETENCY", asset_type_id: typeId || undefined },
      });
      setItems(r.data ?? []);
    } catch { setItems([]); }
  }, [typeId]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  // The class this person is employed to run, chosen for them. An assessor
  // opening a tipper driver should not have to find "Tipper" in a list of
  // twenty-four before they can start.
  useEffect(() => {
    if (typeId || !p || types.length === 0) return;
    const already = (p.competencies ?? []).find((c) => c.dimension === "OVERALL")?.asset_type_id;
    const byTrade = types.find((t) => t.name === p.trade_machine);
    const pick = already ?? byTrade?.asset_type_id;
    if (pick) setTypeId(String(pick));
  }, [p, types, typeId]);

  const comps = p?.competencies ?? [];
  const savedLevel = (code: string) =>
    comps.find((c) => String(c.asset_type_id ?? "") === typeId && c.dimension === code)?.level ?? 0;
  /** What the form shows: the staged value if there is one, else what is on file. */
  const levelOf = (code: string) => draft[code] ?? savedLevel(code);
  const rowFor = (code: string) =>
    comps.find((c) => String(c.asset_type_id ?? "") === typeId && c.dimension === code);

  const decisive = items.find((i) => i.is_decisive) ?? items[0];
  const overall = decisive ? rowFor(decisive.code) : undefined;
  const savedRating = overall?.rating ?? 0;
  const ratingOf = draftRating ?? savedRating;

  const attendanceId = useMemo(
    () => (p?.identities ?? []).find((i) => i.system === "CONTRACTOR")?.external_code,
    [p]);

  // Only what actually moved. Re-setting a dimension to the level it already
  // holds is not a change and should not burn a row in the trail.
  const pending = useMemo(
    () => Object.entries(draft).filter(([code, lvl]) => lvl !== savedLevel(code)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, comps, typeId]);
  const ratingChanged = draftRating !== null && draftRating !== savedRating;
  const dirty = pending.length > 0 || ratingChanged;

  const clearedNow = decisive ? levelOf(decisive.code) >= 2 : false;
  const judged = items.filter((i) => levelOf(i.code) > 0).length;
  const missing = items.filter((i) => i.is_required && levelOf(i.code) === 0);

  // Changing the machine class mid-sitting would send levels recorded against
  // one class to another, so the staged work goes with it.
  const changeType = (next: string) => {
    if (dirty && !window.confirm(
      "Changing the machine class clears what you have set but not yet submitted. Continue?")) return;
    setDraft({}); setDraftRating(null); setTypeId(next);
  };

  const setAll = (level: number) => {
    const next: Record<string, number> = {};
    for (const i of items) next[i.code] = level;
    setDraft(next);
  };

  const submit = async () => {
    setAsk(null);
    setBusy(true); setError(null);
    try {
      // One request per changed dimension, because that is what the endpoint
      // takes and each one is genuinely its own record in the trail. Sent in
      // sequence rather than at once: the server derives the next-due date and
      // the previous level from what is already there, and racing fifteen
      // writes at one row's history is how a trend goes wrong.
      for (const [code, level] of pending) {
        await api.post(`/operators/${operatorId}/competency`, {
          asset_type_id: Number(typeId),
          dimension: code,
          level,
          result: level >= 2 ? "PASS" : "PENDING",
          assessment_type: method,
          assessed_on: on,
          remarks: remark || undefined,
        });
      }
      if (ratingChanged && decisive) {
        await api.post(`/operators/${operatorId}/competency`, {
          asset_type_id: Number(typeId),
          dimension: decisive.code,
          rating: draftRating,
          assessment_type: method,
          assessed_on: on,
          remarks: remark || undefined,
        });
      }
      const howMany = pending.length;
      setDraft({}); setDraftRating(null); setRemark("");
      await load();
      onSaved?.();
      setNotice(`${howMany} level${howMany === 1 ? "" : "s"} recorded against ${on}.`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not record that. Nothing further was sent.");
    } finally { setBusy(false); }
  };

  const leave = () => { if (dirty) setAsk("leave"); else onDone(); };

  if (fetching) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Opening this assessment">
        <div className="h-[72px] rounded-xl bg-bg-base border border-border-light animate-pulse" />
        <div className="h-[92px] rounded-xl bg-bg-base border border-border-light animate-pulse" />
        <div className="h-[430px] rounded-xl bg-bg-base border border-border-light animate-pulse" />
      </div>
    );
  }
  if (!p) return <Alert tone="error">{error ?? "That person could not be opened."}</Alert>;

  const chosenType = types.find((t) => String(t.asset_type_id) === typeId);
  const cellInput = "w-full bg-bg-base border border-border rounded-lg px-2.5 py-1.5 "
    + "text-[12.5px] text-txt-primary focus:outline-none focus:border-gold "
    + "focus:ring-2 focus:ring-gold/15";

  /** One dimension. */
  const Row = ({ i }: { i: Item }) => {
    const lvl = levelOf(i.code);
    const staged = draft[i.code] !== undefined && draft[i.code] !== savedLevel(i.code);
    const row = rowFor(i.code);
    return (
      <div className={`px-3 py-1.5 border-b border-border-light
                       ${i.is_decisive ? "bg-gold/[0.06]" : ""}
                       ${staged ? "ring-1 ring-inset ring-gold/40" : ""}`}>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 flex items-center gap-1.5" title={i.help ?? undefined}>
            {i.is_decisive && <ShieldCheck className="w-3.5 h-3.5 text-gold-dark shrink-0" />}
            <span className={`text-[12.5px] truncate ${i.is_decisive
              ? "font-bold text-navy" : "font-semibold text-txt-secondary"}`}>
              {i.label}
            </span>
            {i.is_required && <span className="text-rose text-[11px]">*</span>}
          </span>

          <span className="flex items-center gap-0.5 shrink-0">
            {[0, 1, 2, 3, 4].map((n) => (
              <button key={n} type="button" disabled={!mayAssess}
                onClick={() => setDraft((d) => ({ ...d, [i.code]: n }))}
                title={LEVELS[n]} aria-pressed={lvl === n}
                className={`w-[26px] h-[26px] rounded-md text-[11.5px] font-bold
                  transition-all disabled:opacity-40 disabled:cursor-not-allowed
                  ${lvl === n
                    ? "bg-navy text-white shadow-sm ring-2 ring-gold/40"
                    : "bg-bg-light text-txt-light hover:bg-gold/10 hover:text-navy"}`}>
                {n}
              </button>
            ))}
          </span>

          <span className="w-[112px] text-right shrink-0">
            <Chip tone={LEVEL_TONE[lvl]} dot={false}>{LEVELS[lvl]}</Chip>
          </span>
        </div>

        {row?.previous_level != null && row.previous_level !== row.level && !staged && (
          <p className={`text-[10.5px] ml-1 font-semibold ${
            (row.level ?? 0) > row.previous_level ? "text-emerald" : "text-rose"}`}>
            {(row.level ?? 0) > row.previous_level ? "Improved" : "Declined"} from{" "}
            {LEVELS[row.previous_level].toLowerCase()}
          </p>
        )}
      </div>
    );
  };

  const half = Math.ceil(items.length / 2);

  return (
    <div className="space-y-3 pb-20">
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />

      <Dialog open={ask === "leave"} tone="warning" title="Leave without submitting?"
        confirmLabel="Submit and leave" cancelLabel="Stay here" busy={busy}
        onConfirm={() => { void submit().then(onDone); }}
        onCancel={() => setAsk(null)}
        secondary={{ label: "Leave, lose the levels", tone: "danger",
                     onClick: () => { setAsk(null); onDone(); } }}>
        {pending.length} level{pending.length === 1 ? " has" : "s have"} been set
        and not sent. Nothing is recorded until you submit.
      </Dialog>

      <Dialog open={ask === "submit"} tone="info" title="Record this assessment"
        confirmLabel={`Record ${pending.length} level${pending.length === 1 ? "" : "s"}`}
        cancelLabel="Not yet" busy={busy} onConfirm={submit}
        onCancel={() => setAsk(null)}>
        <p className="mb-2.5">
          Against <strong>{chosenType?.name}</strong>, judged{" "}
          {METHODS.find((m) => m.id === method)?.label.toLowerCase()}, on {on}.
          {missing.length > 0 && (
            <span className="block text-amber mt-1.5">
              {missing.map((m) => m.label).join(", ")} still at nought, and will
              be recorded as not assessed.
            </span>
          )}
        </p>
        <label className="block">
          <span className="block text-[11px] font-semibold text-txt-secondary mb-1.5">
            Remark, kept against every level in this assessment
          </span>
          <textarea id="as-remark" rows={3} value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Confident on the bench; slow on the ramp, to be re-checked in a month"
            className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]
                       text-txt-primary placeholder:text-txt-light focus:outline-none
                       focus:border-gold focus:ring-2 focus:ring-gold/15" />
        </label>
      </Dialog>

      {/* WHO and WHAT, in one band. */}
      <Card tone="emerald">
        <div className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2
                        border-b border-border-light">
          <button type="button" onClick={leave}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border
                       bg-bg-base px-2.5 py-1.5 text-[12px] font-semibold text-navy
                       hover:border-gold transition-colors shrink-0">
            <ArrowLeft className="w-3.5 h-3.5 text-gold-dark" /> Back
          </button>
          <span className="shrink-0 w-8 h-8 rounded-lg bg-emerald-bg ring-1 ring-emerald-ring
                           flex items-center justify-center">
            <User className="w-4 h-4 text-emerald" />
          </span>
          <div className="min-w-0">
            <h2 className="font-condensed font-extrabold text-[18px] leading-none text-navy">
              {p.display_name}
            </h2>
            <p className="text-[11px] text-txt-light mt-0.5 truncate">
              {[p.operator_ref, p.department, p.plant].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {attendanceId && (
              <Chip tone="violet" dot={false}>
                <span className="font-mono font-bold">{attendanceId}</span>
              </Chip>
            )}
            {p.trade && <Chip tone="sky" dot={false}>{p.trade}</Chip>}
            {p.employer && <Chip tone="amber" dot={false}>{p.employer}</Chip>}
          </div>
          <span className="flex-1" />
          <div className="shrink-0" title={overall ? exactly(overall.assessed_on) : undefined}>
            {overall ? (
              <>
                <Chip tone={LEVEL_TONE[overall.level ?? 0]}>{LEVELS[overall.level ?? 0]}</Chip>
                <span className="text-[11px] text-txt-light ml-2">{ago(overall.assessed_on)}</span>
              </>
            ) : <Chip tone="rose">never assessed on this machine</Chip>}
          </div>
        </div>

        <div className="p-2.5 grid grid-cols-2 xl:grid-cols-4 gap-2.5">
          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
              Machine class <span className="text-rose">*</span>
            </span>
            <select id="as-type" value={typeId} onChange={(e) => changeType(e.target.value)}
              className={cellInput}>
              <option value="">Choose a machine class…</option>
              {types.map((t) => (
                <option key={t.asset_type_id} value={t.asset_type_id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
              How it was judged <span className="text-rose">*</span>
            </span>
            <select id="as-method" value={method} onChange={(e) => setMethod(e.target.value)}
              className={cellInput}>
              {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
              The day it happened <span className="text-rose">*</span>
            </span>
            <input id="as-on" type="date" value={on}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setOn(e.target.value)} className={cellInput} />
          </label>
          <div className="block">
            <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
              Expertise, out of five
            </span>
            <div className="flex items-center gap-0.5 h-[32px]">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" disabled={!mayAssess}
                  onClick={() => setDraftRating(n)} aria-label={`Rate ${n} of 5`}
                  className="p-0.5 disabled:opacity-40">
                  <Star className={`w-[18px] h-[18px] transition-colors ${
                    n <= ratingOf ? "text-gold fill-gold" : "text-txt-light/40 hover:text-gold"}`} />
                </button>
              ))}
              <span className="text-[11px] text-txt-light ml-1.5">how well, not whether</span>
            </div>
          </div>
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
        <Card tone={clearedNow ? "emerald" : "amber"}>
          <CardHeader
            title={`${chosenType?.name ?? "Machine"} · ${judged} of ${items.length} judged`}
            icon={Cpu} tone={clearedNow ? "emerald" : "amber"}
            subtitle="Hover a row for what it covers. Nothing is recorded until you submit."
            actions={
              <>
                {/* Set every dimension at once. Somebody who has just watched a
                    driver work usually has one answer for most of the list and
                    then corrects two or three. */}
                {mayAssess && items.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-lg border
                                   border-border bg-bg-light p-0.5">
                    <span className="text-[11px] text-txt-light px-1.5">Set all</span>
                    {[0, 1, 2, 3, 4].map((n) => (
                      <button key={n} type="button" onClick={() => setAll(n)}
                        title={`Set every row to ${LEVELS[n].toLowerCase()}`}
                        className="w-[22px] h-[22px] rounded text-[11px] font-bold
                                   text-txt-secondary hover:bg-gold/15 hover:text-navy">
                        {n}
                      </button>
                    ))}
                  </span>
                )}
                {mayManageFields && onManageFields && (
                  <Button size="sm" variant="secondary" onClick={onManageFields}
                    title="Add, reword or reorder the things assessed here">
                    <Settings2 className="w-3.5 h-3.5" /> Fields
                  </Button>
                )}
                <Chip tone={clearedNow ? "emerald" : "amber"}>
                  {clearedNow ? "cleared to work" : "not cleared"}
                </Chip>
              </>
            } />

          {items.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-txt-muted">
              Nothing is set up to assess yet. Use <strong>Fields</strong> to add
              the first one.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2">
              <div className="lg:border-r border-border-light">
                {items.slice(0, half).map((i) => <Row key={i.code} i={i} />)}
              </div>
              <div>
                {items.slice(half).map((i) => <Row key={i.code} i={i} />)}
              </div>
            </div>
          )}
        </Card>
      )}

      {comps.filter((c) => c.dimension === (decisive?.code ?? "OVERALL")
                        && String(c.asset_type_id ?? "") !== typeId).length > 0 && (
        <Card tone="slate">
          <CardHeader title="Already cleared on" icon={CheckCircle2} tone="slate"
            subtitle="Other machine classes this person has been assessed on." />
          <div className="p-3 flex flex-wrap gap-2">
            {comps.filter((c) => c.dimension === (decisive?.code ?? "OVERALL")
                              && String(c.asset_type_id ?? "") !== typeId).map((c) => (
              <button key={c.operator_competency_id} type="button"
                onClick={() => changeType(String(c.asset_type_id ?? ""))}
                title="Assess them on this instead"
                className="inline-flex items-center gap-2 rounded-lg border border-border
                           bg-bg-base px-2.5 py-1.5 hover:border-gold transition-colors">
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

      {/* What is unsent, and the one button that sends it. Fixed, because with
          fifteen rows the submit would otherwise be below the fold exactly
          when there is something to submit. */}
      {mayAssess && typeId && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border
                        bg-bg-base/95 backdrop-blur px-5 py-2.5
                        shadow-[0_-2px_12px_rgba(15,28,53,.06)]">
          <div className="max-w-[1500px] mx-auto flex flex-wrap items-center gap-3">
            <span className={`text-[12.5px] font-semibold ${dirty ? "text-navy" : "text-txt-light"}`}>
              {dirty
                ? `${pending.length} level${pending.length === 1 ? "" : "s"} set`
                  + `${ratingChanged ? " and a rating" : ""}, not yet recorded`
                : "Nothing set in this sitting"}
            </span>
            {dirty && (
              <button type="button"
                onClick={() => { setDraft({}); setDraftRating(null); }}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold
                           text-txt-muted hover:text-navy">
                <RotateCcw className="w-3 h-3" /> Undo them
              </button>
            )}
            <span className="flex-1" />
            <Button variant="secondary" onClick={leave}>Close</Button>
            <Button variant="primary" disabled={!dirty || busy}
              onClick={() => setAsk("submit")}
              title={dirty ? "Review and record" : "Set a level first"}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit assessment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
