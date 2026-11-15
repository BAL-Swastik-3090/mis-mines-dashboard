"use client";

/**
 * The handover strip: one row across the top of every HOTO screen.
 *
 * ── WHY A STRIP AND NOT JUST THE RAIL ────────────────────────────────────────
 * The rail answers "what else does this dashboard have"; this answers "what
 * else is there about handovers", which is the question somebody actually has
 * while reading one. Moving from a defect to the machine's register entry is a
 * single click here instead of a trip back out to the rail and down a list.
 *
 * It deliberately mirrors SectionTabBar rather than abstracting a shared one:
 * that bar scrolls to sections of one page, this one changes page, and the two
 * will keep diverging. The visual language is shared on purpose, so a strip
 * under the header means the same thing wherever you meet it.
 *
 * ── IT SHOWS ONLY WHAT YOU MAY OPEN ──────────────────────────────────────────
 * A tab that opens onto its own error message reads as a broken platform
 * rather than a closed door, so the same canOpen rule as the rail applies —
 * from the same list, so the two can never disagree about what exists.
 */

import { DoorOpen } from "lucide-react";
import { useAppPage } from "@/contexts/useAppPage";
import { useSidebar } from "@/contexts/useSidebar";
import { useAuth } from "@/contexts/useAuth";
import { canOpen } from "@/contexts/pageAccess";
import { HOTO_TABS } from "./hotoNav";

export default function HotoTabBar() {
  const { page, setPage } = useAppPage();
  const { collapsed }     = useSidebar();
  const user              = useAuth((s) => s.user);

  const tabs = HOTO_TABS.filter((t) => canOpen(user, t.id));
  // Nothing to steer between. The page itself already says what it says.
  if (tabs.length < 2) return null;

  return (
    <div
      style={{ left: collapsed ? "56px" : "200px" }}
      className="fixed top-[71px] right-0 z-20 bg-white border-b border-[#d0d9e8]
                 shadow-sm h-[44px] flex items-stretch
                 transition-[left] duration-300 ease-in-out"
    >
      {/* The section's own name, so the strip is not six unexplained words.
          Not a button: it is the heading of the thing you are already inside,
          and a heading that navigates somewhere gives one label two meanings. */}
      <div className="shrink-0 flex items-center gap-2 pl-4 pr-3 border-r border-[#d0d9e8]">
        <DoorOpen size={16} className="text-navy shrink-0" />
        <span className="font-condensed text-[13px] font-extrabold tracking-[.08em]
                         uppercase text-navy">
          HOTO
        </span>
        {/* The module is under acceptance as a whole. One badge here says it
            for every screen, instead of six badges saying it six times. */}
        <span
          title="Under user acceptance testing — still being checked by the people who own it"
          className="rounded-[3px] bg-[#f5a623]/15 px-1.5 py-px text-[9px] font-bold
                     uppercase leading-none tracking-wider text-[#c8960c]
                     ring-1 ring-inset ring-[#f5a623]/40"
        >
          UAT
        </span>
      </div>

      <nav className="flex flex-1 overflow-x-auto scrollbar-thin min-w-0">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = page === id;
          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              aria-current={isActive ? "page" : undefined}
              className={`
                relative flex items-center gap-[6px]
                px-4 h-full shrink-0
                font-condensed text-[11px] font-bold tracking-[.1em] uppercase
                transition-colors duration-150
                ${isActive
                  ? "text-[#c8960c] bg-[#fdf6e6]"
                  : "text-[#8899bb] hover:text-[#3a4a6b] hover:bg-[#f8fafd]"}
              `}
            >
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#c8960c]" />
              )}
              <Icon size={13} className="shrink-0" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
