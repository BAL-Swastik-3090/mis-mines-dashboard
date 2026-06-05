"use client";
import { Archive } from "lucide-react";
import StockKpiStrip      from "@/components/kpi/StockKpiStrip";
import StockLocationTable from "@/components/tables/StockLocationTable";

export default function StockSection() {
  return (
    <section className="space-y-4">

      {/* Section title */}
      <div className="section-title">
        <Archive size={13} />
        Stock Position — Ore Inventory
      </div>

      {/* Row 1 — Grade-wise KPI cards (HG / MG / LG / LUMP / COB) */}
      <StockKpiStrip />

      {/* Row 2 — Grade × Location cross-tab matrix */}
      <StockLocationTable />

    </section>
  );
}
