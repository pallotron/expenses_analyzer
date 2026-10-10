-- calculate_category_breakdown_by_type(transaction_type=:type, period="month").
SELECT month AS period, category, SUM(amount_cents) AS amount_cents
FROM {view}
WHERE type = :type
GROUP BY month, category
ORDER BY month, category;
