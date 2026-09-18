"use client";
import { Sparkles } from "lucide-react";
import RealityCheckSection from "@/components/sections/RealityCheckSection";
import InsightsSection     from "@/components/sections/InsightsSection";
import { useDateFilter }   from "@/contexts/useDateFilter";

/**
 * Intelligence page — the analytical layer of the dashboard.
 *
 * Reality Check (KPI feasibility vs plan) and AI Insights (LLM-generated risks &
 * actions) used to live at the bottom of the long MIS scroll. They're pulled into
 * their own sidebar page here so they read as a deliberate "so what?" layer rather
 * than a footnote. Both child sections keep their own titled cards, so this file
 * only owns the page banner and the spacing between them.
 */
export default function IntelligenceSection() {
  const { label: dateRange, periodLabel } = useDateFilter();

  return (
    <div className="space-y-6">
      {/* ── Page banner — mirrors the app masthead (navy + gold) ── */}
      <header className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-r from-[#1a2744] via-[#20325a] to-[#1a2744] px-5 py-4 shadow-sm">
        <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#c8960c] via-[#f5a623] to-transparent" />
        <div className="flex items-center gap-3.5">
          <div className="grid place-items-center w-11 h-11 rounded-lg bg-white/10 border border-white/15 shrink-0">
            <Sparkles size={21} className="text-[#f5a623]" />
          </div>
          <div className="min-w-0">
            <h1 className="font-condensed font-bold text-white text-[21px] leading-none tracking-wide">
              Intelligence
            </h1>
            <p className="mt-1 text-[12px] text-white/55 leading-tight">
              Reality Check &amp; AI-generated insights
              <span className="mx-1.5 text-white/25">·</span>
              <span className="text-white/70">{dateRange}</span>
              {periodLabel ? <span className="text-white/35"> ({periodLabel})</span> : null}
            </p>
          </div>
        </div>
      </header>

      {/* ── Reality Check — KPI feasibility vs plan ── */}
      <RealityCheckSection />

      {/* ── AI Insights — LLM-generated risks & actions ── */}
      <InsightsSection />
    </div>
  );
}
