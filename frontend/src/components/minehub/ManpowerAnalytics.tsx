"use client";
/**
 * The shape of the workforce.
 *
 * Everything here is derived on read from one endpoint. No figure is stored,
 * because a stored headcount is wrong by the time somebody reads it — and
 * reconciling that kind of number between spreadsheets is the work this
 * platform exists to stop.
 *
 * The screen leads with what is wrong rather than with how many people there
 * are. A headcount is a fact; an unassessed tipper driver is a decision
 * somebody has to make, and a dashboard that buries the second under the first
 * gets looked at once.
 *
 * No chart library. These are counts across a handful of categories, and a bar
 * whose width is a percentage says it as well as a canvas would, reads at any
 * size, prints, and costs the page nothing.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, BarChart3, Building2, CalendarClock, Download, HardHat,
  Loader2, RefreshCw, ShieldCheck, TrendingUp, Users,
} from "lucide-react";
import api from "@/lib/api";
import {
  Alert, Button, Card, CardHeader, Chip, StatBar, TONE_DOT, type Tone,
} from "./ui";
import { toCsv, download } from "./spreadsheet";

interface Slice { label: string; people: number; operators?: number }
interface TradeRow extends Slice {
  trade_group: string; operates_equipment: boolean; machine: string | null;
  assessed: number;
}
interface CoverageRow {
  label: string; trained_for: number; machines: number; assessed: number;
}
interface Analytics {
  headline: Record<string, number | null>;
  by_group: Slice[]; by_trade: TradeRow[]; by_employer: Slice[];
  by_department: Slice[]; by_skill: Slice[]; by_age: Slice[]; by_service: Slice[];
  coverage: CoverageRow[]; documents: Slice[];
}

const SKILL_LABEL: Record<string, string> = {
  SKILLED: "Skilled", SEMI_SKILLED: "Semi-skilled", UNSKILLED: "Unskilled",
  "Not classified": "Not classified",
};

const GROUP_TONE: Record<string, Tone> = {
  "Machine operation": "emerald", "Workshop": "amber", "Mining operations": "sky",
  "Supervision": "violet", "Electrical": "indigo", "Administration": "teal",
  "Site services": "slate", "Not classified": "rose",
};

/** A count as a proportion of the largest in its group. Bars are compared
 *  against each other, not against the total — scaling to the total makes
 *  every bar but the biggest unreadable. */
function Bars({ rows, tone = "sky", unit = "people", href }: {
  rows: Slice[]; tone?: Tone; unit?: string;
  href?: (label: string) => Tone | undefined;
}) {
  const top = Math.max(1, ...rows.map((r) => r.people));
  const total = rows.reduce((n, r) => n + r.people, 0);
  return (
    <div className="p-4 space-y-2.5">
      {rows.length === 0 && (
        <p className="text-[12.5px] text-txt-light py-4 text-center">Nothing to show yet.</p>
      )}
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(90px,150px)_1fr_auto] items-center gap-3">
          <span className="text-[12px] text-txt-secondary truncate" title={r.label}>
            {SKILL_LABEL[r.label] ?? r.label}
          </span>
          <span className="h-[18px] rounded bg-bg-light overflow-hidden">
            <span className={`block h-full rounded ${TONE_DOT[href?.(r.label) ?? tone]}`}
              style={{ width: `${Math.max(2, (100 * r.people) / top)}%` }} />
          </span>
          <span className="text-[12px] tabular-nums text-navy font-semibold w-[68px] text-right">
            {r.people}
            <span className="text-txt-light font-normal ml-1">
              {total ? `${Math.round((100 * r.people) / total)}%` : ""}
            </span>
          </span>
        </div>
      ))}
      {total > 0 && (
        <p className="text-[11px] text-txt-light pt-1">{total} {unit} in total</p>
      )}
    </div>
  );
}

export default function ManpowerAnalytics() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData((await api.get("/operators/analytics")).data);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not read the workforce figures.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return null;

  const h = data.headline;
  const n = (k: string) => Number(h[k] ?? 0);

  // Machine classes the mine runs and nobody is trained for. Named here rather
  // than left for the reader to spot in a table of twenty rows.
  const uncovered = data.coverage.filter((c) => c.machines > 0 && c.trained_for === 0);
  const thin = data.coverage.filter(
    (c) => c.machines > 0 && c.trained_for > 0 && c.trained_for < c.machines);

  const exportTrades = () => {
    download(toCsv(
      ["Trade", "Group", "Operates a machine", "Machine", "People", "Assessed"],
      data.by_trade.map((t) => [t.label, t.trade_group,
        t.operates_equipment ? "Yes" : "No", t.machine ?? "",
        t.people, t.assessed])),
      `manpower-by-trade-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-4">
      <StatBar items={[
        { label: "On strength", value: n("people"), tone: "sky", icon: Users,
          hint: `${n("employers")} employer${n("employers") === 1 ? "" : "s"}, ${n("contract")} on contract` },
        { label: "Machine operators", value: n("operators"), tone: "emerald", icon: HardHat,
          hint: `${n("people") - n("operators")} in trades and support` },
        { label: "Never assessed", value: n("unassessed_operators"),
          tone: n("unassessed_operators") ? "rose" : "emerald", icon: ShieldCheck,
          hint: "operators with no clearance on any machine" },
        { label: "Awaiting approval", value: n("draft") + n("awaiting"),
          tone: n("draft") + n("awaiting") ? "amber" : "emerald", icon: RefreshCw,
          hint: `${n("draft")} draft, ${n("awaiting")} submitted` },
        { label: "Average age", value: h.avg_age ?? "—", tone: "violet", icon: CalendarClock,
          hint: "years" },
        { label: "Average service", value: h.avg_years ?? "—", tone: "teal", icon: TrendingUp,
          hint: "years at the mine" },
      ]} />

      {/* What is wrong, before how many there are. */}
      {(uncovered.length > 0 || n("unassessed_operators") > 0) && (
        <Card tone="rose">
          <CardHeader title="What needs attention" icon={AlertTriangle} tone="rose"
            subtitle="Read off the register and the machine list together. Nothing here is stored; it is what the two say about each other today." />
          <div className="p-4 space-y-2.5">
            {n("unassessed_operators") > 0 && (
              <p className="text-[12.5px] text-txt-secondary">
                <strong className="text-rose">{n("unassessed_operators")}</strong> people
                whose job is to operate a machine have never been assessed on one.
                Until they are, the register cannot say anybody is cleared to work.
              </p>
            )}
            {uncovered.map((c) => (
              <p key={c.label} className="text-[12.5px] text-txt-secondary">
                <strong className="text-rose">{c.machines}</strong>{" "}
                {c.label.toLowerCase()}{c.machines === 1 ? "" : "s"} in service and{" "}
                <strong>nobody</strong> on the register is employed to run one.
              </p>
            ))}
            {thin.slice(0, 4).map((c) => (
              <p key={c.label} className="text-[12.5px] text-txt-muted">
                {c.trained_for} {c.label.toLowerCase()} operator{c.trained_for === 1 ? "" : "s"}{" "}
                for {c.machines} machines — one per machine leaves no cover for
                leave, sickness or a second shift.
              </p>
            ))}
          </div>
        </Card>
      )}

      {/* Coverage: the register against the fleet. */}
      <Card tone="violet">
        <CardHeader title="Who can run what" icon={ShieldCheck} tone="violet"
          subtitle="Employed to run it, assessed on it, and how many of those machines the mine actually has in service." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="bg-bg-light">
                {["Machine class", "In service", "Employed to run", "Assessed", ""].map((x, i) => (
                  <th key={x || i} className={`font-condensed text-[10.5px] font-bold uppercase
                    tracking-[.12em] text-txt-light px-4 py-2.5 border-b border-border
                    ${i === 0 ? "text-left" : i === 4 ? "text-left w-[34%]" : "text-right"}`}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.coverage.map((c) => {
                const ratio = c.machines ? c.trained_for / c.machines : 0;
                const tone: Tone = c.machines === 0 ? "slate"
                  : c.trained_for === 0 ? "rose" : ratio < 1 ? "amber" : "emerald";
                return (
                  <tr key={c.label} className="border-b border-border-light last:border-0">
                    <td className="px-4 py-2.5 text-[12.5px] font-semibold text-navy">{c.label}</td>
                    <td className="px-4 py-2.5 text-[12.5px] text-right tabular-nums text-txt-secondary">
                      {c.machines || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] text-right tabular-nums text-txt-secondary">
                      {c.trained_for || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {c.assessed > 0
                        ? <span className="text-[12.5px] tabular-nums text-emerald font-semibold">{c.assessed}</span>
                        : <Chip tone="rose" dot={false}>none</Chip>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block h-[14px] rounded bg-bg-light overflow-hidden">
                        <span className={`block h-full rounded ${TONE_DOT[tone]}`}
                          style={{ width: `${Math.min(100, Math.max(3, ratio * 100))}%` }} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card tone="emerald">
          <CardHeader title="By trade group" icon={Users} tone="emerald"
            subtitle="What the mine employs people to do." />
          <Bars rows={data.by_group} href={(l) => GROUP_TONE[l]} />
        </Card>

        <Card tone="teal">
          <CardHeader title="By department" icon={Building2} tone="teal"
            subtitle="Where they are posted." />
          <Bars rows={data.by_department} tone="teal" />
        </Card>

        <Card tone="violet">
          <CardHeader title="By age" icon={CalendarClock} tone="violet"
            subtitle="How much of the workforce is within a few years of leaving it." />
          <Bars rows={data.by_age} tone="violet" />
        </Card>

        <Card tone="sky">
          <CardHeader title="By length of service" icon={TrendingUp} tone="sky"
            subtitle="Experience already on site — and how much of it arrived recently." />
          <Bars rows={data.by_service} tone="sky" />
        </Card>

        <Card tone="amber">
          <CardHeader title="By skill class" icon={BarChart3} tone="amber"
            subtitle="How labour contracts and the state's minimum wage notification classify the work." />
          <Bars rows={data.by_skill} tone="amber" />
        </Card>

        <Card tone="slate">
          <CardHeader title="By employer" icon={Building2} tone="slate"
            subtitle="Own and contract manpower on the same register." />
          <Bars rows={data.by_employer} tone="slate" />
        </Card>
      </div>

      <Card tone="gold">
        <CardHeader title={`Every trade · ${data.by_trade.length}`} icon={BarChart3} tone="gold"
          subtitle="Headcount against assessment, trade by trade. A machine trade with people and no assessments is a gap; a support trade with none is simply not assessed here."
          actions={
            <Button size="sm" variant="secondary" onClick={exportTrades}>
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
          } />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-bg-light">
                {["Trade", "Group", "Machine", "People", "Assessed"].map((x, i) => (
                  <th key={x} className={`font-condensed text-[10.5px] font-bold uppercase
                    tracking-[.12em] text-txt-light px-4 py-2.5 border-b border-border
                    ${i > 2 ? "text-right" : "text-left"}`}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.by_trade.map((t) => (
                <tr key={t.label} className="border-b border-border-light last:border-0
                                             hover:bg-bg-light transition-colors">
                  <td className="px-4 py-2.5 text-[12.5px] font-semibold text-navy">{t.label}</td>
                  <td className="px-4 py-2.5">
                    <Chip tone={GROUP_TONE[t.trade_group] ?? "slate"} dot={false}>
                      {t.trade_group}
                    </Chip>
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px] text-txt-muted">{t.machine ?? "—"}</td>
                  <td className="px-4 py-2.5 text-[12.5px] text-right tabular-nums
                                 text-navy font-semibold">{t.people}</td>
                  <td className="px-4 py-2.5 text-right">
                    {t.assessed > 0 ? (
                      <span className="text-[12.5px] tabular-nums text-emerald font-semibold">
                        {t.assessed}
                      </span>
                    ) : t.operates_equipment ? (
                      <Chip tone="rose" dot={false}>none</Chip>
                    ) : (
                      <span className="text-[12px] text-txt-light">n/a</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
