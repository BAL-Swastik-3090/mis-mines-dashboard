"use client";
import React, { useEffect, useRef, useState } from "react";
import LoginScreen from "./LoginScreen";
import Header from "./Header";
import MainLayout from "./MainLayout";
import { useAppPage } from "@/contexts/useAppPage";
import { useAuth } from "@/contexts/useAuth";
import api, { AUTH_EXPIRED_EVENT } from "@/lib/api";

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

  // Keep a session alive while someone is actually using the dashboard.
  //
  // The session row lives in the shared intranet table, and something outside
  // this application sweeps it: sessions were being closed with end_reason
  // TIMEOUT about fourteen minutes after their last recorded activity, well
  // inside this app's own thirty-minute window. So what matters is that
  // last_active_at keeps moving while someone is working, and the old approach
  // could not guarantee that — it beat on the event itself, at most every five
  // minutes, which leaves a gap whenever a burst of typing is followed by a
  // pause spent reading the form.
  //
  // Now interaction only raises a flag, and a timer decides. Someone filling in
  // a long sheet is seen every two minutes; a machine left unattended raises
  // nothing, so the tab still expires on schedule, which is the point of the
  // timeout.
  const active = useRef(false);
  useEffect(() => {
    if (!user) return;

    const mark = () => { active.current = true; };
    const events: (keyof WindowEventMap)[] = [
      "click", "keydown", "scroll", "pointerdown", "input",
    ];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    const beat = () => {
      if (!active.current || document.visibilityState === "hidden") return;
      active.current = false;
      void api.post("/auth/heartbeat").catch(() => {});
    };
    const timer = setInterval(beat, 2 * 60 * 1000);

    // Coming back to the tab counts as being here, and is the moment a stale
    // session is about to be noticed.
    const onVisible = () => { if (document.visibilityState === "visible") { mark(); beat(); } };
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
    const allowed = user.allowed_pages ?? [];
    if (allowed.length === 0) return;                       // nothing to enforce
    // Neither administration screen is in the page matrix — each is gated on the
    // permissions it needs, so both must be exempted from the allowed_pages
    // check or the guard would bounce an administrator straight off them.
    const perms = user.permissions ?? [];
    if (page === "access-control") {
      if (!perms.includes("access.users.view")) setPage(allowed[0] as typeof page);
      return;
    }
    if (page === "minehub") {
      if (!perms.includes("platform.registry.view")) setPage(allowed[0] as typeof page);
      return;
    }
    if (page === "operations") {
      if (!perms.includes("ops.shift.view")) setPage(allowed[0] as typeof page);
      return;
    }
    if (!allowed.includes(page)) setPage(allowed[0] as typeof page);
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
    setPage("mis");
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
    </>
  );
}
