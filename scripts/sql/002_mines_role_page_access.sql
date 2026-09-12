-- Page access per role for the Mines dashboard.
--
-- Run once against balcorpdb on 80.9.2.78, after 001_mines_user_role.sql.
--
-- Which pages a role may open. Managed from the in-app Access Control screen,
-- which only 'admin' (the super admin) can see. Enforced on the API prefixes
-- behind each page, not just on the sidebar — hiding a menu entry would leave
-- the data reachable by anyone who knows the URL.
--
-- Seeded wide open (every role sees every page), matching the behaviour before
-- this table existed. Tighten it from the UI, not by editing rows here.

CREATE TABLE IF NOT EXISTS mines_role_page_access (
    role        VARCHAR(20)  NOT NULL,           -- viewer | manager | admin
    page        VARCHAR(40)  NOT NULL,           -- mis | oee | intelligence | fuel-management | ev-tracking
    allowed     TINYINT(1)   NOT NULL DEFAULT 1,
    updated_by  VARCHAR(20)  NULL,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role, page)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO mines_role_page_access (role, page, allowed, updated_by) VALUES
    ('viewer','mis',1,'SEED'),
    ('viewer','oee',1,'SEED'),
    ('viewer','intelligence',1,'SEED'),
    ('viewer','fuel-management',1,'SEED'),
    ('viewer','ev-tracking',1,'SEED'),
    ('manager','mis',1,'SEED'),
    ('manager','oee',1,'SEED'),
    ('manager','intelligence',1,'SEED'),
    ('manager','fuel-management',1,'SEED'),
    ('manager','ev-tracking',1,'SEED'),
    ('admin','mis',1,'SEED'),
    ('admin','oee',1,'SEED'),
    ('admin','intelligence',1,'SEED'),
    ('admin','fuel-management',1,'SEED'),
    ('admin','ev-tracking',1,'SEED')
ON DUPLICATE KEY UPDATE allowed = VALUES(allowed);

SELECT role, page, allowed FROM mines_role_page_access ORDER BY role, page;
