"use client";
import WeatherSection      from "@/components/sections/WeatherSection";
import StockSection        from "@/components/sections/StockSection";
import PlantSection        from "@/components/sections/PlantSection";
import ProductionSection   from "@/components/sections/ProductionSection";
import ObSection           from "@/components/sections/ObSection";
import CobSection          from "@/components/sections/CobSection";
import EquipmentSection    from "@/components/sections/EquipmentSection";
import DewateringSection   from "@/components/sections/DewateringSection";
import RealityCheckSection from "@/components/sections/RealityCheckSection";
import InsightsSection     from "@/components/sections/InsightsSection";

// scroll-mt accounts for fixed header (71px) + section tab bar (44px) + breathing room
const S = "scroll-mt-[120px]";

export default function HomePage() {
  return (
    <div className="space-y-8">

      <section id="weather" className={S}>
        <WeatherSection />
      </section>

      <section id="stock" className={S}>
        <StockSection />
      </section>

      <section id="plant" className={S}>
        <PlantSection />
      </section>

      <section id="production" className={S}>
        <ProductionSection />
      </section>

      <section id="ob" className={S}>
        <ObSection />
      </section>

      <section id="cob" className={S}>
        <CobSection />
      </section>

      <section id="equipment" className={S}>
        <EquipmentSection />
      </section>

      <section id="dewatering" className={S}>
        <DewateringSection />
      </section>

      <section id="reality-check" className={S}>
        <RealityCheckSection />
      </section>

      <section id="insights" className={S}>
        <InsightsSection />
      </section>

    </div>
  );
}
