"use client";
/**
 * Login — glass panel over the mine photograph.
 *
 * Aesthetic: instrument panel at dusk. The pit is the subject; the panel reads
 * as a piece of precision equipment set over it, using the engineering-drawing
 * language the dashboard already speaks — registration ticks at the corners,
 * numbered fields, mono type for anything typed, Barlow Condensed at wide
 * tracking for anything labelled.
 *
 * The photograph dictates the layout: it carries baked-in callouts down the
 * left (PRODUCTION / DESPATCH / LOSS ANALYSIS …) and widget graphics down the
 * right, so the panel is CENTRED in the clear band between them and does not
 * cover either. The photograph is shown whole and undimmed — see the background
 * block below for how, and why an earlier scrim was removed.
 *
 * The auth flow is untouched from the previous version: same endpoint, same
 * localStorage keys, same onLoginSuccess contract with AuthWrapper. This is a
 * visual rebuild only.
 */
import React, { useState } from "react";
import Image from "next/image";
import {
  Lock, User, AlertCircle, Loader2, ShieldCheck,
  Eye, EyeOff, ArrowRight,
} from "lucide-react";
import api from "@/lib/api";

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

/** Field label: "01 / EMPLOYEE ID". The index is instrument-panel language and
 *  gives the eye an anchor down the left edge of the form. */
function FieldLabel({ index, children, htmlFor }: {
  index: string; children: React.ReactNode; htmlFor: string;
}) {
  return (
    <label htmlFor={htmlFor}
           className="flex items-center gap-2 mb-2 font-condensed text-[10.5px] font-bold
                      uppercase tracking-[0.2em] text-white/45">
      <span className="text-[#f5a623]/70 font-mono text-[10px] tracking-normal">{index}</span>
      <span className="h-[1px] w-3 bg-white/20" />
      <span className="text-white/70">{children}</span>
    </label>
  );
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [empid, setEmpid] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empid.trim() || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.post("/auth/login", {
        empid: empid.trim(),
        password: password,
      });

      if (res.data && res.data.status === "success") {
        localStorage.setItem("auth_token", res.data.token);
        localStorage.setItem("auth_empid", res.data.empid);
        onLoginSuccess();
      } else {
        setError("Invalid response format from server.");
      }
    } catch (err: unknown) {
      console.error("Login failed:", err);
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    /* A self-contained full-viewport scroll container, not a page-flow div.
       Two defects drove this, both found by measuring rather than assuming:

         - An overflow-hidden viewport box CLIPPED the footer at 1440x600 — the
           size a 1366x768 laptop lands on once browser chrome and the taskbar
           are subtracted — with no way to scroll to it.
         - Letting the page scroll instead exposed `html, body { #f5f7fb }` from
           globals.css as a light band below the dark root, because the root's
           min-h-screen stops at the viewport while the panel does not.

       `fixed inset-0 overflow-y-auto` fixes both: the dark ground always covers
       the viewport and the panel scrolls inside it. `my-auto` keeps the panel
       optically centred when there is room and fully reachable when there is
       not — plain items-center leaves the overflowing top edge unscrollable. */
    <div className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-[#0b1526] select-none">
      <div aria-hidden className="fixed inset-0 overflow-hidden">

      {/* ── The photograph, whole and at its own brightness ─────────────────
          NO scrim, tint or overlay of any kind sits on the image. An earlier
          version laid a navy wash and a radial pool over it for text contrast;
          that dimmed the mine, which the user rejected. Contrast is now the
          panel's own job — see .lg-panel in globals.css — so the photograph is
          left exactly as supplied.

          TWO LAYERS, because the image is 1536x1024 (3:2) and a monitor is not:
            - The FILL layer is object-cover, scaled up and heavily blurred. It
              exists only to continue the photograph past the edges of the
              layer above, so there are no flat letterbox bars. On a 1920x1080
              screen object-contain would otherwise leave ~260px of dead colour
              down each side. It is dimmed and blurred hard on purpose: at a
              light blur it reads as a mismatched band butting against the real
              image, whereas at this strength it reads as ambient surround and
              the eye goes to the photograph. Note this dims only the SURROUND —
              the photograph itself is untouched.
            - The IMAGE layer is the photograph itself, fitted by .lg-photo-fit:
              contain on any viewport at least as wide as it is tall, so the full
              composition survives uncropped — callouts down the left, widget
              graphics down the right, the sky and the network dots at the
              bottom. On a portrait phone it falls back to cover, because contain
              there leaves a thin strip the panel covers entirely. See the rule
              in globals.css for why that is keyed on aspect ratio, not width.

          Both point at the same file, so the browser fetches and decodes it
          once and the second layer is free. */}
      <Image
        src="/Mines_Background.png"
        alt=""
        aria-hidden="true"
        fill
        priority
        quality={70}
        sizes="100vw"
        className="object-cover object-center scale-125 blur-[72px] brightness-[.78] saturate-[1.15]"
      />
      <Image
        src="/Mines_Background.png"
        alt=""
        aria-hidden="true"
        fill
        priority
        quality={88}
        sizes="100vw"
        className="lg-photo lg-photo-fit object-center"
      />
      </div>

      {/* ── The panel ───────────────────────────────────────────────────── */}
      <div className="relative z-10 min-h-full flex items-center justify-center px-4 py-8 sm:px-6">
      <div className="lg-panel lg-ticks relative my-auto w-full max-w-[420px]
                      rounded-2xl px-7 py-9 sm:px-9 sm:py-10">

        {/* Brand */}
        <div className="lg-rise text-center" style={{ animationDelay: "120ms" }}>
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl mb-4
                          border border-[#f5a623]/30 text-[#f5a623]"
               style={{ background:
                 "linear-gradient(155deg, rgba(245,166,35,.20) 0%, rgba(245,166,35,.05) 100%)",
                 boxShadow: "inset 0 1px 0 rgba(255,255,255,.18), 0 6px 18px -6px rgba(0,0,0,.7)" }}>
            <ShieldCheck size={27} strokeWidth={1.9} />
          </div>

          <div className="font-condensed text-[10px] font-bold uppercase
                          tracking-[0.28em] text-[#f5a623]/85">
            Balasore Alloys Limited
          </div>

          <h1 className="mt-1.5 font-condensed text-[26px] sm:text-[29px] font-black uppercase
                         leading-[1.05] tracking-[0.045em] text-white
                         [text-shadow:0_2px_18px_rgba(0,0,0,.55)]">
            Kaliapani<br className="sm:hidden" /> Chromite Mines
          </h1>

          {/* Calibration rule — gold at the centre, fading to nothing at both
              ends. Separates the identity from the form without a hard border. */}
          <div className="mx-auto my-4 h-[1px] w-40"
               style={{ background:
                 "linear-gradient(90deg, transparent, rgba(245,166,35,.75) 50%, transparent)" }} />

          <p className="font-mono text-[10.5px] tracking-[0.05em] text-white/50">
            MIS Portal &amp; Analytics Dashboard
          </p>
        </div>

        {/* Error — red glass. Pure #c62828 text is unreadable on a dark panel,
            so the fill carries the signal and the text is lightened. */}
        {error && (
          <div role="alert"
               className="lg-rise mt-6 flex items-start gap-2.5 rounded-lg px-3.5 py-3
                          border border-[#e53935]/35"
               style={{ background: "rgba(198,40,40,.18)" }}>
            <AlertCircle size={15} className="shrink-0 mt-[1px] text-[#ff9a94]" />
            <span className="font-condensed text-[12.5px] font-bold tracking-wide text-[#ffb3ae]">
              {error}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-7 space-y-5">

          {/* Employee ID */}
          <div className="lg-rise" style={{ animationDelay: "220ms" }}>
            <FieldLabel index="01" htmlFor="empid">Employee ID</FieldLabel>
            <div className="relative">
              <User size={15} aria-hidden
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
              <input
                id="empid"
                name="empid"
                type="text"
                required
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                value={empid}
                onChange={(e) => setEmpid(e.target.value)}
                placeholder="Enter Employee ID"
                disabled={loading}
                className="lg-field select-text w-full rounded-lg pl-10 pr-3.5 py-3
                           font-mono text-[13px] tracking-[0.04em]"
              />
            </div>
          </div>

          {/* Password — with a reveal toggle. Employee IDs and intranet
              passwords get mistyped on shared terminals; a reveal is the single
              most useful control that was missing. */}
          <div className="lg-rise" style={{ animationDelay: "300ms" }}>
            <FieldLabel index="02" htmlFor="password">Password</FieldLabel>
            <div className="relative">
              <Lock size={15} aria-hidden
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
              <input
                id="password"
                name="password"
                type={showPw ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter Password"
                disabled={loading}
                className="lg-field select-text w-full rounded-lg pl-10 pr-11 py-3
                           font-mono text-[13px] tracking-[0.04em]"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                disabled={loading}
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md
                           text-white/40 hover:text-[#f5a623] hover:bg-white/[0.07]
                           focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-[#f5a623]/50 transition-colors"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Submit. Navy on gold, not white on gold: white on #c8960c is about
              2.8:1 and fails contrast, whereas deep navy on the gold gradient is
              above 7:1 and reads as machined brass against the glass. */}
          <div className="lg-rise pt-1" style={{ animationDelay: "380ms" }}>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex items-center justify-center gap-2.5
                         rounded-lg py-3.5 font-condensed text-[13px] font-black uppercase
                         tracking-[0.2em] text-[#12203a]
                         transition-all duration-150 active:scale-[0.985]
                         disabled:opacity-65 disabled:pointer-events-none
                         focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-[#f5a623]/60 focus-visible:ring-offset-2
                         focus-visible:ring-offset-transparent"
              style={{
                background: "linear-gradient(180deg, #f7b23f 0%, #f5a623 45%, #c8960c 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,.45), 0 8px 22px -8px rgba(245,166,35,.55)",
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Signing In
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={15} strokeWidth={2.6}
                              className="transition-transform duration-200
                                         group-hover:translate-x-1" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Footer — the original's intranet note, plus a network state indicator.
            Same fact, said the way an instrument would say it. */}
        <div className="lg-rise mt-8 pt-5 border-t border-white/10"
             style={{ animationDelay: "460ms" }}>
          <div className="flex items-center justify-center gap-2.5
                          font-condensed text-[10px] font-bold uppercase
                          tracking-[0.16em] text-white/40">
            <span className="lg-dot h-1.5 w-1.5 rounded-full bg-[#43a047]" />
            <span>Validated against intranet credentials</span>
          </div>
          <div className="mt-2 text-center font-mono text-[9px]
                          tracking-[0.08em] text-white/25">
            Internal use only · Private network
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
