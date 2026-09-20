"""The shape of the workforce.

Its own module because it is one endpoint with a dozen queries in it, and
burying that in a router that already handles registration, approval,
competency, documents and assignments makes both harder to read.

EVERY FIGURE IS DERIVED ON READ. Nothing here is stored. A stored headcount is
a headcount that is wrong by the time somebody reads it, and reconciling that
kind of number between spreadsheets is the work this platform exists to stop.

ONE ENDPOINT RATHER THAN TWELVE. The screen shows these together, and twelve
round trips over the tunnel to the mine is the difference between a page that
appears and a page that assembles itself while you watch.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/operators", tags=["Operators"])

# Every cut is filtered the same way, and every cast is explicit because an
# untyped bind in a NULL comparison is a thing PostgreSQL refuses to guess at.
#
# The filters narrow the whole screen at once rather than each card separately:
# "the Automobile workshop's headcount, age and coverage" is one question, and
# answering it three times in three places is how two of the three end up
# showing something else.
WHERE = """WHERE (CAST(:plant AS bigint) IS NULL OR o.plant_id = CAST(:plant AS bigint))
             AND (CAST(:employer AS bigint) IS NULL OR o.employer_party_id = CAST(:employer AS bigint))
             AND (CAST(:org AS bigint) IS NULL OR o.org_unit_id = CAST(:org AS bigint))
             AND (CAST(:grp AS text) IS NULL OR t.trade_group = CAST(:grp AS text))
             AND (CAST(:approval AS text) IS NULL OR o.approval_status = CAST(:approval AS text))
             AND (CAST(:operators AS boolean) IS NULL
                  OR COALESCE(t.operates_equipment, FALSE) = CAST(:operators AS boolean))"""

# Cuts that do not join trade themselves still need it, because the group and
# operator filters live on it.
TRADE_JOIN = "LEFT JOIN trade t ON t.trade_id = o.trade_id"


@router.get("/analytics")
def analytics(plant_id: int | None = Query(None),
              employer_party_id: int | None = Query(None),
              org_unit_id: int | None = Query(None),
              trade_group: str = Query(""),
              approval_status: str = Query(""),
              operators_only: bool | None = Query(None),
              db: Session = Depends(get_minehub_db)) -> dict:
    """Headcount, composition, coverage and the gaps, in the cuts people ask for."""
    p = {"plant": plant_id, "employer": employer_party_id, "org": org_unit_id,
         "grp": trade_group or None, "approval": approval_status or None,
         "operators": operators_only}

    def rows(sql: str) -> list[dict]:
        return [dict(r) for r in db.execute(text(sql), p).mappings()]

    headline = db.execute(text(f"""
        SELECT count(*)                                                AS people,
               count(*) FILTER (WHERE o.approval_status = 'APPROVED')  AS approved,
               count(*) FILTER (WHERE o.approval_status = 'DRAFT')     AS draft,
               count(*) FILTER (WHERE o.approval_status = 'SUBMITTED') AS awaiting,
               count(*) FILTER (WHERE t.operates_equipment)            AS operators,
               count(*) FILTER (WHERE o.employment_type = 'CONTRACT')  AS contract,
               count(DISTINCT o.employer_party_id)                     AS employers,
               -- The gap this screen exists for: people whose job is to run a
               -- machine and who have never been cleared to run one.
               count(*) FILTER (WHERE t.operates_equipment AND NOT EXISTS (
                   SELECT 1 FROM operator_competency c
                    WHERE c.operator_id = o.operator_id
                      AND c.dimension = 'OVERALL' AND c.level >= 2))   AS unassessed_operators,
               round(avg(EXTRACT(EPOCH FROM (now() - o.joined_on)) / 31557600.0)
                     FILTER (WHERE o.joined_on IS NOT NULL), 1)        AS avg_years,
               round(avg(EXTRACT(EPOCH FROM (now() - p2.date_of_birth)) / 31557600.0)
                     FILTER (WHERE p2.date_of_birth IS NOT NULL), 0)   AS avg_age
          FROM operator o
          JOIN party p2 ON p2.party_id = o.party_id
          LEFT JOIN trade t ON t.trade_id = o.trade_id
          {WHERE}
    """), p).mappings().first()

    return {
        "headline": dict(headline or {}),

        "by_group": rows(f"""
            SELECT COALESCE(t.trade_group, 'Not classified') AS label,
                   count(*) AS people,
                   count(*) FILTER (WHERE t.operates_equipment) AS operators
              FROM operator o LEFT JOIN trade t ON t.trade_id = o.trade_id
              {WHERE} GROUP BY 1 ORDER BY people DESC"""),

        "by_trade": rows(f"""
            SELECT COALESCE(t.name, 'Not classified') AS label,
                   COALESCE(t.trade_group, '-')       AS trade_group,
                   COALESCE(t.operates_equipment, FALSE) AS operates_equipment,
                   ta.name                            AS machine,
                   count(*) AS people,
                   count(*) FILTER (WHERE EXISTS (
                       SELECT 1 FROM operator_competency c
                        WHERE c.operator_id = o.operator_id
                          AND c.dimension = 'OVERALL' AND c.level >= 2)) AS assessed
              FROM operator o
              LEFT JOIN trade t ON t.trade_id = o.trade_id
              LEFT JOIN asset_type ta ON ta.asset_type_id = t.asset_type_id
              {WHERE} GROUP BY 1,2,3,4 ORDER BY people DESC"""),

        "by_employer": rows(f"""
            SELECT COALESCE(e.display_name, 'Not recorded') AS label, count(*) AS people
              FROM operator o LEFT JOIN party e ON e.party_id = o.employer_party_id
              {TRADE_JOIN}
              {WHERE} GROUP BY 1 ORDER BY people DESC"""),

        "by_department": rows(f"""
            SELECT COALESCE(ou.name, 'Not posted') AS label, count(*) AS people
              FROM operator o LEFT JOIN org_unit ou ON ou.org_unit_id = o.org_unit_id
              {TRADE_JOIN}
              {WHERE} GROUP BY 1 ORDER BY people DESC"""),

        "by_skill": rows(f"""
            SELECT COALESCE(t.skill_class, 'Not classified') AS label, count(*) AS people
              FROM operator o LEFT JOIN trade t ON t.trade_id = o.trade_id
              {WHERE} GROUP BY 1 ORDER BY people DESC"""),

        # Bands, not a bar per year. "How many are within five years of
        # retiring" is the question, and a histogram does not answer it.
        "by_age": rows(f"""
            SELECT band AS label, count(*) AS people FROM (
                SELECT CASE
                    WHEN p2.date_of_birth IS NULL                        THEN 'Not recorded'
                    WHEN age(p2.date_of_birth) < interval '25 years'     THEN 'Under 25'
                    WHEN age(p2.date_of_birth) < interval '35 years'     THEN '25 to 34'
                    WHEN age(p2.date_of_birth) < interval '45 years'     THEN '35 to 44'
                    WHEN age(p2.date_of_birth) < interval '55 years'     THEN '45 to 54'
                    ELSE '55 and over' END AS band
                  FROM operator o JOIN party p2 ON p2.party_id = o.party_id
                  {TRADE_JOIN}
                  {WHERE}) x
            GROUP BY 1 ORDER BY 1"""),

        "by_service": rows(f"""
            SELECT band AS label, count(*) AS people FROM (
                SELECT CASE
                    WHEN o.joined_on IS NULL                            THEN 'Not recorded'
                    WHEN o.joined_on > now() - interval '1 year'        THEN 'Under a year'
                    WHEN o.joined_on > now() - interval '3 years'       THEN '1 to 3 years'
                    WHEN o.joined_on > now() - interval '5 years'       THEN '3 to 5 years'
                    WHEN o.joined_on > now() - interval '10 years'      THEN '5 to 10 years'
                    ELSE 'Over 10 years' END AS band
                  FROM operator o {TRADE_JOIN} {WHERE}) x
            GROUP BY 1 ORDER BY 1"""),

        # Who can run what, against how many machines of that class the mine
        # actually has in service. A class with machines and nobody cleared to
        # run them is the finding worth surfacing; so is the reverse.
        "coverage": rows(f"""
            SELECT ta.name AS label,
                   count(DISTINCT o.operator_id) AS trained_for,
                   (SELECT count(*) FROM asset a
                     WHERE a.asset_type_id = ta.asset_type_id
                       AND a.status IN ('ACTIVE','MAINTENANCE','STANDBY','IDLE')) AS machines,
                   (SELECT count(DISTINCT c.operator_id) FROM operator_competency c
                     WHERE c.asset_type_id = ta.asset_type_id
                       AND c.dimension = 'OVERALL' AND c.level >= 2)              AS assessed
              FROM asset_type ta
              LEFT JOIN trade t ON t.asset_type_id = ta.asset_type_id
              LEFT JOIN operator o ON o.trade_id = t.trade_id
                   AND (CAST(:plant AS bigint) IS NULL
                        OR o.plant_id = CAST(:plant AS bigint))
                   AND (CAST(:employer AS bigint) IS NULL
                        OR o.employer_party_id = CAST(:employer AS bigint))
                   AND (CAST(:org AS bigint) IS NULL
                        OR o.org_unit_id = CAST(:org AS bigint))
             GROUP BY ta.asset_type_id, ta.name
             HAVING count(DISTINCT o.operator_id) > 0
                 OR (SELECT count(*) FROM asset a
                      WHERE a.asset_type_id = ta.asset_type_id
                        AND a.status IN ('ACTIVE','MAINTENANCE','STANDBY','IDLE')) > 0
             ORDER BY machines DESC, label"""),

        # Straight from the view the alerts screen reads, so the two screens
        # can never quietly disagree about how many licences have run out.
        "documents": rows("""
            SELECT severity AS label, count(*) AS people
              FROM operator_alert GROUP BY 1 ORDER BY 1"""),

        # What the filters may be set to, counted against the current
        # selection so the menus never offer a choice that returns nothing.
        "choices": {
            "employer": rows(f"""
                SELECT e.party_id AS id, e.display_name AS label, count(*) AS people
                  FROM operator o JOIN party e ON e.party_id = o.employer_party_id
                  {TRADE_JOIN} {WHERE} GROUP BY 1,2 ORDER BY people DESC"""),
            "department": rows(f"""
                SELECT ou.org_unit_id AS id, ou.name AS label, count(*) AS people
                  FROM operator o JOIN org_unit ou ON ou.org_unit_id = o.org_unit_id
                  {TRADE_JOIN} {WHERE} GROUP BY 1,2 ORDER BY people DESC"""),
            "trade_group": rows(f"""
                SELECT t.trade_group AS label, count(*) AS people
                  FROM operator o {TRADE_JOIN} {WHERE}
                   AND t.trade_group IS NOT NULL
                 GROUP BY 1 ORDER BY people DESC"""),
        },
    }
