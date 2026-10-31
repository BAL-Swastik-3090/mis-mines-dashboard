"use client";
/**
 * Every machine's work over the period, as ONE TABLE with sections.
 *
 * This was four stacked blocks, each with its own heading and its own pair of
 * bars — four objects on screen that were really four rows of one thing. The
 * repetition hid the comparison it existed to make: to read the grader against
 * the excavator you had to carry a number down the page past two other blocks.
 *
 * As a table the figures line up in columns and the eye does the comparing for
 * free, and the sections (excavators, grader, loader) say the thing the four
 * separate blocks could not: comparing a loader's hours with an excavator's is
 * not a fair comparison, so the machines that ARE comparable sit together and
 * subtotal together.
 *
 * The bar survives as one column rather than two rows, because a bar is still
 * the fastest way to see a ratio — it just doesn't need a block to itself.
 *
 * Built from the overview the page already holds — no extra request per
 * machine — so it costs nothing and moves with the date picker like everything
 * else on the screen.
 */
import type { EvVehicleData } from "@/types";
import { periodLabel } from "@/lib/periodLabel";

const n1 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const n0 = (v: number) => Math.round(v).toLocaleString("en-IN");

const TH = "border border-border-light px-2.5 py-1.5 text-[10px] font-condensed font-bold uppercase tracking-widest text-txt-secondary";
const TD = "border border-border-light px-2.5 py-1.5";
/** Zero in a period column is a real reading of nothing; dimming it keeps the
 *  eye on the machines that actually moved. */
const dim = (v: number) => (v ? "text-navy" : "text-txt-light/50");

/** Excavator, Excavators — the section heading is read, not parsed. */
const plural = (type: string, n: number) =>
  n === 1 ? type : /s$/i.test(type) ? type : `${type}s`;

export default function EvWorkAnalysisAll(
  { vehicles, from, to, onDrillDown }:
  { vehicles: EvVehicleData[]; from?: string | null; to?: string | null;
    onDrillDown?: (id: number) => void },
) {
  if (!vehicles.length) return null;

  /* Bars are drawn against the busiest machine in the period, not against a
     fixed ceiling: a fleet that worked 2 hours all month should still show a
     readable comparison, and one that worked 300 should not clip. */
  const maxWork = Math.max(...vehicles.map((v) => v.work_hours), 0);
  const maxEnergy = Math.max(...vehicles.map((v) => v.total_energy_kwh), 0);
  const anyWork = maxWork > 0 || maxEnergy > 0;

  /* Grouped in the order the machines first appear, so the sections follow the
     page's own ordering instead of an alphabet nobody asked for. */
  const groups: { type: string; rows: EvVehicleData[] }[] = [];
  for (const v of vehicles) {
    const type = v.equipment_type || "Other";
    const g = groups.find((x) => x.type === type);
    if (g) g.rows.push(v); else groups.push({ type, rows: [v] });
  }

  const sum = (rows: EvVehicleData[], pick: (v: EvVehicleData) => number) =>
    rows.reduce((n, v) => n + (pick(v) || 0), 0);
  const rate = (h: number, kwh: number) => (h > 0 ? kwh / h : null);

  const fleetWork = sum(vehicles, (v) => v.work_hours);
  const fleetIdle = sum(vehicles, (v) => v.idling_hours);
  const fleetKwh = sum(vehicles, (v) => v.total_energy_kwh);

  /** The comparison cell: engine-on against the busiest machine, with the
   *  idling share drawn INSIDE it — the two are parts of one engine-on period,
   *  and side by side they read as independent totals that happen to touch. */
  const bars = (work: number, idle: number, kwh: number) => {
    const workPct = maxWork ? (work / maxWork) * 100 : 0;
    const idlePct = work ? Math.min((idle / work) * 100, 100) : 0;
    const energyPct = maxEnergy ? (kwh / maxEnergy) * 100 : 0;
    return (
      <div className="min-w-[120px] space-y-1">
        <span className="relative block h-2.5 rounded-sm bg-bg-section">
          <span className="absolute inset-y-0 left-0 rounded-sm bg-navy" style={{ width: `${workPct}%` }} />
          {idlePct > 0 ? (
            <span className="absolute inset-y-0 left-0 rounded-sm bg-gold/80"
                  style={{ width: `${(workPct * idlePct) / 100}%` }}
                  title={`${n1(idle)} h idling within ${n1(work)} h engine-on`} />
          ) : null}
        </span>
        <span className="relative block h-2.5 rounded-sm bg-bg-section">
          <span className="absolute inset-y-0 left-0 rounded-sm bg-teal-600" style={{ width: `${energyPct}%` }} />
        </span>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-4 py-2.5">
        <h3 className="font-condensed text-[13px] font-bold uppercase tracking-widest text-navy">
          Work analysis — all machines
        </h3>
        <span className="text-[10.5px] text-txt-light">
          Work hours and energy · {periodLabel(from, to)}
        </span>
      </div>

      {!anyWork ? (
        <p className="px-4 py-6 text-center text-[12px] text-txt-light">
          No machine recorded work in this period. That may be a quiet month, or
          it may be that nobody has uploaded it — the Upload Log tab separates
          the two.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px] tabular-nums">
            <thead className="bg-bg-section">
              <tr>
                <th className={`${TH} text-left`}>Machine</th>
                <th className={`${TH} text-right border-l-2 border-border`}>Engine on h</th>
                <th className={`${TH} text-right`}>Idling h</th>
                <th className={`${TH} text-right`}>Idle %</th>
                <th className={`${TH} text-right border-l-2 border-border`}>kWh</th>
                <th className={`${TH} text-right`}>kWh/h</th>
                <th className={`${TH} text-left border-l-2 border-border`}>Against busiest</th>
              </tr>
            </thead>

            {groups.map((g) => {
              const gw = sum(g.rows, (v) => v.work_hours);
              const gi = sum(g.rows, (v) => v.idling_hours);
              const gk = sum(g.rows, (v) => v.total_energy_kwh);
              const gr = rate(gw, gk);
              return (
                <tbody key={g.type}>
                  {/* The section heading, inside the table rather than above a
                      separate one — so the columns stay a single grid. */}
                  <tr className="bg-bg-light/70">
                    <td colSpan={7}
                        className="border border-border-light px-2.5 py-1 font-condensed text-[10px]
                                   font-bold uppercase tracking-widest text-txt-secondary">
                      {plural(g.type, g.rows.length)}
                      <span className="ml-1.5 font-normal normal-case tracking-normal text-txt-light">
                        {g.rows.length} machine{g.rows.length === 1 ? "" : "s"}
                      </span>
                    </td>
                  </tr>

                  {g.rows.map((v) => {
                    const idlePct = v.work_hours ? (v.idling_hours / v.work_hours) * 100 : 0;
                    return (
                      <tr key={v.ev_equipment_id}
                          onClick={onDrillDown ? () => onDrillDown(v.ev_equipment_id) : undefined}
                          className={`hover:bg-bg-light ${onDrillDown ? "cursor-pointer" : ""}`}>
                        <td className={`${TD} whitespace-nowrap`}>
                          <span className="font-semibold text-navy">{v.display_name || v.serial_no}</span>
                          <span className="ml-1.5 font-mono text-[9.5px] text-txt-light">{v.serial_no}</span>
                          {v.model ? (
                            <span className="ml-1.5 text-[10px] text-txt-light">{v.model}</span>
                          ) : null}
                        </td>
                        <td className={`${TD} text-right border-l-2 border-border ${dim(v.work_hours)}`}>{n1(v.work_hours)}</td>
                        <td className={`${TD} text-right ${dim(v.idling_hours)}`}>{n1(v.idling_hours)}</td>
                        <td className={`${TD} text-right text-txt-light`}>
                          {v.work_hours ? `${n0(idlePct)}%` : "—"}
                        </td>
                        <td className={`${TD} text-right border-l-2 border-border ${dim(v.total_energy_kwh)}`}>{n0(v.total_energy_kwh)}</td>
                        <td className={`${TD} text-right text-txt-light`}>
                          {v.work_hours > 0 ? n1(v.avg_energy_kwh_per_h) : "—"}
                        </td>
                        <td className={`${TD} border-l-2 border-border`}>
                          {bars(v.work_hours, v.idling_hours, v.total_energy_kwh)}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Subtotalled only where it means something: two excavators
                      add up, a loader plus a grader does not. */}
                  {g.rows.length > 1 ? (
                    <tr className="bg-bg-section/60">
                      <td className={`${TD} text-right text-[10.5px] font-semibold text-txt-secondary`}>
                        {plural(g.type, 2)} total
                      </td>
                      <td className={`${TD} text-right border-l-2 border-border font-semibold`}>{n1(gw)}</td>
                      <td className={`${TD} text-right font-semibold`}>{n1(gi)}</td>
                      <td className={`${TD} text-right text-txt-light`}>{gw ? `${n0((gi / gw) * 100)}%` : "—"}</td>
                      <td className={`${TD} text-right border-l-2 border-border font-semibold`}>{n0(gk)}</td>
                      <td className={`${TD} text-right text-txt-light`}>{gr === null ? "—" : n1(gr)}</td>
                      <td className={`${TD} border-l-2 border-border`} />
                    </tr>
                  ) : null}
                </tbody>
              );
            })}

            <tfoot>
              <tr className="bg-bg-section">
                <td className={`${TD} font-condensed font-extrabold uppercase tracking-widest text-navy`}>Fleet</td>
                <td className={`${TD} text-right border-l-2 border-border font-bold text-navy`}>{n1(fleetWork)}</td>
                <td className={`${TD} text-right font-bold text-navy`}>{n1(fleetIdle)}</td>
                <td className={`${TD} text-right text-txt-light`}>
                  {fleetWork ? `${n0((fleetIdle / fleetWork) * 100)}%` : "—"}
                </td>
                <td className={`${TD} text-right border-l-2 border-border font-bold text-navy`}>{n0(fleetKwh)}</td>
                <td className={`${TD} text-right text-txt-light`}>
                  {fleetWork ? n1(fleetKwh / fleetWork) : "—"}
                </td>
                <td className={`${TD} border-l-2 border-border`} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-light px-4 py-2 text-[10px] text-txt-light">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-navy" /> engine on
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-gold/80" /> of which idling
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-teal-600" /> energy
        </span>
        <span className="ml-auto">
          Bars compare against the busiest machine in this period; kWh/h is energy
          over <strong>engine-on</strong> hours.
        </span>
      </p>
    </div>
  );
}
