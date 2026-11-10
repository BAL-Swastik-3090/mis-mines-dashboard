"use client";
import { useState } from "react";
import { Check, Download, Factory, Info, Layers } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import FormulaModal from "@/components/sections/FormulaModal";
import KamLossTreeSection from "@/components/sections/KamLossTreeSection";
import LCMCobSection from "@/components/sections/LCMCobSection";
import LCMSection from "@/components/sections/LCMSection";
import { useDateFilter } from "@/contexts/useDateFilter";
import { withExportMode } from "@/contexts/useExportMode";
import { useLCM } from "@/hooks/useLCM";
import { useOEE } from "@/hooks/useOEE";
import { downloadDashboard } from "@/utils/downloadDashboard";

/**
 * The Lost Cost Matrix, on a page of its own.
 *
 * WHY IT LEFT THE OEE SCREEN. The two were one page because the LCM is
 * calculated from the OEE window and the same excavation plan, and that is
 * still true — but they are read by different people for different reasons.
 * OEE asks how the fleet performed; the LCM asks what the shortfall cost, in
 * rupees, and who owns it. Somebody arriving for the second had to scroll
 * past four machine tables to reach it, and anybody linking to it could only
 * link to the top of the OEE page.
 *
 * NOTHING ABOUT THE CALCULATION MOVED. The three blocks here are the same
 * components the OEE page mounted — the mines matrix, the plant matrix, and
 * the KAM tree derived from both. They fetch through the same hooks under the
 * same `["oee", …]` query keys, so this page and the OEE page read ONE cached
 * response rather than two: the window, the plan, the machine split and the
 * costing basis are the same objects on both screens and cannot drift apart.
 *
 * THE PERIOD IS THE GLOBAL DATE FILTER, as before. These blocks take no date
 * props; each reads `useDateFilter` itself and the server clamps the window to
 * days that have ENDED, so a filter running to today is answered for an
 * earlier day. The LCM divides a deviation by the loss hours behind it, so
 * both halves must cover the same days — which is why that clamp lives in one
 * place on the server and not in either of these screens.
 *
 * THE EXCAVATION PLAN IS NOT ENTERED HERE. It is on the OEE Master Selector,
 * reached from the entry menu, which navigates to the OEE page to open it.
 * The plan decides the ore/OB machine split this matrix divides by, so a
 * change there moves every head in this table — and one invalidation of the
 * `["oee"]` prefix refetches both screens.
 */
export default function LCMPageSection() {
  const { label: dateRange, periodLabel } = useDateFilter();
  const qc = useQueryClient();
  const [showFormulae, setShowFormulae] = useState(false);
  const [busy, setBusy] = useState(false);
  const [htmlDone, setHtmlDone] = useState(false);

  /* The same query keys the OEE page uses, so this reads the cached responses
     rather than fetching again. `machines` is wanted only to answer whether
     the plan has put a hired machine in a bucket — the badge used to assert
     "Own Equipment", which stopped being true the moment the mine could
     assign a hired one. */
  const lcmPlan = useLCM().data?.plan;
  const machines = useOEE().data?.machines ?? [];
  const hiredNames = new Set(machines.filter((m) => m.hired).map((m) => m.machine));
  const lcmHasHired = !!lcmPlan &&
    [...lcmPlan.ore, ...lcmPlan.ob].some((n) => hiredNames.has(n));

  async function handleHtml() {
    if (busy) return;
    setBusy(true);
    setHtmlDone(false);
    try {
      // Export mode first, so the loss trees render whole rather than
      // arriving as empty expanders — React does not render what is
      // collapsed, and the KAM tree is collapsed by default.
      await withExportMode(
        () =>
          downloadDashboard({
            dateRange,
            periodLabel,
            rootSelector: "#lcm-section",
            title: "LCM — Lost Cost Matrix",
            fileStem: "kaliapani-lcm",
          }),
        // The trees fetch on mount and export mode is what mounts them.
        // Without this the file keeps their skeletons.
        () => qc.isFetching(),
      );
      setHtmlDone(true);
      setTimeout(() => setHtmlDone(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    // The id is what the download points at: the whole section, nothing of
    // the chrome around it. Same mechanism the OEE and MIS exports use.
    <div id="lcm-section" className="space-y-4">

      <FormulaModal open={showFormulae} onClose={() => setShowFormulae(false)} />

      {/* ── Section header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-[#6a1b9a]" />
          <h2 className="font-condensed font-extrabold text-[15px] tracking-widest uppercase text-navy">
            LCM — Lost Cost Matrix
          </h2>
          {/* Read from the plan against the fleet rather than asserted — it
              was hardcoded "Own Equipment" and stopped being true the moment
              the mine could assign a hired machine to a bucket. */}
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-[#f3e5f5] text-[#6a1b9a] border-[#ce93d8] tracking-widest uppercase font-mono">
            {lcmHasHired ? "Own + Hired" : "Own Equipment"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* THE MACHINE SPLIT IS THE MINE'S OWN PLAN, not a line of markup.
              It was written out by hand once, which meant the heading and
              the calculation could disagree without anyone noticing. */}
          <span className="text-[10px] font-mono text-txt-muted hidden lg:inline">
            {lcmPlan
              ? <>Ore · {lcmPlan.ore.join(", ") || "—"}&nbsp;&nbsp;|&nbsp;&nbsp;OB · {lcmPlan.ob.join(", ") || "—"}</>
              : "—"}
          </span>

          <button
            type="button"
            onClick={handleHtml}
            disabled={busy}
            title="Download this section as a standalone HTML file"
            /* Deliberately the same three states as the OEE export, down to
               the colours: they do the same job and must not look like two
               different features. */
            className={`
              flex items-center gap-[6px] px-3 py-1.5 rounded
              font-condensed text-[11px] font-bold tracking-[.08em] uppercase
              transition-all duration-150
              ${htmlDone
                ? "bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]"
                : busy
                  ? "bg-[#f5f7fb] text-[#8899bb] border border-[#d0d9e8] cursor-wait"
                  : "bg-[#2e7d32] text-white border border-[#2e7d32] hover:bg-[#388e3c] hover:border-[#388e3c] active:scale-95"
              }
            `}
          >
            {htmlDone
              ? <><Check size={12} className="shrink-0" /><span>Downloaded</span></>
              : busy
                ? <><span className="w-3 h-3 border border-[#b0bdd4] border-t-[#6b7ea8] rounded-full animate-spin shrink-0" /><span>Preparing…</span></>
                : <><Download size={12} className="shrink-0" /><span>Export to HTML</span></>
            }
          </button>

          <button
            type="button"
            onClick={() => setShowFormulae(true)}
            title="View all OEE / LCM formulae"
            aria-label="View all OEE / LCM formulae"
            className="w-6 h-6 rounded-full border border-[#ce93d8] bg-[#f3e5f5] text-[#6a1b9a]
                       flex items-center justify-center hover:bg-[#e1bee7] transition-colors shrink-0"
          >
            <Info size={13} />
          </button>
        </div>
      </div>

      {/* The mines matrix: the deviation, the loss heads it is distributed
          across, and what each one cost. */}
      <LCMSection />

      {/* ── LCM for COB — the beneficiation plant, below the mines matrix ──
          A separate block rather than extra columns on the matrix above: the
          mines LCM distributes across loss heads from the shift log, and the
          plant has no downtime log to draw heads from. Different object,
          different shape, same period and costing conventions. */}
      <div className="flex items-center gap-2 pt-3">
        <Factory size={17} className="text-[#00838f]" />
        <h2 className="font-condensed font-extrabold text-[15px] tracking-widest uppercase text-navy">
          LCM for COB
        </h2>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-[#e0f7fa] text-[#00838f] border-[#80deea] tracking-widest uppercase font-mono">
          Plant 1210
        </span>
        <span className="ml-auto text-[10px] font-mono text-txt-muted hidden sm:inline">
          Concentrate deviation&nbsp;·&nbsp;feed volume vs recovery
        </span>
      </div>

      <LCMCobSection />

      {/* Re-cut of the LCM figures by accountability head. Sits after both
          blocks because it is derived from them, not a new measurement. */}
      <KamLossTreeSection />

    </div>
  );
}
