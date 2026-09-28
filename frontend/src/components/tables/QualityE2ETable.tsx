"use client";
/**
 * End-to-end quality — what the mine despatched against what the plant received.
 *
 * ONE ROW PER CONSIGNMENT: a stack on a despatch date, which is the grain the
 * mine's own reconciliation uses and the grain at which the two labs disagree.
 * A stack sent over two days is two rows, each with its own assay on both
 * sides; the backend splits it by truck count.
 *
 * READ-ONLY, entirely derived from SAP. There is nothing to enter, so a
 * corrected assay appears the moment it is posted.
 *
 * BLANK MEANS NOT ASSAYED, NEVER ZERO. A zero here would read as "the lab
 * found none", which is a different claim. Three things render blank by
 * design: LUMP has no FeO or Cr/Fe in SAP at all; a stack the mine has not yet
 * assayed shows a blank mines half; a stack the plant has not yet received
 * shows a blank plant half. Each fills itself in when the data arrives.
 *
 * VARIANCE = Plant − Mines. Green is a gain at the plant, red a loss.
 *
 * QUANTITY AND TRIPS are the despatched figures, shown once rather than twice.
 * The plant's own gate record is not wired in yet, so a received column would
 * repeat the despatch and every variance in it would read 0.00 — which looks
 * like agreement rather than an absence. It gets its own columns when the mine
 * supplies the source.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows, Search, Download, AlertTriangle,
         SlidersHorizontal, HelpCircle, X } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import { useDateFilter } from "@/contexts/useDateFilter";
import SearchSelect from "@/components/minehub/SearchSelect";

interface Side {
  trips: number;
  qty: number;
  moisture: number | null;
  cr2o3: number | null;
  feo: number | null;
  cr_fe: number | null;
}
interface Row {
  date: string;
  batch: string;
  grade: string | null;
  /** Which plant it went to — "BAL" or "JABAMOYEE". */
  destination: string;
  mines: Side;
  plant: Side;
  variance: Omit<Side, "trips"> & { trips: number };
}
interface Dest { key: string; label: string; plant: string }
interface Totals {
  trips: number;
  mines_qty: number;
  [k: string]: number | null;
}
interface Resp {
  from: string; to: string;
  destinations: Dest[];
  rows: Row[];
  /** Keyed by destination, plus "ALL". */
  totals: Record<string, Totals>;
}

/** Both plants, plus everything. "ALL" is a view, not a destination. */
const ALL_DEST = "ALL";

/**
 * A stack number repeats across destinations — the same batch ships to both
 * plants on the same day — so date and batch alone do not identify a row.
 */
const rowKey = (r: Row) => `${r.date}|${r.batch}|${r.destination}`;

const PARAMS = ["moisture", "cr2o3", "feo", "cr_fe"] as const;
type Param = (typeof PARAMS)[number];

/** Cr/Fe is a ratio and moves in the second decimal; the rest are percentages. */
const DP: Record<Param, number> = { moisture: 2, cr2o3: 2, feo: 2, cr_fe: 2 };

/**
 * How far the two labs may differ before it is worth a phone call.
 *
 * Measured from this mine's own history — 106 consignments, July to September
 * 2026 — and set near the ninetieth percentile of the absolute variance:
 *
 *     |variance|   median   p90    max
 *     moisture      0.31    0.56   3.41
 *     Cr2O3         0.41    0.60   1.86
 *     FeO           0.17    0.52   1.75
 *     Cr/Fe         0.02    0.05   0.09
 *
 * So about one consignment in ten is flagged: few enough to chase, and above
 * the noise the two labs make on an ordinary stack.
 *
 * A STARTING POINT, NOT A STANDARD. The lab should confirm these, which is why
 * they are on the screen and editable rather than buried here.
 */
const DEFAULT_TOLERANCE: Record<Param, number> = {
  moisture: 0.60, cr2o3: 0.60, feo: 0.55, cr_fe: 0.05,
};

function Val({ v, dp = 2 }: { v: number | null; dp?: number }) {
  if (v == null) return <span className="text-txt-light/40">—</span>;
  return <span className="font-mono text-navy">{formatIndian(v, dp)}</span>;
}

/**
 * Variance cell, marked by whether the labs agree rather than by which way.
 *
 * It used to be green for positive and red for negative, and that cannot be
 * right for all four. Variance is Plant minus Mines: on Cr2O3 a positive means
 * the plant found more chrome than the mine claimed, which is good for the
 * mine; on moisture a positive means the plant found more water, which means
 * the mine was paid for weight that was not ore. Green cannot mean both.
 *
 * So colour says "these two labs disagree by more than they usually do", and
 * the sign — still printed — says which way.
 */
function Var({ v, dp = 2, tol }: { v: number | null; dp?: number; tol?: number }) {
  if (v == null) return <span className="text-txt-light/40">—</span>;
  const out = tol != null && Math.abs(v) > tol;
  return (
    <span className={out
      ? "font-mono font-bold text-rose bg-rose-bg rounded px-1"
      : "font-mono text-txt-muted"}
      title={out ? `Outside the ${tol} tolerance` : undefined}>
      {v > 0 ? "+" : ""}{formatIndian(v, dp)}
    </span>
  );
}

const HEADS: Record<Param, string> = {
  moisture: "Mois%", cr2o3: "Cr2O3%", feo: "FeO%", cr_fe: "Cr/Fe",
};
/** The three assay blocks share one header row; a rule closes each block. */
const SUB_HEADS = (["mines", "plant", "var"] as const).flatMap((block, b) =>
  PARAMS.map((p, i) => ({
    key: `${block}-${p}`, label: HEADS[p], edge: i === PARAMS.length - 1 && b < 2,
  })),
);

const TH = "px-2 font-condensed font-extrabold text-[11px] tracking-[.1em]";
const TD = "px-2 py-2 leading-4 text-right text-[12px] whitespace-nowrap";

/* Ten rows at a time, with both header rows and the total pinned.
 *
 * The heights are fixed rather than left to the content because the second
 * header row sticks BELOW the first, and its offset has to be the first row's
 * exact height — a row that grows by a pixel would leave a gap that body rows
 * scroll through. HEAD_H is therefore set on the header rows, not merely
 * assumed, and the same figure feeds the `top` offset and the window height.
 *
 * Sticky is applied to the cells, never to <thead>/<tr>: with
 * border-collapse a sticky row is ignored in Chrome, while sticky cells work.
 */
const HEAD_H = 28;   // px, the FIRST header row — matches `h-7`
// The second row is taller, because it now holds the stack and grade filters
// rather than only a label. Its own height does not affect where it sticks —
// that offset is the first row's height — but the scroll window is measured
// from both, so it is stated rather than assumed to match.
const HEAD2_H = 36;
const ROW_H = 33;    // px, one body row at py-2 plus its border
const VISIBLE_ROWS = 10;
const WINDOW_H = HEAD_H + HEAD2_H + ROW_H * (VISIBLE_ROWS + 1); // + the WTD AVG row

// The background lives on the cell, not the row: a transparent sticky cell
// lets the body scroll through it.
const STICKY_1 = "sticky top-0 z-20 bg-navy";
const STICKY_2 = "sticky z-20 bg-navy";
const STICKY_FOOT = "sticky bottom-0 z-10 bg-bg-section border-t-2 border-navy/20";
const TF = `px-2 py-2 leading-4 text-right text-[12px] whitespace-nowrap ${STICKY_FOOT}`;

export default function QualityE2ETable() {
  // The header's range, not a month picker of its own. Two date controls on one
  // page is two answers to "what am I looking at", and the header's is the one
  // every other screen here obeys.
  const from = useDateFilter((x) => x.apiFrom);
  const to = useDateFilter((x) => x.apiTo);

  const [q2, setQ2] = useState("");
  const [onlyOut, setOnlyOut] = useState(false);
  const [tol, setTol] = useState<Record<Param, number>>(DEFAULT_TOLERANCE);
  const [showTol, setShowTol] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [byStack, setByStack] = useState("");
  const [byGrade, setByGrade] = useState("");
  const [dest, setDest] = useState<string>(ALL_DEST);

  const q = useQuery<Resp>({
    queryKey: ["quality-e2e", from, to],
    queryFn: async () =>
      (await api.get("/quality-e2e", {
        params: { from_date: from, to_date: to },
      })).data,
    staleTime: 5 * 60 * 1000,
  });

  const dests = q.data?.destinations ?? [];

  // Newest despatch first — the row people come to this table for is the last
  // one, not the first. The API stays chronological for anything else reading it.
  const everything = useMemo(
    () => [...(q.data?.rows ?? [])].sort(
      (a, b) => b.date.localeCompare(a.date)
        || a.batch.localeCompare(b.batch)
        || a.destination.localeCompare(b.destination)),
    [q.data],
  );

  /**
   * One plant at a time, or both.
   *
   * Everything below — the flagged count, the ordering, the lean, the footer
   * — is computed from this and not from the whole response, because the two
   * plants are separate questions. A weighted average across both would
   * describe a shipment nobody made, and a lean pooled across both would hide
   * one plant's calibration drift inside the other's volume: Balasore is 85%
   * of the tonnage, so Jabamoyee could be badly out and never show.
   */
  const all = useMemo(
    () => (dest === ALL_DEST
      ? everything
      : everything.filter((r) => r.destination === dest)),
    [everything, dest],
  );

  /** Per-plant headline figures, so both are legible without switching. */
  const byDest = useMemo(() => dests.map((d) => {
    const rs = everything.filter((r) => r.destination === d.key);
    const out = rs.filter((r) => PARAMS.some((pp) => {
      const v = r.variance[pp];
      return v != null && Math.abs(v) > tol[pp];
    }));
    return {
      ...d,
      rows: rs.length,
      trips: rs.reduce((n, r) => n + r.mines.trips, 0),
      qty: rs.reduce((n, r) => n + (r.mines.qty || 0), 0),
      flagged: out.length,
      unassayed: rs.filter((r) => r.mines.cr2o3 == null).length,
    };
  }), [everything, dests, tol]);

  /** Which parameters this consignment is out on. Empty means the two labs
   *  agree within tolerance on all four. */
  const outOn = useMemo(() => {
    const m = new Map<string, Param[]>();
    for (const r of all) {
      m.set(rowKey(r), PARAMS.filter((pp) => {
        const v = r.variance[pp];
        return v != null && Math.abs(v) > tol[pp];
      }));
    }
    return m;
  }, [all, tol]);

  const rows = useMemo(() => all.filter((r) => {
    const key = rowKey(r);
    if (onlyOut && (outOn.get(key)?.length ?? 0) === 0) return false;
    if (byStack && r.batch !== byStack) return false;
    if (byGrade && (r.grade ?? "") !== byGrade) return false;
    return matchesSearch(q2, [r.batch, r.grade, r.date]);
  }), [all, q2, onlyOut, outOn, byStack, byGrade]);

  /** The stacks and grades on offer, from what the selected plant actually
   *  shipped — not from every value the master holds, which would offer a
   *  grade that empties the table. */
  const stackOptions = useMemo(() => {
    const m = new Map<string, { trips: number; qty: number; days: number }>();
    for (const r of all) {
      const e = m.get(r.batch) ?? { trips: 0, qty: 0, days: 0 };
      e.trips += r.mines.trips;
      e.qty += r.mines.qty || 0;
      e.days += 1;
      m.set(r.batch, e);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].qty - a[1].qty)
      .map(([batch, e]) => ({
        value: batch, label: batch,
        // A stack is one row per despatch day per plant, so the count of
        // rows behind a stack is worth saying: picking it shows all of them.
        hint: e.days > 1 ? `${e.days} consignments` : undefined,
        meta: <span className="text-txt-light">{formatIndian(e.qty, 2)} MT</span>,
      }));
  }, [all]);

  const gradeOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) m.set(r.grade ?? "—", (m.get(r.grade ?? "—") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([g, n]) => ({
        value: g === "—" ? "" : g, label: g,
        meta: <span className="text-txt-light">{n}</span>,
      }));
  }, [all]);

  /** How many distinct stacks are behind the rows. One stack ships over
   *  several days and to both plants, so the count of consignments is not the
   *  count of stacks and saying only the first invites the wrong one. */
  const uniqueStacks = useMemo(
    () => new Set(rows.map((r) => r.batch)).size, [rows]);

  const flagged = all.filter(
    (r) => (outOn.get(rowKey(r))?.length ?? 0) > 0);

  /**
   * The ones worth ringing somebody about, worst first — and "worst" is how
   * far out TIMES how much ore it is about.
   *
   * Ordering by the variance alone put single-truck tails at the top. A stack
   * finishing with one truck of 11 MT that assays 2% apart is two labs
   * disagreeing about one truck; a 68-truck consignment of 800 MT that assays
   * 0.8% apart is eight hundred tonnes of ore whose grade is in dispute. The
   * second is the phone call, and it was sitting fourth.
   */
  const worst = useMemo(() => [...flagged].sort((a, b) => {
    const score = (r: Row) => Math.max(...PARAMS.map((pp) => {
      const v = r.variance[pp];
      return v == null ? 0 : Math.abs(v) / tol[pp];
    })) * (r.mines.qty || 0);
    return score(b) - score(a);
  }), [flagged, tol]);

  /** How much ore is under a disagreement. The count of rows says nothing
   *  about scale: five consignments can be 40 MT or 4,000. */
  const flaggedQty = flagged.reduce((n, r) => n + (r.mines.qty || 0), 0);
  const totalQty = all.reduce((n, r) => n + (r.mines.qty || 0), 0);

  const t = q.data?.totals?.[dest];

  /**
   * The reading of this period's own figures, not a paragraph about
   * tolerances in general.
   *
   * Three things somebody needs and cannot get by looking: which consignment
   * carries the most ore under dispute, how much contained chrome that is in
   * tonnes, and whether the disagreements point one way or scatter. The first
   * two size the problem; the third says whose problem it is — a consistent
   * direction across many consignments is a calibration question for the labs,
   * a scattered one is a sampling question for the stacks.
   */
  const destLabel = dest === ALL_DEST
    ? "both plants"
    : (dests.find((d) => d.key === dest)?.label ?? dest);

  const reading = useMemo(() => {
    if (!all.length) return null;
    const top = worst[0];

    // Contained Cr2O3 in dispute on the worst row: tonnes times the gap.
    const gap = top ? top.variance.cr2o3 : null;
    const contained = top && gap != null
      ? Math.abs(gap) / 100 * top.mines.qty : null;

    // Which way the plant reads on Cr2O3, across everything assayed — not
    // only the flagged ones, because a drift shows in the ordinary rows too.
    const withCr = all.filter((r) => r.variance.cr2o3 != null);
    const lower = withCr.filter((r) => (r.variance.cr2o3 as number) < 0).length;
    const higher = withCr.length - lower;
    const leans = withCr.length >= 5
      && Math.max(lower, higher) / withCr.length >= 0.75;

    return { top, gap, contained, lower, higher, withCr: withCr.length, leans };
  }, [all, worst]);

  const download = () => {
    const head = ["Date", "Stack", "Destination", "Grade", "Trips", "Qty MT",
      ...PARAMS.map((pp) => `Mines ${HEADS[pp]}`),
      ...PARAMS.map((pp) => `Plant ${HEADS[pp]}`),
      ...PARAMS.map((pp) => `Var ${HEADS[pp]}`), "Out of tolerance on"];
    const body = rows.map((r) => [
      r.date, r.batch,
      dests.find((d) => d.key === r.destination)?.label ?? r.destination,
      r.grade ?? "", r.mines.trips, r.mines.qty,
      ...PARAMS.map((pp) => r.mines[pp] ?? ""),
      ...PARAMS.map((pp) => r.plant[pp] ?? ""),
      ...PARAMS.map((pp) => r.variance[pp] ?? ""),
      (outOn.get(rowKey(r)) ?? []).map((pp) => HEADS[pp]).join(" "),
    ]);
    // Quoted throughout: a stack number is safe but a grade or a future column
    // may not be, and a CSV that breaks on one comma breaks silently.
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `end-to-end-quality-${dest.toLowerCase()}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="space-y-2">
      <div className="section-title">
        <GitCompareArrows size={13} />
        End-to-End Quality — Mine Despatch vs Plant Receipt
        <span className="text-[10px] text-txt-light font-medium normal-case tracking-normal ml-1">
          by stack · {from.split("-").reverse().join("-")} to{" "}
          {to.split("-").reverse().join("-")} · from the date at the top
        </span>
      </div>

      {/* BOTH PLANTS AT ONCE, AND THE TABLE FOR ONE.
          Ore leaves the same mine for two plants and they are separate
          questions — Balasore is 85% of the tonnage, so anything wrong at
          Jabamoyee would be invisible inside a pooled figure. Each tile
          carries the three things that say whether a plant needs attention:
          how much went, how many consignments are out of tolerance, and how
          many the mine has not assayed. Reading them needs no click, and no
          scrolling; selecting one narrows everything below. */}
      {!q.isLoading && byDest.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[{ key: ALL_DEST, label: "Both plants", plant: "" }, ...byDest].map((d) => {
            const s = byDest.find((x) => x.key === d.key);
            const on = dest === d.key;
            const rows_ = s ? s.rows : byDest.reduce((n, x) => n + x.rows, 0);
            const trips = s ? s.trips : byDest.reduce((n, x) => n + x.trips, 0);
            const qty = s ? s.qty : byDest.reduce((n, x) => n + x.qty, 0);
            const flag = s ? s.flagged : byDest.reduce((n, x) => n + x.flagged, 0);
            const blank = s ? s.unassayed : byDest.reduce((n, x) => n + x.unassayed, 0);
            return (
              <button key={d.key} type="button" onClick={() => setDest(d.key)}
                aria-pressed={on}
                className={`rounded-xl border px-3 py-2 text-left transition-colors
                  ${on ? "border-navy bg-navy text-white shadow-md"
                       : "border-border bg-white hover:border-navy/40"}`}>
                <div className="flex items-baseline gap-2">
                  <span className={`text-[12px] font-bold ${on ? "text-white" : "text-navy"}`}>
                    {d.label}
                  </span>
                  {s && (
                    <span className={`text-[9.5px] font-mono
                      ${on ? "text-white/60" : "text-txt-light"}`}>
                      plant {s.plant}
                    </span>
                  )}
                </div>
                <div className={`mt-0.5 flex items-baseline gap-2 text-[11px] tabular-nums
                  ${on ? "text-white/85" : "text-txt-muted"}`}>
                  <span className="font-semibold">{formatIndian(qty, 2)} MT</span>
                  <span>{trips} trips</span>
                  <span>{rows_} cons.</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                  <span className={flag
                    ? (on ? "text-rose-200 font-semibold" : "text-rose font-semibold")
                    : (on ? "text-emerald-200" : "text-emerald")}>
                    {flag ? `${flag} out of tolerance` : "all within tolerance"}
                  </span>
                  {blank > 0 && (
                    <span className={on ? "text-white/60" : "text-txt-light"}>
                      · {blank} unassayed
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* The answer, before the working.
          Thirty rows of four variances each is a hundred and twenty numbers,
          and the question anybody brings to this table is which of them needs
          a phone call. Leaving that to be found by scanning is what made this
          a report rather than a tool. */}
      {!q.isLoading && all.length > 0 && (
        <div className={`rounded-xl border px-4 py-3 ${
          flagged.length
            ? "border-rose-ring bg-rose-bg/40"
            : "border-emerald-ring bg-emerald-bg/40"}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* The icon is the way in to the explanation, because it is the
                thing somebody looks at when they do not understand the card. */}
            <button type="button" onClick={() => setShowHelp((v) => !v)}
              title="What is this card saying?"
              className={`rounded-full p-0.5 transition-colors ${
                flagged.length
                  ? "text-rose hover:bg-rose/10"
                  : "text-emerald hover:bg-emerald/10"}`}>
              <AlertTriangle className="w-4 h-4" />
            </button>
            <span className="text-[13px] font-bold text-navy">
              {flagged.length === 0
                ? `All ${all.length} consignments agree within tolerance`
                : `${flagged.length} of ${all.length} consignment`
                  + `${all.length === 1 ? "" : "s"} outside tolerance`}
            </span>
            {flagged.length > 0 && (
              // The tonnage, because the count says nothing about scale.
              <span className="text-[11.5px] text-txt-muted">
                {formatIndian(flaggedQty, 2)} MT of {formatIndian(totalQty, 2)}
                {" "}({Math.round((flaggedQty / (totalQty || 1)) * 100)}%)
              </span>
            )}
            {flagged.length > 0 && (
              <button type="button" onClick={() => setOnlyOut((v) => !v)}
                className="text-[11.5px] font-semibold text-gold-dark hover:underline
                           underline-offset-2">
                {onlyOut ? "show them all" : "show only those"}
              </button>
            )}
            <span className="ml-auto flex items-center gap-3">
              <button type="button" onClick={() => setShowHelp((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px]
                           text-txt-muted hover:text-navy">
                <HelpCircle className="w-3.5 h-3.5" />
                how to read this
              </button>
              <button type="button" onClick={() => setShowTol((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px]
                           text-txt-muted hover:text-navy">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                tolerance
              </button>
            </span>
          </div>

          {showHelp && reading && (
            <div className="mt-2 rounded-lg border border-border-light bg-white/70
                            px-3 py-2.5 text-[11.5px] leading-relaxed space-y-2">
              <div className="flex items-start gap-2">
                <HelpCircle className="w-3.5 h-3.5 text-txt-light shrink-0 mt-0.5" />
                <span className="font-bold text-navy">
                  What this card is saying
                </span>
                <button type="button" onClick={() => setShowHelp(false)}
                  className="ml-auto rounded p-0.5 text-txt-light hover:text-navy">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-txt-muted">
                The mine&apos;s lab assays a stack before it leaves; the receiving
                plant assays the same material on arrival. Over{" "}
                {from.split("-").reverse().join("-")} to{" "}
                {to.split("-").reverse().join("-")}, <b className="text-navy">
                {all.length} consignments</b> went to{" "}
                <b className="text-navy">{destLabel}</b> —{" "}
                {formatIndian(totalQty, 2)} MT. On{" "}
                <b className="text-navy">{flagged.length}</b> of them the two
                labs differ by more than they usually do.
              </p>

              {reading.top && (
                <p className="text-txt-muted">
                  <b className="text-navy">The one that matters most</b> is{" "}
                  <span className="font-mono font-semibold text-navy">
                    {reading.top.batch}
                  </span>{" "}
                  on {reading.top.date.split("-").reverse().join("-")}:{" "}
                  {formatIndian(reading.top.mines.qty, 2)} MT in{" "}
                  {reading.top.mines.trips} trips.
                  {reading.gap != null && (
                    <>
                      {" "}The plant assayed Cr<sub>2</sub>O<sub>3</sub> at{" "}
                      <b className="text-navy">
                        {formatIndian(reading.top.plant.cr2o3 as number, 2)}
                      </b>{" "}against the mine&apos;s{" "}
                      <b className="text-navy">
                        {formatIndian(reading.top.mines.cr2o3 as number, 2)}
                      </b>{" "}— {formatIndian(Math.abs(reading.gap), 2)}{" "}
                      {reading.gap < 0 ? "lower" : "higher"}. On that tonnage
                      it is about{" "}
                      <b className="text-navy">
                        {formatIndian(reading.contained as number, 1)} MT
                      </b>{" "}of contained chrome in dispute.
                    </>
                  )}
                  {" "}Ordered by tonnage, not by how far apart the labs are: a
                  single truck out by 2% is two labs arguing about one truck.
                </p>
              )}

              {/* The direction across everything assayed, not only the
                  flagged rows — a drift shows in the ordinary ones too. */}
              <p className="text-txt-muted">
                <b className="text-navy">Which way it leans.</b> Of{" "}
                {reading.withCr} consignments the plant has assayed, it read
                LOWER on Cr<sub>2</sub>O<sub>3</sub> on{" "}
                <b className="text-navy">{reading.lower}</b> and higher on{" "}
                <b className="text-navy">{reading.higher}</b>.{" "}
                {reading.leans
                  ? "That is one-sided enough to be worth asking the labs about "
                    + "calibration, rather than looking at individual stacks."
                  : "That is scattered, so it reads as sampling rather than as "
                    + "one lab drifting — how the stack was mixed and when the "
                    + "sample was taken."}
              </p>

              <p className="text-txt-light">
                Colour marks disagreement, not good or bad. Variance is Plant
                minus Mines: on Cr<sub>2</sub>O<sub>3</sub> a positive is good
                for the mine, on moisture a positive means weight was paid for
                that was water. The sign says which way; the tolerance says
                whether it is unusual.
              </p>
            </div>
          )}

          {worst.length > 0 && (
            // The tiles above now carry the headline for each plant, so this list is
            // the detail rather than the summary. Shortened from 13rem to keep the
            // whole section — tiles, card and ten table rows — inside one screen.
            <div className="mt-2 space-y-0.5 max-h-[8.5rem] overflow-y-auto pr-1">
              {worst.map((r) => {
                const bad = outOn.get(rowKey(r)) ?? [];
                return (
                  <div key={rowKey(r)}
                    className="grid grid-cols-[7.5rem_5.5rem_2.2rem_6rem_1fr]
                               gap-x-2 items-baseline text-[11.5px] py-0.5
                               border-t border-rose-ring/30 first:border-0">
                    <span className="font-mono font-semibold text-navy truncate">
                      {r.batch}
                    </span>
                    <span className="text-txt-muted tabular-nums">
                      {r.date.split("-").reverse().join("-")}
                    </span>
                    <span className="text-[10px] text-txt-light">{r.grade ?? "—"}</span>
                    {/* Right-aligned so the tonnages line up on the decimal —
                        this is the column the list is ordered by and the one
                        somebody is comparing. */}
                    <span className="text-right font-semibold text-navy tabular-nums">
                      {formatIndian(r.mines.qty, 2)}
                      <span className="text-[9.5px] font-normal text-txt-light"> MT</span>
                    </span>
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {bad.map((pp) => {
                        const v = r.variance[pp] as number;
                        return (
                          <span key={pp} className="whitespace-nowrap">
                            <span className="text-txt-light">{HEADS[pp]}</span>{" "}
                            <span className="font-mono font-bold text-rose">
                              {v > 0 ? "+" : ""}{formatIndian(v, DP[pp])}
                            </span>
                          </span>
                        );
                      })}
                      <span className="text-[10px] text-txt-light">
                        · {r.mines.trips} trip{r.mines.trips === 1 ? "" : "s"}
                      </span>
                    </span>
                  </div>
                );
              })}

            </div>
          )}

          {/* Editable, and on the screen rather than buried in the code,
              because these are measured from this mine's own history and not
              a standard anybody has signed off. */}
          {showTol && (
            <div className="mt-2 pt-2 border-t border-border-light flex flex-wrap
                            items-end gap-3">
              {PARAMS.map((pp) => (
                <label key={pp} className="block">
                  <span className="block text-[10px] font-semibold text-txt-secondary">
                    {HEADS[pp]}
                  </span>
                  <input type="number" step={0.01} min={0} value={tol[pp]}
                    onChange={(e) => setTol({ ...tol, [pp]: Number(e.target.value) })}
                    className="w-[74px] text-[12px] border border-border rounded
                               px-2 py-0.5 text-navy focus:outline-none
                               focus:border-gold" />
                </label>
              ))}
              <span className="text-[10.5px] text-txt-light max-w-[440px]">
                Set near the ninetieth percentile of 106 consignments, July to
                September 2026 — about one in ten is flagged. A starting point
                measured here, not a standard; the lab should confirm them.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl overflow-hidden border border-border shadow-md bg-white">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light
                        bg-bg-soft flex-wrap">
          <span className="relative">
            <Search className="w-3.5 h-3.5 text-txt-light absolute left-2
                               top-1/2 -translate-y-1/2" />
            <input value={q2} onChange={(e) => setQ2(e.target.value)}
              placeholder="Stack number, grade, date…"
              className="w-[240px] text-[12px] border border-border rounded
                         pl-7 pr-2 py-1 text-navy placeholder:text-txt-light
                         focus:outline-none focus:border-gold" />
          </span>
          {(q2 || onlyOut || byStack || byGrade) && (
            <button type="button"
              onClick={() => { setQ2(""); setOnlyOut(false);
                               setByStack(""); setByGrade(""); }}
              className="text-[11.5px] font-semibold text-gold-dark hover:underline">
              Clear
            </button>
          )}
          <button type="button" onClick={download} disabled={rows.length === 0}
            title="What is on screen, as a spreadsheet"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold
                       text-txt-muted hover:text-navy disabled:opacity-40">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <span className="text-[10px] text-txt-light/70 ml-auto">
            {q.isLoading ? "Loading…"
              : `${rows.length}${rows.length !== all.length ? ` of ${all.length}` : ""}`
                + ` consignment${rows.length === 1 ? "" : "s"}`
                + ` · ${uniqueStacks} stack${uniqueStacks === 1 ? "" : "s"}`}
            {" · matched on batch number"}
          </span>
        </div>

        {q.isLoading ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-6 bg-bg-section animate-pulse rounded" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="p-4 text-[12px] text-danger">
            Could not load end-to-end quality.
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-txt-light">
            {dest === ALL_DEST
              ? "No despatches in this period."
              : `No despatches to ${dests.find((d) => d.key === dest)?.label ?? dest}`
                + " in this period."}
          </div>
        ) : (
          <div
            className="overflow-auto"
            style={{ maxHeight: rows.length > VISIBLE_ROWS ? WINDOW_H : undefined }}
          >
            <table className={`w-full border-collapse ${dest === ALL_DEST ? "min-w-[1160px]" : "min-w-[1080px]"}`}>
              <thead>
                <tr className="text-white" style={{ height: HEAD_H }}>
                  <th className={`${TH} ${STICKY_1} text-left`}>Date</th>
                  <th className={`${TH} ${STICKY_1} text-left`}>Stack No.</th>
                  {dest === ALL_DEST && (
                    <th className={`${TH} ${STICKY_1} text-left`}>To</th>
                  )}
                  <th className={`${TH} ${STICKY_1} text-left`}>Grade</th>
                  <th className={`${TH} ${STICKY_1} text-right`}>Trips</th>
                  <th className={`${TH} ${STICKY_1} text-right border-r border-white/20`}
                    >
                    Qty&nbsp;(MT)
                  </th>
                  <th className={`${TH} ${STICKY_1} text-center border-r border-white/20`}
                    colSpan={4}>
                    Mines Analysis
                  </th>
                  <th className={`${TH} ${STICKY_1} text-center border-r border-white/20`}
                    colSpan={4}>
                    Plant Analysis
                  </th>
                  <th className={`${TH} ${STICKY_1} text-center`} colSpan={4}>Variation</th>
                </tr>
                <tr className="text-white/90" style={{ height: HEAD2_H }}>
                  {/* The five left columns held one word each across two
                      header rows, so this row under them was empty navy. The
                      assay columns need the second row; these did not, and
                      the space was there either way.

                      Stack and grade only: those are the two with a small set
                      of values somebody picks from. The date is already
                      bounded by the header's range, and a dropdown of every
                      distinct tonnage is a list of every row — which is the
                      table you are already looking at. */}
                  <th style={{ top: HEAD_H }} className={`${STICKY_2} px-2`} />
                  <th style={{ top: HEAD_H }} className={`${STICKY_2} px-1.5 pb-1`}>
                    <SearchSelect narrow value={byStack} onChange={setByStack}
                      allLabel="All stacks" options={stackOptions}
                      searchPlaceholder="Type a stack number…"
                      className="w-full bg-white/10 border-white/25 text-white
                                 font-normal hover:border-white/50" />
                  </th>
                  {/* The same selection the tiles above make, in the column
                      it belongs to.
                      
                      Not a second piece of state: it reads and writes `dest`,
                      so the tile and this can never disagree. The tiles carry
                      the figures that say whether a plant needs looking at;
                      this is for somebody already in the table who does not
                      want to go back up to change it. */}
                  {dests.length > 1 && (
                    <th style={{ top: HEAD_H }} className={`${STICKY_2} px-1.5 pb-1`}>
                      <SearchSelect narrow value={dest === ALL_DEST ? "" : dest}
                        allLabel="Both plants" allValue=""
                        onChange={(v) => setDest(v || ALL_DEST)}
                        searchPlaceholder="Type a plant…"
                        options={dests.map((d) => ({
                          value: d.key, label: d.label,
                          hint: d.plant ? `plant ${d.plant}` : undefined,
                        }))}
                        className="w-full bg-white/10 border-white/25 text-white
                                   font-normal hover:border-white/50" />
                    </th>
                  )}
                  <th style={{ top: HEAD_H }} className={`${STICKY_2} px-1.5 pb-1`}>
                    <SearchSelect narrow value={byGrade} onChange={setByGrade}
                      allLabel="All grades" options={gradeOptions}
                      searchPlaceholder="Type a grade…"
                      className="w-full bg-white/10 border-white/25 text-white
                                 font-normal hover:border-white/50" />
                  </th>
                  <th style={{ top: HEAD_H }} className={`${STICKY_2} px-2`} />
                  <th style={{ top: HEAD_H }}
                    className={`${STICKY_2} px-2 border-r border-white/20`} />
                  {SUB_HEADS.map(({ key, label, edge }) => (
                    <th
                      key={key}
                      style={{ top: HEAD_H }}
                      className={`${TH} ${STICKY_2} text-right font-bold tracking-normal
                        ${edge ? "border-r border-white/20" : ""}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={rowKey(r)}
                    style={{ height: ROW_H }}
                    className="border-b border-border-light last:border-0 hover:bg-bg-soft/60"
                  >
                    <td className="px-2 py-2 leading-4 text-[12px] whitespace-nowrap text-txt-primary">
                      {r.date.slice(8, 10)}.{r.date.slice(5, 7)}.{r.date.slice(2, 4)}
                    </td>
                    <td className="px-2 py-2 leading-4 text-[12px] font-mono text-txt-primary whitespace-nowrap">
                      {r.batch}
                    </td>
                    {dest === ALL_DEST && (
                      <td className="px-2 py-2 leading-4 text-[12px]">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px]
                          font-bold tracking-wide ${r.destination === "BAL"
                            ? "bg-navy/10 text-navy" : "bg-gold/15 text-gold-dark"}`}>
                          {dests.find((d) => d.key === r.destination)?.label
                            ?? r.destination}
                        </span>
                      </td>
                    )}
                    <td className="px-2 py-2 leading-4 text-[12px]">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-bg-section
                                       text-[10px] font-bold text-txt-muted tracking-wide">
                        {r.grade ?? "—"}
                      </span>
                    </td>
                    <td className={TD}>
                      <span className="font-mono text-navy">{r.mines.trips}</span>
                    </td>
                    <td className={`${TD} border-r border-border-light`}>
                      <span className="font-mono font-bold text-navy">
                        {formatIndian(r.mines.qty, 2)}
                      </span>
                    </td>

                    {PARAMS.map((p, i) => (
                      <td key={`m-${p}`}
                        className={`${TD} ${i === 3 ? "border-r border-border-light" : ""}`}>
                        <Val v={r.mines[p]} dp={DP[p]} />
                      </td>
                    ))}
                    {PARAMS.map((p, i) => (
                      <td key={`p-${p}`}
                        className={`${TD} ${i === 3 ? "border-r border-border-light" : ""}`}>
                        <Val v={r.plant[p]} dp={DP[p]} />
                      </td>
                    ))}
                    {PARAMS.map((pp) => (
                      <td key={`v-${pp}`} className={TD}>
                        <Var v={r.variance[pp]} dp={DP[pp]} tol={tol[pp]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {t && (
                <tfoot>
                  <tr style={{ height: ROW_H }}>
                    <td className={`px-2 py-2 leading-4 text-[11px] font-condensed font-extrabold
                                   tracking-[.1em] text-navy text-left ${STICKY_FOOT}`}
                      colSpan={dest === ALL_DEST ? 4 : 3}>
                      WTD AVG
                    </td>
                    <td className={TF}>
                      <span className="font-mono font-bold text-navy">{t.trips}</span>
                    </td>
                    <td className={`${TF} border-r border-border-light`}>
                      <span className="font-mono font-bold text-navy">
                        {formatIndian(t.mines_qty, 2)}
                      </span>
                    </td>
                    {PARAMS.map((p, i) => (
                      <td key={`tm-${p}`}
                        className={`${TF} ${i === 3 ? "border-r border-border-light" : ""}`}>
                        <Val v={t[`mines_${p}`] as number | null} dp={DP[p]} />
                      </td>
                    ))}
                    {PARAMS.map((p, i) => (
                      <td key={`tp-${p}`}
                        className={`${TF} ${i === 3 ? "border-r border-border-light" : ""}`}>
                        <Val v={t[`plant_${p}`] as number | null} dp={DP[p]} />
                      </td>
                    ))}
                    {PARAMS.map((p) => (
                      <td key={`tv-${p}`} className={TF}>
                        <Var v={t[`var_${p}`] as number | null} dp={DP[p]} />
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <div className="border-t border-border-light px-3 py-1 flex items-center justify-between flex-wrap gap-1">
          <span className="text-[10px] text-txt-light/60">
            Variation = Plant − Mines · <span className="text-success font-bold">green</span> is
            higher at the plant, <span className="text-danger font-bold">red</span> is lower
          </span>
          <span className="text-[9px] text-txt-light/50">
            Blank = not yet assayed, and fills in on its own · qty and trips are the despatched figures
          </span>
        </div>
      </div>
    </section>
  );
}
