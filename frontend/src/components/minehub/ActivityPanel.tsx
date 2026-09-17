"use client";
/**
 * Day-to-day platform activity.
 *
 * Read straight off the event log, so any module added later appears here
 * without this screen changing — a new fact type is a new event_type, not a new
 * table and a new feed.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Truck, Link2, Unlink, UserPlus, Pencil, Activity as Pulse } from "lucide-react";
import api from "@/lib/api";
import { Alert, Badge, Card, CardHeader, EmptyRow, Td, Th } from "./ui";

interface EventRow {
  event_id: string;
  event_type: string;
  occurred_at: string;
  recorded_by: string | null;
  source: string;
  payload: Record<string, unknown>;
  fleet_code: string | null;
}

const TYPE: Record<string, { label: string; icon: React.ElementType; tone: "gold" | "success" | "danger" | "info" | "neutral" }> = {
  ASSET_REGISTERED:        { label: "Machine registered", icon: Truck,    tone: "success" },
  ASSET_UPDATED:           { label: "Machine updated",    icon: Pencil,   tone: "gold" },
  ASSET_IDENTITY_LINKED:   { label: "Identity linked",    icon: Link2,    tone: "info" },
  ASSET_IDENTITY_UNLINKED: { label: "Identity removed",   icon: Unlink,   tone: "danger" },
  PARTY_REGISTERED:        { label: "Party registered",   icon: UserPlus, tone: "success" },
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

/** The interesting fields of a payload, as a readable line. */
function describe(e: EventRow): string {
  const p = e.payload ?? {};
  if (e.event_type === "ASSET_REGISTERED") {
    return [p.fleet_code, p.ownership === "HIRED" ? "hired" : "own"].filter(Boolean).join(" · ");
  }
  if (e.event_type.startsWith("ASSET_IDENTITY")) {
    return `${p.system ?? ""} → ${p.external_code ?? ""}`.trim();
  }
  if (e.event_type === "PARTY_REGISTERED") return String(p.name ?? "");
  const keys = Object.keys(p).filter((k) => k !== "fleet_code");
  return keys.length ? keys.map((k) => `${k}: ${String(p[k])}`).join(", ") : "—";
}

export default function ActivityPanel() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get("/minehub/activity", { params: { limit: 150 } });
      setRows(r.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load activity.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader
          title={`Activity · ${rows.length}`}
          subtitle="Every action recorded on the platform, newest first. Append-only — a correction is a new entry, never an edit."
        />
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr>
                  <Th className="w-[190px]">When</Th>
                  <Th className="w-[180px]">What</Th>
                  <Th className="w-[130px]">Machine</Th>
                  <Th>Detail</Th>
                  <Th className="hidden lg:table-cell w-[110px]">By</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <EmptyRow colSpan={5}>
                    Nothing recorded yet. Registering a machine or linking an identity will appear here.
                  </EmptyRow>
                )}
                {rows.map((e) => {
                  const meta = TYPE[e.event_type] ?? { label: e.event_type, icon: Pulse, tone: "neutral" as const };
                  const Icon = meta.icon;
                  return (
                    <tr key={e.event_id} className="hover:bg-bg-light">
                      <Td className="text-txt-muted whitespace-nowrap">{when(e.occurred_at)}</Td>
                      <Td><Badge tone={meta.tone}><Icon className="w-3 h-3" />{meta.label}</Badge></Td>
                      <Td className="font-mono text-[11.5px] text-txt-primary">{e.fleet_code ?? "—"}</Td>
                      <Td>{describe(e)}</Td>
                      <Td className="hidden lg:table-cell text-txt-muted">{e.recorded_by ?? "—"}</Td>
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
