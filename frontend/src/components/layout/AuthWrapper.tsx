"use client";
import React, { useEffect } from "react";
import LoginScreen from "./LoginScreen";
import Header from "./Header";
import MainLayout from "./MainLayout";
import { useAppPage } from "@/contexts/useAppPage";
import { useAuth } from "@/contexts/useAuth";
import api from "@/lib/api";

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
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
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <>
      <Header />
      <MainLayout>{children}</MainLayout>
    </>
  );
}
