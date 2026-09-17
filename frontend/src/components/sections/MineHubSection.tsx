"use client";
/**
 * MineHub Platform — one screen for everything the platform administers.
 *
 * Access and the registry used to be two sidebar entries, which made them look
 * like unrelated products. They are the same job: deciding who may do what, and
 * keeping the master data they act on. One entry, tabs inside.
 *
 * Each tab is gated on a permission rather than a role name, so a role created
 * in the Roles tab immediately controls what its holders see here — with no code
 * change, which is the point of roles being data.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Boxes, Users, KeyRound, Cpu } from "lucide-react";
import { useAuth } from "@/contexts/useAuth";
import UsersPanel from "@/components/minehub/UsersPanel";
import RolesPanel from "@/components/minehub/RolesPanel";
import EquipmentPanel from "@/components/minehub/EquipmentPanel";

type TabId = "users" | "roles" | "equipment";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
  hint: string;
  permission: string;
}

const TABS: Tab[] = [
  { id: "users", label: "People & Access", icon: Users, permission: "access.users.view",
    hint: "Who can sign in, and what each person may do" },
  { id: "roles", label: "Roles", icon: KeyRound, permission: "access.users.view",
    hint: "Create roles and decide what each one carries" },
  { id: "equipment", label: "Equipment Registry", icon: Cpu, permission: "platform.registry.view",
    hint: "One identity per machine, across every system" },
];

export default function MineHubSection() {
  const can = useAuth((s) => s.can);
  const permissions = useAuth((s) => s.user?.permissions ?? []);

  const visible = useMemo(
    () => TABS.filter((t) => can(t.permission)),
    // recompute when the permission set changes, not just on mount
    [can, permissions],
  );

  const [tab, setTab] = useState<TabId>("users");

  // If a tab disappears because the user's own access changed while they were
  // on it, move them somewhere they can still be rather than showing nothing.
  useEffect(() => {
    if (visible.length && !visible.some((t) => t.id === tab)) {
      setTab(visible[0].id);
    }
  }, [visible, tab]);

  const active = visible.find((t) => t.id === tab);

  return (
    <div className="px-4 md:px-6 py-5 space-y-5 max-w-[1240px]">
      {/* Banner */}
      <div className="rounded-lg bg-gradient-to-r from-[#0b1b33] to-[#13294d] border border-[#c8960c]/25 px-5 py-4">
        <div className="flex items-center gap-3">
          <Boxes className="w-5 h-5 text-[#c8960c] shrink-0" />
          <div>
            <h1 className="text-white font-semibold text-[15px] tracking-wide">MineHub Platform</h1>
            <p className="text-white/55 text-[12px] mt-0.5">
              {active?.hint ?? "Platform administration"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      {visible.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-white/10">
          {visible.map((t) => {
            const Icon = t.icon;
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-[12.5px] font-semibold tracking-wide
                            border-b-2 -mb-px transition
                            ${on ? "border-[#c8960c] text-white"
                                 : "border-transparent text-white/45 hover:text-white/80"}`}
              >
                <Icon className={`w-4 h-4 ${on ? "text-[#c8960c]" : ""}`} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {visible.length === 0 && (
        <p className="text-white/45 text-[13px] py-10 text-center">
          You do not have permission for any platform module.
        </p>
      )}

      {tab === "users" && can("access.users.view") && <UsersPanel />}
      {tab === "roles" && can("access.users.view") && <RolesPanel />}
      {tab === "equipment" && can("platform.registry.view") && <EquipmentPanel />}
    </div>
  );
}
