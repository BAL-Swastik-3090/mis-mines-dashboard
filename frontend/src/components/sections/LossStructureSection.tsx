"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Network, User, X } from "lucide-react";
import { useLossStructure } from "@/hooks/useLossStructure";
import { formatIndian } from "@/lib/utils";
import type { LossStructureNode } from "@/types";

/**
 * KAM Wise Loss Structure — the mine's own layout, supplied 11 November 2026.
 *
 * Two parts, in the order the workbook sets them out:
 *
 *   SUMMARY    ORE and OB — Plan, Actual, −ve Variance, Value — then the same
 *              variance split across every excavator on the plan.
 *   STRUCTURE  Chief of Mines over SEVEN heads drawn on ONE line, each card
 *              carrying Total / Controllable / Non Controllable in both units
 *              the mine reads: production variance in MT, and its value in
 *              rupees. COB Loss appears on Head COB and the Chief alone.
 *
 * THE SEVEN ARE DRAWN FLAT, AND THAT IS NOT A SIMPLIFICATION. Head Electrical
 * and Head Store report to Head Engineering, Head Security to Head Human
 * Resource — recorded on each card as "reports to". But each node carries
 * ONLY the loss heads assigned to it, so the seven are disjoint and the root
 * is their sum. Nesting three of them while also showing them on the line
 * would count that loss twice and the root would stop matching the matrix.
 *
 * NAMES COME FROM THE KAM SELECTOR, never from this file. A node's owner is
 * the KAM holding most of its loss heads, or an explicit dated override —
 * so moving Illumination problem to Head Electrical gives that card its owner
 * with nothing else to set. A node with no heads yet reads as vacant, which
 * is the truth rather than a guess.
 *
 * PHOTOS ARE NOT WIRED YET. The slot is here and keys on the employee id, so
 * a photo follows the person through a rename; until the mine supplies them
 * each card shows the person's initials.
 */

function f1(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function f2(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function f0(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}

/** Two or three letters from a name, for the slot a photo will fill. */
function initials(name: string | null) {
  if (!name) return "—";
  const parts = name.replace(/^Dr\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function Shimmer({ w = "w-20", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

/**
 * One KAM's own Loss Cost Matrix, in the mine's sheet layout.
 *
 * The card on the line says how much a head lost; this says WHAT LOST IT. The
 * same figures, re-cut — nothing here is computed in the browser beyond the
 * total, so a row can never disagree with the card it opened from.
 *
 * ZEROS ARE PRINTED. The mine's own sheet carries "Not in operation 0.00",
 * and it earns its line: a head this KAM answers for that cost nothing is a
 * result, and hiding it would leave it looking like a head nobody owns.
 *
 * COB IS THE ONE THAT ADDS DIFFERENTLY. Its causes are a small tree — Feed
 * grade and Plant efficiency sit beneath Recovery / yield — so only the top
 * level totals; adding all four would count the pair twice. Its MT is
 * concentrate at the plant, not ore at the face, which is exactly why its
 * card shows a dash, so the modal says so rather than letting the two units
 * sit in one column unremarked.
 */
function LossDetailModal({ node, onClose }: {
  node: LossStructureNode; onClose: () => void;
}) {
  const concentrate = node.loss_heads_unit === "concentrate_mt";
  const rows = node.loss_heads;
  // Totalled here, from the rows on screen, so the foot can never disagree
  // with the lines above it.
  const totalled = rows.filter((h) => (h.level ?? 1) === 1);
  const totMt = totalled.reduce((s, h) => s + (h.variance_mt ?? 0), 0);
  const totRs = totalled.reduce((s, h) => s + (h.value_lacs ?? 0), 0);
  const anyMt = rows.some((h) => h.variance_mt != null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while this is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Loss Cost Matrix for ${node.title}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center
                 bg-navy/40 backdrop-blur-[2px] p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] my-auto bg-white border border-border
                   rounded-lg shadow-2xl overflow-hidden"
      >
        {/* Header — the mine's banner: the matrix, then whose it is. */}
        <div className="px-4 py-3 bg-navy text-white flex items-center gap-3">
          <Face node={node} size={40} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-condensed font-bold tracking-widest
                            uppercase text-white/60">
              Loss Cost Matrix
            </div>
            <div className="font-condensed font-extrabold text-[15px] leading-tight truncate">
              {node.title}
            </div>
            <div className="text-[10px] font-mono text-white/70 truncate">
              {node.owner ?? "— vacant —"}
              {node.parent_role_code ? " · reports upward" : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-white/70 hover:text-white
                       hover:bg-white/10 focus:outline-none focus:ring-2
                       focus:ring-white/40"
          >
            <X size={18} />
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[12px] text-txt-muted">
              No loss head is assigned to {node.title} yet.
            </p>
            <p className="mt-1.5 text-[10.5px] font-mono text-txt-light">
              Assign its heads under <strong>Rolls up to</strong> in the LCM KAM
              Selector and they will be listed here.
            </p>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#f3f1f6]">
                  <th rowSpan={2}
                      className="border border-border px-2 py-1.5 text-[10px]
                                 font-condensed font-bold uppercase tracking-wider
                                 text-navy w-[46px]">SN</th>
                  <th rowSpan={2}
                      className="border border-border px-2 py-1.5 text-left text-[10px]
                                 font-condensed font-bold uppercase tracking-wider
                                 text-navy">Loss Impact</th>
                  <th colSpan={anyMt ? 2 : 1}
                      className="border border-border px-2 py-1 text-[10px]
                                 font-condensed font-bold uppercase tracking-wider
                                 text-navy">Business Plan</th>
                </tr>
                <tr className="bg-[#f6dcdc]">
                  {anyMt && (
                    <th className="border border-border px-2 py-1 text-[10px]
                                   font-condensed font-bold text-navy w-[110px]">
                      Production
                      <div className="font-normal normal-case text-[8.5px] text-txt-light">
                        −Ve Var · {concentrate ? "MT conc." : "MT"}
                      </div>
                    </th>
                  )}
                  <th className="border border-border px-2 py-1 text-[10px]
                                 font-condensed font-bold text-navy w-[110px]">
                    Value
                    <div className="font-normal normal-case text-[8.5px] text-txt-light">
                      −Ve Var · Rs. Lacs
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h, i) => {
                  const nil = !h.variance_mt && !h.value_lacs;
                  const child = (h.level ?? 1) > 1;
                  return (
                    <tr key={`${h.column ?? h.loss_description}-${i}`}
                        className={nil ? "bg-bg-soft/40" : "hover:bg-bg-soft/60"}>
                      <td className="border border-border px-2 py-1 text-center
                                     text-[11px] font-mono text-txt-muted tabular-nums">
                        {child ? "" : i + 1}
                      </td>
                      <td className={`border border-border px-2 py-1 text-[11.5px] ${
                        nil ? "text-txt-muted" : "text-txt-primary"}`}>
                        {/* COB's two sub-causes are indented under their
                            parent rather than listed as peers. */}
                        {child && <span className="text-txt-light">↳ </span>}
                        <span className={child ? "pl-1" : ""}>{h.loss_description}</span>
                        {h.loss_type && (
                          <span className={`ml-1.5 text-[8.5px] font-mono ${
                            h.loss_type === "Controllable"
                              ? "text-[#c0392b]" : "text-txt-light"}`}>
                            {h.loss_type === "Controllable" ? "C" : "NC"}
                          </span>
                        )}
                      </td>
                      {anyMt && (
                        <td className={`border border-border px-2 py-1 text-right
                                        text-[11.5px] font-mono tabular-nums ${
                          nil ? "text-txt-light" : "text-txt-primary"}`}>
                          {f2(h.variance_mt)}
                        </td>
                      )}
                      <td className={`border border-border px-2 py-1 text-right
                                      text-[11.5px] font-mono tabular-nums ${
                        nil ? "text-txt-light" : "text-[#c0392b] font-semibold"}`}>
                        {f2(h.value_lacs)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-[#dce6f1]">
                  <td colSpan={2}
                      className="border border-border px-2 py-1.5 text-center
                                 text-[12px] font-condensed font-extrabold text-navy">
                    Total
                  </td>
                  {anyMt && (
                    <td className="border border-border px-2 py-1.5 text-right
                                   text-[12px] font-mono font-extrabold text-navy
                                   tabular-nums">{f2(totMt)}</td>
                  )}
                  <td className="border border-border px-2 py-1.5 text-right
                                 text-[12px] font-mono font-extrabold text-navy
                                 tabular-nums">{f2(totRs)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-2 bg-bg-soft border-t border-border
                        text-[9.5px] font-mono text-txt-light leading-relaxed">
          {concentrate ? (
            <>
              These are the plant&rsquo;s own causes, from LCM for COB. The MT
              column is <strong>concentrate</strong>, not ore at the face — which
              is why the card shows a dash. Only the top level totals;
              Feed grade and Plant efficiency sit <em>inside</em> Recovery / yield.
            </>
          ) : (
            <>
              Every loss head {node.owner ?? "this node"} answers for, biggest
              first. <strong>C</strong> is controllable, <strong>NC</strong> is not.
              The total is the same figure as the card.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The photo slot. An <img> once the mine supplies them; initials until then. */
function Face({ node, size = 44 }: { node: LossStructureNode; size?: number }) {
  return (
    <div
      className="rounded-full border-2 border-white shadow-sm shrink-0
                 flex items-center justify-center bg-[#eceff1] overflow-hidden"
      style={{ width: size, height: size }}
      title={node.owner ?? "vacant"}
    >
      {node.owner
        ? <span className="font-condensed font-extrabold text-navy tracking-wide"
                style={{ fontSize: size * 0.34 }}>{initials(node.owner)}</span>
        : <User size={size * 0.5} className="text-txt-muted" />}
    </div>
  );
}

/** The 4×2 grid on every card: the rows the mine's template lays out. */
function Measures({ n, dense }: { n: LossStructureNode; dense?: boolean }) {
  const pad = dense ? "py-[3px]" : "py-1";
  const rows: { label: string; mt: number | null; rs: number | null; tone: string }[] = [
    { label: "Total", mt: n.total.variance_mt, rs: n.total.value_lacs,
      tone: "font-bold text-navy" },
    { label: "Contrl", mt: n.controllable.variance_mt, rs: n.controllable.value_lacs,
      tone: "text-[#c62828]" },
    { label: "Non Contrl", mt: n.non_controllable.variance_mt,
      rs: n.non_controllable.value_lacs, tone: "text-[#455a64]" },
  ];
  // Only where the mine put it. On the other five cards the row is absent,
  // not blank — COB loss is a plant figure and has no meaning under them.
  if (n.shows_cob) {
    rows.push({ label: "COB Loss", mt: n.cob.variance_mt, rs: n.cob.value_lacs,
                tone: "text-[#00838f]" });
  }
  // A head nobody has classified would otherwise vanish between the two
  // rows above while still sitting in the total.
  const uncl = n.unclassified.value_lacs;
  if (uncl != null && Math.abs(uncl) > 0.005) {
    rows.splice(3, 0, { label: "Unclassified", mt: n.unclassified.variance_mt,
                        rs: uncl, tone: "text-[#c8960c]" });
  }

  return (
    <table className="w-full text-[11px] font-mono border-collapse">
      <thead>
        <tr className="border-b border-border-light">
          <th />
          <th className="px-1.5 pb-1 text-right font-condensed font-bold text-[8.5px]
                         tracking-widest uppercase text-txt-secondary leading-tight">
            Prod Var<span className="block font-normal normal-case tracking-normal
                                     text-[8px] text-txt-light">MT</span>
          </th>
          <th className="px-1.5 pb-1 text-right font-condensed font-bold text-[8.5px]
                         tracking-widest uppercase text-txt-secondary leading-tight">
            Value Var<span className="block font-normal normal-case tracking-normal
                                      text-[8px] text-txt-light">₹ Lacs</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-border-light last:border-0">
            <td className={`${pad} pr-1.5 text-[10px] whitespace-nowrap ${r.tone}`}>
              {r.label}
            </td>
            <td className={`${pad} px-1.5 text-right tabular-nums ${r.tone}`}>
              {f1(r.mt)}
            </td>
            <td className={`${pad} px-1.5 text-right tabular-nums ${r.tone}`}>
              {f2(r.rs)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LossStructureSection() {
  const { data, isLoading, isError } = useLossStructure();
  /* Held as a role code, not as the node object — the structure refetches
     when the date range or the KAM Selector changes, and an open modal must
     then show the NEW figures rather than the ones it was opened with. */
  const [open, setOpen] = useState<string | null>(null);

  const nodes = data?.nodes ?? [];
  const rec = data?.reconciliation;
  const reconciles = !!rec && rec.mt_matches && rec.value_matches;
  const titleOf = new Map(
    [...(data ? [data.root] : []), ...nodes].map((n) => [n.role_code, n.title]));

  if (isError) {
    return (
      <div className="bg-white border border-border rounded-lg shadow-sm px-4 py-6
                      text-center text-[12px] text-danger">
        The loss structure could not be loaded.
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* ── Summary: ORE / OB, then the same variance per excavator ───── */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center
                        gap-2 flex-wrap">
          <Network size={14} className="text-[#6a1b9a]" />
          <span className="font-condensed font-bold text-[13px] text-navy
                           tracking-widest uppercase">
            KAM Wise Loss Structure
          </span>
          {data && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border
                             bg-[#f3e5f5] text-[#6a1b9a] border-[#ce93d8]
                             tracking-widest uppercase font-mono">
              {nodes.filter((n) => n.role_code !== "UNMAPPED").length} heads
            </span>
          )}
          <span className="ml-auto text-[10px] font-mono text-txt-light">
            production variance is ore only · value at the plan-weighted IBM rate
          </span>
        </div>

        <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border-light">
          {/* ORE / OB */}
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="bg-bg-section border-b border-border">
                  <th className="px-3 py-2 text-left font-condensed font-bold text-[10px]
                                 tracking-widest uppercase text-navy">&nbsp;</th>
                  {["Plan", "Actual", "−ve Var", "Value (₹ Lacs)"].map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-condensed font-bold
                                           text-[10px] tracking-widest uppercase text-navy">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading || !data
                  ? ["ORE", "OB"].map((k) => (
                      <tr key={k} className="border-b border-border-light">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <td key={i} className="px-3 py-2.5"><Shimmer w="w-14" /></td>
                        ))}
                      </tr>
                    ))
                  : (["ore", "ob"] as const).map((k) => {
                      const s = data.summary[k];
                      return (
                        <tr key={k} className="border-b border-border-light last:border-0">
                          <td className="px-3 py-2.5 font-semibold text-navy">
                            {k.toUpperCase()}
                            <span className="ml-1 text-[9px] text-txt-light">{s.unit}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right">{f0(s.plan)}</td>
                          <td className="px-3 py-2.5 text-right">{f0(s.actual)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-[#c62828]">
                            {f1(s.variance)}
                          </td>
                          {/* OB is waste rock with no IBM rate — a dash, never
                              a zero, which would read as "lost nothing". */}
                          <td className="px-3 py-2.5 text-right font-semibold text-[#c62828]">
                            {f2(s.value_lacs)}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>

          {/* Per excavator */}
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="bg-bg-section border-b border-border">
                  <th className="px-3 py-2 text-left font-condensed font-bold text-[10px]
                                 tracking-widest uppercase text-navy">Equipment</th>
                  <th className="px-3 py-2 text-right font-condensed font-bold text-[10px]
                                 tracking-widest uppercase text-navy">−ve Var</th>
                  <th className="px-3 py-2 text-right font-condensed font-bold text-[10px]
                                 tracking-widest uppercase text-navy">Value (₹ Lacs)</th>
                </tr>
              </thead>
              <tbody>
                {isLoading || !data
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-border-light">
                        {Array.from({ length: 3 }).map((__, j) => (
                          <td key={j} className="px-3 py-2.5"><Shimmer w="w-14" /></td>
                        ))}
                      </tr>
                    ))
                  : data.equipment.map((e) => (
                      <tr key={e.equipment_name}
                          className="border-b border-border-light last:border-0">
                        <td className="px-3 py-2.5">
                          <span className={`text-[8px] font-bold tracking-widest uppercase
                                            px-1 rounded mr-1.5 ${
                            e.side === "ORE" ? "bg-[#e3f2fd] text-[#1565c0]"
                                             : "bg-[#e8f5e9] text-[#2e7d32]"}`}>
                            {e.side}
                          </span>
                          <span className="font-semibold text-navy">{e.equipment_name}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {f1(e.variance)}
                          <span className="ml-1 text-[9px] text-txt-light">{e.unit}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-[#c62828]">
                          {f2(e.value_lacs)}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* The check, printed rather than left to be done by hand across
            seven cards. */}
        {!isLoading && rec && (
          <div className={`px-4 py-2 border-t text-[10px] font-mono flex items-center
                           gap-x-5 gap-y-1 flex-wrap ${
            reconciles
              ? "bg-[#f1f8f2] border-[#c8e6c9] text-[#2e7d32]"
              : "bg-[#fff8e1] border-[#ffe082] text-[#8d6e00]"}`}>
            {reconciles ? <CheckCircle2 size={12} className="shrink-0" />
                        : <AlertTriangle size={12} className="shrink-0" />}
            <span className="font-bold tracking-widest uppercase text-[9px]">
              {reconciles ? "The seven heads add to the matrix" : "Does not reconcile"}
            </span>
            <span>Heads {f1(rec.root_mt)} / ore deviation {f1(rec.ore_deviation)} MT</span>
            <span>
              Heads ₹{f2(rec.root_value_lacs)} L / matrix ₹{f2(rec.matrix_value_lacs)} L
              {rec.cob_value_lacs != null && <> + COB ₹{f2(rec.cob_value_lacs)} L</>}
            </span>
          </div>
        )}
      </div>

      {/* ── The structure ─────────────────────────────────────────────── */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        {isLoading || !data ? (
          <div className="px-4 py-10 text-center text-[12px] text-txt-muted">
            Loading the structure…
          </div>
        ) : (
          <div className="p-4">
            {/* Root */}
            <div className="flex justify-center">
              <div role="button"
                   tabIndex={0}
                   aria-haspopup="dialog"
                   title={`Open ${data.root.title}'s loss descriptions`}
                   onClick={() => setOpen(data.root.role_code)}
                   onKeyDown={(e) => {
                     if (e.key === "Enter" || e.key === " ") {
                       e.preventDefault();
                       setOpen(data.root.role_code);
                     }
                   }}
                   className="w-[270px] border-2 border-[#c8960c] rounded-lg
                              bg-[#fffdf5] shadow-sm overflow-hidden cursor-pointer
                              transition hover:shadow-md hover:border-[#b5860b]
                              focus:outline-none focus:ring-2 focus:ring-[#c8960c]/50">
                <div className="px-3 py-2.5 flex items-center gap-2.5
                                border-b border-[#f0e2b8] bg-[#fdf8e8]">
                  <Face node={data.root} size={46} />
                  <div className="min-w-0">
                    {/* The NAME is the card. The mine's template marks the role
                        title "not visible in dashboard" — it is kept as the
                        small line beneath so a reader can still tell which
                        node they are looking at. */}
                    <div className="font-condensed font-extrabold text-[14px]
                                    text-navy leading-tight truncate">
                      {data.root.owner ?? "— vacant —"}
                    </div>
                    <div className="text-[9px] font-mono text-txt-light truncate">
                      {data.root.title} · {data.root.head_count} loss heads
                    </div>
                  </div>
                </div>
                <div className="px-3 py-2"><Measures n={data.root} /></div>
              </div>
            </div>

            {/* The connector: one trunk down, one rail across, a stub per card.
                Drawn rather than nested, because the seven are siblings. */}
            <div className="flex justify-center">
              <div className="w-px h-4 bg-border" />
            </div>
            <div className="border-t border-border mx-8" />

            {/* The seven, on one line */}
            <div className="flex gap-3 overflow-x-auto pt-0 pb-1 -mx-1 px-1">
              {nodes.map((n) => {
                const vacant = !n.owner;
                const empty = n.head_count === 0 && !n.shows_cob;
                return (
                  <div key={n.role_code}
                       className="w-[230px] shrink-0 flex flex-col items-center">
                    <div className="w-px h-4 bg-border" />
                    <div role="button"
                         tabIndex={0}
                         aria-haspopup="dialog"
                         title={`Open ${n.title}'s loss descriptions`}
                         onClick={() => setOpen(n.role_code)}
                         onKeyDown={(e) => {
                           if (e.key === "Enter" || e.key === " ") {
                             e.preventDefault();
                             setOpen(n.role_code);
                           }
                         }}
                         className={`w-full border rounded-lg shadow-sm overflow-hidden
                                     cursor-pointer transition hover:shadow-md
                                     focus:outline-none focus:ring-2 focus:ring-navy/30 ${
                      n.role_code === "UNMAPPED"
                        ? "border-[#ffe082] bg-[#fffdf5] hover:border-[#f0c040]"
                        : empty ? "border-dashed border-border bg-bg-soft hover:border-txt-light"
                                : "border-border bg-white hover:border-navy/40"}`}>
                      <div className="px-2.5 py-2 flex items-center gap-2
                                      border-b border-border-light bg-[#fafbfd]">
                        <Face node={n} size={38} />
                        <div className="min-w-0">
                          <div className={`font-condensed font-bold text-[12.5px]
                                           leading-tight truncate ${
                            vacant ? "text-txt-muted italic" : "text-navy"}`}>
                            {n.owner ?? "— vacant —"}
                          </div>
                          <div className="text-[9px] font-mono text-txt-light truncate">
                            {n.title}
                          </div>
                          <div className="text-[8.5px] font-mono text-txt-light truncate">
                            {n.head_count} head{n.head_count === 1 ? "" : "s"}
                            {/* Recorded, never summed — the card says who the
                                head reports to without implying the figures
                                roll up through it. */}
                            {n.parent_role_code && (
                              <> · reports to {titleOf.get(n.parent_role_code)
                                ?? n.parent_role_code}</>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="px-2.5 py-1.5"><Measures n={n} dense /></div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* A node with nothing in it is a question for the mine, not a
                rendering fault — say so rather than leaving a blank card. */}
            {nodes.some((n) => n.head_count === 0 && !n.shows_cob) && (
              <p className="mt-3 text-[10px] font-mono text-txt-muted
                            flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-[1px] text-[#c8960c]" />
                <span>
                  {nodes.filter((n) => n.head_count === 0 && !n.shows_cob)
                        .map((n) => n.title).join(", ")}
                  {" "}carries no loss head yet, so it shows no owner and no figures.
                  Assign its heads under <strong>Rolls up to</strong> in the LCM KAM
                  Selector and the card fills in — including the name, which follows
                  the KAM holding most of them.
                </span>
              </p>
            )}

            <p className="mt-2 text-[9.5px] font-mono text-txt-light">
              Click any card for that KAM&rsquo;s own loss descriptions.
            </p>
          </div>
        )}
      </div>

      {/* Looked up fresh on every render, so a modal left open across a date
          change or a KAM edit shows the new figures instead of the old. */}
      {open && (() => {
        const n = [...(data ? [data.root] : []), ...nodes]
          .find((x) => x.role_code === open);
        return n ? <LossDetailModal node={n} onClose={() => setOpen(null)} /> : null;
      })()}
    </div>
  );
}
