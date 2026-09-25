"use client";
/**
 * Who runs what — the standing plan, one row per machine.
 *
 * A machine is not run by one person. A tipper has a driver on each shift and
 * somebody who covers when one of them is off, so the crew is a list and the
 * screen shows it as one: chips you add to and take away from, the way a task
 * takes assignees.
 *
 * THIS IS A PLAN AND NOTHING ELSE
 *
 * Naming a crew here puts nobody on a machine today. It is the standing map a
 * shift is built from; deploying is a separate act, on a day, done from the
 * Shift Board after somebody has looked at the plan and agreed with it. The
 * two were nearly one screen, and that would have meant editing a plan quietly
 * sent people out.
 *
 * Two columns, two sources, and the screen says which is which. The crew is
 * yours to choose. "Cleared" comes from the competency register and cannot be
 * typed in — somebody appears there once they have been assessed, and a screen
 * that let you declare a clearance would let you skip the assessment.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Truck, Loader2, Search, AlertTriangle, UserX, Plus, X, ShieldCheck,
  Download, Upload, Check,
} from "lucide-react";
import api from "@/lib/api";
import { matchesSearch } from "@/lib/search";
import {
  Card, CardHeader, Chip, EmptyRow, Td, Th, inputClass, Button, type Tone,
} from "@/components/minehub/ui";
import SearchSelect from "@/components/minehub/SearchSelect";
import Dialog from "@/components/minehub/Dialog";
import { useDateFilter } from "@/contexts/useDateFilter";

interface Person {
  operator_id: number; display_name: string; operator_ref: string | null;
  designation: string | null;
  trade: string | null; employer: string | null; department: string | null;
  /** Machines this person is already named against. Offering somebody for a
   *  second machine without showing this is how one man ends up planned onto
   *  four tippers. */
  assigned_to: string[];
}

interface CrewMember {
  operator_id: number; person: string; operator_ref: string | null;
  role: string; shift: string | null; since: string;
  cleared: boolean; state: string | null;
  level: number | null; rating: number | null;
}

interface Candidate {
  operator_id: number; person: string; operator_ref: string | null;
  trade: string | null; level: number | null; rating: number | null;
  matched: "this machine" | "its class";
  lapsed: boolean; reassessment_overdue: boolean;
  state: string | null; shift: string | null; why_not: string | null;
}

interface Machine {
  asset_id: number; fleet_code: string | null; registration_no: string | null;
  nickname: string | null; asset_type: string | null; status: string;
  category: string | null; department: string | null;
  ownership: string | null; owner: string | null;
  crew: CrewMember[]; crew_size: number; crew_not_cleared: number;
  can_run: number; free_now: number; candidates: Candidate[];
}

interface ImportReport {
  dry_run: boolean; file: string; machines_in_file: number;
  changes: { row: number; ref: string; display_name: string;
             fleet_code: string; role?: string; action: string }[];
  problems: { row: number; ref: string; why: string }[];
  summary: Record<string, number>;
}

const ROLE_TONE: Record<string, Tone> = {
  PRIMARY: "emerald", RELIEF: "sky", STANDBY: "slate", TRAINEE: "amber",
};

/** What the roster says somebody is doing, in the words people use. */
function doing(state: string | null): string {
  switch (state) {
    case "ON": return "on shift";
    case "REST": return "resting";
    case "LEAVE": return "on leave";
    case "HOLIDAY": return "holiday";
    default: return "not rostered";
  }
}

export default function MachineCover() {
  // The day comes from the date picker in the page header, not from one of its
  // own. Two pickers on one screen is two answers to "which day am I looking
  // at", and the one in the header is the one every other screen already obeys
  // — a roster that disagreed with the header would be the screen at fault.
  //
  // The header picks a range; the day that matters here is the end of it, which
  // is the "report as on" date the header itself displays.
  const day = useDateFilter((s2) => s2.apiTo);
  const [rows, setRows] = useState<Machine[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  // Machines are narrowed the way a planner thinks about them: the part of the
  // mine, the kind of work, the hire. Three hundred rows is not a list anybody
  // reads, and a filter is what turns it into one.
  const [by, setBy] = useState({ category: "", department: "", type: "",
                                 ownership: "", crew: "" });
  const [importing, setImporting] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [pick, setPick] = useState("");
  // Chosen but not yet saved. Every click used to be a write, so a supervisor
  // building a crew of four made four round trips and could not change their
  // mind halfway without undoing what they had already done.
  const [draft, setDraft] = useState<CrewMember[]>([]);
  const [pickBy, setPickBy] = useState({ trade: "", employer: "", department: "" });
  const [section, setSection] = useState<"all" | "planned" | "none">("planned");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/workforce/cover", { params: { day } });
      // Normalised here, once, because the shape is a claim and not a promise.
      //
      // `crew: CrewMember[]` is what TypeScript believes; what arrives is
      // whatever the server sent. A browser holding this bundle against a
      // backend that has not been restarted yet gets a response with no crew
      // field at all, and `m.crew.map` took the whole page down with a
      // TypeError — which is how a deploy in progress becomes a white screen
      // for everybody mid-request rather than a list missing one column.
      setRows((r.data?.machines ?? []).map((m: Machine) => ({
        ...m,
        crew: Array.isArray(m.crew) ? m.crew : [],
        candidates: Array.isArray(m.candidates) ? m.candidates : [],
        crew_size: m.crew_size ?? (Array.isArray(m.crew) ? m.crew.length : 0),
        crew_not_cleared: m.crew_not_cleared ?? 0,
        can_run: m.can_run ?? 0,
      })));
      setError(null);
    } catch {
      setError("Who runs what could not be read.");
    } finally { setLoading(false); }
  }, [day]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const d = (await api.get("/workforce/people")).data;
        setPeople(Array.isArray(d) ? d : []);
      }
      catch { /* the picker says so itself when it comes up empty */ }
    })();
  }, []);

  /** Send the whole crew, never a change to it.
   *
   *  Two people editing one machine with add-and-remove calls end up with a
   *  crew neither of them chose. Sending the list means the last intention is
   *  what stands, and it reads as one line in the history. */
  const saveCrew = useCallback(async (m: Machine, crew: CrewMember[]) => {
    setBusy(true);
    try {
      await api.put(`/workforce/cover/${m.asset_id}/crew`, {
        operators: crew.map((c) => ({ operator_id: c.operator_id, role: c.role })),
      });
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That crew could not be saved.");
    } finally { setBusy(false); }
  }, [load]);

  const optionsOf = useCallback((pick: (m: Machine) => string | null) =>
    [...new Set(rows.map(pick).filter(Boolean) as string[])].sort(), [rows]);

  /** Only people actually on a crew. Offering all 211 would be a list of
   *  names that mostly return nothing. */
  const peopleOptions = useMemo(() => ({
    trade: [...new Set(people.map((p2) => p2.trade).filter(Boolean) as string[])].sort(),
    employer: [...new Set(people.map((p2) => p2.employer).filter(Boolean) as string[])].sort(),
    department: [...new Set(people.map((p2) => p2.department).filter(Boolean) as string[])].sort(),
  }), [people]);

  const crewNames = useMemo(() =>
    [...new Set(rows.flatMap((m) => m.crew.map((c) => c.person)))].sort(),
    [rows]);

  const exportPlan = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.get("/workforce/cover/export", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Kaliapani-crews-${day}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch { setError("The plan could not be exported."); }
    finally { setBusy(false); }
  }, [day]);

  /** Always read first. Nothing is written until somebody has seen what would
   *  change — a spreadsheet that has been round the office is never something
   *  anybody is certain about. */
  const readImport = useCallback(async (f: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const r = await api.post("/workforce/cover/import?dry_run=true", form);
      setPending(f);
      setImporting(r.data);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That file could not be read.");
    } finally { setBusy(false); }
  }, []);

  const applyImport = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", pending);
      await api.post("/workforce/cover/import?dry_run=false", form);
      setImporting(null);
      setPending(null);
      await load();
    } catch { setError("Those changes could not be applied."); }
    finally { setBusy(false); }
  }, [pending, load]);

  const shown = useMemo(() => rows
    .filter((m) => section === "all" ? true
                 : section === "planned" ? m.crew_size > 0
                 : m.crew_size === 0)
    .filter((m) => (!by.category || m.category === by.category)
                && (!by.department || (m.department ?? "") === by.department)
                && (!by.type || m.asset_type === by.type)
                && (!by.ownership || m.ownership === by.ownership)
                // "Which machines is this man on" is the other direction of the
                // same question, and until now the only way to ask it was to
                // read every row.
                && (!by.crew || m.crew.some((c) => c.person === by.crew)))
    .filter((m) => matchesSearch(q, [
      m.fleet_code, m.registration_no, m.nickname, m.asset_type,
      ...m.crew.map((c) => c.person),
      ...m.candidates.map((c) => c.person),
    ])), [rows, q, by, section]);

  const editingMachine = useMemo(
    () => rows.find((m) => m.asset_id === editing) ?? null, [rows, editing]);

  /** Who the dialog may still add: everybody, less those already chosen,
   *  narrowed by its own filters, and marked with what is known about them. */
  const pickable = useMemo(() => {
    if (!editingMachine) return [];
    const already = new Set(draft.map((c) => c.operator_id));
    return people
      .filter((pp) => !already.has(pp.operator_id))
      .filter((pp) => (!pickBy.trade || pp.trade === pickBy.trade)
                   && (!pickBy.employer || pp.employer === pickBy.employer)
                   && (!pickBy.department || pp.department === pickBy.department))
      .map((pp) => {
        const cand = editingMachine.candidates.find(
          (c) => c.operator_id === pp.operator_id);
        return {
          id: pp.operator_id, name: pp.display_name, trade: pp.trade,
          cleared: Boolean(cand), rating: cand?.rating ?? null,
          level: cand?.level ?? null,
          elsewhere: (pp.assigned_to ?? []).filter((f) => f !== editingMachine.fleet_code),
        };
      })
      .filter((o) => matchesSearch(pick, [o.name, o.trade]))
      .sort((a, b) => Number(b.cleared) - Number(a.cleared)
                   || a.name.localeCompare(b.name));
  }, [editingMachine, people, draft, pickBy, pick]);

  const unplanned = rows.filter((m) => m.crew_size === 0).length;
  const planned = rows.reduce((n, m) => n + m.crew_size, 0);
  const notCleared = rows.reduce((n, m) => n + m.crew_not_cleared, 0);

  return (
    <Card>
      {/* The explanation is on the icon, not under the title. Three lines
          saying what the screen is for cost sixty vertical pixels every time
          anybody opens it, and are worth reading once. */}
      <CardHeader icon={Truck} title="Who runs what" tone="teal"
        subtitleOnIcon
        subtitle="The standing plan: the crew named against each machine. Naming somebody here deploys nobody — that happens on the Shift Board, on the day."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* One shape for all four, so the bar reads as a set rather than
                four controls that happen to sit together. */}
            {([
              ["department", "All departments", optionsOf((m) => m.department)],
              ["category", "All work", optionsOf((m) => m.category)],
              ["type", "All types", optionsOf((m) => m.asset_type)],
              ["ownership", "Own and hired", optionsOf((m) => m.ownership)],
              ["crew", "Anybody's machines", crewNames],
            ] as const).map(([key, all, options]) => (
              <SearchSelect key={key} value={by[key]} allLabel={all} options={options}
                onChange={(v) => setBy({ ...by, [key]: v })} />
            ))}
            <Button size="sm" variant="secondary" disabled={busy}
                    onClick={() => void exportPlan()} title="Download the whole plan">
              <Download className="w-3.5 h-3.5" /> Excel
            </Button>
            <label className="inline-flex items-center gap-1.5 rounded-lg border
                              border-slate-200 bg-white px-2.5 py-1.5 text-[11px]
                              font-semibold text-txt-muted hover:bg-slate-50
                              cursor-pointer transition"
                   title="Bring an edited Crews sheet back">
              <Upload className="w-3.5 h-3.5" /> Import
              <input type="file" className="hidden"
                     accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                     onChange={(e) => {
                       const f = e.target.files?.[0];
                       e.target.value = "";
                       if (f) void readImport(f);
                     }} />
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Machine, type or person"
                className={`${inputClass} pl-8 w-full sm:w-[260px] lg:w-[340px]`} />
            </div>
          </div>
        } />

      {error && <p className="px-4 py-3 text-[12.5px] text-rose">{error}</p>}

      {!error && (
        <>
          <div className="px-4 py-2 border-b border-border-light flex flex-wrap items-center
                          gap-3 text-[12px] text-txt-muted">
            {/* Two sections, because they are two jobs. Reading a plan and
                filling the gaps in one are different errands, and a single
                list of a hundred and seven mixes them. */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              {/* Assigned first, then the gaps, then everything. The plan
                  is what somebody came to read; "all 107" is the least useful
                  of the three and was leading. */}
              {([
                ["planned", `Assigned ${rows.length - unplanned}`],
                ["none", `No crew ${unplanned}`],
                ["all", `All ${rows.length}`],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setSection(id)}
                  className={`px-2.5 py-1 text-[12px] transition-colors ${
                    section === id
                      ? "bg-gold/15 text-txt-primary font-semibold"
                      : "text-txt-muted hover:bg-bg-hover"}`}>
                  {label}
                </button>
              ))}
            </div>
            <span><strong className="text-txt-primary tabular-nums">{planned}</strong> people planned</span>
            {unplanned > 0 && (
              <span className="inline-flex items-center gap-1 text-amber">
                <AlertTriangle className="w-3.5 h-3.5" /> {unplanned} with no crew
              </span>
            )}
            {notCleared > 0 && (
              <span className="inline-flex items-center gap-1 text-rose">
                <UserX className="w-3.5 h-3.5" /> {notCleared} planned but not assessed
              </span>
            )}
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-txt-light" />}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  <Th>Machine</Th>
                  <Th>Type</Th>
                  <Th>Crew — yours to choose</Th>
                  <Th>Cleared — from the assessments</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center">
                    <Loader2 className="w-4 h-4 animate-spin inline text-txt-light" />
                  </td></tr>
                )}
                {!loading && shown.length === 0 && (
                  <EmptyRow colSpan={4}>
                    {rows.length === 0 ? "No machines to show."
                      : section === "none" ? "Every machine has a crew."
                      : section === "planned" && !q
                        ? "No machine has a crew yet. Open “No crew” and start naming people."
                      : `Nothing matches “${q}”.`}
                  </EmptyRow>
                )}
                {!loading && shown.map((m) => {
                  return (
                    <tr key={m.asset_id} className="border-t border-border-light align-top">
                      <Td>
                        <span className="font-semibold text-navy">{m.fleet_code || "—"}</span>
                        {m.registration_no && (
                          <span className="block text-[11px] text-txt-light">{m.registration_no}</span>
                        )}
                      </Td>
                      <Td className="text-[12px]">{m.asset_type || "—"}</Td>

                      <Td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {m.crew.map((c) => (
                            <span key={c.operator_id}
                              title={`${c.role.toLowerCase()} · ${doing(c.state)}`
                                     + (c.cleared
                                          ? ` · assessed${c.level ? ` at level ${c.level}` : ""}`
                                          : " · NOT assessed on this machine")}
                              className={`inline-flex items-center gap-1 rounded-full pl-2 pr-1
                                          py-0.5 text-[11.5px] border ${
                                c.cleared ? "bg-emerald-bg border-emerald-ring text-emerald"
                                          : "bg-rose-bg border-rose-ring text-rose"}`}>
                              {c.cleared && <ShieldCheck className="w-3 h-3" />}
                              {c.person}
                              {/* What he is rated, or that nobody has said.
                                  A crew chip that looks the same for a man
                                  signed off at level 4 and a man never assessed
                                  is a chip that tells a supervisor nothing. */}
                              <span className="text-[10px] opacity-80">
                                {c.rating ? `${c.rating}/5`
                                  : c.level ? `L${c.level}`
                                  : "not assessed"}
                              </span>
                              <Chip tone={ROLE_TONE[c.role] ?? "slate"} dot={false}>
                                {c.role.toLowerCase()}
                              </Chip>
                              <button type="button" disabled={busy}
                                title={`Take ${c.person} off ${m.fleet_code}`}
                                onClick={() => void saveCrew(m, m.crew.filter(
                                  (x) => x.operator_id !== c.operator_id))}
                                className="rounded-full p-0.5 hover:bg-white/60">
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}

                          {(
                            <button type="button" disabled={busy}
                              onClick={() => {
                                setEditing(m.asset_id);
                                setDraft(m.crew);
                                setPick("");
                                setPickBy({ trade: "", employer: "", department: "" });
                              }}
                              className="inline-flex items-center gap-1 rounded-full border
                                         border-dashed border-slate-300 px-2 py-0.5
                                         text-[11.5px] text-txt-light hover:border-gold
                                         hover:text-gold">
                              <Plus className="w-3 h-3" />
                              {m.crew.length === 0 ? "add a crew" : "change"}
                            </button>
                          )}
                        </div>
                      </Td>

                      <Td>
                        {m.can_run === 0
                          ? <span className="text-[11.5px] text-txt-light">
                              nobody assessed on {m.asset_type ?? "this"}
                            </span>
                          : (
                            <span className="text-[12px]">
                              {m.candidates.slice(0, 3).map((c) => c.person).join(", ")}
                              {m.can_run > 3 && (
                                <span className="text-txt-light"> and {m.can_run - 3} more</span>
                              )}
                            </span>
                          )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* The picker is a dialog, not something inside the table.
          Inline it grew the row to the height of the panel. Floating it was
          clipped: the table scrolls sideways, and an overflow container crops
          anything positioned inside it — the search box, the three filters and
          the Save button were all cut away, leaving a list of names hanging
          over the rows with no way to act on them.
          A dialog is outside both problems, and choosing who runs a machine is
          enough of a decision to deserve one. */}
      {editingMachine && (
        <Dialog open bare width={560}
          title={`Crew for ${editingMachine.fleet_code || "this machine"}`}
          confirmLabel={draft.length === 0 ? "Save — nobody on it"
                                           : `Save crew of ${draft.length}`}
          cancelLabel="Cancel" busy={busy}
          onCancel={() => { setEditing(null); setPick(""); }}
          onConfirm={() => {
            const m = editingMachine;
            setEditing(null); setPick("");
            void saveCrew(m, draft);
          }}>
          <div className="space-y-3">
            <p className="text-[12px] text-txt-muted">
              {editingMachine.asset_type || "machine"}
              {editingMachine.registration_no ? ` · ${editingMachine.registration_no}` : ""}
              {" — the first person chosen drives it, the rest cover."}
            </p>

            {draft.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {draft.map((c) => (
                  <span key={c.operator_id}
                    className={`inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5
                                text-[11.5px] border ${
                      c.cleared ? "bg-emerald-bg border-emerald-ring text-emerald"
                                : "bg-rose-bg border-rose-ring text-rose"}`}>
                    {c.cleared && <ShieldCheck className="w-3 h-3" />}
                    {c.person}
                    <Chip tone={ROLE_TONE[c.role] ?? "slate"} dot={false}>
                      {c.role.toLowerCase()}
                    </Chip>
                    <button type="button" title={`Take ${c.person} off`}
                      onClick={() => setDraft(draft.filter(
                        (x) => x.operator_id !== c.operator_id))}
                      className="rounded-full p-0.5 hover:bg-white/60">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-txt-light">
                Nobody chosen yet. Pick from the list below.
              </p>
            )}

            <input autoFocus value={pick} placeholder="Type a name…"
              onChange={(e) => setPick(e.target.value)} className={inputClass} />

            {/* The picker gets its own filters. Two hundred names is not a list
                anybody scrolls — a planner knows the contractor, the department
                or the trade before they know the name. */}
            <div className="flex flex-wrap gap-1.5">
              {([
                ["trade", "Any trade", peopleOptions.trade],
                ["employer", "Any contractor", peopleOptions.employer],
                ["department", "Any department", peopleOptions.department],
              ] as const).map(([key, all, options]) => (
                <SearchSelect key={key} value={pickBy[key]} allLabel={all} options={options}
                  narrow onChange={(v) => setPickBy({ ...pickBy, [key]: v })} />
              ))}
            </div>

            <div className="rounded-lg border border-border-light max-h-64 overflow-auto">
              {pickable.length === 0 && (
                <p className="px-3 py-3 text-[11.5px] text-txt-light">
                  Nobody matches. Clear a filter above.
                </p>
              )}
              {pickable.slice(0, 80).map((o) => (
                <button key={o.id} type="button"
                  onClick={() => setDraft([...draft, {
                    operator_id: o.id, person: o.name, operator_ref: null,
                    role: draft.length === 0 ? "PRIMARY" : "RELIEF",
                    shift: null, since: day, cleared: o.cleared,
                    state: null, level: o.level, rating: o.rating,
                  }])}
                  className="w-full text-left px-3 py-1.5 flex items-center justify-between
                             gap-2 hover:bg-gold/[0.07] border-b border-border-light
                             last:border-0">
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-navy truncate">
                      {o.name}
                    </span>
                    <span className="block text-[10.5px] text-txt-light truncate">
                      {o.trade ?? "trade not set"}
                      {/* Already named on another machine. One man planned onto
                          four tippers is a plan that cannot happen, and this is
                          where it gets noticed. */}
                      {o.elsewhere.length > 0 && (
                        <span className="text-amber">
                          {" · already on "}{o.elsewhere.join(", ")}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10.5px]">
                    {o.cleared
                      ? <span className="text-emerald">
                          {o.rating ? `${o.rating}/5` : `L${o.level ?? "?"}`}
                        </span>
                      : <span className="text-txt-light">not assessed</span>}
                  </span>
                </button>
              ))}
            </div>

            <p className="text-[11px] text-txt-light">
              {draft.length} chosen · {pickable.length} to pick from
              {pickable.length > 80 && " · showing the first 80"}
            </p>
          </div>
        </Dialog>
      )}

      {importing && (
        <Dialog open tone="warning" width={760}
          title={`Import ${importing.changes.length} crew change(s)`}
          confirmLabel="Apply these changes" busy={busy}
          onConfirm={() => void applyImport()}
          onCancel={() => { setImporting(null); setPending(null); }}>
          <div className="space-y-3">
            <p className="text-[12px] text-txt-muted">
              Read from <strong>{importing.file}</strong>. Nothing has been
              written yet. Machines are matched on the fleet code and people on
              the operator reference, never on the names — two people called
              Sahoo is not a hypothetical.
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip tone={importing.changes.length ? "emerald" : "slate"} dot={false}>
                {importing.changes.length} would change
              </Chip>
              <Chip tone={importing.problems.length ? "rose" : "slate"} dot={false}>
                {importing.problems.length} rejected
              </Chip>
              <Chip tone="slate" dot={false}>
                {importing.machines_in_file} machines in the file
              </Chip>
            </div>

            {importing.changes.length > 0 && (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100
                              max-h-56 overflow-auto">
                {importing.changes.map((c, i) => (
                  <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-[12px]">
                    {c.action === "add"
                      ? <Check className="w-3.5 h-3.5 text-emerald shrink-0" />
                      : <X className="w-3.5 h-3.5 text-rose shrink-0" />}
                    <span className="font-semibold text-navy">
                      {c.display_name || "somebody"}
                    </span>
                    <span className="text-txt-light">
                      {c.action === "add"
                        ? `onto ${c.fleet_code}${c.role ? ` as ${c.role.toLowerCase()}` : ""}`
                        : "taken off"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {importing.problems.length > 0 && (
              <div className="rounded-lg border border-rose/30 bg-rose-bg/40 divide-y
                              divide-rose/10 max-h-40 overflow-auto">
                {importing.problems.map((p2, i) => (
                  <div key={i} className="px-3 py-1.5 text-[12px] text-rose">
                    Row {p2.row} ({p2.ref}): {p2.why}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </Card>
  );
}
