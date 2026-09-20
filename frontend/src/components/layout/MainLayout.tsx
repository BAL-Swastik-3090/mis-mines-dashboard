"use client";
import AppSidebar              from "./AppSidebar";
import SectionTabBar           from "./SectionTabBar";
import FuelManagementSection   from "@/components/sections/FuelManagementSection";
import ElectricVehiclesSection from "@/components/sections/ElectricVehiclesSection";
import OEESection              from "@/components/sections/OEESection";
import IntelligenceSection     from "@/components/sections/IntelligenceSection";
import MineHubSection          from "@/components/sections/MineHubSection";
import OperationsSection       from "@/components/sections/OperationsSection";
import WorkforceSection        from "@/components/sections/WorkforceSection";
import AccessControlSection    from "@/components/sections/AccessControlSection";
import { useAppPage }          from "@/contexts/useAppPage";
import { useSidebar }          from "@/contexts/useSidebar";
import { useAuth }             from "@/contexts/useAuth";
import { canOpen, openablePages } from "@/contexts/pageAccess";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { page }      = useAppPage();
  const { collapsed } = useSidebar();
  const user          = useAuth((s) => s.user);

  // The last line of the same rule the sidebar and the guard use. The guard
  // moves people off a page they cannot open, but it cannot move somebody who
  // has nowhere to go — and rendering the section anyway is what produced a
  // dashboard full of 403s. Say it plainly instead.
  const mayOpen  = canOpen(user, page);
  const anywhere = openablePages(user).length > 0;
  const isMis    = page === "mis" && mayOpen;

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
          {!mayOpen ? (
            <div className="py-20 max-w-xl mx-auto text-center">
              <h2 className="font-condensed font-extrabold text-[22px] text-navy">
                {anywhere ? "Not your page" : "No access yet"}
              </h2>
              <p className="mt-2 text-[13px] text-txt-muted leading-relaxed">
                {anywhere
                  ? "You do not have access to this screen. Pick one from the menu on the left."
                  : "Your account is signed in but has not been given access to any "
                    + "screen yet. An Access Manager grants it under Access Control — "
                    + "until then there is nothing here to show you."}
              </p>
              <p className="mt-4 text-[12px] text-txt-light">
                Signed in as {user?.name ?? user?.emp_id}
                {user?.roles?.length
                  ? ` · ${user.roles.map((r) => r.name).join(", ")}`
                  : " · no role"}
              </p>
            </div>
          ) : (
            <>
          {page === "mis"              && children}
          {page === "oee"              && <OEESection />}
          {page === "intelligence"     && <IntelligenceSection />}
          {page === "fuel-management"  && <FuelManagementSection />}
          {page === "ev-tracking"      && <ElectricVehiclesSection />}
          {page === "access-control"   && <AccessControlSection />}
          {page === "minehub"          && <MineHubSection />}
          {page === "operations"       && <OperationsSection />}
          {page === "workforce"        && <WorkforceSection />}
            </>
          )}
        </div>
      </main>
    </>
  );
}
