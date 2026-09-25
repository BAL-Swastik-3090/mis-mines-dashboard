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
 * The list renders in a portal at the document root. It first lived inside the
 * form, where the surrounding table's `overflow-x-auto` clipped it — the
 * options ran under the next section and could not be reached. Nothing inside a
 * scrolling ancestor can escape it, so the only reliable fix is to leave the
 * container entirely and position against the input's own rectangle.
 *
 * NOT `SearchSelect`, which sits next to it in this folder. That one replaces a
 * <select>: a closed list of rows from a table — an operator, a machine, a
 * plant — that you search but cannot add to. Use this one where the value is
 * allowed to be new.
 */
import { matchesSearch } from "@/lib/search";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Loader2 } from "lucide-react";
import api from "@/lib/api";

export interface ComboOption { value: string; hint?: string }

export default function Combobox({
  category, options: staticOptions, onAddNew,
  value, onChange, placeholder, id, allowAdd = true, disabled,
}: {
  /** Pull suggestions from the lookup table under this category. */
  category?: string;
  /** Or supply them directly — for lists that live in their own table. */
  options?: ComboOption[];
  /** Create a value that is not in a supplied list. Returns what was stored. */
  onAddNew?: (value: string) => Promise<string>;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  allowAdd?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; below: boolean } | null>(null);

  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isStatic = Array.isArray(staticOptions);

  const load = useCallback(async (q: string) => {
    if (!category) return;
    setLoading(true);
    try {
      const r = await api.get("/minehub/lookups", { params: { category, q } });
      setFetched((r.data ?? []).map((o: { value: string }) => ({ value: o.value })));
    } catch { setFetched([]); } finally { setLoading(false); }
  }, [category]);

  useEffect(() => {
    if (!open || isStatic) return;
    const t = setTimeout(() => { void load(query); }, 180);
    return () => clearTimeout(t);
  }, [open, query, load, isStatic]);

  const typed = query.trim();
  const options = isStatic
    ? (staticOptions ?? []).filter((o) =>
        matchesSearch(typed, [o.value]))
    : fetched;

  /** Where to draw the list: below the input, or above it when the window ends
   *  first. Recomputed on scroll and resize so it stays attached. */
  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const below = spaceBelow > 240 || spaceBelow > r.top;
    setRect({
      top: below ? r.bottom + 4 : r.top - 4,
      left: r.left,
      width: r.width,
      below,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place, options.length]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    // capture:true so scrolling any ancestor keeps the list attached, not just
    // the window.
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const exact = options.some((o) => o.value.toLowerCase() === typed.toLowerCase());
  const canAdd = allowAdd && typed.length > 0 && !exact;

  const pick = (v: string) => { onChange(v); setQuery(""); setOpen(false); };

  const addNew = async () => {
    if (!typed) return;
    setAdding(true);
    try {
      if (onAddNew) {
        pick(await onAddNew(typed));
      } else if (category) {
        const r = await api.post("/minehub/lookups", { category, value: typed });
        pick(r.data?.value ?? typed);
      } else {
        pick(typed);
      }
    } catch {
      // Honour what the user typed even if storing it failed — losing their
      // input to a failed side effect would be the worse outcome.
      pick(typed);
    } finally { setAdding(false); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === "ArrowDown") setOpen(true); return; }
    const max = options.length + (canAdd ? 1 : 0) - 1;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, max)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight < options.length) pick(options[highlight].value);
      else if (canAdd) void addNew();
    } else if (e.key === "Escape") { setOpen(false); }
  };

  const list = open && rect ? createPortal(
    <div ref={listRef}
      style={{
        position: "fixed", left: rect.left, width: rect.width,
        ...(rect.below ? { top: rect.top } : { bottom: window.innerHeight - rect.top }),
        // Above the app's sticky header and any section banner.
        zIndex: 9999,
      }}
      className="bg-bg-base border border-border rounded-lg shadow-lg max-h-[300px] overflow-y-auto py-1">
      {loading && options.length === 0 && (
        <div className="px-3 py-2.5 text-[12px] text-txt-light flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking…
        </div>
      )}

      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button"
            onMouseEnter={() => setHighlight(i)}
            onClick={() => pick(o.value)}
            className={`w-full text-left px-3 py-2 text-[13px] flex items-center justify-between gap-2
                        ${i === highlight ? "bg-bg-section" : ""}
                        ${on ? "text-navy font-semibold" : "text-txt-primary"}`}>
            <span className="truncate">
              {o.value}
              {o.hint && <span className="text-txt-light font-normal ml-2 text-[11.5px]">{o.hint}</span>}
            </span>
            {on && <Check className="w-3.5 h-3.5 text-emerald shrink-0" />}
          </button>
        );
      })}

      {!loading && options.length === 0 && !canAdd && (
        <div className="px-3 py-3 text-[12px] text-txt-muted">
          <span className="font-medium text-txt-secondary">No entries yet.</span>
          <span className="block mt-0.5 text-txt-light">
            Start typing and the value is added to the list, so the next person picks it
            instead of retyping it.
          </span>
        </div>
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
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={anchorRef} data-combobox className="relative">
      <input
        id={id}
        disabled={disabled}
        value={open ? query : value}
        placeholder={value || placeholder}
        onFocus={() => { setOpen(true); setQuery(""); setHighlight(0); }}
        onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
        onKeyDown={onKey}
        autoComplete="off"
        className={`w-full bg-bg-base border rounded-lg pl-3 pr-8 py-2 text-[13px] text-txt-primary
                    placeholder:text-txt-light transition-colors disabled:opacity-50
                    ${open ? "border-gold ring-2 ring-gold/15" : "border-border"}
                    focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15`}
      />
      <ChevronDown className={`w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-txt-light
                               pointer-events-none transition-transform ${open ? "rotate-180" : ""}`} />
      {list}
    </div>
  );
}
