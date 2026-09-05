-- Base views for the analysis queries.
--
-- These encode the three rules every summary in the app depends on, so no
-- individual query has to restate them:
--
--   1. Live rows only. A soft-deleted transaction is history, never a total.
--   2. Category resolves per-transaction override first, then the merchant's
--      category, then the literal "Other" — mirroring the Python's
--      DisplayMerchant.map(categories).fillna("Other").
--   3. Tag exclusion honours the trailing-star prefix patterns.
--
-- Written as views rather than repeated CTEs because D1 supports them, so the
-- same definitions can move into a migration once the Worker needs them.

CREATE TEMP VIEW v_live AS
SELECT
  t.id,
  t.date,
  t.amount_cents,
  t.type,
  t.source,
  t.merchant_raw,
  m.canonical_name          AS merchant,
  COALESCE(c.name, 'Other') AS category,
  c.spending_type,
  strftime('%Y', t.date, 'unixepoch')    AS year,
  strftime('%Y-%m', t.date, 'unixepoch') AS month
FROM transactions t
LEFT JOIN merchants m  ON m.id = t.merchant_id
LEFT JOIN categories c ON c.id = COALESCE(t.category_override_id, m.category_id)
WHERE t.deleted_at IS NULL;

-- Transactions matching any exclusion pattern.
--
-- The prefix test is substr(), not LIKE. Tag names may contain "_", which LIKE
-- treats as a single-character wildcard, so LIKE 'trip_%' would also match
-- 'tripx:...'. substr() compares literally and has no such trap.
CREATE TEMP VIEW v_excluded_ids AS
SELECT DISTINCT tt.transaction_id AS id
FROM transaction_tags tt
JOIN tags g ON g.id = tt.tag_id
JOIN tag_exclusion_patterns p ON
  CASE
    WHEN p.pattern LIKE '%*'
      THEN substr(g.name, 1, length(p.pattern) - 1) = substr(p.pattern, 1, length(p.pattern) - 1)
    ELSE g.name = p.pattern
  END;

-- What the Summary screen totals: live rows minus the excluded tags.
CREATE TEMP VIEW v_summary AS
SELECT * FROM v_live
WHERE id NOT IN (SELECT id FROM v_excluded_ids);
