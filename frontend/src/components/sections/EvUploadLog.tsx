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
import { ChevronDown, ChevronRight, FileSpreadsheet, Loader2 } from "lucide-react";
import api from "@/lib/api";

interface Batch {
  batch_id: number;
  source_file: string;
  serial_no: string;
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

export default function EvUploadLog() {
  const [batches, setBatches] = useState<Batch[] | null>(null);
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
      <div className="rounded-lg border border-border bg-white px-5 py-8 text-center">
        <FileSpreadsheet className="mx-auto mb-2 h-5 w-5 text-txt-light" />
        <p className="text-[12.5px] font-semibold text-navy">No uploads recorded yet</p>
        <p className="mx-auto mt-1 max-w-xl text-[11px] leading-relaxed text-txt-light">
          Telemetry loaded before this log existed is still in the fleet figures —
          it simply was not recorded here, and the values those loads replaced are
          gone. Everything uploaded from now on appears here with what it changed.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border-light px-4 py-2.5">
        <h3 className="font-condensed text-[13px] font-bold uppercase tracking-widest text-navy">
          Upload log
        </h3>
        <span className="text-[10px] text-txt-light">
          {batches.length} upload{batches.length === 1 ? "" : "s"} · newest first
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px] tabular-nums">
          <thead className="bg-bg-section">
            <tr>
              <th className={`${TH} w-6`} aria-hidden />
              <th className={`${TH} text-left`}>When</th>
              <th className={`${TH} text-left`}>Machine</th>
              <th className={`${TH} text-left w-full`}>File</th>
              <th className={`${TH} text-left whitespace-nowrap`}>Covering</th>
              <th className={`${TH} text-right whitespace-nowrap`}>New</th>
              <th className={`${TH} text-right whitespace-nowrap`}>Changed</th>
              <th className={`${TH} text-right whitespace-nowrap`}>Unchanged</th>
              <th className={`${TH} text-left whitespace-nowrap`}>By</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <>
                <tr key={b.batch_id} className="cursor-pointer hover:bg-bg-light"
                    onClick={() => void toggle(b.batch_id)}>
                  <td className={`${TD} text-center text-txt-light`}>
                    {open === b.batch_id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{stamp(b.uploaded_at)}</td>
                  <td className={`${TD} whitespace-nowrap font-semibold text-navy`}>{b.serial_no}</td>
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
                    <td className={TD} colSpan={8}>
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
  );
}
