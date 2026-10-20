-- Essential vs discretionary by month, with untyped spend in its own bucket.
--
-- Unlike spending_type_by_year.sql, a NULL spending_type (a category nobody
-- typed, or an uncategorised row) is 'unclassified' here, so the Summary can
-- show it. Callers that budget still count it as discretionary. last_date is
-- the latest row's date, which tells how far into its month the data reaches.
SELECT
  month AS period,
  CASE WHEN spending_type IS NULL THEN 'unclassified' ELSE spending_type END
    AS spending_type,
  SUM(amount_cents) AS amount_cents,
  MAX(date) AS last_date
FROM {view}
WHERE type = 'expense'
GROUP BY month, 2
ORDER BY month, 2;
