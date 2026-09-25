"use client";
/**
 * Where the Est Actual figures are entered.
 *
 * WHY A DIALOG RATHER THAN CELLS IN THE TABLE. The table is read by everyone
 * who opens the dashboard and written by one person once a morning. Inputs
 * sitting in it permanently invited a stray keystroke into a figure management
 * reads, and made a display table look like a form. Entry is a deliberate act:
 * open from the header menu, pick the day, type, submit.
 *
 * IT CHOOSES ITS OWN DAY. The date box opens on yesterday, which is the case
 * that matters every morning, but any past day can be picked — figures are
 * missed, and a day that was not entered on the day has to be enterable later.
 * Future dates are refused by the input and again by the server.
 *
 * IT FETCHES ITS OWN DATA. The plan, the despatch figure and anything already
 * saved all follow the selected date rather than the table behind it, so
 * changing the date re-reads all three. The rows themselves come from
 * buildRows() in lib/prevDay, the same function the table uses, so the plan
 * shown while typing is exactly the plan the variance will be measured against.
 *
 * ONE REQUEST, ALL OR NOTHING. Submitting sends the whole day together, so a
 * failure leaves the stored row exactly as it was. Saving figure by figure
 * could leave a half-recorded day behind a dropped connection, which is worse
 * than saving nothing because it looks complete.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Save, Loader2, AlertTriangle, PencilLine } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { buildRows, dayLabel, todayISO, type KpiRow } from "@/lib/prevDay";
import type { ProductionDaywiseResponse, DespatchDaywiseResponse } from "@/types";

export interface StoredValue {
  value: number;
  plan: number | null;
  entered_by: string;
  entered_at: string | null;
}

/** Empty means "not stated", which clears the stored row — deliberately not the
 *  same as 0, which asserts nothing was produced. */
function parseCell(raw: string): { ok: boolean; value: number | null } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: null };
  return { ok: true, value: n };
}

export default function PrevDayEntryModal({
  open, onClose, defaultDay, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Where the date box starts — yesterday, from the table. */
  defaultDay: string;
  /** Called with the day that was saved, so the caller can refresh if it is
   *  showing that day. */
  onSaved: (day: string) => void | Promise<void>;
}) {
  const [day, setDay] = useState(defaultDay);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxDay = todayISO();

  // Reopen on the default day rather than wherever it was left. A dialog that
  // remembers a date somebody picked last week is how a figure ends up against
  // the wrong day.
  useEffect(() => {
    if (!open) return;
    setDay(defaultDay);
    setError(null);
  }, [open, defaultDay]);

  const enabled = open && Boolean(day);

  const prod = useQuery<ProductionDaywiseResponse>({
    queryKey: ["prev-day", "production", day],
    queryFn: async () => (await api.get("/production/daywise", {
      params: { from_date: day, to_date: day },
    })).data,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  const desp = useQuery<DespatchDaywiseResponse>({
    queryKey: ["prev-day", "despatch", day],
    queryFn: async () => (await api.get("/despatch/daywise", {
      params: { from_date: day, to_date: day },
    })).data,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  const entries = useQuery<{ values: Record<string, StoredValue> }>({
    queryKey: ["prev-day", "entered", day],
    queryFn: async () => (await api.get("/prev-day-actual", {
      params: { on_date: day },
    })).data,
    enabled,
    staleTime: 30 * 1000,
  });

  const rows: KpiRow[] = useMemo(
    () => buildRows(
      prod.data?.rows?.find((r) => r.date === day),
      desp.data?.rows?.find((r) => r.date === day),
    ),
    [prod.data, desp.data, day],
  );

  const stored = entries.data?.values;
  const loading = prod.isFetching || desp.isFetching || entries.isFetching;

  // Seed the boxes from what is stored for the SELECTED day. Keyed on the day
  // as well as the data, so switching date replaces the draft rather than
  // carrying one day's typing onto another.
  useEffect(() => {
    if (!open || !stored) return;
    setDraft(Object.fromEntries(
      rows.filter((r) => r.manual)
        .map((r) => [r.key, stored[r.key] ? String(stored[r.key].value) : ""]),
    ));
    // rows is rebuilt per render; keying on the data behind it is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stored, day]);

  // Esc to close, and stop the page behind from scrolling while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const invalid = useMemo(
    () => Object.values(draft).some((v) => !parseCell(v).ok),
    [draft],
  );
  const futureDay = day > maxDay;

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = rows.map((r) => ({
        metric: r.key,
        // Despatch is not typed: its actual is the gate record, submitted with
        // the rest so the stored row is a complete record of the day.
        value: r.manual ? parseCell(draft[r.key] ?? "").value : r.actual,
        plan: r.plan,
      }));
      await api.put("/prev-day-actual", { on_date: day, entries: payload });
      await onSaved(day);
      onClose();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Could not save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [rows, draft, day, onSaved, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/45"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enter actuals"
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-border w-full max-w-xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2 shrink-0">
          <PencilLine size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Enter Actuals
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── which day ─────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-center gap-2 flex-wrap">
          <label htmlFor="prev-day-date" className="text-[11px] font-extrabold tracking-[.12em] text-txt-secondary uppercase">
            Date
          </label>
          <input
            id="prev-day-date"
            type="date"
            value={day}
            max={maxDay}
            onChange={(e) => setDay(e.target.value)}
            className="rounded border border-border bg-white px-2 py-1 text-[12px] font-mono text-navy
              focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
          <span className="text-[11px] text-txt-muted">{dayLabel(day)}</span>
          {loading && <Loader2 size={12} className="animate-spin text-txt-light" />}
          {futureDay && (
            <span className="text-[11px] font-semibold text-danger">
              Cannot record a future date
            </span>
          )}
        </div>

        <div className="px-4 py-3 overflow-y-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left text-[10px] font-extrabold tracking-[.12em] text-txt-secondary uppercase py-1.5">
                  Material
                </th>
                <th className="text-right text-[10px] font-extrabold tracking-[.12em] text-txt-secondary uppercase py-1.5">
                  Plan
                </th>
                <th className="text-right text-[10px] font-extrabold tracking-[.12em] text-txt-secondary uppercase py-1.5 pl-3">
                  Actual
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const parsed = parseCell(draft[r.key] ?? "");
                const entry = stored?.[r.key];
                return (
                  <tr key={r.key} className="border-b border-border-light/70">
                    <td className="py-2">
                      <div className="text-[12px] font-bold text-navy">{r.label}</div>
                      <div className="text-[10px] text-txt-light">
                        {r.unit}
                        {entry && <> · last by {entry.entered_by}</>}
                      </div>
                    </td>
                    <td className="py-2 text-right font-mono text-[13px] text-txt-muted">
                      {r.plan == null ? "—" : formatIndian(r.plan)}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      {r.manual ? (
                        <input
                          value={draft[r.key] ?? ""}
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`Actual for ${r.label}`}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                          className={`w-[120px] text-right font-mono text-[13px] rounded px-2 py-1.5
                            border bg-white transition-colors
                            ${!parsed.ok ? "border-danger text-danger"
                              : "border-border text-navy"}
                            focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30`}
                        />
                      ) : (
                        <span
                          className="inline-block w-[120px] font-mono text-[13px] text-txt-muted"
                          title="Read from the weighbridge gate record — not entered by hand"
                        >
                          {r.actual == null ? "—" : formatIndian(r.actual)}
                          <span className="ml-1 text-[9px] text-txt-light">auto</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="text-[10px] text-txt-light mt-3 leading-relaxed">
            Leave a box empty to record nothing for that material — that clears any
            figure already saved, and is not the same as entering 0. The plan shown
            is saved with each figure, so a variance keeps the plan it was agreed
            against even if the plan is revised later.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-border-light flex items-center justify-end gap-2 shrink-0 bg-bg-soft">
          {error && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-danger mr-auto">
              <AlertTriangle size={12} />
              {error}
            </span>
          )}
          {invalid && !error && (
            <span className="text-[11px] font-semibold text-danger mr-auto">
              Enter a number, or leave the box empty
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-border text-[12px] font-bold
              text-txt-secondary hover:bg-bg-section"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || invalid || futureDay || !day}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded text-[12px] font-bold
              bg-navy text-white shadow-sm transition-colors
              hover:bg-navy-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
