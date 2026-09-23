"use client";
/**
 * Fields the mine added itself.
 *
 * Every time this platform needed somewhere to put a new fact, the answer was
 * a migration and a deployment. This renders the general answer instead: a
 * field is a row, and whoever holds the right names it, picks a type and says
 * which section it belongs on.
 *
 * The screen knows nothing about what the fields are. It reads the definitions,
 * draws a control per type, and posts back a map of code to value — so a field
 * added this afternoon appears here without this file changing.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, SlidersHorizontal, X } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Band, Row, Sheet, cellInput } from "./sheet";
import { Alert, Button, Chip, Field, inputClass } from "./ui";
import Dialog from "./Dialog";
import DateField from "./DateField";

export type FieldType =
  | "TEXT" | "LONG_TEXT" | "NUMBER" | "DATE" | "BOOLEAN"
  | "SELECT" | "MULTI_SELECT" | "PHONE" | "EMAIL";

export interface FieldDef {
  field_definition_id: number;
  entity: string; code: string; label: string;
  data_type: FieldType;
  options: string[] | null;
  section: string; hint: string | null; placeholder: string | null;
  is_required: boolean; is_sensitive: boolean;
  sort_order: number; status: string; answered: number;
}

type Value = string | number | boolean | string[] | null;

const TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Short text", LONG_TEXT: "Paragraph", NUMBER: "Number",
  DATE: "Date", BOOLEAN: "Yes / no", SELECT: "Choose one",
  MULTI_SELECT: "Choose several", PHONE: "Phone number", EMAIL: "Email",
};

/* Offered on a register that has no groups yet, so the first field does not
 * face an empty list. Not seeded into the database: these are suggestions, and
 * a group only becomes real once a field actually sits in it. */
const SUGGESTED_SECTIONS = [
  "More details", "Safety", "Compliance", "Medical", "Training",
  "Contract", "Statutory",
];

const errorOf = (e: unknown, f: string): string =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? f;

/* ════════════════════════════════════════════════════════════════════════ */
export default function CustomFields({ entity, entityId, disabled, onDirty }: {
  entity: string;
  entityId: number | null;
  disabled?: boolean;
  /** Told when a value changes, so the parent can show its own saved state. */
  onDirty?: () => void;
}) {
  const can = useAuth((s) => s.can);
  const mayManage = can("platform.fields.manage");

  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get("/fields/definitions", { params: { entity } });
      setDefs(d.data?.fields ?? []);
      if (entityId) {
        const v = await api.get("/fields/values", {
          params: { entity, entity_id: entityId },
        });
        setValues(v.data?.values ?? {});
      }
      setError(null);
    } catch (e) {
      setError(errorOf(e, "Could not load the extra fields."));
    } finally { setLoading(false); }
  }, [entity, entityId]);

  useEffect(() => { void load(); }, [load]);

  /* Saved one field at a time, as it is left.
   *
   * A single Save for the whole set would mean a half-filled form is either
   * all or nothing, and this sits inside a larger form that already saves as
   * you go. One field, one write, so nothing is lost to a closed tab. */
  const commit = useCallback(async (code: string, value: Value) => {
    if (!entityId) return;
    setSaving(code);
    try {
      await api.put("/fields/values", {
        entity, entity_id: entityId, values: { [code]: value },
      });
      setError(null);
      onDirty?.();
    } catch (e) {
      setError(errorOf(e, "That value was not accepted."));
      await load();          // put back what the database actually holds
    } finally { setSaving(null); }
  }, [entity, entityId, load, onDirty]);

  const bySection = useMemo(() => {
    const m = new Map<string, FieldDef[]>();
    defs.forEach((d) => {
      const list = m.get(d.section) ?? [];
      list.push(d);
      m.set(d.section, list);
    });
    return [...m.entries()];
  }, [defs]);

  if (loading) {
    return (
      <div className="py-10 flex items-center justify-center gap-2 text-txt-light text-[13px]">
        <Loader2 className="w-4 h-4 animate-spin" /> Reading the extra fields…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      {defs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center px-6">
          <SlidersHorizontal className="w-7 h-7 text-txt-light mx-auto mb-3" />
          <p className="text-[13px] text-txt-muted max-w-md mx-auto">
            No extra fields yet. When the register needs to hold something it
            does not hold today, add it here rather than waiting for a change
            to the software.
          </p>
          {mayManage && !disabled && (
            <Button className="mt-4" onClick={() => setAdding(true)}>
              <Plus className="w-4 h-4" /> Add a field
            </Button>
          )}
        </div>
      ) : (
        bySection.map(([section, fields]) => (
          <section key={section}>
            <Band
              title={section}
              hint="Added by the mine, not built into the software"
              right={mayManage && !disabled ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add a field
                </Button>
              ) : undefined}
            />
            <Sheet>
              {fields.map((d) => (
                <Row key={d.code} label={d.label} required={d.is_required}
                     hint={d.hint ?? undefined}
                     wide={d.data_type === "LONG_TEXT"}
                     note={saving === d.code ? "saving…" : undefined}>
                  <Control
                    def={d}
                    value={values[d.code] ?? null}
                    disabled={!!disabled || !entityId}
                    onChange={(v) => setValues((s) => ({ ...s, [d.code]: v }))}
                    onCommit={(v) => void commit(d.code, v)}
                  />
                </Row>
              ))}
            </Sheet>
          </section>
        ))
      )}

      {!entityId && defs.length > 0 && (
        <p className="text-[11.5px] text-txt-light">
          Extra fields can be filled in once the record has been saved once.
        </p>
      )}

      {adding && (
        <AddFieldDialog
          entity={entity}
          existingSections={[...new Set(defs.map((d) => d.section))]}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); void load(); }}
        />
      )}
    </div>
  );
}

/* ── one control per type ────────────────────────────────────────────────── */
function Control({ def, value, disabled, onChange, onCommit }: {
  def: FieldDef; value: Value; disabled: boolean;
  onChange: (v: Value) => void; onCommit: (v: Value) => void;
}) {
  const common = { id: `cf-${def.code}`, disabled, className: cellInput };

  switch (def.data_type) {
    case "BOOLEAN":
      return (
        <label className="flex items-center gap-2 text-[13px] text-txt-secondary py-1.5">
          <input type="checkbox" disabled={disabled}
                 checked={value === true}
                 onChange={(e) => { onChange(e.target.checked); onCommit(e.target.checked); }} />
          {value === true ? "Yes" : "No"}
        </label>
      );

    case "DATE":
      return (
        <DateField {...common} value={(value as string) ?? ""}
                   onChange={(v: string) => { onChange(v); onCommit(v); }} />
      );

    case "SELECT":
      return (
        <select {...common} value={(value as string) ?? ""}
                onChange={(e) => { onChange(e.target.value); onCommit(e.target.value); }}>
          <option value="">Select…</option>
          {(def.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );

    case "MULTI_SELECT": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1.5 py-1">
          {(def.options ?? []).map((o) => {
            const on = picked.includes(o);
            return (
              <button key={o} type="button" disabled={disabled}
                onClick={() => {
                  const next = on ? picked.filter((x) => x !== o) : [...picked, o];
                  onChange(next); onCommit(next);
                }}
                className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold border transition-colors
                            ${on ? "bg-navy text-white border-navy"
                                 : "bg-bg-base text-txt-secondary border-border hover:border-gold"}`}>
                {o}
              </button>
            );
          })}
        </div>
      );
    }

    case "LONG_TEXT":
      return (
        <textarea {...common} rows={3} value={(value as string) ?? ""}
                  placeholder={def.placeholder ?? undefined}
                  onChange={(e) => onChange(e.target.value)}
                  onBlur={(e) => onCommit(e.target.value)} />
      );

    case "NUMBER":
      return (
        <input {...common} inputMode="decimal" value={value === null ? "" : String(value)}
               placeholder={def.placeholder ?? undefined}
               onChange={(e) => onChange(e.target.value)}
               onBlur={(e) => onCommit(e.target.value)} />
      );

    default:
      return (
        <input {...common}
               type={def.data_type === "EMAIL" ? "email" : "text"}
               inputMode={def.data_type === "PHONE" ? "tel" : undefined}
               value={(value as string) ?? ""}
               placeholder={def.placeholder ?? undefined}
               onChange={(e) => onChange(e.target.value)}
               onBlur={(e) => onCommit(e.target.value)} />
      );
  }
}

/* ── adding one ──────────────────────────────────────────────────────────── */
function AddFieldDialog({ entity, existingSections, onClose, onDone }: {
  entity: string; existingSections: string[];
  onClose: () => void; onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("TEXT");
  const [section, setSection] = useState(existingSections[0] ?? "More details");
  const [hint, setHint] = useState("");
  const [required, setRequired] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsOptions = type === "SELECT" || type === "MULTI_SELECT";
  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post("/fields/definitions", {
        entity, label: label.trim(), data_type: type,
        section: section.trim() || "More details",
        hint: hint.trim(),
        is_required: required, is_sensitive: sensitive,
        options: needsOptions ? cleanOptions : undefined,
      });
      onDone();
    } catch (e) { setErr(errorOf(e, "Could not add that field.")); }
    finally { setBusy(false); }
  };

  const blocked = busy || !label.trim() || (needsOptions && cleanOptions.length < 2);

  return (
    <Dialog open tone="info" width={880} bare title="Add a field"
            confirmLabel="Add it" onCancel={onClose}
            onConfirm={() => void save()} busy={blocked}>
      <p className="text-[12px] text-txt-light -mt-1 mb-4">
        It appears on every {entity.toLowerCase()} record straight away — no
        change to the software, no wait for a release.
      </p>

      {/* Two columns, because a laptop screen is wide and short.
       *
       * In one column this ran past the bottom of a 768-high screen and the
       * Add button sat below the fold — the same mistake already made once on
       * the weighbridge capture dialog. What the field IS goes on the left,
       * where it belongs and is read first; where it sits and how it behaves
       * go on the right. */}
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 items-start">

        {/* ── left: what the field is ───────────────────────────────── */}
        <div className="space-y-4">
          {err && <Alert tone="error">{err}</Alert>}

          <Field label="What is it called?" required
                 hint="What the person filling the form will see.">
            <input value={label} onChange={(e) => setLabel(e.target.value)}
                   className={inputClass} autoFocus
                   placeholder="Helmet size, Police verification…" />
          </Field>

          <Field label="What kind of answer?" required>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TYPE_LABEL) as FieldType[]).map((t) => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border
                              transition-colors leading-none
                              ${t === type ? "bg-navy text-white border-navy"
                                : "bg-bg-base text-txt-secondary border-border hover:border-gold"}`}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </Field>

          {needsOptions && (
            <Field label="The choices" required
                   hint="At least two — with one it is not a choice.">
              <div className="space-y-1.5 max-h-[190px] overflow-y-auto scrollbar-thin pr-1">
                {options.map((o, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input value={o} className={inputClass}
                           placeholder={`Choice ${i + 1}`}
                           onChange={(e) => setOptions((s) =>
                             s.map((x, j) => (j === i ? e.target.value : x)))} />
                    {options.length > 2 && (
                      <button onClick={() => setOptions((s) => s.filter((_, j) => j !== i))}
                              className="text-txt-light hover:text-rose px-1.5 shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Button size="sm" className="mt-1.5"
                      onClick={() => setOptions((s) => [...s, ""])}>
                <Plus className="w-3.5 h-3.5" /> Another choice
              </Button>
            </Field>
          )}
        </div>

        {/* ── right: where it sits and how it behaves ───────────────── */}
        <div className="space-y-4">
          {/* One control, not two.
            *
            * This was a dropdown plus a separate "or start a new group" box,
            * and the dropdown listed only groups that already had a field in
            * them — so on a register with no custom fields yet it offered
            * exactly one choice and the real answer was always the box below
            * it. A single input that suggests what exists and accepts anything
            * else asks the question once. */}
          <Field label="Which group?"
                 hint="Type a new one, or pick a group that already exists.">
            <input list="cf-sections" value={section}
                   onChange={(e) => setSection(e.target.value)}
                   className={inputClass}
                   placeholder="Safety, Compliance, Medical…" />
            <datalist id="cf-sections">
              {[...new Set([...existingSections, ...SUGGESTED_SECTIONS])].map((s) =>
                <option key={s} value={s} />)}
            </datalist>
          </Field>

          <Field label="A note under the field"
                 hint="Optional. Says what good looks like.">
            <input value={hint} onChange={(e) => setHint(e.target.value)}
                   className={inputClass} />
          </Field>

          <div className="space-y-2 pt-0.5">
            <label className="flex items-center gap-2 text-[12.5px] text-txt-secondary">
              <input type="checkbox" checked={required}
                     onChange={(e) => setRequired(e.target.checked)} />
              Must be answered
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-txt-secondary">
              <input type="checkbox" checked={sensitive}
                     onChange={(e) => setSensitive(e.target.checked)} />
              Sensitive — treat like a document number
            </label>
          </div>

          <p className="text-[11px] text-txt-light leading-relaxed border-t border-border-light pt-3">
            The name and the kind cannot be changed afterwards: stored answers
            point at the one and already are the other. A field that turns out
            wrong is retired and replaced, which keeps the old answers readable.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
