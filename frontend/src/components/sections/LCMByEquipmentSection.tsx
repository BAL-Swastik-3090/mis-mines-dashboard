"use client";
import { Fragment, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowUpDown, CheckCircle2, Columns3, Layers, Truck,
} from "lucide-react";
import { useLCMByEquipment } from "@/hooks/useLCMByEquipment";
import { formatIndian } from "@/lib/utils";
import type { LCMEquipment, LCMEquipmentRow } from "@/types";

/**
 * Equipment Wise Lost Cost Matrix.
 *
 * THE ONE LOSS MATRIX THE PAGE SHOWS. It used to sit above a second table
 * that printed the same 25 loss heads and the same ten columns, differing
 * only in giving every machine on a side ONE rate — so a single Ore Factor
 * divided the whole ore deviation by the whole ore fleet's loss hours, and an
 * hour lost on a 26 CuM/hr excavator cost the same tonnes as an hour lost on
 * a 17 CuM/hr one. They are not the same: the bigger machine was planned to
 * produce more, so an hour of its downtime loses more. That table was removed
 * on 11 November 2026 as the same figures said less well.
 *
 * IT RE-ATTRIBUTES A TOTAL, IT NEVER CHANGES ONE — and the page states that
 * rather than asking anyone to take it on trust. The reconciliation strip at
 * the top prints this table's totals against what get_lcm() computed for the
 * period: hours to the second decimal, the ore and OB columns against their
 * deviations, and the rupee total. That check matters MORE now that the
 * second table is gone, because nothing else on screen would show a drift.
 * If any of them stops agreeing, the strip turns amber and says which.
 *
 * WHICH MACHINES APPEAR IS NOT DECIDED HERE. The sides come from the mine's
 * Equipment Excavation Plan and the capacities from the Equipment Status
 * Selector. Move a machine from OB to ore, correct its capacity or mark it
 * inactive, and this table follows on the next load.
 *
 * EVERY LOSS HEAD IS SHOWN, including the ones carrying nothing. A head at
 * zero this period is not the same as a head that does not exist, and the
 * mine reads this table down the Sl column.
 */

const ALL = "__ALL__";

function fmt(v: number | null | undefined, dp = 2) {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function f0(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}
/** Large rupee figures read in lakhs, as the rest of the page prints them. */
function rsLakh(v: number | null | undefined) {
  if (v == null) return "—";
  return `₹${(v / 100000).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;
}

function Shimmer({ w = "w-20", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

/** Controllable / Non Ctrl / Unclassified, styled as the LCM KAM Selector
 *  and the KAM tree style them — the same classification must not look like
 *  two different things on one screen. */
function TypePill({ t }: { t: string }) {
  const map: Record<string, string> = {
    "Controllable": "bg-[#ffebee] text-[#c62828] border-[#ef9a9a]",
    "Non Controllable": "bg-[#eceff1] text-[#455a64] border-[#b0bec5]",
  };
  const label = t === "Non Controllable" ? "NON CTRL"
    : t === "Controllable" ? "CONTROLLABLE" : "UNCLASSIFIED";
  return (
    <span className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border tracking-widest
                      uppercase font-mono whitespace-nowrap ${
      map[t] ?? "bg-[#fff8e1] text-[#c8960c] border-[#ffe082]"}`}>
      {label}
    </span>
  );
}

export default function LCMByEquipmentSection() {
  const { data, isLoading, isError } = useLCMByEquipment();
  const [picked, setPicked] = useState<string>(ALL);
  const [sortByShare, setSortByShare] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);

  const machines = useMemo(() => data?.machines ?? [], [data]);
  /* A machine the mine has since taken off the plan must not leave the table
     stuck on an empty selection when the date filter moves. */
  const sel = picked !== ALL && machines.some((m) => m.equipment_name === picked)
    ? picked : ALL;
  const selMachine: LCMEquipment | undefined =
    sel === ALL ? undefined : machines.find((m) => m.equipment_name === sel);

  /** The rows for whatever is selected, with the scope's own loss share.
   *
   *  Share is recomputed against the SELECTED scope rather than carried from
   *  the roll-up, so the column always adds to 100% of what is on screen.
   *  A machine's share of the whole mine's loss is a different question and
   *  would read as a broken column here. */
  const rows = useMemo(() => {
    const src = data?.rows ?? [];
    const scoped = src.map((r) => {
      if (sel === ALL) {
        return {
          row: r,
          oreHours: r.ore_hours, oreLoss: r.planned_ore_loss,
          obHours: r.ob_hours, obLoss: r.planned_ob_loss,
          amount: r.loss_amount,
        };
      }
      const c = r.machines[sel];
      const isOre = c?.side === "ORE";
      return {
        row: r,
        oreHours: isOre ? (c?.hours ?? 0) : null,
        oreLoss: isOre ? (c?.planned_loss ?? 0) : null,
        obHours: !isOre ? (c?.hours ?? 0) : null,
        obLoss: !isOre ? (c?.planned_loss ?? 0) : null,
        amount: c?.loss_amount ?? null,
      };
    });
    const tot = scoped.reduce((s, x) => s + (x.amount ?? 0), 0);
    const withShare = scoped.map((x) => ({
      ...x, share: tot > 0 && x.amount != null ? (x.amount / tot) * 100 : null,
    }));
    return sortByShare
      ? [...withShare].sort((a, b) =>
          (b.share ?? -1) - (a.share ?? -1) || a.row.sl_no - b.row.sl_no)
      : withShare;
  }, [data, sel, sortByShare]);

  /** Column totals for whatever is on screen. */
  const totals = useMemo(() => rows.reduce((s, x) => ({
    oreHours: s.oreHours + (x.oreHours ?? 0),
    oreLoss: s.oreLoss + (x.oreLoss ?? 0),
    obHours: s.obHours + (x.obHours ?? 0),
    obLoss: s.obLoss + (x.obLoss ?? 0),
    amount: s.amount + (x.amount ?? 0),
    share: s.share + (x.share ?? 0),
  }), { oreHours: 0, oreLoss: 0, obHours: 0, obLoss: 0, amount: 0, share: 0 }), [rows]);

  const rate = data?.costing?.weighted_rate ?? null;
  const rec = data?.reconciliation;
  const reconciles = !!rec && rec.hours_match && rec.ore_loss_match
    && rec.ob_loss_match && rec.amount_match;

  const noPlan = !isLoading && !isError && machines.length === 0;
  const unattributed = machines.filter((m) => !m.carries_share);

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center
                      justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Truck size={14} className="text-[#00838f]" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Equipment Wise Lost Cost Matrix — Loss Heads
          </span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-[#e0f7fa]
                           text-[#00838f] border-[#80deea] tracking-widest uppercase font-mono">
            {machines.length} machine{machines.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSideBySide((v) => !v)}
            title={sideBySide ? "One machine at a time" : "All machines side by side"}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[9.5px]
                        font-condensed font-bold tracking-widest uppercase transition-colors ${
              sideBySide
                ? "border-[#00838f] bg-[#e0f7fa] text-[#00838f]"
                : "border-border bg-white text-txt-secondary hover:bg-bg-section"}`}
          >
            <Columns3 size={11} />
            Side by side
          </button>
          <button
            type="button"
            onClick={() => setSortByShare((v) => !v)}
            title={sortByShare ? "Back to Sl. order" : "Sort by loss share, high to low"}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[9.5px]
                        font-condensed font-bold tracking-widest uppercase transition-colors ${
              sortByShare
                ? "border-[#ad1457] bg-[#fce4ec] text-[#ad1457]"
                : "border-border bg-white text-txt-secondary hover:bg-bg-section"}`}
          >
            <ArrowUpDown size={11} />
            {sortByShare ? "Loss share ↓" : "Sl. order"}
          </button>
        </div>
      </div>

      {/* ── Reconciliation strip ────────────────────────────────────────
          This table exists to re-attribute a total, never to change one.
          Printing the check is cheaper than asking anyone to believe it — and
          since the overall matrix was removed, this strip is the ONLY place a
          drift between the two would become visible. */}
      {!isLoading && !noPlan && rec && (
        <div className={`px-4 py-2 border-b text-[10px] font-mono flex items-center
                         gap-x-5 gap-y-1 flex-wrap ${
          reconciles
            ? "bg-[#f1f8f2] border-[#c8e6c9] text-[#2e7d32]"
            : "bg-[#fff8e1] border-[#ffe082] text-[#8d6e00]"}`}>
          {reconciles
            ? <CheckCircle2 size={12} className="shrink-0" />
            : <AlertTriangle size={12} className="shrink-0" />}
          <span className="font-bold tracking-widest uppercase text-[9px]">
            {reconciles ? "Reconciles with the period deviation" : "Does not reconcile"}
          </span>
          <span>Ore hrs {fmt(data?.totals.ore_hours)} / {fmt(rec.overall_ore_hours)}</span>
          <span>OB hrs {fmt(data?.totals.ob_hours)} / {fmt(rec.overall_ob_hours)}</span>
          <span>Ore loss {f0(data?.totals.planned_ore_loss)} / {f0(rec.ore_deviation)} MT</span>
          <span>OB loss {f0(data?.totals.planned_ob_loss)} / {f0(rec.ob_deviation)} CuM</span>
          {rec.overall_loss_amount != null && (
            <span>Value {rsLakh(data?.totals.loss_amount)} / {rsLakh(rec.overall_loss_amount)}</span>
          )}
          {data?.capacity_source === "fleet_default" && (
            <span className="text-[#8d6e00]">
              · capacities are built-in defaults — minehub was unreachable
            </span>
          )}
        </div>
      )}

      {/* ── Machine strip: capacity, hours, share and the factor each earns ── */}
      {!isLoading && !noPlan && (
        <div className="px-4 py-2.5 border-b border-border-light bg-[#fafbfd]">
          <div className="flex items-stretch gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setPicked(ALL)}
              className={`px-2.5 py-1.5 rounded border text-left transition-colors ${
                sel === ALL
                  ? "border-navy bg-navy text-white"
                  : "border-border bg-white hover:bg-bg-section"}`}
            >
              <span className="block text-[10px] font-condensed font-bold tracking-widest uppercase">
                All equipment
              </span>
              <span className={`block text-[9px] font-mono ${
                sel === ALL ? "text-white/70" : "text-txt-light"}`}>
                every machine on the plan
              </span>
            </button>

            {machines.map((m) => {
              const on = sel === m.equipment_name;
              const ore = m.side === "ORE";
              return (
                <button
                  key={m.equipment_name}
                  type="button"
                  onClick={() => setPicked(m.equipment_name)}
                  title={m.carries_share
                    ? `${m.side} · capacity ${m.capacity} CuM/hr · ${fmt(m.hours)} loss hrs · factor ${m.factor} ${m.unit}/hr`
                    : m.reason === "no_loss_hours"
                      ? "No loss hours this period — its share went to the machines that did lose hours"
                      : "No capacity on file in the Equipment Status Selector, so it cannot take a share"}
                  className={`px-2.5 py-1.5 rounded border text-left transition-colors ${
                    on
                      ? (ore ? "border-[#1565c0] bg-[#1565c0] text-white"
                             : "border-[#2e7d32] bg-[#2e7d32] text-white")
                      : "border-border bg-white hover:bg-bg-section"}`}
                >
                  <span className="flex items-center gap-1">
                    <span className={`text-[8px] font-bold tracking-widest uppercase font-mono
                                      px-1 rounded ${
                      on ? "bg-white/20 text-white"
                         : ore ? "bg-[#e3f2fd] text-[#1565c0]" : "bg-[#e8f5e9] text-[#2e7d32]"}`}>
                      {m.side}
                    </span>
                    <span className="text-[10px] font-condensed font-bold tracking-wide uppercase">
                      {m.equipment_name}
                    </span>
                    {!m.carries_share && (
                      <AlertTriangle size={9} className={on ? "text-white" : "text-[#c8960c]"} />
                    )}
                  </span>
                  <span className={`block text-[9px] font-mono ${
                    on ? "text-white/70" : "text-txt-light"}`}>
                    {m.capacity != null ? `${m.capacity} CuM/hr` : "no capacity"}
                    {" · "}
                    {m.factor != null ? `${m.factor} ${m.unit}/hr` : "—"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Named, never silently dropped: their hours are still in the
              denominator get_lcm() divides the deviation by. */}
          {unattributed.length > 0 && (
            <p className="mt-2 text-[10px] font-mono text-[#8d6e00] flex items-start gap-1">
              <AlertTriangle size={11} className="shrink-0 mt-[1px]" />
              <span>
                {unattributed.map((m) => m.equipment_name).join(", ")}
                {unattributed.length === 1 ? " carries" : " carry"} no share —
                {unattributed.some((m) => m.reason === "no_capacity")
                  ? " no capacity on file in the Equipment Status Selector."
                  : " no loss hours this period, so the share went to the machines that did."}
              </span>
            </p>
          )}

          {/* The selected machine's working, spelled out. */}
          {selMachine && selMachine.carries_share && (
            <p className="mt-2 text-[10px] font-mono text-txt-secondary">
              <span className="font-bold text-navy">{selMachine.equipment_name}</span>
              {" · "}capacity {selMachine.capacity} CuM/hr
              {" = "}{fmt(selMachine.share_pct, 2)}% of the {selMachine.side} side
              {" → "}{f0(selMachine.share)} {selMachine.unit} of the deviation
              {" ÷ "}{fmt(selMachine.hours)} loss hrs
              {" = "}<span className="font-bold text-navy">{selMachine.factor} {selMachine.unit}/hr</span>
              {" · "}breakdown from {selMachine.bd_source}
              {selMachine.hired ? " · hired" : " · own"}
            </p>
          )}
        </div>
      )}

      {/* ── No plan ─────────────────────────────────────────────────── */}
      {noPlan && (
        <div className="px-4 py-8 text-center">
          <Layers size={22} className="mx-auto text-txt-muted mb-2" />
          <p className="text-[12px] text-txt-secondary">
            No excavator is assigned to ore or OB for this period.
          </p>
          <p className="text-[11px] text-txt-muted mt-1">
            The split is entered on the OEE Master Selector, under Equipment
            Excavation Plan. Until it is, there is nothing to divide per machine.
          </p>
        </div>
      )}

      {isError && (
        <div className="px-4 py-6 text-center text-[12px] text-danger">
          The equipment-wise matrix could not be loaded.
        </div>
      )}

      {/* ── Side by side: every machine as its own column pair ───────── */}
      {!noPlan && !isError && sideBySide && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="bg-bg-section border-b border-border">
                <th rowSpan={2} className="px-3 py-2 text-left font-condensed font-bold
                                           text-[10px] tracking-widest uppercase text-navy">Sl.</th>
                <th rowSpan={2} className="px-3 py-2 text-left font-condensed font-bold
                                           text-[10px] tracking-widest uppercase text-navy">Loss Description</th>
                <th rowSpan={2} className="px-3 py-2 text-left font-condensed font-bold
                                           text-[10px] tracking-widest uppercase text-navy">KAM</th>
                <th rowSpan={2} className="px-3 py-2 text-left font-condensed font-bold
                                           text-[10px] tracking-widest uppercase text-navy">Loss Type</th>
                {machines.map((m) => (
                  <th key={m.equipment_name} colSpan={2}
                      className={`px-3 py-1.5 text-center font-condensed font-bold text-[10px]
                                  tracking-widest uppercase border-l border-border ${
                        m.side === "ORE" ? "text-[#1565c0]" : "text-[#2e7d32]"}`}>
                    {m.equipment_name}
                    <span className="block text-[8.5px] font-mono normal-case tracking-normal
                                     text-txt-light">
                      {m.side} · {m.factor != null ? `${m.factor} ${m.unit}/hr` : "no share"}
                    </span>
                  </th>
                ))}
                <th colSpan={2} className="px-3 py-1.5 text-center font-condensed font-bold
                                           text-[10px] tracking-widest uppercase text-navy
                                           border-l-2 border-navy/30">Total</th>
              </tr>
              <tr className="bg-bg-section border-b border-border">
                {machines.map((m) => (
                  <Fragment key={m.equipment_name}>
                    <th className="px-3 py-1.5 text-right font-condensed font-bold text-[9.5px]
                                   tracking-widest uppercase text-txt-secondary border-l border-border">
                      Hour Loss
                    </th>
                    <th className="px-3 py-1.5 text-right font-condensed font-bold text-[9.5px]
                                   tracking-widest uppercase text-txt-secondary">
                      Loss ({m.unit})
                    </th>
                  </Fragment>
                ))}
                <th className="px-3 py-1.5 text-right font-condensed font-bold text-[9.5px]
                               tracking-widest uppercase text-txt-secondary border-l-2 border-navy/30">
                  Ore (MT)
                </th>
                <th className="px-3 py-1.5 text-right font-condensed font-bold text-[9.5px]
                               tracking-widest uppercase text-txt-secondary">
                  OB (CuM)
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border-light">
                      {Array.from({ length: 6 + machines.length * 2 }).map((__, j) => (
                        <td key={j} className="px-3 py-2.5"><Shimmer w="w-12" /></td>
                      ))}
                    </tr>
                  ))
                : rows.map(({ row }) => {
                    const idle = row.ore_hours === 0 && row.ob_hours === 0;
                    return (
                      <tr key={row.column}
                          className={`border-b border-border-light hover:bg-bg-light ${
                            idle ? "text-txt-muted" : ""}`}>
                        <td className="px-3 py-2 text-txt-light">{row.sl_no}</td>
                        <td className={`px-3 py-2 ${idle ? "" : "font-semibold text-navy"}`}>
                          {row.loss_description}
                        </td>
                        <td className="px-3 py-2">{row.kam}</td>
                        <td className="px-3 py-2"><TypePill t={row.loss_type} /></td>
                        {machines.map((m) => {
                          const c = row.machines[m.equipment_name];
                          return (
                            <Fragment key={m.equipment_name}>
                              <td className="px-3 py-2 text-right border-l border-border-light">
                                {fmt(c?.hours)}
                              </td>
                              <td className={`px-3 py-2 text-right ${
                                    idle ? "" : m.side === "ORE"
                                      ? "text-[#1565c0] font-semibold" : "text-[#2e7d32] font-semibold"}`}>
                                {m.side === "ORE" ? fmt(c?.planned_loss, 1) : f0(c?.planned_loss)}
                              </td>
                            </Fragment>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-semibold text-[#1565c0]
                                       border-l-2 border-navy/20">
                          {fmt(row.planned_ore_loss, 1)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-[#2e7d32]">
                          {f0(row.planned_ob_loss)}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
            {!isLoading && (
              <tfoot>
                <tr className="bg-navy text-white font-bold">
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 font-condensed tracking-widest uppercase text-[11px]">
                    Total
                  </td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5" />
                  {machines.map((m) => {
                    const t = data?.machine_totals?.[m.equipment_name];
                    return (
                      <Fragment key={m.equipment_name}>
                        <td className="px-3 py-2.5 text-right border-l border-white/20">
                          {fmt(t?.hours)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {m.side === "ORE" ? fmt(t?.planned_loss, 1) : f0(t?.planned_loss)}
                        </td>
                      </Fragment>
                    );
                  })}
                  <td className="px-3 py-2.5 text-right border-l-2 border-white/30">
                    {fmt(data?.totals.planned_ore_loss, 1)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {f0(data?.totals.planned_ob_loss)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ── One scope at a time: the full matrix, every column ───────── */}
      {!noPlan && !isError && !sideBySide && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="bg-bg-section border-b border-border">
                {["Sl.", "Loss Description", "KAM", "Loss Type"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-condensed font-bold
                                         text-[10px] tracking-widest uppercase text-navy">{h}</th>
                ))}
                <th className="px-3 py-2.5 text-right font-condensed font-bold text-[10px]
                               tracking-widest uppercase text-[#1565c0]">
                  Production<span className="block font-normal normal-case tracking-normal
                                             text-[9px] text-txt-light">Hour Loss</span>
                </th>
                <th className="px-3 py-2.5 text-right font-condensed font-bold text-[10px]
                               tracking-widest uppercase text-[#1565c0]">
                  Planned Ore<span className="block font-normal normal-case tracking-normal
                                              text-[9px] text-txt-light">Loss (MT)</span>
                </th>
                <th className="px-3 py-2.5 text-right font-condensed font-bold text-[10px]
                               tracking-widest uppercase text-[#2e7d32]">
                  OB Production<span className="block font-normal normal-case tracking-normal
                                                text-[9px] text-txt-light">Hour Loss</span>
                </th>
                <th className="px-3 py-2.5 text-right font-condensed font-bold text-[10px]
                               tracking-widest uppercase text-[#2e7d32]">
                  Planned OB<span className="block font-normal normal-case tracking-normal
                                             text-[9px] text-txt-light">Loss (CuM)</span>
                </th>
                <th className="px-3 py-2.5 text-right font-condensed font-bold text-[10px]
                               tracking-widest uppercase text-[#c62828]">
                  Loss Amount<span className="block font-normal normal-case tracking-normal
                                              text-[9px] text-txt-light">(₹ Lakh)</span>
                </th>
                <th className="px-3 py-2.5 text-right font-condensed font-bold text-[10px]
                               tracking-widest uppercase text-navy">
                  Loss<span className="block font-normal normal-case tracking-normal
                                       text-[9px] text-txt-light">Share</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border-light">
                      {Array.from({ length: 10 }).map((__, j) => (
                        <td key={j} className="px-3 py-2.5"><Shimmer w="w-14" /></td>
                      ))}
                    </tr>
                  ))
                : rows.map((x) => {
                    const r: LCMEquipmentRow = x.row;
                    const idle = !(x.oreHours || x.obHours);
                    return (
                      <tr key={r.column}
                          className={`border-b border-border-light hover:bg-bg-light ${
                            idle ? "text-txt-muted" : ""}`}>
                        <td className="px-3 py-2.5 text-txt-light">{r.sl_no}</td>
                        <td className={`px-3 py-2.5 ${idle ? "" : "font-semibold text-navy"}`}>
                          {r.loss_description}
                        </td>
                        <td className="px-3 py-2.5">{r.kam}</td>
                        <td className="px-3 py-2.5"><TypePill t={r.loss_type} /></td>
                        <td className="px-3 py-2.5 text-right">{fmt(x.oreHours)}</td>
                        <td className={`px-3 py-2.5 text-right ${
                          idle ? "" : "text-[#1565c0] font-semibold"}`}>
                          {fmt(x.oreLoss, 1)}
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmt(x.obHours)}</td>
                        <td className={`px-3 py-2.5 text-right ${
                          idle ? "" : "text-[#2e7d32] font-semibold"}`}>
                          {f0(x.obLoss)}
                        </td>
                        <td className={`px-3 py-2.5 text-right ${
                          idle ? "" : "text-[#c62828] font-semibold"}`}>
                          {rate == null ? "—" : rsLakh(x.amount)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {x.share == null ? "—" : `${x.share.toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
            {!isLoading && (
              <tfoot>
                <tr className="bg-navy text-white font-bold">
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 font-condensed tracking-widest uppercase text-[11px]">
                    {sel === ALL ? "Total — all equipment" : `Total — ${sel}`}
                  </td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right">{fmt(totals.oreHours)}</td>
                  <td className="px-3 py-2.5 text-right">{fmt(totals.oreLoss, 1)}</td>
                  <td className="px-3 py-2.5 text-right">{fmt(totals.obHours)}</td>
                  <td className="px-3 py-2.5 text-right">{f0(totals.obLoss)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {rate == null ? "—" : rsLakh(totals.amount)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {totals.share > 0 ? `${totals.share.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ── How to read it ──────────────────────────────────────────── */}
      {!noPlan && !isError && !isLoading && (
        <div className="px-4 py-2.5 border-t border-border-light bg-[#fafbfd]
                        text-[10px] font-mono text-txt-muted leading-relaxed">
          Each machine earns a share of the deviation in the ratio of its ideal
          capacity, then divides that share by its OWN loss hours — so an hour
          lost on a bigger excavator costs more than an hour lost on a smaller
          one. The columns still foot to the same deviation the cards above
          report; only the attribution between heads changes.
          {sel !== ALL && selMachine?.side === "OB" && (
            <> OB is waste rock and carries no IBM rate, so this machine has no
            rupee value — that is a blank, not a zero.</>
          )}
        </div>
      )}
    </div>
  );
}
