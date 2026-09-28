"""Does noting activity actually record it — including when the lock is held?

The bug this replaces was not a crash. Every piece of it "worked": the request
succeeded, the error was caught, the log line was written. The only thing that
did not happen was the one thing that mattered — last_active_at moving. So the
test has to check the timestamp in the database, not that nothing threw.

Four things:
  1. touch() records the session without writing (and cannot fail)
  2. a flush moves last_active_at for real
  3. a flush that loses the lock does not LOSE the activity — the ids come back
     and the next flush covers them
  4. a session that has been ended is not resurrected by a flush in flight
"""
import sys
import time

sys.path.insert(0, r'D:\Projects\Mines\mis-mines-dashboard\backend')

from sqlalchemy import text                            # noqa: E402
from app.database import engine, SessionLocal          # noqa: E402
from app.services import auth                          # noqa: E402

SESS = "digital_apps_user_sessions"
ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'ok  ' if good else 'FAIL'} {name}: {got}"
          + ("" if good else f"  (expected {want})"))


def age(db, sid):
    return db.execute(text(
        f"SELECT TIMESTAMPDIFF(SECOND, last_active_at, NOW()) FROM {SESS} "
        f"WHERE session_id = :s"), {"s": sid}).scalar()


db = SessionLocal()
sid = db.execute(text(
    f"SELECT session_id FROM {SESS} WHERE app_source='MINES' AND is_active=1 "
    f"ORDER BY login_at DESC LIMIT 1")).scalar()
if not sid:
    sid = db.execute(text(
        f"SELECT session_id FROM {SESS} WHERE app_source='MINES' "
        f"ORDER BY login_at DESC LIMIT 1")).scalar()
print(f"using session {sid[:8]}…\n")

print("1. touch() notes the session and writes nothing")
auth._seen.clear()
started = time.monotonic()
auth.touch(db, sid)
took = time.monotonic() - started
check("returned immediately (under 50ms)", took < 0.05, True)
check("session is pending", sid in auth._seen, True)

print("\n2. a flush moves last_active_at")
db.execute(text(
    f"UPDATE {SESS} SET last_active_at = NOW() - INTERVAL 20 MINUTE "
    f"WHERE session_id = :s"), {"s": sid})
db.commit()
check("aged to ~20 minutes", age(db, sid) > 1000, True)
n = auth.flush_touches(db)
check("flushed one session", n, 1)
check("timestamp is now current (< 60s)", age(db, sid) < 60, True)
check("pending list cleared", len(auth._seen), 0)

print("\n3. a flush that cannot have the lock KEEPS the activity")
auth.touch(db, sid)
db.execute(text(
    f"UPDATE {SESS} SET last_active_at = NOW() - INTERVAL 20 MINUTE "
    f"WHERE session_id = :s"), {"s": sid})
db.commit()
blocker = engine.connect()
blocker.execute(text("BEGIN"))
blocker.execute(text(
    f"UPDATE {SESS} SET last_active_at = last_active_at WHERE session_id = :s"),
    {"s": sid})
try:
    # Shorten the wait so the test is not four × fifteen seconds.
    real = auth.FLUSH_LOCK_WAIT, auth.FLUSH_ATTEMPTS
    auth.FLUSH_LOCK_WAIT, auth.FLUSH_ATTEMPTS = 1, 2
    started = time.monotonic()
    n = auth.flush_touches(db)
    print(f"     (took {time.monotonic() - started:.1f}s)")
    auth.FLUSH_LOCK_WAIT, auth.FLUSH_ATTEMPTS = real
    check("reported nothing written", n, 0)
    check("but the session is pending again", sid in auth._seen, True)
finally:
    blocker.execute(text("ROLLBACK"))
    blocker.invalidate()
    blocker.close()
    time.sleep(1)

print("\n   …and the next flush lands it")
n = auth.flush_touches(db)
check("flushed", n, 1)
check("timestamp current (< 60s)", age(db, sid) < 60, True)

print("\n4. ending a session drops its pending activity")
auth.touch(db, sid)
check("pending", sid in auth._seen, True)
auth.forget_session(sid)
check("gone after forget_session", sid in auth._seen, False)

db.close()
print()
print("ALL PASS" if ok else "SOMETHING FAILED")
sys.exit(0 if ok else 1)
