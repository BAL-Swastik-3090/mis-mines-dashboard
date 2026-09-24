"use client";
/**
 * Cycles the mine can adopt, instead of an empty list and a shrug.
 *
 * Nothing is seeded — the same rule departments and leave types follow, because
 * a platform that invents a mine's working pattern gets it subtly wrong and
 * nobody notices until somebody is rostered onto a shift they do not work. But
 * "nothing is seeded" was being paid for by whoever opened the roster first and
 * found a dropdown with nothing in it.
 *
 * So the patterns are offered rather than assumed. Each is built on the server
 * from this mine's own shift calendar, which means a suggestion can never name
 * a shift that does not exist, and each says plainly what it costs — how many
 * working days a year, who it is hard on. Adopting one creates it and nothing
 * else; it can be edited or retired afterwards like any other.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Sparkles, Loader2, Check, Plus } from "lucide-react";
import api from "@/lib/api";
import { Button, Chip } from "@/components/minehub/ui";
import { DAY_STATE } from "./state";

export interface Suggestion {
  code: string; name: string; description: string; why: string;
  slots: string[]; cycle_days: number; working_days: number; exists: boolean;
}

export default function StarterPatterns({ onAdopted, compact }: {
  /** The codes that were actually created, so a caller waiting on a pattern
   *  can use the one it just made instead of asking the user to go and find
   *  it in a list that was empty a second ago. */
  onAdopted?: (created: string[]) => void;
  /** Inside a dialog there is no room for the full reasoning, so the cards
   *  shrink to the cycle and the sentence that matters. */
  compact?: boolean;
}) {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/workforce/patterns/suggestions");
      setRows(r.data ?? []);
      setError(null);
    } catch {
      setError("The suggested patterns could not be read.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = (code: string) => setPicked((was) => {
    const next = new Set(was);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  const adopt = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const r = await api.post("/workforce/patterns/adopt", { codes: [...picked] });
      setPicked(new Set());
      await load();
      onAdopted?.(r.data?.created ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Those patterns could not be created.");
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <p className="text-[12px] text-txt-light inline-flex items-center gap-2 px-1 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading this mine&apos;s shifts…
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] text-amber px-1 py-2">
        No shifts are defined in the shift calendar, so there is nothing to build
        a pattern out of yet.
      </p>
    );
  }

  const available = rows.filter((r) => !r.exists);

  return (
    <div className="space-y-3">
      {error && <p className="text-[12px] text-rose">{error}</p>}

      {!compact && (
        <p className="text-[12px] text-txt-muted">
          Built from the shifts this mine actually runs, so none of them can name
          a shift that does not exist. Adopting one creates it — edit or retire it
          afterwards like any other.
        </p>
      )}

      {/* Four across on a laptop when compact, because the dialog that holds
          them is now wide enough for it. Two-up inside a 560px modal is what
          made this a scrolling list instead of a set of choices you can see. */}
      <div className={`grid gap-2 ${compact
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {rows.map((r) => {
          const chosen = picked.has(r.code);
          return (
            <button key={r.code} type="button" disabled={r.exists}
              onClick={() => toggle(r.code)}
              className={`text-left rounded-xl border p-3 transition
                ${r.exists ? "border-slate-200 bg-slate-50 opacity-70 cursor-default"
                  : chosen ? "border-gold bg-gold/[0.07] ring-1 ring-gold/30"
                           : "border-slate-200 bg-white hover:border-gold/50 hover:bg-gold/[0.03]"}`}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-bold text-navy">{r.name}</span>
                  <span className="block text-[10.5px] text-txt-light font-mono">{r.code}</span>
                </span>
                {r.exists ? (
                  <Chip tone="slate" dot={false}>Already here</Chip>
                ) : chosen ? (
                  <Check className="w-4 h-4 text-gold shrink-0" />
                ) : (
                  <Plus className="w-4 h-4 text-txt-light shrink-0" />
                )}
              </div>

              <div className="flex flex-wrap gap-0.5 mt-2">
                {r.slots.map((slot, i) => (
                  <span key={i} className={`w-5 h-5 rounded border text-[9px] font-bold
                    inline-flex items-center justify-center
                    ${slot === "REST" ? DAY_STATE.REST.cell : DAY_STATE.ON.cell}`}>
                    {slot === "REST" ? "·" : slot[0]}
                  </span>
                ))}
              </div>

              <p className="mt-2 text-[11px] text-txt-muted">
                {r.working_days} working days in every {r.cycle_days}
              </p>
              {!compact && (
                <p className="mt-1 text-[11px] text-txt-light leading-snug">{r.why}</p>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" disabled={picked.size === 0 || busy}
                onClick={() => void adopt()}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5" />}
          {picked.size ? `Create ${picked.size} pattern${picked.size === 1 ? "" : "s"}`
                       : "Pick one above to create it"}
        </Button>
        {picked.size === 0 && available.length > 0 && (
          <span className="text-[11.5px] text-txt-light">
            Tap a card, then create it — it becomes choosable straight away.
          </span>
        )}
        {available.length === 0 && (
          <span className="text-[11.5px] text-txt-light">
            Every suggestion is already defined.
          </span>
        )}
      </div>
    </div>
  );
}
