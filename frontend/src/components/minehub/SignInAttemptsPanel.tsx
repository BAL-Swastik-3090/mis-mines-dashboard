"use client";
/**
 * Sign-in attempts.
 *
 * Only successful logins were ever written down — a session row exists once
 * somebody is already in. A refusal left nothing, so "why can this person not
 * sign in" had no answer beyond checking each thing that could have refused
 * and finding them all correct.
 *
 * The login endpoint tells an unknown employee ID, a wrong password and an
 * inactive account exactly the same thing, so it cannot be used to discover
 * which IDs exist. That reticence is right facing the person signing in and
 * useless to whoever has to explain the refusal, so the reason is recorded
 * and shown HERE, behind the same gate as the rest of Access Control.
 *
 * What is never recorded: the password, in any form. The outcome says which
 * check refused, which is what an investigation actually needs.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2, Search, CheckCircle2, KeyRound, UserX, Ban, ShieldOff, CircleSlash,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Chip, Card, CardHeader, EmptyRow, Td, Th, type Tone } from "./ui";

interface AttemptRow {
  login_attempt_id: number;
  occurred_at: string;
  empid: string;
  name: string | null;
  outcome: string;
  ip_address: string | null;
  user_agent: string | null;
}

/** Each outcome says which check refused, in the words a person would use. */
const OUTCOME: Record<string, { label: string; icon: React.ElementType; tone: Tone; why: string }> = {
  OK:           { label: "Signed in",      icon: CheckCircle2, tone: "emerald",
                  why: "Credentials correct and access granted" },
  BAD_PASSWORD: { label: "Wrong password", icon: KeyRound,     tone: "gold",
                  why: "The ID exists and is active — the password did not match" },
  UNKNOWN_ID:   { label: "Unknown ID",     icon: UserX,        tone: "rose",
                  why: "No such employee ID in the intranet login table" },
  INACTIVE:     { label: "Account closed", icon: Ban,          tone: "rose",
                  why: "The intranet account exists but is not active" },
  NO_ACCESS:    { label: "Not invited",    icon: ShieldOff,    tone: "sky",
                  why: "Password was correct — this dashboard is invite-only" },
  INCOMPLETE:   { label: "Form incomplete", icon: CircleSlash, tone: "slate",
                  why: "Submitted without an employee ID or a password" },
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

/** The browser, roughly. The full string is noise in a table this wide. */
function device(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg/.test(ua) ? "Edge"
    : /Chrome/.test(ua) ? "Chrome"
    : /Firefox/.test(ua) ? "Firefox"
    : /Safari/.test(ua) ? "Safari" : "Other";
  const os = /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

export default function SignInAttemptsPanel() {
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emp, setEmp] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);

  const load = useCallback(async (empId: string, failed: boolean) => {
    setError(null);
    try {
      const r = await api.get("/access/login-attempts", {
        params: { limit: 200, emp_id: empId, failed_only: failed },
      });
      setRows(r.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load the sign-in attempts.");
    } finally { setLoading(false); }
  }, []);

  // Debounced, so typing an employee ID does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void load(emp.trim(), failedOnly); }, 350);
    return () => clearTimeout(t);
  }, [emp, failedOnly, load]);

  const failures = rows.filter((r) => r.outcome !== "OK").length;

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardHeader
          title={`Sign-in attempts · ${rows.length}`}
          subtitle={
            failures > 0
              ? `${failures} of these were refused. The person trying is told only “Invalid Employee ID or Password” — the reason is shown here.`
              : "Every attempt, successful or not, newest first. The password is never recorded."
          }
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFailedOnly((v) => !v)}
                className={`rounded border px-2.5 py-1.5 text-[12px] transition-colors ${
                  failedOnly
                    ? "border-gold text-gold bg-gold/10"
                    : "border-border text-txt-muted hover:text-txt-primary"
                }`}
              >
                Refused only
              </button>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-light" />
                <input
                  id="mh-attempt-emp"
                  value={emp}
                  onChange={(e) => setEmp(e.target.value)}
                  placeholder="Employee ID…"
                  className="bg-bg-base border border-border rounded pl-8 pr-3 py-1.5 text-[12px] text-txt-primary placeholder:text-txt-light focus:outline-none focus:border-gold w-full sm:w-[260px] lg:w-[360px]"
                />
              </div>
            </div>
          }
        />

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-gold" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <Th className="w-[190px]">When</Th>
                  <Th className="w-[170px]">Outcome</Th>
                  <Th>Who tried</Th>
                  <Th>Why it ended that way</Th>
                  <Th className="hidden lg:table-cell w-[150px]">From</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <EmptyRow colSpan={5}>
                    {emp.trim()
                      ? `No sign-in attempts recorded for ${emp.trim()}.`
                      : failedOnly
                        ? "No refused attempts recorded."
                        : "No sign-in attempts recorded yet."}
                  </EmptyRow>
                )}
                {rows.map((r) => {
                  const meta = OUTCOME[r.outcome] ?? {
                    label: r.outcome, icon: CircleSlash, tone: "slate" as const, why: "",
                  };
                  const Icon = meta.icon;
                  return (
                    <tr key={r.login_attempt_id} className="hover:bg-bg-light">
                      <Td className="text-txt-muted whitespace-nowrap">{when(r.occurred_at)}</Td>
                      <Td>
                        <Chip tone={meta.tone}><Icon className="w-3 h-3" />{meta.label}</Chip>
                      </Td>
                      <Td>
                        <span className="text-txt-primary">
                          {r.name ?? r.empid}
                          {r.name && <span className="text-txt-light"> · {r.empid}</span>}
                        </span>
                        {/* No name means the ID is not an employee ID at all,
                            which is the most interesting row on the page. */}
                        {!r.name && (
                          <span className="text-txt-light"> · not an employee ID</span>
                        )}
                      </Td>
                      <Td className="text-txt-secondary">{meta.why || "—"}</Td>
                      <Td className="hidden lg:table-cell text-txt-muted whitespace-nowrap">
                        {device(r.user_agent)}
                        {r.ip_address && (
                          <span className="text-txt-light"> · {r.ip_address}</span>
                        )}
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
