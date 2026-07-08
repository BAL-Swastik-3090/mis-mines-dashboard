"use client";
import { LayoutDashboard, Gauge, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppPage, type AppPage } from "@/contexts/useAppPage";
import { useSidebar }               from "@/contexts/useSidebar";

const NAV_ITEMS: { id: AppPage; label: string; icon: React.ElementType }[] = [
  { id: "mis",              label: "MIS Dashboard",  icon: LayoutDashboard },
  { id: "fuel-management", label: "Fuel Management", icon: Gauge           },
];

export default function AppSidebar() {
  const { page, setPage }      = useAppPage();
  const { collapsed, toggle }  = useSidebar();

  return (
    <aside
      className={`
        fixed top-[71px] left-0 bottom-0 z-20
        bg-[#1a2744] border-r border-white/10
        flex flex-col
        transition-[width] duration-300 ease-in-out
        ${collapsed ? "w-[56px]" : "w-[200px]"}
      `}
    >
      {/* Gold accent line — mirrors header */}
      <div className="h-[2px] bg-gradient-to-r from-[#c8960c] via-[#f5a623] to-transparent shrink-0" />

      {/* Group label — hidden when collapsed */}
      {!collapsed && (
        <div className="px-4 pt-3 pb-1.5 shrink-0">
          <span className="text-[10px] font-bold tracking-[.18em] text-white/30 uppercase font-condensed">
            Operations
          </span>
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-thin">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = page === id;
          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              title={collapsed ? label : undefined}
              className={`
                w-full flex items-center gap-3
                px-3 py-2.5
                transition-colors duration-150
                relative group
                ${isActive
                  ? "bg-white/10 text-white"
                  : "text-white/55 hover:text-white/90 hover:bg-white/5"
                }
              `}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-[#f5a623]" />
              )}

              {/* Icon */}
              <Icon
                size={17}
                className={`shrink-0 transition-colors ${isActive ? "text-[#f5a623]" : "text-current"}`}
              />

              {/* Label — hidden when collapsed */}
              {!collapsed && (
                <span className="text-[12px] font-semibold tracking-wide leading-tight truncate font-condensed text-left">
                  {label}
                </span>
              )}

              {/* Tooltip — only when collapsed */}
              {collapsed && (
                <span className="
                  pointer-events-none select-none
                  absolute left-[56px] top-1/2 -translate-y-1/2
                  bg-[#0f1c35] text-white text-[11px] font-semibold
                  px-2.5 py-1 rounded shadow-lg whitespace-nowrap
                  opacity-0 group-hover:opacity-100
                  transition-opacity duration-150
                  z-50 border border-white/10
                ">
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-white/10 shrink-0">
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-full flex items-center justify-center py-3 text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
        >
          {collapsed
            ? <ChevronRight size={16} />
            : (
              <span className="flex items-center gap-2 text-[11px] font-semibold text-white/40">
                <ChevronLeft size={15} />
                Collapse
              </span>
            )
          }
        </button>
      </div>
    </aside>
  );
}
