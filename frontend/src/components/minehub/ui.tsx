"use client";
/**
 * Design system for the platform screens.
 *
 * Two rules it exists to enforce.
 *
 * Colour carries meaning, it is not decoration. Each state has one hue and
 * keeps it everywhere: expired is always rose, due is always amber, live is
 * always emerald. A status is then recognised before it is read, which is the
 * whole point of a status.
 *
 * And nothing hand-picks a colour. These screens were once built with
 * dark-surface classes on a light application and rendered white text on white
 * ground — invisible, and only found by someone screenshotting it. Reach for
 * these components instead.
 */
import React from "react";

/* ── Tone system ─────────────────────────────────────────────────────────── */
export type Tone =
  | "navy" | "gold" | "violet" | "indigo" | "teal" | "rose"
  | "amber" | "sky" | "emerald" | "slate";

const TONE: Record<Tone, { text: string; bg: string; ring: string; solid: string; dot: string }> = {
  navy:    { text: "text-navy",       bg: "bg-bg-section",  ring: "ring-border",        solid: "bg-navy",       dot: "bg-navy" },
  gold:    { text: "text-gold-dark",  bg: "bg-gold/10",     ring: "ring-gold/25",       solid: "bg-gold",       dot: "bg-gold" },
  violet:  { text: "text-violet",     bg: "bg-violet-bg",   ring: "ring-violet-ring",   solid: "bg-violet",     dot: "bg-violet-light" },
  indigo:  { text: "text-indigo",     bg: "bg-indigo-bg",   ring: "ring-indigo-ring",   solid: "bg-indigo",     dot: "bg-indigo-light" },
  teal:    { text: "text-teal",       bg: "bg-teal-bg",     ring: "ring-teal-ring",     solid: "bg-teal",       dot: "bg-teal-light" },
  rose:    { text: "text-rose",       bg: "bg-rose-bg",     ring: "ring-rose-ring",     solid: "bg-rose",       dot: "bg-rose-light" },
  amber:   { text: "text-amber",      bg: "bg-amber-bg",    ring: "ring-amber-ring",    solid: "bg-amber",      dot: "bg-amber-light" },
  sky:     { text: "text-sky",        bg: "bg-sky-bg",      ring: "ring-sky-ring",      solid: "bg-sky",        dot: "bg-sky-light" },
  emerald: { text: "text-emerald",    bg: "bg-emerald-bg",  ring: "ring-emerald-ring",  solid: "bg-emerald",    dot: "bg-emerald-light" },
  slate:   { text: "text-slate",      bg: "bg-slate-bg",    ring: "ring-slate-ring",    solid: "bg-slate",      dot: "bg-slate-light" },
};

/** The solid swatch for a tone, for callers that want a colour without a
 *  whole Chip around it — a group heading's marker, for instance. */
export const TONE_DOT: Record<Tone, string> =
  Object.fromEntries(
    (Object.keys(TONE) as Tone[]).map((k) => [k, TONE[k].solid]),
  ) as Record<Tone, string>;

/* ── Page header ─────────────────────────────────────────────────────────── */
/** Two-tone title, subtitle, and the page's primary actions on the right. */
export function PageHeader({ lead, rest, subtitle, tone = "gold", actions, icon: Icon,
                             joined = false }: {
  lead: string; rest?: string; subtitle?: string; tone?: Tone;
  actions?: React.ReactNode; icon?: React.ElementType;
  /** The two halves are one word. "MineHub Platform" is two and wants the
   *  gap; "Manpower" is one, and rendering it as "Man power" makes the
   *  heading look like a mistake. */
  joined?: boolean;
}) {
  const t = TONE[tone];
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-1">
      <div className="min-w-0 flex items-start gap-3.5">
        {Icon && (
          <span className={`shrink-0 w-11 h-11 rounded-xl ${t.bg} ring-1 ${t.ring}
                            flex items-center justify-center mt-0.5`}>
            <Icon className={`w-5 h-5 ${t.text}`} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-condensed font-extrabold text-[30px] leading-none tracking-tight text-navy">
            {lead}{rest && <span className={`${joined ? "" : "ml-2"} ${t.text}`}>{rest}</span>}
          </h1>
          {subtitle && <p className="text-[13px] text-txt-muted mt-1.5 max-w-[68ch]">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: string; icon?: React.ElementType; tone?: Tone }[];
  value: T; onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 p-1 bg-bg-section rounded-xl w-fit">
      {tabs.map((t) => {
        const on = t.id === value;
        const tone = TONE[t.tone ?? "gold"];
        const Icon = t.icon;
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold
                        transition-all duration-150
                        ${on ? "bg-bg-base text-navy shadow-sm"
                             : "text-txt-muted hover:text-navy hover:bg-bg-base/60"}`}>
            {Icon && <Icon className={`w-4 h-4 ${on ? tone.text : "text-txt-light"}`} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────── */
export function Card({ children, className = "", tone }: {
  children: React.ReactNode; className?: string; tone?: Tone;
}) {
  return (
    <section className={`bg-bg-base rounded-xl border border-border-light shadow-sm overflow-hidden
                         ${tone ? `border-t-[3px] ${TONE[tone].solid.replace("bg-", "border-t-")}` : ""}
                         ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, actions, icon: Icon, tone = "slate" }: {
  title: string; subtitle?: string; actions?: React.ReactNode;
  icon?: React.ElementType; tone?: Tone;
}) {
  const t = TONE[tone];
  return (
    <header className="px-5 py-4 border-b border-border-light flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex items-start gap-3">
        {Icon && (
          <span className={`shrink-0 w-8 h-8 rounded-lg ${t.bg} ring-1 ${t.ring} flex items-center justify-center`}>
            <Icon className={`w-4 h-4 ${t.text}`} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-semibold text-[14px] text-navy leading-tight">{title}</h2>
          {subtitle && <p className="text-[12px] text-txt-muted mt-1 max-w-[74ch]">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gold " +
  "disabled:opacity-40 disabled:cursor-not-allowed active:scale-[.98]";

export function Button({ variant = "secondary", size = "md", className = "", ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "accent" | "success" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
  }) {
  const sizes = {
    sm: "px-2.5 py-1.5 text-[11.5px]",
    md: "px-4 py-2 text-[12.5px]",
    lg: "px-5 py-2.5 text-[13.5px]",
  };
  const variants = {
    primary:   "bg-grad-gold text-white shadow-sm hover:shadow-md hover:brightness-105",
    accent:    "bg-grad-sky text-white shadow-sm hover:shadow-md hover:brightness-105",
    // Approval is the one action on these screens that means "yes, this is
    // right", and it should not look like every other button on the row.
    success:   "bg-grad-emerald text-white shadow-sm hover:shadow-md hover:brightness-105",
    secondary: "bg-bg-base text-txt-secondary border border-border hover:border-navy/30 hover:text-navy shadow-sm",
    ghost:     "text-txt-muted hover:text-navy hover:bg-bg-section",
    danger:    "text-rose hover:bg-rose-bg border border-transparent hover:border-rose-ring",
  };
  return <button className={`${BTN} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />;
}

/* ── Chip ────────────────────────────────────────────────────────────────── */
/** A status. The dot makes it readable at a glance and without relying on hue
 *  alone, which matters for anyone who cannot separate red from green. */
export function Chip({ tone = "slate", dot = true, children, title, className = "" }: {
  tone?: Tone; dot?: boolean; children: React.ReactNode; title?: string; className?: string;
}) {
  const t = TONE[tone];
  return (
    <span title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 ${t.bg} ${t.ring}
                  ${t.text} text-[11px] font-semibold whitespace-nowrap ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

/* ── Stat tile ───────────────────────────────────────────────────────────── */
export function Tile({ label, value, hint, tone = "navy", icon: Icon, onClick, active }: {
  label: string; value: React.ReactNode; hint?: string; tone?: Tone;
  icon?: React.ElementType; onClick?: () => void; active?: boolean;
}) {
  const t = TONE[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`text-left w-full bg-bg-base rounded-xl border shadow-sm px-4 py-3.5 transition-all
                  ${onClick ? "hover:shadow-md hover:-translate-y-px" : ""}
                  ${active ? "border-gold ring-2 ring-gold/20" : "border-border-light"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-condensed text-[10.5px] font-bold uppercase tracking-[.14em] text-txt-light">
          {label}
        </span>
        {Icon && (
          <span className={`w-7 h-7 rounded-lg ${t.bg} ring-1 ${t.ring} flex items-center justify-center shrink-0`}>
            <Icon className={`w-3.5 h-3.5 ${t.text}`} />
          </span>
        )}
      </div>
      <div className={`font-condensed font-extrabold text-[30px] leading-none mt-2 tabular-nums ${t.text}`}>
        {value}
      </div>
      {hint && <div className="text-[11.5px] text-txt-muted mt-1.5">{hint}</div>}
    </Tag>
  );
}

/* ── Stat bar ────────────────────────────────────────────────────────────── */
/**
 * The same figures a row of Tiles carried, in one band instead of five cards.
 *
 * Five tiles in a four-column grid left one stranded on a second row and spent
 * about four hundred pixels before a single machine was visible — on a screen
 * whose entire job is the list underneath. Five numbers do not need five cards,
 * a shadow each and a gap between them; they need to be legible and to say
 * which of them you can click.
 *
 * Hairlines come from a one-pixel gap over a coloured ground, so they stay
 * true however the grid wraps — `divide-x` draws in DOM order and puts a stray
 * rule down the left of the second row.
 */
export interface Stat {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: React.ElementType;
  /** Given, the figure is a control: clicking it narrows the list below. */
  onClick?: () => void;
  active?: boolean;
  /** What clicking does, for the tooltip. */
  title?: string;
}

export function StatBar({ items }: { items: Stat[] }) {
  return (
    <div className="rounded-xl border border-border-light shadow-sm overflow-hidden
                    bg-border-light grid gap-px
                    grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((s) => {
        const t = TONE[s.tone ?? "navy"];
        const Tag = s.onClick ? "button" : "div";
        const Icon = s.icon;
        return (
          <Tag key={s.label} onClick={s.onClick} title={s.title}
            className={`relative text-left w-full bg-bg-base px-3.5 py-3 transition-colors
                        ${s.onClick ? "hover:bg-gold/[0.05] cursor-pointer" : ""}
                        ${s.active ? "bg-gold/[0.08]" : ""}`}>
            {/* The marker for "this one is filtering" is a rule along the top
                edge rather than a ring, which inside a gapless band would
                fight the hairlines either side of it. */}
            {s.active && <span className="absolute inset-x-0 top-0 h-[3px] bg-gold" />}
            <div className="flex items-center justify-between gap-2">
              <span className={`font-condensed font-extrabold text-[26px] leading-none
                                tabular-nums ${t.text}`}>
                {s.value}
              </span>
              {Icon && <Icon className={`w-4 h-4 shrink-0 ${t.text} opacity-50`} />}
            </div>
            {/* Barlow Condensed at 9.5px with .13em of tracking is the house
                style for a table heading, where the word is one of eight and
                you already know what it says. Here it is the only name the
                figure has, so it is set the way the tabs above are set — IBM
                Plex, sentence case, actually readable at a glance. */}
            <div className="text-[12.5px] font-semibold text-txt-secondary mt-2 leading-tight">
              {s.label}
            </div>
            {s.hint && (
              <div className="text-[11.5px] text-txt-muted mt-1 leading-snug">{s.hint}</div>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */
export const inputClass =
  "w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-[13px] text-txt-primary " +
  "placeholder:text-txt-light transition-colors " +
  "focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/15";

export function Field({ label, children, hint, required }: {
  label: string; children: React.ReactNode; hint?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-txt-secondary mb-1.5">
        {label}{required && <span className="text-rose ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[10.5px] text-txt-light mt-1">{hint}</span>}
    </label>
  );
}

/* ── Feedback ────────────────────────────────────────────────────────────── */
export function Alert({ tone, children }: {
  tone: "error" | "success" | "info" | "warning"; children: React.ReactNode;
}) {
  const map = { error: "rose", success: "emerald", info: "sky", warning: "amber" } as const;
  const t = TONE[map[tone]];
  return (
    <div className={`rounded-xl ring-1 px-4 py-3 text-[12.5px] font-medium ${t.bg} ${t.ring} ${t.text}`}>
      {children}
    </div>
  );
}

/* ── Table ───────────────────────────────────────────────────────────────── */
/** A table heading.
 *
 *  It was Barlow Condensed at 10.5px, uppercase, with .12em of tracking. On a
 *  four-column table that reads as a considered caption. On a ten-column one
 *  the tracking makes every word too wide for its column, so the register's
 *  headings truncated to ATTENDANC…, EMPLOYM…, DEPARTM…, SER…, CAN … — which
 *  is a table whose columns are unlabelled.
 *
 *  Sentence case in the body face, at a size meant to be read: the same
 *  decision already taken for the figures in StatBar, for the same reason. */
export const Th = ({ children, className = "", colSpan }: {
  children?: React.ReactNode; className?: string; colSpan?: number;
}) => (
  <th colSpan={colSpan} className={`text-left text-[11.5px] font-semibold
                  text-txt-secondary px-3 py-2.5 bg-bg-light border-b border-border
                  whitespace-nowrap ${className}`}>
    {children}
  </th>
);

export const Td = ({ children, className = "", colSpan }: {
  children?: React.ReactNode; className?: string; colSpan?: number;
}) => (
  <td colSpan={colSpan}
      className={`px-3 py-2 border-b border-border-light text-[12.5px]
                  text-txt-secondary align-middle ${className}`}>
    {children}
  </td>
);

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-[13px] text-txt-light">
        {children}
      </td>
    </tr>
  );
}

/* ── Avatar ──────────────────────────────────────────────────────────────── */
/** Initials on a hue derived from the name, so the same person is always the
 *  same colour and a long list stays scannable. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const tones: Tone[] = ["violet", "indigo", "teal", "sky", "amber", "emerald", "rose"];
  const hash = [...(name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0);
  const t = TONE[tones[hash % tones.length]];
  const initials = (name || "?")
    .split(/\s+/).filter((p) => /[A-Za-z]/.test(p)).slice(0, 2)
    .map((p) => p[0]!.toUpperCase()).join("") || "?";
  const dims = size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-[11.5px]";
  return (
    <span className={`${dims} ${t.bg} ${t.text} ring-1 ${t.ring} rounded-full
                      flex items-center justify-center font-bold shrink-0`}>
      {initials}
    </span>
  );
}
