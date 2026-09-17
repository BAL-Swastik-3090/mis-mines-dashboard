"use client";
/**
 * A field whose values standardise themselves.
 *
 * Type to filter what already exists, pick one, or add what is missing without
 * leaving the form. Adding is never refused — if it were, people would type
 * into a free-text box instead and the register would fragment, which is
 * exactly how the legacy driver master ended up holding equipment types that
 * match nothing in the equipment type master.
 *
 * Choosing a value counts it, so the list reorders itself around what this mine
 * actually uses rather than staying alphabetical.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Loader2 } from "lucide-react";
import api from "@/lib/api";

interface Option { lookup_id: number; value: string; usage_count: number; is_system: boolean }

export default function Combobox({
  category, value, onChange, placeholder, id, allowAdd = true, disabled,
}: {
  category: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  allowAdd?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const r = await api.get("/minehub/lookups", { params: { category, q } });
      setOptions(r.data ?? []);
    } catch { setOptions([]); } finally { setLoading(false); }
  }, [category]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { void load(query); }, 180);
    return () => clearTimeout(t);
  }, [open, query, load]);

  // Close on a click anywhere else, so several of these on one form behave.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const typed = query.trim();
  const exact = options.some((o) => o.value.toLowerCase() === typed.toLowerCase());
  const canAdd = allowAdd && typed.length > 0 && !exact;

  const pick = (v: string) => {
    onChange(v);
    setQuery(""); setOpen(false);
  };

  const addNew = async () => {
    if (!typed) return;
    setAdding(true);
    try {
      const r = await api.post("/minehub/lookups", { category, value: typed });
      pick(r.data?.value ?? typed);
    } catch {
      // Even if it could not be saved to the list, honour what the user typed —
      // losing their input to a failed side effect would be worse.
      pick(typed);
    } finally { setAdding(false); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    const max = options.length + (canAdd ? 1 : 0) - 1;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, max)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight < options.length) pick(options[highlight].value);
      else if (canAdd) void addNew();
    } else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <input
          id={id}
          disabled={disabled}
          value={open ? query : value}
          placeholder={value || placeholder}
          onFocus={() => { setOpen(true); setQuery(""); setHighlight(0); }}
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
          onKeyDown={onKey}
          className={`w-full bg-bg-base border rounded-lg pl-3 pr-8 py-2 text-[13px] text-txt-primary
                      placeholder:text-txt-light transition-colors disabled:opacity-50
                      ${open ? "border-gold ring-2 ring-gold/15" : "border-border"}
                      focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15`}
        />
        <ChevronDown className={`w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-txt-light
                                 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-bg-base border border-border rounded-lg shadow-lg
                        max-h-[260px] overflow-y-auto py-1">
          {loading && options.length === 0 && (
            <div className="px-3 py-2.5 text-[12px] text-txt-light flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking…
            </div>
          )}

          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <button key={o.lookup_id} type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(o.value)}
                className={`w-full text-left px-3 py-2 text-[13px] flex items-center justify-between gap-2
                            ${i === highlight ? "bg-bg-section" : ""}
                            ${on ? "text-navy font-semibold" : "text-txt-primary"}`}>
                <span className="truncate">{o.value}</span>
                {on && <Check className="w-3.5 h-3.5 text-emerald shrink-0" />}
              </button>
            );
          })}

          {!loading && options.length === 0 && !canAdd && (
            <div className="px-3 py-2.5 text-[12px] text-txt-light">Nothing yet — type to add one.</div>
          )}

          {canAdd && (
            <button type="button"
              onMouseEnter={() => setHighlight(options.length)}
              onClick={addNew} disabled={adding}
              className={`w-full text-left px-3 py-2.5 text-[13px] font-semibold text-gold-dark
                          border-t border-border-light flex items-center gap-2
                          ${highlight === options.length ? "bg-gold/[0.07]" : ""}`}>
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add “{typed}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
