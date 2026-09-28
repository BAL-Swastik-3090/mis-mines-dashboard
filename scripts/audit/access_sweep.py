"""Who has a login and no access, and who has access and no login.

Biswajit had signed in nineteen times holding no roles at all — every visit met
a screen telling him he had no access, and nobody knew because nothing looks
for it. That is a whole category of failure: the platform is working exactly as
configured, and the configuration is the problem.

Two directions, and they are different problems with different owners:

  ARRIVED AND WAS TURNED AWAY   somebody was given a login, tried to use the
                                platform, and got nothing. Either finish
                                granting them access or tell them why not.

  GRANTED AND NEVER ARRIVED     somebody holds live roles and has never signed
                                in, or not for a long time. Either they do not
                                need it, or nobody showed them.

Reported, not acted on. Revoking somebody's access because a report says they
are quiet is how a man comes back from three weeks' leave locked out.
"""
import sys
from datetime import date, timedelta

sys.path.insert(0, "/app")

from sqlalchemy import text                             # noqa: E402
from app.database import SessionLocal as MySQL          # noqa: E402
from app.minehub_db import SessionLocal as PG           # noqa: E402

my, pg = MySQL(), PG()
APP = "MINES"

# Everyone holding a live role, and what they hold.
granted = {}
for r in pg.execute(text("""
    SELECT ua.emp_id, STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name) AS roles
      FROM user_access ua
      JOIN role r ON r.role_id = ua.role_id AND r.status = 'ACTIVE'
     WHERE ua.valid_to IS NULL
     GROUP BY ua.emp_id
""")).all():
    granted[r[0]] = r[1]

# Everyone who has ever signed in to this application.
seen = {}
for r in my.execute(text("""
    SELECT emp_id, MAX(emp_name), MAX(department), COUNT(*),
           MAX(login_at), MIN(login_at)
      FROM digital_apps_user_sessions
     WHERE app_source = :a
     GROUP BY emp_id
"""), {"a": APP}).all():
    seen[r[0]] = {"name": r[1], "dept": r[2], "sessions": int(r[3]),
                  "last": r[4], "first": r[5]}

# Names for people who hold a role but never signed in.
master = {}
for r in my.execute(text("""
    SELECT EMPID, EMPNAME, EMPDEPT, EMPDESG FROM sap_employee_details_new
""")).all():
    key = str(r[0] or "").strip().lstrip("0")
    if key:
        master[key] = (r[1], r[2], r[3])


def who(emp):
    if emp in seen and seen[emp]["name"]:
        return seen[emp]["name"], seen[emp]["dept"] or "—"
    m = master.get(str(emp).lstrip("0"))
    return (m[0], m[1] or "—") if m else ("(not in the employee master)", "—")


print("=" * 78)
print("ARRIVED AND WAS TURNED AWAY — signed in, holds no role")
print("=" * 78)
turned_away = sorted(
    ((e, v) for e, v in seen.items() if e not in granted),
    key=lambda x: -x[1]["sessions"])
if not turned_away:
    print("  nobody — everyone who has signed in holds something")
for emp, v in turned_away:
    name, dept = who(emp)
    print(f"  {emp:<8}{name[:26]:<28}{dept[:18]:<20}"
          f"{v['sessions']:>4} sign-ins   last {str(v['last'])[:16]}")

print()
print("=" * 78)
print("GRANTED AND NEVER ARRIVED — holds a live role, never signed in")
print("=" * 78)
never = sorted(e for e in granted if e not in seen)
if not never:
    print("  nobody")
for emp in never:
    name, dept = who(emp)
    print(f"  {emp:<8}{name[:26]:<28}{dept[:18]:<20}{granted[emp][:40]}")

print()
print("=" * 78)
print("QUIET — holds a role, has not signed in for 30 days")
print("=" * 78)
cut = date.today() - timedelta(days=30)
quiet = sorted(
    ((e, seen[e]) for e in granted
     if e in seen and seen[e]["last"] and seen[e]["last"].date() < cut),
    key=lambda x: x[1]["last"])
if not quiet:
    print("  nobody")
for emp, v in quiet:
    name, dept = who(emp)
    days = (date.today() - v["last"].date()).days
    print(f"  {emp:<8}{name[:26]:<28}{dept[:18]:<20}"
          f"{days:>4}d ago   {granted[emp][:34]}")

print()
print(f"summary: {len(granted)} hold a live role · {len(seen)} have ever signed in "
      f"· {len(turned_away)} turned away · {len(never)} never came · {len(quiet)} quiet")
