"use client";
/**
 * Grade-wise Despatch — the reconciliation, and the caveats.
 *
 * The grade-band table that used to head this file is gone: the mine asked for a
 * day-wise bar graph instead, and the band totals now sit as a summary strip
 * under those bars in GradeDespatchChart. What remains here is the one thing that
 * genuinely needs to be a table.
 *
 * SOLD AS vs ASSAYED is the reason the whole feature exists. What a load was
 * billed as and what it tested are different things — August 2026 had material
 * billed 40-52% assaying down to 35.90, and low-grade material assaying up to
 * 41.22. A billed grade whose assay range crosses a band boundary is flagged red;
 * banding on MATERIAL_DESC would have shown two clean rows and hidden all of it.
 *
 * The two banners below it are deliberately not hidden: assay coverage, and the
 * tonnage the Despatch section's transporter filter drops.
 *
 * The coverage banner used to blame assay lag for the Unassayed row. That was
 * wrong — the whole row was COB concentrate, assayed at plant 1210, which the
 * query was not reading. Corrected; Unassayed now means what it says.
 */
import { AlertTriangle, Scale } from "lucide-react";
import { useGradeDespatch } from "@/hooks/useGradeDespatch";
import { formatIndian } from "@/lib/utils";

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

const thCls = "px-3 py-2 text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary";

export default function GradeDespatchTable() {
  const { data, isLoading, isError, error } = useGradeDespatch();

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

  if (isLoading || !data || data.totals.tonnage === 0) return null;

  const unassayed = data.bands.find((b) => b.key === "UNASSAYED");
  const cov = data.coverage;

  return (
    <div className="space-y-3">

      {/* ── Assay coverage ────────────────────────────────────────────── */}
      {(unassayed?.tonnage ?? 0) > 0 && (
        <div className="p-3 rounded-lg bg-[#fff8e1] border border-[#ffe082]
                        border-l-[3px] border-l-[#c8960c] flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">
              {n1(unassayed?.tonnage)} MT ({pct(unassayed?.share_pct)}) has no assay linked.
            </span>{" "}
            Of the graded tonnage, {n1(cov.tier1_tonnage)} MT is matched to its own consignment
            (PO + batch) and {n1(cov.tier2_tonnage)} MT falls back to the PO average. This row
            is genuinely missing lab results — it is not COB concentrate, which is assayed at
            the plant and carries its own band.
          </div>
        </div>
      )}

      {/* ── Transporter exclusion ─────────────────────────────────────── */}
      {data.excluded.tonnage > 0 && (
        <div className="p-3 rounded-lg bg-bg-section border border-border
                        border-l-[3px] border-l-[#8899bb] flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-txt-muted shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">
              A further {n1(data.excluded.tonnage)} MT across {n0(data.excluded.trips)} trips is
              outside these figures.
            </span>{" "}
            The Despatch section scopes actuals to one transporter and this section matches it so
            the two agree. That excludes{" "}
            {data.excluded.transporters.map((x) => x.transporter || "(blank)").join(", ")}.
            Worth a decision — widening it would move the headline Despatch numbers too.
          </div>
        </div>
      )}

      {/* ── Sold as vs assayed ────────────────────────────────────────── */}
      {data.sold_as.length > 0 && (
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
                  <th className={`${thCls} text-right text-[#6a1b9a]`}>Weighted Cr₂O₃ %</th>
                  <th className={`${thCls} text-right`}>Assay Range</th>
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
                      <td className="px-3 py-2 text-right tabular-nums text-[#6a1b9a]">{g(s.cr2o3)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${
                        straddles ? "text-[#c62828] font-semibold" : "text-txt-secondary"}`}>
                        {s.cr_min == null ? "—" : `${g(s.cr_min)} – ${g(s.cr_max)}`}
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
              that tested into another. This is why the bars above are built on the assay and
              not on the material code.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
