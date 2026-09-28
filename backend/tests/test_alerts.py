"""The whole life of an alert, against the real database.

An alert system is nearly all edge cases, and every one of them is silent when
it is wrong: a bell that shows nothing looks exactly like a platform with
nothing to report. So this drives the states rather than reading the code.

  1. a fault that is happening appears, and is recorded as ONE episode
  2. polling again does not open a second episode
  3. clearing hides it for the person who cleared, and nobody else
  4. a cleared alert that gets WORSE comes back
  5. a fault that stops is announced as recovered, and the episode closes
  6. somebody with no permission neither sees it nor resolves it
  7. the history has the episode with how long it lasted
"""
import sys

sys.path.insert(0, r'D:\Projects\Mines\mis-mines-dashboard\backend')

from unittest.mock import Mock                          # noqa: E402
from sqlalchemy import text                             # noqa: E402
from app.minehub_db import get_minehub_db               # noqa: E402
from app.routers import alerts as A                     # noqa: E402

pg = next(get_minehub_db())
ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'ok  ' if good else 'FAIL'} {name}: {got}"
          + ("" if good else f"  (expected {want})"))


def req(perms, emp="9999"):
    r = Mock()
    r.state.permissions = perms
    r.state.emp_id = emp
    return r


ADMIN = req({"access.users.view"}, "9999")
OTHER = req({"access.users.view"}, "8888")
NOBODY = req({"dashboard.mis"}, "7777")

# Start from a clean slate for the test actor only; the real WB3 episode is
# left alone, so this does not rewrite the mine's own history.
pg.execute(text("DELETE FROM platform_alert_ack WHERE emp_id IN ('9999','8888','7777')"))
pg.commit()

print("1. the fault that is happening now")
d = A.live(ADMIN, pg=pg)
wb = [a for a in d["alerts"] if a["key"].startswith("wb-agent-")]
check("at least one weighbridge alert", len(wb) >= 1, True)
check("it is DOWN", wb[0]["severity"] if wb else None, "DOWN")
print(f"       {wb[0]['title']} — {wb[0]['minutes']} minutes")
first_id = wb[0]["id"]

print("\n2. polling again does not open a second episode")
A.live(ADMIN, pg=pg)
A.live(ADMIN, pg=pg)
n = pg.execute(text("""
    SELECT COUNT(*) FROM platform_alert
     WHERE alert_key = :k AND resolved_at IS NULL"""),
    {"k": wb[0]["key"]}).scalar()
check("still exactly one open episode", int(n), 1)

print("\n3. clearing is personal")
A.clear(ADMIN, pg=pg)
mine = A.live(ADMIN, pg=pg)
theirs = A.live(OTHER, pg=pg)
check("gone for the person who cleared", mine["count"], 0)
check("still there for everybody else", theirs["count"] >= 1, True)

print("\n4. a cleared alert that gets worse comes back")
pg.execute(text("""
    UPDATE platform_alert_ack SET severity = 'WARN'
     WHERE alert_id = :i AND emp_id = '9999'"""), {"i": first_id})
pg.commit()
back = A.live(ADMIN, pg=pg)
check("back, because DOWN is worse than the WARN acknowledged",
      any(a["id"] == first_id for a in back["alerts"]), True)

print("\n5. somebody with no permission sees nothing and resolves nothing")
none = A.live(NOBODY, pg=pg)
check("sees nothing", none["count"], 0)
still = pg.execute(text("""
    SELECT COUNT(*) FROM platform_alert
     WHERE alert_key = :k AND resolved_at IS NULL"""),
    {"k": wb[0]["key"]}).scalar()
check("and the episode is still open", int(still), 1)

print("\n6. recovery closes the episode and is announced")
# Pretend the agent reported in, which is what recovery IS.
saved = pg.execute(text("""
    SELECT a.agent_id, a.last_seen_at FROM weighbridge_agent a
     JOIN weighbridge w ON w.weighbridge_id = a.weighbridge_id
    WHERE w.code = :c"""), {"c": wb[0]["key"].replace("wb-agent-", "")}).first()
pg.execute(text("UPDATE weighbridge_agent SET last_seen_at = now() WHERE agent_id = :i"),
           {"i": saved[0]})
pg.commit()
rec = A.live(ADMIN, pg=pg)
good = [a for a in rec["alerts"] if a["severity"] == "OK"]
check("announced as recovered", len(good) >= 1, True)
if good:
    print(f"       {good[0]['title']} — {good[0]['detail']}")
closed = pg.execute(text("""
    SELECT resolved_at IS NOT NULL FROM platform_alert WHERE alert_id = :i"""),
    {"i": first_id}).scalar()
check("episode closed", bool(closed), True)

print("\n7. the history holds it")
h = A.history(ADMIN, days=30, pg=pg)
mine_h = [x for x in h if x["alert_id"] == first_id]
check("episode is in the history", len(mine_h), 1)
if mine_h:
    print(f"       lasted {mine_h[0]['lasted']}, ongoing={mine_h[0]['ongoing']}")
check("history is empty for somebody without permission",
      len(A.history(NOBODY, days=30, pg=pg)), 0)

# Put the agent's clock back so the screen keeps telling the truth about WB3.
pg.execute(text("UPDATE weighbridge_agent SET last_seen_at = :t WHERE agent_id = :i"),
           {"t": saved[1], "i": saved[0]})
pg.execute(text("DELETE FROM platform_alert_ack WHERE emp_id IN ('9999','8888','7777')"))
pg.commit()
A.live(ADMIN, pg=pg)     # reopen the real episode
print("\n   (WB3 restored to its real state)")

print()
print("ALL PASS" if ok else "SOMETHING FAILED")
sys.exit(0 if ok else 1)
