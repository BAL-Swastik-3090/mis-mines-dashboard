"use client";
/**
 * The four figures a morning meeting opens with.
 *
 * The tables below carry the whole chain — every consignment the mine sent,
 * what the receiving plant made of it, and what came out of the furnaces. That
 * is the right level to argue from and the wrong level to start at. The first
 * question is always the same:
 *
 *     what grade did we send, and what did the plant call it
 *     what are we producing, and what is it assaying
 *
 * SIDE BY SIDE, because they are one question. The ore going in and the metal
 * coming out are read together or not at all; stacked, the second is below the
 * fold on a laptop and stops being looked at.
 *
 * MINE AGAINST PLANT IN ADJACENT COLUMNS, never as a single "variance". The
 * two assays are both measurements, and which one is right is exactly what the
 * meeting is for. A difference column decides that argument by presenting one
 * as the error in the other.
 *
 * THE LAST THREE CONSIGNMENTS sit under the month for the same reason: a
 * month's average moves slowly and hides a drift that started on Tuesday.
 * Balasore's month reads 43.04 and its last three read 40.89, which is the
 * whole point of the row.
 *
 * WHAT IS BLANK IS BLANK. Jabamoyee files no composite sample, so its metal
 * columns carry a dash rather than a zero. A zero is a measurement.
 */
import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FlaskConical, Truck } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { useDateFilter } from "@/contexts/useDateFilter";

interface OreSide {
  consignments: number; qty: number;
  mines_cr2o3: number | null; plant_cr2o3: number | null;
  mines_cr_fe: number | null; plant_cr_fe: number | null;
}
interface MetalSide {
  furnace_days: number; yield_t: number;
  cr: number | null; cr_fe: number | null; cr_fe_derived: boolean;
}
interface Scorecard {
  ore: {
    destinations: { key: string; label: string }[];
    mtd: Record<string, OreSide>;
    recent: Record<string, OreSide>;
    recent_of: number;
  };
  metal: {
    plants: { key: string; label: string }[];
    mtd: Record<string, MetalSide>;
    last_day: Record<string, MetalSide>;
    last_day_date: string | null;
  };
}

const ddmm = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "—";

/** A dash, not a zero. A blank means nobody measured it; nought is a reading. */
function N({ v, dp = 2 }: { v: number | null | undefined; dp?: number }) {
  if (v == null) return <span className="text-txt-light/40">—</span>;
  return <span className="font-mono text-navy">{formatIndian(v, dp)}</span>;
}

const TH = "px-2 py-1 font-condensed font-extrabold text-[10px] tracking-[.1em] text-white/90";
const RL = "px-2 py-1.5 text-[11px] text-txt-secondary whitespace-nowrap";
const TD = "px-2 py-1.5 text-right text-[12px] whitespace-nowrap";

export default function ChainScorecard() {
  const from = useDateFilter((x) => x.apiFrom);
  const to = useDateFilter((x) => x.apiTo);

  const q = useQuery<Scorecard>({
    queryKey: ["chain-scorecard", from, to],
    queryFn: async () =>
      (await api.get("/plant-output/scorecard", {
        params: { from_date: from, to_date: to },
      })).data,
    staleTime: 5 * 60 * 1000,
  });

  if (q.isLoading) {
    return (
      <div className="h-[132px] rounded-xl bg-bg-section/60 animate-pulse mb-3" />
    );
  }
  if (!q.data) return null;

  const { ore, metal } = q.data;
  const dests = ore.destinations ?? [];
  const plants = metal.plants ?? [];

  return (
    <div className="grid lg:grid-cols-2 gap-3 mb-3">

      {/* ── ore out ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border-light bg-bg-base overflow-hidden">
        <div className="px-3 py-1.5 bg-navy flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 text-white/70" />
          <span className="font-condensed font-extrabold text-[11px] tracking-[.12em]
                           text-white">
            ORE DESPATCH — MINES TO PLANT
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[430px]">
            <thead>
              <tr className="bg-navy/90">
                <th className={`${TH} text-left`} colSpan={2} />
                {dests.map((d) => (
                  <th key={d.key} className={`${TH} text-center border-l border-white/15`}
                    colSpan={2}>
                    {d.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-navy/75">
                <th className={`${TH} text-left`} colSpan={2} />
                {dests.map((d) => (
                  <ThPair key={d.key} />
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ["MTD", ore.mtd],
                [`Last ${ore.recent_of} consignments`, ore.recent],
              ] as const).map(([label, block], bi) => (
                <Fragment key={label}>
                  <tr className={bi ? "border-t-2 border-border" : ""}>
                    <td className={`${RL} font-semibold text-navy`} rowSpan={2}>
                      {label}
                      <span className="block text-[9.5px] text-txt-light font-normal">
                        {dests.map((d) => block[d.key]?.consignments ?? 0).join(" / ")} cons.
                      </span>
                    </td>
                    <td className={RL}>Cr<sub>2</sub>O<sub>3</sub></td>
                    {dests.map((d) => (
                      <Pair key={d.key} a={block[d.key]?.mines_cr2o3}
                        b={block[d.key]?.plant_cr2o3} />
                    ))}
                  </tr>
                  <tr className="border-b border-border-light">
                    <td className={RL}>Cr/Fe</td>
                    {dests.map((d) => (
                      <Pair key={d.key} a={block[d.key]?.mines_cr_fe}
                        b={block[d.key]?.plant_cr_fe} />
                    ))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── metal made ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border-light bg-bg-base overflow-hidden">
        <div className="px-3 py-1.5 bg-navy flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <FlaskConical className="w-3.5 h-3.5 text-white/70" />
            <span className="font-condensed font-extrabold text-[11px] tracking-[.12em]
                             text-white">
              FERRO CHROME PRODUCED
            </span>
          </span>
          <span className="text-[9.5px] text-white/55">Cr/Fe derived · Fe by difference</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[380px]">
            <thead>
              <tr className="bg-navy/90">
                <th className={`${TH} text-left`} colSpan={2} />
                {plants.map((p) => (
                  <th key={p.key} className={`${TH} text-right border-l border-white/15`}>
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ["MTD", metal.mtd, null],
                [`FTD ${ddmm(metal.last_day_date)}`, metal.last_day,
                 metal.last_day_date],
              ] as const).map(([label, block], bi) => (
                <Fragment key={label}>
                  <tr className={bi ? "border-t-2 border-border" : ""}>
                    <td className={`${RL} font-semibold text-navy`} rowSpan={2}>
                      {label}
                      {bi === 1 && (
                        <span className="block text-[9.5px] text-txt-light font-normal">
                          last assayed day
                        </span>
                      )}
                    </td>
                    <td className={RL}>Cr%</td>
                    {plants.map((p) => (
                      <td key={p.key} className={`${TD} border-l border-border-light`}>
                        <N v={block[p.key]?.cr} />
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-border-light">
                    <td className={RL}>Cr/Fe</td>
                    {plants.map((p) => (
                      <td key={p.key} className={`${TD} border-l border-border-light`}>
                        <N v={block[p.key]?.cr_fe} />
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))}
              <tr className="bg-bg-section/60">
                <td className={`${RL} font-semibold text-navy`} colSpan={2}>
                  Yield (t) · MTD
                </td>
                {plants.map((p) => (
                  <td key={p.key} className={`${TD} border-l border-border-light`}>
                    <span className="font-mono font-bold text-navy">
                      {formatIndian(metal.mtd[p.key]?.yield_t ?? 0, 2)}
                    </span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** "Mines" and "Plant" over a destination's pair of columns. */
function ThPair() {
  return (
    <>
      <th className={`${TH} text-right border-l border-white/15`}>Mines</th>
      <th className={`${TH} text-right`}>Plant</th>
    </>
  );
}

/** The mine's figure and the plant's, side by side and both plain.
 *
 *  Neither is styled as the correct one. Which assay is right is the argument
 *  the meeting is there to have, and a screen that colours one of them red has
 *  already taken a side. */
function Pair({ a, b }: { a: number | null | undefined; b: number | null | undefined }) {
  return (
    <>
      <td className={`${TD} border-l border-border-light`}><N v={a} /></td>
      <td className={TD}><N v={b} /></td>
    </>
  );
}
