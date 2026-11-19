"use client";
/**
 * The mining faces: the list the excavation plan picks from.
 *
 * ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
 * The excavation plan has always carried a face NUMBER and, beside it,
 * whatever the person filing typed that day. The master those numbers pointed
 * at was empty, so across 4,151 rows seventeen faces collected a hundred and
 * nine spellings — "North ob", "North OB", "Noth ob", "Nort ob". Any report
 * grouping by the name counted one face several times.
 *
 * Migration 130 built the list from the plan's own rows and gave the plan a
 * foreign key onto it. This is where the mine keeps it right.
 *
 * ── THE NAMES HERE ARE A STARTING POINT, NOT AN ANSWER ──────────────────────
 * Each was seeded with the spelling the mine used most, which is the best a
 * migration can do and is not the same as being correct: "East ore&ob"
 * describes what a face yielded rather than naming it. The screen says so,
 * and the two faces that were seeded with a number appended say it loudest,
 * because the mine's own rows gave them the same name as another face.
 *
 * ── ACTIVE IS ABOUT TOMORROW, NOT ABOUT HISTORY ─────────────────────────────
 * An inactive face keeps every row ever filed against it and simply stops
 * being offered for a new one. Nothing is deleted here: a face that is worked
 * out is part of the record of how the pit was mined.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, Loader2, Mountain, Pencil, X,
} from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Card, Chip } from "@/components/minehub/ui";
import Toast from "@/components/minehub/Toast";

interface Face {
  face_no: number;
  name: string;
  face_kind: string;
  bench_rl: string | null;
  status: string;
  note: string | null;
  updated_by: string | null;
  updated_at: string | null;
  revision: number;
  last_planned: string | null;
  rows_planned: number;
}

const KIND_LABEL: Record<string, string> = {
  ORE: "Ore", OB: "Overburden", ORE_OB: "Ore + OB",
  DUMP: "Dump", OTHER: "Other",
};
const KIND_TONE: Record<string, string> = {
  ORE: "bg-emerald-bg text-emerald ring-emerald-ring",
  OB: "bg-amber-bg text-amber ring-amber-ring",
  ORE_OB: "bg-sky-bg text-sky ring-sky-ring",
  DUMP: "bg-slate-bg text-slate ring-slate-ring",
  OTHER: "bg-slate-bg text-slate ring-slate-ring",
};

export default function MineFacesSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Face>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    count: number; faces: Face[]; kinds: string[]; may_edit: boolean;
  }>({
    queryKey: ["mine-faces"],
    queryFn: async () => (await api.get("/plan-entry/faces/list")).data,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: async (f: Partial<Face>) =>
      (await api.put("/plan-entry/faces/save", f)).data,
    onSuccess: (res) => {
      setEditing(null);
      setNotice(`Face ${res.face_no} saved as “${res.name}”.`);
      void qc.invalidateQueries({ queryKey: ["mine-faces"] });
      // The excavation plan shows these names.
      void qc.invalidateQueries({ queryKey: ["plan-entry", "excavation"] });
    },
    onError: (e: unknown) => {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That face could not be saved.");
    },
  });

  const faces = data?.faces ?? [];
  const active = useMemo(() => faces.filter((f) => f.status === "ACTIVE"), [faces]);
  const retired = useMemo(() => faces.filter((f) => f.status !== "ACTIVE"), [faces]);
  /** Seeded with a number appended because another face had the same name. */
  const ambiguous = useMemo(
    () => faces.filter((f) => /\(face \d+\)$/.test(f.name)), [faces]);

  const begin = (f: Face) => { setError(null); setEditing(f.face_no); setDraft({ ...f }); };

  const row = (f: Face) => {
    const isEdit = editing === f.face_no;
    return (
      <tr key={f.face_no} className={isEdit ? "bg-amber-bg/40" : "even:bg-bg-light"}>
        <td className="px-3 py-1.5 border-b border-border-light font-mono text-[11.5px]
                       text-txt-muted whitespace-nowrap">{f.face_no}</td>
        <td className="px-3 py-1.5 border-b border-border-light">
          {isEdit ? (
            <input
              autoFocus
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-[220px] bg-bg-base border border-border rounded px-2 py-1
                         text-[12.5px] focus:outline-none focus:ring-1 focus:ring-navy"
            />
          ) : (
            <span className="font-semibold text-navy text-[12.5px]">{f.name}</span>
          )}
        </td>
        <td className="px-3 py-1.5 border-b border-border-light">
          {isEdit ? (
            <select
              value={draft.face_kind ?? "ORE_OB"}
              onChange={(e) => setDraft({ ...draft, face_kind: e.target.value })}
              className="bg-bg-base border border-border rounded px-2 py-1 text-[12px]"
            >
              {(data?.kinds ?? []).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
              ))}
            </select>
          ) : (
            <span className={`inline-flex rounded-[3px] px-1.5 py-px text-[10px]
                              font-bold uppercase tracking-wide ring-1 ring-inset
                              ${KIND_TONE[f.face_kind] ?? KIND_TONE.OTHER}`}>
              {KIND_LABEL[f.face_kind] ?? f.face_kind}
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 border-b border-border-light text-[12px] text-txt-muted">
          {isEdit ? (
            <input
              value={draft.bench_rl ?? ""}
              placeholder="40-64 MRL"
              onChange={(e) => setDraft({ ...draft, bench_rl: e.target.value })}
              className="w-[130px] bg-bg-base border border-border rounded px-2 py-1
                         text-[12px] focus:outline-none focus:ring-1 focus:ring-navy"
            />
          ) : (f.bench_rl || "—")}
        </td>
        <td className="px-3 py-1.5 border-b border-border-light">
          {isEdit ? (
            <select
              value={draft.status ?? "ACTIVE"}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              className="bg-bg-base border border-border rounded px-2 py-1 text-[12px]"
            >
              <option value="ACTIVE">Working</option>
              <option value="INACTIVE">Not worked</option>
            </select>
          ) : (
            <Chip tone={f.status === "ACTIVE" ? "emerald" : "slate"} dot={false}>
              {f.status === "ACTIVE" ? "working" : "not worked"}
            </Chip>
          )}
        </td>
        <td className="px-3 py-1.5 border-b border-border-light text-[11.5px]
                       text-txt-muted whitespace-nowrap tabular-nums">
          {f.last_planned ?? "never"}
          <span className="ml-2 text-txt-light">{f.rows_planned.toLocaleString("en-IN")} rows</span>
        </td>
        <td className="px-3 py-1.5 border-b border-border-light whitespace-nowrap">
          {!data?.may_edit ? null : isEdit ? (
            <span className="flex gap-1.5">
              <Button size="sm" disabled={save.isPending}
                      onClick={() => save.mutate(draft)}>
                {save.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Check className="w-3.5 h-3.5" />} Save
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </span>
          ) : (
            <button onClick={() => begin(f)}
                    className="text-txt-light hover:text-navy" title="Rename or retire">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </td>
      </tr>
    );
  };

  const head = (
    <thead>
      <tr className="bg-bg-section">
        {["Face #", "Name", "Yields", "Bench", "Status", "Last planned", ""].map((h) => (
          <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold
                                 text-txt-secondary border-b border-border whitespace-nowrap">
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="space-y-3">
      {ambiguous.length > 0 && (
        <Alert tone="warning">
          <span className="font-semibold">
            {ambiguous.length} face{ambiguous.length === 1 ? "" : "s"} could not be
            named from the filed rows.
          </span>{" "}
          {ambiguous.map((f) => `#${f.face_no}`).join(" and ")} were given the same
          name as another face by whoever filed them, so the number was appended to
          tell them apart. They are different places — the mine should say what each
          is called.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <div className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2
                        border-b border-border-light">
          <span
            title={
              "The list the excavation plan picks from.\n\n"
              + "Names were seeded from the spelling the mine used most in the "
              + "filed rows, because the master these numbers pointed at was "
              + "empty — seventeen faces had collected a hundred and nine "
              + "spellings between them.\n\n"
              + "A face that is not worked any more is marked so, which keeps "
              + "its history and stops it being offered for tomorrow. Nothing "
              + "here is ever deleted."
            }
            className="shrink-0 w-7 h-7 rounded-lg bg-slate-bg ring-1 ring-slate-ring
                       flex items-center justify-center cursor-help"
          >
            <Mountain className="w-3.5 h-3.5 text-slate" />
          </span>
          <span className="font-semibold text-[13px] text-navy">Mining Faces</span>
          <span className="text-txt-light">·</span>
          <span className="text-[11.5px] text-txt-muted">
            {isLoading ? "reading…"
              : `${active.length} working, ${retired.length} no longer worked`}
          </span>
          {!data?.may_edit && !isLoading && (
            <Chip tone="slate" dot={false}>read only</Chip>
          )}
        </div>

        <table className="w-full text-[12px] border-collapse">
          {head}
          <tbody>
            {active.map(row)}
            {retired.length > 0 && (
              <tr>
                <td colSpan={7}
                    className="px-3 py-1.5 bg-slate-bg/60 border-y border-border
                               text-[10px] font-bold uppercase tracking-wider text-txt-light">
                  No longer worked · kept so their history still reads
                </td>
              </tr>
            )}
            {retired.map(row)}
          </tbody>
        </table>

        <p className="px-4 py-2.5 text-[11.5px] text-txt-light border-t border-border-light
                      flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          The face number is what every filed row refers to and cannot be changed.
          Renaming a face renames it everywhere, including on plans already filed —
          which is the point, because the name is a label and the number is the
          identity.
        </p>
      </Card>

      <Toast tone="success" message={notice} onClose={() => setNotice(null)} />
    </div>
  );
}
