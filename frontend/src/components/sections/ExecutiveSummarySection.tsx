"use client";
/**
 * Mines Executive Summary — the mine's daily report, one screen.
 *
 * ── HOW IT IS MEANT TO BE READ ───────────────────────────────────────────────
 * Tiles first, then the detail that supports them. Somebody opening this before
 * a morning meeting wants four numbers; everything below exists to answer the
 * question those four provoke.
 *
 * COLOUR CARRIES MEANING, NOT DECORATION. One hue per grade, the same hue in
 * every table, so HG is recognised before it is read. The percentage columns
 * stay neutral — red and green on this page would be read as good and bad, and
 * a grade is neither.
 *
 * ZEROS ARE DIMMED, BLANKS ARE DASHED, AND THE TWO ARE NOT THE SAME. Most cells
 * on the stock grid are legitimately nought and drown the handful that matter,
 * so a zero is drawn faint and a real figure in navy. A dash means nobody
 * recorded the number — see the footnote for the four that are permanently
 * dashed, each of which fills itself when the data starts arriving.
 *
 * TYPOGRAPHY FOLLOWS MARKET WATCH'S ROYALTY TABLE, at the mine's instruction:
 * tables are `text-[12px] tabular-nums` -- the page's own sans face, with the
 * digits on a fixed advance so they still line up down a column. They were
 * `font-mono`, which set every cell in IBM Plex Mono and made these tables
 * read as a different document from the rest of the dashboard. Headings stay
 * `font-condensed tracking-widest uppercase`.
 *
 * TWO AS-ON DATES, A DAY APART ON PURPOSE. The mine's sheet is headed "Stock
 * Position as on 6 Oct" and "Performance as on 5 Oct", which looks like an
 * error and is not: stock is counted at the START of a day, so the snapshot
 * dated the 6th is what the 5th's work left behind. Both are printed, so nobody
 * has to remember the rule to read the page.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList, Package, Truck, Factory, Pickaxe, ShieldCheck, Send,
} from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { useDateFilter } from "@/contexts/useDateFilter";
import type {
  ExecutiveSummaryResponse, ExecGradeRow, ExecWeightedTotal, ExecPlantRow,
} from "@/types";

/* ── one hue per grade, used in every table on the page ─────────────────── */
const GRADE_TONE: Record<string, { chip: string; text: string }> = {
  HG:        { chip: "bg-emerald-bg text-emerald ring-1 ring-emerald-ring", text: "text-emerald" },
  MG:        { chip: "bg-sky-bg text-sky ring-1 ring-sky-ring",             text: "text-sky" },
  LG:        { chip: "bg-amber-bg text-amber ring-1 ring-amber-ring",       text: "text-amber" },
  COB:       { chip: "bg-violet-bg text-violet ring-1 ring-violet-ring",    text: "text-violet" },
  UNASSAYED: { chip: "bg-slate-bg text-slate ring-1 ring-slate-ring",       text: "text-slate" },
};
const tone = (k: string) => GRADE_TONE[k] ?? GRADE_TONE.UNASSAYED;

/* LIGHT HEADERS, not the navy bars this first carried. A dark card header with
   a dark table header stacked under it put two heavy bands above every table
   and made the page read as chrome with figures squeezed between. The house
   pattern — white card header, pale grey column header — is what the OEE and
   Plant Output tables use, and the figures are what should carry the weight. */
/* RULED LIKE A SPREADSHEET, at the mine's instruction. The tables carried
   horizontal rules only, so the eye had nothing to follow across a row of
   eleven columns and the Location block in particular read as a drift of
   figures. Every cell is now boxed, which is what the sheet this page
   reproduces looks like on the desk it is printed from.

   border-collapse is already set on each table, so adjacent borders merge into
   one line rather than doubling into a 2px ladder. Rows tighten from py-2 to
   py-1.5 because a grid adds its own visual weight and the old spacing with
   lines through it reads loose. */
const CELL = "border border-border-light";
/* THE TWO PERIODS READ AS TWO TABLES, so they are separated like two tables.
   A single ruled grid running TD straight into MTD meant the eye crossed the
   boundary without noticing it, which is the one mistake this page must not
   invite: the columns on either side carry identical names. The gutter takes
   no border of its own — the ruled cells on each side draw its edges — so it
   reads as the gap between two sheets rather than as an empty column. */
const GAP = "w-4 min-w-[16px] p-0 border-0 bg-bg-soft";
const TH   = "px-3 py-2 text-[10px] font-condensed font-bold tracking-widest "
  + "uppercase text-txt-secondary " + CELL;
const THEAD = "bg-bg-section";
const TD   = "px-3 py-1.5 " + CELL;
/* The MTD half of every table sits on a faint tint. Two periods side by side
   with identical columns is the easiest place on this page to read a figure
   off the wrong one, and a rule alone is too quiet to stop it. */
const MTD_BG = "bg-bg-light";

/* ── numbers ───────────────────────────────────────────────────────────── */
/** Decimals only where there are decimals.
 *
 *  Stock and production are booked in whole tonnes, so a column of 5,559.00,
 *  3,052.00, 500.00 spends three characters per row saying nothing. The
 *  fraction is kept the moment one exists — an assay reads 42.97 and a royalty
 *  4,852.04 — so nothing is rounded away, it is only not printed when it is
 *  not there.
 *
 *  Rounded FIRST and tested after: 2,999.999 must print as 3,000 rather than
 *  as a whole number that disagrees with its own total. */
function N({ v, dp = 2, strong }: { v?: number | null; dp?: number; strong?: boolean }) {
  if (v === null || v === undefined)
    return <span className="text-txt-light/40">—</span>;
  if (v === 0)
    return <span className="text-txt-light/45">0</span>;
  const r = Number(v.toFixed(dp));
  return (
    <span className={strong ? "font-bold text-navy" : "text-txt-primary"}>
      {formatIndian(r, Number.isInteger(r) ? 0 : dp)}
    </span>
  );
}

/** "11 Oct" — enough to say which day without repeating the year in a heading
 *  that already sits under one. */
function shortDay(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/* A borrowed grade is marked where it is READ, not only in a footnote. The
   figure sits in a column of measured ones and is indistinguishable from them;
   a reader who takes the number and leaves never sees a note at the bottom.
   The glyph is ≈ — "approximately" — and carries the share and the tonnage in
   its tooltip, so hovering answers "how much of this?" without another screen. */
function Est({ pct, qty }: { pct?: number | null; qty?: number | null }) {
  if (!pct) return null;
  const t = qty
    ? `${pct}% of this row's graded tonnage (${formatIndian(qty, 2)} MT) has no assay of `
      + `its own yet — the grade shown is its purchase order's average`
    : `${pct}% of this row's graded tonnage has no assay of its own yet — `
      + `the grade shown is its purchase order's average`;
  return (
    <span
      title={t}
      className="ml-1 align-super text-[9px] font-bold text-amber-600 cursor-help select-none"
      aria-label={t}
    >
      ≈
    </span>
  );
}

function niceDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/* ── chrome ────────────────────────────────────────────────────────────── */
function Card({ icon, title, sub, children }: {
  icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2 flex-wrap">
        <span className="text-steel">{icon}</span>
        <h3 className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          {title}
        </h3>
        {sub && <span className="text-[10px] tabular-nums text-txt-light ml-auto">{sub}</span>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Tile({ label, value, unit, sub, accent, strong }: {
  label: string; value: number | null | undefined; unit: string;
  sub?: string; accent: string; strong?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${strong ? "bg-[#f5f9ff]" : "bg-white"}`}
         style={{ borderColor: strong ? accent : undefined }}>
      <div className="text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-muted">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-condensed font-extrabold text-[22px] leading-none"
              style={{ color: accent }}>
          {value === null || value === undefined ? "—" : formatIndian(value, 0)}
        </span>
        <span className="text-[10px] text-txt-light">{unit}</span>
      </div>
      {sub && <div className="mt-1 text-[10px] text-txt-light tabular-nums truncate">{sub}</div>}
    </div>
  );
}

/* ── Block 1 · stock ───────────────────────────────────────────────────── */
function StockBlock({ d }: { d: ExecutiveSummaryResponse }) {
  const s = d.stock;
  const cg = s.clearance?.grades ?? [];
  const lc = s.location_grid?.columns ?? [];
  return (
    <Card icon={<Package size={14} />} title="Stock Position"
          sub={`as on ${niceDate(d.stock_as_on)}`}>
      {/* THE SAME GUTTER THE PERIOD TABLES USE. Clearance and Location are two
          separate statements about the same tonnage — one by what it is cleared
          for, one by where it sits — and they were divided by a single pixel,
          so the eye ran from the LG column straight into "Location & grade"
          as though it were a twelfth column of the first table. Sixteen
          pixels of page showing through says they are two sheets, and matches
          the gap between TD and MTD further down the page.

          The 1px rule is gone with it: the gap does that job now, and a line
          as well would just be the old divider with space around it. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 bg-bg-soft">
        {/* Clearance status */}
        <table className="w-full text-[12px] tabular-nums border-collapse bg-white">
          <thead>
            <tr className={THEAD}>
              <th className={`${TH} text-left min-w-[150px]`}>Mines Clearance Status</th>
              <th className={`${TH} text-center`}>UoM</th>
              <th className={`${TH} text-right`}>Total</th>
              {cg.map((g) => <th key={g.key} className={`${TH} text-right`}>{g.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {(s.clearance?.rows ?? []).map((r) => (
              <tr key={r.key}
                  className={r.is_total ? "bg-bg-section/70" : "hover:bg-bg-light"}>
                <td className={`${TD} font-condensed font-bold text-[11px] text-navy`}>{r.label}</td>
                <td className={`${TD} text-center text-[10px] text-txt-light`}>{r.uom}</td>
                <td className={`${TD} text-right`}><N v={r.total} strong /></td>
                {/* by_grade, NOT the row itself — the grade figures are nested a
                    level down, and reading r[key] gives undefined, which renders
                    as a dash while the Total column keeps working. */}
                {cg.map((g) => (
                  <td key={g.key} className={`${TD} text-right`}>
                    <N v={r.by_grade?.[g.key] ?? null} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Location & grade */}
        <table className="w-full text-[12px] tabular-nums border-collapse bg-white">
          <thead>
            <tr className={THEAD}>
              <th className={`${TH} text-left min-w-[150px]`}>Location &amp; Grade wise Stock</th>
              <th className={`${TH} text-center`}>UoM</th>
              {lc.map((c) => <th key={c.key} className={`${TH} text-right`}>{c.label}</th>)}
              <th className={`${TH} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(s.location_grid?.rows ?? []).map((r) => (
              <tr key={r.key}
                  className={r.is_total ? "bg-bg-section/70" : "hover:bg-bg-light"}>
                <td className={`${TD} font-condensed font-bold text-[11px] ${r.is_total ? "text-navy" : tone(r.key).text}`}>
                  {r.label}
                </td>
                <td className={`${TD} text-center text-[10px] text-txt-light`}>{r.uom}</td>
                {lc.map((c) => (
                  <td key={c.key} className={`${TD} text-right`}>
                    <N v={r.cells?.[c.key] ?? null} />
                  </td>
                ))}
                <td className={`${TD} text-right`}><N v={r.total} strong /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── Blocks 2-4 · a grade table, TD beside MTD ─────────────────────────── */
function GradeTable({ icon, title, sub, qtyLabel, tdLabel, mtdLabel,
                     td, mtd, tdTotal, mtdTotal }: {
  icon: React.ReactNode; title: string; sub: string; qtyLabel: string;
  /* The heading says WHICH day and WHICH span, not just "Today". The page is
     read a day or two in arrears — the mine files in arrears — so "Today" on a
     column holding the 11th, opened on the 12th, is simply wrong. */
  tdLabel: string; mtdLabel: string;
  td: ExecGradeRow[]; mtd: ExecGradeRow[];
  tdTotal?: ExecWeightedTotal; mtdTotal?: ExecWeightedTotal;
}) {
  /* Rows are keyed by grade and merged across the two periods, never zipped by
     index: a grade present in MTD but not TD — "Not yet assayed" is the live
     case — would otherwise shift every row below it onto the wrong line, with
     nothing on screen to show it had happened. */
  const keys: string[] = [];
  for (const r of [...td, ...mtd]) if (!keys.includes(r.grade)) keys.push(r.grade);
  const at = (rows: ExecGradeRow[], k: string) => rows.find((r) => r.grade === k);

  /* The footnote appears only when something on THIS table is estimated. A
     standing caveat printed under every table on every day is read once and
     then stops being read, which is the opposite of what it is for. */
  const estQty = (mtdTotal?.estimated_qty ?? 0) || 0;
  const estPct = mtdTotal?.estimated_pct ?? null;

  return (
    <Card icon={icon} title={title} sub={sub}>
      <table className="w-full text-[12px] tabular-nums border-collapse">
        <thead>
          <tr className={THEAD}>
            <th className={`${TH} text-left min-w-[130px]`} rowSpan={2}>Grade</th>
            <th className={`${TH} text-center border-l border-border text-steel`} colSpan={3}>
              {tdLabel}
            </th>
            <th className={GAP} rowSpan={2} aria-hidden />
            {/* The MTD half keeps its tint through BOTH header rows and the body.
                Two periods with identical column names side by side is the
                easiest place on this page to read a figure off the wrong one. */}
            <th className={`${TH} text-center border-l-2 border-border text-steel ${MTD_BG}`} colSpan={3}>
              {mtdLabel}
            </th>
          </tr>
          <tr className={THEAD}>
            <th className={`${TH} text-right border-l border-border`}>{qtyLabel}</th>
            <th className={`${TH} text-right`}>Cr/Fe</th>
            <th className={`${TH} text-right`}>Cr2O3 %</th>
            <th className={`${TH} text-right border-l-2 border-border ${MTD_BG}`}>{qtyLabel}</th>
            <th className={`${TH} text-right ${MTD_BG}`}>Cr/Fe</th>
            <th className={`${TH} text-right ${MTD_BG}`}>Cr2O3 %</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const a = at(td, k), b = at(mtd, k), t = tone(k);
            return (
              <tr key={k} className="hover:bg-bg-light">
                <td className={TD}>
                  <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold tracking-wide ${t.chip}`}>
                    {a?.label ?? b?.label ?? k}
                  </span>
                </td>
                <td className={`${TD} text-right border-l border-border-light`}><N v={a?.qty} strong /></td>
                <td className={`${TD} text-right`}><N v={a?.crfe} /></td>
                <td className={`${TD} text-right whitespace-nowrap`}>
                  <N v={a?.cr2o3} /><Est pct={a?.estimated_pct} qty={a?.estimated_qty} />
                </td>
                <td className={GAP} aria-hidden />
                <td className={`${TD} text-right border-l border-border ${MTD_BG}`}><N v={b?.qty} strong /></td>
                <td className={`${TD} text-right ${MTD_BG}`}><N v={b?.crfe} /></td>
                <td className={`${TD} text-right whitespace-nowrap ${MTD_BG}`}>
                  <N v={b?.cr2o3} /><Est pct={b?.estimated_pct} qty={b?.estimated_qty} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-bg-section border-t-2 border-border">
            <td className={`${TD} font-condensed font-extrabold tracking-widest uppercase text-[11px] text-navy`}>
              Weighted Avg
            </td>
            <td className={`${TD} text-right border-l border-border-light`}><N v={tdTotal?.qty} strong /></td>
            <td className={`${TD} text-right`}><N v={tdTotal?.crfe} strong /></td>
            <td className={`${TD} text-right whitespace-nowrap`}>
              <N v={tdTotal?.cr2o3} strong /><Est pct={tdTotal?.estimated_pct} qty={tdTotal?.estimated_qty} />
            </td>
            <td className={GAP} aria-hidden />
            <td className={`${TD} text-right border-l border-border`}><N v={mtdTotal?.qty} strong /></td>
            <td className={`${TD} text-right`}><N v={mtdTotal?.crfe} strong /></td>
            <td className={`${TD} text-right whitespace-nowrap`}>
              <N v={mtdTotal?.cr2o3} strong /><Est pct={mtdTotal?.estimated_pct} qty={mtdTotal?.estimated_qty} />
            </td>
          </tr>
        </tfoot>
      </table>

      {estPct ? (
        <p className="px-4 py-2.5 border-t border-border-light bg-amber-50/60
                      text-[10px] font-mono leading-relaxed text-amber-900">
          <span className="font-bold align-super text-[9px]">≈</span>{" "}
          <span className="font-bold">{estPct}%</span> of the month&rsquo;s graded
          tonnage ({formatIndian(estQty, 2)} MT) is still awaiting its own assay.
          Those loads carry their purchase order&rsquo;s average in the meantime,
          so the grade is an estimate, not a lab result — it settles as the lab
          files. Tonnage is unaffected.
        </p>
      ) : null}
    </Card>
  );
}

/* ── Block 5 · ferrochrome ─────────────────────────────────────────────── */
function PlantBlock({ statusTill, tdLabel, mtdLabel, td, mtd, tdTotal, mtdTotal }: {
  statusTill: string; tdLabel: string; mtdLabel: string;
  td: ExecPlantRow[]; mtd: ExecPlantRow[];
  tdTotal?: ExecWeightedTotal; mtdTotal?: ExecWeightedTotal;
}) {
  const names: string[] = [];
  for (const r of [...td, ...mtd]) if (!names.includes(r.plant)) names.push(r.plant);
  const at = (rows: ExecPlantRow[], n: string) => rows.find((r) => r.plant === n);
  return (
    <Card icon={<Factory size={14} />} title="Ferro Chrome Plant Performance"
          sub={statusTill}>
      <table className="w-full text-[12px] tabular-nums border-collapse">
        <thead>
          <tr className={THEAD}>
            <th className={`${TH} text-left min-w-[150px]`} rowSpan={2}>Plant</th>
            <th className={`${TH} text-center border-l border-border text-steel`} colSpan={2}>
              {tdLabel}
            </th>
            <th className={GAP} rowSpan={2} aria-hidden />
            <th className={`${TH} text-center border-l-2 border-border text-steel ${MTD_BG}`} colSpan={2}>
              {mtdLabel}
            </th>
          </tr>
          <tr className={THEAD}>
            <th className={`${TH} text-right border-l border-border`}>Production (MT)</th>
            <th className={`${TH} text-right`}>Cr %</th>
            <th className={`${TH} text-right border-l-2 border-border ${MTD_BG}`}>Production (MT)</th>
            <th className={`${TH} text-right ${MTD_BG}`}>Cr %</th>
          </tr>
        </thead>
        <tbody>
          {names.map((n) => {
            const a = at(td, n), b = at(mtd, n);
            return (
              <tr key={n} className="hover:bg-bg-light">
                <td className={`${TD} font-condensed font-bold text-[11px] text-navy`}>{n}</td>
                <td className={`${TD} text-right border-l border-border-light`}><N v={a?.qty} strong /></td>
                <td className={`${TD} text-right`}><N v={a?.cr} /></td>
                <td className={GAP} aria-hidden />
                <td className={`${TD} text-right border-l border-border ${MTD_BG}`}><N v={b?.qty} strong /></td>
                <td className={`${TD} text-right ${MTD_BG}`}>
                  <N v={b?.cr} />
                  {/* An average over part of the output is a different claim
                      from one over all of it, so say which this is. */}
                  {b?.cr != null && b.cr_covered_pct != null && b.cr_covered_pct < 99 && (
                    <div className="text-[9px] text-txt-light">{b.cr_covered_pct}% of tonnage</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-bg-section border-t-2 border-border">
            <td className={`${TD} font-condensed font-extrabold tracking-widest uppercase text-[11px] text-navy`}>
              Total
            </td>
            <td className={`${TD} text-right border-l border-border-light`}><N v={tdTotal?.qty} strong /></td>
            <td className={`${TD} text-right`}><N v={tdTotal?.cr} strong /></td>
            <td className={GAP} aria-hidden />
            <td className={`${TD} text-right border-l border-border`}><N v={mtdTotal?.qty} strong /></td>
            <td className={`${TD} text-right`}><N v={mtdTotal?.cr} strong /></td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */
const DEST = [
  { key: "BAL",       label: "Despatch from Mines to Balasore" },
  { key: "JABAMOYEE", label: "Despatch from Mines to Sukinda" },
];

export default function ExecutiveSummarySection() {
  // The filter's END date only. Both as-on dates are derived server-side from
  // one rule, so the stock block and the performance blocks can never be put on
  // days that do not belong together.
  const to = useDateFilter((x) => x.apiTo);

  const q = useQuery<ExecutiveSummaryResponse>({
    queryKey: ["executive-summary", to],
    queryFn: async () =>
      (await api.get("/executive-summary", { params: { to_date: to } })).data,
    staleTime: 5 * 60 * 1000,
  });
  const d = q.data;

  /* Every performance card is cut off at the same day, so each header says
     which day rather than repeating the column names printed inside it. */
  const statusTill = d ? `Status till ${niceDate(d.report_day)}` : "";
  /* Built once here rather than inside each table: the four of them must name
     the same days, and four copies of this would be four chances to drift. */
  const tdLabel  = d ? `TD · ${shortDay(d.report_day)}` : "TD";
  const mtdLabel = d
    ? `MTD · ${shortDay(d.mtd_from)} – ${shortDay(d.report_day)}`
    : "MTD";

  const pd = d?.stock?.proposed_despatch;
  const pdSub = pd?.has_data
    ? Object.entries(pd.by_destination ?? {})
        .map(([k, v]) => `${pd.labels?.[k] ?? k} ${formatIndian(v, 0)}`)
        .join(" · ")
    : "nothing proposed";

  /* THE FOUR HEADLINE FIGURES, DEFINED ONCE.
   *
   * They are shown twice — as the tiles across the top and as the table under
   * them — and the mine asked for both. Two renderings reading two
   * computations is how a page ends up quoting a different Total Stock in two
   * places a hand's width apart, with nothing to say which is right. So the
   * figure is worked out here and both views are given the same array. */
  const headline = d ? [
    { key: "stock", label: "Total Stock", unit: "MT",
      value: d.stock?.total_stock ?? null,
      sub: "mine · all grades, all statuses", accent: "#1565c0", strong: true },
    { key: "perm", label: "Permission in Hand", unit: "MT",
      value: d.stock?.clearance?.rows
        ?.find((r) => r.key === "PERMISSION_IN_HAND")?.total ?? null,
      sub: "cleared · ready to lift", accent: "#2e7d32", strong: false },
    { key: "prop", label: "Proposed Despatch", unit: "MT",
      value: pd?.total ?? null, sub: pdSub, accent: "#ad1457", strong: false },
    { key: "dmtd", label: "Despatch MTD", unit: "MT",
      value: DEST.reduce((n, x) => n + (d.mtd.despatch_total[x.key]?.qty ?? 0), 0),
      sub: "Balasore + Sukinda", accent: "#0f766e", strong: false },
  ] : [];

  return (
    <div className="space-y-4">
      {/* THE HOUSE SECTION HEADING, not a navy banner of its own. `.section-title`
          is what every other screen uses — condensed steel caps with a rule
          running off to the right — so this page announces itself the same way
          OEE / LCM and Plant Output do instead of inventing a heavier one. */}
      <div className="section-title">
        <ClipboardList size={13} />
        Executive Summary
        {d && (
          <span className="text-[10px] text-txt-light font-medium normal-case tracking-normal ml-1">
            TD {niceDate(d.report_day)} · MTD {niceDate(d.mtd_from)} – {niceDate(d.report_day)}
            {" · "}Stock as on {niceDate(d.stock_as_on)}
          </span>
        )}
      </div>

      {q.isLoading && <div className="py-20 text-center text-txt-muted text-[13px]">Loading…</div>}
      {q.isError && (
        <div className="py-16 text-center text-[13px] text-danger bg-danger-bg border border-danger/20 rounded-lg">
          Could not load the Executive Summary
        </div>
      )}

      {d && (
        <>
          {/* THE FOUR NUMBERS A MEETING OPENS WITH. Proposed Despatch is a tile
              rather than a table row: it is entered by destination, not by
              grade, so inside the clearance grid it had nothing to put under
              four of the columns and sat there as a row of dashes. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {headline.map((h) => (
              <Tile key={h.key} label={h.label} value={h.value} unit={h.unit}
                    sub={h.sub} accent={h.accent} strong={h.strong} />
            ))}
          </div>

          {/* ── 'AT A GLANCE' — WITHDRAWN, NOT DELETED ──────────────────

              The mine asked for the four headline figures as a table and,
              seeing it, judged that it did not earn its place: the tiles
              above already say the same four things, and a four-row table
              under them repeated the page's opening instead of adding to
              it. Removed at their word.

              Kept here rather than deleted because the request was for the
              figures in table form, and that may come back in a shape that
              works — inside the Stock Position card, say, rather than as a
              card of its own. The `headline` array it reads is still built
              above and still feeds the tiles, so this needs only to be
              uncommented to render again.

              The two JSX comments that were inside it are flattened to
              prose below. A JSX comment ends at the first close-comment
              marker it meets, so nesting them would close this wrapper early
              and spill the markup back onto the page -- which is exactly what
              happened on the first attempt, because this very paragraph
              spelled that marker out literally.

           The same four figures as a table, at the mine's request. A tile is
              quick to read and awkward to copy into a report; a ruled row is
              the opposite, and the daily sheet this page reproduces is a table
              throughout. Both are fed by `headline` above, so they cannot
              disagree. 
          <Card icon={<ClipboardList size={14} />} title="At a glance"
                sub={`stock as on ${niceDate(d.stock_as_on)}`}>
            <table className="w-full text-[12px] tabular-nums border-collapse">
              <thead>
                 ONLY FOUR COLUMNS, so `w-full` on the table had nowhere to
                    put its slack but the first one, and Measure stretched to
                    nearly half the page with UoM marooned out in the middle of
                    it. The three narrow columns now size to their content and
                    Basis takes the remainder, which is the column that can
                    actually use it. 
                <tr className={THEAD}>
                  <th className={`${TH} text-left whitespace-nowrap`}>Measure</th>
                  <th className={`${TH} text-center whitespace-nowrap`}>UoM</th>
                  <th className={`${TH} text-right whitespace-nowrap`}>Quantity</th>
                  <th className={`${TH} text-left w-full`}>Basis</th>
                </tr>
              </thead>
              <tbody>
                {headline.map((h) => (
                  <tr key={h.key} className="hover:bg-bg-light">
                    <td className={`${TD} font-condensed font-bold text-[11px] whitespace-nowrap`}
                        style={{ color: h.accent }}>{h.label}</td>
                    <td className={`${TD} text-center text-[10px] text-txt-light whitespace-nowrap`}>{h.unit}</td>
                    <td className={`${TD} text-right whitespace-nowrap`}><N v={h.value} strong={h.strong} /></td>
                    <td className={`${TD} text-[11px] text-txt-light`}>{h.sub}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          ──────────────────────────────────────────────────────────── */}

          <StockBlock d={d} />

          <GradeTable icon={<Pickaxe size={14} />} title="Mines Production"
            sub={statusTill} qtyLabel="Production (MT)"
            tdLabel={tdLabel} mtdLabel={mtdLabel}
            td={d.td.production} mtd={d.mtd.production}
            tdTotal={d.td.production_total} mtdTotal={d.mtd.production_total} />

          {DEST.map((x, i) => (
            <GradeTable key={x.key}
              icon={i === 0 ? <Truck size={14} /> : <Send size={14} />}
              title={x.label} sub={statusTill} qtyLabel="Despatch (MT)"
              tdLabel={tdLabel} mtdLabel={mtdLabel}
              td={d.td.despatch[x.key] ?? []} mtd={d.mtd.despatch[x.key] ?? []}
              tdTotal={d.td.despatch_total[x.key]} mtdTotal={d.mtd.despatch_total[x.key]} />
          ))}

          <PlantBlock statusTill={statusTill} tdLabel={tdLabel} mtdLabel={mtdLabel}
            td={d.td.plant} mtd={d.mtd.plant}
            tdTotal={d.td.plant_total} mtdTotal={d.mtd.plant_total} />

          {/* What a reader must know before quoting anything off this page. */}
          <div className="rounded-lg border border-[#ffe082] bg-[#fff8e1] px-4 py-3 space-y-1.5">
            <p className="text-[10px] text-txt-secondary leading-relaxed">
              <ShieldCheck size={11} className="inline mr-1 -mt-px text-[#c8960c]" />
              <span className="font-bold text-navy">A dash is not a zero.</span>{" "}
              <span className="font-semibold">Cr/Fe on production</span> is blank because SAP&apos;s
              production entry posts no such characteristic — only DY01, the despatch side, carries
              Cr/Fe and moisture. <span className="font-semibold">Cr2O3 on LG</span> is blank because
              low grade is received at LGCR, which is not an inspection location.{" "}
              <span className="font-semibold">HG</span> reads nil because the mine is not producing
              it. <span className="font-semibold">Sukinda Cr%</span> is blank because Jabamoyee files
              no daily composite assay. Each fills itself the day the data starts arriving.
            </p>
            <p className="text-[10px] text-txt-secondary leading-relaxed">
              <span className="font-bold text-navy">Two as-on dates, a day apart.</span>{" "}
              Stock is counted at the start of a day, so the snapshot shows what the reported day&apos;s
              work left behind. Despatch counts mines haulage only — Shree Ganesh or Weigh Bridge 4 —
              de-duplicated by delivery, the same rule the Despatch KPI card uses.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
