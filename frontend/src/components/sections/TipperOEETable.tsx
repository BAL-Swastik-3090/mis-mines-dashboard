"use client";
import { Download } from "lucide-react";

import { formatIndian } from "@/lib/utils";
import { toCsv, download } from "@/components/minehub/spreadsheet";
import type { TipperOEERow, TipperOEEFleet } from "@/types";

/* Ten columns, in the order the mine reads them: the hours first, then the
 * trips, then the four percentages they multiply into.
 *
 * NOTHING IS CAPPED, unlike the excavator table. A Utilisation over 100% means
 * the breakdown hours behind it are wrong — an SAP notification left open
 * shrinks the denominator while the truck keeps working — and the mine asked
 * for the arithmetic as written. A cap would turn a visible data fault into a
 * plausible-looking number, which is how the tipper figures went unquestioned
 * for so long. Over-100 values are coloured as a warning instead. */

const SOURCE_LABEL: Record<string, string> = {
  telematics: "TECHNOTON",
  shift_log:  "SHIFT LOG",
  sap:        "SAP",
};

function fmt2(v: number) { return v.toFixed(2); }
function fmt0(v: number) { return formatIndian(Math.round(v)); }

/** A percentage, or an em dash where the server said the question was empty.
 *  Blank is not nought: a truck down all period has no Utilisation, and one
 *  with no Ideal Trip has no Yield. */
function Pct({ v, high = 75, mid = 50 }: { v: number | null; high?: number; mid?: number }) {
  if (v == null) return <span className="text-txt-light">—</span>;
  // Over 100 is impossible, so it is coloured as a fault rather than as a
  // triumph — green on 105% would read as the best truck in the fleet.
  const cls = v > 100 ? "text-[#c62828] font-extrabold"
    : v >= high ? "text-[#2e7d32]"
    : v >= mid  ? "text-[#c8960c]"
    : "text-[#c62828]";
  return (
    <span className={`font-bold ${cls}`} title={v > 100
      ? "Over 100% — the breakdown hours behind this are overstated, "
        + "which happens when a SAP notification is left open"
      : undefined}>
      {fmt2(v)}
    </span>
  );
}

const HEADINGS = [
  "Equipment Name", "God Hour", "Engine Hrs", "BD Hrs", "Ideal Trip",
  "Actual Trip", "Availability %", "Utilisation %", "Yield %", "OEE %",
];

function exportRows(rows: TipperOEERow[], fleet: TipperOEEFleet | undefined) {
  const n2 = (v: number) => Number(v.toFixed(2));
  const out: unknown[][] = rows.map((m) => [
    m.machine, n2(m.god_hours), n2(m.engine_hrs), n2(m.bd_hours),
    Math.round(m.ideal_trip), Math.round(m.actual_trip),
    m.availability ?? "", m.utilisation ?? "", m.yield_pct ?? "", m.oee ?? "",
  ]);
  if (fleet && rows.length) {
    out.push([
      "OVERALL", n2(fleet.god_hours), n2(fleet.engine_hrs), n2(fleet.bd_hours),
      Math.round(fleet.ideal_trip), Math.round(fleet.actual_trip),
      fleet.availability ?? "", fleet.utilisation ?? "",
      fleet.yield_pct ?? "", fleet.oee ?? "",
    ]);
  }
  return out;
}

export default function TipperOEETable({
  title, slug, machines, fleet, loading, from, to, note,
}: {
  title: string; slug: string;
  machines: TipperOEERow[]; fleet: TipperOEEFleet | undefined;
  loading: boolean; from?: string; to?: string; note?: string;
}) {
  const canExport = !loading && machines.length > 0;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between gap-3">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          {title}
        </span>
        <button
          type="button"
          onClick={() => download(
            toCsv(HEADINGS, exportRows(machines, fleet)),
            `oee-${slug}-${from ?? ""}-to-${to ?? ""}.csv`)}
          disabled={!canExport}
          title={canExport ? "Download this table as a spreadsheet" : "Nothing to export yet"}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded border
                     border-border bg-white text-[10px] font-condensed font-bold uppercase
                     tracking-widest text-navy hover:bg-bg-soft
                     disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white
                     focus:outline-none focus:ring-1 focus:ring-navy"
        >
          <Download size={12} />
          Excel
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-mono">
          <thead>
            <tr className="bg-bg-section border-b border-border-light">
              {HEADINGS.map((h) => (
                <th key={h}
                    className="px-3 py-2 text-left text-[10px] font-condensed font-bold
                               tracking-widest uppercase text-txt-secondary whitespace-pre-line">
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-border-light/60">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {HEADINGS.map((__, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-4 w-14 bg-bg-section animate-pulse rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : machines.length === 0 ? (
              <tr>
                <td colSpan={HEADINGS.length}
                    className="px-4 py-8 text-center text-txt-muted text-sm font-sans">
                  No data for selected period
                </td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m.machine} className="hover:bg-bg-section/50 transition-colors">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="font-condensed font-bold text-[12px] text-navy">
                      {m.machine}
                    </div>
                    {/* A truck absent from the shift log has no Actual Trip —
                        which looks exactly like a truck that made none. Saying
                        so is the only way to tell the two apart. */}
                    {m.days_logged === 0 && (
                      <div className="text-[9px] text-[#c8960c]" title="No shift-log entries in this period, so Actual Trip cannot be measured">
                        not in shift log
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt0(m.god_hours)}</td>
                  {/* Engine hrs — and where they came from, because the new
                      tippers have no telematics unit at all. */}
                  <td className="px-3 py-2.5 text-[#2e7d32] font-semibold">
                    <div>{fmt2(m.engine_hrs)}</div>
                    <div className="text-[8px] font-normal text-txt-light tracking-wide">
                      {SOURCE_LABEL[m.engine_source]}
                    </div>
                  </td>
                  <td className={`px-3 py-2.5 font-semibold ${m.bd_hours > 0 ? "text-[#c62828]" : "text-txt-light"}`}>
                    <div>{fmt2(m.bd_hours)}</div>
                    <div className="text-[8px] font-normal text-txt-light tracking-wide">
                      {SOURCE_LABEL[m.bd_source]}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-txt-light">{fmt0(m.ideal_trip)}</td>
                  <td className="px-3 py-2.5 text-navy font-semibold">{fmt0(m.actual_trip)}</td>
                  <td className="px-3 py-2.5"><Pct v={m.availability} high={85} mid={70} /></td>
                  <td className="px-3 py-2.5"><Pct v={m.utilisation} high={70} mid={50} /></td>
                  <td className="px-3 py-2.5"><Pct v={m.yield_pct} high={85} mid={70} /></td>
                  <td className="px-3 py-2.5 font-extrabold">
                    <Pct v={m.oee} />
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {/* Weighted roll-up from the server — the hours and trips are summed
              and the four formulae applied once, never an average of the rows. */}
          {!loading && fleet && machines.length > 0 && (
            <tfoot>
              <tr className="bg-bg-section border-t-2 border-border font-bold">
                <td className="px-3 py-3 font-condensed text-[12px] text-navy tracking-widest uppercase">
                  Overall
                </td>
                <td className="px-3 py-3 text-navy">{fmt0(fleet.god_hours)}</td>
                <td className="px-3 py-3 text-[#2e7d32]">{fmt2(fleet.engine_hrs)}</td>
                <td className="px-3 py-3 text-[#c62828]">{fmt2(fleet.bd_hours)}</td>
                <td className="px-3 py-3 text-txt-secondary">{fmt0(fleet.ideal_trip)}</td>
                <td className="px-3 py-3 text-navy">{fmt0(fleet.actual_trip)}</td>
                <td className="px-3 py-3"><Pct v={fleet.availability} high={85} mid={70} /></td>
                <td className="px-3 py-3"><Pct v={fleet.utilisation} high={70} mid={50} /></td>
                <td className="px-3 py-3"><Pct v={fleet.yield_pct} high={85} mid={70} /></td>
                <td className="px-3 py-3"><Pct v={fleet.oee} /></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Trucks on the roster the shift log never mentions. Listed rather than
          left as a row of zeros the reader has to notice for themselves. */}
      {!loading && fleet && fleet.unlogged.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-[#fff8e1]">
          <p className="text-[9px] text-txt-secondary leading-tight">
            <span className="font-bold text-navy">No shift-log entries this period: </span>
            {fleet.unlogged.join(", ")} — Actual Trip reads 0 because nothing was
            recorded, which is not the same as no trips made.
          </p>
        </div>
      )}

      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">GOD HRS · </span>DAYS × 24
          {"   "}
          <span className="font-semibold text-success/60">IDEAL TRIP · </span>
          {slug === "old-tipper" ? "ENGINE HRS × 1.5" : "FIXED PER MACHINE"}
          {"   "}
          <span className="font-semibold text-success/60">ACTUAL TRIP · </span>IMOS SHIFT LOG
        </p>
        {note && (
          <p className="text-[9px] font-mono text-[#c8960c] leading-tight mt-0.5">{note}</p>
        )}
      </div>
    </div>
  );
}
