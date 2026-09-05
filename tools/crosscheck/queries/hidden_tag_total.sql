-- exclude_tagged_transactions: expense total of the rows the Summary hides.
SELECT COALESCE(SUM(amount_cents), 0) AS hidden_cents
FROM v_live
WHERE type = 'expense' AND id IN (SELECT id FROM v_excluded_ids);
