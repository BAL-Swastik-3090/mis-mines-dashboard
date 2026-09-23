"""Apply migration 053, and first repair the ledger it has to run behind.

WHY THIS EXISTS RATHER THAN JUST RUNNING migrate.py

Migrations 045 to 052 were applied by hand during the market build and never
recorded in schema_migration. The runner therefore believes 044 is the newest
and would re-run all eight on its way to 053. Most are written to survive that;
047 is not. It seeds market_source with a row coded OMC_NOTICES, which 048
renames to OMC_PRICES — so a second pass inserts the old code again beside the
renamed one and 048's rename then collides with it. Two sources for one site is
how a price series quietly gains a duplicate.

So the eight are marked applied instead of re-run, and only after checking that
the object each one created is actually present. If any check fails, nothing is
written: an unverified backfill would hide a migration that really is missing.

One transaction. Either the ledger is repaired and 053 is in, or neither.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from migrate import connect, load_env  # noqa: E402

ROOT = Path(__file__).resolve().parent

# migration id -> a query that returns true only if it already ran
EVIDENCE = {
    "045_a_role_that_holds_everything": """
        SELECT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = %(s)s AND table_name = 'role'
                          AND column_name = 'grants_everything')""",
    "046_only_superadmin_holds_everything": """
        SELECT NOT EXISTS (SELECT 1 FROM role WHERE code = 'MANAGEMENT')""",
    "047_market_prices_and_news": """
        SELECT count(*) = 3 FROM information_schema.tables
         WHERE table_schema = %(s)s
           AND table_name IN ('market_source', 'mineral_price', 'market_news')""",
    "048_auction_prices_and_royalty": """
        SELECT count(*) = 2 FROM information_schema.tables
         WHERE table_schema = %(s)s
           AND table_name IN ('auction_price', 'royalty_rate')""",
    "049_translate_the_news": """
        SELECT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = %(s)s AND table_name = 'market_news'
                          AND column_name = 'title_en')""",
    "050_prices_keep_their_history": """
        SELECT EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_schema = %(s)s AND table_name = 'price_revision')""",
    "051_who_may_change_a_rate": """
        SELECT EXISTS (SELECT 1 FROM permission WHERE code = 'market.rates.manage')""",
    "052_when_the_issue_was_published": """
        SELECT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = %(s)s AND table_name = 'mineral_price'
                          AND column_name = 'published_on')""",
}

NOTE = ("Applied out of band during the market build. Ledger backfilled after "
        "checking the object it creates is present.")


def main() -> int:
    env = load_env()
    schema = env.get("PG_SCHEMA", "minehub")
    conn = connect(env)
    try:
        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{schema}", public')
            cur.execute("SELECT migration_id FROM schema_migration")
            applied = {r[0] for r in cur.fetchall()}

            for mid, check in EVIDENCE.items():
                if mid in applied:
                    print(f"  [=] {mid} already recorded")
                    continue
                cur.execute(check, {"s": schema})
                if not cur.fetchone()[0]:
                    conn.rollback()
                    sys.exit(f"  [!] {mid} has NOT actually been applied — "
                             f"its objects are missing. Nothing written.")
                cur.execute("INSERT INTO schema_migration (migration_id, description) "
                            "VALUES (%s, %s)", (mid, NOTE))
                print(f"  [+] {mid} verified present, recorded")

            if "053_who_holds_what" in applied:
                print("\n  053 is already applied. Nothing to do.")
                conn.commit()
                return 0

            sql = (ROOT / "migrations" / "053_who_holds_what.sql").read_text(encoding="utf-8")
            cur.execute(sql)
            cur.execute("INSERT INTO schema_migration (migration_id, description) "
                        "VALUES (%s, %s)",
                        ("053_who_holds_what",
                         "Organisation: units, posts, holdings, accountability."))
            print("\n  [+] 053_who_holds_what applied")

        conn.commit()
        print("\nCommitted.")
    except Exception:
        conn.rollback()
        print("\nRolled back — nothing written.", file=sys.stderr)
        raise
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
