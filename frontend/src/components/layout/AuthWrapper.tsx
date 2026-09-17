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

  // Keep a session alive while someone is actually using the dashboard. The
  // timeout is meant to catch unattended machines, not to sign out a person who
  // is reading a chart and has not triggered a fetch for half an hour. Driven by
  // real interaction and throttled, so an idle tab still expires on schedule.
  const lastBeat = useRef(0);
  useEffect(() => {
    if (!user) return;
    const beat = () => {
      const now = Date.now();
      if (now - lastBeat.current < 5 * 60 * 1000) return;   // at most every 5 min
      lastBeat.current = now;
      void api.post("/auth/heartbeat").catch(() => {});
    };
    const events: (keyof WindowEventMap)[] = ["click", "keydown", "scroll"];
    events.forEach((e) => window.addEventListener(e, beat, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, beat));
  }, [user]);

  // `page` is persisted to localStorage, so a user whose access was revoked
  // since their last visit would reload straight onto a page MainLayout no
  // longer renders — a blank screen with no way back. Send them to the first
  // page they can still open instead.
  useEffect(() => {
    if (!user) return;
    const allowed = user.allowed_pages ?? [];
    if (allowed.length === 0) return;                       // nothing to enforce
    // Role-gated pages are not in the page matrix, so they must be exempted from
    // the allowed_pages check or the guard would bounce a superadmin off them.
    if (page === "access-control") {
      if (user.mines_role !== "admin" && user.mines_role !== "superadmin") {
        setPage(allowed[0] as typeof page);
      }
      return;
    }
    if (page === "minehub") {
      if (user.mines_role !== "superadmin") setPage(allowed[0] as typeof page);
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
