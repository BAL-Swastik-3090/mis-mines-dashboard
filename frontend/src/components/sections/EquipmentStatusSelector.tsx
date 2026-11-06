"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, History, Loader2 } from "lucide-react";
import api from "@/lib/api";

/**
 * The Equipment Status Selector — who is on the OEE tables, and what they are
 * measured against.
 *
 * WHAT THIS SCREEN ACTUALLY MOVES. The ideal rate on a row is the denominator
 * of that machine's Performance, so changing it changes Performance, OEE, and
 * both weighted OVERALL rows. Old or new decides which of the two tables a
 * machine appears in. Inactive takes it off the screen entirely. None of
 * these are cosmetic, and the banner says so rather than leaving somebody to
 * find out from a report.
 *
 * THE DATE IS NOT A FILTER, IT IS THE EDIT. Everything on this screen is
 * "from this day onward". Viewing 1 October shows what October was measured
 * with; saving on 1 October rewrites October and every month after it that
 * has no decision of its own. That is the rule the mine asked for — set it
 * once and it holds until changed — and the only honest way to show it is to
 * put the date at the top of the form rather than beside a search box.
 *
 * A ROW SAYS WHICH DAY ITS SETTINGS WERE CHOSEN ON. A machine last changed in
 * October still answers a question about November, and showing those settings
 * without their date would imply somebody chose them for November.
 */

type Klass = "EXCAVATOR" | "TIPPER";
type Gen = "OLD" | "NEW";
type Status = "ACTIVE" | "INACTIVE";

interface Machine {
  id: number;
  equipment_name: string;
  category: "OWN" | "HIRED";
  equipment_class: Klass;
  name_shift_log: string | null;
  sap_equipment_no: string | null;
  sap_desc_tech_object: string | null;
  engine_source: string | null;
  bd_source: string;
  effective_from: string;
  status: Status;
  generation: Gen;
  ideal_cum_per_hr: number | null;
  ideal_trip_fixed: number | null;
  trips_per_engine_hour: number | null;
  revision: number;
}

interface Group {
  key: string;
  label: string;
  equipment_class: Klass;
  generation: Gen;
  machines: Machine[];
}

interface Read { on_date: string; groups: Group[]; count: number }

interface Edit {
  equipment_name: string;
  effective_from: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  revision: number;
  entry_id: string;
  entry_date: string;
}

/** The one figure this machine is measured by, and what to call it. */
function rateOf(m: Machine): { field: keyof Machine; label: string; value: number | null } {
  if (m.equipment_class === "EXCAVATOR")
    return { field: "ideal_cum_per_hr", label: "Ideal CuM/hr", value: m.ideal_cum_per_hr };
  if (m.generation === "NEW")
    return { field: "ideal_trip_fixed", label: "Ideal Trip", value: m.ideal_trip_fixed };
  return { field: "trips_per_engine_hour", label: "Trips / Engine hr", value: m.trips_per_engine_hour };
}

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

type Draft = Partial<Record<"status" | "generation" | "ideal_cum_per_hr"
  | "ideal_trip_fixed" | "trips_per_engine_hour", string | number | null>>;

export default function EquipmentStatusSelector({ onSaved }: {
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
    queryKey: ["oee-settings", "equipment", effective],
    queryFn: async () =>
      (await api.get("/oee-settings/equipment",
        { params: { on_date: effective, include_inactive: true } })).data,
    staleTime: 10 * 1000,
  });

  const hist = useQuery<{ history: Edit[] }>({
    queryKey: ["oee-settings", "equipment", "history"],
    queryFn: async () =>
      (await api.get("/oee-settings/equipment/history", { params: { limit: 120 } })).data,
    enabled: showHistory,
    staleTime: 10 * 1000,
  });

  const groups = useMemo(() => q.data?.groups ?? [], [q.data]);

  function set(name: string, field: keyof Draft, value: string | number | null) {
    setDraft((d) => ({ ...d, [name]: { ...(d[name] ?? {}), [field]: value } }));
    setDone(null);
  }

  /** What a cell shows: an unsaved edit first, then what is in force. */
  function shown<T>(m: Machine, field: keyof Draft, fallback: T): T | string | number | null {
    const d = draft[m.equipment_name];
    return d && field in d ? d[field]! : fallback;
  }

  const changed = Object.entries(draft).filter(([, d]) => Object.keys(d).length > 0);

  async function save() {
    setBusy(true); setError(null); setDone(null);
    try {
      const changes = changed.map(([equipment_name, d]) => ({ equipment_name, ...d }));
      const r = await api.post("/oee-settings/equipment",
        { effective_from: effective, changes });
      const n = r.data?.fields ?? 0;
      const k = r.data?.written?.length ?? 0;
      setDone(n === 0
        ? "Nothing had changed — nothing was written."
        : `${n} setting${n === 1 ? "" : "s"} on ${k} machine${k === 1 ? "" : "s"}, from ${onDay(effective)}.`);
      setDraft({});
      await q.refetch();
      if (showHistory) await hist.refetch();
      await onSaved();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The settings could not be saved.");
    } finally { setBusy(false); }
  }

  return (
    <>
      {/* ── the date these choices start from ─────────────────────────── */}
      <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-end gap-3 flex-wrap">
        <div>
          <label htmlFor="ess-date"
            className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
            Effective from
          </label>
          <input
            id="ess-date" type="date" value={effective}
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

      {/* THE WARNING IS AT THE TOP, NOT IN A FOOTNOTE. Somebody who has
          already pressed Save does not need to be told what it did. */}
      <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-[11px] text-amber-900 leading-relaxed">
          These settings are the OEE calculation. An ideal rate is the
          denominator of Performance; <strong>old</strong> or <strong>new</strong>{" "}
          decides which table a machine appears in; <strong>inactive</strong>{" "}
          removes it from the tables and from both OVERALL rows.
        </p>
      </div>

      <div className="max-h-[56vh] overflow-y-auto">
        {q.isLoading && (
          <div className="px-4 py-10 text-center text-[12px] text-txt-muted">
            <Loader2 size={16} className="inline animate-spin mr-2" />Loading…
          </div>
        )}

        {groups.map((g) => (
          <div key={g.key}>
            <div className="px-4 py-1.5 bg-bg-section border-y border-border-light
                            text-[10px] font-condensed font-bold tracking-widest
                            uppercase text-navy flex items-center gap-2">
              {g.label}
              <span className="font-normal text-txt-muted normal-case tracking-normal">
                {g.machines.length} machine{g.machines.length === 1 ? "" : "s"}
              </span>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} text-left min-w-[150px]`}>Equipment</th>
                  <th className={`${TH} text-left`}>Status</th>
                  <th className={`${TH} text-left`}>Fleet</th>
                  <th className={`${TH} text-right`}>Ideal rate</th>
                  <th className={`${TH} text-left`}>Breakdown from</th>
                  <th className={`${TH} text-left`}>Set on</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {g.machines.map((m) => {
                  const rate = rateOf(m);
                  const d = draft[m.equipment_name] ?? {};
                  const dirty = Object.keys(d).length > 0;
                  const status = shown(m, "status", m.status) as Status;
                  return (
                    <tr key={m.equipment_name}
                        className={dirty ? "bg-amber-50/60" : "hover:bg-bg-light"}>
                      <td className={`${TD} font-semibold text-navy`}>
                        {m.equipment_name}
                        {m.category === "HIRED" && (
                          <span className="ml-1.5 px-1 rounded-sm bg-bg-section text-[8px]
                                           font-bold tracking-widest uppercase text-txt-muted">
                            hired
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        <select
                          value={status}
                          onChange={(e) => set(m.equipment_name, "status", e.target.value)}
                          className="border border-border rounded px-1.5 py-1 text-[11px] bg-white"
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                        </select>
                      </td>
                      <td className={TD}>
                        <select
                          value={shown(m, "generation", m.generation) as Gen}
                          onChange={(e) => set(m.equipment_name, "generation", e.target.value)}
                          className="border border-border rounded px-1.5 py-1 text-[11px] bg-white"
                        >
                          <option value="OLD">Old</option>
                          <option value="NEW">New</option>
                        </select>
                      </td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        <input
                          type="number" step="any" min="0"
                          value={(shown(m, rate.field as keyof Draft, rate.value) ?? "") as string | number}
                          onChange={(e) => set(m.equipment_name, rate.field as keyof Draft,
                            e.target.value === "" ? null : Number(e.target.value))}
                          className="w-20 border border-border rounded px-1.5 py-1 text-[11px]
                                     text-right tabular-nums bg-white"
                        />
                        <span className="ml-1.5 text-[9px] text-txt-muted">{rate.label}</span>
                      </td>
                      {/* NOT EDITABLE HERE, AND SHOWN ANYWAY. Where a machine's
                          downtime comes from is a fact about which systems have
                          ever heard of it, not a choice — but it explains why
                          two machines in one table read so differently. */}
                      <td className={`${TD} text-[10px] uppercase tracking-wide text-txt-muted`}>
                        {m.bd_source === "SAP" ? "SAP" : "Shift log"}
                      </td>
                      <td className={`${TD} text-[10px] text-txt-light tabular-nums`}>
                        {onDay(m.effective_from)}
                        {m.effective_from !== effective && (
                          <span className="ml-1 text-txt-light/70">(carried)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

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
                    {h.equipment_name}
                  </span>
                  <span className="text-txt-secondary">{h.field}</span>
                  <span className="tabular-nums text-txt-muted">
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

      {/* ── save ─────────────────────────────────────────────────────── */}
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
            : `${changed.length} machine${changed.length === 1 ? "" : "s"} changed`}
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
