-- 130: the mining faces become a list, instead of a number and free text.
--
-- ── WHAT IS WRONG TODAY ─────────────────────────────────────────────────────
-- excavation_plan carries loc_id, a face number, and face_desc, which is
-- whatever the person filing typed that day. loc_id points at
-- balcorpdb.mines_location_master -- a table that exists and HAS NEVER HELD A
-- ROW. minehub.location cannot stand in for it either: its ids are a
-- different series (its 4 is PIT-EAST, the plan's 4 is Pit Bottom West), so
-- joining the two would silently mislabel every face.
--
-- So the only description of a face is the text beside it, and across 4,151
-- rows seventeen faces have collected a hundred and nine spellings:
--
--   face 3   West ob · West ore&ob · West orer&ob · Wesdt ore&ob
--            West olre&ob · West ore& ob · West(120-144Mrl) · …18 in all
--   face 8   North ob · North OB · Noth ob · Nort ob · Northside OB
--
-- Any report that groups by the name counts one face several times. Only the
-- number is reliable, and nobody can read a number.
--
-- ── THE SEED IS DERIVED, NOT TYPED ──────────────────────────────────────────
-- Each face is named by the spelling the mine itself used most often, taken
-- from the plan rows. That is a starting point and not an opinion: the names
-- are editable on the Faces screen, and the mine should correct them, because
-- "East ore&ob" is a description of what a face yielded and not really its
-- name. Deriving it in SQL rather than pasting a list means this migration
-- produces the same answer on any database that holds the same plan.
--
-- WHAT EACH FACE YIELDS is derived the same way -- from whether its rows ever
-- carried ore, overburden or both. A face is not labelled by what somebody
-- thinks it is; it is labelled by what it has produced.
--
-- WHICH ARE STILL WORKING is derived from the last day planned against them.
-- Six of the seventeen were planned in the last sixty days; the rest stopped
-- between January and October. The entry screen offers the working ones and
-- keeps the rest for reading history, because a dropdown that offers a face
-- abandoned in January is how a plan gets filed against it again.
--
-- ── face_desc IS NOT DELETED ────────────────────────────────────────────────
-- The typed text stays on every historic row. It is the record of what was
-- filed, misspellings and all, and rewriting it would be editing the past to
-- match a list that did not exist when those rows were made. New rows take
-- their description from this master instead.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE FACES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mine_face (
    face_no     integer     PRIMARY KEY,

    -- What the mine calls it. UNIQUE so two faces cannot share a name and
    -- leave the next reader unable to tell which was meant.
    name        varchar(60) NOT NULL UNIQUE
                CHECK (btrim(name) <> ''),

    -- What comes out of it. ORE_OB is a face worked for both, which most of
    -- the pit faces are.
    face_kind   varchar(8)  NOT NULL DEFAULT 'ORE_OB'
                CHECK (face_kind IN ('ORE', 'OB', 'ORE_OB', 'DUMP', 'OTHER')),

    -- The bench, where the mine records one -- '40-64 MRL'. Free text on
    -- purpose: it is a label off a survey plan, not a measurement this
    -- platform computes.
    bench_rl    varchar(40),

    -- INACTIVE keeps a worked-out face readable in history without offering
    -- it for tomorrow.
    status      varchar(8)  NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'INACTIVE')),

    note        text,

    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now(),
    updated_by  varchar(32),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    revision    integer     NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

COMMENT ON TABLE mine_face IS
    'The mining faces, by the number the excavation plan has always used. '
    'Seeded in migration 130 from the plan''s own rows because the master it '
    'pointed at was empty; the names are the mine''s most-used spelling and '
    'are meant to be corrected on the Faces screen.';

COMMENT ON COLUMN mine_face.face_no IS
    'The same number excavation_plan.loc_id has always carried. NOT '
    'renumbered: the plan rows refer to it, and a tidier series would break '
    'the reference this table exists to resolve.';

CREATE INDEX IF NOT EXISTS mine_face_active_idx
    ON mine_face (status, face_no);


-- ---------------------------------------------------------------------------
-- 2. WHAT CHANGED ABOUT A FACE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mine_face_hist (
    id          bigserial   PRIMARY KEY,
    face_no     integer     NOT NULL,
    action      varchar(8)  NOT NULL CHECK (action IN ('ADDED','CHANGED','REMOVED')),
    field       varchar(40),
    old_value   text,
    new_value   text,
    revision    integer     NOT NULL CHECK (revision >= 1),
    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now(),

    CHECK (old_value IS DISTINCT FROM new_value)
);

CREATE INDEX IF NOT EXISTS mine_face_hist_face_idx
    ON mine_face_hist (face_no, entry_date DESC);


-- ---------------------------------------------------------------------------
-- 3. SEEDED FROM THE PLAN ITSELF
-- ---------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING so re-running never overwrites a name the mine has
-- since corrected -- which is the whole point of giving them a screen.
WITH spelling AS (
    SELECT loc_id,
           btrim(regexp_replace(face_desc, '\s+', ' ', 'g')) AS nm,
           count(*) AS uses
      FROM excavation_plan
     WHERE face_desc IS NOT NULL AND btrim(face_desc) <> ''
     GROUP BY 1, 2
), best AS (
    -- The spelling used most; the longest one breaks a tie, because the
    -- longer of two names for one face is usually the fuller one.
    SELECT DISTINCT ON (loc_id) loc_id, nm
      FROM spelling
     ORDER BY loc_id, uses DESC, length(nm) DESC, nm
), shape AS (
    SELECT loc_id,
           SUM(COALESCE(ore_qty, 0))    AS ore,
           SUM(COALESCE(ob_qty_cum, 0)) AS ob,
           MAX(prod_date)               AS last_planned
      FROM excavation_plan
     GROUP BY 1
)
, named AS (
    SELECT s.loc_id, s.ore, s.ob, s.last_planned,
           COALESCE(b.nm, 'Face ' || s.loc_id) AS nm,
           -- TWO FACES SHARE A NAME, in the mine's own typing: 5 and 10 are
           -- both "South ob". They are different places -- 5 yielded only
           -- overburden and stopped in March, 10 yielded ore as well and ran
           -- to May -- and a report grouping by that name has been adding
           -- them together.
           --
           -- The UNIQUE on name stays, because that is the whole defence
           -- against it happening again. The seed disambiguates instead, and
           -- the suffix is a prompt: whoever opens the Faces screen sees two
           -- names ending in a number and knows the mine has to say which is
           -- which.
           row_number() OVER (PARTITION BY COALESCE(b.nm, 'Face ' || s.loc_id)
                              ORDER BY s.loc_id) AS dup
      FROM shape s
      LEFT JOIN best b ON b.loc_id = s.loc_id
)
INSERT INTO mine_face (face_no, name, face_kind, status, note, entry_id)
SELECT s.loc_id,
       CASE WHEN s.dup = 1 THEN s.nm
            ELSE s.nm || ' (face ' || s.loc_id || ')' END,
       CASE WHEN s.ore > 0 AND s.ob > 0 THEN 'ORE_OB'
            WHEN s.ore > 0              THEN 'ORE'
            WHEN s.ob  > 0              THEN 'OB'
            ELSE 'OTHER' END,
       -- Sixty days: a face planned within the last two months is being
       -- worked, one that is not has stopped. Correct it on the screen; this
       -- only decides what the dropdown offers on day one.
       CASE WHEN s.last_planned >= (CURRENT_DATE - INTERVAL '60 days')
            THEN 'ACTIVE' ELSE 'INACTIVE' END,
       'Name seeded from the spelling the mine used most in the excavation '
       'plan. Last planned ' || s.last_planned || '.'
       || CASE WHEN s.dup > 1
               THEN ' ANOTHER FACE CARRIES THIS SAME NAME in the filed rows -'
                    || '- the mine should say which is which.'
               ELSE '' END,
       'MIG-130'
  FROM named s
ON CONFLICT (face_no) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 4. THE PLAN POINTS AT THE LIST
-- ---------------------------------------------------------------------------
-- Added only once every face in the plan is in the master, which the seed
-- above guarantees. From here a plan cannot be filed against a face number
-- that does not exist -- which is what let 109 spellings accumulate.
--
-- NOT VALID then VALIDATE: adding it outright scans the table under an
-- exclusive lock, and this one has 4,151 rows and is read by the LCM, the MIS
-- dashboard and the Executive Summary.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'excavation_plan_face_fkey'
                      AND conrelid = 'minehub.excavation_plan'::regclass) THEN
        ALTER TABLE excavation_plan
            ADD CONSTRAINT excavation_plan_face_fkey
            FOREIGN KEY (loc_id) REFERENCES mine_face (face_no)
            ON UPDATE CASCADE NOT VALID;
        ALTER TABLE excavation_plan VALIDATE CONSTRAINT excavation_plan_face_fkey;
    END IF;
END $$;
