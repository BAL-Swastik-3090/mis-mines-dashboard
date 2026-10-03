"use client";
/**
 * Mines Stock Position — from `mines_stock_entry`, filled in on this dashboard.
 *
 * Entry lives in MinesStockEntryModal, opened from "Enter Mines Stock" in the
 * three-dot menu in the header; this section only displays. The modal is
 * mounted here because this is the section its figures belong to.
 *
 * TWO TABLES, SIDE BY SIDE, in the layout the mine already reads:
 *
 *   Mines Clearance Status          status down, grade across
 *   Location wise & Grade wise      grade down, location across
 *
 * They are one grade x bucket grid read along two axes, which is why they are
 * shown together and why they cannot disagree — the clearance table's Total
 * Stock column and the location table's Mines column are the same sum. This
 * replaced three separate blocks (grade bars, location tiles, clearance tiles)
 * that made three answers out of one.
 *
 * Both tables come from the API already shaped, totals included, so no figure
 * on screen is arithmetic done twice.
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Package, AlertTriangle } from "lucide-react";
import { useStockPosition } from "@/hooks/useStock";
import { formatIndian } from "@/lib/utils";
import { useEntryDialog } from "@/contexts/useEntryDialog";
import MinesStockEntryModal from "@/components/sections/MinesStockEntryModal";

function mt(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}
function niceDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${d}-${MON[Number(m) - 1]}-${y}`;
}
function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-white/20 animate-pulse rounded`} />;
}

// Cell styles shared by the two tables, so they line up when read side by side.
const TH = "px-2 py-1.5 font-condensed font-extrabold text-[10px] tracking-[.1em]";
const TD = "px-2 py-1.5 text-right text-[11px] font-mono tabular-nums " +
           "whitespace-nowrap text-txt-primary";


export default function StockSection() {
  const { data, isLoading, isError, error } = useStockPosition();
  const qc = useQueryClient();
  const dialog = useEntryDialog((s) => s.which);
  const closeDialog = useEntryDialog((s) => s.close);

  // A saved position changes what this section shows, so the snapshot query is
  // refetched rather than waiting for its stale time.
  const afterSave = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["stock"] });
  }, [qc]);

  const entryModal = (
    <MinesStockEntryModal
      open={dialog === "mines-stock"}
      onClose={closeDialog}
      onSaved={afterSave}
    />
  );

  if (isError) {
    // The dialog renders here too: a failure to READ the position is exactly
    // when somebody may need to enter one, and an unreachable form would make
    // the section a dead end.
    return (
      <>
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3">
          <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
          <span className="text-[12px] text-[#c62828]">
            {error instanceof Error ? error.message : "Failed to load stock position"}
          </span>
        </div>
        {entryModal}
      </>
    );
  }

  const statuses = data?.statuses ?? [];
  const permission = statuses.find((s) => s.label === "Permission in Hand")?.qty ?? null;
  const proposed     = data?.proposed_despatch;
  const clearance    = data?.clearance;
  const locationGrid = data?.location_grid;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">

      {/* Header — navy band, matching the mine's own stock report */}
      <div className="bg-navy px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Package size={15} className="text-white/80" />
          <span className="font-condensed font-extrabold text-[14px] text-white tracking-widest uppercase">
            Mines Stock Position
          </span>
        </div>
        <span className="text-[11px] font-mono text-white/75">
          {isLoading ? <Shimmer w="w-32" h="h-4" />
                     : <>As on {niceDate(data?.snapshot_date ?? null)}</>}
        </span>
      </div>

      {/* No snapshot at or before the selected date */}
      {!isLoading && data && !data.has_data && (
        <div className="p-4 flex items-start gap-2.5 bg-[#fff8e1]">
          <AlertTriangle size={15} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">No stock entry on or before this date.</span>{" "}
            Stock is entered per day in IMOS; pick a later date once an entry exists.
          </div>
        </div>
      )}

      {/* Snapshot older than the selected date — entry is not daily */}
      {!isLoading && data?.is_stale && (
        <div className="px-4 py-2 bg-[#fff8e1] border-b border-[#ffe082] flex items-start gap-2.5">
          <AlertTriangle size={14} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11px] text-txt-secondary leading-relaxed">
            {/* Not "before the selected date" any more. The date asked for is
                the morning after the day being reported on, which is derived
                rather than picked — telling a reader their selected date is a
                day they did not select is the confusion this change exists to
                remove. It names the day asked for instead. */}
            Latest entry is <span className="font-bold text-navy">{niceDate(data.snapshot_date)}</span>
            {data.days_stale
              ? <> — {data.days_stale} day{data.days_stale > 1 ? "s" : ""} before{" "}
                  {niceDate(data.requested_date ?? null)}, the morning asked for</>
              : null}.
            Stock is not entered every day.
          </div>
        </div>
      )}

      {(isLoading || data?.has_data) && (
        <>
          {/* Headline KPIs */}
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: "Total Stock",        value: data?.total_stock,
                sub: "mine stock · all grades, all clearance statuses",
                accent: "#1565c0", strong: true },
              { label: "Permission in Hand", value: permission,
                sub: "cleared · ready to lift", accent: "#2e7d32" },
              // Entered on the stock form against this same date, so it is the
              // proposal made while looking at the position beside it. The
              // sub-line carries the split, because the total alone does not
              // say which plant it is going to.
              { label: "Proposed Today's Despatch",
                value: proposed?.has_data ? proposed.total : null,
                sub: proposed?.has_data
                  ? Object.entries(proposed.by_destination)
                      .map(([k, v]) => `${proposed.labels[k] ?? k} ${mt(v)}`)
                      .join(" · ")
                  : "not entered for this day",
                accent: "#ad1457" },
            ].map((k) => (
              <div key={k.label}
                   className={`rounded-lg border p-3 ${k.strong ? "border-[#1565c0] bg-[#f5f9ff]" : "border-border bg-white"}`}>
                <div className="text-[9.5px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
                  {k.label}
                </div>
                {isLoading ? <div className="mt-2"><div className="h-6 w-24 bg-bg-section animate-pulse rounded" /></div> : (
                  <div className="font-condensed font-extrabold text-[22px] sm:text-[24px] xl:text-[26px] leading-none mt-1 break-words"
                       style={{ color: k.accent }}>
                    {mt(k.value)}
                    <span className="text-[11px] font-mono font-normal text-txt-muted ml-1">MT</span>
                  </div>
                )}
                <div className="text-[9.5px] text-txt-light font-mono mt-1">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* THE MINE'S OWN TWO TABLES, SIDE BY SIDE.
              Replaces the grade bars, the location tiles and the clearance
              tiles — the same figures, in the layout the mine already reads
              them in. Side by side because they are one grid read along two
              axes: clearance status down and grade across, then grade down and
              location across. Reading them apart is what made three blocks out
              of one answer.

              They stack on a narrow screen. Each scrolls sideways on its own
              rather than the page doing it, so a header stays with its column. */}
          <div className="px-4 pb-4 grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* ── Mines clearance status ─────────────────────────────── */}
            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase
                              font-condensed text-txt-secondary mb-2">
                Mines Clearance Status
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse min-w-[360px]">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className={`${TH} text-left`}>Status</th>
                      <th className={`${TH} text-center`}>UoM</th>
                      <th className={`${TH} text-right`}>Total</th>
                      {(clearance?.grades ?? []).map((g) => (
                        <th key={g.key} className={`${TH} text-right`}>{g.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(isLoading ? [] : clearance?.rows ?? []).map((r) => (
                      <tr key={r.key}
                          className={`border-b border-border-light last:border-0
                            ${r.is_total ? "bg-bg-section font-semibold" : "hover:bg-bg-soft/60"}`}>
                        <td className={`${TD} text-left ${r.is_total ? "text-navy font-bold" : "text-txt-primary"}`}>
                          {r.label}
                        </td>
                        <td className={`${TD} text-center text-txt-light`}>{r.uom}</td>
                        <td className={`${TD} font-bold text-navy`}>{mt(r.total)}</td>
                        {(clearance?.grades ?? []).map((g) => (
                          <td key={g.key} className={TD}>{mt(r.by_grade[g.key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {isLoading && <div className="p-3 space-y-1.5">
                  {[0,1,2,3,4].map((i) => (
                    <div key={i} className="h-4 bg-bg-section animate-pulse rounded" />))}
                </div>}
              </div>
            </div>

            {/* ── Location wise & grade wise stock ───────────────────── */}
            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase
                              font-condensed text-txt-secondary mb-2">
                Location wise &amp; Grade wise Stock
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse min-w-[420px]">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className={`${TH} text-left`}>Grade</th>
                      <th className={`${TH} text-center`}>UoM</th>
                      {(locationGrid?.columns ?? []).map((c) => (
                        <th key={c.key} className={`${TH} text-right`}>{c.label}</th>
                      ))}
                      <th className={`${TH} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(isLoading ? [] : locationGrid?.rows ?? []).map((r) => (
                      <tr key={r.key}
                          className={`border-b border-border-light last:border-0
                            ${r.is_total ? "bg-bg-section font-semibold" : "hover:bg-bg-soft/60"}`}>
                        <td className={`${TD} text-left ${r.is_total ? "text-navy font-bold" : "text-txt-primary"}`}>
                          {r.label}
                        </td>
                        <td className={`${TD} text-center text-txt-light`}>{r.uom}</td>
                        {(locationGrid?.columns ?? []).map((c) => (
                          <td key={c.key} className={TD}>{mt(r.cells[c.key])}</td>
                        ))}
                        <td className={`${TD} font-bold text-navy`}>{mt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {isLoading && <div className="p-3 space-y-1.5">
                  {[0,1,2,3,4].map((i) => (
                    <div key={i} className="h-4 bg-bg-section animate-pulse rounded" />))}
                </div>}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">STOCK · </span>dashboard entry
          &nbsp;·&nbsp;snapshot per day, all figures MT
        </p>
      </div>

      {entryModal}
    </div>
  );
}
