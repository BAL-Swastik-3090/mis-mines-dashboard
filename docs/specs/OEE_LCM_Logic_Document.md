# OEE / LCM Calculation Logic — Kaliapani Chromite Mines

**Project**: Kaliapani Mines Dashboard — Balasore Alloys Limited  
**Module**: OEE (Overall Equipment Effectiveness) for Excavators  
**Prepared**: 2026-07-28  

---

## 1. Scope

OEE is calculated **per excavator machine** only (not tippers).  
There are **5 excavators** in scope:

| Display Name   | Short Code (IMOS) | SAP Equipment No.      | Ideal Capacity (CuM/hr) |
|----------------|-------------------|------------------------|-------------------------|
| TATA-470(7)    | 470-7             | 000000000000700086     | 17.0                    |
| TATA-470(2)    | 470-2             | 000000000000700042     | 17.0                    |
| TATA-370(5)    | 370-5             | 000000000000700064     | 39.0                    |
| TATA-370(4)    | 370-4             | 000000000000700053     | 39.0                    |
| TATA-220(8)    | 220-8             | 000000000000700090     | 29.0                    |

---

## 2. OEE Formula

```
OEE (%) = Availability × Performance × Quality
```

Where each component is expressed as a decimal (0–1) and the final result is multiplied by 100.

### 2.1 Availability

```
Availability (%) = Operating Hours / God Hours × 100
```

### 2.2 Performance

```
Performance (%) = Actual Excavation (CuM) / Ideal Production (CuM) × 100

Ideal Production (CuM) = Ideal Capacity (CuM/hr) × Operating Hours
```
- Capped at **100%** maximum.

### 2.3 Quality

```
Quality = 100% (fixed — no quality losses are tracked at this mine)
```

---

## 3. Key Definitions

### God Hours
```
God Hours = Number of days in selected period × 24
```
Example: July 1–27 (27 days) = 648 hours.

### Operating Hours
```
Operating Hours = God Hours
                − Sunday/Weekly Off Hours
                − No Excavation Plan Hours
                − Planned Shutdown Hours
                − Breakdown Hours
                − Preventive Maintenance Hours
```
Operating Hours is capped at minimum **0** (cannot be negative).

---

## 4. Data Sources

### 4.1 Loss Hours (Source: IMOS)
**Table**: `mines_tipper_details`  
**Database**: `balcorpdb`

Three columns store loss hours per excavator per shift entry:

| Column                     | Meaning                        |
|----------------------------|--------------------------------|
| `sunday_holiday_weekly_off`| Sunday / Weekly Off hours      |
| `no_excavation_plan`       | No excavation planned hours    |
| `planned_shut_down_hr`     | Planned shutdown hours         |

**How to match rows to a specific excavator:**  
The column `equipment_name` stores equipment as either:
- **New format (July 2026+)**: Single full name per row — e.g. `TATA-470(7)`
- **Old format (before July 2026)**: CSV of multiple machines — e.g. `470-7,MAN-75,MAN-57,...`

Match using:
```sql
FIND_IN_SET(:short_code, equipment_name) > 0
OR equipment_name = :full_name
```

**Note**: These fields were newly added and will mostly be 0 until field teams start filling them consistently.

---

### 4.2 Breakdown Hours (Source: SAP)
**Table**: `zpm_iw29_notifications`  
**Database**: `balcorpdb`

**Filter conditions:**
```sql
WHERE MAINTENANCE_PLANT = '1200'
  AND NOTIFICATION_TYPE = 'M2'
  AND MAIN_WORK_CENTER  = 'MINEAUTO'
  AND EQUIPMENT         = :sap_equipment_number
  AND MALFUNCTION_START BETWEEN :from_date AND :to_date
```

**Duration column**: `BREAKDOWN_DURAION`  
**Unit**: The values are stored in **seconds** (despite the unit column showing 'H').  
**Conversion to hours**:
```sql
SUM(BREAKDOWN_DURAION) / 3600.0
```

---

### 4.3 Preventive Maintenance Hours (Source: SAP)
**Table**: `mm_plant_maint_calibration`  
**Database**: `balcorpdb`

**Filter conditions:**
```sql
WHERE ORDER_TYPE      = 'BA03'
  AND PLANT           = '1200'
  AND MAIN_WORK_CTR   = 'MINEAUTO'
  AND EQUIPMENT_NO    = :sap_equipment_number
  AND BASIC_START_DATE BETWEEN :from_date AND :to_date
```

**Duration calculation** (temporary — SAP team is adding time columns):
```sql
DATEDIFF(STR_TO_DATE(COMPLETION_DATE, '%Y-%m-%d'), BASIC_START_DATE) * 24
```
- Records where `COMPLETION_DATE = '0000-00-00'` or `NULL` contribute **0 hours**.
- Once SAP team adds `START_TIME` and `COMPLETION_TIME` columns, update the logic to use exact time difference.

---

### 4.4 Actual Excavation (Source: SAP / IMOS)
**Table**: `mines_tipper_details`  
**Database**: `balcorpdb`

Quantities are stored as **trips** (number of truck loads), not CuM directly.  
**Conversion to CuM:**

| Column        | Material       | Multiplier |
|---------------|----------------|------------|
| `ore_quantity`  | Ore           | × 6        |
| `lg_quantity`   | LG (Low Grade)| × 6        |
| `ob_quantity`   | Overburden    | × 6        |
| `boulder`       | Boulder       | × 6        |
| `tailing`       | Tailing       | × 6        |
| `feed_to_cobp`  | Feed to COB Plant | × 6    |
| `silt_quantity` | Silt          | × 4        |

**Total Actual CuM formula:**
```sql
(ore + lg + ob + boulder + tailing + feed_to_cobp) × 6 + silt × 4
```

All columns are `VARCHAR` — use `CAST(NULLIF(column_name, '') AS DECIMAL(12,2))` to safely convert.

**Row matching** (same as loss hours):
```sql
FIND_IN_SET(:short_code, equipment_name) > 0
OR equipment_name = :full_name
```

---

## 5. Full Calculation Example

**Period**: July 1–27, 2026 (27 days)  
**Machine**: TATA-470(2)

| Step                       | Value      | Source                              |
|----------------------------|------------|-------------------------------------|
| God Hours                  | 648.0 hrs  | 27 × 24                             |
| Weekly Off / Holiday       | 0.0 hrs    | mines_tipper_details (new field)    |
| No Plan                    | 0.0 hrs    | mines_tipper_details (new field)    |
| Planned Shutdown           | 0.0 hrs    | mines_tipper_details (new field)    |
| Breakdown Hours            | 42.21 hrs  | zpm_iw29_notifications / 3600       |
| PM Hours                   | 0.0 hrs    | mm_plant_maint_calibration          |
| **Operating Hours**        | **605.79 hrs** | 648 − 0 − 0 − 0 − 42.21 − 0    |
| Actual Excavation          | 456.0 CuM  | mines_tipper_details (trips × conv) |
| Ideal Capacity             | 17.0 CuM/hr| Fixed config                        |
| Ideal Production           | 10,298 CuM | 17.0 × 605.79                       |
| **Availability**           | **93.49%** | 605.79 / 648 × 100                  |
| **Performance**            | **4.43%**  | 456 / 10298 × 100                   |
| **Quality**                | **100%**   | Fixed                               |
| **OEE**                    | **4.14%**  | 0.9349 × 0.0443 × 1.0 × 100        |

> Note: Low performance is expected in early July — field team data entry for trips is still in progress.

---

## 6. Color Coding (Frontend)

| Metric        | Green (Good) | Amber (Average) | Red (Poor) |
|---------------|-------------|-----------------|------------|
| OEE           | ≥ 75%       | 50–75%          | < 50%      |
| Availability  | ≥ 85%       | 70–85%          | < 70%      |
| Performance   | ≥ 85%       | 70–85%          | < 70%      |
| Quality       | Always green (100%) | —       | —          |

---

## 7. Backend Implementation (FastAPI + SQLAlchemy)

**Files:**
- `backend/app/services/oee.py` — all calculation logic
- `backend/app/schemas/oee.py` — Pydantic response models
- `backend/app/routers/oee.py` — API endpoint

**Endpoint:**
```
GET /api/oee?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
```

**Response shape:**
```json
{
  "from_date": "2026-07-01",
  "to_date":   "2026-07-27",
  "machines": [
    {
      "machine":        "TATA-470(7)",
      "ideal_cap":      17.0,
      "god_hours":      648.0,
      "holiday_hrs":    0.0,
      "no_plan_hrs":    0.0,
      "planned_sd_hrs": 0.0,
      "bd_hours":       74.75,
      "pm_hours":       0.0,
      "operating_hrs":  573.25,
      "actual_cum":     0.0,
      "ideal_cum":      9744.25,
      "availability":   88.46,
      "performance":    0.0,
      "quality":        100.0,
      "oee":            0.0
    }
  ]
}
```

---

## 8. Frontend Implementation (Next.js + TypeScript)

**Files:**
- `frontend/src/types/index.ts` — `OEEMachineRow`, `OEEResponse` interfaces
- `frontend/src/hooks/useOEE.ts` — TanStack Query hook
- `frontend/src/components/sections/OEESection.tsx` — full page component

**Page routing:**
- This is a **standalone sidebar page** (not a tab inside MIS Dashboard).
- `AppPage` type includes `"oee"`.
- `AppSidebar.tsx` — nav item "OEE / LCM" with `Activity` icon, placed below "MIS Dashboard".
- `MainLayout.tsx` — renders `<OEESection />` when `page === "oee"`.

---

## 9. Pending Improvements

1. **PM Hours precision**: SAP team is adding `START_TIME` and `COMPLETION_TIME` columns to `mm_plant_maint_calibration`. Once added, update `_get_pm_hours()` in `oee.py` to use exact time-based duration instead of date-level duration.

2. **Loss hours data**: `sunday_holiday_weekly_off`, `no_excavation_plan`, `planned_shut_down_hr` fields in `mines_tipper_details` are new — field teams need to start entering these values consistently.

3. **Historical data normalization**: Pre-July 2026, `equipment_name` stored multiple machines as a CSV (e.g. `470-7,MAN-75,...`). From July 2026, each row has a single full name (e.g. `TATA-470(7)`). The query already handles both formats via `FIND_IN_SET OR equipment_name =`.
