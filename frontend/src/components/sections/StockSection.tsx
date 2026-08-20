"use client";
/**
 * Mines Stock Position — sourced from IMOS entry (`mines_stock`).
 *
 * Three blocks that deliberately do NOT reconcile with one another, because they
 * count different things:
 *
 *   Total Mines Stock  — Section C, the four grade columns (stock at the mine)
 *   All Locations      — Section C across Mines / BAL / SUK / LG for COB
 *   Clearance Status   — Section B, mine stock grouped by permission status
 *
 * They are kept in separate blocks so none reads as a breakdown of another.
 */
import { Package, AlertTriangle } from "lucide-react";
import { useStockPosition } from "@/hooks/useStock";
import { formatIndian } from "@/lib/utils";

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

const GRADE_COLOR: Record<string, string> = {
  HG:  "bg-gold",
  MG:  "bg-accent",
  LG:  "bg-[#e65100]",
  COB: "bg-[#00838f]",
};

export default function StockSection() {
  const { data, isLoading, isError, error } = useStockPosition();

  if (isError) {
    return (
      <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3">
        <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
        <span className="text-[12px] text-[#c62828]">
          {error instanceof Error ? error.message : "Failed to load stock position"}
        </span>
      </div>
    );
  }

  const loc      = data?.locations;
  const grades   = data?.grades   ?? [];
  const statuses = data?.statuses ?? [];
  const permission = statuses.find((s) => s.label === "Permission in Hand")?.qty ?? null;
  const awaiting   = statuses.filter((s) => s.label !== "Permission in Hand");
  // Bars are scaled to the largest grade present, not to the total, so a small
  // grade beside a dominant one is still visible.
  const gradeMax = Math.max(...grades.map((g) => g.mines), 1);

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
            Latest entry is <span className="font-bold text-navy">{niceDate(data.snapshot_date)}</span>
            {data.days_stale ? <> — {data.days_stale} day{data.days_stale > 1 ? "s" : ""} before the selected date</> : null}.
            Stock is not entered every day.
          </div>
        </div>
      )}

      {(isLoading || data?.has_data) && (
        <>
          {/* Headline KPIs */}
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Total Mines Stock", value: data?.total_mines_stock,
                sub: "at the mine · Section C grades", accent: "#1565c0", strong: true },
              { label: "Total Stock",       value: data?.total_stock,
                sub: "sum of the four clearance statuses", accent: "#6a1b9a" },
              { label: "Permission in Hand", value: permission,
                sub: "cleared · ready to lift", accent: "#2e7d32" },
            ].map((k) => (
              <div key={k.label}
                   className={`rounded-lg border p-3 ${k.strong ? "border-[#1565c0] bg-[#f5f9ff]" : "border-border bg-white"}`}>
                <div className="text-[9.5px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
                  {k.label}
                </div>
                {isLoading ? <div className="mt-2"><div className="h-6 w-24 bg-bg-section animate-pulse rounded" /></div> : (
                  <div className="font-condensed font-extrabold text-[26px] leading-none mt-1"
                       style={{ color: k.accent }}>
                    {mt(k.value)}
                    <span className="text-[11px] font-mono font-normal text-txt-muted ml-1">MT</span>
                  </div>
                )}
                <div className="text-[9.5px] text-txt-light font-mono mt-1">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Grade-wise mine stock — all four grades always listed */}
          <div className="px-4 pb-4">
            <div className="text-[10px] font-bold tracking-widest uppercase font-condensed text-txt-secondary mb-2">
              Grade-wise Stock (Mines)
            </div>
            <div className="space-y-1.5">
              {(isLoading ? [] : grades).map((g) => (
                <div key={g.grade_key} className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 w-[124px] shrink-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${GRADE_COLOR[g.grade_key] ?? "bg-accent"}`} />
                    <span className="text-[11px] text-txt-muted font-medium">{g.grade_label}</span>
                  </span>
                  <div className="flex-1 h-[14px] bg-bg-section rounded overflow-hidden">
                    <div className={`h-full rounded ${GRADE_COLOR[g.grade_key] ?? "bg-accent"}`}
                         style={{ width: `${(g.mines / gradeMax) * 100}%` }} />
                  </div>
                  <span className="w-[80px] shrink-0 text-right font-mono text-[11px] font-semibold text-navy tabular-nums">
                    {mt(g.mines)}<span className="text-[9px] text-txt-light ml-0.5">MT</span>
                  </span>
                </div>
              ))}
              {isLoading && [0,1,2,3].map((i) => <div key={i} className="h-[14px] bg-bg-section animate-pulse rounded" />)}
            </div>
          </div>

          {/* All locations — Total is the sum of the four tiles beside it */}
          <div className="px-4 pb-4 border-t border-border-light pt-3">
            <div className="text-[10px] font-bold tracking-widest uppercase font-condensed text-txt-secondary mb-2">
              All Locations — Total Stock
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: "Mines",      value: loc?.mines },
                { label: "BAL Plant",  value: loc?.bal_plant },
                { label: "SUK Plant",  value: loc?.suk_plant },
                { label: "LG for COB", value: loc?.lg_for_cob },
                { label: "Total",      value: loc?.total, strong: true },
              ].map((t) => (
                <div key={t.label}
                     className={`rounded-lg border p-2.5 text-center ${t.strong ? "border-[#1565c0] bg-[#f5f9ff]" : "border-border bg-white"}`}>
                  <div className="text-[9px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
                    {t.label}
                  </div>
                  <div className={`font-condensed font-extrabold text-[17px] leading-none mt-1 ${t.strong ? "text-[#1565c0]" : "text-navy"}`}>
                    {isLoading ? "—" : mt(t.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Clearance status — the remaining Section B rows */}
          <div className="px-4 pb-4 border-t border-border-light pt-3">
            <div className="text-[10px] font-bold tracking-widest uppercase font-condensed text-txt-secondary mb-2">
              Clearance Status
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(isLoading ? [] : awaiting).map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-white p-2.5">
                  <div className="text-[9px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
                    {s.label}
                  </div>
                  <div className="font-condensed font-extrabold text-[17px] leading-none text-navy mt-1">
                    {mt(s.qty)}<span className="text-[10px] font-mono font-normal text-txt-muted ml-1">MT</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">STOCK · </span>IMOS data entry
          &nbsp;·&nbsp;snapshot per day, all figures MT
        </p>
      </div>
    </div>
  );
}
