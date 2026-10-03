# Transactions (edit), PR A: row actions — design

Status: approved in conversation 2026-10-03, awaiting spec review.

## Goal

Bring the TUI's row-level editing to the web Transactions screen, so the web
app can replace the TUI before cutover. This is the first PR of two:

- **PR A (this spec):** select rows, delete with Undo, tag and untag, edit
  one transaction, bulk edit. Also the per-transaction category override,
  which the TUI never had. Folds in the TUI's bulk-delete screen (`d`).
- **PR B (later spec):** the merchant editor (pattern, alias, category,
  live preview) and changing a category's budget type.

Every household member may edit; there are no read-only users. The phone
layout must support every action.

Success: everything the TUI's Transactions and Delete screens could change
on a row can be changed from the web on desktop and phone, every change is
reflected in the Summary at once, and a delete can be undone.

## Worker

### Routes

All under the existing `/api/*` auth middleware.

| Route | Body | Response | Service |
|---|---|---|---|
| `PATCH /api/transactions/:id` | `TransactionEdit` | `{ ok: true }`, 404 if no such id | `updateTransactions([id], …)` |
| `POST /api/transactions/bulk-edit` | `{ ids, edit: BulkEdit }` | `{ updated }` | `updateTransactions` |
| `POST /api/transactions/delete` | `{ ids }` | `{ deleted }` | `softDeleteTransactions` |
| `POST /api/transactions/restore` | `{ ids }` | `{ restored }` | `restoreTransactions` |
| `POST /api/transactions/tags` | `{ ids, tags, mode: "add" \| "remove" }` | `{ tagged }` | `tagTransactions` |

```ts
interface TransactionEdit {
  date?: string;          // YYYY-MM-DD, within the import date limits
  merchant?: string;      // raw statement text; re-resolved through aliases
  amountCents?: number;   // positive integer; the sign is `type`
  type?: "expense" | "income";
  source?: string;
  category?: string | null; // set override / null clears / absent = unchanged
}
type BulkEdit = Pick<TransactionEdit, "merchant" | "type" | "source" | "category">;
```

Validation (400 with a message the UI can show as is):

- `ids`: 1–10,000 positive integers, duplicates removed.
- Text fields trimmed and non-empty.
- `category` must name an existing category. Categories are created in
  PR B, not here.
- `tags`: at least one that survives `normalizeTags`.
- `PATCH` with an empty body is a 400.

### Services

- **`updateTransactions(db, ids, edit, userId)`**, new. Applies one edit to
  many rows in a single `atomic` batch and returns how many exist. When date,
  merchant or amount move live rows to a new identity, it assigns free
  occurrences for all of them in one `freeOccurrences` call, which already
  counts placements made in the same call. The existing `updateTransaction`
  becomes a wrapper (`updateTransactions(db, [id], …) === 1`), so there is
  one code path. The `category` field sets or clears
  `category_override_id`.
- `softDeleteTransactions`, `restoreTransactions` and `tagTransactions` are
  used as they are.

### Row shape

`TransactionRow` gains:

- `merchantCategory: string`: the merchant's own category, or "Other".
- `categoryOverridden: boolean`.

`category` stays the effective one. `LookupsResponse.categories` lists every
category in the table as well as every live one, so a category with no rows
yet can still be chosen as an override. `v_transactions` already resolves
`COALESCE(override, merchant category)`. The Summary totals follow the
override with no change.

### Cross-site request protection

These are the app's first write endpoints, and Cloudflare Access
authenticates by cookie. A middleware on every non-GET `/api/*` request
requires the `Origin` header to match the request URL's origin; otherwise it
returns 403. Requests without an `Origin` header are rejected too, since
browsers send one on every non-GET fetch. One allowance for development: when
both the Origin and the request are on a local host (localhost, 127.0.0.1,
::1), any port may write, because the Vite dev server proxies to the Worker
from another port.

## Frontend

### Shared pieces (`src/lib/`)

- **`Sheet`**: built on the native `<dialog>` (focus trap, Escape, backdrop).
  A centred panel on `md`+ and a bottom sheet on phones. While a request is
  running it can't be dismissed.
- **`Toast`**: one live region at the bottom of the screen. It holds a
  message, an optional action ("Undo", "Retry"), and disappears after
  about 10 s.
- **`api.ts`**: `send(method, path, body)` beside the existing GET helper,
  throwing `ApiError` with the server's message.
- **Mutation hooks** (`transactions/mutations.ts`): one per route. On
  success each invalidates the transactions, summary, periods and lookups
  queries.

### Selection

- A `Set<number>` of ids in `TransactionsPage` state, not in the URL. It is
  cleared when the filters change, so it never holds rows you can't see.
- **Desktop:** a checkbox column first, and a header checkbox for the rows
  currently shown.
- **Phone:** a checkbox at the left edge of each `DayList` row.
- Clicking a row anywhere except the checkbox opens the edit sheet.

### Action bar

Appears when at least one row is selected. On desktop it sits under the
pinned Transactions controls; on phones it sticks to the bottom of the
screen:

`2 selected · Select all 87 · Tag · Untag · Edit · Delete · Cancel`

"Select all N" selects every filtered row, including those still hidden
behind "Show more".

### Edit sheet (one transaction)

- Fields: Date; Statement text (the raw merchant) with "Shows as: <name>"
  under it; Amount (positive) with an Expense/Income toggle; Source (free
  text, suggesting `lookups.sources`); Category ("From merchant (<name>)"
  first, then every category).
- Only changed fields are sent.
- A note under Statement text: changing it may change the merchant, and so
  the category, unless an override is set.
- Save, plus Delete as a quiet secondary button. Delete goes through the
  same Undo toast.

### Bulk edit sheet

- Statement text, Type, Source and Category, each starting as "Leave
  unchanged". Only touched fields are sent.
- Header: "Edit N transactions".

### Tag sheet

- Opened by Tag or Untag: a chips input autocompleting from `lookups.tags`.
- In Untag mode it suggests only the tags the selected rows carry.

### Delete

- Up to 20 rows: delete at once, then the toast "N deleted · Undo". Undo
  calls `restore` with the same ids.
- More than 20 rows: a confirmation sheet first, "Delete 87 transactions
  totalling €3,120.40?", then the same toast.
- No progress bar. A delete is one atomic request that finishes well under
  a second even for thousands of rows. While it runs, the confirm button
  reads "Deleting 87…" with a spinner. Splitting it into chunks to show
  progress would break atomicity and complicate Undo.

### Busy states and errors

- Every sheet's primary button shows its action in progress ("Saving…",
  "Tagging 87…") and the sheet can't be dismissed meanwhile.
- **400:** the sheet stays open with the input kept and the server's message
  shown. A network error offers Retry.
- **404 on PATCH:** "This transaction no longer exists", then the list
  refreshes.
- **Partial counts:** bulk results report the count; when it's less than
  asked, the toast says so ("85 of 87 deleted (2 were already gone)").
- **Undo failure:** the toast becomes "Couldn't restore · Retry".

### Selection after a change

- Cleared after Delete and Bulk edit.
- Kept after Tag and Untag, so a mistaken tag can be untagged at once.

## Testing

### Worker

- Route tests: validation (400s), unknown id (404), the Origin check (403
  for a foreign or missing Origin, allowed for the same origin), and each
  route's count.
- `updateTransactions`: occurrence clashes when many rows move to one
  merchant at once, deleted rows keeping their occurrence, and category
  override set, clear and leave.
- A Summary test showing a row moving to its override category.

### Frontend

- Selection: toggle, header checkbox, "Select all N", cleared on filter
  change.
- Edit and bulk sheets send only changed fields; the category field maps
  "From merchant" to `null`.
- Delete: no confirmation up to 20 rows, confirmation above; Undo calls
  restore with the same ids; partial-count toast.
- Tag sheet: Untag suggests only tags present on the selection.

### By hand and before pushing

- A Playwright pass against `make dev` at 390 px and 1440 px.
- The usual privacy scan before pushing.

## Out of scope

- PR B: the merchant editor and the budget-type change.
- Creating categories.
- Keyboard shortcuts.
- A page of deleted transactions.
- Concurrent-edit detection: the last write wins, which is fine for one
  household.
