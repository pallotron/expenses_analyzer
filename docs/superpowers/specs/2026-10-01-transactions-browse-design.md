# Transactions (browse) and Summary drill-down — design

Step 2 of `docs/WEB_PORT_PLAN.md`, the "Transactions (read)" PR plus the
Summary drill-down. Editing (single, bulk, merchant rules, tags, delete) is the
next PR and out of scope here.

## Goal

A Transactions screen that lists and filters transactions on phone and
desktop, and that the Summary links into, so that clicking a number on the
Summary shows exactly the transactions that make it up.

## Decisions taken with the user

- Opening Transactions with no filters shows the **current month**; if it has
  no transactions, the **previous month**; if that is empty too, the latest
  month with data. (The TUI showed the whole current year.)
- Drill-down from the Summary works as in the TUI and is part of this PR.
- Filters are the TUI's: date from/to, merchant, category, source, amount
  min/max, tags, type, budget type. Quoted text is an exact match.
- **Hidden tags follow the Summary (option a).** A drill-down from a Summary
  that hides tagged rows hides them here too, so the list total equals the
  number clicked. A "Hidden tags excluded ✕" chip shows it and turns it off.
  Opening Transactions directly shows everything.
- **Sources are checkbox pills, as on the Summary (option a)**, multi-select,
  inside the Filters sheet on a phone. The source text box is not offered.
- **Layout A**: desktop filter block above a sortable table; phone "Filters
  (n)" sheet, removable chips for active filters, rows grouped by day.

## API

Both routes sit behind `getUser` and answer `Cache-Control: no-store`, like
`/api/summary`.

### `GET /api/transactions`

| Param | Meaning | Validation (400 message) |
|---|---|---|
| `from`, `to` | ISO dates, inclusive | `from must be YYYY-MM-DD` / `to must be YYYY-MM-DD` |
| `merchant`, `category`, `tags` | text, `"quoted"` = exact | none |
| `min`, `max` | euros as typed, e.g. `12.5` | `min must be a number` / `max must be a number` |
| `type` | `expense` or `income` | `type must be expense or income` |
| `budget` | `essential` or `discretionary` | `budget must be essential or discretionary` |
| `sources` | repeated; absent = all, one empty value = none | none |
| `excludeHidden` | `1` hides rows the Summary hides | `excludeHidden must be 0 or 1` |

Response:

```ts
interface TransactionsResponse {
  rows: TransactionRow[];          // as listTransactions returns them, newest first
  count: number;
  incomeCents: number;             // sum of income rows listed
  expensesCents: number;           // sum of expense rows listed
}
```

With type "All" the screen shows "Income €x · Expenses €y"; with one type it
shows that one total. The TUI's single sum mixed the two.

All matching rows are returned; the page renders 200 at a time with a "Show
more" button. A year is a few thousand rows at most; server paging waits until
it is needed.

### `GET /api/lookups`

```ts
interface LookupsResponse { categories: string[]; tags: string[]; sources: string[]; }
```

Sorted, distinct values from live (not soft-deleted) rows. Feeds category and
tag suggestions (`<datalist>`) and the source pills.

### Service changes

`TransactionFilter` (`worker/src/domain/filters.ts`) gains:

- `sources?: string[]` — exact match on any; `[]` matches nothing. Same
  semantics as the Summary's `Scope.sources`.
- `excludeHidden?: boolean` — drops rows the Summary hides. Implemented by
  reusing the Summary's view selection (`v_summary` versus `v_live`, as
  `source(scope)` in `queries/analysis.ts` does) so the two screens cannot
  disagree about which rows are hidden.

The existing `source` text filter stays in the service (the Python had it and
the vectors cover it) but the screen does not use it.

## URL

All state is in the query string, e.g.
`/transactions?from=2026-09-01&to=2026-09-30&category="Groceries"&type=expense&excludeHidden=1`.
Back/forward, reload and shared links show the same list. A malformed value
is dropped (falls back to unset) rather than failing the page, as the Summary's
`parseParams` does.

- **No date params at all**: the page picks the default month (rule above)
  from `/api/summary/periods` (which lists the months with data per year),
  using today's date in the browser, then replaces the URL with explicit
  `from`/`to`. Periods counts all live rows, hidden ones included, which is
  right for a direct open that shows everything.
- **Month stepping**: ◂ ▸ appear when `from`/`to` span exactly one calendar
  month and move by a month, keeping every other filter.
- **Clear filters** returns to the default month and resets everything else.
- **Sort** (`sort=date|merchant|amount|type|source|category|budget|tags`,
  `dir=asc|desc`, default date desc) is client-side and also in the URL.

## Drill-down from the Summary

Links, carrying the Summary's selected sources and, when the Summary hides
tags, `excludeHidden=1`:

| Clicked | Filters |
|---|---|
| Category in a breakdown list | `category="<name>"`, the type of the list, the Summary's period |
| Merchant in a top-merchants list | `merchant="<name>"`, the type of the list, the Summary's period |
| Monthly grid cell | `category="<row>"`, that month |
| Grid Total row, month column | that month, the grid's type |
| Grid Total / Average column | that category, the whole year |
| Phone grid row | that category, the whole year |

"The Summary's period" is the selected month, or the whole year in a year
view. Type is `expense` for expense tables, `income` for income tables.
Expense categories also set `budget` to that category's spending type, as the
TUI's `_open_transactions` does. Merchants do not: a merchant's rows can carry
category overrides of the other spending type, and the TUI's budget filter then
dropped them, so its list came out short of the number clicked. Links are real `<a>` elements (React Router
`<Link>`), so they open in a new tab too.

## Screen

**Top bar** gains `Summary` and `Transactions` links, the current one marked.

**Desktop (≥768px)**: heading with the month and ◂ ▸; a filter block:

- From / To (date inputs), Amount min–max
- Merchant, Category (suggestions), Tags (suggestions)
- Type: All | Expense | Income; Budget: All | Essential | Discretionary
- Source pills; "Hidden tags excluded ✕" chip when set
- "N transactions · totals" and "Clear filters"

Then a table: Date, Merchant, Amount, Type, Source, Category, Budget, Tags.
Clicking a header sorts; again reverses. Amounts right-aligned, income in the
income colour.

**Phone**: heading with month stepper; "Filters (n)" opens the sheet holding
all of the above; under it a chip per active filter, each with ✕; the totals
line; rows grouped under day headers ("Tue 29 Sep"), each row merchant + amount
on the first line, category · source (· tags) on the second.

Text inputs apply after 300 ms without typing; there is no Apply button.

## Errors and empty states

- A 400 shows its message in red under the filters; other failures use the
  existing error handling (`getJson`, reauth on 401).
- No rows: "No transactions match these filters" with a Clear filters link.
- Loading keeps the previous rows dimmed rather than blanking the list.

## Testing

- **Python parity**: the filter itself is already held to the TUI's
  `TransactionScreen` by the `filters` section of `python_vectors.json`
  (quoted/unquoted text, dates, amounts, type, budget). The new parts
  (`sources`, `excludeHidden`) are the Summary's own rules, so they are
  proved by the next test rather than by new Python vectors.
- **Drill-down equals Summary** (the key test): on the fixture, for every grid
  cell, Total row cell, breakdown category and top merchant the Summary
  returns, in both hidden modes and with a source subset, the list total for
  the drill-down filters equals the Summary's number. Also runs on real data
  with `CROSSCHECK_DB`.
- Route tests: validation messages, `no-store`, repeated `sources`.
- Frontend (Vitest + jsdom): URL ↔ filters round trip, default-month rule
  (current / previous / latest), month stepping, drill-down hrefs from each
  Summary component, phone and desktop rendering, debounce.
- Playwright screenshots at 390 px and 1440 px on local real data, checked by
  eye, no overflow.

## Out of scope

Editing, deleting, tagging, merchant rules (next PR); hidden-tag editor;
budget-type editing; PDF export; server-side paging.
