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
 * TYPOGRAPHY FOLLOWS THE OEE SECTION, at the mine's instruction: tables are
 * `text-[12px] font-mono` so digits line up down a column, headings are
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
const TH   = "px-3 py-2.5 text-[10px] font-condensed font-bold tracking-widest "
  + "uppercase text-txt-secondary";
const THEAD = "bg-bg-section border-b border-border";
const TD   = "px-3 py-2";
/* The MTD half of every table sits on a faint tint. Two periods side by side
   with identical columns is the easiest place on this page to read a figure
   off the wrong one, and a rule alone is too quiet to stop it. */
const MTD_BG = "bg-bg-light";

/* ── numbers ───────────────────────────────────────────────────────────── */
function N({ v, dp = 2, strong }: { v?: number | null; dp?: number; strong?: boolean }) {
  if (v === null || v === undefined)
    return <span className="text-txt-light/40">—</span>;
  if (v === 0)
    return <span className="text-txt-light/45">{formatIndian(0, dp)}</span>;
  return (
    <span className={strong ? "font-bold text-navy" : "text-txt-primary"}>
      {formatIndian(Number(v.toFixed(dp)), dp)}
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
        {sub && <span className="text-[10px] font-mono text-txt-light ml-auto">{sub}</span>}
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
      {sub && <div className="mt-1 text-[10px] text-txt-light font-mono truncate">{sub}</div>}
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-px bg-border-light">
        {/* Clearance status */}
        <table className="w-full text-[12px] font-mono border-collapse bg-white">
          <thead>
            <tr className={THEAD}>
              <th className={`${TH} text-left min-w-[150px]`}>Mines Clearance Status</th>
              <th className={`${TH} text-center`}>UoM</th>
              <th className={`${TH} text-right`}>Total</th>
              {cg.map((g) => <th key={g.key} className={`${TH} text-right`}>{g.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
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
        <table className="w-full text-[12px] font-mono border-collapse bg-white">
          <thead>
            <tr className={THEAD}>
              <th className={`${TH} text-left min-w-[150px]`}>Location &amp; Grade wise Stock</th>
              <th className={`${TH} text-center`}>UoM</th>
              {lc.map((c) => <th key={c.key} className={`${TH} text-right`}>{c.label}</th>)}
              <th className={`${TH} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
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
function GradeTable({ icon, title, sub, qtyLabel, td, mtd, tdTotal, mtdTotal }: {
  icon: React.ReactNode; title: string; sub: string; qtyLabel: string;
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

  return (
    <Card icon={icon} title={title} sub={sub}>
      <table className="w-full text-[12px] font-mono border-collapse">
        <thead>
          <tr className={THEAD}>
            <th className={`${TH} text-left min-w-[130px]`} rowSpan={2}>Grade</th>
            <th className={`${TH} text-center border-l border-border text-steel`} colSpan={3}>
              TD · Today
            </th>
            {/* The MTD half keeps its tint through BOTH header rows and the body.
                Two periods with identical column names side by side is the
                easiest place on this page to read a figure off the wrong one. */}
            <th className={`${TH} text-center border-l-2 border-border text-steel ${MTD_BG}`} colSpan={3}>
              MTD · Month to Date
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
        <tbody className="divide-y divide-border-light">
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
                <td className={`${TD} text-right`}><N v={a?.cr2o3} /></td>
                <td className={`${TD} text-right border-l border-border ${MTD_BG}`}><N v={b?.qty} strong /></td>
                <td className={`${TD} text-right ${MTD_BG}`}><N v={b?.crfe} /></td>
                <td className={`${TD} text-right ${MTD_BG}`}><N v={b?.cr2o3} /></td>
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
            <td className={`${TD} text-right`}><N v={tdTotal?.cr2o3} strong /></td>
            <td className={`${TD} text-right border-l border-border`}><N v={mtdTotal?.qty} strong /></td>
            <td className={`${TD} text-right`}><N v={mtdTotal?.crfe} strong /></td>
            <td className={`${TD} text-right`}><N v={mtdTotal?.cr2o3} strong /></td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/* ── Block 5 · ferrochrome ─────────────────────────────────────────────── */
function PlantBlock({ statusTill, td, mtd, tdTotal, mtdTotal }: {
  statusTill: string;
  td: ExecPlantRow[]; mtd: ExecPlantRow[];
  tdTotal?: ExecWeightedTotal; mtdTotal?: ExecWeightedTotal;
}) {
  const names: string[] = [];
  for (const r of [...td, ...mtd]) if (!names.includes(r.plant)) names.push(r.plant);
  const at = (rows: ExecPlantRow[], n: string) => rows.find((r) => r.plant === n);
  return (
    <Card icon={<Factory size={14} />} title="Ferro Chrome Plant Performance"
          sub={statusTill}>
      <table className="w-full text-[12px] font-mono border-collapse">
        <thead>
          <tr className={THEAD}>
            <th className={`${TH} text-left min-w-[150px]`} rowSpan={2}>Plant</th>
            <th className={`${TH} text-center border-l border-border text-steel`} colSpan={2}>
              TD · Today
            </th>
            <th className={`${TH} text-center border-l-2 border-border text-steel ${MTD_BG}`} colSpan={2}>
              MTD · Month to Date
            </th>
          </tr>
          <tr className={THEAD}>
            <th className={`${TH} text-right border-l border-border`}>Production (MT)</th>
            <th className={`${TH} text-right`}>Cr %</th>
            <th className={`${TH} text-right border-l-2 border-border ${MTD_BG}`}>Production (MT)</th>
            <th className={`${TH} text-right ${MTD_BG}`}>Cr %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {names.map((n) => {
            const a = at(td, n), b = at(mtd, n);
            return (
              <tr key={n} className="hover:bg-bg-light">
                <td className={`${TD} font-condensed font-bold text-[11px] text-navy`}>{n}</td>
                <td className={`${TD} text-right border-l border-border-light`}><N v={a?.qty} strong /></td>
                <td className={`${TD} text-right`}><N v={a?.cr} /></td>
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

  const pd = d?.stock?.proposed_despatch;
  const pdSub = pd?.has_data
    ? Object.entries(pd.by_destination ?? {})
        .map(([k, v]) => `${pd.labels?.[k] ?? k} ${formatIndian(v, 0)}`)
        .join(" · ")
    : "nothing proposed";

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
            <Tile label="Total Stock" value={d.stock?.total_stock} unit="MT"
                  sub="mine · all grades, all statuses" accent="#1565c0" strong />
            <Tile label="Permission in Hand"
                  value={d.stock?.clearance?.rows?.find((r) => r.key === "PERMISSION_IN_HAND")?.total}
                  unit="MT" sub="cleared · ready to lift" accent="#2e7d32" />
            <Tile label="Proposed Despatch" value={pd?.total} unit="MT"
                  sub={pdSub} accent="#ad1457" />
            <Tile label="Despatch MTD"
                  value={DEST.reduce((n, x) => n + (d.mtd.despatch_total[x.key]?.qty ?? 0), 0)}
                  unit="MT" sub="Balasore + Sukinda" accent="#0f766e" />
          </div>

          <StockBlock d={d} />

          <GradeTable icon={<Pickaxe size={14} />} title="Mines Production"
            sub={statusTill} qtyLabel="Production (MT)"
            td={d.td.production} mtd={d.mtd.production}
            tdTotal={d.td.production_total} mtdTotal={d.mtd.production_total} />

          {DEST.map((x, i) => (
            <GradeTable key={x.key}
              icon={i === 0 ? <Truck size={14} /> : <Send size={14} />}
              title={x.label} sub={statusTill} qtyLabel="Despatch (MT)"
              td={d.td.despatch[x.key] ?? []} mtd={d.mtd.despatch[x.key] ?? []}
              tdTotal={d.td.despatch_total[x.key]} mtdTotal={d.mtd.despatch_total[x.key]} />
          ))}

          <PlantBlock statusTill={statusTill} td={d.td.plant} mtd={d.mtd.plant}
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
