"use client";
/**
 * Work hours against energy, and the utilisation calendar, for every machine
 * at once.
 *
 * SMALL MULTIPLES, NOT ONE CHART WITH FOUR SERIES. Four machines on a single
 * pair of axes is unreadable the moment two of them overlap, and these four
 * are not comparable day to day anyway — one is a loader and one is a grader.
 * The same chart repeated down the page, on a SHARED Y SCALE, lets the eye
 * compare heights across machines without the lines fighting each other.
 *
 * The shared scale is the point: drawn to each machine's own maximum, a grader
 * that peaked at 4 hours and an excavator that peaked at 12 would look
 * identical.
 */
import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useEvHistoryAll } from "@/hooks/useEvTracking";
import type { EvVehicleData, EvVehicleHistoryDay } from "@/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface Series { vehicle: EvVehicleData; days: EvVehicleHistoryDay[] }

const shortDay = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const n1 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const n0 = (v: number) => Math.round(v).toLocaleString("en-IN");

export default function EvAnalysisAllVehicles({
  vehicles, from, to,
}: { vehicles: EvVehicleData[]; from: string | null; to: string | null }) {
  /* ONE CALL, CACHED. This asked the per-vehicle endpoint once per machine —
     four round trips to a database on another host, 1,859 ms for rows a single
     grouped read returns in 601 ms — and then threw the answer away and asked
     again every time the tab was reopened. */
  const { data, isPending } = useEvHistoryAll(from, to) as {
    data: { vehicles: { ev_equipment_id: number; history: EvVehicleHistoryDay[] }[] } | undefined;
    isPending: boolean;
  };

  /* Driven by the vehicle list the page already holds, so the order and the
     names match the rest of the screen rather than the query's. A machine with
     no rows comes back as an empty series — "no readings for this machine" is
     a different statement from the machine not existing. */
  const series: Series[] | null = useMemo(() => {
    if (!data) return null;
    const byId = new Map((data.vehicles ?? []).map((v) => [v.ev_equipment_id, v.history ?? []]));
    return vehicles.map((v) => ({ vehicle: v, days: byId.get(v.ev_equipment_id) ?? [] }));
  }, [data, vehicles]);

  if (!series || isPending) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-border bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    );
  }

  // One scale for every chart, so the heights mean something across machines.
  const maxHours = Math.max(
    ...series.flatMap((s) => s.days.map((d) => d.work_hours)), 1);
  const maxEnergy = Math.max(
    ...series.flatMap((s) => s.days.map((d) => d.total_energy_kwh)), 1);

  const option = (s: Series) => ({
    grid: { left: 44, right: 44, top: 16, bottom: 46 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: s.days.map((d) => shortDay(d.date)),
      axisLabel: {
        fontSize: 9, color: "#94a3b8", rotate: 45,
        interval: Math.max(Math.ceil(s.days.length / 15) - 1, 0),
      },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
    },
    yAxis: [
      { type: "value", max: Math.ceil(maxHours), name: "h",
        nameTextStyle: { fontSize: 9, color: "#94a3b8" },
        axisLabel: { fontSize: 9, color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#f1f5f9" } } },
      { type: "value", max: Math.ceil(maxEnergy), name: "kWh",
        nameTextStyle: { fontSize: 9, color: "#94a3b8" },
        axisLabel: { fontSize: 9, color: "#94a3b8" },
        splitLine: { show: false } },
    ],
    series: [
      { name: "Work hours", type: "bar", data: s.days.map((d) => d.work_hours),
        itemStyle: { color: "#2c4a7c", borderRadius: [2, 2, 0, 0] }, barMaxWidth: 14 },
      { name: "Energy kWh", type: "line", yAxisIndex: 1, smooth: true, symbol: "circle",
        symbolSize: 4, data: s.days.map((d) => d.total_energy_kwh),
        lineStyle: { width: 2, color: "#0d9488" }, itemStyle: { color: "#0d9488" } },
    ],
  });

  const tone = (h: number) =>
    h <= 0 ? "bg-bg-soft text-txt-muted"
      : h <= 2 ? "bg-blue-50 text-blue-800 border border-blue-100"
      : h <= 4 ? "bg-blue-100 text-blue-900 border border-blue-200"
      : h <= 6 ? "bg-blue-200 text-blue-950 border border-blue-300"
      : "bg-[#2c4a7c] text-white font-bold";

  return (
    <div className="space-y-3">
      {/* ── THE CHARTS, ONE AFTER ANOTHER ──────────────────────────────── */}
      {series.map((s) => {
        const hrs = s.days.reduce((n, d) => n + d.work_hours, 0);
        const kwh = s.days.reduce((n, d) => n + d.total_energy_kwh, 0);
        const worked = s.days.filter((d) => d.work_hours > 0).length;
        return (
          <div key={s.vehicle.ev_equipment_id}
               className="rounded-lg border border-border bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border-light pb-2">
              <h3 className="font-condensed text-[13px] font-bold uppercase tracking-widest text-navy">
                {s.vehicle.display_name || s.vehicle.serial_no}
              </h3>
              <span className="font-mono text-[9.5px] text-txt-light">{s.vehicle.serial_no}</span>
              <span className="text-[10px] text-txt-light">
                {s.vehicle.equipment_type}{s.vehicle.model ? ` · ${s.vehicle.model}` : ""}
              </span>
              <span className="ml-auto text-[11px] tabular-nums text-txt-secondary">
                {n1(hrs)} h · {n0(kwh)} kWh · worked {worked} of {s.days.length} days
              </span>
            </div>
            {s.days.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-txt-light">
                No readings for this machine in the selected period.
              </p>
            ) : (
              <div className="h-[200px]">
                <ReactECharts option={option(s)} style={{ height: "100%", width: "100%" }}
                              opts={{ renderer: "canvas" }} notMerge />
              </div>
            )}
          </div>
        );
      })}

      <p className="px-1 text-[10px] text-txt-light">
        Every chart shares one scale, so a bar twice as tall is twice the work —
        drawn to each machine&apos;s own maximum, a grader that peaked at four
        hours would look like an excavator that peaked at twelve.
      </p>

      {/* ── THEN EVERY CALENDAR, STACKED IN ONE PLACE ───────────────────
          Interleaved with the charts, comparing 14 April across four machines
          meant scrolling past four charts to do it. Together, the same column
          of squares lines up down the page and a day the whole fleet stood
          still is visible at a glance. */}
      <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
        <div className="mb-3 border-b border-border-light pb-2">
          <h3 className="font-condensed text-[13px] font-bold uppercase tracking-widest text-navy">
            Utilisation calendar — all machines
          </h3>
          <p className="text-[10px] text-txt-light">
            Intensity of daily work hours. The rows share a date axis, so a column
            that is pale across all four is a day nobody worked.
          </p>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[640px] space-y-1.5">
            {series.map((s) => (
              <div key={s.vehicle.ev_equipment_id} className="flex items-center gap-2">
                <span className="w-[108px] shrink-0 truncate text-[10.5px] font-semibold text-navy"
                      title={`${s.vehicle.display_name || ""} ${s.vehicle.serial_no}`}>
                  {s.vehicle.display_name || s.vehicle.serial_no}
                </span>
                <div className="flex gap-1">
                  {s.days.length === 0 ? (
                    <span className="text-[10px] text-txt-light">no readings</span>
                  ) : s.days.map((d) => (
                    <div key={d.date}
                         title={`${s.vehicle.display_name || s.vehicle.serial_no} · ${shortDay(d.date)} — ${n1(d.work_hours)} h, ${n0(d.total_energy_kwh)} kWh`}
                         className={`flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded text-[8px] leading-tight ${tone(d.work_hours)}`}>
                      <span>{new Date(d.date + "T00:00:00").getDate()}</span>
                      <span className="opacity-80">{n1(d.work_hours)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-light pt-2 text-[10px] text-txt-light">
          <span>Work hours:</span>
          {[["none", "bg-bg-soft"], ["to 2 h", "bg-blue-50"], ["2–4 h", "bg-blue-100"],
            ["4–6 h", "bg-blue-200"], ["over 6 h", "bg-[#2c4a7c]"]].map(([label, cls]) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`inline-block h-3 w-3 rounded ${cls} border border-border-light`} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
