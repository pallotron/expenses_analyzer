-- calculate_net_cash_flow(period="month"). Months with only one side still
-- appear, with zero on the other, matching the outer merge + fillna(0).
SELECT
  month AS period,
  COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_cents END), 0) AS income_cents,
  COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expenses_cents
FROM {view}
GROUP BY month
ORDER BY month;
