"use client";
import { format } from "date-fns";
import { RefreshCw, Bell, MoreVertical, PencilLine, Boxes } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DateFilter from "./DateFilter";
import ProfileMenu from "./ProfileMenu";
import { useDateFilter } from "@/contexts/useDateFilter";
import { useAppPage } from "@/contexts/useAppPage";
import { useEntryDialog } from "@/contexts/useEntryDialog";
import { cn } from "@/lib/utils";

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

          {/* Date Filter */}
          <DateFilter />

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

          {/* Alerts */}
          <button
            title="Alerts"
            className="p-2 rounded border border-white/15 text-white/60 hover:text-white hover:border-white/30 transition-colors relative"
          >
            <Bell size={15} />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger rounded-full text-[9px] text-white flex items-center justify-center font-bold">
              3
            </span>
          </button>

          {/* Data-entry actions. Separate from the profile menu, which is about
              who you are rather than what you can record. */}
          <ActionsMenu />

          {/* Who is signed in. Was at the foot of the sidebar with every role
              spelled out as a badge, which cost half the rail for anybody
              holding more than one. */}
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * The three-dot actions menu.
 *
 * "Enter Est Actual" also switches to the MIS dashboard, because the dialog is
 * owned by the previous-day table that holds the plan figures it needs. Opening
 * it from another page would otherwise set a flag nothing was listening to and
 * appear to do nothing at all.
 */
function ActionsMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const setPage = useAppPage((s) => s.setPage);
  const openDialog = useEntryDialog((s) => s.open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-2 rounded border border-white/15 text-white/60 hover:text-white hover:border-white/30 transition-colors"
      >
        <MoreVertical size={15} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 bg-white rounded-lg shadow-xl border border-border py-1 z-50"
        >
          {([
            ["prev-day", "Enter Est Actual", PencilLine],
            ["mines-stock", "Enter Mines Stock", Boxes],
          ] as const).map(([which, label, Icon]) => (
            <button
              key={which}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPage("mis");
                openDialog(which);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-txt-secondary hover:bg-bg-section hover:text-navy transition-colors"
            >
              <Icon size={13} className="text-accent shrink-0" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
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
