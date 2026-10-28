"use client";
/**
 * The Costing Summary sheet - phase one, laid out as the department's
 * workbook lays it out: Mines Costing and COB Costing side by side, each
 * with Rs. and Rs./Mt against the tonnes it produced.
 *
 * Both columns render the same list of particulars in the same order, with a
 * dash where a line is nil, so the two sheets read across. Dropping an empty
 * line would misalign the columns and hide the fact that COB carries no
 * excavation charge - which is information, not absence of it.
 */
import { useCostSummary } from "@/hooks/useCosting";
import { formatIndian } from "@/lib/utils";
import type { CostSummaryResponse } from "@/types";

/** The particulars, in the workbook's order. */
const LINES = [
  "Excavation Charges", "Electricity Cost", "Diesel",
  "Cons., Spares & Maintenance", "Labour", "Hire Charges",
  "Sampling & Analysis", "Salary", "Overhead",
] as const;

const BEFORE = "Mining Cost Before Depreciation";
const AFTER = "Mining Cost After Depreciation";
const TOTAL_CONC = "Total Cost of Concentrate";

export default function CostSheet({ period, asOf }: { period: string; asOf?: string }) {
  const mines = useCostSummary(period, "MINES", asOf);
  const cob = useCostSummary(period, "COB", asOf);

  if (mines.isLoading || cob.isLoading) {
    return <div className="bg-white border border-[#d0d9e8] rounded h-[520px] animate-pulse" />;
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Sheet
        title="Mines Costing"
        qtyLabel="Ore Production (MT)"
        tailLine="Overburden"
        data={mines.data}
      />
      <Sheet
        title="COB Costing"
        qtyLabel="COB Production (MT)"
        tailLine="Others"
        data={cob.data}
        extraTail
      />
    </div>
  );
}

function Sheet({
  title, qtyLabel, tailLine, data, extraTail = false,
}: {
  title: string;
  qtyLabel: string;
  tailLine: string;
  data: CostSummaryResponse | undefined;
  extraTail?: boolean;
}) {
  const by = new Map((data?.lines ?? []).map((l) => [l.line, l]));
  const particulars = [...LINES, tailLine];
  const anyAccrued = (data?.lines ?? []).some((l) => l.is_accrued);

  return (
    <div className="bg-white border border-[#d0d9e8] rounded shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#d0d9e8] bg-navy">
        <span className="font-condensed text-[13px] font-bold tracking-[.12em] uppercase text-white">
          {title}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[420px]">
          <thead>
            <tr className="bg-[#eaf3fb] border-b border-[#d0d9e8]">
              <Th className="text-left pl-4 w-[46%]">Particulars</Th>
              <Th className="text-center" colSpan={2}>As per Accounts</Th>
            </tr>
            <tr className="border-b border-[#d0d9e8] bg-[#f6eef7]">
              <td className="py-1.5 pl-4 font-semibold text-txt-secondary">{qtyLabel}</td>
              <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-txt-primary" colSpan={2}>
                {data ? formatIndian(data.production_mt, 0) : "—"}
              </td>
            </tr>
            <tr className="border-b border-[#d0d9e8] bg-[#eaf3fb] text-txt-secondary">
              <Th className="text-left pl-4">Particulars</Th>
              <Th className="text-right">Rs.</Th>
              <Th className="text-right pr-4">Rs./Mt</Th>
            </tr>
          </thead>

          <tbody>
            {particulars.map((name) => (
              <Line key={name} name={name} row={by.get(name)} />
            ))}

            <Line name={BEFORE} row={by.get(BEFORE)} total />
            <Line name="Depreciation" row={by.get("Depreciation")} />
            <Line name={AFTER} row={by.get(AFTER)} total />

            {extraTail && (
              <>
                <Line name="Feed Cost" row={by.get("Feed Cost")} />
                <Line name="Total Cost of Conc." row={by.get(TOTAL_CONC)} total />
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* A month-end cost that has not posted yet is an estimate. Printed
          plain it reads as a payment, so the lines carrying one say so and
          the arithmetic behind them is stated rather than assumed. */}
      {anyAccrued && data && (
        <div className="px-4 py-2 border-t border-[#d0d9e8] bg-[#fff8e6] text-[11px] text-txt-secondary">
          <span className="text-gold-dark font-bold">†</span>{" "}
          accrued, not yet posted: plan ÷ {data.days_in_month} days
          × {data.days_elapsed} days elapsed
          {" "}({(data.accrual_factor * 100).toFixed(1)}% of the month)
        </div>
      )}
    </div>
  );
}

function Line({
  name, row, total = false,
}: {
  name: string;
  row?: { actual: number; rs_per_mt: number | null; is_accrued?: boolean };
  total?: boolean;
}) {
  // A nil line is a dash, as on the sheet - not a zero, which reads as a
  // measured quantity, and not a missing row, which breaks the alignment
  // between the two columns.
  const amount = row && row.actual !== 0 ? formatIndian(row.actual) : "-";
  const rate = row && row.rs_per_mt ? formatIndian(row.rs_per_mt, 0) : "-";

  return (
    <tr className={[
      "border-b border-[#eef2f8]",
      total ? "bg-[#fdeadb] font-bold text-txt-primary" : "text-txt-secondary",
    ].join(" ")}>
      <td className="py-1.5 pl-4">
        {name}
        {row?.is_accrued ? (
          <span className="text-gold-dark font-bold" title="Accrued from plan - not yet posted">
            {" "}†
          </span>
        ) : null}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{amount}</td>
      <td className="py-1.5 pr-4 text-right font-mono tabular-nums">{rate}</td>
    </tr>
  );
}

function Th({
  children, className = "", colSpan,
}: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <th colSpan={colSpan}
      className={`py-2 font-condensed text-[11px] font-bold tracking-wider uppercase ${className}`}>
      {children}
    </th>
  );
}
