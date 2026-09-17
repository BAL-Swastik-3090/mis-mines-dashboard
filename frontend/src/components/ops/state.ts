/**
 * The words the operations screens share.
 *
 * Machine state, operator state and readiness appear on four different screens,
 * and a colour that means breakdown on one and maintenance on another is worse
 * than no colour at all. So the vocabulary lives here once: every screen that
 * shows a state imports the same tone, the same label and the same ordering.
 */
import type { Tone } from "@/components/minehub/ui";

/** How a machine looks on the board, and how urgent it is to look at. */
export const MACHINE_STATE: Record<string, { label: string; tone: Tone; rank: number }> = {
  RUNNING:             { label: "Running",            tone: "emerald", rank: 1 },
  ASSIGNED:            { label: "Assigned",           tone: "sky",     rank: 2 },
  AVAILABLE:           { label: "Available",          tone: "teal",    rank: 3 },
  AWAITING_HOTO:       { label: "Awaiting handover",  tone: "amber",   rank: 4 },
  FUEL_REQUIRED:       { label: "Fuel required",      tone: "amber",   rank: 5 },
  LOCATION_RESTRICTED: { label: "Location restricted", tone: "amber",  rank: 6 },
  BREAKDOWN:           { label: "Breakdown",          tone: "rose",    rank: 7 },
  MAINTENANCE:         { label: "Maintenance",        tone: "violet",  rank: 8 },
  INSPECTION_HOLD:     { label: "Inspection hold",    tone: "rose",    rank: 9 },
  COMPLIANCE_HOLD:     { label: "Compliance hold",    tone: "rose",    rank: 10 },
  PLANNED_DOWN:        { label: "Planned down",       tone: "slate",   rank: 11 },
  DECOMMISSIONED:      { label: "Decommissioned",     tone: "slate",   rank: 12 },
};

export const OPERATOR_STATE: Record<string, { label: string; tone: Tone }> = {
  OPERATING:          { label: "Operating",       tone: "emerald" },
  ASSIGNED:           { label: "Assigned",        tone: "sky" },
  PRESENT:            { label: "Present",         tone: "teal" },
  ATTENDANCE_PENDING: { label: "Not marked",      tone: "slate" },
  TRAINING:           { label: "In training",     tone: "violet" },
  ABSENT:             { label: "Absent",          tone: "rose" },
  LEAVE:              { label: "On leave",        tone: "amber" },
  MEDICAL_HOLD:       { label: "Medical hold",    tone: "rose" },
  SUSPENDED:          { label: "Suspended",       tone: "rose" },
  INACTIVE:           { label: "Inactive",        tone: "slate" },
  RETIRED:            { label: "Retired",         tone: "slate" },
};

export const READINESS: Record<string, { label: string; tone: Tone }> = {
  READY:              { label: "Ready",            tone: "emerald" },
  READY_WITH_WARNING: { label: "Ready, with notes", tone: "amber" },
  BLOCKED:            { label: "Blocked",          tone: "rose" },
};

export const SEVERITY: Record<string, Tone> = {
  CRITICAL: "rose", HIGH: "rose", MEDIUM: "amber", LOW: "slate",
};

/** Why a machine or a person is unavailable — the reasons a supervisor picks
 *  from, rather than free text that nothing can ever count. */
export const MACHINE_HOLDS = [
  { state: "BREAKDOWN",           label: "Breakdown" },
  { state: "MAINTENANCE",         label: "Under maintenance" },
  { state: "INSPECTION_HOLD",     label: "Inspection hold" },
  { state: "COMPLIANCE_HOLD",     label: "Compliance hold" },
  { state: "PLANNED_DOWN",        label: "Planned down" },
  { state: "FUEL_REQUIRED",       label: "Fuel or charge required" },
  { state: "LOCATION_RESTRICTED", label: "Location restricted" },
];

export const OPERATOR_HOLDS = [
  { state: "ABSENT",       label: "Absent" },
  { state: "LEAVE",        label: "On leave" },
  { state: "TRAINING",     label: "In training" },
  { state: "MEDICAL_HOLD", label: "Medical hold" },
  { state: "SUSPENDED",    label: "Suspended" },
];

export const EXCEPTION_LABEL: Record<string, string> = {
  OPERATOR_ABSENT:       "Operator absent",
  MACHINE_UNAVAILABLE:   "Machine unavailable",
  HOTO_BLOCKED:          "Handover blocked",
  HOTO_CRITICAL_DEFECT:  "Critical defect at handover",
  DEPLOYED_OVER_BLOCK:   "Deployed over a block",
};

/** A time, said the way people say it out loud. */
export function ago(iso?: string | null): string {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function clock(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN",
    { hour: "2-digit", minute: "2-digit", hour12: false });
}
