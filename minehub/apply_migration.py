"""Apply one migration file exactly as written.

SQLAlchemy's text() treats % as a parameter marker and doubles it, so a LIKE
pattern such as 'DRAFT-%' was reaching PostgreSQL as 'DRAFT-%%' and quietly
becoming a different rule. Migrations carry no parameters, so they go straight
to the driver with none — then what is in the file is what runs.

Usage: python minehub/apply_migration.py minehub/migrations/015_x.sql
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import psycopg                                    # noqa: E402
from app.config import get_settings               # noqa: E402


def main(path: str) -> None:
    sql = Path(path).read_text(encoding="utf-8")
    s = get_settings()
    with psycopg.connect(host=s.pg_host, port=s.pg_port, dbname=s.pg_database,
                         user=s.pg_user, password=s.pg_password,
                         options=f"-csearch_path={s.pg_schema},public") as conn:
        with conn.cursor() as cur:
            cur.execute(sql)            # no params: % stays %
        conn.commit()
    print(f"applied {Path(path).name}")


if __name__ == "__main__":
    main(sys.argv[1])
