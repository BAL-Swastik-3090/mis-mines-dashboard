"use client";
/**
 * One machine's history.
 *
 * Shows what changed rather than what everything was: the question people ask
 * is "who moved the rated output, and from what", not "what did the whole
 * record look like in March". The snapshot behind each revision can answer the
 * second, but putting it on screen would bury the first.
 */
import React from "react";
import {
  FilePlus2, Pencil, Send, CheckCircle2, Undo2, Clock, Loader2, ChevronDown,
} from "lucide-react";
import { Chip, type Tone } from "./ui";

export interface Revision {
  revision_id: number;
  version: number;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  remarks: string | null;
  changed_by: string;
  /** Resolved from the employee master; absent if it could not be read. */
  changed_by_name?: string | null;
  changed_at: string;
}

const ACTION: Record<string, { label: string; icon: React.ElementType; tone: Tone }> = {
  CREATED:   { label: "Registered",   icon: FilePlus2,    tone: "emerald" },
  UPDATED:   { label: "Updated",      icon: Pencil,       tone: "sky" },
  SUBMITTED: { label: "Submitted",    icon: Send,         tone: "amber" },
  APPROVED:  { label: "Approved",     icon: CheckCircle2, tone: "emerald" },
  SENT_BACK: { label: "Sent back",    icon: Undo2,        tone: "rose" },
};

/** Field names as people read them, not as the database spells them. */
const FIELD: Record<string, string> = {
  fleet_code: "Fleet code", nickname: "Nickname", registration_no: "Registration",
  asset_type_id: "Equipment type", make: "Make", model: "Model",
  year_of_make: "Year", chassis_no: "Chassis", engine_no: "Engine",
  capacity: "Capacity", capacity_uom: "Capacity unit", ownership: "Ownership",
  owner_party_id: "Contractor", supplier_party_id: "Supplier",
  sap_equipment_no: "SAP equipment no.", contract_no: "Contract no.",
  service_po_no: "Service PO no.", po_valid_from: "PO valid from", po_valid_to: "PO valid to",
  purchase_date: "Purchase date", purchase_cost: "Purchase cost",
  hire_rate: "Hire rate", hire_rate_uom: "Rate basis",
  rated_output_per_hr: "Rated output/hr", rated_fuel_lph: "Rated fuel L/hr",
  fuel_type: "Fuel type", tank_capacity_l: "Tank capacity",
  battery_kwh: "Battery kWh", range_km: "Range km", charging_type: "Charging",
  charge_time_hrs: "Charge time", reading_uom: "Meter unit",
  current_reading: "Meter reading", reading_as_on: "Reading as on",
  home_location_id: "Home location", org_unit_id: "Department",
  commissioned_on: "Commissioned", status: "Status",
  tyre_count: "Tyres", seating_capacity: "Seats", remarks: "Remarks",
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const show = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

export default function RevisionPanel({ revisions, loading }: {
  revisions: Revision[]; loading?: boolean;
}) {
  // Open by default — the history is why an existing machine gets opened at
  // all. On a narrow screen it sits above the form, where a long trail would
  // push the fields off the screen, so it can be folded away.
  const [open, setOpen] = React.useState(true);
  // Which entries have had their full field list opened. Eight is enough to see
  // what an edit was about; a registration touches everything and would
  // otherwise fill the panel on its own.
  const [shown, setShown] = React.useState<Set<number>>(new Set());
  const toggleOne = (id: number) => setShown((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <div className="bg-bg-base border border-border-light rounded-xl shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-controls="revision-list"
        className="w-full px-3 py-2.5 border-b border-border-light flex items-center justify-between gap-2
                   hover:bg-bg-light transition-colors text-left">
        <h3 className="font-condensed font-bold text-[11.5px] uppercase tracking-[.09em] text-navy
                       flex items-center gap-2">
          <Clock className="w-4 h-4 text-gold" /> Revision history
        </h3>
        <span className="flex items-center gap-2">
          <Chip tone="slate" dot={false}>{revisions.length}</Chip>
          <ChevronDown className={`w-4 h-4 text-txt-light transition-transform
                                   ${open ? "" : "-rotate-90"}`} />
        </span>
      </button>

      <div id="revision-list" hidden={!open}>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>
      ) : revisions.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12px] text-txt-light">
          No history yet.
        </p>
      ) : (
        <ol className="max-h-[560px] overflow-y-auto">
          {revisions.map((r, i) => {
            const meta = ACTION[r.action] ?? { label: r.action, icon: Pencil, tone: "slate" as Tone };
            const Icon = meta.icon;
            const all = Object.entries(r.changes ?? {});
            const expanded = shown.has(r.revision_id);
            const changed = expanded ? all : all.slice(0, 8);
            return (
              <li key={r.revision_id}
                  className="relative px-3 py-2.5 border-b border-border-light last:border-0">
                {/* The spine, drawn between entries rather than beside all of them */}
                {i < revisions.length - 1 && (
                  <span className="absolute left-[25px] top-9 bottom-0 w-px bg-border" />
                )}
                <div className="flex items-start gap-3">
                  <span className="shrink-0 w-[18px] h-[18px] rounded-full bg-bg-base ring-2 ring-border
                                   flex items-center justify-center mt-0.5 z-10">
                    <Icon className="w-3 h-3 text-txt-muted" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={meta.tone} dot={false}>{meta.label}</Chip>
                      <span className="text-[11px] font-mono text-txt-light">v{r.version}</span>
                      <span className="text-[11px] text-txt-light">{when(r.changed_at)}</span>
                    </div>
                    <div className="text-[11.5px] text-txt-muted mt-1">
                      by <span className="font-semibold text-txt-secondary">
                        {r.changed_by_name || r.changed_by}
                      </span>
                      {/* The id stays visible beside the name: two people share
                          a name far more often than an employee number. */}
                      {r.changed_by_name && (
                        <span className="font-mono text-[10.5px] text-txt-light ml-1.5">
                          {r.changed_by}
                        </span>
                      )}
                    </div>

                    {r.remarks && (
                      <p className="mt-1.5 text-[12px] text-txt-secondary italic
                                    bg-bg-light border-l-2 border-border rounded-r px-2.5 py-1.5">
                        “{r.remarks}”
                      </p>
                    )}

                    {changed.length > 0 && (
                      <div className="mt-2 rounded-lg bg-bg-light border border-border-light px-2.5 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-txt-light mb-1.5">
                          Changed ({all.length})
                        </div>
                        <ul className="space-y-1.5">
                          {changed.map(([field, v]) => (
                            // The label sits above the change rather than
                            // beside it. In a narrow rail a long value wrapped
                            // under its own field name and the arrow ended up
                            // on a line of its own, which read as two changes.
                            <li key={field} className="text-[11px] leading-snug">
                              <span className="block text-txt-light">
                                {FIELD[field] ?? field}
                              </span>
                              <span className="block break-words">
                                <span className="text-rose line-through">{show(v.from)}</span>
                                <span className="text-txt-light mx-1">→</span>
                                <span className="text-emerald font-semibold">{show(v.to)}</span>
                              </span>
                            </li>
                          ))}
                          {all.length > 8 && (
                            <li>
                              <button type="button" onClick={() => toggleOne(r.revision_id)}
                                className="text-[11px] font-semibold text-gold-dark hover:underline">
                                {expanded ? "Show less" : `and ${all.length - 8} more`}
                              </button>
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      </div>
    </div>
  );
}
