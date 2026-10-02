# Transactions (browse) and Summary drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Transactions screen (filters, phone and desktop) that the Summary links into, whose list total equals the Summary number clicked.

**Architecture:** One shared, import-free contract file (`worker/src/api/transactions.ts`) holds the response types, the URL form of the filters and the drill-down mapping; the Worker parses that URL into the existing `TransactionFilter` and runs `listTransactions`, now with `sources[]` and `excludeHidden`; the frontend builds links and API paths with the same functions. A worker test drives every Summary number through `drillDown` → URL → route parser → `listTransactions` and requires equality.

**Tech Stack:** Cloudflare Worker, Hono, Zod 4, Drizzle over D1 / better-sqlite3 in tests, Vitest 5; React 19, React Router 7 (import from `"react-router"`), TanStack Query 5, Tailwind 4, Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-01-transactions-browse-design.md`

## Global Constraints

- Money is integer cents everywhere. Never multiply a float by 100 in new code (`parseAmountFilter` is existing, Python-matching code; reuse it, don't copy it).
- `env.DB` is touched only in `createDb`; query code takes a `Db`.
- Every route sits behind `getUser`; `/api/*` responses are `Cache-Control: no-store` (already done by middleware — don't add per-route headers).
- `worker/src/api/*.ts` files have **no imports** (the frontend compiles them directly).
- Frontend imports React Router from `"react-router"`, never `"react-router-dom"`.
- Component test files start with `/** @vitest-environment jsdom */`.
- Don't format dates or compact money with `Intl`/`toLocaleDateString` in new code: ICU differs between Node 22 (CI) and Node 24/browsers. Build date labels from fixed arrays.
- In `worker/`, never `npm install <pkg>`. No new dependencies are needed in either package.
- No real names, employer names, emails or personal paths in code, fixtures or docs. Fixtures use `Bank A`, `Card`, `Tesco`-style synthetic data.
- VCS is jj. One jj change per task: `jj new -m "<message>"` before starting, and commit message bodies end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- Run worker tests with `cd worker && npx vitest run`, frontend with `cd frontend && npx vitest run`; typecheck with `cd worker && npx tsc --noEmit` and `cd frontend && npx tsc -b`.

## Review Focus

1. **A category or merchant name containing a quote, comma, `&`, `#` or non-ASCII** (e.g. `Café "Bar" & Co`): the drill-down link must round-trip through the URL and still exact-match. Pinned in Task 1 (round-trip test) and Task 4 (fixture row with such a merchant).
2. **Summary with sources = none (`[]`)**: drill-down must carry an empty `sources` and list nothing, not everything. Pinned in Task 1 and Task 2.
3. **Opening `/transactions` on the 1st of a month before any import** (current month empty): must show the previous month, and with no data at all, an empty state, not a spinner forever. Pinned in Task 5 and Task 8.
4. **Typing quickly in a text filter**: one URL update after the pause, history not flooded (`replace`), and an outside URL change (back button) updates the box. Pinned in Task 6.
5. **Hidden-tag mismatch**: drilling from a Summary that hides tags must give the same total as the Summary; drilling when nothing is excluded must not show the chip. Pinned in Task 4 and Task 9.

## File Structure

Worker:
- Create `worker/src/api/transactions.ts` — contract: `TransactionRow`, `TransactionsResponse`, `LookupsResponse`, `TransactionsQuery`, `DrillTarget`, `quote`, `monthRange`, `drillDown`, `toTransactionsSearch`.
- Modify `worker/src/queries/transactions.ts` — `TransactionRow` moves to the contract (re-exported); `listTransactions` gains `sources`/`excludeHidden` and income/expense totals; new `listLookups`.
- Modify `worker/src/domain/filters.ts` — two new optional fields on `TransactionFilter`.
- Create `worker/src/routes/transactions.ts` — `parseTransactionsQuery`, `transactionRoutes` (`/transactions`, `/lookups`).
- Modify `worker/src/app.ts` — mount the routes.
- Tests: `worker/src/__tests__/api/transactions.test.ts`, `worker/src/__tests__/queries/listTransactions.test.ts`, `worker/src/__tests__/app/transactionsRoute.test.ts`, `worker/src/__tests__/services/drillDown.test.ts`.

Frontend:
- Modify `frontend/src/lib/types.ts` — re-export the contract.
- Create `frontend/src/transactions/params.ts`, `defaultMonth.ts`, `queries.ts`, `TransactionFilters.tsx`, `SourcePills.tsx`, `TransactionTable.tsx`, `DayList.tsx`, `TransactionsPage.tsx`.
- Modify `frontend/src/App.tsx`, `frontend/src/TopBar.tsx`, `frontend/src/summary/BreakdownList.tsx`, `frontend/src/summary/MonthlyGrid.tsx`, `frontend/src/summary/SummaryPage.tsx`.
- Tests under `frontend/src/__tests__/transactions/` plus updates to existing Summary/TopBar tests.

Docs: `docs/WEB_PORT_PLAN.md` (Task 10).

---

### Task 1: Shared contract for transactions and drill-down

**Files:**
- Create: `worker/src/api/transactions.ts`
- Modify: `worker/src/queries/transactions.ts` (move `TransactionRow` out)
- Test: `worker/src/__tests__/api/transactions.test.ts`

**Interfaces:**
- Produces (exact names used by every later task):
  - `type TransactionType = "expense" | "income"`, `type BudgetKind = "essential" | "discretionary"`
  - `interface TransactionRow { id: number; date: string; merchant: string; merchantRaw: string; amountCents: number; type: TransactionType; category: string; budget: BudgetKind; tags: string; source: string }`
  - `interface TransactionsResponse { rows: TransactionRow[]; count: number; incomeCents: number; expensesCents: number }`
  - `interface LookupsResponse { categories: string[]; tags: string[]; sources: string[] }`
  - `interface TransactionsQuery { from?; to?; merchant?; category?; tags?; min?; max?: string; type?: TransactionType; budget?: BudgetKind; sources?: string[]; excludeHidden?: boolean }`
  - `interface DrillTarget { year: number; month: number | null; type: TransactionType; category?: string; merchant?: string; budget?: BudgetKind | null; sources?: string[]; excludeHidden: boolean }`
  - `quote(s: string): string`, `monthRange(year, month | null): { from: string; to: string }`, `drillDown(t: DrillTarget): TransactionsQuery`, `toTransactionsSearch(q: TransactionsQuery): URLSearchParams`

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/__tests__/api/transactions.test.ts
import { describe, expect, it } from "vitest";

import { drillDown, monthRange, quote, toTransactionsSearch } from "../../api/transactions";

describe("monthRange", () => {
  it("spans a whole month, leap February included", () => {
    expect(monthRange(2026, 9)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthRange(2024, 2)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange(2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("spans the year when there is no month", () => {
    expect(monthRange(2025, null)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
});

describe("drillDown", () => {
  it("asks for the exact category in the period, with type and budget", () => {
    expect(drillDown({ year: 2026, month: 3, type: "expense", category: "Groceries", budget: "essential", excludeHidden: true }))
      .toEqual({ from: "2026-03-01", to: "2026-03-31", category: '"Groceries"', type: "expense", budget: "essential", excludeHidden: true });
  });
  it("asks for the exact merchant and leaves out what is unset", () => {
    expect(drillDown({ year: 2026, month: null, type: "income", merchant: "Employer", excludeHidden: false }))
      .toEqual({ from: "2026-01-01", to: "2026-12-31", merchant: '"Employer"', type: "income" });
  });
  it("carries an empty source list, which means none", () => {
    expect(drillDown({ year: 2026, month: null, type: "expense", sources: [], excludeHidden: false }).sources).toEqual([]);
  });
});

describe("toTransactionsSearch", () => {
  it("round-trips awkward names through a URL", () => {
    const name = 'Café "Bar" & Co, #1';
    const sp = toTransactionsSearch({ merchant: quote(name), sources: ["Bank A", "Card, joint"] });
    const back = new URLSearchParams(sp.toString());
    expect(back.get("merchant")).toBe(`"${name}"`);
    expect(back.getAll("sources")).toEqual(["Bank A", "Card, joint"]);
  });
  it("writes one empty sources value for none, nothing for all, and skips empty text", () => {
    expect(toTransactionsSearch({ sources: [] }).getAll("sources")).toEqual([""]);
    expect(toTransactionsSearch({ merchant: "" }).toString()).toBe("");
    expect(toTransactionsSearch({ excludeHidden: true }).get("excludeHidden")).toBe("1");
    expect(toTransactionsSearch({ excludeHidden: false }).has("excludeHidden")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/__tests__/api/transactions.test.ts`
Expected: FAIL — cannot resolve `../../api/transactions`.

- [ ] **Step 3: Write the contract**

```ts
// worker/src/api/transactions.ts
/**
 * The Transactions API's JSON and the URL form of its filters, shared with the
 * frontend, which imports this file directly. Keep it free of imports.
 *
 * drillDown is the one place a Summary number becomes a Transactions filter,
 * so the Summary's links and the test that holds their totals to the Summary
 * cannot drift apart.
 */

export type TransactionType = "expense" | "income";
export type BudgetKind = "essential" | "discretionary";

export interface TransactionRow {
  id: number;
  /** YYYY-MM-DD. */
  date: string;
  merchant: string;
  merchantRaw: string;
  amountCents: number;
  type: TransactionType;
  category: string;
  /** Anything not essential is discretionary, as get_category_spending_type. */
  budget: BudgetKind;
  /** Sorted, comma-separated. */
  tags: string;
  source: string;
}

export interface TransactionsResponse {
  /** Newest first. */
  rows: TransactionRow[];
  count: number;
  incomeCents: number;
  expensesCents: number;
}

export interface LookupsResponse {
  categories: string[];
  tags: string[];
  sources: string[];
}

/** The filters as they travel in a URL. Text exactly as typed; "quoted" is exact. */
export interface TransactionsQuery {
  from?: string;
  to?: string;
  merchant?: string;
  category?: string;
  tags?: string;
  /** Euros as typed, e.g. "12.5". */
  min?: string;
  max?: string;
  type?: TransactionType;
  budget?: BudgetKind;
  /** Undefined: every source. []: none. */
  sources?: string[];
  /** Hide the rows the Summary hides (tag exclusion patterns). */
  excludeHidden?: boolean;
}

/** An exact-match filter value: the filter compares the whole field. */
export function quote(value: string): string {
  return `"${value}"`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function monthRange(year: number, month: number | null): { from: string; to: string } {
  if (month === null) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/** A Summary number someone clicked. Category or merchant unset: every row of the type. */
export interface DrillTarget {
  year: number;
  month: number | null;
  type: TransactionType;
  category?: string;
  merchant?: string;
  /** Expense categories only; merchants leave it unset (see the spec). */
  budget?: BudgetKind | null;
  sources?: string[];
  excludeHidden: boolean;
}

export function drillDown(t: DrillTarget): TransactionsQuery {
  const q: TransactionsQuery = { ...monthRange(t.year, t.month), type: t.type };
  if (t.category !== undefined) q.category = quote(t.category);
  if (t.merchant !== undefined) q.merchant = quote(t.merchant);
  if (t.budget) q.budget = t.budget;
  if (t.sources !== undefined) q.sources = t.sources;
  if (t.excludeHidden) q.excludeHidden = true;
  return q;
}

const TEXT_KEYS = ["from", "to", "merchant", "category", "tags", "min", "max", "type", "budget"] as const;

/** `sources` repeats, so a name may contain commas; one empty value means none. */
export function toTransactionsSearch(q: TransactionsQuery): URLSearchParams {
  const sp = new URLSearchParams();
  for (const key of TEXT_KEYS) {
    const value = q[key];
    if (value !== undefined && value !== "") sp.set(key, value);
  }
  if (q.sources !== undefined) {
    if (q.sources.length === 0) sp.append("sources", "");
    for (const s of q.sources) sp.append("sources", s);
  }
  if (q.excludeHidden) sp.set("excludeHidden", "1");
  return sp;
}
```

In `worker/src/queries/transactions.ts`, delete the local `TransactionRow` interface and replace it with:

```ts
import type { TransactionRow } from "../api/transactions";

export type { TransactionRow };
```

(keep the existing `TransactionList`; Task 2 extends it).

- [ ] **Step 4: Run tests and typecheck**

Run: `cd worker && npx vitest run src/__tests__/api/transactions.test.ts && npx tsc --noEmit && npx vitest run`
Expected: PASS, no type errors, whole worker suite still green.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Add the shared Transactions contract and drill-down mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 2: `listTransactions` with sources, hidden tags and split totals; `listLookups`

**Files:**
- Modify: `worker/src/domain/filters.ts` (interface only)
- Modify: `worker/src/queries/transactions.ts`
- Test: `worker/src/__tests__/queries/listTransactions.test.ts`

**Interfaces:**
- Consumes: `TransactionRow`, `LookupsResponse` from Task 1; `vectorStore()` from `src/__tests__/helpers/summaryStore.ts` (rows from vectors' `summary` section: sources `"Bank A"` and `"Card"`, merchant `"Bookshop"` exists).
- Produces:
  - `TransactionFilter` gains `sources?: string[]` and `excludeHidden?: boolean`.
  - `interface TransactionList { rows: TransactionRow[]; totalCents: number; incomeCents: number; expensesCents: number }`
  - `listLookups(db: Db): Promise<LookupsResponse>`

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/__tests__/queries/listTransactions.test.ts
import { describe, expect, it } from "vitest";

import { listLookups, listTransactions } from "../../queries/transactions";
import { vectorStore } from "../helpers/summaryStore";

function store() {
  const s = vectorStore();
  s.sqlite.exec(`
    INSERT INTO tags (id, name) VALUES (1, 'emergency'), (2, 'gift');
    INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency');
    INSERT INTO transaction_tags (transaction_id, tag_id)
      SELECT id, 1 FROM transactions WHERE merchant_raw = 'Bookshop';
  `);
  return s;
}

describe("listTransactions sources and hidden tags", () => {
  const { db, sqlite } = store();
  const count = (where: string) =>
    (sqlite.prepare(`SELECT COUNT(*) FROM v_live WHERE ${where}`).raw().get() as [number])[0];

  it("keeps only the chosen sources", async () => {
    const list = await listTransactions(db, { sources: ["Card"] });
    expect(list.rows.length).toBe(count(`source = 'Card'`));
    expect(list.rows.every((r) => r.source === "Card")).toBe(true);
  });

  it("lists nothing for an empty source list", async () => {
    expect((await listTransactions(db, { sources: [] })).rows).toEqual([]);
  });

  it("drops exactly the rows v_summary drops when hidden tags are excluded", async () => {
    const all = await listTransactions(db);
    const shown = await listTransactions(db, { excludeHidden: true });
    expect(shown.rows.length).toBe((sqlite.prepare(`SELECT COUNT(*) FROM v_summary`).raw().get() as [number])[0]);
    expect(shown.rows.some((r) => r.merchant === "Bookshop")).toBe(false);
    expect(all.rows.some((r) => r.merchant === "Bookshop")).toBe(true);
  });

  it("totals income and expenses separately", async () => {
    const list = await listTransactions(db);
    const sum = (t: string) => list.rows.filter((r) => r.type === t).reduce((a, r) => a + r.amountCents, 0);
    expect(list.incomeCents).toBe(sum("income"));
    expect(list.expensesCents).toBe(sum("expense"));
    expect(list.totalCents).toBe(list.incomeCents + list.expensesCents);
  });
});

describe("listLookups", () => {
  it("lists live categories, tags in use and sources, sorted", async () => {
    const { db, sqlite } = store();
    const l = await listLookups(db);
    expect(l.sources).toEqual(["Bank A", "Card"]);
    expect(l.tags).toEqual(["emergency"]); // 'gift' is on no transaction
    expect(l.categories).toEqual([...l.categories].sort());
    expect(l.categories).toContain("Groceries");
    sqlite.exec(`UPDATE transactions SET deleted_at = 1 WHERE source = 'Card'`);
    expect((await listLookups(db)).sources).toEqual(["Bank A"]);
  });
});
```

If `Groceries` is not a category in the vector rows, replace it with any category the `summary.rows` section of `worker/src/__tests__/fixtures/python_vectors.json` contains (check with `grep -o '"Groceries"' worker/src/__tests__/fixtures/python_vectors.json | head -1`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/__tests__/queries/listTransactions.test.ts`
Expected: FAIL — `listLookups` is not exported; `sources` ignored.

- [ ] **Step 3: Implement**

In `worker/src/domain/filters.ts`, add to `TransactionFilter` (after `budget`):

```ts
  /**
   * Applied in SQL by listTransactions, not by applyFilters: the Summary's
   * rules, which are not the TUI screen's. Undefined is every source; [] none.
   */
  sources?: string[];
  /** Hide the rows v_summary hides (tag exclusion patterns). */
  excludeHidden?: boolean;
```

In `worker/src/queries/transactions.ts`:

```ts
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import type { LookupsResponse, TransactionRow } from "../api/transactions";
import { tags, transactionTags, vExcludedIds, vLive, vTransactions } from "../db/schema";
// ...existing imports of Db, applyFilters, TransactionFilter stay

export interface TransactionList {
  rows: TransactionRow[];
  /** Sum of the listed rows, as the screen's total line showed. */
  totalCents: number;
  incomeCents: number;
  expensesCents: number;
}
```

Inside `listTransactions`, after the existing `where.push(...)` lines:

```ts
  if (filter.sources) where.push(filter.sources.length ? inArray(v.source, filter.sources) : sql`0`);
  // The same rule as v_summary, so a drill-down lists what the Summary counted.
  if (filter.excludeHidden) where.push(notInArray(v.id, db.select({ id: vExcludedIds.id }).from(vExcludedIds)));
```

and replace the return with:

```ts
  const filtered = applyFilters(rows, filter);
  const sumOf = (type: string) => filtered.reduce((sum, row) => sum + (row.type === type ? row.amountCents : 0), 0);
  const incomeCents = sumOf("income");
  const expensesCents = sumOf("expense");
  return { rows: filtered, totalCents: incomeCents + expensesCents, incomeCents, expensesCents };
```

Add:

```ts
/** Values the filter boxes suggest: what live (not deleted) rows carry. */
export async function listLookups(db: Db): Promise<LookupsResponse> {
  const categories = await db.selectDistinct({ name: vLive.category }).from(vLive).orderBy(asc(vLive.category));
  const sources = await db.selectDistinct({ name: vLive.source }).from(vLive).orderBy(asc(vLive.source));
  const tagNames = await db.selectDistinct({ name: tags.name }).from(tags)
    .innerJoin(transactionTags, eq(transactionTags.tagId, tags.id))
    .innerJoin(vLive, eq(vLive.id, transactionTags.transactionId))
    .orderBy(asc(tags.name));
  return {
    categories: categories.map((r) => r.name),
    tags: tagNames.map((r) => r.name),
    sources: sources.map((r) => r.name),
  };
}
```

`totalCents` keeps its meaning (every listed row summed), so existing callers are unchanged.

- [ ] **Step 4: Run tests**

Run: `cd worker && npx vitest run && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Mutation check**

Temporarily change `notInArray` to `inArray` in the `excludeHidden` line; run the new test file; confirm "drops exactly the rows v_summary drops" FAILS; revert.

- [ ] **Step 6: Commit**

```bash
jj desc -m "Filter the transaction list by sources and hidden tags, and total income and expenses apart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 3: `/api/transactions` and `/api/lookups` routes

**Files:**
- Create: `worker/src/routes/transactions.ts`
- Modify: `worker/src/app.ts`
- Test: `worker/src/__tests__/app/transactionsRoute.test.ts`

**Interfaces:**
- Consumes: `listTransactions`, `listLookups` (Task 2); `TransactionsResponse` (Task 1); `parseAmountFilter` from `domain/filters.ts`.
- Produces: `parseTransactionsQuery(url: URL): { ok: true; filter: TransactionFilter } | { ok: false; error: string }`; `transactionRoutes<B extends AppBindings>()` mounted at `/api`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/__tests__/app/transactionsRoute.test.ts
import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import type { LookupsResponse, TransactionsResponse } from "../../api/transactions";
import { parseTransactionsQuery } from "../../routes/transactions";
import { vectorStore } from "../helpers/summaryStore";

const { db } = vectorStore();
const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};
const get = (path: string) => createApp(() => db).request(`http://localhost${path}`, {}, env);

describe("parseTransactionsQuery", () => {
  const parse = (qs: string) => parseTransactionsQuery(new URL(`http://x/api/transactions?${qs}`));

  it("maps every parameter onto the filter", () => {
    expect(parse("from=2026-01-01&to=2026-01-31&merchant=tes&category=%22Groceries%22&tags=gift&min=1.5&max=20&type=expense&budget=essential&sources=Card&sources=Bank+A&excludeHidden=1"))
      .toEqual({ ok: true, filter: {
        dateFrom: "2026-01-01", dateTo: "2026-01-31", merchant: "tes", category: '"Groceries"', tags: "gift",
        amountMinCents: 150, amountMaxCents: 2000, type: "expense", budget: "essential",
        sources: ["Card", "Bank A"], excludeHidden: true,
      } });
  });

  it("treats empty values as unset, except sources where one empty value means none", () => {
    expect(parse("merchant=&from=&sources=")).toEqual({ ok: true, filter: { sources: [], excludeHidden: false } });
    expect(parse("")).toEqual({ ok: true, filter: { excludeHidden: false } });
  });

  it.each([
    ["from=2026-1-1", "from must be YYYY-MM-DD"],
    ["to=yesterday", "to must be YYYY-MM-DD"],
    ["min=ten", "min must be a number"],
    ["max=1e3", "max must be a number"],
    ["type=refund", "type must be expense or income"],
    ["budget=fun", "budget must be essential or discretionary"],
    ["excludeHidden=yes", "excludeHidden must be 0 or 1"],
  ])("rejects %s", (qs, error) => {
    expect(parse(qs)).toEqual({ ok: false, error });
  });
});

describe("GET /api/transactions", () => {
  it("lists rows with their count and totals", async () => {
    const res = await get("/api/transactions?type=expense&sources=Card");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json() as TransactionsResponse;
    expect(body.count).toBe(body.rows.length);
    expect(body.count).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.source === "Card" && r.type === "expense")).toBe(true);
    expect(body.incomeCents).toBe(0);
    expect(body.expensesCents).toBe(body.rows.reduce((a, r) => a + r.amountCents, 0));
  });

  it("answers a bad parameter with 400 and the message", async () => {
    const res = await get("/api/transactions?min=abc");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "min must be a number" });
  });
});

describe("GET /api/lookups", () => {
  it("returns the lookups", async () => {
    const body = await (await get("/api/lookups")).json() as LookupsResponse;
    expect(body.sources).toEqual(["Bank A", "Card"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/__tests__/app/transactionsRoute.test.ts`
Expected: FAIL — module `../../routes/transactions` not found.

- [ ] **Step 3: Implement**

```ts
// worker/src/routes/transactions.ts
/**
 * /api/transactions and /api/lookups. Parse, call the query, serialise.
 * The URL form is api/transactions.ts's toTransactionsSearch.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import type { TransactionsResponse } from "../api/transactions";
import { parseAmountFilter, type TransactionFilter } from "../domain/filters";
import { listLookups, listTransactions } from "../queries/transactions";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

const Params = z.object({
  from: z.string().regex(ISO_DATE, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(ISO_DATE, "to must be YYYY-MM-DD").optional(),
  merchant: z.string().optional(),
  category: z.string().optional(),
  tags: z.string().optional(),
  min: z.string().regex(NUMBER, "min must be a number").optional(),
  max: z.string().regex(NUMBER, "max must be a number").optional(),
  type: z.enum(["expense", "income"], "type must be expense or income").optional(),
  budget: z.enum(["essential", "discretionary"], "budget must be essential or discretionary").optional(),
  excludeHidden: z.enum(["0", "1"], "excludeHidden must be 0 or 1").optional(),
});

const SINGLE_KEYS = Object.keys(Params.shape);

export function parseTransactionsQuery(url: URL):
  { ok: true; filter: TransactionFilter } | { ok: false; error: string } {
  // An empty box arrives as an empty value; it means "no filter".
  const single = Object.fromEntries(SINGLE_KEYS.flatMap((k) => {
    const v = url.searchParams.get(k);
    return v === null || v === "" ? [] : [[k, v]];
  }));
  const parsed = Params.safeParse(single);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const p = parsed.data;
  const raw = url.searchParams.getAll("sources");
  const filter: TransactionFilter = {
    ...(p.from && { dateFrom: p.from }),
    ...(p.to && { dateTo: p.to }),
    ...(p.merchant && { merchant: p.merchant }),
    ...(p.category && { category: p.category }),
    ...(p.tags && { tags: p.tags }),
    ...(p.min && { amountMinCents: parseAmountFilter(p.min) }),
    ...(p.max && { amountMaxCents: parseAmountFilter(p.max) }),
    ...(p.type && { type: p.type }),
    ...(p.budget && { budget: p.budget }),
    ...(raw.length > 0 && { sources: raw.filter((s) => s !== "") }),
    excludeHidden: p.excludeHidden === "1",
  };
  return { ok: true, filter };
}

export function transactionRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/transactions", async (c) => {
    const parsed = parseTransactionsQuery(new URL(c.req.url));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const list = await listTransactions(c.get("db"), parsed.filter);
    const body: TransactionsResponse = {
      rows: list.rows, count: list.rows.length, incomeCents: list.incomeCents, expensesCents: list.expensesCents,
    };
    return c.json(body);
  });

  routes.get("/lookups", async (c) => c.json(await listLookups(c.get("db"))));

  return routes;
}
```

In `worker/src/app.ts`, import `transactionRoutes` and add, right after `app.route("/api/summary", summaryRoutes<B>());`:

```ts
  app.route("/api", transactionRoutes<B>());
```

- [ ] **Step 4: Run tests**

Run: `cd worker && npx vitest run && npx tsc --noEmit`
Expected: PASS. (If the `toEqual` in "maps every parameter" fails only on key order or an explicit `undefined`, fix the implementation, not the test: unset keys must be absent.)

- [ ] **Step 5: Commit**

```bash
jj desc -m "Serve the transaction list and filter lookups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 4: Every Summary number drills down to a list with the same total

**Files:**
- Test: `worker/src/__tests__/services/drillDown.test.ts`

**Interfaces:**
- Consumes: `buildSummary` (`services/summary.ts`, query `{ year, month, sources?, includeHidden }`), `drillDown`, `toTransactionsSearch` (Task 1), `parseTransactionsQuery` (Task 3), `listTransactions` (Task 2), `vectorStore`, `inMemoryCopy`.

- [ ] **Step 1: Write the test**

```ts
// worker/src/__tests__/services/drillDown.test.ts
/**
 * The promise behind every Summary link: the list it opens totals the number
 * that was clicked. Each number goes the whole way a click goes — drillDown,
 * the URL, the route's parser, listTransactions.
 *
 * Runs on the vector rows; with CROSSCHECK_DB, also on real data.
 */

import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drillDown, toTransactionsSearch, type DrillTarget } from "../../api/transactions";
import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { listTransactions } from "../../queries/transactions";
import { parseTransactionsQuery } from "../../routes/transactions";
import { buildSummary, summaryPeriods } from "../../services/summary";
import { inMemoryCopy } from "../helpers/db";
import { vectorStore } from "../helpers/summaryStore";

async function listedCents(db: Db, target: DrillTarget): Promise<number> {
  const url = new URL(`http://x/api/transactions?${toTransactionsSearch(drillDown(target))}`);
  const parsed = parseTransactionsQuery(url);
  if (!parsed.ok) throw new Error(parsed.error);
  const list = await listTransactions(db, parsed.filter);
  return target.type === "income" ? list.incomeCents : list.expensesCents;
}

/** Every clickable number in one Summary view, as [label, target, expected cents]. */
async function clickable(db: Db, year: number, month: number | null, sources: string[] | undefined, includeHidden: boolean) {
  const s = await buildSummary(db, { year, month, sources, includeHidden });
  const base = { year, month, sources, excludeHidden: !includeHidden };
  const out: [string, DrillTarget, number][] = [];
  for (const c of s.expenseCategories) out.push([`expense category ${c.category}`, { ...base, type: "expense", category: c.category, budget: c.spendingType }, c.amountCents]);
  for (const c of s.incomeCategories) out.push([`income category ${c.category}`, { ...base, type: "income", category: c.category }, c.amountCents]);
  for (const m of s.topMerchants) out.push([`expense merchant ${m.merchant}`, { ...base, type: "expense", merchant: m.merchant }, m.amountCents]);
  for (const m of s.topIncome) out.push([`income merchant ${m.merchant}`, { ...base, type: "income", merchant: m.merchant }, m.amountCents]);
  if (s.monthly) {
    for (const type of ["expense", "income"] as const) {
      const grid = s.monthly[type];
      const budgetOf = (cat: string) => type === "expense" ? s.expenseCategories.find((c) => c.category === cat)?.spendingType ?? null : null;
      grid.total.months.forEach((cell, i) =>
        out.push([`${type} total ${i + 1}`, { ...base, month: i + 1, type }, cell.amountCents]));
      for (const row of grid.rows) {
        out.push([`${type} ${row.category} year`, { ...base, month: null, type, category: row.category, budget: budgetOf(row.category) }, row.totalCents]);
        row.months.forEach((cell, i) =>
          out.push([`${type} ${row.category} ${i + 1}`, { ...base, month: i + 1, type, category: row.category, budget: budgetOf(row.category) }, cell.amountCents]));
      }
    }
  }
  return out;
}

async function expectAllEqual(db: Db, year: number, month: number | null, sources: string[] | undefined, includeHidden: boolean) {
  const targets = await clickable(db, year, month, sources, includeHidden);
  expect(targets.length).toBeGreaterThan(0);
  const mismatches: string[] = [];
  for (const [label, target, expected] of targets) {
    const got = await listedCents(db, target);
    if (got !== expected) mismatches.push(`${label}: summary ${expected}, list ${got}`);
  }
  expect(mismatches).toEqual([]);
}

describe("drill-down totals equal the Summary (vector rows)", () => {
  const { db, sqlite } = vectorStore();
  sqlite.exec(`
    INSERT INTO tags (id, name) VALUES (1, 'emergency'), (2, 'trip:rome');
    INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency'), ('trip:*');
    INSERT INTO transaction_tags (transaction_id, tag_id)
      SELECT id, 1 FROM transactions WHERE merchant_raw = 'Bookshop';
    INSERT INTO transaction_tags (transaction_id, tag_id)
      SELECT id, 2 FROM transactions WHERE id = (SELECT MIN(id) FROM transactions WHERE type = 'income');
    INSERT INTO merchants (canonical_name) VALUES ('Café "Bar" & Co, #1');
    INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, type, source, occurrence)
      SELECT unixepoch('2026-02-14'), 'CAFE BAR', id, 1234, 'expense', 'Card', 0 FROM merchants WHERE canonical_name = 'Café "Bar" & Co, #1';
  `);

  for (const includeHidden of [false, true]) {
    for (const sources of [undefined, ["Card"], []] as (string[] | undefined)[]) {
      it(`year views, includeHidden=${includeHidden}, sources=${JSON.stringify(sources)}`, async () => {
        for (const { year } of (await summaryPeriods(db)).years) await expectAllEqual(db, year, null, sources, includeHidden);
      });
      it(`month views, includeHidden=${includeHidden}, sources=${JSON.stringify(sources)}`, async () => {
        for (const { year, months } of (await summaryPeriods(db)).years) {
          for (const month of months) await expectAllEqual(db, year, month, sources, includeHidden);
        }
      });
    }
  }
});

describe.runIf(process.env.CROSSCHECK_DB)("drill-down totals equal the Summary (CROSSCHECK_DB)", () => {
  let sqlite: Database.Database;
  let db: Db;
  beforeAll(() => {
    sqlite = inMemoryCopy(process.env.CROSSCHECK_DB!);
    db = drizzle(sqlite, { schema }) as unknown as Db;
  });
  afterAll(() => sqlite.close());

  it("every year view, both hidden modes", async () => {
    for (const { year } of (await summaryPeriods(db)).years) {
      await expectAllEqual(db, year, null, undefined, false);
      await expectAllEqual(db, year, null, undefined, true);
    }
  }, 600_000);

  it("every month view of the newest year", async () => {
    const [newest] = (await summaryPeriods(db)).years;
    for (const month of newest.months) await expectAllEqual(db, newest.year, month, undefined, false);
  }, 600_000);
});
```

Check the `INSERT INTO transactions` column list against `worker/src/db/schema.ts` (`transactions` table) and `summaryStore` (which inserts `date` as `epochDay(date)`): if `date` is stored as epoch seconds of midnight UTC, `unixepoch('2026-02-14')` matches; otherwise use the same expression `summaryStore` produces. With `sources=[]` every Summary list is empty, so `targets` may be zero — in that case assert `targets.length === 0` is acceptable: change the `toBeGreaterThan(0)` line to run only when `sources?.length !== 0`.

- [ ] **Step 2: Run it**

Run: `cd worker && npx vitest run src/__tests__/services/drillDown.test.ts`
Expected: PASS. If a mismatch appears, it is a real disagreement between the Summary and the list: find which side is wrong (the Summary is held to the Python, so it is the reference) and fix `drillDown`/`listTransactions`, never the expected value. Record the cause in the commit message.

- [ ] **Step 3: Mutation checks**

(a) In `drillDown`, temporarily drop the `excludeHidden` line → test must FAIL for `includeHidden=false`. (b) Temporarily change `quote` to return the value unquoted → must FAIL (substring matches pull in more rows). Revert both.

- [ ] **Step 4: Commit**

```bash
jj desc -m "Hold every Summary drill-down total to the Summary's number

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 5: Frontend data layer — URL params, default month, queries

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/transactions/params.ts`, `frontend/src/transactions/defaultMonth.ts`, `frontend/src/transactions/queries.ts`
- Test: `frontend/src/__tests__/transactions/params.test.ts`, `frontend/src/__tests__/transactions/defaultMonth.test.ts`

**Interfaces:**
- Consumes: Task 1 contract via `lib/types`; `PeriodsResponse`; `getJson`.
- Produces:
  - `SORT_KEYS`, `type SortKey`, `interface TxParams extends TransactionsQuery { sort: SortKey; dir: "asc" | "desc" }`
  - `parseTxParams(sp: URLSearchParams): TxParams`, `toTxSearch(p: TxParams): URLSearchParams`, `transactionsApiPath(p: TransactionsQuery): string`
  - `wholeMonth(p): { year: number; month: number } | null`, `shiftMonth(p: TxParams, delta: number): TxParams`, `activeFilterCount(p): number`
  - `defaultMonth(periods: PeriodsResponse, today: Date): { year: number; month: number } | null`
  - `useTransactions(p: TransactionsQuery, enabled: boolean)`, `useLookups()`

- [ ] **Step 1: Re-export the contract**

Append to `frontend/src/lib/types.ts`:

```ts
export type {
  BudgetKind, DrillTarget, LookupsResponse, TransactionRow, TransactionsQuery, TransactionsResponse, TransactionType,
} from "../../../worker/src/api/transactions";
export { drillDown, monthRange, quote, toTransactionsSearch } from "../../../worker/src/api/transactions";
```

- [ ] **Step 2: Write the failing tests**

```ts
// frontend/src/__tests__/transactions/params.test.ts
import { describe, expect, it } from "vitest";

import { activeFilterCount, parseTxParams, shiftMonth, toTxSearch, transactionsApiPath, wholeMonth } from "../../transactions/params";

const parse = (qs: string) => parseTxParams(new URLSearchParams(qs));

describe("parseTxParams", () => {
  it("reads every filter and the sort", () => {
    expect(parse('from=2026-09-01&to=2026-09-30&merchant=tes&category="Groceries"&tags=gift&min=1&max=2.5&type=income&budget=essential&sources=Card&sources=Bank%20A&excludeHidden=1&sort=amount&dir=asc'))
      .toEqual({ from: "2026-09-01", to: "2026-09-30", merchant: "tes", category: '"Groceries"', tags: "gift", min: "1", max: "2.5",
        type: "income", budget: "essential", sources: ["Card", "Bank A"], excludeHidden: true, sort: "amount", dir: "asc" });
  });
  it("drops malformed values instead of failing", () => {
    expect(parse("from=soon&min=ten&type=refund&budget=x&sort=colour&dir=up"))
      .toEqual({ excludeHidden: false, sort: "date", dir: "desc" });
  });
  it("keeps an explicit empty source list", () => {
    expect(parse("sources=").sources).toEqual([]);
  });
});

describe("toTxSearch / transactionsApiPath", () => {
  it("round-trips, writing sort only when not the default", () => {
    const p = parse('from=2026-09-01&category="A & B"&sources=&sort=merchant&dir=asc');
    expect(parseTxParams(toTxSearch(p))).toEqual(p);
    expect(toTxSearch(parse("from=2026-09-01")).toString()).toBe("from=2026-09-01");
  });
  it("leaves the sort out of the API path", () => {
    expect(transactionsApiPath(parse("type=income&sort=amount"))).toBe("/api/transactions?type=income");
  });
});

describe("wholeMonth / shiftMonth", () => {
  it("recognises a calendar month", () => {
    expect(wholeMonth(parse("from=2026-02-01&to=2026-02-28"))).toEqual({ year: 2026, month: 2 });
    expect(wholeMonth(parse("from=2026-02-01&to=2026-02-27"))).toBeNull();
    expect(wholeMonth(parse("from=2026-01-01&to=2026-12-31"))).toBeNull();
  });
  it("steps across a year boundary and keeps other filters", () => {
    const next = shiftMonth(parse("from=2025-12-01&to=2025-12-31&merchant=x"), 1);
    expect(next).toMatchObject({ from: "2026-01-01", to: "2026-01-31", merchant: "x" });
    expect(shiftMonth(parse("from=2026-01-01&to=2026-01-31"), -1)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("activeFilterCount", () => {
  it("counts filters other than the dates", () => {
    expect(activeFilterCount(parse("from=2026-01-01&to=2026-01-31"))).toBe(0);
    expect(activeFilterCount(parse("merchant=a&min=1&max=2&sources=Card&excludeHidden=1&type=expense"))).toBe(6);
  });
});
```

```ts
// frontend/src/__tests__/transactions/defaultMonth.test.ts
import { describe, expect, it } from "vitest";

import { defaultMonth } from "../../transactions/defaultMonth";

const periods = (years: { year: number; months: number[] }[]) => ({ years, sources: [] });
const on = (iso: string) => new Date(`${iso}T12:00:00`);

describe("defaultMonth", () => {
  it("is the current month when it has transactions", () => {
    expect(defaultMonth(periods([{ year: 2026, months: [8, 9] }]), on("2026-09-15"))).toEqual({ year: 2026, month: 9 });
  });
  it("is the previous month when the current one is empty, across a year boundary", () => {
    expect(defaultMonth(periods([{ year: 2026, months: [8, 9] }]), on("2026-10-01"))).toEqual({ year: 2026, month: 9 });
    expect(defaultMonth(periods([{ year: 2025, months: [11, 12] }]), on("2026-01-03"))).toEqual({ year: 2025, month: 12 });
  });
  it("falls back to the newest month with data", () => {
    expect(defaultMonth(periods([{ year: 2026, months: [3, 5] }, { year: 2025, months: [1] }]), on("2026-09-15")))
      .toEqual({ year: 2026, month: 5 });
  });
  it("is null with no data", () => {
    expect(defaultMonth(periods([]), on("2026-09-15"))).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/transactions`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

```ts
// frontend/src/transactions/params.ts
/**
 * The Transactions screen's state lives in the URL, so a Summary link, reload
 * and back/forward all show the same list. A hand-edited value that makes no
 * sense is dropped rather than failing, as on the Summary.
 */
import { monthRange, toTransactionsSearch, type TransactionsQuery } from "../lib/types";

export const SORT_KEYS = ["date", "merchant", "amount", "type", "source", "category", "budget", "tags"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface TxParams extends TransactionsQuery {
  sort: SortKey;
  dir: "asc" | "desc";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

export function parseTxParams(sp: URLSearchParams): TxParams {
  const p: TxParams = { excludeHidden: sp.get("excludeHidden") === "1", sort: "date", dir: "desc" };
  const text = (k: "merchant" | "category" | "tags") => { const v = sp.get(k); if (v) p[k] = v; };
  for (const k of ["from", "to"] as const) { const v = sp.get(k); if (v && ISO_DATE.test(v)) p[k] = v; }
  for (const k of ["min", "max"] as const) { const v = sp.get(k); if (v && NUMBER.test(v)) p[k] = v; }
  text("merchant"); text("category"); text("tags");
  const type = sp.get("type");
  if (type === "expense" || type === "income") p.type = type;
  const budget = sp.get("budget");
  if (budget === "essential" || budget === "discretionary") p.budget = budget;
  const raw = sp.getAll("sources");
  if (raw.length) p.sources = raw.filter((s) => s !== "");
  const sort = sp.get("sort");
  if ((SORT_KEYS as readonly string[]).includes(sort ?? "")) p.sort = sort as SortKey;
  if (sp.get("dir") === "asc") p.dir = "asc";
  return p;
}

export function toTxSearch(p: TxParams): URLSearchParams {
  const sp = toTransactionsSearch(p);
  if (p.sort !== "date") sp.set("sort", p.sort);
  if (p.dir !== "desc") sp.set("dir", p.dir);
  return sp;
}

/** The API ignores sorting: rows always come newest first. */
export function transactionsApiPath(p: TransactionsQuery): string {
  const { sort: _s, dir: _d, ...query } = p as TxParams;
  return `/api/transactions?${toTransactionsSearch(query)}`;
}

export function wholeMonth(p: TransactionsQuery): { year: number; month: number } | null {
  const m = p.from?.match(/^(\d{4})-(\d{2})-01$/);
  if (!m || !p.to) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return monthRange(year, month).to === p.to ? { year, month } : null;
}

export function shiftMonth(p: TxParams, delta: number): TxParams {
  const at = wholeMonth(p);
  if (!at) return p;
  const index = at.year * 12 + (at.month - 1) + delta;
  return { ...p, ...monthRange(Math.floor(index / 12), (index % 12) + 1) };
}

/** Filters other than the date range: what the phone's "Filters (n)" counts. */
export function activeFilterCount(p: TransactionsQuery): number {
  return (["merchant", "category", "tags", "min", "max", "type", "budget"] as const).filter((k) => p[k] !== undefined).length
    + (p.sources !== undefined ? 1 : 0)
    + (p.excludeHidden ? 1 : 0);
}
```

```ts
// frontend/src/transactions/defaultMonth.ts
import type { PeriodsResponse } from "../lib/types";

/**
 * What Transactions shows when opened with no filters: this month, or last
 * month while this one is still empty, or failing both the newest month with
 * data. `today` is the browser's local date.
 */
export function defaultMonth(periods: PeriodsResponse, today: Date): { year: number; month: number } | null {
  const has = (year: number, month: number) => periods.years.find((y) => y.year === year)?.months.includes(month) ?? false;
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  if (has(year, month)) return { year, month };
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  if (has(prev.year, prev.month)) return prev;
  const newest = periods.years[0];
  if (!newest || newest.months.length === 0) return null;
  return { year: newest.year, month: newest.months[newest.months.length - 1] };
}
```

```ts
// frontend/src/transactions/queries.ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import type { LookupsResponse, TransactionsQuery, TransactionsResponse } from "../lib/types";
import { transactionsApiPath } from "./params";

/** Keeps the previous list on screen while the next one loads. */
export function useTransactions(p: TransactionsQuery, enabled: boolean) {
  const path = transactionsApiPath(p);
  return useQuery({
    queryKey: ["transactions", path],
    queryFn: () => getJson<TransactionsResponse>(path),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useLookups() {
  return useQuery({ queryKey: ["lookups"], queryFn: () => getJson<LookupsResponse>("/api/lookups"), staleTime: 5 * 60_000 });
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
jj desc -m "Add the Transactions URL state, default month and queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 6: Filter controls — desktop block, phone sheet and chips

**Files:**
- Create: `frontend/src/transactions/SourcePills.tsx`, `frontend/src/transactions/TransactionFilters.tsx`
- Test: `frontend/src/__tests__/transactions/TransactionFilters.test.tsx`

**Interfaces:**
- Consumes: `TxParams`, `activeFilterCount` (Task 5); `LookupsResponse`; `DESKTOP`, `useMediaQuery`; `formatCents`.
- Produces:
  - `SourcePills(props: { sources: string[]; selected: string[] | undefined; onChange: (s: string[] | undefined) => void; compact?: boolean })`
  - `TransactionFilters(props: { params: TxParams; lookups: LookupsResponse | undefined; onChange: (patch: Partial<TxParams>) => void; onClear: () => void; desktop: boolean })`
  - Text inputs debounce 300 ms (`DEBOUNCE_MS` exported) and call `onChange({ key: value || undefined })`.

Behaviour (from the spec, layout A):
- Desktop: labelled inputs — From, To (`type="date"`), Amount min, max (`inputMode="decimal"`), Merchant, Category (`list` → datalist of `lookups.categories`), Tags (datalist of `lookups.tags`); Type and Budget as button groups with `aria-pressed` (All / Expense / Income; All / Essential / Discretionary); `SourcePills`; when `params.excludeHidden`, a button "Hidden tags excluded ✕" that calls `onChange({ excludeHidden: false })`; a "Clear filters" button calling `onClear`.
- Phone (`desktop=false`): a button `Filters (n)` (n = `activeFilterCount(params)`) toggling a panel with the same controls stacked; below it, one chip button per active filter, accessible name `Remove <label>` (e.g. `Remove Category: "Groceries"`), which calls `onChange({ <key>: undefined })` (`excludeHidden: false` for the hidden chip, `sources: undefined` for sources).
- A text input shows the URL value; typing updates the box immediately and `onChange` once, 300 ms after the last keystroke; when `params` changes from outside (back button), the box shows the new value.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/__tests__/transactions/TransactionFilters.test.tsx
/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEBOUNCE_MS, TransactionFilters } from "../../transactions/TransactionFilters";
import { parseTxParams, type TxParams } from "../../transactions/params";

const lookups = { categories: ["Groceries", "Rent"], tags: ["gift"], sources: ["Bank A", "Card"] };
const params = (qs: string) => parseTxParams(new URLSearchParams(qs));

function setup(p: TxParams, desktop = true) {
  const onChange = vi.fn();
  const onClear = vi.fn();
  const utils = render(<TransactionFilters params={p} lookups={lookups} onChange={onChange} onClear={onClear} desktop={desktop} />);
  return { onChange, onClear, ...utils };
}

afterEach(() => vi.useRealTimers());

describe("TransactionFilters", () => {
  it("applies typed text once, after the pause", () => {
    vi.useFakeTimers();
    const { onChange } = setup(params(""));
    const box = screen.getByLabelText("Merchant");
    fireEvent.change(box, { target: { value: "te" } });
    fireEvent.change(box, { target: { value: "tes" } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ merchant: "tes" });
  });

  it("clears a filter when its box is emptied", () => {
    vi.useFakeTimers();
    const { onChange } = setup(params("merchant=tes"));
    fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "" } });
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(onChange).toHaveBeenCalledWith({ merchant: undefined });
  });

  it("follows a URL change made elsewhere", () => {
    const { rerender, onChange, onClear } = setup(params("merchant=tes"));
    rerender(<TransactionFilters params={params("merchant=lidl")} lookups={lookups} onChange={onChange} onClear={onClear} desktop />);
    expect(screen.getByLabelText("Merchant")).toHaveValue("lidl");
  });

  it("sets type and budget from the button groups", () => {
    const { onChange } = setup(params(""));
    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    expect(onChange).toHaveBeenCalledWith({ type: "income" });
    fireEvent.click(screen.getByRole("button", { name: "Essential" }));
    expect(onChange).toHaveBeenCalledWith({ budget: "essential" });
  });

  it("offers to stop excluding hidden tags only when they are excluded", () => {
    setup(params(""));
    expect(screen.queryByRole("button", { name: /hidden tags excluded/i })).not.toBeInTheDocument();
    const { onChange } = setup(params("excludeHidden=1"));
    fireEvent.click(screen.getByRole("button", { name: /hidden tags excluded/i }));
    expect(onChange).toHaveBeenCalledWith({ excludeHidden: false });
  });

  it("unticking a source narrows to the rest; ticking all goes back to every source", () => {
    const { onChange, rerender, onClear } = setup(params(""));
    fireEvent.click(screen.getByRole("checkbox", { name: "Card" }));
    expect(onChange).toHaveBeenLastCalledWith({ sources: ["Bank A"] });
    rerender(<TransactionFilters params={params("sources=Bank%20A")} lookups={lookups} onChange={onChange} onClear={onClear} desktop />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Card" }));
    expect(onChange).toHaveBeenLastCalledWith({ sources: undefined });
  });

  it("on a phone, counts active filters and removes one from its chip", () => {
    const { onChange } = setup(params('from=2026-09-01&to=2026-09-30&category="Groceries"&sources=Card'), false);
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Merchant")).not.toBeInTheDocument(); // sheet closed
    fireEvent.click(screen.getByRole("button", { name: 'Remove Category: "Groceries"' }));
    expect(onChange).toHaveBeenCalledWith({ category: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Filters (2)" }));
    expect(screen.getByLabelText("Merchant")).toBeInTheDocument();
  });

  it("clears everything", () => {
    const { onClear } = setup(params("merchant=x"));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/transactions/TransactionFilters.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/transactions/SourcePills.tsx
/**
 * The source checkboxes, as on the Summary: undefined means every source,
 * and ticking the last one goes back to undefined so the URL stays clean.
 */
export function SourcePills(props: {
  sources: string[];
  selected: string[] | undefined;
  onChange: (s: string[] | undefined) => void;
  compact?: boolean;
}) {
  const chosen = props.selected ?? props.sources;
  const toggle = (s: string) => {
    const next = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s];
    props.onChange(next.length === props.sources.length ? undefined : next);
  };
  return (
    <div role="group" aria-label="Sources" className="flex flex-wrap items-center gap-2">
      <span className="text-slate-600 dark:text-slate-400">Sources:</span>
      {props.sources.map((s) => (
        <label key={s} className={props.compact
          ? "flex items-center gap-2 py-0.5"
          : `flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 ${chosen.includes(s)
            ? "border-slate-400 dark:border-slate-500"
            : "border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-500"}`}>
          <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
          {s}
        </label>
      ))}
      <button type="button" className="underline" onClick={() => props.onChange(undefined)}>All</button>
      <button type="button" className="underline" onClick={() => props.onChange([])}>None</button>
    </div>
  );
}
```

```tsx
// frontend/src/transactions/TransactionFilters.tsx
import { useEffect, useRef, useState } from "react";

import type { LookupsResponse } from "../lib/types";
import { activeFilterCount, type TxParams } from "./params";
import { SourcePills } from "./SourcePills";

export const DEBOUNCE_MS = 300;

type TextKey = "from" | "to" | "merchant" | "category" | "tags" | "min" | "max";

/** A box that shows the URL's value and reports edits after a pause. */
function DebouncedInput(props: {
  label: string; name: TextKey; value: string | undefined; onChange: (patch: Partial<TxParams>) => void;
  type?: string; list?: string; inputMode?: "decimal"; placeholder?: string;
}) {
  const [text, setText] = useState(props.value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Back/forward or a chip changed the URL: show it, and drop a pending edit.
  useEffect(() => { clearTimeout(timer.current); setText(props.value ?? ""); }, [props.value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const id = `filter-${props.name}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
      {props.label}
      <input id={id} type={props.type ?? "text"} list={props.list} inputMode={props.inputMode} placeholder={props.placeholder}
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => props.onChange({ [props.name]: value || undefined }), DEBOUNCE_MS);
        }}
        className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:text-slate-100" />
    </label>
  );
}

function Segmented<T extends string>(props: {
  label: string; options: [T | undefined, string][]; value: T | undefined; onChange: (v: T | undefined) => void;
}) {
  return (
    <div role="group" aria-label={props.label} className="flex overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700">
      {props.options.map(([value, text]) => (
        <button key={text} type="button" aria-pressed={props.value === value} onClick={() => props.onChange(value)}
          className={`px-2.5 py-1 ${props.value === value ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : ""}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** One removable chip per active filter (phone). */
function chips(p: TxParams): { label: string; patch: Partial<TxParams> }[] {
  const out: { label: string; patch: Partial<TxParams> }[] = [];
  if (p.merchant) out.push({ label: `Merchant: ${p.merchant}`, patch: { merchant: undefined } });
  if (p.category) out.push({ label: `Category: ${p.category}`, patch: { category: undefined } });
  if (p.tags) out.push({ label: `Tags: ${p.tags}`, patch: { tags: undefined } });
  if (p.min) out.push({ label: `≥ €${p.min}`, patch: { min: undefined } });
  if (p.max) out.push({ label: `≤ €${p.max}`, patch: { max: undefined } });
  if (p.type) out.push({ label: p.type === "income" ? "Income" : "Expenses", patch: { type: undefined } });
  if (p.budget) out.push({ label: p.budget === "essential" ? "Essential" : "Discretionary", patch: { budget: undefined } });
  if (p.sources) out.push({ label: p.sources.length ? p.sources.join(", ") : "No sources", patch: { sources: undefined } });
  if (p.excludeHidden) out.push({ label: "Hidden tags excluded", patch: { excludeHidden: false } });
  return out;
}

export function TransactionFilters(props: {
  params: TxParams;
  lookups: LookupsResponse | undefined;
  onChange: (patch: Partial<TxParams>) => void;
  onClear: () => void;
  desktop: boolean;
}) {
  const { params: p, onChange } = props;
  const [open, setOpen] = useState(false);

  const controls = (
    <div className={props.desktop ? "flex flex-col gap-3" : "flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700"}>
      <div className={props.desktop ? "grid grid-cols-4 gap-3" : "grid grid-cols-2 gap-3"}>
        <DebouncedInput label="From" name="from" type="date" value={p.from} onChange={onChange} />
        <DebouncedInput label="To" name="to" type="date" value={p.to} onChange={onChange} />
        <DebouncedInput label="Amount min" name="min" inputMode="decimal" placeholder="0.00" value={p.min} onChange={onChange} />
        <DebouncedInput label="Amount max" name="max" inputMode="decimal" placeholder="0.00" value={p.max} onChange={onChange} />
        <DebouncedInput label="Merchant" name="merchant" placeholder='contains… ("exact")' value={p.merchant} onChange={onChange} />
        <DebouncedInput label="Category" name="category" list="tx-categories" placeholder='contains… ("exact")' value={p.category} onChange={onChange} />
        <DebouncedInput label="Tags" name="tags" list="tx-tags" placeholder="contains…" value={p.tags} onChange={onChange} />
      </div>
      <datalist id="tx-categories">{props.lookups?.categories.map((c) => <option key={c} value={`"${c}"`} />)}</datalist>
      <datalist id="tx-tags">{props.lookups?.tags.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Type" value={p.type} onChange={(type) => onChange({ type })}
          options={[[undefined, "All"], ["expense", "Expense"], ["income", "Income"]]} />
        <Segmented label="Budget" value={p.budget} onChange={(budget) => onChange({ budget })}
          options={[[undefined, "All"], ["essential", "Essential"], ["discretionary", "Discretionary"]]} />
      </div>
      {props.lookups && (
        <SourcePills sources={props.lookups.sources} selected={p.sources} compact={!props.desktop}
          onChange={(sources) => onChange({ sources })} />
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {p.excludeHidden && (
          <button type="button" onClick={() => onChange({ excludeHidden: false })}
            className="rounded-full border border-slate-300 px-2.5 py-0.5 dark:border-slate-700">
            Hidden tags excluded ✕
          </button>
        )}
        <button type="button" onClick={props.onClear} className="underline">Clear filters</button>
      </div>
    </div>
  );

  if (props.desktop) return <div className="text-sm">{controls}</div>;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="self-start rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700">
        Filters ({activeFilterCount(p)})
      </button>
      {open && controls}
      <div className="flex flex-wrap gap-2">
        {chips(p).map((c) => (
          <button key={c.label} type="button" aria-label={`Remove ${c.label}`} onClick={() => onChange(c.patch)}
            className="max-w-full truncate rounded-full bg-slate-100 px-2.5 py-0.5 dark:bg-slate-800">
            {c.label} ✕
          </button>
        ))}
      </div>
    </div>
  );
}
```

Note the chip for `excludeHidden` duplicates the in-sheet button on phone only when the sheet is open; that is acceptable (both remove it).

- [ ] **Step 4: Run tests and typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Change `DEBOUNCE_MS` usage in `setTimeout` to `0` and drop `clearTimeout(timer.current)` in `onChange`; the "applies typed text once" test must FAIL (called twice). Revert.

- [ ] **Step 6: Commit**

```bash
jj desc -m "Add the Transactions filter controls for desktop and phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 7: The list — sortable desktop table and phone day groups

**Files:**
- Create: `frontend/src/transactions/TransactionTable.tsx`, `frontend/src/transactions/DayList.tsx`
- Test: `frontend/src/__tests__/transactions/list.test.tsx`

**Interfaces:**
- Consumes: `TransactionRow`; `SortKey` (Task 5); `formatCents`.
- Produces:
  - `sortRows(rows: TransactionRow[], sort: SortKey, dir: "asc" | "desc"): TransactionRow[]` (exported from `TransactionTable.tsx`): stable; ties broken by date desc then id desc; text compared with `localeCompare(undefined, { sensitivity: "base" })`; `amount` by `amountCents`.
  - `TransactionTable(props: { rows: TransactionRow[]; sort: SortKey; dir: "asc" | "desc"; onSort: (sort: SortKey, dir: "asc" | "desc") => void })` — header buttons; clicking the current column flips `dir`, another column sets it with `asc` (date: `desc`); the current header has `aria-sort`.
  - `dayLabel(iso: string): string` (exported from `DayList.tsx`) — `"Tue 29 Sep"`, built from fixed arrays with `Date.UTC`, no Intl.
  - `DayList(props: { rows: TransactionRow[] })` — rows in the order given, grouped under a heading per date.
- Amounts: `formatCents(amountCents)`; income rows get `text-income`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/__tests__/transactions/list.test.tsx
/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DayList, dayLabel } from "../../transactions/DayList";
import { sortRows, TransactionTable } from "../../transactions/TransactionTable";
import type { TransactionRow } from "../../lib/types";

const row = (id: number, date: string, merchant: string, amountCents: number, type: "expense" | "income" = "expense"): TransactionRow => ({
  id, date, merchant, merchantRaw: merchant.toUpperCase(), amountCents, type, category: "Groceries", budget: "essential", tags: "", source: "Card",
});
const rows = [row(3, "2026-09-29", "tesco", 5420), row(2, "2026-09-29", "Lidl", 3110), row(1, "2026-09-27", "Employer", 500000, "income")];

describe("sortRows", () => {
  it("sorts text without regard to case, ties newest first", () => {
    expect(sortRows(rows, "merchant", "asc").map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortRows(rows, "amount", "desc").map((r) => r.id)).toEqual([1, 3, 2]);
    expect(sortRows(rows, "source", "asc").map((r) => r.id)).toEqual([3, 2, 1]);
  });
  it("does not mutate its input", () => {
    const copy = [...rows];
    sortRows(rows, "merchant", "asc");
    expect(rows).toEqual(copy);
  });
});

describe("dayLabel", () => {
  it("names the weekday and month without Intl", () => {
    expect(dayLabel("2026-09-29")).toBe("Tue 29 Sep");
    expect(dayLabel("2026-01-01")).toBe("Thu 1 Jan");
  });
});

describe("TransactionTable", () => {
  it("shows every column and flips the sort on the current header", () => {
    const onSort = vi.fn();
    render(<TransactionTable rows={rows} sort="date" dir="desc" onSort={onSort} />);
    for (const h of ["Date", "Merchant", "Amount", "Type", "Source", "Category", "Budget", "Tags"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h) })).toBeInTheDocument();
    }
    expect(screen.getByRole("columnheader", { name: /Date/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: /Date/ }));
    expect(onSort).toHaveBeenLastCalledWith("date", "asc");
    fireEvent.click(screen.getByRole("button", { name: /Amount/ }));
    expect(onSort).toHaveBeenLastCalledWith("amount", "asc");
  });
});

describe("DayList", () => {
  it("groups rows under their day", () => {
    render(<DayList rows={rows} />);
    const days = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(days).toEqual(["Tue 29 Sep", "Sun 27 Sep"]);
    const first = screen.getByRole("list", { name: "Tue 29 Sep" });
    expect(within(first).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("€5,000.00")).toHaveClass("text-income");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/transactions/list.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/transactions/TransactionTable.tsx
import { formatCents } from "../lib/money";
import type { TransactionRow } from "../lib/types";
import type { SortKey } from "./params";

const COLUMNS: [SortKey, string][] = [
  ["date", "Date"], ["merchant", "Merchant"], ["amount", "Amount"], ["type", "Type"],
  ["source", "Source"], ["category", "Category"], ["budget", "Budget"], ["tags", "Tags"],
];

function compare(a: TransactionRow, b: TransactionRow, sort: SortKey): number {
  if (sort === "amount") return a.amountCents - b.amountCents;
  const key = sort === "date" ? "date" : sort;
  return String(a[key]).localeCompare(String(b[key]), undefined, { sensitivity: "base" });
}

/** Client-side, as the TUI's header click was. Ties stay newest first. */
export function sortRows(rows: TransactionRow[], sort: SortKey, dir: "asc" | "desc"): TransactionRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) =>
    sign * compare(a, b, sort) || b.date.localeCompare(a.date) || b.id - a.id);
}

export function TransactionTable(props: {
  rows: TransactionRow[];
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (sort: SortKey, dir: "asc" | "desc") => void;
}) {
  const click = (key: SortKey) => props.onSort(key,
    key === props.sort ? (props.dir === "asc" ? "desc" : "asc") : key === "date" ? "desc" : "asc");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            {COLUMNS.map(([key, label]) => (
              <th key={key} scope="col" className={`px-2 py-1 font-normal ${key === "amount" ? "text-right" : ""}`}
                aria-sort={props.sort === key ? (props.dir === "asc" ? "ascending" : "descending") : undefined}>
                <button type="button" onClick={() => click(key)} className="whitespace-nowrap">
                  {label}{props.sort === key ? (props.dir === "asc" ? " ▴" : " ▾") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-2 py-1.5 whitespace-nowrap">{r.date}</td>
              <td className="max-w-64 truncate px-2" title={r.merchantRaw}>{r.merchant}</td>
              <td className={`px-2 text-right whitespace-nowrap ${r.type === "income" ? "text-income" : ""}`}>{formatCents(r.amountCents)}</td>
              <td className="px-2">{r.type}</td>
              <td className="px-2 whitespace-nowrap">{r.source}</td>
              <td className="px-2 whitespace-nowrap">{r.category}</td>
              <td className="px-2">{r.type === "expense" ? r.budget : ""}</td>
              <td className="px-2 text-xs text-slate-500">{r.tags}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

```tsx
// frontend/src/transactions/DayList.tsx
import { formatCents } from "../lib/money";
import type { TransactionRow } from "../lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 29 Sep". Built by hand: Intl's short month differs by ICU ("Sept"). */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

/** Phone list: rows in the order given, under a heading per day. */
export function DayList(props: { rows: TransactionRow[] }) {
  const days: { date: string; rows: TransactionRow[] }[] = [];
  for (const r of props.rows) {
    const last = days[days.length - 1];
    if (last?.date === r.date) last.rows.push(r);
    else days.push({ date: r.date, rows: [r] });
  }
  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => {
        const label = dayLabel(day.date);
        return (
          <section key={day.date}>
            <h3 className="mb-1 border-b border-slate-200 pb-0.5 text-xs font-semibold text-slate-500 dark:border-slate-800">{label}</h3>
            <ul aria-label={label} className="flex flex-col gap-2">
              {day.rows.map((r) => (
                <li key={r.id} className="text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{r.merchant}</span>
                    <span className={`shrink-0 ${r.type === "income" ? "text-income" : ""}`}>{formatCents(r.amountCents)}</span>
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {[r.category, r.source, r.tags].filter(Boolean).join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

The `dayLabel` year in a multi-year range is not shown; acceptable because the page heading shows the range. (Ruling: phone keeps server order — date newest first — and ignores `sort`; sorting is a desktop table feature, as the TUI's header click was.)

- [ ] **Step 4: Run tests and typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Add the transaction table and the phone day list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 8: Transactions page, route and top-bar navigation

**Files:**
- Create: `frontend/src/transactions/TransactionsPage.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/TopBar.tsx`
- Modify test: `frontend/src/__tests__/TopBar.test.tsx` (wrap in `MemoryRouter`, add nav test)
- Test: `frontend/src/__tests__/transactions/TransactionsPage.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 5–7; `usePeriods` from `summary/queries.ts`; `ApiError`; `DESKTOP`, `useMediaQuery`; `formatCents`.
- Produces: route `/transactions`; `PAGE_SIZE = 200` exported from `TransactionsPage.tsx`.

Behaviour:
- If the URL has **no query parameters at all**, wait for periods, compute `defaultMonth(periods, new Date())` and `setSearch(toTxSearch({...params, ...monthRange(y, m)}), { replace: true })`. If `defaultMonth` is null, show "No transactions yet." (Ruling: the default applies only to an empty query string, so a list filtered by merchant across all dates — dates emptied by hand — is not overridden.)
- Heading: "Transactions" and, when `wholeMonth(params)` is set, the month name and year (`September 2026`, from a fixed month-name array) with ◂ ▸ buttons labelled `Previous month` / `Next month` calling `setSearch(toTxSearch(shiftMonth(params, ∓1)))`; otherwise `from – to`, `from onwards`, `until to`, or `All dates`.
- Filter changes: `setSearch(toTxSearch({ ...params, ...patch }), { replace: true })` for text (debounced) changes and plain `setSearch` for the rest — simplest acceptable: always `replace: true` for patches coming from `TransactionFilters`, push for month stepping.
- Clear filters: `setSearch(new URLSearchParams())` (push) → default month again.
- Totals line: `N transactions` plus, if `params.type` is set, that type's total (`Expenses €x` / `Income €x`), else `Income €x · Expenses €y`.
- Rows: desktop → `TransactionTable` over `sortRows(rows, sort, dir)`; phone → `DayList` over rows as returned. Show the first `PAGE_SIZE`, then a `Show more (N left)` button adding another `PAGE_SIZE`; reset to `PAGE_SIZE` when the API path changes.
- Loading with previous data: dim (`opacity-60`). First load: pulse placeholder.
- Errors: `ApiError` with status 400 → its message in a `<p role="alert" className="text-expense">` under the filters; other errors → message and a Retry button.
- Empty: "No transactions match these filters." and a "Clear filters" button.
- `App.tsx`: `<Route path="/transactions" element={<TransactionsPage />} />` before the `*` route.
- `TopBar.tsx`: after the brand, `NavLink`s `Summary` (`to="/"`, `end`) and `Transactions` (`to="/transactions"`); the active one `font-semibold underline` (NavLink sets `aria-current="page"`). Hide the "Expenses" brand below `sm` so the bar fits 390 px.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/__tests__/transactions/TransactionsPage.test.tsx
/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeriodsResponse, TransactionRow, TransactionsResponse } from "../../lib/types";
import { PAGE_SIZE, TransactionsPage } from "../../transactions/TransactionsPage";

let location = "";
function LocationProbe() {
  location = useLocation().search;
  return null;
}

const periods: PeriodsResponse = { years: [{ year: 2026, months: [8, 9] }], sources: ["Bank A", "Card"] };
const row = (id: number, date: string, cents: number, type: "expense" | "income" = "expense"): TransactionRow => ({
  id, date, merchant: `Shop ${id}`, merchantRaw: `SHOP ${id}`, amountCents: cents, type, category: "Groceries", budget: "essential", tags: "", source: "Card",
});

function api(opts: { rows?: TransactionRow[]; error?: { status: number; body: unknown } } = {}) {
  const calls: URL[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/summary/periods") return json(periods);
    if (url.pathname === "/api/lookups") return json({ categories: ["Groceries"], tags: [], sources: periods.sources });
    if (opts.error) return json(opts.error.body, opts.error.status);
    const rows = opts.rows ?? [row(2, "2026-09-29", 5420), row(1, "2026-09-27", 500000, "income")];
    const body: TransactionsResponse = {
      rows, count: rows.length,
      incomeCents: rows.filter((r) => r.type === "income").reduce((a, r) => a + r.amountCents, 0),
      expensesCents: rows.filter((r) => r.type === "expense").reduce((a, r) => a + r.amountCents, 0),
    };
    return json(body);
  };
  return { fetch, calls };
}

function renderAt(url: string, mock = api()) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <TransactionsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

let desktop = true;
beforeEach(() => {
  desktop = true;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T09:00:00"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("TransactionsPage", () => {
  it("opens on the previous month while the current one is empty", async () => {
    const mock = renderAt("/transactions");
    await waitFor(() => expect(location).toBe("?from=2026-09-01&to=2026-09-30"));
    expect(await screen.findByText("September 2026")).toBeInTheDocument();
    await waitFor(() => expect(mock.calls.some((u) => u.pathname === "/api/transactions" && u.searchParams.get("from") === "2026-09-01")).toBe(true));
  });

  it("shows the count and both totals, and steps months", async () => {
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    expect(await screen.findByText(/2 transactions/)).toBeInTheDocument();
    expect(screen.getByText(/Income €5,000\.00 · Expenses €54\.20/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(location).toBe("?from=2026-08-01&to=2026-08-31"));
  });

  it("keeps a drill-down's filters as given", async () => {
    const mock = renderAt('/transactions?from=2026-01-01&to=2026-12-31&category=%22Groceries%22&type=expense&excludeHidden=1');
    await waitFor(() => expect(mock.calls.some((u) => u.pathname === "/api/transactions" && u.searchParams.get("excludeHidden") === "1")).toBe(true));
    expect(location).toContain("category=");
    expect(screen.getByText("2026-01-01 – 2026-12-31")).toBeInTheDocument();
  });

  it("shows a 400 message under the filters", async () => {
    renderAt("/transactions?from=2026-09-01", api({ error: { status: 400, body: { error: "min must be a number" } } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("min must be a number");
  });

  it("says when nothing matches", async () => {
    renderAt("/transactions?merchant=zzz", api({ rows: [] }));
    expect(await screen.findByText("No transactions match these filters.")).toBeInTheDocument();
  });

  it("shows rows a page at a time", async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => row(i + 1, "2026-09-10", 100));
    renderAt("/transactions?from=2026-09-01&to=2026-09-30", api({ rows: many }));
    await screen.findByText(`${PAGE_SIZE + 5} transactions`, { exact: false });
    expect(screen.getAllByRole("row")).toHaveLength(PAGE_SIZE + 1); // + header
    await userEvent.click(screen.getByRole("button", { name: "Show more (5 left)" }));
    expect(screen.getAllByRole("row")).toHaveLength(PAGE_SIZE + 6);
  });

  it("uses day groups on a phone", async () => {
    desktop = false;
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    expect(await screen.findByRole("heading", { name: "Tue 29 Sep" })).toBeInTheDocument();
  });
});
```

In `frontend/src/__tests__/TopBar.test.tsx`, wrap the render in `<MemoryRouter initialEntries={[path]}>` (import from `"react-router"`, add a `path = "/"` parameter to `renderBar`) and add:

```tsx
  it("links to both screens and marks the current one", async () => {
    renderBar("expenses.example.com", undefined, "/transactions");
    expect(screen.getByRole("link", { name: "Summary" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute("aria-current", "page");
  });
```

(Adjust `renderBar`'s signature to `(hostname, me = { … }, path = "/")`; existing calls are unchanged.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/transactions/TransactionsPage.test.tsx src/__tests__/TopBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/transactions/TransactionsPage.tsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { ApiError } from "../lib/api";
import { formatCents } from "../lib/money";
import { monthRange } from "../lib/types";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { usePeriods } from "../summary/queries";
import { DayList } from "./DayList";
import { defaultMonth } from "./defaultMonth";
import { parseTxParams, shiftMonth, toTxSearch, transactionsApiPath, wholeMonth, type TxParams } from "./params";
import { useLookups, useTransactions } from "./queries";
import { TransactionFilters } from "./TransactionFilters";
import { sortRows, TransactionTable } from "./TransactionTable";

export const PAGE_SIZE = 200;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function rangeLabel(p: TxParams): string {
  const m = wholeMonth(p);
  if (m) return `${MONTH_NAMES[m.month - 1]} ${m.year}`;
  if (p.from && p.to) return `${p.from} – ${p.to}`;
  if (p.from) return `${p.from} onwards`;
  if (p.to) return `until ${p.to}`;
  return "All dates";
}

export function TransactionsPage() {
  const [search, setSearch] = useSearchParams();
  const desktop = useMediaQuery(DESKTOP);
  const params = parseTxParams(search);
  const unset = search.toString() === "";
  const periods = usePeriods();
  const lookups = useLookups();
  const list = useTransactions(params, !unset);
  const path = transactionsApiPath(params);
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => setShown(PAGE_SIZE), [path]);

  const start = unset && periods.data ? defaultMonth(periods.data, new Date()) : null;
  useEffect(() => {
    if (start) setSearch(toTxSearch({ ...params, ...monthRange(start.year, start.month) }), { replace: true });
  }, [start?.year, start?.month]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<TxParams>) => setSearch(toTxSearch({ ...params, ...patch }), { replace: true });
  const clear = () => setSearch(new URLSearchParams());

  if (unset && periods.data && !start) {
    return <main className="mx-auto max-w-6xl p-4"><p>No transactions yet.</p></main>;
  }

  const month = wholeMonth(params);
  const data = list.data;
  const badRequest = list.error instanceof ApiError && list.error.status === 400 ? list.error.message : null;
  const totals = data && (params.type === "income"
    ? `Income ${formatCents(data.incomeCents)}`
    : params.type === "expense"
      ? `Expenses ${formatCents(data.expensesCents)}`
      : `Income ${formatCents(data.incomeCents)} · Expenses ${formatCents(data.expensesCents)}`);
  const rows = data ? (desktop ? sortRows(data.rows, params.sort, params.dir) : data.rows) : [];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Transactions</h1>
        <div className="flex items-center gap-2 text-sm">
          {month && <button type="button" aria-label="Previous month" onClick={() => setSearch(toTxSearch(shiftMonth(params, -1)))}>◂</button>}
          <span>{rangeLabel(params)}</span>
          {month && <button type="button" aria-label="Next month" onClick={() => setSearch(toTxSearch(shiftMonth(params, 1)))}>▸</button>}
        </div>
      </header>

      <TransactionFilters params={params} lookups={lookups.data} onChange={update} onClear={clear} desktop={desktop} />
      {badRequest && <p role="alert" className="text-sm text-expense">{badRequest}</p>}
      {list.error && !badRequest && (
        <div className="text-sm">
          <p className="mb-2">{list.error.message}</p>
          <button type="button" onClick={() => list.refetch()} className="rounded-md border px-3 py-1">Retry</button>
        </div>
      )}

      {!data && !list.error && <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" aria-busy="true" />}
      {data && (
        <section aria-label="Transactions list" className={`flex flex-col gap-3 transition-opacity ${list.isPlaceholderData ? "opacity-60" : ""}`}>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {data.count} transactions{data.count > 0 && ` · ${totals}`}
          </p>
          {data.count === 0 ? (
            <p className="text-sm">
              No transactions match these filters.{" "}
              <button type="button" onClick={clear} className="underline">Clear filters</button>
            </p>
          ) : desktop ? (
            <TransactionTable rows={rows.slice(0, shown)} sort={params.sort} dir={params.dir}
              onSort={(sort, dir) => setSearch(toTxSearch({ ...params, sort, dir }), { replace: true })} />
          ) : (
            <DayList rows={rows.slice(0, shown)} />
          )}
          {rows.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} className="self-start text-sm underline">
              Show more ({rows.length - shown} left)
            </button>
          )}
        </section>
      )}
    </main>
  );
}
```

`App.tsx`: import `TransactionsPage` and change `<Routes>` to:

```tsx
        <Routes>
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="*" element={<SummaryPage />} />
        </Routes>
```

`TopBar.tsx`: import `{ NavLink } from "react-router"`; replace `<span className="font-semibold">Expenses</span>` with:

```tsx
        <span className="flex items-center gap-4">
          <span className="hidden font-semibold sm:inline">Expenses</span>
          {([["/", "Summary"], ["/transactions", "Transactions"]] as const).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}
              className={({ isActive }) => (isActive ? "font-semibold underline" : "text-slate-600 dark:text-slate-400")}>
              {label}
            </NavLink>
          ))}
        </span>
```

- [ ] **Step 4: Run tests, typecheck, build**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run build`
Expected: PASS, build succeeds. If the "opens on the previous month" test sees `location` with a different parameter order, fix the code to produce `from` then `to` (it does via `toTransactionsSearch`'s key order) — do not loosen the test.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Add the Transactions page and top-bar navigation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 9: Summary drill-down links

**Files:**
- Modify: `frontend/src/summary/BreakdownList.tsx`, `frontend/src/summary/MonthlyGrid.tsx`, `frontend/src/summary/SummaryPage.tsx`
- Test: modify `frontend/src/__tests__/summary/BreakdownList.test.tsx`, `frontend/src/__tests__/summary/MonthlyGrid.test.tsx`, `frontend/src/__tests__/summary/SummaryPage.test.tsx` (wrap renders in `MemoryRouter` where they now render `<Link>`)

**Interfaces:**
- Consumes: `drillDown`, `toTransactionsSearch`, `DrillTarget` (via `lib/types`).
- Produces:
  - `BreakdownItem.href?: string` — when set, the label is a `<Link to={href}>`.
  - `MonthlyGrid` prop `cellHref?: (category: string | null, month: number | null) => string` — `category` null = Total row; `month` null = whole year.
  - In `SummaryPage`: `const href = (t: Partial<DrillTarget> & Pick<DrillTarget, "type">) => \`/transactions?${toTransactionsSearch(drillDown({ year, month: view.month, sources: view.sources, excludeHidden: !view.hidden && (tags.current?.patterns.length ?? 0) > 0, ...t }))}\``.

**Since #32 the Summary has tabs** (`?tab=expenses|income|monthly`, default expenses): the expense lists sit on the Expenses tab, the income lists on the Income tab, and both `MonthlyGrid`s on the Monthly tab (absent in a month view). `BreakdownList` folds items under `foldBelow` into a "Smaller items" sub-list rendered by the same `row()` helper, so the `href` on the label covers folded items too — add a test that a folded item is a link once "Smaller items" is opened. `MonthlyGrid`'s `Amount` now takes `{cell, trend}`; keep the trend arrow inside the link. Tests that look for income or grid regions must render the right tab (`&tab=income`, `&tab=monthly`). Drill-down links never carry `tab`.

Links (spec table):
- Expense categories: `href({ type: "expense", category: c.category, budget: c.spendingType })`.
- Top expense merchants: `href({ type: "expense", merchant: m.merchant })` — no budget (spec ruling).
- Income categories / top income: `type: "income"`, `category` / `merchant`.
- Expense grid: `cellHref = (category, month) => href({ type: "expense", month, ...(category !== null && { category, budget: budgetOf(category) }) })` where `budgetOf` looks the category up in `data.expenseCategories`. Income grid: same with `type: "income"` and no budget.
- Desktop grid: category name `<th>` → `cellHref(row.category, null)` (Total row: `cellHref(null, null)`); Total and Average cells → same as the name; month cells with a non-zero amount → `cellHref(category | null, i + 1)`. Zero cells stay plain "–".
- Phone grid: the row button still expands; inside the expanded panel each non-zero month amount is a link, and a final link `All <category> transactions` → `cellHref(category, null)`.
- Links keep their current look; add `hover:underline` only.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/__tests__/summary/BreakdownList.test.tsx` (wrap every `render` in that file in `<MemoryRouter>`):

```tsx
  it("links an item to its transactions when given an href", () => {
    render(<MemoryRouter><BreakdownList title="Cats" tone="expense" items={[{ label: "Groceries", amountCents: 100, href: "/transactions?category=%22Groceries%22" }]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Groceries" })).toHaveAttribute("href", "/transactions?category=%22Groceries%22");
  });
```

Add to `frontend/src/__tests__/summary/MonthlyGrid.test.tsx` (wrap renders in `<MemoryRouter>`):

```tsx
  it("links names, totals and non-zero months on desktop", () => {
    const cellHref = vi.fn((c: string | null, m: number | null) => `/t?c=${c ?? "ALL"}&m=${m ?? "Y"}`);
    render(<MemoryRouter><MonthlyGrid title="Monthly expenses" tone="expense" lastMonth={3} grid={grid} cellHref={cellHref} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Groceries" })).toHaveAttribute("href", "/t?c=Groceries&m=Y");
    expect(screen.getByRole("link", { name: "Total" })).toHaveAttribute("href", "/t?c=ALL&m=Y");
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/t?c=Groceries&m=1")).toBe(true);
  });
```

(Use the file's existing `grid` fixture name, or the `summary().monthly!.expense` grid from `fixtures.ts`; with `matchMedia` stubbed to desktop as the file already does. Add a phone variant asserting `All Groceries transactions` appears after expanding the row.)

Add to `frontend/src/__tests__/summary/SummaryPage.test.tsx`:

```tsx
  it("links a category to its transactions with the Summary's scope", async () => {
    renderAt("/?year=2026&sources=Card");
    await screen.findByText("€61,400.00");
    const link = within(screen.getByRole("region", { name: "Expense categories" })).getAllByRole("link")[0];
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/transactions");
    expect(url.searchParams.get("from")).toBe("2026-01-01");
    expect(url.searchParams.get("to")).toBe("2026-12-31");
    expect(url.searchParams.get("type")).toBe("expense");
    expect(url.searchParams.get("category")).toMatch(/^".+"$/);
    expect(url.searchParams.getAll("sources")).toEqual(["Card"]);
    expect(url.searchParams.get("excludeHidden")).toBe("1"); // fixture excludes "emergency"
  });

  it("does not exclude hidden tags in links when the Summary includes them", async () => {
    renderAt("/?year=2026&hidden=1&tab=income");
    await screen.findByText("€61,400.00");
    const link = within(screen.getByRole("region", { name: "Top income sources" })).getByRole("link", { name: "Employer" });
    expect(new URL(link.getAttribute("href")!, "http://localhost").searchParams.has("excludeHidden")).toBe(false);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/summary`
Expected: the new tests FAIL (no links).

- [ ] **Step 3: Implement**

`BreakdownList.tsx`: import `{ Link } from "react-router"`; add `href?: string` to `BreakdownItem`; render the label as:

```tsx
                  {item.href ? <Link to={item.href} className="hover:underline">{item.label}</Link> : item.label}
```

`MonthlyGrid.tsx`: import `{ Link } from "react-router"`; add `cellHref?: (category: string | null, month: number | null) => string` to `MonthlyGrid`'s props and pass it to `DesktopTable` and `PhoneRows`. A helper:

```tsx
function Linked(props: { to: string | undefined; children: ReactNode }) {
  return props.to ? <Link to={props.to} className="hover:underline">{props.children}</Link> : <>{props.children}</>;
}
```

In `DesktopTable`'s `row`, with `const cat = isTotal ? null : r.category; const yearHref = props.cellHref?.(cat, null);` wrap the `<th>` text, the Total and the Average values in `<Linked to={yearHref}>`, and each month cell as `<Linked to={c.amountCents ? props.cellHref?.(cat, i + 1) : undefined}><Amount cell={c} trend={trends[i]} /></Linked>` (whatever trend expression the cell already passes). In `PhoneRows`' expanded `<dl>`, wrap each `<Amount>` the same way, and after the `<dl>` add:

```tsx
              {props.cellHref && (
                <Link to={props.cellHref(r.category, null)} className="mt-2 block text-xs underline">
                  All {r.category} transactions
                </Link>
              )}
```

`SummaryPage.tsx`: import `drillDown`, `toTransactionsSearch`, `type DrillTarget` from `"../lib/types"`; inside the component after `tags.current` is set:

```tsx
  const excludeHidden = !view.hidden && (tags.current?.patterns.length ?? 0) > 0;
  const href = (t: Partial<DrillTarget> & Pick<DrillTarget, "type">) =>
    `/transactions?${toTransactionsSearch(drillDown({ year: year!, month: view.month, sources: view.sources, excludeHidden, ...t }))}`;
```

Add `href` to each `BreakdownList` item mapping as listed above, and pass to the grids:

```tsx
<MonthlyGrid ... cellHref={(category, m) => href({ type: "expense", month: m,
  ...(category !== null && { category, budget: data.expenseCategories.find((c) => c.category === category)?.spendingType ?? null }) })} />
<MonthlyGrid ... cellHref={(category, m) => href({ type: "income", month: m, ...(category !== null && { category }) })} />
```

(`year` is non-null at this point in the component — the early return handles null.)

- [ ] **Step 4: Run tests, typecheck, build**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run build`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Set `excludeHidden` to `false` unconditionally; the "links a category … excludeHidden" test must FAIL. Revert.

- [ ] **Step 6: Commit**

```bash
jj desc -m "Link Summary numbers to the transactions behind them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 10: Docs, full verification and screenshots

**Files:**
- Modify: `docs/WEB_PORT_PLAN.md` (step 2: mark "Transactions (read)" and "Summary drill-down" done, one short paragraph like the Summary's)
- Modify: `worker/README.md` only if it lists API routes (add `/api/transactions`, `/api/lookups`)

- [ ] **Step 1: Update the plan doc**

In `docs/WEB_PORT_PLAN.md`, under `#### Transactions`, strike the "Read PR" bullets the way finished items are struck elsewhere (`~~…~~ Done:`) with one paragraph: the routes, `excludeHidden`/`sources`, the drill-down test, default month. Under `#### Summary`, strike "Drill-down".

- [ ] **Step 2: Full test runs, including Node 22 as CI uses**

Run:
```bash
cd worker && npx vitest run && npx tsc --noEmit
cd ../frontend && npx vitest run && npx tsc -b && npm run build
cd ../frontend && npx -y node@22 node_modules/vitest/vitest.mjs run
```
Expected: all PASS on both Node versions.

- [ ] **Step 3: Real-data checks (controller, local only)**

If a migrated real database is available locally, run `cd worker && CROSSCHECK_DB=<path> npx vitest run src/__tests__/services/drillDown.test.ts` and report pass/fail. Then `cd worker && make dev`, open `/transactions` and a few Summary links at 390 px and 1440 px with Playwright, screenshot, and check by eye: no horizontal overflow, totals match the Summary number clicked, phone chips wrap.

- [ ] **Step 4: Privacy scan before any push**

Run: `jj diff -r 'main..@' | grep -niE '@gmail|/Users/|pallotron' || echo clean` — expected `clean` (the existing Access team domain lines in `WEB_PORT_PLAN.md` are not in this diff). Also grep for the employer name per CLAUDE.md.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Record the Transactions browse screen in the port plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
