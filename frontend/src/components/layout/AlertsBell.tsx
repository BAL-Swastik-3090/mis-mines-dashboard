"use client";
/**
 * The bell, which used to be a picture of a bell with a 3 painted on it.
 *
 * It sat in the header through the whole of the WB3 outage saying "3", and the
 * one thing worth knowing — that the weighbridge had stopped sending readings
 * on Saturday morning — was not among them. A badge that is always 3 teaches
 * people that the bell means nothing, which costs you the alert that mattered.
 *
 * Now it shows what is actually wrong, for this person: the endpoint only
 * returns alerts somebody holds a permission to act on. Nobody is shown a
 * weighbridge that has gone quiet unless they could walk over and look at it,
 * or reach it.
 *
 * POLLED, NOT PUSHED. Every 60 seconds, and again when the tab is brought back
 * to the front. A websocket for one small list would be a connection to hold
 * open, reconnect, authenticate and reason about, to learn the same thing a
 * minute sooner than a poll does — on a fault whose natural unit is "since
 * Saturday".
 *
 * QUIET WHEN THERE IS NOTHING. No badge, no colour, no panel worth opening.
 * The absence of the number is the message.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, Loader2, X } from "lucide-react";
import api from "@/lib/api";
import { useAppPage, type AppPage } from "@/contexts/useAppPage";
import { useAuth } from "@/contexts/useAuth";
import { canOpen } from "@/contexts/pageAccess";

interface Alert {
  key: string;
  severity: "DOWN" | "WARN";
  kind: string;
  title: string;
  detail: string;
  since: string | null;
  minutes: number | null;
  page?: string | null;
}

const POLL_MS = 60_000;

export default function AlertsBell() {
  const user = useAuth((s) => s.user);
  const setPage = useAppPage((s) => s.setPage);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [worst, setWorst] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const r = await api.get("/alerts/live");
      setAlerts(r.data?.alerts ?? []);
      setWorst(r.data?.worst ?? null);
    } catch {
      // A bell that cannot reach the server says nothing rather than claiming
      // all is well — but it also must not throw an error into the header of
      // every page.
    } finally { setBusy(false); }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void load();
    const t = setInterval(() => { void load(); }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [user, load]);

  // Clicking away closes the panel. Escape too — it is a popover, and a
  // popover you can only close by finding the same small button again is a
  // popover people leave open.
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

  if (!user) return null;

  const n = alerts.length;
  const badge = worst === "DOWN" ? "bg-danger" : "bg-warning";

  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => { setOpen((o) => !o); void load(); }}
        title={n ? `${n} thing${n === 1 ? "" : "s"} need attention` : "Nothing needs attention"}
        className="p-2 rounded border border-white/15 text-white/60 hover:text-white
                   hover:border-white/30 transition-colors relative">
        <Bell size={15} />
        {n > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-4 h-4 px-1 ${badge} rounded-full
                            text-[9px] text-white flex items-center justify-center font-bold`}>
            {n}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-[380px] max-w-[92vw]
                        bg-bg-base rounded-xl shadow-2xl border border-border-light
                        overflow-hidden z-[60]">
          <header className="px-4 py-2.5 border-b border-border-light flex items-center
                             justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[.14em] text-txt-secondary">
              {n ? `${n} need${n === 1 ? "s" : ""} attention` : "Nothing needs attention"}
            </span>
            <span className="flex items-center gap-1.5">
              {busy && <Loader2 className="w-3 h-3 animate-spin text-txt-light" />}
              <button type="button" onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-bg-soft text-txt-light">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          </header>

          {n === 0 && (
            <p className="px-4 py-6 text-[12.5px] text-txt-light text-center">
              Everything this platform watches is reporting in.
            </p>
          )}

          <div className="max-h-[400px] overflow-auto divide-y divide-border-light">
            {alerts.map((a) => {
              const goable = a.page && canOpen(user, a.page as AppPage);
              return (
                <div key={a.key}
                  className={`px-4 py-3 ${goable ? "hover:bg-bg-soft cursor-pointer" : ""}`}
                  onClick={() => {
                    if (!goable) return;
                    setPage(a.page as AppPage);
                    setOpen(false);
                  }}>
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5
                      ${a.severity === "DOWN" ? "text-danger" : "text-warning"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-bold text-navy">{a.title}</span>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5
                                          py-0.5 rounded-full
                          ${a.severity === "DOWN"
                            ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}>
                          {a.severity === "DOWN" ? "down" : "late"}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-txt-muted mt-1 leading-snug">
                        {a.detail}
                      </p>
                      <span className="block text-[10px] text-txt-light mt-1">
                        {a.kind}{goable ? " · click to open the screen" : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
