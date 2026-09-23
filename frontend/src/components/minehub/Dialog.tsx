"use client";
/**
 * Asking before something irreversible.
 *
 * window.confirm was doing this job, and it looks like what it is: a browser
 * chrome box with the page's URL at the top, OK and Cancel, no room to say what
 * is about to happen or to make "discard" look more dangerous than "keep". It
 * also blocks the thread, so nothing can be shown mid-flight.
 *
 * This is the general version, meant to be used anywhere in the application
 * that needs an answer before acting.
 */
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, Trash2, X } from "lucide-react";
import { Button } from "./ui";

export type DialogTone = "danger" | "warning" | "info";

const LOOK: Record<DialogTone, {
  icon: React.ElementType; bg: string; fg: string; confirm: "danger" | "accent" | "primary";
}> = {
  danger:  { icon: Trash2,        bg: "bg-rose-bg",    fg: "text-rose",    confirm: "danger" },
  warning: { icon: AlertTriangle, bg: "bg-amber-bg",   fg: "text-amber",   confirm: "accent" },
  info:    { icon: Info,          bg: "bg-sky-bg",     fg: "text-sky",     confirm: "primary" },
};

export default function Dialog({
  open, tone = "info", title, children,
  confirmLabel = "Confirm", cancelLabel = "Cancel",
  onConfirm, onCancel, busy, secondary, width = 560, bare = false,
}: {
  open: boolean;
  tone?: DialogTone;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** How wide the panel may grow, in pixels. 560 suits a question with a
   *  field or two. A form that would otherwise become a nine-block column the
   *  user has to scroll — the weighbridge capture is the case — is better as
   *  two columns at 880 than as a tall one at 560. */
  width?: number;
  /** Drop the tone icon and the indented body, giving the content the full
   *  panel width. For a form; a question still wants the icon. */
  bare?: boolean;
  /** A third answer, for questions that have one — "save and leave" beside
   *  "leave anyway". Cancel is not that: it is what closing the dialog means. */
  secondary?: { label: string; onClick: () => void; tone?: "danger" | "secondary" };
}) {
  const panel = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Escape cancels. The handler reads the callback through a ref so this
  // listener does not have to be torn down and rebuilt on every render.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancelRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus moves into the dialog once, when it opens — and only then.
  //
  // This used to depend on onCancel as well, which callers pass as an inline
  // arrow and therefore hand over freshly on every render. Typing a character
  // re-rendered the parent, produced a new onCancel, re-ran the effect and
  // pulled focus out of the field and onto the first button in the panel: the
  // close cross. One letter per attempt, and the next keystroke dismissed the
  // dialog.
  //
  // It also prefers the first field over the first button. Somebody opening a
  // dialog that asks for a note has come to type, and the cross is the last
  // thing that should be waiting for their next key.
  useEffect(() => {
    if (!open) return;
    const target = panel.current?.querySelector<HTMLElement>(
      "textarea, input:not([type=hidden]), select")
      ?? panel.current?.querySelector<HTMLElement>("button");
    target?.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const look = LOOK[tone];
  const Icon = look.icon;

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4
                    bg-navy/40 motion-safe:animate-[toastIn_.15s_ease-out]"
      // A click on the backdrop means "not now", the same as Cancel.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title}
        // A dialog with a lot in it — the starter patterns, a long list of
        // people — used to grow past the bottom of the screen, and
        // overflow-hidden then CLIPPED it rather than scrolling. The footer
        // went with it, so the confirm button could not be reached at all.
        // Now the panel is a column bounded by the viewport: the body
        // scrolls, the heading and the buttons stay put.
        style={{ width: `min(${width}px, 100%)` }}
        className="relative max-h-[calc(100dvh-2rem)]
                   flex flex-col bg-bg-base rounded-2xl shadow-xl
                   border border-border-light overflow-hidden">
        <button type="button" onClick={onCancel} aria-label="Close"
          className="absolute right-2.5 top-2.5 p-2 rounded-lg text-txt-light
                     hover:text-navy hover:bg-bg-light transition-colors">
          <X className="w-4 h-4" />
        </button>

        <div className={`p-5 pr-12 overflow-y-auto min-h-0
                         ${bare ? "" : "flex items-start gap-3.5"}`}>
          {!bare && (
            <span className={`w-9 h-9 rounded-xl ${look.bg} ${look.fg} flex items-center justify-center shrink-0`}>
              <Icon className="w-4.5 h-4.5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-condensed font-extrabold text-[17px] text-navy leading-tight">{title}</h3>
            <div className="text-[12.5px] text-txt-secondary leading-relaxed mt-1.5">{children}</div>
          </div>
        </div>
        <div className="px-5 py-3.5 bg-bg-light border-t border-border-light
                        shrink-0 flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>{cancelLabel}</Button>
          {secondary && (
            <Button variant={secondary.tone ?? "secondary"} size="sm"
              onClick={secondary.onClick} disabled={busy}>
              {secondary.label}
            </Button>
          )}
          <Button variant={look.confirm} size="sm" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
