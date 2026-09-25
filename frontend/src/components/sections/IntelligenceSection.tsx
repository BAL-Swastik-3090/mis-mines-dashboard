"use client";
import RealityCheckSection from "@/components/sections/RealityCheckSection";
import InsightsSection     from "@/components/sections/InsightsSection";
import WhyWhyAnalysisSection from "@/components/sections/WhyWhyAnalysisSection";

/**
 * Intelligence page — the analytical layer of the dashboard.
 *
 * Reality Check (KPI feasibility vs plan) and AI Insights (LLM-generated risks &
 * actions) used to live at the bottom of the long MIS scroll. They're pulled into
 * their own sidebar page here so they read as a deliberate "so what?" layer rather
 * than a footnote.
 *
 * The page has no banner of its own: IntelligenceTabBar carries the section
 * names, the active-section indicator and the export, the same way the MIS
 * Dashboard works. This file owns only the anchors that bar scrolls to and the
 * spacing between the three sections. scroll-mt clears the 115px of fixed
 * header and tab bar, so a tab click lands on the section rather than behind it.
 */
export default function IntelligenceSection() {

  return (
    <div className="space-y-6">
      {/* ── Reality Check — KPI feasibility vs plan ── */}
      <div id="intel-reality-check" className="scroll-mt-[124px]">
        <RealityCheckSection />
      </div>

      {/* ── AI Insights — LLM-generated risks & actions ── */}
      <div id="intel-ai-insights" className="scroll-mt-[124px]">
        <InsightsSection />
      </div>

      {/* ── Why-Why Analysis — breakdown root causes from the MPICC register.
             Charts are pure DB computation and always render; the AI reading of
             them is opt-in inside the section, so a gateway outage costs one
             card rather than the page. ── */}
      <div id="intel-why-why" className="scroll-mt-[124px]">
        <WhyWhyAnalysisSection />
      </div>
    </div>
  );
}
