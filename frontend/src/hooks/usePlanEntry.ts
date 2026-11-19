"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export type PlanKind = "despatch" | "cobp" | "excavation";

export interface PlanColumn {
  name: string;
  heading: string;
  /** The block the mine's own sheet calls this column -- Balasore, Sukinda,
   *  Feed. The grid bands the header by it rather than running every column
   *  flat, which is what made the first version unreadable. */
  group: string;
  kind: "text" | "number";
}

export interface PlanRow {
  [column: string]: unknown;
  /** Read-only figures the database computes. Shown, never sent. */
  computed?: Record<string, string | number | null>;
}

export interface PlanMonth {
  kind: PlanKind;
  label: string;
  month: string;
  from: string;
  to: string;
  key_columns: string[];
  /** What to call each key column on screen. 'loc id' meant nothing. */
  key_headings: { name: string; heading: string }[];
  columns: PlanColumn[];
  generated: string[];
  generated_group: string;
  count: number;
  rows: PlanRow[];
  may_edit: boolean;
  may_delete: boolean;
}

export interface PlanHistoryEntry {
  plan_date: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  revision: number;
  entry_id: string;
  entry_date: string;
}

/**
 * One month of one plan, and the means to file it.
 *
 * THE SHAPE COMES FROM THE SERVER, not from here. Which columns a plan has,
 * which of them a person may type and which the database computes are all
 * read from the response, so a column added to the table appears on the
 * screen without a second list here to keep in step. The COB plan is the
 * reason: five of its sixteen figures became generated in migration 127, and
 * a hard-coded list here would still be asking for them.
 */
export function usePlanEntry(kind: PlanKind, month: string) {
  const qc = useQueryClient();

  const q = useQuery<PlanMonth>({
    queryKey: ["plan-entry", kind, month],
    queryFn: async () =>
      (await api.get(`/plan-entry/${kind}`, { params: { month } })).data,
    enabled: Boolean(month),
    staleTime: 30_000,
  });

  const history = useQuery<{ entries: PlanHistoryEntry[]; count: number }>({
    queryKey: ["plan-entry", kind, month, "history"],
    queryFn: async () =>
      (await api.get(`/plan-entry/${kind}/history`, { params: { month } })).data,
    enabled: Boolean(month),
    staleTime: 30_000,
  });

  /** Save only the rows that changed. See the note in PlanEntrySection. */
  const save = useMutation({
    mutationFn: async (rows: Record<string, unknown>[]) =>
      (await api.put(`/plan-entry/${kind}`, { month, rows })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plan-entry", kind, month] });
      // Every screen that reads a plan is now out of date.
      void qc.invalidateQueries({ queryKey: ["executive-summary"] });
      void qc.invalidateQueries({ queryKey: ["despatch"] });
      void qc.invalidateQueries({ queryKey: ["oee"] });
    },
  });

  const removeDay = useMutation({
    mutationFn: async (onDate: string) =>
      (await api.delete(`/plan-entry/${kind}`, { params: { on_date: onDate } })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plan-entry", kind, month] });
      void qc.invalidateQueries({ queryKey: ["executive-summary"] });
    },
  });

  return { ...q, history, save, removeDay };
}
