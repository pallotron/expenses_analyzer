# Transactions (edit), PR A: row actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select, delete with Undo, tag and untag, edit one and bulk edit transactions from the web Transactions screen, including a per-transaction category override.

**Architecture:** The worker gets one bulk-capable update service, a row shape that says whether the category is overridden, five write routes behind an Origin check, and lookups that list every category. The frontend gets `send()`, React Query mutations that invalidate every list, a `<dialog>`-based `Sheet`, a `Toast`, row selection with an action bar, and one sheet per action. All editing UI lives under `frontend/src/transactions/edit/` so `TransactionsPage` only holds the selection and which row is open.

**Tech Stack:** Hono + zod + Drizzle on D1 (tests on better-sqlite3), React 19 + React Router + TanStack Query + Tailwind v4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-03-transactions-edit-design.md`

## Global Constraints

- Version control is jj, not git. Commit a task with `jj desc -m "<message>"` then `jj new`. Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` exactly (that model name, whatever model you are).
- Never `npm install <pkg>` in `worker/` (it corrupts the lockfile). No new dependencies are needed in either package.
- Worker tests: `cd worker && npx vitest run <path>`; typecheck `cd worker && npm run typecheck`. Frontend: `cd frontend && npx vitest run <path>`, `npx tsc -b`, `npm run build`.
- Test fixtures are synthetic: no real names, banks, merchants, emails or paths. The repo is public.
- Amounts are stored positive in integer cents; the sign is `type` (`"expense" | "income"`).
- `ids` per request: 1–10,000 positive integers. Delete asks for confirmation above **20** rows.
- Text the user sees follows the house style: sentence case, "€" amounts via `formatCents`, U+2212 "−" for expenses.
- Phone (below `md`) and desktop (`md`+) must both support every action. `useMediaQuery(DESKTOP)` decides.

## Review Focus

1. **Double submit:** pressing Save or Delete twice while the request runs sends one request. Primary buttons are disabled while pending (tests in Tasks 6 and 8).
2. **European decimals:** an amount typed as `12,50` saves as 1250 cents; `0`, `-5` and `abc` are refused in the sheet without a request (tests in Tasks 4 and 8).
3. **Stale selection:** after a refetch drops rows (deleted elsewhere, or filtered out), the selection count and every action use only ids still in the list (test in Task 5).
4. **Uncommitted tag text:** text typed in the tag box but not turned into a chip is still applied on submit, and `Travel, Trip ` becomes `travel`, `trip` (test in Task 7).
5. **Busy and failed sheets:** Escape or a backdrop click while a request runs does not close the sheet, and a 400 keeps every typed value (tests in Tasks 4 and 8).

---

### Task 1: `updateTransactions` — bulk edits and the category override

**Files:**
- Modify: `worker/src/api/transactions.ts` (add the request/response types)
- Modify: `worker/src/services/transactions.ts` (replace `TransactionEdit` and `updateTransaction`, add `updateTransactions`, `UnknownCategoryError`)
- Test: `worker/src/__tests__/services/updateTransactions.test.ts` (new)

**Interfaces:**
- Produces (in `worker/src/api/transactions.ts`, shared with the frontend):

```ts
export interface TransactionEdit {
  /** YYYY-MM-DD. */
  date?: string;
  /** Raw statement text; the merchant is re-resolved through the aliases. */
  merchant?: string;
  /** Positive; the sign is `type`. */
  amountCents?: number;
  type?: TransactionType;
  source?: string;
  /** A category name sets the override, null clears it, absent leaves it. */
  category?: string | null;
}
export type BulkEdit = Pick<TransactionEdit, "merchant" | "type" | "source" | "category">;
export interface BulkEditRequest { ids: number[]; edit: BulkEdit }
export interface IdsRequest { ids: number[] }
export interface TagRequest { ids: number[]; tags: string[]; mode: "add" | "remove" }
export interface UpdatedResponse { updated: number }
export interface DeletedResponse { deleted: number }
export interface RestoredResponse { restored: number }
export interface TaggedResponse { tagged: number }
```

- Produces (in `worker/src/services/transactions.ts`):
  - `updateTransactions(db: Db, ids: number[], edit: TransactionEdit, userId: number): Promise<number>` — how many of the ids exist (live or deleted); all of them are updated in one atomic batch.
  - `updateTransaction(db, id, edit, userId): Promise<boolean>` — unchanged signature, now `(await updateTransactions(db, [id], edit, userId)) === 1`.
  - `class UnknownCategoryError extends Error` — thrown before anything is written when `edit.category` names no category.
  - `TransactionEdit` is re-exported from the service (`export type { TransactionEdit } from "../api/transactions";`) so existing imports keep working.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/__tests__/services/updateTransactions.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildSummary } from "../../services/summary";
import {
  UnknownCategoryError, updateTransaction, updateTransactions,
} from "../../services/transactions";
import { USER, categorise, seed, store } from "../helpers/store";

const rowsOf = (sqlite: ReturnType<typeof store>["sqlite"]) => sqlite.prepare(`
  SELECT t.id, m.canonical_name AS merchant, t.merchant_raw AS raw, date(t.date, 'unixepoch') AS date,
         t.amount_cents AS cents, t.occurrence AS occ, t.type, t.source,
         t.category_override_id IS NOT NULL AS overridden, t.deleted_at IS NOT NULL AS deleted
  FROM transactions t JOIN merchants m ON m.id = t.merchant_id ORDER BY t.id
`).all() as { id: number; merchant: string; raw: string; date: string; cents: number; occ: number; type: string; source: string; overridden: number; deleted: number }[];

describe("updateTransactions", () => {
  it("moves many rows onto one merchant with distinct occurrences, above a live twin", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Cafe", amount: 3, deleted: false },     // 1: the live twin
      { date: "2026-03-01", merchant: "Kiosk", amount: 3, deleted: false },    // 2
      { date: "2026-03-01", merchant: "Bakery", amount: 3, deleted: false },   // 3
      { date: "2026-03-01", merchant: "Stall", amount: 3, deleted: true },     // 4: deleted
    ], []);

    expect(await updateTransactions(db, [2, 3, 4], { merchant: "Cafe" }, USER)).toBe(3);

    const rows = rowsOf(sqlite);
    expect(rows.map((r) => [r.id, r.merchant, r.raw, r.occ])).toEqual([
      [1, "Cafe", "Cafe", 0],
      [2, "Cafe", "Cafe", 1],
      [3, "Cafe", "Cafe", 2],
      [4, "Cafe", "Cafe", 0], // a deleted row keeps its occurrence
    ]);
    sqlite.close();
  });

  it("gives rows moving to a brand-new merchant distinct occurrences too", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Kiosk", amount: 3, deleted: false },
      { date: "2026-03-01", merchant: "Bakery", amount: 3, deleted: false },
    ], []);
    await updateTransactions(db, [1, 2], { merchant: "New Place" }, USER);
    expect(rowsOf(sqlite).map((r) => [r.merchant, r.occ])).toEqual([["New Place", 0], ["New Place", 1]]);
    sqlite.close();
  });

  it("sets, keeps and clears the category override", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false }], []);
    categorise(sqlite, { Shop: "Shopping", Other: "Groceries" });

    await updateTransactions(db, [1], { category: "Groceries" }, USER);
    const category = () => (sqlite.prepare(`SELECT category FROM v_live WHERE id = 1`).get() as { category: string }).category;
    expect(category()).toBe("Groceries");

    await updateTransactions(db, [1], { source: "Card" }, USER); // category absent: unchanged
    expect(category()).toBe("Groceries");

    await updateTransactions(db, [1], { category: null }, USER);
    expect(category()).toBe("Shopping");
    sqlite.close();
  });

  it("refuses an unknown category and writes nothing", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false }], []);
    await expect(updateTransactions(db, [1], { category: "Nope", source: "Card" }, USER))
      .rejects.toBeInstanceOf(UnknownCategoryError);
    expect(rowsOf(sqlite)[0].source).toBe("Manual");
    sqlite.close();
  });

  it("counts only ids that exist, once each", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false }], []);
    expect(await updateTransactions(db, [1, 1, 99], { type: "income" }, USER)).toBe(1);
    expect(await updateTransactions(db, [], { type: "income" }, USER)).toBe(0);
    expect(await updateTransaction(db, 99, { type: "income" }, USER)).toBe(false);
    sqlite.close();
  });

  it("moves an overridden row to its override category in the Summary", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false },
      { date: "2026-03-02", merchant: "Shop", amount: 5, deleted: false },
    ], []);
    categorise(sqlite, { Shop: "Shopping", Other: "Groceries" });

    await updateTransactions(db, [1], { category: "Groceries" }, USER);

    const s = await buildSummary(db, { year: 2026, month: null, includeHidden: false });
    const byName = Object.fromEntries(s.expenseCategories.map((c) => [c.category, c.amountCents]));
    expect(byName).toMatchObject({ Groceries: 1000, Shopping: 500 });
    sqlite.close();
  });

  it("changes date and amount for every row given", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false },
      { date: "2026-03-02", merchant: "Shop", amount: 10, deleted: false },
    ], []);
    await updateTransactions(db, [1, 2], { date: "2026-04-01", amountCents: 700 }, USER);
    expect(rowsOf(sqlite).map((r) => [r.date, r.cents, r.occ])).toEqual([["2026-04-01", 700, 0], ["2026-04-01", 700, 1]]);
    sqlite.close();
  });
});
```

(`seed` gives new rows `source = 'Manual'`, the column default. `categorise({ Other: "Groceries" })` only exists to create the Groceries category; "Other" is a throwaway merchant name.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/services/updateTransactions.test.ts`
Expected: FAIL — `updateTransactions` / `UnknownCategoryError` are not exported.

- [ ] **Step 3: Add the shared types**

Append the `Produces` block above to `worker/src/api/transactions.ts`, after `LookupsResponse`.

- [ ] **Step 4: Implement**

In `worker/src/services/transactions.ts`:
- Add `categories` to the `../db/schema` import.
- Delete the local `interface TransactionEdit` and add `import type { TransactionEdit } from "../api/transactions";` plus `export type { TransactionEdit };`.
- Replace `updateTransaction` with:

```ts
export class UnknownCategoryError extends Error {
  constructor(name: string) {
    super(`There is no category called "${name}"`);
    this.name = "UnknownCategoryError";
  }
}

/**
 * update_single_transaction for many ids at once, in one atomic batch.
 * Changing date, merchant or amount moves a live row to another identity, so
 * each moving live row gets an occurrence free there; freeOccurrences counts
 * the rows placed in this same call, so rows moving together never collide.
 * Deleted rows keep their occurrence. Returns how many of the ids exist.
 */
export async function updateTransactions(
  db: Db, ids: number[], edit: TransactionEdit, userId: number,
): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const current = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      merchantId: transactions.merchantId,
      cents: transactions.amountCents,
      deleted: sql<number>`${transactions.deletedAt} IS NOT NULL`.mapWith(Boolean),
    })
    .from(transactions)
    .where(idsIn(unique))
    .orderBy(asc(transactions.id));
  if (current.length === 0) return 0;

  let categoryId: number | null | undefined;
  if (edit.category === null) categoryId = null;
  else if (edit.category !== undefined) {
    const [found] = await db.select({ id: categories.id }).from(categories).where(eq(categories.name, edit.category));
    if (!found) throw new UnknownCategoryError(edit.category);
    categoryId = found.id;
  }

  const statements: SQL[] = [];
  const sets: SQL[] = [];
  let canonical: string | null = null;
  if (edit.merchant !== undefined) {
    canonical = resolveMerchantName(edit.merchant, await loadAliases(db));
    statements.push(...createMerchants([canonical]));
    sets.push(sql`merchant_raw = ${edit.merchant}`,
      sql`merchant_id = (SELECT id FROM merchants WHERE canonical_name = ${canonical})`);
  }
  const date = edit.date !== undefined ? epochDay(edit.date) : undefined;
  if (date !== undefined) sets.push(sql`date = ${date}`);
  if (edit.amountCents !== undefined) sets.push(sql`amount_cents = ${edit.amountCents}`);
  if (edit.type !== undefined) sets.push(sql`type = ${edit.type}`);
  if (edit.source !== undefined) sets.push(sql`source = ${edit.source}`);
  if (categoryId !== undefined) sets.push(sql`category_override_id = ${categoryId}`);

  // A merchant that does not exist yet has no rows to clash with; -1 stands
  // for it, and freeOccurrences still spaces the rows placed in this call.
  const moving = date !== undefined || edit.amountCents !== undefined || canonical !== null;
  if (moving) {
    let target: number | undefined;
    if (canonical !== null) {
      const [found] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.canonicalName, canonical));
      target = found?.id ?? -1;
    }
    const occurrences = await freeOccurrences(db, current.filter((r) => !r.deleted).map((r) => ({
      id: r.id,
      date: date ?? r.date,
      merchantId: target ?? r.merchantId ?? -1,
      cents: edit.amountCents ?? r.cents,
    })));
    if (occurrences.size > 0) {
      const payload = json([...occurrences].map(([id, occurrence]) => ({ id, occurrence })));
      sets.push(sql`occurrence = COALESCE((
        SELECT json_extract(value, '$.occurrence') FROM json_each(${payload})
        WHERE json_extract(value, '$.id') = transactions.id
      ), occurrence)`);
    }
  }

  sets.push(sql`updated_at = ${now}`, sql`updated_by = ${userId}`);
  statements.push(sql`
    UPDATE transactions SET ${sql.join(sets, sql`, `)}
    WHERE id IN (SELECT value FROM json_each(${json(current.map((r) => r.id))}))
  `);
  await atomic(db, statements);
  return current.length;
}

/** One transaction by id; false if there is no such transaction. */
export async function updateTransaction(
  db: Db, id: number, edit: TransactionEdit, userId: number,
): Promise<boolean> {
  return (await updateTransactions(db, [id], edit, userId)) === 1;
}
```

Notes for the implementer:
- `freeOccurrences` is defined above `restoreTransactions` in the same file; `updateTransactions` must come after it (it already does if you replace `updateTransaction` in place).
- The old `updateTransaction` read `merchantRaw`, `type`, `source` to write them back unchanged; the new SET list writes only what the edit names, so those columns are untouched.
- `merchants` and `asc` are already imported in this file; check `categories` is added to the schema import.

- [ ] **Step 5: Run the new tests and the existing service tests**

Run: `cd worker && npx vitest run src/__tests__/services && npm run typecheck`
Expected: PASS, including the existing `updateTransaction` test in `transactions.test.ts` (unchanged behaviour).

- [ ] **Step 6: Commit**

```bash
jj desc -m "Update many transactions at once, with a per-transaction category

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 2: Rows say whether their category is overridden; lookups list every category

**Files:**
- Modify: `worker/src/api/transactions.ts` (`TransactionRow`)
- Modify: `worker/src/queries/transactions.ts` (`listTransactions`, `listLookups`)
- Modify: `frontend/src/__tests__/transactions/list.test.tsx`, `frontend/src/__tests__/transactions/TransactionsPage.test.tsx` (row fixtures gain the two fields)
- Test: `worker/src/__tests__/queries/listTransactions.test.ts`

**Interfaces:**
- Produces: `TransactionRow` gains `merchantCategory: string` (the merchant's own category, `"Other"` when it has none) and `categoryOverridden: boolean`. `LookupsResponse.categories` now lists every row of the `categories` table plus every live category (so `"Other"` still appears when used), sorted, de-duplicated.

- [ ] **Step 1: Write the failing tests**

Add to `worker/src/__tests__/queries/listTransactions.test.ts` (inside the file, as a new `describe`):

```ts
describe("listTransactions category override", () => {
  it("reports the merchant's own category and whether the row overrides it", async () => {
    const { db, sqlite } = store();
    // vectorStore gives a row a category override when it differs from its merchant's first row.
    const overridden = sqlite.prepare(`
      SELECT t.id, mc.name AS own FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id LEFT JOIN categories mc ON mc.id = m.category_id
      WHERE t.category_override_id IS NOT NULL AND t.deleted_at IS NULL LIMIT 1
    `).get() as { id: number; own: string | null } | undefined;
    const rows = (await listTransactions(db)).rows;
    const plain = rows.find((r) => !r.categoryOverridden)!;
    expect(plain.merchantCategory).toBe(plain.category);
    if (overridden) {
      const row = rows.find((r) => r.id === overridden.id)!;
      expect(row.categoryOverridden).toBe(true);
      expect(row.merchantCategory).toBe(overridden.own ?? "Other");
    }
    sqlite.exec(`UPDATE transactions SET category_override_id = NULL`);
    expect((await listTransactions(db)).rows.every((r) => !r.categoryOverridden && r.merchantCategory === r.category)).toBe(true);
  });
});

describe("listLookups categories", () => {
  it("includes a category no live row uses yet", async () => {
    const { db, sqlite } = store();
    sqlite.exec(`INSERT INTO categories (name) VALUES ('Zz Unused')`);
    const l = await listLookups(db);
    expect(l.categories).toContain("Zz Unused");
    expect(l.categories).toEqual([...new Set(l.categories)]);
    expect(l.categories).toEqual([...l.categories].sort());
  });
});
```

If `store()` in that file is not callable twice (check: it builds a fresh `vectorStore()` each call), the tests are independent. If the `if (overridden)` branch would never run because the fixture has no overrides, replace it by creating one: `sqlite.exec("UPDATE transactions SET category_override_id = (SELECT id FROM categories WHERE name = 'Zz Unused') WHERE id = (SELECT MIN(id) FROM transactions WHERE deleted_at IS NULL)")` after inserting that category, and assert on that row. Do not leave an assertion that silently never runs.

- [ ] **Step 2: Run to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/queries/listTransactions.test.ts`
Expected: FAIL — `merchantCategory` undefined; "Zz Unused" missing.

- [ ] **Step 3: Implement**

`worker/src/api/transactions.ts`, in `TransactionRow` after `category`:

```ts
  /** The merchant's own category ("Other" when it has none). */
  merchantCategory: string;
  /** True when this row's category is set on the row, not inherited. */
  categoryOverridden: boolean;
```

`worker/src/queries/transactions.ts`:
- Import `alias` from `drizzle-orm/sqlite-core`, and `categories, merchants, transactions` from `../db/schema`.
- In `listTransactions`, extend the select and join:

```ts
  const own = alias(categories, "own_category");
  const fetched = await db
    .select({
      // ...the existing fields...
      merchantCategory: sql<string>`COALESCE(${own.name}, 'Other')`,
      categoryOverridden: sql<number>`${transactions.categoryOverrideId} IS NOT NULL`.mapWith(Boolean),
    })
    .from(v)
    .innerJoin(transactions, eq(transactions.id, v.id))
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(own, eq(own.id, merchants.categoryId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(v.date), desc(v.id));
```

- In `listLookups`, replace the `categories` query with the union:

```ts
  const live = await db.selectDistinct({ name: vLive.category }).from(vLive);
  const stored = await db.select({ name: categories.name }).from(categories);
  const categoryNames = [...new Set([...live, ...stored].map((r) => r.name))].sort();
```

and return `categories: categoryNames`. Keep the existing `sources` and `tags` queries. Sort with the default `.sort()` (code-unit order) — the existing test compares with `[...l.categories].sort()`.

- [ ] **Step 4: Update the frontend fixtures**

The frontend imports `TransactionRow`, so its fixtures must gain the fields or `tsc -b` fails. In `frontend/src/__tests__/transactions/list.test.tsx` and `TransactionsPage.test.tsx`, add `merchantCategory: "Groceries", categoryOverridden: false` to each `row(...)` helper's object.

- [ ] **Step 5: Run everything that touches rows**

Run: `cd worker && npx vitest run && npm run typecheck && cd ../frontend && npx vitest run && npx tsc -b`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
jj desc -m "Say whether a row's category is its own, and list every category

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 3: Write routes behind an Origin check

**Files:**
- Create: `worker/src/routes/transactionEdits.ts`
- Modify: `worker/src/app.ts` (Origin middleware; mount the routes)
- Test: `worker/src/__tests__/app/transactionEdits.test.ts` (new)

**Interfaces:**
- Consumes: `updateTransactions`, `UnknownCategoryError` (Task 1); `softDeleteTransactions`, `restoreTransactions`, `tagTransactions`; the request/response types (Task 1).
- Produces: `PATCH /api/transactions/:id` → `{ ok: true }` | 404 `{ error }`; `POST /api/transactions/bulk-edit` → `UpdatedResponse`; `POST /api/transactions/delete` → `DeletedResponse`; `POST /api/transactions/restore` → `RestoredResponse`; `POST /api/transactions/tags` → `TaggedResponse`. Every 400 is `{ error: string }` with a message fit to show as is. Non-GET `/api/*` requests from another origin → 403 `{ error: "Cross-site request refused" }`.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/__tests__/app/transactionEdits.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import { USER, categorise, seed, store } from "../helpers/store";

const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

function setup() {
  const s = store([]);
  seed(s.sqlite, [
    { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false },
    { date: "2026-03-02", merchant: "Cafe", amount: 4, deleted: false },
  ], []);
  categorise(s.sqlite, { Shop: "Shopping", Cafe: "Eating out" });
  const app = createApp(() => s.db);
  const send = (method: string, path: string, body?: unknown, origin: string | null = "http://localhost") =>
    app.request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...(origin && { origin }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  return { ...s, send };
}
const one = <T>(sqlite: ReturnType<typeof store>["sqlite"], q: string) => sqlite.prepare(q).get() as T;

describe("Origin check", () => {
  it("refuses a write from another site, or with no Origin", async () => {
    const { send } = setup();
    expect((await send("POST", "/api/transactions/delete", { ids: [1] }, "https://evil.example")).status).toBe(403);
    expect((await send("POST", "/api/transactions/delete", { ids: [1] }, null)).status).toBe(403);
  });

  it("accepts a local dev server on another port, but only on a local host", async () => {
    const { send } = setup();
    expect((await send("POST", "/api/transactions/delete", { ids: [1] }, "http://localhost:5173")).status).toBe(200);
  });

  it("leaves reads alone", async () => {
    const { send } = setup();
    expect((await send("GET", "/api/lookups", undefined, null)).status).toBe(200);
  });
});

describe("PATCH /api/transactions/:id", () => {
  it("edits one transaction", async () => {
    const { send, sqlite } = setup();
    const res = await send("PATCH", "/api/transactions/1", { amountCents: 1234, type: "income", source: " Card ", category: "Eating out" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(one(sqlite, `SELECT amount_cents AS c, type, source FROM transactions WHERE id = 1`)).toEqual({ c: 1234, type: "income", source: "Card" });
    expect(one(sqlite, `SELECT category FROM v_live WHERE id = 1`)).toEqual({ category: "Eating out" });
  });

  it("answers 404 for a transaction that does not exist", async () => {
    const { send } = setup();
    const res = await send("PATCH", "/api/transactions/99", { type: "income" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This transaction no longer exists." });
  });

  it.each([
    [{}, "Nothing to change"],
    [{ date: "2026-02-30" }, "Date must be a real day, YYYY-MM-DD"],
    [{ date: "1800-01-01" }, "Date must be between 1900-01-01 and"],
    [{ amountCents: 0 }, "Amount must be more than zero"],
    [{ amountCents: 12.5 }, "Amount must be whole cents"],
    [{ amountCents: 100_000_001 }, "Amount must be at most €1,000,000.00"],
    [{ merchant: "   " }, "Statement text cannot be empty"],
    [{ source: "" }, "Source cannot be empty"],
    [{ type: "refund" }, "Type must be expense or income"],
    [{ category: "Nope" }, 'There is no category called "Nope"'],
  ])("refuses %j", async (body, message) => {
    const { send } = setup();
    const res = await send("PATCH", "/api/transactions/1", body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(message);
  });

  it("refuses a non-numeric id", async () => {
    const { send } = setup();
    expect((await send("PATCH", "/api/transactions/abc", { type: "income" })).status).toBe(400);
  });
});

describe("bulk routes", () => {
  it("bulk-edits, counting only rows that exist", async () => {
    const { send, sqlite } = setup();
    const res = await send("POST", "/api/transactions/bulk-edit", { ids: [1, 2, 99], edit: { source: "Card" } });
    expect(await res.json()).toEqual({ updated: 2 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transactions WHERE source = 'Card'`)).toEqual({ n: 2 });
  });

  it("refuses a bulk edit of fields bulk edit does not offer", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/transactions/bulk-edit", { ids: [1], edit: { amountCents: 5 } });
    expect(res.status).toBe(400);
  });

  it("deletes and restores", async () => {
    const { send, sqlite } = setup();
    expect(await (await send("POST", "/api/transactions/delete", { ids: [1, 2] })).json()).toEqual({ deleted: 2 });
    expect(await (await send("POST", "/api/transactions/delete", { ids: [1, 2] })).json()).toEqual({ deleted: 0 });
    expect(await (await send("POST", "/api/transactions/restore", { ids: [1] })).json()).toEqual({ restored: 1 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL`)).toEqual({ n: 1 });
  });

  it("tags and untags", async () => {
    const { send, sqlite } = setup();
    expect(await (await send("POST", "/api/transactions/tags", { ids: [1, 2], tags: ["Trip "], mode: "add" })).json()).toEqual({ tagged: 2 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transaction_tags`)).toEqual({ n: 2 });
    await send("POST", "/api/transactions/tags", { ids: [1], tags: ["trip"], mode: "remove" });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transaction_tags`)).toEqual({ n: 1 });
  });

  it.each([
    ["/api/transactions/delete", { ids: [] }, "Choose at least one transaction"],
    ["/api/transactions/delete", { ids: [0] }, "ids must be positive whole numbers"],
    ["/api/transactions/delete", { ids: Array.from({ length: 10_001 }, (_, i) => i + 1) }, "At most 10,000 transactions at once"],
    ["/api/transactions/tags", { ids: [1], tags: [" , "], mode: "add" }, "Give at least one tag"],
    ["/api/transactions/tags", { ids: [1], tags: ["x"], mode: "toggle" }, "mode must be add or remove"],
    ["/api/transactions/bulk-edit", { ids: [1], edit: {} }, "Nothing to change"],
  ])("refuses a bad body for %s", async (path, body, message) => {
    const { send } = setup();
    const res = await send("POST", path, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(message);
  });

  it("refuses a body that is not JSON", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/transactions/delete", undefined);
    expect(res.status).toBe(400);
  });
});

void USER;
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/app/transactionEdits.test.ts`
Expected: FAIL — 404s (routes missing), Origin tests get 404 instead of 403.

- [ ] **Step 3: Implement the routes**

Create `worker/src/routes/transactionEdits.ts`:

```ts
/**
 * Writes to transactions: edit one, bulk edit, delete, restore, tag. Parse
 * with zod, call the service, answer with a count. Every 400 carries a
 * message the screen shows as is.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import type {
  DeletedResponse, RestoredResponse, TaggedResponse, UpdatedResponse,
} from "../api/transactions";
import { normalizeTags } from "../domain/tags";
import {
  restoreTransactions, softDeleteTransactions, tagTransactions, UnknownCategoryError, updateTransactions,
} from "../services/transactions";

const MAX_IDS = 10_000;
const MAX_CENTS = 100_000_000;
const MIN_DATE = "1900-01-01";

function maxDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const isCalendarDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const text = (name: string) => z.string().trim().min(1, `${name} cannot be empty`);

const Ids = z.array(z.number().int("ids must be positive whole numbers").positive("ids must be positive whole numbers"))
  .min(1, "Choose at least one transaction")
  .max(MAX_IDS, "At most 10,000 transactions at once")
  .transform((ids) => [...new Set(ids)]);

const Category = z.string().trim().min(1, "Category cannot be empty").nullable().optional();
const Type = z.enum(["expense", "income"], "Type must be expense or income").optional();

const Edit = z.object({
  date: z.string()
    .refine(isCalendarDate, "Date must be a real day, YYYY-MM-DD")
    .refine((d) => d >= MIN_DATE && d <= maxDate(), () => ({ message: `Date must be between ${MIN_DATE} and ${maxDate()}` }))
    .optional(),
  merchant: text("Statement text").optional(),
  amountCents: z.number()
    .int("Amount must be whole cents")
    .positive("Amount must be more than zero")
    .max(MAX_CENTS, "Amount must be at most €1,000,000.00")
    .optional(),
  type: Type,
  source: text("Source").optional(),
  category: Category,
}).strict().refine((e) => Object.keys(e).length > 0, "Nothing to change");

const BulkEdit = z.object({
  merchant: text("Statement text").optional(),
  type: Type,
  source: text("Source").optional(),
  category: Category,
}).strict().refine((e) => Object.keys(e).length > 0, "Nothing to change");

const IdsBody = z.object({ ids: Ids });
const BulkBody = z.object({ ids: Ids, edit: BulkEdit });
const TagBody = z.object({
  ids: Ids,
  tags: z.array(z.string()).transform(normalizeTags).refine((t) => t.length > 0, "Give at least one tag"),
  mode: z.enum(["add", "remove"], "mode must be add or remove"),
});

type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, error: "The request body must be JSON" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: parsed.error.issues[0].message };
}

export function transactionEditRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.patch("/transactions/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not a transaction id" }, 400);
    const body = await parseBody(c, Edit);
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const n = await updateTransactions(c.get("db"), [id], body.data, c.get("user").id);
      if (n === 0) return c.json({ error: "This transaction no longer exists." }, 404);
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof UnknownCategoryError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  routes.post("/transactions/bulk-edit", async (c) => {
    const body = await parseBody(c, BulkBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const updated = await updateTransactions(c.get("db"), body.data.ids, body.data.edit, c.get("user").id);
      return c.json({ updated } satisfies UpdatedResponse);
    } catch (e) {
      if (e instanceof UnknownCategoryError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  routes.post("/transactions/delete", async (c) => {
    const body = await parseBody(c, IdsBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const deleted = await softDeleteTransactions(c.get("db"), body.data.ids, c.get("user").id);
    return c.json({ deleted } satisfies DeletedResponse);
  });

  routes.post("/transactions/restore", async (c) => {
    const body = await parseBody(c, IdsBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const restored = await restoreTransactions(c.get("db"), body.data.ids, c.get("user").id);
    return c.json({ restored } satisfies RestoredResponse);
  });

  routes.post("/transactions/tags", async (c) => {
    const body = await parseBody(c, TagBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const { ids, tags, mode } = body.data;
    const tagged = await tagTransactions(c.get("db"), ids, tags, mode, c.get("user").id);
    return c.json({ tagged } satisfies TaggedResponse);
  });

  return routes;
}
```

Check the zod version's API while implementing: `z.enum(values, "message")` is already used in `routes/transactions.ts`, so the string-message form works. If `.refine(fn, () => ({ message }))` is not accepted by this zod version, use `.superRefine` to add the issue with the computed message instead; the test only checks the message starts with "Date must be between 1900-01-01 and".

- [ ] **Step 4: Add the Origin check and mount the routes**

In `worker/src/app.ts`:

```ts
import { transactionEditRoutes } from "./routes/transactionEdits";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Writes must come from the app's own pages. Access authenticates by cookie,
 * which a browser also sends with a form posted from another site; that
 * site cannot set Origin to ours. Browsers send Origin on every non-GET
 * fetch, so a missing one is refused too. Locally, the Vite dev server on
 * another port proxies to the Worker, so any local origin may write to a
 * local Worker.
 */
export function sameOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  let from: URL;
  try { from = new URL(origin); } catch { return false; }
  const to = new URL(requestUrl);
  if (from.origin === to.origin) return true;
  return LOCAL.has(from.hostname) && LOCAL.has(to.hostname);
}
```

and, right after the existing `app.use("/api/*", …Cache-Control…)` middleware:

```ts
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c.req.header("origin") ?? null, c.req.url)) {
      return c.json({ error: "Cross-site request refused" }, 403);
    }
    await next();
  });
```

Mount the routes before the `/api/*` 404 catch-all: `app.route("/api", transactionEditRoutes<B>());` next to `transactionRoutes`.

Add a unit test for `sameOrigin` to the same test file:

```ts
import { sameOrigin } from "../../app";

describe("sameOrigin", () => {
  it.each([
    ["https://x.example", "https://x.example/api/a", true],
    ["https://evil.example", "https://x.example/api/a", false],
    ["http://localhost:5173", "http://localhost:8787/api/a", true],
    ["http://localhost:5173", "https://x.example/api/a", false],
    ["null", "https://x.example/api/a", false],
    [null, "https://x.example/api/a", false],
  ])("%s → %s is %s", (origin, url, ok) => {
    expect(sameOrigin(origin, url)).toBe(ok);
  });
});
```

- [ ] **Step 5: Run the worker suite**

Run: `cd worker && npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Mutation check**

Make `sameOrigin` return `true` unconditionally; the "refuses a write from another site" test must FAIL. Revert.

- [ ] **Step 7: Commit**

```bash
jj desc -m "Add the transaction write routes behind an Origin check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 4: Frontend plumbing — `send`, mutations, `Sheet`, `Toast`, `Segmented`, `parseEuros`

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `send`, share response handling with `getJson`)
- Modify: `frontend/src/lib/types.ts` (re-export the new worker types)
- Create: `frontend/src/lib/Sheet.tsx`, `frontend/src/lib/Toast.tsx`, `frontend/src/lib/Segmented.tsx`
- Modify: `frontend/src/transactions/TransactionFilters.tsx` (import `Segmented` from lib instead of defining it)
- Modify: `frontend/src/transactions/amount.ts` (add `parseEuros`)
- Create: `frontend/src/transactions/edit/mutations.ts`
- Modify: `frontend/src/__tests__/setup.ts` (dialog polyfill for jsdom)
- Test: `frontend/src/__tests__/lib/send.test.ts`, `frontend/src/__tests__/lib/Sheet.test.tsx`, `frontend/src/__tests__/lib/Toast.test.tsx`, `frontend/src/__tests__/transactions/amount.test.ts` (extend), `frontend/src/__tests__/transactions/mutations.test.tsx`

**Interfaces:**
- Consumes: worker types from Task 1.
- Produces:
  - `send<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T>` — throws `ApiError` like `getJson`.
  - `Sheet(props: { title: string; open: boolean; onClose: () => void; busy?: boolean; children: ReactNode })` — a `<dialog>` with accessible name `title`; Escape/backdrop close only when not `busy`; children rendered only while open.
  - `Toast(props: { toast: ToastState | null; onDismiss: () => void })`, `interface ToastState { id: number; message: string; action?: { label: string; run: () => void } }` — auto-dismisses after `TOAST_MS = 10_000`.
  - `Segmented<T extends string>(props: { label: string; options: [T | undefined, string][]; value: T | undefined; onChange: (v: T | undefined) => void })` — moved unchanged from `TransactionFilters.tsx`.
  - `parseEuros(text: string): number | null` — `"12,50"`, `"12.5"`, `"€1,234.56"`, `"1.234,56"` → cents; anything ≤ 0, more than 2 decimals or not a number → `null`.
  - In `transactions/edit/mutations.ts`: `useEditOne()`, `useBulkEdit()`, `useDelete()`, `useRestore()`, `useTag()` — `useMutation` hooks whose `mutationFn` take `{ id, edit }`, `BulkEditRequest`, `number[]`, `number[]`, `TagRequest` respectively, and on success invalidate the `transactions`, `summary`, `periods` and `lookups` queries.

- [ ] **Step 1: Write the failing tests**

`frontend/src/__tests__/transactions/amount.test.ts` — add:

```ts
import { parseEuros } from "../../transactions/amount";

describe("parseEuros", () => {
  it.each([
    ["12,50", 1250], ["12.5", 1250], ["€ 7", 700], ["1,234.56", 123456], ["1.234,56", 123456], [" 0,01 ", 1],
  ])("reads %s as %i cents", (text, cents) => expect(parseEuros(text)).toBe(cents));

  it.each(["", "0", "-5", "abc", "1.234", "12.345", "1,2,3"])("refuses %j", (text) => expect(parseEuros(text)).toBeNull());
});
```

(`"1.234"` is refused: three decimals is ambiguous between €1.234 and €1,234; the person retypes it.)

`frontend/src/__tests__/lib/send.test.ts`:

```ts
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, send } from "../../lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("send", () => {
  it("posts JSON and returns the parsed answer", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ deleted: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await send("POST", "/api/transactions/delete", { ids: [1, 2] })).toEqual({ deleted: 2 });
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/transactions/delete");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ ids: [1, 2] }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("throws the server's message with its status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Amount must be more than zero" }), { status: 400 })));
    await expect(send("PATCH", "/api/transactions/1", {})).rejects.toEqual(new ApiError(400, "Amount must be more than zero"));
  });
});
```

`frontend/src/__tests__/lib/Sheet.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "../../lib/Sheet";

describe("Sheet", () => {
  it("shows its content as a named dialog only while open", () => {
    const { rerender } = render(<Sheet title="Edit transaction" open={false} onClose={() => {}}><p>Body</p></Sheet>);
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    rerender(<Sheet title="Edit transaction" open onClose={() => {}}><p>Body</p></Sheet>);
    expect(screen.getByRole("dialog", { name: "Edit transaction" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("closes on Escape and on the backdrop, but not while busy", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Sheet title="T" open busy onClose={onClose}><p>Body</p></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "T" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Sheet title="T" open onClose={onClose}><p>Body</p></Sheet>);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("has a Close button", () => {
    const onClose = vi.fn();
    render(<Sheet title="T" open onClose={onClose}><p>Body</p></Sheet>);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

`frontend/src/__tests__/lib/Toast.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOAST_MS, Toast } from "../../lib/Toast";

afterEach(() => vi.useRealTimers());

describe("Toast", () => {
  it("announces the message, runs its action, and goes away after a while", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast toast={{ id: 1, message: "3 deleted", action: { label: "Undo", run } }} onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 deleted");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("renders an empty live region when there is nothing to say", () => {
    render(<Toast toast={null} onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
```

`frontend/src/__tests__/transactions/mutations.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDelete } from "../../transactions/edit/mutations";

afterEach(() => vi.unstubAllGlobals());

describe("mutations", () => {
  it("invalidates every list a write can change", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ deleted: 1 }), { status: 200 })));
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDelete(), { wrapper });
    result.current.mutate([1]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([["transactions"], ["summary"], ["periods"], ["lookups"]]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib src/__tests__/transactions/amount.test.ts src/__tests__/transactions/mutations.test.tsx`
Expected: FAIL — missing modules/exports.

- [ ] **Step 3: Implement**

`frontend/src/__tests__/setup.ts` — append (jsdom lacks `showModal`):

```ts
// jsdom has <dialog> but not its modal API.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
```

`frontend/src/lib/types.ts` — extend the transactions re-export with `BulkEdit, BulkEditRequest, DeletedResponse, RestoredResponse, TaggedResponse, TagRequest, TransactionEdit, UpdatedResponse`, and add `export { normalizeTags } from "../../../worker/src/domain/tags";` so the tag sheet applies the Worker's exact tag rule (it is a pure module).

`frontend/src/lib/api.ts` — refactor so both calls share the response handling:

```ts
async function handle<T>(res: Response): Promise<T> {
  if (res.type === "opaqueredirect" || res.status === 401) {
    throw new ApiError(401, reauthenticate()
      ? "Your session has expired. Reloading to sign in again…"
      : "Your session has expired. Reload the page to sign in again.");
  }
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null) as { error?: string } | null;
    // The Origin check also answers 403, with a message; Access's 403 has no body.
    throw new ApiError(403, body?.error ?? NOT_SET_UP);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function getJson<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path, { redirect: "manual", headers: { Accept: "application/json" } }));
}

/** A write. The Worker answers with JSON, or { error } on a 4xx. */
export async function send<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T> {
  return handle<T>(await fetch(path, {
    method,
    redirect: "manual",
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}
```

Check the existing api tests still pass: a 403 with no JSON body must still read `NOT_SET_UP`.

`frontend/src/lib/Sheet.tsx`:

```tsx
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A modal sheet on the native <dialog>, which brings the focus trap, Escape
 * and the backdrop. A centred panel on desktop, a bottom sheet on phones.
 * While `busy`, nothing closes it: the request it started must finish.
 */
export function Sheet(props: { title: string; open: boolean; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  const close = () => { if (!props.busy) props.onClose(); };
  return (
    <dialog ref={ref} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); close(); }}
      // A click on the dialog element itself, not its content, is the backdrop.
      onClick={(e) => { if (e.target === ref.current) close(); }}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 text-slate-900 backdrop:bg-slate-900/40 md:m-auto md:max-w-lg md:rounded-2xl dark:bg-slate-900 dark:text-slate-100">
      {props.open && (
        <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-base font-semibold">{props.title}</h2>
            <button type="button" onClick={close} disabled={props.busy} aria-label="Close"
              className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800">✕</button>
          </div>
          {props.children}
        </div>
      )}
    </dialog>
  );
}
```

`frontend/src/lib/Toast.tsx`:

```tsx
import { useEffect } from "react";

export const TOAST_MS = 10_000;

export interface ToastState {
  /** A new id restarts the timer, even for the same message. */
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

/** One message at a time, bottom of the screen, above the phone action bar. */
export function Toast(props: { toast: ToastState | null; onDismiss: () => void }) {
  const { toast, onDismiss } = props;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(t);
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6">
      {toast && (
        <div className="pointer-events-auto flex items-center gap-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          <span>{toast.message}</span>
          {toast.action && (
            <button type="button" onClick={toast.action.run} className="font-semibold underline">{toast.action.label}</button>
          )}
        </div>
      )}
    </div>
  );
}
```

`frontend/src/lib/Segmented.tsx`: move the `Segmented` function from `TransactionFilters.tsx` verbatim, `export` it, and import it back in `TransactionFilters.tsx`.

`frontend/src/transactions/amount.ts` — add:

```ts
/**
 * What a person types as an amount, in cents: "12,50", "12.5", "€1,234.56"
 * or "1.234,56". The last "." or "," with one or two digits after it is the
 * decimal point; other separators group thousands. Zero, negatives and
 * three decimals ("1.234": a grouping or a decimal?) are refused.
 */
export function parseEuros(text: string): number | null {
  const t = text.replace(/[€\s]/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(t)!;
  const whole = m[1];
  if (!/^\d{1,3}(?:([.,])\d{3})*$/.test(whole) && !/^\d+$/.test(whole)) return null;
  // A grouping separator must differ from the decimal one ("1,2,3" is neither).
  const groups = whole.match(/[.,]/g) ?? [];
  if (new Set(groups).size > 1) return null;
  const decimalSep = t.length > whole.length ? t[whole.length] : null;
  if (decimalSep && groups.includes(decimalSep)) return null;
  const cents = Number(whole.replace(/[.,]/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
```

Run the `parseEuros` cases and adjust the implementation until every listed case passes; the table is the contract, the code above is a starting point.

`frontend/src/transactions/edit/mutations.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { send } from "../../lib/api";
import type {
  BulkEditRequest, DeletedResponse, RestoredResponse, TaggedResponse, TagRequest, TransactionEdit, UpdatedResponse,
} from "../../lib/types";

/** Every query a write can change: the list, the Summary, the periods and the lookups. */
const AFFECTED = ["transactions", "summary", "periods", "lookups"];

function useWrite<V, R>(fn: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(AFFECTED.map((key) => client.invalidateQueries({ queryKey: [key] }))),
  });
}

export const useEditOne = () =>
  useWrite(({ id, edit }: { id: number; edit: TransactionEdit }) => send<{ ok: true }>("PATCH", `/api/transactions/${id}`, edit));
export const useBulkEdit = () => useWrite((body: BulkEditRequest) => send<UpdatedResponse>("POST", "/api/transactions/bulk-edit", body));
export const useDelete = () => useWrite((ids: number[]) => send<DeletedResponse>("POST", "/api/transactions/delete", { ids }));
export const useRestore = () => useWrite((ids: number[]) => send<RestoredResponse>("POST", "/api/transactions/restore", { ids }));
export const useTag = () => useWrite((body: TagRequest) => send<TaggedResponse>("POST", "/api/transactions/tags", body));
```

- [ ] **Step 4: Run tests, typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS (the whole suite, since `api.ts` and `TransactionFilters.tsx` changed).

- [ ] **Step 5: Commit**

```bash
jj desc -m "Add sheets, toasts and write calls to the frontend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 5: Selection and the action bar

**Files:**
- Modify: `frontend/src/transactions/TransactionTable.tsx` (checkbox column, row opens)
- Modify: `frontend/src/transactions/DayList.tsx` (checkbox, row opens)
- Create: `frontend/src/transactions/edit/ActionBar.tsx`
- Create: `frontend/src/transactions/edit/Editing.tsx` (owns sheets and the toast; in this task only the action bar)
- Modify: `frontend/src/transactions/TransactionsPage.tsx` (selection and open-row state)
- Test: `frontend/src/__tests__/transactions/selection.test.tsx` (new); extend `list.test.tsx` for the new props

**Interfaces:**
- Consumes: Task 4's `Sheet`/`Toast` (wired in later tasks).
- Produces:
  - `TransactionTable` and `DayList` gain props `selected: ReadonlySet<number>`, `onToggle: (id: number) => void`, `onOpen: (row: TransactionRow) => void`; `TransactionTable` also `onToggleShown: (ids: number[], on: boolean) => void`.
  - `ActionBar(props: { count: number; total: number; onSelectAll: () => void; onTag: () => void; onUntag: () => void; onEdit: () => void; onDelete: () => void; onCancel: () => void })`.
  - `Editing(props: { rows: TransactionRow[]; selectedIds: number[]; onSelectAll: () => void; onClearSelection: () => void; open: TransactionRow | null; onCloseOpen: () => void; lookups: LookupsResponse | undefined })` — renders the action bar when `selectedIds.length > 0`. Later tasks add the sheets and the toast here; `TransactionsPage` does not change again.

- [ ] **Step 1: Write the failing tests**

`frontend/src/__tests__/transactions/selection.test.tsx` — build it on the same `api()`/`renderAt()` helpers as `TransactionsPage.test.tsx` (copy them; tests are independent files). Default rows (every later task's tests reuse this helper): two expenses in September 2026, `row(3, "2026-09-29", 100)` and `row(2, "2026-09-28", 100)`, €1.00 each, merchants "Shop 3" and "Shop 2". Then:

```tsx
describe("selecting transactions", () => {
  it("shows the action bar once a row is ticked, and hides it on Cancel", async () => {
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    const bar = screen.getByRole("region", { name: "Selected transactions" });
    expect(bar).toHaveTextContent("1 selected");
    await userEvent.click(within(bar).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
  });

  it("ticks every shown row from the header, and every filtered row from the bar", async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => row(i + 1, "2026-09-10", 100));
    renderAt("/transactions?from=2026-09-01&to=2026-09-30", api({ rows: many }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    const bar = screen.getByRole("region", { name: "Selected transactions" });
    expect(bar).toHaveTextContent(`${PAGE_SIZE} selected`);
    await userEvent.click(within(bar).getByRole("button", { name: `Select all ${PAGE_SIZE + 5}` }));
    expect(bar).toHaveTextContent(`${PAGE_SIZE + 5} selected`);
  });

  it("clears the selection when the filters change", async () => {
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
  });

  it("counts only selected rows still in the list after a refetch", async () => {
    // Review Focus 3: a row deleted elsewhere drops out of the selection.
    const rows = { value: [row(3, "2026-09-29", 100), row(2, "2026-09-28", 100)] };
    const client = renderAt("/transactions?from=2026-09-01&to=2026-09-30", api({ rowsRef: rows }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    rows.value = [row(3, "2026-09-29", 100)];
    await act(() => client.invalidateQueries({ queryKey: ["transactions"] }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected transactions" })).toHaveTextContent("1 selected"));
  });

  it("opens a row by clicking it, but not by ticking it", async () => {
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Shop 3" }));
    // The sheet itself arrives in Task 8; here the page records the open row.
    expect(screen.getByTestId("open-row")).toHaveTextContent("3");
  });

  it("offers the same on a phone", async () => {
    desktop = false;
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    expect(screen.getByRole("region", { name: "Selected transactions" })).toHaveTextContent("1 selected");
  });
});
```

Adapt the copied `api()` helper: accept `rowsRef?: { value: TransactionRow[] }` read on every call, and have `renderAt` return the `QueryClient`. The `open-row` test id is a temporary hook: `Editing` renders `<span hidden data-testid="open-row">{open?.id}</span>` until Task 8 replaces it with the edit sheet; Task 8 changes that test to look for the dialog.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/transactions/selection.test.tsx`
Expected: FAIL — no checkboxes.

- [ ] **Step 3: Implement**

`TransactionTable.tsx`:
- New first header cell: `<th scope="col" className="<same sticky classes as the other th> w-8 px-2"><input type="checkbox" aria-label="Select all shown" checked={allShown} ref={(el) => { if (el) el.indeterminate = someShown && !allShown; }} onChange={(e) => props.onToggleShown(props.rows.map((r) => r.id), e.target.checked)} /></th>` where `allShown = rows.length > 0 && rows.every((r) => props.selected.has(r.id))` and `someShown = rows.some(...)`.
- Each row: `onClick={() => props.onOpen(r)}` and `className` adds `cursor-pointer`; a selected row also gets `aria-selected` and a stronger background (`bg-slate-200 dark:bg-slate-800` overriding the stripe — put it after the stripe classes and use `!` if Tailwind ordering requires it; check in the browser in Task 10).
- First cell: `<td className="px-2 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.merchant}, ${r.date}, ${signedAmount(r).text}`} checked={props.selected.has(r.id)} onChange={() => props.onToggle(r.id)} /></td>`.
- The merchant cell's text becomes `<button type="button" className="max-w-full truncate text-left" onClick={(e) => { e.stopPropagation(); props.onOpen(r); }} aria-label={`Edit ${r.merchant}`}>{r.merchant}</button>` — the keyboard route to the edit sheet.

`DayList.tsx`: same props; each `<li>` gets `onClick={() => props.onOpen(r)}` and `cursor-pointer`, a leading checkbox (`onClick` stops propagation, same aria-label pattern), and the merchant text becomes the same "Edit …" button. Lay the checkbox out with `flex items-start gap-2` around the existing two lines.

`ActionBar.tsx`:

```tsx
/** Shown while rows are selected: on phones pinned to the bottom, on desktop in the frozen controls. */
export function ActionBar(props: {
  count: number; total: number;
  onSelectAll: () => void; onTag: () => void; onUntag: () => void; onEdit: () => void; onDelete: () => void; onCancel: () => void;
}) {
  const btn = "rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800";
  return (
    <section aria-label="Selected transactions"
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white p-3 text-sm shadow-[0_-2px_8px_rgba(0,0,0,0.06)] md:static md:rounded-lg md:border md:shadow-none dark:border-slate-800 dark:bg-slate-950">
      <span className="font-medium">{props.count} selected</span>
      {props.count < props.total && (
        <button type="button" onClick={props.onSelectAll} className="underline">Select all {props.total}</button>
      )}
      <span className="flex-1" />
      <button type="button" onClick={props.onTag} className={btn}>Tag</button>
      <button type="button" onClick={props.onUntag} className={btn}>Untag</button>
      <button type="button" onClick={props.onEdit} className={btn}>Edit</button>
      <button type="button" onClick={props.onDelete} className={`${btn} text-expense`}>Delete</button>
      <button type="button" onClick={props.onCancel} className="px-2 py-1.5 underline">Cancel</button>
    </section>
  );
}
```

`Editing.tsx` (this task's version):

```tsx
import type { LookupsResponse, TransactionRow } from "../../lib/types";
import { ActionBar } from "./ActionBar";

export function Editing(props: {
  rows: TransactionRow[];
  selectedIds: number[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  open: TransactionRow | null;
  onCloseOpen: () => void;
  lookups: LookupsResponse | undefined;
}) {
  return (
    <>
      {props.selectedIds.length > 0 && (
        <ActionBar count={props.selectedIds.length} total={props.rows.length} onSelectAll={props.onSelectAll}
          onTag={() => {}} onUntag={() => {}} onEdit={() => {}} onDelete={() => {}} onCancel={props.onClearSelection} />
      )}
      <span hidden data-testid="open-row">{props.open?.id}</span>
    </>
  );
}
```

`TransactionsPage.tsx`:
- State: `const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());` and `const [open, setOpen] = useState<TransactionRow | null>(null);`. Clear `selected` in the existing `useEffect(..., [path])` alongside `setShown`.
- Effective selection (Review Focus 3): `const selectedIds = data ? data.rows.filter((r) => selected.has(r.id)).map((r) => r.id) : [];` — pass `new Set(selectedIds)` to the list components, so a vanished row is neither counted nor ticked.
- `toggle(id)`, `toggleShown(ids, on)`, `selectAll = () => setSelected(new Set(data!.rows.map((r) => r.id)))`, `clearSelection = () => setSelected(new Set())`.
- Render `<Editing … />` inside the `StickyPanel`, after the totals, so on desktop the bar sits in the frozen controls (its own classes make it `fixed` on phones). Pass `rows={data?.rows ?? []}`.
- When the bar is showing on a phone, give `<main>` extra bottom padding (`pb-28`) so the last rows can scroll above it.

- [ ] **Step 4: Run tests, typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS (update `list.test.tsx` renders with `selected={new Set()} onToggle={() => {}} onOpen={() => {}} onToggleShown={() => {}}` where needed).

- [ ] **Step 5: Commit**

```bash
jj desc -m "Select transactions and show what can be done with them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 6: Delete with Undo

**Files:**
- Create: `frontend/src/transactions/edit/DeleteSheet.tsx`
- Create: `frontend/src/transactions/edit/useDeleteFlow.ts`
- Modify: `frontend/src/transactions/edit/Editing.tsx` (toast state; wire Delete)
- Test: `frontend/src/__tests__/transactions/delete.test.tsx` (new)

**Interfaces:**
- Consumes: `useDelete`, `useRestore` (Task 4), `Sheet`, `Toast`, `ToastState`.
- Produces:
  - `export const CONFIRM_ABOVE = 20;`
  - `useDeleteFlow(opts: { rows: TransactionRow[]; notify: (t: Omit<ToastState, "id">) => void; onDeleted: () => void }) => { start: (ids: number[]) => void; sheet: ReactNode }` — `start` deletes at once up to `CONFIRM_ABOVE` ids, else opens the confirmation sheet; on success calls `onDeleted` and notifies "N deleted" (or the partial message) with an Undo action that restores the same ids. Task 8's edit sheet reuses `start([row.id])`.
  - `Editing` holds `const [toast, setToast] = useState<ToastState | null>(null)`, a counter `const nextId = useRef(0)`, and `notify = (t) => setToast({ ...t, id: ++nextId.current })` (a counter, not `Date.now()`, so two toasts in one millisecond still restart the timer).

- [ ] **Step 1: Write the failing tests**

`frontend/src/__tests__/transactions/delete.test.tsx`, with the page helpers from Task 5 extended so `api()` records POST bodies (`calls: { path, method, body }[]`) and answers:
- `POST /api/transactions/delete` → `{ deleted: opts.deletedCount ?? ids.length }`
- `POST /api/transactions/restore` → `{ restored: ids.length }`, or status 500 when `opts.restoreFails`.

Use a response promise the test can hold open for the double-submit case (`opts.gate?: Promise<void>`, awaited before answering any POST or PATCH, never a GET).

```tsx
describe("deleting", () => {
  it("deletes a few rows at once and offers Undo", async () => {
    const mock = renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 deleted"));
    expect(posted(mock, "/api/transactions/delete")).toEqual([{ ids: [3] }]);
    expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/restore")).toEqual([{ ids: [3] }]));
  });

  it("asks first above twenty rows, with the count and the total", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => row(i + 1, "2026-09-10", 100));
    const mock = renderAt(URL_SEPT, api({ rows }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    const sheet = screen.getByRole("dialog", { name: "Delete 21 transactions?" });
    expect(sheet).toHaveTextContent("€21.00");
    expect(posted(mock, "/api/transactions/delete")).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete 21" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("21 deleted"));
  });

  it("does not ask for exactly twenty", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(i + 1, "2026-09-10", 100));
    renderAt(URL_SEPT, api({ rows }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends one request however often Delete is pressed while it runs", async () => {
    // Review Focus 1.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const rows = Array.from({ length: 21 }, (_, i) => row(i + 1, "2026-09-10", 100));
    const mock = renderAt(URL_SEPT, api({ rows, gate }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Delete 21" });
    await userEvent.click(confirm);
    const busy = within(screen.getByRole("dialog")).getByRole("button", { name: /Deleting 21/ });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("21 deleted"));
    expect(posted(mock, "/api/transactions/delete")).toHaveLength(1);
  });

  it("says when some were already gone", async () => {
    renderAt(URL_SEPT, api({ deletedCount: 1 }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 of 2 deleted (1 was already gone)"));
  });

  it("offers Retry when Undo fails", async () => {
    renderAt(URL_SEPT, api({ restoreFails: true }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(await screen.findByRole("status")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn't restore"));
    expect(within(screen.getByRole("status")).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
```

(`URL_SEPT = "/transactions?from=2026-09-01&to=2026-09-30"`, `bar = () => screen.getByRole("region", { name: "Selected transactions" })`, `posted(mock, path)` returns the parsed bodies of POSTs to `path`. The default rows are two, ids 3 and 2, €1.00 each.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/transactions/delete.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`useDeleteFlow.ts`:

```ts
import { createElement, useState, type ReactNode } from "react";
import type { ToastState } from "../../lib/Toast";
import type { TransactionRow } from "../../lib/types";
import { DeleteSheet } from "./DeleteSheet";
import { useDelete, useRestore } from "./mutations";

export const CONFIRM_ABOVE = 20;

const plural = (n: number) => `${n} ${n === 1 ? "was" : "were"}`;

export function useDeleteFlow(opts: {
  rows: TransactionRow[];
  notify: (t: Omit<ToastState, "id">) => void;
  onDeleted: () => void;
}): { start: (ids: number[]) => void; sheet: ReactNode } {
  const del = useDelete();
  const restore = useRestore();
  const [confirming, setConfirming] = useState<number[] | null>(null);

  const undo = (ids: number[]) => restore.mutate(ids, {
    onSuccess: (r) => opts.notify({ message: `${r.restored} restored` }),
    onError: () => opts.notify({ message: "Couldn't restore", action: { label: "Retry", run: () => undo(ids) } }),
  });

  const run = (ids: number[]) => {
    if (del.isPending) return;
    del.mutate(ids, {
      onSuccess: ({ deleted }) => {
        setConfirming(null);
        opts.onDeleted();
        const gone = ids.length - deleted;
        opts.notify({
          message: gone > 0 ? `${deleted} of ${ids.length} deleted (${plural(gone)} already gone)` : `${deleted} deleted`,
          action: deleted > 0 ? { label: "Undo", run: () => undo(ids) } : undefined,
        });
      },
      onError: (e) => opts.notify({ message: `Couldn't delete: ${e.message}`, action: { label: "Retry", run: () => run(ids) } }),
    });
  };

  const start = (ids: number[]) => (ids.length > CONFIRM_ABOVE ? setConfirming(ids) : run(ids));

  const sheet = createElement(DeleteSheet, {
    ids: confirming, rows: opts.rows, busy: del.isPending,
    onConfirm: () => confirming && run(confirming), onClose: () => setConfirming(null),
  });
  return { start, sheet };
}
```

`DeleteSheet.tsx`:

```tsx
import { formatCents } from "../../lib/money";
import { Sheet } from "../../lib/Sheet";
import type { TransactionRow } from "../../lib/types";

export function DeleteSheet(props: {
  ids: number[] | null; rows: TransactionRow[]; busy: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const n = props.ids?.length ?? 0;
  const chosen = new Set(props.ids ?? []);
  const total = props.rows.filter((r) => chosen.has(r.id)).reduce((a, r) => a + r.amountCents, 0);
  return (
    <Sheet title={`Delete ${n} transactions?`} open={props.ids !== null} onClose={props.onClose} busy={props.busy}>
      <p className="text-sm">These {n} transactions total {formatCents(total)}. You can undo this straight after.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={props.onClose} disabled={props.busy} className="rounded-md px-3 py-1.5 underline disabled:opacity-40">Cancel</button>
        <button type="button" onClick={props.onConfirm} disabled={props.busy}
          className="inline-flex items-center gap-2 rounded-md bg-expense px-3 py-1.5 font-medium text-white disabled:opacity-70">
          {props.busy && <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {props.busy ? `Deleting ${n}…` : `Delete ${n}`}
        </button>
      </div>
    </Sheet>
  );
}
```

(The total is the sum of amounts regardless of type, as a count of money moved; the spec's example shows one figure.)

`Editing.tsx`: add toast state, the id counter and `notify`; `const deleting = useDeleteFlow({ rows: props.rows, notify, onDeleted: props.onClearSelection });` wire `onDelete={() => deleting.start(props.selectedIds)}`; render `{deleting.sheet}` and `<Toast toast={toast} onDismiss={() => setToast(null)} />`.

- [ ] **Step 4: Run tests, typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Change `ids.length > CONFIRM_ABOVE` to `>=`; "does not ask for exactly twenty" must FAIL. Revert.

- [ ] **Step 6: Commit**

```bash
jj desc -m "Delete selected transactions, with Undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 7: Tag and untag

**Files:**
- Create: `frontend/src/transactions/edit/TagInput.tsx`
- Create: `frontend/src/transactions/edit/TagSheet.tsx`
- Modify: `frontend/src/transactions/edit/Editing.tsx`
- Test: `frontend/src/__tests__/transactions/tags.test.tsx` (new)

**Interfaces:**
- Consumes: `useTag` (Task 4), `Sheet`, `notify` in `Editing` (Task 6).
- Produces:
  - `splitTags(text: string): string[]` (exported from `TagInput.tsx`) — splits on commas, then applies the Worker's `normalizeTags` (lower-case, trim, spaces to "-", drop characters outside `[a-z0-9:_-]`, no empties or repeats), so a chip shows exactly what will be stored.
  - `TagInput(props: { value: string[]; onChange: (tags: string[]) => void; draft: string; onDraft: (text: string) => void; suggestions: string[]; label: string })`.
  - `TagSheet(props: { mode: "add" | "remove" | null; ids: number[]; rows: TransactionRow[]; known: string[]; onClose: () => void; onDone: (message: string) => void })`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/__tests__/transactions/tags.test.tsx` — page helpers as in Task 6, with `POST /api/transactions/tags` answering `{ tagged: ids.length }`, lookups `tags: ["emergency", "travel"]`, and rows: id 3 tagged `"gift,travel"`, id 2 untagged.

```tsx
import { splitTags } from "../../transactions/edit/TagInput";

describe("splitTags", () => {
  it("applies the Worker's tag rule", () => {
    expect(splitTags("Travel, Trip , ,travel")).toEqual(["travel", "trip"]);
    expect(splitTags("Road Trip!, trip:2026")).toEqual(["road-trip", "trip:2026"]);
  });
});

describe("tagging", () => {
  it("adds typed and chosen tags, including text not yet turned into a chip", async () => {
    // Review Focus 4.
    const mock = renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog", { name: "Tag 2 transactions" });
    const box = within(sheet).getByRole("combobox", { name: "Tags" });
    await userEvent.type(box, "Holiday{Enter}Trip ");
    expect(within(sheet).getByText("holiday")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Add tags" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/tags")).toEqual([{ ids: [3, 2], tags: ["holiday", "trip"], mode: "add" }]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tagged 2"));
    // Selection stays, so a mistake can be untagged at once.
    expect(bar()).toHaveTextContent("2 selected");
  });

  it("removes a chip with Backspace on an empty box", async () => {
    renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const box = screen.getByRole("combobox", { name: "Tags" });
    await userEvent.type(box, "a,b,{Backspace}");
    expect(screen.queryByText("b")).not.toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("suggests only the tags the selection carries when untagging", async () => {
    renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Untag" }));
    const sheet = screen.getByRole("dialog", { name: "Untag 2 transactions" });
    const options = [...sheet.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["gift", "travel"]);
  });

  it("will not submit with no tags", async () => {
    renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    expect(screen.getByRole("button", { name: "Add tags" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/transactions/tags.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`TagInput.tsx`:

```tsx
import { useId } from "react";
import { normalizeTags } from "../../lib/types";

/** "a, b" as the Worker will store it: its own normalizeTags, so chips never lie. */
export function splitTags(text: string): string[] {
  return normalizeTags(text.split(","));
}

/** Chips for the tags so far, and a box that turns "a, b" or Enter into chips. */
export function TagInput(props: {
  value: string[]; onChange: (tags: string[]) => void;
  draft: string; onDraft: (text: string) => void;
  suggestions: string[]; label: string;
}) {
  const listId = useId();
  const commit = (text: string) => {
    const add = splitTags(text).filter((t) => !props.value.includes(t));
    if (add.length) props.onChange([...props.value, ...add]);
    props.onDraft("");
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">{props.label}</span>
        <input role="combobox" aria-expanded={false} list={listId} value={props.draft} aria-label={props.label}
          className="rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) commit(v); else props.onDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(props.draft); }
            if (e.key === "Backspace" && props.draft === "" && props.value.length) props.onChange(props.value.slice(0, -1));
          }} />
      </label>
      <datalist id={listId}>{props.suggestions.map((t) => <option key={t} value={t} />)}</datalist>
      {props.value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen tags">
          {props.value.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
              <span>{t}</span>
              <button type="button" aria-label={`Remove ${t}`} onClick={() => props.onChange(props.value.filter((x) => x !== t))}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

(The `combobox` role with a `list` attribute is what the test queries; if Testing Library already maps `<input list>` to `combobox`, drop the explicit `role` and `aria-expanded`.)

`TagSheet.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Sheet } from "../../lib/Sheet";
import type { TransactionRow } from "../../lib/types";
import { useTag } from "./mutations";
import { splitTags, TagInput } from "./TagInput";

export function TagSheet(props: {
  mode: "add" | "remove" | null; ids: number[]; rows: TransactionRow[]; known: string[];
  onClose: () => void; onDone: (message: string) => void;
}) {
  const tag = useTag();
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setTags([]); setDraft(""); setError(null); }, [props.mode]);

  const chosen = new Set(props.ids);
  const carried = [...new Set(props.rows.filter((r) => chosen.has(r.id)).flatMap((r) => splitTags(r.tags)))].sort();
  const all = [...new Set([...tags, ...splitTags(draft)])];
  const n = props.ids.length;
  const adding = props.mode === "add";

  const submit = () => {
    if (!props.mode || all.length === 0 || tag.isPending) return;
    tag.mutate({ ids: props.ids, tags: all, mode: props.mode }, {
      onSuccess: ({ tagged }) => { props.onDone(`${adding ? "Tagged" : "Untagged"} ${tagged}`); props.onClose(); },
      onError: (e) => setError(e.message),
    });
  };

  return (
    <Sheet title={`${adding ? "Tag" : "Untag"} ${n} transactions`} open={props.mode !== null} onClose={props.onClose} busy={tag.isPending}>
      <TagInput label="Tags" value={tags} onChange={setTags} draft={draft} onDraft={setDraft}
        suggestions={adding ? props.known : carried} />
      {error && <p role="alert" className="text-sm text-expense">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={all.length === 0 || tag.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {tag.isPending ? `${adding ? "Tagging" : "Untagging"} ${n}…` : adding ? "Add tags" : "Remove tags"}
        </button>
      </div>
    </Sheet>
  );
}
```

`Editing.tsx`: `const [tagMode, setTagMode] = useState<"add" | "remove" | null>(null);` wire `onTag={() => setTagMode("add")}`, `onUntag={() => setTagMode("remove")}`, render `<TagSheet mode={tagMode} ids={props.selectedIds} rows={props.rows} known={props.lookups?.tags ?? []} onClose={() => setTagMode(null)} onDone={(message) => notify({ message })} />`. Do not clear the selection after tagging.

- [ ] **Step 4: Run tests, typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Tag and untag selected transactions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 8: Edit one transaction

**Files:**
- Create: `frontend/src/transactions/edit/EditSheet.tsx`
- Create: `frontend/src/transactions/edit/CategorySelect.tsx`
- Modify: `frontend/src/transactions/edit/Editing.tsx` (replace the `open-row` placeholder)
- Modify: `frontend/src/__tests__/transactions/selection.test.tsx` (the open-row test now looks for the dialog)
- Test: `frontend/src/__tests__/transactions/editOne.test.tsx` (new)

**Interfaces:**
- Consumes: `useEditOne` (Task 4), `parseEuros`, `Segmented`, `Sheet`, `useDeleteFlow().start` (Task 6), `notify`.
- Produces:
  - `KEEP = "__keep__"` and `CategorySelect(props: { value: string; onChange: (v: string) => void; categories: string[]; merchantCategory?: string; allowKeep?: boolean })` — option `""` reads "From merchant (X)" (or "From merchant" without X), option `KEEP` reads "Leave unchanged" when `allowKeep`; `"Other"` is never offered as an override.
  - `toCategoryEdit(value: string): string | null | undefined` — `KEEP` → `undefined`, `""` → `null`, else the name.
  - `EditSheet(props: { row: TransactionRow | null; lookups: LookupsResponse | undefined; onClose: () => void; onSaved: () => void; onDelete: (id: number) => void })`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/__tests__/transactions/editOne.test.tsx` — page helpers as before, with `PATCH /api/transactions/:id` answering `opts.patch?.(id, body)` or `{ ok: true }`; lookups `categories: ["Eating out", "Groceries", "Other"]`, `sources: ["Bank A", "Card"]`. Default row 3: `merchant: "Shop 3"`, `merchantRaw: "SHOP 3"`, `amountCents: 100`, `type: "expense"`, `source: "Card"`, `category: "Groceries"`, `merchantCategory: "Groceries"`, `categoryOverridden: false`, `date: "2026-09-29"`.

```tsx
const openShop3 = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "Edit Shop 3" }));
  return screen.getByRole("dialog", { name: "Edit transaction" });
};

describe("editing one transaction", () => {
  it("sends only what changed, with a comma decimal", async () => {
    // Review Focus 2.
    const mock = renderAt(URL_SEPT);
    const sheet = await openShop3();
    const amount = within(sheet).getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "12,50");
    await userEvent.selectOptions(within(sheet).getByLabelText("Category"), "Eating out");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched(mock)).toEqual([{ id: 3, body: { amountCents: 1250, category: "Eating out" } }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each(["0", "-5", "abc"])("refuses the amount %j without a request", async (typed) => {
    const mock = renderAt(URL_SEPT);
    const sheet = await openShop3();
    const amount = within(sheet).getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, typed);
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Enter an amount more than zero, like 12,50");
    expect(patched(mock)).toEqual([]);
  });

  it("clears an override by choosing From merchant", async () => {
    const mock = renderAt(URL_SEPT, api({ rows: [{ ...row(3, "2026-09-29", 100), category: "Eating out", categoryOverridden: true }] }));
    const sheet = await openShop3();
    const select = within(sheet).getByLabelText("Category");
    expect(select).toHaveValue("Eating out");
    expect(within(select).getByRole("option", { name: "From merchant (Groceries)" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Other" })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, "");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched(mock)).toEqual([{ id: 3, body: { category: null } }]));
  });

  it("keeps every typed value and shows the server's message on a 400", async () => {
    // Review Focus 5.
    renderAt(URL_SEPT, api({ patch: () => ({ status: 400, body: { error: "Date must be between 1900-01-01 and 2027-10-03" } }) }));
    const sheet = await openShop3();
    const source = within(sheet).getByLabelText("Source");
    await userEvent.clear(source);
    await userEvent.type(source, "Bank A");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Date must be between");
    expect(within(sheet).getByLabelText("Source")).toHaveValue("Bank A");
  });

  it("says when the transaction no longer exists", async () => {
    renderAt(URL_SEPT, api({ patch: () => ({ status: 404, body: { error: "This transaction no longer exists." } }) }));
    const sheet = await openShop3();
    await userEvent.click(within(sheet).getByRole("button", { name: "Expense" })); // no change yet…
    await userEvent.click(within(sheet).getByRole("button", { name: "Income" }));  // …now one
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("This transaction no longer exists.");
  });

  it("disables Save until something changes, and while saving", async () => {
    // Review Focus 1.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = renderAt(URL_SEPT, api({ gate }));
    const sheet = await openShop3();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Income" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByRole("button", { name: "Saving…" })).toBeDisabled();
    release();
    await waitFor(() => expect(patched(mock)).toHaveLength(1));
  });

  it("deletes from the sheet through the Undo flow", async () => {
    const mock = renderAt(URL_SEPT);
    const sheet = await openShop3();
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/delete")).toEqual([{ ids: [3] }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 deleted");
  });

  it("shows how the statement text displays today", async () => {
    renderAt(URL_SEPT);
    const sheet = await openShop3();
    expect(within(sheet).getByLabelText("Statement text")).toHaveValue("SHOP 3");
    expect(sheet).toHaveTextContent("Shows as: Shop 3");
  });
});
```

(`patched(mock)` returns `{ id, body }` for each PATCH. Change the selection test's last case to `expect(screen.getByRole("dialog", { name: "Edit transaction" })).toBeInTheDocument()`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/transactions/editOne.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`CategorySelect.tsx`:

```tsx
export const KEEP = "__keep__";

/** KEEP: leave alone; "": back to the merchant's category; else the override. */
export function toCategoryEdit(value: string): string | null | undefined {
  if (value === KEEP) return undefined;
  return value === "" ? null : value;
}

export function CategorySelect(props: {
  value: string; onChange: (v: string) => void; categories: string[]; merchantCategory?: string; allowKeep?: boolean;
}) {
  // "Other" is what no category reads as; it is not one you can choose.
  const choices = props.categories.filter((c) => c !== "Other");
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-slate-500">Category</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
        {props.allowKeep && <option value={KEEP}>Leave unchanged</option>}
        <option value="">{props.merchantCategory ? `From merchant (${props.merchantCategory})` : "From merchant"}</option>
        {choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}
```

`EditSheet.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import { formatCents } from "../../lib/money";
import { Segmented } from "../../lib/Segmented";
import { Sheet } from "../../lib/Sheet";
import type { LookupsResponse, TransactionEdit, TransactionRow, TransactionType } from "../../lib/types";
import { parseEuros } from "../amount";
import { CategorySelect, toCategoryEdit } from "./CategorySelect";
import { useEditOne } from "./mutations";

interface Form { date: string; merchant: string; amount: string; type: TransactionType; source: string; category: string }

const formOf = (r: TransactionRow): Form => ({
  date: r.date,
  merchant: r.merchantRaw,
  amount: (r.amountCents / 100).toFixed(2).replace(".", ","),
  type: r.type,
  source: r.source,
  category: r.categoryOverridden ? r.category : "",
});

/** Only what differs from the row, as the PATCH body. Null when the amount does not parse. */
function diff(r: TransactionRow, f: Form): TransactionEdit | null {
  const start = formOf(r);
  const edit: TransactionEdit = {};
  if (f.date !== start.date) edit.date = f.date;
  if (f.merchant.trim() !== start.merchant) edit.merchant = f.merchant.trim();
  if (f.amount !== start.amount) {
    const cents = parseEuros(f.amount);
    if (cents === null) return null;
    if (cents !== r.amountCents) edit.amountCents = cents;
  }
  if (f.type !== start.type) edit.type = f.type;
  if (f.source.trim() !== start.source) edit.source = f.source.trim();
  if (f.category !== start.category) edit.category = toCategoryEdit(f.category);
  return edit;
}

const field = "rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900";

export function EditSheet(props: {
  row: TransactionRow | null; lookups: LookupsResponse | undefined;
  onClose: () => void; onSaved: () => void; onDelete: (id: number) => void;
}) {
  const save = useEditOne();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setForm(props.row ? formOf(props.row) : null); setError(null); }, [props.row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = props.row;
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const edit = r && form ? diff(r, form) : null;
  const changed = edit === null || Object.keys(edit).length > 0;

  const submit = () => {
    if (!r || !form || save.isPending) return;
    if (edit === null) { setError("Enter an amount more than zero, like 12,50"); return; }
    if (form.merchant.trim() === "") { setError("Statement text cannot be empty"); return; }
    if (form.source.trim() === "") { setError("Source cannot be empty"); return; }
    setError(null);
    save.mutate({ id: r.id, edit }, {
      onSuccess: () => { props.onSaved(); props.onClose(); },
      onError: (e) => setError(e instanceof ApiError ? e.message : `Couldn't save: ${e.message}`),
    });
  };

  return (
    <Sheet title="Edit transaction" open={r !== null} onClose={props.onClose} busy={save.isPending}>
      {r && form && (
        <form className="flex flex-col gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Date</span>
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Statement text</span>
            <input value={form.merchant} onChange={(e) => set({ merchant: e.target.value })} className={field} />
            <span className="text-xs text-slate-500">Shows as: {r.merchant}. Changing the text may change the merchant, and with it the category unless one is set below.</span>
          </label>
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-slate-500">Amount</span>
              <input inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })}
                aria-describedby="amount-hint" className={field} />
            </label>
            <Segmented label="Type" value={form.type} onChange={(t) => t && set({ type: t })}
              options={[["expense", "Expense"], ["income", "Income"]]} />
          </div>
          <span id="amount-hint" className="sr-only">Euros, for example 12,50. Currently {formatCents(r.amountCents)}.</span>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Source</span>
            <input list="edit-sources" value={form.source} onChange={(e) => set({ source: e.target.value })} className={field} />
            <datalist id="edit-sources">{props.lookups?.sources.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <CategorySelect value={form.category} onChange={(category) => set({ category })}
            categories={props.lookups?.categories ?? []} merchantCategory={r.merchantCategory} />
          {error && <p role="alert" className="text-expense">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button type="button" onClick={() => props.onDelete(r.id)} disabled={save.isPending}
              className="px-1 text-expense underline disabled:opacity-40">Delete</button>
            <button type="submit" disabled={!changed || save.isPending}
              className="rounded-md bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
```

Notes:
- The 404 case needs the list refreshed: in `onError`, if `e instanceof ApiError && e.status === 404`, also call `queryClient.invalidateQueries({ queryKey: ["transactions"] })` (get the client with `useQueryClient()`).
- `Segmented` with `[T | undefined, string][]` options: pass `["expense", "Expense"]` etc.; the `onChange` value is never `undefined` here because there is no "All" option.
- In the "Save disabled until something changes" test, an amount that does not parse counts as a change (so Save is enabled and the error shows).

`Editing.tsx`: replace the `open-row` span with `<EditSheet row={props.open} lookups={props.lookups} onClose={props.onCloseOpen} onSaved={() => notify({ message: "Saved" })} onDelete={(id) => { props.onCloseOpen(); deleting.start([id]); }} />`.

- [ ] **Step 4: Run tests, typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Edit one transaction, including its own category

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 9: Bulk edit

**Files:**
- Create: `frontend/src/transactions/edit/BulkEditSheet.tsx`
- Modify: `frontend/src/transactions/edit/Editing.tsx`
- Test: `frontend/src/__tests__/transactions/bulkEdit.test.tsx` (new)

**Interfaces:**
- Consumes: `useBulkEdit` (Task 4), `CategorySelect`, `KEEP`, `toCategoryEdit` (Task 8), `Sheet`, `notify`.
- Produces: `BulkEditSheet(props: { ids: number[] | null; lookups: LookupsResponse | undefined; onClose: () => void; onDone: (message: string) => void })`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/__tests__/transactions/bulkEdit.test.tsx` — page helpers as before, `POST /api/transactions/bulk-edit` answering `{ updated: opts.updatedCount ?? ids.length }`.

```tsx
describe("bulk editing", () => {
  const openBulk = async () => {
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Edit" }));
    return screen.getByRole("dialog", { name: "Edit 2 transactions" });
  };

  it("sends only the fields changed from 'Leave unchanged'", async () => {
    const mock = renderAt(URL_SEPT);
    const sheet = await openBulk();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(sheet).getByLabelText("Source"), "Bank A");
    await userEvent.selectOptions(within(sheet).getByLabelText("Category"), "");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/bulk-edit")).toEqual([
      { ids: [3, 2], edit: { source: "Bank A", category: null } },
    ]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Updated 2"));
    expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
  });

  it("sets the type for all of them", async () => {
    const mock = renderAt(URL_SEPT);
    const sheet = await openBulk();
    await userEvent.selectOptions(within(sheet).getByLabelText("Type"), "income");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/bulk-edit")[0].edit).toEqual({ type: "income" }));
  });

  it("says when some were already gone", async () => {
    renderAt(URL_SEPT, api({ updatedCount: 1 }));
    const sheet = await openBulk();
    await userEvent.type(within(sheet).getByLabelText("Source"), "Bank A");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Updated 1 of 2 (1 was already gone)"));
  });

  it("treats a box of spaces as unchanged", async () => {
    renderAt(URL_SEPT);
    const sheet = await openBulk();
    await userEvent.type(within(sheet).getByLabelText("Statement text"), "   ");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/transactions/bulkEdit.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`BulkEditSheet.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Sheet } from "../../lib/Sheet";
import type { BulkEdit, LookupsResponse, TransactionType } from "../../lib/types";
import { CategorySelect, KEEP, toCategoryEdit } from "./CategorySelect";
import { useBulkEdit } from "./mutations";

const field = "rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900";
const was = (n: number) => `${n} ${n === 1 ? "was" : "were"}`;

export function BulkEditSheet(props: {
  ids: number[] | null; lookups: LookupsResponse | undefined; onClose: () => void; onDone: (message: string) => void;
}) {
  const save = useBulkEdit();
  const [merchant, setMerchant] = useState("");
  const [type, setType] = useState<"" | TransactionType>("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState(KEEP);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setMerchant(""); setType(""); setSource(""); setCategory(KEEP); setError(null); }, [props.ids]);

  const edit: BulkEdit = {
    ...(merchant.trim() && { merchant: merchant.trim() }),
    ...(type && { type }),
    ...(source.trim() && { source: source.trim() }),
    ...(category !== KEEP && { category: toCategoryEdit(category) }),
  };
  const n = props.ids?.length ?? 0;
  const changed = Object.keys(edit).length > 0;

  const submit = () => {
    if (!props.ids || !changed || save.isPending) return;
    const ids = props.ids;
    save.mutate({ ids, edit }, {
      onSuccess: ({ updated }) => {
        const gone = ids.length - updated;
        props.onDone(gone > 0 ? `Updated ${updated} of ${ids.length} (${was(gone)} already gone)` : `Updated ${updated}`);
        props.onClose();
      },
      onError: (e) => setError(e.message),
    });
  };

  return (
    <Sheet title={`Edit ${n} transactions`} open={props.ids !== null} onClose={props.onClose} busy={save.isPending}>
      <form className="flex flex-col gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Statement text</span>
          <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Leave unchanged" className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as "" | TransactionType)} className={field}>
            <option value="">Leave unchanged</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Source</span>
          <input list="bulk-sources" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Leave unchanged" className={field} />
          <datalist id="bulk-sources">{props.lookups?.sources.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <CategorySelect value={category} onChange={setCategory} categories={props.lookups?.categories ?? []} allowKeep />
        {error && <p role="alert" className="text-expense">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={!changed || save.isPending}
            className="rounded-md bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
            {save.isPending ? `Saving ${n}…` : "Save"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
```

`Editing.tsx`: `const [bulkIds, setBulkIds] = useState<number[] | null>(null);` wire `onEdit={() => setBulkIds(props.selectedIds)}`; render `<BulkEditSheet ids={bulkIds} lookups={props.lookups} onClose={() => setBulkIds(null)} onDone={(message) => { notify({ message }); props.onClearSelection(); }} />`.

- [ ] **Step 4: Run tests, typecheck, build**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Edit many transactions at once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 10: Docs, full verification, browser check

**Files:**
- Modify: `docs/WEB_PORT_PLAN.md` (under `#### Transactions`, the "Edit PR" list)
- Modify: `CLAUDE.md` only if it documents API routes (it does not today; leave it)

- [ ] **Step 1: Update the plan doc**

In `docs/WEB_PORT_PLAN.md`, rename "Edit PR:" to "Edit PR A (row actions) and PR B (merchant editor, budget type):". Strike through, with `~~…~~ Done:` as elsewhere, the bullets for edit one, bulk edit, tag selected/filtered, select/delete/Undo and the bulk delete screen, followed by one paragraph: the five routes, the Origin check, the per-transaction category override (new, not in the TUI), Undo, confirmation above 20. Leave "Edit merchant" and "Cycle a category's budget type" as they are, marked "(PR B)".

- [ ] **Step 2: Full test runs**

```bash
cd worker && npx vitest run && npm run typecheck
cd ../frontend && npx vitest run && npx tsc -b && npm run build
cd ../frontend && npx -y node@22 node_modules/vitest/vitest.mjs run
```
Expected: all PASS. (The worker suite under `node@22` fails locally only because `better-sqlite3` is built for the local Node; CI rebuilds it. Do not count that as a failure.)

- [ ] **Step 3: Browser check (controller, local only)**

The owner usually runs `make dev` on `:8787`; use it if it is up, otherwise start one. With Playwright (`uv run --with playwright python <script>`), against a **throwaway copy** of the local database or rows you create and then delete — never leave test edits in the owner's data:
- 1440 px and 390 px: select two rows, Tag with a new tag, Untag it, Undo a delete, edit one row's category override and clear it. Screenshot the action bar, each sheet and the toast at both widths.
- Check: no horizontal overflow at 390 px; the phone action bar does not hide the last row; a selected row is visibly different from the stripes; the Summary's category total changes after an override and returns after clearing it.
- With the Vite dev server (`cd frontend && npm run dev`, proxying to `:8787`), confirm a write succeeds (the local-origin allowance).

- [ ] **Step 4: Privacy scan**

Run: `jj diff -r 'main..@' --git | grep -E '^\+' | grep -niE '@gmail|/Users/|pallotron' || echo clean` — expected `clean`. Also grep the diff for any bank or merchant names seen in the owner's data during the browser check.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Record the Transactions row actions in the port plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
