-- 101: let the dashboard read the RFQ portal's own tables.
--
-- The PR-to-Payment module follows a released purchase requisition from SCM
-- assignment through RFQ, evaluation, NFA, PO, receipt, invoice and payment.
-- SAP covers the PR and PO ends and this role already reads sap_odata_api;
-- everything between them -- the RFQ, the quotations, the technical
-- evaluation and the NFA approval chain -- lives in the scm schema, which
-- mines_app cannot see at all. The module fails with "permission denied for
-- schema scm" until this runs.
--
-- ── WHY NAMED TABLES AND NOT THE WHOLE SCHEMA ───────────────────────────────
-- 095 granted SELECT across the whole of sap_odata_api and balcorpdb, and the
-- obvious thing here is to follow that. It is not done, because scm is not
-- only procurement data: it holds scm_user_login, 1,012 rows of another
-- portal's credentials, and scm_quot_portal_session alongside them. A blanket
-- grant to read procurement would hand this application a second system's
-- password table as a side effect, and nothing would ever say so.
--
-- The cost is that a new table the module needs takes a migration. That is
-- the same discipline this repository now holds everything else to, and
-- check_migrations.py already enforces it.
--
-- ── THIS IS A DATABASE GRANT, NOT AN ACCESS RULE ────────────────────────────
-- Quotation values and commercial comparisons are commercially sensitive, and
-- who may see them is a question for the application's own permissions, not
-- for this file. All this says is that the server process may read the rows;
-- which user is shown which column is decided above it.

GRANT USAGE ON SCHEMA scm TO mines_app;

DO $$
DECLARE
    tbl        text;
    owner_role text;
    wanted     text[] := ARRAY[
        -- the RFQ and who was invited
        'scm_quot_generated_rfq',
        'scm_quot_vendor_invitation',
        'scm_quot_rfq_line',
        'scm_quot_rfq_response_deadline',
        -- what came back
        'scm_quot_quotation',
        'scm_quot_quotation_item',
        -- technical evaluation
        'scm_quot_technical_eval_submission',
        'scm_quot_technical_eval_clarification_thread',
        -- the NFA and its approval chain
        'scm_quot_nfa_master',
        'scm_quot_nfa_approvals',
        'scm_quot_nfa_audit',
        -- the buyer, the priority, the mode and the remarks
        'scm_pur_group',
        'scm_quot_pr_priority',
        'scm_quot_pr_procurement',
        'scm_quot_pr_remark',
        'scm_quot_pr_release_notified'
    ];
BEGIN
    FOREACH tbl IN ARRAY wanted LOOP
        -- A table that is not there yet is skipped rather than failing: this
        -- file is replayable against a database the portal has not populated,
        -- which is exactly the development server.
        CONTINUE WHEN to_regclass('scm.' || tbl) IS NULL;
        EXECUTE format('GRANT SELECT ON scm.%I TO mines_app', tbl);
    END LOOP;

    -- Future tables in scm are NOT granted by default, for the reason above.
    -- But a table in this list that the portal REPLACES -- dropped and
    -- recreated by its own migration -- would silently lose the grant, so the
    -- owners that create objects there grant SELECT on replacements of these
    -- names only. There is no ALTER DEFAULT PRIVILEGES that can be limited to
    -- a list of names, so this is left to a re-run of this file instead.
    NULL;
END
$$;

COMMENT ON SCHEMA scm IS
    'SCM / RFQ portal. mines_app holds SELECT on the procurement tables the '
    'PR-to-Payment module reads -- see migration 101 -- and on nothing else '
    'in here, deliberately: scm_user_login lives in this schema.';
