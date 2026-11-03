"use client";
/**
 * Cr₂O₃ and Cr/Fe, day by day, as the mine assayed it against as the plant did.
 *
 * FOUR CHARTS, NOT TWO WITH A SWITCH. The two plants receive different ore on
 * the same day — Balasore took 2,554 MT of MG on 25 October against Sukinda's
 * 522 MT of LG — so a combined line would average two unrelated consignments
 * into one meaningless point. And a reader comparing Balasore's drift with
 * Sukinda's has to see both at once, which a toggle prevents.
 *
 * THE SAME SOURCE AS THE E2E TABLE, deliberately: one request to /quality-e2e,
 * already in the cache when that table is on screen. A second endpoint
 * computing the same averages a second way is how two screens come to disagree
 * about one assay.
 *
 * A DAY CAN HOLD SEVERAL CONSIGNMENTS — a stack is despatched over days and
 * more than one stack moves on a day — so each point is weighted by tonnage,
 * and each side by ITS OWN tonnage: the mine's assay by what the mine weighed,
 * the plant's by what the plant received. Using one quantity for both would
 * quietly attribute the plant's weighing to the mine's reading.
 *
 * A GAP IS A GAP. Where a side has no assay the point is null and the line
 * breaks rather than joining across it. `connectNulls` would draw a straight
 * run between two real readings and invite somebody to read a trend off a
 * segment that is pure interpolation.
 */
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import api from "@/lib/api";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface Side {
  trips: number; qty: number;
  moisture: number | null; cr2o3: number | null;
  feo: number | null; cr_fe: number | null;
}
interface Row {
  date: string; batch: string; grade: string | null;
  destination: string; mines: Side; plant: Side;
}
interface Dest { key: string; label: string; plant: string }
interface Resp { rows: Row[]; destinations: Dest[] }

/** Which assay, and how it is written. */
const PARAMS = [
  { key: "cr2o3" as const, title: "%Cr₂O₃", unit: "%", dp: 2 },
  { key: "cr_fe" as const, title: "Cr:Fe",  unit: "",  dp: 2 },
];

const MINES = "#1a2744";
const PLANT = "#15a0a0";

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")} ${
    d.toLocaleString("en-GB", { month: "short" })}`;
}

/** Tonnage-weighted mean, or null when nothing on this side was assayed. */
function weighted(rows: Row[], side: "mines" | "plant",
                  key: "cr2o3" | "cr_fe"): number | null {
  let num = 0, den = 0;
  for (const r of rows) {
    const v = r[side][key];
    const q = r[side].qty;
    if (v == null || !q) continue;
    num += v * q;
    den += q;
  }
  return den ? num / den : null;
}

function Chart({ rows, destLabel, param }: {
  rows: Row[];
  destLabel: string;
  param: (typeof PARAMS)[number];
}) {
  // One point per despatch date, in order.
  const days = Array.from(new Set(rows.map((r) => r.date))).sort();
  const byDay = days.map((d) => rows.filter((r) => r.date === d));
  const mines = byDay.map((g) => weighted(g, "mines", param.key));
  const plant = byDay.map((g) => weighted(g, "plant", param.key));

  const present = [...mines, ...plant].filter((v): v is number => v != null);
  const lo = present.length ? Math.min(...present) : 0;
  const hi = present.length ? Math.max(...present) : 1;
  const pad = Math.max((hi - lo) * 0.15, param.key === "cr_fe" ? 0.05 : 0.5);

  const option = {
    backgroundColor: "transparent",
    grid: { top: 34, right: 14, bottom: 46, left: 8, containLabel: true },
    legend: {
      top: 0, left: 0, itemWidth: 12, itemHeight: 12, itemGap: 18,
      textStyle: { fontSize: 11, color: "#4a5a76", fontFamily: "IBM Plex Sans" },
      data: ["Mines", "Plant"],
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f1c35", borderColor: "#2c4a7c", borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 12, fontFamily: "IBM Plex Sans" },
      formatter(ps: Array<{ axisValue: string; seriesName: string;
                            value: number | null; color: string }>) {
        const head = `<div style="font-weight:700;margin-bottom:4px;color:#c8d8f0">`
          + `${ps[0]?.axisValue ?? ""} — ${destLabel}</div>`;
        const lines = ps.map((p) => {
          const v = p.value == null ? "not assayed"
            : p.value.toFixed(param.dp) + param.unit;
          return `<div style="font-family:'IBM Plex Mono'">`
            + `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;`
            + `background:${p.color};margin-right:6px"></span>`
            + `${p.seriesName}: ${v}</div>`;
        }).join("");
        // The gap is the number people actually come here for.
        const m = ps.find((p) => p.seriesName === "Mines")?.value;
        const q = ps.find((p) => p.seriesName === "Plant")?.value;
        const diff = (m != null && q != null)
          ? `<div style="margin-top:4px;color:${q - m >= 0 ? "#43d4bb" : "#ff8a80"};`
            + `font-family:'IBM Plex Mono'">Plant − Mines: `
            + `${q - m >= 0 ? "+" : ""}${(q - m).toFixed(param.dp)}</div>`
          : "";
        return head + lines + diff;
      },
    },
    xAxis: {
      type: "category",
      data: days.map(dayLabel),
      axisLabel: { fontSize: 10, color: "#8899bb", rotate: 45,
                   fontFamily: "IBM Plex Mono" },
      axisLine: { lineStyle: { color: "#d0d9e8" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: Number((lo - pad).toFixed(2)),
      max: Number((hi + pad).toFixed(2)),
      axisLabel: { fontSize: 10, color: "#8899bb", fontFamily: "IBM Plex Mono",
                   formatter: (v: number) => v.toFixed(param.dp) },
      splitLine: { lineStyle: { color: "#eef2f8" } },
    },
    series: [
      { name: "Mines", type: "line", data: mines, connectNulls: false,
        symbol: "circle", symbolSize: 6, lineStyle: { width: 2, color: MINES },
        itemStyle: { color: MINES } },
      { name: "Plant", type: "line", data: plant, connectNulls: false,
        symbol: "circle", symbolSize: 6, lineStyle: { width: 2, color: PLANT },
        itemStyle: { color: PLANT } },
    ],
  };

  return (
    <div className="bg-white rounded-lg border border-border shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <FlaskConical size={13} className="text-[#15a0a0]" />
        <span className="font-condensed font-bold text-[12px] tracking-widest
                         uppercase text-navy">
          {param.title} — Mines vs Plant · {destLabel}
        </span>
      </div>
      {days.length === 0 ? (
        <div className="h-[260px] flex items-center justify-center
                        text-[12px] text-txt-light">
          No consignments to {destLabel} in this period.
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 260, width: "100%" }} notMerge />
      )}
    </div>
  );
}

export default function QualityTrendCharts({ from, to }: {
  /** The report's own window, so these agree with the tables above them. */
  from?: string;
  to?: string;
}) {
  const { data, isLoading } = useQuery<Resp>({
    // The same key the E2E table uses, so whichever screen loads first pays
    // for the request and the other reads it from the cache.
    queryKey: ["quality-e2e", from, to],
    queryFn: async () =>
      (await api.get("/quality-e2e", {
        params: { from_date: from, to_date: to },
      })).data,
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(from && to),
  });

  /* The four charts are siblings in a grid rather than children of one Card,
     so without this they arrive on the page as four unexplained panels. The
     heading is rendered in the loading state too — a title that appears only
     once the request lands makes the whole block jump. */
  const Section = ({ children }: { children: React.ReactNode }) => (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-steel"><FlaskConical size={14} /></span>
        <h3 className="font-condensed font-bold text-[13px] text-navy
                       tracking-widest uppercase">
          Despatch Quality Trend — Mines to Plant
        </h3>
      </div>
      {children}
    </section>
  );

  if (isLoading || !data) {
    return (
      <Section>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 xl:gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-border
                                    shadow-sm p-4">
              <div className="h-[280px] bg-bg-section animate-pulse rounded" />
            </div>
          ))}
        </div>
      </Section>
    );
  }

  const dests = data.destinations ?? [];

  return (
    <Section>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 xl:gap-4">
        {/* Cr₂O₃ for both plants, then Cr:Fe for both — the two readings of one
            consignment sit side by side, which is how they are argued about. */}
        {PARAMS.map((p) =>
          dests.map((d) => (
            <Chart
              key={`${p.key}-${d.key}`}
              param={p}
              destLabel={d.label}
              rows={data.rows.filter((r) => r.destination === d.key)}
            />
          )),
        )}
      </div>
    </Section>
  );
}
