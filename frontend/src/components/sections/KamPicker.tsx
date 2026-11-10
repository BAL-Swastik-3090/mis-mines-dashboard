"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Search, UserPlus, X } from "lucide-react";
import api from "@/lib/api";

/**
 * Add a KAM, or attach an employee to a name already on the list.
 *
 * THE NAME COMES FROM SAP, NOT FROM A TEXT BOX. The eight names on the list
 * were typed by hand when the loss heads moved out of Python, and five of
 * them do not match any employee record — "Rana Vikash Singh" against
 * RANA VIKASH KUMAR SINGH, "Bijan Kr Chand" against BIJAN KUMAR CHAND. With
 * free text and a growing list, the same person gets added twice in two
 * spellings and ends up owning loss heads as two different people. Picking
 * from the register, and storing the employee id, is what stops that.
 *
 * WITHDRAWN EMPLOYEES ARE NOT OFFERED — 369 of the 1,328 rows are leavers,
 * and a loss head assigned to one is an accountability line nobody answers.
 * Somebody already on the list who later leaves is NOT removed: the months
 * they owned must keep naming them.
 *
 * THE DISPLAY NAME IS EDITABLE BEFORE SAVING, and deliberately. SAP shouts in
 * capitals and carries the full legal name; the matrix says "K L Das". The
 * box is pre-filled with a title-cased SAP name as a starting point, because
 * the mine's own short forms cannot be derived from the register.
 */

interface Employee {
  emp_id: string;
  name: string;
  designation: string | null;
  department: string | null;
  location: string | null;
  already: boolean;
  kam_name: string | null;
}

export default function KamPicker({ mode, linkTo, onClose, onDone }: {
  /** "add" creates a new KAM; "link" attaches an employee to `linkTo`. */
  mode: "add" | "link";
  linkTo?: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Employee[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Employee | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Debounced, because this runs against 1,328 rows on every keystroke
     otherwise. Two characters is the server's own floor — a single letter
     matches hundreds of people and tells nobody anything. */
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setRows([]); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/oee-settings/employees", { params: { q } });
        if (live) setRows(r.data?.employees ?? []);
      } catch {
        if (live) setRows([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [term]);

  function pick(e: Employee) {
    setPicked(e);
    setError(null);
    // Title-case the SAP name as a starting point; the user edits it.
    setName(e.name.split(/\s+/).map((w) =>
      w.length <= 2 ? w.toUpperCase()
        : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" "));
  }

  async function submit() {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      if (mode === "link") {
        await api.patch("/oee-settings/kams",
          { kam_name: linkTo, emp_id: picked.emp_id });
      } else {
        await api.post("/oee-settings/kams",
          { emp_id: picked.emp_id, kam_name: name.trim() });
      }
      await onDone();
      onClose();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail;
      setError(typeof d === "string" ? d
        : "That could not be saved. Check the name is not already in use.");
    } finally { setBusy(false); }
  }

  return (
    <div className="border border-[#90caf9] bg-[#e3f2fd]/50 rounded-md mx-4 mb-2">
      <div className="px-3 py-2 border-b border-[#90caf9] flex items-center gap-2">
        <UserPlus size={13} className="text-[#1565c0]" />
        <span className="text-[11px] font-condensed font-bold tracking-widest
                         uppercase text-[#0d47a1]">
          {mode === "link" ? `Link “${linkTo}” to an employee` : "Add a KAM"}
        </span>
        <button onClick={onClose} aria-label="Close"
                className="ml-auto p-0.5 rounded hover:bg-white/60 text-[#1565c0]">
          <X size={14} />
        </button>
      </div>

      <div className="p-3 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2.5 text-txt-muted" />
          <input
            autoFocus
            value={term}
            onChange={(e) => { setTerm(e.target.value); setPicked(null); }}
            placeholder="Search SAP by name or employee ID — at least 2 characters"
            className="w-full border border-border rounded pl-7 pr-2 py-1.5
                       text-[12px] bg-white"
          />
          {searching && (
            <Loader2 size={13}
              className="absolute right-2 top-2.5 animate-spin text-txt-muted" />
          )}
        </div>

        {!picked && rows.length > 0 && (
          <ul className="max-h-52 overflow-y-auto border border-border rounded bg-white
                         divide-y divide-border-light">
            {rows.map((e) => (
              <li key={e.emp_id}>
                <button
                  type="button"
                  disabled={e.already}
                  onClick={() => pick(e)}
                  title={e.already
                    ? `Already on the KAM list as “${e.kam_name}”`
                    : undefined}
                  className="w-full text-left px-2.5 py-1.5 text-[12px]
                             hover:bg-bg-light disabled:opacity-45
                             disabled:cursor-not-allowed disabled:hover:bg-white"
                >
                  <span className="font-semibold text-navy">{e.name}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-txt-muted">
                    {e.emp_id}
                  </span>
                  {e.already && (
                    <span className="ml-1.5 text-[9px] font-bold uppercase
                                     tracking-widest text-[#c8960c]">
                      on the list
                    </span>
                  )}
                  <span className="block text-[10px] text-txt-light">
                    {[e.designation, e.department].filter(Boolean).join(" · ") || "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!picked && term.trim().length >= 2 && !searching && rows.length === 0 && (
          <p className="text-[11px] text-txt-muted px-1">
            Nobody active matches that. Leavers are not offered.
          </p>
        )}

        {picked && (
          <div className="border border-border rounded bg-white p-2.5 space-y-2">
            <div className="text-[12px]">
              <span className="font-semibold text-navy">{picked.name}</span>
              <span className="ml-1.5 font-mono text-[10px] text-txt-muted">
                {picked.emp_id}
              </span>
              <span className="block text-[10px] text-txt-light">
                {[picked.designation, picked.department].filter(Boolean).join(" · ") || "—"}
              </span>
            </div>

            {mode === "add" && (
              <div>
                <label htmlFor="kam-display"
                  className="block text-[9px] font-condensed font-bold tracking-widest
                             uppercase text-txt-secondary mb-0.5">
                  Name on the matrix
                </label>
                <input
                  id="kam-display"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-border rounded px-2 py-1
                             text-[12px] font-semibold text-navy bg-white"
                />
                <p className="mt-0.5 text-[9px] text-txt-light">
                  Edit it to whatever the mine calls them — the employee ID is
                  what ties this to SAP, not the spelling.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              {error && (
                <p className="text-[11px] text-danger flex items-center gap-1">
                  <AlertTriangle size={12} /> {error}
                </p>
              )}
              <button
                onClick={() => setPicked(null)}
                className="ml-auto px-2.5 py-1 rounded border border-border
                           text-[11px] text-txt-secondary hover:bg-bg-section"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={busy || (mode === "add" && !name.trim())}
                className="px-3 py-1 rounded bg-navy text-white text-[11px]
                           font-semibold disabled:opacity-40
                           disabled:cursor-not-allowed hover:bg-navy/90
                           inline-flex items-center gap-1"
              >
                {busy ? <Loader2 size={12} className="animate-spin" />
                      : <Check size={12} />}
                {mode === "link" ? "Link" : "Add to the list"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
