-- Every live row in the parquet's shape: what a snapshot user reads.
-- Tags arrive sorted from the view; the Python side sorts to match.
SELECT date, merchant, amount_cents, type, category, tags
FROM {view}
ORDER BY date, merchant, amount_cents, type, category, tags;
