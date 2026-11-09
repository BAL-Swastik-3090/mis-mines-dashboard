/**
 * The device's own database. **Local SQLite is the source of truth on-device**
 * and the server is eventual — not the other way round.
 *
 * ── TWO KINDS OF TABLE, AND THEY ARE NOT THE SAME ───────────────────────────
 * *Cached masters* (`cached_*`) — assets, operators, templates, credentials.
 * The server owns these; the device holds a copy and replaces it wholesale on
 * sync. Never edited here.
 *
 * *Captured records* (`session`, `response`, `photo`) — the DEVICE owns these
 * until the server acknowledges them. Append-only, which is why conflicts are
 * rare: two devices can both capture and neither overwrites the other.
 *
 * ── WHY IDS ARE SERVER IDS, EXCEPT WHERE THEY CANNOT BE ─────────────────────
 * Assets, operators and checklist items carry the server's integer ids, so a
 * captured response points at exactly the row the admin panel edited. A
 * *session* cannot: it is created with no network and no server id exists yet.
 * It is keyed on `client_uuid`, generated here, and that uuid is what makes a
 * retry idempotent — the same capture replayed returns the original record
 * instead of creating a second handover.
 *
 * Opened through SQLCipher: the device holds hashed operator credentials and
 * unsynced handovers, and it lives in a cab.
 */

export const SCHEMA_VERSION = 1;

/** Run in order, inside one transaction, on first open and on upgrade. */
export const MIGRATIONS: readonly string[][] = [
  // ── v1 ────────────────────────────────────────────────────────────────────
  [
    `PRAGMA journal_mode = WAL;`,
    `PRAGMA foreign_keys = ON;`,

    // ── cached masters ──────────────────────────────────────────────────────

    // last_meter_reading is held so the app can query a reading that went
    // backwards AT THE MACHINE — the only moment anybody can go and look at
    // the hour meter again.
    `CREATE TABLE IF NOT EXISTS cached_asset (
       asset_id            INTEGER PRIMARY KEY,
       fleet_code          TEXT    NOT NULL,
       nickname            TEXT,
       asset_type_id       INTEGER NOT NULL,
       asset_type_name     TEXT    NOT NULL,
       qr_code             TEXT,
       meter_uom           TEXT,
       last_meter_reading  REAL,
       last_meter_at       TEXT,
       -- Advisory. A tablet offline for a day holds yesterday's answer, which
       -- is why every session records how stale its masters were.
       operational_state   TEXT,
       -- So the operator sees what he is taking on BEFORE he starts.
       open_defect_count   INTEGER NOT NULL DEFAULT 0,
       has_critical_defect INTEGER NOT NULL DEFAULT 0,
       home_location_id    INTEGER,
       cached_at           TEXT    NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS cached_asset_qr_idx ON cached_asset (qr_code);`,
    `CREATE INDEX IF NOT EXISTS cached_asset_code_idx ON cached_asset (fleet_code);`,

    `CREATE TABLE IF NOT EXISTS cached_operator (
       operator_id            INTEGER PRIMARY KEY,
       emp_id                 TEXT NOT NULL,
       name                   TEXT NOT NULL,
       photo_path             TEXT,
       -- Asset type ids this operator is signed off on, as a JSON array.
       -- Taking a machine outside it is not forbidden here: it is recorded and
       -- raised, because the mine has not yet decided whether it may be
       -- overridden. See section 9 of the scope.
       competent_type_ids     TEXT NOT NULL DEFAULT '[]',
       competency_valid_to    TEXT,
       cached_at              TEXT NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS cached_operator_emp_idx ON cached_operator (emp_id);`,

    `CREATE TABLE IF NOT EXISTS cached_location (
       location_id INTEGER PRIMARY KEY,
       name        TEXT NOT NULL,
       cached_at   TEXT NOT NULL
     );`,

    // version matters: a capture records the version it answered, so a template
    // published next month cannot change what a signed record says.
    `CREATE TABLE IF NOT EXISTS cached_template (
       template_id    INTEGER PRIMARY KEY,
       asset_type_id  INTEGER NOT NULL,
       name           TEXT    NOT NULL,
       version        INTEGER NOT NULL,
       plant_id       INTEGER,
       org_unit_id    INTEGER,
       effective_from TEXT,
       cached_at      TEXT    NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS cached_template_type_idx
       ON cached_template (asset_type_id, effective_from DESC);`,

    `CREATE TABLE IF NOT EXISTS cached_section (
       section_id    INTEGER PRIMARY KEY,
       template_id   INTEGER NOT NULL REFERENCES cached_template (template_id) ON DELETE CASCADE,
       name          TEXT    NOT NULL,
       display_order INTEGER NOT NULL
     );`,

    `CREATE TABLE IF NOT EXISTS cached_item (
       item_id                   INTEGER PRIMARY KEY,
       section_id                INTEGER NOT NULL REFERENCES cached_section (section_id) ON DELETE CASCADE,
       label                     TEXT    NOT NULL,
       response_type             TEXT    NOT NULL,
       unit                      TEXT,
       min_value                 REAL,
       max_value                 REAL,
       category                  TEXT,
       is_critical               INTEGER NOT NULL,
       requires_photo_if_not_ok  INTEGER NOT NULL,
       default_severity          TEXT    NOT NULL,
       display_order             INTEGER NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS cached_item_section_idx
       ON cached_item (section_id, display_order);`,

    // THE PIN ITSELF IS NEVER STORED, here or anywhere. This holds a hash and
    // its salt and the device compares. That is what lets a shared tablet
    // identify an operator at the face, which is the whole reason this app can
    // work with no network at all.
    `CREATE TABLE IF NOT EXISTS cached_credential (
       operator_id INTEGER PRIMARY KEY,
       pin_hash    TEXT NOT NULL,
       pin_salt    TEXT NOT NULL,
       badge_uid   TEXT,
       valid_to    TEXT,
       cached_at   TEXT NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS cached_credential_badge_idx ON cached_credential (badge_uid);`,

    // ── captured records ────────────────────────────────────────────────────

    `CREATE TABLE IF NOT EXISTS session (
       client_uuid        TEXT PRIMARY KEY,

       asset_id           INTEGER NOT NULL,
       shift_instance_id  INTEGER,
       session_type       TEXT    NOT NULL,
       sequence_no        INTEGER NOT NULL DEFAULT 1,

       -- The one operator attesting. One per session: that is the point.
       operator_id        INTEGER,
       operator_emp_id    TEXT,
       -- How he was identified, for audit. Never a login session.
       identified_by      TEXT,

       counterpart_uuid   TEXT,

       template_id        INTEGER,
       template_version   INTEGER,

       meter_reading      REAL,
       meter_uom          TEXT,
       fuel_level         REAL,
       location_id        INTEGER,

       -- The SERVER's state.
       status             TEXT    NOT NULL,
       blocked_reason     TEXT,
       reject_reason      TEXT,

       confirmed_by       TEXT,
       confirmed_at       TEXT,

       -- Deliberately separate from status: "the operator confirmed this" and
       -- "the server has it" are different facts, and a screen that conflates
       -- them tells somebody their handover is filed while it sits in a cab.
       sync_state         TEXT    NOT NULL DEFAULT 'draft',
       sync_attempts      INTEGER NOT NULL DEFAULT 0,
       sync_error         TEXT,
       last_sync_attempt_at TEXT,

       server_session_ref TEXT,
       server_session_id  INTEGER,

       captured_at        TEXT    NOT NULL,
       captured_offline   INTEGER NOT NULL DEFAULT 1,

       captured_lat       REAL,
       captured_lon       REAL,
       gps_accuracy_m     REAL,
       gps_status         TEXT,

       -- How stale the masters were at capture. A handover taken against
       -- three-day-old assignments is still a handover, but a supervisor
       -- reviewing it should be able to see that.
       master_cache_age_hours INTEGER,

       remarks            TEXT
     );`,
    `CREATE INDEX IF NOT EXISTS session_sync_idx ON session (sync_state, captured_at);`,
    `CREATE INDEX IF NOT EXISTS session_asset_idx ON session (asset_id, captured_at DESC);`,

    `CREATE TABLE IF NOT EXISTS response (
       local_id      INTEGER PRIMARY KEY AUTOINCREMENT,
       session_uuid  TEXT    NOT NULL REFERENCES session (client_uuid) ON DELETE CASCADE,
       item_id       INTEGER NOT NULL,
       -- The label AS ASKED, copied not joined: a retired or re-worded item
       -- must not change what a signed record says it answered.
       item_label    TEXT    NOT NULL,
       response_type TEXT    NOT NULL,
       answer        TEXT,
       numeric_value REAL,
       -- Both resolved on the device at capture, by the server's rules, so an
       -- offline verdict matches the one the server would reach.
       in_range      INTEGER,
       severity      TEXT,
       remark        TEXT,
       UNIQUE (session_uuid, item_id)
     );`,

    // Uploaded SEPARATELY from the session, so a slow photo on a bad
    // connection never stops the handover itself from reaching the server.
    `CREATE TABLE IF NOT EXISTS photo (
       photo_uuid    TEXT PRIMARY KEY,
       session_uuid  TEXT NOT NULL REFERENCES session (client_uuid) ON DELETE CASCADE,
       item_id       INTEGER,
       local_path    TEXT NOT NULL,
       bytes         INTEGER NOT NULL,
       -- So a re-upload after a half-finished transfer is recognised rather
       -- than duplicated.
       sha256        TEXT NOT NULL,
       sync_state    TEXT NOT NULL DEFAULT 'queued',
       sync_attempts INTEGER NOT NULL DEFAULT 0,
       server_ref    TEXT,
       captured_at   TEXT NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS photo_sync_idx ON photo (sync_state);`,
    `CREATE INDEX IF NOT EXISTS photo_session_idx ON photo (session_uuid);`,

    // What the device did and what the server said. Kept because the hardest
    // question about an offline system is "why does this record look like
    // that", and the answer is almost always in the sync history.
    `CREATE TABLE IF NOT EXISTS sync_log (
       local_id     INTEGER PRIMARY KEY AUTOINCREMENT,
       at           TEXT    NOT NULL,
       kind         TEXT    NOT NULL,
       subject_uuid TEXT,
       ok           INTEGER NOT NULL,
       http_status  INTEGER,
       detail       TEXT
     );`,

    `CREATE TABLE IF NOT EXISTS meta (
       key   TEXT PRIMARY KEY,
       value TEXT
     );`,
  ],
];
