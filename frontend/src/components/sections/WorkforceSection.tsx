"use client";
/**
 * Workforce — who is working, when, and on what.
 *
 * The roster, leave, the calendar and the allocation engine are one screen
 * because they are one question asked four ways. Approving a leave changes the
 * roster; the roster decides who the engine may consider; the calendar overrides
 * both. Split across four pages, somebody approves leave on Tuesday and
 * discovers on Thursday that the shift is short.
 *
 * The day strip at the top is always on, whichever tab is open, because every
 * one of these decisions is made against the same question: does today still
 * have enough people on it.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  CalendarRange, Plane, CalendarDays, Repeat, Sparkles, Users, Loader2,
  Sun, Moon, CircleSlash,
} from "lucide-react";
import { useAuth } from "@/contexts/useAuth";
import api from "@/lib/api";
import { Card, Chip, PageHeader, Tabs, type Tone } from "@/components/minehub/ui";
import RosterBoard from "@/components/workforce/RosterBoard";
import LeaveDesk from "@/components/workforce/LeaveDesk";
import HolidayCalendar from "@/components/workforce/HolidayCalendar";
import PatternStudio from "@/components/workforce/PatternStudio";
import AllocationEngine from "@/components/workforce/AllocationEngine";
import OperatorDashboard from "@/components/workforce/OperatorDashboard";

type TabId = "roster" | "leave" | "calendar" | "patterns" | "allocate";

const TABS: { id: TabId; label: string; icon: React.ElementType; tone: Tone; hint: string }[] = [
  { id: "roster", label: "Roster", icon: CalendarRange, tone: "violet",
    hint: "Who is on duty, resting, away or on nobody's list" },
  { id: "allocate", label: "Allocate", icon: Sparkles, tone: "emerald",
    hint: "Machines matched to operators by skill, availability and fairness" },
  { id: "leave", label: "Leave", icon: Plane, tone: "amber",
    hint: "Requests, decisions, and what they cost the roster" },
  { id: "calendar", label: "Calendar", icon: CalendarDays, tone: "sky",
    hint: "The days the mine closes, and the ones it works through" },
  { id: "patterns", label: "Patterns", icon: Repeat, tone: "navy",
    hint: "The cycles this mine works — six on one off, three-crew rotation" },
];

interface Coverage {
  day: string; on_duty: number; resting: number; on_leave: number;
  holiday: number; not_on_a_roster: number; headcount: number;
  by_shift: Record<string, number>;
}

interface ShiftRow {
  shift_instance_id: number; shift_code: string; shift_name: string;
  production_day: string; status: string;
}

export default function WorkforceSection() {
  const can = useAuth((s) => s.can);
  const mayView = can("ops.roster.view");
  const mayManage = can("ops.roster.manage");
  const mayApply = can("ops.leave.apply");
  const mayApprove = can("ops.leave.approve");
  const mayDeploy = can("ops.shift.manage");

  const [tab, setTab] = useState<TabId>("roster");
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [shift, setShift] = useState<number | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        api.get("/workforce/coverage"),
        // The shift list is the operating chain's, not a second one: an
        // allocation belongs to the same shift the board is running.
        api.get("/ops/shifts").catch(() => ({ data: [] })),
      ]);
      setCoverage(c.data);
      const rows: ShiftRow[] = s.data ?? [];
      setShifts(rows);
      setShift((was) => was ?? rows.find((r) => r.status === "OPEN")?.shift_instance_id
                             ?? rows[0]?.shift_instance_id ?? null);
    } catch { /* the panels say their own piece */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (mayView) void load(); }, [mayView, load]);

  if (!mayView) {
    return (
      <div className="py-6 max-w-[1500px]">
        <Card><div className="px-5 py-12 text-center text-[13px] text-txt-muted">
          The roster says where people will be on days they have not worked yet,
          so it sits behind its own permission. An Access Manager can add{" "}
          <code>ops.roster.view</code> to your role.
        </div></Card>
      </div>
    );
  }

  const active = TABS.find((t) => t.id === tab);
  const short = coverage && coverage.not_on_a_roster > 0;

  return (
    <div className="py-6 max-w-[1500px] space-y-4">
      <PageHeader
        lead="Workforce" rest="Planning" icon={Users} tone="violet"
        subtitle={active?.hint} tuck
      />

      {/* The day, on every tab. Every decision here is made against it. */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3
                      flex flex-wrap items-center gap-x-5 gap-y-2">
        {loading ? (
          <span className="text-[12px] text-txt-light inline-flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading today&apos;s roster…
          </span>
        ) : coverage ? (
          <>
            <span className="text-[12px] font-bold uppercase tracking-wide text-txt-light">
              Today
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sun className="w-4 h-4 text-emerald" />
              <span className="text-[17px] font-bold text-navy tabular-nums">
                {coverage.on_duty}
              </span>
              <span className="text-[12px] text-txt-muted">on duty</span>
            </span>
            {Object.entries(coverage.by_shift).map(([code, n]) => (
              <Chip key={code} tone="sky" dot={false}>{code} · {n}</Chip>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <Moon className="w-4 h-4 text-txt-light" />
              <span className="text-[13px] font-semibold text-txt-muted tabular-nums">
                {coverage.resting}
              </span>
              <span className="text-[12px] text-txt-light">resting</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Plane className="w-4 h-4 text-amber" />
              <span className="text-[13px] font-semibold text-amber tabular-nums">
                {coverage.on_leave}
              </span>
              <span className="text-[12px] text-txt-light">on leave</span>
            </span>
            {coverage.holiday > 0 && (
              <Chip tone="violet">Mine closed today</Chip>
            )}
            {short && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-rose">
                <CircleSlash className="w-4 h-4" />
                <strong>{coverage.not_on_a_roster}</strong> people are on no roster at all
              </span>
            )}
          </>
        ) : (
          <span className="text-[12px] text-txt-light">
            Today&apos;s roster could not be read.
          </span>
        )}
      </div>

      {tab === "allocate" && shifts.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5
                        flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-txt-light">
            Allocating for
          </span>
          {shifts.slice(0, 8).map((s) => (
            <button key={s.shift_instance_id} onClick={() => setShift(s.shift_instance_id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold border transition
                ${shift === s.shift_instance_id
                  ? "bg-navy text-white border-navy"
                  : "bg-white text-txt-muted border-slate-200 hover:bg-slate-50"}`}>
              {s.shift_code} · {s.production_day.slice(5)}
              {s.status === "OPEN" && <span className="ml-1 text-emerald">●</span>}
            </button>
          ))}
        </div>
      )}

      <Tabs tabs={TABS} value={tab} onChange={(id) => setTab(id as TabId)} />

      {tab === "roster" && (
        <RosterBoard mayManage={mayManage} onChanged={load}
                     onOpenOperator={setViewing} />
      )}
      {tab === "allocate" && (
        <AllocationEngine shiftInstanceId={shift} mayDeploy={mayDeploy} onChanged={load}
                          onOpenOperator={setViewing} />
      )}
      {tab === "leave" && (
        <LeaveDesk mayApply={mayApply} mayApprove={mayApprove} mayManage={mayManage}
                   onChanged={load} onOpenOperator={setViewing} />
      )}
      {tab === "calendar" && <HolidayCalendar mayManage={mayManage} />}
      {tab === "patterns" && <PatternStudio mayManage={mayManage} onChanged={load} />}

      <OperatorDashboard operatorId={viewing} mayApply={mayApply}
                         onClose={() => setViewing(null)} onChanged={load} />
    </div>
  );
}
