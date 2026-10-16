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
}

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

  const reset = () => { setFiles([]); setResult(null); setError(null); setDryRun(true); };
  const close = () => { setOpen(false); reset(); };

  const send = async () => {
    if (!files.length) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      form.append("dry_run", String(dryRun));
      const res = await api.post<UploadResponse>("/ev/upload", form);
      setResult(res.data);
      if (!dryRun && res.data.rows_written > 0) onUploaded?.();
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
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded transition text-[11px] font-condensed font-bold tracking-widest border shadow-sm bg-white hover:bg-bg-section text-txt-secondary hover:text-navy border-border"
      >
        <Upload size={12} />
        UPLOAD EXPORT
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

              {result ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border border-border-light bg-bg-section px-3 py-2 text-[12px]">
                    <span className="font-semibold text-navy">{result.files_accepted} accepted</span>
                    {result.files_rejected > 0 ? <span className="text-red-600">{result.files_rejected} rejected</span> : null}
                    <span className="text-txt-secondary">{result.rows_written} rows written</span>
                  </div>

                  {result.results.map((r) => (
                    <div key={r.file} className="rounded border border-border-light px-3 py-2 text-[11px]">
                      <div className="flex items-center gap-1.5 font-semibold text-navy">
                        <CheckCircle2 size={12} className="text-green-600" />
                        {r.serial_no}
                        {r.equipment_type ? <span className="font-normal text-txt-light">· {r.equipment_type}</span> : null}
                        {!r.written ? <span className="ml-auto rounded bg-gold-light/30 px-1.5 py-0.5 text-gold-dark">NOT SAVED</span> : null}
                      </div>
                      <div className="mt-1 text-txt-secondary">
                        {r.rows_parsed} rows · {r.date_from} to {r.date_to} · {r.columns_matched.length} columns matched
                        {r.has_energy_recycle_column ? " · incl. energy-recycle" : ""}
                        {r.written ? ` · ${r.rows_inserted} new, ${r.rows_updated} updated` : ""}
                      </div>
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

            <div className="flex justify-end gap-2 border-t border-border-light px-5 py-3">
              <button onClick={close} className="rounded border border-border px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-txt-secondary hover:bg-bg-section">
                CLOSE
              </button>
              <button
                onClick={send}
                disabled={busy || files.length === 0}
                className="flex items-center gap-1.5 rounded border border-gold-dark bg-gold px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {busy ? "WORKING" : dryRun ? "CHECK FILE" : "UPLOAD"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
