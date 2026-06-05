"use client";
import StockSection       from "@/components/sections/StockSection";
import StockAllLocations  from "@/components/kpi/StockAllLocations";
import PlantSection       from "@/components/sections/PlantSection";
import ProductionSection  from "@/components/sections/ProductionSection";
import ObSection          from "@/components/sections/ObSection";
import CobSection         from "@/components/sections/CobSection";

export default function HomePage() {
  return (
    <div className="space-y-8 pb-8">
      <StockSection />
      <StockAllLocations />
      <PlantSection />
      <ProductionSection />
      <ObSection />
      <CobSection />
    </div>
  );
}
