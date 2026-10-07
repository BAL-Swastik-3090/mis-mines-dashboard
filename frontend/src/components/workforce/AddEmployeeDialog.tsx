"use client";
/**
 * Put a company employee on the roster.
 *
 * WHY THIS EXISTS. Everything on the roster hangs off the operator register,
 * which was built for the people who drive the machines. The mine's own staff
 * — the Mine Foremen, Mining Mates and Asst Managers who actually run the
 * shifts — were in the platform but had no row in that register, so the roster
 * could not place them. The only way to add one was to run an import script.
 *
 * WHAT IT SEARCHES. The company's employee master, not our own registry. The
 * whole point is to find somebody who is NOT here yet, and a list of the people
 * we already have cannot do that. Each row says which of three states it is in,
 * because that is the only thing that decides what to offer:
 *
 *   on the roster  — already placeable; nothing to do
 *   known here     — we hold the person, but not the row that places them
 *   new            — not in the platform at all
 *
 * THE NUMBER IS THE IDENTITY. Rows are keyed on the employee number the whole
 * way through, never the spelling. The sheet that prompted this work writes
 * "RANA BIKASH SINGH" where the company master says "RANA VIKASH KUMAR SINGH"
 * — 80% alike, below any threshold worth trusting — and they are one man who
 * was already on file. Matching on the name would have made a second one.
 */
import { useCallback, useEffect, useState } from "react";
import { Search, UserPlus, Loader2, Check } from "lucide-react";

import Dialog from "@/components/minehub/Dialog";
import api from "@/lib/api";

interface Row {
  emp_id: string;
  name: string;
  department: string | null;
  designation: string | null;
  employment: string;
  party_id: number | null;
  operator_id: number | null;
  state: "ON_ROSTER" | "KNOWN" | "NEW";
}

const STATE_LABEL: Record<Row["state"], string> = {
  ON_ROSTER: "on the roster",
  KNOWN: "known here",
  NEW: "new",
};

const STATE_TONE: Record<Row["state"], string> = {
  ON_ROSTER: "bg-emerald/10 text-emerald",
  KNOWN: "bg-sky/10 text-sky",
  NEW: "bg-bg-section text-txt-muted",
};

export default function AddEmployeeDialog({
  open, onClose, onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded?: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get("/workforce/employees/search", {
        params: { q: term },
      });
      setRows(r.data ?? []);
    } catch {
      setError("Could not read the employee master.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Typing settles before asking: the master is 1,259 rows and a keystroke is
  // not a question.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void search(q), 250);
    return () => clearTimeout(t);
  }, [q, open, search]);

  useEffect(() => {
    if (!open) {
      setQ(""); setRows([]); setPicked(new Set()); setError(null);
    }
  }, [open]);

  const toggle = (r: Row) => {
    if (r.state === "ON_ROSTER") return;      // nothing to add
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(r.emp_id)) next.delete(r.emp_id);
      else next.add(r.emp_id);
      return next;
    });
  };

  const add = async () => {
    if (!picked.size) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/workforce/employees", {
        emp_ids: Array.from(picked),
      });
      const added: string[] = r.data?.added ?? [];
      const reused: string[] = r.data?.reused ?? [];
      const n = added.length + reused.length;
      onAdded?.(
        `${n} ${n === 1 ? "person" : "people"} can now be put on the roster`
        + (added.length ? ` · ${added.length} newly registered` : "")
        + ".");
      onClose();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Could not add them. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      tone="info"
      width={720}
      title="Put an employee on the roster"
      confirmLabel={picked.size ? `Add ${picked.size}` : "Add"}
      cancelLabel="Close"
      busy={busy}
      onConfirm={() => void add()}
      onCancel={onClose}
    >
      <div className="space-y-3">
        <p className="text-[11.5px] text-txt-muted leading-relaxed">
          Search the company employee master by name or employee number. Adding
          somebody here does not put them on a shift — it makes the roster able
          to place them, after which they appear in the board like anyone else.
        </p>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5
                             text-txt-light pointer-events-none" />
          <input
            id="add-employee-search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or employee number…"
            className="w-full rounded-lg border border-border-light bg-white
                       pl-8 pr-3 py-2 text-[12.5px] text-txt-primary
                       placeholder:text-txt-light focus:outline-none
                       focus:ring-2 focus:ring-gold/40"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-rose/10 px-3 py-2 text-[11.5px] text-rose">
            {error}
          </div>
        )}

        <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border-light">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-6 text-[12px] text-txt-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking…
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-txt-muted">
              {q.trim()
                ? "Nobody in the employee master matches that."
                : "Start typing a name or an employee number."}
            </div>
          )}

          {!loading && rows.map((r) => {
            const on = r.state === "ON_ROSTER";
            const sel = picked.has(r.emp_id);
            return (
              <button
                key={r.emp_id}
                type="button"
                onClick={() => toggle(r)}
                disabled={on}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left
                            border-b border-border-light/60 last:border-0 transition
                            ${on ? "opacity-55 cursor-default"
                                 : "hover:bg-bg-section cursor-pointer"}
                            ${sel ? "bg-gold/10" : ""}`}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center
                                  shrink-0 ${sel ? "bg-gold border-gold"
                                                 : "border-border-light bg-white"}`}>
                  {sel && <Check className="w-3 h-3 text-white" />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold text-txt-primary truncate">
                    {r.name}
                  </span>
                  <span className="block text-[10.5px] text-txt-muted truncate">
                    {r.emp_id}
                    {r.designation ? ` · ${r.designation}` : ""}
                    {r.department ? ` · ${r.department}` : ""}
                  </span>
                </span>

                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px]
                                  font-semibold uppercase tracking-wide
                                  ${STATE_TONE[r.state]}`}>
                  {STATE_LABEL[r.state]}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[10.5px] text-txt-light leading-relaxed">
          <UserPlus className="inline w-3 h-3 -mt-0.5" /> People marked{" "}
          <strong>on the roster</strong> are already placeable and cannot be
          added twice. Matching is on the employee number, so a name spelled
          differently here and in SAP is still one person.
        </p>
      </div>
    </Dialog>
  );
}
