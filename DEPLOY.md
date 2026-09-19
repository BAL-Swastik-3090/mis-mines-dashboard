# Deployment Manifest — Kaliapani Mines Dashboard

Track all modified/new files here before each server deployment.
Copy the files listed under the **Pending** section to the server, then move them to **Deployed**.

---

## How to deploy

```bash
# From your local machine, SCP each file to the server:
scp <local_path> <user>@<server>:<server_path>

# Then restart the backend:
sudo systemctl restart mines-backend
# or if using docker:
docker compose -f docker-compose.prod.yml restart backend
```

---

## Production — mines.balasorealloys.in

Since 2026-09-12 the dashboard runs as a docker compose project on the shared
application server. Host, user and credentials are held by IT and deliberately
kept out of this repo.

| Item | Value |
|---|---|
| Project dir | `<app-root>/mines_dashboard` on the application server |
| Frontend | `mines_frontend` — Next.js standalone, `127.0.0.1:4012` |
| Backend | `mines_backend` — FastAPI/gunicorn, `127.0.0.1:8006` |
| Cache | `mines_redis` (internal only) |
| Compose network | `mines_network`, subnet pinned to `10.230.1.0/24` |
| Domain | `mines.balasorealloys.in` → host nginx → 4012 (`/api/` → 8006) |
| TLS | shared wildcard `*.balasorealloys.in` (`/etc/ssl/certs/fullchain.crt`) |

**Two rules for this box — it hosts ~20 other BAL apps behind one host nginx:**

1. The repo's bundled `nginx` service publishes host **80/443** and would collide
   with the host nginx. `docker-compose.override.yml` puts it in the `disabled`
   profile — never run the stack without that override.
2. The compose network subnet is pinned. The default-assigned `192.168.16.0/20`
   could **not** reach the shared MySQL host on port 3306 (errno 110) even though the
   host itself could. `10.230.1.0/24` works.

```bash
# deploy an update
cd <app-root>/mines_dashboard
git archive --remote=... | tar -x      # or scp the changed files
docker compose build && docker compose up -d

# nginx vhost (needs sudo; file is staged in deploy/)
sudo install -m 644 -o root -g root deploy/mines.balasorealloys.in   /etc/nginx/sites-available/mines.balasorealloys.in
sudo ln -sfn /etc/nginx/sites-available/mines.balasorealloys.in   /etc/nginx/sites-enabled/mines.balasorealloys.in
sudo nginx -t && sudo systemctl reload nginx
```

`.env` lives in the project directory on the server (mode 600) and is never in git.

---

## Deployed — 2026-09-19: MineHub workforce, notes, Superadmin rename

Released `minehub-workforce-release` (commit `776dd6d`) to mines.balasorealloys.in.

Method: `git archive` of the release tag, extracted over `~/mines_dashboard`,
then `docker compose build && docker compose up -d` from that directory. The
default `docker-compose.yml` + `docker-compose.override.yml` pair, which is what
the running stack was already using — confirmed from the container labels before
touching anything, because the `prod` file does **not** auto-load the override
and the bundled nginx would have taken host 80/443 from every other app.

Verified after: site 200; the workforce, notes and ops routes answering; all 70
other containers on the box holding the same ids, none restarted; nothing
publishing 80/443. Previous state backed up to
`~/mines_dashboard-backup-<timestamp>.tar.gz` on the server.

New in the image: `openpyxl` 3.1.5, for the roster import and export.

### ⚠ Still needed before MineHub works on production

The production `.env` has no Postgres block, so every MineHub screen — the
registry, operators, workforce, notes, shift control — reports "not configured"
and the read-only dashboards carry on unaffected. This was already true before
this release; the new features simply make it more visible.

The server can reach `192.168.10.27:5432` directly, so only configuration is
missing:

```
PG_HOST=192.168.10.27
PG_PORT=5432
PG_DATABASE=corpappdb
PG_USER=postgres
PG_PASSWORD=<held by IT, not in this repo>
PG_SCHEMA=minehub
PG_SSLMODE=prefer
```

Then `docker compose up -d backend` to pick it up.

**A decision goes with it:** those settings point at the same database the
development machine uses. One schema shared between dev and production means a
migration applied while building is a migration applied to live data, and a
purge run locally empties the production register. If the two should be
separate, production needs its own database or its own schema, and migrations
001–031 run against it once.

---

## 🟡 Pending Deployment

### Session: 2026-09-12 — Access Control screen (super admin)

| # | Local File | Type |
|---|-----------|------|
| 1 | `scripts/sql/002_mines_role_page_access.sql` | **New** — run once |
| 2 | `backend/app/services/auth.py` | Modified — page-access map + cache |
| 3 | `backend/app/routers/roles.py` | Modified — `/roles/pages` GET+PUT |
| 4 | `backend/app/main.py` | Modified — page gate in middleware |
| 5 | `frontend/src/components/sections/AccessControlSection.tsx` | **New** |
| 6 | `frontend/src/components/layout/AppSidebar.tsx` | Modified — admin entry, filtered nav |
| 7 | `frontend/src/components/layout/MainLayout.tsx` | Modified |
| 8 | `frontend/src/components/layout/AuthWrapper.tsx` | Modified — revoked-page guard |
| 9 | `frontend/src/contexts/useAppPage.ts`, `useAuth.ts` | Modified |

**What it does:** an in-app screen, visible only to `admin`, managing (a) who has
which role and (b) a role x page matrix. Enforced on the API prefixes behind each
page — `PREFIX_PAGE` in `services/auth.py` — so unticking a box blocks the data,
not just the sidebar entry.

**Lockout guards:** Access Control is not in the matrix (gated on the admin role
itself); a save that leaves admin with no pages is rejected; you cannot strip
your own role; and a missing/empty table falls back to allow-everything.

**Caching:** the matrix is held in-process for 60s (a page load fires ~15 API
calls and the MySQL server refuses connections daily). Saving invalidates it, so
changes apply immediately.

**Gotcha for anyone extending this:** `sap_employee_details.STATUS` is
`'Active'`/`'Withdrawn'`. It is NOT the `'A'` flag used by `intranet_user_login`.
Filtering it on `'A'` matches zero of 1300 rows.

Deploy: run `002_mines_role_page_access.sql`, then rebuild both images.

---

### Session: 2026-09-12 — Intranet SSO login + access control

| # | Local File | Type |
|---|-----------|------|
| 1 | `backend/app/services/auth.py` | **New** |
| 2 | `backend/app/routers/auth.py` | Rewritten |
| 3 | `backend/app/routers/roles.py` | **New** |
| 4 | `backend/app/main.py` | Modified — auth middleware |
| 5 | `frontend/src/contexts/useAuth.ts` | **New** |
| 6 | `frontend/src/components/layout/AuthWrapper.tsx` | Modified |
| 7 | `frontend/src/components/layout/LoginScreen.tsx` | Modified |
| 8 | `frontend/src/components/layout/AppSidebar.tsx` | Modified |
| 9 | `scripts/sql/001_mines_user_role.sql` | **New** — run once before deploying |

**Why:** the previous login was cosmetic. `/auth/login` returned
`mock-session-token-<EMPID>` and the UI gated on that string being present in
localStorage, so anyone could grant themselves access from the browser console —
and every `/api/*` route was unauthenticated regardless, serving production and
despatch data to any unauthenticated caller.

**What changed:**
- Real server-side sessions in `digital_apps_user_sessions` (`app_source='MINES'`),
  keyed by a 64-hex `secrets.token_hex` id in an **httpOnly** cookie. Nothing is
  stored client-side; the UI asks `/api/auth/me` who it is talking to.
- Middleware in `main.py` gates every `/api/*` route except `/api/auth/*`,
  `/api/health` and the docs. New routers are protected by default.
- Page views recorded to `digital_apps_page_views` on every page switch.
- Access roles (`viewer`/`manager`/`admin`) in the new `mines_user_role` table.
  Everyone signing in is a viewer; only `/api/roles` requires admin today. Page
  restrictions are a one-line addition to `_ROLE_RULES` in `main.py`.
- Session-touch throttled to 30s — one page load fires ~15 API calls and the
  MySQL server is already refusing connections daily.

**Deploy order matters:**
1. Run `scripts/sql/001_mines_user_role.sql` (edit the seed EMPID first).
2. Backend restart + frontend rebuild — both required.

No new pip or npm packages.

---

### Session: 2026-09-12 — Intelligence Page (Reality Check + AI Insights)

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `frontend/src/contexts/useAppPage.ts` | `/opt/mines_dashboard/frontend/src/contexts/useAppPage.ts` | Modified |
| 2 | `frontend/src/components/layout/AppSidebar.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/AppSidebar.tsx` | Modified |
| 3 | `frontend/src/components/layout/MainLayout.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/MainLayout.tsx` | Modified |
| 4 | `frontend/src/components/layout/SectionTabBar.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/SectionTabBar.tsx` | Modified |
| 5 | `frontend/src/app/page.tsx` | `/opt/mines_dashboard/frontend/src/app/page.tsx` | Modified |
| 6 | `frontend/src/components/sections/IntelligenceSection.tsx` | `/opt/mines_dashboard/frontend/src/components/sections/IntelligenceSection.tsx` | **New** |

**What changed:**
- New **"Intelligence"** sidebar page (Sparkles icon, placed after OEE / LCM) that hosts **Reality Check** + **AI Insights**
- Reality Check & AI Insights **removed from the MIS dashboard** (page.tsx scroll sections + SectionTabBar top-tabs) — MIS now ends at Dewatering
- New `IntelligenceSection` page: navy+gold banner + `RealityCheckSection` + `InsightsSection` (both keep their own titled cards)
- **Frontend-only** change — **frontend rebuild required** (`npm run build`)
- No backend changes; no new npm packages; no DB migrations
- Verified: local `next build` passes; `tsc --noEmit` clean

---

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
