# Ore Production KPI Card — Calculation Logic
## Kaliapani Chromite Mines Dashboard — Balasore Alloys Limited

**Prepared**: 2026-07-29  
**Module**: Ore Production KPI Card (top of Production section / MIS Dashboard)

---

## 1. What the Card Shows

| Field            | Description                                         |
|------------------|-----------------------------------------------------|
| **MTD Actual**   | Total ore produced (MT) from month start to today   |
| **MTD Plan**     | Total ore planned (MT) for same period              |
| **Variance**     | Actual − Plan (negative = shortfall)                |
| **Achieve %**    | Actual ÷ Plan × 100                                 |
| **Progress Bar** | Visual fill of Achieve %, capped at 100%            |
| **Grade Split**  | HG / MG / LG breakdown of actual (MT)              |
| **TD (Today)**   | Single-day actual and plan for the last day of range|

---

## 2. Data Sources

| Data           | Source Table                    | Database     |
|----------------|---------------------------------|--------------|
| Ore Actual     | `pp_production`                 | `balcorpdb`  |
| Ore Plan       | `mines_daily_excavation_plan`   | `balcorpdb`  |

---

## 3. MTD Actual (Ore Production)

**Table**: `pp_production`

**Key columns used:**

| Column        | Purpose                              |
|---------------|--------------------------------------|
| `PLANT`       | Filter: must be `'1200'` (Mines)     |
| `MATERIAL_NO` | Identifies ore grade (see grade table below) |
| `QUANTITY`    | Tonnes produced — this is summed     |
| `POSTING_DATE`| Date filter                          |

**SQL logic:**
```sql
SELECT
  SUM(CASE WHEN MATERIAL_NO = '000000000025000002' THEN QUANTITY ELSE 0 END) AS hg_actual,
  SUM(CASE WHEN MATERIAL_NO = '000000000025000001' THEN QUANTITY ELSE 0 END) AS mg_actual,
  SUM(CASE WHEN MATERIAL_NO = '000000000025000003' THEN QUANTITY ELSE 0 END) AS lg_actual,
  SUM(CASE WHEN MATERIAL_NO IN (
    '000000000025000002',
    '000000000025000001',
    '000000000025000003'
  ) THEN QUANTITY ELSE 0 END) AS ore_actual
FROM pp_production
WHERE PLANT       = '1200'
  AND POSTING_DATE BETWEEN :from_date AND :to_date
```

**Important notes:**
- `PLANT = '1200'` is the plant code for Kaliapani Mines. Change this if your plant code is different.
- No deduplication is applied — every row that matches is summed directly.
- No work-center filter is needed for ore production (unlike excavation re-handling which filters by `WORK_CENTER = 'MINE_EXV'`).

---

## 4. Grade Breakdown (HG / MG / LG)

The grade split is entirely determined by the SAP `MATERIAL_NO` value. There is no mathematical grade calculation — SAP classifies production into one of three material numbers when posting.

| Grade Label | Material No.           | Cr₂O₃ Threshold |
|-------------|------------------------|-----------------|
| HG          | `000000000025000002`   | > 52%           |
| MG          | `000000000025000001`   | 40 – 52%        |
| LG          | `000000000025000003`   | < 40%           |

- `ore_actual = hg_actual + mg_actual + lg_actual`
- The card shows actual MT for each grade. No grade-level achieve% is shown — only total ore has achieve%.

---

## 5. MTD Plan (Ore Plan)

**Table**: `mines_daily_excavation_plan`

**Key columns used:**

| Column      | Purpose                                      |
|-------------|----------------------------------------------|
| `Prod_date` | Date filter                                  |
| `ORE_QTY`   | Daily ore plan (MT) — summed over date range |
| `HG_QTY`    | Daily HG plan (used in some views)           |
| `MG_QTY`    | Daily MG plan                                |
| `LG_QTY`    | Daily LG plan                                |

**SQL logic:**
```sql
SELECT SUM(ORE_QTY) AS ore_plan
FROM mines_daily_excavation_plan
WHERE Prod_date BETWEEN :from_date AND :to_date
```

**Important notes:**
- No PLANT filter — this table contains only mines plan data by design.
- The plan table has one row per shift per location per day, so SUM across all rows gives the full MTD plan.
- `ORE_QTY` is a numeric column — direct SUM, no CAST needed.

---

## 6. Achieve % and Variance

**Achieve %** — computed in the **backend**:
```python
mtd_pct = round(ore_actual / ore_plan * 100, 1) if ore_plan and ore_plan != 0 else None
```
- Returns `None` (displayed as `—`) if plan is 0 or missing.

**Variance** — computed in the **frontend**:
```typescript
const variance = mtd_actual - mtd_plan  // negative = shortfall
```
- Displayed in red when negative (with `−` prefix), green when positive (with `+` prefix).

---

## 7. Today's Values (TD Footer)

The "TD" row shows the **last day of the selected date range** (not necessarily today's calendar date).  
If the user selects a full month, it shows the last date of that month.

**Today's Actual:**
```sql
SELECT SUM(CASE WHEN MATERIAL_NO IN (:hg, :mg, :lg) THEN QUANTITY ELSE 0 END) AS ore_total
FROM pp_production
WHERE PLANT        = '1200'
  AND POSTING_DATE = :to_date   -- single day only
```

**Today's Plan:**
```sql
SELECT SUM(ORE_QTY) AS ore_plan
FROM mines_daily_excavation_plan
WHERE Prod_date = :to_date   -- single day only
```

**Today's Achieve %** — computed in the backend same way as MTD:
```python
today_pct = round(today_actual / today_plan * 100, 1) if today_plan and today_plan != 0 else None
```

---

## 8. Progress Bar Color Thresholds

| Achieve %   | Bar Color  |
|-------------|------------|
| ≥ 90%       | Green      |
| ≥ 60%       | Amber/Yellow|
| > 0%        | Red        |
| 0%          | Red        |

Bar fill is capped at 100% even if actual exceeds plan — the bar never overflows visually.

---

## 9. Date Range Logic (Default Values)

When no date parameters are passed to the API:
```python
from_date = today.replace(day=1)   # first day of current month
to_date   = today                  # today
```

The frontend date filter passes `from_date` and `to_date` as query parameters. The user can switch between:
- **Date range** mode (custom from/to)
- **Month** mode (full calendar month)
- **Financial Year** mode (April 1 to March 31)

The KPI card always uses whatever `from_date` / `to_date` the date filter provides.

---

## 10. API Endpoint

```
GET /api/production/summary?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
```

**Response excerpt (ore section):**
```json
{
  "ore": {
    "mtd_actual":  14546.0,
    "mtd_plan":    30798.0,
    "mtd_pct":     47.2,
    "today_actual": 0.0,
    "today_plan":  1062.0,
    "today_pct":   0.0,
    "hg_actual":   0.0,
    "mg_actual":   9450.0,
    "lg_actual":   5096.0
  }
}
```

Variance (`-16,252`) and grade labels are not in the API response — they are derived in the frontend.

---

## 11. Full Data Flow

```
User selects date range (Zustand store)
  ↓
useProductionSummary hook (TanStack Query)
  ↓
GET /api/production/summary?from_date=&to_date=
  ↓
  backend:
  ├── pp_production (PLANT=1200, MATERIAL_NO in [HG/MG/LG])
  │     → hg_actual, mg_actual, lg_actual, ore_actual (MTD)
  │     → ore_actual for single day (today_actual)
  └── mines_daily_excavation_plan (SUM ORE_QTY)
        → ore_plan (MTD)
        → ore_plan for single day (today_plan)
  ↓
  backend computes: mtd_pct, today_pct
  ↓
  frontend computes: variance = actual - plan
  ↓
KPI Card renders:
  - Large number: mtd_actual (MT)
  - Plan: mtd_plan, Var: variance
  - Achieve badge: mtd_pct %
  - Progress bar (color-coded)
  - Grade rows: HG / MG / LG (actual MT only)
  - TD footer: today_actual vs today_plan, today_pct %
  - Source labels: PLAN · IMOS, ACTUAL · SAP
```

---

## 12. Key Constants to Replicate

If implementing this in another project, change only these values:

| Constant               | Value in This Project      | Change to          |
|------------------------|----------------------------|--------------------|
| `PLANT_MINES`          | `'1200'`                   | Your SAP plant code |
| HG material number     | `'000000000025000002'`     | Your SAP material  |
| MG material number     | `'000000000025000001'`     | Your SAP material  |
| LG material number     | `'000000000025000003'`     | Your SAP material  |
| Actuals table          | `pp_production`            | Your actuals table |
| Actuals quantity col   | `QUANTITY`                 | Your quantity col  |
| Actuals date col       | `POSTING_DATE`             | Your date col      |
| Plan table             | `mines_daily_excavation_plan` | Your plan table |
| Plan quantity col      | `ORE_QTY`                  | Your plan col      |
| Plan date col          | `Prod_date`                | Your plan date col |
