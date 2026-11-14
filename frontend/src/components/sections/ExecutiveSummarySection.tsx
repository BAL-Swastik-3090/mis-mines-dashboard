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
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList, Package, Truck, Factory, Pickaxe, ShieldCheck, Send, Mountain,
  Layers, Waves, Download, Check, Gauge, Users, AlertTriangle, Award,
} from "lucide-react";
import api from "@/lib/api";
import { downloadDashboard } from "@/utils/downloadDashboard";
import { withExportMode } from "@/contexts/useExportMode";
import QualityTrendCharts from "@/components/charts/QualityTrendCharts";
import PlantOutputTrendChart from "@/components/charts/PlantOutputTrendChart";
import { useRainImpact } from "@/hooks/useRainImpact";
import { useExecLossStructure, useExecLcmByEquipment } from "@/hooks/useExecLcm";
import { formatIndian } from "@/lib/utils";
import { useDateFilter } from "@/contexts/useDateFilter";
import type {
  ExecutiveSummaryResponse, ExecGradeRow, ExecWeightedTotal, ExecPlantRow,
  ExecExcavationRow, ExecDewateringBlock, ExecDewateringLine,
  ExecDewateringPeriod,
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
/* `sub` is a ReactNode rather than a string so a card can put a status chip
   up in its header beside the date. Every other caller passes a plain string
   and is unaffected. */
function Card({ icon, title, sub, children }: {
  icon: React.ReactNode; title: string; sub?: React.ReactNode;
  children: React.ReactNode;
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
              <th className={`${TH} text-right w-[1%]`}>#</th>
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
                {/* 3(a) and 3(b) are a breakdown of row 3, not two more
                    positions. The number says so and the indent repeats it, so
                    a reader adding the column downwards can see which rows are
                    already counted above them. */}
                <td className={`pl-3 pr-1 py-2 text-right text-[10px] tabular-nums
                                whitespace-nowrap w-[1%] text-txt-light
                                ${r.is_child ? "" : "font-bold"}`}>{r.sl_no}</td>
                <td className={`${TD} font-condensed text-[11px] ${r.is_child
                  ? "pl-5 font-normal text-txt-secondary"
                  : "font-bold text-navy"}`}>{r.label}</td>
                <td className={`${TD} text-center text-[10px] text-txt-light`}>{r.uom}</td>
                <td className={`${TD} text-right`}><N v={r.total} strong={!r.is_child} /></td>
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
/* == Main KPIs - plan against actual, on one line ==========================
   THE MINE'S OWN MONTHLY REVIEW, as a block on the page it is cut from.
   Everything here is already in the tables below; what the block adds is the
   one reading those tables make somebody do by hand -- how far each stream
   ran from its plan, and which one is carrying the month's shortfall.

   MTD ONLY. A plan is a month's figure and an achievement against one day of
   it is noise: the mine plans 43,000 MT for October, not 1,387 a day, and a
   Sunday would read as a catastrophe. The tables below keep their TD column.

   ACHIEVEMENT IS THE SERVER'S WHEREVER THE SERVER HAS ONE. ach_pct on the
   production, COB and despatch totals is computed once in Python, on the
   totals rather than averaged across grades, and recomputing it here would be
   a second opinion nobody asked for. Overburden, de-silting and dewatering
   are read straight off their own rows, which already carry a pct.

   SO THE ACTUALS INHERIT THE EST-ACTUAL RULE FOR FREE. Production falls back
   to the mine's own entry until SAP posts the day -- source "mixed",
   manual_qty -- and because this block reads the same totals the table below
   reads, it shows the same tonnage the table shows. */
const KPI_GREEN = 95, KPI_AMBER = 80;

function kpiTone(pct: number | null | undefined) {
  if (pct == null) return { bar: "#b9c3d4", text: "text-txt-light" };
  if (pct >= KPI_GREEN) return { bar: "#1e8a4c", text: "text-[#1e8a4c]" };
  if (pct >= KPI_AMBER) return { bar: "#c8960c", text: "text-[#c8960c]" };
  return { bar: "#c0392b", text: "text-[#c0392b]" };
}

interface KpiCard {
  label: string;
  pct: number | null;
  /** The line under the figure: actual of plan, and whatever else the mine
   *  reads beside it. Built by the caller, because each stream says something
   *  different -- a grade here, a sump level there. */
  detail: string;
}

function KpiTile({ c }: { c: KpiCard }) {
  const t = kpiTone(c.pct);
  return (
    <div className="rounded-md border border-border-light bg-white px-3 py-2.5"
         style={{ borderLeft: "4px solid " + t.bar }}>
      <div className="text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-muted">
        {c.label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={"font-condensed font-extrabold text-[21px] leading-none " + t.text}>
          {c.pct == null ? "\u2014" : c.pct.toFixed(1) + "%"}
        </span>
        {c.pct != null && <span className="text-[10px] font-semibold text-txt-muted">ach</span>}
      </div>
      <div className="mt-1 text-[10px] text-txt-light tabular-nums">{c.detail}</div>
      {/* Clamped at 100 so a stream that beat its plan does not draw a bar
          past the end of its own box. The figure above still reads over. */}
      <div className="mt-1.5 h-[5px] rounded-sm bg-bg-section overflow-hidden">
        <div className="h-full rounded-sm"
             style={{ width: Math.max(0, Math.min(100, c.pct ?? 0)) + "%",
                      background: t.bar }} />
      </div>
    </div>
  );
}

function MainKpiBlock({ d, mtdLabel }: {
  d: ExecutiveSummaryResponse; mtdLabel: string;
}) {
  const m = d.mtd;
  const n0 = (v: number | null | undefined) =>
    v == null ? "\u2014" : formatIndian(Math.round(v), 0);
  const gap = (plan: number | null | undefined, act: number | null | undefined) =>
    plan != null && act != null && plan > act
      ? " \u00b7 Gap " + n0(plan - act) : "";

  const at = (k: string) => m.excavation.find((r) => r.key === k);
  const grade = (k: string) => m.production.find((r) => r.grade === k);
  const ob = at("ob"), desilt = at("desilt");
  const desp = mergeDespatch(m.despatch).total;
  const dwRow = (k: string) => (d.dewatering?.mtd?.rows ?? []).find((r) => r.key === k);
  const disposal = dwRow("disposal"), sump = dwRow("stock");
  const prod = m.production_total, cob = m.cob_total;
  const mg = grade("MG"), lg = grade("LG");

  const cards: KpiCard[] = [
    { label: "Ore Production", pct: prod?.ach_pct ?? null,
      detail: n0(prod?.qty) + " / " + n0(prod?.plan) + " MT" + gap(prod?.plan, prod?.qty) },
    { label: "MG Ore", pct: mg?.ach_pct ?? null,
      detail: n0(mg?.qty) + " / " + n0(mg?.plan) + " MT"
        + (mg?.cr2o3 != null ? " \u00b7 Cr\u2082O\u2083 " + mg.cr2o3.toFixed(2) + "%" : "") },
    { label: "LG Ore", pct: lg?.ach_pct ?? null,
      detail: n0(lg?.qty) + " / " + n0(lg?.plan) + " MT" + gap(lg?.plan, lg?.qty) },
    { label: "Overburden", pct: ob?.pct ?? null,
      detail: n0(ob?.actual) + " / " + n0(ob?.plan) + " CuM" },
    { label: "COB Concentrate", pct: cob?.ach_pct ?? null,
      detail: n0(cob?.qty) + " / " + n0(cob?.plan) + " MT"
        + (cob?.cr2o3 != null ? " \u00b7 Cr\u2082O\u2083 " + cob.cr2o3.toFixed(1) + "%" : "") },
    { label: "Total Despatch", pct: desp?.ach_pct ?? null,
      detail: n0(desp?.qty) + " / " + n0(desp?.plan) + " MT"
        + (desp?.cr2o3 != null ? " \u00b7 Cr\u2082O\u2083 " + desp.cr2o3.toFixed(2) + "%" : "") },
    { label: "Dewatering", pct: disposal?.pct ?? null,
      detail: n0(disposal?.actual) + " / " + n0(disposal?.plan) + " m\u00b3"
        + (sump?.actual != null ? " \u00b7 Sump " + n0(sump.actual) + " m\u00b3" : "") },
    { label: "De-Silting", pct: desilt?.pct ?? null,
      detail: n0(desilt?.actual) + " / " + n0(desilt?.plan) + " CuM" },
  ];

  /* == the read-out ========================================================
     COMPUTED, NOT WRITTEN. Every clause is a figure off the cards above with
     a threshold on it; nothing is asserted that the data does not say. Which
     grade carries the shortfall changes month to month -- it was LG in
     October -- so naming one in markup would be a sentence that goes stale
     without anybody noticing. */
  const oreGap = prod?.plan != null && prod?.qty != null && prod.plan > prod.qty
    ? prod.plan - prod.qty : null;
  const worst = [mg, lg]
    .filter((g): g is ExecGradeRow =>
      !!g && g.plan != null && g.qty != null && g.plan > g.qty)
    .sort((a, b) => ((b.plan as number) - (b.qty as number))
                  - ((a.plan as number) - (a.qty as number)))[0];
  const shortfalls = [mg, lg]
    .map((g) => g && g.plan != null && g.qty != null && g.plan > g.qty
      ? g.plan - g.qty : 0)
    .reduce((a, b) => a + b, 0);
  const worstShort = worst ? (worst.plan as number) - (worst.qty as number) : null;
  // Only worth saying when more than one grade is short -- "LG accounts for
  // 100% of the shortfall" is a sentence that says nothing.
  const worstShare = worstShort != null && shortfalls > 0 && shortfalls > worstShort
    ? Math.round(worstShort / shortfalls * 100) : null;
  const onPlan = cards.filter((c) => c.pct != null && c.pct >= KPI_GREEN)
    .map((c) => c.label);

  return (
    <Card icon={<Gauge size={14} />} title="Main KPIs &mdash; Plan vs Actual"
          sub={<span>{mtdLabel}&nbsp;&nbsp;&middot;&nbsp;&nbsp;Green &ge; {KPI_GREEN}% &middot; Amber {KPI_AMBER}&ndash;{KPI_GREEN}% &middot; Red &lt; {KPI_AMBER}%</span>}>
      <div className="p-3 grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => <KpiTile key={c.label} c={c} />)}
      </div>
      <p className="px-4 py-2.5 border-t border-border-light bg-bg-soft/60
                    text-[10px] leading-relaxed text-txt-secondary">
        <span className="font-bold text-navy">Read-out:</span>{" "}
        {onPlan.length > 0 && (
          <>{onPlan.join(", ")} {onPlan.length === 1 ? "is" : "are"} on plan. </>
        )}
        {worst && worstShort != null && (
          <>The month&rsquo;s shortfall is driven by{" "}
            <span className="font-bold">
              {worst.label} ({worst.ach_pct?.toFixed(1)}%)
            </span>, {n0(worstShort)} MT short
            {worstShare != null && <> &mdash; {worstShare}% of the {n0(shortfalls)} MT
              shortfall across grades</>}.{" "}
            {oreGap != null && shortfalls > oreGap && (
              <>The net ore gap is {n0(oreGap)} MT, the rest having been made up
                elsewhere in the mix.{" "}</>
            )}
          </>
        )}
        {ob?.pct != null && cob?.ach_pct != null && (
          <>Overburden is at {ob.pct.toFixed(1)}% and COB concentrate at {cob.ach_pct.toFixed(1)}%.{" "}</>
        )}
        <span className="text-txt-light">
          Achievement is measured month to date; a plan is a month&rsquo;s figure
          and a single day against it is noise.
        </span>
      </p>
    </Card>
  );
}

/* == The loss blocks - what the month's shortfall cost, and who owns it ====
   BOTH READ THE LCM, and the Equipment Wise matrix specifically, which is the
   one the LCM screen shows. Its rain row reads 1,291.9 MT where the overall
   matrix reads 1,181.8, and a summary quoting one while the detail shows the
   other is a reconciliation nobody can win.

   LAKHS, NOT RUPEES, because that is the unit the mine's own review is
   written in. The LCM page reports the same figures in rupees; these are the
   same numbers divided by a hundred thousand, never re-derived.

   THE PERIOD IS THE SUMMARY'S OWN WINDOW, not the dashboard filter -- see
   useExecLossStructure. A loss has to cover the days the production it
   explains covers, or the two blocks on this page describe different months.

   KAM RATINGS FOLLOW, in KamRatingBlock. Its banding is the mine's own and
   is reproduced, not invented -- see RATING below. */
const CTRL_COLOUR = "#c0392b", NCTRL_COLOUR = "#8a98ad";

/** Rupees to lakhs. The services return rupees on the matrix rows and lakhs
 *  on the structure nodes, so only one of the two needs converting -- which
 *  is exactly the kind of thing that goes wrong silently. */
const toLakh = (rs: number | null | undefined) =>
  rs == null ? null : rs / 100000;

function SplitBar({ ctrl, nctrl }: { ctrl: number | null; nctrl: number | null }) {
  const c = ctrl ?? 0, n = nctrl ?? 0, t = c + n;
  if (t <= 0) return <div className="h-[10px] rounded-sm bg-bg-section min-w-[90px]" />;
  return (
    <div className="flex h-[10px] rounded-sm overflow-hidden min-w-[90px] bg-bg-section">
      <div style={{ width: (c / t * 100) + "%", background: CTRL_COLOUR }} />
      <div style={{ width: (n / t * 100) + "%", background: NCTRL_COLOUR }} />
    </div>
  );
}

function L({ v, strong }: { v: number | null | undefined; strong?: boolean }) {
  if (v == null) return <span className="text-txt-light">&mdash;</span>;
  return (
    <span className={strong ? "font-bold text-navy" : "text-txt-secondary"}>
      {formatIndian(Math.round(v * 100) / 100, 2)}
    </span>
  );
}

function KamLossBlock({ from, to, mtdLabel }: {
  from?: string | null; to?: string | null; mtdLabel: string;
}) {
  const q = useExecLossStructure(from, to);
  const d = q.data;

  /* THE COB NODE IS SEPARATED FROM THE MINES ROLL-UP, as the mine's own
     review separates it: a concentrate shortfall at the plant is not a mines
     KAM's loss, and adding it into the mines total would make six people
     answerable for a seventh's plant. */
  const nodes = (d?.nodes ?? []).filter((n) => n.role_code !== "COB");
  const cobNode = (d?.nodes ?? []).find((n) => n.role_code === "COB");
  const mines = nodes.reduce((a, n) => ({
    ctrl:  a.ctrl  + (n.controllable.value_lacs ?? 0),
    nctrl: a.nctrl + (n.non_controllable.value_lacs ?? 0),
    total: a.total + (n.total.value_lacs ?? 0),
  }), { ctrl: 0, nctrl: 0, total: 0 });

  /* COB CARRIES NO CONTROLLABILITY AXIS. The plant matrix has no such split
     -- its causes are feed volume and recovery, neither of which the mine
     classifies -- so the review treats the whole of it as controllable and
     says so. Reproduced here, footnote and all, rather than quietly dropping
     it out of the grand total. */
  const cob = cobNode?.total.value_lacs ?? d?.root.cob.value_lacs ?? null;
  const grand = {
    ctrl:  mines.ctrl + (cob ?? 0),
    nctrl: mines.nctrl,
    total: mines.total + (cob ?? 0),
  };

  const ordered = [...nodes].sort((a, b) =>
    (b.total.value_lacs ?? 0) - (a.total.value_lacs ?? 0));
  const vacant = ordered.filter((n) => !n.owner).length;

  return (
    <Card icon={<Users size={14} />}
          title="KAM-wise Controllable &amp; Non-Controllable Loss"
          sub={<span>{mtdLabel}&nbsp;&nbsp;&middot;&nbsp;&nbsp;&#8377; Lakh</span>}>
      <div className="px-4 pt-2.5 flex gap-4 text-[10px] text-txt-muted">
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px] mr-1"
                 style={{ background: CTRL_COLOUR }} />Controllable</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px] mr-1"
                 style={{ background: NCTRL_COLOUR }} />Non-controllable</span>
      </div>

      <table className="w-full text-[12px] tabular-nums border-collapse mt-1.5">
        <thead>
          <tr className={THEAD}>
            <th className={TH + " text-left min-w-[180px]"}>KAM</th>
            <th className={TH + " text-right"}>Ctrl</th>
            <th className={TH + " text-right"}>Non-Ctrl</th>
            <th className={TH + " text-right"}>Total</th>
            <th className={TH + " text-left w-[120px]"}>Split</th>
          </tr>
        </thead>
        <tbody>
          {q.isLoading && (
            <tr><td className={TD + " text-txt-light"} colSpan={5}>
              Reading the loss matrix&hellip;
            </td></tr>
          )}
          {!q.isLoading && ordered.map((n) => (
            <tr key={n.role_code} className="hover:bg-bg-light">
              <td className={TD}>
                {/* A VACANT POST IS NAMED AS ONE. The owner is derived from
                    the loss heads under the node or set on the KAM Selector;
                    a node nobody has been given reads as the role itself
                    rather than as a blank somebody mistakes for an error. */}
                <span className={n.owner ? "font-semibold text-navy" : "text-txt-light italic"}>
                  {n.owner ?? "Not assigned"}
                </span>
                <span className="ml-1.5 text-[10px] text-txt-light">({n.title})</span>
              </td>
              <td className={TD + " text-right"}><L v={n.controllable.value_lacs} /></td>
              <td className={TD + " text-right"}><L v={n.non_controllable.value_lacs} /></td>
              <td className={TD + " text-right"}><L v={n.total.value_lacs} strong /></td>
              <td className={TD}>
                <SplitBar ctrl={n.controllable.value_lacs}
                          nctrl={n.non_controllable.value_lacs} />
              </td>
            </tr>
          ))}
          {!q.isLoading && d && (
            <>
              <tr className="bg-bg-section border-t border-border">
                <td className={TD + " font-condensed font-bold tracking-wider uppercase text-[11px] text-navy"}>
                  Mines total
                </td>
                <td className={TD + " text-right"}><L v={mines.ctrl} strong /></td>
                <td className={TD + " text-right"}><L v={mines.nctrl} strong /></td>
                <td className={TD + " text-right"}><L v={mines.total} strong /></td>
                <td className={TD}><SplitBar ctrl={mines.ctrl} nctrl={mines.nctrl} /></td>
              </tr>
              <tr className="hover:bg-bg-light">
                <td className={TD}>
                  <span className="font-semibold text-navy">
                    {cobNode?.owner ?? "Not assigned"}
                  </span>
                  <span className="ml-1.5 text-[10px] text-txt-light">(COB*)</span>
                </td>
                <td className={TD + " text-right"}><L v={cob} /></td>
                <td className={TD + " text-right"}><L v={0} /></td>
                <td className={TD + " text-right"}><L v={cob} strong /></td>
                <td className={TD}><SplitBar ctrl={cob} nctrl={0} /></td>
              </tr>
              <tr className="bg-bg-section border-t-2 border-border">
                <td className={TD + " font-condensed font-extrabold tracking-widest uppercase text-[11px] text-navy"}>
                  Grand total (Mines + COB)
                </td>
                <td className={TD + " text-right"}><L v={grand.ctrl} strong /></td>
                <td className={TD + " text-right"}><L v={grand.nctrl} strong /></td>
                <td className={TD + " text-right"}><L v={grand.total} strong /></td>
                <td className={TD}><SplitBar ctrl={grand.ctrl} nctrl={grand.nctrl} /></td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <div className="px-4 py-2.5 border-t border-border-light bg-bg-soft/60
                      text-[10px] leading-relaxed text-txt-secondary space-y-1">
        <p>
          <span className="font-bold">*COB</span> is a concentrate shortfall at the
          plant. The plant matrix carries no controllability axis &mdash; its causes
          are feed volume and recovery, neither of which the mine classifies &mdash;
          so the whole of it is counted as controllable, as the mine&rsquo;s own review
          does.
        </p>
        {d?.costing?.weighted_rate != null && (
          <p>
            Valuation: lost ore &times; IBM weighted rate{" "}
            <span className="font-semibold">
              &#8377;{formatIndian(Math.round(d.costing.weighted_rate), 0)}/MT
            </span>.
          </p>
        )}
        {vacant > 0 && (
          <p className="text-amber-700">
            {vacant} {vacant === 1 ? "head reads" : "heads read"} nil because no loss
            head rolls up to {vacant === 1 ? "it" : "them"} yet. Assign them under
            &ldquo;Rolls up to&rdquo; on the LCM KAM Selector and the figures move here
            with the matrix.
          </p>
        )}
      </div>
    </Card>
  );
}

/* -- KAM RATINGS ---------------------------------------------------------
   Scores each KAM out of ten on the mine's own rule. Every figure it needs
   is already on the loss structure the table above fetched, so the two
   cannot disagree: the Ctrl Loss column here IS that table's Ctrl column,
   read from one response, not a second computation of the same thing.

   THE SCALE IS ABSOLUTE RUPEES AND THE WINDOW IS THE GLOBAL DATE FILTER.
   A fortnight accumulates less loss than a month, so a part-month view
   scores better than the same rate of working over a full one -- across
   1-13 Nov COB's Rs 81 L reads 80%, where that same daily rate over thirty
   days is Rs 188 L and reads 60%. That follows from the mine's rule rather
   than from anything done here, but it is printed on the face of the card
   so a mid-month score is not read as a month's verdict. */

/** POLICY, NOT DATA. The mine's rating rule in one place, so a change of
 *  policy is one edit here and nothing else moves. Slabs are keyed on the
 *  LOWER edge, inclusive: exactly Rs 200 L is the 80% band for a mines KAM
 *  and the 50% band for COB.
 *
 *  THE MINES SLAB IS THE WORKBOOK'S "Inputs" SHEET -- what its live cells
 *  compute, and therefore what produced the ratings the mine has already
 *  seen. Its own "Formula Logic" tab and the JS snippet beside it carry a
 *  DIFFERENT table (under 500 -> 90%, 500-800 -> 80% ...) that the workbook
 *  never uses; on Rana's Rs 257 L the two differ by a whole band. If the
 *  mine means that one, replace minesSlab and nothing else changes.
 *
 *  COB IS GRADED ON ITS OWN, TIGHTER SLAB, as the mine instructed: its top
 *  band is under Rs 50 L where a mines KAM's is under Rs 200 L. */
const RATING = {
  weightPerformance: 0.5,
  weightLoss:        0.5,
  /** Performance cannot score below this, however far plan is missed. */
  performanceFloor:  0.5,
  minesSlab: [[0, 0.9], [200, 0.8], [500, 0.7], [800, 0.6],
              [1000, 0.5], [1500, 0.4]],
  cobSlab:   [[0, 0.9], [50, 0.8], [100, 0.7], [150, 0.6], [200, 0.5]],
  /** Final score -> rating out of ten. Read top down, first match wins. */
  bands:     [[1, 10, "Excellent"], [0.9, 9, "Very Good"], [0.8, 8, "Good"],
              [0.7, 7, "Average"], [0.6, 6, "Below Average"], [0, 5, "Poor"]],
} as const;

type Slab = readonly (readonly [number, number])[];

function slabRating(lakh: number, slab: Slab): number {
  let out = slab[0][1];
  for (const [edge, v] of slab) if (lakh >= edge) out = v;
  return out;
}

function ratingBand(score: number): { rating: number; grade: string } {
  for (const [cut, rating, grade] of RATING.bands)
    if (score >= cut) return { rating, grade };
  return { rating: 5, grade: "Poor" };
}

const RATING_COLOUR: Record<number, string> = {
  10: "#1e7d4f", 9: "#2f9e63", 8: "#6a9c3a",
  7:  "#c8960c", 6: "#d4762a", 5: "#c0392b",
};

function ScoreBar({ score }: { score: number }) {
  const { rating } = ratingBand(score);
  return (
    <div className="flex h-[10px] rounded-sm overflow-hidden min-w-[90px] bg-bg-section">
      <div style={{ width: Math.min(100, Math.max(0, score * 100)) + "%",
                    background: RATING_COLOUR[rating] }} />
    </div>
  );
}

const asPct = (v: number | null | undefined) =>
  v == null ? "\u2014" : (v * 100).toFixed(0) + "%";

function KamRatingBlock({ from, to, mtdLabel }: {
  from?: string | null; to?: string | null; mtdLabel: string;
}) {
  const q = useExecLossStructure(from, to);
  const d = q.data;

  /* THE PERFORMANCE HALF IS MINE-WIDE AND IDENTICAL FOR EVERY KAM. The rule
     multiplies ore achievement by OB achievement, and neither is attributed
     per person anywhere in the data -- so what separates two rows here is
     their own controllable loss, and nothing else. */
  const ore = d?.summary.ore, ob = d?.summary.ob;
  const oreAch = ore && ore.plan ? ore.actual / ore.plan : null;
  const obAch  = ob  && ob.plan  ? ob.actual  / ob.plan  : null;
  const raw  = oreAch != null && obAch != null ? oreAch * obAch : null;
  const perf = raw == null ? null : Math.max(RATING.performanceFloor, raw);
  const floored = raw != null && raw < RATING.performanceFloor;

  const cobNode = (d?.nodes ?? []).find((n) => n.role_code === "COB");
  /* Unmapped is a bucket, not a person, and is not scored. It stays visible
     in the loss table above, which is where it belongs. */
  const mineNodes = (d?.nodes ?? []).filter(
    (n) => n.role_code !== "COB" && n.role_code !== "UNMAPPED");
  const minesCtrl = mineNodes.reduce(
    (a, n) => a + (n.controllable.value_lacs ?? 0), 0);
  const cobLoss = cobNode?.total.value_lacs ?? d?.root.cob.value_lacs ?? null;

  type Row = {
    key: string; name: string; title: string;
    loss: number | null; slab: Slab; rateable: boolean;
  };
  const rows: Row[] = [
    ...mineNodes.map((n) => ({
      key: n.role_code,
      name: n.owner ?? "Not assigned",
      title: n.title,
      loss: n.controllable.value_lacs,
      slab: RATING.minesSlab as Slab,
      /* NIL IS NOT THE SAME AS NOTHING TO ANSWER FOR. A node reads 0.00
         either because its heads cost nothing this window or because no head
         rolls up to it at all -- and the second would earn the top loss band
         and hand a rating to somebody with nothing assigned. Only a post
         that is filled AND carries heads is scored. In Nov 2026 that is the
         difference between rating K L Das, Praspero Sahoo and Maheswar
         Mohanty "7 - Average" on an empty node and showing a dash. */
      rateable: Boolean(n.owner) && n.head_count > 0,
    })),
    ...(cobNode ? [{
      key: "COB",
      name: cobNode.owner ?? "Not assigned",
      title: cobNode.title,
      loss: cobLoss,
      slab: RATING.cobSlab as Slab,
      /* COB'S head_count IS ALWAYS ZERO and must not be read as "nothing
         assigned": no mines loss head reports to the plant, and its causes
         are attached from the COB matrix afterwards. Its own loss figure is
         the test. */
      rateable: Boolean(cobNode.owner) && cobLoss != null,
    }] : []),
  ];

  const scoreOf = (r: Row) =>
    perf == null || r.loss == null || !r.rateable ? null
      : RATING.weightPerformance * perf
        + RATING.weightLoss * slabRating(r.loss, r.slab);

  const scored = rows
    .map((r) => ({ ...r, score: scoreOf(r) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  /* THE CHIEF IS SCORED ON THE WHOLE MINE, COB INCLUDED -- the same figure
     the table above prints as "Grand total (Mines + COB)", so the two tie by
     construction rather than by coincidence. He is graded on the mines slab:
     his total is a mines-scale number. */
  const chiefLoss = minesCtrl + (cobLoss ?? 0);
  const chiefScore = perf == null || !d ? null
    : RATING.weightPerformance * perf
      + RATING.weightLoss * slabRating(chiefLoss, RATING.minesSlab as Slab);

  function RatingCells({ s }: { s: number | null }) {
    if (s == null) return (
      <>
        <td className={TD + " text-right text-txt-light"}>&mdash;</td>
        <td className={TD + " text-center text-txt-light"}>&mdash;</td>
        <td className={TD + " text-txt-light"}>&mdash;</td>
        <td className={TD}><ScoreBar score={0} /></td>
      </>
    );
    const { rating, grade } = ratingBand(s);
    return (
      <>
        <td className={TD + " text-right font-bold text-navy"}>{asPct(s)}</td>
        <td className={TD + " text-center"}>
          <span className="inline-block min-w-[22px] px-1.5 py-0.5 rounded text-[11px] font-bold text-white"
                style={{ background: RATING_COLOUR[rating] }}>{rating}</span>
        </td>
        <td className={TD + " text-[11px] font-semibold"}
            style={{ color: RATING_COLOUR[rating] }}>{grade}</td>
        <td className={TD}><ScoreBar score={s} /></td>
      </>
    );
  }

  return (
    <Card icon={<Award size={14} />}
          title="KAM Ratings (out of 10)"
          sub={<span>{mtdLabel}&nbsp;&nbsp;&middot;&nbsp;&nbsp;50% performance + 50% controllable loss</span>}>

      {d && perf != null && (
        <div className="px-4 pt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-txt-muted">
          <span>Ore achv <span className="font-bold text-navy">{asPct(oreAch)}</span></span>
          <span>OB achv <span className="font-bold text-navy">{asPct(obAch)}</span></span>
          <span>Performance rating{" "}
            <span className="font-bold text-navy">{asPct(perf)}</span>
            {floored && (
              <span className="text-amber-700">
                {" "}(floored from {asPct(raw)})
              </span>
            )}
          </span>
        </div>
      )}

      <table className="w-full text-[12px] tabular-nums border-collapse mt-1.5">
        <thead>
          <tr className={THEAD}>
            <th className={TH + " text-left min-w-[180px]"}>KAM</th>
            <th className={TH + " text-right"}>Ctrl Loss</th>
            <th className={TH + " text-right"}>Loss Rtg</th>
            <th className={TH + " text-right"}>Score</th>
            <th className={TH + " text-center"}>Rating</th>
            <th className={TH + " text-left"}>Grade</th>
            <th className={TH + " text-left w-[110px]"}>&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {q.isLoading && (
            <tr><td className={TD + " text-txt-light"} colSpan={7}>
              Scoring against the loss matrix&hellip;
            </td></tr>
          )}
          {!q.isLoading && scored.map((r) => (
            <tr key={r.key} className="hover:bg-bg-light">
              <td className={TD}>
                <span className={r.rateable
                  ? "font-semibold text-navy" : "text-txt-light italic"}>
                  {r.name}
                </span>
                <span className="ml-1.5 text-[10px] text-txt-light">
                  ({r.title}{r.key === "COB" ? "*" : ""})
                </span>
              </td>
              <td className={TD + " text-right"}><L v={r.loss} /></td>
              <td className={TD + " text-right text-txt-secondary"}>
                {r.loss == null ? <span className="text-txt-light">&mdash;</span>
                                : asPct(slabRating(r.loss, r.slab))}
              </td>
              <RatingCells s={r.score} />
            </tr>
          ))}
          {!q.isLoading && d && (
            <tr className="bg-bg-section border-t-2 border-border">
              <td className={TD + " font-condensed font-extrabold tracking-widest uppercase text-[11px] text-navy"}>
                {d.root.owner ?? d.root.title}
                <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-txt-light">
                  ({d.root.title})
                </span>
              </td>
              <td className={TD + " text-right"}><L v={chiefLoss} strong /></td>
              <td className={TD + " text-right text-txt-secondary"}>
                {asPct(slabRating(chiefLoss, RATING.minesSlab as Slab))}
              </td>
              <RatingCells s={chiefScore} />
            </tr>
          )}
        </tbody>
      </table>

      {/* THE SCALE IS DRAWN FROM RATING.bands, not typed again. A band edge
          changed in the policy block moves the table and this legend
          together, which is the whole point of having one. */}
      <div className="px-4 py-2.5 border-t border-border-light
                      flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span className="text-[10px] font-condensed font-bold tracking-widest
                         uppercase text-txt-muted">
          Rating scale
        </span>
        {RATING.bands.map(([cut, rating, grade], i) => {
          const upper = i === 0 ? null : RATING.bands[i - 1][0];
          const range = upper == null
            ? "\u2265" + (cut * 100).toFixed(0) + "%"
            : cut === 0
              ? "<" + (upper * 100).toFixed(0) + "%"
              : (cut * 100).toFixed(0) + "\u2013" + (upper * 100).toFixed(0) + "%";
          return (
            <span key={rating} className="inline-flex items-center gap-1.5">
              <span className="inline-block min-w-[18px] text-center px-1 py-0.5
                               rounded text-[10px] font-bold text-white"
                    style={{ background: RATING_COLOUR[rating] }}>{rating}</span>
              <span className="text-[10px] font-semibold text-txt-secondary">{grade}</span>
              <span className="text-[10px] text-txt-light tabular-nums">{range}</span>
            </span>
          );
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-border-light bg-bg-soft/60
                      text-[10px] leading-relaxed text-txt-secondary space-y-1">
        <p>
          Score ={" "}{asPct(RATING.weightPerformance)}{" "}performance (ore achv &times;
          OB achv, floored at {asPct(RATING.performanceFloor)}) +{" "}
          {asPct(RATING.weightLoss)}{" "}loss rating. Performance is mine-wide and the
          same for every KAM, so what separates two rows is their own controllable
          loss.
        </p>
        <p>
          <span className="font-bold">Loss slabs (&#8377; Lakh).</span>{" "}
          Mines &mdash; &lt;200 : 90% &middot; 200&ndash;500 : 80% &middot;
          500&ndash;800 : 70% &middot; 800&ndash;1,000 : 60% &middot;
          1,000&ndash;1,500 : 50% &middot; &ge;1,500 : 40%.{" "}
          <span className="font-bold">*COB</span> &mdash; &lt;50 : 90% &middot;
          50&ndash;100 : 80% &middot; 100&ndash;150 : 70% &middot;
          150&ndash;200 : 60% &middot; &ge;200 : 50%, applied to its whole plant
          loss, which carries no controllability split.
        </p>
        <p>
          The {d?.root.title ?? "Chief of Mines"}{" "}is scored on the whole mine
          &mdash; every KAM&rsquo;s controllable loss plus COB &mdash; which is the
          grand total printed in the table above.
        </p>
        <p>
          A KAM with no loss head rolling up to them is shown as{" "}
          <span className="font-bold">&mdash;</span>, not scored: nil loss there
          means nothing has been assigned, not that nothing went wrong. Assign
          heads under &ldquo;Rolls up to&rdquo; on the LCM KAM Selector and they
          join the table.
        </p>
        <p className="text-amber-700">
          The slabs are absolute rupees, so a part-month window carries less loss
          and scores higher than the same rate of working over a full month.
          Compare whole months, or read this with the window in mind.
        </p>
      </div>
    </Card>
  );
}

/** The idle family, for the read-out beneath the loss table. Keyed on the
 *  matrix COLUMN, never the label: the labels live in LABEL_OVERRIDES in
 *  lcm.py and renaming one must not silently empty this group. */
const IDLE_COLUMNS = ["idle_safety", "job_allocation", "idle_requ_basic", "idle"];

/** How many heads the table names before the rest are gathered into one row.
 *  The mine's own review prints seven and a remainder. */
const CTRL_HEADS_SHOWN = 7;

/* == WHICH ACTIONS APPEAR ==================================================
   The sentences are the mine's, held against each loss head in the LCM KAM
   Selector and dated there, so re-opening September shows September's
   policy. Nothing is written here and nothing is generated: this decides
   only WHICH of them is worth printing this month, which is arithmetic on
   the table beside it.

   A HEAD HANDLED IN ANOTHER SECTION IS LEFT TO IT. The mine's own review
   skips Breakdown in this panel at 23% of controllable loss and writes "see
   Section 5" instead, because equipment is answered by the equipment matrix.
   Repeating it here would crowd out the operations actions this panel is
   for. */
const ACTIONS_SHOWN = 4;
const ACTION_MIN_SHARE_PCT = 5;
const ACTION_HANDLED_ELSEWHERE: Record<string, string> = {
  breakdown: "the Equipment Excavation Plan",
};

function ControllableLossBlock({ from, to, mtdLabel }: {
  from?: string | null; to?: string | null; mtdLabel: string;
}) {
  const q = useExecLcmByEquipment(from, to);
  const rows = (q.data?.rows ?? []).filter((r) => r.loss_type === "Controllable");
  const total = rows.reduce((a, r) => a + (r.loss_amount ?? 0), 0);
  const oreHrs = rows.reduce((a, r) => a + (r.ore_hours ?? 0), 0);
  // OB HOURS, NOT THE CuM BEHIND THEM. The mine's review reads hours on
  // the OB side and tonnes on the ore side, because an overburden head is
  // judged on the machine time it swallowed; planned_ob_loss is the cubic
  // metres those hours would have moved and is a different question.
  const obHrs  = rows.reduce((a, r) => a + (r.ob_hours ?? 0), 0);
  const oreMt  = rows.reduce((a, r) => a + (r.planned_ore_loss ?? 0), 0);

  const ranked = [...rows].sort((a, b) => (b.loss_amount ?? 0) - (a.loss_amount ?? 0));
  const shown = ranked.slice(0, CTRL_HEADS_SHOWN);
  const rest  = ranked.slice(CTRL_HEADS_SHOWN);
  const restAgg = rest.reduce((a, r) => ({
    ore_hours: a.ore_hours + (r.ore_hours ?? 0),
    ore_mt:    a.ore_mt    + (r.planned_ore_loss ?? 0),
    ob_hrs:    a.ob_hrs    + (r.ob_hours ?? 0),
    rs:        a.rs        + (r.loss_amount ?? 0),
  }), { ore_hours: 0, ore_mt: 0, ob_hrs: 0, rs: 0 });

  const share = (rs: number) => total > 0 ? rs / total * 100 : 0;
  const n1 = (v: number) => formatIndian(Math.round(v * 10) / 10, 1);
  const n0 = (v: number) => formatIndian(Math.round(v), 0);

  /* == the observations ====================================================
     EVERY LINE IS ARITHMETIC ON THE TABLE BESIDE IT. The mine's review also
     carries a list of recommended actions; those are somebody's judgement
     about named machines and named people, and are not generated here. */
  const top3 = ranked.slice(0, 3).reduce((a, r) => a + (r.loss_amount ?? 0), 0);
  const idle = rows.filter((r) => IDLE_COLUMNS.includes(r.column));
  const idleRs = idle.reduce((a, r) => a + (r.loss_amount ?? 0), 0);
  const biggest = ranked[0];

  /* == the actions =========================================================
     The heads that cost enough to be worth acting on, that carry a remedy,
     and that are not answered by another section. A head with no action_text
     is skipped silently rather than given a placeholder -- 'other' is a
     catch-all and has deliberately been left without one. */
  const actions = ranked.filter((r) =>
    r.action_text
    && share(r.loss_amount ?? 0) >= ACTION_MIN_SHARE_PCT
    && !ACTION_HANDLED_ELSEWHERE[r.column]).slice(0, ACTIONS_SHOWN);
  const deferred = ranked.filter((r) =>
    ACTION_HANDLED_ELSEWHERE[r.column]
    && share(r.loss_amount ?? 0) >= ACTION_MIN_SHARE_PCT);

  return (
    <Card icon={<AlertTriangle size={14} />}
          title="Major Controllable Loss Summary &mdash; Operations"
          sub={<span>{mtdLabel}&nbsp;&nbsp;&middot;&nbsp;&nbsp;
            &#8377;{formatIndian(Math.round(toLakh(total) ?? 0), 0)} L &middot;{" "}
            {n1(oreHrs)} ore-hrs &middot; {n1(obHrs)} OB-hrs</span>}>
      <div className="grid gap-0 lg:grid-cols-[1.6fr_1fr]">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] tabular-nums border-collapse">
            <thead>
              <tr className={THEAD}>
                <th className={TH + " text-left min-w-[150px]"}>Loss head</th>
                <th className={TH + " text-left min-w-[130px]"}>KAM</th>
                <th className={TH + " text-right"}>Ore hrs</th>
                <th className={TH + " text-right"}>Ore loss MT</th>
                <th className={TH + " text-right"}>OB hrs</th>
                <th className={TH + " text-right"}>&#8377; L</th>
                <th className={TH + " text-left w-[110px]"}>% of ctrl loss</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td className={TD + " text-txt-light"} colSpan={7}>
                  Reading the loss matrix&hellip;
                </td></tr>
              )}
              {!q.isLoading && shown.map((r) => {
                const pc = share(r.loss_amount ?? 0);
                return (
                  <tr key={r.column} className="hover:bg-bg-light">
                    <td className={TD + " font-semibold text-navy"}>{r.loss_description}</td>
                    <td className={TD + " text-txt-secondary"}>{r.kam}</td>
                    <td className={TD + " text-right"}>{n1(r.ore_hours ?? 0)}</td>
                    <td className={TD + " text-right"}>{n0(r.planned_ore_loss ?? 0)}</td>
                    <td className={TD + " text-right"}>{n1(r.ob_hours ?? 0)}</td>
                    <td className={TD + " text-right"}><L v={toLakh(r.loss_amount)} strong /></td>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-[8px] rounded-sm bg-bg-section overflow-hidden min-w-[40px]">
                          <div className="h-full rounded-sm"
                               style={{ width: Math.min(100, pc) + "%",
                                        background: pc >= 20 ? CTRL_COLOUR : "#c8960c" }} />
                        </div>
                        <span className="text-[11px] text-txt-secondary">{pc.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!q.isLoading && rest.length > 0 && (
                <tr className="hover:bg-bg-light">
                  <td className={TD + " text-txt-secondary"}>
                    Others ({rest.length} heads)
                  </td>
                  <td className={TD + " text-txt-light"}>Various</td>
                  <td className={TD + " text-right"}>{n1(restAgg.ore_hours)}</td>
                  <td className={TD + " text-right"}>{n0(restAgg.ore_mt)}</td>
                  <td className={TD + " text-right"}>{n1(restAgg.ob_hrs)}</td>
                  <td className={TD + " text-right"}><L v={toLakh(restAgg.rs)} /></td>
                  <td className={TD + " text-[11px] text-txt-secondary"}>
                    {share(restAgg.rs).toFixed(1)}%
                  </td>
                </tr>
              )}
              {!q.isLoading && rows.length > 0 && (
                <tr className="bg-bg-section border-t-2 border-border">
                  <td className={TD + " font-condensed font-extrabold tracking-widest uppercase text-[11px] text-navy"}
                      colSpan={2}>
                    Total controllable
                  </td>
                  <td className={TD + " text-right font-bold text-navy"}>{n1(oreHrs)}</td>
                  <td className={TD + " text-right font-bold text-navy"}>{n0(oreMt)}</td>
                  <td className={TD + " text-right font-bold text-navy"}>{n1(obHrs)}</td>
                  <td className={TD + " text-right"}><L v={toLakh(total)} strong /></td>
                  <td className={TD + " text-[11px] font-bold text-navy"}>100%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 border-l border-border-light">
          <div className="rounded-md bg-[#fbe9e7] px-3 py-2.5">
            <h4 className="font-condensed font-bold text-[12px] text-navy tracking-wide mb-1.5">
              Key observations
            </h4>
            {q.isLoading || rows.length === 0 ? (
              <p className="text-[10px] text-txt-light">Waiting for the loss matrix&hellip;</p>
            ) : (
              <ul className="list-disc pl-4 text-[10.5px] leading-relaxed text-txt-secondary space-y-1">
                <li>
                  <span className="font-bold">Top 3 heads = {share(top3).toFixed(1)}%</span>
                  {" "}of controllable loss (&#8377;{n0(toLakh(top3) ?? 0)} L).
                </li>
                {idle.length > 0 && (
                  <li>
                    <span className="font-bold">Idle time</span> ({idle.map((r) => r.loss_description).join(", ")}){" "}
                    = <span className="font-bold">&#8377;{n0(toLakh(idleRs) ?? 0)} L,
                    {" "}{share(idleRs).toFixed(0)}%</span> &mdash; a planning and
                    face-readiness question, not an equipment one.
                  </li>
                )}
                {biggest && (
                  <li>
                    <span className="font-bold">{biggest.loss_description}</span> alone cost{" "}
                    {n0(biggest.planned_ore_loss ?? 0)} MT of ore, against{" "}
                    {n1(biggest.ore_hours ?? 0)} ore-hours.
                  </li>
                )}
                <li>
                  Controllable loss is {n0(oreMt)} MT of ore and {n1(obHrs)} hours
                  of overburden time, worth &#8377;{n0(toLakh(total) ?? 0)} L in all.
                </li>
              </ul>
            )}
            <p className="mt-2 text-[9.5px] text-txt-light leading-relaxed">
              Every line above is arithmetic on the table beside it.
            </p>
          </div>

          {!q.isLoading && (actions.length > 0 || deferred.length > 0) && (
            <div className="rounded-md bg-[#e8f3ea] px-3 py-2.5 mt-3">
              <h4 className="font-condensed font-bold text-[12px] text-navy tracking-wide mb-1.5">
                Actions recommended
              </h4>
              <ul className="list-disc pl-4 text-[10.5px] leading-relaxed
                             text-txt-secondary space-y-1.5">
                {actions.map((r) => (
                  <li key={r.column}>
                    {r.action_text}
                    <span className="block text-[9.5px] text-txt-light mt-0.5">
                      {r.loss_description} &middot;{" "}
                      &#8377;{n0(toLakh(r.loss_amount) ?? 0)} L &middot;{" "}
                      {share(r.loss_amount ?? 0).toFixed(1)}% of ctrl loss
                      {r.owning_function && (
                        <> &middot; <span className="font-semibold text-txt-secondary">
                          {r.owning_function}
                        </span></>
                      )}
                    </span>
                  </li>
                ))}
                {deferred.map((r) => (
                  <li key={r.column} className="text-txt-light">
                    <span className="font-semibold">{r.loss_description}</span>{" "}
                    is {share(r.loss_amount ?? 0).toFixed(1)}% of controllable loss
                    and is answered in {ACTION_HANDLED_ELSEWHERE[r.column]}.
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[9.5px] text-txt-light leading-relaxed">
                The wording is the mine&rsquo;s own standing remedy for each loss
                head, held in the LCM KAM Selector and dated there &mdash; not
                generated, so this month reads the same way whenever it is
                re-opened. Which of them appears is decided by the table beside
                it: heads above {ACTION_MIN_SHARE_PCT}% of controllable loss,
                largest first.
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function GradeTable({ icon, title, sub, qtyLabel, tdLabel, mtdLabel,
                     td, mtd, tdTotal, mtdTotal, showPlan = false,
                     qtyDp = 2, rainImpactMt }: {
  icon: React.ReactNode; title: string; sub: string; qtyLabel: string;
  /* The heading says WHICH day and WHICH span, not just "Today". The page is
     read a day or two in arrears — the mine files in arrears — so "Today" on a
     column holding the 11th, opened on the 12th, is simply wrong. */
  tdLabel: string; mtdLabel: string;
  td: ExecGradeRow[]; mtd: ExecGradeRow[];
  tdTotal?: ExecWeightedTotal; mtdTotal?: ExecWeightedTotal;
  /* Production, COB and despatch all plan against something — the excavation
     plan, mines_cobp_plan and mines_despatch_plan respectively — so all three
     show the two extra columns. A row whose plan is null still prints a dash
     there: no plan was written for that grade, which is not a plan of zero. */
  showPlan?: boolean;
  /* MT of ore the mine lost to rain this month, from the LCM's Equipment Wise
     matrix. Given only by Mines Production: the deduction is an ore figure and
     means nothing against concentrate or despatch. Undefined means "this table
     does not carry the rows at all"; null means it does, and the figure has
     not arrived or could not be read. */
  rainImpactMt?: number | null;
  /* Decimal places for the TONNAGE columns only — Plan and the quantity, in
     the body and in the footer. Every tonnage table on this page passes 0:
     the mine books and reads whole tonnes, and a column of 1,177.84 /
     2,121.72 spends three characters a row saying nothing. The default of 2
     remains for any table added later that genuinely needs the fraction.

     THE ASSAY COLUMNS ARE UNTOUCHED either way — Cr/Fe and Cr2O3 are
     measurements, not quantities, and rounding those would change what they
     say rather than how they are printed. */
  qtyDp?: number;
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
            <th className={`${TH} text-center border-l border-border text-steel`}
                colSpan={showPlan ? 5 : 3}>
              {tdLabel}
            </th>
            <th className={GAP} rowSpan={2} aria-hidden />
            {/* The MTD half keeps its tint through BOTH header rows and the body.
                Two periods with identical column names side by side is the
                easiest place on this page to read a figure off the wrong one. */}
            <th className={`${TH} text-center border-l-2 border-border text-steel ${MTD_BG}`}
                colSpan={showPlan ? 5 : 3}>
              {mtdLabel}
            </th>
          </tr>
          <tr className={THEAD}>
            {showPlan && <th className={`${TH} text-right border-l border-border`}>Plan (MT)</th>}
            <th className={`${TH} text-right ${showPlan ? "" : "border-l border-border"}`}>{qtyLabel}</th>
            {showPlan && <th className={`${TH} text-right`}>Ach %</th>}
            <th className={`${TH} text-right`}>Cr/Fe</th>
            <th className={`${TH} text-right`}>Cr2O3 %</th>
            {showPlan && <th className={`${TH} text-right border-l-2 border-border ${MTD_BG}`}>Plan (MT)</th>}
            <th className={`${TH} text-right ${MTD_BG} ${showPlan ? "" : "border-l-2 border-border"}`}>{qtyLabel}</th>
            {showPlan && <th className={`${TH} text-right ${MTD_BG}`}>Ach %</th>}
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
                {showPlan && (
                  <td className={`${TD} text-right border-l border-border-light text-txt-light`}>
                    <N v={a?.plan} dp={qtyDp} />
                  </td>
                )}
                <td className={`${TD} text-right whitespace-nowrap ${showPlan ? "" : "border-l border-border-light"}`}>
                  <N v={a?.qty} dp={qtyDp} strong />
                </td>
                {showPlan && <td className={`${TD} text-right`}><Ach v={a?.ach_pct} /></td>}
                <td className={`${TD} text-right`}><N v={a?.crfe} /></td>
                <td className={`${TD} text-right whitespace-nowrap`}>
                  <N v={a?.cr2o3} /><Est pct={a?.estimated_pct} qty={a?.estimated_qty} />
                </td>
                <td className={GAP} aria-hidden />
                {showPlan && (
                  <td className={`${TD} text-right border-l border-border text-txt-light ${MTD_BG}`}>
                    <N v={b?.plan} dp={qtyDp} />
                  </td>
                )}
                <td className={`${TD} text-right whitespace-nowrap ${MTD_BG} ${showPlan ? "" : "border-l border-border"}`}>
                  <N v={b?.qty} dp={qtyDp} strong />
                </td>
                {showPlan && <td className={`${TD} text-right ${MTD_BG}`}><Ach v={b?.ach_pct} /></td>}
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
            {showPlan && (
              <td className={`${TD} text-right border-l border-border-light text-txt-secondary`}>
                <N v={tdTotal?.plan} dp={qtyDp} />
              </td>
            )}
            <td className={`${TD} text-right whitespace-nowrap ${showPlan ? "" : "border-l border-border-light"}`}>
              <N v={tdTotal?.qty} dp={qtyDp} strong />
            </td>
            {showPlan && <td className={`${TD} text-right`}><Ach v={tdTotal?.ach_pct} strong /></td>}
            <td className={`${TD} text-right`}><N v={tdTotal?.crfe} strong /></td>
            <td className={`${TD} text-right whitespace-nowrap`}>
              <N v={tdTotal?.cr2o3} strong /><Est pct={tdTotal?.estimated_pct} qty={tdTotal?.estimated_qty} />
            </td>
            <td className={GAP} aria-hidden />
            {showPlan && (
              <td className={`${TD} text-right border-l border-border text-txt-secondary`}>
                <N v={mtdTotal?.plan} dp={qtyDp} />
              </td>
            )}
            <td className={`${TD} text-right whitespace-nowrap ${showPlan ? "" : "border-l border-border"}`}>
              <N v={mtdTotal?.qty} dp={qtyDp} strong />
            </td>
            {showPlan && <td className={`${TD} text-right`}><Ach v={mtdTotal?.ach_pct} strong /></td>}
            <td className={`${TD} text-right`}><N v={mtdTotal?.crfe} strong /></td>
            <td className={`${TD} text-right whitespace-nowrap`}>
              <N v={mtdTotal?.cr2o3} strong /><Est pct={mtdTotal?.estimated_pct} qty={mtdTotal?.estimated_qty} />
            </td>
          </tr>

          {/* ── Rain Impact, and the plan net of it ─────────────────────────
              MTD ONLY, and that is not a simplification. The deduction is a
              month's loss hours priced into tonnes; there is no day-sized
              version of it to put in the TD half, and printing the month's
              figure there would say the mine lost 1,346 MT to rain on the
              12th. The TD cells are left blank for the same reason the Plan
              column prints a dash where no plan was written.

              IT IS NOT A GRADE, so it sits in the footer below the Weighted
              Avg rather than among HG / MG / LG: rain is not something the
              mine produced, and a row in the body would be picked up by
              anything reading the grade list.

              ONLY THE PLAN MOVES. Production is what was dug and does not
              change because of why it was not more, so the Revised row
              repeats the same tonnage and divides it by the smaller plan --
              which is the whole point of the row, and is why Ach % is
              recomputed here rather than carried from the server. */}
          {rainImpactMt !== undefined && showPlan && (() => {
            const plan = mtdTotal?.plan ?? null;
            const qty  = mtdTotal?.qty ?? null;
            const net  = plan != null && rainImpactMt != null
              ? plan - rainImpactMt : null;
            // No percentage against a revised plan of nothing, and none
            // against a plan rain has wiped out entirely -- a dash, never a
            // division nobody can read.
            const ach = qty != null && net != null && net > 0
              ? Math.round(qty / net * 1000) / 10 : null;
            return (
              <>
                <tr className="bg-bg-section border-t border-border-light">
                  <td className={`${TD} font-condensed font-bold tracking-wider uppercase text-[11px] text-txt-secondary`}>
                    Rain Impact (Non-Controllable)
                  </td>
                  <td className={`${TD} text-right border-l border-border-light`} />
                  <td className={TD} /><td className={TD} />
                  <td className={TD} /><td className={TD} />
                  <td className={GAP} aria-hidden />
                  <td className={`${TD} text-right border-l border-border text-amber-700 font-semibold ${MTD_BG}`}>
                    {rainImpactMt == null ? "—" : `− ${formatIndian(rainImpactMt, qtyDp)}`}
                  </td>
                  <td className={`${TD} ${MTD_BG}`} /><td className={`${TD} ${MTD_BG}`} />
                  <td className={`${TD} ${MTD_BG}`} /><td className={`${TD} ${MTD_BG}`} />
                </tr>
                <tr className="bg-bg-section border-b-2 border-border">
                  <td className={`${TD} font-condensed font-extrabold tracking-widest uppercase text-[11px] text-navy`}>
                    Revised Plan (Net rain impact)
                  </td>
                  <td className={`${TD} text-right border-l border-border-light`} />
                  <td className={TD} /><td className={TD} />
                  <td className={TD} /><td className={TD} />
                  <td className={GAP} aria-hidden />
                  <td className={`${TD} text-right border-l border-border text-txt-secondary font-semibold ${MTD_BG}`}>
                    <N v={net} dp={qtyDp} />
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap ${MTD_BG}`}>
                    <N v={net == null ? null : qty} dp={qtyDp} strong />
                  </td>
                  <td className={`${TD} text-right ${MTD_BG}`}><Ach v={ach} strong /></td>
                  <td className={`${TD} ${MTD_BG}`} /><td className={`${TD} ${MTD_BG}`} />
                </tr>
              </>
            );
          })()}
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

/* Achievement against plan. Thresholds match the OB table and the OEE
 * screens, so one percentage means one thing across the dashboard. A plan of
 * nothing gives no percentage — a dash, never 0%, which would read as a miss
 * rather than as "nothing was planned". */
function Ach({ v, strong = false }: { v?: number | null; strong?: boolean }) {
  if (v == null) return <span className="text-txt-light">—</span>;
  const cls = v >= 90 ? "text-[#2e7d32]" : v >= 70 ? "text-[#c8960c]" : "text-[#c62828]";
  return <span className={`${cls} ${strong ? "font-extrabold" : "font-bold"}`}>
    {v.toFixed(1)}%
  </span>;
}

/* ── Block 4b · overburden and de-silting ──────────────────────────────────
   THE SAME FIGURES THE MIS DASHBOARD REPORTS, from the same backend functions
   its KPI strip and plan-vs-actual charts are built on — not a second
   derivation that would agree today and drift later.

   A TABLE, NOT THE CHARTS. MIS draws these as day-by-day bars, which answers
   "how did the month go"; this page answers "where are we against plan", and
   every other block on it is a TD/MTD table. Keeping the shape means the whole
   screen can be read down one pair of columns.

   DE-SILTING HAS NO PLAN ANYWHERE — no table holds one, which is why MIS shows
   its card with a blank target too. The cell says "no plan" rather than a bare
   dash, because a dash on this page means "not reported yet" and would have
   somebody chasing the mine for a figure that does not exist. */
/* THREE REASONS A CELL IS BLANK, AND THEY ARE NOT THE SAME. Saying "no plan"
   for all of them either sends somebody looking for a figure that cannot
   exist, or lets a missing one sit unnoticed. Each key says which it is. */
function blankWhy(key: string): string {
  if (key === "desilt")
    return "No de-silting plan is held in any system — the MIS dashboard "
         + "shows this blank too";
  if (key.startsWith("shift_"))
    return "No shifting plan has been uploaded for this month — load it "
         + 'from the header menu, "Enter Shifting Plan"';
  return "No excavation plan has been entered for this month yet — "
       + "it is loaded into mines_daily_excavation_plan";
}

/* The chip tells the three groups apart at a glance: overburden is the waste
   the ore sits under, de-silting is water management, and the three shifting
   rows are material moved around the mine rather than out of it. One hue per
   group, none of them the red/amber/green the Ach % column uses. */
function activityChip(key: string): string {
  if (key === "ob") return "bg-[#f3ece3] text-[#7a5a2e]";
  if (key === "desilt") return "bg-[#e0f2f1] text-[#00695c]";
  return "bg-[#ede7f6] text-[#4527a0]";
}

function ExcavationBlock({ statusTill, tdLabel, mtdLabel, td, mtd }: {
  /* THE SAME DATED HEADINGS THE OTHER CARDS CARRY. This card said "TD ·
     Today" and "MTD · Month to Date" while the tables above and below it
     named the actual days. The page is read a day or two in arrears — the
     mine files in arrears — so "Today" over a column holding the 3rd, opened
     on the 5th, is simply wrong, and wrong differently from its neighbours. */
  statusTill: string; tdLabel: string; mtdLabel: string;
  td: ExecExcavationRow[]; mtd: ExecExcavationRow[];
}) {
  const keys: string[] = [];
  for (const r of [...td, ...mtd]) if (!keys.includes(r.key)) keys.push(r.key);
  const at = (rows: ExecExcavationRow[], k: string) => rows.find((r) => r.key === k);

  /* Achievement colouring, on the same thresholds the OEE tables use so a
     percentage means one thing across the dashboard. */
  const pctTone = (v: number | null | undefined) =>
    v == null ? "text-txt-light"
      : v >= 90 ? "text-[#2e7d32]" : v >= 70 ? "text-[#c8960c]" : "text-[#c62828]";

  const cells = (r: ExecExcavationRow | undefined, tint: string) => (
    <>
      {/* Overburden in CuM and de-silting in CuM are excavation output, read
          the same way as the tonnes above — whole units. */}
      <td className={`${TD} text-right border-l border-border-light ${tint}`}>
        <N v={r?.plan} dp={0} />
      </td>
      <td className={`${TD} text-right whitespace-nowrap ${tint}`}>
        <N v={r?.actual} dp={0} strong />
      </td>
      <td className={`${TD} text-right whitespace-nowrap ${tint}`}>
        {/* THE TWO BLANKS MEAN DIFFERENT THINGS. De-silting has no plan table
            anywhere, so its blank is permanent and nobody should be chased for
            it. Overburden has one — a blank there means this month has not
            been entered yet, which somebody can fix. Saying "no plan" for both
            without distinguishing them sends people looking for a figure that
            does not exist, or lets a missing one sit unnoticed. */}
        {r?.no_plan
          ? <span className="text-[9px] uppercase tracking-wide text-txt-light"
                  title={blankWhy(r.key)}>
              {r.key === "desilt" ? "no plan" : "not planned"}
            </span>
          : <span className={`font-bold ${pctTone(r?.pct)}`}>
              {r?.pct == null ? "—" : `${r.pct.toFixed(1)}%`}
            </span>}
      </td>
    </>
  );

  return (
    <Card icon={<Mountain size={14} />}
          title="Overburden, De-Silting & Shifting"
          sub={statusTill}>
      <table className="w-full text-[12px] font-mono border-collapse">
        <thead>
          <tr className={THEAD}>
            <th className={`${TH} text-left min-w-[130px]`} rowSpan={2}>Activity</th>
            <th className={`${TH} text-center border-l border-border text-steel`}
                colSpan={3}>
              {tdLabel}
            </th>
            <th className={`${TH} text-center border-l-2 border-border text-steel ${MTD_BG}`}
                colSpan={3}>
              {mtdLabel}
            </th>
          </tr>
          <tr className={THEAD}>
            <th className={`${TH} text-right border-l border-border`}>Plan (CuM)</th>
            <th className={`${TH} text-right`}>Actual (CuM)</th>
            <th className={`${TH} text-right`}>Ach %</th>
            <th className={`${TH} text-right border-l-2 border-border ${MTD_BG}`}>Plan (CuM)</th>
            <th className={`${TH} text-right ${MTD_BG}`}>Actual (CuM)</th>
            <th className={`${TH} text-right ${MTD_BG}`}>Ach %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {keys.map((k) => {
            const a = at(td, k), b = at(mtd, k);
            return (
              <tr key={k} className="hover:bg-bg-light">
                <td className={TD}>
                  <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold tracking-wide ${activityChip(k)}`}>
                    {a?.label ?? b?.label ?? k}
                  </span>
                </td>
                {cells(a, "")}
                {cells(b, MTD_BG)}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 border-t border-border-light bg-bg-section/40
                    text-[9px] font-mono leading-relaxed text-txt-secondary">
        <span className="font-semibold">OB PLAN · </span>IMOS daily excavation plan
        {"   "}<span className="font-semibold">OB ACTUAL · </span>SAP
        {"   "}<span className="font-semibold">DE-SILTING PLAN · </span>uploaded
        month by month from the mine&apos;s sheet
        {"   "}<span className="font-semibold">DE-SILTING ACTUAL · </span>IMOS
        day-wise excavation, variant 4, with the mine&apos;s own figure standing
        in for days IMOS has not filed.
        {/* The three shifting rows have no feed behind them at all — both
            halves are the mine's own, which is worth saying plainly rather
            than letting them sit in a card whose other rows come from SAP. */}
        {"   "}<span className="font-semibold">SHIFTING PLAN · </span>uploaded
        month by month from the mine&apos;s sheet
        {"   "}<span className="font-semibold">SHIFTING ACTUAL · </span>entered
        by the mine, day by day — neither figure comes from a feed.
      </p>
    </Card>
  );
}

/* ── Block 4b · dewatering ─────────────────────────────────────────────── */
/* THIS BLOCK CARRIES ITS OWN WINDOW, and that is the only reason it does not
   simply look like the tables above it. Every other card on this page reports
   the month the page reports. The mine files dewatering in arrears and
   sometimes stops for a fortnight, so a month-to-date column here can be
   thirteen days wearing the label of thirty-one — and every rate under it,
   average pumping and days to clear especially, is then wrong by the ratio of
   the two. So the gap is stated above the figures rather than footnoted
   below them, and the MTD heading names the days it actually covers.

   The six tiles reuse the page's own Tile, and the table is the same ruled
   TD/MTD grid as Overburden, so the card reads as part of this report rather
   than as a dashboard pasted into it. */
function DewateringBlock({ d }: { d: ExecDewateringBlock }) {
  const k = d.kpi;

  /* Achievement colouring on the page's shared thresholds, so a percentage
     means one thing across the whole report. */
  const pctTone = (v: number | null | undefined) =>
    v == null ? "text-txt-light"
      : v >= 90 ? "text-[#2e7d32]" : v >= 70 ? "text-[#c8960c]" : "text-[#c62828]";

  const BADGE: Record<string, string> = {
    ok:       "bg-emerald-bg text-emerald ring-1 ring-emerald-ring",
    watch:    "bg-amber-bg text-amber ring-1 ring-amber-ring",
    critical: "bg-danger-bg text-danger ring-1 ring-danger/30",
  };
  const BADGE_TEXT: Record<string, string> = {
    ok: "COMPLETE", watch: "PARTIAL", critical: "INCOMPLETE",
  };

  const gapDays = d.window_days - d.entered;

  const cells = (r: ExecDewateringLine | undefined, tint: string) => (
    <>
      <td className={`${TD} text-right border-l border-border-light ${tint}`}>
        {/* Inflow has no plan and never will. Every other row, closing stock
            included, carries a real one. */}
        {r?.no_plan
          ? <span className="text-[9px] uppercase tracking-wide text-txt-light"
                  title="Seepage is measured and rain is weather — neither is planned.">
              no plan
            </span>
          : /* A PLAN THAT RAN THE SUMP DRY READS AS PLAIN 0. The sump holds no
               negative water, so the plan column stops at empty; the water the
               plan asked for beyond what arrived is carried on the response and
               explained in the footnote rather than printed beside the figure,
               which the mine found noisier than it was worth. The hover still
               says it for anyone who wants the number. */
            <span title={r?.overdraw
              ? `The plan asked for ${formatIndian(r.overdraw, 0)} M³ more water than reached the sump, so it would have run dry — this figure stops at empty rather than going negative.`
              : undefined}>
              <N v={r?.plan} dp={r?.dp ?? 0} />
            </span>}
      </td>
      <td className={`${TD} text-right whitespace-nowrap ${tint}`}>
        <N v={r?.actual} dp={r?.dp ?? 0} strong />
      </td>
      <td className={`${TD} text-right whitespace-nowrap ${tint}`}>
        {r?.inverse
          ? /* THE ONE ROW WHERE LOW IS GOOD. A sump left below the level the
               plan would have left it has been over-pumped, not under-
               achieved, so this prints the signed variance against plan and
               colours DOWN green — the opposite of every row above it. */
            (() => {
              if (r?.pct == null) return (
                <span className="text-txt-light/40"
                      title={r?.overdraw
                        ? "No variance: the plan would have emptied the sump, so there is no planned level to measure against."
                        : undefined}>—</span>
              );
              const down = r.pct <= 0;
              return (
                <span className={`font-bold ${down ? "text-[#2e7d32]" : "text-[#c62828]"}`}
                      title={down
                        ? "Below the level the plan would have left — over-pumped against plan."
                        : "Above the level the plan would have left — under-pumped against plan."}>
                  {down ? "↓" : "↑"} {Math.abs(r.pct).toFixed(1)}%
                </span>
              );
            })()
          : r?.no_plan
            ? <span className="text-txt-light/40">—</span>
            : <span className={`font-bold ${pctTone(r?.pct)}`}>
                {r?.pct == null ? "—" : `${r.pct.toFixed(1)}%`}
              </span>}
      </td>
    </>
  );

  const keys = (d.mtd?.rows ?? d.td?.rows ?? []).map((r) => r.key);
  const at = (p: ExecDewateringPeriod | null | undefined, key: string) =>
    p?.rows.find((r) => r.key === key);

  return (
    <Card icon={<Waves size={14} />} title="Dewatering Performance"
          sub={
            <span className="flex items-center gap-2">
              <span className="text-[10px] tabular-nums text-txt-light">
                {d.data_to ? `data up to ${niceDate(d.data_to)}` : "no data"}
              </span>
              {/* The chip reports the DATA, not the pumping: a month 90%
                  achieved on a third of its days is not a 90% month. */}
              <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold
                                tracking-widest uppercase ${BADGE[d.status]}`}
                    title={`${d.entered} of ${d.window_days} days entered`}>
                {BADGE_TEXT[d.status]}
              </span>
            </span>
          }>
      {/* THE GAP IS STATED BEFORE ANY FIGURE IS READ. A reader who takes the
          MTD total without knowing it covers thirteen of thirty-one days has
          taken a wrong number, and a footnote at the bottom of the card is
          read after the figure has already been copied. */}
      {d.gap_from && (
        <div className="mx-4 mt-3 rounded-md border-l-[3px] border-danger
                        bg-danger-bg/60 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-txt-secondary">
            <span className="font-bold text-danger">Data gap:</span>{" "}
            no dewatering actuals for {shortDay(d.gap_from)}–{shortDay(d.gap_to)}
            {" "}({gapDays} of {d.window_days} days).{" "}
            {/* With nothing entered at all there is no window to qualify, and
                "figures below cover — to —" would be worse than silence. */}
            {d.entered === 0
              ? "Nothing has been filed for this month."
              : <>Every figure below covers {shortDay(d.mtd?.from)} – {shortDay(d.data_to)} only.</>}
          </p>
        </div>
      )}

      {k && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 p-4">
          <Tile label="MTD Water Disposal" value={k.disposal_actual} unit="M³"
                accent="#1565c0" strong
                sub={k.disposal_plan == null ? undefined
                  : `Plan ${formatIndian(k.disposal_plan, 0)} · Ach ${k.disposal_pct ?? "—"}%`} />
          <Tile label="MTD Pump Run Hours" value={k.pump_actual_hr} unit="h"
                accent="#c8960c"
                sub={k.pump_plan_hr == null ? undefined
                  : `Plan ${k.pump_plan_hr} · Ach ${k.pump_pct ?? "—"}%`} />
          {/* The one figure here that is not a total. It is what the pumps
              averaged, beside what they MUST average to match the inflow —
              the line below which the sump rises however good the
              compliance percentage looks. */}
          <Tile label="Avg Pumping / Day" value={k.avg_pump_hr} unit="h/day"
                accent="#283593"
                sub={`Plan ${k.avg_plan_hr ?? "—"} h`
                  + (k.offset_hr == null ? "" : ` · ${k.offset_hr} h/day offsets inflow`)} />
          {/* The plan leads the sub-line here, as it does on every other
              tile, with the movement off the opening behind it. */}
          <Tile label="Sump Closing Stock" value={k.closing_stock} unit="M³"
                accent="#2e7d32"
                sub={(k.plan_closing_stock == null ? ""
                  : `Plan ${formatIndian(k.plan_closing_stock, 0)} · `)
                  + (k.opening_stock == null ? ""
                    : `Opening ${formatIndian(Math.round(k.opening_stock), 0)}`
                      + (k.stock_change_pct == null ? ""
                        : ` · ${k.stock_change_pct <= 0 ? "↓" : "↑"} ${Math.abs(k.stock_change_pct)}%`))
                  || undefined} />
          {/* Blank when the sump is RISING. A sump that is filling has no
              date it empties, and a negative number of days would read as a
              small one. */}
          <Tile label="Est. Days to Clear" value={k.days_to_clear} unit="days"
                accent="#0f766e"
                sub={k.net_drawdown == null || k.net_drawdown <= 0
                  ? "sump is not falling — no clearance date"
                  : `Net drawdown ≈ ${formatIndian(Math.round(k.net_drawdown), 0)} M³/day`} />
          <Tile label="Data Completeness" value={k.completeness_pct} unit="%"
                accent={d.status === "ok" ? "#2e7d32"
                  : d.status === "watch" ? "#c8960c" : "#c62828"}
                sub={`${d.entered} of ${d.window_days} days entered`} />
        </div>
      )}

      {/* A header with no rows under it is chrome. With nothing entered the
          banner above has already said so, and an empty grid only invites
          somebody to look for figures that are not there. */}
      {keys.length > 0 && (
      <table className="w-full text-[12px] tabular-nums border-collapse">
        <thead>
          <tr className={THEAD}>
            <th className={`${TH} text-left min-w-[180px]`} rowSpan={2}>Parameter</th>
            <th className={`${TH} text-center border-l border-border text-steel`}
                colSpan={3}>
              TD · {shortDay(d.td?.date)}
            </th>
            <th className={`${TH} text-center border-l-2 border-border text-steel ${MTD_BG}`}
                colSpan={3}>
              MTD · {shortDay(d.mtd?.from)} – {shortDay(d.mtd?.to)}
            </th>
          </tr>
          <tr className={THEAD}>
            <th className={`${TH} text-right border-l border-border`}>Plan</th>
            <th className={`${TH} text-right`}>Actual</th>
            <th className={`${TH} text-right`}>Ach %</th>
            <th className={`${TH} text-right border-l-2 border-border ${MTD_BG}`}>Plan</th>
            <th className={`${TH} text-right ${MTD_BG}`}>Actual</th>
            <th className={`${TH} text-right ${MTD_BG}`}>Ach %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {keys.map((key) => {
            const a = at(d.td, key), b = at(d.mtd, key);
            return (
              <tr key={key} className="hover:bg-bg-light">
                <td className={`${TD} font-semibold text-[11px] whitespace-nowrap`}>
                  {b?.label ?? a?.label ?? key}
                  <span className="ml-1 font-normal text-txt-light">({b?.uom ?? a?.uom})</span>
                </td>
                {cells(a, "")}
                {cells(b, MTD_BG)}
              </tr>
            );
          })}
        </tbody>
      </table>
      )}

      <p className="px-4 py-2 border-t border-border-light bg-bg-section/40
                    text-[9px] font-mono leading-relaxed text-txt-secondary">
        <span className="font-semibold">ALL FIGURES · </span>entered at the mine,
        day by day, on the Enter Daily Dewatering Data form — there is no feed
        behind any of them.
        {"   "}<span className="font-semibold">DISPOSAL · </span>pump hours ×
        adjusted pump capacity, as the mine&apos;s own sheet computes it.
        {"   "}<span className="font-semibold">INFLOW · </span>measured seepage
        plus rainfall converted at the factor the day was filed under.
        {"   "}<span className="font-semibold">SUMP CLOSING STOCK · </span>
        opening + seepage + rain water − disposal. The PLAN column is that
        same balance with PLAN disposal in it, chained day by day — where the
        sump would have been left had the plan been pumped against the water
        that actually arrived — so below plan is the good direction. Opening
        is the previous day&apos;s closing, which makes the MTD pair span the
        first and last days ENTERED, not the first and last days of the month.
        {"   "}<span className="font-semibold">A PLAN OF 0 · </span>means the
        plan asked for more water than ever reached the sump. A sump holds no
        negative water, so the plan column stops at empty rather than
        subtracting water that was never there into a stock that cannot exist;
        the variance is then left blank, because an empty sump is not a level
        to measure against.
        {k?.plan_dry_from && (
          <>
            {" "}Over this period the plan would have run the sump dry from{" "}
            <span className="font-semibold">{shortDay(k.plan_dry_from)}</span>
            {k.plan_dry_days > 1 ? ` and on ${k.plan_dry_days} days in all` : ""}.
          </>
        )}
      </p>
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
                <td className={`${TD} text-right border-l border-border-light`}><N v={a?.qty} dp={0} strong /></td>
                <td className={`${TD} text-right`}><N v={a?.cr} /></td>
                <td className={GAP} aria-hidden />
                <td className={`${TD} text-right border-l border-border ${MTD_BG}`}><N v={b?.qty} dp={0} strong /></td>
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
            <td className={`${TD} text-right border-l border-border-light whitespace-nowrap`}>
              <N v={tdTotal?.qty} dp={0} strong />
            </td>
            <td className={`${TD} text-right`}><N v={tdTotal?.cr} strong /></td>
            <td className={GAP} aria-hidden />
            <td className={`${TD} text-right border-l border-border whitespace-nowrap`}>
              <N v={mtdTotal?.qty} dp={0} strong />
            </td>
            <td className={`${TD} text-right`}><N v={mtdTotal?.cr} strong /></td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/* ── Block 5a · despatch against plan, before the grade detail ─────────────
   THE SAME TABLE AS THE TWO BELOW IT, carrying the two destinations added
   together. Those report Balasore and Sukinda grade by grade; this one answers
   the same questions of despatch as a whole, in the same shape, so the screen
   can be read straight down one pair of columns instead of changing form
   halfway.

   MERGED IN THE BROWSER, FROM THE ROWS ALREADY ON IT. Nothing new is fetched
   and no second derivation exists to drift: every figure here is built from
   the two blocks below, which is why a reader can always add them up and get
   this. BAL and JABAMOYEE are the only mines customers there are
   (despatch_grade.MINES_CUSTOMERS is that pair), so their sum is the whole of
   despatch rather than most of it.

   EACH COLUMN COMBINED THE WAY ITS OWN KIND COMBINES. Tonnage and plan add;
   the assays do not. Cr/Fe and Cr2O3 are averaged across the two destinations
   weighted by the tonnage each sent, because 3,400 MT to Sukinda at 43.29 and
   22,677 MT to Balasore at 44.66 is not a 43.98 month. Achievement is taken
   once on the combined plan and tonnage, never averaged across the two — the
   same rule the Weighted Avg row of every other block already uses.

   A MONTH WITH NO PLAN IS NOT A PLAN OF ZERO. June 2026 has no rows in
   mines_despatch_plan at all; where both destinations are silent the cell
   stays null and prints a dash, rather than reporting a miss against a target
   nobody set. */

/** Sum that keeps "nothing was reported" distinct from "zero was reported". */
function addOrNull(vals: (number | null | undefined)[]): number | null {
  const present = vals.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** Tonnage-weighted mean across the destinations, or null if none assayed. */
function wavgBy(parts: ExecGradeRow[], key: "cr2o3" | "crfe"): number | null {
  let num = 0, den = 0;
  for (const r of parts) {
    const v = r[key], q = r.qty;
    if (v != null && q != null && q > 0) { num += v * q; den += q; }
  }
  return den ? Math.round((num / den) * 1000) / 1000 : null;
}

const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
/** Matches backend production._pct exactly: same guard, same single decimal. */
const pct = (actual: number | null, plan: number | null) =>
  actual == null || plan == null || plan === 0
    ? null : Math.round((actual / plan) * 1000) / 10;

function mergeDespatch(byDest: Record<string, ExecGradeRow[]> | undefined): {
  rows: ExecGradeRow[]; total: ExecWeightedTotal;
} {
  const lists = Object.values(byDest ?? {}).map((l) => l ?? []);
  /* Keyed by grade and merged, never zipped by index: a grade one destination
     shipped and the other did not — "Not yet assayed" is the live case —
     would otherwise land on the wrong line. */
  const keys: string[] = [];
  const labels: Record<string, string> = {};
  for (const l of lists) for (const r of l) {
    if (!keys.includes(r.grade)) keys.push(r.grade);
    if (!labels[r.grade]) labels[r.grade] = r.label;
  }

  const rows: ExecGradeRow[] = keys.map((k) => {
    const parts = lists.flatMap((l) => l.filter((r) => r.grade === k));
    const qty = r2(addOrNull(parts.map((r) => r.qty)));
    const plan = r2(addOrNull(parts.map((r) => r.plan)));
    const est = addOrNull(parts.map((r) => r.estimated_qty));
    /* The share's denominator is GRADED tonnage, the same denominator each
       row used, so this agrees with its own lines instead of being a third
       kind of average. */
    const graded = parts.reduce(
      (s, r) => s + (r.cr2o3 != null ? (r.qty ?? 0) : 0), 0);
    return {
      grade: k, label: labels[k] ?? k,
      qty, plan, ach_pct: pct(qty, plan),
      crfe: wavgBy(parts, "crfe"), cr2o3: wavgBy(parts, "cr2o3"),
      estimated_qty: r2(est),
      estimated_pct: graded && est ? Math.round((est / graded) * 1000) / 10 : null,
      manual_qty: r2(addOrNull(parts.map((r) => r.manual_qty))),
    };
  });

  /* The Weighted Avg row, built from the merged rows by the same rule the
     backend's _totals uses — plan summed from the rows and achievement taken
     once on the totals, so a grade planned at 100 MT and missed counts for
     its tonnage rather than equally with one planned at 20,000. */
  const all = lists.flat();
  const qty = r2(addOrNull(all.map((r) => r.qty)));
  const plan = r2(addOrNull(all.map((r) => r.plan)));
  const est = addOrNull(all.map((r) => r.estimated_qty));
  const graded = all.reduce((s, r) => s + (r.cr2o3 != null ? (r.qty ?? 0) : 0), 0);
  return {
    rows,
    total: {
      qty, plan, ach_pct: pct(qty, plan),
      crfe: wavgBy(all, "crfe"), cr2o3: wavgBy(all, "cr2o3"), cr: null,
      estimated_qty: r2(est),
      estimated_pct: graded && est ? Math.round((est / graded) * 1000) / 10 : null,
      manual_qty: r2(addOrNull(all.map((r) => r.manual_qty))),
    },
  };
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

  /* THE SUMMARY'S OWN WINDOW, not the global filter -- see useRainImpact. The
     server derives the month from the end date, so this must ask for the same
     span the Plan it is deducted from was built over. */
  const rain = useRainImpact(d?.mtd_from, d?.report_day);

  /* Every performance card is cut off at the same day, so each header says
     which day rather than repeating the column names printed inside it. */
  const statusTill = d ? `Status till ${niceDate(d.report_day)}` : "";
  /* Built once here rather than inside each table: the four of them must name
     the same days, and four copies of this would be four chances to drift. */
  const tdLabel  = d ? `TD · ${shortDay(d.report_day)}` : "TD";
  const mtdLabel = d
    ? `MTD · ${shortDay(d.mtd_from)} – ${shortDay(d.report_day)}`
    : "MTD";

  /* ── the HTML download ──────────────────────────────────────────────── */
  const { label: dateRange, periodLabel } = useDateFilter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [htmlDone, setHtmlDone] = useState(false);

  async function handleHtml() {
    if (busy) return;
    setBusy(true);
    setHtmlDone(false);
    try {
      // EXPORT MODE FIRST, even though nothing on this page collapses. The
      // two trend charts at the foot of the report fetch their own windows
      // on mount, and capturing before they land writes their skeletons into
      // the file — a grey box where the quality trend should be. The
      // isFetching callback is what waits for them.
      await withExportMode(
        () =>
          downloadDashboard({
            // THE WINDOW THE REPORT ACTUALLY COVERS, NOT THE ONE THE FILTER
            // ASKED FOR. The server cuts the end back to the last day that
            // has ENDED, so the default "this month" filter reads
            // "1 Nov – 30 Nov" while the report inside covers four days. The
            // banner is the first thing a reader sees in the file, and it
            // must not contradict the heading two inches below it. Falls
            // back to the filter's own label only if the response is absent,
            // in which case there is nothing to export anyway.
            dateRange: d
              ? `${niceDate(d.mtd_from)} – ${niceDate(d.report_day)}`
              : dateRange,
            periodLabel,
            rootSelector: "#executive-summary-section",
            title: "Executive Summary",
            fileStem: "kaliapani-executive-summary",
          }),
        () => qc.isFetching(),
      );
      setHtmlDone(true);
      setTimeout(() => setHtmlDone(false), 2500);
    } finally {
      setBusy(false);
    }
  }

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
    // The id is what the download points at: the whole report, none of the
    // chrome around it. Same mechanism the MIS, Intelligence and OEE exports
    // use — see utils/downloadDashboard.ts.
    <div id="executive-summary-section" className="space-y-4">
      {/* THE HOUSE SECTION HEADING, not a navy banner of its own. `.section-title`
          is what every other screen uses — condensed steel caps with a rule
          running off to the right — so this page announces itself the same way
          OEE and Plant Output do instead of inventing a heavier one.

          Wrapped in a flex row so the download button can sit at the end of
          that rule rather than before it: `.section-title::after` is the rule
          itself and is always the last child, so a button placed inside would
          have the line drawn past it. */}
      <div className="flex items-center gap-3 mb-2.5">
        <div className="section-title flex-1 mb-0">
          <ClipboardList size={13} />
          Executive Summary
          {d && (
            <span className="text-[10px] text-txt-light font-medium normal-case tracking-normal ml-1">
              TD {niceDate(d.report_day)} · MTD {niceDate(d.mtd_from)} – {niceDate(d.report_day)}
              {" · "}Stock as on {niceDate(d.stock_as_on)}
            </span>
          )}
        </div>

        {/* THE WHOLE REPORT AS ONE HTML FILE — the tiles, the stock grid and
            every performance card, exactly as they sit here. Disabled while
            loading: a snapshot of a loading message is worse than no file.
            Styled from OEESection's button down to the three states, because
            they do the same job and must not read as two features. */}
        <button
          type="button"
          onClick={handleHtml}
          disabled={q.isLoading || busy || !d}
          data-export-hide
          title="Download the Executive Summary as a self-contained HTML file"
          className={`
            shrink-0 flex items-center gap-[6px] px-3 py-1.5 rounded
            font-condensed text-[11px] font-bold tracking-[.08em] uppercase
            transition-all duration-150
            ${htmlDone
              ? "bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]"
              : busy || q.isLoading || !d
                ? "bg-[#f5f7fb] text-[#8899bb] border border-[#d0d9e8] cursor-wait"
                : "bg-[#2e7d32] text-white border border-[#2e7d32] hover:bg-[#388e3c] hover:border-[#388e3c] active:scale-95"
            }
          `}
        >
          {htmlDone
            ? <><Check size={12} className="shrink-0" /><span>Downloaded</span></>
            : busy
              ? <><span className="w-3 h-3 border border-[#b0bdd4] border-t-[#6b7ea8] rounded-full animate-spin shrink-0" /><span>Preparing…</span></>
              : <><Download size={12} className="shrink-0" /><span>Export to HTML</span></>
          }
        </button>
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

          {/* ABOVE MINES PRODUCTION, where the mine asked for it: the one-line
              verdict on the month comes before the grade detail that explains
              it. Given the whole payload rather than a dozen props -- it reads
              seven different blocks of it, and threading those through the
              signature would be a parameter list nobody could keep straight. */}
          <MainKpiBlock d={d} mtdLabel={mtdLabel} />

          {/* MINES PRODUCTION ALONE CARRIES THE RAIN ROWS. The deduction is
              ore at the face; against COB concentrate or a despatch it would
              be a figure borrowed from another question. */}
          <GradeTable icon={<Pickaxe size={14} />} title="Mines Production"
            sub={statusTill} qtyLabel="Production (MT)" showPlan qtyDp={0}
            tdLabel={tdLabel} mtdLabel={mtdLabel}
            td={d.td.production} mtd={d.mtd.production}
            tdTotal={d.td.production_total} mtdTotal={d.mtd.production_total}
            rainImpactMt={rain.mt} />

          {/* Concentrate, not ore, and reported apart from the grades above:
              it is beneficiated at plant 1210 against its own plan, and a
              tonne of it answers a different question from a tonne of ROM. */}
          <GradeTable icon={<Layers size={14} />} title="COB Production"
            sub={statusTill} qtyLabel="Production (MT)" showPlan qtyDp={0}
            tdLabel={tdLabel} mtdLabel={mtdLabel}
            td={d.td.cob ?? []} mtd={d.mtd.cob ?? []}
            tdTotal={d.td.cob_total} mtdTotal={d.mtd.cob_total} />

          {/* Directly under Mines Production: ore, overburden and de-silting
              are one shift's work at the same faces, and the OB figure is the
              first thing asked for after the ore figure. */}
          <ExcavationBlock statusTill={statusTill}
            tdLabel={tdLabel} mtdLabel={mtdLabel}
            td={d.td.excavation ?? []} mtd={d.mtd.excavation ?? []} />

          {/* Dewatering sits with the excavation work above it rather than
              with the despatch blocks below: keeping the pit dry is what
              makes the faces workable, so it answers a question about the
              same shift. Absent entirely when the platform database could
              not be read — a card of dashes would say the mine pumped
              nothing, which is a different claim from "nobody knows". */}
          {d.dewatering?.available && <DewateringBlock d={d.dewatering} />}

          {/* Despatch as a whole, before the two destination blocks break it
              down. Rendered by the SAME component they are, so the three
              cannot drift apart in shape. */}
          {(() => {
            const a = mergeDespatch(d.td.despatch);
            const b = mergeDespatch(d.mtd.despatch);
            return (
              <GradeTable icon={<Truck size={14} />} title="Total Despatch"
                sub={statusTill} qtyLabel="Despatch (MT)" showPlan qtyDp={0}
                tdLabel={tdLabel} mtdLabel={mtdLabel}
                td={a.rows} mtd={b.rows}
                tdTotal={a.total} mtdTotal={b.total} />
            );
          })()}

          {DEST.map((x, i) => (
            <GradeTable key={x.key}
              icon={i === 0 ? <Truck size={14} /> : <Send size={14} />}
              title={x.label} sub={statusTill} qtyLabel="Despatch (MT)" showPlan qtyDp={0}
              tdLabel={tdLabel} mtdLabel={mtdLabel}
              td={d.td.despatch[x.key] ?? []} mtd={d.mtd.despatch[x.key] ?? []}
              tdTotal={d.td.despatch_total[x.key]} mtdTotal={d.mtd.despatch_total[x.key]} />
          ))}

          <PlantBlock statusTill={statusTill} tdLabel={tdLabel} mtdLabel={mtdLabel}
            td={d.td.plant} mtd={d.mtd.plant}
            tdTotal={d.td.plant_total} mtdTotal={d.mtd.plant_total} />

          {/* THE TWO ASSAYS OF ONE CONSIGNMENT, day by day. Everything above
              reports a month as a single weighted figure; these say whether
              the mine and the plant have been reading the same ore all month
              or drifting apart. Given the report's OWN window rather than the
              dashboard filter, so the lines cover exactly the days the tables
              above them cover. */}
          <QualityTrendCharts from={d.mtd_from} to={d.report_day} />

          {/* DIRECTLY BELOW THE DESPATCH QUALITY TREND, where the mine asked
              for them: what the month cost and who owns it, after the
              production and quality detail that explains how it arose.
              Both take the report's OWN window rather than the dashboard
              filter, so the loss covers exactly the days the tables above
              cover -- see useExecLcm. */}
          <KamLossBlock from={d.mtd_from} to={d.report_day} mtdLabel={mtdLabel} />
          <KamRatingBlock from={d.mtd_from} to={d.report_day} mtdLabel={mtdLabel} />
          <ControllableLossBlock from={d.mtd_from} to={d.report_day} mtdLabel={mtdLabel} />

          {/* And then what the ore became. Production and assay on one pair of
              axes, because a quality dip on a full day and the same dip on a
              40-tonne day are not the same event. */}
          <PlantOutputTrendChart from={d.mtd_from} to={d.report_day} />

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
