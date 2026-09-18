"use client";
/**
 * Building a cycle.
 *
 * A pattern is a small thing described badly by a form: "six on, one off,
 * rotating" is three words to say and a paragraph to type. So the cycle is
 * built by clicking the days, and each click cycles a square through the shifts
 * the mine actually runs and then back to rest. What you see is the roster, in
 * the same squares the grid draws it in.
 *
 * The shifts come from the mine's own shift calendar rather than a list written
 * here, because a pattern that refers to a shift nobody runs is a pattern that
 * rosters people onto nothing.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Repeat, Plus, Loader2, Users, Minus, Check, Sparkles } from "lucide-react";
import api from "@/lib/api";
import {
  Button, Card, CardHeader, Chip, Field, inputClass,
} from "@/components/minehub/ui";
import { DAY_STATE, isoDay } from "./state";
import StarterPatterns from "./StarterPatterns";

interface Pattern {
  pattern_id: number; code: string; name: string; description: string | null;
  cycle_days: number; slots: string[]; is_active: boolean; people: number;
}

const REST = "REST";

export default function PatternStudio({ mayManage, onChanged }: {
  mayManage: boolean; onChanged?: () => void;
}) {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [shifts, setShifts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<{ code: string; name: string; description: string;
                                       slots: string[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const today = isoDay(new Date());
    try {
      const [p, b] = await Promise.all([
        api.get("/workforce/patterns"),
        // One day wide: this only needs the mine's shift codes, and asking for
        // the whole roster to read a five-item list is a slow screen for nothing.
        api.get("/workforce/board", { params: { from_date: today, to_date: today } }),
      ]);
      setPatterns(p.data ?? []);
      setShifts((b.data?.shifts ?? []).map((s: { code: string }) => s.code));
      setError(null);
    } catch {
      setError("Patterns could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const start = () => setDraft({
    code: "", name: "", description: "",
    // Six on, one off — the shape most of the mine already works, offered as a
    // starting point rather than as the answer.
    slots: [...Array(6).fill(shifts[0] ?? "A"), REST],
  });

  const cycle = (index: number) => {
    if (!draft) return;
    const order = [...shifts, REST];
    const now = draft.slots[index];
    const next = order[(order.indexOf(now) + 1) % order.length] ?? REST;
    const slots = [...draft.slots];
    slots[index] = next;
    setDraft({ ...draft, slots });
  };

  const resize = (by: number) => {
    if (!draft) return;
    const slots = [...draft.slots];
    if (by > 0) slots.push(REST);
    else if (slots.length > 1) slots.pop();
    setDraft({ ...draft, slots });
  };

  const save = async () => {
    if (!draft?.code.trim()) return;
    setBusy(true);
    try {
      await api.post("/workforce/patterns", {
        code: draft.code.trim(), name: draft.name.trim() || draft.code.trim(),
        description: draft.description.trim() || null, slots: draft.slots,
      });
      setDraft(null);
      await load();
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The pattern could not be saved.");
    } finally { setBusy(false); }
  };

  const retire = async (p: Pattern) => {
    setBusy(true);
    try {
      await api.patch(`/workforce/patterns/${p.pattern_id}`, { is_active: !p.is_active });
      await load();
    } catch { setError("That could not be changed."); }
    finally { setBusy(false); }
  };

  const working = draft ? draft.slots.filter((s) => s !== REST).length : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Patterns" icon={Repeat} tone="sky"
          subtitle="The cycles this mine works. A cycle is not a week."
          actions={mayManage && !draft && (
            <Button size="sm" variant="primary" onClick={start}>
              <Plus className="w-3.5 h-3.5" /> New pattern
            </Button>
          )}
        />

        {error && (
          <div className="px-5 py-3 text-[12px] text-rose bg-rose-bg border-b border-rose/20">
            {error}
          </div>
        )}

        {draft && (
          <div className="px-5 py-4 border-b border-slate-100 bg-sky-bg/30 space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Short code" required hint="What the roster grid shows">
                <input className={inputClass} value={draft.code} maxLength={16}
                       placeholder="6ON-1OFF-A"
                       onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Name">
                <input className={inputClass} value={draft.name}
                       placeholder="Six on, one off — A shift"
                       onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Note">
                <input className={inputClass} value={draft.description}
                       placeholder="Who this is for"
                       onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-txt-light">
                  The cycle — click a day to change it
                </p>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => resize(-1)}>
                    <Minus className="w-3 h-3" />
                  </Button>
                  <span className="text-[12px] font-semibold text-navy tabular-nums">
                    {draft.slots.length} days
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => resize(1)}>
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {draft.slots.map((slot, i) => (
                  <button key={i} onClick={() => cycle(i)} type="button"
                    title={`Day ${i + 1} of the cycle`}
                    className={`w-10 h-10 rounded-lg border text-[12px] font-bold transition
                      hover:scale-105 ${slot === REST ? DAY_STATE.REST.cell : DAY_STATE.ON.cell}`}>
                    {slot === REST ? "·" : slot}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] text-txt-muted">
                {working} working {working === 1 ? "day" : "days"} in every{" "}
                {draft.slots.length}
                {draft.slots.length >= 7 && (
                  <> — about {Math.round(working * 365 / draft.slots.length)} days a year.</>
                )}
              </p>
              {shifts.length === 0 && (
                <p className="mt-1 text-[11.5px] text-amber">
                  No shifts are defined in the shift calendar, so every day can only be rest.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}
                      disabled={busy || !draft.code.trim()}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Check className="w-3.5 h-3.5" />}
                Save pattern
              </Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="px-5 py-12 text-center text-[13px] text-txt-muted">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </div>
        ) : patterns.length === 0 ? (
          <div className="px-5 py-6">
            <p className="text-[13px] text-txt-muted mb-1">
              No patterns yet. A pattern says which days somebody works and which
              they rest, and nobody can be rostered until there is one.
            </p>
            <p className="text-[12.5px] text-txt-light mb-4">
              Here is how mines like this one usually work. Take whichever match,
              or build your own above.
            </p>
            {mayManage && <StarterPatterns onAdopted={() => void load()} />}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {patterns.map((p) => (
              <div key={p.pattern_id}
                   className={`px-5 py-3.5 flex flex-wrap items-center gap-3
                               ${p.is_active ? "" : "opacity-55"}`}>
                <div className="min-w-[180px]">
                  <p className="text-[13px] font-bold text-navy">{p.code}</p>
                  <p className="text-[11.5px] text-txt-light">{p.name}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(p.slots ?? []).map((slot, i) => (
                    <span key={i} className={`w-6 h-6 rounded border text-[10px] font-bold
                      inline-flex items-center justify-center
                      ${slot === REST ? DAY_STATE.REST.cell : DAY_STATE.ON.cell}`}>
                      {slot === REST ? "·" : slot}
                    </span>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Chip tone={p.people ? "navy" : "slate"} dot={false}>
                    <Users className="w-3 h-3" /> {p.people}
                  </Chip>
                  {mayManage && (
                    <Button size="sm" variant="secondary" disabled={busy}
                            onClick={() => void retire(p)}>
                      {p.is_active ? "Retire" : "Bring back"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {mayManage && patterns.length > 0 && (
        <Card>
          <CardHeader title="Other patterns you could add" icon={Sparkles} tone="gold"
            subtitle="Built from this mine's own shifts. Nothing is created until you pick it." />
          <div className="px-5 py-4">
            <StarterPatterns onAdopted={() => void load()} />
          </div>
        </Card>
      )}
    </div>
  );
}
