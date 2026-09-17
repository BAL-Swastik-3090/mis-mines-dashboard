"use client";
/**
 * What is expiring and what is falling due.
 *
 * An expired fitness certificate on a running machine is a statutory exposure,
 * not an administrative detail, so this is a screen of its own rather than
 * something you find by opening each machine in turn.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ShieldAlert, Wrench, FileWarning, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import { Alert, Card, CardHeader, Chip, EmptyRow, Td, Th, Tile, type Tone } from "./ui";

interface AlertRow {
  asset_id: number; fleet_code: string; nickname: string | null;
  alert_kind: "COMPLIANCE" | "MAINTENANCE" | "COMMERCIAL";
  alert_type: string; due_on: string | null; days_left: number | null;
  severity: "EXPIRED" | "DUE" | "OK";
}

const LABEL: Record<string, string> = {
  INSURANCE: "Insurance", FITNESS: "Fitness certificate", PUC: "PUC",
  ROAD_TAX: "Road tax", PERMIT: "Permit", NATIONAL_PERMIT: "National permit",
  STATUTORY_INSPECTION: "Statutory inspection", EXPLOSIVE_LICENCE: "Explosive licence",
  POLLUTION_NOC: "Pollution NOC", OTHER: "Other document",
};

function due(days: number | null): { text: string; tone: Tone } {
  if (days === null) return { text: "no date", tone: "slate" };
  if (days < 0) return { text: `${Math.abs(days)} days overdue`, tone: "rose" };
  if (days === 0) return { text: "due today", tone: "rose" };
  if (days <= 7) return { text: `${days} days left`, tone: "rose" };
  if (days <= 30) return { text: `${days} days left`, tone: "amber" };
  return { text: `${days} days left`, tone: "emerald" };
}

export default function AlertsPanel({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get("/minehub/alerts");
      setRows(r.data ?? []);
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load alerts.");
    } finally { setLoading(false); }
  }, [onChanged]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    expired: rows.filter((r) => r.severity === "EXPIRED").length,
    docs: rows.filter((r) => r.alert_kind === "COMPLIANCE").length,
    services: rows.filter((r) => r.alert_kind === "MAINTENANCE").length,
  }), [rows]);

  /** What kind of date this is. A lapsed service PO is neither a document nor a
   *  service — it stops the machine being billable, which is a different desk. */
  const KIND: Record<string, { label: string; tone: Tone }> = {
    COMPLIANCE: { label: "Document",  tone: "violet" },
    MAINTENANCE: { label: "Service",  tone: "sky" },
    COMMERCIAL: { label: "Contract",  tone: "amber" },
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile label="Already expired" value={counts.expired} tone={counts.expired ? "rose" : "emerald"}
              icon={ShieldAlert} hint={counts.expired ? "needs action today" : "nothing overdue"} />
        <Tile label="Documents" value={counts.docs} tone="amber" icon={FileWarning}
              hint="insurance, fitness, tax, permits" />
        <Tile label="Services" value={counts.services} tone="sky" icon={Wrench}
              hint="maintenance falling due" />
      </div>

      <Card tone={counts.expired ? "rose" : "emerald"}>
        <CardHeader
          title={rows.length ? `${rows.length} item${rows.length === 1 ? "" : "s"} need attention` : "Nothing needs attention"}
          icon={ShieldAlert} tone={counts.expired ? "rose" : "emerald"}
          subtitle="Expired first, then whatever falls due soonest. Each document carries its own reminder window."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr>
                <Th>Machine</Th>
                <Th>What</Th>
                <Th>Kind</Th>
                <Th>Due on</Th>
                <Th className="text-right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <EmptyRow colSpan={5}>
                  <span className="inline-flex items-center gap-2 text-emerald">
                    <CheckCircle2 className="w-4 h-4" />
                    Every document is valid and no service is due.
                  </span>
                </EmptyRow>
              )}
              {rows.map((r, i) => {
                const d = due(r.days_left);
                return (
                  <tr key={`${r.asset_id}-${r.alert_type}-${i}`} className="hover:bg-bg-light transition-colors">
                    <Td>
                      <span className="font-semibold text-navy">{r.nickname || r.fleet_code}</span>
                      {r.nickname && <span className="text-txt-light font-mono text-[11px] ml-2">{r.fleet_code}</span>}
                    </Td>
                    <Td className="text-txt-primary">{LABEL[r.alert_type] ?? r.alert_type}</Td>
                    <Td>
                      <Chip tone={KIND[r.alert_kind]?.tone ?? "slate"} dot={false}>
                        {KIND[r.alert_kind]?.label ?? r.alert_kind}
                      </Chip>
                    </Td>
                    <Td className="tabular-nums">{r.due_on ?? "—"}</Td>
                    <Td className="text-right"><Chip tone={d.tone}>{d.text}</Chip></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
