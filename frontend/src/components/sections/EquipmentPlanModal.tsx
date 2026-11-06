"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pickaxe, X, Loader2, AlertTriangle, Check, History } from "lucide-react";
import api from "@/lib/api";
import EquipmentStatusSelector from "./EquipmentStatusSelector";
import LcmKamSelector from "./LcmKamSelector";

/**
 * Which excavator digs ore and which digs overburden, for one month.
 *
 * A FORM, NOT AN UPLOAD — unlike the de-silting plan next to it in the menu.
 * Ten machines and a choice of two is something you read in one screen, so
 * there is no preview step: what you are about to store is what is in front
 * of you.
 *
 * ALL OR NOTHING, AND THE REASON IS NOT TIDINESS. A machine left blank drops
 * out of the LCM's denominator, which lifts every loss head in proportion and
 * moves the controllable/non-controllable split of the rupee value. The total
 * does not change — it is fixed by the deviation — so nothing on the LCM page
 * looks wrong. The server refuses a partial month for that reason and this
 * screen refuses to send one, so the rule holds whichever way a row arrives.
 *
 * A SAVED MONTH IS STILL EDITABLE, AND THE SCREEN SAYS SO. Machines get
 * reassigned mid-month; a screen that opened looking finished would leave
 * somebody believing the plan was closed. An entered month therefore carries a
 * line inviting the change, every unsaved edit names the value it replaces
 * ("was ORE — not saved yet"), and the whole trail of past edits is one click
 * away. Saving writes only what actually differs, so pressing Save twice is
 * not a revision.
 *
 * THREE TABS, ONE SCREEN. The month's ORE/OB assignment was the first thing
 * the mine was given control of; the Equipment Status Selector and the LCM KAM
 * Selector are the other two. All three answer the same kind of question —
 * what the mine has decided, as opposed to what it measured — and all three
 * feed the OEE and the Lost Cost Matrix, so they belong behind one door.
 *
 * THE OTHER TWO TABS ARE DATED, AND THIS ONE IS MONTHLY. That is not an
 * inconsistency to be tidied away: the excavation plan has no grain finer
 * than a month by the mine's own decision, and the other two apply from the
 * day they are made. Each tab therefore carries its own period control rather
 * than sharing one that would have to lie to half of them.
 *
 * WHY STORED AND EFFECTIVE ARE DRAWN DIFFERENTLY. An unentered month opens
 * pre-filled with last month's assignment, which is what the LCM is using. If
 * that looked identical to an entered month, somebody would close this screen
 * believing they had already done the thing they had not done — so a carried
 * value is shown as a suggestion, with the month it came from, until saved.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

type Material = "ORE" | "OB";

interface Machine {
  id: number;
  equipment_name: string;
  category: "OWN" | "HIRED";
  status: string;
  stored: Material | null;
  effective: Material | null;
  carried_from: string | null;
  entry_id: string | null;
  entry_date: string | null;
  revision: number | null;
}

interface MonthRead {
  month: string;
  month_entered: boolean;
  /** 0 = never entered, 1 = entered once, 2+ = entered and since revised. */
  revision: number;
  carried_from: string | null;
  unassigned: string[];
  machines: Machine[];
}

interface Edit {
  plan_month: string;
  equipment_name: string;
  action: "ADDED" | "CHANGED" | "REMOVED";
  old_material: Material | null;
  new_material: Material | null;
  revision: number;
  entry_id: string;
  entry_date: string | null;
}

function currentYM() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

function monthLabel(iso: string | null): string {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** When an edit was made, to the minute. A revision trail without a time on it
 *  cannot be lined up against the day an LCM was published, which is the only
 *  question anybody brings to it. */
function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function EquipmentPlanModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const now = currentYM();
  const [year, setYear] = useState(now.y);
  const [month, setMonth] = useState(now.m);
  const [picked, setPicked] = useState<Record<string, Material>>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [tab, setTab] = useState<"plan" | "status" | "lcm">("plan");

  useEffect(() => {
    if (!open) return;
    const ym = currentYM();
    setYear(ym.y); setMonth(ym.m); setTab("plan");
  }, [open]);

  useEffect(() => {
    setPicked({}); setProblems([]); setError(null); setDone(null);
    setShowHistory(false);
  }, [year, month, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const q = useQuery<MonthRead>({
    queryKey: ["equipment-plan", year, month],
    queryFn: async () =>
      (await api.get("/equipment-plan", { params: { year, month } })).data,
    enabled: open && tab === "plan",
    staleTime: 10 * 1000,
  });

  const machines = useMemo(() => q.data?.machines ?? [], [q.data]);
  const revision = q.data?.revision ?? 0;

  /* The trail is fetched only when somebody opens it. It is the answer to a
     question asked occasionally — "who changed this, and from what" — and
     loading it with every month would make the common case pay for the rare
     one. */
  const hist = useQuery<{ history: Edit[] }>({
    queryKey: ["equipment-plan", "history", year, month],
    queryFn: async () =>
      (await api.get("/equipment-plan/history",
                     { params: { year, month } })).data,
    enabled: open && showHistory && revision > 0,
    staleTime: 10 * 1000,
  });

  /* What each row shows: an explicit click first, then what the server says is
     in force. `effective` already carries last month's answer, so an unentered
     month opens filled in rather than blank. */
  const valueOf = useCallback(
    (m: Machine): Material | null => picked[m.equipment_name] ?? m.effective,
    [picked]);

  const missing = machines.filter((m) => !valueOf(m)).map((m) => m.equipment_name);
  const complete = machines.length > 0 && missing.length === 0;

  const changes = useMemo(() => machines.filter((m) => {
    const v = valueOf(m);
    return v != null && v !== m.stored;
  }), [machines, valueOf]);

  async function save() {
    setBusy(true); setProblems([]); setError(null);
    try {
      const assignments = machines
        .map((m) => ({ equipment_name: m.equipment_name,
                       material_type: valueOf(m)! }))
        .filter((a) => a.material_type);
      const r = await api.post("/equipment-plan",
        { year, month, assignments });
      /* WHAT HAPPENED, NOT HOW MANY ROWS EXIST. "10 machines saved" after a
         one-machine correction reads as though ten things changed; the server
         returns the diff, so say that instead. */
      const d = r.data ?? {};
      const n = (d.added?.length ?? 0) + (d.changed?.length ?? 0)
              + (d.removed?.length ?? 0);
      setDone(
        n === 0
          ? "Nothing had changed — nothing was written."
          : d.revised
            ? `Revision ${d.revision} saved — ${n} machine${n === 1 ? "" : "s"} changed.`
            : `${MONTHS[month - 1]} ${year} saved — ${d.stored} machines.`);
      setPicked({});
      await q.refetch();
      if (showHistory) await hist.refetch();
      await onSaved();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail;
      if (d && typeof d === "object" && "problems" in d) {
        setProblems((d as { problems: string[] }).problems);
      } else {
        setError(typeof d === "string" ? d : "The month could not be saved.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const carriedFrom = q.data?.carried_from;
  const entered = q.data?.month_entered;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/45 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="OEE master selector"
    >
      <div
        className={"bg-white rounded-lg shadow-xl border border-border w-full my-auto "
          + (tab === "plan" ? "max-w-2xl" : "max-w-5xl")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── heading ──────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Pickaxe size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            OEE Master Selector
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── the three things the mine sets here ──────────────────────── */}
        {/* ONE DOOR, THREE DECISIONS. All three feed the OEE tables and the
            Lost Cost Matrix, and all three are the mine's to make rather than
            ours. Keeping them apart in the menu would have meant three places
            to look for "the thing that changed the number". */}
        <div className="px-4 pt-2 border-b border-border-light flex gap-1">
          {([
            ["plan",   "Excavation Plan"],
            ["status", "Equipment Status Selector"],
            ["lcm",    "LCM KAM Selector"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-current={tab === k ? "page" : undefined}
              className={"px-3 py-1.5 rounded-t text-[11px] font-condensed font-bold "
                + "tracking-widest uppercase transition-colors "
                + (tab === k
                  ? "bg-white text-navy border border-border-light border-b-white -mb-px"
                  : "text-txt-muted hover:text-navy hover:bg-bg-section")}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "status" && <EquipmentStatusSelector onSaved={onSaved} />}
        {tab === "lcm" && <LcmKamSelector onSaved={onSaved} />}

        {tab === "plan" && (<>

        {/* ── month ────────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-end gap-3 flex-wrap">
          <div>
            <label htmlFor="eqp-month"
              className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
              Month
            </label>
            <select
              id="eqp-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white"
            >
              {MONTHS.map((n, i) => (
                <option key={n} value={i + 1}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="eqp-year"
              className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
              Year
            </label>
            <select
              id="eqp-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white"
            >
              {[now.y - 1, now.y, now.y + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="ml-auto text-[11px] text-txt-muted">
            {q.isLoading ? "Loading…"
              : entered
                ? `${machines.filter((m) => m.stored).length} of ${machines.length} machines stored`
                : "Not entered yet"}
          </div>
        </div>

        {/* ── carried-forward notice ───────────────────────────────────── */}
        {!q.isLoading && !entered && carriedFrom && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
            <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-900 leading-relaxed">
              <strong>{MONTHS[month - 1]} {year} has not been entered.</strong>{" "}
              The LCM is using the {monthLabel(carriedFrom)} plan, shown below.
              Confirm or change it, then save to make it this month&rsquo;s own.
            </p>
          </div>
        )}

        {/* ── an entered month is editable, and says so ────────────────── */}
        {/* A saved month used to open looking finished, with nothing stating
            that it could still be corrected. The mine reassigns machines
            mid-month; the screen has to invite that rather than imply the
            month is closed. */}
        {!q.isLoading && entered && (
          <div className="px-4 py-2 border-b border-border-light bg-bg-soft/60
                          flex items-center gap-2 flex-wrap">
            <p className="text-[11px] text-txt-secondary leading-relaxed">
              {revision > 1
                ? <><strong>Revision {revision}.</strong>{" "}</>
                : <><strong>Entered.</strong>{" "}</>}
              Change any machine below and save — the previous assignment is
              kept, not overwritten.
            </p>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border
                         border-border bg-white text-[10px] font-condensed font-bold
                         uppercase tracking-widest text-navy hover:bg-bg-section
                         focus:outline-none focus:ring-1 focus:ring-navy"
              aria-expanded={showHistory}
            >
              <History size={11} />
              {showHistory ? "Hide changes" : "Change history"}
            </button>
          </div>
        )}

        {/* ── the trail ────────────────────────────────────────────────── */}
        {showHistory && entered && (
          <div className="px-4 py-2.5 border-b border-border-light bg-bg-section/40">
            {hist.isLoading ? (
              <p className="text-[11px] text-txt-muted">
                <Loader2 size={11} className="animate-spin inline mr-1.5" />
                Reading the trail…
              </p>
            ) : !hist.data?.history?.length ? (
              <p className="text-[11px] text-txt-muted">
                No edits recorded for this month.
              </p>
            ) : (
              <ul className="space-y-1">
                {hist.data.history.map((h) => (
                  <li key={`${h.entry_date}-${h.equipment_name}-${h.action}`}
                      className="text-[11px] font-mono text-txt-secondary
                                 flex items-baseline gap-2 flex-wrap">
                    <span className="text-txt-muted w-[42px] shrink-0">r{h.revision}</span>
                    <span className="font-bold text-navy w-[96px] shrink-0">
                      {h.equipment_name}
                    </span>
                    {/* BOTH VALUES, ALWAYS. Reading backwards from a published
                        figure is the whole point of the trail, and only the
                        old value answers "what was it then". */}
                    <span>
                      {h.action === "ADDED"   && <>set to <strong>{h.new_material}</strong></>}
                      {h.action === "CHANGED" && <>
                        <span className="line-through text-txt-muted">{h.old_material}</span>
                        {" → "}<strong>{h.new_material}</strong>
                      </>}
                      {h.action === "REMOVED" && <>
                        removed (was <span className="line-through text-txt-muted">{h.old_material}</span>)
                      </>}
                    </span>
                    <span className="ml-auto text-[10px] text-txt-muted">
                      {h.entry_id} · {stamp(h.entry_date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── the fleet ────────────────────────────────────────────────── */}
        <div className="px-4 py-3">
          {q.isLoading ? (
            <div className="py-10 text-center text-[12px] text-txt-muted">
              <Loader2 size={16} className="animate-spin inline mr-2" />
              Reading the fleet…
            </div>
          ) : machines.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-txt-muted">
              No active machines in the equipment master.
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-light">
                  <th className="text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary pb-1.5">
                    Excavator
                  </th>
                  <th className="text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary pb-1.5 w-[190px]">
                    Excavating
                  </th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => {
                  const v = valueOf(m);
                  const suggested = !m.stored && v != null;
                  return (
                    <tr key={m.equipment_name} className="border-b border-border-light/60">
                      <td className="py-2">
                        <span className="text-[12px] font-bold text-navy">
                          {m.equipment_name}
                        </span>
                        {m.category === "HIRED" && (
                          <span className="ml-1.5 px-1 py-px rounded bg-bg-section text-[9px] font-bold tracking-wider text-txt-muted align-middle">
                            HIRED
                          </span>
                        )}
                        {suggested && (
                          <span className="block text-[10px] text-amber-700">
                            from {monthLabel(m.carried_from)} — not saved for this month
                          </span>
                        )}
                        {/* AN UNSAVED EDIT NAMES WHAT IT REPLACES. Without
                            this the toggle just moves and the previous answer
                            is gone from the screen, so a mis-click is
                            invisible until it has already been written. */}
                        {m.stored && v !== m.stored && (
                          <span className="block text-[10px] text-navy">
                            was <span className="line-through">{m.stored}</span> —
                            not saved yet
                          </span>
                        )}
                        {m.stored && v === m.stored && m.entry_date && (
                          <span className="block text-[10px] text-txt-muted">
                            {m.revision && m.revision > 1 ? "changed" : "set"}{" "}
                            {stamp(m.entry_date)}
                            {m.entry_id ? ` by ${m.entry_id}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <div className="inline-flex rounded border border-border overflow-hidden">
                          {(["ORE", "OB"] as Material[]).map((opt) => {
                            const on = v === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setPicked((p) => ({
                                  ...p, [m.equipment_name]: opt }))}
                                className={[
                                  "px-4 py-1 text-[11px] font-bold tracking-wider transition-colors",
                                  on
                                    ? (opt === "ORE"
                                        ? "bg-navy text-white"
                                        : "bg-[#6b7280] text-white")
                                    : "bg-white text-txt-muted hover:bg-bg-section",
                                  suggested && on ? "opacity-70" : "",
                                ].join(" ")}
                                aria-pressed={on}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── why a partial month is refused ───────────────────────────── */}
        {!q.isLoading && missing.length > 0 && (
          <div className="px-4 pb-3">
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-900 leading-relaxed">
                <strong>{missing.join(", ")}</strong>{" "}
                {missing.length === 1 ? "has" : "have"} no assignment.
                Every machine needs one: a machine left out keeps its lost hours
                out of the LCM, which raises every multiplying factor and shifts
                the controllable share of the loss, with nothing on the page to
                show it.
              </p>
            </div>
          </div>
        )}

        {problems.length > 0 && (
          <div className="px-4 pb-3">
            <div className="rounded border border-danger/30 bg-danger/5 px-3 py-2">
              <p className="text-[11px] font-bold text-danger mb-1">
                The month was not saved.
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {problems.map((p) => (
                  <li key={p} className="text-[11px] text-danger">{p}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {error && (
          <div className="px-4 pb-3">
            <p className="text-[11px] text-danger">{error}</p>
          </div>
        )}

        {/* ── footer ───────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-t border-border-light bg-bg-soft flex items-center gap-3">
          <div className="text-[11px] text-txt-muted">
            {done != null ? (
              <span className="text-success font-semibold inline-flex items-center gap-1">
                <Check size={12} /> {done}
              </span>
            ) : changes.length > 0 ? (
              entered
                ? `${changes.length} machine${changes.length === 1 ? "" : "s"} to change`
                : `${changes.length} of ${machines.length} to be written`
            ) : entered ? (
              "Nothing to change"
            ) : ""}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-border text-[12px] font-semibold text-txt-secondary hover:bg-bg-section transition-colors"
            >
              Close
            </button>
            <button
              onClick={save}
              /* An entered month with nothing picked has nothing to write, so
                 the button says so by being disabled rather than by writing a
                 revision that changes nothing. */
              disabled={busy || !complete || (entered && changes.length === 0)}
              className="px-4 py-1.5 rounded bg-navy text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy/90 transition-colors inline-flex items-center gap-1.5"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {entered ? "Save changes" : `Save ${MONTHS[month - 1]}`}
            </button>
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}
