"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, History, Loader2 } from "lucide-react";
import api from "@/lib/api";

/**
 * The LCM KAM Selector — what each loss head is called, who owns it, whether
 * it is controllable, and which head of department it rolls up to.
 *
 * FOUR COLUMNS, THREE DIFFERENT CONSEQUENCES. The Loss Description is the
 * words on the matrix. The Loss Type decides the controllable /
 * non-controllable split of the rupee value at the foot of it. The KAM names
 * the owner on the row, and Rolls up to moves that row's money between the
 * nodes of the KAM Wise Loss Tree — which is why the two are separate and not
 * derived from each other: H.S.D shortage is owned by one person and reports
 * to another, and so do two other heads.
 *
 * THE DATE IS THE EDIT, NOT A FILTER — the same rule as the Equipment Status
 * Selector beside it. A choice applies from the day it is made until it is
 * changed, so an October matrix keeps October's owners after November has
 * been reassigned.
 *
 * WHAT IS NOT ON THIS SCREEN. Which loss heads exist. That is read from the
 * columns of the shift log, so a loss reason the mine starts recording
 * reaches the matrix on its own — as Unclassified, at the bottom — and
 * appears here once it has been classified. A fixed list here would let a new
 * head go missing, and the matrix would quietly stop footing.
 */

type LossType = "Controllable" | "Non Controllable" | "Unclassified";

interface Head {
  column_name: string;
  label: string;
  loss_type: LossType;
  kam_name: string | null;
  role_code: string | null;
  sl_order: number | null;
  is_active: boolean;
  effective_from: string;
  revision: number;
}

interface Kam { kam_name: string; emp_id: string | null; status: string }
interface Role { role_code: string; title: string; owner_kam: string | null }

interface Read { on_date: string; heads: Head[]; kams: Kam[]; roles: Role[] }

interface Edit {
  column_name: string; effective_from: string; action: string;
  field: string | null; old_value: string | null; new_value: string | null;
  entry_id: string; entry_date: string;
}

const TYPES: LossType[] = ["Controllable", "Non Controllable", "Unclassified"];

function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function onDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

const TH = "px-2 py-1.5 text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary";
const TD = "px-2 py-1.5 text-[12px]";

const TYPE_TONE: Record<LossType, string> = {
  "Controllable":     "text-[#c62828]",
  "Non Controllable": "text-txt-secondary",
  "Unclassified":     "text-[#c8960c]",
};

type Draft = Partial<Record<"label" | "loss_type" | "kam_name" | "role_code"
  | "sl_order" | "is_active", string | number | boolean | null>>;

export default function LcmKamSelector({ onSaved }: {
  onSaved: () => void | Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [effective, setEffective] = useState(today);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { setDraft({}); setError(null); setDone(null); }, [effective]);

  const q = useQuery<Read>({
    queryKey: ["oee-settings", "loss-heads", effective],
    queryFn: async () =>
      (await api.get("/oee-settings/loss-heads", { params: { on_date: effective } })).data,
    staleTime: 10 * 1000,
  });

  const hist = useQuery<{ history: Edit[] }>({
    queryKey: ["oee-settings", "loss-heads", "history"],
    queryFn: async () =>
      (await api.get("/oee-settings/loss-heads/history", { params: { limit: 120 } })).data,
    enabled: showHistory,
    staleTime: 10 * 1000,
  });

  const heads = useMemo(() => q.data?.heads ?? [], [q.data]);
  const kams = q.data?.kams ?? [];
  // The Chief and COB are not nodes a mines loss head reports to, and
  // Unmapped is where the unclassified fall rather than somewhere to put one
  // on purpose. Offering any of the three would let somebody file real money
  // outside the three heads the tree is drawn for.
  const roles = (q.data?.roles ?? []).filter(
    (r) => !["CHIEF", "COB", "UNMAPPED"].includes(r.role_code));

  function set(col: string, field: keyof Draft, value: string | number | boolean | null) {
    setDraft((d) => ({ ...d, [col]: { ...(d[col] ?? {}), [field]: value } }));
    setDone(null);
  }

  function shown<T>(h: Head, field: keyof Draft, fallback: T): T | string | number | boolean | null {
    const d = draft[h.column_name];
    return d && field in d ? d[field]! : fallback;
  }

  const changed = Object.entries(draft).filter(([, d]) => Object.keys(d).length > 0);

  async function save() {
    setBusy(true); setError(null); setDone(null);
    try {
      const changes = changed.map(([column_name, d]) => ({ column_name, ...d }));
      const r = await api.post("/oee-settings/loss-heads",
        { effective_from: effective, changes });
      const n = r.data?.fields ?? 0;
      const k = r.data?.written?.length ?? 0;
      setDone(n === 0
        ? "Nothing had changed — nothing was written."
        : `${n} setting${n === 1 ? "" : "s"} on ${k} loss head${k === 1 ? "" : "s"}, from ${onDay(effective)}.`);
      setDraft({});
      await q.refetch();
      if (showHistory) await hist.refetch();
      await onSaved();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The loss heads could not be saved.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-end gap-3 flex-wrap">
        <div>
          <label htmlFor="lks-date"
            className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
            Effective from
          </label>
          <input
            id="lks-date" type="date" value={effective}
            onChange={(e) => setEffective(e.target.value)}
            className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white"
          />
        </div>
        <p className="text-[10px] leading-relaxed text-txt-muted max-w-sm">
          What is shown is what was in force on this day. What is saved applies
          from this day until it is changed again.
        </p>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="ml-auto flex items-center gap-1 text-[11px] text-steel hover:text-navy"
        >
          <History size={12} /> {showHistory ? "Hide" : "Show"} changes
        </button>
      </div>

      <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-[11px] text-amber-900 leading-relaxed">
          <strong>Loss Type</strong> decides the controllable / non-controllable
          split at the foot of the matrix. <strong>Rolls up to</strong> moves
          that head&rsquo;s money between the nodes of the KAM Wise Loss Tree —
          it is a separate question from who the KAM is, and three heads
          deliberately answer the two differently.
        </p>
      </div>

      <div className="max-h-[56vh] overflow-y-auto">
        {q.isLoading && (
          <div className="px-4 py-10 text-center text-[12px] text-txt-muted">
            <Loader2 size={16} className="inline animate-spin mr-2" />Loading…
          </div>
        )}

        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_var(--color-border-light)]">
            <tr>
              <th className={`${TH} text-right w-10`}>Sl</th>
              <th className={`${TH} text-left min-w-[180px]`}>Loss description</th>
              <th className={`${TH} text-left`}>Loss type</th>
              <th className={`${TH} text-left`}>KAM</th>
              <th className={`${TH} text-left`}>Rolls up to</th>
              <th className={`${TH} text-left`}>Set on</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {heads.map((h) => {
              const d = draft[h.column_name] ?? {};
              const dirty = Object.keys(d).length > 0;
              const lt = shown(h, "loss_type", h.loss_type) as LossType;
              return (
                <tr key={h.column_name}
                    className={dirty ? "bg-amber-50/60" : "hover:bg-bg-light"}>
                  <td className={`${TD} text-right tabular-nums text-txt-muted`}>
                    {h.sl_order ?? "—"}
                  </td>
                  <td className={TD}>
                    <input
                      type="text" maxLength={80}
                      value={shown(h, "label", h.label) as string}
                      onChange={(e) => set(h.column_name, "label", e.target.value)}
                      className="w-full border border-border rounded px-1.5 py-1
                                 text-[12px] font-semibold text-navy bg-white"
                    />
                    {/* THE COLUMN, NOT THE LABEL, IS THE KEY. Shown so that
                        renaming a head does not look like creating one. */}
                    <span className="block mt-0.5 text-[9px] font-mono text-txt-light">
                      {h.column_name}
                    </span>
                  </td>
                  <td className={TD}>
                    <select
                      value={lt}
                      onChange={(e) => set(h.column_name, "loss_type", e.target.value)}
                      className={`border border-border rounded px-1.5 py-1 text-[11px]
                                  font-semibold bg-white ${TYPE_TONE[lt]}`}
                    >
                      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={TD}>
                    <select
                      value={(shown(h, "kam_name", h.kam_name) as string) ?? ""}
                      onChange={(e) => set(h.column_name, "kam_name",
                        e.target.value === "" ? null : e.target.value)}
                      className="border border-border rounded px-1.5 py-1 text-[11px] bg-white"
                    >
                      <option value="">— none —</option>
                      {kams.map((k) => (
                        <option key={k.kam_name} value={k.kam_name}>{k.kam_name}</option>
                      ))}
                    </select>
                  </td>
                  <td className={TD}>
                    <select
                      value={(shown(h, "role_code", h.role_code) as string) ?? ""}
                      onChange={(e) => set(h.column_name, "role_code",
                        e.target.value === "" ? null : e.target.value)}
                      className="border border-border rounded px-1.5 py-1 text-[11px] bg-white"
                    >
                      <option value="">— unmapped —</option>
                      {roles.map((r) => (
                        <option key={r.role_code} value={r.role_code}>{r.title}</option>
                      ))}
                    </select>
                  </td>
                  <td className={`${TD} text-[10px] text-txt-light tabular-nums`}>
                    {onDay(h.effective_from)}
                    {h.effective_from !== effective && (
                      <span className="ml-1 text-txt-light/70">(carried)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {showHistory && (
          <div className="border-t-2 border-border">
            <div className="px-4 py-1.5 bg-bg-section text-[10px] font-condensed
                            font-bold tracking-widest uppercase text-navy">
              Every change, newest first
            </div>
            {hist.isLoading && (
              <p className="px-4 py-3 text-[11px] text-txt-muted">Loading…</p>
            )}
            {!hist.isLoading && (hist.data?.history.length ?? 0) === 0 && (
              <p className="px-4 py-3 text-[11px] text-txt-muted">
                Nothing has been changed yet.
              </p>
            )}
            <ul className="divide-y divide-border-light">
              {(hist.data?.history ?? []).map((h, i) => (
                <li key={i} className="px-4 py-1.5 text-[11px] flex gap-2 flex-wrap">
                  <span className="font-semibold text-navy min-w-[110px]">
                    {h.column_name}
                  </span>
                  <span className="text-txt-secondary">{h.field}</span>
                  <span className="text-txt-muted">
                    {h.old_value ?? "—"} → <strong>{h.new_value ?? "—"}</strong>
                  </span>
                  <span className="ml-auto text-txt-light tabular-nums">
                    from {onDay(h.effective_from)} · {h.entry_id} · {stamp(h.entry_date)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border-light flex items-center gap-3 flex-wrap">
        {error && (
          <p className="text-[11px] text-danger flex items-center gap-1">
            <AlertTriangle size={12} /> {error}
          </p>
        )}
        {done && !error && (
          <p className="text-[11px] text-[#2e7d32] flex items-center gap-1">
            <Check size={12} /> {done}
          </p>
        )}
        <span className="ml-auto text-[11px] text-txt-muted">
          {changed.length === 0 ? "No changes"
            : `${changed.length} loss head${changed.length === 1 ? "" : "s"} changed`}
        </span>
        <button
          onClick={save}
          disabled={busy || changed.length === 0}
          className="px-4 py-1.5 rounded bg-navy text-white text-[12px] font-semibold
                     disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy/90"
        >
          {busy ? <Loader2 size={13} className="inline animate-spin mr-1" /> : null}
          Save from {onDay(effective)}
        </button>
      </div>
    </>
  );
}
