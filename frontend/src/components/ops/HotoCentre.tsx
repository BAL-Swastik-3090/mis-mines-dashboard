"use client";
/**
 * Handover and takeover.
 *
 * The checklist is the screen. Twenty-eight items answered with a thumb on a
 * phone at the pit head, so the buttons are large, the critical items are marked
 * before anyone touches them, and the count of what is left is always visible —
 * nobody should have to scroll to find out whether they are finished.
 *
 * Critical items are not a formality. One marked bad blocks the handover and
 * puts the machine on inspection hold, because a shift change must not become
 * the way an unsafe machine gets back to work.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, Loader2, Check, X, AlertTriangle, ShieldAlert, Gauge, Clock,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Card, CardHeader, Chip, type Tone } from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import Toast from "@/components/minehub/Toast";
import { ago, clock } from "./state";

interface HotoRow {
  hoto_id: number; hoto_ref: string; status: string; blocked_reason: string | null;
  meter_reading: number | null; created_at: string; updated_at: string;
  fleet_code: string; nickname: string | null; asset_type: string | null;
  outgoing_name: string | null; incoming_name: string | null;
  check_count: number; answered: number;
}

interface CheckItem {
  key: string; label: string; critical?: boolean;
  status?: string | null; remarks?: string | null;
}

interface Candidate {
  operator_id: number; display_name: string; level: number | null;
  readiness: string; blockers: string[];
}

const STATUS_TONE: Record<string, Tone> = {
  PENDING: "amber", BLOCKED: "rose", COMPLETED: "emerald", CANCELLED: "slate",
};

export default function HotoCentre({ openId, onOpened, rights, onChanged }: {
  openId?: number | null;
  onOpened?: () => void;
  rights: { may_manage: boolean; may_hoto: boolean; may_override: boolean };
  onChanged?: () => void;
}) {
  const [list, setList] = useState<HotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [current, setCurrent] = useState<Record<string, unknown> | null>(null);
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [meter, setMeter] = useState("");
  const [incoming, setIncoming] = useState("");
  const [remarks, setRemarks] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [blockedBy, setBlockedBy] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/ops/hoto");
      setList(r.data ?? []);
      setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not load handovers.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openOne = useCallback(async (hotoId: number) => {
    try {
      const r = await api.get(`/ops/hoto/${hotoId}`);
      setCurrent(r.data);
      setChecks((r.data.checks ?? []) as CheckItem[]);
      setMeter(r.data.meter_reading !== null ? String(r.data.meter_reading) : "");
      setIncoming(r.data.incoming_operator_id ? String(r.data.incoming_operator_id) : "");
      setRemarks(r.data.remarks ?? "");
      const c = await api.get(`/ops/assets/${r.data.asset_id}/candidates`).catch(() => ({ data: [] }));
      setCandidates(c.data ?? []);
    } catch { setError("Could not open that handover."); }
  }, []);

  useEffect(() => {
    if (openId) { void openOne(openId); onOpened?.(); }
  }, [openId, openOne, onOpened]);

  const answered = checks.filter((c) => c.status).length;
  const criticalBad = checks.filter((c) => c.critical && c.status === "BAD");
  const left = checks.length - answered;

  const setStatus = (key: string, status: string) =>
    setChecks((prev) => prev.map((c) => c.key === key ? { ...c, status } : c));

  const setAllOk = () =>
    setChecks((prev) => prev.map((c) => c.status ? c : { ...c, status: "OK" }));

  const save = async (then?: "complete") => {
    if (!current) return;
    setBusy("save");
    try {
      await api.put(`/ops/hoto/${current.hoto_id}`, {
        checks, meter_reading: meter ? Number(meter) : null,
        incoming_operator_id: incoming ? Number(incoming) : null,
        remarks: remarks || null,
      });
      if (then === "complete") {
        await api.post(`/ops/hoto/${current.hoto_id}/complete`, {
          incoming_operator_id: incoming ? Number(incoming) : undefined,
          remarks: remarks || undefined,
        });
        setNotice(`${current.hoto_ref} completed — responsibility transferred.`);
        setCurrent(null);
      } else {
        setNotice("Saved.");
      }
      await load(); onChanged?.();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      if (detail && typeof detail === "object") {
        const d = detail as { message?: string; critical?: string[]; blockers?: string[]; action?: string };
        if (d.critical) {
          setBlockedBy(d.critical);
          setNotice(null);
          await load();
          setCurrent(null);
        } else if (d.blockers) {
          setError(`${d.message ?? "Blocked"} — ${d.blockers.join("; ")}`);
        } else {
          setError(d.message ?? "Could not complete the handover.");
        }
      } else {
        setError(typeof detail === "string" ? detail : "Could not complete the handover.");
      }
    } finally { setBusy(null); }
  };

  const open = list.filter((h) => h.status === "PENDING" || h.status === "BLOCKED");
  const done = list.filter((h) => h.status === "COMPLETED" || h.status === "CANCELLED");

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  return (
    <div className="space-y-4">
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />

      {open.length === 0 && done.length === 0 && (
        <Card>
          <div className="px-5 py-14 text-center">
            <ArrowLeftRight className="w-7 h-7 mx-auto text-txt-light mb-3" />
            <p className="text-[14px] font-semibold text-navy">No handovers yet</p>
            <p className="text-[12.5px] text-txt-muted mt-1 max-w-md mx-auto">
              A handover starts from the Live fleet, on a machine that somebody is
              running. It transfers responsibility — it is not a form filled in
              afterwards.
            </p>
          </div>
        </Card>
      )}

      {open.length > 0 && (
        <Card tone="amber">
          <CardHeader title={`Open handovers · ${open.length}`} icon={ArrowLeftRight} tone="amber"
            subtitle="Blocked ones first. A handover holds responsibility for a machine until it finishes." />
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {open.map((h) => (
              <button key={h.hoto_id} onClick={() => void openOne(h.hoto_id)}
                className={`text-left rounded-xl border bg-bg-base p-4 transition-all
                            hover:shadow-md hover:-translate-y-0.5
                            ${h.status === "BLOCKED" ? "border-rose-ring" : "border-amber-ring"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-condensed font-extrabold text-[15px] text-navy truncate">
                      {h.nickname || h.fleet_code}
                    </div>
                    <div className="font-mono text-[10.5px] text-txt-light">{h.hoto_ref}</div>
                  </div>
                  <Chip tone={STATUS_TONE[h.status] ?? "slate"}>{h.status.toLowerCase()}</Chip>
                </div>

                <div className="mt-2.5 text-[12.5px] text-txt-secondary">
                  {h.outgoing_name ?? "—"} <span className="text-txt-light">→</span>{" "}
                  {h.incoming_name ?? <span className="text-txt-light">nobody yet</span>}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-bg-section overflow-hidden">
                    <div className="h-full bg-grad-gold transition-all"
                      style={{ width: `${Math.round((h.answered / Math.max(h.check_count, 1)) * 100)}%` }} />
                  </div>
                  <span className="text-[11px] tabular-nums text-txt-muted">
                    {h.answered}/{h.check_count}
                  </span>
                </div>

                {h.blocked_reason && (
                  <p className="mt-2 text-[11px] text-rose leading-snug line-clamp-2">
                    {h.blocked_reason}
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-txt-light">{ago(h.created_at)}</p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {done.length > 0 && (
        <Card tone="slate">
          <CardHeader title="Completed" icon={Check} tone="slate"
            subtitle="What was handed over, by whom, and when." />
          <ul className="divide-y divide-border-light">
            {done.slice(0, 12).map((h) => (
              <li key={h.hoto_id} className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-mono text-[11px] text-violet">{h.hoto_ref}</span>
                  <span className="font-semibold text-navy text-[13px] ml-2">
                    {h.nickname || h.fleet_code}
                  </span>
                  <span className="block text-[12px] text-txt-muted">
                    {h.outgoing_name ?? "—"} → {h.incoming_name ?? "—"}
                    {h.meter_reading !== null && ` · ${h.meter_reading} hrs`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-txt-light">{ago(h.updated_at)}</span>
                  <Chip tone={STATUS_TONE[h.status] ?? "slate"} dot={false}>
                    {h.status.toLowerCase()}
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* The checklist itself */}
      <Dialog open={Boolean(current)} tone={criticalBad.length ? "danger" : "info"}
        title={current ? `${current.hoto_ref} · ${current.nickname || current.fleet_code}` : ""}
        confirmLabel={left > 0 ? `${left} left to answer` : "Complete handover"}
        cancelLabel="Close"
        busy={busy !== null || left > 0}
        onConfirm={() => void save("complete")}
        onCancel={() => setCurrent(null)}
        secondary={{ label: "Save progress", tone: "secondary", onClick: () => void save() }}>
        {current && (
          <div className="space-y-3 text-left">
            {String(current.status) === "BLOCKED" && current.blocked_reason ? (
              <Alert tone="error">{String(current.blocked_reason)}</Alert>
            ) : null}

            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[12px]">
                <span className="block font-semibold text-txt-secondary mb-1">Meter reading</span>
                <span className="relative block">
                  <Gauge className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-light" />
                  <input type="number" value={meter} onChange={(e) => setMeter(e.target.value)}
                    className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5
                               text-[13px] w-[140px] tabular-nums" />
                </span>
              </label>
              <label className="text-[12px] flex-1 min-w-[200px]">
                <span className="block font-semibold text-txt-secondary mb-1">Taking over</span>
                <select value={incoming} onChange={(e) => setIncoming(e.target.value)}
                  className="w-full bg-bg-base border border-border rounded-lg px-3 py-1.5 text-[13px]">
                  <option value="">Nobody yet — machine stands idle</option>
                  {candidates.map((c) => (
                    <option key={c.operator_id} value={c.operator_id}>
                      {c.display_name} · L{c.level ?? 0}
                      {c.readiness !== "READY" ? ` — ${c.blockers[0] ?? "has warnings"}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[12px] text-txt-muted">
                <span className="font-bold text-navy">{answered}</span> of {checks.length} answered
                {criticalBad.length > 0 && (
                  <span className="text-rose font-semibold ml-2">
                    · {criticalBad.length} critical fault
                  </span>
                )}
              </span>
              <Button size="sm" variant="secondary" onClick={setAllOk}>
                Mark the rest OK
              </Button>
            </div>

            <ul className="max-h-[42vh] overflow-y-auto divide-y divide-border-light rounded-lg
                           border border-border-light">
              {checks.map((c) => (
                <li key={c.key} className="px-3 py-2 flex items-center justify-between gap-3">
                  <span className="min-w-0 flex items-center gap-1.5">
                    {c.critical && <ShieldAlert className="w-3.5 h-3.5 text-rose shrink-0" />}
                    <span className={`text-[12.5px] ${c.critical ? "font-semibold text-navy" : "text-txt-secondary"}`}>
                      {c.label}
                    </span>
                  </span>
                  <span className="flex gap-1 shrink-0">
                    {[["OK", "emerald"], ["NA", "slate"], ["BAD", "rose"]].map(([value, tone]) => (
                      <button key={value} onClick={() => setStatus(c.key, value)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors
                          ${c.status === value
                            ? tone === "emerald" ? "bg-emerald text-white border-emerald"
                              : tone === "rose" ? "bg-rose text-white border-rose"
                              : "bg-txt-light text-white border-txt-light"
                            : "bg-bg-base text-txt-light border-border hover:border-navy"}`}>
                        {value}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>

            <input value={remarks} onChange={(e) => setRemarks(e.target.value)}
              placeholder="Anything the next operator should know"
              className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px]" />

            {criticalBad.length > 0 && (
              <Alert tone="error">
                {criticalBad.map((c) => c.label).join(", ")} marked bad. Completing
                this will block the handover and put the machine on inspection hold —
                which is the point of marking an item critical.
              </Alert>
            )}
          </div>
        )}
      </Dialog>

      {/* What happened when a critical item stopped it */}
      <Dialog open={Boolean(blockedBy)} tone="danger" title="Handover blocked"
        confirmLabel="Understood" cancelLabel=""
        onConfirm={() => setBlockedBy(null)} onCancel={() => setBlockedBy(null)}>
        <p>These are marked bad and are critical:</p>
        <ul className="mt-1.5 text-[12.5px] text-rose space-y-0.5">
          {(blockedBy ?? []).map((c) => <li key={c}>· {c}</li>)}
        </ul>
        <p className="mt-2 text-[12px] text-txt-muted">
          The machine is now on inspection hold and cannot be deployed until
          somebody releases it from the Live fleet. A shift change is not a way to
          put an unsafe machine back to work.
        </p>
      </Dialog>
    </div>
  );
}
