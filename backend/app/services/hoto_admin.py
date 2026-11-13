"""Building and publishing checklists.

This is the module the whole schema was shaped for: adding a check, changing a
range, moving an item, marking one critical or retiring it is an edit here, not
a deployment.

── A PUBLISHED TEMPLATE IS IMMUTABLE ────────────────────────────────────────
Every mutation below refuses to touch anything that is not a DRAFT. Editing an
ACTIVE template would rewrite history: a handover signed last Tuesday records
the template and version it answered, and changing that version's questions
would make the record claim it answered something nobody asked. So the panel
clones to a draft, edits the draft, and publishes it as a new version.

── PUBLISHING DOES NOT RETIRE THE OLD VERSION ───────────────────────────────
This surprises people, so it is worth stating. The resolver picks the ACTIVE
template with the latest `effective_from` on or before the production day being
resolved. Leaving earlier versions ACTIVE is what makes a capture that syncs
three days late -- or a register entry read next year -- resolve against the
template that was genuinely in force at the time.

RETIRED means "this scope should no longer resolve at all", which is a
different and rarer intention than "there is a newer version".
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

RESPONSE_TYPES = ("OK_CAUTION_NOTOK", "NUMERIC", "YES_NO", "LEVEL")
SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")


class AdminError(ValueError):
    """Refused, with every problem rather than the first."""

    def __init__(self, problems: list[str], status: int = 422):
        self.problems = problems
        self.status = status
        super().__init__("; ".join(problems))


def _template(db: Session, template_id: int) -> dict | None:
    row = db.execute(text("""
        SELECT t.template_id, t.asset_type_id, at.name AS asset_type_name,
               t.plant_id, t.org_unit_id, t.name, t.version, t.status,
               t.effective_from, t.notes, t.created_by, t.created_at,
               t.updated_by, t.updated_at
          FROM hoto_checklist_template t
          JOIN asset_type at ON at.asset_type_id = t.asset_type_id
         WHERE t.template_id = :t
    """), {"t": template_id}).mappings().first()
    return dict(row) if row else None


def _require_draft(db: Session, template_id: int) -> dict:
    t = _template(db, template_id)
    if not t:
        raise AdminError([f"no such checklist: {template_id}"], status=404)
    if t["status"] != "DRAFT":
        raise AdminError(
            [f"{t['name']} v{t['version']} is {t['status']} and cannot be edited. "
             f"Clone it to a draft — a published checklist is what signed "
             f"handovers say they answered."], status=409)
    return t


# ── reading ──────────────────────────────────────────────────────────────────

def list_templates(db: Session, *, include_retired: bool = False) -> list[dict]:
    """Every checklist, newest version first within each machine type."""
    rows = db.execute(text("""
        SELECT t.template_id, t.name, t.version, t.status, t.effective_from,
               t.asset_type_id, at.name AS asset_type_name,
               t.plant_id, p.name AS plant_name,
               t.org_unit_id, ou.name AS org_unit_name,
               t.updated_by, t.updated_at,
               (SELECT count(*) FROM hoto_checklist_section s
                 WHERE s.template_id = t.template_id) AS section_count,
               (SELECT count(*) FROM hoto_checklist_item i
                  JOIN hoto_checklist_section s2 ON s2.section_id = i.section_id
                 WHERE s2.template_id = t.template_id AND i.status = 'ACTIVE') AS item_count,
               (SELECT count(*) FROM hoto_checklist_item i
                  JOIN hoto_checklist_section s3 ON s3.section_id = i.section_id
                 WHERE s3.template_id = t.template_id AND i.status = 'ACTIVE'
                   AND i.is_critical) AS critical_count,
               -- How many handovers were answered against this exact version.
               -- The panel shows it because it is the reason the version
               -- cannot be edited.
               (SELECT count(*) FROM hoto_session hs
                 WHERE hs.template_id = t.template_id) AS captures
          FROM hoto_checklist_template t
          JOIN asset_type at ON at.asset_type_id = t.asset_type_id
          LEFT JOIN plant p ON p.plant_id = t.plant_id
          LEFT JOIN org_unit ou ON ou.org_unit_id = t.org_unit_id
         WHERE (:inc OR t.status <> 'RETIRED')
         ORDER BY at.name, t.version DESC
    """), {"inc": include_retired}).mappings().all()
    return [dict(r) for r in rows]


# ── creating and cloning ─────────────────────────────────────────────────────

def clone(db: Session, template_id: int, actor: str,
          *, name: str | None = None) -> dict:
    """Copy a template into a new DRAFT version, sections and items included.

    This is how every edit to a published checklist starts. A grader's list is
    a dozer's list with three changes, so cloning is also how a new machine
    type gets its first template.
    """
    src = _template(db, template_id)
    if not src:
        raise AdminError([f"no such checklist: {template_id}"], status=404)

    next_ver = db.execute(text("""
        SELECT COALESCE(MAX(version), 0) + 1 FROM hoto_checklist_template
         WHERE asset_type_id = :at
           AND plant_id IS NOT DISTINCT FROM :p
           AND org_unit_id IS NOT DISTINCT FROM :o
    """), {"at": src["asset_type_id"], "p": src["plant_id"],
           "o": src["org_unit_id"]}).scalar()

    new_id = db.execute(text("""
        INSERT INTO hoto_checklist_template
            (asset_type_id, plant_id, org_unit_id, name, version, status, notes, created_by)
        VALUES (:at, :p, :o, :n, :v, 'DRAFT', :notes, :by)
        RETURNING template_id
    """), {"at": src["asset_type_id"], "p": src["plant_id"], "o": src["org_unit_id"],
           "n": name or src["name"], "v": next_ver,
           "notes": f"Cloned from v{src['version']}", "by": actor}).scalar()

    db.execute(text("""
        INSERT INTO hoto_checklist_section (template_id, name, display_order)
        SELECT :new, name, display_order FROM hoto_checklist_section
         WHERE template_id = :old
    """), {"new": new_id, "old": template_id})

    db.execute(text("""
        INSERT INTO hoto_checklist_item
            (section_id, label, response_type, unit, min_value, max_value, category,
             is_critical, requires_photo_if_not_ok, default_severity, display_order,
             adverse_answer,
             status, created_by)
        SELECT ns.section_id, i.label, i.response_type, i.unit, i.min_value, i.max_value,
               i.category, i.is_critical, i.requires_photo_if_not_ok,
               i.adverse_answer,
               i.default_severity, i.display_order, 'ACTIVE', :by
          FROM hoto_checklist_item i
          JOIN hoto_checklist_section os ON os.section_id = i.section_id
          JOIN hoto_checklist_section ns ON ns.template_id = :new
                                        AND ns.display_order = os.display_order
         WHERE os.template_id = :old AND i.status = 'ACTIVE'
    """), {"new": new_id, "old": template_id, "by": actor})

    db.commit()
    return {"template_id": new_id, "version": next_ver, "status": "DRAFT",
            "cloned_from": template_id}


# ── editing a draft ──────────────────────────────────────────────────────────

def add_section(db: Session, template_id: int, name: str, actor: str) -> dict:
    _require_draft(db, template_id)
    order = db.execute(text("""
        SELECT COALESCE(MAX(display_order), 0) + 1 FROM hoto_checklist_section
         WHERE template_id = :t
    """), {"t": template_id}).scalar()
    sid = db.execute(text("""
        INSERT INTO hoto_checklist_section (template_id, name, display_order)
        VALUES (:t, :n, :o) RETURNING section_id
    """), {"t": template_id, "n": name, "o": order}).scalar()
    db.commit()
    return {"section_id": sid, "display_order": order}


def _validate_item(d: dict) -> list[str]:
    """The same rules the table's CHECK constraints enforce, stated in words.

    Duplicated on purpose: a constraint violation reaches the panel as
    "violates check constraint hoto_checklist_item_check", which tells an
    administrator nothing about what to change.
    """
    problems: list[str] = []
    rt = d.get("response_type")
    if rt not in RESPONSE_TYPES:
        problems.append(f"response_type must be one of {', '.join(RESPONSE_TYPES)}")
    if d.get("default_severity") not in SEVERITIES:
        problems.append(f"severity must be one of {', '.join(SEVERITIES)}")
    if not (d.get("label") or "").strip():
        problems.append("the item needs a label")

    # A yes/no item that does not say which of its two answers reports a
    # problem records answers and raises nothing -- which is how a fleet ran
    # with excessive exhaust smoke, cuts in tyres and tread below the limit
    # all invisible to the workshop. Asked for here rather than left to
    # default, because the answer depends entirely on how the question is
    # worded and only the person writing it knows. See migration 112.
    adv = d.get("adverse_answer")
    if rt == "YES_NO":
        if adv not in ("YES", "NO"):
            problems.append(
                "say which answer reports a problem: YES for a question phrased "
                "as a fault (\"Exhaust smoke (excessive)\"), NO for one phrased "
                "as a task (\"Grease points done\")")
    elif adv is not None:
        problems.append("only a yes/no item says which answer is the finding")

    lo, hi = d.get("min_value"), d.get("max_value")
    if rt == "NUMERIC":
        if not (d.get("unit") or "").strip():
            problems.append("a gauge reading needs a unit — it cannot be "
                            "validated or printed without one")
    elif lo is not None or hi is not None:
        problems.append("only a numeric item has a range")
    if lo is not None and hi is not None and float(lo) > float(hi):
        problems.append(f"the range is the wrong way round ({lo} to {hi}) — "
                        f"it would reject every reading")
    return problems


def add_item(db: Session, section_id: int, d: dict, actor: str) -> dict:
    row = db.execute(text("""
        SELECT s.template_id FROM hoto_checklist_section s WHERE s.section_id = :s
    """), {"s": section_id}).mappings().first()
    if not row:
        raise AdminError([f"no such section: {section_id}"], status=404)
    _require_draft(db, row["template_id"])

    problems = _validate_item(d)
    if problems:
        raise AdminError(problems)

    order = db.execute(text("""
        SELECT COALESCE(MAX(display_order), 0) + 1 FROM hoto_checklist_item
         WHERE section_id = :s
    """), {"s": section_id}).scalar()

    iid = db.execute(text("""
        INSERT INTO hoto_checklist_item
            (section_id, label, response_type, unit, min_value, max_value, category,
             is_critical, requires_photo_if_not_ok, default_severity, display_order,
             created_by, adverse_answer)
        VALUES (:s, :l, :rt, :u, :lo, :hi, :c, :crit, :photo, :sev, :o, :by, :adv)
        RETURNING item_id
    """), {"s": section_id, "l": d["label"].strip(), "rt": d["response_type"],
           "u": d.get("unit"), "lo": d.get("min_value"), "hi": d.get("max_value"),
           "c": d.get("category"), "crit": bool(d.get("is_critical")),
           "photo": bool(d.get("requires_photo_if_not_ok", True)),
           "adv": d.get("adverse_answer"),
           "sev": d["default_severity"], "o": order, "by": actor}).scalar()
    db.commit()
    return {"item_id": iid, "display_order": order}


def update_item(db: Session, item_id: int, d: dict, actor: str) -> dict:
    row = db.execute(text("""
        SELECT s.template_id FROM hoto_checklist_item i
          JOIN hoto_checklist_section s ON s.section_id = i.section_id
         WHERE i.item_id = :i
    """), {"i": item_id}).mappings().first()
    if not row:
        raise AdminError([f"no such item: {item_id}"], status=404)
    _require_draft(db, row["template_id"])

    problems = _validate_item(d)
    if problems:
        raise AdminError(problems)

    db.execute(text("""
        UPDATE hoto_checklist_item
           SET label = :l, response_type = :rt, unit = :u,
               min_value = :lo, max_value = :hi, category = :c,
               is_critical = :crit, requires_photo_if_not_ok = :photo,
               adverse_answer = :adv,
               default_severity = :sev, updated_by = :by, updated_at = now()
         WHERE item_id = :i
    """), {"i": item_id, "l": d["label"].strip(), "rt": d["response_type"],
           "u": d.get("unit"), "lo": d.get("min_value"), "hi": d.get("max_value"),
           "c": d.get("category"), "crit": bool(d.get("is_critical")),
           "photo": bool(d.get("requires_photo_if_not_ok", True)),
           "adv": d.get("adverse_answer"),
           "sev": d["default_severity"], "by": actor})
    db.commit()
    return {"item_id": item_id, "updated": True}


def retire_item(db: Session, item_id: int, actor: str) -> dict:
    """Retire, never delete.

    A response points at its item, and a defect raised eight months ago has to
    stay readable. On a DRAFT nothing has answered it yet, so a delete would be
    safe — but keeping one rule is better than two, and a retired item in a
    draft simply does not get published.
    """
    row = db.execute(text("""
        SELECT s.template_id FROM hoto_checklist_item i
          JOIN hoto_checklist_section s ON s.section_id = i.section_id
         WHERE i.item_id = :i
    """), {"i": item_id}).mappings().first()
    if not row:
        raise AdminError([f"no such item: {item_id}"], status=404)
    _require_draft(db, row["template_id"])
    db.execute(text("""
        UPDATE hoto_checklist_item SET status = 'RETIRED', updated_by = :by,
               updated_at = now() WHERE item_id = :i
    """), {"i": item_id, "by": actor})
    db.commit()
    return {"item_id": item_id, "status": "RETIRED"}


# ── publishing ───────────────────────────────────────────────────────────────

def publish(db: Session, template_id: int, effective_from: date, actor: str) -> dict:
    """A draft becomes the checklist in force from a date.

    REFUSED IF IT HAS NO CRITICAL ITEM. A checklist where nothing blocks is a
    form, not a control: every answer can be NOT OK and the machine still
    changes hands. If a machine type genuinely has nothing that should stop it
    working, that is a decision somebody should take deliberately rather than
    by publishing an incomplete list.
    """
    t = _require_draft(db, template_id)

    counts = db.execute(text("""
        SELECT count(*) AS items,
               count(*) FILTER (WHERE i.is_critical) AS critical,
               count(DISTINCT s.section_id) AS sections
          FROM hoto_checklist_section s
          LEFT JOIN hoto_checklist_item i
                 ON i.section_id = s.section_id AND i.status = 'ACTIVE'
         WHERE s.template_id = :t
    """), {"t": template_id}).mappings().first()

    problems: list[str] = []
    if not counts["items"]:
        problems.append("a checklist with no items cannot be published")
    if not counts["critical"]:
        problems.append("no item is marked critical — nothing on this checklist "
                        "would stop a machine going to work")
    if effective_from is None:
        problems.append("published checklists need a date they start applying")
    if problems:
        raise AdminError(problems)

    db.execute(text("""
        UPDATE hoto_checklist_template
           SET status = 'ACTIVE', effective_from = :eff,
               updated_by = :by, updated_at = now()
         WHERE template_id = :t
    """), {"t": template_id, "eff": effective_from, "by": actor})
    db.commit()

    # Deliberately NOT retiring the previous version. The resolver picks the
    # latest effective_from on or before the day being resolved, so leaving
    # earlier versions ACTIVE is what lets a late capture, or a register entry
    # read next year, resolve against the checklist genuinely in force then.
    return {"template_id": template_id, "version": t["version"], "status": "ACTIVE",
            "effective_from": effective_from.isoformat(),
            "sections": counts["sections"], "items": counts["items"],
            "critical_items": counts["critical"]}


def retire(db: Session, template_id: int, actor: str) -> dict:
    """Stop this scope resolving at all.

    Different from publishing a newer version, and rarer: use it when a machine
    type should no longer present a checklist, not when the checklist has
    changed.
    """
    t = _template(db, template_id)
    if not t:
        raise AdminError([f"no such checklist: {template_id}"], status=404)
    db.execute(text("""
        UPDATE hoto_checklist_template SET status = 'RETIRED', updated_by = :by,
               updated_at = now() WHERE template_id = :t
    """), {"t": template_id, "by": actor})
    db.commit()
    return {"template_id": template_id, "status": "RETIRED"}


def asset_types_needing_a_checklist(db: Session) -> list[dict]:
    """Every machine type in the fleet, and whether it has a checklist.

    The screen leads with this because it is the question an administrator
    actually has: ten of this mine's thirteen machine types have no checklist
    at all, so a handover on an ambulance or a crane stops at "this device
    holds no checklist for a Crane". A list of templates does not show that --
    it shows what exists, not what is missing.
    """
    rows = db.execute(text("""
        SELECT at.asset_type_id, at.name AS asset_type_name,
               count(DISTINCT a.asset_id) AS machines,
               count(DISTINCT t.template_id) FILTER (WHERE t.status = 'ACTIVE') AS published,
               count(DISTINCT t.template_id) FILTER (WHERE t.status = 'DRAFT')  AS drafts
          FROM asset_type at
          LEFT JOIN asset a ON a.asset_type_id = at.asset_type_id
          LEFT JOIN hoto_checklist_template t ON t.asset_type_id = at.asset_type_id
         GROUP BY at.asset_type_id, at.name
        HAVING count(DISTINCT a.asset_id) > 0
         ORDER BY (count(DISTINCT t.template_id) FILTER (WHERE t.status = 'ACTIVE')) ASC,
                  count(DISTINCT a.asset_id) DESC
    """)).mappings().all()
    return [dict(r) for r in rows]


def create_template(db: Session, *, asset_type_id: int, name: str, actor: str,
                    plant_id: int | None = None,
                    org_unit_id: int | None = None) -> dict[str, Any]:
    """Start a checklist for a machine type that has none.

    ── WHY THIS IS NOT `clone` ──────────────────────────────────────────────
    Cloning was the only way to get a draft, which works perfectly for the
    three types that already had a checklist and not at all for the ten that
    did not: there was nothing to clone from. An administrator could not
    create a checklist for a crane without first inventing one for a crane.

    It starts EMPTY rather than with a copied set of checks. A dozer's
    walk-round is not a crane's, and a template pre-filled from the nearest
    thing is how an ambulance ends up with a check for its blade.
    """
    problems: list[str] = []
    name = (name or "").strip()
    if not name:
        problems.append("the checklist needs a name — what it will be called on a tablet")
    if len(name) > 120:
        problems.append("the name is longer than 120 characters")

    at = db.execute(text("""
        SELECT asset_type_id, name FROM asset_type WHERE asset_type_id = :a
    """), {"a": asset_type_id}).mappings().first()
    if not at:
        problems.append(f"no such machine type: {asset_type_id}")
    if problems:
        raise AdminError(problems)

    # A second ACTIVE template for the same scope is the ambiguity the
    # resolver would have to break arbitrarily, so it is refused here where
    # the person can still pick a different scope.
    clash = db.execute(text("""
        SELECT template_id, name, version FROM hoto_checklist_template
         WHERE asset_type_id = :a AND status = 'ACTIVE'
           AND plant_id IS NOT DISTINCT FROM :p
           AND org_unit_id IS NOT DISTINCT FROM :o
    """), {"a": asset_type_id, "p": plant_id, "o": org_unit_id}).mappings().first()
    if clash:
        raise AdminError(
            [f"{at['name']} already has a published checklist "
             f"({clash['name']} v{clash['version']}). Clone that to a draft "
             f"instead, so handovers already signed against it still mean "
             f"what they said."], status=409)

    tid = db.execute(text("""
        INSERT INTO hoto_checklist_template
            (asset_type_id, plant_id, org_unit_id, name, version, status, created_by)
        VALUES (:a, :p, :o, :n, 1, 'DRAFT', :by)
        RETURNING template_id
    """), {"a": asset_type_id, "p": plant_id, "o": org_unit_id,
           "n": name, "by": actor}).scalar()
    db.commit()
    logger.info("checklist %s started for %s by %s", tid, at["name"], actor)

    return {"template_id": tid, "version": 1, "status": "DRAFT",
            "asset_type_id": asset_type_id, "asset_type_name": at["name"],
            "name": name,
            "note": ("Empty on purpose. Add the sections and checks this machine "
                     "actually needs, then publish it.")}


# ── editing a section ───────────────────────────────────────────────────────
# add_section has existed since phase 6 with nothing to pair it with: a
# section could be created and then neither renamed nor removed. A typo in a
# heading was permanent, and a section added by mistake stayed in the draft
# for ever. Both of these only ever touch a DRAFT, which is what makes them
# safe to offer at all.

def rename_section(db: Session, section_id: int, name: str, actor: str) -> dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise AdminError(["the section needs a name"])
    if len(name) > 80:
        raise AdminError(["the section name is longer than 80 characters"])

    row = db.execute(text("""
        SELECT template_id, name FROM hoto_checklist_section WHERE section_id = :s
    """), {"s": section_id}).mappings().first()
    if not row:
        raise AdminError([f"no such section: {section_id}"], status=404)
    _require_draft(db, row["template_id"])

    db.execute(text("""
        UPDATE hoto_checklist_section SET name = :n WHERE section_id = :s
    """), {"n": name, "s": section_id})
    db.commit()
    logger.info("section %s renamed to %s by %s", section_id, name, actor)
    return {"section_id": section_id, "name": name, "was": row["name"]}


def delete_section(db: Session, section_id: int, actor: str) -> dict[str, Any]:
    """Remove a section from a draft, and the checks in it.

    Refused while it still holds checks, rather than cascading. On a draft a
    cascade would be safe -- nothing has answered them -- but "remove the
    section" and "remove the eleven checks inside it" are different intentions
    and a heading tapped by mistake should not take a morning's work with it.
    Empty it first, deliberately, and then it goes.
    """
    row = db.execute(text("""
        SELECT s.template_id, s.name,
               (SELECT count(*) FROM hoto_checklist_item i
                 WHERE i.section_id = s.section_id AND i.status = 'ACTIVE') AS items
          FROM hoto_checklist_section s WHERE s.section_id = :s
    """), {"s": section_id}).mappings().first()
    if not row:
        raise AdminError([f"no such section: {section_id}"], status=404)
    _require_draft(db, row["template_id"])

    if row["items"]:
        raise AdminError(
            [f"{row['name']} still holds {row['items']} check"
             f"{'' if row['items'] == 1 else 's'}. Remove them first — a heading "
             f"tapped by mistake should not take them with it."], status=409)

    db.execute(text("DELETE FROM hoto_checklist_section WHERE section_id = :s"),
               {"s": section_id})
    db.commit()
    logger.info("section %s (%s) removed by %s", section_id, row["name"], actor)
    return {"section_id": section_id, "removed": row["name"]}


def item_performance(db: Session, template_id: int, *,
                     days: int = 90) -> list[dict[str, Any]]:
    """How often each check on this template has actually found something.

    ── WHY THIS IS THE MOST USEFUL NUMBER IN THE MODULE ──────────────────────
    A checklist is a cost paid by every operator at every handover, and until
    now nobody could see what any single question bought. The system has been
    recording the answers all along: this reads them back the other way round,
    per question.

    Two kinds of question earn their place differently, so both are reported
    and neither is scored:

      A check that NEVER finds anything may be worthless -- or it may be the
      one everybody passes precisely because it is asked. Brakes are checked
      every shift and almost always fine; dropping that question because it
      rarely fires would be the worst possible reading of this table.

      A check that ALWAYS finds something is usually a question worded so
      that the normal state of the machine is an exception, and it trains
      operators to answer without looking.

    So this returns counts and leaves the judgement to the people who know
    the machines. No ranking, no recommendation, no traffic light.
    """
    rows = db.execute(text("""
        SELECT i.item_id, i.label, i.response_type, i.default_severity,
               sec.name AS section_name,
               count(r.response_id) AS answered,
               -- A YES/NO check's finding is whichever answer the item says
               -- is adverse, which is the whole point of migration 112. The
               -- obvious NOT_OK/CAUTION test alone would report every greasing
               -- and fire-extinguisher check as having never once found
               -- anything, which is exactly backwards.
               count(*) FILTER (
                 WHERE r.answer IN ('NOT_OK','CAUTION')
                    OR r.in_range = false
                    OR (i.adverse_answer IS NOT NULL
                        AND r.answer = i.adverse_answer)
               ) AS found,
               max(s.captured_at) AS last_answered
          FROM hoto_checklist_item i
          JOIN hoto_checklist_section sec ON sec.section_id = i.section_id
          LEFT JOIN hoto_response r ON r.item_id = i.item_id
          LEFT JOIN hoto_session s  ON s.session_id = r.session_id
               AND s.captured_at > now() - CAST(:d || ' days' AS interval)
               AND s.status <> 'REJECTED'
         WHERE sec.template_id = :t AND i.status <> 'RETIRED'
         GROUP BY i.item_id, i.label, i.response_type, i.default_severity,
                  sec.name, i.display_order, sec.display_order
         ORDER BY sec.display_order, i.display_order
    """), {"t": template_id, "d": days}).mappings().all()

    out = []
    for r in rows:
        d = dict(r)
        answered = int(d["answered"] or 0)
        found = int(d["found"] or 0)
        d["answered"] = answered
        d["found"] = found
        # Deliberately null rather than 0 when nothing has been answered: a
        # question nobody has reached yet is not a question that never fires,
        # and 0% would say the opposite of the truth.
        d["found_rate"] = round(found / answered, 4) if answered else None
        out.append(d)
    return out
