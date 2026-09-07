"use client";
/**
 * KAM Wise Loss Tree — production loss by accountability head.
 *
 * Chief of Mines sits at the root holding the whole period of loss, split
 * Controllable / Non-Controllable, and that total is segregated under the three
 * heads beneath: Mines Operation, Engineering, Human Resource.
 *
 * The numbers come from the SAME get_lcm() computation as the LCM table above,
 * re-cut by head on the server, so this section and that table can never
 * disagree. The root is the sum of its children by construction; what is worth
 * checking is the tree against the LCM total, and the backend reports that as
 * `reconciles` rather than leaving the reader to trust it.
 *
 * Measured in RUPEES, per the mine's choice. Amounts go null together when an
 * IBM rate is missing — rendered as a dash, never as 0, which would read as
 * "no loss" rather than "not costed".
 *
 * Connectors are CSS borders rather than an image or a chart library: three
 * fixed nodes need no layout engine, and borders stay sharp at any zoom.
 */
import { GitFork, AlertTriangle } from "lucide-react";
import { useKamLossTree } from "@/hooks/useKamLossTree";
import type { KamLossNode } from "@/types";

/** Rupees to crore. The LCM table leads in crore and these are the same rupees,
 *  so the two read on one scale. */
function cr(v: number | null | undefined) {
  if (v == null) return "—";
  return (v / 1e7).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const CTRL_COLOR = "#c62828"; // controllable — the mine can act on it
const NONC_COLOR = "#6b7ea8"; // non-controllable — it cannot

function NodeCard({ node, root = false }: { node: KamLossNode; root?: boolean }) {
  const unclassified = node.unclassified ?? 0;
  return (
    <div
      className={`bg-white border rounded-lg overflow-hidden shadow-sm
                  ${root ? "border-[#c8960c] border-[1.5px]" : "border-border"}`}
    >
      <div
        className={`px-3 py-2 border-b flex flex-col gap-0.5
                    ${root ? "bg-[#fff8e1] border-[#ffe082]" : "bg-bg-section border-border-light"}`}
      >
        <span className="font-condensed font-bold text-[12px] text-navy tracking-wider uppercase leading-tight">
          {node.title}
        </span>
        <span className="font-mono text-[9.5px] text-txt-muted leading-tight">
          {node.owner}
          {node.head_count > 0 && (
            <> · {node.head_count} loss head{node.head_count === 1 ? "" : "s"}</>
          )}
        </span>
      </div>

      <table className="w-full text-[11.5px] font-mono">
        <tbody className="divide-y divide-border-light/60">
          <tr>
            <td className="px-3 py-1.5 whitespace-nowrap">
              <span
                className="inline-block h-2 w-2 rounded-sm mr-1.5 translate-y-[-1px]"
                style={{ background: CTRL_COLOR }}
              />
              <span className="text-txt-secondary">Controllable Loss</span>
            </td>
            <td
              className="px-3 py-1.5 text-right tabular-nums font-semibold"
              style={{ color: CTRL_COLOR }}
            >
              {cr(node.controllable)}
            </td>
          </tr>
          <tr>
            <td className="px-3 py-1.5 whitespace-nowrap">
              <span
                className="inline-block h-2 w-2 rounded-sm mr-1.5 translate-y-[-1px]"
                style={{ background: NONC_COLOR }}
              />
              <span className="text-txt-secondary">Non-Controllable Loss</span>
            </td>
            <td
              className="px-3 py-1.5 text-right tabular-nums font-semibold"
              style={{ color: NONC_COLOR }}
            >
              {cr(node.non_controllable)}
            </td>
          </tr>
          {/* Only when non-zero. A head nobody has classified must not be
              quietly folded into either bucket — same rule the LCM table uses. */}
          {unclassified > 0 && (
            <tr>
              <td className="px-3 py-1.5 text-txt-muted whitespace-nowrap">Unclassified</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-txt-muted">
                {cr(node.unclassified)}
              </td>
            </tr>
          )}
          <tr className={root ? "bg-[#fff8e1]/50" : "bg-bg-light/50"}>
            <td className="px-3 py-1.5 font-condensed font-bold text-[11px] tracking-wider uppercase text-navy">
              Total
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums font-bold text-navy">
              {cr(node.total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function KamLossTreeSection() {
  const { data, isLoading, isError, error } = useKamLossTree();

  if (isError) {
    return (
      <div className="bg-white border border-border rounded-lg shadow-sm p-4 flex items-center gap-3">
        <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
        <span className="text-[12px] text-[#c62828]">
          {error instanceof Error ? error.message : "Failed to load KAM wise loss tree"}
        </span>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="bg-white border border-border rounded-lg shadow-sm p-4">
        <div className="h-[280px] bg-bg-section animate-pulse rounded" />
      </div>
    );
  }
  if (!data) return null;

  const { root, children } = data;
  const n = children.length;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2 flex-wrap">
        <GitFork size={14} className="text-[#c8960c] shrink-0" />
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          KAM Wise Loss Tree
        </span>
        <span className="ml-auto text-[10px] font-mono text-txt-muted">
          <span className="font-bold text-navy text-[13px]">{cr(root.total)}</span> Cr total loss
          <span className="ml-1.5">· ₹ basis</span>
        </span>
      </div>

      <div className="p-4 overflow-x-auto">
        <div className="min-w-[720px] flex flex-col items-center">
          {/* Root */}
          <div className="w-[300px]">
            <NodeCard node={root} root />
          </div>

          {/* Trunk down from the root */}
          <div className="h-6 w-px bg-border" />

          {/* Horizontal bus. Inset by half a column each side so it spans centre
              to centre of the outer children rather than overhanging them. */}
          <div className="w-full flex" style={{ height: 1 }}>
            <div style={{ width: `${100 / (n * 2)}%` }} />
            <div className="flex-1 bg-border" />
            <div style={{ width: `${100 / (n * 2)}%` }} />
          </div>

          {/* Drop lines, one per child, centred on its column */}
          <div className="w-full flex">
            {children.map((c) => (
              <div key={c.role} className="flex-1 flex justify-center">
                <div className="h-6 w-px bg-border" />
              </div>
            ))}
          </div>

          {/* Children */}
          <div className="w-full flex items-start gap-4">
            {children.map((c) => (
              <div key={c.role} className="flex-1 min-w-[220px]">
                <NodeCard node={c} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reconciliation. Stated, not assumed — and loud if it ever breaks. */}
      {!data.reconciles && (
        <div className="px-3 py-2 border-t border-border-light bg-[#fdecea] flex items-start gap-2">
          <AlertTriangle size={14} className="text-[#c62828] shrink-0 mt-[1px]" />
          <p className="text-[10.5px] font-mono text-[#c62828] leading-tight">
            Tree total {cr(root.total)} Cr does not match the LCM total{" "}
            {cr(data.lcm_total_loss_amount)} Cr. A loss head is unmapped or double-counted.
          </p>
        </div>
      )}

      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 space-y-0.5">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">DERIVED · </span>
          same LCM computation as the table above, re-cut by accountability head
        </p>
        <p className="text-[9px] font-mono text-txt-muted leading-tight">
          Figures are ₹ crore of production loss over the selected period. Chief of Mines is the
          sum of the heads below it, and the tree is checked against the LCM total
          {data.reconciles ? " — it reconciles" : ""}. Controllability and ownership are business
          classifications with no home in the database; they are mapped per loss head in code.
        </p>
      </div>
    </div>
  );
}
