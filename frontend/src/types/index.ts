// ── Date Filter ───────────────────────────────────────────────
export type FilterMode = "date" | "month" | "fy";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface MonthYear {
  month: number; // 1–12
  year: number;
}

export interface FinancialYear {
  label: string;     // "FY 2025-26"
  startYear: number; // 2025 (April 2025)
  endYear: number;   // 2026 (March 2026)
  from: Date;        // 01-Apr-2025
  to: Date;          // 31-Mar-2026
}

export interface DateFilterState {
  mode: FilterMode;
  // Date mode
  dateRange: DateRange;
  // Month mode
  selectedMonth: MonthYear;
  // FY mode
  selectedFY: FinancialYear;
  // Computed — always available, used by APIs
  apiFrom: string; // "YYYY-MM-DD"
  apiTo: string;   // "YYYY-MM-DD"
}

// ── API Common ────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T;
  status: string;
  message?: string;
}

// ── KPI Types ─────────────────────────────────────────────────
export interface KpiValue {
  today: number | null;
  today_plan: number | null;
  mtd: number | null;
  mtd_plan: number | null;
  unit: string;
  pct_vs_plan: number | null;
}

// ── Stock ─────────────────────────────────────────────────────
export interface AllLocationsAPI {
  mines_total: number;   // Mines (PLANT=1200) + COB at CST1
  bal_plant:   number;   // BAL Plant (PLANT=1100)
  suk_plant:   number;   // SUK Plant (PLANT=1110)
  grand_total: number;   // mines + BAL + SUK
}

export interface StockLocationAPI {
  store_loc:      string;
  store_loc_desc: string;
  stock:          number;
  value:          number | null;
}

export interface StockGradeAPI {
  grade_key:   string;   // "HG" | "MG" | "LG" | "LUMP_H" | "LUMP_L"
  grade_label: string;   // "High Grade >52%"
  total_stock: number;
  total_value: number | null;
  locations:   StockLocationAPI[];
}

export interface StockPositionResponse {
  items:         StockGradeAPI[];
  grand_total:   number;
  by_location:   StockLocationAPI[];
  all_locations: AllLocationsAPI;
  note:          string;
}

// ── Production ───────────────────────────────────────────────
export interface DayWiseRow {
  date: string;
  ore_target: number | null;
  ore_actual: number | null;
  cob_target: number | null;
  cob_actual: number | null;
  despatch_target: number | null;
  despatch_actual: number | null;
  ob_target: number | null;
  ob_actual: number | null;
  silt_actual: number | null;
  closing_water_level: number | null;
  closing_stock: number | null;
}

// ── Equipment ────────────────────────────────────────────────
export interface ExcavatorRow {
  machine_id: string;
  eng_hours_mtd: number;
  breakdown_hours: number;
  availability_pct: number;
  utilization_pct: number;
  status: "Running" | "Long Breakdown" | "Maintenance";
}

// ── Production API Responses ─────────────────────────────────
export interface ProductionKpiCard {
  today_actual: number | null;
  today_plan:   number | null;
  today_pct:    number | null;
  mtd_actual:   number | null;
  mtd_plan:     number | null;
  mtd_pct:      number | null;
  unit:         string;
}

export interface ProductionSummaryResponse {
  as_on:     string;
  from_date: string;
  to_date:   string;
  ore:       ProductionKpiCard;
  ob:        ProductionKpiCard;
  cob:       ProductionKpiCard;
  de_silt:   ProductionKpiCard;
}

export interface ProductionDayRowAPI {
  date:        string;
  ore_actual:  number | null;
  ore_plan:    number | null;
  ore_hg:      number | null;
  ore_mg:      number | null;
  ore_lg:      number | null;
  ob_actual:   number | null;
  ob_plan:     number | null;
  cob_actual:  number | null;
  cob_plan:    number | null;
  silt_actual: number | null;
  silt_plan:   number | null;
}

export interface ProductionDaywiseResponse {
  from_date:      string;
  to_date:        string;
  rows:           ProductionDayRowAPI[];
  mtd_ore_actual: number;
  mtd_ore_plan:   number;
  mtd_ob_actual:  number;
  mtd_ob_plan:    number;
  mtd_cob_actual: number;
  mtd_cob_plan:   number;
  mtd_hg:         number;
  mtd_mg:         number;
  mtd_lg:         number;
}

export interface GradeDayRowAPI {
  date:       string;
  hg_actual:  number | null;
  mg_actual:  number | null;
  lg_actual:  number | null;
  hg_plan:    number | null;
  mg_plan:    number | null;
  lg_plan:    number | null;
  total:      number | null;
}

export interface GradeBreakdownResponse {
  from_date:  string;
  to_date:    string;
  rows:       GradeDayRowAPI[];
  mtd_hg:     number;
  mtd_mg:     number;
  mtd_lg:     number;
  mtd_total:  number;
}

// ── Plant Performance (FeCr) ──────────────────────────────────
export interface PlantUnitAPI {
  total:     number;
  per_day:   number;
  share_pct: number;
}

export interface PlantPerformanceResponse {
  from_date:        string;
  to_date:          string;
  days:             number;
  combined_total:   number;
  combined_per_day: number;
  bal:              PlantUnitAPI;
  suk:              PlantUnitAPI;
}

// ── OB Excavation ─────────────────────────────────────────────
export interface ObDayRowAPI {
  date:       string;
  bal_actual: number | null;
  ob_plan:    number | null;
}

export interface ObVendorDayRowAPI {
  date:   string;
  actual: number | null;
}

export interface ObVendorDataAPI {
  agency_id:   string;
  agency_desc: string;   // e.g. "DASHMESH", "DVS", "ATWA"
  rows:        ObVendorDayRowAPI[];
  mtd_actual:  number;
}

export interface ObSummaryResponse {
  from_date:      string;
  to_date:        string;
  rows:           ObDayRowAPI[];
  mtd_bal_actual: number;
  mtd_ob_plan:    number;
  mtd_bal_pct:    number | null;
  vendors:        ObVendorDataAPI[];
  vendor_names:   string[];
}

// ── COB Plant Analysis ────────────────────────────────────────
export interface CobDayRowAPI {
  date:              string;
  feed_actual:       number | null;
  cob_actual:        number | null;
  tailings_actual:   number | null;
  yield_pct:         number | null;
  io_ratio:          number | null;
  input_cr2o3:       number | null;
  output_cr2o3:      number | null;
  tailings_cr2o3:    number | null;
  feed_plan:         number | null;
  cob_plan:          number | null;
  tailings_plan:     number | null;
  yield_plan:        number | null;
  running_hr_plan:   number | null;
  input_cr2o3_plan:  number | null;
  output_cr2o3_plan: number | null;
}

export interface CobSummaryResponse {
  from_date:           string;
  to_date:             string;
  rows:                CobDayRowAPI[];
  mtd_feed_actual:     number;
  mtd_feed_plan:       number;
  mtd_cob_actual:      number;
  mtd_cob_plan:        number;
  mtd_tailings_actual: number;
  mtd_tailings_plan:   number;
  mtd_yield_pct:       number | null;
  mtd_yield_plan:      number | null;
  mtd_io_ratio:        number | null;
  avg_input_cr2o3:     number | null;
  avg_output_cr2o3:    number | null;
  avg_tailings_cr2o3:  number | null;
}

export interface TipperRow {
  vehicle_id: string;
  eng_hours_mtd: number;
  breakdown_hours: number;
  availability_pct: number;
  utilization_pct: number;
  status: string;
  fuel_lph?: number;
  kmpl?: number;
}
