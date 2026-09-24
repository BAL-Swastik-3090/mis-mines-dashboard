"use client";
/**
 * Every roster change, newest first.
 *
 * A roster's rows say what it is now, and with their dates what it was. They
 * cannot say who typed it, or when. "Who moved the night crew onto A shift, and
 * when did they do it" is a question about people, and until this screen there
 * was nowhere to ask it — the platform recorded that five operators had been
 * assigned and nothing about which five, or what they came off.
 *
 * Read from the event log rather than from the assignment rows, because the log
 * is the only thing that carries the hand that made the change.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { History, Loader2, Search, ArrowRight, Users } from "lucide-react";
import api from "@/lib/api";
import { matchesSearch } from "@/lib/search";
import { Card, CardHeader, Chip, EmptyRow, Td, Th, inputClass } from "@/components/minehub/ui";

interface Change {
  event_id: string;
  event_type: string;
  occurred_at: string;
  recorded_by: string | null;
  person: string | null;
  operator_ref: string | null;
  from_pattern: string | null;
  to_pattern: string | null;
  effective_from: string | null;
  batch: string | null;
  batch_size: number | null;
  how: string | null;
}

const WINDOWS: { days: number; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "A year" },
];

/** When it happened, said the way people ask about it. */
function when(iso: string): string {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days <= 6) return `${days} d ago`;
  return then.toLocaleDateString("en-IN",
    { day: "2-digit", month: "short", year: "numeric" });
}

export default function RosterActivity() {
  const [rows, setRows] = useState<Change[]>([]);
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/workforce/activity", { params: { days, limit: 500 } });
      setRows(r.data ?? []);
      setError(null);
    } catch {
      setError("The roster history could not be read.");
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => rows.filter((r) => matchesSearch(q, [
    r.person, r.operator_ref, r.from_pattern, r.to_pattern, r.recorded_by,
  ])), [rows, q]);

  // A bulk change is one decision, and listing it as thirty identical lines
  // buries the one line that was somebody being moved on their own.
  const batches = useMemo(() => {
    const seen = new Set<string>();
    shown.forEach((r) => { if (r.batch && (r.batch_size ?? 0) > 1) seen.add(r.batch); });
    return seen.size;
  }, [shown]);

  return (
    <Card>
      <CardHeader icon={History} title="Roster history"
        subtitle="Every change to who works when — what they moved off, what onto, and who moved them."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {WINDOWS.map((w) => (
                <button key={w.days} type="button" onClick={() => setDays(w.days)}
                  className={`px-2.5 py-1.5 text-[12px] transition-colors ${
                    days === w.days ? "bg-gold/15 text-txt-primary font-semibold"
                                    : "text-txt-muted hover:bg-bg-hover"}`}>
                  {w.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Person, pattern, who changed it"
                className={`${inputClass} pl-8 w-full sm:w-[320px] lg:w-[440px] xl:w-[520px]`} />
            </div>
          </div>
        } />

      {error && <p className="px-4 py-3 text-[12.5px] text-rose">{error}</p>}

      {!error && (
        <>
          <div className="px-4 py-2 border-b border-border-light flex flex-wrap items-center gap-3
                          text-[12px] text-txt-muted">
            <span className="tabular-nums">
              <strong className="text-txt-primary">{shown.length}</strong>
              {shown.length !== rows.length && ` of ${rows.length}`} change
              {shown.length === 1 ? "" : "s"}
            </span>
            {batches > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {batches} were crew changes, not one person at a time
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Moved</Th>
                  <Th>From date</Th>
                  <Th>Changed</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center">
                    <Loader2 className="w-4 h-4 animate-spin inline text-txt-light" />
                  </td></tr>
                )}
                {!loading && shown.length === 0 && (
                  <EmptyRow colSpan={5}>
                    {rows.length === 0
                      ? "No roster changes in this window. Putting somebody on a pattern records it here."
                      : `Nothing matches “${q}”.`}
                  </EmptyRow>
                )}
                {!loading && shown.map((r) => (
                  <tr key={r.event_id} className="border-t border-border-light hover:bg-bg-hover">
                    <Td>
                      <span className="font-semibold text-txt-primary">
                        {r.person ?? "—"}
                      </span>
                      {r.operator_ref && (
                        <span className="block text-[11px] text-txt-light font-mono">
                          {r.operator_ref}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        {r.from_pattern
                          ? <Chip tone="slate" dot={false}>{r.from_pattern}</Chip>
                          : <span className="text-[11.5px] text-txt-light">not on a roster</span>}
                        <ArrowRight className="w-3 h-3 text-txt-light" />
                        {r.to_pattern
                          ? <Chip tone="violet" dot={false}>{r.to_pattern}</Chip>
                          : <Chip tone="rose" dot={false}>off the roster</Chip>}
                      </span>
                    </Td>
                    <Td className="tabular-nums text-[12px]">{r.effective_from ?? "—"}</Td>
                    <Td className="text-[12px] text-txt-muted whitespace-nowrap">
                      {/* "3 h ago" is how people ask; the exact stamp is what
                          they need when they are reconstructing a day, so it
                          sits behind the hover rather than in the column. */}
                      <span title={new Date(r.occurred_at).toLocaleString("en-IN")}>
                        {when(r.occurred_at)}
                      </span>
                    </Td>
                    <Td className="text-[12px]">
                      {r.recorded_by ?? "—"}
                      {(r.batch_size ?? 0) > 1 && (
                        <span className="block text-[11px] text-txt-light">
                          with {(r.batch_size ?? 1) - 1} other
                          {(r.batch_size ?? 1) - 1 === 1 ? "" : "s"}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
