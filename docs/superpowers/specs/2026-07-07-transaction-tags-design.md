# Transaction Tags — Design

**Date:** 2026-07-07
**Status:** Approved (2026-07-07)

## Problem

Two real-world needs surfaced during a spending analysis:

1. **Emergency spend pollutes the run-rate.** A one-off family emergency added a burst of unplanned spending. Monthly and yearly summaries overstate baseline household spend vs the annual budget, and every future analysis has to manually re-identify and exclude these rows.
2. **Trip costs are invisible as a unit.** Expenses abroad keep their true categories (groceries, pharmacy, coffee), so there is no way to ask "what did the Sicily trip cost in total?" without ad-hoc date filtering. Recategorizing everything abroad as "Travel" was considered and **rejected**: it destroys category truth (groceries are still groceries) and fights the merchant→category mapping in `categories.json`.

## Decision summary

- Per-transaction **`Tags` column** in `transactions.parquet` — general-purpose, not an emergency-only boolean.
- **Summary screen excludes** transactions tagged with any tag in a configurable exclusion list (default: `emergency`) — toggleable at runtime.
- **Trip tags** (`trip:<name>`) answer "total trip cost" while categories stay truthful. Not excluded from summaries.
- Tagging happens in the **Transactions screen**: per-selection and bulk (all filtered rows). No new screen.
- One-time **migration** folds the ad-hoc `Emergency` boolean column (already present in the user's parquet ahead of this feature) into `Tags`.

## Data model

- New column `Tags: str` on the transactions DataFrame. Format: lowercase, comma-separated, no spaces around commas. Examples: `""` (untagged), `"emergency"`, `"trip:paris-jun26"`, `"emergency,trip:paris-mar26"`.
- Tag characters: `[a-z0-9:_-]`. Input is normalized (lowercased, stripped) before storage.
- Backward compatibility in `load_transactions_from_parquet()` (same pattern as the existing `Source`/`Deleted` blocks):
  - If `Tags` column missing → add it as `""`.
  - If legacy `Emergency` column present → rows with `Emergency == True` get `emergency` appended to `Tags`; the `Emergency` column is then dropped. Saved back on next save.
- `append_transactions()` (CSV import, TrueLayer sync) defaults `Tags` to `""` for new rows. Dedup logic (Date, Merchant, Amount) is unaffected.

### Helpers (in `data_handler.py`)

- `add_tags(df, mask, tags: list[str]) -> df` — append tags to matching rows, dedup within a row, normalize.
- `remove_tags(df, mask, tags: list[str]) -> df` — remove tags from matching rows.
- `has_tag(df, tag: str) -> pd.Series[bool]` — exact-token match (not substring: `trip` must not match `trip:x` unless asked via prefix helper).
- `has_tag_prefix(df, prefix: str) -> pd.Series[bool]` — e.g. all `trip:*` rows.
- `all_tags(df) -> list[str]` — distinct tags in use (for UI autocomplete/listing).

Screens never manipulate the comma-separated string directly.

## Configuration

New file `tag_settings.json` in the config dir (`~/.config/expenses_analyzer/`), created with defaults on first run:

```json
{ "exclude_from_summary": ["emergency"] }
```

Path added to `config.py` like the other config files.

## Summary screen behaviour

- On load, transactions carrying any tag in `exclude_from_summary` are **excluded by default** from all aggregations (yearly, monthly, category breakdowns, trends).
- Keybinding `x` toggles inclusion (`e` is already bound to Export PDF on this screen). The screen always states the current mode in a status line, e.g. `excluding: emergency (€1,234 hidden)` vs `including all tags`.
- Optional tag filter: a way to restrict the summary to a single tag (e.g. `trip:paris-jun26`) to see a trip's cost broken down by category. Implemented as an input/selector reusing the same filtered-DataFrame path; no new aggregation logic.

## Transactions screen behaviour

- Row selection with spacebar already exists as a pattern (categorize screen); reuse it here.
- `g` — open tag modal, apply entered tag(s) to **selected rows** (or the cursor row if none selected).
- `G` — same modal, apply to **all rows matching current filters** (bulk; e.g. date range + source = tag the whole Sicily fortnight).
- The modal has an apply/remove mode toggle so untagging uses the same flow.
- A `Tags` filter input joins the existing filters, using `apply_filters`' `contains` operator (searching `trip:` lists all trip spend).
- The Tags column is visible in the transaction table (truncated if long).

## Error handling

- Empty/whitespace tag input → no-op with a notification.
- Invalid characters → normalized where possible, otherwise rejected with a notification.
- Corrupt/missing `tag_settings.json` → recreated with defaults, warning logged (same posture as other config files).

## Testing

pytest, following the existing test-file layout:

- `test_data_handler.py` additions: Tags column backward-compat, `Emergency` → `Tags` migration (incl. the drop), tag helper functions (add/remove/has/prefix/dedup/normalization), `append_transactions` defaulting.
- `test_transaction_filter.py`: `contains` on Tags.
- `test_analysis.py` / summary tests: aggregation with exclusion on/off; hidden-total figure correctness.
- Migration test uses a fixture parquet with an `Emergency` boolean to mirror the real user data.

## Out of scope (deliberate)

- Auto-detecting "abroad" transactions (Gemini or merchant heuristics) and auto-suggesting trip tags at import. Possible later; bulk date-range tagging covers the current need with zero false positives.
- Per-tag budgets or tag hierarchies.
- Backfilling location metadata from TrueLayer.
