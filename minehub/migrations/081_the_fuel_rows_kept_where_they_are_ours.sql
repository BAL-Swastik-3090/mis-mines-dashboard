-- 081: two thousand rows we were reading four million rows to find.
--
-- The fuel screen reads scm_zmm_stock_mb5b in balcorpdb. That table holds
-- every material at every plant for 340 days -- 4,130,084 rows, 1.1 GB -- and
-- the fuel at our four plants is 2,068 of them. Five hundredths of one per
-- cent.
--
-- Its index is (plant, report_date), which narrows a thirty-day window to
-- 635,937 rows; matgroup is not in it, so the other 633,000 are read and
-- discarded one at a time. Two queries doing that is 2.8 of the 4.3 seconds
-- the screen took.
--
-- The index that would end it belongs on a 1.1 GB table in a database
-- twenty-five applications share, and adding one is not ours to do quietly.
-- So the rows come here instead, where 2,068 of them fit in a page and the
-- index costs nobody anything.
--
-- THE SAME SHAPE AS THE USAGE MIRROR, for the same reason, and with the same
-- rule: balcorpdb stays the place SAP writes. Nothing writes here but the
-- sync, and the whole thing can be dropped and rebuilt from the source.

CREATE TABLE IF NOT EXISTS fuel_stock_snapshot (
    report_date   date        NOT NULL,
    plant         text        NOT NULL,
    material      text        NOT NULL,
    description   text,
    opening_l     numeric(18,3),
    received_l    numeric(18,3),
    -- Stored as a POSITIVE number. SAP keeps issues negative in a varchar
    -- with the sign on the front -- '-10409.0' -- and every reader of the
    -- source has had to remember that. It is normalised once, here.
    issued_l      numeric(18,3),
    closing_l     numeric(18,3),
    closing_value numeric(18,2),
    received_value numeric(18,2),
    unit          text,
    synced_at     timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (report_date, plant, material)
);

-- What every query on the screen actually asks for.
CREATE INDEX IF NOT EXISTS ix_fuel_snapshot_plant_day
    ON fuel_stock_snapshot (plant, report_date DESC);
CREATE INDEX IF NOT EXISTS ix_fuel_snapshot_day
    ON fuel_stock_snapshot (report_date DESC);

COMMENT ON TABLE fuel_stock_snapshot IS
    'Mirror of the fuel rows of balcorpdb.scm_zmm_stock_mb5b for our plants. '
    'A copy, never the record: droppable and rebuildable from the source. '
    'issued_l is positive here; SAP stores it negative in a varchar.';


-- ---------------------------------------------------------------------------
-- What is still owed
-- ---------------------------------------------------------------------------
--
-- One row per purchase-order line for fuel. Small enough that the whole thing
-- is replaced on each pass rather than reconciled -- a line that is deleted or
-- completed in SAP should disappear here, and working out which ones vanished
-- is more code than simply writing the current set again.

CREATE TABLE IF NOT EXISTS fuel_purchase_line (
    po            text        NOT NULL,
    item_no       text        NOT NULL,
    plant         text        NOT NULL,
    material      text        NOT NULL,
    vendor        text,
    ordered_l     numeric(18,3),
    pending_l     numeric(18,3),
    received_l    numeric(18,3),
    unit          text,
    due_on        date,
    goods_receipt_on date,
    synced_at     timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (po, item_no)
);

CREATE INDEX IF NOT EXISTS ix_fuel_po_plant ON fuel_purchase_line (plant, due_on);
CREATE INDEX IF NOT EXISTS ix_fuel_po_receipt ON fuel_purchase_line (goods_receipt_on);

COMMENT ON TABLE fuel_purchase_line IS
    'Mirror of the fuel lines of balcorpdb.scm_purchase_order. Replaced whole '
    'on each sync, because a completed line must disappear.';


CREATE TABLE IF NOT EXISTS fuel_sync_state (
    source_table text PRIMARY KEY,
    watermark    date,
    last_run_at  timestamptz,
    last_rows    integer NOT NULL DEFAULT 0,
    last_error   text
);
