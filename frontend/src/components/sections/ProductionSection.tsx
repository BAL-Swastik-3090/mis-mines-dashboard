"use client";
import { TrendingUp } from "lucide-react";
import ProductionKpiStrip from "@/components/kpi/ProductionKpiStrip";
import ProductionCharts   from "@/components/charts/ProductionCharts";
import GradeChart         from "@/components/charts/GradeChart";
import DeSiltingChart     from "@/components/charts/DeSiltingChart";
import DaywiseTable       from "@/components/tables/DaywiseTable";

export default function ProductionSection() {
  return (
    <section className="space-y-4">

      {/* Section title */}
      <div className="section-title">
        <TrendingUp size={13} />
        Production Performance — Ore · Overburden · COB
      </div>

      {/* Row 1 — KPI hero cards */}
      <ProductionKpiStrip />

      {/* Row 2 — Plan vs Actual charts */}
      <ProductionCharts />

      {/* Row 3 — Grade-wise Ore + De-Silting side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
        <GradeChart />
        <DeSiltingChart />
      </div>

      {/* Row 4 — Day-wise production table (full width) */}
      <DaywiseTable />

    </section>
  );
}
