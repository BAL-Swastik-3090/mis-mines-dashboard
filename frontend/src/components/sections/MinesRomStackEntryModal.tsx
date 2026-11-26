"use client";
/**
 * Entry ROM Stack — what the mine built out of its ROM, and the number it ships under.
 *
 * TWO DATES, AND THEY ARE NOT THE SAME DATE. The Stack Creation Date is when
 * the stack was made; it is what the despatch number's month letter and year
 * come from, and it belongs to the stack. The Production Date beside the
 * shift is what ore went IN, and a stack is routinely built out of three
 * days' ore — the mine's own stack 414 carries 31 October, 1 and 2 November.
 * Taking the letter off a line's production date would give one stack two
 * different numbers.
 *
 * PICK THE DATE AND THE SHIFT AND THE FIGURES ARRIVE. The day-wise ROM entry
 * already holds the location, the block model, Cr2O3, FeO and the moisture;
 * re-typing them here would be the same assay keyed twice, and the two
 * screens would eventually disagree with nothing to say which was right. So
 * the only things typed are the Stack Number and how much of each sample went
 * in. Everything fetched stays editable, and a figure the mine changes is
 * flagged as amended so the divergence is explained rather than discovered.
 *
 * SHIFTING MATERIAL IS NOT ROM. The three shifting shifts were never filed as
 * samples, so there is nothing to fetch and the line is typed in full. The
 * server refuses to link one to a sample and so does the table.
 *
 * THE NUMBER IS THE WHOLE POINT, so it is shown as it is built. The mine
 * types the last four digits — the ones its workbook has always carried — and
 * the month letter and year come off the creation date. The composed key is
 * what despatch is matched on, and it appears under the box as it is typed so
 * nobody finds out at reconciliation.
 *
 * NOTHING THAT CAN BE COMPUTED IS TYPED. The WET AVG line at the foot and
 * every row's Cr/Fe ratio are computed from the lines. The mine's workbook
 * types both, and thirteen of its seventy-four WET AVG lines do not reproduce
 * from the rows above them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  X, Save, Loader2, AlertTriangle, Plus, Trash2, Layers, Check, Truck,
  Download,
} from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { dayLabel, todayISO } from "@/lib/prevDay";
import DateField from "@/components/minehub/DateField";
import FormShell from "@/components/ui/FormShell";

/** The six the mine named. Shifting material is a shift here rather than a
 *  flag beside A/B/C — their sheet reads that way and so does the dropdown
 *  they asked for. The three plain ones are the only ones that can fetch. */
const SHIFTS = [
  "A", "B", "C",
  "A(Shifting material)",
  "B(Shifting material)",
  "C(Shifting material)",
] as const;

const isShifting = (s: string) => s.includes("Shifting");

/** The dropdown's last option. A sentinel rather than a number, so it can
 *  never collide with a real location_id. */
const ADD_NEW = "__add__";

/** Mass fraction of Cr in Cr2O3, and of Fe in FeO — the same two constants
 *  the server uses. The screen computes the ratio as you type so the figure
 *  is never a surprise after saving, and neither side stores it, so they
 *  cannot disagree. */
const CR_IN_CR2O3 = 0.6843;
const FE_IN_FEO = 0.7773;

type Loc = { location_id: number; name: string; is_active: boolean; in_use: number };

type Sample = {
  rom_id: number; on_date: string; shift: string;
  location_id: number; location: string;
  qty_mt: number | null; moisture_pct: number | null;
  cr2o3_pct: number | null; feo_pct: number | null;
  block_mrl: string | null; block_cr2o3_pct: number | null;
  ratio: number | null; stacked_mt: number | null; remaining_mt: number;
};

type ApiLine = {
  line_id: number; rom_id: number | null;
  on_date: string; shift: string;
  location_id: number | null; location: string | null;
  block_mrl: string | null; block_cr2o3_pct: number | null;
  cr2o3_pct: number | null; feo_pct: number | null;
  moisture_pct: number | null; qty_mt: number | null;
  ratio: number | null; amended: boolean; is_shifting: boolean;
};

type Despatch = {
  batch: string; trips: number; qty_mt: number | null;
  first_out: string | null; last_out: string | null;
};

type StackResponse = {
  created_on: string; stack_no: string; stack_key: string;
  exists: boolean;
  stack: { stack_id: number; despatch_batch: string | null; note: string | null } | null;
  lines: ApiLine[];
  summary: {
    lines: number; qty_mt: number; cr2o3_pct: number | null;
    feo_pct: number | null; moisture_pct: number | null; ratio: number | null;
    block_cr2o3_pct: number | null; shifting_lines: number; amended_lines: number;
  };
  despatch: Despatch | null;
  may_edit: boolean; may_delete: boolean;
};

/** A line as the form holds it: every figure a string, because a half-typed
 *  "4." is not a number and must not be rounded into one while the cursor is
 *  still in the box. */
type Draft = {
  key: string;
  line_id: number | null;
  rom_id: number | null;
  on_date: string;
  shift: string;
  location_id: string;
  block_mrl: string;
  block_cr2o3_pct: string;
  cr2o3_pct: string;
  feo_pct: string;
  moisture_pct: string;
  qty_mt: string;
  amended: boolean;
};

let seq = 0;

const fromSample = (s: Sample): Draft => ({
  key: `new-${++seq}`,
  line_id: null,
  rom_id: s.rom_id,
  on_date: s.on_date,
  shift: s.shift,
  location_id: String(s.location_id),
  block_mrl: s.block_mrl ?? "",
  block_cr2o3_pct: s.block_cr2o3_pct == null ? "" : String(s.block_cr2o3_pct),
  cr2o3_pct: s.cr2o3_pct == null ? "" : String(s.cr2o3_pct),
  feo_pct: s.feo_pct == null ? "" : String(s.feo_pct),
  moisture_pct: s.moisture_pct == null ? "" : String(s.moisture_pct),
  // LEFT EMPTY, DELIBERATELY. An earlier version pre-filled it with what was
  // left of the sample, on the reasoning that "all of what remains" is the
  // commonest case. The mine struck that out (25 Nov 2026) and they are
  // right: how much of a parcel went into a stack is a thing somebody
  // decided at the stockpile, and a number already sitting in the box is one
  // nobody has to look at. Every other column here is fetched BECAUSE it was
  // measured elsewhere; this one was not measured anywhere but here.
  qty_mt: "",
  amended: false,
});

const blankShifting = (on_date: string, shift: string): Draft => ({
  key: `new-${++seq}`, line_id: null, rom_id: null, on_date, shift,
  location_id: "", block_mrl: "", block_cr2o3_pct: "",
  cr2o3_pct: "", feo_pct: "", moisture_pct: "", qty_mt: "", amended: false,
});

const toDraft = (l: ApiLine): Draft => ({
  key: `line-${l.line_id}`,
  line_id: l.line_id,
  rom_id: l.rom_id,
  on_date: l.on_date,
  shift: l.shift,
  location_id: l.location_id == null ? "" : String(l.location_id),
  block_mrl: l.block_mrl ?? "",
  block_cr2o3_pct: l.block_cr2o3_pct == null ? "" : String(l.block_cr2o3_pct),
  cr2o3_pct: l.cr2o3_pct == null ? "" : String(l.cr2o3_pct),
  feo_pct: l.feo_pct == null ? "" : String(l.feo_pct),
  moisture_pct: l.moisture_pct == null ? "" : String(l.moisture_pct),
  qty_mt: l.qty_mt == null ? "" : String(l.qty_mt),
  amended: l.amended,
});

function num(v: string | undefined): number | null {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const filled = (v: string | undefined) => String(v ?? "").trim() !== "";

function bad(v: string | undefined, hi?: number): boolean {
  if (!filled(v)) return false;
  const n = num(v);
  if (n === null || n < 0) return true;
  return hi !== undefined && n > hi;
}

/** A bench level ("80", "27.5") or a span of two ("80-82"). Spaces around the
 *  dash are fine — the server takes them out rather than refusing. */
function badMrl(v: string | undefined): boolean {
  if (!filled(v)) return false;
  const t = String(v).replace(/\s*-\s*/g, "-").trim();
  if (!/^\d{1,4}(\.\d{1,2})?(-\d{1,4}(\.\d{1,2})?)?$/.test(t)) return true;
  if (t.includes("-")) {
    const [lo, hi] = t.split("-").map(Number);
    if (lo > hi) return true;       // "82-80" is a transposition
  }
  return false;
}

function ratioOf(cr: number | null, fe: number | null): number | null {
  if (cr === null || fe === null || fe <= 0) return null;
  return (cr * CR_IN_CR2O3) / (fe * FE_IN_FEO);
}

/** Month letter + two-digit year + the four-digit tail, exactly as the
 *  database generates it. Shown while the number is being typed so the person
 *  sees what despatch will be matched on, rather than finding out later.
 *  A=Jan … L=Dec; the year is TWO digits — 2026 is 26, not 260. */
function keyOf(createdOn: string, tail: string): string {
  const d = new Date(`${createdOn}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const t = tail.trim();
  if (!/^\d{1,4}$/.test(t)) return "";
  return String.fromCharCode(64 + d.getMonth() + 1)
    + String(d.getFullYear() % 100).padStart(2, "0")
    + t.padStart(4, "0");
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

/** The mark on a column that will not let the stack be filed without it. */
function Req() {
  return <span className="text-danger font-bold ml-0.5" aria-hidden>*</span>;
}

function Fig({ v, dp = 2, strong }: { v: number | null; dp?: number; strong?: boolean }) {
  return (
    <span className={`text-[12px] font-mono tabular-nums ${
      strong ? "font-bold text-navy" : "text-txt-primary"}`}>
      {v === null || v === undefined ? "—" : formatIndian(v, dp)}
    </span>
  );
}

export default function MinesRomStackEntryModal({
  open, onClose, onSaved, inline,
}: {
  open: boolean;
  /** True on its own screen under Daily Entry Hub: no backdrop, no
   *  click-to-dismiss, no close button. See FormShell. */
  inline?: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  // ── the stack ─────────────────────────────────────────────────────────────
  const [createdOn, setCreatedOn] = useState(todayISO);
  const [stackNo, setStackNo] = useState("");
  const [rows, setRows] = useState<Draft[]>([]);

  // ── the picker ────────────────────────────────────────────────────────────
  const [pickDate, setPickDate] = useState(todayISO);
  const [pickShift, setPickShift] = useState<string>("A");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
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
    setPicked(new Set());
    // Reopening is a fresh start, so the next stack genuinely loads.
    loadedFor.current = null;
  }, [open]);

  const locs = useQuery<{ locations: Loc[] }>({
    queryKey: ["rom-locations"],
    queryFn: async () => (await api.get("/rom-entry/locations")).data,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // The number must be four digits before there is a stack to ask about.
  const tailReady = /^\d{1,4}$/.test(stackNo.trim());
  const liveKey = keyOf(createdOn, stackNo);

  const stackQ = useQuery<StackResponse>({
    queryKey: ["rom-stack", createdOn, stackNo.trim().padStart(4, "0")],
    queryFn: async () => (await api.get("/rom-stack/stack", {
      params: { created_on: createdOn, stack_no: stackNo.trim() },
    })).data,
    enabled: open && Boolean(createdOn) && tailReady,
    staleTime: 30 * 1000,
  });

  const samplesQ = useQuery<{ samples: Sample[]; is_shifting: boolean; note: string | null }>({
    queryKey: ["rom-stack-samples", pickDate, pickShift],
    queryFn: async () => (await api.get("/rom-stack/samples", {
      params: { on_date: pickDate, shift: pickShift },
    })).data,
    enabled: open && Boolean(pickDate) && !isShifting(pickShift),
    staleTime: 30 * 1000,
  });

  const mayEdit = stackQ.data?.may_edit ?? false;

  // ── loading the stack, ONCE PER STACK ────────────────────────────────────
  // Keyed on WHICH STACK, not on the query's data. react-query hands back a
  // fresh object on every background refetch -- its own stale time, the
  // window regaining focus -- and an effect that reloaded on that would
  // replace the lines with the SAVED ones mid-entry. A stack built from three
  // days is three visits to the picker with nothing submitted in between, so
  // that is not an edge case here: it is the normal way this form is used,
  // and it silently threw away the first two days' work.
  //
  // The ref is what makes "have I already loaded this stack" a question the
  // effect can answer. Clearing it is how a save asks for a genuine reload --
  // which a save does need, because new lines have no line_id until they are
  // written.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !stackQ.data) return;
    const id = `${stackQ.data.created_on}|${stackQ.data.stack_no}`;
    if (loadedFor.current === id) return;
    loadedFor.current = id;
    // A stack that does not exist yet opens empty rather than with a blank
    // line: the way in is the picker, not a row.
    setRows(stackQ.data.lines.map(toDraft));
  }, [open, stackQ.data]);

  const set = (key: string, field: keyof Draft, v: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: v } : r)));

  const dropRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  // Which samples are already on this stack, so the picker can say so rather
  // than letting the same sample be added to one stack twice.
  const onStack = useMemo(
    () => new Set(rows.map((r) => r.rom_id).filter((x): x is number => x !== null)),
    [rows]);

  const addPicked = () => {
    const chosen = (samplesQ.data?.samples ?? []).filter(
      (s) => picked.has(s.rom_id) && !onStack.has(s.rom_id));
    if (!chosen.length) return;
    setRows((rs) => [...rs, ...chosen.map(fromSample)]);
    setPicked(new Set());
  };

  const addShifting = () =>
    setRows((rs) => [...rs, blankShifting(pickDate, pickShift)]);

  async function addLocation(forKey: string) {
    const name = newLoc.trim();
    if (!name) return;
    setAddingLoc(true);
    setError(null);
    try {
      const res = await api.post("/rom-entry/locations", { name });
      await locs.refetch();
      // Selected on the line that asked for it — whether it was created just
      // now or already existed under another spelling. The server answers a
      // duplicate with the existing row, and quietly selecting it is the
      // whole point of that.
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

  // Which production days the stack has drawn on so far, in date order. A
  // stack is routinely built from three, and the picker reads as a one-shot
  // unless the screen says otherwise -- so it says otherwise.
  const daysIn = useMemo(() => {
    const seen = new Set(rows.map((r) => r.on_date));
    return [...seen].sort();
  }, [rows]);

  // ── what the stack adds up to ─────────────────────────────────────────────
  const totals = useMemo(() => {
    const live = rows.map((r) => ({
      q: num(r.qty_mt), m: num(r.moisture_pct),
      c: num(r.cr2o3_pct), f: num(r.feo_pct), b: num(r.block_cr2o3_pct),
    }));
    const qty = live.reduce((s, r) => s + (r.q ?? 0), 0);
    // Lines missing a figure are left out of BOTH sides. Counting their
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
    const cr = w((r) => r.c), fe = w((r) => r.f);
    return {
      qty,
      cr2o3: cr, feo: fe, moisture: w((r) => r.m), block: w((r) => r.b),
      // From the weighted assays, never a mean of the rows' own ratios: a
      // mean of ratios is not the ratio of the means, and the workbook's own
      // WET AVG line takes it this way.
      ratio: ratioOf(cr, fe),
    };
  }, [rows]);

  // ── what is not fit to send ───────────────────────────────────────────────
  const problem = useMemo(() => {
    if (!filled(stackNo)) return "The stack needs its number.";
    if (!tailReady)
      return "A stack number is one to four digits — the last four of the "
        + "despatch batch.";
    if (createdOn > maxDay) return "A stack cannot be created in the future.";
    if (!rows.length) return "Nothing has been added to this stack yet.";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const at = `Line ${i + 1}`;
      if (!r.shift) return `${at}: pick a shift.`;
      if (!filled(r.on_date)) return `${at}: the production date is missing.`;
      // The one asymmetry, and it is the real rule rather than a convenience:
      // shifting material was never filed as a ROM sample, so it has nothing
      // to link to and everything is typed.
      if (!isShifting(r.shift) && r.rom_id === null)
        return `${at}: that line has lost its ROM sample. Remove it and pick `
          + `again from the samples below.`;
      if (isShifting(r.shift) && r.rom_id !== null)
        return `${at}: shifting material cannot be linked to a ROM sample.`;
      if (!filled(r.cr2o3_pct) || !filled(r.feo_pct))
        return `${at}: Cr₂O₃% and FeO% are both needed.`;
      if (!filled(r.qty_mt)) return `${at}: the quantity is needed.`;
      if (bad(r.cr2o3_pct, 100)) return `${at}: Cr₂O₃% must be 0–100.`;
      if (bad(r.feo_pct, 100)) return `${at}: FeO% must be 0–100.`;
      if (bad(r.moisture_pct, 100)) return `${at}: moisture must be 0–100.`;
      if (bad(r.block_cr2o3_pct, 100)) return `${at}: block Cr₂O₃% must be 0–100.`;
      if (badMrl(r.block_mrl))
        return `${at}: the mRL should be a bench level like 80, or a span `
          + `like 80-82.`;
      const q = num(r.qty_mt);
      if (q === null || q <= 0) return `${at}: the quantity must be more than nought.`;
      const hasM = filled(r.block_mrl), hasC = filled(r.block_cr2o3_pct);
      if (hasM !== hasC)
        return `${at}: a block model needs both the mRL and the Cr₂O₃%. `
          + `Leave both empty to clear it.`;
    }
    return null;
  }, [rows, stackNo, tailReady, createdOn, maxDay]);

  // ── saving ────────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const res = await api.put("/rom-stack", {
        created_on: createdOn,
        stack_no: stackNo.trim(),
        // `note` is deliberately NOT sent. The box was taken off the form at
        // the mine's instruction (25 Nov 2026) and the column is still there,
        // so omitting the field leaves whatever a stack already holds alone --
        // sending null would quietly erase it.
        // amended and despatch_batch are NOT sent. The server derives the
        // first by comparing against the sample and resolves the second from
        // SAP; a client that could assert either could hide a divergence the
        // flag exists to show.
        lines: rows.map((r) => ({
          line_id: r.line_id,
          rom_id: r.rom_id,
          on_date: r.on_date,
          shift: r.shift,
          location_id: r.location_id ? Number(r.location_id) : null,
          block_mrl: r.block_mrl.trim() || null,
          block_cr2o3_pct: num(r.block_cr2o3_pct),
          cr2o3_pct: num(r.cr2o3_pct),
          feo_pct: num(r.feo_pct),
          moisture_pct: num(r.moisture_pct),
          qty_mt: num(r.qty_mt),
        })),
      });
      await onSaved();
      // The one place a genuine reload is wanted: lines added just now have
      // no line_id until they are written, and without one the next save
      // would insert them all over again.
      loadedFor.current = null;
      await stackQ.refetch();
      setDone(`Stack ${res.data.stack_key} submitted`);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Could not save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [rows, createdOn, stackNo, onSaved, stackQ]);

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

  const options = locs.data?.locations ?? [];
  const despatch = stackQ.data?.despatch ?? null;
  const samples = samplesQ.data?.samples ?? [];
  const pickingShifting = isShifting(pickShift);

  return (
    <FormShell inline={inline} maxW="max-w-7xl"
               label="Enter ROM stack" onClose={onClose}>
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Layers size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Entry ROM Stack
          </span>
          {(stackQ.isFetching || locs.isFetching) && (
            <Loader2 size={12} className="animate-spin text-txt-light" />
          )}
          {!inline && (<button onClick={onClose} aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors">
            <X size={16} />
          </button>)}
        </div>

        {/* ── which stack ──────────────────────────────────────────────────
            The creation date and the number together ARE the stack. Typing a
            different number opens a different stack rather than renaming this
            one, which is why they sit above the lines and not among them. */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-end gap-3 flex-wrap">
          <div>
            <label htmlFor="stack-created" className={`${TH} block px-0 pb-1`}>
              Stack Creation Date<Req />
            </label>
            <DateField id="stack-created" value={createdOn} max={maxDay}
                       onChange={setCreatedOn} className="w-[140px]" />
          </div>

          <div>
            <label htmlFor="stack-no" className={`${TH} block px-0 pb-1`}>
              Stack Number<Req />
            </label>
            <input
              id="stack-no"
              inputMode="numeric"
              maxLength={4}
              placeholder="414"
              className={`${BOX} w-[90px] text-center`}
              value={stackNo}
              onChange={(e) => setStackNo(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>

          {/* WHAT DESPATCH WILL BE MATCHED ON, shown as it is typed. The mine
              types the last four digits; the month letter and the two-digit
              year come off the creation date. Seeing it here is what stops a
              mis-keyed stack being discovered at reconciliation. */}
          <div className="pb-0.5">
            <span className={`${TH} block px-0 pb-1`}>Despatch Key</span>
            <span className="font-mono font-bold text-[15px] text-navy tracking-wider tabular-nums">
              {liveKey || "—"}
            </span>
          </div>

          <span className="text-[11px] text-txt-muted pb-1.5">
            {dayLabel(createdOn)}
          </span>

          {tailReady && stackQ.data && (
            <span className={`ml-auto text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border ${
              stackQ.data.exists
                ? "bg-blue-50 text-blue-700 border-blue-200"
                : "bg-bg-section text-txt-muted border-border"}`}>
              {stackQ.data.exists ? "Existing stack" : "New stack"}
            </span>
          )}
        </div>

        {/* ── has it shipped ───────────────────────────────────────────────
            Not a warning when it is absent. A stack built this week has not
            despatched yet and nothing is wrong with it; the line only appears
            once SAP has an answer. */}
        {despatch && (
          <div className="px-4 py-2 border-b border-border-light bg-green-50/60 flex items-center gap-3 flex-wrap text-[11px]">
            <Truck size={13} className="text-green-700" />
            <span className="font-semibold text-green-900">
              Despatched as {despatch.batch}
            </span>
            <span className="text-txt-secondary">
              {despatch.trips} trips · {formatIndian(despatch.qty_mt ?? 0, 3)} MT
              {despatch.first_out && ` · ${dayLabel(despatch.first_out)}`}
              {despatch.last_out && despatch.last_out !== despatch.first_out
                && ` to ${dayLabel(despatch.last_out)}`}
            </span>
          </div>
        )}

        <div className="px-4 py-3 space-y-3">
          {/* ── the picker ────────────────────────────────────────────────
              A production date and a shift, and back come that shift's
              samples. This is the only way a ROM line gets onto a stack:
              re-typing an assay that is already filed would be the same
              figure keyed twice. */}
          <div className="rounded border border-border-light bg-bg-soft">
            <div className="px-3 py-2 flex items-end gap-3 flex-wrap border-b border-border-light">
              <div>
                <label htmlFor="pick-date" className={`${TH} block px-0 pb-1`}>
                  Production Date
                </label>
                <DateField id="pick-date" value={pickDate} max={maxDay}
                           onChange={(v) => { setPickDate(v); setPicked(new Set()); }}
                           className="w-[140px]" />
              </div>
              <div>
                <label htmlFor="pick-shift" className={`${TH} block px-0 pb-1`}>
                  Shift
                </label>
                <select id="pick-shift" className={`${SEL} w-[190px]`}
                        value={pickShift}
                        onChange={(e) => { setPickShift(e.target.value); setPicked(new Set()); }}>
                  {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {pickingShifting ? (
                <button type="button" onClick={addShifting} disabled={!mayEdit}
                  className="px-3 py-1.5 rounded bg-navy text-white text-[11px] font-semibold
                             inline-flex items-center gap-1.5 hover:bg-navy/90
                             disabled:opacity-40 disabled:cursor-not-allowed">
                  <Plus size={13} /> Add a line to type
                </button>
              ) : (
                <button type="button" onClick={addPicked}
                  disabled={!mayEdit || picked.size === 0}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[11px] font-semibold
                             inline-flex items-center gap-1.5 hover:bg-accent/90
                             disabled:opacity-40 disabled:cursor-not-allowed">
                  <Download size={13} />
                  Add {picked.size || ""} selected
                </button>
              )}
              {samplesQ.isFetching && (
                <Loader2 size={12} className="animate-spin text-txt-light mb-2" />
              )}
            </div>

            <div className="px-3 py-2">
              {pickingShifting ? (
                <p className="text-[11px] text-txt-secondary">
                  <span className="font-semibold text-navy">Shifting material is not
                  a ROM sample.</span>{" "}
                  It was never filed on the day-wise analysis, so there is nothing to
                  fetch — add a line and type it in full.
                </p>
              ) : samples.length === 0 ? (
                <p className="text-[11px] text-txt-muted">
                  No ROM samples were filed for {dayLabel(pickDate)} shift {pickShift}.
                </p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={`${TH} w-[1%]`} />
                      <th className={`${TH} text-left`}>Location</th>
                      <th className={`${TH} text-right`}>ROM Qty</th>
                      <th className={`${TH} text-right`}>Already Stacked</th>
                      <th className={`${TH} text-right`}>Remaining</th>
                      <th className={`${TH} text-right`}>Cr<sub>2</sub>O<sub>3</sub>%</th>
                      <th className={`${TH} text-right`}>FeO%</th>
                      <th className={`${TH} text-right`}>%Moist</th>
                      <th className={`${TH} text-right`}>Block Cr<sub>2</sub>O<sub>3</sub></th>
                    </tr>
                  </thead>
                  <tbody>
                    {samples.map((s) => {
                      const already = onStack.has(s.rom_id);
                      return (
                        <tr key={s.rom_id}
                            className={`border-t border-border-light/70 ${
                              already ? "opacity-50" : ""}`}>
                          <td className="py-1 pr-1">
                            <input type="checkbox" disabled={already || !mayEdit}
                              aria-label={`Select ${s.location}`}
                              checked={picked.has(s.rom_id)}
                              onChange={(e) => setPicked((p) => {
                                const n = new Set(p);
                                if (e.target.checked) n.add(s.rom_id); else n.delete(s.rom_id);
                                return n;
                              })} />
                          </td>
                          <td className="py-1 text-[12px] text-txt-primary">
                            {s.location}
                            {already && (
                              <span className="ml-1.5 text-[10px] text-txt-muted">
                                already on this stack
                              </span>
                            )}
                          </td>
                          <td className="py-1 text-right"><Fig v={s.qty_mt} dp={3} /></td>
                          <td className="py-1 text-right"><Fig v={s.stacked_mt} dp={3} /></td>
                          <td className="py-1 text-right">
                            {/* What is LEFT of the sample across every stack,
                                not just this one. A sample is apportioned, so
                                offering it again is right -- offering it
                                without saying how much has already gone is how
                                it gets counted twice. */}
                            <span className={s.remaining_mt <= 0 ? "text-danger" : ""}>
                              <Fig v={s.remaining_mt} dp={3} strong />
                            </span>
                          </td>
                          <td className="py-1 text-right"><Fig v={s.cr2o3_pct} /></td>
                          <td className="py-1 text-right"><Fig v={s.feo_pct} /></td>
                          <td className="py-1 text-right"><Fig v={s.moisture_pct} /></td>
                          <td className="py-1 text-right"><Fig v={s.block_cr2o3_pct} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── what the stack has drawn on so far ─────────────────────────
              The picker above is used once per production day and shift, and
              a form that does not say so reads as though one stack came off
              one day. The mine's own stacks run to three days and ten lines. */}
          <div className="flex items-baseline gap-2 flex-wrap text-[11px]">
            {daysIn.length === 0 ? (
              <span className="text-txt-muted">
                Nothing added yet. Pick a production date and shift above, tick
                what went in, and add — then change the date and add again for
                each further day the stack was built from.
              </span>
            ) : (
              <>
                <span className={`${TH} px-0`}>In this stack</span>
                <span className="font-semibold text-navy">
                  {rows.length} line{rows.length === 1 ? "" : "s"} from{" "}
                  {daysIn.length} day{daysIn.length === 1 ? "" : "s"}
                </span>
                <span className="text-txt-secondary">
                  {daysIn.map((d) => dayLabel(d)).join(" · ")}
                </span>
                <span className="text-txt-muted">
                  — change the production date above and add again to draw on
                  another day.
                </span>
              </>
            )}
          </div>

          {/* ── what is in the stack ──────────────────────────────────────── */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} text-left w-[110px]`} rowSpan={2}>Date<Req /></th>
                  <th className={`${TH} text-left w-[150px]`} rowSpan={2}>Shift<Req /></th>
                  <th className={`${TH} text-left min-w-[140px]`} rowSpan={2}>Location</th>
                  {/* The block pair is tinted as one group, because it is one
                      person's work and arrives after everything to its left. */}
                  <th className={`${TH} text-center bg-amber-50 border-x border-amber-200`}
                      colSpan={2}>Block Model</th>
                  <th className={`${TH} text-right w-[95px]`} rowSpan={2}>
                    Cr<sub>2</sub>O<sub>3</sub>%<Req />
                  </th>
                  <th className={`${TH} text-right w-[95px]`} rowSpan={2}>FeO%<Req /></th>
                  <th className={`${TH} text-right w-[80px]`} rowSpan={2}>Ratio</th>
                  <th className={`${TH} text-right w-[85px]`} rowSpan={2}>%Moist</th>
                  <th className={`${TH} text-right w-[110px]`} rowSpan={2}>Quantity<Req /></th>
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
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11}
                        className="py-6 text-center text-[12px] text-txt-muted">
                      Nothing in this stack yet.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const live = ratioOf(num(r.cr2o3_pct), num(r.feo_pct));
                  const shifting = isShifting(r.shift);
                  return (
                    <tr key={r.key} className="border-t border-border-light/70">
                      <td className="py-1.5 pr-1 text-[12px] font-mono tabular-nums text-txt-primary">
                        {dayLabel(r.on_date)}
                      </td>
                      <td className="py-1.5 pr-1">
                        <select className={SEL} disabled={!mayEdit} value={r.shift}
                                aria-label="Shift"
                                onChange={(e) => set(r.key, "shift", e.target.value)}>
                          {SHIFTS.map((s) => (
                            // A fetched line cannot become shifting material
                            // and a typed one cannot become a ROM shift: the
                            // first would claim a sample it is not, the second
                            // would need one it has not got.
                            <option key={s} value={s}
                                    disabled={isShifting(s) !== shifting}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-1">
                        <select className={SEL} disabled={!mayEdit}
                                aria-label="Location"
                                value={r.location_id}
                                onChange={(e) => {
                                  if (e.target.value === ADD_NEW) {
                                    setNewLocFor(r.key);
                                    setNewLoc("");
                                    return;
                                  }
                                  set(r.key, "location_id", e.target.value);
                                }}>
                          <option value="">Select…</option>
                          {options.map((o) => (
                            <option key={o.location_id} value={o.location_id}>
                              {o.name}{o.is_active ? "" : " (retired)"}
                            </option>
                          ))}
                          {mayEdit && <option value={ADD_NEW}>+ Add a location…</option>}
                        </select>
                      </td>
                      <td className="py-1.5 pr-1 bg-amber-50/40 border-l border-amber-200">
                        <input className={BOX} disabled={!mayEdit}
                               aria-label="Block mRL" placeholder="80 or 80-82"
                               value={r.block_mrl}
                               onChange={(e) => set(r.key, "block_mrl", e.target.value)} />
                      </td>
                      <td className="py-1.5 pr-1 bg-amber-50/40 border-r border-amber-200">
                        <input className={BOX} disabled={!mayEdit}
                               aria-label="Block Cr2O3 percent"
                               value={r.block_cr2o3_pct}
                               onChange={(e) => set(r.key, "block_cr2o3_pct", e.target.value)} />
                      </td>
                      <td className="py-1.5 pr-1">
                        <input className={BOX} disabled={!mayEdit}
                               aria-label="Cr2O3 percent" value={r.cr2o3_pct}
                               onChange={(e) => set(r.key, "cr2o3_pct", e.target.value)} />
                      </td>
                      <td className="py-1.5 pr-1">
                        <input className={BOX} disabled={!mayEdit}
                               aria-label="FeO percent" value={r.feo_pct}
                               onChange={(e) => set(r.key, "feo_pct", e.target.value)} />
                      </td>
                      <td className="py-1.5 pr-1 text-right">
                        {/* Computed, never typed. The workbook types it and
                            carries typing slips -- one row reads 2.79 where
                            the chemistry gives 1.86. */}
                        <Fig v={live} dp={3} />
                      </td>
                      <td className="py-1.5 pr-1">
                        <input className={BOX} disabled={!mayEdit}
                               aria-label="Moisture percent" value={r.moisture_pct}
                               onChange={(e) => set(r.key, "moisture_pct", e.target.value)} />
                      </td>
                      <td className="py-1.5 pr-1">
                        <input className={BOX} disabled={!mayEdit}
                               aria-label="Quantity" value={r.qty_mt}
                               onChange={(e) => set(r.key, "qty_mt", e.target.value)} />
                      </td>
                      <td className="py-1.5 pl-1 text-right whitespace-nowrap">
                        {r.amended && (
                          <span title="A figure here no longer matches the ROM sample it came from"
                                className="mr-1 text-[9px] font-bold uppercase tracking-wider
                                           text-amber-700">
                            amended
                          </span>
                        )}
                        <button type="button" onClick={() => dropRow(r.key)}
                                disabled={!mayEdit} aria-label="Remove line"
                                className="p-1 rounded text-txt-light hover:text-danger
                                           hover:bg-red-50 disabled:opacity-30">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-bg-section">
                    <td className={`${TH} text-left`} colSpan={3}>Wet &amp; Avg.</td>
                    <td className="py-1.5 pr-1 text-right bg-amber-50/60 border-l border-amber-200">—</td>
                    <td className="py-1.5 pr-1 text-right bg-amber-50/60 border-r border-amber-200">
                      <Fig v={totals.block} strong />
                    </td>
                    <td className="py-1.5 pr-1 text-right"><Fig v={totals.cr2o3} strong /></td>
                    <td className="py-1.5 pr-1 text-right"><Fig v={totals.feo} strong /></td>
                    <td className="py-1.5 pr-1 text-right"><Fig v={totals.ratio} dp={3} strong /></td>
                    <td className="py-1.5 pr-1 text-right"><Fig v={totals.moisture} strong /></td>
                    <td className="py-1.5 pr-1 text-right"><Fig v={totals.qty} dp={3} strong /></td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* ── adding a location, asked for from the dropdown ─────────────── */}
          {newLocFor && (
            <div className="flex items-center gap-2 p-2 rounded bg-bg-soft border border-border">
              <input autoFocus className={`${SEL} max-w-xs text-left`}
                     placeholder="New location name"
                     value={newLoc}
                     onChange={(e) => setNewLoc(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === "Enter") void addLocation(newLocFor);
                       if (e.key === "Escape") setNewLocFor(null);
                     }} />
              <button type="button" onClick={() => void addLocation(newLocFor)}
                      disabled={addingLoc || !newLoc.trim()}
                      className="px-2.5 py-1 rounded bg-accent text-white text-[11px]
                                 font-semibold inline-flex items-center gap-1
                                 disabled:opacity-40">
                {addingLoc ? <Loader2 size={12} className="animate-spin" />
                           : <Check size={12} />}
                Add
              </button>
              <button type="button" onClick={() => setNewLocFor(null)}
                      className="px-2.5 py-1 rounded border border-border text-[11px]
                                 text-txt-secondary hover:bg-bg-section">
                Cancel
              </button>
            </div>
          )}

          {/* ── what the screen is doing, said once ────────────────────────── */}
          <p className="text-[9px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">Two dates, and they are not the
            same date.</span>{" "}
            The <span className="font-semibold">Stack Creation Date</span> is when the
            stack was made, and the despatch key&apos;s month letter and year come from
            it — a stack built in October out of October and November ore is an October
            stack. The <span className="font-semibold">Production Date</span> beside the
            shift is what went in, and one stack routinely spans three days.{" "}
            <span className="font-semibold">The key is seven characters and the SAP
            batch is ten</span> — the four digits in between vary per stack and cannot
            be derived, so despatch is matched on the month letter, the year and the
            last four digits, which is unique across every batch ever despatched.
            Location, Block Model, Cr<sub>2</sub>O<sub>3</sub>, FeO and moisture are
            fetched from the day-wise ROM entry and stay editable; a figure changed here
            is marked <span className="font-semibold">amended</span> so the two screens
            differing is explained rather than discovered.{" "}
            <span className="font-semibold">Quantity is never fetched</span> — how much
            of a parcel went into this stack was decided at the stockpile and is
            measured nowhere else, so it is typed. The Remaining column beside each
            sample is there to check it against, not to fill it in. Ratio and the
            Wet &amp; Avg. line are computed from the lines and are never stored.
          </p>
        </div>

        {/* ── footer ────────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-t border-border-light flex items-center gap-3 flex-wrap">
          {error && (
            <span className="text-[11px] text-danger font-semibold inline-flex items-center gap-1.5">
              <AlertTriangle size={13} /> {error}
            </span>
          )}
          {!error && problem && mayEdit && (
            <span className="text-[11px] text-amber-700 font-semibold">{problem}</span>
          )}
          {!error && !problem && done && (
            <span className="text-[11px] text-green-700 font-semibold inline-flex items-center gap-1.5">
              <Check size={13} /> {done}
            </span>
          )}
          {!mayEdit && stackQ.data && (
            <span className="text-[11px] text-txt-muted">
              You can read the stacks but not build one.
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 rounded border border-border text-[12px]
                         text-txt-secondary hover:bg-bg-section">
              {inline ? "Cancel" : "Close"}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!mayEdit || saving || Boolean(problem)}
              className="px-4 py-1.5 rounded bg-accent text-white text-[12px] font-semibold
                         inline-flex items-center gap-1.5 hover:bg-accent/90
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={13} className="animate-spin" />
                      : <Save size={13} />}
              Submit
            </button>
          </div>
        </div>
    </FormShell>
  );
}
