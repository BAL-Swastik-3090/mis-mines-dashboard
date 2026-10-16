"use client";
/**
 * Upload LiuGong "Man-hour fuel consumption" exports into minehub.
 *
 * The machine is read from the file name, so nothing has to be chosen. Check
 * before saving first — it parses and reports without writing, which is the
 * only way to see that a file is all zeros before it is in the table.
 */
import React, { useRef, useState } from "react";
import { Upload, X, CheckCircle2, AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import api from "@/lib/api";

interface FileReport {
  file: string;
  serial_no: string;
  rows_parsed: number;
  date_from: string;
  date_to: string;
  columns_matched: string[];
  columns_ignored: string[];
  has_energy_recycle_column: boolean;
  suspect_dates: string[];
  all_zero: boolean;
  written: boolean;
  equipment_type?: string;
  rows_inserted?: number;
  rows_updated?: number;
  /* What the file would do to the table, computed against the stored rows
     before anything is written. Present on the dry run and the real upload
     alike — on the real one it is taken BEFORE the write, because afterwards
     the old values are gone and the question cannot be answered. */
  rows_new?: number;
  rows_changed?: number;
  rows_identical?: number;
  /* How much of each group is a day the machine did nothing. "2 new" says
     nothing about whether it worked those days, and a month of zeros looks
     exactly like a month of work until somebody opens the file. */
  rows_new_idle?: number;
  rows_identical_idle?: number;
  display_name?: string | null;
  new_from?: string | null;
  new_to?: string | null;
  changed?: {
    report_date: string;
    fields: Record<string, { from: number | null; to: number | null }>;
    previous_source_file?: string | null;
  }[];
}

/** "total_energy_kwh" reads as a column name; the dialog is read by the person
 *  holding the spreadsheet, who calls it Total Energy. */
const FIELD_LABEL: Record<string, string> = {
  operating_hours: "Operating hrs", idling_hours: "Idling hrs",
  work_hours: "Work hrs", operating_energy_kwh: "Operating kWh",
  idling_energy_kwh: "Idling kWh", total_energy_kwh: "Total kWh",
  avg_operating_kwh_per_h: "Avg operating kWh/h",
  avg_idling_kwh_per_h: "Avg idling kWh/h",
  avg_energy_kwh_per_h: "Avg kWh/h",
  avg_energy_recycle_kwh_per_h: "Avg recycle kWh/h",
};
const num = (v: number | null) => (v === null || v === undefined ? "—" : String(v));
const day = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
    { day: "2-digit", month: "short", year: "numeric" });

interface UploadResponse {
  files_accepted: number;
  files_rejected: number;
  rows_written: number;
  results: FileReport[];
  errors: { file: string; error: string }[];
}

export default function EvUploadButton({ onUploaded }: { onUploaded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* A check that came back with something to do. `written === false` on every
     result is what distinguishes "I have looked at this" from "I have saved
     it", and errors alone must not offer a Save. */
  const checked = Boolean(
    result && result.results.length > 0 && result.results.every((r) => !r.written),
  );
  /* Rolled up across every file in the batch. `anyImpact` guards the strip:
     an older server, or a reply that is nothing but errors, carries no impact
     figures at all and must not render a row of confident zeros. */
  const totals = (result?.results ?? []).reduce(
    (a, r) => ({
      nw: a.nw + (r.rows_new ?? 0),
      ch: a.ch + (r.rows_changed ?? 0),
      sm: a.sm + (r.rows_identical ?? 0),
      anyImpact: a.anyImpact || r.rows_new !== undefined,
    }),
    { nw: 0, ch: 0, sm: 0, anyImpact: false },
  );
  /* What saving would actually write — new plus changed, never the identical
     days, so the button promises the number the report just showed. */
  const toWrite = totals.nw + totals.ch;

  /* A write that actually happened: at least one file reported written. */
  const saved = Boolean(
    result && result.results.length > 0 && result.results.some((r) => r.written),
  );
  const savedNames = (result?.results ?? [])
    .filter((r) => r.written)
    .map((r) => r.display_name ?? r.serial_no)
    .join(", ");

  const reset = () => { setFiles([]); setResult(null); setError(null); setDryRun(true); };
  const close = () => { setOpen(false); reset(); };

  /* `check` is passed rather than read from state so "Save it" can send the
     real upload directly off the back of a check, without first flipping a
     checkbox the reader has to find and understand. */
  const send = async (check: boolean) => {
    if (!files.length) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      form.append("dry_run", String(check));
      const res = await api.post<UploadResponse>("/ev/upload", form);
      setResult(res.data);
      if (!check && res.data.rows_written > 0) onUploaded?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
      const detail = e.response?.data?.detail;
      // When every file fails the API answers 400 with {detail:{message,errors}}.
      // Render those per file like a normal result rather than dumping JSON at
      // the user — "Serial X is not registered" is the whole point of the reply.
      if (detail && typeof detail === "object" && Array.isArray((detail as { errors?: unknown }).errors)) {
        const d = detail as { message?: string; errors: { file: string; error: string }[] };
        setResult({ files_accepted: 0, files_rejected: d.errors.length, rows_written: 0, results: [], errors: d.errors });
      } else {
        setError(typeof detail === "string" ? detail : e.message ?? "Upload failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* The only control on this header that writes anything, so it is the
          only one styled as an action rather than as a view to switch to. */}
      <button
        onClick={() => setOpen(true)}
        title="Load a LiuGong .xlsx export — checked before anything is saved"
        className="flex items-center gap-1.5 rounded-lg border border-navy bg-navy px-3 py-1.5 text-[11px] font-condensed font-bold uppercase tracking-widest text-white shadow-sm transition hover:bg-navy-2"
      >
        <Upload size={12} />
        Upload Export
      </button>

      {!open ? null : (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
          <div className="w-full max-w-2xl rounded-md border border-border bg-white shadow-xl">

            <div className="flex items-start justify-between border-b border-border-light px-5 py-3">
              <div>
                <h2 className="font-condensed text-[15px] font-black uppercase tracking-[.05em] text-navy">
                  Upload EV telemetry export
                </h2>
                <p className="mt-0.5 text-[11px] text-txt-light">
                  LiuGong &quot;Man-hour fuel consumption&quot; .xlsx — the machine is read from the file name
                </p>
              </div>
              <button onClick={close} className="rounded p-1 text-txt-light hover:bg-bg-section hover:text-navy">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div
                onClick={() => inputRef.current?.click()}
                className="cursor-pointer rounded border-2 border-dashed border-border px-4 py-6 text-center hover:border-gold hover:bg-bg-section"
              >
                <FileSpreadsheet size={22} className="mx-auto text-txt-light" />
                <p className="mt-2 text-[12px] font-semibold text-navy">
                  {files.length ? `${files.length} file${files.length > 1 ? "s" : ""} selected` : "Choose .xlsx files"}
                </p>
                <p className="mt-0.5 text-[11px] text-txt-light">One workbook per machine per month. Several at once is fine.</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx"
                  multiple
                  hidden
                  onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setResult(null); setError(null); }}
                />
              </div>

              {files.length === 0 ? null : (
                <ul className="max-h-28 space-y-1 overflow-y-auto text-[11px] text-txt-secondary">
                  {files.map((f) => (
                    <li key={f.name} className="flex justify-between gap-3 border-b border-border-light pb-1">
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-txt-light">{(f.size / 1024).toFixed(0)} KB</span>
                    </li>
                  ))}
                </ul>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-txt-secondary">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                Check without saving — parse and report, write nothing
              </label>

              {error ? (
                <div className="flex gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {/* IT SAVED — SAY SO. The dialog used to look identical after a
                  write and after a check: the same report, the same buttons,
                  and a quiet "NOT SAVED" chip that had simply gone. Somebody
                  who looked away for a second had no way to tell whether the
                  upload had happened, and the safe move from there is to press
                  it again. */}
              {saved ? (
                <div className="mb-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-green-800">
                    <CheckCircle2 size={16} />
                    Saved — {result!.rows_written} row
                    {result!.rows_written === 1 ? "" : "s"} written to the fleet record
                  </div>
                  <p className="mt-1 text-[11px] text-green-900/70">
                    {savedNames}. The fleet figures behind this page have been
                    refreshed, and the upload is recorded in the Upload Log with
                    what it changed.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      onClick={reset}
                      className="flex items-center gap-1.5 rounded border border-green-300 bg-white px-3 py-1.5 text-[11px] font-condensed font-bold uppercase tracking-widest text-green-800 hover:bg-green-100"
                    >
                      <Upload size={12} />
                      Load another file
                    </button>
                    <button
                      onClick={close}
                      className="rounded border border-border px-3 py-1.5 text-[11px] font-condensed font-bold uppercase tracking-widest text-txt-secondary hover:bg-bg-section"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : null}

              {result ? (
                <div className="space-y-2">
                  {/* ACROSS EVERY FILE IN THE BATCH. Several workbooks at once
                      is the normal case — a month per machine — and reading
                      four per-file reports and adding them up by hand is the
                      kind of arithmetic that gets done wrong at 7am. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border-light bg-bg-section px-3 py-2 text-[12px]">
                    <span className="font-semibold text-navy">
                      {result.files_accepted} file{result.files_accepted === 1 ? "" : "s"} read
                    </span>
                    {result.files_rejected > 0 ? (
                      <span className="text-red-600">{result.files_rejected} rejected</span>
                    ) : null}
                    {totals.anyImpact ? (
                      <>
                        <span className="h-3 w-px bg-border" aria-hidden />
                        {totals.nw > 0 ? (
                          <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700 ring-1 ring-green-200">
                            {totals.nw} new
                          </span>
                        ) : null}
                        {totals.ch > 0 ? (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-amber-200">
                            {totals.ch} would change
                          </span>
                        ) : null}
                        {totals.sm > 0 ? (
                          <span className="rounded bg-white px-1.5 py-0.5 text-txt-light ring-1 ring-border-light">
                            {totals.sm} unchanged
                          </span>
                        ) : null}
                        {totals.nw + totals.ch === 0 ? (
                          <span className="text-txt-light">nothing to write — all of this is already loaded</span>
                        ) : null}
                      </>
                    ) : null}
                    <span className="ml-auto text-txt-secondary">
                      {result.rows_written} row{result.rows_written === 1 ? "" : "s"} written
                    </span>
                  </div>

                  {result.results.map((r) => (
                    <div key={r.file} className="rounded border border-border-light px-3 py-2 text-[11px]">
                      <div className="flex items-center gap-1.5 font-semibold text-navy">
                        <CheckCircle2 size={12} className="text-green-600" />
                        {/* The mine says EV EX-2, not CLG922FECSE735955. The
                            serial stays beside it — it is what links the file
                            to the machine and what a reader checks against the
                            file name. */}
                        {r.display_name ?? r.serial_no}
                        {r.display_name ? (
                          <span className="font-normal text-txt-light">{r.serial_no}</span>
                        ) : null}
                        {r.equipment_type ? <span className="font-normal text-txt-light">· {r.equipment_type}</span> : null}
                        {!r.written ? <span className="ml-auto rounded bg-gold-light/30 px-1.5 py-0.5 text-gold-dark">NOT SAVED</span> : null}
                      </div>
                      <div className="mt-1 text-txt-secondary">
                        {r.rows_parsed} rows · {day(r.date_from)} to {day(r.date_to)} · {r.columns_matched.length} columns matched
                        {r.has_energy_recycle_column ? " · incl. energy-recycle" : ""}
                      </div>

                      {/* WHAT IT DOES TO THE TABLE, which is the question.
                          "31 rows, 1-31 July" reads the same whether the table
                          is empty or already holds every one of those days. */}
                      {r.rows_new !== undefined ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {r.rows_new > 0 ? (
                            <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700 ring-1 ring-green-200">
                              {r.rows_new} new
                              {r.new_from ? ` · ${day(r.new_from)} to ${day(r.new_to!)}` : ""}
                              {r.rows_new_idle ? ` · ${r.rows_new_idle} idle` : ""}
                            </span>
                          ) : null}
                          {r.rows_changed ? (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-amber-200">
                              {r.rows_changed} would change
                            </span>
                          ) : null}
                          {r.rows_identical ? (
                            <span className="rounded bg-bg-section px-1.5 py-0.5 text-txt-light ring-1 ring-border-light"
                                  title="Already stored with exactly these figures — re-uploading them changes nothing">
                              {r.rows_identical} already there, unchanged
                              {r.rows_identical_idle ? ` · ${r.rows_identical_idle} idle` : ""}
                            </span>
                          ) : null}
                          {!r.rows_new && !r.rows_changed && r.rows_identical ? (
                            <span className="text-txt-light">nothing to do — this file is already loaded</span>
                          ) : null}
                        </div>
                      ) : null}

                      {/* ONLY THE CHANGED DAYS ARE LISTED, with the figure that
                          moves. A day being added has nothing to compare
                          against, and a day that matches has nothing to say;
                          a day whose total energy is about to go from 412 to
                          0 is the one somebody must see before saving. */}
                      {(r.rows_new_idle || r.rows_identical_idle) ? (
                        <p className="mt-1 text-[10px] leading-relaxed text-txt-light">
                          An <strong>idle</strong> day is a reading of zero hours and
                          zero kWh — the machine was there and did nothing. It is a
                          measurement, not a missing day.
                        </p>
                      ) : null}

                      {r.changed && r.changed.length ? (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-amber-800">
                            Show the {r.changed.length} day{r.changed.length === 1 ? "" : "s"} that would change
                          </summary>
                          <div className="mt-1 max-h-48 overflow-y-auto rounded border border-border-light">
                            <table className="w-full border-collapse text-[10.5px] tabular-nums">
                              <thead className="bg-bg-section">
                                <tr>
                                  <th className="border border-border-light px-2 py-1 text-left">Date</th>
                                  <th className="border border-border-light px-2 py-1 text-left">Figure</th>
                                  <th className="border border-border-light px-2 py-1 text-right">Now</th>
                                  <th className="border border-border-light px-2 py-1 text-right">After</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.changed.map((c) =>
                                  Object.entries(c.fields).map(([f, v], i) => (
                                    <tr key={`${c.report_date}-${f}`}>
                                      {i === 0 ? (
                                        <td className="border border-border-light px-2 py-1 align-top font-semibold text-navy"
                                            rowSpan={Object.keys(c.fields).length}>
                                          {day(c.report_date)}
                                        </td>
                                      ) : null}
                                      <td className="border border-border-light px-2 py-1">{FIELD_LABEL[f] ?? f}</td>
                                      <td className="border border-border-light px-2 py-1 text-right text-txt-light">{num(v.from)}</td>
                                      <td className="border border-border-light px-2 py-1 text-right font-semibold text-navy">{num(v.to)}</td>
                                    </tr>
                                  )),
                                )}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      ) : null}
                      {r.all_zero ? (
                        <div className="mt-1 flex gap-1.5 text-amber-700">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          Every row is zero — the machine reported no activity for this period.
                        </div>
                      ) : null}
                      {r.suspect_dates.length ? (
                        <div className="mt-1 flex gap-1.5 text-amber-700">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          Impossible energy on {r.suspect_dates.join(", ")} — stored but excluded from averages.
                        </div>
                      ) : null}
                      {r.columns_ignored.length ? (
                        <div className="mt-1 text-txt-light">Ignored columns: {r.columns_ignored.join(", ")}</div>
                      ) : null}
                    </div>
                  ))}

                  {result.errors.map((e) => (
                    <div key={e.file} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                      <span className="font-semibold">{e.file}</span> — {e.error}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={`flex justify-end gap-2 border-t border-border-light px-5 py-3 ${saved ? "hidden" : ""}`}>
              <button onClick={close} className="rounded border border-border px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-txt-secondary hover:bg-bg-section">
                CLOSE
              </button>
              <button
                onClick={() => void send(dryRun)}
                disabled={busy || files.length === 0}
                className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest disabled:cursor-not-allowed disabled:opacity-40 ${
                  checked
                    ? "border-border bg-white text-txt-secondary hover:bg-bg-section"
                    : "border-gold-dark bg-gold text-white"
                }`}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {busy ? "WORKING" : dryRun ? "CHECK FILE" : "UPLOAD"}
              </button>

              {/* THE STEP AFTER CHECKING IS SAVING, so offer it.
                  The checkbox stays — it is how somebody chooses to check in
                  the first place — but having read the report, the reader
                  should not have to work out that the way to act on it is to
                  untick a box and press the same button again. Appears only
                  once a check has actually come back clean, and names the
                  number it is about to write. */}
              {checked ? (
                <button
                  onClick={() => { setDryRun(false); void send(false); }}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded border border-gold-dark bg-gold px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {toWrite > 0 ? `SAVE ${toWrite} ROW${toWrite === 1 ? "" : "S"}` : "SAVE ANYWAY"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
