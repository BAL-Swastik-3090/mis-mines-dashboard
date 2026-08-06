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
}

export interface BreakdownEvent {
  notification_no: string;
  start:   string | null;
  end:     string | null;
  bd_hrs:  number | null;
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
  god_hours:      number;
  holiday_hrs:    number;
  no_plan_hrs:    number;
  planned_sd_hrs: number;
  bd_hours:       number;
  pm_hours:       number;
  operating_hrs:  number;
  actual_cum:     number;
  ideal_cum:      number;
  availability:   number;
  performance:    number;
  quality:        number;
  oee:            number;
}

export interface OEEResponse {
  from_date: string;
  to_date:   string;
  machines:  OEEMachineRow[];
}

