"use client";

/**
 * HOTO checklists — the screen the schema was shaped for.
 *
 * Adding a check, changing a range, marking one critical or retiring it happens
 * here, not in a deployment. That is the whole point of migration 105.
 *
 * ── WHY A PUBLISHED CHECKLIST CANNOT BE EDITED ───────────────────────────────
 * A handover records the template and version it answered. Editing a published
 * version would make a record signed last Tuesday claim it answered a question
 * nobody asked. So the screen offers *Clone to draft* on anything ACTIVE and
 * only ever edits drafts — and it shows the capture count beside each version,
 * because that number is the reason.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Loader2,
  Plus, Send, Trash2, X,
} from "lucide-react";
import api from "@/lib/api";

type Status = "DRAFT" | "ACTIVE" | "RETIRED";
type ResponseType = "OK_CAUTION_NOTOK" | "NUMERIC" | "YES_NO" | "LEVEL";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface TemplateRow {
  template_id: number;
  name: string;
  version: number;
  status: Status;
  effective_from: string | null;
  asset_type_id: number;
  asset_type_name: string;
  plant_name: string | null;
  org_unit_name: string | null;
  section_count: number;
  item_count: number;
  critical_count: number;
  captures: number;
  updated_by: string | null;
  updated_at: string | null;
}

interface Item {
  item_id: number;
  label: string;
  response_type: ResponseType;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  category: string | null;
  is_critical: boolean;
  requires_photo_if_not_ok: boolean;
  default_severity: Severity;
  display_order: number;
}
interface Section {
  section_id: number;
  name: string;
  display_order: number;
  items: Item[];
}
interface TemplateDetail extends TemplateRow { sections: Section[] }

const RESPONSE_LABEL: Record<ResponseType, string> = {
  OK_CAUTION_NOTOK: "OK / Caution / Not OK",
  NUMERIC: "Gauge reading",
  YES_NO: "Yes / No",
  LEVEL: "Level",
};

const SEVERITY_STYLE: Record<Severity, string> = {
  LOW: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const STATUS_STYLE: Record<Status, string> = {
  DRAFT: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  RETIRED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

/** How a range reads to a fitter: "80–120 psi", "≥ 2 bar", "≤ 95 °C". */
function rangeLabel(i: Item): string | null {
  if (i.min_value == null && i.max_value == null) return null;
  const u = i.unit ? ` ${i.unit}` : "";
  if (i.min_value != null && i.max_value != null) return `${i.min_value}–${i.max_value}${u}`;
  return i.min_value != null ? `≥ ${i.min_value}${u}` : `≤ ${i.max_value}${u}`;
}

export default function HotoChecklistsSection() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/hoto/admin/templates", {
        params: { include_retired: showRetired },
      });
      setRows(r.data.templates ?? []);
      setError(null);
    } catch (e: any) {
      setError([e?.response?.data?.detail ?? "Could not load the checklists."]);
    } finally {
      setLoading(false);
    }
  }, [showRetired]);

  useEffect(() => { void load(); }, [load]);

  const loadDetail = useCallback(async (id: number) => {
    setSelected(id);
    setDetail(null);
    try {
      const r = await api.get(`/hoto/template/${id}`);
      setDetail(r.data);
      setOpen(new Set((r.data.sections ?? []).map((s: Section) => s.section_id)));
    } catch {
      setError(["Could not open that checklist."]);
    }
  }, []);

  /** Pull the problems out of the API's `{message, problems}` shape. */
  const act = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try {
      await fn();
      await load();
      if (selected) await loadDetail(selected);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setError(Array.isArray(d?.problems) ? d.problems : [d?.message ?? d ?? "Refused."]);
    } finally {
      setBusy(null);
    }
  }, [load, loadDetail, selected]);

  const grouped = useMemo(() => {
    const by = new Map<string, TemplateRow[]>();
    for (const r of rows) {
      const k = r.asset_type_name;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const isDraft = detail?.status === "DRAFT";

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">HOTO checklists</h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-prose">
            What an operator is asked at a handover, per machine type. Edited here,
            not in a release — but a published version is never changed, because
            handovers record the version they answered.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={showRetired}
                 onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
            <div className="text-[11px] text-red-900 dark:text-red-200 space-y-0.5">
              {error.map((p, i) => <p key={i}>{p}</p>)}
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-red-600">
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ── the list ─────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          )}

          {!loading && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No checklists yet. One has to exist per machine type before a
              handover can be captured for it.
            </p>
          )}

          {grouped.map(([type, versions]) => (
            <section key={type} className="rounded border border-border">
              <h3 className="px-3 py-2 text-xs font-semibold border-b border-border">
                {type}
              </h3>
              <ul className="divide-y divide-border">
                {versions.map((t) => (
                  <li key={t.template_id}>
                    <button
                      onClick={() => void loadDetail(t.template_id)}
                      className={`w-full text-left px-3 py-2 hover:bg-muted/50 ${
                        selected === t.template_id ? "bg-muted" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">v{t.version}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>
                          {t.status}
                        </span>
                        {t.effective_from && (
                          <span className="text-[10px] text-muted-foreground">
                            from {t.effective_from}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {t.section_count} sections · {t.item_count} items ·{" "}
                        <span className={t.critical_count === 0 ? "text-red-600" : ""}>
                          {t.critical_count} critical
                        </span>
                        {t.captures > 0 && <> · {t.captures} handovers answered this</>}
                      </div>
                      {(t.plant_name || t.org_unit_name) && (
                        <div className="text-[10px] text-muted-foreground">
                          scoped to {[t.plant_name, t.org_unit_name].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* ── the checklist itself ─────────────────────────────────────── */}
        <div className="rounded border border-border min-h-[20rem]">
          {!detail && (
            <p className="p-4 text-xs text-muted-foreground">
              Pick a checklist to see what it asks.
            </p>
          )}

          {detail && (
            <>
              <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-semibold">
                    {detail.name} <span className="font-normal text-muted-foreground">v{detail.version}</span>
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {detail.asset_type_name} · {detail.sections.length} sections ·{" "}
                    {detail.sections.reduce((n, s) => n + s.items.length, 0)} items
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {detail.status === "ACTIVE" && (
                    <button
                      disabled={busy !== null}
                      onClick={() => void act("clone", () =>
                        api.post(`/hoto/admin/templates/${detail.template_id}/clone`, {}))}
                      className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
                    >
                      <Copy size={12} /> Clone to draft
                    </button>
                  )}
                  {isDraft && <PublishButton detail={detail} busy={busy} act={act} />}
                </div>
              </div>

              {detail.status === "ACTIVE" && (
                <p className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border">
                  Published, so it cannot be changed —{" "}
                  {detail.captures > 0
                    ? `${detail.captures} handover${detail.captures === 1 ? "" : "s"} recorded answering this exact version.`
                    : "handovers that answer it will record this exact version."}{" "}
                  Clone it to make changes.
                </p>
              )}

              <div className="divide-y divide-border">
                {detail.sections.map((s) => {
                  const isOpen = open.has(s.section_id);
                  return (
                    <section key={s.section_id}>
                      <button
                        onClick={() => setOpen((prev) => {
                          const next = new Set(prev);
                          next.has(s.section_id) ? next.delete(s.section_id) : next.add(s.section_id);
                          return next;
                        })}
                        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/40"
                      >
                        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <span className="text-xs font-medium">{s.display_order}. {s.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {s.items.length} items
                          {s.items.some((i) => i.is_critical) &&
                            ` · ${s.items.filter((i) => i.is_critical).length} critical`}
                        </span>
                      </button>

                      {isOpen && (
                        <ul className="pb-2">
                          {s.items.map((i) => (
                            <li key={i.item_id}
                                className="px-4 py-1.5 pl-9 flex items-start gap-2 hover:bg-muted/30">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs">{i.label}</span>
                                  {i.is_critical && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
                                      BLOCKS
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                                  <span>{RESPONSE_LABEL[i.response_type]}</span>
                                  {rangeLabel(i) && <>· <span className="font-medium">{rangeLabel(i)}</span></>}
                                  {i.requires_photo_if_not_ok && <>· photo required</>}
                                </div>
                              </div>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_STYLE[i.default_severity]}`}>
                                {i.default_severity}
                              </span>
                              {isDraft && (
                                <button
                                  title="Retire this item"
                                  disabled={busy !== null}
                                  onClick={() => void act(`retire-${i.item_id}`, () =>
                                    api.delete(`/hoto/admin/items/${i.item_id}`))}
                                  className="text-muted-foreground hover:text-red-600 shrink-0"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </li>
                          ))}
                          {isDraft && <AddItem sectionId={s.section_id} busy={busy} act={act} />}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>

              {isDraft && <AddSection templateId={detail.template_id} busy={busy} act={act} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── publish ──────────────────────────────────────────────────────────────── */

function PublishButton({ detail, busy, act }: {
  detail: TemplateDetail; busy: string | null;
  act: (k: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const criticals = detail.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.is_critical).length, 0);

  return (
    <div className="flex items-center gap-1.5">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
             className="text-[11px] px-1.5 py-1 rounded border border-border bg-background" />
      <button
        disabled={busy !== null}
        title={criticals === 0
          ? "Nothing on this checklist is marked as blocking, so nothing would stop a machine going to work"
          : "Put this version in force from the chosen date"}
        onClick={() => void act("publish", () =>
          api.post(`/hoto/admin/templates/${detail.template_id}/publish`,
                   { effective_from: date }))}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        <Send size={12} /> Publish
      </button>
    </div>
  );
}

/* ── adding ───────────────────────────────────────────────────────────────── */

function AddSection({ templateId, busy, act }: {
  templateId: number; busy: string | null;
  act: (k: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <div className="px-4 py-2 border-t border-border flex items-center gap-2">
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        placeholder="New section — ENGINE, SAFETY, FLUIDS…"
        className="text-xs px-2 py-1 rounded border border-border bg-background flex-1"
      />
      <button
        disabled={busy !== null || !name.trim()}
        onClick={() => void act("add-section", async () => {
          await api.post(`/hoto/admin/templates/${templateId}/sections`, { name });
          setName("");
        })}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40"
      >
        <Plus size={12} /> Add section
      </button>
    </div>
  );
}

function AddItem({ sectionId, busy, act }: {
  sectionId: number; busy: string | null;
  act: (k: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({
    label: "", response_type: "OK_CAUTION_NOTOK" as ResponseType,
    unit: "", min_value: "", max_value: "",
    is_critical: false, requires_photo_if_not_ok: true,
    default_severity: "MEDIUM" as Severity,
  });

  if (!adding) {
    return (
      <li className="px-4 pl-9 pt-1">
        <button onClick={() => setAdding(true)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <Plus size={12} /> Add a check
        </button>
      </li>
    );
  }

  const numeric = f.response_type === "NUMERIC";

  return (
    <li className="px-4 pl-9 py-2 space-y-1.5 bg-muted/30">
      <input
        value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}
        placeholder="What is checked — 'Service brake response'"
        className="w-full text-xs px-2 py-1 rounded border border-border bg-background"
      />
      <div className="flex items-center gap-1.5 flex-wrap">
        <select value={f.response_type}
                onChange={(e) => setF({ ...f, response_type: e.target.value as ResponseType })}
                className="text-[11px] px-1.5 py-1 rounded border border-border bg-background">
          {(Object.keys(RESPONSE_LABEL) as ResponseType[]).map((k) => (
            <option key={k} value={k}>{RESPONSE_LABEL[k]}</option>
          ))}
        </select>

        {/* A gauge reading needs a unit — the server refuses one without, since
            it cannot be validated or printed. */}
        {numeric && (
          <>
            <input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}
                   placeholder="unit" size={6}
                   className="text-[11px] px-1.5 py-1 rounded border border-border bg-background w-16" />
            <input value={f.min_value} onChange={(e) => setF({ ...f, min_value: e.target.value })}
                   placeholder="min" inputMode="decimal"
                   className="text-[11px] px-1.5 py-1 rounded border border-border bg-background w-16" />
            <input value={f.max_value} onChange={(e) => setF({ ...f, max_value: e.target.value })}
                   placeholder="max" inputMode="decimal"
                   className="text-[11px] px-1.5 py-1 rounded border border-border bg-background w-16" />
          </>
        )}

        <select value={f.default_severity}
                onChange={(e) => setF({ ...f, default_severity: e.target.value as Severity })}
                className="text-[11px] px-1.5 py-1 rounded border border-border bg-background">
          {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Severity[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label className="flex items-center gap-1 text-[11px]"
               title="A failed answer stops the machine changing hands">
          <input type="checkbox" checked={f.is_critical}
                 onChange={(e) => setF({ ...f, is_critical: e.target.checked })} />
          Blocks the handover
        </label>
        <label className="flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={f.requires_photo_if_not_ok}
                 onChange={(e) => setF({ ...f, requires_photo_if_not_ok: e.target.checked })} />
          Photo if not OK
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          disabled={busy !== null || !f.label.trim()}
          onClick={() => void act("add-item", async () => {
            await api.post(`/hoto/admin/sections/${sectionId}/items`, {
              label: f.label,
              response_type: f.response_type,
              unit: numeric ? f.unit || null : null,
              min_value: numeric && f.min_value !== "" ? Number(f.min_value) : null,
              max_value: numeric && f.max_value !== "" ? Number(f.max_value) : null,
              is_critical: f.is_critical,
              requires_photo_if_not_ok: f.requires_photo_if_not_ok,
              default_severity: f.default_severity,
            });
            setAdding(false);
            setF({ ...f, label: "", unit: "", min_value: "", max_value: "" });
          })}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-foreground text-background disabled:opacity-40"
        >
          <Check size={12} /> Add
        </button>
        <button onClick={() => setAdding(false)}
                className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted">
          Cancel
        </button>
      </div>
    </li>
  );
}
