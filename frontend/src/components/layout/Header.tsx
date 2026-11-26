"use client";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";
import AlertsBell from "./AlertsBell";
import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DateFilter from "./DateFilter";
import ProfileMenu from "./ProfileMenu";
import DataHealthButton from "./DataHealthButton";
import { useDateFilter } from "@/contexts/useDateFilter";
import { useAppPage } from "@/contexts/useAppPage";
import { ENTRY_PAGES } from "./entryNav";
import { cn } from "@/lib/utils";
import { type AppPage } from "@/contexts/useAppPage";

/** Screens with no period of their own: what they show is "now" or "all".
 *
 *  THE ENTRY FORMS BELONG HERE, AND NOT ONLY FOR TIDINESS. Every one of them
 *  carries its own date box — the day being filed is the form's own field, not
 *  a dashboard filter — so the control drives nothing a person can see, and a
 *  filter that changes nothing teaches people it is unreliable everywhere else.
 *
 *  It was also a way to file a figure against the wrong day. Est Actual starts
 *  its date box at reportDay(apiTo); while these were dialogs the backdrop sat
 *  over the header and the filter could not be reached. Inline it can, and
 *  moving it re-dated the box underneath whatever had already been typed into
 *  the rows — same figures, different day, no warning. */
const DATELESS_PAGES = new Set<AppPage>([
  "hoto-board", "hoto-defects", "hoto-checklists", "hoto-devices",
  "hoto-stickers", "hoto-app",
  ...ENTRY_PAGES,
]);

/** True when the selected end-date is today → sensor data is live. */
function useIsLive(): boolean {
  const { apiTo } = useDateFilter();
  const [isLive, setIsLive] = useState<boolean>(false); // SSR default: false (avoids hydration mismatch)
  useEffect(() => {
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    setIsLive(apiTo === today);
  }, [apiTo]);
  return isLive;
}

function useNow(): string {
  const [now, setNow] = useState<string>("");   // empty until client mounts
  useEffect(() => {
    const tick = () => setNow(format(new Date(), "d MMM yyyy · HH:mm 'IST'"));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Header() {
  const { periodLabel } = useDateFilter();
  const page = useAppPage((s) => s.page);
  const drivesDates = !DATELESS_PAGES.has(page);
  const isLive          = useIsLive();
  const qc              = useQueryClient();
  const now             = useNow();

  const [spinning, setSpinning] = useState(false);

  const handleRefresh = useCallback(() => {
    setSpinning(true);
    qc.invalidateQueries();
    setTimeout(() => setSpinning(false), 900);
  }, [qc]);

  return (
    <header className="fixed top-0 left-0 right-0 z-30 bg-[#1a2744] shadow-lg">
      {/* Gold accent line */}
      <div className="h-[3px] bg-gradient-to-r from-[#c8960c] via-[#f5a623] to-[#c8960c]" />

      <div className="flex items-stretch min-h-[68px] min-w-0">

        {/* ── Brand ──────────────────────────────────────────── */}
        <div className="flex flex-col justify-center px-3 sm:px-5 pr-4 sm:pr-6 border-r border-white/10
                        min-w-0 sm:min-w-[240px] xl:min-w-[300px]">
          <div className="text-[11px] font-semibold tracking-[.18em] text-[#f5a623] uppercase font-condensed">
            Balasore Alloys Limited
          </div>
          <div className="font-condensed font-extrabold text-white text-[17px] sm:text-[20px] xl:text-[26px] leading-tight tracking-[.01em]">
            Kaliapani Chromite Mines
          </div>
          <div className="text-[11px] text-white/40 tracking-[.04em] mt-0.5">
            Sukinda Valley · Jajpur, Odisha
          </div>
        </div>

        {/* ── Meta strip ─────────────────────────────────────── */}
        <div className="hidden md:flex items-center gap-6 xl:gap-10 px-6 flex-1">
          <MetaItem
            label="Report As On"
            value={now}
            gold
          />
        </div>

        {/* Spacer on mobile */}
        <div className="flex-1 md:hidden" />

        {/* ── Controls ───────────────────────────────────────── */}
        <div className="flex items-center gap-2 xl:gap-3 px-4 xl:px-5 border-l border-white/10">

          {/* Live / Historical badge — reflects actual selected date */}
          {isLive ? (
            <div
              title="Showing live data (today)"
              className="flex items-center gap-1.5 bg-success/10 border border-success/30 rounded px-3 py-1.5"
            >
              <span className="pulse-dot" />
              <span className="text-[11px] text-success font-bold tracking-wider hidden sm:inline">
                LIVE
              </span>
            </div>
          ) : (
            <div
              title={`Showing historical data — ${periodLabel}`}
              className="flex items-center gap-1.5 bg-warning/10 border border-warning/25 rounded px-3 py-1.5"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-warning shrink-0" />
              <span className="text-[11px] text-warning/80 font-bold tracking-wider hidden sm:inline">
                {periodLabel || "HIST"}
              </span>
            </div>
          )}

          {/* THE DATE CONTROL ONLY APPEARS WHERE IT DRIVES SOMETHING.
              The shift board shows the shift running now, defects shows what
              is open, and devices, checklists and stickers are registers with
              no period at all. A range sitting over those screens is a control
              that changes nothing -- which teaches people the filter is
              unreliable everywhere else too. */}
          {drivesDates && <DateFilter />}

          {/* Refresh — invalidates all TanStack Query cache */}
          <button
            onClick={handleRefresh}
            disabled={spinning}
            title="Refresh all data"
            className="p-2 rounded border border-white/15 text-white/60 hover:text-white hover:border-white/30 active:scale-95 transition-all disabled:opacity-70"
          >
            <RefreshCw
              size={15}
              className={spinning ? "animate-spin" : ""}
            />
          </button>

          {/* Alerts.
              This was a picture of a bell with a 3 painted on it, and it sat
              here through the whole of the WB3 outage saying 3 — while the one
              thing worth knowing, that the weighbridge had stopped sending
              readings on Saturday morning, was not among them. A badge that is
              always 3 teaches people the bell means nothing. */}
          {/* How current the data is. Beside the bell but deliberately not
              in it: the bell reports equipment that has stopped and carries a
              personal "clear"; this reports how fresh each table is, has
              nothing to acknowledge, and is derived fresh each time. It
              replaced a banner across the top of every section, which read as
              an error with the page rather than a note about its data. */}
          <DataHealthButton />

          <AlertsBell />

          {/* THE THREE-DOT ACTIONS MENU WAS REMOVED ON 26 NOVEMBER 2026.
             It held nothing but the ten entry forms, and they have had a
             sidebar section and ten pages of their own since the Daily Entry
             Hub shipped. Two doors to the same ten screens meant two lists to
             keep in step with who may open them -- and the menu's list had
             already drifted once, offering forms the API refused.

             Nothing else lived in it, so removing the entries removed the
             button. If something non-navigational ever needs a home up here,
             it is a new control with its own name, not this one brought back
             as a drawer. */}

          {/* Who is signed in. Was at the foot of the sidebar with every role
              spelled out as a badge, which cost half the rail for anybody
              holding more than one. */}
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

function MetaItem({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[.14em] text-white/40 font-semibold mb-0.5">
        {label}
      </div>
      <div className={cn(
        "font-condensed font-bold text-[17px] leading-tight",
        gold ? "text-[#f5a623]" : "text-white"
      )}>
        {value}
      </div>
    </div>
  );
}
