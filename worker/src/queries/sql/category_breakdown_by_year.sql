-- calculate_category_breakdown_by_type(transaction_type=:type, period="year").
SELECT year AS period, category, SUM(amount_cents) AS amount_cents
FROM {view}
WHERE type = :type
GROUP BY year, category
ORDER BY year, category;
