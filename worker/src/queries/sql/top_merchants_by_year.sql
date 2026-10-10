-- The Summary screen's top-merchants table: spend per canonical merchant per
-- year, with the transaction count it shows alongside.
SELECT year AS period, merchant, SUM(amount_cents) AS amount_cents, COUNT(*) AS txn_count
FROM {view}
WHERE type = :type
GROUP BY year, merchant
ORDER BY year, merchant;
