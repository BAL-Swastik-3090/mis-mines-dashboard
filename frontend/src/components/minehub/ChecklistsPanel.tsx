"use client";
/**
 * The things people record answers against, and how the mine edits them.
 *
 * "What if tomorrow I want to add a new field — how can we do that?" was a
 * fair question with a bad answer: the fifteen competency dimensions were an
 * array in a React file, so adding one meant a developer, a build and a
 * deploy. They are rows now, and this is the screen that edits them.
 *
 * The same screen does handover checks, because they are the same shape — an
 * ordered, named thing somebody answers for a class of machine. Building one
 * editor for both means the HOTO check-in inherits it rather than growing its
 * own half of it.
 *
 * TWO THINGS IT WILL NOT LET YOU DO, both for the same reason.
 *
 * It will not rename a code. The label is what the assessor reads and can be
 * reworded freely; the code is what every assessment already recorded points
 * at, and changing it would silently orphan them.
 *
 * It will not delete an item that has been answered. Retiring takes it off the
 * form and leaves the history alone, which is what an append-only trail needs.
 * The screen says how many answers stand behind each item so that decision is
 * made with the number in view.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Check, ClipboardCheck, Loader2,
  Plus, Save, ShieldCheck, Trash2, Undo2, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Alert, Button, Card, CardHeader, Chip, Tabs, type Tone } from "./ui";
import Dialog from "./Dialog";
import Toast from "./Toast";

type Kind = "COMPETENCY" | "HOTO";

interface Item {
  checklist_item_id: number; kind: Kind; code: string; label: string;
  help: string | null; asset_type_id: number | null; asset_type: string | null;
  is_decisive: boolean; is_required: boolean; sort_order: number;
  status: string; answers: number; updated_by: string | null;
}
interface AssetType { asset_type_id: number; name: string }

const KINDS: { id: Kind; label: string; tone: Tone; icon: React.ElementType; hint: string }[] = [
  { id: "COMPETENCY", label: "Assessment fields", tone: "violet", icon: ShieldCheck,
    hint: "What an assessor judges when deciding whether somebody may run a machine. One of them is the decision itself; the rest describe what the person understands." },
  { id: "HOTO", label: "Handover checks", tone: "sky", icon: ClipboardCheck,
    hint: "What the outgoing and incoming operator agree about a machine at the change of shift." },
];

export default function ChecklistsPanel({ kind: initial = "COMPETENCY", onBack }: {
  kind?: Kind;
  onBack?: () => void;
}) {
  const can = useAuth((s) => s.can);

  const [kind, setKind] = useState<Kind>(initial);
  const [items, setItems] = useState<Item[]>([]);
  const [types, setTypes] = useState<AssetType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<{ label: string; help: string }>({ label: "", help: "" });
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({ label: "", help: "", asset_type_id: "", required: false });
  const [confirm, setConfirm] = useState<Item | null>(null);
  // The order as it stands on screen. Held locally so dragging rows about does
  // not fire a request per nudge; one Save sends the whole order.
  const [order, setOrder] = useState<number[] | null>(null);

  const mayManage = can(kind === "COMPETENCY"
    ? "platform.operators.manage" : "platform.registry.manage");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, t] = await Promise.all([
        api.get("/checklists", { params: { kind, include_retired: true } }),
        api.get("/minehub/asset-types").catch(() => ({ data: [] })),
      ]);
      setItems(r.data ?? []);
      setTypes(t.data ?? []);
      setOrder(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not read that list.");
    } finally { setLoading(false); }
  }, [kind]);

  useEffect(() => { void load(); }, [load]);

  const active = items.filter((i) => i.status === "ACTIVE");
  const retired = items.filter((i) => i.status !== "ACTIVE");

  // What the list looks like with any local reordering applied.
  const shown = order
    ? order.map((id) => active.find((i) => i.checklist_item_id === id)!).filter(Boolean)
    : active;

  const move = (index: number, by: number) => {
    const ids = shown.map((i) => i.checklist_item_id);
    const to = index + by;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    setOrder(ids);
  };

  const saveOrder = async () => {
    if (!order) return;
    setBusy(true);
    try {
      await api.post("/checklists/reorder", { kind, ids: order });
      await load();
      setNotice("Order saved. The form asks them in this order now.");
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not save that order.");
    } finally { setBusy(false); }
  };

  const patch = async (item: Item, body: Record<string, unknown>, said: string) => {
    setBusy(true); setError(null);
    try {
      await api.put(`/checklists/${item.checklist_item_id}`, body);
      await load();
      setEditing(null);
      setNotice(said);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not save that.");
    } finally { setBusy(false); }
  };

  const add = async () => {
    if (!newItem.label.trim()) { setError("Give it a name."); return; }
    setBusy(true); setError(null);
    try {
      await api.post("/checklists", {
        kind, label: newItem.label.trim(), help: newItem.help.trim() || undefined,
        asset_type_id: newItem.asset_type_id ? Number(newItem.asset_type_id) : undefined,
        is_required: newItem.required,
      });
      setNewItem({ label: "", help: "", asset_type_id: "", required: false });
      setAdding(false);
      await load();
      setNotice("Added. It is on the form from now on, at the end of the list.");
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not add that.");
    } finally { setBusy(false); }
  };

  const remove = async (item: Item) => {
    setConfirm(null);
    setBusy(true); setError(null);
    try {
      const r = await api.delete(`/checklists/${item.checklist_item_id}`);
      await load();
      setNotice(r.data?.retired
        ? `Retired. It is off the form; the ${r.data.answers} answers already `
          + "recorded against it are untouched."
        : "Removed. Nothing had been answered against it.");
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not remove that.");
    } finally { setBusy(false); }
  };

  const current = KINDS.find((k) => k.id === kind)!;

  if (loading) {
    return <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  return (
    <div className="space-y-4">
      <Toast tone="error" message={error} onClose={() => setError(null)} />
      <Toast tone="success" message={error ? null : notice} onClose={() => setNotice(null)} />

      <Dialog open={Boolean(confirm)} tone="danger"
        title={confirm?.answers ? "Retire this from the form?" : "Remove this?"}
        confirmLabel={confirm?.answers ? "Retire it" : "Remove it"}
        cancelLabel="Keep it" busy={busy}
        onConfirm={() => confirm && remove(confirm)} onCancel={() => setConfirm(null)}>
        {confirm?.answers
          ? `${confirm.answers} assessment${confirm.answers === 1 ? " has" : "s have"} `
            + "been recorded against this. Retiring takes it off the form and leaves "
            + "every one of them exactly as it is — nothing is rewritten and nothing "
            + "is lost. It can be put back."
          : "Nothing has been answered against this, so it goes for good."}
      </Dialog>

      {onBack && (
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 text-gold-dark" /> Back to assessment
        </Button>
      )}

      <Tabs tabs={KINDS} value={kind} onChange={(id) => setKind(id as Kind)} />

      <Card tone={current.tone}>
        <CardHeader title={`${current.label} · ${active.length}`}
          icon={current.icon} tone={current.tone} subtitle={current.hint}
          actions={
            <>
              {order && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setOrder(null)}>
                    <Undo2 className="w-3.5 h-3.5" /> Undo
                  </Button>
                  <Button size="sm" variant="primary" onClick={saveOrder} disabled={busy}>
                    <Save className="w-3.5 h-3.5" /> Save order
                  </Button>
                </>
              )}
              {mayManage && !adding && (
                <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add a field
                </Button>
              )}
            </>
          } />

        {adding && (
          <div className="px-4 py-3 border-b border-border bg-gold/[0.04] space-y-2.5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <label className="block">
                <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                  What is being judged <span className="text-rose">*</span>
                </span>
                <input id="cl-label" value={newItem.label} autoFocus
                  onChange={(e) => setNewItem({ ...newItem, label: e.target.value })}
                  placeholder={kind === "COMPETENCY"
                    ? "Load sheeting and tarpaulin" : "Reversing camera working"}
                  className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                             text-[13px] focus:outline-none focus:border-gold" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                  Which machines
                </span>
                <select id="cl-type" value={newItem.asset_type_id}
                  onChange={(e) => setNewItem({ ...newItem, asset_type_id: e.target.value })}
                  className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                             text-[13px] focus:outline-none focus:border-gold">
                  <option value="">Every machine class</option>
                  {types.map((t) => (
                    <option key={t.asset_type_id} value={t.asset_type_id}>
                      Only {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="block text-[11px] font-semibold text-txt-secondary mb-1">
                What it covers — shown to the assessor, and the reason two of them agree
              </span>
              <input id="cl-help" value={newItem.help}
                onChange={(e) => setNewItem({ ...newItem, help: e.target.value })}
                placeholder="Sheets the load before leaving the bench, every time"
                className="w-full bg-bg-base border border-border rounded-lg px-3 py-2
                           text-[13px] focus:outline-none focus:border-gold" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-[12px] text-txt-secondary">
                <input type="checkbox" checked={newItem.required}
                  onChange={(e) => setNewItem({ ...newItem, required: e.target.checked })}
                  className="accent-gold w-3.5 h-3.5" />
                An answer is required
              </label>
              <span className="flex-1" />
              <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={add} disabled={busy}>
                <Check className="w-3.5 h-3.5" /> Add it
              </Button>
            </div>
          </div>
        )}

        <div className="divide-y divide-border-light">
          {shown.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-txt-light">
              Nothing on this list yet.
            </p>
          )}
          {shown.map((i, index) => (
            <div key={i.checklist_item_id}
              className={`px-3 py-2 ${i.is_decisive ? "bg-gold/[0.06]" : ""}`}>
              {editing === i.checklist_item_id ? (
                <div className="space-y-2">
                  <input id={`cl-e-${i.checklist_item_id}`} value={form.label} autoFocus
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    className="w-full bg-bg-base border border-border rounded-lg px-3 py-1.5
                               text-[13px] font-semibold focus:outline-none focus:border-gold" />
                  <input value={form.help}
                    onChange={(e) => setForm({ ...form, help: e.target.value })}
                    placeholder="What it covers"
                    className="w-full bg-bg-base border border-border rounded-lg px-3 py-1.5
                               text-[12px] focus:outline-none focus:border-gold" />
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="primary" disabled={busy}
                      onClick={() => patch(i, { label: form.label, help: form.help || null },
                                           "Reworded. Assessments already recorded are untouched.")}>
                      <Check className="w-3.5 h-3.5" /> Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <span className="text-[11px] text-txt-light">
                      The code stays <code className="font-mono">{i.code}</code> — assessments
                      point at it.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {mayManage && (
                    <span className="flex flex-col shrink-0">
                      <button type="button" onClick={() => move(index, -1)}
                        disabled={index === 0} aria-label="Move up"
                        className="text-txt-light hover:text-navy disabled:opacity-25">
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => move(index, 1)}
                        disabled={index === shown.length - 1} aria-label="Move down"
                        className="text-txt-light hover:text-navy disabled:opacity-25">
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      {i.is_decisive && <ShieldCheck className="w-3.5 h-3.5 text-gold-dark shrink-0" />}
                      <span className={`text-[13px] ${i.is_decisive
                        ? "font-bold text-navy" : "font-semibold text-txt-secondary"}`}>
                        {i.label}
                      </span>
                      {i.is_required && <Chip tone="amber" dot={false}>required</Chip>}
                      {i.asset_type && <Chip tone="sky" dot={false}>only {i.asset_type}</Chip>}
                      {i.is_decisive && <Chip tone="gold" dot={false}>the decision</Chip>}
                    </span>
                    {i.help && (
                      <span className="block text-[11px] text-txt-light mt-0.5">{i.help}</span>
                    )}
                  </span>

                  <span className="text-[11px] text-txt-light font-mono shrink-0 hidden md:block">
                    {i.code}
                  </span>
                  <span className="text-[11px] text-txt-muted tabular-nums w-[86px] text-right shrink-0">
                    {i.answers ? `${i.answers} answered` : "not used yet"}
                  </span>

                  {mayManage && (
                    <span className="flex items-center gap-1 shrink-0">
                      {!i.is_decisive && kind === "COMPETENCY" && (
                        <button type="button" title="Make this the one that decides clearance"
                          onClick={() => patch(i, { is_decisive: true },
                                               `“${i.label}” now decides whether somebody may work.`)}
                          className="p-1 text-txt-light hover:text-gold-dark">
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button type="button" title="Reword it"
                        onClick={() => { setEditing(i.checklist_item_id);
                                         setForm({ label: i.label, help: i.help ?? "" }); }}
                        className="px-2 py-1 text-[11.5px] font-semibold text-txt-muted
                                   hover:text-navy">
                        Edit
                      </button>
                      <button type="button" title={i.answers ? "Retire it" : "Remove it"}
                        onClick={() => setConfirm(i)} disabled={i.is_decisive}
                        className="p-1 text-txt-light hover:text-rose disabled:opacity-25
                                   disabled:cursor-not-allowed">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {order && (
          <div className="px-4 py-2.5 border-t border-border bg-gold/[0.05]
                          flex items-center gap-2 text-[12px] text-gold-dark">
            <AlertTriangle className="w-3.5 h-3.5" />
            The order has changed on screen but not been saved.
          </div>
        )}
      </Card>

      {retired.length > 0 && (
        <Card tone="slate">
          <CardHeader title={`Retired · ${retired.length}`} icon={X} tone="slate"
            subtitle="Off the form, but still explaining the assessments recorded against them. Put one back and it returns to the end of the list." />
          <div className="p-3 flex flex-wrap gap-2">
            {retired.map((i) => (
              <span key={i.checklist_item_id}
                className="inline-flex items-center gap-2 rounded-lg border border-border
                           bg-bg-base px-2.5 py-1.5">
                <span className="text-[12.5px] text-txt-muted">{i.label}</span>
                <span className="text-[11px] text-txt-light tabular-nums">
                  {i.answers} answered
                </span>
                {mayManage && (
                  <button type="button"
                    onClick={() => patch(i, { status: "ACTIVE" },
                                         `“${i.label}” is back on the form.`)}
                    className="text-[11.5px] font-semibold text-gold-dark hover:underline">
                    Put back
                  </button>
                )}
              </span>
            ))}
          </div>
        </Card>
      )}

      {!mayManage && (
        <Alert tone="warning">
          You can read this list but not change it. An Access Manager grants{" "}
          <code>{kind === "COMPETENCY"
            ? "platform.operators.manage" : "platform.registry.manage"}</code>.
        </Alert>
      )}
    </div>
  );
}
