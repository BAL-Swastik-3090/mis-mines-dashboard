"use client";
/**
 * What the certificates used to say.
 *
 * The form shows the document in force. This shows the ones behind it, which
 * is the half nobody could see: every renewal kept, every correction recorded,
 * and last year's policy still downloadable from the row it belonged to.
 *
 * It answers one question that the current row cannot — "what was the
 * insurance on the day of the incident" — and that question is the reason the
 * renewal history is kept at all. A history nothing displays is a history
 * nobody trusts is there.
 *
 * Closed by default. On a machine registered last month there is nothing to
 * see, and a panel that is empty most of the time teaches people to skip it.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toDisplay } from "./DateField";
import {
  History, ChevronDown, Loader2, Download, ArrowRight, PencilLine,
} from "lucide-react";
import api from "@/lib/api";
import { Chip } from "./ui";
import { ExpiryChip } from "./cells";

interface Version {
  asset_compliance_id: number; document_type: string; document_no: string | null;
  provider: string | null; valid_from: string | null; valid_upto: string | null;
  amount: string | null; renewal_no: number; superseded_at: string | null;
  renewed_from: number | null; created_by: string | null; created_at: string;
  files: number;
}

interface Correction {
  revision_id: number; asset_compliance_id: number; document_type: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  reason: string | null; changed_by: string; changed_at: string;
}

interface History {
  by_type: Record<string, Version[]>;
  corrections: Correction[];
  renewals: number;
}

const pretty = (code: string) =>
  code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

export default function ComplianceHistory({ assetId }: { assetId: number | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<Record<number, { asset_document_id: number;
                                                     file_name: string;
                                                     content_type: string | null }[]>>({});

  const load = useCallback(async () => {
    if (!assetId || !open) return;
    setLoading(true);
    try {
      const [h, f] = await Promise.all([
        api.get(`/minehub/assets/${assetId}/compliance-history`),
        api.get(`/minehub/assets/${assetId}/documents`),
      ]);
      setData(h.data);
      const byVersion: Record<number, typeof files[number]> = {};
      for (const row of f.data ?? []) {
        if (!row.asset_compliance_id) continue;
        (byVersion[row.asset_compliance_id] ||= []).push(row);
      }
      setFiles(byVersion);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [assetId, open]);

  useEffect(() => { void load(); }, [load]);

  const download = async (doc: { asset_document_id: number; file_name: string;
                                 content_type: string | null }) => {
    try {
      const r = await api.get(
        `/minehub/assets/${assetId}/documents/${doc.asset_document_id}`,
        { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data],
        { type: doc.content_type ?? "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.file_name;
      link.click();
      URL.revokeObjectURL(url);
    } catch { /* the panel is read-only; a failed download says so in the console */ }
  };

  if (!assetId) return null;

  const past = Object.values(data?.by_type ?? {})
    .flat().filter((v) => v.superseded_at);
  const nothing = data && past.length === 0 && data.corrections.length === 0;

  return (
    <div className="border border-t-0 border-border rounded-b-xl bg-bg-base">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-bg-light
                   transition rounded-b-xl">
        <History className="w-3.5 h-3.5 text-txt-light" />
        <span className="text-[10.5px] font-bold uppercase tracking-[.12em]
                         text-txt-light font-condensed">
          Earlier certificates
        </span>
        {data && (past.length > 0 || data.corrections.length > 0) && (
          <span className="flex items-center gap-1.5">
            {past.length > 0 && (
              <Chip tone="slate" dot={false}>{past.length} superseded</Chip>
            )}
            {data.corrections.length > 0 && (
              <Chip tone="sky" dot={false}>
                {data.corrections.length} corrected
              </Chip>
            )}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 text-txt-light ml-auto transition
                                 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-3 pb-3">
          {loading ? (
            <p className="py-4 text-center">
              <Loader2 className="w-4 h-4 animate-spin mx-auto text-txt-light" />
            </p>
          ) : nothing ? (
            <p className="py-2 text-[12.5px] text-txt-light">
              Nothing superseded yet. When a certificate is renewed, the one it
              replaced stays here with its own dates and its own papers.
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data?.by_type ?? {}).map(([kind, versions]) => {
                const history = versions.filter((v) => v.superseded_at);
                if (history.length === 0) return null;
                return (
                  <div key={kind} className="rounded-lg border border-slate-200 bg-white">
                    <p className="px-3 py-1.5 text-[11.5px] font-bold text-navy
                                  border-b border-slate-100">
                      {pretty(kind)}
                    </p>
                    <div className="divide-y divide-slate-100">
                      {history.map((v) => (
                        <div key={v.asset_compliance_id}
                             className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-[12px] text-txt-muted tabular-nums">
                            {v.valid_from || "—"}
                            <ArrowRight className="w-3 h-3 inline mx-1 text-txt-light" />
                            {v.valid_upto || "—"}
                          </span>
                          {v.document_no && (
                            <span className="text-[11.5px] font-mono text-navy">
                              {v.document_no}
                            </span>
                          )}
                          {v.provider && (
                            <span className="text-[11.5px] text-txt-light">{v.provider}</span>
                          )}
                          <Chip tone="slate" dot={false}>
                            renewal {v.renewal_no}
                          </Chip>
                          <span className="ml-auto flex items-center gap-2">
                            {(files[v.asset_compliance_id] ?? []).map((doc) => (
                              <button key={doc.asset_document_id}
                                onClick={() => void download(doc)}
                                title={`Download ${doc.file_name}`}
                                className="inline-flex items-center gap-1 text-[11.5px]
                                           text-txt-muted hover:text-navy">
                                <Download className="w-3.5 h-3.5" />
                                {doc.file_name.length > 22
                                  ? `${doc.file_name.slice(0, 20)}…` : doc.file_name}
                              </button>
                            ))}
                            {(files[v.asset_compliance_id] ?? []).length === 0 && (
                              <span className="text-[11px] text-txt-light italic">
                                no papers kept
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {(data?.corrections.length ?? 0) > 0 && (
                <div className="rounded-lg border border-sky/25 bg-sky-bg/30">
                  <p className="px-3 py-1.5 text-[11.5px] font-bold text-sky
                                border-b border-sky/15 flex items-center gap-1.5">
                    <PencilLine className="w-3.5 h-3.5" />
                    Corrections — what was on file before it was fixed
                  </p>
                  <div className="divide-y divide-sky/10">
                    {data!.corrections.map((c) => (
                      <div key={c.revision_id} className="px-3 py-2 text-[12px]">
                        <span className="font-semibold text-navy">
                          {pretty(c.document_type)}
                        </span>
                        {Object.entries(c.changes).map(([field, move]) => (
                          <span key={field} className="ml-2 text-txt-muted">
                            {field.replace(/_/g, " ")}:{" "}
                            <span className="line-through text-txt-light">
                              {String(move.from ?? "—")}
                            </span>
                            <ArrowRight className="w-3 h-3 inline mx-1 text-txt-light" />
                            <span className="font-semibold text-navy">
                              {String(move.to ?? "—")}
                            </span>
                          </span>
                        ))}
                        <span className="block text-[11px] text-txt-light mt-0.5">
                          {c.changed_by} · {toDisplay(String(c.changed_at).slice(0, 10))}
                          {c.reason ? ` · “${c.reason}”` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { ExpiryChip };
