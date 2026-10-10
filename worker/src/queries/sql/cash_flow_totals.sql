-- get_cash_flow_totals: all-time income, expenses and net.
-- Savings rate is derived by the caller so both sides divide identically.
SELECT
  COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_cents END), 0) AS income_cents,
  COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expenses_cents
FROM {view};
