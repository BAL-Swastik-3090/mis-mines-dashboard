"use client";
/**
 * AMIRA Accounting — contained chromium followed along the chain.
 *
 * WHY THE TABLE IS TRANSPOSED. The mine's own workbook puts the seven stages
 * across the top and the six measures down the side, and it is read across: one
 * row, say Cr2O3, is followed left to right to watch the grade move between the
 * block model and the furnace. Laying it out the usual way — a row per stage —
 * would make that comparison vertical and break every reader's muscle memory
 * for a sheet they already use. The shape here matches the sheet exactly.
 *
 * THE FIVE EMPTY COLUMNS ARE DELIBERATE. Phase 1 sources only Mines Despatch
 * and Plant Receipt. The other five are still drawn, greyed, because the chain
 * starting at the block model IS the point of the table; dropping the columns
 * until they have data would quietly change what the screen is about, and the
 * day they arrive nobody would recognise it as the same table.
 *
 * UoM NOTE. The source sheet labels Cr2O3 and Moisture "Mt". They are
 * percentages — Net Chromium only reproduces the sheet's own figures when they
 * are treated as such. Shown here as "%", since printing Mt against a number
 * like 44.97 would carry a typo into a system of record.
 */
import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { AmiraResponse, AmiraStage } from "@/types";

/** The six measures, in the sheet's order, with how each one is written. */
const MEASURES = [
  { key: "ore_qty",           label: "Ore Quantity",       uom: "Mt",        dp: 2 },
  { key: "cr2o3",             label: "Cr2O3",              uom: "%",         dp: 2 },
  { key: "moisture",          label: "Moisture",           uom: "%",         dp: 2 },
  { key: "net_chromium",      label: "Net Chromium Qty",   uom: "Mt",        dp: 2 },
  { key: "chromium_loss",     label: "Chromium Loss",      uom: "Mt",        dp: 2 },
  { key: "contribution_loss", label: "Contribution Loss",  uom: "Rs. Lacs",  dp: 2 },
] as const;

type MeasureKey = (typeof MEASURES)[number]["key"];

/** A number, or an em dash where there is nothing to show.
 *
 *  A loss is a negative-is-good quantity, so the colours are the opposite way
 *  round from the rest of the dashboard: metal lost between two stages is red,
 *  and a stage that gained reads green. The sheet shows a gain in brackets,
 *  which is kept — accountants read (55.07) faster than -55.07. */
function Cell({ v, dp, loss }: { v: number | null; dp: number; loss?: boolean }) {
  if (v === null || v === undefined) {
    return <span className="text-txt-light/50">—</span>;
  }
  if (loss) {
    const gain = v < 0;
    return (
      <span className={`font-mono font-semibold ${gain ? "text-success" : "text-[#c62828]"}`}>
        {gain ? `(${formatIndian(Math.abs(v), dp)})` : formatIndian(v, dp)}
      </span>
    );
  }
  return <span className="font-mono text-navy">{formatIndian(v, dp)}</span>;
}

function niceDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function AmiraAccountingTable() {
  const from = useDateFilter((x) => x.apiFrom);
  const to = useDateFilter((x) => x.apiTo);

  const q = useQuery<AmiraResponse>({
    queryKey: ["amira", from, to],
    queryFn: async () =>
      (await api.get("/amira", { params: { from_date: from, to_date: to } })).data,
    staleTime: 5 * 60 * 1000,
  });

  const stages: AmiraStage[] = q.data?.stages ?? [];
  const live = stages.filter((s) => s.available).length;

  /* The closing-stock heading carries the date it is "as on", the way the sheet
     does. Taken from the filter's end rather than written into the label, so it
     cannot drift from the period actually being shown. */
  const heading = (s: AmiraStage) =>
    s.key === "closing_stock" && q.data
      ? `Mines Closing Stock as on ${niceDate(q.data.to_date)}`
      : s.key === "prod_plus_cs" && q.data
        ? `Total Mines Production + Closing Stock as on ${niceDate(q.data.to_date)}`
        : s.label;

  return (
    <section className="space-y-2">
      <div className="section-title">
        <Scale size={13} />
        AMIRA Accounting
        <span className="text-[10px] text-txt-light font-medium normal-case tracking-normal ml-1">
          contained chromium, mine to plant
        </span>
        <span className="ml-auto text-[10px] font-mono text-txt-light normal-case tracking-normal">
          Phase 1 · {live} of {stages.length} stages
        </span>
      </div>

      <div className="bg-white rounded-lg border border-border-light shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-bg-section">
                {/* Sticky on the CELLS, not the row — under border-collapse a
                    position:sticky on <th>'s parent does nothing. */}
                <th className="sticky left-0 z-10 bg-bg-section px-3 py-2.5 text-left font-condensed
                               font-bold text-[10px] text-navy uppercase tracking-wide
                               border-r border-border-light min-w-[150px]">
                  Particulars
                </th>
                <th className="px-2 py-2.5 text-center font-condensed font-bold text-[10px]
                               text-navy uppercase tracking-wide border-r border-border-light">
                  UoM
                </th>
                {stages.map((s) => (
                  <th
                    key={s.key}
                    className={`px-3 py-2.5 text-right font-condensed font-bold text-[10px]
                                uppercase tracking-wide border-r border-border-light
                                last:border-r-0 min-w-[120px] align-bottom
                                ${s.available ? "text-navy" : "text-txt-light/60"}`}
                  >
                    {heading(s)}
                    {!s.available && (
                      <div className="text-[8px] font-normal normal-case tracking-normal
                                      text-txt-light/50 mt-0.5">
                        not yet sourced
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-border-light/60">
              {q.isLoading ? (
                <tr>
                  <td colSpan={MEASURES.length + 2} className="px-4 py-8 text-center text-txt-muted">
                    Loading…
                  </td>
                </tr>
              ) : q.isError ? (
                <tr>
                  <td colSpan={MEASURES.length + 2} className="px-4 py-8 text-center text-[#c62828]">
                    Could not load AMIRA accounting
                  </td>
                </tr>
              ) : (
                MEASURES.map((m) => {
                  const isLoss = m.key === "chromium_loss" || m.key === "contribution_loss";
                  return (
                    <tr key={m.key} className="hover:bg-bg-section/40 transition-colors">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2.5 font-condensed
                                     font-bold text-[11px] text-navy border-r border-border-light">
                        {m.label}
                      </td>
                      <td className="px-2 py-2.5 text-center text-[10px] text-txt-light
                                     border-r border-border-light whitespace-nowrap">
                        {m.uom}
                      </td>
                      {stages.map((s) => (
                        <td
                          key={s.key}
                          className={`px-3 py-2.5 text-right border-r border-border-light
                                      last:border-r-0 ${s.available ? "" : "bg-bg-section/30"}`}
                        >
                          <Cell
                            v={s[m.key as MeasureKey] as number | null}
                            dp={m.dp}
                            loss={isLoss}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* What a reader must know before quoting anything off this table. */}
        {!q.isLoading && q.data && (
          <div className="px-3 py-2 border-t border-border-light/40 bg-[#fff8e1] space-y-1">
            <p className="text-[9px] text-txt-secondary leading-relaxed">
              <span className="font-bold text-navy">Phase 1. </span>
              {q.data.pending_stages.join(", ")} are not yet sourced — the block model
              carries no tonnage, ROM carries no moisture, and stock history begins in
              August 2026. Chromium Loss is measured against the stage immediately to the
              left, so <span className="font-semibold">Mines Despatch shows no loss until
              ROM Stack is built</span>.
            </p>
            {q.data.plant_qty_mirrors_despatch && (
              <p className="text-[9px] text-txt-secondary leading-relaxed">
                <span className="font-bold text-navy">Plant tonnage mirrors despatch. </span>
                At the mine&apos;s instruction, until the plant-side gate record is
                identified. The loss between the last two columns is therefore a grade and
                moisture difference only, not a weight difference.
              </p>
            )}
          </div>
        )}

        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40
                        flex flex-wrap gap-x-4 gap-y-1">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">NET Cr · </span>
            ORE × (1 − MOIST%) × Cr2O3% × {q.data?.cr2o3_to_cr ?? "0.68421"}
          </p>
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">CONTRIBUTION · </span>
            Cr LOSS × {q.data?.contribution_rate ?? 0.75} Rs. LACS/MT
          </p>
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">DESPATCH &amp; RECEIPT · </span>SAP
          </p>
        </div>
      </div>
    </section>
  );
}
