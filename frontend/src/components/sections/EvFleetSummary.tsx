"use client";
/**
 * The whole fleet on one table: the day, the month, and the machine's life.
 *
 * WHY LIFETIME SITS BESIDE THE PERIOD. Three of these four machines last
 * reported in July, so their October columns are empty and will stay empty.
 * A page showing only the period would read as a dead fleet; a page showing
 * only lifetime would hide that nothing has arrived since. Both, side by side,
 * say the true thing: these machines have done real work, and nobody has
 * uploaded it lately.
 *
 * ONE REPORT DAY FOR EVERY MACHINE. Reading the grader's last day against the
 * loader's would compare July with October and call it a fleet.
 */
import { BarChart3, Loader2 } from "lucide-react";
import { useEvAnalytics } from "@/hooks/useEvTracking";
import { periodLabel, periodDays } from "@/lib/periodLabel";

interface Row {
  serial_no: string; display_name: string | null; fleet_code: string | null;
  equipment_type: string; model: string | null;
  td_hours: number; td_energy: number; td_rate: number | null;
  mtd_hours: number; mtd_energy: number; mtd_rate: number | null;
  mtd_days: number; mtd_active_days: number; mtd_idle_days: number;
  life_hours: number; life_energy: number; life_rate: number | null;
  life_days: number; life_active_days: number; suspect_days: number;
  first_day: string | null; last_day: string | null;
  days_behind: number | null; reported_on_day: boolean;
}
interface Fleet {
  machines: number; reporting_on_day: number;
  td_hours: number; td_energy: number; td_rate: number | null;
  mtd_hours: number; mtd_energy: number; mtd_rate: number | null;
  life_hours: number; life_energy: number; life_rate: number | null;
}
interface Analytics {
  as_of: string | null; mtd_from: string | null;
  machines: Row[]; fleet: Fleet;
}

const day = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
    { day: "2-digit", month: "short", year: "numeric" }) : "—";
const n1 = (v: number | null) =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const n0 = (v: number | null) =>
  v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-IN");

const TH = "border border-border-light px-2.5 py-1.5 text-[10px] font-condensed font-bold uppercase tracking-widest text-txt-secondary";
const TD = "border border-border-light px-2.5 py-1.5";
/** A figure of zero in a period column is not the same claim as a machine
 *  that never reported; dimming the former keeps the eye on the latter. */
const dim = (v: number) => (v ? "text-navy" : "text-txt-light/50");

export default function EvFleetSummary(
  { from, to, onWorkAnalysis }:
  { from: string | null; to: string | null; onWorkAnalysis?: () => void },
) {
  /* On the shared query cache, so coming back to this tab does not pay for
     the whole table again — see the note in useEvTracking. */
  const { data: a, isError: err } = useEvAnalytics(from, to) as
    { data: Analytics | undefined; isError: boolean };

  if (err) return null;
  if (!a) {
    return (
      <div className="rounded-lg border border-border bg-white py-8 text-center">
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-gold" />
      </div>
    );
  }

  const f = a.fleet;
  const days = periodDays(a.mtd_from, a.as_of);
  return (
    <div className="rounded-lg border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-4 py-2.5">
        <h3 className="font-condensed text-[13px] font-bold uppercase tracking-widest text-navy">
          Fleet at a glance
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10.5px] text-txt-light">
            Day {day(a.as_of)} · {f.reporting_on_day} of {f.machines} reported on the day
          </span>
          {/* The shortcut out of this table. Somebody who has just read the
              totals wants the per-machine detail next, and the tab bar is a
              long scroll back up once the table has pushed it off screen. */}
          {onWorkAnalysis ? (
            <button type="button" onClick={onWorkAnalysis}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1
                               font-condensed text-[10.5px] font-bold uppercase tracking-widest
                               text-txt-secondary shadow-sm transition hover:border-gold hover:text-navy">
              <BarChart3 size={12} />
              Work analysis
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px] tabular-nums">
          <thead className="bg-bg-section">
            <tr>
              <th className={`${TH} text-left`} rowSpan={2}>Machine</th>
              <th className={`${TH} text-center border-l-2 border-border`} colSpan={3}>
                Last day · {day(a.as_of)}
              </th>
              {/* The dates, not the words "selected period": a column group
                  headed by a control's name tells the reader nothing they can
                  check, and survives neither a screenshot nor a printout. */}
              <th className={`${TH} text-center border-l-2 border-border whitespace-nowrap`} colSpan={4}>
                {days ? "Period · " : ""}{periodLabel(a.mtd_from, a.as_of)}
                {days ? <span className="ml-1 font-normal normal-case tracking-normal text-txt-light">({days} d)</span> : null}
              </th>
              {/* The only columns that mean anything for a machine that stopped
                  reporting in July, which is three of the four. */}
              <th className={`${TH} text-center border-l-2 border-border`} colSpan={4}>Since first reading</th>
            </tr>
            <tr>
              <th className={`${TH} text-right border-l-2 border-border`}>Work h</th>
              <th className={`${TH} text-right`}>kWh</th>
              <th className={`${TH} text-right`}>kWh/h</th>
              <th className={`${TH} text-right border-l-2 border-border`}>Work h</th>
              <th className={`${TH} text-right`}>kWh</th>
              <th className={`${TH} text-right`}>kWh/h</th>
              <th className={`${TH} text-right`}>Idle d</th>
              <th className={`${TH} text-right border-l-2 border-border`}>Work h</th>
              <th className={`${TH} text-right`}>kWh</th>
              <th className={`${TH} text-right`}>kWh/h</th>
              <th className={`${TH} text-left whitespace-nowrap`}>Last reading</th>
            </tr>
          </thead>
          <tbody>
            {a.machines.map((m) => (
              <tr key={m.serial_no} className="hover:bg-bg-light">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="font-semibold text-navy">{m.display_name ?? m.serial_no}</span>
                  <span className="ml-1.5 text-[10px] text-txt-light">
                    {m.equipment_type}{m.model ? ` · ${m.model}` : ""}
                  </span>
                </td>
                <td className={`${TD} text-right border-l-2 border-border ${dim(m.td_hours)}`}>{n1(m.td_hours)}</td>
                <td className={`${TD} text-right ${dim(m.td_energy)}`}>{n0(m.td_energy)}</td>
                <td className={`${TD} text-right text-txt-light`}>{n1(m.td_rate)}</td>
                <td className={`${TD} text-right border-l-2 border-border ${dim(m.mtd_hours)}`}>{n1(m.mtd_hours)}</td>
                <td className={`${TD} text-right ${dim(m.mtd_energy)}`}>{n0(m.mtd_energy)}</td>
                <td className={`${TD} text-right text-txt-light`}>{n1(m.mtd_rate)}</td>
                <td className={`${TD} text-right text-txt-light`}>{m.mtd_idle_days || "—"}</td>
                <td className={`${TD} text-right border-l-2 border-border font-semibold text-navy`}>{n1(m.life_hours)}</td>
                <td className={`${TD} text-right font-semibold text-navy`}>{n0(m.life_energy)}</td>
                <td className={`${TD} text-right text-txt-light`}>{n1(m.life_rate)}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  <span className={m.reported_on_day ? "text-txt-light" : "text-rose-700"}>
                    {day(m.last_day)}
                  </span>
                  {!m.reported_on_day && m.days_behind ? (
                    <span className="ml-1.5 rounded bg-rose-50 px-1 py-0.5 text-[10px] text-rose-800 ring-1 ring-rose-200">
                      {m.days_behind}d behind
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-bg-section">
              <td className={`${TD} font-condensed font-extrabold uppercase tracking-widest text-navy`}>Fleet</td>
              <td className={`${TD} text-right border-l-2 border-border font-semibold`}>{n1(f.td_hours)}</td>
              <td className={`${TD} text-right font-semibold`}>{n0(f.td_energy)}</td>
              <td className={`${TD} text-right text-txt-light`}>{n1(f.td_rate)}</td>
              <td className={`${TD} text-right border-l-2 border-border font-semibold`}>{n1(f.mtd_hours)}</td>
              <td className={`${TD} text-right font-semibold`}>{n0(f.mtd_energy)}</td>
              <td className={`${TD} text-right text-txt-light`}>{n1(f.mtd_rate)}</td>
              <td className={TD} />
              <td className={`${TD} text-right border-l-2 border-border font-bold text-navy`}>{n1(f.life_hours)}</td>
              <td className={`${TD} text-right font-bold text-navy`}>{n0(f.life_energy)}</td>
              <td className={`${TD} text-right text-txt-light`}>{n1(f.life_rate)}</td>
              <td className={TD} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="border-t border-border-light px-4 py-2 text-[10.5px] leading-relaxed text-txt-light">
        kWh/h is energy over <strong>working</strong> hours, not calendar hours — a
        rate across a month of standing still is a division by nothing. Readings
        flagged as impossible are excluded from every figure here.
      </p>
    </div>
  );
}
