"use client";
/**
 * Attendance corrections — raising them, and deciding them.
 *
 * Two jobs on one screen because they are two halves of one thing, and which
 * half you see depends on what you hold: a supervisor sees what they raised, an
 * approver sees the queue, somebody with both sees both and still cannot
 * approve their own.
 *
 * NOTHING HERE CHANGES THE GATE RECORD. A correction sits beside the punch
 * data and explains a gap in it. The screen says so rather than letting anyone
 * believe they are editing attendance, because the difference is the whole
 * reason this needs two people.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, Clock, Loader2, Plus, Search,
  ShieldCheck, Undo2, X, XCircle,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import ColumnFilter, { optionsFrom, matches } from "./ColumnFilter";
import DateField, { toDisplay } from "./DateField";
import Dialog from "./Dialog";
import Toast from "./Toast";
import HoverCard, { CardBody, CardHead, CardNote, Fact } from "./HoverCard";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, StatBar, Td, Th, type Tone,
} from "./ui";
import { ago, exactly } from "./when";

interface Correction {
  correction_id: number; emp_no: string; name: string; operator_ref: string | null;
  trade: string | null; employer: string | null; department: string | null;
  on_date: string; kind: string; at_time: string | null;
  reason_code: string; reason: string | null; remarks: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  requested_by: string; requested_by_name: string | null; requested_at: string | null;
  decided_by: string | null; decided_by_name: string | null;
  decided_at: string | null; decision_note: string | null;
}
interface Reason { code: string; label: string; help: string | null }

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

const STATUS: Record<Correction["status"], { label: string; tone: Tone }> = {
  PENDING:   { label: "waiting", tone: "amber" },
  APPROVED:  { label: "approved", tone: "emerald" },
  REJECTED:  { label: "refused", tone: "rose" },
  WITHDRAWN: { label: "withdrawn", tone: "slate" },
};

const today = () => new Date().toISOString().slice(0, 10);

export default function CorrectionsPanel({ prefill, onDone }: {
  /** Opened from a day row: the worker and date are already known. */
  prefill?: { emp_no: string; name: string; on_date: string; kind?: string };
  onDone?: () => void;
}) {
  const can = useAuth((s) => s.can);
  const me = useAuth((s) => s.user?.emp_id);
  const mayRaise = can("ops.attendance.correct");
  const mayDecide = can("ops.attendance.approve");

  const [rows, setRows] = useState<Correction[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "new" | null>(null);

  const [tab, setTab] = useState<"PENDING" | "ALL">("PENDING");
  const [query, setQuery] = useState("");
  const [by, setBy] = useState({ kind: "", reason: "", employer: "" });
  const set = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));

  const [adding, setAdding] = useState(Boolean(prefill));
  const [form, setForm] = useState({
    emp_no: prefill?.emp_no ?? "", on_date: prefill?.on_date ?? today(),
    kind: prefill?.kind ?? "CLOCK_OUT", at_time: "", reason_code: "", remarks: "",
  });
  const [decide, setDecide] = useState<{ row: Correction; to: "APPROVED" | "REJECTED" } | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, r] = await Promise.all([
        api.get("/attendance/corrections"),
        api.get("/checklists", { params: { kind: "ATTENDANCE_REASON" } }),
      ]);
      setRows(c.data ?? []);
      setReasons(r.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not read the corrections.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const say = (e: unknown, fallback: string) => {
    const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    setError(d ?? fallback);
  };

  const submit = async () => {
    setBusy("new"); setError(null);
    try {
      await api.post("/attendance/corrections", form);
      setAdding(false);
      setForm({ emp_no: "", on_date: today(), kind: "CLOCK_OUT",
                at_time: "", reason_code: "", remarks: "" });
      await load(); onDone?.();
      setNotice("Raised. It waits for somebody else to decide — you cannot approve your own.");
    } catch (e) { say(e, "Could not raise that."); } finally { setBusy(null); }
  };

  const act = async () => {
    if (!decide) return;
    const { row, to } = decide;
    setBusy(row.correction_id); setError(null); setDecide(null);
    try {
      await api.post(
        `/attendance/corrections/${row.correction_id}/${to === "APPROVED" ? "approve" : "reject"}`,
        { note });
      setNote("");
      await load(); onDone?.();
      setNotice(to === "APPROVED"
        ? `Approved. ${row.name}'s day on ${toDisplay(row.on_date)} now reads with the correction.`
        : "Refused, with the reason attached.");
    } catch (e) { say(e, "Could not record that decision."); } finally { setBusy(null); }
  };

  const withdraw = async (row: Correction) => {
    setBusy(row.correction_id); setError(null);
    try {
      await api.post(`/attendance/corrections/${row.correction_id}/withdraw`, {});
      await load(); setNotice("Withdrawn.");
    } catch (e) { say(e, "Could not withdraw that."); } finally { setBusy(null); }
  };

  const menus = useMemo(() => ({
    kind: Object.keys(KIND).map((k) => ({
      value: k, label: KIND[k].label, count: rows.filter((r) => r.kind === k).length,
    })).filter((o) => o.count > 0),
    reason: optionsFrom(rows, (r) => r.reason, (v) => v, null),
    employer: optionsFrom(rows, (r) => r.employer, (v) => v, null),
  }), [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "PENDING" && r.status !== "PENDING") return false;
      if (by.kind && r.kind !== by.kind) return false;
      if (!matches(r.reason, by.reason)) return false;
      if (!matches(r.employer, by.employer)) return false;
      if (!q) return true;
      return [r.name, r.emp_no, r.reason, r.remarks, r.requested_by_name]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, tab, by, query]);

  const n = (s: Correction["status"]) => rows.filter((r) => r.status === s).length;
  const mine = rows.filter((r) => r.requested_by === me && r.status === "PENDING").length;
  const kindInfo = KIND[form.kind];
  const canSubmit = form.emp_no.trim() && form.on_date && form.reason_code
    && (!kindInfo?.needsTime || form.at_time);

  if (loading) {
    return <div className="flex justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  return (
    <div className="space-y-4">
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />

      <Dialog open={Boolean(decide)}
        tone={decide?.to === "APPROVED" ? "info" : "warning"}
        title={decide?.to === "APPROVED" ? "Approve this correction" : "Refuse this correction"}
        confirmLabel={decide?.to === "APPROVED" ? "Approve it" : "Refuse it"}
        cancelLabel="Not yet"
        busy={busy !== null || (decide?.to === "REJECTED" && !note.trim())}
        onConfirm={act} onCancel={() => { setDecide(null); setNote(""); }}>
        {decide && (
          <>
            <p className="mb-2.5">
              <strong>{decide.row.name}</strong> ({decide.row.emp_no}) on{" "}
              {toDisplay(decide.row.on_date)} —{" "}
              <strong>{KIND[decide.row.kind]?.label ?? decide.row.kind}</strong>
              {decide.row.at_time ? ` at ${decide.row.at_time}` : ""}.
              {decide.to === "APPROVED" && (
                <span className="block text-txt-muted mt-1.5">
                  The gate record is not changed. The day will read with this
                  beside it, showing which part came from a person.
                </span>
              )}
            </p>
            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1.5">
                {decide.to === "APPROVED"
                  ? "Note (optional)"
                  : "Why it is refused — the person who raised it sees this"}
              </span>
              <textarea id="cor-note" rows={3} value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={decide.to === "APPROVED"
                  ? "Reader log confirms the gate was down"
                  : "The reader was working that day; check with the gate first"}
                className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                           text-[13px] focus:outline-none focus:border-gold
                           focus:ring-2 focus:ring-gold/15" />
            </label>
          </>
        )}
      </Dialog>

      <StatBar items={[
        { label: "Waiting", value: n("PENDING"),
          tone: n("PENDING") ? "amber" : "emerald", icon: Clock,
          hint: mayDecide ? "for you to decide" : "with an approver",
          title: "Show the queue", onClick: () => setTab("PENDING"), active: tab === "PENDING" },
        { label: "Approved", value: n("APPROVED"), tone: "emerald", icon: CheckCircle2,
          hint: "now showing on the day" },
        { label: "Refused", value: n("REJECTED"), tone: n("REJECTED") ? "rose" : "slate",
          icon: XCircle, hint: "with a reason attached" },
        { label: "Raised by you", value: mine, tone: mine ? "sky" : "slate", icon: ShieldCheck,
          hint: "still waiting on somebody else" },
        { label: "All", value: rows.length, tone: "slate", icon: Search,
          hint: "everything ever raised",
          title: "Show everything", onClick: () => setTab("ALL"), active: tab === "ALL" },
      ]} />

      {/* ── raising one ─────────────────────────────────────────── */}
      {mayRaise && (adding ? (
        <Card tone="gold">
          <CardHeader title="Raise a correction" icon={Plus} tone="gold"
            subtitle="What happened, where the readers are silent. It goes to somebody else to decide — raising one asserts nothing on its own."
            actions={
              <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            } />
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                Attendance ID <span className="text-rose">*</span>
              </span>
              <input id="cor-emp" value={form.emp_no}
                onChange={(e) => setForm({ ...form, emp_no: e.target.value })}
                placeholder="17001" disabled={Boolean(prefill)}
                className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                           text-[13px] font-mono focus:outline-none focus:border-gold
                           disabled:opacity-60" />
              {prefill && (
                <span className="block text-[11px] text-txt-light mt-1">{prefill.name}</span>
              )}
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                The day <span className="text-rose">*</span>
              </span>
              <DateField id="cor-date" value={form.on_date} max={today()}
                onChange={(v) => setForm({ ...form, on_date: v })}
                className="w-full bg-bg-base border border-border rounded-lg" />
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                What is being corrected <span className="text-rose">*</span>
              </span>
              <select id="cor-kind" value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
                className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                           text-[13px] focus:outline-none focus:border-gold">
                {Object.keys(KIND).map((k) => (
                  <option key={k} value={k}>{KIND[k].label}</option>
                ))}
              </select>
              <span className="block text-[11px] text-txt-light mt-1">{kindInfo?.why}</span>
            </label>

            {kindInfo?.needsTime && (
              <label className="block">
                <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                  Time it happened <span className="text-rose">*</span>
                </span>
                <input id="cor-time" type="time" value={form.at_time}
                  onChange={(e) => setForm({ ...form, at_time: e.target.value })}
                  className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                             text-[13px] focus:outline-none focus:border-gold" />
                <span className="block text-[11px] text-txt-light mt-1">
                  It cannot contradict a punch the reader did take.
                </span>
              </label>
            )}

            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                Reason <span className="text-rose">*</span>
              </span>
              <select id="cor-reason" value={form.reason_code}
                onChange={(e) => setForm({ ...form, reason_code: e.target.value })}
                className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                           text-[13px] focus:outline-none focus:border-gold">
                <option value="">Choose a reason…</option>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
              <span className="block text-[11px] text-txt-light mt-1">
                {reasons.find((r) => r.code === form.reason_code)?.help
                  ?? "Compulsory — it is what explains this six months from now."}
              </span>
            </label>

            <label className="block xl:col-span-3">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                Remarks
              </span>
              <input id="cor-remarks" value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                placeholder="Gate reader was showing an error at shift end; three others affected"
                className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                           text-[13px] focus:outline-none focus:border-gold" />
            </label>
          </div>
          <div className="px-4 py-3 border-t border-border-light bg-bg-light/60
                          flex items-center gap-3">
            <Button variant="primary" onClick={submit} disabled={!canSubmit || busy === "new"}>
              {busy === "new" ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Check className="w-4 h-4" />}
              Raise it for approval
            </Button>
            <span className="text-[12px] text-txt-muted">
              The gate record is not changed. This sits beside it.
            </span>
          </div>
        </Card>
      ) : (
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> Raise a correction
        </Button>
      ))}

      {!mayRaise && !mayDecide && (
        <Alert tone="warning">
          You can see corrections but not raise or decide them. An Access Manager
          grants <code>ops.attendance.correct</code> to raise one and{" "}
          <code>ops.attendance.approve</code> to decide one — deliberately not
          the same person.
        </Alert>
      )}

      {/* ── the queue ───────────────────────────────────────────── */}
      <Card tone={tab === "PENDING" ? "amber" : "slate"}>
        <CardHeader
          title={`${tab === "PENDING" ? "Waiting" : "Every correction"} · ${shown.length}`}
          icon={tab === "PENDING" ? Clock : Search}
          tone={tab === "PENDING" ? "amber" : "slate"}
          subtitle={tab === "PENDING"
            ? "Raised by a supervisor, waiting on somebody who did not raise it."
            : "Everything raised, decided and withdrawn, with who did what and when."}
          actions={
            <>
              {menus.kind.length > 1 && (
                <ColumnFilter variant="control" label="Kind" allLabel="Any kind"
                  value={by.kind} options={menus.kind} onChange={set("kind")} />
              )}
              {menus.reason.length > 1 && (
                <ColumnFilter variant="control" label="Reason" allLabel="Any reason"
                  value={by.reason} options={menus.reason} onChange={set("reason")} />
              )}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
                <input id="cor-search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, ID, reason…"
                  className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5
                             text-[12px] focus:outline-none focus:border-gold w-[180px]" />
              </div>
            </>
          } />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                <Th className="w-[92px]">Day</Th>
                <Th>Worker</Th>
                <Th>What</Th>
                <Th>Reason</Th>
                <Th className="hidden lg:table-cell">Raised by</Th>
                <Th className="text-right w-[110px]">Status</Th>
                <Th className="text-right w-[168px]">Decision</Th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <EmptyRow colSpan={7}>
                  {tab === "PENDING"
                    ? "Nothing waiting. Every correction raised has been decided."
                    : "No correction has been raised yet."}
                </EmptyRow>
              )}
              {shown.map((r) => {
                const k = KIND[r.kind] ?? { label: r.kind, tone: "slate" as Tone };
                const isMine = r.requested_by === me;
                return (
                  <tr key={r.correction_id} className="hover:bg-bg-light transition-colors">
                    <Td className="tabular-nums whitespace-nowrap">{toDisplay(r.on_date)}</Td>
                    <Td>
                      <HoverCard width={290} card={
                        <>
                          <CardHead title={r.name}
                            sub={`${r.emp_no}${r.trade ? ` · ${r.trade}` : ""}`} />
                          <CardBody>
                            <Fact label="Day" value={toDisplay(r.on_date)} />
                            <Fact label="Claim" value={k.label}
                              sub={r.at_time ? `at ${r.at_time}` : "no time claimed"} />
                            <Fact label="Reason" value={r.reason ?? r.reason_code}
                              sub={r.remarks ?? undefined} />
                            <Fact label="Raised" value={r.requested_by_name ?? r.requested_by}
                              sub={r.requested_at ? ago(r.requested_at) : undefined} />
                            {r.decided_by && (
                              <Fact label="Decided" value={r.decided_by_name ?? r.decided_by}
                                sub={r.decided_at ? ago(r.decided_at) : undefined} />
                            )}
                          </CardBody>
                          {r.decision_note && <CardNote>{r.decision_note}</CardNote>}
                        </>
                      }>
                        <span className="font-semibold text-navy text-[12.5px] cursor-help">
                          {r.name}
                        </span>
                      </HoverCard>
                      <span className="block text-[10.5px] font-mono text-violet font-bold">
                        {r.emp_no}
                      </span>
                    </Td>
                    <Td>
                      <Chip tone={k.tone} dot={false}>{k.label}</Chip>
                      {r.at_time && (
                        <span className="block text-[11px] text-txt-muted mt-0.5 tabular-nums">
                          at {r.at_time}
                        </span>
                      )}
                    </Td>
                    <Td className="text-txt-muted">
                      <span className="block text-[12px]">{r.reason ?? r.reason_code}</span>
                      {r.remarks && (
                        <span className="block text-[10.5px] text-txt-light truncate max-w-[26ch]"
                          title={r.remarks}>{r.remarks}</span>
                      )}
                    </Td>
                    <Td className="hidden lg:table-cell">
                      <span className="text-[12px] text-txt-secondary">
                        {r.requested_by_name ?? r.requested_by}
                      </span>
                      {r.requested_at && (
                        <span className="block text-[10.5px] text-txt-light"
                          title={exactly(r.requested_at)}>{ago(r.requested_at)}</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Chip>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {r.status === "PENDING" ? (
                        mayDecide && !isMine ? (
                          <span className="inline-flex gap-1.5">
                            <Button size="sm" variant="primary"
                              disabled={busy === r.correction_id}
                              onClick={() => { setNote(""); setDecide({ row: r, to: "APPROVED" }); }}>
                              <Check className="w-3.5 h-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="secondary"
                              disabled={busy === r.correction_id}
                              onClick={() => { setNote(""); setDecide({ row: r, to: "REJECTED" }); }}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </span>
                        ) : isMine ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-[11px] text-txt-light">yours</span>
                            {mayRaise && (
                              <button type="button" onClick={() => withdraw(r)}
                                disabled={busy === r.correction_id}
                                className="inline-flex items-center gap-1 text-[11.5px]
                                           font-semibold text-txt-muted hover:text-rose">
                                <Undo2 className="w-3 h-3" /> Withdraw
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="text-[11px] text-txt-light">with an approver</span>
                        )
                      ) : (
                        <span className="text-[11px] text-txt-muted">
                          {r.decided_by_name ?? r.decided_by ?? "—"}
                          {r.decided_at && (
                            <span className="block text-[10.5px] text-txt-light"
                              title={exactly(r.decided_at)}>{ago(r.decided_at)}</span>
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

        {tab === "PENDING" && n("PENDING") > 0 && mayDecide && (
          <div className="px-4 py-2.5 border-t border-border-light bg-amber-bg/40
                          flex items-start gap-2 text-[12px] text-txt-secondary">
            <AlertTriangle className="w-3.5 h-3.5 text-amber shrink-0 mt-0.5" />
            <span>
              Before approving a batch of single-punch corrections from one day,
              check the Activity matrix for that date. If dozens are affected it
              was the gate, and the correction belongs against the day rather
              than against each person.
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
