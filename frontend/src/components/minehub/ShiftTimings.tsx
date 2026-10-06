"use client";
import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Card, CardHeader, Chip, inputClass } from "./ui";

/**
 * The hours A, B and C actually run, and a way to change them.
 *
 * They were set once by a migration and could only be changed in the
 * database. The mine runs different hours in summer and winter, so a figure
 * that moves with the season was the one figure nobody could move — and that
 * is how the same times end up hard-coded in three screens instead, each
 * drifting from the others.
 *
 * ONE DEFINITION. The roster reads these, the production day a load is
 * attributed to reads these, and the weighbridge reads them when it
 * pre-selects a shift. Changing them here changes all three, which is the
 * point and also the warning.
 */
interface Shift {
  shift_id: number; code: string; name: string;
  start_time: string; end_time: string;
  crosses_midnight: boolean; planned_hours: number | null;
  running_now: boolean;
}

export default function ShiftTimings({ mayEdit }: { mayEdit: boolean }) {
  const [rows, setRows] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** What is typed but not yet saved, per shift. */
  const [draft, setDraft] = useState<Record<number, { start: string; end: string }>>({});

  const load = useCallback(async () => {
    try {
      const r = await api.get("/operators/shifts");
      setRows(r.data ?? []);
      setDraft({});
    } catch {
      setError("Could not read the shift calendar.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (s: Shift) => {
    const d = draft[s.shift_id];
    if (!d) return;
    setBusy(s.shift_id); setError(null); setNote(null);
    try {
      const r = await api.put(`/operators/shifts/${s.shift_id}`,
                              { start_time: d.start, end_time: d.end });
      setNote(`${r.data.code} now runs ${r.data.start_time}–${r.data.end_time}`
              + ` (${r.data.planned_hours} hours).`);
      await load();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Could not change that shift.");
    } finally { setBusy(null); }
  };

  if (loading) {
    return <div className="flex justify-center py-16">
      <Loader2 className="w-5 h-5 animate-spin text-gold" /></div>;
  }

  return (
    <Card>
      <CardHeader
        title="Shift timings" icon={Clock} tone="sky"
        subtitle="The hours each shift runs. The roster, the production day a load is counted under, and the weighbridge all read these — change them here and all three follow."
      />
      {error && <div className="px-5 pt-3"><Alert tone="error">{error}</Alert></div>}
      {note && <div className="px-5 pt-3"><Alert tone="success">{note}</Alert></div>}

      <div className="p-5 space-y-2.5">
        {rows.map((s) => {
          const d = draft[s.shift_id] ?? { start: s.start_time, end: s.end_time };
          const changed = d.start !== s.start_time || d.end !== s.end_time;
          return (
            <div key={s.shift_id}
                 className={`flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1
                             ${s.running_now ? "bg-emerald-bg ring-emerald-ring"
                                             : "bg-bg-soft ring-border-light"}`}>
              <span className="w-[108px] shrink-0">
                <span className="block text-[13px] font-semibold text-navy">{s.code}</span>
                <span className="block text-[10.5px] text-txt-light">{s.name}</span>
              </span>

              <label className="flex items-center gap-1.5 text-[11px] text-txt-muted">
                from
                <input type="time" value={d.start} disabled={!mayEdit || busy === s.shift_id}
                       onChange={(e) => setDraft((o) => ({
                         ...o, [s.shift_id]: { ...d, start: e.target.value } }))}
                       className={`${inputClass} w-[104px] py-1 tabular-nums`} />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-txt-muted">
                to
                <input type="time" value={d.end} disabled={!mayEdit || busy === s.shift_id}
                       onChange={(e) => setDraft((o) => ({
                         ...o, [s.shift_id]: { ...d, end: e.target.value } }))}
                       className={`${inputClass} w-[104px] py-1 tabular-nums`} />
              </label>

              <span className="flex items-center gap-1.5">
                {s.running_now && <Chip tone="emerald" dot>running now</Chip>}
                {/* Worked out from the times, never asked for: a shift ending
                    at or before it starts runs through the night, and leaving
                    that to a tick box is leaving it to be ticked wrong. */}
                {s.crosses_midnight && <Chip tone="slate" dot={false}>through the night</Chip>}
                {s.planned_hours != null && (
                  <span className="text-[11px] text-txt-light tabular-nums">
                    {s.planned_hours}h
                  </span>
                )}
              </span>

              {mayEdit && changed && (
                <Button size="sm" onClick={() => void save(s)}
                        disabled={busy === s.shift_id} className="ml-auto">
                  {busy === s.shift_id ? "Saving…" : "Save"}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <p className="px-5 pb-5 text-[11px] text-txt-muted leading-relaxed">
        Changing a shift changes what every past figure is read against, not
        only future ones — a load weighed at 05:30 belongs to C today and to A
        tomorrow if A is moved to start at five. That is deliberate: these
        times describe the mine, not the rows. Every change is recorded with
        what it was before.
        {!mayEdit && " You can see these but not change them."}
      </p>
    </Card>
  );
}
