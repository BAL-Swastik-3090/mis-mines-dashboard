"use client";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { useEntryDialog } from "@/contexts/useEntryDialog";
import DesiltingPlanModal from "@/components/sections/DesiltingPlanModal";
import ShiftingActualModal from "@/components/sections/ShiftingActualModal";
import ShiftingPlanModal   from "@/components/sections/ShiftingPlanModal";
import ProductionKpiStrip from "@/components/kpi/ProductionKpiStrip";
import ProductionCharts   from "@/components/charts/ProductionCharts";
import GradeChart         from "@/components/charts/GradeChart";
import OreGradeChart      from "@/components/charts/OreGradeChart";
import DeSiltingChart     from "@/components/charts/DeSiltingChart";
import DespatchCharts     from "@/components/charts/DespatchCharts";
import GradeDespatchChart from "@/components/charts/GradeDespatchChart";
import GradeDespatchTable from "@/components/tables/GradeDespatchTable";
import DaywiseTable       from "@/components/tables/DaywiseTable";

export default function ProductionSection() {
  const dialog = useEntryDialog((s) => s.which);
  const closeDialog = useEntryDialog((s) => s.close);
  const qc = useQueryClient();

  /* The de-silting plan feeds the KPI card in this section, the day-wise
     silt_plan beneath it, and the Executive Summary's achievement. Dropping
     the ["production"] prefix covers the first two — summary and daywise are
     both nested under it — and the summary page is keyed separately.

     The dialog lives HERE because this section owns the De-Silting card the
     plan fills, which is the rule the stock dialog already follows. */
  const afterSave = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["production"] }),
      qc.invalidateQueries({ queryKey: ["executive-summary"] }),
      qc.invalidateQueries({ queryKey: ["desilting-plan"] }),
    ]);
  }, [qc]);

  /* One prefix covers the plan, the actual and their history: the plan
     screen and the actual screen read each other's data, so a save on either
     must refresh both. */
  const afterShifting = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["shifting"] });
  }, [qc]);

  return (
    <section className="space-y-4">

      <DesiltingPlanModal
        open={dialog === "desilting-plan"}
        onClose={closeDialog}
        onSaved={afterSave}
      />

      {/* Shifting lives on this section for the same reason the de-silting
          plan does: it is the mine's own day-wise movement figure, entered
          here and read here. Both dialogs invalidate the same key, so the
          actual screen sees a freshly uploaded plan without a reload. */}
      <ShiftingActualModal
        open={dialog === "shifting-actual"}
        onClose={closeDialog}
        onSaved={afterShifting}
      />
      <ShiftingPlanModal
        open={dialog === "shifting-plan"}
        onClose={closeDialog}
        onSaved={afterShifting}
      />

      {/* Section title */}
      <div className="section-title">
        <TrendingUp size={13} />
        Production Performance — Ore · Overburden · COB · Despatch
      </div>

      {/* Row 1 — KPI hero cards (Ore / OB / COB / De-Silting / Despatch) */}
      <ProductionKpiStrip />

      {/* Row 2 — Plan vs Actual charts (Ore / OB / COB) */}
      <ProductionCharts />

      {/* Row 3 — Grade-wise Ore + De-Silting side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
        <GradeChart />
        <DeSiltingChart />
      </div>

      {/* Row 4 — Weighted average Cr₂O₃ of the ore produced (full width: the
          bars are per-day per-grade and need the room) */}
      <OreGradeChart />

      {/* Row 5 — Despatch Plan charts (Overall + Location-wise) */}
      <DespatchCharts />

      {/* Row 6 — Grade-wise despatch. Sits directly under the despatch charts
          because it is despatch, shares their date filter, and its total is
          deliberately the same figure those charts report. Bars are on the
          ASSAYED Cr₂O₃ from SAP quality, joined to the outbound trips on
          PO + batch — the despatch table itself carries no grade at all.
          Chart first: the mine asked for the day-wise view as the headline, with
          the sold-as reconciliation and the caveats beneath it. */}
      <GradeDespatchChart />
      <GradeDespatchTable />

      {/* Row 6 — Day-wise production + despatch table (full width) */}
      <DaywiseTable />

    </section>
  );
}
