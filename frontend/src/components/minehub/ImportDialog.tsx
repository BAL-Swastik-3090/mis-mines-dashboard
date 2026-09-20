"use client";
/**
 * Reading a spreadsheet into the register.
 *
 * The shape of this is one decision: nothing is written until the person has
 * seen, row by row, what writing it would do. Bulk import is the one action on
 * this screen that can be wrong 130 times before anybody notices, so the
 * dry run is not an option here, it is the first half of the feature.
 *
 * Everything it writes lands as a draft, including changes to machines that
 * were already approved. A spreadsheet is somebody's working copy.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, FileUp, Loader2, Plus, RefreshCw, X,
} from "lucide-react";
import api from "@/lib/api";
import { Button, Chip, type Tone } from "./ui";
import { parseCsv, toCsv, download } from "./spreadsheet";

interface PlanRow {
  line: number;
  action: "CREATE" | "UPDATE" | "SKIP" | "ERROR";
  machine?: string;
  message: string;
}

const ACTION: Record<PlanRow["action"], { tone: Tone; label: string }> = {
  CREATE: { tone: "emerald", label: "new" },
  UPDATE: { tone: "sky", label: "update" },
  SKIP: { tone: "slate", label: "skipped" },
  ERROR: { tone: "rose", label: "problem" },
};

/** The headings the register understands, which are also the ones it exports.
 *  Offered as a file so nobody has to guess the spelling. */
const TEMPLATE = [
  "Machine", "Reference", "Name", "Registration", "Type", "Make", "Model",
  "Owner", "Status", "Fuel", "Propulsion", "Capacity", "Capacity UOM",
  "Chassis No", "Engine No", "Year", "SAP Equipment No", "Remarks",
];

export default function ImportDialog({ onClose, onDone }: {
  onClose: () => void;
  /** Something was written; the register behind this needs reloading. */
  onDone: (summary: string) => void;
}) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [filename, setFilename] = useState("");
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<"reading" | "checking" | "writing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const check = useCallback(async (parsed: Record<string, string>[]) => {
    setBusy("checking"); setError(null);
    try {
      const r = await api.post("/minehub/assets/import",
        { rows: parsed, dry_run: true });
      setPlan(r.data.plan ?? []);
      setCounts(r.data.counts ?? {});
      setOnlyProblems((r.data.counts?.ERROR ?? 0) > 0);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not read that file.");
    } finally { setBusy(null); }
  }, []);

  const take = async (file: File) => {
    setBusy("reading"); setError(null); setPlan(null);
    setFilename(file.name);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length === 0) {
        setError("That file has no rows under its headings.");
        setRows(null); setBusy(null); return;
      }
      setRows(parsed);
      await check(parsed);
    } catch {
      setError("That file could not be read as a CSV.");
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!rows) return;
    setBusy("writing"); setError(null);
    try {
      const r = await api.post("/minehub/assets/import",
        { rows, dry_run: false });
      const bits = [
        r.data.created ? `${r.data.created} registered` : "",
        r.data.updated ? `${r.data.updated} updated` : "",
        r.data.unchanged ? `${r.data.unchanged} already matched` : "",
      ].filter(Boolean);
      onDone(bits.length
        ? `Imported from ${filename}: ${bits.join(", ")}. Everything landed as a draft.`
        : `Nothing in ${filename} needed changing.`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "The import failed. Nothing was written.");
      setBusy(null);
    }
  };

  const errors = counts.ERROR ?? 0;
  const willWrite = (counts.CREATE ?? 0) + (counts.UPDATE ?? 0);
  const shown = (plan ?? []).filter((p) => !onlyProblems || p.action === "ERROR");

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center
                    bg-navy/40 backdrop-blur-[2px] p-4 overflow-y-auto">
      <div className="bg-bg-base rounded-2xl shadow-2xl border border-border-light
                      w-full max-w-[860px] my-8 overflow-hidden">
        <header className="px-5 py-4 border-b border-border-light flex items-start
                           justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="shrink-0 w-8 h-8 rounded-lg bg-sky-bg ring-1 ring-sky-ring
                             flex items-center justify-center">
              <FileUp className="w-4 h-4 text-sky" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-[14px] text-navy leading-tight">
                Import machines from a spreadsheet
              </h2>
              <p className="text-[12px] text-txt-muted mt-1 max-w-[70ch]">
                Everything imported lands as a <strong>draft</strong>, including
                changes to machines already approved — somebody still has to look
                at each one. You will see exactly what the file would do before
                anything is written.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 text-txt-light hover:text-navy p-1">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg bg-rose-bg ring-1 ring-rose-ring px-3 py-2.5
                            text-[12.5px] text-rose flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" /> {error}
            </div>
          )}

          {/* ── choosing a file ─────────────────────────────────────────── */}
          {!plan && (
            <div className="rounded-xl border-2 border-dashed border-border
                            px-5 py-8 text-center">
              <input ref={input} type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void take(f);
                  e.target.value = "";     // the same file can be chosen twice
                }} />
              <FileUp className="w-7 h-7 mx-auto text-txt-light mb-2.5" />
              <p className="text-[13px] text-txt-secondary mb-1">
                Choose a CSV file
              </p>
              <p className="text-[11.5px] text-txt-light mb-4 max-w-[52ch] mx-auto">
                A file exported from this register can be corrected in Excel and
                sent straight back — the headings match. Rows with a Machine code
                the register already knows are updated; the rest are registered.
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button variant="primary" onClick={() => input.current?.click()}
                  disabled={busy !== null}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <FileUp className="w-3.5 h-3.5" />}
                  {busy === "reading" ? "Reading…" : busy === "checking"
                    ? "Checking…" : "Choose file"}
                </Button>
                <Button variant="secondary"
                  onClick={() => download(toCsv(TEMPLATE, []),
                                          "machine-import-template.csv")}>
                  Download a blank template
                </Button>
              </div>
            </div>
          )}

          {/* ── what the file would do ──────────────────────────────────── */}
          {plan && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-txt-secondary font-semibold
                                 truncate max-w-[24ch]" title={filename}>
                  {filename}
                </span>
                <span className="text-[12px] text-txt-light">
                  {plan.length} row{plan.length === 1 ? "" : "s"}
                </span>
                <span className="flex-1" />
                {(["CREATE", "UPDATE", "SKIP", "ERROR"] as const)
                  .filter((a) => counts[a])
                  .map((a) => (
                    <Chip key={a} tone={ACTION[a].tone}>
                      {counts[a]} {ACTION[a].label}
                      {counts[a] === 1 ? "" : "s"}
                    </Chip>
                  ))}
              </div>

              {errors > 0 && (
                <div className="rounded-lg bg-amber-bg ring-1 ring-amber-ring px-3 py-2.5
                                text-[12.5px] text-amber flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                  <span>
                    Nothing will be imported while any row has a problem — a
                    half-finished import is worse than none, because you cannot
                    tell afterwards what landed. Fix these {errors} in the file
                    and choose it again.
                  </span>
                </div>
              )}

              {errors > 0 && (
                <label className="inline-flex items-center gap-2 text-[12px] text-txt-muted">
                  <input type="checkbox" checked={onlyProblems}
                    onChange={(e) => setOnlyProblems(e.target.checked)}
                    className="accent-gold w-3.5 h-3.5" />
                  Show only the rows with problems
                </label>
              )}

              <div className="max-h-[42vh] overflow-y-auto rounded-xl border border-border-light">
                <table className="w-full">
                  <thead className="sticky top-0">
                    <tr className="bg-bg-light">
                      <th className="text-left font-condensed text-[10px] font-bold uppercase
                                     tracking-[.12em] text-txt-light px-3 py-2 w-14">Row</th>
                      <th className="text-left font-condensed text-[10px] font-bold uppercase
                                     tracking-[.12em] text-txt-light px-3 py-2 w-24">Does</th>
                      <th className="text-left font-condensed text-[10px] font-bold uppercase
                                     tracking-[.12em] text-txt-light px-3 py-2">Machine</th>
                      <th className="text-left font-condensed text-[10px] font-bold uppercase
                                     tracking-[.12em] text-txt-light px-3 py-2">What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr key={p.line} className="border-t border-border-light">
                        <td className="px-3 py-2 text-[11.5px] text-txt-light tabular-nums">
                          {p.line}
                        </td>
                        <td className="px-3 py-2">
                          <Chip tone={ACTION[p.action].tone} dot={false}>
                            {ACTION[p.action].label}
                          </Chip>
                        </td>
                        <td className="px-3 py-2 text-[12px] font-semibold text-navy
                                       font-mono truncate max-w-[18ch]">
                          {p.machine || "—"}
                        </td>
                        <td className={`px-3 py-2 text-[12px] ${
                          p.action === "ERROR" ? "text-rose" : "text-txt-muted"}`}>
                          {p.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <footer className="px-5 py-3.5 border-t border-border-light bg-bg-light/60
                           flex items-center justify-between gap-2">
          <div>
            {plan && (
              <Button variant="secondary" onClick={() => { setPlan(null); setRows(null); }}
                disabled={busy !== null}>
                <ArrowLeft className="w-3.5 h-3.5" /> Choose a different file
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy === "writing"}>
              Cancel
            </Button>
            {plan && rows && (
              <Button variant="primary" onClick={apply}
                disabled={busy !== null || errors > 0 || willWrite === 0}
                title={errors > 0 ? "Fix the problem rows first"
                       : willWrite === 0 ? "This file would change nothing" : undefined}>
                {busy === "writing"
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</>
                  : <>
                      {(counts.CREATE ?? 0) > 0 ? <Plus className="w-3.5 h-3.5" />
                                                : <RefreshCw className="w-3.5 h-3.5" />}
                      Import {willWrite} machine{willWrite === 1 ? "" : "s"} as drafts
                    </>}
              </Button>
            )}
            {plan && willWrite === 0 && errors === 0 && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald">
                <Check className="w-3.5 h-3.5" /> Already up to date
              </span>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
