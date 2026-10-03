# Merchant editor and Merchants page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the TUI's merchant editor to the web, add a Merchants page (the Categorize port, plus rule deletion), and fold in the follow-ups deferred from Transactions edit PR A.

**Architecture:** One shared Worker step, `repointRows`, re-resolves only the rows a changed pattern matches and rewrites their merchant and occurrence atomically; saving and deleting a rule both build a new rule table and call it. New read queries (`listMerchants`, `ruleFor`) and Origin-checked routes under `/api/merchants` feed a React `MerchantEditor` sheet, opened from a transaction's edit sheet and from a new `/merchants` page.

**Tech Stack:** Cloudflare Worker (Hono, drizzle-orm 0.44 on D1, zod), Vitest with better-sqlite3 and `fakeD1`; React 19, react-router, TanStack Query, Tailwind, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-03-merchants-design.md`

## Global Constraints

- Version control is **jj**, never git. Each task: `jj st`; if `@` has changes, `jj new`; then `jj desc -m "<message>"` before editing. Messages are an imperative sentence-case verb phrase, no full stop.
- Every commit message ends with exactly this trailer line (no other model name): `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- In `worker/` and `frontend/`, never run `npm install <pkg>`; no new dependencies are needed.
- Worker tests: `cd worker && npx vitest run <path>`; typecheck: `cd worker && npm run typecheck`.
- Frontend tests: `cd frontend && npx vitest run <path>`; typecheck: `cd frontend && npx tsc -b`.
- Test fixtures are synthetic: generic names like `CORNER SHOP`, `CAFE ONE`. No real people, banks, employers, emails or paths.
- Money is integer cents. A displayed signed amount follows `signedAmount`: income `+€…` green, expense `−€…` (U+2212).
- Every write through `atomic()`; every new write service gets a `fakeD1` test in `worker/src/__tests__/db/atomicD1.test.ts`.
- Rule changes have no Undo.
- Merchant-write query invalidation keys: `transactions`, `summary`, `periods`, `lookups`, `merchants`, `merchant-rule`, `alias-preview`.

## Review Focus

1. **A pattern edited into different text** creates a new rule and leaves the old one (the TUI did the same, keyed on pattern). The person expects the old rule to still show on the Merchants row afterwards, not vanish. Task 3 test "a merchant keeps both rules after a pattern is retyped".
2. **Deleting the last rule for a merchant whose raw names never had their own `merchants` row**: rows must land on a newly created merchant named by `normalizeMerchantName(raw)`, not on null. Task 2 test "deleting the only rule creates the raw-name merchants".
3. **Tags typed but not turned into chips** in the editor must still be saved, as on TagSheet. Task 8 test "saves tags still in the box".
4. **A category typed with surrounding spaces** ("  Eating out ") on Set category: trimmed, so the existing category is reused rather than a near-duplicate created. Task 2 test "trims the category name".
5. **Opening the editor from a transaction whose raw name the server cannot find a rule for while the request is still loading**: Save must stay disabled until the lookup answers, so a new rule is not saved on top of an existing one. Task 8 test "Save waits for the rule lookup".

---

## File map

Worker:
- Modify `worker/src/services/merchants.ts`: `repointRows`, `saveMerchantDecision` (+tags), `deleteMerchantRule`, `setMerchantCategory`, `UnknownRuleError`.
- Create `worker/src/queries/merchants.ts`: `listMerchants`, `ruleFor`.
- Create `worker/src/api/merchants.ts`: JSON types shared with the frontend (no imports except types from `./transactions`).
- Create `worker/src/routes/merchants.ts`; modify `worker/src/app.ts` to mount it.
- Modify `worker/src/queries/transactions.ts` (`listLookups` gains `essentialCategories`), `worker/src/api/transactions.ts` (`LookupsResponse`, `DeletedResponse`).
- Modify `worker/src/services/transactions.ts` (`softDeleteTransactions` returns ids; `tagTransactions` live-only), `worker/src/routes/transactionEdits.ts`.
- Tests: `worker/src/__tests__/services/merchants.test.ts`, `worker/src/__tests__/queries/merchants.test.ts` (new), `worker/src/__tests__/app/merchantsRoute.test.ts` (new), `worker/src/__tests__/db/atomicD1.test.ts`, `worker/src/__tests__/app/transactionEdits.test.ts`, `worker/src/__tests__/services/transactions.test.ts`.

Frontend:
- Create `frontend/src/lib/suggestPattern.ts`, `frontend/src/lib/useSheetSubmit.tsx`, `frontend/src/lib/useDebounced.ts`.
- Modify `frontend/src/lib/Toast.tsx` (+`useToast`), `frontend/src/lib/types.ts` (re-export merchant types).
- Modify `frontend/src/transactions/edit/*`: `mutations.ts` (exported `useWrite`), `EditSheet.tsx`, `BulkEditSheet.tsx`, `TagSheet.tsx`, `TagInput.tsx`, `DeleteSheet.tsx`, `useDeleteFlow.ts`, `Editing.tsx`; `frontend/src/transactions/TransactionsPage.tsx`, `TransactionTable.tsx`, `DayList.tsx`.
- Create `frontend/src/merchants/`: `queries.ts`, `mutations.ts`, `CategoryInput.tsx`, `MerchantEditor.tsx`, `params.ts`, `MerchantsPage.tsx`, `MerchantTable.tsx`, `MerchantCards.tsx`, `MerchantActionBar.tsx`, `SetCategorySheet.tsx`.
- Modify `frontend/src/App.tsx`, `frontend/src/TopBar.tsx`.
- Tests under `frontend/src/__tests__/lib/` and `frontend/src/__tests__/merchants/` (new), plus existing transactions tests.

Docs: `docs/WEB_PORT_PLAN.md`.

---

### Task 1: Shared re-point step, set-based update, tags on save

**Files:**
- Modify: `worker/src/services/merchants.ts`
- Test: `worker/src/__tests__/services/merchants.test.ts`, `worker/src/__tests__/db/atomicD1.test.ts`

**Interfaces:**
- Produces:
  - `repointRows(db: Db, rulesAfter: AliasRule[], pattern: string, steps: { before: SQL[]; after: SQL[] }, userId: number): Promise<number>`, exported (Task 2 uses it).
  - `interface MerchantDecision { pattern: string; alias: string; category?: string; tags?: string[] }`
  - `interface MerchantDecisionResult { repointed: number; tagged: number }`
  - `saveMerchantDecision(db, decision, userId): Promise<MerchantDecisionResult>`

- [ ] **Step 1: Write failing tests** (append inside `describe("saving an alias re-points the rows it claims", …)` in `merchants.test.ts`; update the three existing `toEqual({ repointed: N })` assertions there to `toEqual({ repointed: N, tagged: 0 })`)

```ts
  it("adds tags to the live rows that display as the alias, not deleted ones", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-04-12", merchant: "CORNER SHOP 1", amount: 3, deleted: false },
      { date: "2026-04-13", merchant: "CORNER SHOP 2", amount: 4, deleted: false },
      { date: "2026-04-14", merchant: "CORNER SHOP 3", amount: 5, deleted: true },
      { date: "2026-04-14", merchant: "OTHER PLACE", amount: 5, deleted: false },
    ], []);
    const result = await saveMerchantDecision(db, { pattern: "CORNER\\s+SHOP", alias: "Corner Shop", tags: ["Local", "local"] }, USER);
    expect(result).toEqual({ repointed: 3, tagged: 2 });
    const tagged = sqlite.prepare(`
      SELECT t.merchant_raw AS raw FROM transaction_tags tt
      JOIN transactions t ON t.id = tt.transaction_id JOIN tags g ON g.id = tt.tag_id
      WHERE g.name = 'local' ORDER BY t.id
    `).all();
    expect(tagged).toEqual([{ raw: "CORNER SHOP 1" }, { raw: "CORNER SHOP 2" }]);
    sqlite.close();
  });

  it("tags rows already under the alias even when nothing moves", async () => {
    const rules = [["CORNER", "Corner Shop"]];
    const { sqlite, db } = store(rules);
    seed(sqlite, [{ date: "2026-04-12", merchant: "CORNER SHOP 1", amount: 3, deleted: false }], rules);
    expect(await saveMerchantDecision(db, { pattern: "CORNER", alias: "Corner Shop", tags: ["local"] }, USER))
      .toEqual({ repointed: 0, tagged: 1 });
    sqlite.close();
  });
```

And in `atomicD1.test.ts`, inside `describe("write services on the D1 driver", …)` (add `saveMerchantDecision` to an import from `../../services/merchants`, `importTransactions` to the transactions import):

```ts
  it("saves a merchant decision: rule, category, re-point and tags", async () => {
    const { sqlite, db } = d1Store();
    seed(sqlite, [
      { date: "2026-03-01", merchant: "CAFE ONE", amount: 4, deleted: false },
      { date: "2026-03-01", merchant: "CAFE TWO", amount: 4, deleted: false },
    ], []);
    const result = await saveMerchantDecision(db, { pattern: "^CAFE", alias: "Cafe", category: "Eating out", tags: ["coffee"] }, USER);
    expect(result).toEqual({ repointed: 2, tagged: 2 });
    expect(sqlite.prepare(`
      SELECT m.canonical_name AS m, t.occurrence AS o FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id ORDER BY t.id
    `).all()).toEqual([{ m: "Cafe", o: 0 }, { m: "Cafe", o: 1 }]);
    expect(tagsOf(sqlite, 1)).toEqual(["coffee"]);
    sqlite.close();
  });

  it("imports, deduplicating against what is stored", async () => {
    const { sqlite, db } = d1Store();
    const rows = [{ date: "2026-03-01", merchant: "CAFE ONE", amountCents: 400 }];
    expect(await importTransactions(db, rows, { source: "Test", userId: USER })).toMatchObject({ inserted: 1 });
    expect(await importTransactions(db, rows, { source: "Test", userId: USER })).toMatchObject({ inserted: 0, duplicates: 1 });
    sqlite.close();
  });
```

- [ ] **Step 2: Run them; expect failures**

Run: `cd worker && npx vitest run src/__tests__/services/merchants.test.ts src/__tests__/db/atomicD1.test.ts`
Expected: FAIL: `tagged` missing from results (the import test may already pass; that is fine, it guards the D1 path).

- [ ] **Step 3: Implement.** In `merchants.ts`, replace everything from `export interface MerchantDecision` to the end of the file with:

```ts
export interface MerchantDecision {
  pattern: string;
  /** The canonical name matching rows will display as. */
  alias: string;
  /** Set on the alias's merchant. Omit to leave its category alone. */
  category?: string;
  /** Added to the live rows that display as the alias once saved. */
  tags?: string[];
}

export interface MerchantDecisionResult {
  /** Rows, live or deleted, now pointing at a different merchant. */
  repointed: number;
  /** Live rows under the alias the tags were added to; 0 with no tags. */
  tagged: number;
}

/**
 * Move every row `pattern` matches whose name `rulesAfter` changes, in one
 * atomic batch with `steps.before` ahead of the move and `steps.after` behind.
 *
 * Only rows the pattern matches can change name (see previewAliasChange). A
 * live row moving to another merchant needs an occurrence free at its new
 * identity, above every live row that stays put there; deleted rows keep
 * theirs. Returns how many rows moved.
 */
export async function repointRows(
  db: Db, rulesAfter: AliasRule[], pattern: string, steps: { before: SQL[]; after: SQL[] }, userId: number,
): Promise<number> {
  const table = compileAliases(rulesAfter);
  const rows = await db
    .select({
      id: transactions.id,
      raw: transactions.merchantRaw,
      merchant: merchants.canonicalName,
      date: transactions.date,
      cents: transactions.amountCents,
      occurrence: transactions.occurrence,
      deleted: sql<number>`${transactions.deletedAt} IS NOT NULL`.mapWith(Boolean),
    })
    .from(transactions)
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .orderBy(asc(transactions.id));

  const edited = new RegExp(pattern, "i");
  const moves = rows
    .filter((row) => edited.test(row.raw))
    .map((row) => ({ ...row, to: resolveMerchantName(row.raw, table) }))
    .filter((row) => row.to !== row.merchant);
  const movingIds = new Set(moves.map((m) => m.id));

  const keyOf = (date: number, merchant: string | null, cents: number) =>
    JSON.stringify([date, merchant, cents]);
  const next = new Map<string, number>();
  for (const row of rows) {
    if (row.deleted || movingIds.has(row.id)) continue;
    const key = keyOf(row.date, row.merchant, row.cents);
    next.set(key, Math.max(next.get(key) ?? 0, row.occurrence + 1));
  }
  const payload = JSON.stringify(moves.map((move) => {
    let occurrence = move.occurrence;
    if (!move.deleted) {
      const key = keyOf(move.date, move.to, move.cents);
      occurrence = next.get(key) ?? 0;
      next.set(key, occurrence + 1);
    }
    return { id: move.id, merchant: move.to, occurrence };
  }));
  const names = JSON.stringify([...new Set(moves.map((m) => m.to))]);

  await atomic(db, [
    ...steps.before,
    ...(moves.length ? [
      sql`INSERT OR IGNORE INTO merchants (canonical_name) SELECT value FROM json_each(${names})`,
      // Park the moving rows first. The unique index is checked row by row, so
      // a row arriving at an identity could otherwise meet one not yet gone.
      sql`
        UPDATE transactions SET occurrence = -id
        WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${payload}))
      `,
      // One join, not a subquery per row: correlated json_each is quadratic.
      sql`
        UPDATE transactions
        SET merchant_id = j.merchant_id, occurrence = j.occurrence,
            updated_at = unixepoch(), updated_by = ${userId}
        FROM (
          SELECT json_extract(e.value, '$.id') AS id, m.id AS merchant_id,
                 json_extract(e.value, '$.occurrence') AS occurrence
          FROM json_each(${payload}) e
          JOIN merchants m ON m.canonical_name = json_extract(e.value, '$.merchant')
        ) AS j
        WHERE transactions.id = j.id
      `,
    ] : []),
    ...steps.after,
  ]);
  return moves.length;
}

/**
 * apply_merchant_decision, saved: the rule, the alias's category, every
 * transaction whose name the new table changes, and the tags.
 *
 * The old merchant is left in place with its category, as the Python left the
 * old category key: another rule may still resolve to it.
 */
export async function saveMerchantDecision(
  db: Db, decision: MerchantDecision, userId: number,
): Promise<MerchantDecisionResult> {
  const { pattern, alias, category } = decision;
  if (!pattern.trim()) throw new Error("a merchant rule needs a pattern");
  if (!alias.trim()) throw new Error("a merchant rule needs an alias");
  checkPattern(pattern);
  const tags = normalizeTags(decision.tags ?? []);

  const rules = await loadAliasRules(db);
  const aliasId = sql`(SELECT id FROM merchants WHERE canonical_name = ${alias})`;
  const isNew = !rules.some((r) => r.pattern === pattern);
  const tagList = JSON.stringify(tags);

  const before: SQL[] = [
    sql`INSERT OR IGNORE INTO merchants (canonical_name) VALUES (${alias})`,
    ...(category ? [
      sql`INSERT OR IGNORE INTO categories (name) VALUES (${category})`,
      sql`
        UPDATE merchants
        SET category_id = (SELECT id FROM categories WHERE name = ${category}),
            category_suggested = 0, category_set_by = ${userId}, category_set_at = unixepoch()
        WHERE canonical_name = ${alias}
      `,
    ] : []),
    isNew
      ? sql`
        INSERT INTO merchant_aliases (pattern, priority, merchant_id, created_by)
        VALUES (${pattern}, (SELECT COALESCE(MAX(priority), -1) + 1 FROM merchant_aliases), ${aliasId}, ${userId})
      `
      : sql`UPDATE merchant_aliases SET merchant_id = ${aliasId} WHERE pattern = ${pattern}`,
  ];
  // Runs after the move, so it sees the rows that just arrived at the alias.
  const after: SQL[] = tags.length ? [
    sql`INSERT OR IGNORE INTO tags (name) SELECT value FROM json_each(${tagList})`,
    sql`
      INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, tagged_by)
      SELECT t.id, g.id, ${userId}
      FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id AND m.canonical_name = ${alias}
      JOIN tags g ON g.name IN (SELECT value FROM json_each(${tagList}))
      WHERE t.deleted_at IS NULL
    `,
  ] : [];

  const repointed = await repointRows(db, withRule(rules, pattern, alias), pattern, { before, after }, userId);
  let tagged = 0;
  if (tags.length) {
    const [row] = await db
      .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(transactions)
      .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
      .where(and(eq(merchants.canonicalName, alias), isNull(transactions.deletedAt)));
    tagged = row.n;
  }
  return { repointed, tagged };
}
```

Update the imports at the top of `merchants.ts`:

```ts
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { atomic } from "../db/atomic";
import { categories, merchants, transactions } from "../db/schema";
import type { Db } from "../db/types";
import {
  compileAliases, resolveMerchantName, type AliasRule,
} from "../domain/merchants";
import { normalizeTags } from "../domain/tags";
import { loadAliasRules } from "./transactions";
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `cd worker && npx vitest run src/__tests__/services/merchants.test.ts src/__tests__/db/atomicD1.test.ts && npm run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
jj desc -m "Share the merchant re-point step and tag rows on save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Delete a rule, set a merchant's category

**Files:**
- Modify: `worker/src/services/merchants.ts`
- Test: `worker/src/__tests__/services/merchants.test.ts`, `worker/src/__tests__/db/atomicD1.test.ts`

**Interfaces:**
- Consumes: `repointRows` (Task 1).
- Produces:
  - `class UnknownRuleError extends Error`
  - `deleteMerchantRule(db: Db, ruleId: number, userId: number): Promise<{ repointed: number }>`, throwing `UnknownRuleError` for an id that does not exist
  - `setMerchantCategory(db: Db, merchantIds: number[], category: string | null, userId: number): Promise<{ updated: number }>`

- [ ] **Step 1: Write failing tests** (new `describe` blocks in `merchants.test.ts`; import `deleteMerchantRule, setMerchantCategory, UnknownRuleError` from `../../services/merchants`)

```ts
const ruleId = (sqlite: Database.Database, pattern: string) =>
  (sqlite.prepare(`SELECT id FROM merchant_aliases WHERE pattern = ?`).get(pattern) as { id: number }).id;

describe("deleting a rule", () => {
  const rules = [["^CAFE ONE$", "Cafe One"], ["^CAFE", "Cafe"]];
  function cafes() {
    const s = store(rules);
    seed(s.sqlite, [
      { date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: false },
      { date: "2026-04-12", merchant: "CAFE TWO", amount: 4, deleted: false },
      { date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: true },
    ], rules);
    return s;
  }

  it("lets a later rule take over, with a free occurrence", async () => {
    const { sqlite, db } = cafes();
    expect(await deleteMerchantRule(db, ruleId(sqlite, "^CAFE ONE$"), USER)).toEqual({ repointed: 2 });
    expect((await loadAliasRules(db)).map((r) => r.pattern)).toEqual(["^CAFE"]);
    expect(sqlite.prepare(`
      SELECT t.id, m.canonical_name AS m, t.occurrence AS o FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id ORDER BY t.id
    `).all()).toEqual([
      { id: 1, m: "Cafe", o: 1 },
      { id: 2, m: "Cafe", o: 0 },
      { id: 3, m: "Cafe", o: 0 }, // deleted rows keep their occurrence
    ]);
    sqlite.close();
  });

  it("deleting the only rule creates the raw-name merchants", async () => {
    const only = [["^CORNER", "Corner Shop"]];
    const { sqlite, db } = store(only);
    seed(sqlite, [{ date: "2026-04-12", merchant: "CORNER SHOP 12/04 7", amount: 3, deleted: false }], only);
    expect(await deleteMerchantRule(db, ruleId(sqlite, "^CORNER"), USER)).toEqual({ repointed: 1 });
    expect(merchantOf(sqlite, 1)).toBe("CORNER SHOP");
    // The merchant the rule pointed at stays, as another rule may still use it.
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM merchants WHERE canonical_name = 'Corner Shop'`).get()).toEqual({ n: 1 });
    sqlite.close();
  });

  it("refuses an id that is not a rule, changing nothing", async () => {
    const { sqlite, db } = cafes();
    await expect(deleteMerchantRule(db, 999, USER)).rejects.toBeInstanceOf(UnknownRuleError);
    expect(await loadAliasRules(db)).toHaveLength(2);
    sqlite.close();
  });
});

describe("setting merchant categories", () => {
  it("sets, creating the category, and clears the suggestion flag", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: false },
      { date: "2026-04-12", merchant: "CAFE TWO", amount: 4, deleted: false },
    ], []);
    sqlite.exec(`UPDATE merchants SET category_suggested = 1`);
    expect(await setMerchantCategory(db, [1, 2, 99], "Eating out", USER)).toEqual({ updated: 2 });
    expect(sqlite.prepare(`
      SELECT m.canonical_name AS m, c.name AS c, m.category_suggested AS s, m.category_set_by AS by
      FROM merchants m JOIN categories c ON c.id = m.category_id ORDER BY m.id
    `).all()).toEqual([
      { m: "CAFE ONE", c: "Eating out", s: 0, by: USER },
      { m: "CAFE TWO", c: "Eating out", s: 0, by: USER },
    ]);
    sqlite.close();
  });

  it("trims the category name and reuses an existing one", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: false }], []);
    categorise(sqlite, { "CAFE ONE": "Eating out" });
    await setMerchantCategory(db, [1], "  Eating out ", USER);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM categories`).get()).toEqual({ n: 1 });
    sqlite.close();
  });

  it("clears with null", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: false }], []);
    categorise(sqlite, { "CAFE ONE": "Eating out" });
    expect(await setMerchantCategory(db, [1], null, USER)).toEqual({ updated: 1 });
    expect(sqlite.prepare(`SELECT category_id AS c FROM merchants WHERE id = 1`).get()).toEqual({ c: null });
    sqlite.close();
  });
});
```

In `atomicD1.test.ts` (import `deleteMerchantRule, setMerchantCategory`):

```ts
  it("deletes a rule and sets a category", async () => {
    const { sqlite, db } = d1Store();
    sqlite.exec(`INSERT INTO merchants (canonical_name) VALUES ('Cafe')`);
    sqlite.exec(`INSERT INTO merchant_aliases (pattern, priority, merchant_id) VALUES ('^CAFE', 0, 1)`);
    seed(sqlite, [{ date: "2026-03-01", merchant: "CAFE ONE", amount: 4, deleted: false }], [["^CAFE", "Cafe"]]);
    expect(await deleteMerchantRule(db, 1, USER)).toEqual({ repointed: 1 });
    const id = (sqlite.prepare(`SELECT merchant_id AS m FROM transactions WHERE id = 1`).get() as { m: number }).m;
    expect(await setMerchantCategory(db, [id], "Eating out", USER)).toEqual({ updated: 1 });
    expect(sqlite.prepare(`SELECT category FROM v_live WHERE id = 1`).get()).toEqual({ category: "Eating out" });
    sqlite.close();
  });
```

- [ ] **Step 2: Run; expect FAIL** (`deleteMerchantRule` is not exported)

Run: `cd worker && npx vitest run src/__tests__/services/merchants.test.ts src/__tests__/db/atomicD1.test.ts`

- [ ] **Step 3: Implement** (append to `merchants.ts`; add `inArray` to the drizzle import and `merchantAliases` to the schema import)

```ts
export class UnknownRuleError extends Error {
  constructor(id: number) {
    super(`There is no merchant rule ${id}`);
    this.name = "UnknownRuleError";
  }
}

/**
 * Drop one rule and re-point the rows it decided: to the next rule that
 * matches, or to their own normalised names. The merchant it pointed at stays,
 * with its category, since another rule may still resolve to it.
 */
export async function deleteMerchantRule(db: Db, ruleId: number, userId: number): Promise<{ repointed: number }> {
  const [rule] = await db.select({ pattern: merchantAliases.pattern })
    .from(merchantAliases).where(eq(merchantAliases.id, ruleId));
  if (!rule) throw new UnknownRuleError(ruleId);
  const rules = (await loadAliasRules(db)).filter((r) => r.pattern !== rule.pattern);
  const repointed = await repointRows(db, rules, rule.pattern, {
    before: [sql`DELETE FROM merchant_aliases WHERE id = ${ruleId}`],
    after: [],
  }, userId);
  return { repointed };
}

/** The Merchants page's bulk assign. Null clears; a new name is created. */
export async function setMerchantCategory(
  db: Db, merchantIds: number[], category: string | null, userId: number,
): Promise<{ updated: number }> {
  const ids = [...new Set(merchantIds)];
  if (ids.length === 0) return { updated: 0 };
  const found = await db.select({ id: merchants.id }).from(merchants).where(inArray(merchants.id, ids));
  if (found.length === 0) return { updated: 0 };
  const name = category?.trim() || null;
  const idList = JSON.stringify(found.map((r) => r.id));
  await atomic(db, [
    ...(name ? [sql`INSERT OR IGNORE INTO categories (name) VALUES (${name})`] : []),
    sql`
      UPDATE merchants
      SET category_id = ${name ? sql`(SELECT id FROM categories WHERE name = ${name})` : sql`NULL`},
          category_suggested = 0, category_set_by = ${userId}, category_set_at = unixepoch()
      WHERE id IN (SELECT value FROM json_each(${idList}))
    `,
  ]);
  return { updated: found.length };
}
```

Note: `loadAliasRules` keeps rules ordered by priority, so filtering one out keeps the others' order.

- [ ] **Step 4: Run; expect PASS**

Run: `cd worker && npx vitest run src/__tests__/services/merchants.test.ts src/__tests__/db/atomicD1.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "Delete merchant rules and set merchant categories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Run `jj new` first only if `@` already holds Task 1; check with `jj st`.)

---

### Task 3: Merchant list, rule lookup, essential categories in lookups

**Files:**
- Create: `worker/src/api/merchants.ts`, `worker/src/queries/merchants.ts`
- Modify: `worker/src/api/transactions.ts` (`LookupsResponse`), `worker/src/queries/transactions.ts` (`listLookups`)
- Test: `worker/src/__tests__/queries/merchants.test.ts` (new); extend the lookups test wherever `listLookups` is tested today (`grep -rn listLookups worker/src/__tests__`)

**Interfaces:**
- Produces, in `worker/src/api/merchants.ts` (no runtime imports; `import type { BudgetKind, TransactionType } from "./transactions"` only):

```ts
import type { BudgetKind, TransactionType } from "./transactions";

export interface MerchantRule { id: number; pattern: string }

export interface MerchantRow {
  id: number;
  name: string;
  /** Null: no category, so it counts as "Other". */
  category: string | null;
  /** Anything not essential is discretionary, as on Transactions. */
  budget: BudgetKind;
  /** Gemini proposed the category and nobody confirmed it. */
  suggested: boolean;
  /** Live rows only. */
  count: number;
  /** Income minus expenses, in cents: a shop is negative. */
  totalCents: number;
  /** YYYY-MM-DD of the newest live row; null when it has none. */
  lastDate: string | null;
  /** income when most of its live rows are income. */
  type: TransactionType;
  /** Priority order. */
  rules: MerchantRule[];
}

export interface MerchantsResponse { merchants: MerchantRow[] }

/** The rule deciding a raw name today, and the merchant it lands on. */
export interface RuleLookupResponse { rule: MerchantRule | null; merchant: string; category: string | null }

export interface AliasPreviewResponse {
  matched: number;
  totalCents: number;
  currentCategories: Record<string, number>;
  merchants: Record<string, number>;
  error?: string;
}

export interface DecisionRequest { pattern: string; alias: string; category?: string; tags?: string[] }
export interface DecisionResponse { repointed: number; tagged: number }
export interface RuleDeletedResponse { repointed: number }
export interface MerchantCategoryRequest { ids: number[]; category: string | null }
export interface MerchantCategoryResponse { updated: number }
```

- `LookupsResponse` gains `essentialCategories: string[]` (sorted names whose `spending_type` is `essential`).
- `listMerchants(db: Db): Promise<MerchantRow[]>`; `ruleFor(db: Db, raw: string): Promise<RuleLookupResponse>`.

- [ ] **Step 1: Write failing tests** in new `worker/src/__tests__/queries/merchants.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { listMerchants, ruleFor } from "../../queries/merchants";
import { listLookups } from "../../queries/transactions";
import { saveMerchantDecision } from "../../services/merchants";
import { USER, categorise, seed, store } from "../helpers/store";

const rules = [["^CAFE", "Cafe"], ["CAFE\\s+ANNEX", "Cafe"]];

function cafes() {
  const s = store(rules);
  seed(s.sqlite, [
    { date: "2026-04-10", merchant: "CAFE ONE", amount: 4, deleted: false },
    { date: "2026-04-12", merchant: "CAFE TWO", amount: 6, deleted: false },
    { date: "2026-04-20", merchant: "CAFE ONE", amount: 50, deleted: true },
    { date: "2026-04-11", merchant: "EMPLOYER PAY", amount: 1000, deleted: false },
  ], rules);
  s.sqlite.exec(`UPDATE transactions SET type = 'income' WHERE merchant_raw = 'EMPLOYER PAY'`);
  s.sqlite.exec(`INSERT INTO merchants (canonical_name) VALUES ('Unused')`);
  categorise(s.sqlite, { Cafe: "Eating out" });
  s.sqlite.exec(`UPDATE categories SET spending_type = 'essential' WHERE name = 'Eating out'`);
  return s;
}

describe("listMerchants", () => {
  it("counts live rows only, signs totals, and lists rules in priority order", async () => {
    const { sqlite, db } = cafes();
    const list = await listMerchants(db);
    expect(list.map((m) => m.name).sort()).toEqual(["Cafe", "EMPLOYER PAY"]);
    const cafe = list.find((m) => m.name === "Cafe")!;
    expect(cafe).toMatchObject({
      category: "Eating out", budget: "essential", suggested: false,
      count: 2, totalCents: -1000, lastDate: "2026-04-12", type: "expense",
    });
    expect(cafe.rules.map((r) => r.pattern)).toEqual(["^CAFE", "CAFE\\s+ANNEX"]);
    expect(list.find((m) => m.name === "EMPLOYER PAY")).toMatchObject({
      category: null, budget: "discretionary", count: 1, totalCents: 100000, type: "income", rules: [],
    });
    sqlite.close();
  });

  it("keeps a merchant that has a rule but no rows", async () => {
    const { sqlite, db } = cafes();
    sqlite.exec(`INSERT INTO merchant_aliases (pattern, priority, merchant_id) SELECT 'NOTHING', 9, id FROM merchants WHERE canonical_name = 'Unused'`);
    expect((await listMerchants(db)).find((m) => m.name === "Unused"))
      .toMatchObject({ count: 0, totalCents: 0, lastDate: null, rules: [{ pattern: "NOTHING" }] });
    sqlite.close();
  });

  it("a merchant keeps both rules after a pattern is retyped", async () => {
    const { sqlite, db } = cafes();
    await saveMerchantDecision(db, { pattern: "^CAFE\\s", alias: "Cafe" }, USER);
    expect((await listMerchants(db)).find((m) => m.name === "Cafe")!.rules.map((r) => r.pattern))
      .toEqual(["^CAFE", "CAFE\\s+ANNEX", "^CAFE\\s"]);
    sqlite.close();
  });
});

describe("ruleFor", () => {
  it("answers the first matching rule and its merchant", async () => {
    const { sqlite, db } = cafes();
    const found = await ruleFor(db, "CAFE ANNEX 3");
    expect(found).toMatchObject({ merchant: "Cafe", category: "Eating out", rule: { pattern: "^CAFE" } });
    expect(typeof found.rule?.id).toBe("number");
    sqlite.close();
  });

  it("answers no rule, the normalised name, and its category for an unmatched name", async () => {
    const { sqlite, db } = cafes();
    expect(await ruleFor(db, "EMPLOYER PAY 01/04 2")).toEqual({ rule: null, merchant: "EMPLOYER PAY", category: null });
    sqlite.close();
  });
});

describe("lookups", () => {
  it("lists the essential categories", async () => {
    const { sqlite, db } = cafes();
    expect((await listLookups(db)).essentialCategories).toEqual(["Eating out"]);
    sqlite.close();
  });
});
```

- [ ] **Step 2: Run; expect FAIL** (module missing)

Run: `cd worker && npx vitest run src/__tests__/queries/merchants.test.ts`

- [ ] **Step 3: Implement.** Create `worker/src/api/merchants.ts` with the block in Interfaces. Add `essentialCategories: string[];` to `LookupsResponse` in `api/transactions.ts`. In `listLookups` add:

```ts
  const essential = await db.select({ name: categories.name }).from(categories)
    .where(eq(categories.spendingType, "essential")).orderBy(asc(categories.name));
```

and `essentialCategories: essential.map((r) => r.name),` in its return.

Create `worker/src/queries/merchants.ts`:

```ts
/**
 * The Merchants page: one row per merchant that has live transactions or a
 * rule, with its own category (not per-row overrides) and its rules in the
 * order they are tried. And the rule deciding a raw name, for the editor.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { MerchantRow, RuleLookupResponse } from "../api/merchants";
import { categories, merchantAliases, merchants, transactions } from "../db/schema";
import type { Db } from "../db/types";
import { compileAliases, resolveMerchantName } from "../domain/merchants";
import { loadAliasRules } from "../services/transactions";

export async function listMerchants(db: Db): Promise<MerchantRow[]> {
  const totals = await db
    .select({
      id: merchants.id,
      name: merchants.canonicalName,
      category: categories.name,
      spendingType: categories.spendingType,
      suggested: merchants.categorySuggested,
      count: sql<number>`COUNT(${transactions.id})`.mapWith(Number),
      totalCents: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'income'
        THEN ${transactions.amountCents} ELSE -${transactions.amountCents} END), 0)`.mapWith(Number),
      income: sql<number>`COALESCE(SUM(${transactions.type} = 'income'), 0)`.mapWith(Number),
      lastDate: sql<string | null>`date(MAX(${transactions.date}), 'unixepoch')`,
    })
    .from(merchants)
    .leftJoin(categories, eq(categories.id, merchants.categoryId))
    .leftJoin(transactions, and(eq(transactions.merchantId, merchants.id), isNull(transactions.deletedAt)))
    .groupBy(merchants.id);

  const rules = await db
    .select({ id: merchantAliases.id, pattern: merchantAliases.pattern, merchantId: merchantAliases.merchantId })
    .from(merchantAliases)
    .orderBy(asc(merchantAliases.priority), asc(merchantAliases.id));
  const byMerchant = new Map<number, { id: number; pattern: string }[]>();
  for (const r of rules) {
    const list = byMerchant.get(r.merchantId) ?? [];
    list.push({ id: r.id, pattern: r.pattern });
    byMerchant.set(r.merchantId, list);
  }

  return totals
    .filter((m) => m.count > 0 || byMerchant.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      budget: m.spendingType === "essential" ? "essential" : "discretionary",
      suggested: m.suggested,
      count: m.count,
      totalCents: m.totalCents,
      lastDate: m.lastDate,
      type: m.income * 2 > m.count ? "income" : "expense",
      rules: byMerchant.get(m.id) ?? [],
    }));
}

export async function ruleFor(db: Db, raw: string): Promise<RuleLookupResponse> {
  const rules = await loadAliasRules(db);
  const compiled = compileAliases(rules);
  const hit = compiled.find((r) => r.regex.test(raw));
  const merchant = resolveMerchantName(raw, compiled);
  let rule = null;
  if (hit) {
    const [row] = await db.select({ id: merchantAliases.id }).from(merchantAliases)
      .where(eq(merchantAliases.pattern, hit.pattern));
    rule = { id: row.id, pattern: hit.pattern };
  }
  const [cat] = await db.select({ name: categories.name }).from(merchants)
    .innerJoin(categories, eq(categories.id, merchants.categoryId))
    .where(eq(merchants.canonicalName, merchant));
  return { rule, merchant, category: cat?.name ?? null };
}
```

Fix any frontend type errors the new required `essentialCategories` field causes: in `frontend/src/__tests__/transactions/pageHarness.tsx` the default lookups object gets `essentialCategories: []`. Search: `grep -rn "categories: \[" frontend/src/__tests__`.

- [ ] **Step 4: Run; expect PASS**

Run: `cd worker && npx vitest run && npm run typecheck && cd ../frontend && npx tsc -b`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "List merchants and look up the rule deciding a raw name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Merchant routes

**Files:**
- Create: `worker/src/routes/merchants.ts`
- Modify: `worker/src/app.ts`
- Test: `worker/src/__tests__/app/merchantsRoute.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 1–3 services, queries and `api/merchants.ts` types.
- Produces routes (mounted at `/api`):
  - `GET /merchants` → `MerchantsResponse`
  - `GET /merchants/rule?raw=` → `RuleLookupResponse` (400 `{error}` when `raw` is missing or blank)
  - `GET /merchants/preview?pattern=&alias=` → `AliasPreviewResponse`
  - `POST /merchants/decision` `DecisionRequest` → `DecisionResponse`
  - `POST /merchants/rules/:id/delete` → `RuleDeletedResponse`; 404 `{error: "This rule no longer exists."}`
  - `POST /merchants/category` `MerchantCategoryRequest` → `MerchantCategoryResponse`

- [ ] **Step 1: Write failing tests** in `merchantsRoute.test.ts` (setup copied from `transactionEdits.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import { categorise, seed, store } from "../helpers/store";

const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

function setup() {
  const rules = [["^CAFE", "Cafe"]];
  const s = store(rules);
  seed(s.sqlite, [
    { date: "2026-03-01", merchant: "CAFE ONE", amount: 4, deleted: false },
    { date: "2026-03-02", merchant: "CORNER SHOP", amount: 10, deleted: false },
  ], rules);
  categorise(s.sqlite, { Cafe: "Eating out" });
  const app = createApp(() => s.db);
  const send = (method: string, path: string, body?: unknown, origin: string | null = "http://localhost") =>
    app.request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...(origin && { origin }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  return { ...s, send };
}

describe("merchant reads", () => {
  it("lists merchants", async () => {
    const { send } = setup();
    const res = await send("GET", "/api/merchants");
    expect(res.status).toBe(200);
    const { merchants } = await res.json() as { merchants: { name: string }[] };
    expect(merchants.map((m) => m.name).sort()).toEqual(["CORNER SHOP", "Cafe"]);
  });

  it("looks up the rule for a raw name, refusing a blank one", async () => {
    const { send } = setup();
    expect(await (await send("GET", "/api/merchants/rule?raw=CAFE%20TWO")).json())
      .toMatchObject({ merchant: "Cafe", rule: { pattern: "^CAFE" }, category: "Eating out" });
    expect((await send("GET", "/api/merchants/rule?raw=%20")).status).toBe(400);
  });

  it("previews, reporting a bad pattern in the body", async () => {
    const { send } = setup();
    expect(await (await send("GET", "/api/merchants/preview?pattern=CORNER&alias=Corner")).json())
      .toMatchObject({ matched: 1, totalCents: 1000 });
    const bad = await (await send("GET", "/api/merchants/preview?pattern=%5Bbad&alias=X")).json() as { error?: string };
    expect(bad.error).toBeTruthy();
  });
});

describe("merchant writes", () => {
  it("refuses a write from another site", async () => {
    const { send } = setup();
    expect((await send("POST", "/api/merchants/category", { ids: [1], category: "X" }, "https://evil.example")).status).toBe(403);
  });

  it("saves a decision", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/merchants/decision", { pattern: "CORNER", alias: "Corner Shop", category: "Groceries", tags: ["local"] });
    expect(await res.json()).toEqual({ repointed: 1, tagged: 1 });
  });

  it("answers 400 with the regex message, and for a blank alias", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/merchants/decision", { pattern: "[bad", alias: "X" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/pattern/i);
    expect((await send("POST", "/api/merchants/decision", { pattern: "CORNER", alias: " " })).status).toBe(400);
  });

  it("deletes a rule, and answers 404 the second time", async () => {
    const { send, sqlite } = setup();
    const { id } = sqlite.prepare(`SELECT id FROM merchant_aliases`).get() as { id: number };
    expect(await (await send("POST", `/api/merchants/rules/${id}/delete`)).json()).toEqual({ repointed: 1 });
    expect((await send("POST", `/api/merchants/rules/${id}/delete`)).status).toBe(404);
    expect((await send("POST", `/api/merchants/rules/abc/delete`)).status).toBe(400);
  });

  it("sets and clears categories", async () => {
    const { send } = setup();
    expect(await (await send("POST", "/api/merchants/category", { ids: [1, 2], category: "Food" })).json()).toEqual({ updated: 2 });
    expect(await (await send("POST", "/api/merchants/category", { ids: [1], category: null })).json()).toEqual({ updated: 1 });
    expect((await send("POST", "/api/merchants/category", { ids: [], category: "Food" })).status).toBe(400);
  });
});
```

Note: `POST /rules/:id/delete` has no body; the Origin check still applies, and `send` sets the Origin header.

- [ ] **Step 2: Run; expect FAIL** (404s)

Run: `cd worker && npx vitest run src/__tests__/app/merchantsRoute.test.ts`

- [ ] **Step 3: Implement** `worker/src/routes/merchants.ts`

```ts
/**
 * The merchant editor and the Merchants page: list, rule lookup, preview, and
 * the writes. Parse with zod, call the service, answer with counts. Every 400
 * carries a message the screen shows as is.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import type {
  DecisionResponse, MerchantCategoryResponse, MerchantsResponse, RuleDeletedResponse,
} from "../api/merchants";
import { listMerchants, ruleFor } from "../queries/merchants";
import {
  deleteMerchantRule, previewAliasChange, saveMerchantDecision, setMerchantCategory, UnknownRuleError,
} from "../services/merchants";

const Decision = z.object({
  pattern: z.string().trim().min(1, "Enter a pattern"),
  alias: z.string().trim().min(1, "Enter a display name"),
  category: z.string().trim().min(1).optional(),
  tags: z.array(z.string()).optional(),
}).strict().superRefine((d, ctx) => {
  try { new RegExp(d.pattern, "i"); } catch (e) {
    ctx.addIssue({ code: "custom", message: `Invalid pattern: ${e instanceof Error ? e.message : String(e)}` });
  }
});

const CategoryBody = z.object({
  ids: z.array(z.number().int().positive("ids must be positive whole numbers"))
    .min(1, "Choose at least one merchant").max(10_000, "At most 10,000 merchants at once"),
  category: z.string().trim().min(1, "Category cannot be empty").nullable(),
}).strict();

type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { return { ok: false, error: "The request body must be JSON" }; }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: parsed.error.issues[0].message };
}

export function merchantRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/merchants", async (c) =>
    c.json({ merchants: await listMerchants(c.get("db")) } satisfies MerchantsResponse));

  routes.get("/merchants/rule", async (c) => {
    const raw = c.req.query("raw") ?? "";
    if (!raw.trim()) return c.json({ error: "Give the statement text" }, 400);
    return c.json(await ruleFor(c.get("db"), raw));
  });

  routes.get("/merchants/preview", async (c) =>
    c.json(await previewAliasChange(c.get("db"), c.req.query("pattern") ?? "", c.req.query("alias") ?? "")));

  routes.post("/merchants/decision", async (c) => {
    const body = await parseBody(c, Decision);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const result = await saveMerchantDecision(c.get("db"), body.data, c.get("user").id);
    return c.json(result satisfies DecisionResponse);
  });

  routes.post("/merchants/rules/:id/delete", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not a rule id" }, 400);
    try {
      return c.json(await deleteMerchantRule(c.get("db"), id, c.get("user").id) satisfies RuleDeletedResponse);
    } catch (e) {
      if (e instanceof UnknownRuleError) return c.json({ error: "This rule no longer exists." }, 404);
      throw e;
    }
  });

  routes.post("/merchants/category", async (c) => {
    const body = await parseBody(c, CategoryBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const result = await setMerchantCategory(c.get("db"), body.data.ids, body.data.category, c.get("user").id);
    return c.json(result satisfies MerchantCategoryResponse);
  });

  return routes;
}
```

In `app.ts`: `import { merchantRoutes } from "./routes/merchants";` and `app.route("/api", merchantRoutes<B>());` after the transaction edit routes.

- [ ] **Step 4: Run; expect PASS**

Run: `cd worker && npx vitest run && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "Serve the merchant editor and Merchants page from the Worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Delete and tag follow-ups (PR A items 1–5)

**Files:**
- Modify: `worker/src/services/transactions.ts`, `worker/src/routes/transactionEdits.ts`, `worker/src/api/transactions.ts`
- Modify: `frontend/src/transactions/edit/useDeleteFlow.ts`, `DeleteSheet.tsx`, `Editing.tsx`, `frontend/src/transactions/TransactionsPage.tsx`
- Test: `worker/src/__tests__/app/transactionEdits.test.ts`, `worker/src/__tests__/services/transactions.test.ts`, `frontend/src/__tests__/transactions/delete.test.tsx`, `frontend/src/__tests__/transactions/pageHarness.tsx`

**Interfaces:**
- Produces: `softDeleteTransactions(db, ids, userId): Promise<number[]>` (the ids it deleted, ascending); `DeletedResponse` becomes `{ deleted: number; ids: number[] }`; `tagTransactions` counts and tags live rows only; `Editing` takes `onDeselect: (ids: number[]) => void` in place of using `onClearSelection` after a delete; `DeleteSheet` takes `error: string | null` and `onRetry: () => void`.

- [ ] **Step 1: Write failing tests**

Worker, `transactionEdits.test.ts` (replace the first two `expect`s of "deletes and restores" and add a test):

```ts
    expect(await (await send("POST", "/api/transactions/delete", { ids: [1, 2] })).json()).toEqual({ deleted: 2, ids: [1, 2] });
    expect(await (await send("POST", "/api/transactions/delete", { ids: [1, 2] })).json()).toEqual({ deleted: 0, ids: [] });
```

```ts
  it("tags only live rows, and counts only those", async () => {
    const { send, sqlite } = setup();
    await send("POST", "/api/transactions/delete", { ids: [2] });
    expect(await (await send("POST", "/api/transactions/tags", { ids: [1, 2], tags: ["trip"], mode: "add" })).json()).toEqual({ tagged: 1 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transaction_tags WHERE transaction_id = 2`)).toEqual({ n: 0 });
  });
```

Fix every other caller/assertion of `softDeleteTransactions` return value in worker tests (`grep -rn softDeleteTransactions worker/src/__tests__`): a number `n` becomes an array, e.g. `expect(await softDeleteTransactions(...)).toEqual([1, 2])`.

Frontend: in `pageHarness.tsx`, `deleteRoutes` answers delete with `{ deleted, ids }`:

```ts
  "POST /api/transactions/delete": (b) => {
    const ids = idsOf(b).slice(0, opts.deletedCount ?? idsOf(b).length);
    return { body: { deleted: ids.length, ids } };
  },
```

Add to `delete.test.tsx`:

```ts
  it("Undo restores only the rows that were deleted", async () => {
    const { mock } = renderAt(URL_SEPT, api({ deletedCount: 1 }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 of 2 deleted"));
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/restore")).toEqual([{ ids: [3] }]));
  });

  it("shows the confirm total signed, a refund lowering it", async () => {
    const rows = [...many(20), row(99, "2026-09-11", 500, "income")];
    renderAt(URL_SEPT, api({ rows }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete 21 transactions?" })).toHaveTextContent("total −€15.00");
  });

  it("shows a failed confirmed delete inside the sheet, with Retry", async () => {
    let fail = true;
    const { mock } = renderAt(URL_SEPT, api({
      rows: many(21),
      routes: { "POST /api/transactions/delete": (b) => (fail ? { status: 500, body: { error: "boom" } } : { body: { deleted: 21, ids: idsOf(b) } }) },
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    const sheet = screen.getByRole("dialog", { name: "Delete 21 transactions?" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete 21" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("boom");
    fail = false;
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("21 deleted"));
    expect(posted(mock, "/api/transactions/delete")).toHaveLength(2);
  });

  it("deleting one row from its edit sheet keeps the rest of the selection", async () => {
    renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 2/ }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Shop 3" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Edit transaction" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 deleted"));
    expect(bar()).toHaveTextContent("1 selected");
  });
```

Add `const idsOf = (body: unknown) => (body as { ids: number[] }).ids;` at the top of `delete.test.tsx`.

- [ ] **Step 2: Run; expect FAIL**

Run: `cd worker && npx vitest run src/__tests__/app/transactionEdits.test.ts` and `cd frontend && npx vitest run src/__tests__/transactions/delete.test.tsx`

- [ ] **Step 3: Implement**

`softDeleteTransactions`: return type `Promise<number[]>`; `if (ids.length === 0) return [];`, `if (live.length === 0) return [];`, end with `return live.map((r) => r.id).sort((a, b) => a - b);`. Route: `const ids = await softDeleteTransactions(...); return c.json({ deleted: ids.length, ids } satisfies DeletedResponse);`. `DeletedResponse` = `{ deleted: number; ids: number[] }`.

`tagTransactions`: the `found` query adds `isNull(transactions.deletedAt)`:

```ts
  const found = await db.select({ id: transactions.id }).from(transactions)
    .where(and(idsIn(ids), isNull(transactions.deletedAt)));
```

Update its doc comment: soft-deleted rows are neither tagged nor counted.

`useDeleteFlow`: `onDeleted: (ids: number[]) => void`; add `const [error, setError] = useState<string | null>(null);`. In `run`:

```ts
  const run = (ids: number[]) => {
    if (del.isPending) return;
    setError(null);
    del.mutate(ids, {
      onSuccess: ({ deleted, ids: gone }) => {
        setConfirming(null);
        opts.onDeleted(gone);
        const missing = ids.length - deleted;
        opts.notify({
          message: missing > 0 ? `${deleted} of ${ids.length} deleted (${plural(missing)} already gone)` : `${deleted} deleted`,
          action: deleted > 0 ? { label: "Undo", run: () => undo(gone) } : undefined,
        });
      },
      onError: (e) => {
        // A toast cannot show above a modal dialog, so a confirmed delete reports in its sheet.
        if (confirming) setError(`Couldn't delete: ${e.message}`);
        else opts.notify({ message: `Couldn't delete: ${e.message}`, action: { label: "Retry", run: () => run(ids) } });
      },
    });
  };
```

`start` clears `error` when it opens the sheet; `onClose` of the sheet clears it too. Pass `error` and `onRetry: () => confirming && run(confirming)` into `DeleteSheet`.

`DeleteSheet`: signed total and the error:

```tsx
  const net = props.rows.filter((r) => chosen.has(r.id))
    .reduce((a, r) => a + (r.type === "income" ? r.amountCents : -r.amountCents), 0);
  const total = `${net < 0 ? "−" : net > 0 ? "+" : ""}${formatCents(Math.abs(net))}`;
  …
      <p className="text-sm">These {n} transactions total {total}. You can undo this straight after.</p>
      {props.error && (
        <p role="alert" className="text-sm text-expense">
          {props.error}
          <button type="button" onClick={props.onRetry} disabled={props.busy} className="ml-2 underline">Retry</button>
        </p>
      )}
```

`Editing`: add prop `onDeselect: (ids: number[]) => void`; `useDeleteFlow({ …, onDeleted: props.onDeselect })`. `TransactionsPage`: pass

```tsx
          onDeselect={(ids) => setSelected((s) => { const n = new Set(s); for (const id of ids) n.delete(id); return n; })}
```

- [ ] **Step 4: Run; expect PASS**

Run: `cd worker && npx vitest run && npm run typecheck && cd ../frontend && npx vitest run && npx tsc -b`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "Undo only what was deleted and keep delete errors in view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Shared sheet submit hook, TagInput fixes, toast hook

**Files:**
- Create: `frontend/src/lib/useSheetSubmit.tsx`
- Modify: `frontend/src/lib/Toast.tsx`, `frontend/src/transactions/edit/EditSheet.tsx`, `BulkEditSheet.tsx`, `TagSheet.tsx`, `TagInput.tsx`, `Editing.tsx`
- Test: `frontend/src/__tests__/lib/useSheetSubmit.test.tsx` (new), `frontend/src/__tests__/transactions/tags.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface SheetSubmit<V> {
  /** Start the request unless one is running. */
  run: (vars: V) => void;
  /** Show a message without sending anything (form validation). */
  fail: (message: string) => void;
  reset: () => void;
  error: string | null;
  /** True when the request never got an answer, so Retry may work. */
  retryable: boolean;
  pending: boolean;
}
export function useSheetSubmit<V, R>(
  mutation: UseMutationResult<R, Error, V>,
  onSuccess: (result: R, vars: V) => void,
  onError?: (e: Error) => void,
): SheetSubmit<V>;
/** The alert line under a form, with Retry when retryable. */
export function SheetError(props: { submit: SheetSubmit<unknown>; onRetry: () => void }): JSX.Element | null;
```

  - `useToast(): { toast: ToastState | null; notify: (t: Omit<ToastState, "id">) => void; dismiss: () => void }` in `Toast.tsx`.
  - `TagInput` gains `autoFocus?: boolean`.

- [ ] **Step 1: Write failing tests**

`useSheetSubmit.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { SheetError, useSheetSubmit } from "../../lib/useSheetSubmit";

function Probe(props: { fn: (n: number) => Promise<string>; onSuccess: (r: string) => void }) {
  const m = useMutation({ mutationFn: props.fn });
  const s = useSheetSubmit(m, props.onSuccess);
  return (
    <div>
      <button type="button" onClick={() => s.run(7)}>Go</button>
      <button type="button" onClick={() => s.fail("Enter a pattern")}>Fail</button>
      <SheetError submit={s} onRetry={() => s.run(7)} />
    </div>
  );
}

const mount = (fn: (n: number) => Promise<string>, onSuccess = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient()}><Probe fn={fn} onSuccess={onSuccess} /></QueryClientProvider>);
  return onSuccess;
};

describe("useSheetSubmit", () => {
  it("shows an API error as is, without Retry", async () => {
    mount(async () => { throw new ApiError(400, "Invalid pattern: x"); });
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid pattern: x");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("offers Retry after a network failure, and succeeds on it", async () => {
    let fail = true;
    const onSuccess = mount(async () => { if (fail) throw new TypeError("Failed to fetch"); return "ok"; });
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save: Failed to fetch");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("ok", 7));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a validation message without sending", async () => {
    const fn = vi.fn(async () => "ok");
    mount(fn);
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a pattern");
    expect(fn).not.toHaveBeenCalled();
  });
});
```

Add to `tags.test.tsx` (inside `describe("tagging", …)`):

```ts
  it("focuses the tag box when the sheet opens", async () => {
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Tags" })).toHaveFocus();
  });

  it("turns a picked suggestion into a chip at once", async () => {
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog");
    const box = within(sheet).getByRole("combobox", { name: "Tags" });
    // A datalist pick arrives as a plain change, not typed input.
    fireEvent.change(box, { target: { value: "emergency" } });
    expect(within(sheet).getByRole("list", { name: "Chosen tags" })).toHaveTextContent("emergency");
    expect(box).toHaveValue("");
  });

```

And a network failure that Retry recovers from (stub `fetch` to reject the first POST):

```ts
  it("offers Retry when tagging never got an answer", async () => {
    const { mock } = page();
    const real = mock.fetch;
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail && init?.method === "POST") throw new TypeError("Failed to fetch");
      return real(input, init);
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog");
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Tags" }), "trip{Enter}");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add tags" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Couldn't save: Failed to fetch");
    fail = false;
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tagged 2"));
  });
```

(Import `vi` from vitest in `tags.test.tsx`.)

- [ ] **Step 2: Run; expect FAIL**

Run: `cd frontend && npx vitest run src/__tests__/lib/useSheetSubmit.test.tsx src/__tests__/transactions/tags.test.tsx`

- [ ] **Step 3: Implement**

`frontend/src/lib/useSheetSubmit.tsx`:

```tsx
import type { UseMutationResult } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "./api";

export interface SheetSubmit<V> {
  run: (vars: V) => void;
  fail: (message: string) => void;
  reset: () => void;
  error: string | null;
  retryable: boolean;
  pending: boolean;
}

/**
 * What every sheet's Save does: one request at a time, the Worker's message
 * shown as is, and Retry only when the request never got an answer.
 */
export function useSheetSubmit<V, R>(
  mutation: UseMutationResult<R, Error, V>,
  onSuccess: (result: R, vars: V) => void,
  onError?: (e: Error) => void,
): SheetSubmit<V> {
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const reset = () => { setError(null); setRetryable(false); };
  return {
    run: (vars) => {
      if (mutation.isPending) return;
      reset();
      mutation.mutate(vars, {
        onSuccess: (r) => onSuccess(r, vars),
        onError: (e) => {
          setError(e instanceof ApiError ? e.message : `Couldn't save: ${e.message}`);
          setRetryable(!(e instanceof ApiError));
          onError?.(e);
        },
      });
    },
    fail: (message) => { setError(message); setRetryable(false); },
    reset,
    error,
    retryable,
    pending: mutation.isPending,
  };
}

export function SheetError(props: { submit: SheetSubmit<never>; onRetry: () => void }) {
  if (!props.submit.error) return null;
  return (
    <p role="alert" className="text-sm text-expense">
      {props.submit.error}
      {props.submit.retryable && <button type="button" onClick={props.onRetry} className="ml-2 underline">Retry</button>}
    </p>
  );
}
```

(`SheetSubmit<never>` accepts any `SheetSubmit<V>` because `run` is contravariant; if TypeScript objects, type the prop as `Pick<SheetSubmit<unknown>, "error" | "retryable">`.)

`EditSheet`: drop the local `error`/`retryable` state; `const submitter = useSheetSubmit(save, () => { props.onSaved(); props.onClose(); }, (e) => { if (e instanceof ApiError && e.status === 404) void client.invalidateQueries({ queryKey: ["transactions"] }); });`. Validation calls `submitter.fail("…")`; the `useEffect` on row id calls `submitter.reset()`; `submit()` ends with `submitter.run({ id: r.id, edit })`; render `<SheetError submit={submitter} onRetry={submit} />`. `BulkEditSheet` the same, with its message built in the success callback. `TagSheet` the same; `onRetry={submit}`; pass `autoFocus` to `TagInput`.

`TagInput`: add `autoFocus?: boolean` and put it on the `<input>`. In `onChange`:

```ts
          onChange={(e) => {
            const v = e.target.value;
            // A datalist pick replaces the text in one step, as a plain change
            // or an "insertReplacementText" input; typing arrives as insertText.
            const native = e.nativeEvent as InputEvent;
            const picked = native.inputType === undefined || native.inputType === "insertReplacementText";
            if (v.includes(",") || (picked && props.suggestions.includes(v))) commit(v); else props.onDraft(v);
          }}
```

`Toast.tsx`: add

```ts
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  // A counter, not Date.now(): two toasts in one millisecond must still restart the timer.
  const nextId = useRef(0);
  return {
    toast,
    notify: (t: Omit<ToastState, "id">) => setToast({ ...t, id: ++nextId.current }),
    dismiss: () => setToast(null),
  };
}
```

and use it in `Editing.tsx` in place of its own toast state.

- [ ] **Step 4: Run; expect PASS** (the whole frontend suite: the sheets' existing tests guard the refactor)

Run: `cd frontend && npx vitest run && npx tsc -b`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "Share sheet submission, focus tag boxes, chip picked tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Suggested pattern, merchant queries and mutations

**Files:**
- Create: `frontend/src/lib/suggestPattern.ts`, `frontend/src/lib/useDebounced.ts`, `frontend/src/merchants/queries.ts`, `frontend/src/merchants/mutations.ts`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/transactions/edit/mutations.ts`
- Test: `frontend/src/__tests__/lib/suggestPattern.test.ts` (new)

**Interfaces:**
- Consumes: `api/merchants.ts` types (Task 3).
- Produces:
  - `suggestPattern(raw: string): string`
  - `useDebounced<T>(value: T, ms: number): T`
  - `useMerchants()` (key `["merchants"]`), `useRuleLookup(raw: string | null)` (key `["merchant-rule", raw]`, enabled when `raw`), `useAliasPreview(pattern: string, alias: string)` (key `["alias-preview", pattern, alias]`, enabled when `pattern.trim()`, `placeholderData: keepPreviousData`)
  - `useSaveDecision()`, `useDeleteRule()` (vars: rule id), `useSetMerchantCategory()` (vars: `MerchantCategoryRequest`)
  - `useWrite(fn, keys?)` exported from `transactions/edit/mutations.ts`; its default keys add `"merchants"`.
  - `lib/types.ts` re-exports every type in `worker/src/api/merchants.ts`.

- [ ] **Step 1: Write failing test** `suggestPattern.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { suggestPattern } from "../../lib/suggestPattern";

// Hand-written. The Python escaped "." before "\" and so doubled the backslash
// ("APPLE\\.COM"), which never matched the name it came from.
const CASES: [string, string][] = [
  ["POS APPLE.COM/BI 02/08 1", "POS\\s+APPLE\\.COM/BI.*"],
  ["CORNER SHOP  12/31", "CORNER\\s+SHOP.*"],
  ["ACME (UK) LTD 1234", "ACME\\s+\\(UK\\)\\s+LTD.*"],
  ["PAY*COFFEE+CO", "PAY\\*COFFEE\\+CO.*"],
  ["Plain", "Plain.*"],
  ["BACKSLASH\\NAME 07/07 99", "BACKSLASH\\\\NAME.*"],
  ["TRAILING.*", "TRAILING\\.\\*.*"],
  ["   ", ""],
];

describe("suggestPattern", () => {
  it.each(CASES)("%s", (raw, expected) => {
    expect(suggestPattern(raw)).toBe(expected);
  });

  it.each(CASES.filter(([raw]) => raw.trim()))("the suggestion for %s matches it", (raw) => {
    expect(new RegExp(suggestPattern(raw), "i").test(raw)).toBe(true);
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `cd frontend && npx vitest run src/__tests__/lib/suggestPattern.test.ts`

- [ ] **Step 3: Implement**

`suggestPattern.ts`:

```ts
/**
 * _suggest_pattern from edit_merchant_screen.py: a starting regex for a raw
 * statement name. Drops " dd/dd" date stamps and a trailing number, escapes
 * what is special in a regex, lets any run of spaces match, and accepts any
 * tail. Escaping is one pass; the Python's two passes doubled backslashes.
 */
export function suggestPattern(raw: string): string {
  const cleaned = raw
    .replace(/\s+\d{2}\/\d{2}/g, "")
    .replace(/\s+\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return escaped.endsWith(".*") ? escaped : `${escaped}.*`;
}
```

`useDebounced.ts`:

```ts
import { useEffect, useState } from "react";

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
```

`transactions/edit/mutations.ts`: change `AFFECTED` to `["transactions", "summary", "periods", "lookups", "merchants"]` and

```ts
export function useWrite<V, R>(fn: (vars: V) => Promise<R>, keys: string[] = AFFECTED) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] }))),
  });
}
```

`lib/types.ts`: add

```ts
export type {
  AliasPreviewResponse, DecisionRequest, DecisionResponse, MerchantCategoryRequest, MerchantCategoryResponse,
  MerchantRow, MerchantRule, MerchantsResponse, RuleDeletedResponse, RuleLookupResponse,
} from "../../../worker/src/api/merchants";
```

`merchants/queries.ts`:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import type { AliasPreviewResponse, MerchantsResponse, RuleLookupResponse } from "../lib/types";

export function useMerchants() {
  return useQuery({ queryKey: ["merchants"], queryFn: () => getJson<MerchantsResponse>("/api/merchants") });
}

export function useRuleLookup(raw: string | null) {
  return useQuery({
    queryKey: ["merchant-rule", raw],
    queryFn: () => getJson<RuleLookupResponse>(`/api/merchants/rule?${new URLSearchParams({ raw: raw ?? "" })}`),
    enabled: raw !== null,
    staleTime: 0,
  });
}

export function useAliasPreview(pattern: string, alias: string) {
  return useQuery({
    queryKey: ["alias-preview", pattern, alias],
    queryFn: () => getJson<AliasPreviewResponse>(`/api/merchants/preview?${new URLSearchParams({ pattern, alias })}`),
    enabled: pattern.trim() !== "",
    placeholderData: keepPreviousData,
  });
}
```

`merchants/mutations.ts`:

```ts
import { send } from "../lib/api";
import type {
  DecisionRequest, DecisionResponse, MerchantCategoryRequest, MerchantCategoryResponse, RuleDeletedResponse,
} from "../lib/types";
import { useWrite } from "../transactions/edit/mutations";

/** A rule change can rename any row, so everything that shows rows refetches. */
const MERCHANT_WRITES = ["transactions", "summary", "periods", "lookups", "merchants", "merchant-rule", "alias-preview"];

export const useSaveDecision = () =>
  useWrite((body: DecisionRequest) => send<DecisionResponse>("POST", "/api/merchants/decision", body), MERCHANT_WRITES);
export const useDeleteRule = () =>
  useWrite((id: number) => send<RuleDeletedResponse>("POST", `/api/merchants/rules/${id}/delete`, {}), MERCHANT_WRITES);
export const useSetMerchantCategory = () =>
  useWrite((body: MerchantCategoryRequest) => send<MerchantCategoryResponse>("POST", "/api/merchants/category", body), MERCHANT_WRITES);
```

- [ ] **Step 4: Run; expect PASS**

Run: `cd frontend && npx vitest run && npx tsc -b`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "Suggest a pattern from a raw name and add merchant API hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Merchant editor sheet, opened from a transaction

**Files:**
- Create: `frontend/src/merchants/CategoryInput.tsx`, `frontend/src/merchants/MerchantEditor.tsx`
- Modify: `frontend/src/transactions/edit/EditSheet.tsx`, `frontend/src/transactions/edit/Editing.tsx`
- Test: `frontend/src/__tests__/transactions/merchantRule.test.tsx` (new)

**Interfaces:**
- Consumes: Task 6 `useSheetSubmit`/`SheetError`, `TagInput`, `splitTags`; Task 7 hooks and `suggestPattern`, `useDebounced`.
- Produces:

```ts
export type EditorTarget = { kind: "raw"; raw: string } | { kind: "merchant"; merchant: MerchantRow };
export function MerchantEditor(props: {
  target: EditorTarget | null;
  lookups: LookupsResponse | undefined;
  onClose: () => void;
  onDone: (message: string) => void;
}): JSX.Element;
export function CategoryInput(props: { value: string; onChange: (v: string) => void; categories: string[]; autoFocus?: boolean }): JSX.Element;
```

  - `EditSheet` gains `onMerchantRule: (raw: string) => void`, shown as a "Merchant rule…" button under the "Shows as" line.

Behaviour (spec section 2):
- Sheet title: "Merchant rule".
- Read-only line: "Statement text: <raw>" for `raw`; "Merchant: <name>" for `merchant`.
- Start values. `raw`: wait for `useRuleLookup(raw)`; rule → pattern = `rule.pattern`, alias = `merchant`, ruleId = `rule.id`; no rule → pattern = `suggestPattern(raw)`, alias = `""`, ruleId = null; category = lookup `category ?? ""`. `merchant`: one rule → that rule, alias = name; several → a radio group "Rule" listing each pattern plus "New rule", first rule chosen; none → `suggestPattern(name)`, alias `""`; category = `merchant.category ?? ""`. Choosing "New rule" sets pattern `suggestPattern(name)`, alias `""`, ruleId null.
- Fields, labelled exactly: "Pattern" (hint text "`.*` matches anything, `\d` a digit, `\s` a space"), "Display name", "Category" (`CategoryInput`), budget line `Budget: Essential (from category)` / `Budget: Discretionary (from category)` from `lookups.essentialCategories` (hidden when category empty), "Tags to add" (`TagInput`).
- Preview (`useAliasPreview(useDebounced(pattern, 300), useDebounced(alias, 300))`), a `<section aria-label="Preview">`:
  - `Matches {matched} transactions · {formatCents(totalCents)}`
  - `Currently {n} {category}, …` (by count, descending) plus ` → {category}` when one is typed
  - `Claims: {merchant names, sorted}`
  - `+ tags {matched} rows: {tags joined by ", "}` when tags are given
  - Nothing when `matched` is 0 and no error.
- A pattern that does not compile (`new RegExp(pattern, "i")` throws) shows `Invalid pattern: <message>` in an alert under the field and disables Save, at once rather than debounced.
- Save is disabled while the lookup loads (`raw` mode), while pending, or with an invalid pattern. Empty pattern → `fail("Enter a pattern")`; empty alias → `fail("Enter a display name")`.
- Sends `{ pattern: pattern.trim(), alias: alias.trim(), ...(category.trim() && { category: category.trim() }), ...(tags.length && { tags }) }`, where `tags` = chips plus `splitTags(draft)`.
- Success: `onDone(\`Saved ${alias}: re-pointed ${repointed}${tagged ? \`, tagged ${tagged}\` : ""}\`)`, then `onClose()`.
- "Delete rule" (only when ruleId is set) turns into an inline confirm: text "Matching rows go back to their own names or the next rule." with buttons "Delete rule" (confirm) and "Keep". Confirm sends `useDeleteRule` and on success `onDone(\`Rule deleted: re-pointed ${repointed}\`)`, `onClose()`.

- [ ] **Step 1: Write failing tests** `merchantRule.test.tsx` (uses `pageHarness`; GET routes go through `routes` too, keyed `"GET /api/merchants/rule"` etc.)

```tsx
/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, posted, renderAt, row, URL_SEPT, useHarness, type Route } from "./pageHarness";

useHarness();

const preview: Route = (_b, url) => ({
  body: url.searchParams.get("pattern")?.startsWith("[")
    ? { matched: 0, totalCents: 0, currentCategories: {}, merchants: {}, error: "bad" }
    : { matched: 2, totalCents: 700, currentCategories: { Groceries: 2 }, merchants: { "SHOP 3": 1, "SHOP 2": 1 } },
});

function page(rule: Route = () => ({ body: { rule: null, merchant: "SHOP 3", category: null } }), extra: Record<string, Route> = {}) {
  return renderAt(URL_SEPT, api({
    rows: [row(3, "2026-09-29", 100), row(2, "2026-09-28", 100)],
    lookups: { essentialCategories: ["Groceries"] },
    routes: {
      "GET /api/merchants/rule": rule,
      "GET /api/merchants/preview": preview,
      "POST /api/merchants/decision": () => ({ body: { repointed: 1, tagged: 2 } }),
      ...extra,
    },
  }));
}

async function openEditor() {
  await userEvent.click(await screen.findByRole("button", { name: "Edit Shop 3" }));
  await userEvent.click(within(screen.getByRole("dialog", { name: "Edit transaction" })).getByRole("button", { name: "Merchant rule…" }));
  return screen.getByRole("dialog", { name: "Merchant rule" });
}

describe("the merchant editor from a transaction", () => {
  it("starts from a suggested pattern when no rule decides the name", async () => {
    page();
    const sheet = await openEditor();
    expect(within(sheet).getByText(/SHOP 3/)).toBeInTheDocument();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("SHOP.*"));
    expect(within(sheet).getByRole("textbox", { name: "Display name" })).toHaveValue("");
    expect(within(sheet).queryByRole("button", { name: "Delete rule" })).not.toBeInTheDocument();
  });

  it("starts from the rule in force, with its merchant and category", async () => {
    page(() => ({ body: { rule: { id: 4, pattern: "^SHOP", }, merchant: "Shop", category: "Groceries" } }));
    const sheet = await openEditor();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("^SHOP"));
    expect(within(sheet).getByRole("textbox", { name: "Display name" })).toHaveValue("Shop");
    expect(within(sheet).getByRole("combobox", { name: "Category" })).toHaveValue("Groceries");
    expect(sheet).toHaveTextContent("Budget: Essential (from category)");
  });

  it("previews what the pattern claims", async () => {
    page();
    const sheet = await openEditor();
    const section = await within(sheet).findByRole("region", { name: "Preview" });
    await waitFor(() => expect(section).toHaveTextContent("Matches 2 transactions · €7.00"));
    expect(section).toHaveTextContent("Currently 2 Groceries");
    expect(section).toHaveTextContent("Claims: SHOP 2, SHOP 3");
  });

  it("refuses a pattern that does not compile, at once", async () => {
    page();
    const sheet = await openEditor();
    const box = within(sheet).getByRole("textbox", { name: "Pattern" });
    await waitFor(() => expect(box).toHaveValue("SHOP.*"));
    await userEvent.clear(box);
    await userEvent.type(box, "[[bad");
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Invalid pattern");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves tags still in the box, with the category, and says what moved", async () => {
    const { mock } = page();
    const sheet = await openEditor();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("SHOP.*"));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Display name" }), "Shop");
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Category" }), "Groceries");
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Tags to add" }), "weekly");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(mock, "/api/merchants/decision")).toEqual([
      { pattern: "SHOP.*", alias: "Shop", category: "Groceries", tags: ["weekly"] },
    ]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved Shop: re-pointed 1, tagged 2"));
    expect(screen.queryByRole("dialog", { name: "Merchant rule" })).not.toBeInTheDocument();
  });

  it("asks for a display name before saving", async () => {
    const { mock } = page();
    const sheet = await openEditor();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("SHOP.*"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Enter a display name");
    expect(posted(mock, "/api/merchants/decision")).toEqual([]);
  });

  it("deletes the rule in force after a confirm", async () => {
    const { mock } = page(
      () => ({ body: { rule: { id: 4, pattern: "^SHOP" }, merchant: "Shop", category: null } }),
      { "POST /api/merchants/rules/4/delete": () => ({ body: { repointed: 3 } }) },
    );
    const sheet = await openEditor();
    await userEvent.click(await within(sheet).findByRole("button", { name: "Delete rule" }));
    expect(sheet).toHaveTextContent("Matching rows go back to their own names or the next rule.");
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(posted(mock, "/api/merchants/rules/4/delete")).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Rule deleted: re-pointed 3"));
  });
});
```

Add an option to `pageHarness`'s `ApiOptions`, `getGate?: Promise<void>`, awaited before answering any GET whose path starts with `/api/merchants/rule`, and add this test to the same `describe`:

```tsx
  it("Save waits for the rule lookup", async () => {
    let release!: () => void;
    const getGate = new Promise<void>((r) => { release = r; });
    renderAt(URL_SEPT, api({
      rows: [row(3, "2026-09-29", 100)],
      getGate,
      routes: { "GET /api/merchants/rule": () => ({ body: { rule: { id: 4, pattern: "^SHOP" }, merchant: "Shop", category: null } }) },
    }));
    const sheet = await openEditor();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    release();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("^SHOP"));
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled();
  });
```

In `pageHarness.tsx` `fetch`, before the route lookup: `if (method === "GET" && url.pathname.startsWith("/api/merchants/rule")) await opts.getGate;`.

- [ ] **Step 2: Run; expect FAIL**

Run: `cd frontend && npx vitest run src/__tests__/transactions/merchantRule.test.tsx`

- [ ] **Step 3: Implement**

`CategoryInput.tsx`:

```tsx
import { useId } from "react";

/** A category by name: pick one in use or type a new one. Empty means none chosen. */
export function CategoryInput(props: { value: string; onChange: (v: string) => void; categories: string[]; autoFocus?: boolean }) {
  const listId = useId();
  // "Other" is what no category reads as; it is not one you can choose.
  const choices = props.categories.filter((c) => c !== "Other");
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-slate-500">Category</span>
      <input list={listId} value={props.value} autoFocus={props.autoFocus} placeholder="No category"
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900" />
      <datalist id={listId}>{choices.map((c) => <option key={c} value={c} />)}</datalist>
    </label>
  );
}
```

`MerchantEditor.tsx`: implement the behaviour list above with `Sheet` (`busy={save.isPending || del.isPending}`), `useSheetSubmit(save, …)` and a second `useSheetSubmit(del, …)`, `TagInput` labelled "Tags to add", `CategoryInput`. State resets whenever `target` changes (effect keyed on `target`) and when the rule lookup's data arrives (effect keyed on `lookup.data`). Compute `const compileError = (() => { if (!pattern) return null; try { new RegExp(pattern, "i"); return null; } catch (e) { return (e as Error).message; } })();` Render the preview only when `!compileError && preview.data && preview.data.matched > 0`. Category counts line: `Object.entries(currentCategories).sort((a, b) => b[1] - a[1]).map(([c, n]) => \`${n} ${c}\`).join(", ")`. Give the pattern box `aria-describedby` pointing at the hint, and `spellCheck={false}` with a monospace class.

`EditSheet.tsx`: prop `onMerchantRule: (raw: string) => void`; after the "Shows as" span add

```tsx
            <button type="button" onClick={() => props.onMerchantRule(r.merchantRaw)} disabled={save.isPending}
              className="self-start text-xs underline disabled:opacity-40">Merchant rule…</button>
```

`Editing.tsx`: `const [ruleRaw, setRuleRaw] = useState<string | null>(null);`; pass `onMerchantRule={(raw) => { props.onCloseOpen(); setRuleRaw(raw); }}` to `EditSheet`; render

```tsx
      <MerchantEditor target={ruleRaw === null ? null : { kind: "raw", raw: ruleRaw }} lookups={props.lookups}
        onClose={() => setRuleRaw(null)} onDone={(message) => notify({ message })} />
```

- [ ] **Step 4: Run; expect PASS**

Run: `cd frontend && npx vitest run && npx tsc -b`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "Edit a merchant rule from a transaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Merchants page: list, filters, sorting, editor

**Files:**
- Create: `frontend/src/merchants/params.ts`, `MerchantsPage.tsx`, `MerchantTable.tsx`, `MerchantCards.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/TopBar.tsx`
- Test: `frontend/src/__tests__/merchants/params.test.ts`, `frontend/src/__tests__/merchants/harness.tsx`, `frontend/src/__tests__/merchants/MerchantsPage.test.tsx`, `frontend/src/__tests__/TopBar.test.tsx`

**Interfaces:**
- Consumes: `MerchantRow`, `useMerchants`, `useLookups` (from `transactions/queries`), `MerchantEditor`, `useToast`, `StickyPanel`, `Segmented`, `quote`.
- Produces:

```ts
export const MERCHANT_SORTS = ["name", "category", "budget", "count", "total", "last", "rules"] as const;
export type MerchantSort = (typeof MERCHANT_SORTS)[number];
export interface MerchantParams {
  q?: string; category?: string; attention?: "uncategorized" | "suggested"; type?: TransactionType;
  sort: MerchantSort; dir: "asc" | "desc";
}
export function parseMerchantParams(sp: URLSearchParams): MerchantParams;  // default sort total, dir desc
export function toMerchantSearch(p: MerchantParams): URLSearchParams;      // omits defaults
export function filterMerchants(rows: MerchantRow[], p: MerchantParams): MerchantRow[];
export function sortMerchants(rows: MerchantRow[], sort: MerchantSort, dir: "asc" | "desc"): MerchantRow[];
```

  - `filterMerchants`: `q` is case-insensitive "contains" on name; `category` exact; `attention=uncategorized` → `category === null`; `suggested` → `suggested`; `type` exact.
  - `sortMerchants`: `total` sorts by `Math.abs(totalCents)`; `last` by `lastDate` (null last in either direction); `rules` by `rules.length`; `category` with null as ""; strings with `localeCompare`; ties by name ascending.
  - `MerchantsPage` (route `/merchants`), `<h1>Merchants</h1>`, controls inside `<StickyPanel label="Merchant controls">`: search box "Search merchants", a `<select>` "Category" ("All categories" + lookups categories), `Segmented` "Needs attention" (All / Uncategorized / Suggested), `Segmented` "Type" (All / Expense / Income); totals line `{n} merchants · {u} uncategorized`; desktop `MerchantTable`, phone `MerchantCards`.
  - Row content: name; category or muted "Uncategorized" (plus "suggested" badge when suggested); budget "Essential"/"Discretionary" (only when `type === "expense"`); count; signed total (`+€` green for positive, `−€` for negative); last date; rules: count plus first pattern in `font-mono text-xs text-slate-500`.
  - A row click (or the name button, aria-label `Edit {name}`) opens `MerchantEditor` with `{ kind: "merchant", merchant }`. A link per row, text "→", aria-label `Transactions for {name}`, `to={\`/transactions?${new URLSearchParams({ merchant: quote(name) })}\`}`, with `onClick={(e) => e.stopPropagation()}`.
  - Table headers are sort buttons like `TransactionTable`'s (reuse its pattern: `aria-sort`, a chevron); clicking the active column flips `dir`, another column sets it with `dir` `desc` for numbers/dates and `asc` for text.

- [ ] **Step 1: Write failing tests**

`params.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MerchantRow } from "../../lib/types";
import { filterMerchants, parseMerchantParams, sortMerchants, toMerchantSearch } from "../../merchants/params";

const m = (id: number, name: string, over: Partial<MerchantRow> = {}): MerchantRow => ({
  id, name, category: "Groceries", budget: "essential", suggested: false, count: 1,
  totalCents: -100, lastDate: "2026-09-01", type: "expense", rules: [], ...over,
});

describe("merchant params", () => {
  it("round-trips, dropping defaults and nonsense", () => {
    const p = parseMerchantParams(new URLSearchParams("q=cafe&attention=uncategorized&type=income&sort=name&dir=asc&bogus=1"));
    expect(p).toEqual({ q: "cafe", attention: "uncategorized", type: "income", sort: "name", dir: "asc" });
    expect(toMerchantSearch(p).toString()).toBe("q=cafe&attention=uncategorized&type=income&sort=name&dir=asc");
    expect(parseMerchantParams(new URLSearchParams("sort=nope&attention=x"))).toEqual({ sort: "total", dir: "desc" });
    expect(toMerchantSearch({ sort: "total", dir: "desc" }).toString()).toBe("");
  });

  it("filters by name, category, attention and type", () => {
    const rows = [m(1, "Corner Shop"), m(2, "Cafe One", { category: null }), m(3, "Pay", { type: "income", suggested: true })];
    const ids = (p: Parameters<typeof filterMerchants>[1]) => filterMerchants(rows, p).map((r) => r.id);
    const base = { sort: "total", dir: "desc" } as const;
    expect(ids({ ...base, q: "CAFE" })).toEqual([2]);
    expect(ids({ ...base, category: "Groceries" })).toEqual([1, 3]);
    expect(ids({ ...base, attention: "uncategorized" })).toEqual([2]);
    expect(ids({ ...base, attention: "suggested" })).toEqual([3]);
    expect(ids({ ...base, type: "income" })).toEqual([3]);
  });

  it("sorts total by size, nulls last, ties by name", () => {
    const rows = [m(1, "B", { totalCents: -500 }), m(2, "A", { totalCents: 900 }), m(3, "C", { totalCents: -500, lastDate: null })];
    expect(sortMerchants(rows, "total", "desc").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortMerchants(rows, "last", "asc").map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortMerchants(rows, "last", "desc").map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortMerchants(rows, "name", "asc").map((r) => r.id)).toEqual([2, 1, 3]);
  });
});
```

`harness.tsx` (not a test file):

```tsx
// Shared by the Merchants page tests; Vitest only collects *.test.*.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";

import type { MerchantRow } from "../../lib/types";
import { MerchantsPage } from "../../merchants/MerchantsPage";

export const merchant = (id: number, name: string, over: Partial<MerchantRow> = {}): MerchantRow => ({
  id, name, category: "Groceries", budget: "essential", suggested: false, count: 2,
  totalCents: -1250, lastDate: "2026-09-20", type: "expense", rules: [], ...over,
});

export type Call = { path: string; method: string; body: unknown };
type Answer = (body: unknown, url: URL) => { status?: number; body: unknown };

export function api(rows: MerchantRow[], routes: Record<string, Answer> = {}) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const route = routes[`${method} ${url.pathname}`];
    if (route) { const r = route(body, url); return json(r.body, r.status); }
    if (url.pathname === "/api/merchants") return json({ merchants: rows });
    if (url.pathname === "/api/lookups") return json({ categories: ["Eating out", "Groceries", "Other"], tags: [], sources: [], essentialCategories: ["Groceries"] });
    if (url.pathname === "/api/merchants/preview") return json({ matched: 0, totalCents: 0, currentCategories: {}, merchants: {} });
    return json({});
  };
  return { fetch, calls };
}

function Where() { const l = useLocation(); return <output aria-label="location">{l.pathname + l.search}</output>; }

export function renderMerchants(url: string, mock: ReturnType<typeof api>) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="*" element={<><MerchantsPage /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

let desktop = true;
export const setDesktop = (on: boolean) => { desktop = on; };

export function useHarness() {
  beforeEach(() => {
    desktop = true;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
}
```

`MerchantsPage.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, merchant, renderMerchants, setDesktop, useHarness } from "./harness";

useHarness();

const rows = [
  merchant(1, "Corner Shop", { totalCents: -1250, rules: [{ id: 7, pattern: "^CORNER" }] }),
  merchant(2, "Cafe One", { category: null, budget: "discretionary", totalCents: -400 }),
  merchant(3, "Pay", { category: "Salary", type: "income", totalCents: 300000, budget: "discretionary" }),
];

describe("the Merchants page", () => {
  it("lists merchants by total size, with the totals line", async () => {
    renderMerchants("/merchants", api(rows));
    const table = await screen.findByRole("table");
    const names = within(table).getAllByRole("button", { name: /^Edit / }).map((b) => b.textContent);
    expect(names).toEqual(["Pay", "Corner Shop", "Cafe One"]);
    expect(screen.getByText("3 merchants · 1 uncategorized")).toBeInTheDocument();
    expect(within(table).getByText("^CORNER")).toBeInTheDocument();
    expect(within(table).getByText("+€3,000.00")).toBeInTheDocument();
    expect(within(table).getByText("−€12.50")).toBeInTheDocument();
  });

  it("keeps filters in the URL", async () => {
    renderMerchants("/merchants", api(rows));
    await screen.findByRole("table");
    await userEvent.click(within(screen.getByRole("group", { name: "Needs attention" })).getByRole("button", { name: "Uncategorized" }));
    expect(screen.getByLabelText("location")).toHaveTextContent("attention=uncategorized");
    expect(screen.getAllByRole("button", { name: /^Edit / }).map((b) => b.textContent)).toEqual(["Cafe One"]);
  });

  it("sorts by a column header", async () => {
    renderMerchants("/merchants", api(rows));
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /Merchant/ }));
    expect(screen.getAllByRole("button", { name: /^Edit / }).map((b) => b.textContent)).toEqual(["Cafe One", "Corner Shop", "Pay"]);
  });

  it("links each merchant to its transactions, exact match", async () => {
    renderMerchants("/merchants", api(rows));
    const link = await screen.findByRole("link", { name: "Transactions for Corner Shop" });
    expect(link).toHaveAttribute("href", `/transactions?merchant=${encodeURIComponent('"Corner Shop"')}`);
  });

  it("opens the editor on the merchant's rule", async () => {
    renderMerchants("/merchants", api(rows));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Corner Shop" }));
    const sheet = screen.getByRole("dialog", { name: "Merchant rule" });
    expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("^CORNER");
    expect(within(sheet).getByRole("textbox", { name: "Display name" })).toHaveValue("Corner Shop");
  });

  it("offers a choice when a merchant has several rules", async () => {
    renderMerchants("/merchants", api([merchant(1, "Corner Shop", { rules: [{ id: 7, pattern: "^CORNER" }, { id: 8, pattern: "CRNR" }] })]));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Corner Shop" }));
    const sheet = screen.getByRole("dialog", { name: "Merchant rule" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "CRNR" }));
    expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("CRNR");
    await userEvent.click(within(sheet).getByRole("radio", { name: "New rule" }));
    expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("Corner\\s+Shop.*");
    expect(within(sheet).getByRole("textbox", { name: "Display name" })).toHaveValue("");
  });

  it("shows cards on a phone", async () => {
    setDesktop(false);
    renderMerchants("/merchants", api(rows));
    await waitFor(() => expect(screen.getByRole("list", { name: "Merchants" })).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
```

`TopBar.test.tsx`: in "links to both screens and marks the current one", also assert `screen.getByRole("link", { name: "Merchants" })` has `href` `/merchants`, and rename the test "links to every screen…".

- [ ] **Step 2: Run; expect FAIL**

Run: `cd frontend && npx vitest run src/__tests__/merchants src/__tests__/TopBar.test.tsx`

- [ ] **Step 3: Implement** the files per the Interfaces block. Follow `TransactionsPage.tsx` for layout: `<main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">`, `useMediaQuery(DESKTOP)`, `StickyPanel`, loading skeleton, error with Retry. Follow `TransactionTable.tsx` for the table: sticky `<th>` classes, striped rows (`odd:bg-white even:bg-slate-100 … hover:bg-slate-200`), `cursor-pointer` rows that open on click. Phone cards follow `DayList.tsx` (`<ul aria-label="Merchants">`). Filter updates use `setSearch(toMerchantSearch({ ...params, ...patch }), { replace: true })`. The editor and toast live on the page: `const { toast, notify, dismiss } = useToast();` and `<MerchantEditor target={editing} lookups={lookups.data} onClose={() => setEditing(null)} onDone={(message) => notify({ message })} />`, `<Toast toast={toast} onDismiss={dismiss} />`.

In `MerchantEditor` (Task 8 file), implement the `merchant` target now if Task 8 left it unexercised: the radio group is `<fieldset><legend>Rule</legend>` with one `<label><input type="radio" …/> <span className="font-mono">{pattern}</span></label>` per rule and one "New rule".

`App.tsx`: `<Route path="/merchants" element={<MerchantsPage />} />`. `TopBar.tsx`: add `["/merchants", "Merchants"]` to the nav list.

- [ ] **Step 4: Run; expect PASS**

Run: `cd frontend && npx vitest run && npx tsc -b`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "Add a Merchants page with filters, sorting and the rule editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Set or clear categories on many merchants; bigger phone checkboxes

**Files:**
- Create: `frontend/src/merchants/MerchantActionBar.tsx`, `frontend/src/merchants/SetCategorySheet.tsx`
- Modify: `frontend/src/merchants/MerchantsPage.tsx`, `MerchantTable.tsx`, `MerchantCards.tsx`, `frontend/src/transactions/DayList.tsx`, `frontend/src/transactions/TransactionTable.tsx`
- Test: `frontend/src/__tests__/merchants/selection.test.tsx` (new), `frontend/src/__tests__/transactions/selection.test.tsx`

**Interfaces:**
- Consumes: `useSetMerchantCategory`, `useSheetSubmit`, `SheetError`, `CategoryInput`, `Sheet`, `useToast`.
- Produces:
  - `MerchantActionBar(props: { count: number; total: number; onSelectAll; onSetCategory; onClearCategory; onCancel })`, a `region` named "Selected merchants", the same placement classes as `transactions/edit/ActionBar.tsx`. Buttons: "Select all {total}" (when count < total), "Set category", "Clear category", "Cancel". Text `{count} selected`.
  - `SetCategorySheet(props: { ids: number[] | null; categories: string[]; onClose; onDone: (message: string) => void })`, titled `Set category on {n} merchants`, with `CategoryInput` (autoFocus) and a "Set category" submit button, disabled while empty.
  - Toasts: `Set {category} on {updated} merchants`; `Cleared the category on {updated} merchants`. Selection clears after either.
  - "Select all" selects every filtered row. The table header checkbox "Select all shown" works as on Transactions.
  - Checkboxes on Merchants (table and cards) and on Transactions (`DayList` and `TransactionTable`) sit in a 44px tap target: wrap each in `<label className="-m-2 inline-flex h-11 w-11 items-center justify-center">` (keep the `aria-label` on the input, and the `stopPropagation` on click) and give the input `className="h-4 w-4"`.

- [ ] **Step 1: Write failing tests** `merchants/selection.test.tsx`

```tsx
/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, merchant, renderMerchants, useHarness } from "./harness";

useHarness();

const rows = [merchant(1, "Corner Shop"), merchant(2, "Cafe One", { category: null }), merchant(3, "Bakery")];
const bar = () => screen.getByRole("region", { name: "Selected merchants" });
const posts = (mock: ReturnType<typeof api>) => mock.calls.filter((c) => c.method === "POST").map((c) => c.body);

describe("selecting merchants", () => {
  it("sets a typed category on the selected merchants", async () => {
    const mock = renderMerchants("/merchants", api(rows, {
      "POST /api/merchants/category": (b) => ({ body: { updated: (b as { ids: number[] }).ids.length } }),
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Cafe One" }));
    expect(bar()).toHaveTextContent("2 selected");
    await userEvent.click(within(bar()).getByRole("button", { name: "Set category" }));
    const sheet = screen.getByRole("dialog", { name: "Set category on 2 merchants" });
    const box = within(sheet).getByRole("combobox", { name: "Category" });
    expect(box).toHaveFocus();
    await userEvent.type(box, "Food");
    await userEvent.click(within(sheet).getByRole("button", { name: "Set category" }));
    await waitFor(() => expect(posts(mock)).toEqual([{ ids: [1, 2], category: "Food" }]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Set Food on 2 merchants"));
    expect(screen.queryByRole("region", { name: "Selected merchants" })).not.toBeInTheDocument();
  });

  it("clears the category on the selection", async () => {
    const mock = renderMerchants("/merchants", api(rows, {
      "POST /api/merchants/category": () => ({ body: { updated: 1 } }),
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Bakery" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Clear category" }));
    await waitFor(() => expect(posts(mock)).toEqual([{ ids: [3], category: null }]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cleared the category on 1 merchants"));
  });

  it("selects every filtered merchant", async () => {
    renderMerchants("/merchants?q=c", api(rows));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Select all 2" }));
    expect(bar()).toHaveTextContent("2 selected");
  });

  it("a checkbox click does not open the editor", async () => {
    renderMerchants("/merchants", api(rows));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Bakery" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

In `transactions/selection.test.tsx`, add one test: on a phone (`setDesktop(false)`), the row checkbox's parent `label` has class `h-11` (assert `checkbox.closest("label")` has class `h-11`).

- [ ] **Step 2: Run; expect FAIL**

Run: `cd frontend && npx vitest run src/__tests__/merchants/selection.test.tsx src/__tests__/transactions/selection.test.tsx`

- [ ] **Step 3: Implement** as specified in Interfaces. Selection state on `MerchantsPage` as on `TransactionsPage` (a `Set<number>`, effective ids = filtered rows that are selected; the selection resets when the filters change). "Clear category" posts at once (no sheet) through `useSetMerchantCategory` and toasts; a failure toasts `Couldn't clear: {message}` with Retry. Pad the page bottom when the bar shows: `pb-28 md:pb-4`.

- [ ] **Step 4: Run; expect PASS**

Run: `cd frontend && npx vitest run && npx tsc -b`

- [ ] **Step 5: Commit**

```bash
jj new && jj desc -m "Set or clear categories on many merchants at once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Port plan doc

**Files:**
- Modify: `docs/WEB_PORT_PLAN.md`

- [ ] **Step 1: Edit** these places (find them with `grep -n "Cycle a category\|Edit merchant\|#### Categorize\|Budget types" docs/WEB_PORT_PLAN.md`):
  - The order line (around line 142): replace "Categorize + Gemini" with "Merchants page (done) + Gemini".
  - "Edit merchant (`e`, …) (PR B)" → strike through with `~~…~~` and add "Done: `MerchantEditor`, from a transaction's edit sheet ("Merchant rule…") and from the Merchants page; rules can also be deleted. `suggestPattern` fixes the Python's doubled backslashes."
  - "Cycle a category's budget type from a row (`x`). (PR B)" → "~~`x` cycles the budget **filter** (All → Essential → Discretionary).~~ Done: the Budget filter. Changing a category's type belongs to Budget types; the merchant editor shows it read-only and will offer it once that service exists."
  - `#### Categorize (categorize_screen.py)` section: retitle "Merchants page (replaces Categorize)"; mark the merchant list, filters, multi-select and assign done (`/merchants`); leave "Auto-categorize uncategorized → Gemini" pending.
  - Under `#### Budget types`: add "Also make the budget type editable in the merchant editor, under its category."
  - The `services/merchants.ts` bullet (around line 116): add "`repointRows` is the one place rows change merchant; `deleteMerchantRule` and `setMerchantCategory` sit beside it."

- [ ] **Step 2: Commit**

```bash
jj new && jj desc -m "Record the merchant editor and Merchants page in the port plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Real-driver check and privacy scan (controller, not a subagent)

The owner usually has `make dev` running on :8787 against the local D1; a second `wrangler dev` on the same state dies on a locked D1. Ask before starting anything on their port.

- [ ] **Step 1: Full suites.** `cd worker && npx vitest run && npm run typecheck`; `cd frontend && npx vitest run && npx tsc -b`. All green.
- [ ] **Step 2: Throwaway D1 copy.** Copy `worker/.wrangler/state` to the scratchpad and run `cd worker && npx wrangler dev --port 8790 --persist-to <copy> --local-upstream localhost:8790` (without `--local-upstream` the dev login is refused). Build the frontend first if the Worker serves `frontend/dist` (`cd frontend && npm run build`).
- [ ] **Step 3: Drive it** with `uv run --with playwright python <script>` from the scratchpad, against `http://localhost:8790`:
  - `/merchants` loads; note the merchant count (confirms no paging is needed; if over ~2,000, tell the owner).
  - Open a transaction → "Merchant rule…" → preview shows → save a new rule with a category and a tag → the toast reports re-pointed/tagged; the Transactions row shows the new name.
  - On `/merchants`, open that merchant → "Delete rule" → confirm → rows go back.
  - Select two merchants → Set category → the Summary's category list reflects it.
  - Re-import is not in the web yet: instead call `importTransactions` indirectly by checking dedup holds with a `wrangler d1 execute --local --persist-to <copy>` query that no `(date, merchant_id, amount_cents, occurrence)` repeats among live rows.
- [ ] **Step 4: Privacy scan** of `jj diff -r 'main..@'`: no real names, banks, employers, emails, absolute personal paths; fixtures only synthetic names. `grep -n -i` the diff for the owner's employer name (ask the owner if unsure what to grep) and for `/Users/`.
- [ ] **Step 5: Report** results to the owner; ask before pushing or opening the PR. After merge, delete this plan and the spec.
