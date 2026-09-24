"use client";
/**
 * Shift Control — the operating chain, on one screen.
 *
 * Live fleet, shift board, handover and analysis are separate modules because
 * they are separate jobs, but they are not separate features: they read the
 * same state and the shift chosen at the top applies to all of them. A
 * deployment made on the fleet screen appears on the board because it is the
 * same deployment, not because two screens were kept in step.
 *
 * The shift bar is above the tabs for that reason. Almost nothing here means
 * anything without a shift — a handover belongs to one, a deployment belongs to
 * one — so choosing it is the first thing the screen asks and the last thing it
 * forgets.
 */
import MachineCover from "@/components/workforce/MachineCover";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Radar, Cpu, ClipboardList, ArrowLeftRight, BarChart3, Play, Loader2, CalendarClock,
  GitCompare, Truck,
} from "lucide-react";
import { useAuth } from "@/contexts/useAuth";
import api from "@/lib/api";
import { Button, Card, Chip, PageHeader, Tabs, type Tone } from "@/components/minehub/ui";
import LiveFleet from "@/components/ops/LiveFleet";
import ShiftBoard from "@/components/ops/ShiftBoard";
import HotoCentre from "@/components/ops/HotoCentre";
import Reconciliation from "@/components/ops/Reconciliation";
import ShiftAnalysis from "@/components/ops/ShiftAnalysis";

type TabId = "fleet" | "shift" | "cover" | "hoto" | "reconcile" | "analysis";

const TABS: { id: TabId; label: string; icon: React.ElementType; tone: Tone; hint: string }[] = [
  { id: "fleet", label: "Live Fleet", icon: Cpu, tone: "sky",
    hint: "Every machine, what it is doing, and what is stopping the rest" },
  { id: "shift", label: "Shift Board", icon: ClipboardList, tone: "violet",
    hint: "Attendance, shortages, deployments and what is blocking the shift" },
  // Beside the shift board rather than in Workforce Planning. It answers a
  // question asked while a shift is being filled — somebody has not turned up,
  // who else can take the machine — and that is this screen's work, not the
  // planner's. Workforce Planning decides who works which week; this decides
  // who is on which machine this morning.
  { id: "cover", label: "Who can run what", icon: Truck, tone: "teal",
    hint: "Every machine, who is cleared to run it, and who is free today" },
  { id: "hoto", label: "Handover", icon: ArrowLeftRight, tone: "amber",
    hint: "Transferring responsibility for a machine, with the inspection that goes with it" },
  { id: "reconcile", label: "Reconcile", icon: GitCompare, tone: "rose",
    hint: "What was planned, who was deployed, and what the machines actually did" },
  { id: "analysis", label: "Analysis", icon: BarChart3, tone: "emerald",
    hint: "Where the hours went, and what keeps stopping the work" },
];

interface ShiftRow {
  shift_instance_id: number; shift_id: number; shift_code: string; shift_name: string;
  production_day: string; status: string; plant: string | null;
  supervisor_emp_id: string | null; supervisor_name: string | null;
  start_time: string; end_time: string;
  planned: number; live: number; open_exceptions: number;
}

interface ShiftDefinition {
  shift_id: number; code: string; name: string; start_time: string; end_time: string;
}

export default function OperationsSection() {
  const can = useAuth((s) => s.can);
  const mayView = can("ops.shift.view");

  const [tab, setTab] = useState<TabId>("fleet");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [definitions, setDefinitions] = useState<ShiftDefinition[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [rights, setRights] = useState({ may_manage: false, may_hoto: false, may_override: false });
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [hotoToOpen, setHotoToOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, d, me] = await Promise.all([
        api.get("/ops/shifts"),
        api.get("/ops/shift-calendar"),
        api.get("/ops/meta/me"),
      ]);
      const rows: ShiftRow[] = s.data ?? [];
      setShifts(rows);
      setDefinitions(d.data ?? []);
      setRights({ may_manage: Boolean(me.data?.may_manage),
                  may_hoto: Boolean(me.data?.may_hoto),
                  may_override: Boolean(me.data?.may_override) });
      // Land on the shift that is actually running, which is what somebody
      // opening this screen almost always means.
      setCurrent((was) => was ?? rows.find((r) => r.status === "OPEN")?.shift_instance_id ?? null);
    } catch { /* the screens say their own piece */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (mayView) void load(); }, [mayView, load]);

  const shift = useMemo(
    () => shifts.find((s) => s.shift_instance_id === current) ?? null, [shifts, current]);

  const openShift = async (shiftId: number) => {
    setOpening(true);
    try {
      const r = await api.post("/ops/shifts", { shift_id: shiftId });
      await load();
      setCurrent(r.data.shift_instance_id);
      setTab("shift");
    } catch { /* surfaced by the board */ }
    finally { setOpening(false); }
  };

  if (!mayView) {
    return (
      <div className="py-6 max-w-[1500px]">
        <Card><div className="px-5 py-12 text-center text-[13px] text-txt-muted">
          Shift Control shows who is on which machine, so it sits behind its own
          permission. An Access Manager can add <code>ops.shift.view</code> to your role.
        </div></Card>
      </div>
    );
  }

  const active = TABS.find((t) => t.id === tab);
  const today = new Date().toLocaleDateString("en-IN",
    { weekday: "short", day: "2-digit", month: "short" });

  return (
    <div className="py-6 space-y-5 max-w-[1600px]">
      <PageHeader
        lead="Shift" rest="Control" tone="sky" icon={Radar}
        subtitle={active?.hint}
        actions={
          shift ? (
            <span className="inline-flex items-center gap-2">
              <Chip tone={shift.status === "OPEN" ? "emerald" : "slate"}>
                {shift.shift_code} · {shift.status.toLowerCase()}
              </Chip>
              {shift.open_exceptions > 0 && (
                <Button variant="secondary" size="lg" onClick={() => setTab("shift")}>
                  {shift.open_exceptions} to deal with
                </Button>
              )}
            </span>
          ) : null
        }
      />

      {/* The shift everything else hangs off */}
      <div className="rounded-xl border border-border-light bg-bg-base px-4 py-3
                      flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 text-[12.5px] text-txt-muted">
          <CalendarClock className="w-4 h-4 text-gold" />
          <span className="font-semibold text-navy">{today}</span>
        </span>

        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-gold" />
        ) : shifts.length === 0 ? (
          <span className="text-[12.5px] text-txt-muted">
            No shift today yet.
          </span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {shifts.map((s) => (
              <button key={s.shift_instance_id} onClick={() => setCurrent(s.shift_instance_id)}
                className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors
                  ${current === s.shift_instance_id
                    ? "bg-navy text-white border-navy"
                    : "bg-bg-base text-txt-muted border-border hover:border-navy hover:text-navy"}`}>
                {s.shift_code}
                <span className="opacity-70 font-normal ml-1.5">
                  {s.status === "OPEN" ? `${s.live} live` : s.status.toLowerCase()}
                </span>
              </button>
            ))}
          </span>
        )}

        {rights.may_manage && (
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] text-txt-light">Open</span>
            {definitions
              .filter((d) => !shifts.some((s) => s.shift_id === d.shift_id && s.status !== "CANCELLED"))
              .map((d) => (
                <Button key={d.shift_id} size="sm" variant="secondary" disabled={opening}
                  onClick={() => void openShift(d.shift_id)}>
                  <Play className="w-3.5 h-3.5" /> {d.code}
                </Button>
              ))}
            {definitions.every((d) => shifts.some((s) => s.shift_id === d.shift_id)) && (
              <span className="text-[11.5px] text-txt-light">all shifts started today</span>
            )}
          </span>
        )}
      </div>

      <Tabs tabs={TABS} value={tab} onChange={(id) => setTab(id as TabId)} />

      {tab === "fleet" && (
        <LiveFleet shiftInstanceId={current} rights={rights} onChanged={load}
          onHandover={(hotoId) => { setHotoToOpen(hotoId); setTab("hoto"); }} />
      )}
      {tab === "shift" && (
        <ShiftBoard shift={shift} shifts={shifts} onShiftChange={setCurrent}
          rights={rights} onChanged={load} />
      )}
      {tab === "cover" && <MachineCover />}
      {tab === "hoto" && (
        <HotoCentre openId={hotoToOpen} onOpened={() => setHotoToOpen(null)}
          rights={rights} onChanged={load} />
      )}
      {tab === "reconcile" && <Reconciliation rights={rights} onChanged={load} />}
      {tab === "analysis" && <ShiftAnalysis />}
    </div>
  );
}
