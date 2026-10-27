-- 086: the SAP rows we read, kept where we can index them.
--
-- Every production, quality, breakdown and maintenance figure on this platform
-- is read out of tables SAP writes into balcorpdb. They are big, they are
-- shared with two dozen other applications, and not one of the four that
-- matter most carries an index on a date:
--
--     pp_production               336,701 rows   112 MB   no date index
--     pp_quality_inspection       278,539 rows   100 MB   no date index
--     zpm_iw29_notifications       54,765 rows    26 MB   no date index
--     mm_plant_maint_calibration   43,606 rows    17 MB   no date index
--
-- So every one of those reads is a full scan. get_daily_actuals -- a single
-- query behind the Production screen -- takes 1,978 ms to find the 3,381 rows
-- of pp_production that belong to this mine. EXPLAIN says it all: type ALL,
-- 336,701 rows examined, 2.22% of them kept.
--
-- THE INDEX THAT WOULD FIX IT IS NOT OURS TO ADD. These are SAP's own tables
-- in a database twenty-five applications share, and adding an index to one is
-- not a change this project gets to make quietly.
--
-- So the rows come here instead. 199,732 of them across five tables -- the
-- mine's share, nobody else's -- where an index costs nothing and the whole
-- set fits in a few pages.
--
-- THE SAME SHAPE AS THE USAGE AND FUEL MIRRORS, for the same reason and with
-- the same rule: balcorpdb stays the place SAP writes. Nothing writes here but
-- the sync, and the whole thing can be dropped and rebuilt from the source.
--
-- NAMES ARE KEPT EXACTLY. The tables carry their SAP names and their SAP
-- columns, lower-cased because Postgres folds unquoted identifiers that way.
-- A query that reads these is the query that read balcorpdb, unchanged -- so
-- the migration is a change of session, not a rewrite of forty queries, and
-- the two can be compared row for row while both exist.


-- pp_production: 3,381 rows are the mine's, of 21 columns.
CREATE TABLE IF NOT EXISTS pp_production (
    order_number               text,
    order_type                 text,
    order_desc                 text,
    created_on                 date,
    company_code               text,
    plant                      text,
    work_center                text,
    work_center_desc           text,
    material_document          text,
    document_year              text,
    mat_doc_item               text,
    movement_type              text,
    material_no                text,
    material_desc              text,
    storage_location           text,
    batch_number               text,
    amount_local_curr          numeric(13,2),
    quantity                   numeric(13,3),
    unit                       text,
    posting_date               date,
    msg                        text,
    synced_at                  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (order_number, material_document, mat_doc_item)
);
CREATE INDEX IF NOT EXISTS ix_pp_production_plant_posting_date
    ON pp_production (plant, posting_date);
CREATE INDEX IF NOT EXISTS ix_pp_production_posting_date
    ON pp_production (posting_date);
CREATE INDEX IF NOT EXISTS ix_pp_production_material_no
    ON pp_production (material_no);

-- pp_quality_inspection: 173,848 rows are the mine's, of 35 columns.
CREATE TABLE IF NOT EXISTS pp_quality_inspection (
    lot_number                 text,
    plant                      text,
    material_no                text,
    material_desc              text,
    lot_quantity               numeric(13,3),
    lot_qty_unit               text,
    qlt_start_date             date,
    inspection_type            text,
    short_text                 text,
    created_by                 text,
    group_name                 text,
    supplier                   text,
    batch                      text,
    storage_location           text,
    po_no                      text,
    po_item                    text,
    document_type              text,
    mat_doc_year               text,
    mat_doc_no                 text,
    mat_doc_item               text,
    posting_date               date,
    movement_type              text,
    stock_held_plant           text,
    lot_stock_st_loc           text,
    sample_size                numeric(13,3),
    unrestricted_use_stock     numeric(13,3),
    posted_qty                 numeric(13,3),
    actually_quantity          numeric(13,3),
    actual_lot_quantity        numeric(13,3),
    gl_acc_no                  text,
    node_number                text,
    inspec_char_no             text,
    short_text_ins_char        text,
    result                     numeric(10,4),
    msg                        text,
    synced_at                  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lot_number, inspec_char_no)
);
CREATE INDEX IF NOT EXISTS ix_pp_quality_inspection_plant_storage_loca_qlt_start_da
    ON pp_quality_inspection (plant, storage_location, qlt_start_date);
CREATE INDEX IF NOT EXISTS ix_pp_quality_inspection_lot_number
    ON pp_quality_inspection (lot_number);
CREATE INDEX IF NOT EXISTS ix_pp_quality_inspection_qlt_start_da
    ON pp_quality_inspection (qlt_start_date);
CREATE INDEX IF NOT EXISTS ix_pp_quality_inspection_material_no
    ON pp_quality_inspection (material_no);

-- pp_prod_order_confirmation: 1,975 rows are the mine's, of 19 columns.
CREATE TABLE IF NOT EXISTS pp_prod_order_confirmation (
    order_no                   text,
    order_type                 text,
    order_category             numeric(2,0),
    plant                      text,
    confirmation               numeric(10,0),
    confirm_counter            text,
    work_center                text,
    posting_date               date,
    confirmed_yield            numeric(13,3),
    uom                        text,
    activity                   text,
    activity_conf_1            numeric(13,3),
    activity1_unit             text,
    activity_conf_2            numeric(13,3),
    activity2_unit             text,
    confirm_text               text,
    lotno                      text,
    reverse_ind                text,
    msg                        text,
    synced_at                  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (order_no, order_type, plant, confirmation, confirm_counter)
);
CREATE INDEX IF NOT EXISTS ix_pp_prod_order_confirmation_plant_posting_date
    ON pp_prod_order_confirmation (plant, posting_date);

-- zpm_iw29_notifications: 11,705 rows are the mine's, of 56 columns.
CREATE TABLE IF NOT EXISTS zpm_iw29_notifications (
    notification               text,
    maintenance_plant          text,
    plant_section              text,
    work_center                text,
    main_work_center           text,
    malfunction_start          date,
    notification_date          date,
    description                text,
    system_status              text,
    completion_date            date,
    notification_type          text,
    created_on                 date,
    created_by                 text,
    breakdown_duraion          numeric(10,2),
    equipment                  text,
    malfunction_end            date,
    malfunction_start_time     text,
    malfunction_end_time       text,
    functional_location        text,
    completion_time            text,
    abc_indicator              text,
    plant_for_work_ctr         text,
    order_no                   text,
    equipment_affected         text,
    functional_loc_affect      text,
    sort_field                 text,
    desc_tech_object           text,
    loc_acctassignment         text,
    cost_center                text,
    coding_code_text           text,
    codeg_roup_text            text,
    required_end_date          date,
    required_end_time          text,
    breakdown_durtn_unit       text,
    breakdown                  text,
    notification_time          text,
    object_number              text,
    emplresp_person            text,
    desc_functional_loc        text,
    priority_type              text,
    priority                   text,
    priority_text              text,
    coding_code                text,
    code_group                 text,
    reported_by                text,
    catalog_profile            text,
    revision                   text,
    location                   text,
    circle_description         text,
    circle_no                  text,
    abnormality_ypes           text,
    fuguai_colour_type         text,
    impact_category            text,
    tab1                       text,
    fuguai_tag_no              text,
    msg                        text,
    synced_at                  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notification)
);
CREATE INDEX IF NOT EXISTS ix_zpm_iw29_notifications_maintenance__malfunction_
    ON zpm_iw29_notifications (maintenance_plant, malfunction_start);
CREATE INDEX IF NOT EXISTS ix_zpm_iw29_notifications_equipment
    ON zpm_iw29_notifications (equipment);

-- mm_plant_maint_calibration: 8,823 rows are the mine's, of 28 columns.
CREATE TABLE IF NOT EXISTS mm_plant_maint_calibration (
    order_no                   text,
    order_type                 text,
    basic_start_date           date,
    maint_item_text            text,
    plant                      text,
    cost_center                text,
    cost_center_desc           text,
    main_work_ctr              text,
    plnt_work_ctr              text,
    maint_strategy             text,
    maintenance_plan           text,
    plan_call_no               numeric(10,0),
    maint_item                 numeric(4,0),
    completion_date            text,
    equipment_no               text,
    tech_obj_desc              text,
    plant_section              text,
    technical_object           text,
    notification_no            text,
    notification_type          text,
    maint_location             text,
    malfunc_start_dt           text,
    malfunc_start_tm           text,
    malfunc_end_dt             text,
    malfunc_end_tm             text,
    work_hours                 numeric(8,2),
    msg                        text,
    completion                 text,
    synced_at                  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (order_no, order_type)
);
CREATE INDEX IF NOT EXISTS ix_mm_plant_maint_calibration_plant_basic_start_
    ON mm_plant_maint_calibration (plant, basic_start_date);
CREATE INDEX IF NOT EXISTS ix_mm_plant_maint_calibration_equipment_no
    ON mm_plant_maint_calibration (equipment_no);


-- Where each table's sync has reached, so a pass reads only what changed.
CREATE TABLE IF NOT EXISTS sap_sync_state (
    source_table text PRIMARY KEY,
    watermark    date,
    last_run_at  timestamptz,
    last_rows    integer NOT NULL DEFAULT 0,
    last_error   text
);
