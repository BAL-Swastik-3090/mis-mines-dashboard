"use client";
/**
 * Raising attendance corrections — for one person or for a shift's worth.
 *
 * The first version asked for one attendance number typed into a box, one
 * time, one reason. That is the rare case. The case the data actually showed
 * is 17 and 18 September, when the gate failed and thirty-eight people had one
 * punch instead of two — and typing that out thirty-eight times is how three
 * of them come out wrong.
 *
 * So: find people by department, trade or name, tick the ones affected, pick
 * the shift rather than typing its times, say why once, and raise the lot.
 * Each is still a correction of its own with its own guards and its own
 * approval; this only saves the typing.
 *
 * WHAT IT WILL NOT LET YOU DO. Remarks are compulsory — a reason puts a
 * correction in one of eight boxes, and the remark is the only part anybody
 * reads when they ask about it later. And the list of people is scoped by the
 * department the raiser's access covers, at the server, so a supervisor is
 * never offered somebody they would then be refused.
 */
import { matchesSearch } from "@/lib/search";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, CheckSquare, Clock, Loader2, Plus, Search, Square,
  Users, X,
} from "lucide-react";
import api from "@/lib/api";
import ColumnFilter, { optionsFrom, matches } from "./ColumnFilter";
import DateField, { toDisplay } from "./DateField";
import { Alert, Button, Card, CardHeader, Chip, type Tone } from "./ui";

interface Worker {
  operator_id: number; operator_ref: string | null; name: string; emp_no: string;
  trade: string | null; trade_group: string | null; employer: string | null;
  department: string | null; org_unit_id: number | null;
}
interface Shift {
  shift_id: number; code: string; name: string;
  start_time: string; end_time: string; crosses_midnight: boolean;
}
interface Reason { code: string; label: string; help: string | null }
interface Who {
  may_raise: boolean; may_decide: boolean; may_edit_reasons: boolean;
  scope_org_unit_id: number | null; scope_department: string | null;
}

const KIND: Record<string, { label: string; tone: Tone; needsTime: boolean; why: string }> = {
  CLOCK_IN:     { label: "Missing punch in",  tone: "emerald", needsTime: true,
                  why: "They came in and the reader did not take it" },
  CLOCK_OUT:    { label: "Missing punch out", tone: "amber", needsTime: true,
                  why: "They left and the reader did not take it" },
  MARK_PRESENT: { label: "Present, time unknown", tone: "sky", needsTime: false,
                  why: "They were here; nobody can say exactly when" },
  MARK_ABSENT:  { label: "Confirmed absent", tone: "rose", needsTime: false,
                  why: "They did not attend. The only way absence is ever asserted" },
  NOTE:         { label: "Note only", tone: "slate", needsTime: false,
                  why: "An explanation, claiming nothing" },
};

const today = () => new Date().toISOString().slice(0, 10);

export default function RaiseCorrection({ who, prefill, onRaised, onCancel }: {
  who: Who;
  prefill?: { emp_no: string; name: string; on_date: string; kind?: string };
  onRaised: (summary: string,
             problems: { emp_no: string; kind: string; why: string }[]) => void;
  onCancel: () => void;
}) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [by, setBy] = useState({ department: "", trade: "", employer: "" });
  const set = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(prefill ? [prefill.emp_no] : []));

  const [mode, setMode] = useState<"shift" | "single">(prefill?.kind ? "single" : "shift");
  const [on, setOn] = useState(prefill?.on_date ?? today());
  const [shiftId, setShiftId] = useState<string>("");
  const [ends, setEnds] = useState({ in: true, out: true });
  const [kind, setKind] = useState(prefill?.kind ?? "CLOCK_OUT");
  const [at, setAt] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");

  const [newReason, setNewReason] = useState<{ label: string; help: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, s, r] = await Promise.all([
        api.get("/attendance/workers"),
        api.get("/attendance/shifts"),
        api.get("/checklists", { params: { kind: "ATTENDANCE_REASON" } }),
      ]);
      setWorkers(w.data ?? []);
      setShifts(s.data ?? []);
      setReasons(r.data ?? []);
      const a = (s.data ?? []).find((x: Shift) => x.code === "A");
      if (a) setShiftId(String(a.shift_id));
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load the worker list.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const menus = useMemo(() => ({
    department: optionsFrom(workers, (w) => w.department, (v) => v, "Not posted"),
    trade: optionsFrom(workers, (w) => w.trade, (v) => v, "No trade set"),
    employer: optionsFrom(workers, (w) => w.employer, (v) => v, null),
  }), [workers]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workers.filter((w) => {
      if (!matches(w.department, by.department)) return false;
      if (!matches(w.trade, by.trade)) return false;
      if (!matches(w.employer, by.employer)) return false;
      if (!q) return true;
      return matchesSearch(q, [w.name, w.emp_no, w.trade]);
    });
  }, [workers, by, query]);

  const allShown = shown.length > 0 && shown.every((w) => picked.has(w.emp_no));
  const toggle = (emp: string) => setPicked((s) => {
    const n = new Set(s); if (n.has(emp)) n.delete(emp); else n.add(emp); return n;
  });
  const pickAllShown = () => setPicked((s) => {
    const n = new Set(s);
    if (allShown) shown.forEach((w) => n.delete(w.emp_no));
    else shown.forEach((w) => n.add(w.emp_no));
    return n;
  });

  const shift = shifts.find((s) => String(s.shift_id) === shiftId);
  const kindInfo = KIND[kind];
  const needsTime = mode === "single" && kindInfo?.needsTime;

  const ready = picked.size > 0 && on && reason && remarks.trim()
    && (mode === "shift" ? Boolean(shiftId) && (ends.in || ends.out)
                         : Boolean(kind) && (!needsTime || at));

  const addReason = async () => {
    if (!newReason?.label.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post("/checklists", {
        kind: "ATTENDANCE_REASON", label: newReason.label.trim(),
        help: newReason.help.trim() || undefined,
      });
      const list = await api.get("/checklists", { params: { kind: "ATTENDANCE_REASON" } });
      setReasons(list.data ?? []);
      setReason(r.data?.code ?? "");
      setNewReason(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not add that reason.");
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        emp_nos: [...picked], on_date: on,
        reason_code: reason, remarks: remarks.trim(),
      };
      if (mode === "shift") {
        body.shift_id = Number(shiftId);
        body.punch_in = ends.in; body.punch_out = ends.out;
      } else {
        body.kind = kind;
        if (needsTime) body.at_time = at;
      }
      const r = await api.post("/attendance/corrections/batch", body);
      onRaised(
        `${r.data.raised} correction${r.data.raised === 1 ? "" : "s"} raised for `
        + `${toDisplay(on)}, waiting on somebody who did not raise them.`,
        r.data.problems ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not raise those.");
    } finally { setBusy(false); }
  };

  if (loading) {
    return <Card><div className="flex justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-gold" /></div></Card>;
  }

  const input = "w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px] "
    + "text-txt-primary focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15";
  const lbl = "block text-[11px] font-semibold text-txt-secondary mb-1";

  return (
    <Card tone="gold">
      <CardHeader title="Raise a correction" icon={Plus} tone="gold"
        subtitle="What happened, where the readers are silent. Choose everybody affected, say why once, and raise them together — each still needs somebody else to approve it."
        actions={
          <Button size="sm" variant="secondary" onClick={onCancel}>
            <X className="w-3.5 h-3.5" /> Cancel
          </Button>
        } />

      {error && <div className="px-4 pt-3"><Alert tone="error">{error}</Alert></div>}

      {who.scope_department && (
        <div className="px-4 py-2 border-b border-border-light bg-sky-bg/40
                        flex items-center gap-2 text-[12px] text-txt-secondary">
          <AlertTriangle className="w-3.5 h-3.5 text-sky shrink-0" />
          Your access covers <strong>{who.scope_department}</strong>, so only its
          people are listed. Attendance is corrected by the department that
          supervises the person.
        </div>
      )}

      {/* ── 1. who ──────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-border-light">
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-navy">
            <Users className="w-4 h-4 text-gold-dark" /> 1. Who was affected
          </span>
          {picked.size > 0 && (
            <Chip tone="gold" dot={false}>{picked.size} selected</Chip>
          )}
          <span className="flex-1" />
          {menus.department.length > 1 && (
            <ColumnFilter variant="control" label="Department" allLabel="All departments"
              value={by.department} options={menus.department} onChange={set("department")} />
          )}
          <ColumnFilter variant="control" label="Trade" allLabel="All trades"
            value={by.trade} options={menus.trade} onChange={set("trade")} />
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
            <input id="rc-search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, ID or trade…"
              className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5
                         text-[12px] focus:outline-none focus:border-gold w-[190px]" />
          </div>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={pickAllShown}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold
                       text-gold-dark hover:underline underline-offset-2">
            {allShown ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            {allShown ? "Clear these" : `Select all ${shown.length}`}
          </button>
          {picked.size > 0 && (
            <button type="button" onClick={() => setPicked(new Set())}
              className="text-[11.5px] font-semibold text-txt-muted hover:text-navy">
              Clear the selection
            </button>
          )}
          <span className="text-[11px] text-txt-light">
            {shown.length} of {workers.length} shown
          </span>
        </div>

        <div className="max-h-[220px] overflow-y-auto rounded-lg border border-border-light">
          {shown.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-txt-light">
              Nobody matches that.
            </p>
          ) : shown.map((w) => {
            const on_ = picked.has(w.emp_no);
            return (
              <button key={w.emp_no} type="button" onClick={() => toggle(w.emp_no)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-3
                            border-b border-border-light last:border-0 transition-colors
                            ${on_ ? "bg-gold/[0.08]" : "hover:bg-bg-light"}`}>
                {on_ ? <CheckSquare className="w-4 h-4 text-gold-dark shrink-0" />
                     : <Square className="w-4 h-4 text-txt-light shrink-0" />}
                <span className="font-mono text-[11.5px] font-bold text-violet w-[52px] shrink-0">
                  {w.emp_no}
                </span>
                <span className="text-[12.5px] font-semibold text-navy flex-1 truncate">
                  {w.name}
                </span>
                <span className="text-[11.5px] text-txt-muted truncate max-w-[16ch]">
                  {w.trade ?? "—"}
                </span>
                <span className="text-[11px] text-txt-light truncate max-w-[16ch] hidden md:block">
                  {w.department ?? "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 2. what ─────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-border-light">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-navy mb-2.5">
          <Clock className="w-4 h-4 text-gold-dark" /> 2. What happened
        </span>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {([["shift", "A whole shift", "Times come from the shift, not from typing"],
             ["single", "One correction", "A single punch, an absence, or a note"]] as const)
            .map(([id, label, why]) => (
            <button key={id} type="button" onClick={() => setMode(id)} title={why}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition
                          ${mode === id ? "border-gold bg-gold/[0.08] text-gold-dark"
                                        : "border-border bg-bg-base text-txt-secondary hover:border-gold/50"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <label className="block">
            <span className={lbl}>The day <span className="text-rose">*</span></span>
            <DateField id="rc-date" value={on} max={today()} onChange={setOn}
              className="w-full bg-bg-base border border-border rounded-lg" />
          </label>

          {mode === "shift" ? (
            <>
              <label className="block">
                <span className={lbl}>Shift <span className="text-rose">*</span></span>
                <select id="rc-shift" value={shiftId}
                  onChange={(e) => setShiftId(e.target.value)} className={input}>
                  {shifts.map((s) => (
                    <option key={s.shift_id} value={s.shift_id}>
                      {s.name} · {s.start_time}–{s.end_time}
                    </option>
                  ))}
                </select>
                {shift?.crosses_midnight && (
                  <span className="block text-[11px] text-amber mt-1">
                    This shift ends the next morning — the out punch belongs to
                    the following day.
                  </span>
                )}
              </label>
              <div className="block">
                <span className={lbl}>Which end failed</span>
                <div className="flex flex-wrap gap-2">
                  {([["in", `In at ${shift?.start_time ?? "—"}`],
                     ["out", `Out at ${shift?.end_time ?? "—"}`]] as const).map(([k, label]) => (
                    <label key={k}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2
                                  text-[12.5px] cursor-pointer transition
                                  ${ends[k] ? "border-gold bg-gold/[0.06] text-navy font-semibold"
                                            : "border-border text-txt-muted"}`}>
                      <input type="checkbox" checked={ends[k]} className="accent-gold w-3.5 h-3.5"
                        onChange={(e) => setEnds({ ...ends, [k]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                </div>
                <span className="block text-[11px] text-txt-light mt-1">
                  A punch the reader already took is refused, so leaving both on
                  is safe.
                </span>
              </div>
            </>
          ) : (
            <>
              <label className="block">
                <span className={lbl}>What is being corrected <span className="text-rose">*</span></span>
                <select id="rc-kind" value={kind} onChange={(e) => setKind(e.target.value)}
                  className={input}>
                  {Object.keys(KIND).map((k) => (
                    <option key={k} value={k}>{KIND[k].label}</option>
                  ))}
                </select>
                <span className="block text-[11px] text-txt-light mt-1">{kindInfo?.why}</span>
              </label>
              {needsTime && (
                <label className="block">
                  <span className={lbl}>Time it happened <span className="text-rose">*</span></span>
                  <input id="rc-time" type="time" value={at}
                    onChange={(e) => setAt(e.target.value)} className={input} />
                  <span className="block text-[11px] text-txt-light mt-1">
                    It cannot contradict a punch the reader did take.
                  </span>
                </label>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── 3. why ──────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-navy mb-2.5">
          <AlertTriangle className="w-4 h-4 text-gold-dark" /> 3. Why
        </span>

        {newReason ? (
          <div className="rounded-lg border border-gold/40 bg-gold/[0.04] p-3 mb-3 space-y-2">
            <span className="block text-[12px] font-semibold text-navy">
              A reason that is not on the list yet
            </span>
            <input id="rc-nr-label" autoFocus value={newReason.label}
              onChange={(e) => setNewReason({ ...newReason, label: e.target.value })}
              placeholder="Power cut at the gate" className={input} />
            <input id="rc-nr-help" value={newReason.help}
              onChange={(e) => setNewReason({ ...newReason, help: e.target.value })}
              placeholder="What it covers, for whoever picks it next" className={input} />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={addReason}
                disabled={busy || !newReason.label.trim()}>
                <Check className="w-3.5 h-3.5" /> Add it to the list
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setNewReason(null)}>
                Cancel
              </Button>
              <span className="text-[11px] text-txt-light">
                It stays on the list for everybody from now on.
              </span>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className={lbl}>Reason <span className="text-rose">*</span></span>
            <span className="flex items-center gap-2">
              <select id="rc-reason" value={reason}
                onChange={(e) => setReason(e.target.value)} className={input}>
                <option value="">Choose a reason…</option>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
              {who.may_edit_reasons && !newReason && (
                <Button size="sm" variant="secondary"
                  onClick={() => setNewReason({ label: "", help: "" })}
                  title="Add a reason that is not on the list">
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              )}
            </span>
            <span className="block text-[11px] text-txt-light mt-1">
              {reasons.find((r) => r.code === reason)?.help
                ?? (who.may_edit_reasons
                    ? "Not on the list? Add it with the button beside."
                    : "If none of these fit, use “Something else” and say what happened below.")}
            </span>
          </label>

          <label className="block">
            <span className={lbl}>
              What happened <span className="text-rose">*</span>
            </span>
            <textarea id="rc-remarks" rows={3} value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="OUT reader at the CLL gate was showing an error from about 17:00; the whole B shift is affected"
              className={input} />
            <span className="block text-[11px] text-txt-light mt-1">
              Compulsory. The reason puts this in one of eight boxes; this is the
              part somebody reads when they ask about it later.
            </span>
          </label>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border-light bg-bg-light/60
                      flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={submit} disabled={!ready || busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Raise {picked.size > 0 ? `${picked.size} ` : ""}for approval
        </Button>
        <span className="text-[12px] text-txt-muted">
          {mode === "shift" && (ends.in && ends.out)
            ? `Two corrections each — an in and an out — so ${picked.size * 2} in total. `
            : ""}
          The gate record is not changed; these sit beside it.
        </span>
      </div>
    </Card>
  );
}
