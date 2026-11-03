"use client";
/**
 * Weighbridge · Report from SAP.
 *
 * What the bridge weighed, as SAP recorded it: the totals, then the day by
 * grade, then every weighment beneath.
 *
 * SUMMARY ABOVE, EVIDENCE BELOW. Nobody opens a weighbridge report only to
 * read a total, and nobody reads 1,100 rows to find one. The grid answers
 * "what moved last week" and the register answers "where is that truck",
 * which are the two questions this screen gets.
 *
 * THE REGISTER FILTERS WHAT IS ALREADY HERE. A month is about 1,100 rows and
 * they arrive in one response, so typing a vehicle number searches memory
 * rather than making a round trip per keystroke. The counts above the filters
 * stay on the whole range on purpose — a filter narrows what you are looking
 * at, it does not change what the mine shifted.
 *
 * EVERYTHING IS TONNES. The application's own weighbridge screen beside this
 * one stores kilograms, so the two must never be read as the same unit; the
 * column headings say so rather than leaving it to be inferred.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Scale, Search, Truck, Clock, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import { formatIndian } from "@/lib/utils";

interface Trip {
  transaction_id: string;
  production_date: string | null;
  shift: string | null;
  vehicle_no: string | null;
  transporter: string | null;
  grade: string | null;
  material: string | null;
  sub_grade: string | null;
  source: string | null;
  destination: string | null;
  location: string | null;
  tare_t: number;
  gross_t: number;
  net_t: number;
  weighed_at: string | null;
  tare_at: string | null;
  weighed_by: string | null;
}

interface Report {
  from_date: string;
  to_date: string;
  grades: string[];
  totals: {
    trips: number; net_t: number; gross_t: number; tare_t: number;
    vehicles: number; days: number; synced_at: string | null;
  };
  by_grade: { grade: string; trips: number; net_t: number; vehicles: number }[];
  by_day: { date: string; trips: number; net_t: number;
            grades: Record<string, number> }[];
  trips: Trip[];
  truncated: boolean;
}

const TH = "px-3 py-2 text-[10px] font-condensed font-bold tracking-widest " +
           "uppercase text-txt-secondary whitespace-nowrap";
const TD = "px-3 py-2 text-[12px]";

/** Tonnes, to two places, with the Indian grouping used across the dashboard. */
function T({ v, strong = false }: { v: number | null | undefined; strong?: boolean }) {
  if (v == null) return <span className="text-txt-light">—</span>;
  return (
    <span className={`font-mono tabular-nums ${
      strong ? "font-bold text-navy" : "text-txt-secondary"}`}>
      {formatIndian(Math.round(v * 100) / 100)}
    </span>
  );
}

const GRADE_TONE: Record<string, string> = {
  ORE:        "bg-emerald-50 text-[#2e7d32]",
  COB:        "bg-violet-50 text-[#5e35b1]",
  OVERBURDEN: "bg-amber-50 text-[#8d6e00]",
  SILT:       "bg-teal-50 text-[#00695c]",
  REHANDLING: "bg-slate-100 text-txt-secondary",
};

function Grade({ g }: { g: string | null }) {
  if (!g) return <span className="text-txt-light">—</span>;
  return (
    <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold
                      tracking-wide ${GRADE_TONE[g] ?? "bg-slate-100 text-txt-secondary"}`}>
      {g}
    </span>
  );
}

function Tile({ label, value, sub }: {
  label: string; value: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-border px-4 py-3">
      <div className="text-[10px] font-condensed font-bold tracking-widest
                      uppercase text-txt-light">{label}</div>
      <div className="font-mono tabular-nums text-[20px] font-extrabold text-navy
                      leading-tight mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-txt-light mt-0.5">{sub}</div>}
    </div>
  );
}

export default function WeighbridgeSapSection() {
  const { apiFrom, apiTo } = useDateFilter();
  const [q, setQ] = useState("");
  const [grade, setGrade] = useState("");
  const [shift, setShift] = useState("");

  const { data, isLoading, isError, error } = useQuery<Report>({
    queryKey: ["weighbridge-sap", apiFrom, apiTo],
    queryFn: async () => (await api.get("/weighbridge-sap", {
      params: { from_date: apiFrom, to_date: apiTo },
    })).data,
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(apiFrom && apiTo),
  });

  const rows = useMemo(() => {
    const all = data?.trips ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((t) =>
      (!grade || t.grade === grade) &&
      (!shift || t.shift === shift) &&
      (!needle || [t.vehicle_no, t.transporter, t.transaction_id,
                   t.source, t.destination, t.material]
        .some((f) => (f ?? "").toLowerCase().includes(needle))));
  }, [data, q, grade, shift]);

  const shown = useMemo(() => ({
    trips: rows.length,
    net: rows.reduce((s, t) => s + (t.net_t ?? 0), 0),
  }), [rows]);

  const filtering = Boolean(q.trim() || grade || shift);

  return (
    <section className="space-y-4">
      <div className="section-title">
        <Scale size={13} />
        Weighbridge — Report from SAP
      </div>

      {isError && (
        <div className="bg-white rounded-lg border border-[#ef9a9a] px-4 py-3
                        text-[12px] text-[#c62828]">
          <AlertTriangle size={14} className="inline mr-1.5 -mt-0.5" />
          The SAP weighbridge feed could not be read
          {error instanceof Error ? ` — ${error.message}` : ""}.
        </div>
      )}

      {isLoading && (
        <div className="bg-white rounded-lg border border-border px-4 py-10
                        text-center text-[12px] text-txt-muted animate-pulse">
          Reading the weighbridge feed…
        </div>
      )}

      {data && (
        <>
          {/* ── the totals ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
            <Tile label="Weighings" value={formatIndian(data.totals.trips)}
                  sub={`${data.totals.days} day(s) with traffic`} />
            <Tile label="Net tonnes"
                  value={formatIndian(Math.round(data.totals.net_t * 100) / 100)}
                  sub="gross less tare" />
            <Tile label="Gross tonnes"
                  value={formatIndian(Math.round(data.totals.gross_t * 100) / 100)} />
            <Tile label="Vehicles" value={String(data.totals.vehicles)}
                  sub="distinct on the bridge" />
            <Tile label="Feed last ran"
                  value={data.totals.synced_at
                    ? data.totals.synced_at.slice(0, 10) : "—"}
                  sub={data.totals.synced_at
                    ? data.totals.synced_at.slice(11, 16) : "never synced"} />
          </div>

          {data.totals.trips === 0 && (
            <div className="bg-white rounded-lg border border-border px-4 py-8
                            text-center">
              <Truck size={24} className="mx-auto text-txt-light mb-2" />
              <div className="text-[13px] font-bold text-navy">
                No weighings in this range
              </div>
              <p className="text-[11px] text-txt-light mt-1">
                The feed holds nothing between {data.from_date} and {data.to_date}.
                {data.totals.synced_at
                  ? ` It last ran on ${data.totals.synced_at.slice(0, 10)}.`
                  : " It has never run."}
              </p>
            </div>
          )}

          {data.totals.trips > 0 && (
            <>
              {/* ── by grade ───────────────────────────────────────────── */}
              <div className="bg-white rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border-light
                                font-condensed font-bold text-[12px] text-navy
                                tracking-widest uppercase">
                  By material
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-bg-section">
                      <tr>
                        <th className={`${TH} text-left`}>Grade</th>
                        <th className={`${TH} text-right`}>Weighings</th>
                        <th className={`${TH} text-right`}>Net (tonnes)</th>
                        <th className={`${TH} text-right`}>Vehicles</th>
                        <th className={`${TH} text-right`}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_grade.map((g) => (
                        <tr key={g.grade} className="border-t border-border-light">
                          <td className={TD}><Grade g={g.grade} /></td>
                          <td className={`${TD} text-right font-mono tabular-nums
                                          text-txt-secondary`}>{g.trips}</td>
                          <td className={`${TD} text-right`}><T v={g.net_t} strong /></td>
                          <td className={`${TD} text-right font-mono tabular-nums
                                          text-txt-secondary`}>{g.vehicles}</td>
                          <td className={`${TD} text-right font-mono tabular-nums
                                          text-txt-light`}>
                            {data.totals.net_t
                              ? `${(g.net_t / data.totals.net_t * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-bg-section">
                      <tr className="border-t-2 border-border">
                        <td className={`${TD} font-condensed font-bold
                                        text-[11px] uppercase tracking-widest
                                        text-navy`}>Total</td>
                        <td className={`${TD} text-right font-mono tabular-nums
                                        font-bold text-navy`}>{data.totals.trips}</td>
                        <td className={`${TD} text-right`}><T v={data.totals.net_t} strong /></td>
                        <td className={`${TD} text-right font-mono tabular-nums
                                        font-bold text-navy`}>{data.totals.vehicles}</td>
                        <td className={`${TD} text-right text-txt-light`}>100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* ── day by grade ───────────────────────────────────────── */}
              <div className="bg-white rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border-light
                                font-condensed font-bold text-[12px] text-navy
                                tracking-widest uppercase">
                  Day by day
                  <span className="ml-2 font-mono font-normal text-[10px]
                                   normal-case tracking-normal text-txt-light">
                    net tonnes
                  </span>
                </div>
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-bg-section sticky top-0">
                      <tr>
                        <th className={`${TH} text-left`}>Date</th>
                        <th className={`${TH} text-right`}>Weighings</th>
                        {data.grades.map((g) => (
                          <th key={g} className={`${TH} text-right`}>{g}</th>
                        ))}
                        <th className={`${TH} text-right border-l border-border`}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_day.map((d) => (
                        <tr key={d.date} className="border-t border-border-light">
                          <td className={`${TD} font-mono text-txt-secondary
                                          whitespace-nowrap`}>{d.date}</td>
                          <td className={`${TD} text-right font-mono tabular-nums
                                          text-txt-light`}>{d.trips}</td>
                          {data.grades.map((g) => (
                            <td key={g} className={`${TD} text-right`}>
                              {d.grades[g] ? <T v={d.grades[g]} />
                                           : <span className="text-txt-light">—</span>}
                            </td>
                          ))}
                          <td className={`${TD} text-right border-l border-border-light`}>
                            <T v={d.net_t} strong />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── the register ───────────────────────────────────────── */}
              <div className="bg-white rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border-light
                                flex items-center gap-2 flex-wrap">
                  <span className="font-condensed font-bold text-[12px] text-navy
                                   tracking-widest uppercase">
                    Every weighing
                  </span>
                  <span className="text-[10px] text-txt-light">
                    {filtering
                      ? `${formatIndian(shown.trips)} of ${formatIndian(data.totals.trips)} · ${formatIndian(Math.round(shown.net * 100) / 100)} t shown`
                      : `${formatIndian(data.totals.trips)} rows`}
                  </span>

                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search size={12} className="absolute left-2 top-1/2
                                                   -translate-y-1/2 text-txt-light" />
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Vehicle, transporter, transaction ID, face…"
                        className="pl-7 pr-2 py-1.5 w-56 border border-border rounded
                                   text-[11.5px] text-navy placeholder:text-txt-light"
                      />
                    </div>
                    <select value={grade} onChange={(e) => setGrade(e.target.value)}
                      className="border border-border rounded px-2 py-1.5
                                 text-[11.5px] font-semibold text-navy bg-white">
                      <option value="">All materials</option>
                      {data.grades.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <select value={shift} onChange={(e) => setShift(e.target.value)}
                      className="border border-border rounded px-2 py-1.5
                                 text-[11.5px] font-semibold text-navy bg-white">
                      <option value="">All shifts</option>
                      {["A", "B", "C"].map((s) => (
                        <option key={s} value={s}>Shift {s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {data.truncated && (
                  <div className="px-4 py-2 bg-[#fff8e1] border-b border-[#ffe082]
                                  text-[11px] text-[#8d6e00]">
                    This range has more weighings than the register draws. The
                    totals above cover all of them; the rows below are the most
                    recent. Narrow the dates to see the rest.
                  </div>
                )}

                <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-bg-section sticky top-0">
                      <tr>
                        <th className={`${TH} text-left`}>Date</th>
                        <th className={`${TH} text-left`}>Shift</th>
                        <th className={`${TH} text-left`}>Vehicle</th>
                        <th className={`${TH} text-left`}>Transporter</th>
                        <th className={`${TH} text-left`}>Material</th>
                        <th className={`${TH} text-left`}>From → To</th>
                        <th className={`${TH} text-right`}>Tare (t)</th>
                        <th className={`${TH} text-right`}>Gross (t)</th>
                        <th className={`${TH} text-right`}>Net (t)</th>
                        <th className={`${TH} text-left`}>Weighed at</th>
                        {/* SAP's own name for it. "Ticket" is what the
                            weighbridge operator calls the slip; the number in
                            this column is the transaction SAP recorded, and
                            the two are only the same thing when SAP kept the
                            weighment — which the gaps in this sequence show it
                            does not always do. */}
                        <th className={`${TH} text-left`}>Transaction ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.transaction_id}
                            className="border-t border-border-light hover:bg-bg-soft">
                          <td className={`${TD} font-mono text-txt-secondary
                                          whitespace-nowrap`}>{t.production_date}</td>
                          <td className={`${TD} text-txt-secondary`}>{t.shift ?? "—"}</td>
                          <td className={`${TD} font-semibold text-navy
                                          whitespace-nowrap`}>{t.vehicle_no ?? "—"}</td>
                          <td className={`${TD} text-txt-secondary`}>
                            {/* Blank where the mine's own fleet hauled it, which
                                is information rather than a gap. */}
                            {t.transporter ?? <span className="text-txt-light">own fleet</span>}
                          </td>
                          <td className={`${TD} whitespace-nowrap`}>
                            <Grade g={t.grade} />
                            {t.sub_grade && (
                              <span className="ml-1.5 text-[10px] text-txt-light">
                                {t.sub_grade}
                              </span>
                            )}
                          </td>
                          <td className={`${TD} text-txt-secondary whitespace-nowrap`}>
                            {t.source ?? "—"}
                            <span className="text-txt-light mx-1">→</span>
                            {t.destination ?? "—"}
                          </td>
                          <td className={`${TD} text-right`}><T v={t.tare_t} /></td>
                          <td className={`${TD} text-right`}><T v={t.gross_t} /></td>
                          <td className={`${TD} text-right`}><T v={t.net_t} strong /></td>
                          <td className={`${TD} font-mono text-[11px]
                                          text-txt-light whitespace-nowrap`}>
                            {t.weighed_at ?? "—"}
                          </td>
                          <td className={`${TD} font-mono text-[11px] text-txt-light`}>
                            {t.transaction_id}
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={11}
                              className="px-4 py-8 text-center text-[12px] text-txt-light">
                            Nothing matches those filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* What a reader has to know before quoting anything here. */}
              <div className="rounded-lg border border-[#ffe082] bg-[#fff8e1]
                              px-4 py-3 text-[11px] text-[#8d6e00] leading-relaxed">
                <Clock size={13} className="inline mr-1.5 -mt-0.5" />
                Weights are <span className="font-semibold">tonnes</span>, from
                SAP&apos;s record of Weigh Bridge 3. The application&apos;s own
                record of the same bridge is under{" "}
                <span className="font-semibold">Report from Application</span> and
                stores kilograms — the two are not interchangeable. A tare may
                have been taken days before its load: the time shown is when the
                loaded vehicle crossed.
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
