-- ============================================================================
-- MineHub · Migration 002 · Roles and permissions
-- ============================================================================
-- Replaces the four hardcoded roles with a model where roles are data.
--
-- Two problems with what came before:
--
--   1. The role list was an enum in code and a CHECK constraint in the database,
--      so creating a role meant a migration and a deployment. Access policy
--      changes far more often than software does.
--
--   2. The names collided with job titles. Six designations at this mine contain
--      the word "Manager" - Manager, Dy Manager, Sr Manager, Asst Manager,
--      General Manager, Sr General Manager - so a system role called "manager"
--      said nothing, and a Sr General Manager holding it looked demoted.
--
-- Roles are now named for what they let you DO in the software, never for rank,
-- and permissions are the unit of access. A role is a bundle of permissions; a
-- person holds roles. Adding a capability is a permission row, not a deployment.
-- ============================================================================

SET search_path TO minehub, public;

-- ---------------------------------------------------------------------------
-- permission — the atoms. One row per thing a person can do.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission (
    permission_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,       -- dashboard.mis · access.roles.manage
    module         text NOT NULL,              -- groups them in the UI
    name           text NOT NULL,
    description    text,
    -- A permission that gates something dangerous is shown differently and
    -- cannot be given to a role by accident.
    is_sensitive   boolean NOT NULL DEFAULT false,
    sort_order     smallint NOT NULL DEFAULT 100,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- role — bundles of permissions. Created and named by the people who use them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role (
    role_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    description    text,
    -- System roles cannot be deleted or renamed: they are referenced by the
    -- bootstrap path, and deleting the one that grants access management would
    -- leave nobody able to restore it.
    is_system      boolean NOT NULL DEFAULT false,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);

CREATE TABLE IF NOT EXISTS role_permission (
    role_id        bigint NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
    permission_id  bigint NOT NULL REFERENCES permission(permission_id) ON DELETE CASCADE,
    granted_at     timestamptz NOT NULL DEFAULT now(),
    granted_by     text,
    PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- user_access — who holds which role.
-- ---------------------------------------------------------------------------
-- Keyed on emp_id rather than party_id for now: the party registry is not yet
-- populated, and access must keep working through that import. Migration 0xx
-- adds party_id and backfills once every holder exists as a party.
CREATE TABLE IF NOT EXISTS user_access (
    user_access_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emp_id         text NOT NULL,
    role_id        bigint NOT NULL REFERENCES role(role_id),
    party_id       bigint REFERENCES party(party_id),
    valid_from     date NOT NULL DEFAULT CURRENT_DATE,
    valid_to       date,
    granted_by     text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_role UNIQUE (emp_id, role_id)
);
CREATE INDEX IF NOT EXISTS ix_user_access_emp ON user_access (emp_id);

-- ---------------------------------------------------------------------------
-- Seed the permissions
-- ---------------------------------------------------------------------------
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
SELECT v.code, v.module, v.name, v.description, v.sensitive, v.sort_order
FROM (VALUES
    -- dashboards
    ('dashboard.mis',           'Dashboards', 'MIS Dashboard',
     'Production, despatch, stock, plant, equipment and dewatering', false, 10),
    ('dashboard.oee',           'Dashboards', 'OEE / LCM',
     'Equipment effectiveness and lost cost matrix', false, 20),
    ('dashboard.intelligence',  'Dashboards', 'Intelligence',
     'Reality Check and AI-generated insights', false, 30),
    ('dashboard.fuel',          'Dashboards', 'Fuel Management',
     'Fleet fuel levels, consumption and refills', false, 40),
    ('dashboard.ev',            'Dashboards', 'Electric Vehicles',
     'Electric vehicle tracking', false, 50),

    -- access administration
    ('access.users.view',       'Access', 'View users',
     'See who has access and which roles they hold', false, 110),
    ('access.users.manage',     'Access', 'Grant and revoke access',
     'Add people, change their roles, remove access', true, 120),
    ('access.roles.manage',     'Access', 'Manage roles',
     'Create roles and decide which permissions each one carries', true, 130),

    -- the platform itself
    ('platform.registry.view',  'Platform', 'View registry',
     'Browse equipment, people, locations and materials', false, 210),
    ('platform.registry.manage','Platform', 'Manage registry',
     'Register machines and people, link system identities', true, 220),
    ('platform.settings',       'Platform', 'Platform settings',
     'Database migrations, integrations and platform configuration', true, 230)
) AS v(code, module, name, description, sensitive, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM permission p WHERE p.code = v.code);

-- ---------------------------------------------------------------------------
-- Seed the system roles
-- ---------------------------------------------------------------------------
-- Named for what they let you do, never for seniority. "Platform Owner" cannot
-- be confused with a job title; "Manager" could be, and was.
INSERT INTO role (code, name, description, is_system, created_by)
SELECT v.code, v.name, v.description, true, 'MIGRATION_002'
FROM (VALUES
    ('PLATFORM_OWNER', 'Platform Owner',
     'Full control, including the registry and platform settings. Can create roles.'),
    ('ACCESS_MANAGER', 'Access Manager',
     'Grants and removes access and manages roles. Does not administer the platform.'),
    ('DASHBOARD_VIEWER', 'Dashboard Viewer',
     'Reads the dashboards their role allows. The default for a new user.')
) AS v(code, name, description)
WHERE NOT EXISTS (SELECT 1 FROM role r WHERE r.code = v.code);

-- Platform Owner holds everything, including permissions added later. That is
-- handled in code by the role's is_system + code check rather than by a row per
-- permission, so a new permission never needs a migration to reach the owner.
INSERT INTO role_permission (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, 'MIGRATION_002'
FROM role r CROSS JOIN permission p
WHERE r.code = 'PLATFORM_OWNER'
  AND NOT EXISTS (SELECT 1 FROM role_permission rp
                  WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

INSERT INTO role_permission (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, 'MIGRATION_002'
FROM role r JOIN permission p ON p.code IN (
        'dashboard.mis','dashboard.oee','dashboard.intelligence','dashboard.fuel','dashboard.ev',
        'access.users.view','access.users.manage','access.roles.manage')
WHERE r.code = 'ACCESS_MANAGER'
  AND NOT EXISTS (SELECT 1 FROM role_permission rp
                  WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

INSERT INTO role_permission (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, 'MIGRATION_002'
FROM role r JOIN permission p ON p.code IN (
        'dashboard.mis','dashboard.oee','dashboard.intelligence','dashboard.fuel','dashboard.ev')
WHERE r.code = 'DASHBOARD_VIEWER'
  AND NOT EXISTS (SELECT 1 FROM role_permission rp
                  WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger for role
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_role_updated ON role;
CREATE TRIGGER trg_role_updated BEFORE UPDATE ON role
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO schema_migration (migration_id, description)
VALUES ('002_roles_and_permissions', 'Dynamic roles, permissions and user access')
ON CONFLICT (migration_id) DO NOTHING;
