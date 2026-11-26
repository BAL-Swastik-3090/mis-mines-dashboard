"use client";

/**
 * The Daily Entry strip: one row across the top of every entry screen.
 *
 * It mirrors PlanTabBar rather than abstracting a shared one, for the reason
 * given there: the bars will keep diverging, and the visual language is what
 * should be shared, not the code. A strip under the header means the same
 * thing wherever you meet it.
 *
 * ── IT SHOWS ONLY WHAT YOU MAY OPEN ──────────────────────────────────────────
 * Same canOpen rule as the rail, from the same list, so the two can never
 * disagree about what exists. A tab that opens onto its own error message
 * reads as a broken platform rather than a closed door.
 *
 * ── IT DOES NOT HIDE ITSELF WHEN THERE IS ONLY ONE TAB ───────────────────────
 * PlanTabBar returns null below two, because a plan screen is a page you read
 * and a one-tab strip over it is furniture. These are forms, and the strip is
 * also the only thing on the screen that says where you are once the dialog is
 * open over it. One tab is still worth a heading.
 */

import { ClipboardPaste } from "lucide-react";
import { useAppPage } from "@/contexts/useAppPage";
import { useSidebar } from "@/contexts/useSidebar";
import { useAuth } from "@/contexts/useAuth";
import { canOpen } from "@/contexts/pageAccess";
import { ENTRY_TABS } from "./entryNav";

export default function EntryTabBar() {
  const { page, setPage } = useAppPage();
  const { collapsed }     = useSidebar();
  const user              = useAuth((s) => s.user);

  const tabs = ENTRY_TABS.filter((t) => canOpen(user, t.id));
  if (!tabs.length) return null;

  return (
    <div
      style={{ left: collapsed ? "56px" : "200px" }}
      className="fixed top-[71px] right-0 z-20 bg-white border-b border-[#d0d9e8]
                 shadow-sm h-[44px] flex items-stretch
                 transition-[left] duration-300 ease-in-out"
    >
      <div className="shrink-0 flex items-center gap-2 pl-4 pr-3 border-r border-[#d0d9e8]">
        <ClipboardPaste size={16} className="text-navy shrink-0" />
        <span className="font-condensed text-[13px] font-extrabold tracking-[.08em]
                         uppercase text-navy whitespace-nowrap">
          Daily Entry
        </span>
      </div>

      <nav className="flex flex-1 overflow-x-auto scrollbar-thin min-w-0">
        {tabs.map(({ id, label, icon: Icon, title }) => {
          const isActive = page === id;
          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              title={title}
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
