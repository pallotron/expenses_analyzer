-- calculate_net_cash_flow(period="year").
SELECT
  year AS period,
  COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_cents END), 0) AS income_cents,
  COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expenses_cents
FROM {view}
GROUP BY year
ORDER BY year;
