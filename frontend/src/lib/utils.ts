import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, startOfMonth, endOfMonth } from "date-fns";
import type { FinancialYear, MonthYear } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format number with Indian comma style: 1,00,000 */
export function formatIndian(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format with unit: 3,229 MT */
export function formatWithUnit(n: number | null | undefined, unit: string, decimals = 0): string {
  if (n == null) return "—";
  return `${formatIndian(n, decimals)} ${unit}`;
}

/** Percentage with sign */
export function formatPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

/** YYYY-MM-DD */
export function toApiDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** "19 May 2026" */
export function toDisplayDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return format(date, "d MMM yyyy");
}

/** Get all Financial Years from FY 2020-21 to current+1 */
export function getFinancialYears(): FinancialYear[] {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1-indexed
  const currentFYStart = currentMonth >= 4 ? currentYear : currentYear - 1;

  const years: FinancialYear[] = [];
  for (let startYear = 2020; startYear <= currentFYStart + 1; startYear++) {
    const endYear = startYear + 1;
    years.push({
      label: `FY ${startYear}-${String(endYear).slice(2)}`,
      startYear,
      endYear,
      from: new Date(startYear, 3, 1),     // April 1
      to: new Date(endYear, 2, 31),         // March 31
    });
  }
  return years.reverse(); // latest first
}

/** Current FY */
export function getCurrentFY(): FinancialYear {
  const all = getFinancialYears();
  const now = new Date();
  return (
    all.find((fy) => now >= fy.from && now <= fy.to) ?? all[0]
  );
}

/** Current Month */
export function getCurrentMonth(): MonthYear {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

/** Month range → API dates */
export function monthToRange(m: MonthYear): { from: string; to: string } {
  const d = new Date(m.year, m.month - 1, 1);
  return {
    from: toApiDate(startOfMonth(d)),
    to: toApiDate(endOfMonth(d)),
  };
}

/** Month short label */
export function monthLabel(m: MonthYear): string {
  return format(new Date(m.year, m.month - 1, 1), "MMM yyyy");
}

/** Color class for % vs plan */
export function pctColor(pct: number | null): string {
  if (pct == null) return "text-txt-muted";
  if (pct >= 90) return "text-success";
  if (pct >= 60) return "text-warning";
  return "text-danger";
}

export function pctBgClass(pct: number | null): string {
  if (pct == null) return "pill-blue";
  if (pct >= 90) return "pill-green";
  if (pct >= 60) return "pill-orange";
  return "pill-red";
}
