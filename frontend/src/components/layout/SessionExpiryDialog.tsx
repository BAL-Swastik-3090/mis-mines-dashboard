"use client";
/**
 * "You are about to be signed out. Stay?"
 *
 * WHY THIS EXISTS. Being signed out mid-sentence is the worst thing this
 * platform does to somebody. The half-filled roster, the machine you were
 * halfway through registering, the filter you spent a minute setting up — all
 * of it goes, and the screen that replaces it blames you for being idle.
 *
 * A timeout is still right; a timeout with no warning is not. Two minutes and
 * a button is the whole feature.
 *
 * WHEN IT APPEARS, and why eight minutes rather than twenty-eight.
 *
 * This application's own rule is thirty minutes on last_active_at. But
 * something outside it sweeps the shared session table and closes sessions
 * about ten minutes after their last RECORDED activity — measured across every
 * application on the intranet, median just under twelve minutes. So the real
 * fuse is the shorter one, and a warning pegged to our own thirty would arrive
 * twenty minutes after the session had already gone.
 *
 * Eight minutes of no interaction, then two minutes of countdown. If nobody
 * answers, this signs them out deliberately and says so — which is a better
 * ending than being bounced to a login screen by a sweeper with no explanation.
 *
 * WHAT COUNTS AS BEING HERE. The same interactions the heartbeat watches:
 * clicking, typing, scrolling, pointing. Deliberately NOT mouse movement — a
 * cursor sitting on a desk gets nudged, and a warning that a passing lorry can
 * dismiss is not protecting anybody's work.
 *
 * And while the dialog is up, only the button dismisses it. If stray input
 * could, the person who walked away would be kept signed in by the same
 * accident, which is the thing the timeout is for.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Clock, LogOut } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";

/** How long without interaction before we ask. */
const WARN_AFTER_MS = 8 * 60 * 1000;
/** How long they then have to answer. */
const GRACE_SECONDS = 120;
/** How often we check. Ten seconds is finer than the minute that matters. */
const TICK_MS = 10_000;

const WATCHED: (keyof WindowEventMap)[] = [
  "click", "keydown", "scroll", "pointerdown", "input",
];

export default function SessionExpiryDialog() {
  const user = useAuth((s) => s.user);
  const [left, setLeft] = useState<number | null>(null);   // null = not asking
  const lastSeen = useRef(Date.now());
  const asking = useRef(false);

  const stayIn = useCallback(async () => {
    asking.current = false;
    setLeft(null);
    lastSeen.current = Date.now();
    // Tell the server we are here, rather than only resetting our own clock:
    // the countdown was about last_active_at, so the fix has to reach it.
    try { await api.post("/auth/heartbeat"); } catch { /* the next one will */ }
  }, []);

  const signOut = useCallback(async () => {
    asking.current = false;
    setLeft(null);
    try { await useAuth.getState().logout(); } catch { /* going anyway */ }
  }, []);

  // Watch for signs of life.
  useEffect(() => {
    if (!user) return;
    const mark = () => {
      // While the dialog is up, only the button counts. See the note above.
      if (!asking.current) lastSeen.current = Date.now();
    };
    WATCHED.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => WATCHED.forEach((e) => window.removeEventListener(e, mark));
  }, [user]);

  // Decide when to ask.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      if (asking.current) return;
      if (Date.now() - lastSeen.current >= WARN_AFTER_MS) {
        asking.current = true;
        setLeft(GRACE_SECONDS);
      }
    }, TICK_MS);
    return () => clearInterval(t);
  }, [user]);

  // Count down, once we are asking.
  useEffect(() => {
    if (left === null) return;
    if (left <= 0) { void signOut(); return; }
    const t = setTimeout(() => setLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [left, signOut]);

  // Signing out elsewhere, or being signed out, closes this.
  useEffect(() => {
    if (!user && left !== null) { asking.current = false; setLeft(null); }
  }, [user, left]);

  if (!user || left === null) return null;

  const mm = String(Math.floor(left / 60)).padStart(1, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-[10100] bg-navy/50 backdrop-blur-sm
                    flex items-center justify-center p-4"
      role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="bg-bg-base rounded-2xl shadow-2xl w-full max-w-[420px] overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center">
          <span className="w-12 h-12 rounded-full bg-amber-bg ring-1 ring-amber-ring
                           flex items-center justify-center mx-auto mb-3">
            <Clock className="w-6 h-6 text-amber" />
          </span>
          <h2 id="idle-title"
            className="font-condensed font-extrabold text-[21px] text-navy leading-tight">
            Still there?
          </h2>
          <p className="text-[12.5px] text-txt-muted mt-1.5">
            You have not done anything for a while, so this session is about to
            close. Anything you have typed and not saved would go with it.
          </p>
          <div className="mt-4">
            <span className="font-mono font-extrabold text-[38px] text-navy tabular-nums
                             leading-none">
              {mm}:{ss}
            </span>
            <span className="block text-[10.5px] uppercase tracking-[.14em]
                             text-txt-light mt-1">
              until you are signed out
            </span>
          </div>
          {/* A bar, because a number counting down is easier to feel than to
              read when you have just looked up from something else. */}
          <span className="block h-1.5 rounded-full bg-bg-section overflow-hidden mt-3">
            <span className="block h-full rounded-full bg-amber transition-[width] duration-1000
                             ease-linear"
              style={{ width: `${(left / GRACE_SECONDS) * 100}%` }} />
          </span>
        </div>
        <div className="px-6 pb-6 pt-1 flex gap-2.5">
          <button type="button" onClick={() => void signOut()}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl
                       text-[12.5px] font-semibold text-txt-secondary bg-bg-soft
                       hover:bg-bg-section transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sign out now
          </button>
          <button type="button" onClick={() => void stayIn()} autoFocus
            className="flex-[1.4] px-4 py-2.5 rounded-xl text-[12.5px] font-bold text-navy
                       bg-gold hover:bg-gold-dark hover:text-white transition-colors
                       shadow-sm">
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
