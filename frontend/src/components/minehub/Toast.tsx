"use client";
/**
 * A message that finds the reader.
 *
 * The form is taller than the screen, so an error rendered in the flow appears
 * wherever that part of the form happens to be — press Submit at the foot of
 * the sheet and the explanation lands two screens above, which reads as the
 * button doing nothing at all. A toast is fixed to the viewport instead, so it
 * is in view whatever is scrolled.
 *
 * Errors stay until they are dismissed: they usually carry an instruction, and
 * a message that removes itself while being read is worse than none. Everything
 * else clears itself, since a confirmation has nothing left to say once seen.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastTone = "error" | "success" | "info";

const LOOK: Record<ToastTone, { icon: React.ElementType; ring: string; bar: string; text: string }> = {
  error:   { icon: AlertCircle,  ring: "border-rose-ring",    bar: "bg-rose",    text: "text-rose" },
  success: { icon: CheckCircle2, ring: "border-emerald-ring", bar: "bg-emerald", text: "text-emerald" },
  info:    { icon: Info,         ring: "border-sky-ring",     bar: "bg-sky",     text: "text-sky" },
};

export default function Toast({ tone, message, onClose }: {
  tone: ToastTone;
  message: string | null;
  onClose: () => void;
}) {
  // Portals need a document, which the server render does not have.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!message || tone === "error") return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [message, tone, onClose]);

  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [message, onClose]);

  if (!ready || !message) return null;

  const look = LOOK[tone];
  const Icon = look.icon;

  return createPortal(
    <div
      // Announced to a screen reader as soon as it appears; an error interrupts,
      // a confirmation waits for a pause.
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className="fixed z-[10000] left-1/2 -translate-x-1/2 w-[min(560px,calc(100vw-32px))]
                 motion-safe:animate-[toastIn_.18s_ease-out]"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 96px)" }}
    >
      <div className={`flex items-start gap-3 rounded-xl bg-bg-base shadow-lg border ${look.ring}
                       overflow-hidden`}>
        <span className={`w-1 self-stretch ${look.bar}`} />
        <Icon className={`w-4.5 h-4.5 shrink-0 mt-3 ${look.text}`} />
        <p className="flex-1 py-3 pr-1 text-[13px] leading-snug text-txt-primary">{message}</p>
        <button type="button" onClick={onClose} aria-label="Dismiss"
          className="p-3 text-txt-light hover:text-navy transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
