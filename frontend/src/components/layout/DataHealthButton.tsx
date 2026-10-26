"use client";

/**
 * Data freshness, on a button rather than across the top of the page.
 *
 * This began as a banner above every section, which was the wrong shape for
 * it: the warning is about the data behind the page, not about the page, and
 * a strip that wide reads as an error with the dashboard itself. It also
 * pushed the first card down on exactly the screens people open to read one
 * figure quickly.
 *
 * So it is a button in the header. The status is one click away and it is the
 * reader who asks for it — which is right for a condition that is true all
 * morning and needs acting on once, not for something demanding attention
 * every time the page renders.
 *
 * SEPARATE FROM THE BELL NEXT DOOR, on purpose. AlertsBell reports equipment
 * that has stopped — a weighbridge agent, a tracker — and clearing one is a
 * personal acknowledgement against a server-side list. This reports how
 * current each table is, has nothing to acknowledge, and is derived fresh
 * every time it is asked. Folding them together would mean one list where
 * "clear" meant two different things.
 *
 * THIS SECTION FIRST. The feeds behind the screen you are on are what you came
 * to check; the rest of the platform is below a rule, for whoever is looking
 * after it.
 */
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, CheckCircle2, Clock, HelpCircle } from "lucide-react";

import { useAppPage } from "@/contexts/useAppPage";
import { useAuth } from "@/contexts/useAuth";
import { canOpen } from "@/contexts/pageAccess";
import { useDataHealth } from "@/hooks/useDataHealth";
import type { DataHealthFeed, DataHealthStatus } from "@/types";

const SEVERITY: Record<DataHealthStatus, number> = {
  ok: 0, unknown: 1, warn: 2, stale: 3,
};

const ROW_TONE: Record<DataHealthStatus, string> = {
  stale: "text-red-700",
  warn: "text-amber-700",
  unknown: "text-slate-600",
  ok: "text-emerald-700",
};

const SECTION_LABEL: Record<string, string> = {
  "executive-summary": "Executive Summary",
  "mis": "MIS Dashboard",
  "oee": "OEE / LCM",
  "intelligence": "Intelligence",
  "amira": "AMIRA Accounting",
  "market": "Market Watch",
  "fuel-management": "Fuel Management",
  "ev-tracking": "Electric Vehicles Tracking",
  "workforce": "Workforce Planning",
  "usage": "Usage",
};

function Row({ f }: { f: DataHealthFeed }) {
  const Icon = f.status === "unknown" ? HelpCircle : Clock;
  return (
    <li className="px-3 py-2 border-b border-border-light last:border-0">
      <div className="flex items-start gap-2">
        <Icon size={12} className={`${ROW_TONE[f.status]} mt-0.5 shrink-0`} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-condensed font-bold text-[11px] tracking-wide
                             uppercase text-navy">
              {f.label}
            </span>
            {/* Who to chase. A SAP feed that stops is an interface for IT; a
                form that stops is a person at the mine. */}
            <span className="text-[9px] uppercase tracking-wide text-txt-light">
              {f.origin_label}
            </span>
          </div>
          <p className="text-[11px] font-mono leading-relaxed text-txt-muted mt-0.5">
            {f.message}
          </p>
        </div>
      </div>
    </li>
  );
}

export default function DataHealthButton() {
  const user = useAuth((s) => s.user);
  const { page, setPage } = useAppPage();
  const { data } = useDataHealth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Clicking away closes it, and so does Escape. A popover you can only close
  // by finding the same small button again is one people leave open.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!user || !data) return null;

  const byKey = new Map(data.feeds.map((f) => [f.key, f]));
  const pick = (keys: string[] | undefined) =>
    (keys ?? []).map((k) => byKey.get(k))
      .filter((f): f is DataHealthFeed => Boolean(f))
      .filter((f) => f.status !== "ok")
      .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status]
        || (b.days_behind ?? 0) - (a.days_behind ?? 0));

  const here = pick(data.sections?.[page]?.feeds);
  const hereKeys = new Set(here.map((f) => f.key));
  const elsewhere = data.feeds
    .filter((f) => f.status !== "ok" && !hereKeys.has(f.key))
    .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status]
      || (b.days_behind ?? 0) - (a.days_behind ?? 0));

  const total = here.length + elsewhere.length;
  const monitored = Boolean(data.sections?.[page]);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={total
          ? `${total} feed${total === 1 ? "" : "s"} behind — click for the dates`
          : "All data feeds are current"}
        aria-label="Data freshness"
        className="p-2 rounded border border-white/15 text-white/60 hover:text-white
                   hover:border-white/30 transition-colors relative"
      >
        <Activity size={15} />
        {/* A COUNT, NOT A WARNING COLOUR. The equivalent of a red pip here
            would compete with the bell beside it, which reports equipment
            that has actually stopped. Stale data is worth knowing and is
            rarely worth interrupting anybody for. */}
        {total > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full
                           bg-white/25 text-[9px] text-white/90 font-bold
                           flex items-center justify-center">
            {total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-[420px] max-w-[92vw] bg-white
                        rounded-lg shadow-xl border border-border z-50
                        max-h-[70vh] overflow-y-auto">
          <div className="px-3 py-2.5 border-b border-border bg-bg-section
                          flex items-center gap-2">
            <Activity size={13} className="text-steel" />
            <span className="font-condensed font-bold text-[11px] tracking-widest
                             uppercase text-navy">
              Data freshness
            </span>
            <span className="ml-auto text-[10px] font-mono text-txt-light">
              {data.summary.ok}/{data.summary.total} current
            </span>
          </div>

          {/* This screen */}
          <div className="px-3 pt-2.5 pb-1">
            <span className="text-[9px] font-condensed font-bold tracking-widest
                             uppercase text-txt-light">
              {SECTION_LABEL[page] ?? "This screen"}
            </span>
          </div>
          {!monitored ? (
            <p className="px-3 pb-2.5 text-[11px] font-mono text-txt-muted">
              {/* NOT the same claim as "current", and must not render as one. */}
              {data.unmonitored?.[page]
                ?? "This screen has no daily feed to be late."}
            </p>
          ) : here.length === 0 ? (
            <p className="px-3 pb-2.5 text-[11px] font-mono text-emerald-700
                          flex items-center gap-1.5">
              <CheckCircle2 size={12} />
              Everything behind this screen is current.
            </p>
          ) : (
            <ul className="border-t border-border-light">
              {here.map((f) => <Row key={f.key} f={f} />)}
            </ul>
          )}

          {/* Everywhere else */}
          {elsewhere.length > 0 && (
            <>
              <div className="px-3 pt-2.5 pb-1 border-t border-border">
                <span className="text-[9px] font-condensed font-bold tracking-widest
                                 uppercase text-txt-light">
                  Elsewhere ({elsewhere.length})
                </span>
              </div>
              <ul className="border-t border-border-light">
                {elsewhere.map((f) => <Row key={f.key} f={f} />)}
              </ul>
            </>
          )}

          {canOpen(user, "data-health") && (
            <button
              type="button"
              onClick={() => { setPage("data-health"); setOpen(false); }}
              className="w-full flex items-center gap-1.5 px-3 py-2.5 border-t
                         border-border text-[11px] font-semibold text-steel
                         hover:bg-bg-section hover:text-navy transition-colors"
            >
              Open Data Health
              <ArrowRight size={12} className="ml-auto" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
