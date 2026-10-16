"use client";
import React, { useEffect, useRef, useState } from "react";
import LoginScreen from "./LoginScreen";
import Header from "./Header";
import MainLayout from "./MainLayout";
import SessionExpiryDialog from "./SessionExpiryDialog";
import { useAppPage } from "@/contexts/useAppPage";
import { useAuth } from "@/contexts/useAuth";
import { canOpen, landingPage } from "@/contexts/pageAccess";
import api, { AUTH_EXPIRED_EVENT } from "@/lib/api";

/* How recently somebody must have interacted for this tab to report them
   present, and the minimum gap between reports. One write per user per two
   minutes is a fraction of the load that caused the original lock trouble. */
const BEAT_EVERY_MS = 2 * 60 * 1000;

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);
  const { setPage } = useAppPage();
  const page = useAppPage((s) => s.page);
  const user = useAuth((s) => s.user);
  const checked = useAuth((s) => s.checked);
  const refresh = useAuth((s) => s.refresh);

  // Ask the server who we are. Previously this read a token out of localStorage,
  // which meant anyone could grant themselves the UI from the browser console —
  // and the API behind it was open regardless. The session cookie is httpOnly,
  // so the server is now the only thing that can answer this.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The session can expire while the tab sits open. Without this the dashboard
  // stayed on screen with every panel showing a raw 401, which reads as the site
  // being broken rather than as having been signed out.
  useEffect(() => {
    const onExpired = (e: Event) => {
      useAuth.setState({ user: null, checked: true });
      setNotice((e as CustomEvent<{ message?: string }>).detail?.message
                ?? "You have been signed out. Please sign in again.");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  // Keep a session alive for as long as this application says it is alive.
  //
  // THE BUG. Something outside this app sweeps the shared session table and
  // closes a session about ten to twelve minutes after its last RECORDED
  // activity -- measured on this user's own rows, every TIMEOUT closure landed
  // 10-13 minutes after last_active_at, never at our own thirty. So the row
  // has to keep moving, or somebody else ends the session for us.
  //
  // The old beat had two gates, and between them they let the row go stale
  // while somebody was plainly still working:
  //
  //   1. it only fired if there had been an INTERACTION in the last two
  //      minutes -- so reading a report, studying a chart, or watching a
  //      screen during a call recorded nothing, and the sweeper took it;
  //   2. it stopped entirely when the tab was hidden -- so alt-tabbing to
  //      Excel for twelve minutes was enough, and coming back meant the login
  //      page.
  //
  // The visibility gate is gone, and the tick is finer. What this reports is
  // simply "a person was here recently"; how long that is worth is decided by
  // the server, which keeps the row fresh for the full thirty minutes on the
  // browser's behalf (services/auth.py, _real_seen). That split is what fixes
  // the hidden-tab case: a frozen background page cannot be relied on to send
  // anything, so nothing important depends on it any more.
  //
  // An unattended machine in a control room is still signed out on schedule,
  // measured from the last time a person touched it -- which is what "idle"
  // means, and what the tab being visible never did.
  const lastSeenAt = useRef(Date.now());
  const lastBeatAt = useRef(0);
  useEffect(() => {
    if (!user) return;

    const mark = () => { lastSeenAt.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = [
      "click", "keydown", "scroll", "pointerdown", "input",
    ];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    const beat = () => {
      const now = Date.now();
      // Only while somebody is ACTUALLY here. Deliberately not "within the
      // thirty-minute window": the server extends a session thirty minutes
      // from the last beat it receives, so a browser that kept beating for
      // thirty minutes after the last click would buy an hour, which is twice
      // the policy. The browser reports presence; the server decides how long
      // presence is worth. Each side owns one half and neither doubles it.
      if (now - lastSeenAt.current > BEAT_EVERY_MS) return;
      if (now - lastBeatAt.current < BEAT_EVERY_MS) return;     // too soon
      lastBeatAt.current = now;
      void api.post("/auth/heartbeat").catch(() => {
        // Let the next tick try again rather than booking the full interval
        // off: a beat that never landed is exactly the one worth repeating.
        lastBeatAt.current = 0;
      });
    };

    // Ticked every thirty seconds rather than every two minutes, because a
    // background tab has its timers throttled -- a two-minute interval can be
    // stretched past the sweeper's fuse by the very case this is here to fix.
    beat();
    const timer = setInterval(beat, 30_000);

    // Coming back to the tab counts as being here, and is the moment a stale
    // session is about to be noticed.
    const onVisible = () => {
      if (document.visibilityState === "visible") { mark(); beat(); }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [user]);

  // `page` is persisted to localStorage, so a user whose access was revoked
  // since their last visit would reload straight onto a page MainLayout no
  // longer renders — a blank screen with no way back. Send them to the first
  // page they can still open instead.
  useEffect(() => {
    if (!user) return;
    // One rule for both kinds of page — the five dashboards from the page
    // matrix, and the platform screens gated on their own permission. This
    // used to be four special cases and a fall-through, which is how the
    // Workforce page came to bounce people off itself when it was added.
    if (canOpen(user, page)) return;

    const somewhere = landingPage(user);
    // Null is a real state: somebody with access to nothing. Leaving them where
    // they are lets the page say so, which is better than a redirect loop
    // between screens they cannot open either.
    if (somewhere) setPage(somewhere);
  }, [user, page, setPage]);

  // One row in digital_apps_page_views per page the user opens, which is what
  // makes Mines visible in the shared intranet activity reporting.
  //
  // Two calls per visit, because the duration is not known on arrival:
  //   /auth/track       inserts the row when the page opens
  //   /auth/track-time  fills in time_spent_seconds when the page is left
  // Inserting once and completing it later keeps one row per visit — posting
  // again on exit would double every visit in the shared reporting.
  //
  // Fire-and-forget throughout: a failed tracking call must never interrupt the
  // dashboard.
  const prevPage = React.useRef<string | null>(null);
  const enteredAt = React.useRef<number>(Date.now());

  useEffect(() => {
    if (!user) return;
    const referrer = prevPage.current;
    const leaving = referrer;
    const seconds = Math.round((Date.now() - enteredAt.current) / 1000);

    // Close off the page being left before opening the next one.
    if (leaving && seconds > 0) {
      void api.post("/auth/track-time", { path: `/${leaving}`, time_spent: seconds })
        .catch(() => {});
    }

    prevPage.current = page;
    enteredAt.current = Date.now();
    void api.post("/auth/track", {
      path: `/${page}`,
      referrer: referrer ? `/${referrer}` : null,
    }).catch(() => {});
  }, [page, user]);

  // The last page of a visit is never "left" by navigation — the user closes the
  // tab or switches away. Without this, every session would lose the duration of
  // whatever page it ended on. keepalive lets the request outlive the page;
  // axios cannot do that, so this uses fetch directly.
  useEffect(() => {
    if (!user) return;
    const flush = () => {
      if (document.visibilityState !== "hidden") return;
      const seconds = Math.round((Date.now() - enteredAt.current) / 1000);
      if (seconds <= 0) return;
      enteredAt.current = Date.now();       // don't count the same span twice
      try {
        fetch("/api/auth/track-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: `/${page}`, time_spent: seconds }),
          keepalive: true,
        }).catch(() => {});
      } catch { /* the page is going away; nothing useful to do */ }
    };
    // visibilitychange is the reliable one — pagehide/unload are not fired at all
    // in some mobile and bfcache paths, and Chrome ignores unload for keepalive.
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [page, user]);

  const handleLoginSuccess = () => {
    setNotice(null);
    // SIGNING IN LANDS ON THE EXECUTIVE SUMMARY, not on whatever page was last
    // open. The persisted page is right for a reload — it keeps somebody where
    // they were working — and wrong for a new session, where the mine wants
    // everyone to start from the same one-screen view.
    //
    // Safe for a user who cannot open it: the effect above moves anyone off a
    // page they lack access to, onto their own highest-ranked page.
    setPage("executive-summary");
    void refresh();
  };

  if (!checked) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-[#f5f7fb]">
        <div className="w-8 h-8 border-2 border-border border-t-[#c8960c] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} notice={notice} />;
  }

  return (
    <>
      <Header />
      <MainLayout>{children}</MainLayout>
      {/* Two minutes and a button before the session closes. Being signed out
          mid-sentence costs somebody the roster they were halfway through; a
          timeout is still right, a timeout with no warning is not. */}
      <SessionExpiryDialog />
    </>
  );
}
