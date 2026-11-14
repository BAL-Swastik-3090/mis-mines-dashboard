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

// ── Stock (mines_stock_entry — dashboard entry) ───────────────
export interface StockGradeRow {
  grade_key:   "HG" | "MG" | "LG" | "COB";
  grade_label: string;
  mines:       number;   // Section B, that grade's column across the 4 statuses
}

export interface StockStatusRow {
  label: string;
  qty:   number;
}

export interface StockLocations {
  mines:      number;
  bal_plant:  number;
  suk_plant:  number;
  lg_for_cob: number;
  total:      number;
}

/** One row of the Mines Clearance Status table: a status, read across grades. */
export interface StockClearanceRow {
  key:      string;
  /** "1", "2", "3", "3(a)" — a sub-row takes its PARENT's number with a letter
   *  rather than one of its own, so the numbering carries the structure. */
  sl_no:    string;
  label:    string;
  uom:      string;
  by_grade: Record<string, number>;
  total:    number;
  is_total: boolean;
  /** Rows 8A and 8B — a breakdown of the row above, not a position of their
   *  own. Indented, and never added to anything: their tonnage is already
   *  counted inside Awaiting Permission. */
  is_child?: boolean;
}

/** One row of the Location wise & Grade wise table: a grade, read across locations. */
export interface StockLocationRow {
  key:      string;
  label:    string;
  uom:      string;
  cells:    Record<string, number>;
  total:    number;
  is_total: boolean;
}

/** The day's proposed despatch, split by plant. total = SKD + BLS. */
export interface ProposedDespatch {
  total:          number;
  by_destination: Record<string, number>;
  labels:         Record<string, string>;
  has_data:       boolean;
}

export interface StockPositionResponse {
  snapshot_date:  string | null;
  requested_date: string | null;
  days_stale:     number | null;
  is_stale:       boolean;
  has_data:       boolean;
  total_stock:       number;   // also the Mines location figure
  grades:    StockGradeRow[];
  statuses:  StockStatusRow[];
  locations: StockLocations;
  /** The two tables shown side by side — one grid read along two axes. */
  clearance:     { grades: { key: string; label: string }[];
                   rows: StockClearanceRow[] };
  location_grid: { columns: { key: string; label: string }[];
                   rows: StockLocationRow[] };
  proposed_despatch: ProposedDespatch;
  /** When this snapshot was last CHANGED, and by whom — not first filed. */
  updated_at: string | null;
  updated_by: string | null;
}

// ── Mines Executive Summary ───────────────────────────────────
/** One grade line. Every figure is nullable and none defaults to zero: a blank
 *  Cr/Fe means SAP posts no such characteristic on production entry, where a
 *  zero would claim the ore assayed nought. */
/** Where a tonnage came from. 'manual' is the mine's own figure standing in
 *  for a day SAP has not posted; 'mixed' is a total containing both. Distinct
 *  from estimated_qty, which is about a borrowed ASSAY, not a tonnage. */
export type ExecSource = "sap" | "manual" | "mixed";

export interface ExecGradeRow {
  grade: string;
  label: string;
  qty:   number | null;
  cr2o3: number | null;
  crfe:  number | null;
  /** Despatch rows only. When a consignment has no assay of its own, the PO's
   *  average stands in: this is the share of the row's GRADED tonnage that came
   *  that way, and estimated_qty the tonnage itself. null means every tonne
   *  shown was tested. The share's denominator is graded tonnage, not total, so
   *  the two cannot be derived from one another. */
  estimated_pct?: number | null;
  estimated_qty?: number | null;
  /** Planned tonnage for this grade and actual against it. Production rows
   *  only — despatch plans against a different table and does not use these. */
  plan?:    number | null;
  ach_pct?: number | null;
  /** Where the TONNAGE came from — a different question from the assay above. */
  source?: ExecSource;
  /** Of `qty`, how much is the mine's hand-entered figure standing in for days
   *  SAP has not posted. null when every tonne came from SAP. */
  manual_qty?: number | null;
  /** How many days of the window that manual figure covers. */
  est_days?: number | null;
}

/** The sheet's Weighted Average row: SUMPRODUCT / SUM, never a mean. */
export interface ExecWeightedTotal {
  qty:   number | null;
  cr2o3: number | null;
  crfe:  number | null;
  cr:    number | null;
  estimated_pct?: number | null;
  estimated_qty?: number | null;
  plan?:    number | null;
  ach_pct?: number | null;
  source?: ExecSource;
  manual_qty?: number | null;
}

export interface ExecPlantRow {
  plant: string;
  qty:   number | null;
  cr:    number | null;
  cr_covered_pct: number | null;
}

/** One column of the report — TD or MTD. Despatch is keyed by CUSTOMERNO. */
/** Overburden or De-Silting, plan against actual, in CuM.
 *  `no_plan` marks a blank the screen can explain instead of printing a bare
 *  dash, for two different reasons depending on the row: de-silting has no
 *  plan table anywhere (permanent), while overburden simply has no plan
 *  entered for this month yet (someone can fix it). */
export interface ExecExcavationRow {
  key:     "ob" | "desilt";
  label:   string;
  unit:    string;
  plan:    number | null;
  actual:  number | null;
  pct:     number | null;
  no_plan: boolean;
  source?: ExecSource;
  manual_qty?: number | null;
}

export interface ExecPeriodBlock {
  /** HG, MG and LG only. COB is concentrate out of plant 1210 rather than ore
   *  raised at the mine, so it carries its own block and its own total and the
   *  two are never averaged together. */
  production:       ExecGradeRow[];
  production_total: ExecWeightedTotal;
  cob:              ExecGradeRow[];
  cob_total:        ExecWeightedTotal;
  despatch:         Record<string, ExecGradeRow[]>;
  despatch_total:   Record<string, ExecWeightedTotal>;
  plant:            ExecPlantRow[];
  plant_total:      ExecWeightedTotal;
  excavation:       ExecExcavationRow[];
}

/** One measure of the dewatering block, for one period. */
export interface ExecDewateringLine {
  key:    "disposal" | "pump_hr" | "inflow" | "stock";
  label:  string;
  uom:    string;
  dp:     number;
  plan:   number | null;
  actual: number | null;
  pct:    number | null;
  /** No plan exists for this measure and none ever will — inflow is seepage
   *  and weather. Different from a plan nobody has filed yet. */
  no_plan: boolean;
  /** Beating this plan means coming in BELOW it — closing stock is the one
   *  such measure. `pct` is then the signed VARIANCE against plan, not an
   *  achievement, and below plan is the good direction. */
  inverse: boolean;
  /** M³ the plan asked for that was never in the sump. Non-zero only on
   *  closing stock, and only where the plan out-ran the water that arrived —
   *  the plan figure beside it is then a floor (an empty sump), not a
   *  forecast, and `pct` is suppressed because the comparison is meaningless.
   *  0 in a period the plan fitted. */
  overdraw: number;
}

export interface ExecDewateringPeriod {
  rows: ExecDewateringLine[];
  date?: string | null;        // the day column
  entered?: boolean | null;    // was that day filed at all
  from?: string | null;
  to?:   string | null;
}

export interface ExecDewateringKpi {
  disposal_actual:  number | null;
  disposal_plan:    number | null;
  disposal_pct:     number | null;
  pump_actual_hr:   number | null;
  pump_plan_hr:     number | null;
  pump_pct:         number | null;
  avg_pump_hr:      number | null;
  avg_plan_hr:      number | null;
  /** Hours a day the pumps must run merely to match the water arriving. */
  offset_hr:        number | null;
  opening_stock:    number | null;
  closing_stock:    number | null;
  /** Where the plan would have left the sump — chained day by day against
   *  the water that really arrived, and floored at empty, because a sump
   *  holds no negative water. */
  plan_closing_stock: number | null;
  /** Total M³ the plan asked for beyond what was ever there. 0 when the plan
   *  fitted the inflow. */
  plan_overdraw: number;
  /** The first day the plan would have emptied the sump, null if it never
   *  would have. From here on the plan was pumping water that did not exist. */
  plan_dry_from: string | null;
  /** How many days in the period that was true of. */
  plan_dry_days: number;
  stock_change_pct: number | null;
  net_drawdown:     number | null;
  days_to_clear:    number | null;
  completeness_pct: number | null;
}

/** Dewatering, on its own window. THE DAYS ENTERED ARE NOT THE DAYS ASKED
 *  FOR: `entered` of `window_days` carry figures, every total here covers
 *  those days only, and gap_from..gap_to names the stretch that does not. */
export interface ExecDewateringBlock {
  available:   boolean;
  entered:     number;
  window_days: number;
  data_to:     string | null;
  gap_from:    string | null;
  gap_to:      string | null;
  td:   ExecDewateringPeriod | null;
  mtd:  ExecDewateringPeriod | null;
  kpi:  ExecDewateringKpi | null;
  /** How complete the data is, not how well the mine pumped. */
  status: "ok" | "watch" | "critical";
}

export interface ExecutiveSummaryResponse {
  /** Two as-on dates, a day apart on purpose: stock is counted at the start of
   *  a day, performance is a completed day. */
  report_day:  string;
  stock_as_on: string;
  mtd_from:    string;
  stock: StockPositionResponse;
  td:    ExecPeriodBlock;
  mtd:   ExecPeriodBlock;
  /** null means the platform database could not be read — not that nothing
   *  was pumped. */
  dewatering?: ExecDewateringBlock | null;
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
  hg_actual?:   number | null;
  mg_actual?:   number | null;
  lg_actual?:   number | null;
  hg_plan?:     number | null;
  mg_plan?:     number | null;
  lg_plan?:     number | null;
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

export interface RehandlingDaywiseRow {
  date:     string;
  total_m3: number | null;
}

export interface RehandlingDaywiseResponse {
  from_date:  string;
  to_date:    string;
  rows:       RehandlingDaywiseRow[];
  mtd_total:  number;
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

// ── Equipment Utilization ─────────────────────────────────────
export interface ExcavatorMachineRowAPI {
  vehicle_desc:   string;
  display_name:   string;
  sap_name:       string;
  eng_hr_mtd:     number;
  bd_hr:          number;
  bd_count:       number;
  bd_count_start: number;
  avail_pct:      number | null;
  util_pct:       number | null;
  mttr:           number | null;
  mtbf:           number | null;
  /** False when the Technoton unit gave no running-hours reading for this
   *  period. The row then shows "no signal" instead of a measured-looking 0.00
   *  and a 100% availability nobody measured. */
  sensor_ok:        boolean;
  sensor_last_seen: string | null;
}
export interface ExcavatorSummaryResponse {
  from_date:       string;
  to_date:         string;
  machines:        ExcavatorMachineRowAPI[];
  total_eng_hr:    number;
  total_bd_hr:     number;
  active_count:    number;
  total_count:     number;
  total_bd_count:  number;
  fleet_mttr:      number | null;
  fleet_mtbf:      number | null;
}
export interface ExcavatorFuelRowAPI {
  vehicle_desc: string;
  eng_hr_mtd:   number;
  fuel_mtd:     number;
  lph_avg:      number | null;
}
export interface ExcavatorFuelResponse {
  from_date:   string;
  to_date:     string;
  machines:    ExcavatorFuelRowAPI[];
  avg_lph:     number | null;
  fleet_count: number;
  oem_lph:     number;
  total_fuel:  number;
}
export interface ExcavatorTrendResponse {
  from_date:     string;
  to_date:       string;
  machine_names: string[];
  dates:         string[];
  series:        Record<string, (number | null)[]>;
}
export interface TipperMachineRowAPI {
  vehicle_desc:   string;
  sap_name:       string;
  eng_hr_mtd:     number;
  bd_hr:          number;
  bd_count:       number;
  bd_count_start: number;
  avail_pct:      number | null;
  util_pct:       number | null;
  mttr:           number | null;
  mtbf:           number | null;
  /** False when the Technoton unit gave no running-hours reading for this
   *  period. Nine of the twenty-eight tippers are in that state. */
  sensor_ok:        boolean;
  sensor_last_seen: string | null;
}

export interface BreakdownEvent {
  notification_no: string;
  start:   string | null;
  end:     string | null;
  bd_hrs:  number | null;
  /** Still open — bd_hrs is counted to now and keeps growing. */
  is_open?: boolean;
  reason:  string | null;
}

export interface BreakdownDetailsResponse {
  machine:    string;
  from_date:  string;
  to_date:    string;
  events:     BreakdownEvent[];
}
export interface TipperSummaryResponse {
  from_date:       string;
  to_date:         string;
  machines:        TipperMachineRowAPI[];
  total_eng_hr:    number;
  total_bd_hr:     number;
  active_count:    number;
  total_count:     number;
  total_bd_count:  number;
  fleet_mttr:      number | null;
  fleet_mtbf:      number | null;
}
export interface TipperFuelRowAPI {
  vehicle_desc: string;
  eng_hr_mtd:   number;
  fuel_mtd:     number;
  dist_mtd:     number;
  lph_avg:      number | null;
  kmpl_avg:     number | null;
}
export interface TipperFuelResponse {
  from_date:   string;
  to_date:     string;
  machines:    TipperFuelRowAPI[];
  avg_lph:     number | null;
  avg_kmpl:    number | null;
  fleet_count: number;
  oem_lph:     number;
}

// ── Despatch ──────────────────────────────────────────────────
export interface DespatchDayRowAPI {
  date:           string;
  total_plan:     number;
  bal_plan:       number;
  suk_plan:       number;
  total_actual:   number | null;
  bal_actual:     number | null;
  suk_actual:     number | null;
  unsynced_count: number;
}

export interface DespatchSummaryResponse {
  from_date:          string;
  to_date:            string;
  mtd_total_plan:     number;
  mtd_bal_plan:       number;
  mtd_suk_plan:       number;
  td_total_plan:      number | null;
  td_bal_plan:        number | null;
  td_suk_plan:        number | null;
  mtd_total_actual:   number | null;
  mtd_bal_actual:     number | null;
  mtd_suk_actual:     number | null;
  mtd_unsynced_count: number;
  td_total_actual:    number | null;
  td_bal_actual:      number | null;
  td_suk_actual:      number | null;
  td_unsynced_count:  number;
}

export interface DespatchDaywiseResponse {
  from_date:          string;
  to_date:            string;
  rows:               DespatchDayRowAPI[];
  mtd_total_plan:     number;
  mtd_bal_plan:       number;
  mtd_suk_plan:       number;
  mtd_total_actual:   number | null;
  mtd_bal_actual:     number | null;
  mtd_suk_actual:     number | null;
  mtd_unsynced_count: number;
}

// ── Dewatering ────────────────────────────────────────────────
export interface DewateringDayRow {
  date:          string;
  open_stock:    number | null;
  rain_added:    number | null;
  seepage:       number | null;
  pump_plan_hr:  number | null;
  pump_act_hr:   number | null;
  disposal_plan: number | null;
  disposal_act:  number | null;
  variance:      number | null;
  closing_stock: number | null;
  variance_reason: string | null;   // kpi_id 42, free text
}

export interface DewateringTodayKpi {
  latest_date:        string;
  day_num:            number;
  disposal_actual:    number | null;
  disposal_plan:      number | null;
  disposal_variance:  number | null;
  disposal_pct:       number | null;
  pump_actual_hr:     number | null;
  pump_plan_hr:       number | null;
  pump_pct:           number | null;
  closing_stock:      number | null;
  prev_closing_stock: number | null;
  stock_delta:        number | null;
  pump_capacity:      number | null;
  eddy_pump_mins:     number | null;
}

export interface DewateringMtdKpi {
  days:                 number;
  mtd_disposal_actual:  number;
  mtd_disposal_plan:    number;
  mtd_disposal_pct:     number | null;
  mtd_pump_actual_hr:   number;
  mtd_pump_plan_hr:     number;
  mtd_pump_pct:         number | null;
  mtd_rain_inflow:      number;
  net_stock_change:     number | null;
  d1_open_stock:        number | null;
  d_last_close_stock:   number | null;
}

export interface DewateringSummaryResponse {
  from_date: string;
  to_date:   string;
  today:     DewateringTodayKpi;
  mtd:       DewateringMtdKpi;
  rows:      DewateringDayRow[];
  /** Days inside the filter with no dewatering entry, so the screen can say
   *  which ones are missing rather than quietly showing an older day. */
  missing_dates: string[];
}

// ── Insights / Reality Check ──────────────────────────────────
export type InsightVerdict =
  | "ACHIEVABLE"
  | "STRETCH"
  | "NOT_FEASIBLE"
  | "NO_DATA"
  | "N/A";

export interface RealityCheckRow {
  kpi:              string;
  unit:             string;
  plan:             number;
  actual:           number;
  gap:              number;
  run_rate_per_day: number | null;
  required_per_day: number | null;
  uplift:           number | null;
  verdict:          InsightVerdict;
}

export interface RealityCheckResponse {
  as_on:          string;
  from_date:      string;
  to_date:        string;
  month_end:      string;
  days_elapsed:   number;
  days_remaining: number;
  cycle_pct:      number;
  plan_month:     string;
  plan_fallback:  boolean;
  rows:           RealityCheckRow[];
}

export interface InsightsResponse {
  generated_at:              string;
  model_used:                string;
  reality_check_narrative:   string;
  dewatering_observations:   string;
  equipment_cob_status:      string;
  stock_despatch_summary:    string;
  key_risks_and_actions:     string;
  shift_snapshot?:           string;
  cached?:                   boolean;
}

// ── Live Fleet Tracking ───────────────────────────────────────
export interface VehicleData {
  vehicle_desc:       string;
  display_name:       string;
  category:           string;
  source:             "man" | "equipment";
  has_data:           boolean;
  // engine
  engine_hours:       number;
  // speed
  avg_speed:          number;
  max_speed:          number;
  // movement
  distance_km:        number;
  // fuel — fuel_consumed drives wave animation
  fuel_consumed:      number;
  lph:                number;
  initial_fuel_level: number;
  final_fuel_level:   number;
  tank_capacity:      number;
  // events
  total_fillings:     number;
  total_drains:       number;
  filled_litres:      number;
  drained_litres:     number;
  // meta
  last_seen:          string | null;
}

export interface LiveTrackingResponse {
  vehicles: VehicleData[];
  count:    number;
}

// ── Fuel Management ───────────────────────────────────────────
export interface FuelVehicle {
  vehicle_desc:        string;
  display_name:        string;
  category:            string;
  source:              "man" | "equipment";
  has_data:            boolean;
  engine_hours:        number;
  fuel_pct:            number;
  fuel_level_l:        number;
  tank_capacity:       number;
  fuel_consumed:       number;
  lph:                 number;
  est_hours_remaining: number | null;
  total_fillings:      number;
  total_drains:        number;
  filled_litres:       number;
  drained_litres:      number;
  status:              "good" | "medium" | "low" | "no_data";
  last_seen:           string | null;
}

export interface FuelDistributionBand {
  band:  string;
  key:   string;
  count: number;
  color: string;
}

export interface FuelTrendDay {
  date:             string;
  total_consumed_l: number;
  vehicle_count:    number;
}

export interface FuelKpis {
  total_vehicles:          number;
  active_vehicles:         number;
  vehicles_with_data:      number;
  avg_fuel_pct:            number;
  total_fuel_l:            number;
  total_capacity_l:        number;
  fleet_fuel_pct:          number;
  fuel_consumed_today:     number;
  fuel_consumed_yesterday: number;
  total_filled_today:      number;
  vehicles_refilled:       number;
  avg_lph:                 number;
  excellent_count:         number;
  good_count:              number;
  medium_count:            number;
  low_count:               number;
  no_data_count:           number;
}

export interface FuelOverviewResponse {
  as_of:          string;   // newest report_date that actually has data
  compared_to:    string;   // previous date with data (day-on-day baseline)
  days_stale:     number;   // calendar days between as_of and today
  is_stale:       boolean;  // true when as_of is behind today
  kpis:           FuelKpis;
  distribution:   FuelDistributionBand[];
  vehicles:       FuelVehicle[];
  top_consumers:  FuelVehicle[];
  refills_today:  FuelVehicle[];
  trend:          FuelTrendDay[];
}

// ── Fuel Summary (historical, date-range driven) ──────────────
export interface FuelSummaryKpis {
  days_in_range:        number;
  days_with_data:       number;
  active_vehicles:      number;
  total_vehicles:       number;
  total_consumed_l:     number;
  total_filled_l:       number;
  total_drained_l:      number;
  total_engine_hours:   number;
  total_distance_km:    number;
  drain_events:         number;
  fill_events:          number;
  avg_lph:              number | null;
  avg_consumed_per_day: number;
}

export interface FuelSummaryDay {
  date:               string;
  consumed_l:         number;
  filled_l:           number;
  drained_l:          number;
  drain_events:       number;
  fill_events:        number;
  distance_km:        number;
  engine_hours:       number;
  vehicles_reporting: number;
}

export interface FuelSummaryVehicle {
  vehicle_desc:  string;
  display_name:  string;
  category:      string;
  source:        "man" | "equipment";
  consumed_l:    number;
  filled_l:      number;
  drained_l:     number;
  drain_events:  number;
  fill_events:   number;
  engine_hours:  number;
  distance_km:   number | null;   // MAN tippers only
  avg_lph:       number | null;
  kmpl:          number | null;   // MAN tippers only
  days_reported: number;
}

export interface FuelSummaryResponse {
  from_date: string;
  to_date:   string;
  kpis:      FuelSummaryKpis;
  daily:     FuelSummaryDay[];
  vehicles:  FuelSummaryVehicle[];
  drainers:  FuelSummaryVehicle[];
}

export interface FuelVehicleHistoryDay {
  date:           string;
  engine_hours:   number;
  fuel_consumed:  number;
  lph:            number;
  fuel_pct:       number;
  filled_litres:  number;
  drained_litres: number;
  total_fillings: number;
  total_drains:   number;
}

export interface FuelVehicleHistoryResponse {
  vehicle_desc:  string;
  display_name:  string;
  category:      string;
  tank_capacity: number;
  source_table:  string;
  from_date:     string;
  to_date:       string;
  days:          FuelVehicleHistoryDay[];
}

// ── Electric Vehicle Tracking ────────────────────────────────
export interface EvVehicleData {
  ev_equipment_id:      number;
  serial_no:            string;
  display_name:         string;
  equipment_type:       string;
  make:                 string;
  model:                string;
  battery_capacity:     number;
  status:               "Active" | "Idle";
  operating_hours:      number;
  idling_hours:         number;
  work_hours:           number;
  total_energy_kwh:     number;
  avg_energy_kwh_per_h: number;
  battery_soc:          number;
  battery_soh:          number;
  last_seen:            string | null;
}

export interface EvOverviewResponse {
  report_date:      string;
  total_vehicles:   number;
  active_vehicles:  number;
  total_work_hours: number;
  total_energy_kwh: number;
  vehicles:         EvVehicleData[];
}

export interface EvVehicleHistoryDay {
  date:                 string;
  operating_hours:      number;
  idling_hours:         number;
  work_hours:           number;
  total_energy_kwh:     number;
  avg_energy_kwh_per_h: number;
  battery_soc:          number;
}

export interface EvVehicleHistoryResponse {
  ev_equipment_id:  number;
  serial_no:        string;
  equipment_type:   string;
  make:             string;
  model:            string;
  battery_capacity: number;
  from_date:        string;
  to_date:          string;
  history:          EvVehicleHistoryDay[];
}

// ── OEE ───────────────────────────────────────────────────────
export interface OEEMachineRow {
  machine:        string;
  ideal_cap:      number;
  /** Which table this row belongs to. The mine names the new machines —
   *  NEW_EXCAVATORS in backend/app/services/oee.py — nothing derives it, and
   *  being hired is not the test. */
  generation:     "old" | "new";
  bd_source:      "sap" | "imos";   // where this row's BD/PM came from
  hired:          boolean;          // contractor machine, not a Balasore asset
  god_hours:      number;
  holiday_hrs:    number;
  no_plan_hrs:    number;
  planned_sd_hrs: number;
  loss_hrs:       number;
  ideal_time:     number;   // God − Loss; Availability denominator
  bd_hours:       number;
  pm_hours:       number;
  operating_hrs:  number;
  actual_cum:     number;
  /** What the buckets carried. ore+ob+other always re-add to actual_cum. */
  ore_cum:   number;
  ob_cum:    number;
  other_cum: number;
  material:     "ORE" | "OB" | "OTHER" | "MIXED" | null;
  material_pct: number | null;
  ore_pct:      number | null;
  ob_pct:       number | null;
  other_pct:    number | null;
  /** THE ORE / OB COLUMN. What the mine assigned this machine to for the
   *  month, from the OEE Master Selector — not what it actually moved,
   *  which is the `material` fields above and is now the tooltip. null means
   *  the plan has never named this machine, in any month. */
  plan_material: "ORE" | "OB" | null;
  /** "entered" = this month's own plan; "carried" = the latest earlier month,
   *  named in plan_from. */
  plan_source:   "entered" | "carried" | null;
  plan_from:     string | null;
  /** running_hours / (god − breakdown), capped at 100 — the MIS Equipment
   *  section's formula with the shift log in place of the GPS feed. */
  utilisation:  number | null;
  ideal_cum:      number;
  availability:   number;
  performance:    number;
  quality:        number;
  oee:            number;
  // reporting only — feeds no OEE formula
  deviation_hrs:  number;
  running_hrs:    number;
  shift_hours:    number;
  deviation_pct:  number | null;
}

/** Weighted fleet roll-up computed server-side. Never average the machine
 *  percentages client-side — it overstates the fleet figure badly. */
export interface OEEFleet {
  god_hours:     number;
  loss_hrs:      number;
  ideal_time:    number;
  bd_hours:      number;
  pm_hours:      number;
  operating_hrs: number;
  actual_cum:    number;
  /** What the buckets carried. ore+ob+other always re-add to actual_cum. */
  ore_cum:   number;
  ob_cum:    number;
  other_cum: number;
  material:     "ORE" | "OB" | "OTHER" | "MIXED" | null;
  material_pct: number | null;
  ore_pct:      number | null;
  ob_pct:       number | null;
  other_pct:    number | null;
  /** How the group's plan split. Counts, not an average — a plan is a label
   *  per machine, so there is no weighted mean of ORE and OB to take. */
  plan_ore:       number;
  plan_ob:        number;
  plan_unplanned: number;
  plan_carried:   number;
  /** running_hours / (god − breakdown), capped at 100 — the MIS Equipment
   *  section's formula with the shift log in place of the GPS feed. */
  utilisation:  number | null;
  ideal_cum:     number;
  availability:  number;
  performance:   number;
  quality:       number;
  oee:           number;
  deviation_hrs: number;
  running_hrs:   number;
  shift_hours:   number;
  deviation_pct: number | null;
  machine_count: number;
  /** Roster excavators with no shift rows in this period, so not shown at all
   *  rather than shown as zeros. */
  absent_machines: string[];
}

export interface OEEResponse {
  from_date: string;
  to_date:   string;
  machines:  OEEMachineRow[];
  fleet:     OEEFleet;
  /** The same weighted roll-up restricted to each generation. Use these for
   *  the two tables' OVERALL rows instead of re-summing here: averaging or
   *  re-deriving percentages in the browser overstates them. */
  fleet_old: OEEFleet;
  fleet_new: OEEFleet;
  /** 'table' when the fleet came from the Equipment Status Selector, which is
   *  the normal case; 'fallback' when minehub could not be reached and these
   *  are the figures compiled into the service. */
  roster_source?: string;
  /** The day the fleet was resolved FOR — the first day of the window, not
   *  today. The two differ on any month-to-date view, which is why the table
   *  prints it: a setting saved today starts after the last day this page
   *  can report, and the footer has to say so. */
  roster_as_on?: string | null;
}

// ── AMIRA Accounting ──────────────────────────────────────────
/** One stage of the mine-to-plant chain. `available` is false for the stages
 *  not yet sourced; the row is still returned so the table keeps the shape of
 *  the whole chain rather than hiding the gap. */
export interface AmiraStage {
  key:   string;
  label: string;
  available: boolean;
  ore_qty:       number | null;
  cr2o3:         number | null;
  moisture:      number | null;
  net_chromium:  number | null;
  /** Against the stage immediately before this one; null when that one is
   *  itself unavailable. */
  chromium_loss:     number | null;
  contribution_loss: number | null;
}

/** The workbook's Total column: the two loss rows only, signed. The other rows
 *  have no total in the sheet — ore summed along a chain counts the same ore
 *  five times, and percentages do not sum. */
export interface AmiraTotal {
  chromium_loss:     number | null;
  contribution_loss: number | null;
}

export interface AmiraResponse {
  from_date: string;
  to_date:   string;
  stages:    AmiraStage[];
  total:     AmiraTotal;
  cr2o3_to_cr:       number;
  nsr_per_mt_fecr:           number;
  variable_cost_per_mt_fecr: number;
  contribution_per_mt_fecr:  number;
  fecr_cr_content:           number;
  pending_stages:    string[];
  /** Plant tonnage is currently the despatched tonnage, by the mine's
   *  instruction, until the plant-side gate record is identified. */
  plant_qty_mirrors_despatch: boolean;
}

// ── LCM (Lost Cost Matrix) ────────────────────────────────────
export interface LCMRow {
  sl_no:            number;
  loss_description: string;
  ore_hours:        number;
  planned_ore_loss: number;   // MT
  ob_hours:         number;
  planned_ob_loss:  number;   // CuM
  loss_amount:      number | null;   // Rs — null while the IBM rate is unset
  loss_share_pct:   number | null;   // % of the period's total loss amount
  loss_type:        "Controllable" | "Non Controllable" | "Unclassified";
  kam:              string;
}

export interface LCMGradeRate {
  grade: "HG" | "MG" | "LG";
  qty:   number;          // planned MT
  rate:  number | null;   // IBM Rs/MT
  share: number;          // % of planned ore
  value: number | null;   // qty x rate
}

export interface LCMCosting {
  weighted_rate:  number | null;   // Rs/MT, plan-weighted across grades
  status:         "ok" | "rate_missing" | "no_plan_qty";
  missing_grades: string[];
  total_plan_qty: number;
  source:         string;
  /** The bulletin issue in use, YYYY-MM-01. Null when none could be read. */
  rate_period?:   string | null;
  /** True when minehub could not be reached and the last known issue is shown. */
  rate_is_stale?: boolean;
  /** Grades whose price the collector flagged as an implausible parse. */
  rate_flagged?:  string[];
  breakdown:      LCMGradeRate[];
  ore_plan:       number;
  grade_plan_total: number;
  grade_plan_matches_ore_plan: boolean;
  ob_costed:      boolean;
}

export interface LCMBasis {
  days:                  number;
  ore_plan:              number;
  ore_actual:            number;
  ore_deviation:         number;
  ob_plan:               number;
  ob_actual:             number;
  ob_deviation:          number;
  total_ore_loss_hours:  number;
  total_ob_loss_hours:   number;
  ore_factor:            number;   // MT per hour
  ob_factor:             number;   // CuM per hour
  ore_machines:          string[];
  ob_machines:           string[];
  /** Ore hours + OB hours, against the fleet's own total for the period.
   *  Equal means no machine is missing from the plan. Anything less says how
   *  much is unaccounted for — and it is the only visible symptom there is,
   *  because the Planned Loss column foots to the Deviation either way. */
  hours_counted:         number;
  hours_excluded:        number;
  hours_fleet:           number;
  hours_coverage_pct:    number | null;
}

/** Where the month's ORE/OB split came from. */
export interface LCMPlan {
  /** entered = the mine assigned every machine for this month.
   *  carried = some or all came from an earlier month, named in carried_from.
   *  none = the table is readable and empty.
   *  unavailable = minehub could not be read; these are built-in defaults. */
  status:        "entered" | "carried" | "none" | "unavailable";
  month:         string;
  ore:           string[];
  ob:            string[];
  /** Machines whose hours reach neither bucket. */
  excluded:      string[];
  /** Assigned, but absent from the OEE fleet list, so unmatchable to hours. */
  no_spec:       string[];
  /** Never assigned in any month. */
  unassigned:    string[];
  carried:       { equipment_name: string; material_type: string; from_month: string }[];
  carried_from:  string | null;
  month_entered: boolean;
  /** The period crosses a month boundary; the plan has no finer grain. */
  spans_months:  boolean;
}

export interface LCMCoverage {
  days_in_period:   number;
  ore_days_present: number;
  ob_days_present:  number;
  ore_rows:         number;
  ob_rows:          number;
}

export interface LCMTotals {
  ore_hours:               number;
  planned_ore_loss:        number;
  ob_hours:                number;
  planned_ob_loss:         number;
  controllable_ore_loss:   number;
  controllable_ob_loss:    number;
  controllable_ore_hours:  number;
  controllable_ob_hours:   number;
  loss_amount:                  number | null;
  controllable_loss_amount:     number | null;
  non_controllable_loss_amount: number | null;
  loss_share_pct:               number | null;
}

export interface LCMResponse {
  from_date: string;
  to_date:   string;
  basis:     LCMBasis;
  plan:      LCMPlan;
  costing:   LCMCosting;
  coverage:  LCMCoverage;
  rows:      LCMRow[];
  totals:    LCMTotals;
}

// ── Equipment Wise LCM ─────────────────────────────────────────
/** One excavator on this period's excavation plan, and the share of the
 *  deviation its ideal capacity earns it.
 *
 *  `carries_share` is false — with `reason` saying which — when a machine is
 *  on the plan but cannot take a share: it lost no hours at all (nothing to
 *  divide by), or the Equipment Status Selector holds no capacity for it.
 *  Such a machine is still LISTED, because its hours are in the denominator
 *  of the matrix below and silently dropping it would hide that. */
export interface LCMEquipment {
  equipment_name: string;
  side:           "ORE" | "OB";
  unit:           "MT" | "CuM";
  capacity:       number | null;   // ideal CuM/hr, from the selector
  has_capacity:   boolean;
  hours:          number;          // this machine's own loss hours
  share:          number | null;   // its slice of the deviation
  share_pct:      number | null;   // its slice of the side's capacity
  factor:         number | null;   // share / hours — MT or CuM per hour
  carries_share:  boolean;
  reason:         "no_loss_hours" | "no_capacity" | null;
  hired:          boolean;
  bd_source:      "SAP" | "SHIFT LOG";
}

/** One loss head on one machine. */
export interface LCMEquipmentCell {
  side:         "ORE" | "OB";
  unit:         "MT" | "CuM";
  hours:        number;
  planned_loss: number;
  /** Rs — ore machines only. OB is waste rock and carries no IBM rate, so an
   *  OB machine's amount is null, never zero. */
  loss_amount:  number | null;
}

export interface LCMEquipmentRow {
  sl_no:            number;
  loss_description: string;
  column:           string;
  loss_type:        "Controllable" | "Non Controllable" | "Unclassified";
  kam:              string;
  role:             string;
  /** The mine's standing remedy for this head and who carries it out, from
   *  the LCM KAM Selector. null is a real answer: a catch-all head such as
   *  'other' is deliberately given none, and nothing invents one. */
  action_text:      string | null;
  owning_function:  string | null;
  /** The roll-up: every machine's cell for this head, added together. */
  ore_hours:        number;
  planned_ore_loss: number;
  ob_hours:         number;
  planned_ob_loss:  number;
  loss_amount:      number | null;
  loss_share_pct:   number | null;
  /** What the same head reads on the overall matrix below, so the page can
   *  show the movement instead of leaving two tables to disagree in silence. */
  overall_planned_ore_loss: number | null;
  overall_planned_ob_loss:  number | null;
  machines:         Record<string, LCMEquipmentCell>;
}

export interface LCMEquipmentTotals {
  ore_hours:        number;
  planned_ore_loss: number;
  ob_hours:         number;
  planned_ob_loss:  number;
  loss_amount:      number | null;
  loss_share_pct:   number | null;
  controllable_loss_amount:     number | null;
  non_controllable_loss_amount: number | null;
}

/** The page states this rather than assuming it: splitting the matrix by
 *  machine re-attributes a total, it never changes one. */
export interface LCMEquipmentReconciliation {
  ore_deviation:       number;
  ob_deviation:        number;
  overall_loss_amount: number | null;
  overall_ore_hours:   number;
  overall_ob_hours:    number;
  hours_match:    boolean;
  ore_loss_match: boolean;
  ob_loss_match:  boolean;
  amount_match:   boolean;
}

export interface LCMByEquipmentResponse {
  from_date: string;
  to_date:   string;
  machines:  LCMEquipment[];
  machine_totals: Record<string, {
    hours: number; planned_loss: number; loss_amount: number | null;
  }>;
  rows:     LCMEquipmentRow[];
  /** "selector" = the mine's own capacities; "fleet_default" = minehub was
   *  unreachable and these are the built-in figures. */
  capacity_source: "selector" | "fleet_default";
  basis:    LCMBasis;
  plan:     LCMPlan;
  costing:  LCMCosting;
  coverage: LCMCoverage;
  totals:   LCMEquipmentTotals;
  reconciliation: LCMEquipmentReconciliation;
}


// ── KAM Wise Loss Structure (the mine's seven-head layout) ─────
/** One measure on a card. Production variance is ORE ONLY — ore is MT and OB
 *  is CuM, so they cannot be added, and only ore carries an IBM rate. Null is
 *  "does not apply here", never zero: Head COB has no MT because what the
 *  plant lost is concentrate, not ore at the face. */
export interface LossMeasure {
  variance_mt: number | null;
  value_lacs:  number | null;
}

export interface LossStructureNode {
  role_code: string;
  title:     string;
  /** From the KAM Selector — derived from the loss heads under the node, or
   *  an explicit dated override. Null is a vacant post. */
  owner:     string | null;
  /** The employee behind the name. Photos key on this, not the spelling, so a
   *  renamed KAM keeps their picture. */
  emp_id:    string | null;
  /** Who this head reports to. RECORDED, NEVER SUMMED — all seven nodes are
   *  drawn on one line and each carries only its own loss heads. */
  parent_role_code: string | null;
  sl_order:   number;
  head_count: number;
  total:            LossMeasure;
  controllable:     LossMeasure;
  non_controllable: LossMeasure;
  /** Heads nobody has classified. Zero today; carried so the card can warn
   *  rather than let the three rows quietly stop adding to the total. */
  unclassified:     LossMeasure;
  cob:              LossMeasure;
  /** COB Loss is drawn on Head COB and the Chief alone, per the mine. */
  shows_cob:  boolean;
  /** What the MT column of `loss_heads` is measured in. Ore at the face on
   *  every node but COB, whose causes are concentrate at the plant — which is
   *  why the COB card itself shows a dash where the others show tonnes. */
  loss_heads_unit: "ore_mt" | "concentrate_mt";
  /** Every loss head this KAM answers for, biggest first, INCLUDING the ones
   *  that cost nothing this period — a zero is a result, and dropping it
   *  would make an unworked head look like an unassigned one. */
  loss_heads: LossStructureHead[];
}

export interface LossStructureHead {
  loss_description: string;
  /** Null on COB's causes: LCM for COB has no controllability dimension. */
  loss_type: string | null;
  column: string | null;
  kam: string | null;
  /** COB's causes form their own small tree — Feed grade and Plant efficiency
   *  sit under Recovery / yield. Absent (level 1) on a mines loss head.
   *  ONLY LEVEL 1 TOTALS: summing both levels would count them twice. */
  level?: number;
  parent?: string | null;
  /** Null where the row carries rupees but no tonnes, as COB Loss does on the
   *  Chief's list. */
  variance_mt: number | null;
  value_lacs: number | null;
}

export interface LossStructureSide {
  plan: number; actual: number; variance: number;
  unit: "MT" | "CuM";
  /** Null for OB: waste rock has no IBM rate. A dash, not a zero. */
  value_lacs: number | null;
}

export interface LossStructureEquipment {
  equipment_name: string;
  side: "ORE" | "OB";
  unit: "MT" | "CuM";
  capacity: number | null;
  variance: number;
  value_lacs: number | null;
  carries_share: boolean;
  reason: "no_loss_hours" | "no_capacity" | null;
}

export interface LossStructureResponse {
  from_date: string;
  to_date:   string;
  summary:   { ore: LossStructureSide; ob: LossStructureSide };
  equipment: LossStructureEquipment[];
  root:      LossStructureNode;
  nodes:     LossStructureNode[];
  rate_available: boolean;
  costing:   LCMCosting;
  plan:      LCMPlan;
  capacity_source: "selector" | "fleet_default";
  /** The structure re-cuts a total it must not change; the page prints the
   *  check rather than asking a reader to add seven cards up. */
  reconciliation: {
    ore_deviation: number;
    matrix_value_lacs: number | null;
    cob_value_lacs: number | null;
    root_mt: number | null;
    root_value_lacs: number | null;
    expected_value_lacs: number | null;
    mt_matches: boolean;
    value_matches: boolean;
  };
}


// ── Ore grade weighted average (SAP quality inspection, ROM1) ──
export interface OreGradeDetail {
  grade_key:   "HG" | "MG" | "LG";
  grade_label: string;
  qty:         number;
  cr2o3:       number | null;   // null when that grade had no lots
}

export interface OreGradePeriodDetail extends OreGradeDetail {
  share_pct: number;
}

export interface OreGradeDayRow {
  date:        string;
  total_qty:   number;
  weighted_cr: number | null;   // null = no inspection that day, a gap not a zero
  lots:        number;
  grades:      OreGradeDetail[];
}

export interface OreGradeResponse {
  from_date: string;
  to_date:   string;
  rows:      OreGradeDayRow[];
  period_weighted_cr: number | null;
  period_total_qty:   number;
  days_with_data:     number;
  days_in_period:     number;
  period_grades:      OreGradePeriodDetail[];
  source:             string;
}

// ── Dumper-wise trip count (MAN / PRIMA) ──────────────────────
export interface DumperTripColumn {
  key:   string;
  label: string;
}

export interface DumperTripRow {
  dumper_name: string;
  materials:   Record<string, number>;
  total_trips: number;
  active_days: number;
  shift_rows:  number;
}

export interface DumperTripResponse {
  from_date: string;
  to_date:   string;
  columns:   DumperTripColumn[];
  rows:      DumperTripRow[];
  totals:    Record<string, number>;
  total_trips:    number;
  dumpers_total:  number;
  dumpers_active: number;
  // pre-July 2026 CSV rows naming several machines at once
  unattributed_rows:  number;
  unattributed_trips: number;
}

/* ── LCM for COB ──────────────────────────────────────────────────────────── */

/** One attributed cause of the concentrate deviation.
 *
 *  level 1 rows (Feed volume, Recovery / yield) sum to the deviation.
 *  level 2 rows break down their `parent` and must NOT be added to the total —
 *  they are already inside it. */
export interface CobLcmRow {
  sl_no:            number;
  loss_description: string;
  level:            1 | 2;
  parent:           string | null;
  loss_mt:          number | null;
  loss_amount:      number | null;
  loss_share_pct:   number | null;
}

export interface CobLcmSide {
  feed:                 number | null;
  concentrate:          number | null;
  recovery_pct:         number | null;
  feed_grade:           number | null;
  conc_grade:           number | null;
  chrome_recovery_pct:  number | null;
}

export interface CobLcmResponse {
  from_date: string;
  to_date:   string;
  days:      number;

  plan: CobLcmSide & {
    running_hours:   number | null;
    shutdown_hours:  number | null;
    available_hours: number | null;
    feed_rate:       number | null;
    plan_days:       number;
  };
  actual: CobLcmSide & {
    achievable_recovery_pct: number | null;
    posted_days:             number;
    grade_weighted:          boolean;
    grade_lots:              number;
  };

  deviation_mt: number | null;
  has_plan:     boolean;
  /** Actual ÷ Plan concentrate × 100. Not capped — a month that beat plan says so. */
  achieved_pct: number | null;
  rows:         CobLcmRow[];
  totals: {
    loss_mt:        number | null;
    loss_amount:    number | null;
    loss_share_pct: number | null;
  };

  /** Hours are INFERRED from tonnage — the plant has no running-hours source. */
  hours: {
    planned:  number | null;
    implied:  number | null;
    lost:     number | null;
    inferred: boolean;
  };

  posting: {
    last_posted_date: string | null;
    unposted_days:    number;
  };

  costing: {
    rate:   number;
    source: string;
    basis:  string;
  };
}

/* ── Grade-wise Despatch ──────────────────────────────────────────────────── */

/** One HG/MG/LG band, or the Unassayed row. Grades are null on Unassayed —
 *  there is no assay to report, and 0 would be a lie. */
export interface GradeBandRow {
  key:       "HG" | "MG" | "LG" | "COB" | "UNASSAYED";
  label:     string;
  trips:     number;
  tonnage:   number;
  share_pct: number | null;
  cr2o3:     number | null;
  cr_fe:     number | null;
  /** From mines_despatch_plan. null when the band has no plan concept
   *  (Unassayed) or the range has no plan rows at all (June 2026). */
  plan_tonnage:    number | null;
  /** null when there is nothing to measure against. A zero plan is neither 0%
   *  nor infinity — May planned 0 HG and shipped 762.7 MT. */
  achievement_pct: number | null;
}

/** A 2% distribution bucket. share_pct is of ASSAYED tonnage, not of the total. */
export interface GradeFineBand {
  label:     string;
  tonnage:   number;
  trips:     number;
  share_pct: number | null;
}

/** What a tonne was billed as, against what it assayed. */
export interface GradeSoldAsRow {
  material_no:   string | null;
  material_desc: string;
  trips:         number;
  tonnage:       number;
  cr2o3:         number | null;
  cr_min:        number | null;
  cr_max:        number | null;
  bands:         Record<string, number>;
}

export interface GradeCustomerRow {
  code:    string;
  name:    string;
  trips:   number;
  tonnage: number;
  cr2o3:   number | null;
  bands:   Record<string, number>;
}

export interface GradeDespatchResponse {
  from_date: string;
  to_date:   string;

  bands:  GradeBandRow[];
  totals: {
    trips:     number;
    tonnage:   number;
    /** MINE ORE ONLY. Concentrate is a different product and is reported on its
     *  own band row rather than blended into a run-of-mine average. */
    cr2o3:       number | null;
    cr_fe:       number | null;
    ore_tonnage: number;
    share_pct:   number | null;
    /** Every plan category including CrFe/Lump, so it equals the figure the
     *  Despatch section shows. null when the range carries no plan. */
    plan_tonnage:    number | null;
    achievement_pct: number | null;
  };

  fine_bands: GradeFineBand[];
  sold_as:    GradeSoldAsRow[];
  customers:  GradeCustomerRow[];

  /** Per-day tonnage split by band, plus that day's plan per band. A day appears
   *  if it had despatch OR carried a plan, so a planned day that shipped nothing
   *  is visible rather than absent. */
  daily: Array<{ date: string;
                 HG: number; MG: number; LG: number; COB: number; UNASSAYED: number;
                 plan_HG: number; plan_MG: number; plan_LG: number; plan_COB: number }>;

  /** Non-despatch movements on the same SAP table — bagged material hauled by
   *  other carriers. Reported, never hidden; not a pending decision. */
  excluded: {
    trips:        number;
    tonnage:      number;
    bagged_trips: number;
    transporters: Array<{ transporter: string | null; trips: number;
                          tonnage: number; bagged_trips: number }>;
  };

  plan: {
    /** false for June 2026 — no rows in mines_despatch_plan at all. */
    has_plan:       boolean;
    days_with_plan: number;
    days_in_range:  number;
    by_band:        Record<string, number>;
    /** CrFe and Lump: no assay band to compare against. Zero in every row so
     *  far, carried so the plan total cannot silently lose them. */
    unmapped_tonnage: number;
  };

  coverage: {
    tier1_tonnage:     number;
    tier2_tonnage:     number;
    unassayed_tonnage: number;
    cob_tonnage:       number;
    assayed_pct:       number | null;
    po_count:          number;
  };
}

/* ── Why-Why analysis (Intelligence) ─────────────────────────────────────────
 * Two endpoints, deliberately separate. /why-why is pure DB computation and
 * always answers; /why-why/narrative adds BAL-AI's reading on top and can fail.
 * The section renders the charts from the first and treats the second as a
 * bonus, so a gateway outage costs prose, not the whole section.            */

export interface WhyWhyWindow {
  from:           string | null;
  to:             string | null;
  extent_from:    string | null;
  extent_to:      string | null;
  requested_from?: string;
  requested_to?:   string;
  /** The global date filter overhung the register and was trimmed to fit. */
  clamped:        boolean;
  /** The filter misses the register entirely. Nothing is shown — the section
   *  never substitutes a different period for the one that was asked for. */
  no_overlap:     boolean;
  empty:          boolean;
}

export interface WhyWhyHeadline {
  breakdowns:          number;
  machines:            number;
  breakdown_hours:     number;
  avg_hours:           number | null;
  repair_cost:         number;
  repair_cost_rows:    number;
  operating_hours:     number | null;
  repeat_events:       number;
  repeat_pct:          number | null;
  cause_recorded_pct:  number | null;
}

export interface WhyWhyShare {
  label: string;
  count: number;
  pct:   number | null;
  cost?: number;
  hours?: number;
  cost_per_event?: number | null;
}

export interface WhyWhyMachine {
  machine:         string;
  breakdowns:      number;
  hours:           number;
  cost:            number;
  operating_hours: number | null;
  /** Null when the machine ran too few hours for a rate to mean anything. */
  per_100_hours:   number | null;
  top_failure:     string;
}

export interface WhyWhyWatch {
  machine:        string;
  defect:         string;
  events:         number;
  mean_gap_days:  number;
  sd_days:        number;
  last:           string;
  days_since:     number;
  due_in_days:    number;
  state:          "due" | "soon" | "watch" | "held";
}

export interface WhyWhyResponse {
  window:   WhyWhyWindow;
  headline: WhyWhyHeadline | null;
  months:   Array<{ month: string; breakdowns: number; hours: number; cost: number }>;
  machines: WhyWhyMachine[];
  failure_modes: {
    families: WhyWhyShare[];
    families_to_80pct: number;
    top_defects: Array<{ label: string; count: number }>;
  } | null;
  root_causes: {
    categories: WhyWhyShare[];
    recorded: number;
    missing: number;
  } | null;
  timing: {
    by_shift:   WhyWhyShare[];
    by_hour:    Array<{ hour: number; count: number }>;
    peak_hours: number[];
  } | null;
  repeats: Array<{
    machine: string; defect: string; count: number;
    hours: number; cost: number; last: string;
  }>;
  watchlist: WhyWhyWatch[];
  operators: {
    named_events: number;
    unnamed_events: number;
    distinct: number;
    max_events: number;
    operator_error_events: number;
    top: WhyWhyOperator[];
    /** Ships from the backend so the UI cannot quietly drop it. */
    caveat: string;
  } | null;
  production_loss: WhyWhyProductionLoss | null;
  machine_detail:  WhyWhyMachineDetail[];
  operator_issues: WhyWhyOperatorIssues | null;
  completeness: {
    records: number;
    fields: Array<{ field: string; pct: number }>;
    not_recorded: string[];
  } | null;
}

export interface WhyWhyNarrativeResponse {
  facts:    WhyWhyResponse;
  sections: { findings: string; risks: string; actions: string; gaps: string };
  model:    string | null;
  tokens:   number | null;
  generated_at: string | null;
  /** Figures in the prose absent from the figures the model was given. */
  unverified_numbers: string[];
  error:    string | null;
}

/** One machine's own failure Pareto and cause split — the fleet view averages
 *  away the fact that tippers fail on tyres and excavators fail hydraulically. */
export interface WhyWhyMachineDetail {
  machine:         string;
  breakdowns:      number;
  hours:           number;
  cost:            number;
  modes:           WhyWhyShare[];
  causes:          WhyWhyShare[];
  causes_recorded: number;
  modes_to_80pct:  number;
  /** Enough events for a Pareto to mean anything; below it no verdict is given. */
  enough_for_pareto: boolean;
  /** Two modes or fewer cover 80% — a fixable pattern rather than scatter. */
  concentrated:    boolean;
}

export interface WhyWhyOperatorIssue {
  machine:           string;
  date:              string | null;
  shift:             string | null;
  defect:            string;
  family:            string;
  sub_category:      string | null;
  /** Present where recorded. Records who was there, not who is at fault. */
  operator:          string | null;
  problem_statement: string;
  why_chain:         string[];
  hours:             number;
  cost:              number;
}

export interface WhyWhyOperatorIssues {
  events:          number;
  named_events:    number;
  hours:           number;
  cost:            number;
  by_family:       WhyWhyShare[];
  with_why_chain:  number;
  issues:          WhyWhyOperatorIssue[];
}

/** One operating-error breakdown, with the operator reason the AI read out of
 *  its Why-Why, the qualification pack that covers the skill, and the training
 *  topic that would have prevented it. */
export interface WhyWhyTrainingBreakdown {
  id:              number;
  notification_no: string | null;
  date:            string | null;
  shift:           string | null;
  machine:         string;
  defect:          string | null;
  family:          string;
  component:       string | null;
  hours:           number;
  cost:            number;
  why_chain:       string[];
  /** "recorded" = read from the analysts' own Why-Why chain.
   *  "inferred" = no chain existed; read from the defect and failure mode. */
  basis:           "recorded" | "inferred";
  reason:          string | null;
  topic:           string | null;
  /** Resolved from the MACHINE, not chosen by the model — an operator's
   *  qualification is a property of the machine they drive. Null only when the
   *  catalogue holds no pack for that machine class, e.g. a telehandler. */
  pack:            { code: string; name: string; nsqf: number | string } | null;
  outcomes:        string[];
  analysed:        boolean;
}

export interface WhyWhyTrainingResponse {
  period:      WhyWhyWindow;
  summary:     Omit<WhyWhyOperatorIssues, "issues"> | null;
  breakdowns:  WhyWhyTrainingBreakdown[];
  analysed:    number;
  recorded_basis: number;
  packs:       number;
  web:         Array<{ title: string; url: string }>;
  model:       string | null;
  tokens:      number | null;
  generated_at: string | null;
  error:       string | null;
}

/** Breakdown production loss, taken from the LCM section and split here.
 *  Never recomputed — two rupee figures for the same thing on one dashboard
 *  is worse than one figure in two places. */
export interface WhyWhyLossSlice {
  label:     string;
  events:    number;
  hours:     number;
  share_pct: number;
  amount:    number;
  tonnes:    number | null;
}

export interface WhyWhyProductionLoss {
  amount:                 number;
  tonnes:                 number | null;
  loss_hours:             number | null;
  ob_volume_cum:          number | null;
  share_of_all_loss_pct:  number | null;
  loss_type:              string | null;
  rate_per_mt:            number | null;
  rate_source:            string | null;
  lcm_total_loss:         number | null;
  repair_cost:            number;
  /** Production loss as a multiple of the repair bill. The headline. */
  times_repair_cost:      number | null;
  ore_machines:           string[];
  ore_machine_events:     number;
  ob_machine_events:      number;
  allocation: {
    by_machine: WhyWhyLossSlice[];
    by_mode:    WhyWhyLossSlice[];
    by_cause:   WhyWhyLossSlice[];
  };
  basis: string;
}

/** One breakdown a named operator was present for. Present, not responsible —
 *  see WhyWhyResponse.operators.caveat. */
export interface WhyWhyOperatorBreakdown {
  date:            string | null;
  shift:           string | null;
  machine:         string;
  defect:          string | null;
  family:          string;
  cause:           string | null;
  hours:           number;
  cost:            number;
  notification_no: string | null;
  why_chain:       string[];
}

export interface WhyWhyOperator {
  operator:   string;
  events:     number;
  machines:   string[];
  causes:     WhyWhyShare[];
  cost:       number;
  breakdowns: WhyWhyOperatorBreakdown[];
}

/** One breakdown as recorded, with its 5-Why ladder. Rows with no ladder are
 *  still listed — 198 of 345 have none, and hiding them would make the
 *  register look better documented than it is. */
export interface WhyWhyRegisterRow {
  id:              number;
  notification_no: string | null;
  date:            string | null;
  shift:           string | null;
  machine:         string;
  equipment_desc:  string | null;
  defect:          string | null;
  family:          string;
  cause:           string | null;
  cause_detail:    string | null;
  component:       string | null;
  operator:        string | null;
  hours:           number;
  cost:            number;
  why:             Array<{ level: number; question: string | null; answer: string | null }>;
  root_cause:      string | null;
}

export interface WhyWhyRegisterResponse {
  window:       WhyWhyWindow;
  rows:         WhyWhyRegisterRow[];
  machines:     string[];
  causes:       string[];
  families:     string[];
  with_why:     number;
  without_why:  number;
}

/* ── Data health ────────────────────────────────────────────────────────────
   How current the data behind each screen is. Shapes mirror
   backend/app/services/data_health.py. */

export type DataHealthStatus = "ok" | "warn" | "stale" | "unknown";

export interface DataHealthFeed {
  key: string;
  label: string;
  /** AppPage ids this feed serves. One feed can serve several screens. */
  sections: string[];
  source: "mysql" | "minehub";
  table: string;
  /** "daily" is filled in arrears; "plan" is filled forward and is judged on
   *  how far ahead it still reaches, not on how recent it is. */
  kind: "daily" | "plan";
  /** Who to chase when it stops: SAP is an interface, "entry" is a person at
   *  the mine with a form, telematics and platform are syncs. */
  origin: "sap" | "entry" | "telematics" | "platform";
  origin_label: string;
  /** The date this feed should hold. Most screens report the day that has
   *  ended; a stock snapshot and the self-writing feeds are about today; a
   *  plan is judged on how far ahead it reaches. */
  expects: "yesterday" | "today" | "ahead";
  note: string;
  status: DataHealthStatus;
  last_date: string | null;
  expected_date: string | null;
  /** Negative for a plan feed that still reaches into the future. */
  days_behind: number | null;
  /** The sentence to show. Built server-side so every placement words it the
   *  same way. */
  message: string;
}

export interface DataHealthSection {
  status: DataHealthStatus;
  /** Feed keys, worst first. */
  feeds: string[];
  stale_count: number;
}

export interface DataHealthResponse {
  as_of: string;
  /** The day a daily feed is expected to hold: yesterday. */
  expected_date: string;
  feeds: DataHealthFeed[];
  sections: Record<string, DataHealthSection>;
  /** Sections deliberately not watched, and why. Absence of monitoring is not
   *  a clean bill of health, so the reason is carried rather than implied. */
  unmonitored: Record<string, string>;
  summary: { total: number; ok: number; warn: number; stale: number; unknown: number };
  cached?: boolean;
}

// ── Tipper OEE — old (MAN) and new (PRIMA) ─────────────────────
/** Availability and Utilisation mean the same as on the excavator table; Yield
 *  replaces Performance because a tipper is measured in trips. Nothing is
 *  capped — a Utilisation over 100% means the breakdown hours behind it are
 *  wrong, and the excavator table's cap would hide that. */
export interface TipperOEERow {
  machine:       string;
  generation:    "old" | "new";
  god_hours:     number;
  engine_hrs:    number;
  bd_hours:      number;
  available_hrs: number;
  ideal_trip:    number;
  actual_trip:   number;
  /** null, never 0, where the denominator makes the question empty. */
  availability:  number | null;
  utilisation:   number | null;
  yield_pct:     number | null;
  oee:           number | null;
  /** The two tables do not share sources — the PRIMA tippers have no Technoton
   *  unit and no SAP equipment record, so both figures come from the shift log. */
  engine_source: "telematics" | "shift_log";
  bd_source:     "sap" | "shift_log";
  /** Days in the window this truck appears in the shift log at all. */
  days_logged:   number;
}

export interface TipperOEEFleet {
  generation:    "old" | "new";
  god_hours:     number;
  engine_hrs:    number;
  bd_hours:      number;
  available_hrs: number;
  ideal_trip:    number;
  actual_trip:   number;
  availability:  number | null;
  utilisation:   number | null;
  yield_pct:     number | null;
  oee:           number | null;
  machine_count: number;
  /** Roster trucks the shift log never mentions in this window. */
  unlogged:      string[];
}

export interface TipperOEEResponse {
  from_date:    string;
  to_date:      string;
  old_machines: TipperOEERow[];
  new_machines: TipperOEERow[];
  old_fleet:    TipperOEEFleet;
  new_fleet:    TipperOEEFleet;
}

/* ── Product Costing ─────────────────────────────────────────────
   Restored after the 2026-10-15 history reset reverted this file; the
   costing components are untracked and import these.
   ──────────────────────────────────────────────────────────────── */
export type CostSection = "MINES" | "COB";
export type CostBucket  = "DAILY" | "FORM" | "FEED" | "MONTH_END";

export interface CostLine {
  line:            string;
  bucket:          CostBucket | null;
  actual:          number;
  plan:            number;
  variance:        number;
  rs_per_mt:       number | null;
  plan_rs_per_mt:  number | null;
  is_total:        boolean;
  /** Plan pro-rated to as_of, for a month-end line that has not posted. */
  accrued?:        number;
  /** True when `actual` above IS that accrual rather than a posting. */
  is_accrued?:     boolean;
}

export interface CostSummaryResponse {
  period:        string;   // "2026-09"
  section:       CostSection;
  from_date:     string;
  to_date:       string;
  /** The day the sheet answers for; month-end costs are pro-rated to it. */
  as_of:         string;
  is_closed:     boolean;
  /** The whole month asked for, on a month that is over: nothing left to estimate. */
  is_settled:    boolean;
  /** "uploaded" (minehub.cost_plan) or "seed". */
  plan_source:   string;
  /** False when nothing has posted yet and every figure is accrual. */
  has_postings:  boolean;
  days_in_month: number;
  days_elapsed:  number;
  accrual_factor: number;
  production_mt: number;
  lines:         CostLine[];
}

export interface CostCurvePoint {
  date:              string;
  day:               number;
  daily:             number;
  form:              number;
  feed:              number;
  month_end_accrued: number;
  month_end_posted:  number;
  month_end_used:    number;
  total_cost:        number;
  cum_qty_mt:        number;
  rs_per_mt:         number | null;
}

export interface CostCurveResponse {
  period:          string;
  section:         CostSection;
  days_in_month:   number;
  days_elapsed:    number;
  plan_month_end:  number;
  series:          CostCurvePoint[];
}

export interface CostBucketCoverage {
  bucket:   CostBucket;
  source:   string;      // "actual" | "plan, prorated"
  actual:   number;
  plan:     number;
  has_plan: boolean;
}

export interface CostCoverageResponse {
  period:  string;
  section: CostSection;
  buckets: CostBucketCoverage[];
  posting_lag: {
    accrued_on:          string;
    median_lag_days:     number | null;
    late_posted_lines:   number;
    late_posted_amount:  number;
    detail: {
      gl: string; description: string;
      accrual_date: string | null; post_date: string | null;
      lag_days: number | null; amount: number;
    }[];
  };
  warnings: string[];
}

export interface CostGlRow {
  gl_account:     string;
  gl_description: string;
  summary_line:   string;
  bucket:         CostBucket;
  cost_centre:    string;
  amount:         number;
  lines:          number;
}

export interface CostGlDetailResponse {
  period:       string;
  section:      CostSection;
  summary_line: string | null;
  rows:         CostGlRow[];
}
