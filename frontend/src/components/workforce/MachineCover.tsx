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
import DateField from "@/components/minehub/DateField";
import {
  Card, CardHeader, Chip, EmptyRow, Td, Th, inputClass, Button, type Tone,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import { isoDay } from "./state";

interface Person {
  operator_id: number; display_name: string; operator_ref: string | null;
  designation: string | null;
}

interface CrewMember {
  operator_id: number; person: string; operator_ref: string | null;
  role: string; shift: string | null; since: string;
  cleared: boolean; state: string | null;
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
  const [day, setDay] = useState(isoDay(new Date()));
  const [rows, setRows] = useState<Machine[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [gapsOnly, setGapsOnly] = useState(false);
  // Machines are narrowed the way a planner thinks about them: the part of the
  // mine, the kind of work, the hire. Three hundred rows is not a list anybody
  // reads, and a filter is what turns it into one.
  const [by, setBy] = useState({ category: "", department: "", type: "", ownership: "" });
  const [importing, setImporting] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [pick, setPick] = useState("");
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
    .filter((m) => !gapsOnly || m.crew_size === 0)
    .filter((m) => (!by.category || m.category === by.category)
                && (!by.department || (m.department ?? "") === by.department)
                && (!by.type || m.asset_type === by.type)
                && (!by.ownership || m.ownership === by.ownership))
    .filter((m) => matchesSearch(q, [
      m.fleet_code, m.registration_no, m.nickname, m.asset_type,
      ...m.crew.map((c) => c.person),
      ...m.candidates.map((c) => c.person),
    ])), [rows, q, gapsOnly, by]);

  const unplanned = rows.filter((m) => m.crew_size === 0).length;
  const planned = rows.reduce((n, m) => n + m.crew_size, 0);
  const notCleared = rows.reduce((n, m) => n + m.crew_not_cleared, 0);

  return (
    <Card>
      <CardHeader icon={Truck} title="Who runs what" tone="teal"
        subtitle="The standing plan: the crew named against each machine. Naming somebody here deploys nobody — that happens on the Shift Board, on the day."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-txt-muted">
              roster of
              <DateField className={`${inputClass} w-[140px]`} value={day} onChange={setDay} />
            </span>
            {/* One shape for all four, so the bar reads as a set rather than
                four controls that happen to sit together. */}
            {([
              ["department", "All departments", optionsOf((m) => m.department)],
              ["category", "All work", optionsOf((m) => m.category)],
              ["type", "All types", optionsOf((m) => m.asset_type)],
              ["ownership", "Own and hired", optionsOf((m) => m.ownership)],
            ] as const).map(([key, all, options]) => (
              <select key={key} value={by[key]}
                onChange={(e) => setBy({ ...by, [key]: e.target.value })}
                className={`${inputClass} w-auto py-1.5 text-[12px] ${
                  by[key] ? "border-gold text-txt-primary font-semibold" : ""}`}>
                <option value="">{all}</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}
            <button type="button" onClick={() => setGapsOnly((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg border text-[12px] transition-colors ${
                gapsOnly ? "border-rose bg-rose-bg text-rose font-semibold"
                         : "border-border text-txt-muted hover:bg-bg-hover"}`}>
              No crew
            </button>
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
            <span><strong className="text-txt-primary tabular-nums">{shown.length}</strong> machines</span>
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
                      : gapsOnly ? "Every machine has a crew."
                      : `Nothing matches “${q}”.`}
                  </EmptyRow>
                )}
                {!loading && shown.map((m) => {
                  const inCrew = new Set(m.crew.map((c) => c.operator_id));
                  // Assessed people first and labelled as such, so adding
                  // somebody who is not is a thing you can do and can see you
                  // are doing.
                  const offer = [
                    ...m.candidates.filter((c) => !inCrew.has(c.operator_id))
                      .map((c) => ({ id: c.operator_id, name: c.person,
                                     note: `assessed · ${doing(c.state)}`, cleared: true })),
                    ...people.filter((p) => !inCrew.has(p.operator_id)
                        && !m.candidates.some((c) => c.operator_id === p.operator_id))
                      .map((p) => ({ id: p.operator_id, name: p.display_name,
                                     note: p.designation ?? "not assessed on this",
                                     cleared: false })),
                  ].filter((o) => matchesSearch(pick, [o.name, o.note]));

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
                                     + (c.cleared ? " · assessed"
                                                  : " · NOT assessed on this machine")}
                              className={`inline-flex items-center gap-1 rounded-full pl-2 pr-1
                                          py-0.5 text-[11.5px] border ${
                                c.cleared ? "bg-emerald-bg border-emerald-ring text-emerald"
                                          : "bg-rose-bg border-rose-ring text-rose"}`}>
                              {c.cleared && <ShieldCheck className="w-3 h-3" />}
                              {c.person}
                              <Chip tone={ROLE_TONE[c.role] ?? "slate"} dot={false}>
                                {c.role.toLowerCase()}
                              </Chip>
                              <button type="button" disabled={busy}
                                title={`Take ${c.person} off ${m.fleet_code}`}
                                onClick={() => void saveCrew(m,
                                  m.crew.filter((x) => x.operator_id !== c.operator_id))}
                                className="rounded-full p-0.5 hover:bg-white/60">
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}

                          {editing === m.asset_id ? (
                            <div className="w-full mt-1 rounded-lg border border-gold/40
                                            bg-gold/[0.04] p-2 space-y-1.5">
                              <input autoFocus value={pick} placeholder="Type a name…"
                                onChange={(e) => setPick(e.target.value)}
                                className={`${inputClass} py-1`} />
                              <div className="max-h-44 overflow-auto divide-y divide-slate-100">
                                {offer.length === 0 && (
                                  <p className="px-1 py-2 text-[11.5px] text-txt-light">
                                    Nobody left to add.
                                  </p>
                                )}
                                {offer.slice(0, 40).map((o) => (
                                  <button key={o.id} type="button" disabled={busy}
                                    onClick={() => {
                                      void saveCrew(m, [...m.crew, {
                                        operator_id: o.id, person: o.name,
                                        operator_ref: null,
                                        // The first person on a machine drives
                                        // it; everybody after that covers.
                                        role: m.crew.length === 0 ? "PRIMARY" : "RELIEF",
                                        shift: null, since: day,
                                        cleared: o.cleared, state: null,
                                      }]);
                                      setPick("");
                                    }}
                                    className="w-full text-left px-1 py-1.5 flex items-center
                                               gap-2 hover:bg-white rounded">
                                    <span className="text-[12px] font-semibold text-navy">
                                      {o.name}
                                    </span>
                                    <span className={`text-[11px] ${
                                      o.cleared ? "text-emerald" : "text-txt-light"}`}>
                                      {o.note}
                                    </span>
                                  </button>
                                ))}
                              </div>
                              <Button size="sm" variant="ghost"
                                      onClick={() => { setEditing(null); setPick(""); }}>
                                Done
                              </Button>
                            </div>
                          ) : (
                            <button type="button" disabled={busy}
                              onClick={() => { setEditing(m.asset_id); setPick(""); }}
                              className="inline-flex items-center gap-1 rounded-full border
                                         border-dashed border-slate-300 px-2 py-0.5
                                         text-[11.5px] text-txt-light hover:border-gold
                                         hover:text-gold">
                              <Plus className="w-3 h-3" />
                              {m.crew.length === 0 ? "add a crew" : "add"}
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
