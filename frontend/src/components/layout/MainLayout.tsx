"use client";
import AppSidebar            from "./AppSidebar";
import SectionTabBar         from "./SectionTabBar";
import LiveTrackingSection   from "@/components/live/LiveTrackingSection";
import FuelManagementSection from "@/components/sections/FuelManagementSection";
import { useAppPage }        from "@/contexts/useAppPage";
import { useSidebar }        from "@/contexts/useSidebar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { page }      = useAppPage();
  const { collapsed } = useSidebar();
  const isMis         = page === "mis";

  const sideW = collapsed ? "56px" : "200px";

  return (
    <>
      <AppSidebar />
      {isMis && <SectionTabBar />}

      <main
        style={{ marginLeft: sideW }}
        className={`
          min-h-screen pb-8
          px-4 sm:px-6 xl:px-8
          transition-[margin-left,padding-top] duration-300 ease-in-out
          ${isMis ? "pt-[115px]" : "pt-[76px]"}
        `}
      >
        <div className="max-w-[1920px] mx-auto">
          {page === "mis"              && children}
          {page === "live-tracking"    && <LiveTrackingSection />}
          {page === "fuel-management"  && <FuelManagementSection />}
        </div>
      </main>
    </>
  );
}
