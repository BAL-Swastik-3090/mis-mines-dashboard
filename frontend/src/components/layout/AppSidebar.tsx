"use client";
import { Activity, Boxes, CalendarRange, DoorOpen, Network, Scale, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, Gauge, LayoutDashboard, LineChart, Radar, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { useAppPage, type AppPage } from "@/contexts/useAppPage";
import { canOpen } from "@/contexts/pageAccess";
import { useSidebar }               from "@/contexts/useSidebar";
import { useAuth }                  from "@/contexts/useAuth";

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
  { kind: "page", id: "intelligence",    label: "Intelligence",               icon: Sparkles        },
  { kind: "page", id: "market",          label: "Market Watch",               icon: LineChart       },
  { kind: "page", id: "fuel-management", label: "Fuel Management",            icon: Gauge           },
  { kind: "page", id: "ev-tracking",     label: "Electric Vehicles Tracking", icon: Zap             },
  { kind: "link", href: PRPO_URL,        label: "PR/PO Status",               icon: ClipboardList   },
];

/* Two administration entries, split by audience rather than merged for tidiness.
   Access Control is an IT concern answered rarely; MineHub is operational work
   done daily. Both sit outside the page matrix — the screen that grants access
   must not be something you can revoke from yourself. */
const ACCESS_ITEM: NavItem =
  { kind: "page", id: "access-control", label: "Access Control", icon: ShieldCheck };

/* The organisation sits above the registers because everything in them is held
   against a department: a machine, a person, and soon a crate of bearings. A
   register whose owning department has no head is a register nobody answers
   for, and this is the screen that says so. */
const ORG_ITEM: NavItem =
  { kind: "page", id: "organisation", label: "Organisation", icon: Network };

const PLATFORM_ITEM: NavItem =
  { kind: "page", id: "minehub", label: "MineHub Platform", icon: Boxes };

const MANPOWER_ITEM: NavItem =
  { kind: "page", id: "manpower", label: "Manpower", icon: Users };

/* The gate is the security officer's screen, not the weighbridge operator's,
   and it sits before the bridge because that is the order of the day: a
   vehicle is admitted, then it hauls. */
const GATE_ITEM: NavItem =
  { kind: "page", id: "gate", label: "Gate", icon: DoorOpen };

/* The weighbridge is somebody's whole shift, so it sits with the operational
   screens rather than the registers. */
const WEIGHBRIDGE_ITEM: NavItem =
  { kind: "page", id: "weighbridge", label: "Weighbridge", icon: Scale };

/* Shift Control is daily work for a supervisor rather than administration, so it
   sits with the operational pages and behind its own permission — the board
   names who is on which machine. */
const OPERATIONS_ITEM: NavItem =
  { kind: "page", id: "operations", label: "Shift Control", icon: Radar };

/* The roster is planning rather than running: it deals in days nobody has
   worked yet, which is why it is its own page and its own permission rather
   than a sixth tab on the shift board. */
const WORKFORCE_ITEM: NavItem =
  { kind: "page", id: "workforce", label: "Workforce Planning", icon: CalendarRange };

const ITEM_BASE =
  "w-full flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 relative group";

export default function AppSidebar() {
  const { page, setPage }      = useAppPage();
  const { collapsed, toggle }  = useSidebar();
  const user                   = useAuth((s) => s.user);

  /* Only the pages this user may open. The same rule is enforced on the API, so
     this hides entries that would 403 anyway rather than being the gate itself
     — but hiding them matters: a tab that opens onto its own error message
     reads as a broken platform rather than a closed door.

     canOpen draws the absent/empty distinction that this used to get wrong. */
  const items: NavItem[] = [
    ...NAV_ITEMS.filter(
      (i) => i.kind === "link" || canOpen(user, i.id as AppPage),
    ),
    // Permission, not role name — a role created in the UI reaches these entries
    // without any code change.
    //
    // Ordered the way the work runs, not the way the features were built.
    // MineHub is the register everything else refers to, so it comes first;
    // then the shift being run today; then the roster that decides who runs the
    // next one. Access Control is last because it is opened about twice a
    // month, and a screen that rare sitting above daily work is a screen people
    // learn to scroll past.
    ...(canOpen(user, "organisation") ? [ORG_ITEM] : []),
    ...(canOpen(user, "minehub") ? [PLATFORM_ITEM] : []),
    ...(canOpen(user, "manpower") ? [MANPOWER_ITEM] : []),
    ...(canOpen(user, "gate") ? [GATE_ITEM] : []),
    ...(canOpen(user, "weighbridge") ? [WEIGHBRIDGE_ITEM] : []),
    ...(canOpen(user, "operations") ? [OPERATIONS_ITEM] : []),
    ...(canOpen(user, "workforce") ? [WORKFORCE_ITEM] : []),
    ...(canOpen(user, "access-control") ? [ACCESS_ITEM] : []),
  ];

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
        {items.map((item) => {
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

      {/* Who is signed in, and Sign out, both moved to the top bar.
          They lived here with every role printed as a badge, and somebody
          holding several — Sudip Hazra holds several — lost half the rail
          to them, pushing the navigation this sidebar exists for out of
          sight. An avatar in the header costs the same whatever anybody
          holds. See ProfileMenu. */}



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
