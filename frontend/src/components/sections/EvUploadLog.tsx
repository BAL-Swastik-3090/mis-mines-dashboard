"use client";
/**
 * What has been uploaded, and what each upload changed.
 *
 * WHY THIS IS NOT THE OTHER HISTORY. /ev/uploads groups the tracking table by
 * source_file, which describes the CURRENT state wearing a history's clothes:
 * a row carries only the file that touched it last, so re-loading a month from
 * a second export quietly re-attributes those days and the first file shrinks
 * or vanishes. It also cannot say what changed, because the old values were
 * overwritten by the very write it is describing.
 *
 * This reads /ev/uploads/log, which is written by the upload itself, in the
 * same transaction, from the comparison taken BEFORE the rows moved. Nothing
 * can rewrite it.
 *
 * THE LOG STARTS AT MIGRATION 086. The 1,168 rows loaded before it exists were
 * not recorded, and the values they overwrote are genuinely gone — so the
 * empty state says that plainly rather than implying nothing was ever loaded.
 */
import { useEffect, useState } from "react";
import { useEvCoverage } from "@/hooks/useEvTracking";
import { ChevronDown, ChevronRight, FileSpreadsheet, Loader2 } from "lucide-react";
import api from "@/lib/api";

interface Batch {
  batch_id: number;
  source_file: string;
  serial_no: string;
  display_name: string | null;
  equipment_type: string;
  uploaded_by: string | null;
  uploaded_at: string;
  rows_received: number;
  rows_new: number;
  rows_changed: number;
  rows_identical: number;
  date_from: string;
  date_to: string;
}

interface Change {
  report_date: string;
  change_type: "NEW" | "CHANGED";
  fields: Record<string, { from: number | null; to: number | null }> | null;
}

const FIELD_LABEL: Record<string, string> = {
  operating_hours: "Operating hrs", idling_hours: "Idling hrs",
  work_hours: "Work hrs", operating_energy_kwh: "Operating kWh",
  idling_energy_kwh: "Idling kWh", total_energy_kwh: "Total kWh",
  avg_operating_kwh_per_h: "Avg operating kWh/h",
  avg_idling_kwh_per_h: "Avg idling kWh/h",
  avg_energy_kwh_per_h: "Avg kWh/h",
  avg_energy_recycle_kwh_per_h: "Avg recycle kWh/h",
};
const day = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
    { day: "2-digit", month: "short", year: "numeric" });
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN",
    { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const num = (v: number | null) => (v === null || v === undefined ? "—" : String(v));

const TH = "border border-border-light px-2.5 py-1.5 text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary";
const TD = "border border-border-light px-2.5 py-1.5";

interface CoverageVehicle {
  serial_no: string;
  display_name: string | null;
  fleet_code: string | null;
  equipment_type: string;
  model: string | null;
  first_day: string | null;
  last_day: string | null;
  days_held: number;
  days_missing: number;
  missing_months: string[];
  idle_days: number;
  idle_pct: number | null;
  suspect_days: number;
  energy_kwh: number;
  work_hours: number;
}
interface Coverage {
  vehicles: CoverageVehicle[];
  never_filled_columns: string[];
  never_filled_note: string;
}

const monthName = (ym: string) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};
const n0 = (v: number) => Math.round(v).toLocaleString("en-IN");

/** What the record covers, and — the part no list of uploads can show — what
 *  it does not. A month nobody downloaded from the portal is invisible on a
 *  page built from the rows that exist, and reads as a month the machine did
 *  nothing. */
function CoveragePanel() {
  /* Cached: coverage describes months nobody has uploaded, which does not
     change between two visits to this tab. A failure leaves cov undefined and
     the log below still stands on its own. */
  const { data: cov } = useEvCoverage() as { data: Coverage | undefined };

  if (!cov) return null;
  const totalMissing = cov.vehicles.reduce((n, v) => n + v.days_missing, 0);

  return (
    <div className="mb-3 rounded-lg border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-4 py-2.5">
        <h3 className="font-condensed text-[13px] font-bold uppercase tracking-widest text-navy">
          What the record covers
        </h3>
        {totalMissing > 0 ? (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-800 ring-1 ring-amber-200">
            {n0(totalMissing)} day{totalMissing === 1 ? "" : "s"} never uploaded
          </span>
        ) : (
          <span className="text-[10.5px] text-txt-light">no gaps</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px] tabular-nums">
          <thead className="bg-bg-section">
            <tr>
              <th className={`${TH} text-left`}>Machine</th>
              <th className={`${TH} text-left whitespace-nowrap`}>Covering</th>
              <th className={`${TH} text-right whitespace-nowrap`}>Days held</th>
              <th className={`${TH} text-right whitespace-nowrap`}>Never uploaded</th>
              <th className={`${TH} text-right whitespace-nowrap`}>Idle days</th>
              <th className={`${TH} text-right whitespace-nowrap`}>Energy kWh</th>
              <th className={`${TH} text-left w-full`}>Months to fetch</th>
            </tr>
          </thead>
          <tbody>
            {cov.vehicles.map((v) => (
              <tr key={v.serial_no} className="hover:bg-bg-light">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="font-semibold text-navy">{v.display_name ?? v.serial_no}</span>
                  {v.display_name ? (
                    <span className="ml-1.5 font-mono text-[9.5px] text-txt-light">{v.serial_no}</span>
                  ) : null}
                  <span className="ml-1.5 text-txt-light">{v.equipment_type}</span>
                </td>
                <td className={`${TD} whitespace-nowrap text-txt-light`}>
                  {v.first_day ? `${day(v.first_day)} – ${day(v.last_day!)}` : "—"}
                </td>
                <td className={`${TD} text-right`}>{n0(v.days_held)}</td>
                <td className={`${TD} text-right ${v.days_missing ? "font-semibold text-amber-800" : "text-txt-light"}`}>
                  {v.days_missing || "—"}
                </td>
                {/* An idle day is a measurement — the machine was there and did
                    nothing. Shown next to the gaps precisely so the two are not
                    read as the same thing. */}
                <td className={`${TD} text-right text-txt-light`}>
                  {n0(v.idle_days)}{v.idle_pct !== null ? ` · ${v.idle_pct}%` : ""}
                </td>
                <td className={`${TD} text-right`}>{n0(v.energy_kwh)}</td>
                <td className={TD}>
                  {v.missing_months.length ? (
                    <span className="flex flex-wrap gap-1">
                      {v.missing_months.map((m) => (
                        <span key={m} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-800 ring-1 ring-amber-200">
                          {monthName(m)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-txt-light">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cov.never_filled_columns.length ? (
        <p className="border-t border-border-light px-4 py-2 text-[10.5px] leading-relaxed text-txt-light">
          <strong className="text-txt-secondary">The energy split is not available.</strong>{" "}
          {cov.never_filled_note} Anything built on operating-versus-idling energy
          would read zero and look like a machine that never works.
        </p>
      ) : null}
    </div>
  );
}

type SortKey = "uploaded_at" | "display_name" | "rows_new" | "rows_changed" | "date_from";

export default function EvUploadLog() {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  /* Eighteen uploads of the same two machines is already hard to read, and
     this list only grows. A machine filter and a sort are the two things
     somebody actually does with it: "what did we load for the loader" and
     "what changed most recently". */
  const [machine, setMachine] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("uploaded_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [changes, setChanges] = useState<Record<number, Change[]>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<Batch[]>("/ev/uploads/log", { params: { limit: 100 } });
        setBatches(res.data);
      } catch {
        setError("Could not read the upload log.");
      }
    })();
  }, []);

  /** Fetched when a row is opened, not with the list: most rows are never
   *  opened, and a month of corrections is a lot of rows to carry for nothing. */
  const toggle = async (id: number) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (changes[id]) return;
    try {
      const res = await api.get<Change[]>(`/ev/uploads/log/${id}/changes`);
      setChanges((c) => ({ ...c, [id]: res.data }));
    } catch {
      setChanges((c) => ({ ...c, [id]: [] }));
    }
  };

  const nameOf = (b: Batch) => b.display_name ?? b.serial_no;
  const machines = Array.from(
    new Map((batches ?? []).map((b) => [b.serial_no, nameOf(b)])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const shown = (batches ?? [])
    .filter((b) => machine === "ALL" || b.serial_no === machine)
    .slice()
    .sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      if (sortKey === "display_name") return nameOf(a).localeCompare(nameOf(b)) * dir;
      if (sortKey === "rows_new") return (a.rows_new - b.rows_new) * dir;
      if (sortKey === "rows_changed") return (a.rows_changed - b.rows_changed) * dir;
      if (sortKey === "date_from") return a.date_from.localeCompare(b.date_from) * dir;
      return a.uploaded_at.localeCompare(b.uploaded_at) * dir;
    });

  /* Clicking the column you are already sorted by reverses it, which is what
     every table in the world does and what the reader will try first. */
  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(k === "display_name"); }
  };
  const Arrow = ({ k }: { k: SortKey }) =>
    k === sortKey ? <span className="ml-0.5 text-gold">{sortAsc ? "\u25B2" : "\u25BC"}</span> : null;

  if (error) return <div className="py-10 text-center text-[12px] text-danger">{error}</div>;
  if (!batches) {
    return (
      <div className="py-10 text-center">
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-gold" />
      </div>
    );
  }
  if (!batches.length) {
    return (
      <>
        <CoveragePanel />
      <div className="rounded-lg border border-border bg-white px-5 py-8 text-center">
        <FileSpreadsheet className="mx-auto mb-2 h-5 w-5 text-txt-light" />
        <p className="text-[12.5px] font-semibold text-navy">No uploads recorded yet</p>
        <p className="mx-auto mt-1 max-w-xl text-[11px] leading-relaxed text-txt-light">
          Telemetry loaded before this log existed is still in the fleet figures —
          it simply was not recorded here, and the values those loads replaced are
          gone. Everything uploaded from now on appears here with what it changed.
        </p>
      </div>
      </>
    );
  }

  return (
    <>
    <CoveragePanel />
    <div className="rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border-light px-4 py-2.5">
        <h3 className="font-condensed text-[13px] font-bold uppercase tracking-widest text-navy">
          Upload log
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            className="rounded border border-border bg-white px-2 py-1 text-[11px] text-txt-secondary"
          >
            <option value="ALL">All machines</option>
            {machines.map(([serial, name]) => (
              <option key={serial} value={serial}>{name}</option>
            ))}
          </select>
          <span className="text-[10.5px] text-txt-light">
            {shown.length} of {batches.length} upload{batches.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px] tabular-nums">
          <thead className="bg-bg-section">
            <tr>
              <th className={`${TH} w-6`} aria-hidden />
              <th className={`${TH} text-left cursor-pointer select-none whitespace-nowrap`}
                  onClick={() => sortBy("uploaded_at")}>When<Arrow k="uploaded_at" /></th>
              <th className={`${TH} text-left cursor-pointer select-none whitespace-nowrap`}
                  onClick={() => sortBy("display_name")}>Machine<Arrow k="display_name" /></th>
              <th className={`${TH} text-left whitespace-nowrap`}>Serial</th>
              <th className={`${TH} text-left w-full`}>File</th>
              <th className={`${TH} text-left cursor-pointer select-none whitespace-nowrap`}
                  onClick={() => sortBy("date_from")}>Covering<Arrow k="date_from" /></th>
              <th className={`${TH} text-right cursor-pointer select-none whitespace-nowrap`}
                  onClick={() => sortBy("rows_new")}>New<Arrow k="rows_new" /></th>
              <th className={`${TH} text-right cursor-pointer select-none whitespace-nowrap`}
                  onClick={() => sortBy("rows_changed")}>Changed<Arrow k="rows_changed" /></th>
              <th className={`${TH} text-right whitespace-nowrap`}>Unchanged</th>
              <th className={`${TH} text-left whitespace-nowrap`}>By</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <>
                <tr key={b.batch_id} className="cursor-pointer hover:bg-bg-light"
                    onClick={() => void toggle(b.batch_id)}>
                  <td className={`${TD} text-center text-txt-light`}>
                    {open === b.batch_id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{stamp(b.uploaded_at)}</td>
                  <td className={`${TD} whitespace-nowrap font-semibold text-navy`}>
                    {b.display_name ?? b.serial_no}
                  </td>
                  <td className={`${TD} whitespace-nowrap font-mono text-[10px] text-txt-light`}>
                    {b.serial_no}
                  </td>
                  <td className={`${TD} text-txt-light`}>{b.source_file}</td>
                  <td className={`${TD} whitespace-nowrap text-txt-light`}>
                    {day(b.date_from)} – {day(b.date_to)}
                  </td>
                  <td className={`${TD} text-right font-semibold text-green-700`}>{b.rows_new || "—"}</td>
                  <td className={`${TD} text-right font-semibold text-amber-800`}>{b.rows_changed || "—"}</td>
                  <td className={`${TD} text-right text-txt-light`}>{b.rows_identical || "—"}</td>
                  <td className={`${TD} whitespace-nowrap text-txt-light`}>{b.uploaded_by ?? "—"}</td>
                </tr>
                {open === b.batch_id ? (
                  <tr key={`${b.batch_id}-d`}>
                    <td className={TD} />
                    <td className={TD} colSpan={9}>
                      {!changes[b.batch_id] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />
                      ) : !changes[b.batch_id].length ? (
                        <span className="text-[11px] text-txt-light">
                          Nothing recorded for this upload.
                        </span>
                      ) : (
                        <div className="max-h-72 overflow-y-auto">
                          <table className="w-full border-collapse text-[10.5px] tabular-nums">
                            <thead className="bg-bg-section">
                              <tr>
                                <th className={`${TH} text-left`}>Date</th>
                                <th className={`${TH} text-left`}>What happened</th>
                                <th className={`${TH} text-left w-full`}>Figure</th>
                                <th className={`${TH} text-right`}>Was</th>
                                <th className={`${TH} text-right`}>Became</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes[b.batch_id].map((c) =>
                                c.change_type === "NEW" || !c.fields ? (
                                  <tr key={c.report_date}>
                                    <td className={`${TD} whitespace-nowrap font-semibold text-navy`}>
                                      {day(c.report_date)}
                                    </td>
                                    <td className={`${TD} text-green-700`} colSpan={4}>
                                      added — this day had no reading before
                                    </td>
                                  </tr>
                                ) : (
                                  Object.entries(c.fields).map(([f, v], i) => (
                                    <tr key={`${c.report_date}-${f}`}>
                                      {i === 0 ? (
                                        <td className={`${TD} whitespace-nowrap align-top font-semibold text-navy`}
                                            rowSpan={Object.keys(c.fields!).length}>
                                          {day(c.report_date)}
                                        </td>
                                      ) : null}
                                      {i === 0 ? (
                                        <td className={`${TD} align-top text-amber-800`}
                                            rowSpan={Object.keys(c.fields!).length}>
                                          corrected
                                        </td>
                                      ) : null}
                                      <td className={TD}>{FIELD_LABEL[f] ?? f}</td>
                                      <td className={`${TD} text-right text-txt-light`}>{num(v.from)}</td>
                                      <td className={`${TD} text-right font-semibold text-navy`}>{num(v.to)}</td>
                                    </tr>
                                  ))
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}
