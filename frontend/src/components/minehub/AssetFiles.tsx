"use client";
/**
 * The papers themselves — the scanned certificate, the invoice, the permit.
 *
 * A date in a field says the insurance runs to August. It does not prove it,
 * and proof is what somebody needs at a gate, at an audit, or after an
 * incident. Today that PDF is in an inbox, and the person who needs it is not
 * the person who received it.
 *
 * Attached to a certificate where one is chosen, so last year's policy stays
 * on last year's row rather than piling up against the machine. That is the
 * whole point of keeping renewal history: the document and the period it
 * covers stay together.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Paperclip, Upload, Download, Trash2, Loader2, FileText, X,
} from "lucide-react";
import api from "@/lib/api";
import { Chip } from "./ui";

interface FileRow {
  asset_document_id: number; asset_compliance_id: number | null;
  kind: string; title: string | null; file_name: string;
  content_type: string | null; size_bytes: number | null;
  uploaded_by: string | null; uploaded_at: string;
  document_type: string | null; valid_upto: string | null;
}

/** A size somebody can read at a glance. */
function size(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AssetFiles({ assetId, mayManage, attachments }: {
  assetId: number | null;
  mayManage: boolean;
  /** Certificates on file, so a paper can be put against the right one. */
  attachments?: { asset_compliance_id?: number; document_type: string;
                  valid_upto: string }[];
}) {
  const [rows, setRows] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [against, setAgainst] = useState<string>("");
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!assetId) { setRows([]); return; }
    setLoading(true);
    try {
      const r = await api.get(`/minehub/assets/${assetId}/documents`);
      setRows(r.data ?? []);
      setError(null);
    } catch {
      setError("The attached files could not be listed.");
    } finally { setLoading(false); }
  }, [assetId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    if (!assetId) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const chosen = attachments?.find(
        (a) => String(a.asset_compliance_id ?? "") === against);
      const params = new URLSearchParams({
        kind: chosen?.document_type ?? "OTHER",
      });
      if (against) params.set("asset_compliance_id", against);
      await api.post(`/minehub/assets/${assetId}/documents?${params}`, form);
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That file could not be attached.");
    } finally { setBusy(false); }
  };

  /** Fetched rather than linked, because the API needs the session header —
   *  a plain href would arrive unauthenticated and download a 401. */
  const download = async (row: FileRow) => {
    setBusy(true);
    try {
      const r = await api.get(
        `/minehub/assets/${assetId}/documents/${row.asset_document_id}`,
        { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data],
        { type: row.content_type ?? "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = row.file_name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("That file could not be downloaded.");
    } finally { setBusy(false); }
  };

  const remove = async (row: FileRow) => {
    setBusy(true);
    try {
      await api.delete(`/minehub/assets/${assetId}/documents/${row.asset_document_id}`);
      await load();
    } catch {
      setError("That file could not be removed.");
    } finally { setBusy(false); }
  };

  if (!assetId) {
    return (
      <p className="px-3 py-4 text-[12.5px] text-txt-muted">
        Save the machine first — a file needs something to be attached to.
      </p>
    );
  }

  return (
    <div className="px-3 py-3 space-y-3">
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-rose-bg
                        px-3 py-2 text-[12px] text-rose">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {mayManage && (
        <div className="flex flex-wrap items-center gap-2">
          {attachments && attachments.length > 0 && (
            <select value={against} onChange={(e) => setAgainst(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]
                         text-txt-muted bg-white">
              <option value="">About the machine</option>
              {attachments.filter((a) => a.asset_compliance_id).map((a) => (
                <option key={a.asset_compliance_id} value={String(a.asset_compliance_id)}>
                  {a.document_type.replace("_", " ").toLowerCase()}
                  {a.valid_upto ? ` — to ${a.valid_upto}` : ""}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={() => picker.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200
                       bg-white px-3 py-1.5 text-[12px] font-semibold text-txt-muted
                       hover:bg-slate-50 transition disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Upload className="w-3.5 h-3.5" />}
            Attach a file
          </button>
          <input ref={picker} type="file" className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }} />
          <span className="text-[11px] text-txt-light">
            PDF, image, Word or Excel — up to 15 MB
          </span>
        </div>
      )}

      {loading ? (
        <p className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-txt-light" /></p>
      ) : rows.length === 0 ? (
        <p className="py-3 text-[12.5px] text-txt-light">
          Nothing attached. A date says the insurance runs to August; the
          certificate proves it.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((row) => (
            <div key={row.asset_document_id}
                 className="px-3 py-2 flex items-center gap-3 group">
              <FileText className="w-4 h-4 text-txt-light shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-navy truncate"
                   title={row.file_name}>{row.file_name}</p>
                <p className="text-[11px] text-txt-light">
                  {size(row.size_bytes)}
                  {row.uploaded_by ? ` · ${row.uploaded_by}` : ""}
                  {` · ${String(row.uploaded_at).slice(0, 10)}`}
                </p>
              </div>
              {row.document_type && (
                <Chip tone="sky" dot={false}>
                  {row.document_type.replace("_", " ").toLowerCase()}
                  {row.valid_upto ? ` to ${row.valid_upto}` : ""}
                </Chip>
              )}
              <button onClick={() => void download(row)} disabled={busy}
                className="text-txt-light hover:text-navy" title="Download">
                <Download className="w-4 h-4" />
              </button>
              {mayManage && (
                <button onClick={() => void remove(row)} disabled={busy}
                  className="text-txt-light hover:text-rose opacity-0 group-hover:opacity-100
                             transition" title="Remove from the record">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { Paperclip };
