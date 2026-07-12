"use client";
import { Layers } from "lucide-react";
import ObCharts      from "@/components/charts/ObCharts";
import { useObSummary } from "@/hooks/useOb";

export default function ObSection() {
  const { data } = useObSummary();
  const vendorNames = data?.vendor_names ?? [];

  // ── Dynamic section title ──────────────────────────────────
  // 0 vendors → "BAL Own"
  // 1 vendor  → "BAL Own vs Vendor (DASHMESH)"
  // 2+ vendors → "BAL Own vs Vendors (DASHMESH · DVS)"
  const vendorLabel = vendorNames.length === 0
    ? ""
    : vendorNames.length === 1
      ? ` vs Vendor (${vendorNames[0]})`
      : ` vs Vendors (${vendorNames.join(" · ")})`;

  const title = `Over-Burden Excavation — Ore · OB · De-Silting${vendorLabel}`;

  return (
    <section className="space-y-4">

      <div className="section-title">
        <Layers size={13} />
        {title}
        <span className="ml-2 text-[9px] font-extrabold tracking-[.14em] uppercase
          text-accent bg-blue-50 px-2 py-0.5 rounded border border-accent/20">
          Daily Plan vs Actual
        </span>
      </div>

      <ObCharts />

    </section>
  );
}
