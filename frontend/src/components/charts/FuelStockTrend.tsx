"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

/**
 * Where the diesel went, and where it is going.
 *
 * Two halves of one line. To the left of today, what MB5B recorded: the stock
 * at close of each day, with the days fuel arrived marked. To the right, the
 * same tank drawn forward at the rate it has actually been emptying.
 *
 * THE ARRIVALS ARE THE POINT. Stock only rises when something lands — a
 * tanker, or a transfer out of Sukinda, which MB5B records as an issue there
 * and a receipt here on the same day. The bars say which days those were, so
 * a reader can see that the mine has been living delivery to delivery rather
 * than off a reserve.
 *
 * THE FORECAST CARRIES NO OVERDUE ORDER. A lorry that was due in August has
 * not become more likely to arrive this morning, so the line shows what
 * happens if nothing changes. That is the only question worth putting on a
 * screen; the hopeful version of it has never helped anybody order fuel.
 */
interface Movement {
  day: string; plant: string; name: string;
  opening_l: number; received_l: number; issued_l: number; closing_l: number;
}
interface Projected { day: string; litres: number; arriving_l: number; dry: boolean }

export default function FuelStockTrend({
  movements, projection, burnPerDay, plantName,
}: {
  movements: Movement[];
  projection: Projected[];
  burnPerDay: number;
  plantName: string;
}) {
  const option = useMemo(() => {
    // Oldest first for a time axis; the API returns newest first because a
    // table wants it that way.
    const short = (iso: string) =>
      new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
        { day: "2-digit", month: "short" });
    const past = [...movements].sort((a, b) => a.day.localeCompare(b.day));

    /* TODAY HAS TO BE ON THE AXIS.
     *
     * The movement list holds only days something moved, and nothing moved
     * today — so the axis ran 05 Oct straight to 07 Oct and the day the
     * reader is standing in was not on the chart at all. The projection's
     * first entry IS today, carrying the stock as it stands, so it belongs on
     * the axis rather than being sliced off as a duplicate of a point that
     * was never there. */
    const days = [...past.map((m) => m.day), ...projection.map((p) => p.day)];
    const todayAt = past.length;          // where the record stops and the guess starts

    // The solid line runs to today and stops; the dashed one starts there, so
    // they meet at a point that exists rather than across a gap.
    const actual = [...past.map((m) => m.closing_l), projection[0]?.litres ?? null];
    const forecast = [
      ...new Array(past.length).fill(null),
      ...projection.map((p) => p.litres),
    ];
    const arrivals = [
      ...past.map((m) => (m.received_l > 0 ? m.received_l : null)),
      ...projection.map((p) => (p.arriving_l > 0 ? p.arriving_l : null)),
    ];

    return {
      grid: { left: 58, right: 20, top: 40, bottom: 46 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number | null) =>
          v === null || v === undefined ? "—" : `${Math.round(v).toLocaleString("en-IN")} L`,
      },
      legend: {
        data: ["In tank", "If nothing changes", "Arrived / due"],
        bottom: 0, itemWidth: 14, itemHeight: 8,
        textStyle: { fontSize: 10, color: "#64748b" },
      },
      xAxis: {
        type: "category", data: days.map(short),
        axisLabel: { fontSize: 9, color: "#94a3b8", interval: Math.ceil(days.length / 12) },
        axisLine: { lineStyle: { color: "#e2e8f0" } },
      },
      yAxis: {
        type: "value", name: "litres",
        nameTextStyle: { fontSize: 9, color: "#94a3b8" },
        axisLabel: {
          fontSize: 9, color: "#94a3b8",
          formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)),
        },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
      },
      series: [
        {
          name: "Arrived / due", type: "bar", data: arrivals,
          itemStyle: { color: "#38bdf8", borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 16,
        },
        {
          name: "In tank", type: "line", data: actual, smooth: false,
          symbol: "circle", symbolSize: 4,
          lineStyle: { width: 2.2, color: "#1e3a5f" },
          itemStyle: { color: "#1e3a5f" },
          areaStyle: { color: "rgba(30,58,95,0.07)" },
        },
        {
          name: "If nothing changes", type: "line", data: forecast,
          smooth: false, symbol: "none",
          lineStyle: { width: 2, type: "dashed", color: "#e11d48" },
          itemStyle: { color: "#e11d48" },
          /* Two vertical marks rather than a pin on the axis.
           *
           * The pin hung off the bottom of the plot and sat wherever the dry
           * day happened to fall, which on a crowded right-hand side meant it
           * landed on the tooltip. A line through the whole height cannot
           * collide with anything, and it says which day it is rather than
           * leaving the reader to follow it down to the axis.
           *
           * The first line is today — the boundary between what SAP recorded
           * and what this chart is guessing — which until now was only
           * implied by where the solid line stopped. */
          markLine: {
            symbol: "none",
            silent: true,
            data: [
              ...(past.length ? [{
                xAxis: todayAt,
                lineStyle: { color: "#94a3b8", width: 1.5, type: "dashed" },
                label: {
                  formatter: `today · ${short(projection[0]?.day ?? past[past.length - 1].day)}`,
                  position: "insideEndTop", fontSize: 9.5, color: "#475569",
                  backgroundColor: "#f8fafc", padding: [2, 5],
                  borderRadius: 3,
                },
              }] : []),
              ...(projection.some((p) => p.dry) ? [{
                xAxis: days.indexOf(projection.find((p) => p.dry)!.day),
                lineStyle: { color: "#e11d48", width: 2 },
                label: {
                  formatter: `dry · ${short(projection.find((p) => p.dry)!.day)}`,
                  position: "insideEndTop", fontSize: 9.5, color: "#fff",
                  backgroundColor: "#e11d48", padding: [2, 6],
                  borderRadius: 3,
                },
              }] : []),
            ],
          },
        },
      ],
    };
  }, [movements, projection]);

  return (
    <div>
      <ReactECharts option={option} style={{ height: 260 }}
                    opts={{ renderer: "canvas" }} notMerge />
      <p className="px-1 pt-1 text-[10.5px] text-txt-muted leading-relaxed">
        {plantName} is drawing about {Math.round(burnPerDay).toLocaleString("en-IN")} L
        a day. The dashed line carries that rate forward and adds deliveries on
        the date SAP holds for them — orders already overdue are left out, so
        this is what happens if nothing changes.
      </p>
    </div>
  );
}
