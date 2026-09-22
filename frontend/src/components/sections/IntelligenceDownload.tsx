"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Check, ChevronDown, Loader2 } from "lucide-react";
import { downloadDashboard } from "@/utils/downloadDashboard";
import { useDateFilter } from "@/contexts/useDateFilter";
import { withExportMode } from "@/contexts/useExportMode";

/**
 * Export the Intelligence page, or one section of it, as a self-contained file.
 *
 * The MIS tab bar has exported the whole page for months; this reuses that
 * machinery rather than growing a second one — same CSS inlining, same canvas
 * snapshotting, same branded banner. All that changes is the root element and
 * the name, which is why downloadDashboard now takes a selector.
 *
 * Section-wise matters here more than on MIS. Why-Why alone runs to the
 * breakdown register and a training topic per failure; somebody sending that to
 * a maintenance head should not have to send Reality Check and the AI insights
 * with it.
 *
 * The ids below are set by IntelligenceSection. If one is missing the option is
 * hidden rather than producing an empty file.
 */
const TARGETS = [
  { id: "",                      label: "Whole page",         stem: "intelligence",      title: "Intelligence" },
  { id: "intel-reality-check",   label: "Reality Check",      stem: "reality-check",     title: "Reality Check" },
  { id: "intel-ai-insights",     label: "AI Insights",        stem: "ai-insights",       title: "Operational Insights" },
  { id: "intel-why-why",         label: "Why-Why Analysis",   stem: "why-why-analysis",  title: "Why-Why Analysis" },
] as const;

export default function IntelligenceDownload() {
  const { label: dateRange, periodLabel } = useDateFilter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

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

  async function run(t: (typeof TARGETS)[number]) {
    if (busy) return;
    setBusy(t.stem);
    setDone(null);
    try {
      // Expand every collapsible thing first, or the file arrives with empty
      // expanders — React does not render collapsed content, so the clone
      // cannot contain it.
      await withExportMode(() =>
        downloadDashboard({
          dateRange,
          periodLabel,
          // The whole page falls back to the util's own default root.
          rootSelector: t.id ? `#${t.id}` : undefined,
          title: t.title,
          fileStem: `kaliapani-${t.stem}`,
        }),
      );
      setDone(t.stem);
      setTimeout(() => setDone(null), 2500);
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative" ref={wrap}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={Boolean(busy)}
        className="flex items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-3 py-1.5
                   text-[11.5px] font-semibold text-white transition-colors hover:bg-white/20
                   disabled:opacity-60"
      >
        {busy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : done ? (
          <Check size={13} className="text-[#7fd18a]" />
        ) : (
          <Download size={13} />
        )}
        {busy ? "Preparing…" : done ? "Downloaded" : "Download"}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-[248px] overflow-hidden rounded-lg border
                     border-border bg-white shadow-lg"
        >
          <div className="border-b border-border-light px-3 py-2">
            <div className="font-condensed text-[10px] font-bold uppercase tracking-widest text-txt-muted">
              Download as HTML
            </div>
            <div className="mt-0.5 text-[11px] text-txt-muted">{dateRange}</div>
          </div>
          {TARGETS.map((t) => {
            // Hidden rather than offered and then producing an empty file.
            const present = !t.id || (typeof document !== "undefined" && document.getElementById(t.id));
            if (!present) return null;
            return (
              <button
                key={t.stem}
                role="menuitem"
                onClick={() => run(t)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]
                           text-txt-secondary hover:bg-bg-subtle"
              >
                <Download size={12} className="shrink-0 text-txt-muted" />
                {t.label}
                {busy === t.stem ? (
                  <Loader2 size={12} className="ml-auto animate-spin text-navy" />
                ) : null}
              </button>
            );
          })}
          <p className="border-t border-border-light px-3 py-2 text-[10.5px] leading-snug text-txt-muted">
            A static snapshot with every section expanded — Why chains, machine
            detail and the full register, not just the rows on screen. Charts
            are exported as images.
          </p>
        </div>
      ) : null}
    </div>
  );
}
