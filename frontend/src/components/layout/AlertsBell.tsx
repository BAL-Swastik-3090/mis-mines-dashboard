"use client";
/**
 * The bell, which used to be a picture of a bell with a 3 painted on it.
 *
 * It sat in the header through the whole of the WB3 outage saying "3", and the
 * one thing worth knowing — that the weighbridge had stopped sending readings
 * on Saturday morning — was not among them. A badge that is always 3 teaches
 * people the bell means nothing, which costs you the alert that mattered.
 *
 * TWO LISTS, because they answer different questions. "Now" is what needs
 * somebody; "History" is how often this happens and for how long. A bridge that
 * drops for ten minutes every morning is a different problem from one that died
 * on Saturday, and only the second list tells them apart.
 *
 * RECOVERY IS SHOWN, not silently dropped. When the agent starts reporting
 * again the alert turns green and says how long it was out, and stays for
 * twelve hours. People want to know it came back at least as much as they
 * wanted to know it went — and a notification that vanishes leaves you unsure
 * whether it was fixed or you imagined it.
 *
 * CLEARING IS PERSONAL AND IS NOT A DELETE. "Clear all" records that THIS
 * person has read what is on the list. The fault carries on, the history keeps
 * it, and a colleague's bell is untouched — one person deciding they have seen
 * it must not take it off somebody else's screen. If it gets worse afterwards
 * it comes back, because what was cleared was the thing as it stood.
 *
 * POLLED, NOT PUSHED. Every 60 seconds and on tab focus. A websocket for one
 * small list is a connection to hold open, reconnect and authenticate, to learn
 * the same thing a minute sooner about a fault whose natural unit is "since
 * Saturday".
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Bell, CheckCircle2, Clock, History, Loader2, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAppPage, type AppPage } from "@/contexts/useAppPage";
import { useAuth } from "@/contexts/useAuth";
import { canOpen } from "@/contexts/pageAccess";

interface Alert {
  id: number; key: string;
  severity: "DOWN" | "WARN" | "OK";
  kind: string; title: string; detail: string;
  since: string | null; minutes: number | null;
  page?: string | null; resolved?: boolean;
}
interface Episode {
  alert_id: number; alert_key: string; kind: string; title: string;
  severity: string; began: string | null; resolved_at: string | null;
  lasted: string | null; ongoing: boolean;
}

const POLL_MS = 60_000;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB",
    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function AlertsBell() {
  const user = useAuth((s) => s.user);
  const setPage = useAppPage((s) => s.setPage);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [worst, setWorst] = useState<string | null>(null);
  const [past, setPast] = useState<Episode[] | null>(null);
  const [tab, setTab] = useState<"now" | "history">("now");
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
      // all is well — and must not throw an error into every page's header.
    } finally { setBusy(false); }
  }, [user]);

  const loadHistory = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.get("/alerts/history", { params: { days: 30 } });
      setPast(r.data ?? []);
    } catch { setPast([]); } finally { setBusy(false); }
  }, []);

  const clearAll = useCallback(async () => {
    setBusy(true);
    try { await api.post("/alerts/clear"); await load(); }
    catch { /* it will still be there next poll */ }
    finally { setBusy(false); }
  }, [load]);

  useEffect(() => {
    if (!user) return;
    void load();
    const t = setInterval(() => { void load(); }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, load]);

  // Clicking away closes it, and so does Escape: a popover you can only close
  // by finding the same small button again is a popover people leave open.
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

  // Recovered notices do not count towards the badge. A green "it is back" is
  // information, not a job; a number on the bell means somebody is needed.
  const needing = alerts.filter((a) => a.severity !== "OK").length;
  const badge = worst === "DOWN" ? "bg-danger" : "bg-warning";

  return (
    <div className="relative" ref={box}>
      <button type="button"
        onClick={() => { setOpen((o) => !o); void load(); }}
        title={needing
          ? `${needing} thing${needing === 1 ? "" : "s"} need attention`
          : "Nothing needs attention"}
        className="p-2 rounded border border-white/15 text-white/60 hover:text-white
                   hover:border-white/30 transition-colors relative">
        <Bell size={15} />
        {needing > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-4 h-4 px-1 ${badge} rounded-full
                            text-[9px] text-white flex items-center justify-center font-bold`}>
            {needing}
          </span>
        )}
        {needing === 0 && alerts.length > 0 && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-success rounded-full
                           ring-2 ring-[#1a2744]" title="something recovered" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-[400px] max-w-[92vw]
                        bg-bg-base rounded-xl shadow-2xl border border-border-light
                        overflow-hidden z-[60]">
          <header className="px-3 py-2 border-b border-border-light flex items-center
                             justify-between gap-2">
            <span className="flex gap-1 p-0.5 bg-bg-section rounded-lg">
              {([["now", "Now"], ["history", "History"]] as const).map(([id, label]) => (
                <button key={id} type="button"
                  onClick={() => {
                    setTab(id);
                    if (id === "history" && past === null) void loadHistory();
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11.5px] font-semibold
                              transition-colors ${tab === id
                                ? "bg-bg-base text-navy shadow-sm"
                                : "text-txt-muted hover:text-navy"}`}>
                  {label}
                  {id === "now" && needing > 0 && (
                    <span className="ml-1 text-danger">{needing}</span>
                  )}
                </button>
              ))}
            </span>
            <span className="flex items-center gap-1">
              {busy && <Loader2 className="w-3 h-3 animate-spin text-txt-light" />}
              {tab === "now" && alerts.length > 0 && (
                <button type="button" onClick={() => void clearAll()}
                  title="Mark these as read for you. It does not delete them, and it does not clear them for anybody else."
                  className="text-[11px] font-semibold text-txt-muted hover:text-navy
                             px-2 py-1 rounded hover:bg-bg-soft">
                  Clear all
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-bg-soft text-txt-light">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          </header>

          {/* ── what needs somebody now ─────────────────────────────────── */}
          {tab === "now" && (
            <>
              {alerts.length === 0 && (
                <p className="px-4 py-7 text-[12.5px] text-txt-light text-center">
                  Everything this platform watches is reporting in.
                </p>
              )}
              <div className="max-h-[420px] overflow-auto divide-y divide-border-light">
                {alerts.map((a) => {
                  const goable = a.page && canOpen(user, a.page as AppPage);
                  const good = a.severity === "OK";
                  const Icon = good ? CheckCircle2 : AlertTriangle;
                  return (
                    <div key={a.id}
                      className={`px-4 py-3 ${goable ? "hover:bg-bg-soft cursor-pointer" : ""}`}
                      onClick={() => {
                        if (!goable) return;
                        setPage(a.page as AppPage);
                        setOpen(false);
                      }}>
                      <div className="flex items-start gap-2.5">
                        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${
                          good ? "text-success"
                               : a.severity === "DOWN" ? "text-danger" : "text-warning"}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12.5px] font-bold text-navy">{a.title}</span>
                            <span className={`text-[9px] font-bold uppercase tracking-wider
                                              px-1.5 py-0.5 rounded-full ${
                              good ? "bg-success/10 text-success"
                                   : a.severity === "DOWN" ? "bg-danger/10 text-danger"
                                                           : "bg-warning/10 text-warning"}`}>
                              {good ? "back" : a.severity === "DOWN" ? "down" : "late"}
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
            </>
          )}

          {/* ── how often, and for how long ─────────────────────────────── */}
          {tab === "history" && (
            <>
              <div className="px-4 py-2 border-b border-border-light flex items-center
                              gap-1.5 text-[10.5px] text-txt-light">
                <History className="w-3 h-3" /> Last 30 days · newest first
              </div>
              {past !== null && past.length === 0 && (
                <p className="px-4 py-7 text-[12.5px] text-txt-light text-center">
                  Nothing has gone wrong in the last 30 days.
                </p>
              )}
              <div className="max-h-[420px] overflow-auto divide-y divide-border-light">
                {(past ?? []).map((e) => (
                  <div key={e.alert_id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12px] font-semibold text-navy min-w-0">
                        {e.title}
                      </span>
                      <span className={`text-[9px] font-bold uppercase tracking-wider
                                        px-1.5 py-0.5 rounded-full shrink-0 ${
                        e.ongoing ? "bg-danger/10 text-danger"
                                  : "bg-bg-section text-txt-muted"}`}>
                        {e.ongoing ? "still out" : "over"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10.5px] text-txt-light">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {e.lasted ?? "—"}
                      </span>
                      <span>{when(e.began)}</span>
                      {!e.ongoing && <span>→ {when(e.resolved_at)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
