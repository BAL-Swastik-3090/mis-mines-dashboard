# Deploying `why-why-merge-21-09-2026`

Branch: **`why-why-merge-21-09-2026`** — my corrections/roster work plus the
team's five Why-Why commits, cherry-picked because the two histories share no
ancestor.

---

## Before you start: the one thing that will bite

The new backend reads `QWEN_BASE_URL` / `QWEN_API_KEY` / `QWEN_MODEL`. The
server's `.env` does not have them yet. If the new backend starts without the
key, the charts still render — they are pure SQL — but **Why-Why → narrative
and training return 502**.

So the `.env` edit happens *before* the containers come up, not after. Three
lines, appended to `<app-root>/mines_dashboard/.env` (mode 600), values taken
from your `Downloads/env 2`:

```
QWEN_BASE_URL=https://chat.balasorealloys.in
QWEN_API_KEY=<from your file>
QWEN_MODEL=qwen3-32b
```

`QWEN_BASE_URL` carries **no** `/v1` — the service appends it.

Do this yourself on the box. The key should not pass through a chat transcript
or a commit.

---

## Schema: nothing to do

Production and this workspace share the same Postgres (`corpappdb`, schema
`minehub`), so migrations 043 and 044 went live when they were applied here
earlier today. There is **no migration step in this deploy and no schema
downtime**.

Both are additive — 043 creates a new table, 044 adds a nullable column — so
the currently-running production code is unaffected by them and has been since
this morning. Nothing to roll back on the database side either.

---

## The sequence, ordered for minimum downtime

The expensive part is the image build, and it costs nothing while the old
containers keep serving. Only the last step interrupts anybody.

```bash
cd <app-root>/mines_dashboard

# 1. snapshot what is running, so the diff afterwards is meaningful
docker ps --format '{{.Names}}\t{{.Status}}' | sort > /tmp/containers-before.txt
wc -l < /tmp/containers-before.txt        # expect 77

# 2. bring the code across (no service touched yet)
git fetch origin
git checkout why-why-merge-21-09-2026
git pull --ff-only

# 3. add the three QWEN_ lines to .env now — see above

# 4. build both images. Old containers keep serving throughout;
#    this is the slow step and it is free.
docker compose build backend frontend

# 5. the only interruption: swap both at once, so the API and the UI
#    never disagree about what the payload looks like.
docker compose up -d backend frontend
```

Step 5 is the whole downtime: two container restarts. FastAPI/gunicorn and a
Next standalone server both come back in seconds. Bringing them up together
rather than one at a time matters — `types/index.ts` changed alongside the
insights router, so a window where the new UI talks to the old API is a window
where Why-Why renders wrong.

Do **not** run `docker compose up -d` bare. The repo's bundled `nginx` service
publishes host 80/443 and would collide with the host nginx that fronts ~20
other BAL apps. Naming the two services avoids it; the server's
`docker-compose.override.yml` puts nginx in the `disabled` profile as a second
guard, and that override must stay in place.

---

## Checks after

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | sort > /tmp/containers-after.txt
diff /tmp/containers-before.txt /tmp/containers-after.txt   # only mines_* restarted
```

Then, signed in at `mines.balasorealloys.in`:

| Check | Expect |
|---|---|
| Intelligence → Why-Why | charts render immediately (no LLM involved) |
| Why-Why → narrative | prose within ~20s, no 502 |
| Why-Why → training | topics within ~15s |
| Manpower → Attendance → Fix | worker picker lists people, shift mode offers A/B/C/General |
| Workforce Planning → roster | Department and Job filters present, header select-all works |

Measured locally on this branch against live data: 345 breakdowns, 38 machines,
14,101.7 breakdown hours, ₹16.75 lakh repair cost over Apr–Aug 2026; narrative
21.2s / 2,911 tokens, training 14.5s / 3,075 tokens, both reporting zero
unverified numbers.

---

## Rolling back

Nothing in this release changes data shape, so a rollback is only the images:

```bash
git checkout <previous ref>        # 42af40a was the last production deploy
docker compose build backend frontend
docker compose up -d backend frontend
```

The three `QWEN_` lines can stay in `.env` — the old code ignores them.

---

## Not yet verified

- **Nobody has clicked through the Why-Why UI.** The backend is exercised
  end to end, the frontend typechecks, but the section has not been opened in
  a browser by a person.
- **No production `next build` has been run.** The Docker build in step 4 is
  the first one. If it fails it fails before step 5, so it costs time rather
  than uptime — but budget for that possibility.
