"use client";
/**
 * The picker behind a group chip: tick the forms this person files.
 *
 * Each tick is a role. Applying the picker does not save anything on its own —
 * it hands the chosen role ids back to whoever opened it, which keeps the
 * single save that People & Access already performs as the one place a
 * person's whole role set is written. Two save paths for one row is how a
 * screen starts losing the roles it was not looking at.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Check, X, ListChecks } from "lucide-react";
import FormShell from "@/components/ui/FormShell";
import { Button } from "./ui";
import { roleNameWithin, type ApiRole, type RoleGroup } from "./roleGroups";

export default function RoleGroupPicker<T extends ApiRole>({
  group, value, subject, applyLabel = "Apply", onApply, onClose,
}: {
  group: RoleGroup<T>;
  /** Role ids already held, of any group — only this group's are read. */
  value: number[];
  /** Who it is being granted to, for the dialog's own heading. */
  subject: string;
  applyLabel?: string;
  onApply: (roleIds: number[]) => void;
  onClose: () => void;
}) {
  const ids = group.roles.map((r) => r.role_id);
  const [draft, setDraft] = useState<number[]>(() => value.filter((v) => ids.includes(v)));

  // Escape cancels. The picker is a dialog over a screen that is still there,
  // so there is something to dismiss back to -- unlike the entry forms, which
  // deliberately ignore Escape now that they are pages.
  const cancel = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  const all = draft.length === ids.length;
  const none = draft.length === 0;

  return (
    <FormShell inline={false} maxW="max-w-2xl" label={`${group.name} — choose forms`}
               panelClass="max-h-[88vh] flex flex-col" onClose={cancel}>
      <div className="flex items-start gap-3 px-5 py-4 border-b border-border-light">
        <ListChecks className="w-5 h-5 text-gold shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-txt-primary leading-tight">
            {group.name}
          </h2>
          <p className="text-[12px] text-txt-muted mt-0.5">
            {group.description ?? "Choose what this person may file."}
          </p>
          <p className="text-[11.5px] text-txt-light mt-1">For {subject}</p>
        </div>
        <button onClick={cancel} aria-label="Close"
                className="text-txt-light hover:text-txt-primary shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center justify-between px-5 py-2.5 bg-bg-light border-b border-border-light">
        <span className="text-[12px] text-txt-muted tabular-nums">
          {draft.length} of {ids.length} selected
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={all}
                  onClick={() => setDraft(ids)}>
            <Check className="w-3 h-3" /> Select all
          </Button>
          <Button size="sm" variant="ghost" disabled={none}
                  onClick={() => setDraft([])}>
            Clear all
          </Button>
        </div>
      </div>

      <div className="p-4 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
        {group.roles.map((r) => {
          const on = draft.includes(r.role_id);
          return (
            <button key={r.role_id} type="button"
              /* The functional form, not [...draft, id]: two ticks inside one
                 render — a double click, or a keyboard repeat — would both
                 read the same stale draft and the second would discard the
                 first. The tally would then say 1 of 9 after two ticks. */
              onClick={() => setDraft((d) => on ? d.filter((x) => x !== r.role_id)
                                                : [...d, r.role_id])}
              aria-pressed={on}
              className={`text-left px-3 py-2.5 rounded border transition
                ${on ? "border-gold bg-gold/[0.07]"
                     : "border-border bg-bg-base hover:border-border-strong"}`}>
              <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center shrink-0
                  ${on ? "bg-gold border-gold" : "border-border-strong bg-bg-base"}`}>
                  {on && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-txt-primary">
                    {roleNameWithin(group.name, r.name)}
                  </span>
                  {r.description && (
                    <span className="block text-[11px] text-txt-muted leading-snug mt-0.5">
                      {r.description}
                    </span>
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 px-5 py-3 border-t border-border-light bg-bg-light">
        <Button variant="primary" onClick={() => onApply(draft)}>{applyLabel}</Button>
        <Button variant="ghost" onClick={cancel}>Cancel</Button>
      </div>
    </FormShell>
  );
}
