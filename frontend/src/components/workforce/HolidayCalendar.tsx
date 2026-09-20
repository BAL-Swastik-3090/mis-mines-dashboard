"use client";
/**
 * The year's calendar — the days the mine does not work, and the ones it does
 * anyway.
 *
 * A mine is not closed on every national holiday and is closed on days that are
 * nobody else's holiday, so each entry says what it actually means for work
 * rather than only naming the day. That distinction is the whole point: a
 * festival everybody still works through must not silently empty the roster.
 *
 * Laid out as twelve months rather than a list, because the question people
 * bring here — "how far is the next break" — is answered by looking, not by
 * reading dates.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "@/components/minehub/DateField";
import {
  CalendarDays, Plus, Loader2, Trash2, ChevronLeft, ChevronRight, PartyPopper,
} from "lucide-react";
import api from "@/lib/api";
import {
  Button, Card, CardHeader, Chip, Field, inputClass, Tile,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import { HOLIDAY_KIND, prettyDate, isoDay } from "./state";

interface Holiday {
  holiday_id: number; holiday_date: string; name: string;
  plant_id: number | null; plant_name: string | null;
  kind: string; stops_work: boolean; remarks: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

export default function HolidayCalendar({ mayManage }: { mayManage: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const [form, setForm] = useState({
    holiday_date: isoDay(new Date()), name: "", kind: "PUBLIC",
    stops_work: true, remarks: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/workforce/holidays", { params: { year } });
      setRows(r.data ?? []);
      setError(null);
    } catch {
      setError("The calendar could not be loaded.");
    } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  const byMonth = useMemo(() => {
    const out: Record<number, Holiday[]> = {};
    for (const h of rows) {
      const m = Number(String(h.holiday_date).slice(5, 7)) - 1;
      (out[m] ||= []).push(h);
    }
    return out;
  }, [rows]);

  const closures = rows.filter((h) => h.stops_work).length;
  const today = isoDay(new Date());
  const next = rows.find((h) => h.holiday_date >= today && h.stops_work);

  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api.post("/workforce/holidays", form);
      setAdding(false);
      setForm({ ...form, name: "", remarks: "" });
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That day could not be saved.");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.delete(`/workforce/holidays/${removing.holiday_id}`);
      setRemoving(null);
      await load();
    } catch { setError("That day could not be removed."); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile label="Days the mine closes" value={closures} icon={CalendarDays}
              tone="rose" hint={`In ${year}`} />
        <Tile label="Marked but still worked" value={rows.length - closures}
              icon={PartyPopper} tone="slate"
              hint="Restricted holidays and festivals" />
        <Tile label="Next closure" value={next ? prettyDate(next.holiday_date) : "—"}
              icon={CalendarDays} tone="violet" hint={next?.name ?? "Nothing ahead this year"} />
      </div>

      <Card>
        <CardHeader
          title={`Calendar ${year}`} icon={CalendarDays} tone="violet"
          subtitle="What each day means for work, not just what it is called"
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setYear(year - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setYear(year + 1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
              {mayManage && (
                <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add a day
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

        {loading ? (
          <div className="px-5 py-12 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-txt-light" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-txt-muted">
            Nothing is on the {year} calendar yet. Until a day is here, the roster
            treats it as an ordinary working day.
          </div>
        ) : (
          <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {MONTHS.map((month, i) => (
              <div key={month} className={`rounded-xl border p-3
                ${byMonth[i]?.length ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50/50"}`}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-txt-light mb-2">
                  {month}
                </p>
                {byMonth[i]?.length ? (
                  <div className="space-y-1.5">
                    {byMonth[i].map((h) => {
                      const look = HOLIDAY_KIND[h.kind] ?? HOLIDAY_KIND.PUBLIC;
                      return (
                        <div key={h.holiday_id} className="flex items-start gap-2 group">
                          <span className="w-7 shrink-0 text-[13px] font-bold text-navy tabular-nums">
                            {String(h.holiday_date).slice(8, 10)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-semibold text-navy truncate"
                                  title={h.name}>{h.name}</span>
                            <span className="flex items-center gap-1 mt-0.5">
                              <Chip tone={look.tone} dot={false}>{look.label}</Chip>
                              {!h.stops_work && (
                                <span className="text-[10px] text-txt-light">work continues</span>
                              )}
                            </span>
                          </span>
                          {mayManage && (
                            <button onClick={() => setRemoving(h)}
                              className="opacity-0 group-hover:opacity-100 text-txt-light
                                         hover:text-rose transition shrink-0">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-txt-light">Nothing marked</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={adding} tone="info" title="Add a day to the calendar"
        confirmLabel="Add it" busy={busy}
        onConfirm={() => void save()} onCancel={() => setAdding(false)}>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Date" required>
              <DateField className={inputClass} value={form.holiday_date} onChange={(v) => setForm({ ...form, holiday_date: v })} />
            </Field>
            <Field label="What it is" required>
              <input className={inputClass} value={form.name} placeholder="Republic Day"
                     onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          </div>
          <Field label="Kind">
            <select className={inputClass} value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(HOLIDAY_KIND).map(([key, look]) => (
                <option key={key} value={key}>{look.label}</option>
              ))}
            </select>
          </Field>
          <label className="flex items-start gap-2 text-[12px] text-txt-muted">
            <input type="checkbox" className="mt-0.5" checked={form.stops_work}
                   onChange={(e) => setForm({ ...form, stops_work: e.target.checked })} />
            <span>
              The mine stops on this day.
              <span className="block text-[11px] text-txt-light">
                Leave this off for a festival people mark but still come in for —
                otherwise the roster empties itself.
              </span>
            </span>
          </label>
          <Field label="Note">
            <input className={inputClass} value={form.remarks} placeholder="Optional"
                   onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
        </div>
      </Dialog>

      <Dialog open={Boolean(removing)} tone="danger" title="Remove this day"
        confirmLabel="Remove it" busy={busy}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}>
        {removing && (
          <>
            <strong>{removing.name}</strong> on {prettyDate(removing.holiday_date)} comes
            off the calendar, and the roster will treat it as an ordinary working day.
          </>
        )}
      </Dialog>
    </div>
  );
}
