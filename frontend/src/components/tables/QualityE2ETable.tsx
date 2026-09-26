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
import { GitCompareArrows, Search, Download, AlertTriangle, SlidersHorizontal } from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import { useDateFilter } from "@/contexts/useDateFilter";

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
  mines: Side;
  plant: Side;
  variance: Omit<Side, "trips"> & { trips: number };
}
interface Totals {
  trips: number;
  mines_qty: number;
  [k: string]: number | null;
}
interface Resp { from: string; to: string; rows: Row[]; totals: Totals }

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
const HEAD_H = 28;   // px, per header row — matches `h-7`
const ROW_H = 33;    // px, one body row at py-2 plus its border
const VISIBLE_ROWS = 10;
const WINDOW_H = HEAD_H * 2 + ROW_H * (VISIBLE_ROWS + 1); // + the WTD AVG row

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

  const q = useQuery<Resp>({
    queryKey: ["quality-e2e", from, to],
    queryFn: async () =>
      (await api.get("/quality-e2e", {
        params: { from_date: from, to_date: to },
      })).data,
    staleTime: 5 * 60 * 1000,
  });

  // Newest despatch first — the row people come to this table for is the last
  // one, not the first. The API stays chronological for anything else reading it.
  const all = useMemo(
    () => [...(q.data?.rows ?? [])].sort(
      (a, b) => b.date.localeCompare(a.date) || a.batch.localeCompare(b.batch)),
    [q.data],
  );

  /** Which parameters this consignment is out on. Empty means the two labs
   *  agree within tolerance on all four. */
  const outOn = useMemo(() => {
    const m = new Map<string, Param[]>();
    for (const r of all) {
      m.set(`${r.date}-${r.batch}`, PARAMS.filter((pp) => {
        const v = r.variance[pp];
        return v != null && Math.abs(v) > tol[pp];
      }));
    }
    return m;
  }, [all, tol]);

  const rows = useMemo(() => all.filter((r) => {
    const key = `${r.date}-${r.batch}`;
    if (onlyOut && (outOn.get(key)?.length ?? 0) === 0) return false;
    return matchesSearch(q2, [r.batch, r.grade, r.date]);
  }), [all, q2, onlyOut, outOn]);

  const flagged = all.filter(
    (r) => (outOn.get(`${r.date}-${r.batch}`)?.length ?? 0) > 0);

  /** The worst disagreement on each row, for the summary — a consignment out
   *  on one parameter by a lot matters more than one out on two by a little. */
  const worst = useMemo(() => [...flagged].sort((a, b) => {
    const score = (r: Row) => Math.max(...PARAMS.map((pp) => {
      const v = r.variance[pp];
      return v == null ? 0 : Math.abs(v) / tol[pp];
    }));
    return score(b) - score(a);
  }).slice(0, 4), [flagged, tol]);

  const t = q.data?.totals;

  const download = () => {
    const head = ["Date", "Stack", "Grade", "Trips", "Qty MT",
      ...PARAMS.map((pp) => `Mines ${HEADS[pp]}`),
      ...PARAMS.map((pp) => `Plant ${HEADS[pp]}`),
      ...PARAMS.map((pp) => `Var ${HEADS[pp]}`), "Out of tolerance on"];
    const body = rows.map((r) => [
      r.date, r.batch, r.grade ?? "", r.mines.trips, r.mines.qty,
      ...PARAMS.map((pp) => r.mines[pp] ?? ""),
      ...PARAMS.map((pp) => r.plant[pp] ?? ""),
      ...PARAMS.map((pp) => r.variance[pp] ?? ""),
      (outOn.get(`${r.date}-${r.batch}`) ?? []).map((pp) => HEADS[pp]).join(" "),
    ]);
    // Quoted throughout: a stack number is safe but a grade or a future column
    // may not be, and a CSV that breaks on one comma breaks silently.
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `end-to-end-quality-${from}-to-${to}.csv`;
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
            <AlertTriangle className={`w-4 h-4 ${
              flagged.length ? "text-rose" : "text-emerald"}`} />
            <span className="text-[13px] font-bold text-navy">
              {flagged.length === 0
                ? `All ${all.length} consignments agree within tolerance`
                : `${flagged.length} of ${all.length} consignment`
                  + `${all.length === 1 ? "" : "s"} outside tolerance`}
            </span>
            {flagged.length > 0 && (
              <button type="button" onClick={() => setOnlyOut((v) => !v)}
                className="text-[11.5px] font-semibold text-gold-dark hover:underline
                           underline-offset-2">
                {onlyOut ? "show them all" : "show only those"}
              </button>
            )}
            <button type="button" onClick={() => setShowTol((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 text-[11px]
                         text-txt-muted hover:text-navy">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              tolerance
            </button>
          </div>

          {worst.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {worst.map((r) => (
                <div key={`${r.date}-${r.batch}`} className="text-[11.5px]">
                  <span className="font-mono font-semibold text-navy">{r.batch}</span>
                  <span className="text-txt-muted">
                    {" "}on {r.date.split("-").reverse().join("-")}
                    {r.grade ? ` (${r.grade})` : ""} —{" "}
                    {(outOn.get(`${r.date}-${r.batch}`) ?? []).map((pp) => {
                      const v = r.variance[pp] as number;
                      return `${HEADS[pp]} ${v > 0 ? "+" : ""}${formatIndian(v, DP[pp])}`;
                    }).join(", ")}
                  </span>
                </div>
              ))}
              {flagged.length > worst.length && (
                <div className="text-[11px] text-txt-light">
                  and {flagged.length - worst.length} more
                </div>
              )}
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
          {(q2 || onlyOut) && (
            <button type="button"
              onClick={() => { setQ2(""); setOnlyOut(false); }}
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
                + ` consignment${rows.length === 1 ? "" : "s"}`}
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
            No despatches to Balasore in this period.
          </div>
        ) : (
          <div
            className="overflow-auto"
            style={{ maxHeight: rows.length > VISIBLE_ROWS ? WINDOW_H : undefined }}
          >
            <table className="w-full border-collapse min-w-[1080px]">
              <thead>
                <tr className="text-white" style={{ height: HEAD_H }}>
                  <th className={`${TH} ${STICKY_1} text-left`} rowSpan={2}>Date</th>
                  <th className={`${TH} ${STICKY_1} text-left`} rowSpan={2}>Stack No.</th>
                  <th className={`${TH} ${STICKY_1} text-left`} rowSpan={2}>Grade</th>
                  <th className={`${TH} ${STICKY_1} text-right`} rowSpan={2}>Trips</th>
                  <th className={`${TH} ${STICKY_1} text-right border-r border-white/20`}
                    rowSpan={2}>
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
                <tr className="text-white/90" style={{ height: HEAD_H }}>
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
                    key={`${r.date}-${r.batch}`}
                    style={{ height: ROW_H }}
                    className="border-b border-border-light last:border-0 hover:bg-bg-soft/60"
                  >
                    <td className="px-2 py-2 leading-4 text-[12px] whitespace-nowrap text-txt-primary">
                      {r.date.slice(8, 10)}.{r.date.slice(5, 7)}.{r.date.slice(2, 4)}
                    </td>
                    <td className="px-2 py-2 leading-4 text-[12px] font-mono text-txt-primary whitespace-nowrap">
                      {r.batch}
                    </td>
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
                      colSpan={3}>
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
