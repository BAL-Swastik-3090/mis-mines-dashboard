-- 087: the SAP quality feed, under the names the code already uses.
--
-- WHY THIS VIEW EXISTS. The dashboard reads SAP quality inspections from
-- balcorpdb.pp_quality_inspection on MySQL. The same feed now lands in
-- Postgres as sap_odata_api.quality_inspect, and Postgres is the better
-- source: it is not a mirror of the MySQL table, it is a superset of it.
--
-- Measured on 27 Oct 2026, before anything was changed:
--
--   rows            MySQL 312,113      Postgres 423,385
--   first reading   2024-03-30         2023-12-23
--   September 2026  11,814 rows        12,032 rows
--
-- and, comparing September key by key on (LOT_NUMBER, NODE_NUMBER,
-- INSPEC_CHAR_NO): zero duplicate keys on either side, zero keys MySQL holds
-- that Postgres does not, and 218 keys only Postgres holds. MySQL is a strict
-- subset. The gap is not an artefact of the comparison -- it is inspection
-- characteristics the MySQL sync never received.
--
-- So the figures this feed drives -- Cr2O3 and Cr/Fe on the Executive Summary
-- among them -- will move when the application starts reading Postgres. They
-- will move because they were computed from an incomplete table, which is the
-- point of the change, and is worth saying out loud rather than discovering
-- in a review meeting.
--
-- WHY A VIEW RATHER THAN EDITING THE QUERIES. The two tables hold the same 35
-- fields and differ only in how the names are spelled: MySQL writes
-- LOT_NUMBER, QLT_START_DATE, INSPEC_CHAR_NO; the Postgres copy writes
-- lotnumber, qltstartdate, inspeccharno. Fourteen query sites select from
-- this table, several of them naming most of the 35 columns. Re-typing those
-- lists by hand is the kind of edit that silently swaps two similarly named
-- fields and is not caught by any test the figures would fail loudly on --
-- posted_qty and actually_quantity sit next to each other and are both
-- numeric.
--
-- The view does the renaming once, in one place, checked against
-- information_schema rather than by eye. Every column is aliased to the
-- lower-case underscored spelling, because Postgres folds an unquoted
-- LOT_NUMBER in the application's SQL to lot_number -- so the existing
-- queries resolve against this view unchanged.
--
-- group_name, plant, supplier, batch, result and msg are spelled the same in
-- both and are aliased anyway, so the list reads as one mapping rather than
-- as a mapping with exceptions.

CREATE OR REPLACE VIEW sap_odata_api.pp_quality_inspection AS
SELECT
    lotnumber                AS lot_number,
    plant                    AS plant,
    materialno               AS material_no,
    materialdesc             AS material_desc,
    lotquantity              AS lot_quantity,
    lotqtyunit               AS lot_qty_unit,
    qltstartdate             AS qlt_start_date,
    inspectiontype           AS inspection_type,
    shorttext                AS short_text,
    createdby                AS created_by,
    group_name               AS group_name,
    supplier                 AS supplier,
    batch                    AS batch,
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
    glaccno                  AS gl_acc_no,
    nodenumber               AS node_number,
    inspeccharno             AS inspec_char_no,
    shorttextinschar         AS short_text_ins_char,
    result                   AS result,
    msg                      AS msg
FROM sap_odata_api.quality_inspect;

COMMENT ON VIEW sap_odata_api.pp_quality_inspection IS
    'sap_odata_api.quality_inspect under the column names the Mines dashboard uses. Added by 087 so the application could move off the MySQL copy, which is a strict subset of this feed. Do not add a column here without adding it to quality_inspect first.';
