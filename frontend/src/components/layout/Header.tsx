"use client";
import { format } from "date-fns";
import { RefreshCw, Bell } from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DateFilter from "./DateFilter";
import { useDateFilter } from "@/contexts/useDateFilter";
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

      <div className="flex items-stretch min-h-[68px]">

        {/* ── Brand ──────────────────────────────────────────── */}
        <div className="flex flex-col justify-center px-5 pr-6 border-r border-white/10 min-w-[260px] xl:min-w-[300px]">
          <div className="text-[11px] font-semibold tracking-[.18em] text-[#f5a623] uppercase font-condensed">
            Balasore Alloys Limited
          </div>
          <div className="font-condensed font-extrabold text-white text-[22px] xl:text-[26px] leading-tight tracking-[.01em]">
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
