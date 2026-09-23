"""MineHub migration runner.

Applies the .sql files in minehub/migrations in filename order, inside a
transaction each, and records what ran in minehub.schema_migration so a
re-run is a no-op rather than a duplicate.

    python minehub/migrate.py              # apply anything outstanding
    python minehub/migrate.py --status     # show what is applied, change nothing
    python minehub/migrate.py --dry-run    # print what would run

Connection settings come from the environment, falling back to the backend's
.env so there is one place credentials live:

    PG_HOST  PG_PORT  PG_DATABASE  PG_USER  PG_PASSWORD  PG_SCHEMA

Nothing here prints a password.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

try:
    import psycopg
except ImportError:  # pragma: no cover
    sys.exit("psycopg is not installed in this interpreter.\n"
             "  pip install 'psycopg[binary]'")

ROOT = Path(__file__).resolve().parent
MIGRATIONS = ROOT / "migrations"


def load_env() -> dict[str, str]:
    """Environment first, then backend/.env, then .env at the repo root."""
    env: dict[str, str] = {}
    for candidate in (ROOT.parent / "backend" / ".env", ROOT.parent / ".env"):
        if candidate.exists():
            for line in candidate.read_text(encoding="utf-8").splitlines():
                m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
                if m and not line.lstrip().startswith("#"):
                    env.setdefault(m.group(1), m.group(2).strip())
    env.update({k: v for k, v in os.environ.items() if k.startswith("PG_")})
    return env


def connect(env: dict[str, str]):
    missing = [k for k in ("PG_HOST", "PG_DATABASE", "PG_USER", "PG_PASSWORD") if not env.get(k)]
    if missing:
        sys.exit("Missing connection settings: " + ", ".join(missing) +
                 "\nSet them in backend/.env or the environment.")
    return psycopg.connect(
        host=env["PG_HOST"],
        port=env.get("PG_PORT", "5432"),
        dbname=env["PG_DATABASE"],
        user=env["PG_USER"],
        password=env["PG_PASSWORD"],
        connect_timeout=15,
        autocommit=False,
    )


def applied_set(conn, schema: str) -> set[str]:
    with conn.cursor() as c:
        c.execute("""SELECT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = %s AND table_name = 'schema_migration')""", (schema,))
        if not c.fetchone()[0]:
            return set()
        c.execute(f'SELECT migration_id FROM "{schema}".schema_migration')
        return {r[0] for r in c.fetchall()}


def main() -> int:
    ap = argparse.ArgumentParser(description="Apply MineHub database migrations.")
    ap.add_argument("--status", action="store_true", help="list migrations and exit")
    ap.add_argument("--dry-run", action="store_true", help="show what would run, change nothing")
    args = ap.parse_args()

    env = load_env()
    schema = env.get("PG_SCHEMA", "minehub")
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        print(f"No migrations found in {MIGRATIONS}")
        return 0

    with connect(env) as conn:
        print(f"connected to {env['PG_DATABASE']} @ {env['PG_HOST']}  schema={schema}")

        # Set it here rather than relying on migration 001 to do it.
        #
        # 001 issues `SET search_path TO minehub, public`, and because every
        # file in a run shares this one connection, that setting leaked into
        # all 50-odd files after it. Which worked, invisibly, for as long as
        # every run started from 001 — and broke the first time a single late
        # migration was applied to an already-populated database, where the
        # connection is fresh and nothing has set the path. 054 then failed on
        # `relation "asset" does not exist` while asset was sitting in minehub
        # all along.
        with conn.cursor() as c:
            c.execute(f'SET search_path TO "{schema}", public')

        done = applied_set(conn, schema)

        if args.status:
            for f in files:
                print(f"  [{'x' if f.stem in done else ' '}] {f.name}")
            return 0

        pending = [f for f in files if f.stem not in done]
        if not pending:
            print("nothing to apply — database is up to date")
            return 0

        for f in pending:
            if args.dry_run:
                print(f"  would apply {f.name}")
                continue
            print(f"  applying {f.name} ...", end="", flush=True)
            sql = f.read_text(encoding="utf-8")
            try:
                with conn.cursor() as c:
                    c.execute(sql)
                    # Record it in the same transaction as the migration itself.
                    #
                    # This was missing entirely. The runner read schema_migration
                    # to decide what was outstanding and then never wrote to it,
                    # so every migration was outstanding for ever and re-ran on
                    # every invocation — which is why the ledger stopped at 044
                    # while the database was at 052, and why 054 applied twice.
                    #
                    # It went unnoticed because these files are written to be
                    # idempotent, so a second pass is usually harmless. Usually
                    # is not a guarantee: 047 seeds a market_source row that 048
                    # renames, and re-running the pair would have left two
                    # sources for one site.
                    #
                    # In the same transaction, so a migration that fails is not
                    # recorded as done, and one that succeeds cannot be left
                    # unrecorded by a crash between the two statements.
                    c.execute(
                        f'INSERT INTO "{schema}".schema_migration (migration_id, description) '
                        "VALUES (%s, %s) ON CONFLICT (migration_id) DO NOTHING",
                        (f.stem, f"Applied by migrate.py from {f.name}"))
                conn.commit()
                done.add(f.stem)
                print(" ok")
            except Exception as exc:
                conn.rollback()
                print(" FAILED")
                print(f"\n{type(exc).__name__}: {exc}")
                print("\nRolled back. Nothing from this file was applied.")
                return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
