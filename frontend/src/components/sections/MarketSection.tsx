"use client";
/**
 * What chrome ore is worth, what the mine owes on it, and what is being said.
 *
 * Five tabs, and the split is not cosmetic:
 *
 *   ROYALTY   what a tonne costs in statutory charges, worked out on the IBM
 *             average sale price, because that is what royalty is levied on.
 *   IBM ASP   the monthly series those charges are computed from.
 *   OMC       what the ore actually fetched at auction. A different question,
 *             answered by a different publisher on a different basis.
 *   NEWS      the sector, tagged so chrome reads apart from the rest.
 *   SOURCES   whether any of it is still arriving.
 *
 * THE TWO PRICES ARE NOT THE SAME NUMBER AND MUST NOT BE AVERAGED. IBM
 * publishes a statistical average for a whole state over a calendar month;
 * OMC publishes a weighted average achieved at one e-auction, for one mine,
 * over a stated window. Royalty is levied on the first. The second is a
 * market benchmark — a close one, because South Kaliapani Chromite Mines is
 * the same ore in the same valley. Separate tabs, separate wording, never
 * summed.
 *
 * NOTHING HERE IS THE MINE'S OWN DATA. Every figure links to the document it
 * was read from, because that document is the authority and this is a
 * convenience over it.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ExternalLink, FileWarning, Gauge, Gavel, Landmark, Loader2,
  ArrowUpDown, Calculator, Clock, History, Languages, Minus, Newspaper,
  Plus, RefreshCw, TrendingDown, TrendingUp, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import ColumnFilter, { optionsFrom, matches } from "@/components/minehub/ColumnFilter";
import {
  Alert, Button, Card, CardHeader, Chip, PageHeader, Tabs, type Tone,
} from "@/components/minehub/ui";
import { ago, exactly } from "@/components/minehub/when";
import Dialog from "@/components/minehub/Dialog";
import DateField from "@/components/minehub/DateField";
import { toCsv, download } from "@/components/minehub/spreadsheet";
import { CalendarRange } from "lucide-react";

interface PriceRow {
  grade: string; period: string; price: number; unit: string;
  document_url: string | null; is_flagged: boolean; flag_reason: string | null;
  fetched_at: string; first_seen_at: string | null; revisions: number;
  published_on: string | null;
  previous: number | null; change_pct: number | null;
}
interface Revision {
  revision_id: number; kind: string; label: string; period_label: string;
  old_price: number | null; new_price: number | null;
  old_document_url: string | null; new_document_url: string | null;
  changed_at: string; change_pct: number | null;
}
interface Prices { latest_period: string | null; grades: string[]; rows: PriceRow[] }
interface Rate {
  code: string; name: string; percent: number; basis: string;
  effective_from: string; note: string | null;
}
interface RoyaltyRow {
  grade: string; asp: number; unit: string; royalty: number;
  parts: { code: string; name: string; percent: number; amount: number }[];
  total: number; effective_pct: number | null;
  document_url: string | null; is_flagged: boolean;
}
interface Basis {
  publisher: string; publication: string; mineral: string; state: string;
  period: string; document_url: string | null; fetched_at: string | null;
  grades: number; revisions: number;
}
interface Royalty {
  period: string | null; rates: Rate[]; rows: RoyaltyRow[];
  basis?: Basis; note?: string;
}
interface AuctionRow {
  mine: string; grade: string; basis_pct: number | null; price: number;
  unit: string; valid_from: string; valid_to: string;
  auction_date: string | null; document_url: string | null;
  first_seen_at: string | null; revisions: number;
}
interface Window {
  valid_from: string; valid_to: string; auction_date: string | null; rows: number;
}
interface Auction {
  rows: AuctionRow[]; mines: string[]; windows: Window[];
  window: string | null;
  latest_from: string | null; latest_to: string | null; auction_date: string | null;
  // OMC publishes for a window. Once it passes, the figure is last month's
  // and the screen must say so rather than showing it as current.
  lapsed: boolean; days_lapsed: number; is_latest: boolean;
}
interface NewsItem {
  news_id: number; title: string; title_en: string | null;
  summary_en: string | null; lang: string | null; translated_by: string | null;
  url: string; published_at: string | null;
  summary: string | null; tags: string[]; fetched_at: string; source: string;
}
interface Source {
  source_id: number; code: string; name: string; kind: string; url: string;
  about: string | null; every_hours: number; last_ok_at: string | null;
  last_status: string | null; last_error: string | null;
  prices: number; items: number;
}

const inr = (n: number, dp = 0) =>
  "₹" + n.toLocaleString("en-IN",
    { minimumFractionDigits: dp, maximumFractionDigits: dp });
const monthLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB",
    { month: "short", year: "numeric" });
const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB",
    { day: "2-digit", month: "short", year: "numeric" });

/** Up is not good news here — the royalty rises with it — so the arrow says
 *  which way and the colour stays neutral rather than red or green. */
function Move({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-txt-light">—</span>;
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums font-semibold
                      ${Math.abs(pct) >= 10 ? "text-amber" : "text-txt-secondary"}`}>
      <Icon className="w-3.5 h-3.5" />{pct > 0 ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

const input = "w-full bg-bg-base border border-border rounded-lg px-3 py-2 "
  + "text-[13px] text-txt-primary tabular-nums focus:outline-none "
  + "focus:border-indigo focus:ring-2 focus:ring-indigo/15";
const lbl = "block text-[11px] font-semibold text-txt-secondary mb-1";

/** A column heading that sorts. The arrow shows the current direction, and
 *  a dimmed one shows the column can sort at all — a header that only reveals
 *  itself on hover is a feature nobody finds. */
function SortTh({ label, col, sort, onSort, right }: {
  label: string; col: string;
  sort: { key: string; dir: string };
  onSort: (c: string) => void; right?: boolean;
}) {
  const on = sort.key === col;
  return (
    <th className={`px-3 py-2 border-b border-border-light whitespace-nowrap
                    ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 text-[10.5px] font-bold uppercase
                    tracking-wide transition-colors
                    ${on ? "text-navy" : "text-txt-light hover:text-txt-secondary"}`}>
        {label}
        <ArrowUpDown className={`w-3 h-3 ${on ? "opacity-100" : "opacity-40"}`} />
        {on && (
          <span className="text-[9px] font-normal">
            {sort.dir === "asc" ? "↑" : "↓"}
          </span>
        )}
      </button>
    </th>
  );
}

const Th = ({ children, right, className = "" }: {
  children: React.ReactNode; right?: boolean; className?: string;
}) => (
  <th className={`px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide
                  text-txt-light border-b border-border-light whitespace-nowrap
                  ${right ? "text-right" : "text-left"} ${className}`}>
    {children}
  </th>
);

/** What a published figure used to be, whenever a publisher restated it.
 *
 *  Normally empty, and that emptiness is the point: nothing the royalty was
 *  worked out on has moved. A row here is a publisher changing their mind
 *  after the fact, which is exactly the thing that is invisible otherwise —
 *  the collector overwrites in place, so without this the old figure would
 *  simply have stopped existing. */
function Revisions({ rows, what }: { rows: Revision[]; what: string }) {
  if (rows.length === 0) {
    return (
      <Card>
        <div className="px-5 py-4 flex items-start gap-3">
          <History className="w-4 h-4 mt-0.5 text-txt-light shrink-0" />
          <p className="text-[12.5px] text-txt-muted leading-snug">
            <strong className="text-navy">Nothing has been restated.</strong>{" "}
            No {what} figure has changed since it was first read. Every
            revision is kept from now on — if a publisher reissues a corrected
            document, the previous figure and the date it changed appear here
            rather than being quietly overwritten.
          </p>
        </div>
      </Card>
    );
  }
  return (
    <Card tone="amber">
      <CardHeader title={`Restated · ${rows.length}`} icon={History} tone="amber"
        subtitle="A publisher changed a figure after we had already read it. The earlier value is kept here." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead><tr>
            <Th>What</Th><Th>Period</Th><Th right>Was</Th><Th right>Became</Th>
            <Th right>Move</Th><Th>When</Th>
          </tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.revision_id} className="border-b border-border-light last:border-0">
                <td className="px-3 py-2 text-[12.5px] font-semibold text-navy">
                  {v.label}</td>
                <td className="px-3 py-2 text-[12px] text-txt-muted">{v.period_label}</td>
                <td className="px-3 py-2 text-right text-[12.5px] tabular-nums
                               text-txt-light line-through">
                  {v.old_price !== null ? inr(v.old_price) : "—"}</td>
                <td className="px-3 py-2 text-right text-[12.5px] tabular-nums
                               font-semibold text-navy">
                  {v.new_price !== null ? inr(v.new_price) : "—"}</td>
                <td className="px-3 py-2 text-right text-[12px]">
                  <Move pct={v.change_pct} /></td>
                <td className="px-3 py-2 text-[11.5px] text-txt-light whitespace-nowrap"
                  title={exactly(v.changed_at)}>{ago(v.changed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function MarketSection() {
  const can = useAuth((s) => s.can);
  const mayRefresh = can("market.refresh");
  // Changing a statutory rate is not the same right as re-running a
  // collector, and is granted separately.
  const mayRates = can("market.rates.manage");

  const [tab, setTab] = useState<"royalty" | "asp" | "omc" | "news" | "sources">("royalty");
  const [prices, setPrices] = useState<Prices | null>(null);
  const [royalty, setRoyalty] = useState<Royalty | null>(null);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [grade, setGrade] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: "period" | "grade" | "price" | "change";
                                     dir: "asc" | "desc" }>(
    { key: "period", dir: "desc" });
  const [omcWindow, setOmcWindow] = useState("");
  const [mine, setMine] = useState("");
  const [tag, setTag] = useState("");

  // The calculator. Seeded from the published figures, then free — the point
  // is to answer "what if the rate changes" and "what does this consignment
  // owe", neither of which the published table can.
  // Several lines, because the question is rarely about one grade. A
  // despatch is a mix, and "which grade carries the most charge" is a
  // comparison, not a single sum.
  const [lines, setLines] = useState<
    { id: number; grade: string; asp: string; tonnes: string }[]>([]);
  const [rates, setRates] = useState({ royalty: "", dmf: "", nmet: "" });
  const [nextId, setNextId] = useState(1);

  // Changing a statutory rate for everybody, not just this calculator.
  const [editRate, setEditRate] = useState<
    { code: string; name: string; percent: string; basis: string;
      effective_from: string } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, r, a, n, s, v] = await Promise.all([
        api.get("/market/prices", { params: { months: 24 } }),
        api.get("/market/royalty"),
        api.get("/market/auction", { params: omcWindow ? { window: omcWindow } : {} }),
        api.get("/market/news", { params: { limit: 80 } }),
        api.get("/market/sources"),
        api.get("/market/revisions", { params: { limit: 200 } }),
      ]);
      setPrices(p.data); setRoyalty(r.data); setAuction(a.data);
      setNews(n.data ?? []); setSources(s.data ?? []);
      setRevisions(v.data ?? []); setError(null);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not read the market figures.");
    } finally { setLoading(false); }
  }, [omcWindow]);

  useEffect(() => { void load(); }, [load]);

  // Seed from what was actually published, so it opens on a real case rather
  // than an empty form. Once only — after that it belongs to the reader.
  useEffect(() => {
    if (!royalty?.rows.length || lines.length) return;
    const pct = (c: string) =>
      String(royalty.rates.find((r) => r.code === c)?.percent ?? "");
    setRates({ royalty: pct("ROYALTY"), dmf: pct("DMF"), nmet: pct("NMET") });
    setLines(royalty.rows.slice(0, 2).map((r, k) => ({
      id: k + 1, grade: r.grade, asp: String(r.asp), tonnes: "1000",
    })));
    setNextId(royalty.rows.slice(0, 2).length + 1);
  }, [royalty, lines.length]);

  const saveRate = async () => {
    if (!editRate) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.put(`/market/royalty-rates/${editRate.code}`, {
        percent: parseFloat(editRate.percent),
        basis: editRate.basis,
        effective_from: editRate.effective_from,
        name: editRate.name,
      });
      setNotice(`${editRate.name}: ${r.data.was} → ${r.data.now}, `
        + `from ${dayLabel(editRate.effective_from)}. The previous rate is kept, `
        + `so earlier periods still compute on it.`);
      setEditRate(null);
      // The calculator is seeded from the rates; let it re-seed.
      setLines([]);
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "That rate was not changed.");
    } finally { setBusy(false); }
  };

  const refresh = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.post("/market/refresh", {});
      const ran = (r.data?.ran ?? []) as { code: string; ok: boolean }[];
      const bad = ran.filter((x) => !x.ok);
      setNotice(`${ran.length - bad.length} of ${ran.length} sources answered.`
        + (bad.length ? ` ${bad.map((b) => b.code).join(", ")} did not.` : ""));
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "The refresh did not run.");
    } finally { setBusy(false); }
  };

  const latestAsp = useMemo(() => {
    const by = new Map<string, PriceRow>();
    for (const r of prices?.rows ?? []) {
      const seen = by.get(r.grade);
      if (!seen || r.period > seen.period) by.set(r.grade, r);
    }
    return [...by.values()].sort((a, b) => a.grade.localeCompare(b.grade));
  }, [prices]);

  const months = useMemo(
    () => [...new Set((prices?.rows ?? []).map((r) => r.period))].sort(),
    [prices]);

  const series = useMemo(() => {
    const rows = (prices?.rows ?? []).filter((r) =>
      matches(r.grade, grade)
      && (!from || r.period >= from)
      && (!to || r.period <= to));
    const dir = sort.dir === "asc" ? 1 : -1;
    const key = (r: PriceRow) => {
      switch (sort.key) {
        case "grade": return r.grade;
        case "price": return r.price;
        // A row with no previous month sorts last either way: no change is
        // not a small change.
        case "change": return r.change_pct ?? (sort.dir === "asc" ? Infinity : -Infinity);
        default: return r.period;
      }
    };
    return [...rows].sort((a, b) => {
      const x = key(a), y = key(b);
      if (x === y) return a.grade.localeCompare(b.grade);
      return (typeof x === "number" && typeof y === "number"
        ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [prices, grade, from, to, sort]);
  const auctionRows = useMemo(
    () => (auction?.rows ?? []).filter((r) => matches(r.mine, mine)),
    [auction, mine]);
  const shownNews = useMemo(
    () => news.filter((n) => !tag || n.tags.includes(tag)), [news, tag]);

  const num = (v: string) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };

  const worked = useMemo(() => {
    const rRate = num(rates.royalty), dRate = num(rates.dmf), nRate = num(rates.nmet);
    const rows = lines.map((l) => {
      const asp = num(l.asp), tonnes = num(l.tonnes);
      const royaltyPerT = asp * rRate / 100;
      // Of the royalty, not of the price. The one thing people get wrong.
      const dmfPerT = royaltyPerT * dRate / 100;
      const nmetPerT = royaltyPerT * nRate / 100;
      const totalPerT = royaltyPerT + dmfPerT + nmetPerT;
      return {
        ...l, asp, tonnes, royaltyPerT, dmfPerT, nmetPerT, totalPerT,
        value: asp * tonnes,
        charge: totalPerT * tonnes,
        effective: asp ? totalPerT / asp * 100 : 0,
      };
    });
    const t = (f: (r: typeof rows[number]) => number) =>
      rows.reduce((a, r) => a + f(r), 0);
    const tonnes = t((r) => r.tonnes);
    const charge = t((r) => r.charge);
    const value = t((r) => r.value);
    return {
      rows,
      total: {
        tonnes, charge, value,
        royalty: t((r) => r.royaltyPerT * r.tonnes),
        dmf: t((r) => r.dmfPerT * r.tonnes),
        nmet: t((r) => r.nmetPerT * r.tonnes),
        // Weighted by tonnage, not an average of the percentages — a hundred
        // tonnes of fines and one of lumps is not a fifty-fifty blend.
        perTonne: tonnes ? charge / tonnes : 0,
        effective: value ? charge / value * 100 : 0,
      },
    };
  }, [lines, rates]);

  const sortBy = (col: string) => setSort((p_) => ({
    key: col as typeof p_.key,
    // Second click reverses; a new column starts descending, because the
    // first question of any of these columns is "which is the biggest".
    dir: p_.key === col && p_.dir === "desc" ? "asc" : "desc",
  }));

  const parts = royalty?.rows[0]?.parts ?? [];
  const rateOf = (code: string) => royalty?.rates.find((x) => x.code === code);

  const exportRoyalty = () => download(
    toCsv(["Grade", "ASP", "Royalty", ...parts.map((p) => p.name),
           "Total per tonne", "Of value %"],
      (royalty?.rows ?? []).map((r) => [
        r.grade, r.asp, r.royalty, ...r.parts.map((p) => p.amount),
        r.total, r.effective_pct ?? ""])),
    `chrome-royalty-${royalty?.period ?? "latest"}.csv`);

  if (loading) {
    return <div className="flex justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  const broken = sources.filter((s) => s.last_error);

  return (
    <div className="space-y-4">
      <PageHeader lead="Market" rest="Watch" icon={Gauge} tone="teal"
        subtitle="Prices as published · what the mine owes · what the sector reports. None of it is the mine's own data."
        actions={mayRefresh ? (
          <Button variant="secondary" onClick={() => void refresh()} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RefreshCw className="w-4 h-4" />} Fetch now
          </Button>
        ) : undefined} />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}
      {broken.length > 0 && tab !== "sources" && (
        <Alert tone="warning">
          {broken.length === 1 ? `${broken[0].name} is not answering.`
                               : `${broken.length} sources are not answering.`}{" "}
          <button type="button" onClick={() => setTab("sources")}
            className="font-semibold underline underline-offset-2">See why</button>
        </Alert>
      )}

      <Tabs value={tab} onChange={(id) => setTab(id as typeof tab)} tabs={[
        { id: "royalty", label: "Royalty", icon: Landmark, tone: "gold" as Tone },
        { id: "asp", label: "IBM Sale Price", icon: Gauge, tone: "teal" as Tone },
        { id: "omc", label: "OMC Auction", icon: Gavel, tone: "violet" as Tone },
        { id: "news", label: "News", icon: Newspaper, tone: "indigo" as Tone },
        { id: "sources", label: "Sources", icon: FileWarning, tone: "slate" as Tone },
      ]} />

      {/* ── royalty ──────────────────────────────────────────────── */}
      {tab === "royalty" && (royalty && royalty.rows.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {royalty.rates.map((r) => (
              <Card key={r.code} tone={r.basis === "ASP" ? "gold" : "slate"}>
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11.5px] font-semibold text-txt-secondary">
                      {r.name}</span>
                    {mayRates && (
                      <button type="button"
                        onClick={() => setEditRate({
                          code: r.code, name: r.name, percent: String(r.percent),
                          basis: r.basis,
                          effective_from: new Date().toISOString().slice(0, 10),
                        })}
                        className="text-[10.5px] font-semibold text-gold-dark
                                   hover:underline shrink-0">
                        Change
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 text-[24px] font-bold text-navy tabular-nums">
                    {r.percent}%</div>
                  <div className="text-[11px] text-txt-light">
                    of {r.basis === "ASP" ? "the ASP" : "the royalty"}</div>
                  <div className="text-[10.5px] text-txt-light mt-0.5">
                    since {dayLabel(r.effective_from)}</div>
                </div>
              </Card>
            ))}
            <Card tone="teal">
              <div className="px-4 py-3">
                <div className="text-[11.5px] font-semibold text-txt-secondary">
                  Worked out on</div>
                <div className="mt-0.5 text-[18px] font-bold text-navy">
                  {royalty.period ? monthLabel(royalty.period) : "—"}</div>
                <div className="text-[11px] text-txt-light">IBM average sale price</div>
              </div>
            </Card>
          </div>

          <Card tone="gold">
            <CardHeader title="What a tonne owes" icon={Landmark} tone="gold"
              subtitle={`Worked out on the IBM average sale price for Odisha. Royalty is ${rateOf("ROYALTY")?.percent ?? 15}% of the ASP; DMF and NMET are shares of the royalty itself, not of the ASP — which is why the total is far below the three percentages added together.`}
              actions={<Button size="sm" variant="secondary" onClick={exportRoyalty}>
                Export</Button>} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead><tr>
                  <Th>Grade</Th>
                  <Th right>ASP</Th>
                  <Th right>Royalty
                    <span className="block font-normal normal-case text-[9.5px] text-txt-light">
                      {rateOf("ROYALTY")?.percent}% of price</span></Th>
                  {parts.map((p) => (
                    <Th key={p.code} right>{p.code}
                      <span className="block font-normal normal-case text-[9.5px] text-txt-light">
                        {p.percent}% of royalty</span></Th>
                  ))}
                  <Th right className="bg-gold/[0.07]">Total per tonne</Th>
                  <Th right>Of value</Th>
                </tr></thead>
                <tbody>
                  {royalty.rows.map((r) => (
                    <tr key={r.grade} className="border-b border-border-light last:border-0
                                                 hover:bg-bg-light/60">
                      <td className="px-3 py-2 text-[12.5px] font-semibold text-navy">
                        {r.grade}
                        {r.is_flagged && (
                          <AlertTriangle className="inline w-3.5 h-3.5 ml-1.5 text-amber" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">
                        {inr(r.asp)}</td>
                      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums
                                     text-txt-secondary">{inr(r.royalty, 2)}</td>
                      {r.parts.map((p) => (
                        <td key={p.code} className="px-3 py-2 text-right text-[12.5px]
                                                    tabular-nums text-txt-secondary">
                          {inr(p.amount, 2)}</td>
                      ))}
                      <td className="px-3 py-2 text-right text-[13px] font-bold tabular-nums
                                     text-navy bg-gold/[0.07]">{inr(r.total, 2)}</td>
                      <td className="px-3 py-2 text-right text-[11.5px] tabular-nums
                                     text-txt-light">{r.effective_pct?.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Where the numbers came from. A royalty figure somebody
                cannot trace is a royalty figure somebody re-does by hand. */}
            {royalty.basis && (
              <div className="px-4 py-3 border-t border-border-light bg-bg-light/50">
                <div className="text-[10.5px] font-bold uppercase tracking-wide
                                text-txt-light mb-1.5">
                  The figures behind this
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-2">
                  {([
                    ["Published by", royalty.basis.publisher],
                    ["Publication", royalty.basis.publication],
                    ["Issue", monthLabel(royalty.basis.period)],
                    ["Mineral and state",
                     `${royalty.basis.mineral}, ${royalty.basis.state}`],
                    ["Grades in the issue", `${royalty.basis.grades}`],
                    ["Read from the source",
                     royalty.basis.fetched_at ? ago(royalty.basis.fetched_at) : "—"],
                    ["Restated since",
                     royalty.basis.revisions
                       ? `${royalty.basis.revisions} figure(s) — see IBM Sale Price`
                       : "nothing has changed"],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[10.5px] text-txt-light">{k}</div>
                      <div className="text-[12px] font-semibold text-txt-secondary
                                      leading-snug">{v}</div>
                    </div>
                  ))}
                  {royalty.rates.map((r) => (
                    <div key={r.code}>
                      <div className="text-[10.5px] text-txt-light">
                        {r.code} in force since</div>
                      <div className="text-[12px] font-semibold text-txt-secondary">
                        {dayLabel(r.effective_from)}</div>
                    </div>
                  ))}
                </div>
                {royalty.basis.document_url && (
                  <a href={royalty.basis.document_url} target="_blank" rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11.5px]
                               font-semibold text-gold-dark hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open the IBM issue these prices were read from
                  </a>
                )}
              </div>
            )}

            <p className="px-4 py-3 border-t border-border-light text-[11.5px]
                          text-txt-light leading-snug">
              Worked out when this page is opened, never stored. A rate
              notification is recorded as a new rate from its own date, so every
              figure recomputes against the rate that actually applied rather
              than a stored total drifting away from the percentages printed
              above it.
            </p>
          </Card>
          <Card tone="indigo">
            <CardHeader title="Work out a despatch" icon={Calculator} tone="indigo"
              subtitle="Add a line per grade. Compare them side by side, or add up a mixed load. Nothing here is saved and the published table above is unaffected."
              actions={
                <Button size="sm" variant="secondary"
                  onClick={() => {
                    const used = new Set(lines.map((l) => l.grade));
                    const next = royalty.rows.find((r) => !used.has(r.grade))
                              ?? royalty.rows[0];
                    setLines((ls) => [...ls, { id: nextId, grade: next.grade,
                                               asp: String(next.asp), tonnes: "1000" }]);
                    setNextId((n) => n + 1);
                  }}>
                  <Plus className="w-3.5 h-3.5" /> Add a grade
                </Button>
              } />

            {/* The rates apply to every line, because they are the law rather
                than a property of a consignment. */}
            <div className="px-4 pt-3 flex flex-wrap items-end gap-3">
              {([["royalty", "Royalty %", "of the ASP"],
                 ["dmf", "DMF %", "of the royalty"],
                 ["nmet", "NMET %", "of the royalty"]] as const).map(([k, label, of]) => (
                <label key={k} className="block">
                  <span className={lbl}>{label}</span>
                  <input className={input + " w-[110px]"} inputMode="decimal"
                    value={rates[k]}
                    onChange={(e) => setRates((r) => ({ ...r, [k]: e.target.value }))} />
                  <span className="block text-[10.5px] text-txt-light mt-0.5">{of}</span>
                </label>
              ))}
              <span className="text-[11.5px] text-txt-light pb-5">
                Trying a different rate here changes nothing for anybody else.
                {mayRates ? " Use Change beside a rate above to make it official." : ""}
              </span>
            </div>

            <div className="overflow-x-auto mt-2">
              <table className="w-full min-w-[920px]">
                <thead><tr>
                  <Th>Grade</Th><Th right>ASP</Th><Th right>Tonnes</Th>
                  <Th right>Royalty</Th><Th right>DMF</Th><Th right>NMET</Th>
                  <Th right>Per tonne</Th>
                  <Th right className="bg-indigo-bg/40">Charge on the line</Th>
                  <Th>{""}</Th>
                </tr></thead>
                <tbody>
                  {worked.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border-light">
                      <td className="px-2 py-1.5">
                        <select className={input + " min-w-[210px]"} value={r.grade}
                          onChange={(e) => {
                            const g = e.target.value;
                            const src = royalty.rows.find((x) => x.grade === g);
                            setLines((ls) => ls.map((l) => l.id === r.id
                              ? { ...l, grade: g, asp: src ? String(src.asp) : l.asp }
                              : l));
                          }}>
                          {royalty.rows.map((x) => (
                            <option key={x.grade} value={x.grade}>{x.grade}</option>
                          ))}
                          <option value="">Something else</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={input + " w-[110px] text-right"} inputMode="decimal"
                          value={r.asp === 0 ? "" : String(lines.find((l) => l.id === r.id)?.asp ?? "")}
                          onChange={(e) => setLines((ls) => ls.map((l) =>
                            l.id === r.id ? { ...l, asp: e.target.value } : l))} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={input + " w-[96px] text-right"} inputMode="decimal"
                          value={lines.find((l) => l.id === r.id)?.tonnes ?? ""}
                          onChange={(e) => setLines((ls) => ls.map((l) =>
                            l.id === r.id ? { ...l, tonnes: e.target.value } : l))} />
                      </td>
                      <td className="px-3 py-1.5 text-right text-[12px] tabular-nums
                                     text-txt-secondary">{inr(r.royaltyPerT, 2)}</td>
                      <td className="px-3 py-1.5 text-right text-[12px] tabular-nums
                                     text-txt-secondary">{inr(r.dmfPerT, 2)}</td>
                      <td className="px-3 py-1.5 text-right text-[12px] tabular-nums
                                     text-txt-secondary">{inr(r.nmetPerT, 2)}</td>
                      <td className="px-3 py-1.5 text-right text-[12.5px] font-semibold
                                     tabular-nums text-navy">{inr(r.totalPerT, 2)}
                        <span className="block text-[10px] font-normal text-txt-light">
                          {r.effective.toFixed(2)}% of value</span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-[13px] font-bold
                                     tabular-nums text-navy bg-indigo-bg/40">
                        {inr(r.charge, 0)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <button type="button" title="Remove this line"
                          onClick={() => setLines((ls) => ls.filter((l) => l.id !== r.id))}
                          className="text-txt-light hover:text-rose p-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {worked.rows.length > 1 && (
                    <tr className="bg-indigo-bg/60">
                      <td className="px-3 py-2.5 text-[12.5px] font-bold text-navy">
                        The whole despatch
                        <span className="block text-[10.5px] font-normal text-txt-muted">
                          {worked.rows.length} grades
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[11px] text-txt-light">
                        mixed</td>
                      <td className="px-3 py-2.5 text-right text-[12.5px] font-bold
                                     tabular-nums">
                        {worked.total.tonnes.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2.5 text-right text-[12px] tabular-nums
                                     text-txt-secondary">{inr(worked.total.royalty, 0)}</td>
                      <td className="px-3 py-2.5 text-right text-[12px] tabular-nums
                                     text-txt-secondary">{inr(worked.total.dmf, 0)}</td>
                      <td className="px-3 py-2.5 text-right text-[12px] tabular-nums
                                     text-txt-secondary">{inr(worked.total.nmet, 0)}</td>
                      <td className="px-3 py-2.5 text-right text-[12.5px] font-bold
                                     tabular-nums text-navy">
                        {inr(worked.total.perTonne, 2)}
                        <span className="block text-[10px] font-normal text-txt-light">
                          weighted by tonnage</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[15px] font-bold
                                     tabular-nums text-indigo bg-indigo-bg/40">
                        {inr(worked.total.charge, 0)}</td>
                      <td></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-border-light flex flex-wrap
                            items-center gap-x-5 gap-y-1 text-[11.5px] text-txt-muted">
              <span>Despatch value{" "}
                <strong className="text-navy tabular-nums">
                  {inr(worked.total.value, 0)}</strong></span>
              <span>Charges{" "}
                <strong className="text-navy tabular-nums">
                  {worked.total.effective.toFixed(2)}%</strong> of it</span>
              <span>Net{" "}
                <strong className="text-navy tabular-nums">
                  {inr(worked.total.value - worked.total.charge, 0)}</strong></span>
              <span className="flex-1" />
              <button type="button"
                onClick={() => {
                  const pct = (c: string) =>
                    String(royalty.rates.find((r) => r.code === c)?.percent ?? "");
                  setRates({ royalty: pct("ROYALTY"), dmf: pct("DMF"), nmet: pct("NMET") });
                  setLines(royalty.rows.slice(0, 2).map((r, k) => ({
                    id: k + 1, grade: r.grade, asp: String(r.asp), tonnes: "1000" })));
                  setNextId(3);
                }}
                className="font-semibold text-indigo hover:underline">
                Start again from the published figures
              </button>
              <Button size="sm" variant="secondary"
                onClick={() => download(toCsv(
                  ["Grade", "ASP", "Tonnes", "Royalty/t", "DMF/t", "NMET/t",
                   "Total/t", "Charge on the line"],
                  worked.rows.map((r) => [r.grade, r.asp, r.tonnes,
                    r.royaltyPerT.toFixed(2), r.dmfPerT.toFixed(2),
                    r.nmetPerT.toFixed(2), r.totalPerT.toFixed(2),
                    r.charge.toFixed(2)])),
                  "despatch-royalty.csv")}>Export</Button>
            </div>
          </Card>
        </>
      ) : (
        <Card><p className="px-5 py-8 text-center text-[13px] text-txt-muted">
          {royalty?.note ?? "No sale price has been read yet, so nothing can be worked out."}
        </p></Card>
      ))}

      {/* Changing a rate is not a calculator: it is what the platform will
          work every royalty figure out on, for everybody, until somebody
          changes it again. The old rate is closed rather than overwritten, so
          past periods keep computing on the rate that actually applied. */}
      <Dialog open={Boolean(editRate)} tone="warning"
        title={`Change ${editRate?.name ?? "a rate"}`}
        confirmLabel="Record this rate" busy={busy}
        onConfirm={() => void saveRate()} onCancel={() => setEditRate(null)}>
        {editRate && (
          <div className="space-y-3">
            <p className="text-[12px] text-txt-muted leading-snug">
              This becomes the rate every royalty figure on the platform is
              worked out on, from the date you give, and stays until somebody
              changes it again. The rate it replaces is kept, so periods before
              that date still compute on the old one.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={lbl}>Percentage <span className="text-rose">*</span></span>
                <input className={input} inputMode="decimal" autoFocus
                  value={editRate.percent}
                  onChange={(e) => setEditRate({ ...editRate, percent: e.target.value })} />
              </label>
              <label className="block">
                <span className={lbl}>In force from <span className="text-rose">*</span></span>
                <DateField value={editRate.effective_from}
                  onChange={(v) => setEditRate({ ...editRate, effective_from: v })}
                  className="w-full bg-bg-base border border-border rounded-lg" />
              </label>
            </div>
            <label className="block">
              <span className={lbl}>Worked out on <span className="text-rose">*</span></span>
              <select className={input} value={editRate.basis}
                onChange={(e) => setEditRate({ ...editRate, basis: e.target.value })}>
                <option value="ASP">The ASP</option>
                <option value="ROYALTY">The royalty</option>
              </select>
              <span className="block text-[11px] text-txt-light mt-1">
                DMF and NMET are levied on the royalty, not on the ASP.
                Changing this to the ASP would multiply them by about
                seven, so change it only if a notification actually says so.
              </span>
            </label>
          </div>
        )}
      </Dialog>

      {/* ── IBM ASP ──────────────────────────────────────────────── */}
      {tab === "asp" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {latestAsp.map((r) => (
              <Card key={r.grade} tone={r.is_flagged ? "amber" : "teal"}>
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11.5px] font-semibold text-txt-secondary
                                     leading-snug">{r.grade}</span>
                    {r.is_flagged && <AlertTriangle className="w-4 h-4 text-amber shrink-0" />}
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-[26px] font-bold text-navy tabular-nums">
                      {inr(r.price)}</span>
                    <span className="text-[11.5px] text-txt-light">per {r.unit}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-txt-muted">{monthLabel(r.period)}</span>
                    <Move pct={r.change_pct} />
                  </div>
                  {r.flag_reason && (
                    <p className="mt-2 text-[11px] text-amber leading-snug">{r.flag_reason}</p>
                  )}
                  {r.document_url && (
                    <a href={r.document_url} target="_blank" rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px]
                                 font-semibold text-teal hover:underline">
                      <ExternalLink className="w-3 h-3" /> the PDF this came from</a>
                  )}
                </div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title="Every month published" icon={Gauge} tone="teal"
              subtitle="One row per grade per month, each linked to the document it was read from."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-[11.5px]
                                    text-txt-muted">
                    <CalendarRange className="w-3.5 h-3.5 text-txt-light" />
                    <select value={from} onChange={(e) => setFrom(e.target.value)}
                      className="bg-bg-base border border-border rounded-lg px-2 py-1
                                 text-[11.5px] font-semibold text-txt-secondary
                                 focus:outline-none focus:border-teal">
                      <option value="">From the start</option>
                      {months.map((m) => (
                        <option key={m} value={m}>{monthLabel(m)}</option>
                      ))}
                    </select>
                    to
                    <select value={to} onChange={(e) => setTo(e.target.value)}
                      className="bg-bg-base border border-border rounded-lg px-2 py-1
                                 text-[11.5px] font-semibold text-txt-secondary
                                 focus:outline-none focus:border-teal">
                      <option value="">the latest</option>
                      {months.map((m) => (
                        <option key={m} value={m}>{monthLabel(m)}</option>
                      ))}
                    </select>
                  </label>
                  <Button size="sm" variant="secondary"
                    onClick={() => download(toCsv(
                      ["Month", "Grade", "Price", "Unit", "Change %", "Published on",
                       "Source"],
                      series.map((r) => [monthLabel(r.period), r.grade, r.price,
                        r.unit, r.change_pct ?? "",
                        r.published_on ? dayLabel(r.published_on) : "",
                        r.document_url ?? ""])),
                      "chrome-ore-asp.csv")}>Export</Button>
                </div>
              } />

            {/* Grade as chips rather than a dropdown: there are five of them,
                they are the thing people switch between constantly, and a
                dropdown hides which one is active behind a click. */}
            <div className="px-4 py-2.5 border-b border-border-light flex flex-wrap
                            items-center gap-1.5">
              {[{ v: "", label: "All grades" },
                ...(prices?.grades ?? []).map((g) => ({
                  v: g,
                  // "40% To Below 52 % Cr2O3,Fines" is unreadable as a chip.
                  label: g.replace(/\s*Cr2O3\s*/i, " ").replace(",", " ").trim(),
                }))].map((o) => (
                <button key={o.v || "all"} type="button" onClick={() => setGrade(o.v)}
                  title={o.v || "Every grade"}
                  className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold
                              transition ${grade === o.v
                      ? "border-navy bg-navy text-white"
                      : "border-border text-txt-muted hover:border-navy/40"}`}>
                  {o.label}
                </button>
              ))}
              <span className="flex-1" />
              <span className="text-[11px] text-txt-light tabular-nums">
                {series.length} of {prices?.rows.length ?? 0} rows
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead><tr>
                  <SortTh label="Month" col="period" sort={sort} onSort={sortBy} />
                  <SortTh label="Grade" col="grade" sort={sort} onSort={sortBy} />
                  <SortTh label="Price (₹/t)" col="price" sort={sort}
                    onSort={sortBy} right />
                  <SortTh label="Against last month" col="change" sort={sort}
                    onSort={sortBy} />
                  <Th>Source</Th>
                  <Th>Published on</Th>
                </tr></thead>
                <tbody>
                  {series.map((r, k) => {
                    // A rule and a heavier month label at each change of month,
                    // so a long list reads as months rather than as rows.
                    const newMonth = sort.key === "period"
                      && (k === 0 || series[k - 1].period !== r.period);
                    return (
                      <tr key={`${r.grade}|${r.period}`}
                        className={`border-b border-border-light last:border-0
                                    hover:bg-bg-light/70 transition-colors
                                    ${r.is_flagged ? "bg-amber-bg/40" : ""}
                                    ${newMonth && k ? "border-t-2 border-t-border" : ""}`}>
                        <td className={`px-3 py-2 text-[12.5px] whitespace-nowrap
                                        ${newMonth ? "font-bold text-navy" : "text-txt-light"}`}>
                          {newMonth || sort.key !== "period" ? monthLabel(r.period) : ""}
                        </td>
                        <td className="px-3 py-2 text-[12.5px] text-txt-secondary">
                          {r.grade}
                          {r.revisions > 0 && (
                            <span title={`Restated ${r.revisions} time(s) since first read`}
                              className="ml-1.5 inline-flex items-center gap-0.5 text-[10px]
                                         font-semibold text-amber">
                              <History className="w-3 h-3" />{r.revisions}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-[12.5px] font-semibold
                                       tabular-nums text-navy">
                          {inr(r.price)}
                          <span className="text-txt-light font-normal"> /{r.unit}</span>
                        </td>
                        <td className="px-3 py-2 text-[12px]"><Move pct={r.change_pct} /></td>
                        <td className="px-3 py-2">
                          {r.document_url ? (
                            <a href={r.document_url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11.5px]
                                         text-teal hover:underline">
                              <ExternalLink className="w-3 h-3" /> PDF</a>
                          ) : <span className="text-txt-light text-[11.5px]">—</span>}
                        </td>
                        <td className="px-3 py-2 text-[11.5px] text-txt-light
                                       whitespace-nowrap">
                          {r.published_on ? dayLabel(r.published_on)
                                          : <span title="This issue did not print one">not stated</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {series.length === 0 && (
                    <tr><td colSpan={6}
                      className="px-4 py-8 text-center text-[12.5px] text-txt-muted">
                      Nothing in that range for that grade.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2.5 border-t border-border-light text-[11px]
                          text-txt-light leading-snug">
              IBM publishes about ten weeks behind: the June 2026 issue came out
              on 13 August. A missing recent month usually means it has not been
              published yet, not that the collector has stopped — the Sources
              tab says which.
            </p>
          </Card>

          <Revisions rows={revisions.filter((v) => v.kind === "ASP")}
            what="average sale price" />
        </>
      )}

      {/* ── OMC ──────────────────────────────────────────────────── */}
      {tab === "omc" && (auction && auction.rows.length > 0 ? (
        <Card tone="violet">
          <CardHeader title="What it fetched at auction" icon={Gavel} tone="violet"
            subtitle={auction.latest_from
              ? `${dayLabel(auction.latest_from)} – ${dayLabel(auction.latest_to!)}`
                + (auction.auction_date
                    ? ` · e-auction ${dayLabel(auction.auction_date)}` : "")
              : "Weighted average achieved at OMC's national e-auction."}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {auction.windows.length > 1 && (
                  <label className="inline-flex items-center gap-1.5 text-[11.5px]
                                    text-txt-muted">
                    <CalendarRange className="w-3.5 h-3.5 text-txt-light" />
                    <select value={omcWindow || auction.window || ""}
                      onChange={(e) => setOmcWindow(e.target.value)}
                      className="bg-bg-base border border-border rounded-lg px-2 py-1
                                 text-[11.5px] font-semibold text-txt-secondary
                                 focus:outline-none focus:border-violet">
                      {auction.windows.map((w) => (
                        <option key={w.valid_from} value={w.valid_from}>
                          {dayLabel(w.valid_from)} – {dayLabel(w.valid_to)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <ColumnFilter variant="control" label="Mine" allLabel="All mines"
                  value={mine} onChange={setMine}
                  options={optionsFrom(auction.rows, (r) => r.mine, (v) => v, null)} />
                <Button size="sm" variant="secondary"
                  onClick={() => download(toCsv(
                    ["Mine", "Grade", "Basis Cr2O3 %", "Price", "Unit", "From", "To"],
                    auctionRows.map((r) => [r.mine, r.grade, r.basis_pct ?? "", r.price,
                                            r.unit, r.valid_from, r.valid_to])),
                    "omc-auction-prices.csv")}>Export</Button>
              </div>} />
          {auction.lapsed && auction.is_latest && (
            <div className="mx-4 mt-3 rounded-xl ring-1 ring-amber-ring bg-amber-bg
                            px-4 py-3 flex items-start gap-3">
              <Clock className="w-4 h-4 mt-0.5 text-amber shrink-0" />
              <p className="text-[12.5px] text-amber leading-snug">
                <strong>This window ended {dayLabel(auction.latest_to!)}
                  {auction.days_lapsed === 1 ? ", yesterday" : `, ${auction.days_lapsed} days ago`}.</strong>{" "}
                These are the most recent prices OMC has published, and they are
                the right ones to quote until the next e-auction is posted —
                but they are not current. The collector checks twice a day and
                will pick the new window up on its own.{" "}
                <a href="https://omcltd.in/en/our-business/ore-prices" target="_blank"
                  rel="noreferrer" className="font-semibold underline underline-offset-2">
                  Check OMC directly
                </a>.
              </p>
            </div>
          )}
          {!auction.is_latest && (
            <div className="mx-4 mt-3 rounded-xl ring-1 ring-sky-ring bg-sky-bg
                            px-4 py-2.5 flex items-center gap-3">
              <History className="w-4 h-4 text-sky shrink-0" />
              <p className="text-[12.5px] text-sky leading-snug">
                An earlier window, kept for reference.{" "}
                <button type="button" onClick={() => setOmcWindow("")}
                  className="font-semibold underline underline-offset-2">
                  Back to the most recent
                </button>
              </p>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr>
                <Th>Mine or plant</Th><Th>Grade</Th><Th right>Basis Cr₂O₃</Th>
                <Th right>Weighted average</Th><Th>Window</Th>
              </tr></thead>
              <tbody>
                {auctionRows.map((r, i) => {
                  const first = i === 0 || auctionRows[i - 1].mine !== r.mine;
                  return (
                    <tr key={`${r.mine}|${r.grade}|${r.valid_from}`}
                      className={`border-b border-border-light last:border-0
                                  hover:bg-bg-light/60
                                  ${first && i ? "border-t-2 border-t-border" : ""}`}>
                      <td className="px-3 py-2 text-[12.5px] font-semibold text-navy">
                        {first ? r.mine : ""}</td>
                      <td className="px-3 py-2 text-[12.5px] text-txt-secondary">{r.grade}</td>
                      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums
                                     text-txt-muted">
                        {r.basis_pct !== null ? `${r.basis_pct}%` : "—"}</td>
                      <td className="px-3 py-2 text-right text-[13px] font-bold tabular-nums
                                     text-navy">{inr(r.price)}
                        <span className="text-txt-light font-normal text-[11px]">
                          {" "}/{r.unit}</span></td>
                      <td className="px-3 py-2 text-[11.5px] text-txt-light whitespace-nowrap">
                        {dayLabel(r.valid_from)} – {dayLabel(r.valid_to)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 border-t border-border-light text-[11.5px]
                        text-txt-light leading-snug">
            This is not the average sale price and royalty is not levied on it.
            It is what buyers actually paid at auction, for a stated window, per
            mine. South Kaliapani Chromite Mines is the same ore in the same
            valley as Kaliapani, which makes it the closest benchmark available —
            but the two figures answer different questions and should never be
            averaged together.{" "}
            <a href="https://omcltd.in/en/our-business/ore-prices" target="_blank"
              rel="noreferrer" className="text-violet hover:underline font-semibold">
              OMC’s own page</a>.
          </p>
        </Card>
      ) : (
        <Card><p className="px-5 py-8 text-center text-[13px] text-txt-muted">
          No auction prices have been read yet.</p></Card>
      ))}
      {tab === "omc" && (
        <Revisions rows={revisions.filter((v) => v.kind === "AUCTION")}
          what="auction" />
      )}

      {/* ── news ─────────────────────────────────────────────────── */}
      {tab === "news" && (
        <Card>
          <CardHeader title={`Mining and metals · ${shownNews.length}`}
            icon={Newspaper} tone="indigo"
            subtitle="Tagged from the headline and summary, so chrome reads apart from the rest of the sector."
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                {([["", "Everything"], ["chrome", "Chrome"],
                   ["mining", "Mining"], ["other", "Other"]] as const).map(([v, label]) => (
                  <button key={v || "all"} type="button" onClick={() => setTag(v)}
                    className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold
                                transition ${tag === v
                        ? "border-indigo bg-indigo-bg text-indigo"
                        : "border-border text-txt-muted hover:border-indigo/50"}`}>
                    {label}</button>
                ))}
                <button type="button" onClick={() => setShowOriginal((v) => !v)}
                  title="Several of these are published in Hindi by the Ministry of Mines"
                  className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold
                              inline-flex items-center gap-1 transition
                              ${showOriginal
                      ? "border-teal bg-teal-bg text-teal"
                      : "border-border text-txt-muted hover:border-teal/50"}`}>
                  <Languages className="w-3.5 h-3.5" />
                  {showOriginal ? "Hiding nothing" : "Show originals"}
                </button>
              </div>} />
          {shownNews.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-txt-muted">
              Nothing under that filter yet.</p>
          ) : (
            <ul className="divide-y divide-border-light">
              {shownNews.map((n) => (
                <li key={n.news_id} className="px-5 py-3">
                  {/* The English rendering leads, because a panel of
                      headlines nobody reads is a panel nobody opens. The
                      original stays underneath: it is what the ministry
                      actually published and what the link goes to. */}
                  <a href={n.url} target="_blank" rel="noreferrer"
                    className="text-[13px] font-semibold text-navy hover:text-gold
                               hover:underline leading-snug">
                    {n.title_en || n.title}
                  </a>
                  {n.title_en && (showOriginal ? (
                    <p className="mt-0.5 text-[12px] text-txt-muted leading-snug">
                      {n.title}
                    </p>
                  ) : null)}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]
                                  text-txt-light">
                    <span>{n.source}</span>
                    {n.title_en && (
                      <span title={`Translated by ${n.translated_by ?? "the on-premise model"}. The original is beneath.`}
                        className="inline-flex items-center gap-1 text-teal">
                        <Languages className="w-3 h-3" /> translated
                      </span>
                    )}
                    {n.published_at && (
                      <span title={exactly(n.published_at)}>· {ago(n.published_at)}</span>
                    )}
                    {n.tags.filter((t) => t !== "other").map((t) => (
                      <Chip key={t} tone={t === "chrome" ? "teal" : "slate"} dot={false}>
                        {t}</Chip>
                    ))}
                  </div>
                  {(n.summary_en || n.summary) && (
                    <p className="mt-1 text-[12px] text-txt-muted leading-snug
                                  line-clamp-2">{n.summary_en || n.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── sources ──────────────────────────────────────────────── */}
      {tab === "sources" && (
        <Card>
          <CardHeader title="Where this comes from" icon={FileWarning} tone="slate"
            subtitle="Each source, when it last answered, and what it said. A figure missing because nothing was published and one missing because the collector broke look identical otherwise." />
          <ul className="divide-y divide-border-light">
            {sources.map((s) => (
              <li key={s.source_id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-navy">{s.name}</span>
                  <Chip tone={s.kind === "PRICE" ? "teal" : "indigo"} dot={false}>
                    {s.kind === "PRICE" ? "prices" : "news"}</Chip>
                  {s.last_error ? <Chip tone="rose">not answering</Chip>
                    : s.last_ok_at ? <Chip tone="emerald">answered</Chip>
                                   : <Chip tone="slate">not tried yet</Chip>}
                  <span className="flex-1" />
                  <span className="text-[11.5px] text-txt-light tabular-nums">
                    {s.kind === "PRICE" ? `${s.prices} prices` : `${s.items} items`}
                    {" · every "}{s.every_hours}h</span>
                </div>
                {s.about && (
                  <p className="mt-1 text-[12px] text-txt-muted leading-snug">{s.about}</p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
                  <a href={s.url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-teal hover:underline">
                    <ExternalLink className="w-3 h-3" /> the source</a>
                  {s.last_ok_at && (
                    <span className="text-txt-light" title={exactly(s.last_ok_at)}>
                      last answered {ago(s.last_ok_at)}</span>
                  )}
                  {s.last_status && !s.last_error && (
                    <span className="text-txt-light">{s.last_status}</span>
                  )}
                </div>
                {s.last_error && (
                  <p className="mt-1.5 text-[11.5px] text-rose leading-snug">{s.last_error}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="px-5 py-3 border-t border-border-light text-[11.5px]
                        text-txt-light leading-snug">
            IBM publishes some months as a scan of a printout, with no text in
            the file at all. Those months are named above and left out of the
            series rather than read by OCR: these figures decide a royalty
            payment, and a misread digit that happened to look plausible would
            pass every check we could put on it. Open the PDF for those.
          </p>
        </Card>
      )}
    </div>
  );
}
