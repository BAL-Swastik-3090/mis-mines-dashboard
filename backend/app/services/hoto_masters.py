"""What a device caches before it goes down the pit.

A tablet at the face has no network, so everything it needs to run a handover
has to be on it already: the machines, the operators, the locations, and the
checklist each machine type is answered against. This module is the read side
of that -- the device pulls, caches, and works from the cache.

── WHY THE SERVER RESOLVES THE TEMPLATE, NOT THE DEVICE ──────────────────────
The resolver below picks which checklist applies to a machine. It is the one
piece of this that must not be reimplemented on the device: the rules engine is
mirrored there deliberately (an operator must be told at the machine that it is
blocked), but *which* template applies depends on scope and effective dates the
device has no business deciding. So the device asks for a resolved template and
caches the answer, including the version it resolved to. A capture then records
that version, which is what stops a template published next month from changing
what a signed record claims to have answered.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


# ── the resolver ─────────────────────────────────────────────────────────────

def resolve_template(db: Session, asset_type_id: int, *,
                     plant_id: int | None = None,
                     org_unit_id: int | None = None,
                     on_date: date | None = None) -> dict[str, Any] | None:
    """The checklist in force for this machine, on this day.

    MOST SPECIFIC WINS, in this order:

        asset type + plant + department
        asset type + plant
        asset type + department
        asset type                        the base, and the usual case

    A template matches a scope if its own column is NULL (meaning "any") or
    equal. Ordering by the count of non-null scope columns puts the narrowest
    first, so Sukinda can run a different tipper checklist from Kaliapani
    without a second codebase.

    ON THE DAY, NOT TODAY. `on_date` is the production day the handover belongs
    to. A capture that syncs three days late must resolve against the template
    that was in force when it happened, not the one in force when it arrived.
    """
    on_date = on_date or date.today()
    row = db.execute(text("""
        SELECT template_id, name, version, plant_id, org_unit_id, effective_from
          FROM hoto_checklist_template
         WHERE asset_type_id = :at
           AND status = 'ACTIVE'
           AND effective_from <= :on
           AND (plant_id    IS NULL OR plant_id    = :plant)
           AND (org_unit_id IS NULL OR org_unit_id = :unit)
         ORDER BY CAST(plant_id IS NOT NULL AS int) + CAST(org_unit_id IS NOT NULL AS int) DESC,
                  effective_from DESC,
                  version DESC
         LIMIT 1
    """), {"at": asset_type_id, "plant": plant_id, "unit": org_unit_id,
           "on": on_date}).mappings().first()
    return dict(row) if row else None


def template_payload(db: Session, template_id: int) -> dict[str, Any]:
    """A template with its sections and items, ready to cache.

    Sections carry their order because that is the order an operator walks
    round the machine -- engine, then brakes, then tyres, then the cab. A form
    that presents them in any other order gets filled in wrongly.
    """
    head = db.execute(text("""
        SELECT t.template_id, t.name, t.version, t.asset_type_id, at.name AS asset_type_name,
               t.plant_id, t.org_unit_id, t.effective_from, t.status
          FROM hoto_checklist_template t
          JOIN asset_type at ON at.asset_type_id = t.asset_type_id
         WHERE t.template_id = :t
    """), {"t": template_id}).mappings().first()
    if not head:
        return {}

    rows = db.execute(text("""
        SELECT s.section_id, s.name AS section_name, s.display_order AS section_order,
               i.item_id, i.label, i.response_type, i.unit, i.min_value, i.max_value,
               i.category, i.is_critical, i.requires_photo_if_not_ok,
               i.default_severity, i.display_order
          FROM hoto_checklist_section s
          LEFT JOIN hoto_checklist_item i
                 ON i.section_id = s.section_id AND i.status = 'ACTIVE'
         WHERE s.template_id = :t
         ORDER BY s.display_order, i.display_order
    """), {"t": template_id}).mappings().all()

    sections: list[dict[str, Any]] = []
    for r in rows:
        if not sections or sections[-1]["section_id"] != r["section_id"]:
            sections.append({"section_id": r["section_id"], "name": r["section_name"],
                             "display_order": r["section_order"], "items": []})
        if r["item_id"] is None:          # a section with every item retired
            continue
        sections[-1]["items"].append({
            "item_id": r["item_id"],
            "label": r["label"],
            "response_type": r["response_type"],
            "unit": r["unit"],
            "min_value": float(r["min_value"]) if r["min_value"] is not None else None,
            "max_value": float(r["max_value"]) if r["max_value"] is not None else None,
            "category": r["category"],
            "is_critical": r["is_critical"],
            "requires_photo_if_not_ok": r["requires_photo_if_not_ok"],
            "default_severity": r["default_severity"],
            "display_order": r["display_order"],
        })

    out = dict(head)
    out["sections"] = sections
    out["item_count"] = sum(len(s["items"]) for s in sections)
    out["critical_count"] = sum(
        1 for s in sections for i in s["items"] if i["is_critical"])
    return out


# ── the masters a device caches ──────────────────────────────────────────────

def assets(db: Session, *, plant_id: int | None = None) -> list[dict[str, Any]]:
    """The machines, with the two things an operator needs before he starts.

    THE LAST METER READING, so the app can query a reading that went backwards
    *at the machine* -- the only moment anybody can go and look at the hour
    meter again.

    OPEN DEFECTS, so a machine with a known critical fault is shown as such
    before anyone fills in a form about it, rather than after.
    """
    rows = db.execute(text("""
        SELECT a.asset_id, a.fleet_code, a.nickname,
               a.asset_type_id, at.name AS asset_type_name,
               a.asset_ref AS qr_code,
               a.reading_uom AS meter_uom,
               a.current_reading AS last_meter_reading,
               a.reading_as_on AS last_meter_at,
               a.home_location_id, a.plant_id,
               a.status,
               -- The operational state is the open availability window, if any.
               -- Advisory only: a tablet that has been offline for a day is
               -- holding yesterday's answer, which is why a session records how
               -- stale its masters were.
               (SELECT ae.state FROM availability_event ae
                 WHERE ae.asset_id = a.asset_id AND ae.ended_at IS NULL
                 ORDER BY ae.started_at DESC LIMIT 1) AS operational_state
          FROM asset a
          JOIN asset_type at ON at.asset_type_id = a.asset_type_id
         WHERE a.status = 'ACTIVE'
           AND (CAST(:plant AS bigint) IS NULL OR a.plant_id = CAST(:plant AS bigint))
         ORDER BY a.fleet_code
    """), {"plant": plant_id}).mappings().all()
    return [_asset_row(r) for r in rows]


def _asset_row(r) -> dict[str, Any]:
    d = dict(r)
    for k in ("last_meter_reading",):
        if d.get(k) is not None:
            d[k] = float(d[k])
    # Defect counts arrive in phase 8; until the defect table exists, say zero
    # rather than omitting the field, so the device's cache shape does not
    # change under it mid-pilot.
    d.setdefault("open_defect_count", 0)
    d.setdefault("has_critical_defect", False)
    return d


def operators(db: Session) -> list[dict[str, Any]]:
    """The operators, with what each is signed off to drive.

    Competency is sent down so the device can *say* an operator is taking a
    machine he is not signed off on. It does not refuse him: the mine has not
    decided whether that may be overridden, and until it does, recording the
    fact is more useful than blocking on a rule nobody has agreed.
    """
    rows = db.execute(text("""
        SELECT o.operator_id,
               o.operator_ref        AS emp_id,
               COALESCE(p.display_name, p.legal_name) AS name,
               o.plant_id, o.org_unit_id,
               COALESCE(
                 (SELECT json_agg(DISTINCT oc.asset_type_id)
                    FROM operator_competency oc
                   WHERE oc.operator_id = o.operator_id
                     AND (oc.valid_upto IS NULL OR oc.valid_upto >= CURRENT_DATE)),
                 '[]'::json) AS competent_type_ids,
               (SELECT min(oc.valid_upto) FROM operator_competency oc
                 WHERE oc.operator_id = o.operator_id
                   AND oc.valid_upto IS NOT NULL) AS competency_valid_to
          FROM operator o
          LEFT JOIN party p ON p.party_id = o.party_id
         WHERE o.profile_status = 'ACTIVE'
         ORDER BY 3
    """)).mappings().all()
    return [dict(r) for r in rows]


def locations(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(text("""
        SELECT location_id, name FROM location WHERE status = 'ACTIVE' ORDER BY name
    """)).mappings().all()
    return [dict(r) for r in rows]


def shifts(db: Session) -> list[dict[str, Any]]:
    """The shift calendar.

    `crosses_midnight` and `production_day_rule` travel with it because the
    device must never work out the production day itself: a handover at 06:00
    belongs to the day that is ending, not the one starting, and a device clock
    that has drifted would get that wrong silently.
    """
    rows = db.execute(text("""
        SELECT shift_id, code, name, start_time, end_time, crosses_midnight,
               production_day_rule, planned_hours
          FROM shift_calendar
         WHERE valid_to IS NULL OR valid_to >= CURRENT_DATE
         ORDER BY start_time
    """)).mappings().all()
    return [{**dict(r),
             "start_time": str(r["start_time"]),
             "end_time": str(r["end_time"]),
             "planned_hours": float(r["planned_hours"]) if r["planned_hours"] is not None else None}
            for r in rows]


def sync_bundle(db: Session, *, plant_id: int | None = None) -> dict[str, Any]:
    """Everything a device needs, in one round trip.

    One call rather than five, because the moment a tablet has a network is
    short and often interrupted -- at a gate, in a yard, passing the workshop.
    A partial cache is worse than a stale one: it looks complete.

    `server_time` is returned so the device can measure its own clock drift
    rather than trusting it.
    """
    bundle = {
        "server_time": datetime.now().astimezone().isoformat(),
        "assets": assets(db, plant_id=plant_id),
        "operators": operators(db),
        "locations": locations(db),
        "shifts": shifts(db),
        "templates": [],
    }

    # One resolved template per asset type actually present in the fleet. No
    # point sending a furnace checklist to a tablet that will only ever see
    # tippers.
    type_ids = sorted({a["asset_type_id"] for a in bundle["assets"]})
    for at_id in type_ids:
        head = resolve_template(db, at_id, plant_id=plant_id)
        if head:
            bundle["templates"].append(template_payload(db, head["template_id"]))

    bundle["counts"] = {k: len(v) for k, v in bundle.items() if isinstance(v, list)}
    return bundle
