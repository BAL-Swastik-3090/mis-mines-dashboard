"""Does a contended touch actually let go after two seconds?

The previous test fed `_best_effort` a fake exception and proved the retry
logic branches correctly. It could not have caught this bug, because the bug
was never in the branching — it was in how long the statement sat there before
the exception arrived. That is not something a fake can tell you.

So this takes a real row lock on the real table, on a connection of its own,
and then asks the real `touch()` to write the same row. What is measured is
wall-clock: how long the housekeeping write holds its connection when it cannot
have the lock.

Before the fix that is ~50 seconds per attempt (balcorpdb's
innodb_lock_wait_timeout), twice. After, ~2 seconds, twice.

It also checks the thing that would be worse than the bug: that the connection
does not go back to the pool still carrying our 2-second timeout, which would
hand an unrelated write a mysterious failure later.
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


# A real session row to fight over — whichever one exists; nothing is changed
# that a live touch would not change anyway.
probe = SessionLocal()
sid = probe.execute(text(
    f"SELECT session_id FROM {SESS} ORDER BY login_at DESC LIMIT 1")).scalar()
probe.close()
if not sid:
    print("no session rows to test against — skipping")
    sys.exit(0)
print(f"contending over session {sid[:8]}…\n")

# Hold an exclusive lock on that row and do not let go.
blocker = engine.connect()
blocker.execute(text("BEGIN"))
blocker.execute(text(
    f"UPDATE {SESS} SET last_active_at = last_active_at WHERE session_id = :s"),
    {"s": sid})

try:
    db = SessionLocal()
    print("a touch that cannot have the lock")
    started = time.monotonic()
    auth.touch(db, sid)                 # must not raise, must not linger
    took = time.monotonic() - started
    print(f"  took {took:.1f}s")
    check("gave up in under 10s (was ~100s)", took < 10, True)
    check("did not raise", True, True)

    print("\nthe connection is not handed back carrying our 2s timeout")
    after = db.execute(text("SELECT @@SESSION.innodb_lock_wait_timeout")).scalar()
    srv = db.execute(text("SELECT @@GLOBAL.innodb_lock_wait_timeout")).scalar()
    check("session timeout back to the server's", int(after), int(srv))
    db.close()
finally:
    # Close the physical connection, not just return it to the pool. A pooled
    # connection handed back still owns its locks until it is reused, and the
    # "uncontended" check below would then measure contention with itself —
    # which is exactly what it did on the first run of this test.
    blocker.execute(text("ROLLBACK"))
    blocker.invalidate()
    blocker.close()
    time.sleep(1)

print("\nand an uncontended touch still works")
db2 = SessionLocal()
started = time.monotonic()
auth._last_touch.pop(sid, None)
auth.touch(db2, sid)
took = time.monotonic() - started
print(f"  took {took:.2f}s")
check("fast", took < 3, True)
wrote = db2.execute(text(
    f"SELECT TIMESTAMPDIFF(SECOND, last_active_at, NOW()) FROM {SESS} "
    f"WHERE session_id = :s"), {"s": sid}).scalar()
check("timestamp actually written (seconds old)", int(wrote) <= 5, True)
db2.close()

print()
print("ALL PASS" if ok else "SOMETHING FAILED")
sys.exit(0 if ok else 1)
