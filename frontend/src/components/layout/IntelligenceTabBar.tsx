"use client";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Brain, Wrench, Download, Check, ChevronDown,
} from "lucide-react";
import { useSectionObserver } from "@/hooks/useSectionObserver";
import { useDateFilter }      from "@/contexts/useDateFilter";
import { useSidebar }         from "@/contexts/useSidebar";
import { downloadDashboard }  from "@/utils/downloadDashboard";
import { withExportMode }     from "@/contexts/useExportMode";

/**
 * Section tab bar for Intelligence — the same bar the MIS Dashboard has, with
 * this page's three sections and an export that can take one of them.
 *
 * It deliberately mirrors SectionTabBar rather than abstracting a shared one.
 * The two differ in the part that matters — MIS exports the whole page from a
 * single button, this needs a menu because a maintenance head wants Why-Why on
 * its own — and a shared component carrying both behaviours behind flags would
 * be harder to read than two files that each do one thing.
 */
const TABS = [
  { id: "intel-reality-check", label: "Reality Check",    icon: AlertTriangle },
  { id: "intel-ai-insights",   label: "AI Insights",      icon: Brain         },
  { id: "intel-why-why",       label: "Why-Why Analysis", icon: Wrench        },
] as const;

const SECTION_IDS = TABS.map((t) => t.id);

/** Header (71px) + this bar (44px). Sections carry a matching scroll-margin. */
const TOP_OFFSET = 115;

const TARGETS = [
  { id: "",                    label: "Whole page",       stem: "intelligence",     title: "Intelligence" },
  { id: "intel-reality-check", label: "Reality Check",    stem: "reality-check",    title: "Reality Check" },
  { id: "intel-ai-insights",   label: "AI Insights",      stem: "ai-insights",      title: "Operational Insights" },
  { id: "intel-why-why",       label: "Why-Why Analysis", stem: "why-why-analysis", title: "Why-Why Analysis" },
] as const;

export default function IntelligenceTabBar() {
  const activeId                          = useSectionObserver(SECTION_IDS, TOP_OFFSET);
  const { label: dateRange, periodLabel } = useDateFilter();
  const { collapsed }                     = useSidebar();

  const [open, setOpen]   = useState(false);
  const [busy, setBusy]   = useState<string | null>(null);
  const [done, setDone]   = useState(false);
  const wrap              = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function run(t: (typeof TARGETS)[number]) {
    if (busy) return;
    setBusy(t.stem);
    setDone(false);
    setOpen(false);
    try {
      // Expand everything first — React does not render collapsed content, so
      // a clone taken as-is arrives with empty expanders.
      await withExportMode(() =>
        downloadDashboard({
          dateRange,
          periodLabel,
          rootSelector: t.id ? `#${t.id}` : undefined,
          title: t.title,
          fileStem: `kaliapani-${t.stem}`,
        }),
      );
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{ left: collapsed ? "56px" : "200px" }}
      className="fixed top-[71px] right-0 z-30 bg-white border-b border-[#d0d9e8] shadow-sm h-[44px]
                 flex items-stretch transition-[left] duration-300 ease-in-out"
    >
      {/* ── Section tabs ─────────────────────────────────── */}
      <nav className="flex flex-1 overflow-x-auto scrollbar-thin min-w-0">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeId === id;
          return (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className={`
                relative flex items-center gap-[6px]
                px-4 h-full shrink-0
                font-condensed text-[11px] font-bold tracking-[.1em] uppercase
                transition-colors duration-150
                ${isActive
                  ? "text-[#c8960c]"
                  : "text-[#8899bb] hover:text-[#3a4a6b] hover:bg-[#f8fafd]"
                }
              `}
            >
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#c8960c]" />
              )}
              <Icon size={13} className="shrink-0" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Export — pinned right, with a section picker ──── */}
      <div className="shrink-0 border-l border-[#d0d9e8] flex items-center px-3 relative" ref={wrap}>
        <button
          onClick={() => setOpen(!open)}
          disabled={Boolean(busy)}
          aria-expanded={open}
          aria-haspopup="menu"
          title="Download Intelligence, or one section, as HTML"
          className={`
            flex items-center gap-[6px] px-3 py-1.5 rounded
            font-condensed text-[11px] font-bold tracking-[.08em] uppercase
            transition-all duration-150
            ${done
              ? "bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]"
              : busy
                ? "bg-[#f5f7fb] text-[#8899bb] border border-[#d0d9e8] cursor-wait"
                : "bg-[#2e7d32] text-white border border-[#2e7d32] hover:bg-[#388e3c] hover:border-[#388e3c] active:scale-95"
            }
          `}
        >
          {done
            ? <><Check size={12} className="shrink-0" /><span>Downloaded</span></>
            : busy
              ? <><span className="w-3 h-3 border border-[#b0bdd4] border-t-[#6b7ea8] rounded-full animate-spin shrink-0" /><span>Preparing…</span></>
              : <>
                  <Download size={12} className="shrink-0" /><span>Export HTML</span>
                  <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                </>
          }
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-3 top-full z-50 mt-1 w-[240px] overflow-hidden rounded-lg
                       border border-[#d0d9e8] bg-white shadow-lg"
          >
            <div className="border-b border-[#eef1f6] px-3 py-2">
              <div className="font-condensed text-[10px] font-bold uppercase tracking-[.12em] text-[#8899bb]">
                Export as HTML
              </div>
              <div className="mt-0.5 text-[11px] text-[#8899bb]">{dateRange}</div>
            </div>
            {TARGETS.map((t) => (
              <button
                key={t.stem}
                role="menuitem"
                onClick={() => run(t)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]
                           text-[#3a4a6b] hover:bg-[#f8fafd]"
              >
                <Download size={12} className="shrink-0 text-[#8899bb]" />
                {t.label}
              </button>
            ))}
            <p className="border-t border-[#eef1f6] px-3 py-2 text-[10.5px] leading-snug text-[#8899bb]">
              Every section expanded — Why chains, machine detail and the whole
              register, not just what is on screen.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
