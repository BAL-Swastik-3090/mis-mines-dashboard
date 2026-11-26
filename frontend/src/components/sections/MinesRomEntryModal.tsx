"use client";
/**
 * Entry Daywise ROM — what was dug, from where, and how it assayed.
 *
 * ONE ROW IS ONE SAMPLE, not one day. A day is several rows: a shift, a
 * location, the tonnage off it and the assay of that tonnage. The totals line
 * at the foot is the sheet's TOTAL QTY and "WET & AVG.", and it is computed
 * from the rows rather than typed — as is the Cr/Fe ratio in every row.
 *
 * TWO HALVES, TWO SUBMITS. Production files the left half and submits;
 * Geology fills Block Model and submits. Whoever holds only one permission
 * sees the other half read-only and gets the one button that is theirs.
 * Whoever holds both gets a single Submit that does the production save first
 * and then the block save — in that order, because a new row has no id to
 * hang a block model on until it has been written.
 *
 * NOTHING BEFORE NOVEMBER 2026 HAS A BLOCK MODEL, by the mine's own account.
 * So an empty block half on an older day is correct and is shown as "—",
 * never as a gap to be filled in.
 *
 * THE LOCATION IS A LIST, AND THE LIST GROWS FROM HERE. The workbook this
 * replaces collected eighty-five spellings of about twenty places because the
 * column was free text. A dropdown alone would just move the problem to
 * whoever needed a face that was not on it, so adding one is part of the
 * form — and the server folds case, so a second "PIT BOTTOM" comes back as
 * the existing "Pit Bottom" instead of becoming spelling eighty-six.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  X, Save, Loader2, AlertTriangle, Plus, Trash2, Hammer, Check,
} from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { dayLabel, todayISO } from "@/lib/prevDay";
import DateField from "@/components/minehub/DateField";
import FormShell from "@/components/ui/FormShell";

const SHIFTS = ["A", "B", "C"] as const;

/** The dropdown's last option. A sentinel rather than a number, so it can
 *  never collide with a real location_id. */
const ADD_NEW = "__add__";

/** Mass fraction of Cr in Cr2O3, and of Fe in FeO. Constants of chemistry,
 *  and the same two the server uses — see services/rom_entry.py. The screen
 *  computes the ratio as you type so the figure is never a surprise after
 *  saving; the server computes it again on read, and they cannot disagree
 *  because neither of them stores it. */
const CR_IN_CR2O3 = 0.6843;
const FE_IN_FEO = 0.7773;

type Loc = { location_id: number; name: string; is_active: boolean; in_use: number };

type ApiRow = {
  rom_id: number; on_date: string; shift: string;
  location_id: number; location: string;
  trips: number | null; qty_mt: number | null;
  moisture_pct: number | null; cr2o3_pct: number | null; feo_pct: number | null;
  block_mrl: string | null; block_cr2o3_pct: number | null;
  block_entry_id: string | null; block_entry_date: string | null;
  rom_entry_id: string; ratio: number | null; awaiting_block: boolean;
};

type DayResponse = {
  on_date: string; exists: boolean; rows: ApiRow[];
  summary: {
    samples: number; trips: number | null; qty_mt: number;
    moisture_pct: number | null; cr2o3_pct: number | null;
    feo_pct: number | null; ratio: number | null;
    block_cr2o3_pct: number | null; block_variance: number | null;
    awaiting_block: number;
  };
  may_edit: boolean; may_edit_block: boolean; may_delete: boolean;
};

/** A row as the form holds it: everything a string, because a half-typed
 *  "4." is not a number and must not be rounded into one while the cursor is
 *  still in the box. */
type Draft = {
  key: string;
  rom_id: number | null;
  shift: string;
  location_id: string;
  trips: string;
  qty_mt: string;
  moisture_pct: string;
  cr2o3_pct: string;
  feo_pct: string;
  block_mrl: string;
  block_cr2o3_pct: string;
  block_owner: string | null;
};

let seq = 0;
const blankRow = (): Draft => ({
  key: `new-${++seq}`, rom_id: null, shift: "A", location_id: "",
  trips: "", qty_mt: "", moisture_pct: "", cr2o3_pct: "", feo_pct: "",
  block_mrl: "", block_cr2o3_pct: "", block_owner: null,
});

const toDraft = (r: ApiRow): Draft => ({
  key: `row-${r.rom_id}`,
  rom_id: r.rom_id,
  shift: r.shift,
  location_id: String(r.location_id),
  trips: r.trips == null ? "" : String(r.trips),
  qty_mt: r.qty_mt == null ? "" : String(r.qty_mt),
  moisture_pct: r.moisture_pct == null ? "" : String(r.moisture_pct),
  cr2o3_pct: r.cr2o3_pct == null ? "" : String(r.cr2o3_pct),
  feo_pct: r.feo_pct == null ? "" : String(r.feo_pct),
  block_mrl: r.block_mrl == null ? "" : String(r.block_mrl),
  block_cr2o3_pct: r.block_cr2o3_pct == null ? "" : String(r.block_cr2o3_pct),
  block_owner: r.block_entry_id,
});

function num(v: string | undefined): number | null {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const filled = (v: string | undefined) => String(v ?? "").trim() !== "";
/* badMrl() USED TO LIVE HERE and refused anything that was not a number or a
   span of two. The mine asked on 26 November 2026 for the box to take what
   Geology actually writes -- '>80', 'below 27' -- so there is nothing left to
   check: any text is a bench if the survey says it is. Migration 136 drops the
   matching CHECK constraints on mines_rom_entry and mines_rom_stack_line, and
   the server now only collapses whitespace.

   What went with it is the transposition catch: '82-80' is a bench written
   backwards and the database used to refuse it. Free text cannot keep that --
   '>80' has no two sides to compare. */

function bad(v: string | undefined, hi?: number): boolean {
  if (!filled(v)) return false;
  const n = num(v);
  if (n === null || n < 0) return true;
  return hi !== undefined && n > hi;
}

function ratioOf(cr: number | null, fe: number | null): number | null {
  if (cr === null || fe === null || fe <= 0) return null;
  return (cr * CR_IN_CR2O3) / (fe * FE_IN_FEO);
}

const TH =
  "px-2 py-1.5 text-[10px] font-extrabold tracking-[.08em] text-txt-secondary uppercase";
const BOX =
  "w-full px-1.5 py-1 text-[12px] font-mono tabular-nums text-right rounded " +
  "border border-border focus:border-accent focus:outline-none " +
  "focus:ring-1 focus:ring-accent/40 disabled:bg-bg-section " +
  "disabled:text-txt-light disabled:cursor-not-allowed";
const SEL =
  "w-full px-1.5 py-1 text-[12px] rounded border border-border " +
  "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 " +
  "disabled:bg-bg-section disabled:text-txt-light";

/** The mark on a column that will not let the day be filed without it.
    Only the seven ROM columns carry it; the two tinted Block Model boxes are
    Geology's and are allowed to be empty, so the mark is what says which is
    which before anybody presses Submit rather than after. aria-hidden because
    the message under the table already names the row and the field. */
function Req() {
  return <span className="text-danger font-bold ml-0.5" aria-hidden>*</span>;
}

function Fig({ v, dp = 2, strong }: { v: number | null; dp?: number; strong?: boolean }) {
  return (
    <span className={`text-[12px] font-mono tabular-nums ${
      strong ? "font-extrabold text-navy" : "text-txt-primary"}`}>
      {v == null ? <span className="text-txt-light/50">—</span>
        : formatIndian(Number(v.toFixed(dp)), dp)}
    </span>
  );
}

export default function MinesRomEntryModal({
  open, onClose, onSaved, inline,
}: {
  open: boolean;
  /** True on its own screen under Daily Entry Hub: no backdrop, no
   *  click-to-dismiss, no close button. See FormShell. */
  inline?: boolean;
  onClose: () => void;
  onSaved: (day: string) => void | Promise<void>;
}) {
  const [day, setDay] = useState(todayISO);
  const [rows, setRows] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The row that asked for a new location. The ask comes from the dropdown
  // itself, so the answer has to go back to the row the person was filling —
  // they are mid-row when they discover the list is short.
  const [newLocFor, setNewLocFor] = useState<string | null>(null);
  const [newLoc, setNewLoc] = useState("");
  const [addingLoc, setAddingLoc] = useState(false);
  const maxDay = todayISO();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone(null);
    setNewLocFor(null);
    setNewLoc("");
  }, [open]);

  const locs = useQuery<{ locations: Loc[]; mrls?: string[] }>({
    queryKey: ["rom-locations"],
    queryFn: async () => (await api.get("/rom-entry/locations")).data,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const dayQ = useQuery<DayResponse>({
    queryKey: ["rom-day", day],
    queryFn: async () =>
      (await api.get("/rom-entry/day", { params: { on_date: day } })).data,
    enabled: open && Boolean(day),
    staleTime: 30 * 1000,
  });

  const mayEdit = dayQ.data?.may_edit ?? false;
  const mayBlock = dayQ.data?.may_edit_block ?? false;

  // Reloaded whenever the date moves, so one day's typing never lands on
  // another day's date. A day with nothing on it opens with a single blank
  // line rather than an empty grid and no obvious way in.
  useEffect(() => {
    if (!open || !day || !dayQ.data) return;
    setRows(dayQ.data.rows.length
      ? dayQ.data.rows.map(toDraft)
      : (dayQ.data.may_edit ? [blankRow()] : []));
  }, [open, day, dayQ.data]);

  const set = (key: string, field: keyof Draft, v: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: v } : r)));

  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const dropRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  async function addLocation(forKey: string) {
    const name = newLoc.trim();
    if (!name) return;
    setAddingLoc(true);
    setError(null);
    try {
      const res = await api.post("/rom-entry/locations", { name });
      await locs.refetch();
      // Selected on the row that asked for it — whether it was created just
      // now or already existed under another spelling. The server answers a
      // duplicate with the existing row rather than an error, and quietly
      // selecting it is the whole point of that.
      setRows((rs) => rs.map((r) => (r.key === forKey
        ? { ...r, location_id: String(res.data.location_id) } : r)));
      setNewLocFor(null);
      setNewLoc("");
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "The location could not be added.");
    } finally {
      setAddingLoc(false);
    }
  }

  // ── what the day adds up to ───────────────────────────────────────────────
  const totals = useMemo(() => {
    const live = rows.map((r) => ({
      q: num(r.qty_mt), t: num(r.trips), m: num(r.moisture_pct),
      c: num(r.cr2o3_pct), f: num(r.feo_pct), b: num(r.block_cr2o3_pct),
    }));
    const qty = live.reduce((s, r) => s + (r.q ?? 0), 0);
    const trips = live.reduce((s, r) => s + (r.t ?? 0), 0);
    // Rows missing a figure are left out of BOTH sides. Counting their
    // tonnage in the denominator would drag the mean towards nought in
    // proportion to how much was never measured, which reads as a poor grade
    // rather than as a partial one.
    const w = (pick: (x: typeof live[number]) => number | null) => {
      let n = 0, d = 0;
      for (const r of live) {
        const v = pick(r);
        if (v === null || r.q === null) continue;
        n += v * r.q; d += r.q;
      }
      return d > 0 ? n / d : null;
    };
    const cr = w((r) => r.c), fe = w((r) => r.f), blk = w((r) => r.b);
    return {
      qty, trips: trips || null, moisture: w((r) => r.m), cr2o3: cr, feo: fe,
      // From the weighted assays, never a mean of the rows' own ratios: a mean
      // of ratios is not the ratio of the means, and the sheet's own
      // WET & AVG. line takes it this way.
      ratio: ratioOf(cr, fe),
      block: blk,
      variance: cr !== null && blk !== null ? cr - blk : null,
      awaiting: rows.filter((r) => !filled(r.block_cr2o3_pct)).length,
    };
  }, [rows]);

  // ── what is not fit to send ───────────────────────────────────────────────
  const romProblem = useMemo(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const at = `Row ${i + 1}`;
      // EVERY ROM BOX IS REQUIRED, at the mine's instruction (24 Nov 2026).
      // Only the two tinted Block Model boxes may be left empty, because they
      // are Geology's and arrive later -- blockProblem below is what governs
      // those. The rule is enforced in the router too: this check is the
      // sentence the user reads, not the thing that keeps a half-row out of
      // the table.
      if (!r.shift) return `${at}: pick a shift.`;
      if (!r.location_id) return `${at}: pick a location.`;
      if (!filled(r.trips)) return `${at}: trips is needed.`;
      if (!filled(r.qty_mt)) return `${at}: tonnage is needed.`;
      // Moisture joins the required set now that migration 134 records where
      // each figure came from: a blank typed here is no longer "not measured
      // yet" but a gap nobody can later tell apart from a real zero.
      if (!filled(r.moisture_pct)) return `${at}: moisture is needed.`;
      if (!filled(r.cr2o3_pct) || !filled(r.feo_pct))
        return `${at}: Cr₂O₃% and FeO% are both needed.`;
      if (bad(r.qty_mt)) return `${at}: tonnage is not a valid number.`;
      if (bad(r.trips)) return `${at}: trips is not a valid number.`;
      if (bad(r.moisture_pct, 100)) return `${at}: moisture must be 0–100.`;
      if (bad(r.cr2o3_pct, 100)) return `${at}: Cr₂O₃% must be 0–100.`;
      if (bad(r.feo_pct, 100)) return `${at}: FeO% must be 0–100.`;
    }
    return null;
  }, [rows]);

  const blockProblem = useMemo(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const hasM = filled(r.block_mrl), hasC = filled(r.block_cr2o3_pct);
      if (hasM !== hasC)
        return `Row ${i + 1}: a block model needs both the mRL and the `
          + `Cr₂O₃%. Leave both empty to clear it.`;
      if (bad(r.block_cr2o3_pct, 100))
        return `Row ${i + 1}: block Cr₂O₃% must be 0–100.`;
    }
    return null;
  }, [rows]);

  // A row removed on screen that Geology has already filled is refused by the
  // server, so it is said here first rather than after a failed save.
  const droppingFilled = useMemo(() => {
    const kept = new Set(rows.map((r) => r.rom_id).filter(Boolean));
    return (dayQ.data?.rows ?? [])
      .filter((r) => !kept.has(r.rom_id) && r.block_cr2o3_pct !== null).length;
  }, [rows, dayQ.data]);

  const futureDay = day > maxDay;

  // ── saving ────────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      let savedRows = rows;
      if (mayEdit) {
        await api.put("/rom-entry/day", {
          on_date: day,
          rows: rows.map((r) => ({
            rom_id: r.rom_id,
            shift: r.shift,
            location_id: Number(r.location_id),
            trips: num(r.trips),
            qty_mt: num(r.qty_mt),
            moisture_pct: num(r.moisture_pct),
            cr2o3_pct: num(r.cr2o3_pct),
            feo_pct: num(r.feo_pct),
          })),
        });
        // NEW ROWS HAVE NO ID UNTIL THEY ARE WRITTEN, and a block model has
        // nothing to hang on without one. So the day is re-read between the
        // two saves and the block values are carried across by position.
        if (mayBlock) {
          const fresh = (await api.get("/rom-entry/day",
            { params: { on_date: day } })).data as DayResponse;
          savedRows = rows.map((r, i) => ({
            ...r, rom_id: r.rom_id ?? fresh.rows[i]?.rom_id ?? null,
          }));
        }
      }
      if (mayBlock) {
        const payload = savedRows
          .filter((r) => r.rom_id)
          .map((r) => ({
            rom_id: r.rom_id,
            block_mrl: r.block_mrl.trim() || null,
            block_cr2o3_pct: num(r.block_cr2o3_pct),
          }));
        if (payload.length) await api.put("/rom-entry/block", { rows: payload });
      }
      await onSaved(day);
      await dayQ.refetch();
      setDone(mayEdit && mayBlock ? "Day and block model submitted"
        : mayEdit ? "ROM entry submitted" : "Block model submitted");
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Could not save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [rows, day, mayEdit, mayBlock, onSaved, dayQ]);

  /* NEITHER OF THESE APPLIES INLINE, and both would be bugs there.
     Escape means "put back what I was covering", and inline there is nothing
     covered -- it would silently throw away a half-typed form. And the scroll
     lock is held on document.body so the page BEHIND a dialog cannot move;
     inline that body is the page the form itself sits on, so a form taller
     than the window could not be scrolled to its own Submit button. */
  useEffect(() => {
    if (!open || inline) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, inline, onClose]);

  if (!open) return null;

  const options = (locs.data?.locations ?? []);
  const problem = (mayEdit ? romProblem : null) ?? (mayBlock ? blockProblem : null);
  const nothingToDo = !mayEdit && !mayBlock;
  const label = mayEdit && mayBlock ? "Submit"
    : mayEdit ? "Submit ROM Entry" : "Submit Block Model";

  return (
    <FormShell inline={inline} maxW="max-w-6xl"
               label="Enter day-wise ROM" onClose={onClose}>
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Hammer size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Entry Daywise ROM
          </span>
          {!inline && (<button onClick={onClose} aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors">
            <X size={16} />
          </button>)}
        </div>

        {/* ── which day ──────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-center gap-2 flex-wrap">
          <label htmlFor="rom-date" className={TH.replace("px-2 py-1.5 ", "")}>
            Date of Prd.
          </label>
          <DateField id="rom-date" value={day} max={maxDay} onChange={setDay}
                     className="w-[140px]" />
          <span className="text-[11px] text-txt-muted">{dayLabel(day)}</span>
          {(dayQ.isFetching || locs.isFetching) && (
            <Loader2 size={12} className="animate-spin text-txt-light" />
          )}
          {futureDay && (
            <span className="text-[11px] font-semibold text-danger">
              A day that has not happened cannot be filed
            </span>
          )}
          {/* WHICH HALF IS YOURS, said once and plainly. The two look almost
              identical on screen and have very different consequences. */}
          <span className="ml-auto text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded
                           bg-bg-section text-txt-muted border border-border">
            {mayEdit && mayBlock ? "ROM + Block Model"
              : mayEdit ? "ROM entry" : mayBlock ? "Block model only" : "Read only"}
          </span>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-x-auto">
          {/* ONE LIST FOR EVERY ROW. A datalist is referenced by id, so the
              rows share this rather than each rendering its own copy of the
              same sixty options. Commonest bench first, as the server sends
              it -- browsers keep datalist order, and the one or two benches
              being worked this month are what somebody is reaching for. */}
          <datalist id="rom-mrl-list">
            {(locs.data?.mrls ?? []).map((m) => <option key={m} value={m} />)}
          </datalist>

          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} text-left`} rowSpan={2}>Shift<Req /></th>
                <th className={`${TH} text-left min-w-[150px]`} rowSpan={2}>Location<Req /></th>
                <th className={`${TH} text-right w-[80px]`} rowSpan={2}>Trips<Req /></th>
                <th className={`${TH} text-right w-[110px]`} rowSpan={2}>Total Qty<Req /></th>
                {/* The block pair is tinted as one group, because it is one
                    person's work and arrives after everything to its left. */}
                <th className={`${TH} text-center bg-amber-50 border-x border-amber-200`}
                    colSpan={2}>Block Model</th>
                <th className={`${TH} text-right w-[90px]`} rowSpan={2}>%Moisture<Req /></th>
                <th className={`${TH} text-right w-[95px]`} rowSpan={2}>Cr<sub>2</sub>O<sub>3</sub>%<Req /></th>
                <th className={`${TH} text-right w-[95px]`} rowSpan={2}>FeO%<Req /></th>
                <th className={`${TH} text-right w-[80px]`} rowSpan={2}>Ratio</th>
                <th className={`${TH} w-[1%]`} rowSpan={2} />
              </tr>
              <tr>
                <th className={`${TH} text-right w-[80px] bg-amber-50 border-l border-amber-200`}>mRL</th>
                <th className={`${TH} text-right w-[95px] bg-amber-50 border-r border-amber-200`}>
                  Cr<sub>2</sub>O<sub>3</sub>%
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const live = ratioOf(num(r.cr2o3_pct), num(r.feo_pct));
                return (
                  <tr key={r.key} className="border-t border-border-light/70">
                    <td className="py-1.5 pr-1 w-[70px]">
                      <select className={SEL} disabled={!mayEdit} value={r.shift}
                              aria-label="Shift"
                              onChange={(e) => set(r.key, "shift", e.target.value)}>
                        {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-1">
                      {/* ADDING A LOCATION IS AN OPTION IN THE LIST, not a
                          button beside it. The moment somebody needs a face
                          that is not on the list is the moment they have the
                          list open; anywhere else to put it is somewhere they
                          have to go looking, and going looking is how a free
                          text column gets re-invented. */}
                      {newLocFor === r.key ? (
                        <span className="flex items-center gap-1">
                          <input autoFocus value={newLoc}
                                 placeholder="Name of the face"
                                 aria-label="New location name"
                                 onChange={(e) => setNewLoc(e.target.value)}
                                 onKeyDown={(e) => {
                                   if (e.key === "Enter") void addLocation(r.key);
                                   if (e.key === "Escape") {
                                     setNewLocFor(null); setNewLoc("");
                                   }
                                 }}
                                 className="flex-1 min-w-0 px-1.5 py-1 text-[12px] rounded
                                   border border-accent focus:outline-none
                                   focus:ring-1 focus:ring-accent/40" />
                          <button onClick={() => void addLocation(r.key)}
                                  disabled={addingLoc || !newLoc.trim()}
                                  aria-label="Save location"
                                  className="p-1 rounded text-accent hover:bg-bg-section disabled:opacity-40">
                            {addingLoc ? <Loader2 size={13} className="animate-spin" />
                              : <Check size={13} />}
                          </button>
                          <button onClick={() => { setNewLocFor(null); setNewLoc(""); }}
                                  aria-label="Cancel"
                                  className="p-1 rounded text-txt-light hover:bg-bg-section">
                            <X size={13} />
                          </button>
                        </span>
                      ) : (
                        <select className={SEL} disabled={!mayEdit}
                                aria-label="Location"
                                value={r.location_id}
                                onChange={(e) => {
                                  if (e.target.value === ADD_NEW) {
                                    setNewLoc("");
                                    setNewLocFor(r.key);
                                    return;   // the row keeps the location it had
                                  }
                                  set(r.key, "location_id", e.target.value);
                                }}>
                          <option value="">Select…</option>
                          {options.map((l) => (
                            <option key={l.location_id} value={l.location_id}>{l.name}</option>
                          ))}
                          {mayEdit && <option value={ADD_NEW}>+ Add location…</option>}
                        </select>
                      )}
                    </td>
                    <td className="py-1.5 pr-1">
                      <input className={BOX} inputMode="decimal" disabled={!mayEdit}
                             aria-label="Trips" value={r.trips}
                             onChange={(e) => set(r.key, "trips", e.target.value)} />
                    </td>
                    <td className="py-1.5 pr-1">
                      <input className={BOX} inputMode="decimal" disabled={!mayEdit}
                             aria-label="Total quantity" value={r.qty_mt}
                             onChange={(e) => set(r.key, "qty_mt", e.target.value)} />
                    </td>
                    <td className="py-1.5 px-1 bg-amber-50/60 border-l border-amber-200">
                      {/* TYPE ANYTHING, OR PICK ONE ALREADY USED.
                          A datalist rather than a <select>, because the two
                          requests the mine made pull opposite ways: the box
                          must take whatever the survey says, AND it should
                          offer what has been typed before. A dropdown can
                          only do the second, and a plain box only the first.

                          The list is a convenience, never a constraint --
                          nothing here checks that what was typed is on it. */}
                      <input className={BOX} disabled={!mayBlock}
                             list="rom-mrl-list"
                             aria-label="Block model mRL" placeholder="80, 80-82 or >80"
                             value={r.block_mrl}
                             onChange={(e) => set(r.key, "block_mrl", e.target.value)} />
                    </td>
                    <td className="py-1.5 px-1 bg-amber-50/60 border-r border-amber-200">
                      <input className={BOX} inputMode="decimal" disabled={!mayBlock}
                             aria-label="Block model Cr2O3 percent"
                             value={r.block_cr2o3_pct}
                             onChange={(e) => set(r.key, "block_cr2o3_pct", e.target.value)} />
                    </td>
                    <td className="py-1.5 pl-1 pr-1">
                      <input className={BOX} inputMode="decimal" disabled={!mayEdit}
                             aria-label="Moisture percent" value={r.moisture_pct}
                             onChange={(e) => set(r.key, "moisture_pct", e.target.value)} />
                    </td>
                    <td className="py-1.5 pr-1">
                      <input className={`${BOX} ${bad(r.cr2o3_pct, 100) ? "border-danger" : ""}`}
                             inputMode="decimal" disabled={!mayEdit}
                             aria-label="Cr2O3 percent" value={r.cr2o3_pct}
                             onChange={(e) => set(r.key, "cr2o3_pct", e.target.value)} />
                    </td>
                    <td className="py-1.5 pr-1">
                      <input className={`${BOX} ${bad(r.feo_pct, 100) ? "border-danger" : ""}`}
                             inputMode="decimal" disabled={!mayEdit}
                             aria-label="FeO percent" value={r.feo_pct}
                             onChange={(e) => set(r.key, "feo_pct", e.target.value)} />
                    </td>
                    {/* Computed, never typed — see the note at the foot. */}
                    <td className="py-1.5 pr-1 text-right"><Fig v={live} /></td>
                    <td className="py-1.5 pl-1">
                      {mayEdit && (
                        <button onClick={() => dropRow(r.key)}
                                title={r.block_owner
                                  ? `Geology filed a block model on this row (${r.block_owner}) — removing it has to be done on its own`
                                  : "Remove this row"}
                                aria-label="Remove row"
                                className="p-1 rounded text-txt-light hover:text-danger hover:bg-bg-section">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* ── the sheet's WET & AVG. line ───────────────────────────── */}
              <tr className="bg-bg-soft border-t-2 border-border">
                <td className="py-2 text-[11px] font-condensed font-extrabold text-navy uppercase tracking-wider"
                    colSpan={2}>
                  Wet &amp; Avg.
                </td>
                <td className="py-2 pr-1 text-right"><Fig v={totals.trips} dp={2} strong /></td>
                <td className="py-2 pr-1 text-right"><Fig v={totals.qty || null} dp={3} strong /></td>
                <td className="py-2 px-1 bg-amber-50 border-l border-amber-200" />
                <td className="py-2 px-1 text-right bg-amber-50 border-r border-amber-200">
                  <Fig v={totals.block} strong />
                </td>
                <td className="py-2 pr-1 text-right"><Fig v={totals.moisture} /></td>
                <td className="py-2 pr-1 text-right"><Fig v={totals.cr2o3} strong /></td>
                <td className="py-2 pr-1 text-right"><Fig v={totals.feo} strong /></td>
                <td className="py-2 pr-1 text-right"><Fig v={totals.ratio} dp={2} strong /></td>
                <td />
              </tr>
            </tbody>
          </table>

          <div className="flex items-center gap-3 flex-wrap">
            {mayEdit && (
              <button onClick={addRow}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-border
                        text-[11px] font-bold text-txt-secondary hover:bg-bg-section">
                <Plus size={12} /> Add a sample
              </button>
            )}


            {totals.variance !== null && (
              <span className="ml-auto text-[11px] text-txt-secondary">
                Block model{" "}
                <strong className="font-mono tabular-nums">
                  {totals.block?.toFixed(2)}
                </strong>
                {" vs ROM "}
                <strong className="font-mono tabular-nums">
                  {totals.cr2o3?.toFixed(2)}
                </strong>
                {" — "}
                <strong className={`font-mono tabular-nums ${
                  totals.variance >= 0 ? "text-emerald" : "text-danger"}`}>
                  {totals.variance >= 0 ? "+" : ""}{totals.variance.toFixed(2)}
                </strong>
              </span>
            )}
          </div>

          <p className="text-[10px] text-txt-light leading-relaxed">
            One line per sample — a day is as many lines as it took.{" "}
            <strong>Total Qty, the Wet &amp; Avg. line and the Ratio are worked
            out from the boxes and are never stored</strong>, so no total can
            disagree with its parts; the ratio is (Cr<sub>2</sub>O<sub>3</sub> ×
            0.6843) ÷ (FeO × 0.7773).{" "}
            <strong>Block Model is filed separately by Geology</strong> and may
            be empty — nothing before November 2026 carries it at all. The{" "}
            <strong>mRL takes whatever the survey says</strong> — 80, 80-82,
            &gt;80 — and offers the ones already filed as you type; picking one
            keeps a bench to a single spelling. Adding a location from the
            dropdown puts it on the list for everyone; a re-spelling of one
            already on it selects the original.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-border-light flex items-center justify-end gap-2 bg-bg-soft">
          {error && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-danger mr-auto">
              <AlertTriangle size={12} />{error}
            </span>
          )}
          {!error && done && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald mr-auto">
              <Check size={12} />{done}
            </span>
          )}
          {!error && !done && problem && (
            <span className="text-[11px] font-semibold text-amber-700 mr-auto">{problem}</span>
          )}
          {!error && !done && !problem && droppingFilled > 0 && (
            <span className="text-[11px] font-semibold text-danger mr-auto">
              {droppingFilled} removed row{droppingFilled === 1 ? "" : "s"} already
              carr{droppingFilled === 1 ? "ies" : "y"} a block model — put
              {droppingFilled === 1 ? " it" : " them"} back, or remove separately
            </span>
          )}
          {!error && !done && !problem && !droppingFilled && totals.awaiting > 0 && mayEdit && !mayBlock && (
            <span className="text-[11px] text-txt-muted mr-auto">
              {totals.awaiting} sample{totals.awaiting === 1 ? "" : "s"} will wait
              on Geology for the block model
            </span>
          )}
          <button onClick={onClose}
            className="px-3 py-1.5 rounded border border-border text-[12px] font-bold
              text-txt-secondary hover:bg-bg-section">
            {inline ? "Cancel" : "Close"}
          </button>
          <button
            onClick={submit}
            disabled={saving || nothingToDo || futureDay || Boolean(problem)
              || droppingFilled > 0 || rows.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded text-[12px] font-bold
              bg-navy text-white shadow-sm transition-colors
              hover:bg-navy-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? "Submitting…" : label}
          </button>
        </div>
    </FormShell>
  );
}
