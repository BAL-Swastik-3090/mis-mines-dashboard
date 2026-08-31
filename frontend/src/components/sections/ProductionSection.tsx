"use client";
import { TrendingUp } from "lucide-react";
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
  return (
    <section className="space-y-4">

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
