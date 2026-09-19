"""Apply one migration file exactly as written, and record that it ran.

SQLAlchemy's text() treats % as a parameter marker and doubles it, so a LIKE
pattern such as 'DRAFT-%' was reaching PostgreSQL as 'DRAFT-%%' and quietly
becoming a different rule. Migrations carry no parameters, so they go straight
to the driver with none — then what is in the file is what runs.

IT RECORDS, BECAUSE FOR A FORTNIGHT IT DID NOT. migrate.py writes a row to
schema_migration for everything it applies. This script, written later to dodge
the % problem, applied twenty-three migrations without writing any. The schema
was correct the whole time and the log said the database had stopped at 008 —
which is the worse failure of the two, because a log that is wrong is trusted
until somebody acts on it.

Both the apply and the record happen in one transaction. A migration that ran
but was not recorded is exactly the state this is fixing, so it must not be
possible to produce a new one by crashing in between.

Usage:
    python minehub/apply_migration.py minehub/migrations/015_x.sql
    python minehub/apply_migration.py --status      # what has run, what has not
    python minehub/apply_migration.py --reconcile   # record what is already applied
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import psycopg                                    # noqa: E402
from app.config import get_settings               # noqa: E402

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def _connect():
    s = get_settings()
    return psycopg.connect(host=s.pg_host, port=s.pg_port, dbname=s.pg_database,
                           user=s.pg_user, password=s.pg_password,
                           options=f"-csearch_path={s.pg_schema},public")


def _first_comment(path: Path) -> str:
    """The migration's own one-line summary, for the log to be readable."""
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            text = stripped.lstrip("- ").strip()
            if text:
                return text[:200]
        elif stripped:
            break
    return ""


def _on_file() -> list[str]:
    return sorted(p.stem for p in MIGRATIONS.glob("*.sql"))


def _applied(cur) -> set[str]:
    cur.execute("SELECT migration_id FROM schema_migration")
    return {r[0] for r in cur.fetchall()}


def apply_one(path: str, force: bool = False) -> None:
    file = Path(path)
    sql = file.read_text(encoding="utf-8")

    with _connect() as conn:
        with conn.cursor() as cur:
            if file.stem in _applied(cur) and not force:
                print(f"{file.name} is already recorded as applied — "
                      f"pass --force to run it again.")
                return

            cur.execute(sql)            # no params: % stays %
            # Same transaction as the migration itself. Recorded separately and
            # this could fail after the schema changed, which is the state this
            # whole change exists to prevent.
            cur.execute("""
                INSERT INTO schema_migration (migration_id, description)
                VALUES (%s, %s)
                ON CONFLICT (migration_id) DO UPDATE SET applied_at = now()
            """, (file.stem, _first_comment(file)))
        conn.commit()
    print(f"applied {file.name}")


def status() -> int:
    with _connect() as conn, conn.cursor() as cur:
        done = _applied(cur)
    files = _on_file()
    missing = [m for m in files if m not in done]
    unknown = sorted(done - set(files))

    print(f"{len(files)} migration files, {len(done)} recorded as applied\n")
    for m in files:
        print(f"  {'applied' if m in done else 'NOT RECORDED':<13} {m}")
    if unknown:
        print("\nRecorded but no file on disk:")
        for m in unknown:
            print(f"  {m}")
    if missing:
        print(f"\n{len(missing)} not recorded. If the schema already has them, "
              f"run --reconcile.")
    return len(missing)


def reconcile() -> None:
    """Record migrations whose changes are already in the database.

    For the twenty-three this script applied before it learned to write the log.
    It records rather than re-runs: the tables are already there, and running
    them again is at best a no-op and at worst destructive.
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            done = _applied(cur)
            missing = [m for m in _on_file() if m not in done]
            if not missing:
                print("Nothing to reconcile — the log already matches the files.")
                return
            for name in missing:
                cur.execute("""
                    INSERT INTO schema_migration (migration_id, description)
                    VALUES (%s, %s) ON CONFLICT (migration_id) DO NOTHING
                """, (name, _first_comment(MIGRATIONS / f"{name}.sql")))
                print(f"  recorded {name}")
        conn.commit()
    print(f"\n{len(missing)} migrations recorded. The log now matches the schema.\n"
          "Nothing was re-run — these changes were already in the database.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}

    if "--status" in flags:
        raise SystemExit(0 if status() == 0 else 1)
    if "--reconcile" in flags:
        reconcile()
        raise SystemExit(0)
    if not args:
        raise SystemExit("Give a migration file, or --status / --reconcile.")
    apply_one(args[0], force="--force" in flags)
