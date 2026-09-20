"use client";
/**
 * Leave: asking for it, deciding it, and seeing what it costs the roster.
 *
 * Requests waiting for a decision come first and stay first, because a leave
 * sitting unapproved is not neutral — the person has probably already made
 * plans, and the roster is being built around an answer nobody has given.
 *
 * Approving somebody who is on a machine right now does not release them. The
 * screen says so in as many words and leaves the release to the shift board,
 * because pulling an operator off a running excavator is not a decision a leave
 * form should be making quietly.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "@/components/minehub/DateField";
import {
  Plane, Plus, Loader2, Check, X, Clock, Search, Settings2, CalendarDays,
} from "lucide-react";
import api from "@/lib/api";
import {
  Button, Card, CardHeader, Chip, Field, inputClass, Tile, Avatar,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import { LEAVE_STATUS, shortDate, isoDay } from "./state";

interface LeaveType {
  leave_type_id: number; code: string; name: string; description: string | null;
  is_paid: boolean; annual_quota: number | null; blocks_deployment: boolean;
  needs_approval: boolean; colour: string | null; is_active: boolean;
  taken_this_year: number;
}

interface Leave {
  leave_request_id: number; leave_ref: string; operator_id: number;
  display_name: string; operator_ref: string | null; designation: string | null;
  type_code: string; type_name: string; colour: string | null; is_paid: boolean;
  blocks_deployment: boolean;
  from_date: string; to_date: string; days: number | null;
  half_day_start: boolean; half_day_end: boolean;
  reason: string | null; status: string;
  applied_by: string | null; decided_by: string | null; decision_note: string | null;
  is_retrospective: boolean;
}

interface Op { operator_id: number; display_name: string; operator_ref: string | null; }

const FILTERS = [
  { id: "SUBMITTED", label: "Waiting" },
  { id: "APPROVED", label: "Approved" },
  { id: "", label: "Everything" },
];

export default function LeaveDesk({ mayApply, mayApprove, mayManage, onChanged,
                                   onOpenOperator }: {
  mayApply: boolean; mayApprove: boolean; mayManage: boolean;
  onChanged?: () => void; onOpenOperator?: (id: number) => void;
}) {
  const [rows, setRows] = useState<Leave[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [people, setPeople] = useState<Op[]>([]);
  const [filter, setFilter] = useState("SUBMITTED");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "new" | "type" | null>(null);

  const [applying, setApplying] = useState(false);
  const [typing, setTyping] = useState(false);
  const [form, setForm] = useState({
    operator_id: "", leave_type_id: "", from_date: isoDay(new Date()),
    to_date: isoDay(new Date()), half_day_start: false, half_day_end: false, reason: "",
  });
  const [typeForm, setTypeForm] = useState({
    code: "", name: "", is_paid: true, annual_quota: "",
    blocks_deployment: true, needs_approval: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, t] = await Promise.all([
        api.get("/workforce/leave", { params: { status: filter || undefined } }),
        api.get("/workforce/leave-types"),
      ]);
      setRows(l.data ?? []);
      setTypes(t.data ?? []);
      setError(null);
    } catch {
      setError("Leave could not be loaded.");
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // The operator list is only needed to raise a request, so it is fetched when
  // the form opens rather than on every visit to the screen.
  useEffect(() => {
    if (!applying || people.length) return;
    void api.get("/workforce/people")
      .then((r) => setPeople(r.data ?? []))
      .catch(() => setPeople([]));
  }, [applying, people.length]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => [r.display_name, r.leave_ref, r.type_name, r.operator_ref]
      .some((v) => String(v ?? "").toLowerCase().includes(term)));
  }, [rows, query]);

  const waiting = rows.filter((r) => r.status === "SUBMITTED").length;
  const today = isoDay(new Date());
  const awayNow = rows.filter(
    (r) => r.status === "APPROVED" && r.from_date <= today && r.to_date >= today).length;

  const decide = async (row: Leave, status: string) => {
    setBusy(row.leave_request_id);
    try {
      const r = await api.post(`/workforce/leave/${row.leave_request_id}/decide`, { status });
      setNotice(r.data?.warning
        ?? `${row.leave_ref} ${status === "APPROVED" ? "approved" : status.toLowerCase()}.`);
      await load();
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That decision could not be recorded.");
    } finally { setBusy(null); }
  };

  const apply = async () => {
    if (!form.operator_id || !form.leave_type_id) return;
    setBusy("new");
    try {
      const r = await api.post("/workforce/leave", {
        ...form, operator_id: Number(form.operator_id),
        leave_type_id: Number(form.leave_type_id),
      });
      setApplying(false);
      setNotice(`${r.data.leave_ref} raised — ${r.data.days} day(s), ${
        r.data.status === "APPROVED" ? "approved straight away" : "waiting for a decision"}.`);
      setForm({ ...form, reason: "" });
      await load();
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The request could not be raised.");
    } finally { setBusy(null); }
  };

  const saveType = async () => {
    if (!typeForm.code.trim()) return;
    setBusy("type");
    try {
      await api.post("/workforce/leave-types", {
        ...typeForm,
        annual_quota: typeForm.annual_quota ? Number(typeForm.annual_quota) : null,
      });
      setTyping(false);
      setTypeForm({ code: "", name: "", is_paid: true, annual_quota: "",
                    blocks_deployment: true, needs_approval: true });
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The leave type could not be saved.");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Waiting for a decision" value={waiting} icon={Clock}
              tone={waiting ? "amber" : "slate"}
              hint={waiting ? "Somebody is waiting on this" : "Nothing outstanding"}
              onClick={() => setFilter("SUBMITTED")} active={filter === "SUBMITTED"} />
        <Tile label="Away today" value={awayNow} icon={Plane} tone="sky"
              hint="On approved leave right now" />
        <Tile label="Kinds of leave" value={types.filter((t) => t.is_active).length}
              icon={Settings2} tone="violet"
              hint={types.length ? "Defined by this mine" : "None defined yet"} />
        <Tile label="Requests on file" value={rows.length} icon={CalendarDays} tone="navy"
              hint={FILTERS.find((f) => f.id === filter)?.label ?? ""} />
      </div>

      <Card>
        <CardHeader
          title="Leave" icon={Plane} tone="amber"
          subtitle="Raised, decided, and what it means for the roster"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-light" />
                <input className={`${inputClass} pl-8 w-44`} placeholder="Find a request"
                       value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                {FILTERS.map((f) => (
                  <button key={f.id} onClick={() => setFilter(f.id)}
                    className={`px-2.5 py-1.5 text-[11px] font-semibold transition
                      ${filter === f.id ? "bg-navy text-white"
                                        : "bg-white text-txt-muted hover:bg-slate-50"}`}>
                    {f.label}
                  </button>
                ))}
              </div>
              {mayManage && (
                <Button size="sm" variant="secondary" onClick={() => setTyping(true)}>
                  <Settings2 className="w-3.5 h-3.5" /> Leave types
                </Button>
              )}
              {mayApply && (
                <Button size="sm" variant="primary" onClick={() => setApplying(true)}
                        disabled={types.length === 0}>
                  <Plus className="w-3.5 h-3.5" /> Raise leave
                </Button>
              )}
            </div>
          }
        />

        {error && (
          <div className="px-5 py-3 text-[12px] text-rose bg-rose-bg border-b border-rose/20">
            {error}
          </div>
        )}
        {notice && (
          <div className="px-5 py-3 text-[12px] text-sky bg-sky-bg border-b border-sky/20
                          flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {types.length === 0 && !loading && (
          <div className="px-5 py-4 text-[12.5px] text-amber bg-amber-bg border-b border-amber/20">
            No kinds of leave have been defined. Nothing is seeded on purpose —
            what counts as casual leave here is this mine&apos;s to decide, and a
            list invented elsewhere would be quietly wrong.
            {mayManage && <> Define them under <strong>Leave types</strong>.</>}
          </div>
        )}

        {loading ? (
          <div className="px-5 py-12 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-txt-light" />
          </div>
        ) : shown.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-txt-muted">
            {filter === "SUBMITTED" ? "Nothing is waiting for a decision."
                                    : "No leave matches that."}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {shown.map((r) => {
              const look = LEAVE_STATUS[r.status] ?? LEAVE_STATUS.DRAFT;
              const live = r.status === "APPROVED" && r.from_date <= today && r.to_date >= today;
              return (
                <div key={r.leave_request_id}
                     className="px-5 py-3.5 flex flex-wrap items-center gap-3 hover:bg-slate-50/60">
                  <Avatar name={r.display_name} />
                  <div className="min-w-[190px]">
                    <button onClick={() => onOpenOperator?.(r.operator_id)}
                      className="text-[13px] font-semibold text-navy hover:text-gold
                                 hover:underline text-left">
                      {r.display_name}
                    </button>
                    <p className="text-[11px] text-txt-light">
                      {r.operator_ref || "—"} · {r.designation || "role not set"}
                    </p>
                  </div>
                  <div className="min-w-[160px]">
                    <p className="text-[12.5px] font-semibold text-navy">
                      {shortDate(r.from_date)}
                      {r.to_date !== r.from_date && ` – ${shortDate(r.to_date)}`}
                    </p>
                    <p className="text-[11px] text-txt-light">
                      {r.days} day{Number(r.days) === 1 ? "" : "s"} · {r.type_name}
                      {!r.is_paid && " · unpaid"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={look.tone}>{look.label}</Chip>
                    {live && <Chip tone="sky" dot={false}>Away now</Chip>}
                    {r.is_retrospective && <Chip tone="slate" dot={false}>After the fact</Chip>}
                    {!r.blocks_deployment && (
                      <Chip tone="slate" dot={false} title="This kind of leave does not stop deployment">
                        Still deployable
                      </Chip>
                    )}
                  </div>
                  {r.reason && (
                    <p className="text-[11.5px] text-txt-muted italic max-w-[240px] truncate"
                       title={r.reason}>“{r.reason}”</p>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10.5px] text-txt-light font-mono">{r.leave_ref}</span>
                    {mayApprove && r.status === "SUBMITTED" && (
                      <>
                        <Button size="sm" variant="primary"
                                disabled={busy === r.leave_request_id}
                                onClick={() => void decide(r, "APPROVED")}>
                          <Check className="w-3.5 h-3.5" /> Approve
                        </Button>
                        <Button size="sm" variant="secondary"
                                disabled={busy === r.leave_request_id}
                                onClick={() => void decide(r, "REJECTED")}>
                          Reject
                        </Button>
                      </>
                    )}
                    {mayApprove && r.status === "APPROVED" && r.to_date >= today && (
                      <Button size="sm" variant="secondary"
                              disabled={busy === r.leave_request_id}
                              onClick={() => void decide(r, "CANCELLED")}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={applying} tone="info" title="Raise leave"
        confirmLabel="Raise it" busy={busy === "new"}
        onConfirm={() => void apply()} onCancel={() => setApplying(false)}>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Who" required>
              <select className={inputClass} value={form.operator_id}
                      onChange={(e) => setForm({ ...form, operator_id: e.target.value })}>
                <option value="">Choose an operator</option>
                {people.map((p) => (
                  <option key={p.operator_id} value={p.operator_id}>
                    {p.display_name}{p.operator_ref ? ` — ${p.operator_ref}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kind of leave" required>
              <select className={inputClass} value={form.leave_type_id}
                      onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}>
                <option value="">Choose</option>
                {types.filter((t) => t.is_active).map((t) => (
                  <option key={t.leave_type_id} value={t.leave_type_id}>
                    {t.name} ({t.code}){t.is_paid ? "" : " — unpaid"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From" required>
              <DateField className={inputClass} value={form.from_date} onChange={(v) => setForm({ ...form, from_date: v, to_date: v > form.to_date ? v : form.to_date })} />
            </Field>
            <Field label="To" required>
              <DateField className={inputClass} value={form.to_date} min={form.from_date} onChange={(v) => setForm({ ...form, to_date: v })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[12px] text-txt-muted">
              <input type="checkbox" checked={form.half_day_start}
                     onChange={(e) => setForm({ ...form, half_day_start: e.target.checked })} />
              First day is a half day
            </label>
            {form.to_date !== form.from_date && (
              <label className="flex items-center gap-2 text-[12px] text-txt-muted">
                <input type="checkbox" checked={form.half_day_end}
                       onChange={(e) => setForm({ ...form, half_day_end: e.target.checked })} />
                Last day is a half day
              </label>
            )}
          </div>
          <Field label="Reason">
            <input className={inputClass} value={form.reason} placeholder="Optional"
                   onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          {form.to_date < today && (
            <p className="text-[12px] text-amber">
              These dates are in the past — this will be recorded as leave taken
              rather than leave planned.
            </p>
          )}
        </div>
      </Dialog>

      <Dialog open={typing} tone="info" title="Kinds of leave"
        confirmLabel="Save this kind" busy={busy === "type"}
        onConfirm={() => void saveType()} onCancel={() => setTyping(false)}>
        <div className="space-y-3">
          {types.length > 0 && (
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100
                            max-h-40 overflow-auto">
              {types.map((t) => (
                <div key={t.leave_type_id} className="px-3 py-2 flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-navy">{t.name}</span>
                  <span className="text-[11px] text-txt-light">{t.code}</span>
                  {!t.is_paid && <Chip tone="slate" dot={false}>Unpaid</Chip>}
                  {!t.blocks_deployment && <Chip tone="sky" dot={false}>Still deployable</Chip>}
                  {t.annual_quota && (
                    <span className="ml-auto text-[11px] text-txt-muted tabular-nums">
                      {t.annual_quota}/yr
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Short code" required>
              <input className={inputClass} value={typeForm.code} maxLength={16} placeholder="CL"
                     onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Name" required>
              <input className={inputClass} value={typeForm.name} placeholder="Casual leave"
                     onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} />
            </Field>
            <Field label="Days a year" hint="Leave blank if it is not counted">
              <input type="number" step="0.5" className={inputClass} value={typeForm.annual_quota}
                     onChange={(e) => setTypeForm({ ...typeForm, annual_quota: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[12px] text-txt-muted">
              <input type="checkbox" checked={typeForm.is_paid}
                     onChange={(e) => setTypeForm({ ...typeForm, is_paid: e.target.checked })} />
              Paid
            </label>
            <label className="flex items-center gap-2 text-[12px] text-txt-muted">
              <input type="checkbox" checked={typeForm.needs_approval}
                     onChange={(e) => setTypeForm({ ...typeForm, needs_approval: e.target.checked })} />
              Needs approving before it counts
            </label>
            <label className="flex items-start gap-2 text-[12px] text-txt-muted">
              <input type="checkbox" className="mt-0.5" checked={typeForm.blocks_deployment}
                     onChange={(e) => setTypeForm({ ...typeForm, blocks_deployment: e.target.checked })} />
              <span>
                Stops them being put on a machine.
                <span className="block text-[11px] text-txt-light">
                  Turn this off for things like training, which are leave on paper
                  and presence in the pit.
                </span>
              </span>
            </label>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
