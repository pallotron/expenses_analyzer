-- Essential vs discretionary split, from category_types.json.
--
-- There is no third bucket. get_category_spending_type() tests membership of
-- the essential list only and returns "discretionary" for everything else,
-- including categories in neither list — so a NULL spending_type here is
-- discretionary, not unclassified.
SELECT
  year AS period,
  CASE WHEN spending_type = 'essential' THEN 'essential' ELSE 'discretionary' END
    AS spending_type,
  SUM(amount_cents) AS amount_cents
FROM {view}
WHERE type = 'expense'
GROUP BY year, 2
ORDER BY year, 2;
