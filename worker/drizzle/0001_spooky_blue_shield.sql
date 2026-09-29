CREATE VIEW `v_excluded_ids` AS 
SELECT DISTINCT tt.transaction_id AS id
FROM transaction_tags tt
JOIN tags g ON g.id = tt.tag_id
JOIN tag_exclusion_patterns p ON
  CASE
    WHEN p.pattern LIKE '%*'
      THEN substr(g.name, 1, length(p.pattern) - 1) = substr(p.pattern, 1, length(p.pattern) - 1)
    ELSE g.name = p.pattern
  END
;--> statement-breakpoint
CREATE VIEW `v_live` AS 
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
WHERE t.deleted_at IS NULL
;--> statement-breakpoint
CREATE VIEW `v_summary` AS 
SELECT * FROM v_live
WHERE id NOT IN (SELECT id FROM v_excluded_ids)
;--> statement-breakpoint
CREATE VIEW `v_transactions` AS 
SELECT
  l.id,
  date(l.date, 'unixepoch')          AS date,
  COALESCE(l.merchant, l.merchant_raw) AS merchant,
  l.merchant_raw,
  l.amount_cents,
  l.amount_cents / 100.0             AS amount,
  l.type,
  l.category,
  l.spending_type,
  COALESCE(tg.tags, '')              AS tags,
  l.source
FROM v_live l
LEFT JOIN (
  SELECT transaction_id, group_concat(name, ',') AS tags
  FROM (
    SELECT tt.transaction_id, g.name
    FROM transaction_tags tt
    JOIN tags g ON g.id = tt.tag_id
    ORDER BY tt.transaction_id, g.name
  )
  GROUP BY transaction_id
) tg ON tg.transaction_id = l.id
;