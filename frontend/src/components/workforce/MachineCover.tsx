"use client";
/**
 * Who can run this machine, and who is free today.
 *
 * The question gets asked at six in the morning when somebody has not turned
 * up, and it is asked about a particular machine: the tipper is in the yard,
 * its driver is on leave, who else is cleared to take it out. Answering it
 * meant opening operators one at a time and reading their assessments, which is
 * why it was answered from memory instead.
 *
 * Able and free are two different questions and both are shown. The man who is
 * able but resting is a phone call; the man who is not able is not, whatever
 * the shift is short.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Truck, Loader2, Search, AlertTriangle, CheckCircle2, UserX,
} from "lucide-react";
import api from "@/lib/api";
import { matchesSearch } from "@/lib/search";
import DateField from "@/components/minehub/DateField";
import {
  Card, CardHeader, Chip, EmptyRow, Td, Th, inputClass, type Tone,
} from "@/components/minehub/ui";
import { isoDay } from "./state";

interface Person {
  operator_id: number; display_name: string; operator_ref: string | null;
  designation: string | null;
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
  nickname: string | null; asset_type: string | null; category: string | null;
  status: string;
  assigned_operator: string | null; assigned_state: string | null;
  assigned_shift: string | null;
  can_run: number; free_now: number; candidates: Candidate[];
}

/** How a candidate reads at a glance: can they take it out right now. */
function standing(c: Candidate): { label: string; tone: Tone } {
  if (c.why_not === "on leave") return { label: "on leave", tone: "amber" };
  if (c.why_not?.startsWith("already on")) return { label: c.why_not, tone: "violet" };
  if (c.why_not === "resting") return { label: "resting — could be called", tone: "slate" };
  if (c.why_not === "not on a roster") return { label: "not rostered", tone: "slate" };
  return { label: c.shift ? `on ${c.shift}` : "available", tone: "emerald" };
}

export default function MachineCover() {
  const [day, setDay] = useState(isoDay(new Date()));
  const [rows, setRows] = useState<Machine[]>([]);
  const [q, setQ] = useState("");
  const [gapsOnly, setGapsOnly] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/workforce/cover", { params: { day } });
      setRows(r.data?.machines ?? []);
      setError(null);
    } catch {
      setError("Who can run what could not be read.");
    } finally { setLoading(false); }
  }, [day]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      try { setPeople((await api.get("/workforce/people")).data ?? []); }
      catch { /* the picker says so itself when it is empty */ }
    })();
  }, []);

  /** Put somebody on a machine, through the register's own endpoint.
   *
   *  Not a second way of writing operator_assignment. That endpoint ends the
   *  previous assignment, runs the eligibility check and records what was
   *  overridden — a machine-first shortcut that skipped all three would be a
   *  second answer to "who is on this machine" that disagreed with the first. */
  const assign = useCallback(async (assetId: number, operatorId: number) => {
    setBusy(true);
    try {
      await api.post(`/operators/${operatorId}/assignments`, {
        asset_id: assetId,
        valid_from: day,
      });
      setAssigning(null);
      setNotice("Assigned. Eligibility was checked and recorded, not enforced.");
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That operator could not be assigned.");
    } finally { setBusy(false); }
  }, [day, load]);

  const shown = useMemo(() => rows
    .filter((m) => !gapsOnly || m.free_now === 0)
    .filter((m) => matchesSearch(q, [
      m.fleet_code, m.registration_no, m.nickname, m.asset_type,
      m.assigned_operator,
      ...m.candidates.map((c) => c.person),
    ])), [rows, q, gapsOnly]);

  const nobodyAtAll = rows.filter((m) => m.can_run === 0).length;
  const nobodyFree = rows.filter((m) => m.free_now === 0).length;

  return (
    <Card>
      <CardHeader icon={Truck} title="Who can run what" tone="teal"
        subtitle="The competency register, read by machine: who may run each one, and which of them can take it out on the day."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Labelled, because an unlabelled date at the top of a list
                reads as "this list is about that day" — and the list is not.
                Who is cleared to run a machine is a standing fact; only the
                free-today column moves when this changes. */}
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-txt-muted">
              free on
              <DateField className={`${inputClass} w-[140px]`} value={day} onChange={setDay} />
            </span>
            <button type="button" onClick={() => setGapsOnly((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg border text-[12px] transition-colors ${
                gapsOnly ? "border-rose bg-rose-bg text-rose font-semibold"
                         : "border-border text-txt-muted hover:bg-bg-hover"}`}>
              Only machines with nobody free
            </button>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Machine, type or person"
                className={`${inputClass} pl-8 w-full sm:w-[260px] lg:w-[340px]`} />
            </div>
          </div>
        } />

      {error && <p className="px-4 py-3 text-[12.5px] text-rose">{error}</p>}
      {notice && <p className="px-4 py-3 text-[12.5px] text-emerald">{notice}</p>}

      {!error && (
        <>
          <p className="px-4 pt-3 text-[12px] text-txt-muted">
            <strong className="text-txt-primary">Normally run by</strong> is
            yours to set — click it and choose.{" "}
            <strong className="text-txt-primary">Cleared to run it</strong> is
            not: it comes from the competency register, and somebody appears
            there once they have been assessed on the machine or its class. The
            date changes only who is free.
          </p>
          <div className="px-4 py-2 border-b border-border-light flex flex-wrap items-center
                          gap-3 text-[12px] text-txt-muted">
            <span><strong className="text-txt-primary tabular-nums">{shown.length}</strong> machines</span>
            {nobodyFree > 0 && (
              <span className="inline-flex items-center gap-1 text-amber">
                <AlertTriangle className="w-3.5 h-3.5" />
                {nobodyFree} with nobody free on this day
              </span>
            )}
            {nobodyAtAll > 0 && (
              <span className="inline-flex items-center gap-1 text-rose">
                <UserX className="w-3.5 h-3.5" />
                {nobodyAtAll} nobody is cleared to run at all
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr>
                  <Th>Machine</Th>
                  <Th>Type</Th>
                  <Th>Normally run by</Th>
                  <Th>Cleared to run it</Th>
                  <Th>Free that day</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center">
                    <Loader2 className="w-4 h-4 animate-spin inline text-txt-light" />
                  </td></tr>
                )}
                {!loading && shown.length === 0 && (
                  <EmptyRow colSpan={6}>
                    {rows.length === 0 ? "No machines to show."
                      : gapsOnly ? "Every machine has somebody free."
                      : `Nothing matches “${q}”.`}
                  </EmptyRow>
                )}
                {!loading && shown.map((m) => (
                  <React.Fragment key={m.asset_id}>
                    <tr className="border-t border-border-light hover:bg-bg-hover cursor-pointer"
                        onClick={() => setOpen(open === m.asset_id ? null : m.asset_id)}>
                      <Td>
                        <span className="font-semibold text-navy">{m.fleet_code || "—"}</span>
                        {m.registration_no && (
                          <span className="block text-[11px] text-txt-light">{m.registration_no}</span>
                        )}
                      </Td>
                      <Td className="text-[12px]">{m.asset_type || "—"}</Td>
                      <Td className="text-[12px]">
                        {/* The row toggles the candidate list; this cell is a
                            control of its own, so its clicks stop here rather
                            than also opening the panel underneath. */}
                        <span onClick={(e) => e.stopPropagation()}>
                        {/* Chosen here, because this is the screen somebody is
                            on when they decide it. The register could only be
                            written the other way round — open a person, give
                            them a machine — which is the wrong direction when
                            the machine is the thing in front of you. */}
                        {assigning === m.asset_id ? (
                          <select autoFocus disabled={busy} className={`${inputClass} w-[200px]`}
                            defaultValue=""
                            onChange={(e) => {
                              const id = Number(e.target.value);
                              if (id) void assign(m.asset_id, id);
                            }}
                            onBlur={() => setAssigning(null)}>
                            <option value="">Choose somebody…</option>
                            {/* Cleared first, and said so, because a supervisor
                                assigning somebody not cleared should know that
                                is what they are doing. */}
                            {m.candidates.length > 0 && (
                              <optgroup label="Cleared to run it">
                                {m.candidates.map((c) => (
                                  <option key={c.operator_id} value={c.operator_id}>
                                    {c.person}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="Everybody else — not assessed on this">
                              {people
                                .filter((pp) => !m.candidates.some(
                                  (c) => c.operator_id === pp.operator_id))
                                .map((pp) => (
                                  <option key={pp.operator_id} value={pp.operator_id}>
                                    {pp.display_name}
                                    {pp.designation ? ` · ${pp.designation}` : ""}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        ) : m.assigned_operator ? (
                          <button type="button" onClick={() => setAssigning(m.asset_id)}
                                  className="text-left hover:text-gold hover:underline">
                            {m.assigned_operator}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setAssigning(m.asset_id)}
                                  className="text-txt-light hover:text-gold hover:underline">
                            nobody assigned — choose
                          </button>
                        )}
                        </span>
                      </Td>
                      <Td>
                        {/* The names, not just a count.
                            This is the mapping somebody came to read — which
                            machine can be run by whom — and hiding it behind a
                            click made the screen look like it was about the
                            date at the top. The count alone answers nothing:
                            "3" is not a name you can ring. */}
                        {m.can_run === 0
                          ? <Chip tone="rose" dot={false}>nobody cleared</Chip>
                          : (
                            <span className="text-[12px]">
                              {m.candidates.slice(0, 3).map((c) => c.person).join(", ")}
                              {m.can_run > 3 && (
                                <span className="text-txt-light">
                                  {" "}and {m.can_run - 3} more
                                </span>
                              )}
                            </span>
                          )}
                      </Td>
                      <Td>
                        {m.free_now === 0
                          ? <Chip tone="amber" dot={false}>none free</Chip>
                          : <Chip tone="emerald" dot={false}>{m.free_now}</Chip>}
                      </Td>
                      <Td className="text-right text-[11px] text-txt-light">
                        {open === m.asset_id ? "hide" : "who"}
                      </Td>
                    </tr>

                    {open === m.asset_id && (
                      <tr className="bg-bg-section/60">
                        <td colSpan={6} className="px-4 py-3">
                          {m.candidates.length === 0 ? (
                            <p className="text-[12.5px] text-rose">
                              Nobody is assessed on {m.asset_type || "this machine"}. Until
                              somebody is signed off, this machine cannot be deployed at all.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {m.candidates.map((c) => {
                                const s = standing(c);
                                return (
                                  <div key={c.operator_id}
                                       className="flex flex-wrap items-center gap-2 text-[12px]">
                                    {c.why_not
                                      ? <span className="w-3.5" />
                                      : <CheckCircle2 className="w-3.5 h-3.5 text-emerald shrink-0" />}
                                    <span className="font-semibold text-navy min-w-[10rem]">
                                      {c.person}
                                    </span>
                                    <span className="text-txt-light">{c.trade ?? "—"}</span>
                                    <Chip tone={s.tone} dot={false}>{s.label}</Chip>
                                    <Chip tone="slate" dot={false}>level {c.level}</Chip>
                                    {/* A clearance on the machine itself is a
                                        stronger statement than one on its class,
                                        and the supervisor choosing between two
                                        people should see which they have. */}
                                    {c.matched === "this machine" && (
                                      <Chip tone="teal" dot={false}>on this machine</Chip>
                                    )}
                                    {c.lapsed && <Chip tone="rose" dot={false}>lapsed</Chip>}
                                    {c.reassessment_overdue && (
                                      <Chip tone="amber" dot={false}>reassessment overdue</Chip>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
