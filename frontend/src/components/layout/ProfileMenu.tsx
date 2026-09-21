"use client";
/**
 * Who is signed in, in the top bar rather than down the side.
 *
 * It used to sit above Sign out at the bottom of the sidebar, with every role
 * the person holds printed as a badge underneath. That is fine for somebody
 * holding one role. Sudip Hazra holds several, and the badges took up half
 * the rail — pushing the navigation the sidebar exists for up and out of
 * sight, and getting worse with every role granted.
 *
 * A top-bar avatar costs a fixed 32 pixels whatever somebody holds. The roles
 * move inside the menu, where a long list is a list rather than a layout
 * problem, and the sidebar gets its height back for navigation.
 *
 * WHY THE ROLES ARE STILL SHOWN AT ALL. Several people share a machine here.
 * "Which of us is this, and what can they do" is a question worth being able
 * to answer without opening Access Control — and when somebody is refused an
 * action, the first useful thing is seeing what they actually hold.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, IdCard, LogOut, Mail, MapPin, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/useAuth";

export default function ProfileMenu() {
  const user = useAuth((s) => s.user);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; right: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const away = (e: MouseEvent) => {
      if (menu.current?.contains(e.target as Node)) return;
      if (anchor.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // Rendered into the body, so it does not travel with the header on its
    // own. Close rather than leave it stranded beside nothing.
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  if (!user) return null;

  // Names arrive as "AKASH ." and "SWASTIK ROY CHOUDHURY", so a trailing
  // full stop must not become an initial.
  const initials = (user.name ?? "")
    .split(/\s+/)
    .filter((part) => /[A-Za-z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || (user.emp_id ?? "?").slice(0, 2);

  const facts: [React.ElementType, string, string | null][] = [
    [IdCard, "Attendance ID", user.emp_id],
    [Building2, "Department", user.department],
    [MapPin, "Location", user.plant ?? user.location],
    [Mail, "Email", user.email],
  ];

  return (
    <>
      <button ref={anchor} onClick={() => setOpen((v) => !v)}
        title={`${user.name} · ${user.emp_id}`}
        aria-haspopup="menu" aria-expanded={open}
        className={`flex items-center gap-2 rounded border px-1.5 py-1 transition-colors
                    ${open ? "border-white/35 bg-white/10"
                           : "border-white/15 hover:border-white/30"}`}>
        <span className="w-[26px] h-[26px] shrink-0 rounded-full bg-[#c8960c]/20
                         border border-[#c8960c]/40 text-[#f5a623] text-[10.5px]
                         font-bold flex items-center justify-center">
          {initials}
        </span>
        <span className="hidden lg:block max-w-[132px] text-left leading-tight">
          <span className="block text-[11.5px] font-semibold text-white/90 truncate">
            {user.name}
          </span>
          <span className="block text-[9.5px] text-white/45 truncate">
            {user.emp_id}
          </span>
        </span>
      </button>

      {open && rect && createPortal(
        <div ref={menu} role="menu"
          style={{ top: rect.top, right: rect.right }}
          className="fixed z-[200] w-[292px] rounded-xl border border-border-light
                     bg-bg-base shadow-xl overflow-hidden">

          <div className="px-4 py-3 bg-navy text-white flex items-center gap-3">
            <span className="w-10 h-10 shrink-0 rounded-full bg-[#c8960c]/20
                             border border-[#c8960c]/40 text-[#f5a623] text-[13px]
                             font-bold flex items-center justify-center">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold truncate">{user.name}</span>
              <span className="block text-[11px] text-white/55 truncate">
                {user.designation ?? user.title ?? "No designation recorded"}
              </span>
            </span>
          </div>

          <dl className="px-4 py-2.5 space-y-1.5">
            {facts.filter(([, , v]) => v).map(([Icon, label, value]) => (
              <div key={label} className="flex items-start gap-2.5">
                <Icon className="w-3.5 h-3.5 mt-[2px] shrink-0 text-txt-light" />
                <dt className="sr-only">{label}</dt>
                <dd className="text-[12px] text-txt-secondary break-words min-w-0">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {/* The whole reason this moved. However many roles somebody holds,
              they cost the sidebar nothing now. */}
          <div className="px-4 py-2.5 border-t border-border-light">
            <span className="flex items-center gap-1.5 text-[10.5px] font-bold
                             uppercase tracking-wide text-txt-light mb-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Access · {user.roles?.length ?? 0}
            </span>
            {user.roles?.length ? (
              <div className="flex flex-wrap gap-1 max-h-[132px] overflow-y-auto">
                {user.roles.map((r) => (
                  <span key={r.code} title={r.code}
                    className="px-1.5 py-0.5 rounded border border-gold/30 bg-gold/10
                               text-[10px] font-semibold text-gold-dark">
                    {r.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-txt-light">
                No roles granted. An Access Manager grants them.
              </p>
            )}
            <p className="text-[10.5px] text-txt-light mt-1.5">
              {user.permissions?.length ?? 0} permissions in total.
            </p>
          </div>

          <button
            onClick={async () => {
              setOpen(false);
              await useAuth.getState().logout();
              localStorage.removeItem("kaliapani-app-page");
              window.location.reload();
            }}
            className="w-full flex items-center gap-2 px-4 py-2.5 border-t
                       border-border-light text-[12.5px] font-semibold text-rose
                       hover:bg-rose-bg transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>, document.body)}
    </>
  );
}
