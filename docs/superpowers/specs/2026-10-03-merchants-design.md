# Merchant editor and Merchants page (web port PR B)

Date: 2026-10-03. Status: approved design, awaiting spec review.

## Goal

Port the TUI's merchant editor (`e`, `edit_merchant_screen.py`) to the web and
give merchants a page of their own, replacing the planned Categorize port. Fold
in the follow-ups deferred from Transactions edit PR A (#36).

Success: from any transaction, or from the Merchants page, the owner can create,
edit or delete an alias rule and set a merchant's category and tags, seeing
beforehand what the rule will claim; every row the change affects is re-pointed
so Summary, Transactions and import dedup agree afterwards.

## Decisions taken while brainstorming

- **Budget type (`x`) is not a PR B item.** In the TUI `x` cycles the
  Transactions budget *filter*, which the web already has. Changing a
  category's essential/discretionary type stays with the Budget types screen.
  PR B shows the type read-only under the editor's category picker; once that
  screen's service exists, the label becomes editable there (option 3). The
  owner will judge the UX then.
- **Entry point from Transactions:** a "Merchant rule…" button in the existing
  row edit sheet. No row-cursor shortcut.
- **A Merchants page ships in this PR,** as the Categorize port plus the editor.
- **New beyond the TUI:** deleting a rule. Not included: reordering rule
  priority, renaming a merchant directly (the editor covers it).
- **Re-pointing approach:** one shared step that resolves only the rows the
  changed pattern matches (approach 1). Rejected: re-resolving every row on each
  change (~140 ms CPU), and resolving names at read time (restructures every view).

## 1. Backend

### Service: `worker/src/services/merchants.ts`

- `repointRows(db, rulesAfter, pattern, extra, userId)`, extracted from
  `saveMerchantDecision`. For the rows `pattern` matches, live and deleted:
  resolve under `rulesAfter`, keep those whose merchant changes, assign free
  occurrences as today (live rows above every live row staying at the
  identity; deleted rows keep theirs), and run `extra` plus the re-point in one
  `atomic()`. The re-point parks moving rows (`occurrence = -id`), then sets
  `merchant_id` and `occurrence` with one `UPDATE transactions … FROM
  json_each(payload)` join, replacing the two correlated subqueries.
  Returns the moved count.
- `saveMerchantDecision(db, {pattern, alias, category?, tags?}, userId)`: as
  today, built on `repointRows`. New `tags`: after re-pointing, add them to
  the **live** rows that display as the alias (the TUI also tagged deleted
  rows; the web does not). Returns `{repointed, tagged}`.
- `deleteMerchantRule(db, ruleId, userId)`: rules without that one, then
  `repointRows` with the `DELETE` as `extra`. The merchant row and its category
  stay. Unknown id → a not-found error the route maps to 404.
  Returns `{repointed}`.
- `setMerchantCategory(db, merchantIds, category | null, userId)`: sets or
  clears the category (creating it if new), clears `category_suggested`, stamps
  `category_set_by/at`. Returns `{updated}`.

### Query: `worker/src/queries/merchants.ts`

- `listMerchants(db)`: one row per merchant with live transactions or at least
  one rule, with these fields:
  - `id`, `name`, `category | null`, `spendingType | null`, `suggested`
  - `count`, `lastDate`
  - `totalCents`: income minus expenses, so a spending merchant is negative
    and shows as "−€…" in normal colour, an income one as green "+€…", matching
    `signedAmount` on Transactions
  - `type`: `income` when most of its live rows are income, else `expense`
  - `rules: {id, pattern}[]` in priority order

  Counts, totals and dates use live rows only. All time, no paging.
- `ruleFor(db, raw)`: the rule in force for a raw name (`{id, pattern}` or
  null), the merchant the name resolves to today, and that merchant's category.
  The budget label comes from `essentialCategories`, added to the lookups, so
  it follows the category picker as it changes.

### Routes: `worker/src/routes/merchants.ts`

Origin-checked as in `routes/transactionEdits.ts`; bodies validated with the
same schema helpers.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/merchants` | | `MerchantRow[]` |
| GET | `/api/merchants/rule` | `raw` | `{rule} \| {rule: null}` |
| GET | `/api/merchants/preview` | `pattern`, `alias` | `AliasPreview` |
| POST | `/api/merchants/decision` | `{pattern, alias, category?, tags?}` | `{repointed, tagged}` |
| POST | `/api/merchants/rules/:id/delete` | | `{repointed}` |
| POST | `/api/merchants/category` | `{ids, category \| null}` | `{updated}` |

An invalid pattern on `decision` is a 400 carrying the regex message (preview
returns it in `error` with 200, as the service does). Empty pattern or alias on
`decision` is a 400.

### Suggested pattern

`_suggest_pattern` becomes `suggestPattern(raw)` in `frontend/src/lib/`: strip
` dd/dd` stamps and a trailing number, collapse spaces, escape regex
metacharacters, spaces → `\s+`, append `.*`. Pure, client-side.

The Python escapes in two passes, `.` before `\`, so `APPLE.COM` becomes
`APPLE\\.COM`, which demands a literal backslash and never matches the name it
came from. The port escapes in one pass and is held to hand-written vectors
plus the property that a suggestion matches its own raw name.

## 2. Merchant editor sheet

`frontend/src/merchants/MerchantEditor.tsx`, on PR A's `Sheet`, with
`CategorySelect` and `TagInput`.

Opened with either:
- `{raw}` from a transaction: `GET /rule?raw=`; opens on the rule in force, else
  on `suggestPattern(raw)` with an empty alias.
- `{merchant}` from the Merchants page: one rule → opens on it; several → a list
  at the top picks one or "New rule"; none → `suggestPattern(name)`.

Fields: raw or merchant name (read-only); pattern with the hint "`.*` anything,
`\d` digit, `\s` space"; display alias; category with "Budget: Essential (from
category)" beneath, read-only; tags to add.

Preview, debounced ~300 ms, keyed on pattern and alias:
`Matches 42 transactions · €1,234.56` / `Currently 30 Groceries, 12 Other →
Food` / `Claims: …` / `+ tags 42 rows: weekly`. An invalid regex shows its
error inline and disables Save.

Save requires pattern and alias; on success it invalidates the transactions,
summary, merchants and lookups queries, closes, and toasts
`Tesco → Tesco, re-pointed 12, tagged 42`. "Delete rule" appears only for an
existing rule, asks for confirmation ("matching rows go back to their own names
or the next rule"), then toasts `re-pointed N`. Rule changes have no Undo.

The Transactions row edit sheet gets a "Merchant rule…" button beside the
merchant field that opens the editor with that row's raw name.

## 3. Merchants page

Route `/merchants`, top-bar link after Transactions. Same look as Transactions:
table on desktop, cards on phones, slate-100 stripes with a stronger hover,
controls pinned on desktop only via `StickyPanel`, sticky table header.

Filters, kept in the URL: name contains; category; "Needs attention"
segmented All / Uncategorized / Suggested; type All / Expense / Income.

Columns, sortable, default total by magnitude descending: Merchant, Category,
Budget, Txns, Total, Last seen, Rules (count plus first pattern in muted
monospace).

- Row click → merchant editor with `{merchant}`.
- A "→" per row links to `/transactions?merchant="<name>"`.
- Checkbox selection with an action bar: Set category, Clear category, Select
  all filtered, Cancel. Set category opens a small sheet with `CategorySelect`
  (new names allowed); toast `Set Food on 7 merchants`.
- Totals line: `212 merchants · 18 uncategorized`.

Filtering and sorting run client-side over the single `GET /api/merchants`.

## 4. PR A follow-ups

1. `softDeleteTransactions` returns the ids it deleted; the route returns them;
   Undo restores only those.
2. The tags route passes `liveOnly`, so counts match what is visible.
3. The delete-confirm total is signed, as on Transactions.
4. Deleting one row from the edit sheet drops only that id from the selection.
5. A failed confirmed delete shows its error, with Retry, inside the confirm
   sheet. A toast cannot sit above it: a modal `<dialog>` is in the browser's
   top layer, which no z-index reaches.
6. `useSheetSubmit` (pending, error with Retry, close on success) extracted from
   EditSheet and BulkEditSheet, used by them, TagSheet, the merchant editor and
   the set-category sheet. This gives TagSheet its Retry.
7. TagInput focuses when a tag sheet opens; picking a datalist suggestion
   becomes a chip at once.
8. Phone checkboxes get a 44 px tap target, on Transactions and Merchants.
9. D1-driver tests (`__tests__/helpers/fakeD1.ts`) for `importTransactions`,
   `saveMerchantDecision`, `deleteMerchantRule` and `setMerchantCategory`.

## 5. Testing and verification

Worker:
- `repointRows` via save and delete: a rule sweeping two merchants together;
  deleting a rule so rows fall back to raw names; deleting one so a later rule
  takes over; occurrence collisions both ways, deleted rows keeping theirs;
  tags only on live rows.
- `listMerchants`: live-only counts/totals/last date; rule-only merchants;
  rule order; income/expense type.
- Routes: Origin check, 400 with the regex message, 404 for an unknown rule,
  response shapes.
- Every write also runs through `fakeD1`.

Frontend (`pageHarness`):
- Editor: opens on the rule vs. the suggestion; debounced preview; invalid
  regex; save and delete with their toasts; rule picker for several rules.
- Merchants page: URL filters, sorting, select → set category, the → link.
- `suggestPattern` against hand-written vectors on synthetic names, and each
  suggestion matching its own input.

Before the PR:
- `wrangler dev` on a throwaway D1 copy (`--persist-to <copy> --local-upstream
  localhost:<port>`): add then delete a rule, set a category on several
  merchants, confirm Summary and Transactions agree, re-import a CSV and confirm
  re-pointed rows still dedup.
- Count real merchants to confirm no paging is needed.
- Privacy scan of the diff: fixtures must be synthetic; no names, banks, real
  merchants or paths.

## Docs

`docs/WEB_PORT_PLAN.md`: correct the `x` line (a filter, done); mark the
merchant editor done; replace the Categorize section with the Merchants page,
Gemini still pending; note the editable budget type planned for the editor.
Delete this spec and its plan once the PR merges.
