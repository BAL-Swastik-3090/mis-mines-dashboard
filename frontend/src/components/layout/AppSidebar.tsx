"use client";
import { LayoutDashboard, Gauge, Zap, Activity, ClipboardList,
         ChevronLeft, ChevronRight, LogOut, ExternalLink } from "lucide-react";
import { useAppPage, type AppPage } from "@/contexts/useAppPage";
import { useSidebar }               from "@/contexts/useSidebar";

/** PR/PO Status is a separate application built by another IT team. It opens in
 *  its own tab rather than being embedded, so this dashboard stays alive behind
 *  it with its date filter and scroll position intact, and whatever login that
 *  app has is handled there.
 *
 *  Overridable per environment. NEXT_PUBLIC_* is inlined at build time, so
 *  changing it still needs a rebuild — the variable only keeps the host out of
 *  the component. */
const PRPO_URL =
  process.env.NEXT_PUBLIC_PRPO_URL ?? "http://192.168.10.29:3000/requisition-status-kaliapani";

/** A nav entry is EITHER an internal page or an external link — never both.
 *
 *  External links deliberately stay out of the AppPage union and out of
 *  MainLayout's switch. `page` is persisted to localStorage, so if PR/PO were a
 *  page value, a user whose last click was PR/PO would reload into a blank
 *  screen with no section to render. */
type NavItem =
  | { kind: "page"; id: AppPage;  label: string; icon: React.ElementType }
  | { kind: "link"; href: string; label: string; icon: React.ElementType };

const NAV_ITEMS: NavItem[] = [
  { kind: "page", id: "mis",             label: "MIS Dashboard",              icon: LayoutDashboard },
  { kind: "page", id: "oee",             label: "OEE / LCM",                  icon: Activity        },
  { kind: "page", id: "fuel-management", label: "Fuel Management",            icon: Gauge           },
  { kind: "page", id: "ev-tracking",     label: "Electric Vehicles Tracking", icon: Zap             },
  { kind: "link", href: PRPO_URL,        label: "PR/PO Status",               icon: ClipboardList   },
];

const ITEM_BASE =
  "w-full flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 relative group";

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
        {NAV_ITEMS.map((item) => {
          const { label, icon: Icon } = item;
          const isLink = item.kind === "link";

          /* Label + collapsed tooltip are identical for both kinds. */
          const inner = (isActive: boolean) => (
            <>
              {isActive && (
                <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-[#f5a623]" />
              )}
              <Icon
                size={17}
                className={`shrink-0 transition-colors ${isActive ? "text-[#f5a623]" : "text-current"}`}
              />
              {!collapsed && (
                <span className="text-[12px] font-semibold tracking-wide leading-tight truncate font-condensed text-left">
                  {label}
                </span>
              )}
              {/* Leaving-the-app marker. Without it this reads as another
                  section rather than a jump to someone else's application. */}
              {isLink && !collapsed && (
                <ExternalLink size={11} className="shrink-0 ml-auto opacity-45" />
              )}
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
                  {label}{isLink ? " ↗" : ""}
                </span>
              )}
            </>
          );

          /* External: never active, never touches the persisted page. */
          if (item.kind === "link") {
            return (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                title={collapsed ? label : undefined}
                className={`${ITEM_BASE} text-white/55 hover:text-white/90 hover:bg-white/5`}
              >
                {inner(false)}
              </a>
            );
          }

          const isActive = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              title={collapsed ? label : undefined}
              className={`${ITEM_BASE} ${isActive
                ? "bg-white/10 text-white"
                : "text-white/55 hover:text-white/90 hover:bg-white/5"}`}
            >
              {inner(isActive)}
            </button>
          );
        })}
      </nav>

      {/* Logout button */}
      <div className="border-t border-white/10 shrink-0">
        <button
          onClick={() => {
            localStorage.removeItem("auth_token");
            localStorage.removeItem("auth_empid");
            localStorage.removeItem("kaliapani-app-page");
            window.location.reload();
          }}
          title={collapsed ? "Logout" : undefined}
          className="w-full flex items-center gap-3 px-3 py-3 text-white/55 hover:text-white/90 hover:bg-white/5 transition-colors group relative"
        >
          <LogOut size={16} className="shrink-0 text-danger-light group-hover:text-danger" />
          {!collapsed && (
            <span className="text-[12px] font-semibold tracking-wide leading-tight truncate font-condensed text-left">
              LOGOUT
            </span>
          )}
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
              Logout
            </span>
          )}
        </button>
      </div>

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
