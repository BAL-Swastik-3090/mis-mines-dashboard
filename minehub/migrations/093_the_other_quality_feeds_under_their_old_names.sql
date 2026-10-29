-- 093: the three quality tables under the names the code already knows.
--
-- The SAP OData feed carries these, and has more of them than MySQL does:
--
--   qm_quality_control           243,902 rows in MySQL -> 352,469 in the feed
--   qm_quality_control_result    552,081               -> 783,145
--   qm_inprocess_inspect_result  114,043               -> 192,917
--
-- They were missed when the feed was first surveyed because the feed names
-- them differently -- quality_insp_data, quality_insp_result and
-- qm_inspection_result_detail -- and a survey that matched on table name
-- reported them as MySQL-only. They are not. The same mistake had already
-- been made once with pp_quality_inspection, which is quality_inspect; this
-- is migration 089 doing the same job for the other three.
--
-- ── THE COLUMN NAMES ARE THE OLD ONES WITH THE UNDERSCORES REMOVED ──────────
-- lot_number -> lotnumber, qlt_start_date -> qltstartdate, and so on, which is
-- why these views are generated from the two catalogues rather than typed.
-- Three columns do NOT follow that rule and are handled by hand:
--
--   SHORTTEXTCHARA -> shorttextchar. Verified by its values, not its name:
--     both sides return CHROMIUM, CARBON, CR2O3, FEO, SIO2. plant_output.py
--     is the only reader and it wraps the column in UPPER(), which also
--     absorbs the feed's mixed case ('Carbon' beside 'CARBON').
--
--   GROUPS_NAME is DELIBERATELY ABSENT. The feed has a column called `groups`
--     and it is tempting to map the two. It is not the same data: MySQL holds
--     'RM000137', the feed holds '00000001'. Mapping them would have produced
--     a view that worked and lied. Nothing reads GROUPS_NAME, so the view
--     omits it and a future reader gets an error rather than a wrong answer.
--
--   PROD_ORDER and CREATETIME are absent for the same reason: the feed has
--     order_no and insp_time, nothing reads either column, and a guess that
--     nobody is checking is worse than a gap somebody will.
--
-- Column aliases are LOWERCASE on purpose. Postgres folds an unquoted
-- SELECT LOT_NUMBER to lot_number, so a view exposing "LOT_NUMBER" quoted
-- would never match the queries that read it. 089 made the same choice.

CREATE OR REPLACE VIEW sap_odata_api.qm_quality_control AS
SELECT
    lotnumber                AS lot_number,
    plant                    AS plant,
    materialno               AS material_no,
    materialdesc             AS material_desc,
    materialtype             AS material_type,
    lotquantity              AS lot_quantity,
    lotqtyunit               AS lot_qty_unit,
    qltstartdate             AS qlt_start_date,
    qltenddate               AS qlt_end_date,
    inspectiontype           AS inspection_type,
    shorttext                AS short_text,
    shorttextchar            AS short_text_char,
    createdby                AS created_by,
    lotcreateddt             AS lot_created_dt,
    usagestype               AS usages_type,
    codegroup                AS code_group,
    usagedecicode            AS usage_deci_code,
    codevaluation            AS code_valuation,
    followupaction           AS follow_up_action,
    supplier                 AS supplier,
    batch                    AS batch,
    usages                   AS usages,
    storagelocation          AS storage_location,
    pono                     AS po_no,
    poitem                   AS po_item,
    documenttype             AS document_type,
    matdocyear               AS mat_doc_year,
    matdocno                 AS mat_doc_no,
    matdocitem               AS mat_doc_item,
    postingdate              AS posting_date,
    movementtype             AS movement_type,
    stockheldplant           AS stock_held_plant,
    lotstockstloc            AS lot_stock_st_loc,
    samplesize               AS sample_size,
    unrestrictedusestock     AS unrestricted_use_stock,
    postedqty                AS posted_qty,
    actuallyquantity         AS actually_quantity,
    actuallotquantity        AS actual_lot_quantity,
    ordernumber              AS order_number,
    routingno                AS routing_no,
    glaccno                  AS gl_acc_no,
    inspindicator            AS insp_indicator,
    msg                      AS msg,
    sampleidentity           AS sample_identity,
    samplelocation           AS sample_location,
    shift                    AS shift,
    sampledate               AS sample_date,
    sampletime               AS sample_time
  FROM sap_odata_api.quality_insp_data;

CREATE OR REPLACE VIEW sap_odata_api.qm_quality_control_result AS
SELECT
    lotnumber                AS lot_number,
    nodenumber               AS node_number,
    qltstartdate             AS qlt_start_date,
    inspeccharno             AS inspec_char_no,
    shorttextinschar         AS short_text_ins_char,
    results                  AS results,
    plant                    AS plant,
    materialno               AS material_no,
    materialdesc             AS material_desc,
    materialtype             AS material_type,
    ordernumber              AS order_number,
    routingno                AS routing_no,
    usages                   AS usages,
    msg                      AS msg
  FROM sap_odata_api.quality_insp_result;

CREATE OR REPLACE VIEW sap_odata_api.qm_inprocess_inspect_result AS
SELECT
    plant                    AS plant,
    material                 AS material,
    insplot                  AS insplot,
    lotorigin                AS lotorigin,
    sampleidentity           AS sampleidentity,
    samplelocation           AS samplelocation,
    lotqty                   AS lotqty,
    shift                    AS shift,
    sampledate               AS sampledate,
    sampletime               AS sampletime,
    characteristics          AS characteristics,
    mstrchar                 AS mstrchar,
    shorttextchar            AS shorttextchara,
    valuation                AS valuation,
    lowerlimit               AS lowerlimit,
    upperlimit               AS upperlimit,
    result                   AS result,
    createdate               AS createdate,
    createon                 AS createon
  FROM sap_odata_api.qm_inspection_result_detail;

