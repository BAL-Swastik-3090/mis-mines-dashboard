"use client";

/**
 * Data Health — every monitored feed, worst first.
 *
 * The screen the MIS team works from. The page banners warn whoever happens to
 * open a section; this one answers "what is behind across the whole platform,
 * and who do I chase". `mines_ev_equipment_tracking` stopped receiving rows on
 * 8 July 2026 and nobody noticed for three months, because the only place that
 * fact existed was inside a table nobody queries.
 *
 * Sorted by severity then by how far behind, so the top row is always the one
 * worth acting on. Sections that are deliberately not watched are listed at the
 * bottom WITH THE REASON — "not monitored" and "healthy" are different claims
 * and must not render as the same green tick.
 */
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, Database, HelpCircle, RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppPage } from "@/contexts/useAppPage";
import { useAuth } from "@/contexts/useAuth";
import { canOpen } from "@/contexts/pageAccess";

import api from "@/lib/api";
import { useDataHealth } from "@/hooks/useDataHealth";
import type { DataHealthFeed, DataHealthStatus } from "@/types";

const SEVERITY: Record<DataHealthStatus, number> = {
  ok: 0, unknown: 1, warn: 2, stale: 3,
};

const TONE: Record<DataHealthStatus, {
  chip: string; row: string; icon: typeof Clock; iconClass: string; word: string;
}> = {
  stale: {
    chip: "bg-red-100 text-red-800 border-red-200",
    row: "bg-red-50/40", icon: AlertTriangle, iconClass: "text-red-600",
    word: "Behind",
  },
  warn: {
    chip: "bg-amber-100 text-amber-800 border-amber-200",
    row: "bg-amber-50/40", icon: Clock, iconClass: "text-amber-600",
    word: "Late",
  },
  unknown: {
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    row: "", icon: HelpCircle, iconClass: "text-slate-500",
    word: "Unknown",
  },
  ok: {
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    row: "", icon: CheckCircle2, iconClass: "text-emerald-600",
    word: "Current",
  },
};

/** Sidebar labels, so this page names a section the way the menu does. */
const SECTION_LABEL: Record<string, string> = {
  "executive-summary": "Executive Summary",
  "mis": "MIS Dashboard",
  "oee": "OEE / LCM",
  "intelligence": "Intelligence",
  "amira": "AMIRA Accounting",
  "market": "Market Watch",
  "fuel-management": "Fuel Management",
  "ev-tracking": "Electric Vehicles Tracking",
  "workforce": "Workforce Planning",
  "usage": "Usage",
  "weather": "Weather Forecast",
  "minehub": "Equipment 360",
  "organisation": "Organisation",
  "capacity": "Capacity",
  "manpower": "Manpower",
  "operations": "Shift Control",
  "weighbridge": "Weighbridge",
  "gate": "Gate",
  "access-control": "Access Control",
};

/* Who to chase. A SAP feed that stops is an interface for IT; a form that
   stops is a person at the mine. Shown as its own column because it decides
   where the chase goes, not as a footnote in the note text. */
const ORIGIN_CHIP: Record<DataHealthFeed["origin"], string> = {
  entry: "bg-violet-50 text-violet-700 border-violet-200",
  sap: "bg-sky-50 text-sky-700 border-sky-200",
  telematics: "bg-teal-50 text-teal-700 border-teal-200",
  platform: "bg-slate-50 text-slate-600 border-slate-200",
};

const EXPECTS_WORD: Record<DataHealthFeed["expects"], string> = {
  yesterday: "day − 1",
  today: "today",
  ahead: "runs ahead",
};

const TH = "px-3 py-2.5 text-[10px] font-condensed font-bold tracking-widest "
  + "uppercase text-steel";
const TD = "px-3 py-2.5 align-top";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function Behind({ f }: { f: DataHealthFeed }) {
  if (f.days_behind === null) return <span className="text-txt-light/50">—</span>;
  // A plan reaching into the future carries a negative "behind"; saying
  // "-16 days behind" is a riddle, "16 days ahead" is the fact.
  if (f.days_behind < 0) {
    return <span className="text-emerald-700">{-f.days_behind} days ahead</span>;
  }
  if (f.days_behind === 0) return <span className="text-emerald-700">current</span>;
  return (
    <span className={f.days_behind > 1 ? "font-bold text-red-700" : "text-amber-700"}>
      {f.days_behind} day{f.days_behind > 1 ? "s" : ""}
    </span>
  );
}

export default function DataHealthSection() {
  const { data, isLoading, isError } = useDataHealth();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { previousPage, setPage } = useAppPage();
  const user = useAuth((s) => s.user);

  /* WHERE THE READER CAME FROM, if anywhere. This page is usually reached from
     the freshness button in the header, which can be clicked on any screen, so
     the way back is the screen they were reading -- not a fixed home. Offered
     only when there IS one and the user may still open it: null after a reload,
     and a permission can be withdrawn between one page and the next. */
  const back = previousPage && previousPage !== "data-health"
    && canOpen(user, previousPage) ? previousPage : null;

  async function refresh() {
    setRefreshing(true);
    try {
      // refresh=true skips the server's ten-minute cache. Somebody who has
      // just chased an entry wants to see it land, not wait out the window
      // and conclude the fix did not work.
      const res = await api.get("/data-health", { params: { refresh: true } });
      qc.setQueryData(["data-health"], res.data);
    } catch {
      qc.invalidateQueries({ queryKey: ["data-health"] });
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading) {
    return <p className="text-[13px] font-mono text-txt-light">Checking every feed…</p>;
  }
  if (isError || !data) {
    return (
      <p className="text-[13px] font-mono text-red-700">
        The freshness check could not be run. The dashboards themselves are
        unaffected — this page only reports on them.
      </p>
    );
  }

  const feeds = [...data.feeds].sort((a, b) =>
    SEVERITY[b.status] - SEVERITY[a.status] ||
    (b.days_behind ?? 0) - (a.days_behind ?? 0) ||
    a.label.localeCompare(b.label));

  const s = data.summary;
  const needing = s.stale + s.warn + s.unknown;

  return (
    <div className="space-y-4">
      {/* Headline */}
      <section className="bg-white border border-border rounded-lg shadow-sm">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light
                        flex items-center gap-2 flex-wrap">
          {back && (
            <button
              type="button"
              onClick={() => setPage(back)}
              className="inline-flex items-center gap-1 -ml-1 mr-1 rounded-md
                         px-1.5 py-1 text-[11px] font-semibold text-steel
                         hover:bg-bg-light hover:text-navy transition-colors"
            >
              <ArrowLeft size={13} />
              {SECTION_LABEL[back] ?? "Back"}
            </button>
          )}
          <Database size={14} className="text-steel" />
          <h3 className="font-condensed font-bold text-[13px] text-navy
                         tracking-widest uppercase">
            Data Health
          </h3>
          <span className="text-[10px] font-mono text-txt-light ml-auto">
            Checked {fmt(data.as_of)} · most feeds are expected to hold{" "}
            {fmt(data.expected_date)} — the Expected column says where that
            differs
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="ml-2 inline-flex items-center gap-1.5 rounded-md border
                       border-border px-2 py-1 text-[10px] font-condensed font-bold
                       tracking-widest uppercase text-steel hover:bg-bg-light
                       disabled:opacity-50"
          >
            <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Checking" : "Re-check"}
          </button>
        </div>

        <p className="px-4 py-3 text-[13px] font-mono text-txt-primary">
          {needing === 0 ? (
            <>All <span className="font-bold">{s.total}</span> feeds are current.</>
          ) : (
            <>
              <span className="font-bold text-red-700">{needing}</span> of{" "}
              <span className="font-bold">{s.total}</span> feeds need attention
              {s.stale > 0 && <> — <span className="font-bold">{s.stale}</span> more
                than a day behind</>}.
            </>
          )}
        </p>
      </section>

      {/* Every feed */}
      <section className="bg-white border border-border rounded-lg shadow-sm
                          overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono border-collapse">
            <thead>
              <tr className="bg-bg-section border-b border-border">
                <th className={`${TH} text-left min-w-[200px]`}>Feed</th>
                <th className={`${TH} text-left`}>Status</th>
                <th className={`${TH} text-left`}>Comes from</th>
                <th className={`${TH} text-right`}>Expected</th>
                <th className={`${TH} text-right`}>Last data</th>
                <th className={`${TH} text-right`}>Behind</th>
                <th className={`${TH} text-left min-w-[160px]`}>Sections</th>
                <th className={`${TH} text-left min-w-[180px]`}>Table</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {feeds.map((f) => {
                const t = TONE[f.status];
                const Icon = t.icon;
                return (
                  <tr key={f.key} className={t.row}>
                    <td className={TD}>
                      <div className="flex items-start gap-2">
                        <Icon size={13} className={`${t.iconClass} mt-0.5 shrink-0`} />
                        <div className="min-w-0">
                          <div className="font-bold text-txt-primary">{f.label}</div>
                          {f.status !== "ok" && (
                            <div className="text-[11px] text-txt-muted mt-0.5
                                            leading-relaxed">
                              {f.message}
                            </div>
                          )}
                          <div className="text-[10px] text-txt-light mt-0.5
                                          leading-relaxed max-w-[420px]">
                            {f.note}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={TD}>
                      <span className={`inline-block rounded-sm border px-1.5 py-0.5
                                        text-[10px] font-bold tracking-wide ${t.chip}`}>
                        {t.word}
                      </span>
                      {f.kind === "plan" && (
                        <div className="text-[9px] text-txt-light mt-1
                                        tracking-wide uppercase">
                          plan
                        </div>
                      )}
                    </td>
                    <td className={TD}>
                      <span className={`inline-block rounded-sm border px-1.5 py-0.5
                                        text-[10px] font-bold tracking-wide
                                        ${ORIGIN_CHIP[f.origin]}`}>
                        {f.origin_label}
                      </span>
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap
                                    text-[11px] text-txt-muted`}>
                      {EXPECTS_WORD[f.expects]}
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      {fmt(f.last_date)}
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      <Behind f={f} />
                    </td>
                    <td className={`${TD} text-[11px] text-txt-muted`}>
                      {f.sections.map((x) => SECTION_LABEL[x] ?? x).join(", ")}
                    </td>
                    <td className={`${TD} text-[11px] text-txt-light`}>
                      <span className="uppercase tracking-wide text-[9px]
                                       text-steel mr-1.5">
                        {f.source === "mysql" ? "IMOS/SAP" : "MineHub"}
                      </span>
                      {f.table}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Not watched, and why */}
      {Object.keys(data.unmonitored).length > 0 && (
        <section className="bg-white border border-border rounded-lg shadow-sm">
          <div className="px-4 pt-3 pb-2.5 border-b border-border-light">
            <h3 className="font-condensed font-bold text-[13px] text-navy
                           tracking-widest uppercase">
              Not monitored
            </h3>
            <p className="text-[11px] font-mono text-txt-light mt-1">
              These sections have no daily feed to be late. That is not the same
              as being up to date.
            </p>
          </div>
          <ul className="px-4 py-3 space-y-1.5">
            {Object.entries(data.unmonitored).map(([k, why]) => (
              <li key={k} className="text-[12px] font-mono text-txt-muted">
                <span className="font-bold text-txt-primary">
                  {SECTION_LABEL[k] ?? k}
                </span>
                {" — "}{why}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
