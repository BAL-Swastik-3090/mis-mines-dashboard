"use client";
/**
 * Dumper-wise trip count — MAN and PRIMA only.
 *
 * The seven material columns in mines_tipper_details hold TRIP COUNTS, not
 * tonnage. Columns are rendered from what the API declares rather than hardcoded
 * here, so a new material column flows through without a frontend change.
 *
 * Every dumper on the roster is listed even when it did no work in the period —
 * a zero row is informative, a missing row is easy to overlook.
 */
import { Truck, AlertTriangle } from "lucide-react";
import { useDumperTrips } from "@/hooks/useDumperTrips";
import { formatIndian } from "@/lib/utils";

function n0(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}

const thCls = "px-3 py-2.5 font-bold text-txt-secondary tracking-wide text-[11px]";

export default function DumperTripTable() {
  const { data, isLoading, isError, error } = useDumperTrips();
  const cols = data?.columns ?? [];
  const rows = data?.rows ?? [];

  if (isError) {
    return (
      <div className="bg-white border border-border rounded-lg shadow-sm p-4 flex items-center gap-3">
        <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
        <span className="text-[12px] text-[#c62828]">
          {error instanceof Error ? error.message : "Failed to load dumper trips"}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Truck size={14} className="text-accent shrink-0" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Dumper-wise Trip Count
          </span>
        </div>
        {!isLoading && data && (
          <span className="text-[10px] font-mono text-txt-muted whitespace-nowrap">
            <span className="font-bold text-navy text-[13px]">{n0(data.total_trips)}</span> trips
            <span className="ml-1.5">
              · {data.dumpers_active} of {data.dumpers_total} dumpers active
            </span>
          </span>
        )}
      </div>

      {/* Trips that name several machines on one row cannot be attributed to a
          dumper. Surfaced so a period covering May or June does not quietly
          report a total missing thousands of trips. */}
      {!isLoading && data && data.unattributed_rows > 0 && (
        <div className="px-4 py-2 bg-[#fff8e1] border-b border-[#ffe082] flex items-start gap-2.5">
          <AlertTriangle size={14} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">
              {n0(data.unattributed_trips)} trips on {data.unattributed_rows} row
              {data.unattributed_rows > 1 ? "s" : ""} are not shown below.
            </span>{" "}
            Before July 2026 one shift row could name several dumpers at once, so those trips
            belong to the group jointly and cannot be assigned to a single vehicle.
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-mono">
          <thead>
            <tr className="bg-bg-section border-b border-border-light">
              <th className={`${thCls} text-left`}>DUMPER NAME</th>
              {cols.map((c) => (
                <th key={c.key} className={`${thCls} text-right whitespace-nowrap`}>
                  {c.label.toUpperCase()}
                </th>
              ))}
              <th className={`${thCls} text-right text-accent`}>TOTAL TRIPS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light/60">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <div className="h-3.5 bg-bg-section animate-pulse rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length + 2} className="px-4 py-8 text-center text-txt-muted text-sm">
                  No dumper records for the selected period
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                // An idle dumper stays on the list but recedes, so the eye goes
                // to the vehicles actually working.
                const idle = r.total_trips === 0;
                return (
                  <tr key={r.dumper_name}
                      className={`hover:bg-bg-light/60 transition-colors ${idle ? "opacity-45" : ""}`}>
                    <td className="px-3 py-2 font-condensed font-bold text-[12px] text-navy whitespace-nowrap">
                      {r.dumper_name}
                    </td>
                    {cols.map((c) => {
                      const v = r.materials[c.key] ?? 0;
                      return (
                        <td key={c.key}
                            className={`px-3 py-2 text-right tabular-nums ${
                              v > 0 ? "text-navy" : "text-txt-light/40"
                            }`}>
                          {n0(v)}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-semibold text-accent tabular-nums">
                      {n0(r.total_trips)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!isLoading && data && rows.length > 0 && (
            <tfoot>
              <tr className="bg-navy text-white border-t-2 border-navy font-bold">
                <td className="px-3 py-2.5 font-condensed tracking-widest uppercase text-[11px]">Total</td>
                {cols.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">
                    {n0(data.totals[c.key] ?? 0)}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right tabular-nums">{n0(data.total_trips)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 space-y-0.5">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">TRIPS · </span>IMOS shift log
          &nbsp;·&nbsp;own dumper fleet, MAN and PRIMA only
        </p>
        <p className="text-[9px] font-mono text-txt-muted leading-tight">
          Total trips = ore + LG + OB + silt + boulder + tailing + COB feed. Every dumper on the
          roster is listed; one with no work in the period reads 0 rather than dropping off.
        </p>
      </div>
    </div>
  );
}
