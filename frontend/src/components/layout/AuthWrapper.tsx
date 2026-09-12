"use client";
import React, { useEffect, useRef, useState } from "react";
import LoginScreen from "./LoginScreen";
import Header from "./Header";
import MainLayout from "./MainLayout";
import { useAppPage } from "@/contexts/useAppPage";
import { useAuth } from "@/contexts/useAuth";
import api, { AUTH_EXPIRED_EVENT } from "@/lib/api";

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [expired, setExpired] = useState(false);
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
    const onExpired = () => {
      useAuth.setState({ user: null, checked: true });
      setExpired(true);
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
    if (page === "access-control") {
      if (user.mines_role !== "admin") setPage(allowed[0] as typeof page);
      return;
    }
    if (!allowed.includes(page)) setPage(allowed[0] as typeof page);
  }, [user, page, setPage]);

  // One row in digital_apps_page_views per page the user opens, which is what
  // makes Mines visible in the shared intranet activity reporting. Fire-and-
  // forget: a failed tracking call must never interrupt the dashboard.
  const prevPage = React.useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const referrer = prevPage.current;
    prevPage.current = page;
    void api.post("/auth/track", { path: `/${page}`, referrer }).catch(() => {});
  }, [page, user]);

  const handleLoginSuccess = () => {
    setExpired(false);
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
    return <LoginScreen onLoginSuccess={handleLoginSuccess} expired={expired} />;
  }

  return (
    <>
      <Header />
      <MainLayout>{children}</MainLayout>
    </>
  );
}
