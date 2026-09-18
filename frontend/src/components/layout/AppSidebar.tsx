"use client";
import {
  Radar, LayoutDashboard, Gauge, Zap, Activity, ClipboardList, Sparkles, Boxes, ShieldCheck,
         ChevronLeft, ChevronRight, LogOut, ExternalLink, CalendarRange } from "lucide-react";
import { useAppPage, type AppPage } from "@/contexts/useAppPage";
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

const PLATFORM_ITEM: NavItem =
  { kind: "page", id: "minehub", label: "MineHub Platform", icon: Boxes };

/* Shift Control is daily work for a supervisor rather than administration, so it
   sits with the operational pages and behind its own permission — the board
   names who is on which machine. */
const OPERATIONS_ITEM: NavItem =
  { kind: "page", id: "operations", label: "Shift Control", icon: Radar };

/* The roster is planning rather than running: it deals in days nobody has
   worked yet, which is why it is its own page and its own permission rather
   than a sixth tab on the shift board. */
const WORKFORCE_ITEM: NavItem =
  { kind: "page", id: "workforce", label: "Workforce", icon: CalendarRange };

const ITEM_BASE =
  "w-full flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 relative group";

export default function AppSidebar() {
  const { page, setPage }      = useAppPage();
  const { collapsed, toggle }  = useSidebar();
  const user                   = useAuth((s) => s.user);
  const canAny                 = useAuth((s) => s.canAny);

  /* Initials for the avatar. Names here arrive as "AKASH ." and
     "SWASTIK ROY CHOUDHURY", so take the first letter of the first two parts
     that are actually letters — a trailing "." must not become an initial. */
  const initials = (user?.name ?? "")
    .split(/\s+/)
    .filter((part) => /[A-Za-z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || (user?.emp_id ?? "?").slice(0, 2);

  /* Only the pages this user may open. The same rule is enforced on the API, so
     this hides entries that would 403 anyway rather than being the gate itself.
     An empty allowed_pages (older session payload) shows everything rather than
     presenting an empty sidebar. */
  const allowed = user?.allowed_pages ?? [];
  const items: NavItem[] = [
    ...NAV_ITEMS.filter(
      (i) => i.kind === "link" || allowed.length === 0 || allowed.includes(i.id),
    ),
    // Permission, not role name — a role created in the UI reaches these entries
    // without any code change.
    ...(canAny("ops.shift.view") ? [OPERATIONS_ITEM] : []),
    ...(canAny("ops.roster.view") ? [WORKFORCE_ITEM] : []),
    ...(canAny("access.users.view") ? [ACCESS_ITEM] : []),
    ...(canAny("platform.registry.view") ? [PLATFORM_ITEM] : []),
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

      {/* Signed in as ─────────────────────────────────────────────
          Who you are is worth stating plainly on a dashboard that several
          people share on the same machine: before this, the only way to tell
          whose session was open was to go looking for it. It sits directly
          above Logout because that is the pair — check who this is, then leave. */}
      {user && (
        <div className="border-t border-white/10 shrink-0">
          {collapsed ? (
            <div className="flex justify-center py-3 group relative">
              <span className="w-8 h-8 rounded-full bg-[#c8960c]/20 border border-[#c8960c]/40
                               text-[#f5a623] text-[11px] font-bold flex items-center justify-center">
                {initials}
              </span>
              <span className="
                pointer-events-none select-none
                absolute left-[56px] top-1/2 -translate-y-1/2
                bg-[#0f1c35] text-white text-[11px] px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap
                opacity-0 group-hover:opacity-100 transition-opacity duration-150
                z-50 border border-white/10
              ">
                <span className="font-semibold">{user.name}</span>
                <span className="text-white/45"> · {user.emp_id}</span>
              </span>
            </div>
          ) : (
            <div className="px-3 py-3">
              <div className="text-[9.5px] font-bold tracking-[.16em] text-white/30 uppercase font-condensed mb-1.5">
                Signed in as
              </div>
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 shrink-0 rounded-full bg-[#c8960c]/20 border border-[#c8960c]/40
                                 text-[#f5a623] text-[11px] font-bold flex items-center justify-center">
                  {initials}
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-white/90 truncate leading-tight">
                    {user.name}
                  </div>
                  <div className="text-[10.5px] text-white/40 truncate">
                    {user.emp_id}{user.department ? ` · ${user.department}` : ""}
                  </div>
                </div>
              </div>
              {user.roles?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {user.roles.map((r) => (
                    <span key={r.code}
                          title={`Your access level: ${r.name}`}
                          className="px-1.5 py-0.5 rounded border border-[#c8960c]/30 bg-[#c8960c]/10
                                     text-[9.5px] font-semibold tracking-wide text-[#f5a623] uppercase font-condensed">
                      {r.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Logout */}
      <div className="border-t border-white/10 shrink-0">
        <button
          onClick={async () => {
            // Ends the session row server-side (is_active=0, logout_at, end_reason)
            // so it stops counting as a live session in the intranet activity
            // tables. Clearing the browser alone would leave it open until it
            // idles out.
            await useAuth.getState().logout();
            localStorage.removeItem("kaliapani-app-page");
            window.location.reload();
          }}
          title={collapsed ? "Sign out" : undefined}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-white/55
                     hover:text-red-300 hover:bg-red-500/10 transition-colors group relative"
        >
          <LogOut size={15} className="shrink-0 text-white/40 group-hover:text-red-400 transition-colors" />
          {!collapsed && (
            <span className="text-[11.5px] font-semibold tracking-wide leading-tight truncate font-condensed text-left">
              SIGN OUT
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
              Sign out
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
