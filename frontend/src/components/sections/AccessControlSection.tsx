"use client";
/**
 * Access Control — administration.
 *
 * Deliberately separate from the MineHub Platform screen. They were merged
 * once and it was wrong: this is an IT concern answered rarely (who may sign
 * in), while MineHub is operational work done daily by the people running the
 * mine. Splitting by audience rather than by convenience keeps each screen
 * about one job.
 *
 * Not part of the page-access matrix — it is gated on the access.* permissions,
 * because the screen that grants access must not be something you can revoke
 * from yourself.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Users, KeyRound, History } from "lucide-react";
import { useAuth } from "@/contexts/useAuth";
import UsersPanel from "@/components/minehub/UsersPanel";
import RolesPanel from "@/components/minehub/RolesPanel";
import AuditPanel from "@/components/minehub/AuditPanel";

type TabId = "users" | "roles" | "audit";

const TABS: { id: TabId; label: string; icon: React.ElementType; hint: string }[] = [
  { id: "users", label: "People & Access", icon: Users,
    hint: "Who can sign in, and what each person may do" },
  { id: "roles", label: "Roles", icon: KeyRound,
    hint: "Create roles and decide what each one carries" },
  { id: "audit", label: "Access History", icon: History,
    hint: "Every grant, change and revocation — append-only" },
];

export default function AccessControlSection() {
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<TabId>("users");

  const mayView = can("access.users.view");
  const active = useMemo(() => TABS.find((t) => t.id === tab), [tab]);

  useEffect(() => { if (!mayView) setTab("users"); }, [mayView]);

  if (!mayView) {
    return (
      <p className="text-[13px] text-txt-muted py-10 text-center">
        You do not have permission to administer access.
      </p>
    );
  }

  return (
    <div className="py-5 space-y-5 max-w-[1500px]">
      <div className="rounded-lg bg-gradient-to-r from-navy-2 to-steel border border-gold/25 px-5 py-4 shadow-md">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-gold-light shrink-0" />
          <div>
            <h1 className="font-condensed font-bold text-[18px] tracking-wide text-white uppercase">
              Access Control
            </h1>
            <p className="text-white/60 text-[12px] mt-0.5">{active?.hint}</p>
          </div>
        </div>
      </div>

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

      {tab === "users" && <UsersPanel />}
      {tab === "roles" && <RolesPanel />}
      {tab === "audit" && <AuditPanel />}
    </div>
  );
}
