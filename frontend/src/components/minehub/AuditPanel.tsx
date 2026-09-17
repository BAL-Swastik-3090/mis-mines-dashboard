"use client";
/**
 * Access history.
 *
 * user_access holds only the current grant, so until now the questions that
 * actually get asked about a system gating production data had no answer: who
 * gave the external auditor access, who removed this person, was this role
 * always able to change access. Every change is now recorded as it happens,
 * append-only, and read here.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2, Search, UserCheck, UserX, KeyRound, Pencil, Trash2, ShieldCheck,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Badge, Card, CardHeader, EmptyRow, Td, Th, inputClass } from "./ui";

interface AuditRow {
  access_audit_id: number;
  occurred_at: string;
  actor_emp_id: string; actor_name: string;
  action: string;
  subject_emp_id: string | null; subject_name: string | null;
  role_name: string | null;
  detail: string | null;
  ip_address: string | null;
}

const ACTION: Record<string, { label: string; icon: React.ElementType; tone: "gold" | "success" | "danger" | "info" | "neutral" }> = {
  USER_ROLES_SET:       { label: "Access changed",      icon: UserCheck,   tone: "info" },
  USER_REVOKED:         { label: "Access removed",      icon: UserX,       tone: "danger" },
  ROLE_CREATED:         { label: "Role created",        icon: KeyRound,    tone: "success" },
  ROLE_UPDATED:         { label: "Role edited",         icon: Pencil,      tone: "gold" },
  ROLE_PERMISSIONS_SET: { label: "Permissions changed", icon: ShieldCheck, tone: "gold" },
  ROLE_DELETED:         { label: "Role deleted",        icon: Trash2,      tone: "danger" },
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  const stamp = d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  if (mins < 1) return `just now · ${stamp}`;
  if (mins < 60) return `${mins} min ago · ${stamp}`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago · ${stamp}`;
  return stamp;
}

export default function AuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emp, setEmp] = useState("");

  const load = useCallback(async (empId: string) => {
    setError(null);
    try {
      const r = await api.get("/access/audit", { params: { limit: 200, emp_id: empId } });
      setRows(r.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load the access history.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(""); }, [load]);

  // Debounced so typing an employee ID does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void load(emp.trim()); }, 350);
    return () => clearTimeout(t);
  }, [emp, load]);

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardHeader
          title={`Access history · ${rows.length}`}
          subtitle="Every grant, change and revocation, newest first. Append-only — entries are never edited or deleted."
          actions={
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-light" />
              <input id="mh-audit-emp" value={emp} onChange={(e) => setEmp(e.target.value)}
                placeholder="Employee ID…"
                className="bg-bg-base border border-border rounded pl-8 pr-3 py-1.5 text-[12px] text-txt-primary placeholder:text-txt-light focus:outline-none focus:border-gold w-[150px]" />
            </div>
          }
        />

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <Th className="w-[190px]">When</Th>
                  <Th className="w-[170px]">What</Th>
                  <Th>Who it affected</Th>
                  <Th>Change</Th>
                  <Th className="hidden lg:table-cell w-[150px]">Done by</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <EmptyRow colSpan={5}>
                    {emp.trim()
                      ? `No access changes recorded for ${emp.trim()}.`
                      : "No access changes recorded yet."}
                  </EmptyRow>
                )}
                {rows.map((r) => {
                  const meta = ACTION[r.action] ?? { label: r.action, icon: KeyRound, tone: "neutral" as const };
                  const Icon = meta.icon;
                  return (
                    <tr key={r.access_audit_id} className="hover:bg-bg-light">
                      <Td className="text-txt-muted whitespace-nowrap">{when(r.occurred_at)}</Td>
                      <Td>
                        <Badge tone={meta.tone}><Icon className="w-3 h-3" />{meta.label}</Badge>
                      </Td>
                      <Td>
                        {r.subject_emp_id ? (
                          <span className="text-txt-primary">
                            {r.subject_name ?? r.subject_emp_id}
                            <span className="text-txt-light"> · {r.subject_emp_id}</span>
                          </span>
                        ) : r.role_name ? (
                          <span className="text-txt-primary">Role “{r.role_name}”</span>
                        ) : <span className="text-txt-light">—</span>}
                      </Td>
                      <Td className="text-txt-secondary">{r.detail ?? "—"}</Td>
                      <Td className="hidden lg:table-cell">
                        {r.actor_emp_id === "SYSTEM"
                          ? <span className="text-txt-light">system</span>
                          : <span className="text-txt-secondary">{r.actor_name ?? r.actor_emp_id}</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
