"use client";
import SearchSelect from "@/components/minehub/SearchSelect";
import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Activity, AlertTriangle, BarChart3, BatteryCharging, Gauge, History, Info, RefreshCw, Route, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useDateFilter } from "@/contexts/useDateFilter";
import { periodLabel } from "@/lib/periodLabel";
import { useEvOverview, useEvVehicleHistory } from "@/hooks/useEvTracking";
import EvUploadButton from "@/components/sections/EvUploadButton";
import EvUploadLog from "@/components/sections/EvUploadLog";
import EvFreshnessButton from "@/components/sections/EvFreshnessButton";
import EvFleetSummary from "@/components/sections/EvFleetSummary";
import EvWorkAnalysisAll from "@/components/sections/EvWorkAnalysisAll";
import EvAnalysisAllVehicles from "@/components/sections/EvAnalysisAllVehicles";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const formatDateLabel = (dateStr: string | undefined | null) => {
  if (!dateStr) return "-";
  const pts = dateStr.split("-");
  if (pts.length === 3) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = parseInt(pts[2], 10);
    const month = months[parseInt(pts[1], 10) - 1];
    const year = pts[0];
    return `${day} ${month} ${year}`;
  }
  return dateStr;
};

const formatDateLabelShort = (dateStr: string | undefined | null) => {
  if (!dateStr) return "-";
  const pts = dateStr.split("-");
  if (pts.length === 3) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = parseInt(pts[2], 10);
    const month = months[parseInt(pts[1], 10) - 1];
    return `${day} ${month}`;
  }
  return dateStr;
};

export default function ElectricVehiclesSection() {
  const [activeTab, setActiveTab] = useState<"info" | "analysis" | "uploads">("info");
  /* Defaults to all: somebody opening Work Analysis wants the fleet, and a
     single machine chosen for them is a choice they did not make. */
  const [analysisScope, setAnalysisScope] = useState<"all" | "one">("all");
  const [selectedEvId, setSelectedEvId] = useState<number | null>(null);

  // Get global date range filters from global store
  const { apiFrom, apiTo } = useDateFilter();

  // Fetch Overview Data (polls every 60s when range includes today)
  const { data: overview, isLoading: overviewLoading, error: overviewError, refetch } = useEvOverview(apiFrom, apiTo);

  /* AN UPLOAD INVALIDATES EVERYTHING ON THIS PAGE, not just the overview.
     Now that the analytics table, the freshness badge, the coverage panel and
     the all-machines charts are cached, refetching only the overview would
     leave a page showing new totals beside an old "last reading" and an old
     overdue count — figures that disagree with each other are worse than
     figures that are slow. Both key roots, because the EV endpoints are split
     across two prefixes. */
  const qc = useQueryClient();
  const refreshAll = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ["ev"] });
    void qc.invalidateQueries({ queryKey: ["ev-tracking"] });
  };

  // Set default selected vehicle when overview loads
  useEffect(() => {
    if (overview && overview.vehicles && overview.vehicles.length > 0 && selectedEvId === null) {
      setSelectedEvId(overview.vehicles[0].ev_equipment_id);
    }
  }, [overview, selectedEvId]);

  const selectedVehicle = overview?.vehicles.find(v => v.ev_equipment_id === selectedEvId) || overview?.vehicles[0];

  // Fetch Vehicle History Data (once, no polling)
  /* Only the Equipment Info drill-down reads this, so only Equipment Info
     asks for it. It was fetched on every tab — a ~2.4 s request paid while
     looking at Work Analysis or the Upload Log, for a chart neither of them
     draws. Passing null disables the query; the cache keeps the answer, so
     coming back to this tab does not re-ask. */
  const { data: historyData, isLoading: historyLoading } = useEvVehicleHistory(
    activeTab === "info" ? selectedVehicle?.ev_equipment_id ?? null : null,
    apiFrom,
    apiTo
  );

  // Format dates for yesterday comparison
  const historyList = historyData?.history || [];
  const yesterdayRow = historyList.length > 0 ? historyList[historyList.length - 1] : null;

  const getAggregates = (numDays: number) => {
    const subset = historyList.slice(-numDays);
    const work = subset.reduce((acc, row) => acc + row.work_hours, 0);
    const idle = subset.reduce((acc, row) => acc + row.idling_hours, 0);
    const energy = subset.reduce((acc, row) => {
      // Clean telemetry spikes (e.g. 30055 kWh) for aggregate calculations
      const eVal = row.total_energy_kwh > 2000 ? row.work_hours * 35.0 : row.total_energy_kwh;
      return acc + eVal;
    }, 0);
    const avgRate = subset.length > 0 ? subset.reduce((acc, row) => acc + row.avg_energy_kwh_per_h, 0) / subset.length : 0;
    return {
      work: round(work, 1),
      idle: round(idle, 1),
      energy: round(energy, 1),
      avgRate: round(avgRate, 2),
      totalActiveUnrounded: work + idle
    };
  };

  const getDateRangeLabel = (numDays: number) => {
    if (historyList.length === 0) return `${numDays}-day`;
    const subset = historyList.slice(-numDays);
    if (subset.length === 0) return `${numDays}-day`;
    const startStr = formatDateLabel(subset[0].date);
    const endStr = formatDateLabel(subset[subset.length - 1].date);
    if (startStr === endStr) return startStr;
    return `${startStr} to ${endStr}`;
  };

  const getDateRangeLabelShort = (numDays: number) => {
    if (historyList.length === 0) return `${numDays}-day`;
    const subset = historyList.slice(-numDays);
    if (subset.length === 0) return `${numDays}-day`;
    const startStr = formatDateLabelShort(subset[0].date);
    const endStr = formatDateLabelShort(subset[subset.length - 1].date);
    if (startStr === endStr) return startStr;
    return `${startStr} - ${endStr}`;
  };

  const stats7d = getAggregates(7);
  const stats30d = getAggregates(30);

  // ECharts stacked option for Tab 1 (Light Theme compliant)
  const getStackedBarOption = () => {
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(255, 255, 255, 0.96)",
        borderColor: "#d0d9e8",
        borderWidth: 1,
        textStyle: { color: "#0f1c35", fontSize: 11 }
      },
      legend: {
        data: ["Work Hours", "Idling Hours"],
        textStyle: { color: "#3a4a6b", fontSize: 10 },
        bottom: 0
      },
      grid: {
        left: "3%",
        right: "8%",
        top: "8%",
        bottom: "20%",
        containLabel: true
      },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#eef2f8" } },
        axisLabel: { color: "#6b7ea8", fontSize: 9 }
      },
      yAxis: {
        type: "category",
        data: [
          getDateRangeLabelShort(30),
          getDateRangeLabelShort(7),
          yesterdayRow ? formatDateLabelShort(yesterdayRow.date) : "Latest"
        ],
        axisLabel: { color: "#0f1c35", fontSize: 10, fontWeight: "bold" },
        axisLine: { lineStyle: { color: "#d0d9e8" } }
      },
      series: [
        {
          name: "Work Hours",
          type: "bar",
          stack: "total",
          color: "#2c4a7c", // Steel blue
          barWidth: 16,
          label: {
            show: true,
            position: "inside",
            formatter: (params: any) => params.value > 1.5 ? `${params.value.toFixed(1)}h` : "",
            color: "#ffffff",
            fontSize: 9,
            fontWeight: "bold"
          },
          data: [
            stats30d.work,
            stats7d.work,
            yesterdayRow ? yesterdayRow.work_hours : 0
          ]
        },
        {
          name: "Idling Hours",
          type: "bar",
          stack: "total",
          color: "#c8960c", // Gold
          label: {
            show: true,
            position: "inside",
            formatter: (params: any) => params.value > 1.5 ? `${params.value.toFixed(1)}h` : "",
            color: "#ffffff",
            fontSize: 9,
            fontWeight: "bold"
          },
          data: [
            stats30d.idle,
            stats7d.idle,
            yesterdayRow ? yesterdayRow.idling_hours : 0
          ]
        }
      ]
    };
  };

  // ECharts Work Analysis Column/Area option for Tab 2 (Light Theme compliant)
  const getTrendOption = () => {
    const dates = historyList.map(h => {
      const pts = h.date.split("-");
      if (pts.length === 3) {
        const mNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${pts[2]} ${mNames[parseInt(pts[1]) - 1]}`;
      }
      return h.date;
    });
    const workHours = historyList.map(h => h.work_hours);
    
    // Clean energy consumption spikes dynamically for the chart display (e.g. 30055 kWh typo)
    const energies = historyList.map(h => {
      if (h.total_energy_kwh > 2000) {
        return round(h.work_hours * 35.0, 1);
      }
      return h.total_energy_kwh;
    });

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(255, 255, 255, 0.96)",
        borderColor: "#d0d9e8",
        borderWidth: 1,
        textStyle: { color: "#0f1c35", fontSize: 11 }
      },
      legend: {
        data: ["Work Hours", "Energy Consumed (kWh)"],
        textStyle: { color: "#3a4a6b", fontSize: 10 }
      },
      grid: {
        left: "3%",
        right: "3%",
        top: "15%",
        bottom: "10%",
        containLabel: true
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { color: "#6b7ea8", fontSize: 9, rotate: 30 },
        axisLine: { lineStyle: { color: "#d0d9e8" } }
      },
      yAxis: [
        {
          type: "value",
          name: "Hours",
          nameTextStyle: { color: "#6b7ea8", fontSize: 9 },
          splitLine: { lineStyle: { color: "#eef2f8" } },
          axisLabel: { color: "#6b7ea8", fontSize: 9 }
        },
        {
          type: "value",
          name: "kWh",
          nameTextStyle: { color: "#6b7ea8", fontSize: 9 },
          splitLine: { show: false },
          axisLabel: { color: "#6b7ea8", fontSize: 9 }
        }
      ],
      series: [
        {
          name: "Work Hours",
          type: "bar",
          color: "#2c4a7c",
          barWidth: 12,
          data: workHours
        },
        {
          name: "Energy Consumed (kWh)",
          type: "line",
          yAxisIndex: 1,
          color: "#2e7d32",
          smooth: true,
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(46, 125, 50, 0.15)" },
                { offset: 1, color: "rgba(46, 125, 50, 0)" }
              ]
            }
          },
          data: energies
        }
      ]
    };
  };

  // Render unified loading spinner matching FuelManagementSection
  if (overviewLoading) {
    return (
      <div className="min-h-screen bg-[#f5f7fb]">
        <div className="flex items-center justify-between py-3 px-1 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-gold" />
              <h1 className="font-condensed text-[22px] font-black tracking-[.04em] uppercase text-navy">
                Electric Vehicles Tracking
              </h1>
            </div>
            <p className="text-[11px] text-txt-light mt-0.5 ml-[26px]">
              Loading fleet telematics data...
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-border border-t-[#c8960c] rounded-full animate-spin" />
            <span className="text-[12px] text-txt-light font-condensed tracking-wide">
              Loading EV telematics…
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Render error screen matching layout
  if (overviewError || !overview) {
    return (
      <div className="min-h-screen bg-[#f5f7fb] p-4">
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3">
          <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
          <span className="text-[12px] text-[#c62828]">Failed to load EV telematics data. Please check connection.</span>
          <button
            onClick={refreshAll}
            className="ml-auto text-[11px] text-[#c62828] hover:text-navy underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] space-y-4">
      {/* ── Page header ────────────────────────────────────
          STUCK TO THE TOP, like the MIS dashboard's own section bar. These
          tabs and the upload are what somebody reaches for after reading a
          chart, and four machines' charts and calendars is a long scroll —
          having to come all the way back up to switch view is the kind of
          friction that stops people using a tab at all.

          top-[71px] clears the application header, which is what every other
          sticky bar in this codebase sits under; z-[15] matches it too. */}
      <div className="sticky top-[71px] z-[15] -mx-1 flex flex-wrap items-center justify-between gap-3
                      border-b border-border bg-[#f5f7fb]/95 px-1 py-3 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-gold" />
            <h1 className="font-condensed text-[22px] font-black tracking-[.04em] uppercase text-navy">
              Electric Vehicles Tracking
            </h1>
          </div>
          <p className="text-[11px] text-txt-light mt-0.5 ml-[26px] flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Kaliapani Chromite Mines — Fleet EV Overview</span>
            <span className="hidden md:inline h-1 w-1 rounded-full bg-border-dark" />
            <span className="font-semibold text-navy">Period: {formatDateLabel(apiFrom)} to {formatDateLabel(apiTo)}</span>
          </p>
        </div>

        {/* ── VIEWS, THEN THE ACTION ───────────────────────────────────────
            These were four buttons in a row, styled identically, with Upload
            Export first. Three of them change what this page is showing and
            one of them changes the database, and nothing on screen said which
            was which — the destructive one simply came first.

            So the three views are now one segmented control, in the order the
            mine reads them: the machine, then its work, then who loaded the
            figures. The upload sits apart, after a divider, carrying its own
            icon; it is the only control here that writes anything. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-white p-0.5 shadow-sm">
            {([
              { key: "info",     icon: Info,      label: "Equipment Info", iconOnly: false },
              { key: "analysis", icon: BarChart3, label: "Work Analysis",  iconOnly: false },
              /* The log is a place you go occasionally, not a view you work
                 in. Reduced to its icon so the two daily views carry the eye,
                 with the name on hover and for a screen reader — an unlabelled
                 control is only acceptable when it still announces itself. */
              { key: "uploads",  icon: History,   label: "Upload Log",     iconOnly: true },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                aria-current={activeTab === t.key ? "page" : undefined}
                aria-label={t.label}
                title={t.label}
                className={`flex items-center gap-1.5 rounded-md py-1.5 text-[11px] font-condensed font-bold uppercase tracking-widest transition ${
                  t.iconOnly ? "px-2.5" : "px-3"
                } ${
                  activeTab === t.key
                    ? "bg-gold text-white shadow-sm"
                    : "text-txt-secondary hover:bg-bg-section hover:text-navy"
                }`}
              >
                <t.icon size={t.iconOnly ? 14 : 12} />
                {t.iconOnly ? null : t.label}
              </button>
            ))}
          </div>

          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />

          {/* Says whether yesterday is in before anybody reads a figure off
              this page. Sits beside the upload because the answer to "it is
              overdue" is almost always "then upload it". */}
          <EvFreshnessButton />
          <EvUploadButton onUploaded={refreshAll} />
        </div>
      </div>

      {/* KPI strip (Light theme top-border colored design) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Total Electric Fleet"
          value={`${overview.total_vehicles}`}
          sub={`${overview.active_vehicles} active · ${periodLabel(apiFrom, apiTo)}`}
          icon={Zap}
          accentColor="#c8960c"
        />
        <KpiCard
          label="Total Engine On Time"
          value={`${overview.total_work_hours} H`}
          sub="Cumulative runtime across fleet"
          icon={Gauge}
          accentColor="#2c4a7c"
        />
        <KpiCard
          label="Total Energy Consumed"
          value={`${overview.total_energy_kwh} kWh`}
          sub="Telemetry sum in date range"
          icon={BatteryCharging}
          accentColor="#2e7d32"
        />
        <KpiCard
          label="Avg Energy Load Rate"
          value={`${round(overview.total_work_hours > 0 ? overview.total_energy_kwh / overview.total_work_hours : 0, 2)} kWh/h`}
          sub="Fleet usage load factor"
          icon={Route}
          accentColor="#e65100"
        />
      </div>

      {/* TAB CONTENT: 1. Equipment Info */}
      {/* The side-by-side totals, after the per-machine detail: the charts
          above answer how each machine did, this answers who did most. */}
      {activeTab === "analysis" && overview?.vehicles?.length ? (
        <div className="mt-3">
          {/* A row is the machine, so clicking one opens that machine
              in the drill-down below rather than merely highlighting. */}
          <EvWorkAnalysisAll
            vehicles={overview.vehicles}
            from={apiFrom}
            to={apiTo}
            onDrillDown={(id) => { setSelectedEvId(id); setAnalysisScope("one"); }}
          />
        </div>
      ) : null}

      {/* Keyed on the tab so React remounts this region when it changes — that
          is what lets the fade run on every switch rather than only the first.
          The header above it is deliberately outside: the tabs and the upload
          button should not flicker when the body beneath them changes. */}
      <div key={activeTab} className="ev-tab-enter space-y-4">

      {activeTab === "uploads" && <EvUploadLog />}

      </div>

      {/* The single-glance table the mine asked for: every machine, TD and
          MTD and lifetime, before any drill-down. */}
      {activeTab === "info" && (
        <EvFleetSummary from={apiFrom} to={apiTo}
                        onWorkAnalysis={() => setActiveTab("analysis")} />
      )}

      {activeTab === "info" && selectedVehicle && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          {/* Main comparative chart and details */}
          <div className="xl:col-span-2 space-y-3">
            {/* Top Chart and Aggregates Table */}
            <div className="bg-white border border-border rounded-lg shadow-sm p-4 xl:p-5 flex flex-col min-w-0">
              <div className="flex items-center justify-between border-b border-border-light pb-2.5 mb-4">
                <h3 className="text-[12px] uppercase font-bold tracking-wider text-txt-secondary font-condensed">
                  {/* The name the mine uses leads; the serial stays because it
                      is what ties the machine to its export file. */}
                  Vehicle Usage Analytics — {selectedVehicle.display_name ?? selectedVehicle.serial_no}
                  {selectedVehicle.display_name ? ` · ${selectedVehicle.serial_no}` : ""}
                  {" "}({selectedVehicle.equipment_type})
                </h3>
                <span className="text-[9px] bg-gold/10 border border-gold/30 px-2 py-0.5 rounded text-gold font-bold font-condensed tracking-wider">
                  {selectedVehicle.make} {selectedVehicle.model}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Horizontal Stacked Bar Chart */}
                <div className="md:col-span-2 h-[180px]">
                  <ReactECharts option={getStackedBarOption()} style={{ height: "100%", width: "100%" }} />
                </div>

                {/* Table details */}
                <div className="border border-border rounded overflow-hidden">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-bg-soft border-b border-border text-txt-secondary font-bold font-condensed">
                        <th className="p-2 border-r border-border">Time Period</th>
                        <th className="p-2 border-r border-border text-right">Energy Consumed</th>
                        <th className="p-2 text-right">Total Active Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-txt-primary font-mono text-[10.5px]">
                      <tr>
                        <td className="p-2 border-r border-border font-sans text-txt-secondary font-medium">
                          {yesterdayRow ? formatDateLabel(yesterdayRow.date) : "Latest"}
                        </td>
                        <td className="p-2 border-r border-border text-right">
                          {yesterdayRow ? `${yesterdayRow.total_energy_kwh} kWh` : "0 kWh"}
                        </td>
                        <td className="p-2 text-right">
                          {yesterdayRow ? `${round(yesterdayRow.work_hours + yesterdayRow.idling_hours, 3)} H` : "0 H"}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 border-r border-border font-sans text-txt-secondary font-medium">
                          {getDateRangeLabel(7)}
                        </td>
                        <td className="p-2 border-r border-border text-right">{stats7d.energy} kWh</td>
                        <td className="p-2 text-right">{round(stats7d.totalActiveUnrounded, 3)} H</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-r border-border font-sans text-txt-secondary font-medium">
                          {getDateRangeLabel(30)}
                        </td>
                        <td className="p-2 border-r border-border text-right">{stats30d.energy} kWh</td>
                        <td className="p-2 text-right">{round(stats30d.totalActiveUnrounded, 3)} H</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Bottom Section: Radial dials & Battery health */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Shift achievement */}
              <div className="bg-white border border-border rounded-lg shadow-sm p-4 xl:p-5 flex flex-col justify-between">
                <div className="border-b border-border-light pb-2 mb-3">
                  <h3 className="text-[12px] uppercase font-bold tracking-wider text-txt-secondary font-condensed">
                    Shift Work Hours Achievement
                  </h3>
                  <p className="text-[10px] text-txt-muted font-condensed">Target workload: 8.0 H per day shift</p>
                </div>

                <div className="flex flex-col items-center justify-center py-2 relative">
                  {/* CSS Radial circle */}
                  <div className="relative h-24 w-24 rounded-full border-[8px] border-[#eef2f8] flex items-center justify-center">
                    <div
                      className="absolute inset-0 rounded-full border-[8px] border-t-[#2c4a7c] border-r-[#2c4a7c]"
                      style={{ transform: "rotate(45deg)" }}
                    />
                    <div className="text-center">
                      <span className="text-xl font-extrabold text-navy font-mono">
                        {round(selectedVehicle.work_hours, 1)}h
                      </span>
                      <div className="text-[8px] text-txt-muted uppercase tracking-wider font-bold font-condensed">
                        Shift Hrs
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-4 text-[10.5px] font-bold text-txt-secondary font-condensed">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[#2c4a7c]" />
                      Work: {selectedVehicle.work_hours} H
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[#c8960c]" />
                      Idle: {selectedVehicle.idling_hours} H
                    </span>
                  </div>
                </div>
              </div>

              {/* Battery SoC & SoH */}
              <div className="bg-white border border-border rounded-lg shadow-sm p-4 xl:p-5 flex flex-col justify-between">
                <div className="border-b border-border-light pb-2 mb-3">
                  <h3 className="text-[12px] uppercase font-bold tracking-wider text-txt-secondary font-condensed">
                    Battery Telematics State
                  </h3>
                  <span className="text-[8px] bg-bg-soft border border-border px-1.5 py-0.5 rounded text-txt-muted font-mono">
                    ESTIMATED · TELEMATICS LINK
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 py-1">
                  {/* Battery SoC Cell */}
                  <div className="flex flex-col items-center p-2.5 bg-bg-soft border border-border-light rounded">
                    <div className="relative h-12 w-7 border-2 border-txt-muted/30 rounded p-0.5 flex flex-col justify-end">
                      <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-0.5 bg-txt-muted/40 rounded-t-sm" />
                      <div
                        className="w-full bg-[#2e7d32] rounded-sm transition-all duration-500"
                        style={{ height: `${selectedVehicle.battery_soc}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[9.5px] font-black text-white font-mono drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                        {selectedVehicle.battery_soc}%
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-txt-secondary mt-1.5 font-condensed">Battery SoC</span>
                  </div>

                  {/* Battery SoH Cell */}
                  <div className="flex flex-col items-center p-2.5 bg-bg-soft border border-border-light rounded">
                    <div className="relative h-12 w-7 border-2 border-txt-muted/30 rounded p-0.5 flex flex-col justify-end">
                      <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-0.5 bg-txt-muted/40 rounded-t-sm" />
                      <div
                        className="w-full bg-[#1565c0] rounded-sm transition-all"
                        style={{ height: `${selectedVehicle.battery_soh}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[9.5px] font-black text-white font-mono drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                        {selectedVehicle.battery_soh}%
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-txt-secondary mt-1.5 font-condensed">Battery SoH</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right vehicle list selector */}
          <div className="bg-white border border-border rounded-lg shadow-sm p-4 xl:p-5 flex flex-col">
            <div className="border-b border-border-light pb-2.5 mb-4">
              <h3 className="text-[12px] uppercase font-bold tracking-wider text-txt-secondary font-condensed">
                Active Electric Fleet ({overview.total_vehicles})
              </h3>
              <p className="text-[10px] text-txt-muted font-condensed">Select a vehicle to drill down</p>
            </div>

            {/* TWO LINES A MACHINE, NOT SIX.
                Name, serial and type each had a line of their own, then a
                three-column strip for two numbers and the model — six lines to
                carry seven short facts, so a fleet of four filled the column
                and a fleet of eight would need scrolling to see the last one.
                Nothing is dropped here; the facts that belong together simply
                sit on the same line — then given back enough padding to
                breathe, because two lines crammed into 47 px read as a
                spreadsheet row rather than a thing you click. */}
            <div className="space-y-2 overflow-y-auto flex-1 max-h-[460px] scrollbar-thin">
              {overview.vehicles.map(v => {
                const isActive = v.ev_equipment_id === selectedEvId;
                const running = v.work_hours > 0;
                return (
                  <button
                    key={v.ev_equipment_id}
                    onClick={() => setSelectedEvId(v.ev_equipment_id)}
                    title={`${v.display_name ?? ""} ${v.serial_no} · ${v.equipment_type}${v.model ? ` · ${v.model}` : ""}`}
                    className={`w-full rounded border px-3 py-2.5 text-left transition-colors duration-150 ${
                      isActive
                        ? "bg-bg-light border-gold shadow-sm"
                        : "bg-white border-border hover:bg-bg-soft"
                    }`}
                  >
                    {/* Line 1 — who it is, and whether it moved. */}
                    <div className="flex items-baseline gap-1.5">
                      <span className={`shrink-0 font-mono text-[11.5px] font-bold ${
                        isActive ? "text-gold font-extrabold" : "text-txt-primary"}`}>
                        {v.display_name ?? v.serial_no}
                      </span>
                      {v.display_name ? (
                        <span className="min-w-0 truncate font-mono text-[9px] text-txt-light">
                          {v.serial_no}
                        </span>
                      ) : null}
                      {/* A dot carries "running" as well as a word does and
                          costs no width; the word stays as its title. */}
                      <span
                        title={running ? "Running in this period" : "Idle in this period"}
                        className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${
                          running ? "bg-success" : "bg-warning"}`}
                      />
                    </div>

                    {/* Line 2 — what it is, and what it did. */}
                    <div className="mt-1.5 flex items-baseline gap-1.5 font-condensed text-[9.5px]">
                      <span className="shrink-0 font-bold uppercase tracking-wider text-txt-light">
                        {v.equipment_type}
                      </span>
                      {v.model ? (
                        <span className="min-w-0 truncate text-txt-muted">· {v.model}</span>
                      ) : null}
                      <span className="ml-auto shrink-0 font-mono tabular-nums text-[10px] font-bold text-txt-primary">
                        {v.work_hours} H
                        <span className="mx-1 font-normal text-border-dark">·</span>
                        {v.total_energy_kwh} kWh
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: 2. Work Analysis */}
      {/* ALL MACHINES OR ONE. The question "how did EV EX-2 do" and the
          question "how did they do against each other" are both asked of this
          tab, and before this it could only answer the first. */}
      {activeTab === "analysis" && overview?.vehicles?.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5">
          <span className="text-[11px] font-condensed font-bold uppercase tracking-widest text-txt-secondary">
            Show
          </span>
          {([
            { key: "all", label: `All machines (${overview.vehicles.length})` },
            { key: "one", label: "One machine" },
          ] as const).map((o) => (
            <label key={o.key}
                   className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-condensed font-bold uppercase tracking-widest transition ${
                     analysisScope === o.key
                       ? "border-gold-dark bg-gold text-white"
                       : "border-border bg-white text-txt-secondary hover:bg-bg-section"
                   }`}>
              <input type="radio" name="ev-analysis-scope" className="sr-only"
                     checked={analysisScope === o.key}
                     onChange={() => setAnalysisScope(o.key)} />
              {o.label}
            </label>
          ))}
          {analysisScope === "all" ? (
            <span className="ml-auto text-[10.5px] text-txt-light">
              Same chart per machine, on one shared scale
            </span>
          ) : null}
        </div>
      ) : null}

      {activeTab === "analysis" && analysisScope === "all" && overview?.vehicles?.length ? (
        <EvAnalysisAllVehicles vehicles={overview.vehicles} from={apiFrom} to={apiTo} />
      ) : null}

      {activeTab === "analysis" && analysisScope === "one" && selectedVehicle && (
        <div className="space-y-3">
          {/* Chart Section */}
          <div className="bg-white border border-border rounded-lg shadow-sm p-4 xl:p-5 flex flex-col min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border-light pb-2.5 mb-4 gap-3">
              <div>
                <h3 className="text-[12px] uppercase font-bold tracking-wider text-txt-secondary font-condensed">
                  Work Hours vs Energy Consumption History
                </h3>
                <p className="text-[10px] text-txt-muted font-condensed">Showing data for {selectedVehicle.display_name ?? selectedVehicle.serial_no}{selectedVehicle.display_name ? ` · ${selectedVehicle.serial_no}` : ""} ({selectedVehicle.equipment_type})</p>
              </div>

              {/* Vehicle selector inside Work Analysis tab */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-condensed font-bold text-txt-secondary uppercase">Select Vehicle:</span>
                <SearchSelect value={String(selectedEvId || "")}
                  onChange={(v) => setSelectedEvId(Number(v))}
                  placeholder="Choose a vehicle…"
                  searchPlaceholder="Type a serial number…"
                  className="bg-white text-[11.5px] px-2.5 py-1.5 font-condensed font-bold shadow-sm"
                  options={overview.vehicles.map((v) => ({
                    value: String(v.ev_equipment_id),
                    label: v.display_name ? `${v.display_name} · ${v.serial_no}` : v.serial_no,
                    hint: v.equipment_type,
                  }))} />
              </div>
            </div>

            {historyLoading ? (
              <div className="flex flex-col items-center justify-center h-[260px]">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                <span className="text-[11px] text-txt-light mt-2">Loading trend data...</span>
              </div>
            ) : historyList.length > 0 ? (
              <div className="h-[280px]">
                <ReactECharts option={getTrendOption()} style={{ height: "100%", width: "100%" }} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-[260px] text-[11px] text-txt-light border border-dashed border-border rounded">
                No historical records found for this period.
              </div>
            )}
          </div>

          {/* GitHub Style Calendar Heatmap */}
          <div className="bg-white border border-border rounded-lg shadow-sm p-4 xl:p-5 flex flex-col min-w-0">
            <div className="border-b border-border-light pb-2 mb-3">
              <h3 className="text-[12px] uppercase font-bold tracking-wider text-txt-secondary font-condensed">
                Machine Utilization Calendar View
              </h3>
              <p className="text-[10px] text-txt-muted font-condensed">Intensity of daily work hours</p>
            </div>

            {historyLoading ? (
              <div className="h-20 animate-pulse bg-bg-soft rounded" />
            ) : historyList.length > 0 ? (
              <div className="overflow-x-auto py-2">
                <div className="flex gap-1.5 min-w-[700px] select-none justify-start">
                  {historyList.map(h => {
                    const hrs = h.work_hours;
                    let color = "bg-bg-soft text-txt-muted"; // no work
                    if (hrs > 0 && hrs <= 2) color = "bg-blue-50 text-blue-800 border border-blue-100";
                    if (hrs > 2 && hrs <= 4) color = "bg-blue-100 text-blue-900 border border-blue-200";
                    if (hrs > 4 && hrs <= 6) color = "bg-blue-200 text-blue-950 border border-blue-300";
                    if (hrs > 6) color = "bg-[#2c4a7c] text-white font-bold";

                    const dayLabel = h.date.split("-")[2];
                    const monthLabel = h.date.split("-")[1];
                    const shortMonth = monthLabel === "04" ? "Apr" : monthLabel === "05" ? "May" : monthLabel === "06" ? "Jun" : monthLabel === "07" ? "Jul" : "Mon";

                    return (
                      <div
                        key={h.date}
                        title={`${h.date}: ${hrs} Hours worked`}
                        className={`h-9 w-9 rounded flex flex-col items-center justify-center text-[10px] ${color}`}
                      >
                        <span className="font-mono font-bold leading-tight">{dayLabel}</span>
                        <span className="text-[7.5px] opacity-70 leading-none uppercase font-condensed">{shortMonth}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-between text-[10px] text-txt-light font-bold font-condensed border-t border-border-light pt-3">
                  <div className="flex items-center gap-1.5">
                    <span>Utilization Level:</span>
                    <div className="flex gap-1">
                      <span className="h-3 w-3 rounded bg-bg-soft border border-border" title="0 Hours" />
                      <span className="h-3 w-3 rounded bg-blue-50 border border-blue-100" title="0 - 2 Hours" />
                      <span className="h-3 w-3 rounded bg-blue-100 border border-blue-200" title="2 - 4 Hours" />
                      <span className="h-3 w-3 rounded bg-blue-200 border border-blue-300" title="4 - 6 Hours" />
                      <span className="h-3 w-3 rounded bg-[#2c4a7c]" title=">6 Hours" />
                    </div>
                  </div>
                  <div>
                    <span className="font-mono text-txt-light">Total: {historyList.length} sync logs</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-[11px] text-txt-light">
                No calendar data available.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper formatting function
function round(value: any, precision: number): number {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  const power = Math.pow(10, precision);
  return Math.round(num * power) / power;
}

// Unified KpiCard from FuelManagementSection
interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accentColor?: string;
}
function KpiCard({ icon: Icon, label, value, sub, accentColor = "#c8960c" }: KpiCardProps) {
  return (
    <div
      className="bg-white border border-border rounded-lg shadow-sm p-4 flex flex-col gap-2 min-w-0"
      style={{ borderTop: `3px solid ${accentColor}` }}
    >
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded flex items-center justify-center shrink-0"
             style={{ background: `${accentColor}18` }}>
          <Icon size={13} style={{ color: accentColor }} />
        </div>
        <span className="font-condensed text-[12px] font-bold tracking-widest uppercase text-txt-muted truncate">
          {label}
        </span>
      </div>

      <div className="font-condensed text-[26px] xl:text-[28px] font-extrabold text-navy-2 leading-none truncate tracking-tight">
        {value}
      </div>

      <div className="flex items-center gap-2 min-h-[16px]">
        {sub && <span className="text-[11px] text-txt-muted font-condensed truncate">{sub}</span>}
      </div>
    </div>
  );
}
