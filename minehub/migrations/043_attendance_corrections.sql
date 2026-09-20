-- 043: correcting the gate record, without touching the gate record.
--
-- The readers are right about what they saw and silent about everything else.
-- A worker who came through a gate nobody was manning, or whose punch failed
-- because the reader was down — as it was on 17 and 18 September, when
-- twenty-seven and thirty-eight people had one punch instead of two — leaves a
-- gap. Today the only thing anybody can do about that gap is remember it.
--
-- NOTHING HERE WRITES TO SMARTFACE. The platform reads that database and never
-- writes to it: it belongs to the HR application, other people rely on it, and
-- a second system correcting it would make "what does attendance say" a
-- question with two answers. A correction is an additional record that
-- explains a gap. The punch data underneath stays exactly as the reader left
-- it, so anyone can always see both what was recorded and what was claimed.
--
-- TWO PEOPLE, NEVER ONE. Raising a correction and approving it are different
-- rights held by different people, the same way leave already works here
-- (ops.leave.apply / ops.leave.approve). A supervisor who could approve their
-- own corrections is a supervisor who can write attendance, and attendance
-- feeds a contractor's bill. The constraint is in the table as well as the
-- endpoint, because an endpoint can be bypassed and a CHECK cannot.
--
-- WHY A REASON IS COMPULSORY. A correction without one is unauditable six
-- months later, which is exactly when somebody asks. The reasons are rows in
-- checklist_item rather than a hard-coded list, so the mine can add one the
-- first time something happens that the list does not cover — the same
-- decision taken for assessment fields in 042, and it inherits that editor.

-- ── the reasons ─────────────────────────────────────────────────────────────
-- checklist_item carries a few columns that mean nothing for a reason
-- (asset_type_id, is_decisive). They stay null. A third near-identical lookup
-- table and a third editor for it would cost more than the unused columns do.

ALTER TABLE checklist_item DROP CONSTRAINT IF EXISTS checklist_item_kind_check;
ALTER TABLE checklist_item ADD CONSTRAINT checklist_item_kind_check
    CHECK (kind IN ('COMPETENCY', 'HOTO', 'ATTENDANCE_REASON'));

INSERT INTO checklist_item (kind, code, label, help, is_required, sort_order)
VALUES
 ('ATTENDANCE_REASON', 'READER_DOWN', 'Gate reader not working',
  'The reader was out of service or not responding. Check the day first — if many people are affected it is the gate, not the person.', FALSE, 10),
 ('ATTENDANCE_REASON', 'READER_FAILED_READ', 'Reader did not recognise the face',
  'The reader was working but would not accept this person. Worth re-enrolling if it keeps happening.', FALSE, 20),
 ('ATTENDANCE_REASON', 'FORGOT_TO_PUNCH', 'Worker did not punch',
  'Came through without punching. The commonest single-punch reason.', FALSE, 30),
 ('ATTENDANCE_REASON', 'OTHER_GATE', 'Entered or left by another gate',
  'A gate with no reader, or one they are not enrolled on.', FALSE, 40),
 ('ATTENDANCE_REASON', 'SHIFT_EXTENDED', 'Shift ran past midnight',
  'The out punch fell on the following day. Usually C shift.', FALSE, 50),
 ('ATTENDANCE_REASON', 'OFFSITE_DUTY', 'On duty away from site',
  'Working, but not through this gate — training, escort, another location.', FALSE, 60),
 ('ATTENDANCE_REASON', 'NOT_AT_WORK', 'Did not attend',
  'Confirmed absent. This is the only way absence gets asserted; a missing punch on its own never does.', FALSE, 70),
 ('ATTENDANCE_REASON', 'OTHER', 'Something else',
  'Say what happened in the remarks. If this gets used often, the list is missing a reason.', TRUE, 90)
ON CONFLICT (kind, code, asset_type_id) DO NOTHING;

-- ── the corrections ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance_correction (
    correction_id  bigserial PRIMARY KEY,

    party_id       bigint NOT NULL REFERENCES party(party_id),
    -- The number the readers know them by, copied rather than joined. An
    -- identity can be re-pointed later; what this correction was about cannot.
    emp_no         text NOT NULL,
    on_date        date NOT NULL,

    kind           text NOT NULL CHECK (kind IN (
                     'CLOCK_IN',      -- a punch in that the reader did not take
                     'CLOCK_OUT',     -- a punch out that the reader did not take
                     'MARK_PRESENT',  -- present, time unknown
                     'MARK_ABSENT',   -- confirmed absent
                     'NOTE')),        -- an explanation with no claim attached
    -- Required for the two that assert a time, meaningless for the rest.
    at_time        time,

    -- The code from checklist_item, not a foreign key. A reason that is
    -- retired must keep explaining the corrections already raised under it;
    -- a key would either block retiring it or rewrite history.
    reason_code    text NOT NULL,
    remarks        text,

    status         text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),

    requested_by   text NOT NULL,
    requested_at   timestamptz NOT NULL DEFAULT now(),
    decided_by     text,
    decided_at     timestamptz,
    decision_note  text,

    -- A time is the whole point of a clock correction.
    CONSTRAINT correction_needs_a_time
        CHECK (kind NOT IN ('CLOCK_IN', 'CLOCK_OUT') OR at_time IS NOT NULL),

    -- Nobody approves their own. The endpoint checks this too; the endpoint
    -- can be bypassed and this cannot.
    CONSTRAINT correction_needs_two_people
        CHECK (decided_by IS NULL OR decided_by <> requested_by),

    -- A decision has a decider and a moment, or it is not a decision.
    CONSTRAINT correction_decision_is_complete
        CHECK ((status IN ('PENDING', 'WITHDRAWN'))
               OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

COMMENT ON TABLE attendance_correction IS
    'What somebody says happened, where the gate readers are silent. Never '
    'written back to SmartFace: the punch data stays as the reader left it, '
    'and this sits beside it so both can be seen.';

COMMENT ON COLUMN attendance_correction.emp_no IS
    'Copied from party_identity at the time of raising, not joined. The '
    'identity can be re-pointed later; what this correction was about cannot.';

-- One open correction of a kind per person per day. Two people raising the
-- same missing punch is a queue with the same decision in it twice; the
-- second is told the first exists. Decided rows are not constrained, because
-- a rejected correction may legitimately be raised again with a better reason.
CREATE UNIQUE INDEX IF NOT EXISTS ux_correction_one_open
    ON attendance_correction (emp_no, on_date, kind)
 WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS ix_correction_queue
    ON attendance_correction (status, requested_at);
CREATE INDEX IF NOT EXISTS ix_correction_day
    ON attendance_correction (on_date, emp_no);

-- ── who may do what ─────────────────────────────────────────────────────────
-- Named to match ops.leave.apply / ops.leave.approve, which is the same shape
-- of question already answered on this platform.

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
 ('ops.attendance.correct', 'Operations', 'Raise an attendance correction',
  'Record what happened where the gate readers are silent — a missed punch, a '
  'reader that failed, a confirmed absence. Goes to somebody else to approve.',
  FALSE, 330),
 ('ops.attendance.approve', 'Operations', 'Approve an attendance correction',
  'Accept or refuse what a supervisor has claimed. Deliberately not held by '
  'the people who raise corrections: attendance feeds a contractor''s bill.',
  TRUE, 331)
ON CONFLICT (code) DO NOTHING;

-- The people on site who know who was there.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE p.code = 'ops.attendance.correct'
  AND r.code IN ('SHIFT_SUPERVISOR', 'OPERATOR_REGISTRAR')
ON CONFLICT DO NOTHING;

-- A role of its own, because nobody currently on the platform should quietly
-- acquire the right to write attendance.
INSERT INTO role (code, name, description, is_system)
VALUES ('ATTENDANCE_APPROVER', 'Attendance Approver',
        'Accepts or refuses attendance corrections raised by supervisors. '
        'Holds no right to raise one, which is the point of the role.', FALSE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE r.code = 'ATTENDANCE_APPROVER'
  AND p.code IN ('ops.attendance.approve', 'platform.operators.view',
                 'platform.registry.view')
ON CONFLICT DO NOTHING;

-- Superadmin picks both up through the standing grant from 014, which fires on
-- any permission inserted. Nothing to do here and nothing to remember.
