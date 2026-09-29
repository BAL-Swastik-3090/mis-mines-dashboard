"use client";
/**
 * Plant output — the ferrochrome the ore became, and its analysis.
 *
 * The last link in the chain this page follows: the mine's assay, the receiving
 * plant's assay of the same consignment, and then this.
 *
 * ITS OWN SECTION, NOT MORE COLUMNS ON THE CONSIGNMENT TABLE. A row up there is
 * one stack on one despatch day; a row here is one furnace on one production
 * day. A furnace runs on a blended bunker feed drawn from many stacks at once,
 * so no heat belongs to a stack and no single row could carry both.
 *
 * BLANK MEANS NOT ASSAYED. Chromium and Silicon are measured on nearly every
 * furnace-day, Phosphorus on most, Carbon and Sulphur on about half — so the
 * last two columns are often empty, and the footer says what share of the
 * tonnage each average actually covers. An average over half the output is a
 * different claim from one over all of it.
 *
 * JABAMOYEE PRODUCES BUT DOES NOT ASSAY. It files no composite sample at all,
 * so its rows carry a yield and no chemistry. Shown rather than dropped: 965 t
 * of production left out would be a bigger error than five blank columns.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Factory } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { useDateFilter } from "@/contexts/useDateFilter";
import SearchSelect from "@/components/minehub/SearchSelect";
import ChainScorecard from "@/components/tables/ChainScorecard";

const PARAMS = ["cr", "si", "c", "p", "s"] as const;
type Param = (typeof PARAMS)[number];

interface Row {
  date: string;
  plant: string;
  plant_label: string;
  furnace: string;
  yield_t: number;
  taps: number;
  cr: number | null;
  si: number | null;
  c: number | null;
  p: number | null;
  s: number | null;
}
interface Totals {
  furnace_days: number;
  taps: number;
  yield_t: number;
  [k: string]: number | null;
}
interface Plant { key: string; label: string }
interface Resp {
  from: string; to: string;
  plants: Plant[];
  rows: Row[];
  totals: Record<string, Totals>;
}

const ALL_PLANTS = "ALL";

/** Phosphorus and sulphur run in the third and fourth decimal; the rest do not. */
const DP: Record<Param, number> = { cr: 2, si: 2, c: 2, p: 4, s: 4 };
const HEADS: Record<Param, string> = {
  cr: "Cr%", si: "Si%", c: "C%", p: "P%", s: "S%",
};

/* Ten rows at a time, header and total pinned — the same window the
 * consignment table uses, and for the same reason: the figures have to be
 * readable without losing the column names. Heights are fixed because the
 * sticky header's offset has to be an exact pixel count. */
const HEAD_H = 28;
// The second header row is taller because it holds a control rather than a
// word. Its height does not decide where it sticks — that is the first row's
// height — but the scroll window is measured from both, so it is stated.
const HEAD2_H = 36;
const ROW_H = 33;
const VISIBLE_ROWS = 10;
const WINDOW_H = HEAD_H + HEAD2_H + ROW_H * (VISIBLE_ROWS + 1);

// The background belongs on the cell, never the row: with border-collapse a
// sticky row is ignored in Chrome, and a transparent sticky cell lets the body
// scroll through it.
const STICKY_HEAD = "sticky top-0 z-20 bg-navy";
const STICKY_2 = "sticky z-20 bg-navy";
const STICKY_FOOT = "sticky bottom-0 z-10 bg-bg-section border-t-2 border-navy/20";
const TH = "px-2 font-condensed font-extrabold text-[11px] tracking-[.1em]";
const TD = "px-2 py-2 leading-4 text-right text-[12px] whitespace-nowrap";
const TF = `${TD} ${STICKY_FOOT}`;

function Val({ v, dp }: { v: number | null; dp: number }) {
  if (v == null) return <span className="text-txt-light/40">—</span>;
  return <span className="font-mono text-navy">{formatIndian(v, dp)}</span>;
}

export default function PlantOutputTable() {
  // Follows the page-wide date filter, same as the sections around it.
  const from = useDateFilter((x) => x.apiFrom);
  const to = useDateFilter((x) => x.apiTo);
  const [plant, setPlant] = useState<string>(ALL_PLANTS);
  const [furnace, setFurnace] = useState<string>("");

  const q = useQuery<Resp>({
    queryKey: ["plant-output", from, to],
    queryFn: async () =>
      (await api.get("/plant-output", {
        params: { from_date: from, to_date: to },
      })).data,
    staleTime: 5 * 60 * 1000,
  });

  const plants = q.data?.plants ?? [];

  // Newest production day first — the row anyone opens this for is the last one.
  const everything = useMemo(
    () => [...(q.data?.rows ?? [])].sort(
      (a, b) => b.date.localeCompare(a.date)
        || a.plant.localeCompare(b.plant)
        || a.furnace.localeCompare(b.furnace)),
    [q.data],
  );

  const byPlant = useMemo(
    () => (plant === ALL_PLANTS
      ? everything
      : everything.filter((r) => r.plant === plant)),
    [everything, plant],
  );

  // The furnaces actually present in what the plant filter has left, so the
  // list never offers one that would empty the table.
  const furnaces = useMemo(
    () => [...new Set(byPlant.map((r) => r.furnace))].sort(),
    [byPlant],
  );

  /* A furnace chosen under one plant may not exist under the next — F5 does
     not run at Jabamoyee. Derived rather than corrected with setState during
     render: an unavailable choice simply stops filtering, and the select falls
     back to "All furnaces" on its own. */
  const activeFurnace = furnaces.includes(furnace) ? furnace : "";

  const rows = useMemo(
    () => (activeFurnace
      ? byPlant.filter((r) => r.furnace === activeFurnace)
      : byPlant),
    [byPlant, activeFurnace],
  );

  /* Which background band each date falls in.
   *
   * Alternating per DATE rather than per row: a production day is five rows on
   * Balasore and one on Jabamoyee, and a plain zebra stripe would cut straight
   * through the grouping the reader is trying to see. Built from the rows on
   * screen, so filtering to one furnace still bands by day. */
  const band = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    for (const r of rows) {
      if (!m.has(r.date)) m.set(r.date, i++ % 2);
    }
    return m;
  }, [rows]);

  const t = q.data?.totals?.[plant];

  return (
    <section className="space-y-2">
      <div className="section-title">
        <Factory size={13} />
        Plant Output — Ferrochrome Produced
        <span className="text-[10px] text-txt-light font-medium normal-case tracking-normal ml-1">
          by furnace · daily composite analysis
        </span>
      </div>

      {/* What the page is opened for, before the detail that supports it.
          The tiles that stood here carried a tonnage, a tap count and one
          percentage — all of it repeated by the table below, and two of the
          three a total of the rows already in view. Choosing a plant, which is
          what they were really for, is now a control in the column it
          filters. */}
      <ChainScorecard />

      <div className="rounded-xl overflow-hidden border border-border shadow-md bg-white">
        {q.isLoading ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 bg-bg-section animate-pulse rounded" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="p-4 text-[12px] text-danger">
            Could not load plant output.
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-txt-light">
            No furnace production in this period.
          </div>
        ) : (
          <div className="overflow-auto"
            style={{ maxHeight: rows.length > VISIBLE_ROWS ? WINDOW_H : undefined }}>
            <table className="w-full border-collapse min-w-[860px]">
              <thead>
                {/* Banded like the consignment table above: what ran, then what
                    came out of it. The analysis columns are one group and are
                    named once, rather than five headings with nothing saying
                    they belong together. */}
                <tr className="text-white" style={{ height: HEAD_H }}>
                  <th className={`${TH} ${STICKY_HEAD} text-left`} rowSpan={2}>Date</th>
                  <th className={`${TH} ${STICKY_HEAD} text-left`}>Plant</th>
                  <th className={`${TH} ${STICKY_HEAD} text-left`}>Furnace</th>
                  <th className={`${TH} ${STICKY_HEAD} text-center border-r border-white/20`}
                    colSpan={2}>
                    Produced
                  </th>
                  <th className={`${TH} ${STICKY_HEAD} text-center`}
                    colSpan={PARAMS.length}>
                    Composite Analysis
                  </th>
                </tr>
                <tr className="text-white/90" style={{ height: HEAD2_H }}>
                  {/* The same choice the tiles above make, in the column it
                      belongs to. It reads and writes the same `plant`, so the
                      tiles and this can never disagree — it is for somebody
                      already down in the table who does not want to scroll
                      back up to change it. */}
                  <th style={{ top: HEAD_H }}
                    className={`${STICKY_2} px-1.5 pb-1 text-left`}>
                    {/* Sized to the longest plant name, not to the column. A
                        select stretched edge to edge is a control shouting over
                        the data underneath it. */}
                    <SearchSelect narrow value={plant === ALL_PLANTS ? "" : plant}
                      onChange={(v) => setPlant(v || ALL_PLANTS)}
                      allLabel="Both plants"
                      options={plants.map((pl) => ({
                        value: pl.key, label: pl.label,
                      }))}
                      className="w-[118px] bg-white/10 border-white/25 text-white
                                 font-normal hover:border-white/50" />
                  </th>
                  <th style={{ top: HEAD_H }}
                    className={`${STICKY_2} px-1.5 pb-1 text-left`}>
                    <SearchSelect narrow value={activeFurnace} onChange={setFurnace}
                      allLabel="All furnaces"
                      options={furnaces.map((f) => ({ value: f, label: f }))}
                      className="w-[104px] bg-white/10 border-white/25 text-white
                                 font-normal hover:border-white/50" />
                  </th>
                  <th style={{ top: HEAD_H }}
                    className={`${TH} ${STICKY_2} text-right align-bottom pb-2`}>
                    Yield&nbsp;(t)
                  </th>
                  <th style={{ top: HEAD_H }}
                    className={`${TH} ${STICKY_2} text-right align-bottom pb-2
                                border-r border-white/20`}>
                    Taps
                  </th>
                  {PARAMS.map((pp) => (
                    <th key={pp} style={{ top: HEAD_H }}
                      className={`${TH} ${STICKY_2} text-right align-bottom pb-2`}>
                      {HEADS[pp]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  /* Two very pale tints so the figures stay the loudest thing
                     on the row; Jabamoyee warm, everything else neutral. */
                  const alt = band.get(r.date) === 1;
                  const jab = r.plant !== "1100";
                  const bg = jab
                    ? (alt ? "bg-gold/10" : "bg-gold/5")
                    : (alt ? "bg-sky/5" : "bg-transparent");
                  return (
                  <tr key={`${r.date}|${r.plant}|${r.furnace}`}
                    style={{ height: ROW_H }}
                    className={`${bg} border-b border-border-light last:border-0
                                hover:bg-bg-soft/70 transition-colors`}>
                    <td className="px-2 py-2 leading-4 text-[12px] whitespace-nowrap text-txt-primary">
                      {r.date.slice(8, 10)}.{r.date.slice(5, 7)}.{r.date.slice(2, 4)}
                    </td>
                    {/* Shown whether or not a plant is selected. A column that
                        vanishes takes the table's shape with it: everything
                        shifts left, and a screen printed with one plant chosen
                        no longer says which. */}
                    <td className="px-2 py-2 leading-4 text-[12px]">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px]
                        font-bold tracking-wide ${r.plant === "1100"
                          ? "bg-navy/10 text-navy" : "bg-gold/15 text-gold-dark"}`}>
                        {r.plant_label}
                      </span>
                    </td>
                    <td className="px-2 py-2 leading-4 text-[12px] font-mono text-txt-primary">
                      {r.furnace}
                    </td>
                    <td className={TD}>
                      <span className="font-mono font-bold text-navy">
                        {formatIndian(r.yield_t, 2)}
                      </span>
                    </td>
                    <td className={`${TD} border-r border-border-light`}>
                      <span className="font-mono text-navy">{r.taps}</span>
                    </td>
                    {PARAMS.map((p) => (
                      <td key={p} className={TD}>
                        <Val v={r[p]} dp={DP[p]} />
                      </td>
                    ))}
                  </tr>
                  );
                })}
              </tbody>
              {t && (
                <tfoot>
                  <tr style={{ height: ROW_H }}>
                    <td className={`px-2 py-2 leading-4 text-[11px] font-condensed
                      font-extrabold tracking-[.1em] text-navy text-left ${STICKY_FOOT}`}
                      colSpan={3}>
                      WTD AVG
                    </td>
                    <td className={TF}>
                      <span className="font-mono font-bold text-navy">
                        {formatIndian(t.yield_t, 2)}
                      </span>
                    </td>
                    <td className={`${TF} border-r border-border-light`}>
                      <span className="font-mono font-bold text-navy">{t.taps}</span>
                    </td>
                    {PARAMS.map((p) => (
                      <td key={p} className={TF}>
                        <Val v={t[p] as number | null} dp={DP[p]} />
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <div className="border-t border-border-light px-3 py-1 flex items-center
                        justify-between flex-wrap gap-1">
          <span className="text-[10px] text-txt-light/60">
            Averages weighted by yield · analysis is the day&apos;s composite sample
          </span>
          {/* How much of the tonnage each average actually covers — Carbon and
              Sulphur are assayed on roughly half the furnace-days. */}
          {t && (
            <span className="text-[9px] text-txt-light/50">
              assayed share of tonnage:{" "}
              {PARAMS.map((p) => `${HEADS[p]} ${t[`${p}_covered_pct`] ?? 0}%`).join(" · ")}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
