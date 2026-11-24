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
 * THE THREE EMPTY COLUMNS ARE DELIBERATE. Phase 1 sources Block Model, ROM,
 * Mines Despatch and Plant Receipt. The other three are drawn, greyed, because
 * the chain
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
import { Calculator } from "lucide-react";
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
        <Calculator size={13} />
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
                {/* The workbook's Total column. Only the two loss rows fill it;
                    see the body for why the others stay empty. */}
                <th className="px-3 py-2.5 text-right font-condensed font-bold text-[10px]
                               text-navy uppercase tracking-wide bg-bg-section align-bottom
                               border-l-2 border-border min-w-[100px]">
                  Total
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border-light/60">
              {q.isLoading ? (
                <tr>
                  <td colSpan={stages.length + 3} className="px-4 py-8 text-center text-txt-muted">
                    Loading…
                  </td>
                </tr>
              ) : q.isError ? (
                <tr>
                  <td colSpan={stages.length + 3} className="px-4 py-8 text-center text-[#c62828]">
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
                      {/* The stage a loss was measured against is NOT printed in
                          the cell -- at the mine's instruction, 24 Nov 2026. The
                          API still sends `loss_against` and the footnote still
                          says which stages Mines Despatch spans, so the
                          provenance is on the screen in prose rather than as a
                          label under every figure. */}
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
                      {/* TOTALLED ONLY WHERE THE WORKBOOK TOTALS. Summary!J9 and
                          J10 sum the two loss rows and nothing else. Ore summed
                          along the chain would count the same ore five times,
                          and a row of percentages does not sum to anything — so
                          those three cells stay blank rather than carrying a
                          number that looks authoritative and means nothing. */}
                      <td className="px-3 py-2.5 text-right border-l-2 border-border bg-bg-section/40">
                        {isLoss
                          ? <Cell
                              v={(m.key === "chromium_loss"
                                ? q.data?.total.chromium_loss
                                : q.data?.total.contribution_loss) ?? null}
                              dp={m.dp}
                              loss
                            />
                          : <span className="text-txt-light/40">—</span>}
                      </td>
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
              {q.data.pending_stages.join(", ")} are not yet sourced — the ROM stack is
              not held anywhere as a period figure, and stock history begins in August
              2026. Chromium Loss is measured against{" "}
              <span className="font-semibold">the last column that carries a figure</span>,
              which while the chain is part-sourced is not always the one immediately to the
              left.
            </p>
            <p className="text-[9px] text-txt-secondary leading-relaxed">
              <span className="font-bold text-navy">Block Model is a grade, not a reserve. </span>
              Geology&apos;s Cr<sub>2</sub>O<sub>3</sub> for the ground each ROM sample came
              out of, weighted by that sample&apos;s own tonnage so it is comparable with the
              ROM column beside it. <span className="font-semibold">The Ore Quantity and
              Moisture shown in this column are ROM&apos;s, not the model&apos;s</span> — the
              block model is Surpac output and no tonnage has ever been loaded, so what is
              printed here is the same weight the grade was averaged on, shown so the Net
              Chromium beneath it can be checked against the cells that made it. Read it as
              the metal that grade implies on the ore actually mined, never as a reserve.
              Block Model itself shows no loss: it is the start of the chain and has no
              stage to its left to lose against.
            </p>
            <p className="text-[9px] text-txt-secondary leading-relaxed">
              <span className="font-bold text-navy">ROM&apos;s loss is a grade variance, not
              a tonnage one. </span>
              Net Chromium for Block Model is computed on the ROM tonnage and ROM moisture
              beside it — the same weight that produced the block grade in the first place,
              which is why those two cells now repeat ROM&apos;s figures exactly. Both sides
              therefore carry identical tonnage and moisture and everything cancels but the
              grade, so <span className="font-semibold">ROM&apos;s Chromium Loss is the gap
              between the two Cr<sub>2</sub>O<sub>3</sub> figures and nothing else</span> —
              a negative loss means the ground assayed better than Geology called it.{" "}
              <span className="font-semibold">It is not the mine workbook&apos;s Block Model
              loss</span>, which also carries whatever tonnage the model promised and the
              mine did not dig; that half needs the Surpac tonnage loaded and will move this
              figure when it arrives.
            </p>
            <p className="text-[9px] text-txt-secondary leading-relaxed">
              <span className="font-bold text-navy">ROM is the mine&apos;s own entry. </span>
              Tonnage and Cr<sub>2</sub>O<sub>3</sub> are summed from the day-wise ROM
              analysis filed shift by shift, not from the lab&apos;s inspection lots.
              Moisture is the lab&apos;s daily composite for the mine&apos;s ROM lots,
              carried onto every sample of that day. <span className="font-semibold">It is
              reported only when every sample in the period carries one</span> — one day
              the lab was silent on keeps the column, and Net Chromium with it, blank
              rather than computed off a part-measured month.
            </p>
            <p className="text-[9px] text-txt-secondary leading-relaxed">
              <span className="font-bold text-navy">Mines Despatch is measured across the
              three unsourced stages. </span>
              Its loss is the drop from ROM, because ROM Stack and Mines Closing Stock have
              no figures to measure against yet, so the gap carries whatever happened in
              them. <span className="font-semibold">That is why it reads negative.</span> The
              mine despatched 1,639.06 Mt MORE than it mined in this window and drew the
              difference out of stock, so the arithmetic returns a gain. It is a true
              difference between two true figures — it is not metal found, and it should not
              be read as a mining performance. It resolves on its own, with no change here,
              the day the stock stages are sourced and the chain stops stepping over them.
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
          {/* The three terms, not the 0.75 they reduce to. When NSR moves, the
              number that changed has to be visible on the screen that used it. */}
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">CONTRIBUTION · </span>
            (Cr LOSS ÷ {q.data?.fecr_cr_content ?? 0.6}) × ₹
            {(q.data?.contribution_per_mt_fecr ?? 45000).toLocaleString("en-IN")}/MT FeCr ÷ 10⁵
          </p>
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">NSR · </span>
            ₹{(q.data?.nsr_per_mt_fecr ?? 115000).toLocaleString("en-IN")} − VAR COST ₹
            {(q.data?.variable_cost_per_mt_fecr ?? 70000).toLocaleString("en-IN")} · fixed for now
          </p>
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">DESPATCH &amp; RECEIPT · </span>SAP
          </p>
        </div>
      </div>
    </section>
  );
}
