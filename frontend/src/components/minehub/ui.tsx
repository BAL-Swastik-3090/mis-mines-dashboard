"use client";
/**
 * Shared surfaces for the MineHub platform screens.
 *
 * The dashboard is a LIGHT application — white cards on #f5f7fb, navy text,
 * gold accents — and these screens were first built with dark-surface colours,
 * which rendered white text on a white ground and made whole panels unreadable.
 * Everything here uses the design tokens in tailwind.config.ts so that cannot
 * happen again by hand: reach for these rather than raw colours.
 */
import React from "react";

/* ── Card ────────────────────────────────────────────────────────────────── */
export function Card({ children, className = "" }: {
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-bg-base border border-border-light rounded-lg shadow-sm ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: React.ReactNode;
}) {
  return (
    <header className="px-4 py-3 border-b border-border-light flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-condensed font-bold text-[14px] tracking-wide uppercase text-navy">
          {title}
        </h2>
        {subtitle && <p className="text-[11.5px] text-txt-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
const BTN_BASE =
  "inline-flex items-center gap-1.5 rounded font-semibold transition-colors " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:opacity-40 " +
  "disabled:cursor-not-allowed";

export function Button({ variant = "secondary", size = "md", className = "", ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md";
  }) {
  const sizes = { sm: "px-2.5 py-1 text-[11.5px]", md: "px-3.5 py-1.5 text-[12.5px]" };
  const variants = {
    primary:   "bg-gold text-white hover:bg-gold-dark shadow-sm",
    secondary: "bg-bg-base text-txt-secondary border border-border hover:border-border-strong hover:text-navy",
    ghost:     "text-txt-muted hover:text-navy hover:bg-bg-section",
    danger:    "text-danger hover:bg-danger-bg border border-transparent hover:border-danger/20",
  };
  return <button className={`${BTN_BASE} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />;
}

/* ── Badge ───────────────────────────────────────────────────────────────── */
export function Badge({ tone = "neutral", children, title }: {
  tone?: "neutral" | "gold" | "success" | "warning" | "danger" | "info";
  children: React.ReactNode; title?: string;
}) {
  const tones = {
    neutral: "bg-bg-section text-txt-secondary border-border",
    gold:    "bg-gold/10 text-gold-dark border-gold/30",
    success: "bg-success-bg text-success border-success/25",
    warning: "bg-warning-bg text-warning border-warning/25",
    danger:  "bg-danger-bg text-danger border-danger/25",
    info:    "bg-accent/10 text-accent-dark border-accent/25",
  };
  return (
    <span title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/* ── Stat tile ───────────────────────────────────────────────────────────── */
export function Tile({ label, value, hint, tone = "navy" }: {
  label: string; value: React.ReactNode; hint?: string; tone?: "navy" | "gold" | "warning";
}) {
  const tones = { navy: "text-navy", gold: "text-gold-dark", warning: "text-warning" };
  return (
    <div className="bg-bg-base border border-border-light rounded-lg shadow-sm px-4 py-3">
      <div className="font-condensed text-[10px] font-bold uppercase tracking-[.14em] text-txt-light">
        {label}
      </div>
      <div className={`font-condensed font-extrabold text-[26px] leading-none mt-1.5 tabular-nums ${tones[tone]}`}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-txt-muted mt-1">{hint}</div>}
    </div>
  );
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */
export const inputClass =
  "w-full bg-bg-base border border-border rounded px-3 py-2 text-[13px] text-txt-primary " +
  "placeholder:text-txt-light focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30";

export function Field({ label, children, hint }: {
  label: string; children: React.ReactNode; hint?: string;
}) {
  return (
    <label className="block">
      <span className="block font-condensed text-[10px] font-bold uppercase tracking-[.12em] text-txt-light mb-1">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-txt-light mt-1">{hint}</span>}
    </label>
  );
}

/* ── Feedback ────────────────────────────────────────────────────────────── */
export function Alert({ tone, children }: {
  tone: "error" | "success" | "info"; children: React.ReactNode;
}) {
  const tones = {
    error:   "bg-danger-bg border-danger/25 text-danger",
    success: "bg-success-bg border-success/25 text-success",
    info:    "bg-accent/5 border-accent/20 text-accent-dark",
  };
  return (
    <div className={`rounded border px-3 py-2.5 text-[12.5px] ${tones[tone]}`}>{children}</div>
  );
}

/* ── Table helpers ───────────────────────────────────────────────────────── */
export const Th = ({ children, className = "" }: {
  children?: React.ReactNode; className?: string;
}) => (
  <th className={`text-left font-condensed text-[10.5px] font-bold uppercase tracking-[.1em]
                  text-txt-light px-3 py-2 border-b border-border ${className}`}>
    {children}
  </th>
);

export const Td = ({ children, className = "" }: {
  children?: React.ReactNode; className?: string;
}) => (
  <td className={`px-3 py-2.5 border-b border-border-light text-[12.5px] text-txt-secondary align-top ${className}`}>
    {children}
  </td>
);

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-[12.5px] text-txt-light">
        {children}
      </td>
    </tr>
  );
}
