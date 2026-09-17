"use client";
/**
 * Where the hours went, and what stopped the work.
 *
 * Every figure here is counted from events recorded for their own reasons — a
 * deployment that started and ended, a hold that was opened and released. None
 * of it is a separately maintained statistic, because a statistic maintained
 * separately is one that disagrees with the thing it describes.
 *
 * Lost hours are shown by reason rather than as a total. "Eighteen hours down"
 * is not actionable; eleven of them waiting for an operator is a rostering
 * problem, and the same eleven under breakdown is a maintenance one.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  BarChart3, Loader2, Clock, Wrench, ArrowLeftRight, AlertTriangle, TrendingDown, Gauge,
} from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, Chip, Tile, type Tone } from "@/components/minehub/ui";
import { MACHINE_STATE, EXCEPTION_LABEL, SEVERITY } from "./state";

interface Analysis {
  window_days: number;
  fleet: { active: number; total: number };
  work: Record<string, number>;
  lost_hours: { state: string; occurrences: number; hours: number; still_open: number }[];
  absence: { state: string; occurrences: number; people: number }[];
  handover: Record<string, number>;
  exceptions: { kind: string; severity: string; raised: number; still_open: number;
                avg_hours_to_resolve: number }[];
  worst_machines: { fleet_code: string; nickname: string | null; asset_type: string | null;
                    holds: number; hours: number }[];
  shifts: Record<string, number>;
  readiness_now: Record<string, number>;
  top_blockers: { reason: string; machines: number }[];
}

const WINDOWS = [7, 30, 90] as const;

export default function ShiftAnalysis() {
  const [data, setData] = useState<Analysis | null>(null);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/ops/analysis", { params: { days } });
      setData(r.data);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }
  if (!data) {
    return <Card><div className="px-5 py-12 text-center text-[13px] text-txt-muted">
      Nothing to analyse yet.
    </div></Card>;
  }

  const lostTotal = data.lost_hours.reduce((sum, r) => sum + Number(r.hours), 0);
  const maxLost = Math.max(...data.lost_hours.map((r) => Number(r.hours)), 1);
  const ready = data.readiness_now;
  const readyTotal = Object.values(ready).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-txt-muted max-w-2xl">
          Counted from what the shift recorded — deployments, holds, handovers,
          exceptions. Nothing here is typed in separately, so nothing here can
          disagree with the shift it describes.
        </p>
        <div className="flex gap-1 p-1 bg-bg-section rounded-xl">
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setDays(w)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors
                ${days === w ? "bg-bg-base text-navy shadow-sm" : "text-txt-muted hover:text-navy"}`}>
              {w} days
            </button>
          ))}
        </div>
      </div>

      {/* Now */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Fleet" value={data.fleet.active ?? 0} tone="sky" icon={Gauge}
              hint={`of ${data.fleet.total ?? 0} on the register`} />
        <Tile label="Deployments" value={data.work.deployments ?? 0} tone="violet" icon={Clock}
              hint={`${Number(data.work.meter_hours ?? 0).toFixed(0)} metered hours`} />
        <Tile label="Lost hours" value={lostTotal.toFixed(0)}
              tone={lostTotal > 0 ? "rose" : "emerald"} icon={TrendingDown}
              hint={data.lost_hours[0] ? `most: ${data.lost_hours[0].state.replace("_", " ").toLowerCase()}` : "none recorded"} />
        <Tile label="Handovers" value={data.handover.total ?? 0} tone="teal" icon={ArrowLeftRight}
              hint={`${data.handover.blocked ?? 0} blocked · ${Number(data.handover.avg_minutes ?? 0).toFixed(0)} min average`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Readiness right now */}
        <Card tone="sky">
          <CardHeader title="Readiness, right now" icon={BarChart3} tone="sky"
            subtitle="Derived when asked, so this is a photograph rather than a record — it is true at the moment you look." />
          <div className="p-5 space-y-3">
            <div className="flex h-3 rounded-full overflow-hidden bg-bg-section">
              {([["READY", "bg-emerald"], ["READY_WITH_WARNING", "bg-amber"], ["BLOCKED", "bg-rose"]] as const)
                .map(([key, colour]) => (
                  <div key={key} className={colour}
                    style={{ width: `${((ready[key] ?? 0) / readyTotal) * 100}%` }} />
                ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {([["Ready", ready.READY ?? 0, "text-emerald"],
                 ["With notes", ready.READY_WITH_WARNING ?? 0, "text-amber"],
                 ["Blocked", ready.BLOCKED ?? 0, "text-rose"]] as const).map(([label, value, tone]) => (
                <div key={label}>
                  <div className={`text-[22px] font-extrabold tabular-nums ${tone}`}>{value}</div>
                  <div className="text-[10.5px] uppercase tracking-[.08em] text-txt-light">{label}</div>
                </div>
              ))}
            </div>

            {data.top_blockers.length > 0 && (
              <div className="pt-1">
                <div className="text-[11px] font-bold uppercase tracking-[.08em] text-txt-light mb-1.5">
                  What is blocking them
                </div>
                <ul className="space-y-1">
                  {data.top_blockers.map((b) => (
                    <li key={b.reason} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="text-txt-secondary min-w-0 truncate">{b.reason}</span>
                      <Chip tone="rose" dot={false}>{b.machines}</Chip>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>

        {/* Lost hours by reason */}
        <Card tone="rose">
          <CardHeader title="Lost hours, by reason" icon={TrendingDown} tone="rose"
            subtitle="A total tells nobody what to do. The reason is the part somebody can act on." />
          <div className="p-5">
            {data.lost_hours.length === 0 ? (
              <p className="text-[12.5px] text-txt-muted py-6 text-center">
                No holds recorded in this window. Either nothing went down, or nothing
                was written down — the second is worth checking.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {data.lost_hours.map((r) => {
                  const look = MACHINE_STATE[r.state];
                  return (
                    <li key={r.state}>
                      <div className="flex items-center justify-between gap-2 text-[12.5px] mb-1">
                        <span className="font-medium text-txt-primary">
                          {look?.label ?? r.state.replace("_", " ")}
                          {r.still_open > 0 && (
                            <span className="text-[11px] text-rose font-semibold ml-1.5">
                              {r.still_open} still open
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums text-txt-muted">
                          {Number(r.hours).toFixed(1)} h · {r.occurrences}×
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-bg-section overflow-hidden">
                        <div className="h-full bg-rose/70"
                          style={{ width: `${(Number(r.hours) / maxLost) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* The machines that cost the most */}
        <Card tone="violet">
          <CardHeader title="Machines costing the most time" icon={Wrench} tone="violet"
            subtitle="Not always the ones that break most often — a long repair costs more than three short ones." />
          {data.worst_machines.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
              Nothing has been held in this window.
            </div>
          ) : (
            <ul className="divide-y divide-border-light">
              {data.worst_machines.map((m) => (
                <li key={m.fleet_code} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-semibold text-navy text-[13px]">
                      {m.nickname || m.fleet_code}
                    </span>
                    <span className="block text-[11px] text-txt-light">
                      {m.fleet_code}{m.asset_type ? ` · ${m.asset_type}` : ""} · {m.holds} hold(s)
                    </span>
                  </span>
                  <Chip tone="violet" dot={false}>{Number(m.hours).toFixed(1)} h</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Exceptions */}
        <Card tone="amber">
          <CardHeader title="What keeps stopping work" icon={AlertTriangle} tone="amber"
            subtitle="Raised, still open, and how long they take to close. A kind that recurs is a process problem, not an incident." />
          {data.exceptions.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-txt-muted">
              No exceptions raised in this window.
            </div>
          ) : (
            <ul className="divide-y divide-border-light">
              {data.exceptions.map((e) => (
                <li key={`${e.kind}-${e.severity}`}
                    className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="inline-flex items-center gap-2">
                      <Chip tone={SEVERITY[e.severity] ?? "slate"} dot={false}>
                        {e.severity.toLowerCase()}
                      </Chip>
                      <span className="font-semibold text-navy text-[13px]">
                        {EXCEPTION_LABEL[e.kind] ?? e.kind}
                      </span>
                    </span>
                    <span className="block text-[11px] text-txt-light">
                      {e.raised} raised
                      {e.avg_hours_to_resolve > 0 && ` · ${Number(e.avg_hours_to_resolve).toFixed(1)} h to close`}
                    </span>
                  </span>
                  {e.still_open > 0
                    ? <Chip tone="rose">{e.still_open} open</Chip>
                    : <Chip tone="emerald" dot={false}>all closed</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Absence and handover quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card tone="teal">
          <CardHeader title="Workforce" icon={Clock} tone="teal"
            subtitle="Absence as recorded on the shift, not as reported afterwards." />
          <div className="p-5">
            {data.absence.length === 0 ? (
              <p className="text-[12.5px] text-txt-muted">
                Nothing recorded. Attendance is taken on the shift board.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.absence.map((a) => (
                  <li key={a.state} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="text-txt-secondary">{a.state.replace("_", " ").toLowerCase()}</span>
                    <span className="tabular-nums text-txt-muted">
                      {a.occurrences}× · {a.people} {a.people === 1 ? "person" : "people"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card tone="emerald">
          <CardHeader title="Handover quality" icon={ArrowLeftRight} tone="emerald"
            subtitle="A handover that is always instant is a handover nobody is doing." />
          <div className="p-5 grid grid-cols-2 gap-4">
            {([["Completed", data.handover.completed ?? 0, "text-emerald"],
               ["Blocked", data.handover.blocked ?? 0, "text-rose"],
               ["With defects", data.handover.with_defects ?? 0, "text-amber"],
               ["Average minutes", Number(data.handover.avg_minutes ?? 0).toFixed(0), "text-navy"],
              ] as const).map(([label, value, tone]) => (
              <div key={label}>
                <div className={`text-[24px] font-extrabold tabular-nums ${tone}`}>{value}</div>
                <div className="text-[11px] uppercase tracking-[.08em] text-txt-light">{label}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
