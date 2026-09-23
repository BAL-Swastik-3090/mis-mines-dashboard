-- 063: fields the mine can add without a developer.
--
-- Asked for more than once and answered each time with another fixed column.
-- Every time the mine needed somewhere to put a fact — a PAN, a pay grade, a
-- nominee — the answer was a migration, a deployment, and a wait. That is the
-- wrong shape for a register that is still learning what it holds, and it is
-- the same complaint already made about the manpower filters and the
-- weighbridge lists: a list that cannot be edited without a developer is the
-- wrong list.
--
-- So: a field is a row. Somebody with the right permission names it, picks a
-- type from a dropdown, says which screen it belongs on, and it appears.
--
-- WHY NOT JUST A JSON BLOB ON EVERY TABLE
-- Because then nobody can say what fields exist, what type they are, which are
-- required, or which are sensitive — and every screen would have to guess. The
-- definition is a row so the platform can answer "what does an operator
-- record hold" without reading every operator.
--
-- WHY THE VALUE IS jsonb AND NOT FOUR TYPED COLUMNS
-- A typed column per kind — value_text, value_num, value_date, value_bool —
-- indexes better and needs a constraint tying the column to the definition's
-- type, which is fiddly and easy to get subtly wrong. jsonb holds a string, a
-- number, a date or a list without argument, and these are lookup-by-entity
-- fields rather than things anyone filters a million rows by. If that changes,
-- a typed column can be added later without moving the data.

-- ---------------------------------------------------------------------------
-- 1. What a field is
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_definition (
    field_definition_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Which register it belongs to. Not a foreign key to anything: the whole
    -- point is that a new screen can start using fields without this table
    -- changing.
    entity      text NOT NULL,
    code        text NOT NULL,
    label       text NOT NULL,

    data_type   text NOT NULL CHECK (data_type IN (
                    'TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'BOOLEAN',
                    'SELECT', 'MULTI_SELECT', 'PHONE', 'EMAIL')),
    -- The choices, for SELECT and MULTI_SELECT. A list of strings.
    options     jsonb,

    -- Where it appears. Free text so a new grouping does not need a migration
    -- either — that would be the same mistake one level up.
    section     text NOT NULL DEFAULT 'More details',
    hint        text,
    placeholder text,

    is_required  boolean NOT NULL DEFAULT false,
    -- Marked rather than hidden here: the screen decides what to do about it,
    -- and a field nobody flagged is a field shown to everyone by accident.
    is_sensitive boolean NOT NULL DEFAULT false,

    sort_order  integer NOT NULL DEFAULT 100,
    status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,

    CONSTRAINT field_code_once_per_entity UNIQUE (entity, code),
    -- A dropdown with no choices is a text box that pretends otherwise.
    CONSTRAINT select_needs_options CHECK (
        data_type NOT IN ('SELECT', 'MULTI_SELECT')
        OR (options IS NOT NULL AND jsonb_array_length(options) > 0))
);
CREATE INDEX IF NOT EXISTS ix_field_def_entity
    ON field_definition (entity, sort_order) WHERE status = 'ACTIVE';

DROP TRIGGER IF EXISTS field_definition_touch ON field_definition;
CREATE TRIGGER field_definition_touch BEFORE UPDATE ON field_definition
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE field_definition IS
    'Fields the mine added itself. A field is a row: name it, pick a type, say '
    'which screen it belongs on, and it appears — no migration, no deploy.';

-- ---------------------------------------------------------------------------
-- 2. What somebody put in it
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_value (
    field_value_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    field_definition_id bigint NOT NULL
        REFERENCES field_definition (field_definition_id) ON DELETE CASCADE,
    -- The row it belongs to, in whatever table the definition names.
    entity_id   bigint NOT NULL,
    value       jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text,
    CONSTRAINT one_value_per_field_per_row UNIQUE (field_definition_id, entity_id)
);
CREATE INDEX IF NOT EXISTS ix_field_value_row ON field_value (entity_id);

DROP TRIGGER IF EXISTS field_value_touch ON field_value;
CREATE TRIGGER field_value_touch BEFORE UPDATE ON field_value
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN field_value.value IS
    'Whatever the field''s type says it is — a string, a number, a date as '
    'text, true/false, or a list for a multi-select. Null means unanswered, '
    'which is different from an empty string somebody typed.';

-- ---------------------------------------------------------------------------
-- 3. A value must suit its field
-- ---------------------------------------------------------------------------
-- Checked here rather than only in the API, because the API is not the only
-- thing that will ever write to this table and a dropdown value that is not
-- one of the choices is not a typo, it is a broken record.
CREATE OR REPLACE FUNCTION field_value_fits_its_field() RETURNS trigger AS $$
DECLARE d RECORD;
BEGIN
    SELECT data_type, options, label INTO d
      FROM field_definition WHERE field_definition_id = NEW.field_definition_id;

    IF NEW.value IS NULL OR NEW.value = 'null'::jsonb THEN
        RETURN NEW;                       -- unanswered is always allowed
    END IF;

    IF d.data_type IN ('NUMBER') AND jsonb_typeof(NEW.value) <> 'number' THEN
        RAISE EXCEPTION '% expects a number, got %', d.label, NEW.value;
    END IF;

    IF d.data_type = 'BOOLEAN' AND jsonb_typeof(NEW.value) <> 'boolean' THEN
        RAISE EXCEPTION '% expects true or false, got %', d.label, NEW.value;
    END IF;

    IF d.data_type = 'SELECT'
       AND NOT (d.options @> jsonb_build_array(NEW.value #>> '{}')) THEN
        RAISE EXCEPTION '% is not one of the choices for %', NEW.value, d.label;
    END IF;

    IF d.data_type = 'MULTI_SELECT' THEN
        IF jsonb_typeof(NEW.value) <> 'array' THEN
            RAISE EXCEPTION '% expects a list', d.label;
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.value) AS v
                    WHERE NOT (d.options @> jsonb_build_array(v))) THEN
            RAISE EXCEPTION 'one of those is not a choice for %', d.label;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS field_value_is_valid ON field_value;
CREATE TRIGGER field_value_is_valid
    BEFORE INSERT OR UPDATE ON field_value
    FOR EACH ROW EXECUTE FUNCTION field_value_fits_its_field();

-- ---------------------------------------------------------------------------
-- 4. Who may add a field
-- ---------------------------------------------------------------------------
-- Adding a field changes what every record of that kind can hold and what
-- every user is asked for. That is a decision about the shape of the register,
-- not a day's data entry, so it is held apart from filling one in.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
  ('platform.fields.manage', 'Platform', 'Add and change fields',
   'Create a field on a register — name it, choose its type, say where it '
   'appears — and retire one that is no longer wanted. Changes what everybody '
   'is asked for from then on.', TRUE, 260)
ON CONFLICT (code) DO NOTHING;
