"use client";
/**
 * MineHub Platform — the operational platform.
 *
 * This is where the mine's own work lives: registering equipment, and the
 * operational modules and KPIs built on top of it. Access administration is a
 * separate screen on purpose — it is an IT concern answered rarely, while this
 * is day-to-day work done by the people running the mine.
 *
 * Every action here is recorded in the event log and shown under Activity, so
 * the platform accounts for itself as it is used rather than only when someone
 * goes looking.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Boxes, Cpu, Activity, LayoutGrid } from "lucide-react";
import { useAuth } from "@/contexts/useAuth";
import EquipmentPanel from "@/components/minehub/EquipmentPanel";
import ActivityPanel from "@/components/minehub/ActivityPanel";
import { Card, CardHeader } from "@/components/minehub/ui";

type TabId = "equipment" | "activity" | "modules";

const TABS: { id: TabId; label: string; icon: React.ElementType; hint: string }[] = [
  { id: "equipment", label: "Equipment Registry", icon: Cpu,
    hint: "One identity per machine, across telematics, handover, weighbridge and RFID" },
  { id: "activity", label: "Activity", icon: Activity,
    hint: "Everything recorded on the platform, as it happens" },
  { id: "modules", label: "Modules", icon: LayoutGrid,
    hint: "What is built, and what comes next" },
];

/** The build order from the platform blueprint, so the screen states where the
 *  work actually stands rather than implying more exists than does. */
const ROADMAP = [
  { phase: "Registry", status: "live",
    items: ["Equipment register", "System identity mapping", "Activity log"] },
  { phase: "People", status: "next",
    items: ["Operator register", "Competency and licence expiry", "Contractor workforce"] },
  { phase: "Deployment", status: "planned",
    items: ["One handover replacing nine forms", "Shift deployment plan", "Attendance link"] },
  { phase: "Operations", status: "planned",
    items: ["Production from the weighbridge", "Utilisation and OEE", "Fuel reconciliation"] },
  { phase: "Planning", status: "planned",
    items: ["Work orders", "Plan versus actual", "Capacity gap and loss attribution"] },
];

const STATUS_STYLE: Record<string, string> = {
  live:    "bg-success-bg text-success border-success/25",
  next:    "bg-gold/10 text-gold-dark border-gold/30",
  planned: "bg-bg-section text-txt-muted border-border",
};

export default function MineHubSection() {
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<TabId>("equipment");

  const mayView = can("platform.registry.view");
  const active = useMemo(() => TABS.find((t) => t.id === tab), [tab]);

  useEffect(() => { if (!mayView) setTab("modules"); }, [mayView]);

  return (
    <div className="py-5 space-y-5 max-w-[1500px]">
      <div className="rounded-lg bg-gradient-to-r from-navy-2 to-steel border border-gold/25 px-5 py-4 shadow-md">
        <div className="flex items-center gap-3">
          <Boxes className="w-5 h-5 text-gold-light shrink-0" />
          <div>
            <h1 className="font-condensed font-bold text-[18px] tracking-wide text-white uppercase">
              MineHub Platform
            </h1>
            <p className="text-white/60 text-[12px] mt-0.5">{active?.hint}</p>
          </div>
        </div>
      </div>

      {mayView && (
        <div className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = t.id === tab;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 font-condensed text-[13px] font-bold
                            uppercase tracking-wide border-b-2 -mb-px transition-colors
                            ${on ? "border-gold text-navy"
                                 : "border-transparent text-txt-muted hover:text-navy"}`}>
                <Icon className={`w-4 h-4 ${on ? "text-gold" : "text-txt-light"}`} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {!mayView && (
        <p className="text-[13px] text-txt-muted py-10 text-center">
          You do not have permission to open the platform registry.
        </p>
      )}

      {mayView && tab === "equipment" && <EquipmentPanel />}
      {mayView && tab === "activity" && <ActivityPanel />}
      {mayView && tab === "modules" && (
        <Card>
          <CardHeader title="Platform modules"
            subtitle="Where the build actually stands. Each phase is usable on its own — nothing here exists only to enable the next." />
          <div className="p-4 space-y-3">
            {ROADMAP.map((r) => (
              <div key={r.phase} className="flex flex-wrap items-start gap-3 py-2 border-b border-border-light last:border-0">
                <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold shrink-0 ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
                <div className="min-w-0">
                  <div className="font-condensed font-bold text-[14px] uppercase tracking-wide text-navy">
                    {r.phase}
                  </div>
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
