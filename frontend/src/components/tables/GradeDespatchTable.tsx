"use client";
/**
 * Grade-wise Despatch — what grade actually left the mine.
 *
 * Two tables, because they answer different questions:
 *
 *   1. BANDS      — how much tonnage went out at what grade, on the ASSAY.
 *   2. SOLD AS    — what that same tonnage was billed as, and the assay range
 *                   inside each billed grade. This is the one that earns its
 *                   place: MG-billed material assaying below the 40% LG
 *                   boundary, and LG-billed material reaching above it.
 *
 * The Unassayed row is always shown, never folded into a band, so the table
 * foots to the same total the Despatch section reports above it.
 */
import { Layers, AlertTriangle, Scale } from "lucide-react";
import { useGradeDespatch } from "@/hooks/useGradeDespatch";
import { formatIndian } from "@/lib/utils";
import type { GradeBandRow } from "@/types";

function n1(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function n0(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}
function pct(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
function g(v: number | null | undefined, dp = 2) {
  return v == null ? "—" : v.toFixed(dp);
}

/** Band colours. HG/MG/LG follow the dashboard's grade palette used by the
 *  production grade chart; Unassayed is deliberately grey — it is an absence of
 *  information, not a grade, and must not look like one. */
const BAND_COLOR: Record<string, string> = {
  HG: "#2e7d32",
  MG: "#1565c0",
  LG: "#e65100",
  UNASSAYED: "#8899bb",
};

const thCls = "px-3 py-2 text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary";

function Shimmer() {
  return <div className="h-3.5 bg-bg-section animate-pulse rounded" />;
}

export default function GradeDespatchTable() {
  const { data, isLoading, isError, error } = useGradeDespatch();
  const bands = data?.bands ?? [];
  const t = data?.totals;
  const cov = data?.coverage;

  if (isError) {
    return (
      <div className="bg-white border border-border rounded-lg shadow-sm p-4 flex items-center gap-3">
        <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
        <span className="text-[12px] text-[#c62828]">
          {error instanceof Error ? error.message : "Failed to load grade-wise despatch"}
        </span>
      </div>
    );
  }

  const unassayed = bands.find((b) => b.key === "UNASSAYED");

  return (
    <div className="space-y-3">

      {/* ── Bands ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={14} className="text-accent shrink-0" />
            <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
              Grade-wise Despatch
            </span>
          </div>
          {!isLoading && t && (
            <span className="text-[10px] font-mono text-txt-muted whitespace-nowrap">
              <span className="font-bold text-navy text-[13px]">{n0(t.tonnage)}</span> MT
              <span className="ml-1.5">· {n0(t.trips)} trips</span>
              {cov?.assayed_pct != null && (
                <span className="ml-1.5">· {pct(cov.assayed_pct)} assayed</span>
              )}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="bg-bg-section border-b border-border-light">
                <th className={`${thCls} text-left`}>Grade Band</th>
                <th className={`${thCls} text-right`}>Trips</th>
                <th className={`${thCls} text-right text-[#1565c0]`}>Tonnage (MT)</th>
                <th className={`${thCls} text-right`}>Share</th>
                <th className={`${thCls} text-right text-[#6a1b9a]`}>Wtd Cr₂O₃ %</th>
                <th className={`${thCls} text-right text-[#6a1b9a]`}>Wtd Cr/Fe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/60">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5"><Shimmer /></td>
                  ))}</tr>
                ))
              ) : bands.length === 0 || (t?.tonnage ?? 0) === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-txt-muted text-sm">
                    No despatch in the selected period
                  </td>
                </tr>
              ) : bands.map((b: GradeBandRow) => {
                const empty = b.tonnage === 0;
                const isUn = b.key === "UNASSAYED";
                return (
                  <tr key={b.key}
                      className={`hover:bg-bg-section/50 transition-colors ${empty ? "opacity-45" : ""} ${
                        isUn ? "bg-bg-section/30" : ""}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm shrink-0"
                              style={{ background: BAND_COLOR[b.key] }} />
                        <span className={`font-condensed font-bold text-[12px] ${
                          isUn ? "text-txt-muted" : "text-navy"}`}>{b.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-txt-secondary">{n0(b.trips)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-navy">{n1(b.tonnage)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-txt-secondary">{pct(b.share_pct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#6a1b9a]">{g(b.cr2o3, 2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#6a1b9a]">{g(b.cr_fe, 3)}</td>
                  </tr>
                );
              })}
            </tbody>
            {!isLoading && t && t.tonnage > 0 && (
              <tfoot>
                <tr className="bg-navy text-white border-t-2 border-navy font-bold">
                  <td className="px-3 py-2.5 font-condensed tracking-widest uppercase text-[11px]">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n0(t.trips)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n1(t.tonnage)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">100.0%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{g(t.cr2o3, 2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{g(t.cr_fe, 3)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Customer split — compact, since it is a secondary cut */}
        {!isLoading && data && data.customers.length > 0 && (
          <div className="px-4 py-2.5 border-t border-border-light bg-bg-light/40
                          flex flex-wrap items-center gap-x-6 gap-y-2">
            {data.customers.map((c) => (
              <div key={c.code} className="flex items-baseline gap-2">
                <span className="text-[9.5px] font-condensed font-bold tracking-widest
                                 uppercase text-txt-secondary">{c.name}</span>
                <span className="font-mono text-[12px] font-semibold text-navy tabular-nums">
                  {n1(c.tonnage)} MT
                </span>
                <span className="font-mono text-[10px] text-txt-light">
                  · {n0(c.trips)} trips · Cr₂O₃ {g(c.cr2o3, 2)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 space-y-0.5">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">TONNAGE · </span>SAP outbound despatch
            &nbsp;·&nbsp;<span className="font-semibold text-success/60">GRADE · </span>
            SAP quality inspection, joined on PO + batch
          </p>
          <p className="text-[9px] font-mono text-txt-muted leading-tight">
            Bands are on the ASSAYED Cr₂O₃, not the billed material code. Grades are
            tonnage-weighted, never an average of per-trip readings. The Unassayed row is
            never folded into a band, so the total matches the Despatch figures above.
          </p>
        </div>
      </div>

      {/* ── Assay coverage caveat ─────────────────────────────────────── */}
      {!isLoading && cov && (unassayed?.tonnage ?? 0) > 0 && (
        <div className="p-3 rounded-lg bg-[#fff8e1] border border-[#ffe082]
                        border-l-[3px] border-l-[#c8960c] flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">
              {n1(unassayed?.tonnage)} MT ({pct(unassayed?.share_pct)}) has no assay linked yet.
            </span>{" "}
            Of the graded tonnage, {n1(cov.tier1_tonnage)} MT is matched to its own consignment
            (PO + batch) and {n1(cov.tier2_tonnage)} MT falls back to the PO average. Unassayed
            tonnage is mostly late-month despatch whose lots have not been raised — it shrinks
            as SAP catches up, so this figure is expected to be highest for the current month.
          </div>
        </div>
      )}

      {/* ── Transporter exclusion ─────────────────────────────────────── */}
      {!isLoading && data && data.excluded.tonnage > 0 && (
        <div className="p-3 rounded-lg bg-bg-section border border-border
                        border-l-[3px] border-l-[#8899bb] flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-txt-muted shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">
              A further {n1(data.excluded.tonnage)} MT across {n0(data.excluded.trips)} trips is
              outside these figures.
            </span>{" "}
            The Despatch section scopes actuals to one transporter and this table matches it so
            the two agree. That excludes{" "}
            {data.excluded.transporters.map((x) => x.transporter || "(blank)").join(", ")}.
            Worth a decision — widening it would move the headline Despatch numbers too.
          </div>
        </div>
      )}

      {/* ── Sold as vs assayed ────────────────────────────────────────── */}
      {!isLoading && data && data.sold_as.length > 0 && (
        <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
            <Scale size={14} className="text-[#ad1457]" />
            <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
              Sold As vs Assayed
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="bg-bg-section border-b border-border-light">
                  <th className={`${thCls} text-left`}>Billed As (SAP Material)</th>
                  <th className={`${thCls} text-right`}>Tonnage (MT)</th>
                  <th className={`${thCls} text-right text-[#6a1b9a]`}>Wtd Cr₂O₃ %</th>
                  <th className={`${thCls} text-right`}>Assay Range</th>
                  <th className={`${thCls} text-left`}>Falls Into Bands</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light/60">
                {data.sold_as.map((s) => {
                  // A billed grade whose assays cross the 40% or 52% cut-off is
                  // the finding this table exists for — flag it rather than
                  // leaving the reader to compare two numbers by eye.
                  const straddles =
                    s.cr_min != null && s.cr_max != null &&
                    ((s.cr_min < 40 && s.cr_max >= 40) || (s.cr_min < 52 && s.cr_max >= 52));
                  return (
                    <tr key={s.material_desc} className="hover:bg-bg-section/50 transition-colors">
                      <td className="px-3 py-2 font-condensed font-bold text-[12px] text-navy whitespace-nowrap">
                        {s.material_desc}
                        {s.material_no && (
                          <span className="ml-2 font-mono text-[9.5px] font-normal text-txt-light">
                            {s.material_no.replace(/^0+/, "")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-navy">{n1(s.tonnage)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#6a1b9a]">{g(s.cr2o3, 2)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${
                        straddles ? "text-[#c62828] font-semibold" : "text-txt-secondary"}`}>
                        {s.cr_min == null ? "—" : `${g(s.cr_min, 2)} – ${g(s.cr_max, 2)}`}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex flex-wrap gap-1">
                          {(["HG", "MG", "LG", "UNASSAYED"] as const)
                            .filter((k) => (s.bands[k] ?? 0) > 0)
                            .map((k) => (
                              <span key={k}
                                    className="inline-block px-1.5 py-0.5 rounded text-[9.5px]
                                               font-condensed font-bold tracking-wider uppercase text-white"
                                    style={{ background: BAND_COLOR[k] }}>
                                {k === "UNASSAYED" ? "N/A" : k} {n0(s.bands[k])}
                              </span>
                            ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
            <p className="text-[9px] font-mono text-txt-muted leading-tight">
              An assay range shown in red crosses a band boundary — material billed at one grade
              that tested into another. This is why the bands above are built on the assay and
              not on the material code.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
