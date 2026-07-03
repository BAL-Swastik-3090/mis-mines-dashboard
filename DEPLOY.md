# Deployment Manifest — Kaliapani Mines Dashboard

Track all modified/new files here before each server deployment.
Copy the files listed under the **Pending** section to the server, then move them to **Deployed**.

---

## How to deploy

```bash
# From your local machine, SCP each file to the server:
scp <local_path> user@80.9.2.78:<server_path>

# Then restart the backend:
sudo systemctl restart mines-backend
# or if using docker:
docker compose -f docker-compose.prod.yml restart backend
```

---

## 🟡 Pending Deployment

### Session: 2026-06-29 — Fuel Management System

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `backend/app/services/fuel_management.py` | `/opt/mines_dashboard/backend/app/services/fuel_management.py` | **New** |
| 2 | `backend/app/routers/fuel_management.py` | `/opt/mines_dashboard/backend/app/routers/fuel_management.py` | **New** |
| 3 | `backend/app/main.py` | `/opt/mines_dashboard/backend/app/main.py` | Modified |
| 4 | `frontend/src/types/index.ts` | `/opt/mines_dashboard/frontend/src/types/index.ts` | Modified |
| 5 | `frontend/src/hooks/useFuelManagement.ts` | `/opt/mines_dashboard/frontend/src/hooks/useFuelManagement.ts` | **New** |
| 6 | `frontend/src/components/sections/FuelManagementSection.tsx` | `/opt/mines_dashboard/frontend/src/components/sections/FuelManagementSection.tsx` | Modified |

**What changed:**
- New `/api/fuel-management` endpoint returning today's + yesterday's fleet fuel data + 7-day trend
- Queries both Technoton tables (`mines_technoton_man_utilization` + `mines_technoton_rest_equipment_utilization`) using same `MAX(row_id)` pattern as live tracking
- Full dark-themed Fuel Management dashboard replacing the placeholder
- KPI strip: Total Fleet, Avg Fuel Level, Total Fuel in Tanks, Consumed Today (vs yesterday), Refills Today
- Fuel level distribution donut chart (5 bands: >75%, 50–75%, 20–50%, <20%, No Data)
- Fleet aggregate tank animation using `drawTank()` (same canvas renderer as Live Tracking)
- Alert panel: low fuel vehicles (<20%) + refill event summary
- Vehicle status table with search, inline fuel bars, status badges, est. hours remaining
- 7-day daily consumption trend (area chart via ECharts)
- Top 5 fuel consuming vehicles today (ranked with horizontal bars)
- Backend restart required; frontend rebuild required
- No new pip packages; no DB migrations

---

### Session: 2026-06-29 — Sidebar Restructure + Export HTML

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `frontend/src/contexts/useAppPage.ts` | `/opt/mines_dashboard/frontend/src/contexts/useAppPage.ts` | **New** |
| 2 | `frontend/src/components/layout/AppSidebar.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/AppSidebar.tsx` | **New** |
| 3 | `frontend/src/components/layout/SectionTabBar.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/SectionTabBar.tsx` | **New** |
| 4 | `frontend/src/components/sections/FuelManagementSection.tsx` | `/opt/mines_dashboard/frontend/src/components/sections/FuelManagementSection.tsx` | **New** |
| 5 | `frontend/src/utils/downloadDashboard.ts` | `/opt/mines_dashboard/frontend/src/utils/downloadDashboard.ts` | **New** |
| 6 | `frontend/src/components/layout/MainLayout.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/MainLayout.tsx` | Modified |
| 7 | `frontend/src/app/page.tsx` | `/opt/mines_dashboard/frontend/src/app/page.tsx` | Modified |
| 8 | `frontend/src/hooks/useSectionObserver.ts` | `/opt/mines_dashboard/frontend/src/hooks/useSectionObserver.ts` | Modified |

**What changed:**
- New vertical AppSidebar (MIS Dashboard / Live Tracking / Fuel Management page switcher)
- Old vertical sidebar replaced by horizontal SectionTabBar with scroll-spy + Export HTML button
- LiveTrackingSection moved out of page.tsx — now rendered directly by MainLayout on page switch
- FuelManagementSection added as a placeholder page
- Export HTML button downloads the full MIS Dashboard as a self-contained .html file (inline CSS, canvas snapshots, date range in header)
- No backend changes; frontend rebuild required (`npm run build`)
- No DB migrations; no new packages

---

### Session: 2026-06-29 — Tank PNG Overlay Revert

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `frontend/src/utils/tankRenderer.ts` | `/opt/mines_dashboard/frontend/src/utils/tankRenderer.ts` | Modified |
| 2 | `frontend/src/components/live/VehicleKpiCard.tsx` | `/opt/mines_dashboard/frontend/src/components/live/VehicleKpiCard.tsx` | Modified |
| 3 | `frontend/src/components/live/VehicleModal.tsx` | `/opt/mines_dashboard/frontend/src/components/live/VehicleModal.tsx` | Modified |
| 4 | `frontend/src/app/globals.css` | `/opt/mines_dashboard/frontend/src/app/globals.css` | Modified |
| 5 | ~~`frontend/public/tank-frame.png`~~ | ~~`/opt/mines_dashboard/frontend/public/tank-frame.png`~~ | **Deleted** |

**What changed:**
- Reverted all PNG overlay code — back to pure-canvas `drawTank()` renderer
- Removed `drawLiquid()` function and `_frame` PNG singleton from tankRenderer.ts
- VehicleKpiCard and VehicleModal both restored to single `<canvas>` with `drawTank()`
- `.tank-canvas` CSS class removed; `.vc-tank` and `.modal-tank-canvas` reverted
- `tank-frame.png` deleted from public/ — also delete from server's public folder
- No backend changes; frontend rebuild required

---

### Session: 2026-06-26 — AI Insights (6 Enhancements)

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `backend/app/services/insights.py` | `/opt/mines_dashboard/backend/app/services/insights.py` | Modified |
| 2 | `backend/app/schemas/insights.py` | `/opt/mines_dashboard/backend/app/schemas/insights.py` | Modified |
| 3 | `backend/app/routers/insights.py` | `/opt/mines_dashboard/backend/app/routers/insights.py` | Modified |
| 4 | `backend/app/main.py` | `/opt/mines_dashboard/backend/app/main.py` | Modified |
| 5 | `frontend/src/types/index.ts` | `/opt/mines_dashboard/frontend/src/types/index.ts` | Modified |
| 6 | `frontend/src/components/sections/InsightsSection.tsx` | `/opt/mines_dashboard/frontend/src/components/sections/InsightsSection.tsx` | Modified |

**What changed:**
- Backend restart required (new asyncio 7AM digest scheduler in main.py)
- Frontend rebuild required (`npx next build` or `npm run build`)
- No DB migrations needed
- No new pip packages needed (all deps already in requirements.txt)

---

### Session: 2026-06-26 — Despatch Logic (CUSTOMERNO-based BAL/SUK split)

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `backend/app/services/despatch.py` | `/opt/mines_dashboard/backend/app/services/despatch.py` | Modified |
| 2 | `backend/app/services/insights.py` | `/opt/mines_dashboard/backend/app/services/insights.py` | Modified |
| 3 | `frontend/src/components/kpi/ProductionKpiStrip.tsx` | `/opt/mines_dashboard/frontend/src/components/kpi/ProductionKpiStrip.tsx` | Modified |

**What changed:**
- Despatch actuals now read from `zsd_outbound_despatch.CUSTOMERNO` (BAL / JABAMOYEE)
- Removed all unsynced logic (table refreshes every 15 min)
- Backend restart required; frontend rebuild required

> ⚠️ Note: `insights.py` from the 2026-06-26 AI Insights session supersedes this version — deploy the AI Insights version of `insights.py` only.

---

## ✅ Deployed

_(Move entries here after successful server deployment, with the deployment date.)_

---

## Notes

- Server root is assumed to be `/opt/mines_dashboard/` — adjust if different
- Always restart backend after any `.py` file change
- Always rebuild frontend after any `.tsx` / `.ts` file change
- `.env` file is NEVER deployed via this manifest — manage credentials separately on the server
