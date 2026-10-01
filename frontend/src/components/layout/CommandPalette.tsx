"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CornerDownLeft, ExternalLink, Keyboard, Search } from "lucide-react";
import { useAppPage, type AppPage } from "@/contexts/useAppPage";
import { useVisibleNav, type NavItem } from "./AppSidebar";

/* Twenty screens behind a sidebar you have to read.
 *
 * Every one of them is two actions away: find the row, then click it. That is
 * fine the first week and tiring by the second, and it is worse when the
 * sidebar is collapsed to icons, which is how most people leave it.
 *
 * So: Ctrl-K, type three letters, Enter. The list is the SAME list the sidebar
 * draws -- useVisibleNav -- so the palette can never offer a screen somebody
 * cannot open. A palette with its own copy of the menu is a palette that
 * eventually offers a door that is locked.
 *
 * AND A HELP SHEET ON "?". A shortcut nobody has been told about is not a
 * feature; it is a secret. The sheet lists what exists, including the keys the
 * browser already gives you for nothing, because half of "make it keyboard
 * friendly" is telling people Tab already works.
 */

interface Shortcut { keys: string[]; what: string }

const SHORTCUTS: Shortcut[] = [
  { keys: ["Ctrl", "K"], what: "Open this list and jump to any screen" },
  { keys: ["/"], what: "The same, when you are not typing in a box" },
  { keys: ["?"], what: "Show these shortcuts" },
  { keys: ["↑", "↓"], what: "Move through the list" },
  { keys: ["Enter"], what: "Open what is highlighted" },
  { keys: ["Esc"], what: "Close this, or any dialog" },
  { keys: ["Tab"], what: "Move to the next field or button" },
  { keys: ["Shift", "Tab"], what: "Move back to the previous one" },
  { keys: ["Space"], what: "Tick the checkbox or press the button in focus" },
];

/** Typing in a box means the key belongs to the box, not to the page. */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
    || el.isContentEditable;
}

/** Letters in order, not letters adjacent: "eq3" finds "Equipment 360" and
 *  "wb" finds "Weighbridge", which is what somebody in a hurry actually
 *  types. Returns null when it does not match at all. */
function fuzzyScore(label: string, q: string): number | null {
  if (!q) return 0;
  const l = label.toLowerCase();
  const needle = q.toLowerCase();
  if (l.startsWith(needle)) return 1000;          // best: they typed the start
  if (l.includes(needle)) return 500;             // good: a word inside it
  let i = 0, hits = 0;
  for (const ch of l) {
    if (ch === needle[i]) { i += 1; hits += 1; }
    if (i === needle.length) break;
  }
  return i === needle.length ? hits : null;
}

export default function CommandPalette() {
  const items = useVisibleNav();
  const setPage = useAppPage((s) => s.setPage);
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const scored = items
      .map((it) => ({ it, score: fuzzyScore(it.label, q) }))
      .filter((r): r is { it: NavItem; score: number } => r.score !== null);
    scored.sort((a, b) => b.score - a.score);
    return scored.map((r) => r.it);
  }, [items, q]);

  const go = useCallback((it: NavItem) => {
    setOpen(false);
    setQ("");
    if (it.kind === "link") {
      // Its own tab, exactly as the sidebar opens it — this dashboard stays
      // alive behind it with its dates and scroll position intact.
      window.open(it.href, "_blank", "noopener,noreferrer");
    } else {
      setPage(it.id as AppPage);
    }
  }, [setPage]);

  // ── the keys that open it ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHelp(false);
        setOpen((v) => !v);
        return;
      }
      if (isTyping(e.target)) return;      // the box owns the key
      if (e.key === "/") { e.preventDefault(); setHelp(false); setOpen(true); }
      if (e.key === "?") { e.preventDefault(); setOpen(false); setHelp(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) { setCursor(0); inputRef.current?.focus(); }
  }, [open]);

  useEffect(() => { setCursor(0); }, [q]);

  // Keep the highlighted row on screen when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open && !help) return null;

  const close = () => { setOpen(false); setHelp(false); setQ(""); };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4"
         role="dialog" aria-modal="true"
         aria-label={help ? "Keyboard shortcuts" : "Jump to a screen"}>
      <button type="button" aria-label="Close" onClick={close}
              className="absolute inset-0 bg-navy/40 backdrop-blur-[2px] cursor-default" />

      <div className="relative w-full max-w-[520px] rounded-xl bg-white shadow-2xl
                      ring-1 ring-border overflow-hidden">
        {help ? (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border-light">
              <Keyboard className="w-4 h-4 text-gold" />
              <span className="text-[13px] font-semibold text-navy">Keyboard shortcuts</span>
            </div>
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              {SHORTCUTS.map((s) => (
                <div key={s.what} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex gap-1 shrink-0 w-[112px]">
                    {s.keys.map((k) => (
                      <kbd key={k} className="px-1.5 py-0.5 rounded border border-border
                                              bg-bg-soft text-[10.5px] font-mono text-txt-muted">
                        {k}
                      </kbd>
                    ))}
                  </span>
                  <span className="text-[12px] text-txt-primary">{s.what}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 border-b border-border-light">
              <Search className="w-4 h-4 text-txt-light shrink-0" />
              <input
                ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Go to…  try “wb”, “fuel”, “manpower”"
                aria-label="Search screens"
                className="flex-1 py-3 text-[13px] outline-none placeholder:text-txt-light"
                onKeyDown={(e) => {
                  if (e.key === "Escape") { close(); return; }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, results.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  }
                  if (e.key === "Enter" && results[cursor]) {
                    e.preventDefault();
                    go(results[cursor]);
                  }
                }}
              />
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-bg-soft
                              text-[10px] font-mono text-txt-light shrink-0">Esc</kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
              {results.length === 0 && (
                <p className="px-4 py-6 text-[12px] text-txt-muted text-center">
                  Nothing matches “{q}”. Only the screens you can open are listed.
                </p>
              )}
              {results.map((it, i) => {
                const Icon = it.icon;
                const on = i === cursor;
                return (
                  <button
                    key={it.kind === "link" ? it.href : it.id}
                    type="button" data-row={i}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(it)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left
                                ${on ? "bg-gold/10" : "hover:bg-bg-soft"}`}>
                    <Icon className={`w-4 h-4 shrink-0 ${on ? "text-gold-dark" : "text-txt-light"}`} />
                    <span className={`flex-1 text-[12.5px] ${on ? "font-semibold text-navy" : "text-txt-primary"}`}>
                      {it.label}
                    </span>
                    {it.kind === "link"
                      ? <ExternalLink className="w-3.5 h-3.5 text-txt-light shrink-0" />
                      : on && <CornerDownLeft className="w-3.5 h-3.5 text-gold-dark shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 px-4 py-2 border-t border-border-light
                            bg-bg-soft text-[10.5px] text-txt-light">
              <span className="flex items-center gap-1"><ArrowRight className="w-3 h-3" />
                {results.length} screen{results.length === 1 ? "" : "s"} you can open
              </span>
              <button type="button" onClick={() => { setOpen(false); setHelp(true); }}
                      className="ml-auto underline hover:text-navy">
                All shortcuts (?)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
