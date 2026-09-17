"use client";
/**
 * MineHub Platform — the operational platform.
 *
 * Where the mine's own work lives: registering equipment, and the operational
 * modules built on top of it. Access administration is a separate screen —
 * that is an IT concern answered rarely, this is daily work.
 *
 * The primary action lives in the page header, not buried in a card, because on
 * the Equipment Registry the whole point of the screen is to add machines.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Cpu, Activity, LayoutGrid, Plus, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/useAuth";
import EquipmentPanel from "@/components/minehub/EquipmentPanel";
import ActivityPanel from "@/components/minehub/ActivityPanel";
import AlertsPanel from "@/components/minehub/AlertsPanel";
import { Button, Card, CardHeader, Chip, PageHeader, Tabs, type Tone } from "@/components/minehub/ui";
import api from "@/lib/api";

type TabId = "equipment" | "alerts" | "activity" | "modules";

const TABS: { id: TabId; label: string; icon: React.ElementType; tone: Tone; hint: string }[] = [
  { id: "equipment", label: "Equipment Registry", icon: Cpu, tone: "sky",
    hint: "One identity per machine, across telematics, handover, weighbridge and RFID" },
  { id: "alerts", label: "Alerts", icon: AlertTriangle, tone: "rose",
    hint: "Documents expiring and services falling due" },
  { id: "activity", label: "Activity", icon: Activity, tone: "violet",
    hint: "Everything recorded on the platform, as it happens" },
  { id: "modules", label: "Modules", icon: LayoutGrid, tone: "teal",
    hint: "What is built, and what comes next" },
];

const ROADMAP: { phase: string; status: "live" | "next" | "planned"; items: string[] }[] = [
  { phase: "Registry", status: "live",
    items: ["Equipment register", "System identity mapping", "Compliance & maintenance", "Activity log"] },
  { phase: "People", status: "next",
    items: ["Operator register", "Competency and licence expiry", "Contractor workforce"] },
  { phase: "Deployment", status: "planned",
    items: ["One handover replacing nine forms", "Shift deployment plan", "Attendance link"] },
  { phase: "Operations", status: "planned",
    items: ["Production from the weighbridge", "Utilisation and OEE", "Fuel reconciliation"] },
  { phase: "Planning", status: "planned",
    items: ["Work orders", "Plan versus actual", "Capacity gap and loss attribution"] },
];

const STATUS_TONE = { live: "emerald", next: "amber", planned: "slate" } as const;

export default function MineHubSection() {
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<TabId>("equipment");
  const [addOpen, setAddOpen] = useState(false);
  // While the sheet is open, "Register machine" would start a second one over
  // the top of what is being filled in.
  const [formOpen, setFormOpen] = useState(false);
  const [alertCount, setAlertCount] = useState<number | null>(null);

  const mayView = can("platform.registry.view");
  const mayManage = can("platform.registry.manage");
  const active = useMemo(() => TABS.find((t) => t.id === tab), [tab]);

  const loadAlerts = useCallback(async () => {
    try {
      const r = await api.get("/minehub/alerts");
      setAlertCount((r.data ?? []).length);
    } catch { setAlertCount(null); }
  }, []);

  useEffect(() => { if (mayView) void loadAlerts(); }, [mayView, loadAlerts]);
  useEffect(() => { if (!mayView) setTab("modules"); }, [mayView]);

  const tabsWithCount = TABS.map((t) =>
    t.id === "alerts" && alertCount ? { ...t, label: `Alerts · ${alertCount}` } : t);

  // With the sheet open, the platform banner and the tab strip are a hundred
  // vertical pixels describing where you already are, pushing the fields that
  // are actually being filled in below the fold. The sheet carries its own
  // "Back to registry", so nothing is lost by standing them down.
  return (
    <div className={`py-6 space-y-5 ${formOpen ? "max-w-[1600px]" : "max-w-[1500px]"}`}>
      {!formOpen && <PageHeader
        lead="MineHub" rest="Platform" tone="gold" icon={Boxes}
        subtitle={active?.hint}
        actions={
          <>
            {tab === "equipment" && mayManage && !formOpen && (
              <Button variant="primary" size="lg" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4" /> Register machine
              </Button>
            )}
            {alertCount ? (
              <Button variant="secondary" size="lg" onClick={() => setTab("alerts")}>
                <AlertTriangle className="w-4 h-4 text-rose" />
                {alertCount} alert{alertCount === 1 ? "" : "s"}
              </Button>
            ) : null}
          </>
        }
      />}

      {mayView && !formOpen && (
        <Tabs tabs={tabsWithCount} value={tab} onChange={(id) => setTab(id as TabId)} />
      )}

      {!mayView && (
        <Card><div className="px-5 py-12 text-center text-[13px] text-txt-muted">
          You do not have permission to open the platform registry.
        </div></Card>
      )}

      {mayView && tab === "equipment" && (
        <EquipmentPanel addOpen={addOpen} onAddOpenChange={setAddOpen}
          onFormOpenChange={setFormOpen} onChanged={loadAlerts} />
      )}
      {mayView && tab === "alerts" && <AlertsPanel onChanged={loadAlerts} />}
      {mayView && tab === "activity" && <ActivityPanel />}
      {mayView && tab === "modules" && (
        <Card tone="teal">
          <CardHeader title="Platform modules" icon={LayoutGrid} tone="teal"
            subtitle="Where the build actually stands. Each phase is usable on its own — nothing here exists only to enable the next." />
          <div className="divide-y divide-border-light">
            {ROADMAP.map((r) => (
              <div key={r.phase} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Chip tone={STATUS_TONE[r.status]}>{r.status}</Chip>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[13.5px] text-navy">{r.phase}</div>
                  <div className="text-[12px] text-txt-muted mt-0.5">{r.items.join(" · ")}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
