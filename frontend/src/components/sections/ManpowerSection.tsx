"use client";
/**
 * Manpower — the people side of the mine, on its own screen.
 *
 * It was a tab inside MineHub Platform, wedged between the equipment register
 * and the machine alerts. That made sense when the operator register held
 * eleven people and existed mainly so a machine could be handed to somebody.
 * It holds 211 now, covering tipper drivers, fitters, welders, a time keeper
 * and a gardener, and most of the questions asked of it — how many, of what
 * trade, how old, how long served, who is cleared for what — have nothing to
 * do with any particular machine.
 *
 * Three tabs, because there are three jobs:
 *
 *   REGISTER    who is on strength, and the record behind each of them.
 *   ASSESSMENT  who is cleared to run what, who is overdue, who has never
 *               been looked at. Its own screen rather than a button on a row,
 *               because assessing is a morning's work for one person and a row
 *               at a time is the wrong shape for it.
 *   ANALYTICS   the shape of the workforce, and the gaps in it.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Grid3x3, HardHat, Plus, ShieldCheck, Users } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Button, Card, PageHeader, Tabs, type Tone } from "@/components/minehub/ui";
import OperatorPanel from "@/components/minehub/OperatorPanel";
import AssessmentPanel from "@/components/minehub/AssessmentPanel";
import ManpowerAnalytics from "@/components/minehub/ManpowerAnalytics";

type TabId = "register" | "capability" | "assessment" | "analytics";

const TABS: { id: TabId; label: string; icon: React.ElementType; tone: Tone; hint: string }[] = [
  { id: "register", label: "Register", icon: Users, tone: "emerald",
    hint: "Everyone on strength at the mine, whatever they do — operators, trades, supervision and support." },
  // Lifted out of the register, which had its own Register/Capability switcher
  // directly beneath this strip — two tab bars, both starting with the word
  // Register, one inside the other.
  { id: "capability", label: "Capability", icon: Grid3x3, tone: "indigo",
    hint: "The grid: every person against every machine class, and the level they hold on each." },
  { id: "assessment", label: "Assessment", icon: ShieldCheck, tone: "violet",
    hint: "Who is cleared to run what, who is overdue, and who has never been assessed at all." },
  { id: "analytics", label: "Analytics", icon: BarChart3, tone: "sky",
    hint: "The shape of the workforce — trade, age, service, coverage — and where the gaps are." },
];

export default function ManpowerSection() {
  const can = useAuth((s) => s.can);
  const mayManage = can("platform.operators.manage");

  const [tab, setTab] = useState<TabId>("register");
  const [addOpen, setAddOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  // Bumped whenever something is written, so a tab that was not on screen at
  // the time reloads when you next open it rather than showing yesterday.
  const [changed, setChanged] = useState(0);
  const [overdue, setOverdue] = useState<number | null>(null);

  const active = useMemo(() => TABS.find((t) => t.id === tab), [tab]);

  const loadOverdue = useCallback(async () => {
    try {
      const r = await api.get("/operators/meta/due");
      setOverdue((r.data ?? []).filter((d: { days_left: number }) => d.days_left <= 0).length);
    } catch { setOverdue(null); }
  }, []);

  useEffect(() => { void loadOverdue(); }, [loadOverdue, changed]);

  const tabs = TABS.map((t) =>
    t.id === "assessment" && overdue ? { ...t, label: `Assessment · ${overdue}` } : t);

  // With a profile open, the banner and the tab strip are a hundred vertical
  // pixels telling you where you already are, pushing the fields being filled
  // in below the fold. The sheet carries its own way back.
  return (
    <div className={`py-6 space-y-5 ${formOpen ? "max-w-[1600px]" : "max-w-[1500px]"}`}>
      {!formOpen && (
        <PageHeader
          lead="Man" rest="power" joined tone="emerald" icon={HardHat}
          subtitle={active?.hint}
          actions={
            tab === "register" && mayManage ? (
              <Button variant="primary" size="lg" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4" /> Add a worker
              </Button>
            ) : null
          } />
      )}

      {!formOpen && (
        <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as TabId)} />
      )}

      {(tab === "register" || tab === "capability") && (
        <OperatorPanel view={tab} addOpen={addOpen} onAddOpenChange={setAddOpen}
          onFormOpenChange={setFormOpen}
          onChanged={() => setChanged((n) => n + 1)} />
      )}

      {tab === "assessment" && (
        <AssessmentPanel key={changed} onChanged={() => setChanged((n) => n + 1)} />
      )}

      {tab === "analytics" && <ManpowerAnalytics key={changed} />}

      {!mayManage && tab === "register" && (
        <Card>
          <p className="px-5 py-3 text-[12px] text-txt-muted">
            You can read the register but not change it. An Access Manager
            grants <code>platform.operators.manage</code>.
          </p>
        </Card>
      )}
    </div>
  );
}
