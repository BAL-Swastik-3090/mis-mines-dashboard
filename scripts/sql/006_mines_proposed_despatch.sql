-- Proposed despatch for a day, entered on the Mines Stock form.
--
-- WHY NOT A BUCKET IN mines_stock_entry. That table answers "what is standing
-- where", and every non-mine bucket in it is summed into the stock position's
-- grand total. A proposed despatch is an intention for the day, not stock at a
-- location; putting it there would inflate the figure the morning meeting reads
-- and there would be no way to tell the two apart afterwards.
--
-- ONE ROW PER DESTINATION, NOTHING TOTAL STORED. The form shows Qty, and Qty is
-- SKD + BLS computed — the same rule as everywhere else on that form and the
-- reason its totals can never disagree with their parts. Storing the total as
-- well would create something for them to disagree with.
--
-- Entered against the Stock_Date the form is on, so the proposal and the stock
-- position it was judged against are the same day.

CREATE TABLE IF NOT EXISTS mines_proposed_despatch (
    Despatch_Date DATE          NOT NULL,
    -- SKD = Sukinda, BLS = Balasore. The two plants the mine despatches to,
    -- named as the form names them.
    Destination   VARCHAR(8)    NOT NULL,
    Qty           DECIMAL(14,2) NOT NULL,
    Entry_Id      VARCHAR(50)   NOT NULL,
    Entry_Date    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (Despatch_Date, Destination),

    CONSTRAINT chk_mines_proposed_despatch_destination
        CHECK (Destination IN ('SKD', 'BLS')),
    CONSTRAINT chk_mines_proposed_despatch_qty
        CHECK (Qty >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
