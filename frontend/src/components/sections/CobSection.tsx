"use client";
import { FlaskConical } from "lucide-react";
import CobKpiStrip    from "@/components/kpi/CobKpiStrip";
import CobCharts      from "@/components/charts/CobCharts";
import CobDaywiseTable from "@/components/tables/CobDaywiseTable";

export default function CobSection() {
  return (
    <section className="space-y-4">

      <div className="section-title">
        <FlaskConical size={13} />
        COB Plant Analysis — Feed · Concentrate · Quality
      </div>

      {/* Row 1 — KPI cards */}
      <CobKpiStrip />

      {/* Row 2 — Charts */}
      <CobCharts />

      {/* Row 3 — Day-wise table */}
      <CobDaywiseTable />

    </section>
  );
}
