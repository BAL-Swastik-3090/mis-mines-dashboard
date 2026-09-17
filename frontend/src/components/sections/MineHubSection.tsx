"use client";
/**
 * MineHub Platform — one screen for everything the platform administers.
 *
 * Access and the registry were two sidebar entries, which made them look like
 * unrelated products. They are the same job: deciding who may do what, and
 * keeping the master data they act on. One entry, tabs inside — and the sidebar
 * lists those tabs as sub-items so nothing is hidden a click deep.
 *
 * Each tab is gated on a permission rather than a role name, so a role created
 * in the Roles tab immediately controls what its holders see here, with no code
 * change. That is the point of roles being data.
 */
import React, { useEffect, useMemo } from "react";
import { Boxes, Users, KeyRound, Cpu, History } from "lucide-react";
import { useAuth } from "@/contexts/useAuth";
import { useMineHubTab, type MineHubTab } from "@/contexts/useMineHubTab";
import UsersPanel from "@/components/minehub/UsersPanel";
import RolesPanel from "@/components/minehub/RolesPanel";
import AuditPanel from "@/components/minehub/AuditPanel";
import EquipmentPanel from "@/components/minehub/EquipmentPanel";

interface TabDef {
  id: MineHubTab; label: string; icon: React.ElementType; hint: string; permission: string;
}

export const MINEHUB_TABS: TabDef[] = [
  { id: "users", label: "People & Access", icon: Users, permission: "access.users.view",
    hint: "Who can sign in, and what each person may do" },
  { id: "roles", label: "Roles", icon: KeyRound, permission: "access.users.view",
    hint: "Create roles and decide what each one carries" },
  { id: "audit", label: "Access History", icon: History, permission: "access.users.view",
    hint: "Every grant, change and revocation — append-only" },
  { id: "equipment", label: "Equipment Registry", icon: Cpu, permission: "platform.registry.view",
    hint: "One identity per machine, across every system" },
];

export default function MineHubSection() {
  const can = useAuth((s) => s.can);
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const { tab, setTab } = useMineHubTab();

  const visible = useMemo(
    () => MINEHUB_TABS.filter((t) => can(t.permission)),
    [can, permissions],
  );

  // If the current tab disappears because the user's own access changed while
  // they were on it, move them somewhere they can still be rather than showing
  // an empty screen.
  useEffect(() => {
    if (visible.length && !visible.some((t) => t.id === tab)) setTab(visible[0].id);
  }, [visible, tab, setTab]);

  const active = visible.find((t) => t.id === tab);

  return (
    <div className="py-5 space-y-5 max-w-[1500px]">
      {/* Banner — the one dark surface, matching the other section headers */}
      <div className="rounded-lg bg-gradient-to-r from-navy-2 to-steel border border-gold/25 px-5 py-4 shadow-md">
        <div className="flex items-center gap-3">
          <Boxes className="w-5 h-5 text-gold-light shrink-0" />
          <div>
            <h1 className="font-condensed font-bold text-[18px] tracking-wide text-white uppercase">
              MineHub Platform
            </h1>
            <p className="text-white/60 text-[12px] mt-0.5">
              {active?.hint ?? "Platform administration"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      {visible.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-border">
          {visible.map((t) => {
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

      {visible.length === 0 && (
        <p className="text-[13px] text-txt-muted py-10 text-center">
          You do not have permission for any platform module.
        </p>
      )}

      {tab === "users" && can("access.users.view") && <UsersPanel />}
      {tab === "roles" && can("access.users.view") && <RolesPanel />}
      {tab === "audit" && can("access.users.view") && <AuditPanel />}
      {tab === "equipment" && can("platform.registry.view") && <EquipmentPanel />}
    </div>
  );
}
