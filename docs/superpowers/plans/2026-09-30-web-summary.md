# Web Summary Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a React Summary dashboard from the Worker, behind `getUser`, showing the TUI Summary's numbers for any year or month, with source and hidden-tag filters, on desktop and phone.

**Architecture:** The Worker becomes a Hono app. A middleware authenticates every request, `/api/summary*` routes return JSON built by a summary service from the existing (now scope-aware) analysis queries, and everything else is served from `frontend/dist` through the `ASSETS` binding. The frontend is Vite + React 19 with TanStack Query; URL search params hold the view state. New numbers (the monthly grid, anomaly flags, merchant lists) are held to the Python by `python_vectors.json`; filtered versions of existing queries are held to the verified SQL files run over filtered temp views.

**Tech Stack:** Cloudflare Workers + D1, Hono 4, Zod 4, Drizzle, Vitest; React 19, Vite 7, Tailwind 4, TanStack Query 5, React Router 7, Recharts 3, Testing Library; Python 3.12 (vectors only).

**Spec:** `docs/superpowers/specs/2026-09-30-web-summary-design.md`

## Global Constraints

- Money is integer cents in the database, queries and JSON. Never multiply a float by 100 to get cents. Division for display (averages, formatting) happens only in the client or the shared `averageCents`.
- Invariant 1: identity is decided only by `getUser(request, …)` in `worker/src/auth.ts`, called once per request in the Hono middleware. No other code reads `Cf-Access-*` headers.
- Invariant 2: `env.DB` is touched only by `createDb` in `worker/src/db/client.ts`. Query and service code takes a `Db`.
- Every request, including static assets, passes `getUser` (`run_worker_first = true`).
- `worker/src/api/summary.ts` has **no imports**. The frontend imports it directly.
- Never `npm install <pkg>`. Add dependencies to `package.json` by hand, then `rm -rf node_modules package-lock.json && npm install`, and diff the lockfile's package versions. In `worker/`, `grep -c '"node_modules/@rolldown/binding-' package-lock.json` must still print 15.
- The repo is public. No real data, emails, personal paths, employer or spouse names in code, fixtures, screenshots or commits. Synthetic emails use `example.com`.
- Tests use Vitest `describe/it/expect` in the style of the existing `worker/src/__tests__/`. Python changes follow `tools/crosscheck/vectors.py`'s style.
- Version control is jj. Every task ends with `jj commit -m "<message>"`; the final PR is made in Task 12. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Currency is EUR only, locale `en-IE`.
- Tailwind's `md` breakpoint (768px) separates phone from desktop.

## Review Focus

1. **Access session lapses while the tab is open.** The next fetch is redirected to the Access login. Expected: one reload to the login, never a reload loop, and a 403 (no `users` row) shows a message instead of reloading. Pinned in Task 7 (`api.test.ts`).
2. **Source filter set to "none".** Expected: all figures zero, not all sources. The URL must tell `sources` absent (all) from `sources=` (none). Pinned in Task 1 (`sources: []` scope) and Task 8 (`params.test.ts`).
3. **A source name with a comma or an apostrophe.** Expected: filtering still works. `sources` is a repeated param, so there's no splitting on commas. Pinned in Task 6 (route test) and Task 8 (`params.test.ts`).
4. **A year view with no income, or a month with no expenses.** Expected: savings rate "—", no division by zero, empty grids render as "Nothing this year". Pinned in Task 7 (`savingsRate`) and Task 9 (`CashFlowTiles` test).
5. **A hand-edited URL (`year=abc`, `month=13`).** Expected: fall back to the newest year and the whole year, with no error screen. The API still rejects the same values with 400. Pinned in Task 8 (`params.test.ts`) and Task 6 (route test).

---

## File map

Worker:
- Modify `worker/src/queries/analysis.ts`: `Scope` gains `sources`, `year` and `month`; new `categoryMonthTotalsAllTypes` and `merchantsInScope`.
- Create `worker/src/domain/anomalies.ts`: rolling mean/std and the anomaly test.
- Create `worker/src/domain/grid.ts`: category × month grid for one year.
- Create `worker/src/api/summary.ts`: response types plus `averageCents`. No imports.
- Create `worker/src/services/summary.ts`: `summaryPeriods` and `buildSummary`.
- Create `worker/src/app.ts`: `createApp`, the Hono app with auth middleware, routes and assets.
- Create `worker/src/routes/summary.ts`: Zod query parsing and the two handlers.
- Modify `worker/src/index.ts`: reduced to `Env` and `createApp` wiring.
- Modify `worker/wrangler.toml`: `[assets]`.
- Modify `worker/package.json` and `package-lock.json`: `hono`, `zod`.
- Tests: modify `__tests__/queries/analysis.test.ts`; create `__tests__/helpers/summaryStore.ts`, `__tests__/domain/summaryVectors.test.ts`, `__tests__/queries/merchantsInScope.test.ts`, `__tests__/services/summary.test.ts` and `__tests__/app/app.test.ts`.
- Modify `worker/README.md`: the dev loop with the frontend.

Python:
- Modify `tools/crosscheck/vectors.py`: new `summary` section.
- Regenerate `worker/src/__tests__/fixtures/python_vectors.json`.

Frontend:
- Modify `frontend/package.json`, `package-lock.json`, `tsconfig.json` and `vitest.config.ts`.
- Create `frontend/vite.config.ts` and `frontend/index.html`.
- Create `frontend/src/main.tsx`, `App.tsx` and `index.css`.
- Create `frontend/src/lib/money.ts`, `lib/api.ts` and `lib/useMediaQuery.ts`.
- Create `frontend/src/summary/params.ts`, `queries.ts`, `SummaryPage.tsx`, `PeriodPicker.tsx`, `FiltersBar.tsx`, `CashFlowTiles.tsx`, `SpendingSplit.tsx`, `MonthlyChart.tsx`, `BreakdownList.tsx`, `MonthlyGrid.tsx` and `Sparkline.tsx`.
- Tests under `frontend/src/__tests__/`: `setup.ts`, `lib/money.test.ts`, `lib/api.test.ts`, `summary/params.test.ts`, `summary/SummaryPage.test.tsx`, `summary/CashFlowTiles.test.tsx` and `summary/MonthlyGrid.test.tsx`, plus a `summary/fixtures.ts` helper.

CI and docs:
- Modify `.github/workflows/tests.yml` and `.github/workflows/deploy.yml`.
- Modify `docs/WEB_PORT_PLAN.md`.

---

### Task 1: Scope filters on the analysis queries

**Files:**
- Modify: `worker/src/queries/analysis.ts`
- Test: `worker/src/__tests__/queries/analysis.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Scope { includeHidden?: boolean; sources?: string[]; year?: string; month?: string }
  export async function hiddenTagTotal(db: Db, scope?: Omit<Scope, "includeHidden">): Promise<number>
  ```
  Every existing function (`cashFlowTotals`, `netCashFlow`, `categoryBreakdown`, `merchantsByYear`, `spendingTypeByYear`) honours the new fields. `sources: []` matches nothing.

- [ ] **Step 1: Give the fixture two sources, and let the reference SQL run over a scoped view**

In `analysis.test.ts`, at the end of `seed()` (after the `transaction_tags` insert), add:

```ts
  // Two sources, so the source filter has something to split.
  sqlite.exec(`UPDATE transactions SET source = 'Card' WHERE id IN (3, 7, 11, 15)`);
```

Replace the `reference` function and add the scope helpers below it:

```ts
/** The verified SQL, run exactly as the cross-check runs it. */
function reference(sqlite: Database.Database, file: string, view: string, params?: object): Row[] {
  let text = readFileSync(resolve(QUERIES, file), "utf8").replaceAll("{view}", view);
  // hidden_tag_total.sql names v_live itself rather than taking {view}.
  if (view.startsWith("scoped_")) text = text.replaceAll("FROM v_live", `FROM ${view}`);
  const stmt = sqlite.prepare(text).raw();
  return (params ? stmt.all(params) : stmt.all()) as Row[];
}

const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * A temp view holding only the rows a scope keeps. Running a verified SQL file
 * over it answers "the same query, filtered", which is what a scoped query
 * module must return.
 */
function scopedView(sqlite: Database.Database, base: "v_summary" | "v_live", scope: Scope): string {
  const terms: string[] = [];
  if (scope.sources) {
    terms.push(scope.sources.length ? `source IN (${scope.sources.map(lit).join(", ")})` : "0");
  }
  if (scope.year) terms.push(`year = ${lit(scope.year)}`);
  if (scope.month) terms.push(`month = ${lit(scope.month)}`);
  const name = `scoped_${base}`;
  sqlite.exec(`DROP VIEW IF EXISTS temp.${name}`);
  sqlite.exec(`CREATE TEMP VIEW ${name} AS SELECT * FROM ${base} ${terms.length ? `WHERE ${terms.join(" AND ")}` : ""}`);
  return name;
}

/** Scopes worth checking on a database: its own newest year, month and a source. */
function scopesFor(sqlite: Database.Database): Scope[] {
  const [year, month] = sqlite.prepare(`SELECT MAX(year), MAX(month) FROM v_live`).raw().get() as [string, string];
  const sources = (sqlite.prepare(`SELECT DISTINCT source FROM v_live ORDER BY source`).raw().all() as [string][])
    .map(([s]) => s);
  return [
    { year },
    { month },
    { sources: [sources[0]] },
    { sources: [sources[0]], year },
    { sources: [] },
    { sources },
  ];
}
```

- [ ] **Step 2: Add the scoped cases**

In `Case`, widen `view` to `string`, and add a `scope?: Scope` field. After the existing `cases()` function, add:

```ts
/** Every unscoped case again under each scope, compared with the scoped view. */
function scopedCases(scopes: Scope[]): Case[] {
  const out: Case[] = [];
  for (const scope of scopes) {
    const label = JSON.stringify(scope);
    for (const includeHidden of [false, true]) {
      const full: Scope = { ...scope, includeHidden };
      const base = includeHidden ? "v_live" : "v_summary";
      for (const c of cases().filter((c) => c.file !== "hidden_tag_total.sql" && c.view === base)) {
        out.push({ ...c, name: `${c.name} ${label}`, scope: full, run: (db) => c.runScoped!(db, full) });
      }
    }
    out.push({
      name: `hidden tag total ${label}`,
      file: "hidden_tag_total.sql",
      view: "v_live",
      scope,
      run: async (db) => [[await hiddenTagTotal(db, scope)]],
    });
  }
  return out;
}
```

To make that work, give each case in `cases()` a `runScoped` alongside `run`, with the same body but taking the scope. Add `runScoped?: (db: Db, scope: Scope) => Promise<Row[]>` to `Case`, and write each case like this:

```ts
      {
        name: `cash flow totals${tag}`,
        file: "cash_flow_totals.sql",
        view,
        run: async (db) => values([await cashFlowTotals(db, scope)]),
        runScoped: async (db, s) => values([await cashFlowTotals(db, s)]),
      },
```

Do the same for `netCashFlow` (both periods), `spendingTypeByYear`, `categoryBreakdown` (both periods, both types) and `merchantsByYear`, passing `s` wherever `scope` was passed.

Replace the suite so real data is copied to memory (temp views need a writable connection) and scoped cases run:

```ts
const databases: [string, () => Database.Database][] = [["synthetic fixture", fixture]];
if (process.env.CROSSCHECK_DB) {
  const path = process.env.CROSSCHECK_DB;
  databases.push([`CROSSCHECK_DB`, () => inMemoryCopy(path)]);
}

describe.each(databases)("analysis queries match the cross-check SQL: %s", (_label, open) => {
  const sqlite = open();
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  afterAll(() => sqlite.close());

  const all = [...cases(), ...scopedCases(scopesFor(sqlite))];
  it.each(all.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const view = c.scope ? scopedView(sqlite, c.view as "v_summary" | "v_live", c.scope) : c.view;
    const expected = reference(sqlite, c.file, view, c.params);
    expect(await c.run(db)).toEqual(expected);
  });
});
```

Import `inMemoryCopy` from `../helpers/db`.

- [ ] **Step 3: Run the tests and watch the scoped cases fail**

Run: `cd worker && npx vitest run src/__tests__/queries/analysis.test.ts`
Expected: the unscoped cases PASS, and the scoped cases FAIL, because the functions ignore `sources`, `year` and `month` and return rows from every period and source.

- [ ] **Step 4: Implement the filters**

In `analysis.ts`, change the imports to `import { and, count, eq, inArray, sql, type SQL } from "drizzle-orm";` and replace `Scope` and its helpers:

```ts
export interface Scope {
  /**
   * Count rows carrying an excluded tag. Off by default, matching the
   * Summary screen, which hides them until toggled.
   */
  includeHidden?: boolean;
  /** Only rows from these import sources. Undefined is every source; [] is none. */
  sources?: string[];
  /** "YYYY": only rows in this year. */
  year?: string;
  /** "YYYY-MM": only rows in this month. */
  month?: string;
}

/** The WHERE terms a scope adds. None when the scope is empty. */
function scopeTerms(v: typeof vSummary, scope: Scope = {}): SQL[] {
  const terms: SQL[] = [];
  if (scope.sources) terms.push(scope.sources.length ? inArray(v.source, scope.sources) : sql`0`);
  if (scope.year) terms.push(eq(v.year, scope.year));
  if (scope.month) terms.push(eq(v.month, scope.month));
  return terms;
}
```

Then add the terms to every query:
- `cashFlowTotals`: `.from(v).where(and(...scopeTerms(v, scope)))`
- `netCashFlow`: `.from(v).where(and(...scopeTerms(v, scope))).groupBy(p).orderBy(p)`
- `categoryBreakdown`: `.where(and(eq(v.type, type), ...scopeTerms(v, scope)))`
- `merchantsByYear`: `.where(and(eq(v.type, type), ...scopeTerms(v, scope)))`
- `spendingTypeByYear`: `.where(and(eq(v.type, "expense"), ...scopeTerms(v, scope)))`

Replace `hiddenTagTotal`:

```ts
/**
 * hidden_tag_total.sql: expense total of the rows the Summary hides, within
 * the scope's period and sources, as _compute_hidden_tag_total narrows it.
 */
export async function hiddenTagTotal(db: Db, scope: Omit<Scope, "includeHidden"> = {}): Promise<number> {
  const v = vLive as unknown as typeof vSummary;
  const [row] = await db
    .select({ hiddenCents: sql<number>`COALESCE(SUM(${v.amountCents}), 0)`.mapWith(Number) })
    .from(v)
    .where(
      and(
        eq(v.type, "expense"),
        inArray(v.id, db.select({ id: vExcludedIds.id }).from(vExcludedIds)),
        ...scopeTerms(v, scope),
      ),
    );
  return row.hiddenCents;
}
```

- [ ] **Step 5: Run the whole worker suite**

Run: `cd worker && npm test && npm run typecheck`
Expected: all PASS, including the unchanged "the fixture exercises each rule" block.

- [ ] **Step 6: Mutation check**

Temporarily delete the `if (scope.month) …` line in `scopeTerms`, run `npx vitest run src/__tests__/queries/analysis.test.ts`, and confirm the `{"month":"2026-03"}` cases FAIL. Restore the line. Do the same with `sql\`0\`` replaced by `undefined` (filtered out by `and`), and confirm the `{"sources":[]}` cases FAIL. Restore.

- [ ] **Step 7: Commit**

```bash
jj commit -m "Scope the analysis queries by source, year and month

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Record the Python's monthly grid, anomalies and merchant lists

**Files:**
- Modify: `tools/crosscheck/vectors.py`
- Regenerate: `worker/src/__tests__/fixtures/python_vectors.json`

**Interfaces:**
- Produces a `summary` key in `python_vectors.json`:
  ```jsonc
  {
    "categoryTypes": {"essential": {"categories": [...]}, "discretionary": {"categories": [...]}},
    "rows": [["2025-01-03", "Tesco", 30000, "expense", "Groceries", "Bank A"], ...],  // date, merchant, cents, type, category, source
    "grids": [{"year": 2026, "sources": null | ["Bank A"], "type": "expense" | "income",
               "expected": null | {"total": {"totalCents": n, "months": [n x12]},
                                   "rows": [{"category": s, "totalCents": n, "averageCents": n,
                                             "months": [n x12], "anomalies": [bool x12]}]}}],
    "merchants": [{"year": 2026, "month": null | 2, "sources": null | [...], "type": "expense" | "income",
                   "expected": [["Tesco", "Groceries", 30000], ...]}]   // merchant, modal category, cents, in display order
  }
  ```
  The income grid's `anomalies` are all `false` (the TUI never flags income).

- [ ] **Step 1: Add the synthetic rows and the runners**

In `vectors.py`, add to the imports:

```python
import re
from types import MethodType, SimpleNamespace

from rich.style import Style

from expenses.screens.summary_screen import SummaryScreen
```

Add this section before `build()`:

```python
# ---------------------------------------------------------------- summary

SUMMARY_CATEGORY_TYPES = {
    "essential": {"categories": ["Groceries", "Rent"]},
    "discretionary": {"categories": ["Dining"]},
}


def _months(first: str, last: str) -> list:
    return [p.strftime("%Y-%m") for p in pd.period_range(first, last, freq="M")]


def summary_rows() -> list:
    """Fifteen months of invented household data, shaped to hit every rule.

    - Groceries: steady with a spike in 2026-02 (an anomaly).
    - Rent: constant, so its std is 0 and it can never be an anomaly.
    - Dining: sparse, so most of its window is zeros.
    - Other: an expense category that also has an income row in its window,
      because the historical stats pivot income and expenses together.
    - Books: first appears in 2026-03, so its mean is undefined.
    - No rows at all in 2025-06, to pin down whether the month index has gaps.
    """
    rows = []
    for i, month in enumerate(_months("2025-01", "2026-03")):
        if month == "2025-06":
            continue
        groceries = 90_000 if month == "2026-02" else 30_000 + (i % 3) * 1_000
        rows.append((f"{month}-03", "Tesco", groceries, "expense", "Groceries", "Bank A"))
        rows.append((f"{month}-01", "Landlord", 150_000, "expense", "Rent", "Bank A"))
        rows.append((f"{month}-25", "Employer", 400_000 + (i % 2) * 10_000, "income", "Salary", "Bank A"))
    rows += [
        ("2025-03-14", "Cafe", 2_000, "expense", "Dining", "Card"),
        ("2025-09-20", "Cafe", 2_500, "expense", "Dining", "Card"),
        ("2026-01-10", "Cafe", 9_000, "expense", "Dining", "Card"),
        ("2026-02-11", "Bistro", 4_300, "expense", "Dining", "Card"),
        ("2025-04-02", "Mystery", 1_000, "expense", "Other", "Card"),
        ("2025-05-09", "Refund Co", 50_000, "income", "Other", "Bank A"),
        ("2025-07-12", "Mystery", 1_500, "expense", "Other", "Card"),
        ("2026-03-05", "Bookshop", 5_000, "expense", "Books", "Card"),
        ("2026-02-15", "Tesco", 1_234, "expense", "Groceries", "Card"),
    ]
    return rows


def summary_frame(rows: list, sources) -> pd.DataFrame:
    """The frame SummaryScreen.transactions returns, source filter applied."""
    df = pd.DataFrame(
        [
            {"Date": pd.Timestamp(d), "Merchant": m, "DisplayMerchant": m, "Amount": c / 100,
             "Type": t, "Category": cat, "Source": s}
            for d, m, c, t, cat, s in rows
        ]
    )
    if sources is not None:
        df = df[df["Source"].isin(sources)].copy()
    return df


class _Table:
    """Stands in for a DataTable: keeps the rows the screen adds."""

    def __init__(self):
        self.rows = []

    def clear(self, columns=False):
        self.rows = []

    def add_columns(self, *columns):
        pass

    def add_row(self, *cells, key=None):
        self.rows.append(cells)


def _screen(df: pd.DataFrame, table: _Table):
    """Just enough of a SummaryScreen for its table-filling methods to run."""
    screen = SimpleNamespace(
        transactions=df, selected_rows=set(), category_types=SUMMARY_CATEGORY_TYPES,
        query_one=lambda *_a, **_k: table,
    )
    for name in ("_prepare_monthly_summary", "_calculate_historical_stats", "_create_monthly_cell"):
        setattr(screen, name, MethodType(getattr(SummaryScreen, name), screen))
    return screen


def _plain(cell) -> str:
    return cell.plain if hasattr(cell, "plain") else re.sub(r"\[/?bold\]", "", str(cell))


def _cents(cell) -> int:
    token = _plain(cell).split()[0]
    return 0 if token == "-" else to_cents(token.replace(",", ""))


def _anomaly(cell) -> bool:
    style = getattr(cell, "style", None)
    return isinstance(style, Style) and style.bgcolor is not None and style.bgcolor.name == "dark_red"


def run_grid(rows: list, year: int, sources, income: bool):
    table = _Table()
    fill = (
        SummaryScreen._populate_monthly_income_breakdown if income
        else SummaryScreen._populate_monthly_breakdown
    )
    fill(_screen(summary_frame(rows, sources), table), table, year)
    if not table.rows:
        return None
    total, *body = table.rows
    return {
        "total": {"totalCents": _cents(total[1]), "months": [_cents(c) for c in total[3:]]},
        "rows": [
            {
                "category": _plain(r[0]),
                "totalCents": _cents(r[1]),
                "averageCents": _cents(r[2]),
                "months": [_cents(c) for c in r[3:]],
                "anomalies": [_anomaly(c) for c in r[3:]],
            }
            for r in body
        ],
    }


def run_merchants(rows: list, year: int, month, sources, income: bool) -> list:
    table = _Table()
    screen = _screen(summary_frame(rows, sources), table)
    view = SummaryScreen.update_top_income_view if income else SummaryScreen.update_top_merchants_view
    view(screen, year, month)
    return [[r[0], r[1], _cents(r[-1])] for r in table.rows]


GRID_CASES = [(2025, None), (2026, None), (2026, ["Bank A"]), (2026, ["Card"])]
MERCHANT_CASES = [
    (2026, None, None, False),
    (2026, 2, None, False),
    (2025, None, ["Card"], False),
    (2025, None, None, True),
    (2026, 3, ["Bank A"], True),
]
```

In `build()`, add this entry to the returned dict, after `"merchantEditor"`:

```python
        "summary": {
            "categoryTypes": SUMMARY_CATEGORY_TYPES,
            "rows": [list(r) for r in summary_rows()],
            "grids": [
                {"year": y, "sources": s, "type": t,
                 "expected": run_grid(summary_rows(), y, s, income=(t == "income"))}
                for y, s in GRID_CASES
                for t in ("expense", "income")
            ],
            "merchants": [
                {"year": y, "month": m, "sources": s, "type": "income" if inc else "expense",
                 "expected": run_merchants(summary_rows(), y, m, s, inc)}
                for y, m, s, inc in MERCHANT_CASES
            ],
        },
```

Update the module docstring's "Covers …" sentence to add ", and the Summary screen's monthly grid, anomaly flags and merchant lists".

- [ ] **Step 2: Generate and inspect**

Run: `PYTHONPATH=. .venv/bin/python tools/crosscheck/vectors.py`
Then: `python3 -c "import json;d=json.load(open('worker/src/__tests__/fixtures/python_vectors.json'))['summary'];g=[x for x in d['grids'] if x['year']==2026 and x['sources'] is None and x['type']=='expense'][0]['expected'];[print(r['category'],r['totalCents'],r['anomalies']) for r in g['rows']]"`

Expected: Groceries has `true` in position 1 (February). Rent is all `false`. Books is all `false`. If Groceries shows no anomaly, the fixture is not exercising the rule: adjust the spike amount upwards and rerun (don't change the Python app). Also confirm that no two rows in any grid or merchant list tie on total. Ties would make the order untestable; if there are ties, nudge an amount.

- [ ] **Step 3: Check the file is current and the Python suite still passes**

Run: `PYTHONPATH=. .venv/bin/python tools/crosscheck/vectors.py --check && make test`
Expected: "python vectors are current" and pytest passes.

- [ ] **Step 4: Commit**

```bash
jj commit -m "Record the Summary grid, anomalies and merchant lists as Python vectors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Monthly grid and anomaly flags, held to the vectors

**Files:**
- Create: `worker/src/domain/anomalies.ts`
- Create: `worker/src/domain/grid.ts`
- Create: `worker/src/api/summary.ts` (types plus `averageCents`; later tasks add to it)
- Modify: `worker/src/queries/analysis.ts` (add `categoryMonthTotalsAllTypes`)
- Create: `worker/src/__tests__/helpers/summaryStore.ts`
- Test: `worker/src/__tests__/domain/summaryVectors.test.ts`

**Interfaces:**
- Consumes: `Scope`, `categoryBreakdown(db, "month", type, scope)` from Task 1; `CategoryRow { period; category; amountCents }`.
- Produces:
  ```ts
  // queries/analysis.ts
  export async function categoryMonthTotalsAllTypes(db: Db, scope?: Scope): Promise<CategoryRow[]> // ignores scope.year/month
  // domain/anomalies.ts
  export interface MonthStats { mean: number; std: number }
  export type HistoricalStats = Map<string, Map<string, MonthStats>>   // category -> "YYYY-MM" -> stats
  export function historicalStats(cells: CategoryRow[]): HistoricalStats
  export function isAnomaly(stats: HistoricalStats, category: string, month: string, amountCents: number): boolean
  // domain/grid.ts
  export function buildGrid(cells: CategoryRow[], flag: (category: string, month: string, amountCents: number) => boolean): Grid
  // api/summary.ts
  export interface GridCell { amountCents: number; anomaly: boolean }
  export interface GridRow { category: string; months: GridCell[]; totalCents: number }
  export interface Grid { rows: GridRow[]; total: GridRow }
  export function averageCents(row: GridRow, isTotal?: boolean): number
  // __tests__/helpers/summaryStore.ts
  export type SummaryRow = [date: string, merchant: string, cents: number, type: "expense" | "income", category: string, source: string]
  export function summaryStore(rows: SummaryRow[], essential: string[], discretionary?: string[]): { sqlite: Database.Database; db: Db }
  export const summaryVectors: { categoryTypes; rows; grids; merchants }   // the "summary" section of python_vectors.json, typed
  export function vectorStore(): { sqlite: Database.Database; db: Db }       // summaryStore over summaryVectors
  ```

- [ ] **Step 1: Write the store helper**

`worker/src/__tests__/helpers/summaryStore.ts`:

```ts
/**
 * A store holding tools/crosscheck/vectors.py's summary rows, so the Summary
 * numbers can be computed through the real views and compared with the Python.
 */

import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { epochDay } from "../../domain/money";
import rawVectors from "../fixtures/python_vectors.json";
import { emptyDatabase } from "./db";

export type SummaryRow = [
  date: string, merchant: string, cents: number, type: "expense" | "income", category: string, source: string,
];

export interface ExpectedGrid {
  total: { totalCents: number; months: number[] };
  rows: { category: string; totalCents: number; averageCents: number; months: number[]; anomalies: boolean[] }[];
}

/** The "summary" section of python_vectors.json (tools/crosscheck/vectors.py). */
export const summaryVectors = (rawVectors as unknown as {
  summary: {
    categoryTypes: { essential: { categories: string[] }; discretionary: { categories: string[] } };
    rows: SummaryRow[];
    grids: { year: number; sources: string[] | null; type: "expense" | "income"; expected: ExpectedGrid | null }[];
    merchants: {
      year: number; month: number | null; sources: string[] | null; type: "expense" | "income";
      expected: [string, string, number][];
    }[];
  };
}).summary;

/**
 * Each merchant takes the category of its first row; a row with a different
 * category gets it as an override. "Other" is never stored: v_live resolves a
 * missing category to it, as the Python's fillna("Other") did. A category in
 * neither list gets no spending type, like one missing from category_types.json.
 */
export function summaryStore(
  rows: SummaryRow[], essential: string[], discretionary: string[] = [],
): { sqlite: Database.Database; db: Db } {
  const sqlite = emptyDatabase();
  sqlite.exec(`INSERT INTO users (id, email, display_name, owner_key) VALUES (1, 'a@example.com', 'A', 'self')`);

  const categoryId = (name: string): number | null => {
    if (name === "Other") return null;
    const kind = essential.includes(name) ? "essential" : discretionary.includes(name) ? "discretionary" : null;
    sqlite.prepare(`INSERT OR IGNORE INTO categories (name, spending_type) VALUES (?, ?)`).run(name, kind);
    return (sqlite.prepare(`SELECT id FROM categories WHERE name = ?`).raw().get(name) as [number])[0];
  };

  const merchantCategory = new Map<string, number | null>();
  const occurrences = new Map<string, number>();
  for (const [date, merchant, cents, type, category, source] of rows) {
    const catId = categoryId(category);
    if (!merchantCategory.has(merchant)) {
      merchantCategory.set(merchant, catId);
      sqlite.prepare(`INSERT INTO merchants (canonical_name, category_id) VALUES (?, ?)`).run(merchant, catId);
    }
    const override = merchantCategory.get(merchant) === catId ? null : catId;
    const key = JSON.stringify([date, merchant, cents]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    sqlite.prepare(`
      INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, type, source, category_override_id, occurrence)
      SELECT ?, ?, id, ?, ?, ?, ?, ? FROM merchants WHERE canonical_name = ?
    `).run(epochDay(date), merchant, cents, type, source, override, occurrence, merchant);
  }
  return { sqlite, db: drizzle(sqlite, { schema }) as unknown as Db };
}

/** A store holding the vector rows, typed as the Python's category_types. */
export function vectorStore(): { sqlite: Database.Database; db: Db } {
  const t = summaryVectors.categoryTypes;
  return summaryStore(summaryVectors.rows, t.essential.categories, t.discretionary.categories);
}
```

Test files never import from each other (Vitest would register the imported file's tests twice), which is why the vectors live here.

- [ ] **Step 2: Write the failing vector test**

`worker/src/__tests__/domain/summaryVectors.test.ts`:

```ts
/**
 * The monthly grid and its anomaly flags, computed through the views, must
 * equal what SummaryScreen._populate_monthly_breakdown shows for the same rows.
 */

import { describe, expect, it } from "vitest";

import { averageCents } from "../../api/summary";
import { historicalStats, isAnomaly } from "../../domain/anomalies";
import { buildGrid } from "../../domain/grid";
import { categoryBreakdown, categoryMonthTotalsAllTypes, type Scope } from "../../queries/analysis";
import { summaryVectors, vectorStore } from "../helpers/summaryStore";

const { db } = vectorStore();

describe("the monthly grid matches the Python", () => {
  it.each(summaryVectors.grids.map((g) => [`${g.year} ${g.type} ${JSON.stringify(g.sources)}`, g] as const))(
    "%s",
    async (_name, g) => {
      const scope: Scope = { sources: g.sources ?? undefined };
      const cells = await categoryBreakdown(db, "month", g.type, { ...scope, year: String(g.year) });
      const stats = historicalStats(await categoryMonthTotalsAllTypes(db, scope));
      const grid = buildGrid(cells, (category, month, amount) =>
        g.type === "expense" && isAnomaly(stats, category, month, amount));

      if (g.expected === null) {
        expect(grid.rows).toEqual([]);
        return;
      }
      expect(grid.total.totalCents).toBe(g.expected.total.totalCents);
      expect(grid.total.months.map((m) => m.amountCents)).toEqual(g.expected.total.months);
      expect(grid.rows.map((r) => ({
        category: r.category,
        totalCents: r.totalCents,
        months: r.months.map((m) => m.amountCents),
        anomalies: r.months.map((m) => m.anomaly),
      }))).toEqual(g.expected.rows.map(({ averageCents: _a, ...rest }) => rest));

      // The TUI shows the average to the cent; ours is exact, so within half a cent.
      grid.rows.forEach((r, i) =>
        expect(Math.abs(averageCents(r) - g.expected!.rows[i].averageCents)).toBeLessThanOrEqual(0.5));
    },
  );

  it("the fixture really has an anomaly and a zero-std category", () => {
    const g2026 = summaryVectors.grids.find((g) => g.year === 2026 && g.sources === null && g.type === "expense")!;
    const rows = new Map(g2026.expected!.rows.map((r) => [r.category, r]));
    expect(rows.get("Groceries")!.anomalies).toContain(true);
    expect(rows.get("Rent")!.anomalies).not.toContain(true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd worker && npx vitest run src/__tests__/domain/summaryVectors.test.ts`
Expected: FAIL, cannot resolve `../../api/summary` or `../../domain/anomalies`.

- [ ] **Step 4: Write the API types file**

`worker/src/api/summary.ts`:

```ts
/**
 * The Summary API's JSON, shared with the frontend, which imports this file
 * directly. Keep it free of imports so the frontend can compile and bundle it
 * as it is.
 *
 * All money is integer cents. The client derives rates and averages.
 */

export interface GridCell {
  amountCents: number;
  /** Spend above mean + 2σ of the previous 12 months (expense grid only). */
  anomaly: boolean;
}

export interface GridRow {
  category: string;
  /** Twelve entries, January first. */
  months: GridCell[];
  totalCents: number;
}

export interface Grid {
  /** Descending by total, ties by category name. */
  rows: GridRow[];
  /** Column sums, category "Total". Never an anomaly. */
  total: GridRow;
}

/**
 * The Average column. A category row averages over the months it has spend in
 * (_prepare_monthly_summary); the Total row over all twelve
 * (_populate_monthly_breakdown). Fractional cents: format, don't store.
 */
export function averageCents(row: GridRow, isTotal = false): number {
  if (isTotal) return row.totalCents / 12;
  const active = row.months.filter((m) => m.amountCents > 0).length;
  return active ? row.totalCents / active : 0;
}
```

- [ ] **Step 5: Write the query**

Append to `worker/src/queries/analysis.ts`:

```ts
/**
 * Category totals per month over every year and both types: the frame
 * _calculate_historical_stats pivots. Income is included because the Python
 * pivots the whole filtered frame, so a category with both kinds (e.g. "Other")
 * mixes them in its history. The period in the scope is ignored, since the
 * rolling window reaches back across years.
 */
export async function categoryMonthTotalsAllTypes(db: Db, scope: Scope = {}): Promise<CategoryRow[]> {
  const v = source(scope);
  return db
    .select({ period: v.month, category: v.category, amountCents: sumCents(v) })
    .from(v)
    .where(and(...scopeTerms(v, { sources: scope.sources })))
    .groupBy(v.month, v.category)
    .orderBy(v.month, v.category);
}
```

- [ ] **Step 6: Write the anomaly module**

`worker/src/domain/anomalies.ts`:

```ts
/**
 * The monthly grid's red cells: SummaryScreen._calculate_historical_stats and
 * _create_monthly_cell.
 *
 * pandas pivots category × month (every month from the first to the last in
 * the data, gaps filled with 0), takes rolling(window=12, min_periods=1)
 * mean and sample std, then shift(1), so each month is judged against the up
 * to 12 months before it. std of a single value is NaN and becomes 0. A cell
 * is an anomaly when mean > 0, std > 0 and amount > mean + 2·std.
 */

import type { CategoryRow } from "../queries/analysis";

export interface MonthStats {
  mean: number;
  std: number;
}

/** category -> "YYYY-MM" -> the stats that month is judged against. */
export type HistoricalStats = Map<string, Map<string, MonthStats>>;

/** Every "YYYY-MM" from first to last inclusive. */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function historicalStats(cells: CategoryRow[]): HistoricalStats {
  const stats: HistoricalStats = new Map();
  if (cells.length === 0) return stats;
  const months = cells.map((c) => c.period).sort();
  const index = monthRange(months[0], months[months.length - 1]);

  const byCategory = new Map<string, Map<string, number>>();
  for (const c of cells) {
    const series = byCategory.get(c.category) ?? new Map<string, number>();
    series.set(c.period, (series.get(c.period) ?? 0) + c.amountCents);
    byCategory.set(c.category, series);
  }

  for (const [category, amounts] of byCategory) {
    const series = index.map((m) => amounts.get(m) ?? 0);
    const perMonth = new Map<string, MonthStats>();
    index.forEach((month, i) => {
      const window = series.slice(Math.max(0, i - 12), i);
      if (window.length === 0) return; // mean is NaN: never an anomaly
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const std = window.length < 2
        ? 0
        : Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1));
      perMonth.set(month, { mean, std });
    });
    stats.set(category, perMonth);
  }
  return stats;
}

export function isAnomaly(stats: HistoricalStats, category: string, month: string, amountCents: number): boolean {
  const s = stats.get(category)?.get(month);
  return s !== undefined && s.mean > 0 && s.std > 0 && amountCents > s.mean + 2 * s.std;
}
```

- [ ] **Step 7: Write the grid module**

`worker/src/domain/grid.ts`:

```ts
/**
 * One year's category × month table: SummaryScreen._prepare_monthly_summary
 * and the Total row _populate_monthly_breakdown adds above it.
 */

import type { Grid, GridRow } from "../api/summary";
import type { CategoryRow } from "../queries/analysis";

type Flag = (category: string, month: string, amountCents: number) => boolean;

/** cells: one year, one type, as categoryBreakdown(db, "month", …) returns them. */
export function buildGrid(cells: CategoryRow[], flag: Flag): Grid {
  const byCategory = new Map<string, number[]>();
  for (const c of cells) {
    const months = byCategory.get(c.category) ?? new Array<number>(12).fill(0);
    months[Number(c.period.slice(5, 7)) - 1] += c.amountCents;
    byCategory.set(c.category, months);
  }
  const year = cells[0]?.period.slice(0, 4);

  const rows: GridRow[] = [...byCategory].map(([category, amounts]) => ({
    category,
    months: amounts.map((amountCents, i) => ({
      amountCents,
      anomaly: amountCents > 0 && flag(category, `${year}-${String(i + 1).padStart(2, "0")}`, amountCents),
    })),
    totalCents: amounts.reduce((a, b) => a + b, 0),
  }));
  rows.sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));

  const columnSums = Array.from({ length: 12 }, (_, i) => rows.reduce((sum, r) => sum + r.months[i].amountCents, 0));
  return {
    rows,
    total: {
      category: "Total",
      months: columnSums.map((amountCents) => ({ amountCents, anomaly: false })),
      totalCents: columnSums.reduce((a, b) => a + b, 0),
    },
  };
}
```

- [ ] **Step 8: Run the test**

Run: `cd worker && npx vitest run src/__tests__/domain/summaryVectors.test.ts`
Expected: PASS.

If an anomaly case fails, the likely cause is the month index. If pandas did not fill the 2025-06 gap, `monthRange` must build the index from the months present instead. Change `historicalStats` so the vectors pass: the Python is the spec. Record which it was in the module comment.

- [ ] **Step 9: Mutation checks**

For each of these, make the change, run the test, confirm it FAILS, and revert:
1. In `historicalStats`, change `(window.length - 1)` to `window.length` (population std).
2. Change `Math.max(0, i - 12)` to `Math.max(0, i - 11)` (an 11-month window).
3. In `categoryMonthTotalsAllTypes`, add `eq(v.type, "expense")` to the `where` (drops income from the history).
4. In `averageCents`, count months with `>= 0` instead of `> 0`.

If mutation 3 does not fail, the "Other" rows in Task 2 aren't exercising the income quirk. Raise the `Refund Co` amount and the 2025-07 `Mystery` amount in `summary_rows()` until it does, regenerate the vectors, and repeat.

- [ ] **Step 10: Typecheck and commit**

Run: `cd worker && npm test && npm run typecheck`

```bash
jj commit -m "Port the Summary's monthly grid and anomaly flags, held to the Python

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Merchant lists with their modal category

**Files:**
- Modify: `worker/src/queries/analysis.ts` (add `merchantsInScope`)
- Test: `worker/src/__tests__/queries/merchantsInScope.test.ts`

**Interfaces:**
- Consumes: `Scope`, `scopeTerms`, `source` (Task 1); `summaryStore`, `summaryVectors` and `vectorStore` (Task 3).
- Produces:
  ```ts
  export interface ScopedMerchantRow { merchant: string; category: string; amountCents: number; txnCount: number }
  export async function merchantsInScope(db: Db, type: TransactionType, scope?: Scope): Promise<ScopedMerchantRow[]>
  // descending by amount, ties by merchant name; merchant = canonical name ?? merchant_raw
  ```

- [ ] **Step 1: Write the failing test**

`worker/src/__tests__/queries/merchantsInScope.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { merchantsInScope } from "../../queries/analysis";
import { summaryStore, summaryVectors, vectorStore, type SummaryRow } from "../helpers/summaryStore";

describe("merchant lists match the Python", () => {
  const { db } = vectorStore();

  it.each(summaryVectors.merchants.map((c) => [JSON.stringify([c.year, c.month, c.sources, c.type]), c] as const))(
    "%s",
    async (_name, c) => {
      const rows = await merchantsInScope(db, c.type, {
        sources: c.sources ?? undefined,
        year: String(c.year),
        month: c.month === null ? undefined : `${c.year}-${String(c.month).padStart(2, "0")}`,
      });
      expect(rows.map((r) => [r.merchant, r.category, r.amountCents])).toEqual(c.expected);
    },
  );
});

describe("modal category", () => {
  const rows: SummaryRow[] = [
    ["2026-01-01", "Amazon", 1_000, "expense", "Shopping", "Card"],
    ["2026-01-02", "Amazon", 2_000, "expense", "Groceries", "Card"],
    ["2026-01-03", "Amazon", 3_000, "expense", "Shopping", "Card"],
    ["2026-01-04", "Deli", 500, "expense", "Dining", "Card"],
    ["2026-01-05", "Deli", 700, "expense", "Bakery", "Card"],
  ];
  const { db, sqlite } = summaryStore(rows, []);

  it("takes the most frequent category, not the biggest spend", async () => {
    const amazon = (await merchantsInScope(db, "expense")).find((r) => r.merchant === "Amazon");
    expect(amazon).toEqual({ merchant: "Amazon", category: "Shopping", amountCents: 6_000, txnCount: 3 });
  });

  it("breaks a tie alphabetically, as pandas' mode()[0] does", async () => {
    const deli = (await merchantsInScope(db, "expense")).find((r) => r.merchant === "Deli");
    expect(deli?.category).toBe("Bakery");
  });

  it("falls back to the raw name for an unresolved merchant", async () => {
    sqlite.exec(`INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, type, source)
                 VALUES (${Date.UTC(2026, 0, 9) / 1000}, 'UNRESOLVED 123', NULL, 250, 'expense', 'Card')`);
    const rows = await merchantsInScope(db, "expense");
    expect(rows.find((r) => r.merchant === "UNRESOLVED 123")).toMatchObject({ category: "Other", amountCents: 250 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && npx vitest run src/__tests__/queries/merchantsInScope.test.ts`
Expected: FAIL, `merchantsInScope` is not exported.

- [ ] **Step 3: Implement**

Append to `worker/src/queries/analysis.ts`:

```ts
export interface ScopedMerchantRow {
  /** Canonical name, or the statement's text when it never resolved (as v_transactions). */
  merchant: string;
  /** Most frequent category among the rows in scope; ties go alphabetically first. */
  category: string;
  amountCents: number;
  txnCount: number;
}

/**
 * The Summary's merchant tables (update_top_merchants_view and
 * update_top_income_view) for one scope. Descending by amount, then name.
 */
export async function merchantsInScope(
  db: Db,
  type: TransactionType,
  scope: Scope = {},
): Promise<ScopedMerchantRow[]> {
  const v = source(scope);
  const name = sql<string>`COALESCE(${v.merchant}, ${v.merchantRaw})`;
  const parts = await db
    .select({ merchant: name, category: v.category, amountCents: sumCents(v), txnCount: count() })
    .from(v)
    .where(and(eq(v.type, type), ...scopeTerms(v, scope)))
    .groupBy(name, v.category);

  const merged = new Map<string, ScopedMerchantRow & { modeCount: number }>();
  for (const p of parts) {
    const m = merged.get(p.merchant);
    if (!m) {
      merged.set(p.merchant, { ...p, modeCount: p.txnCount });
      continue;
    }
    m.amountCents += p.amountCents;
    m.txnCount += p.txnCount;
    if (p.txnCount > m.modeCount || (p.txnCount === m.modeCount && p.category < m.category)) {
      m.category = p.category;
      m.modeCount = p.txnCount;
    }
  }
  return [...merged.values()]
    .map(({ modeCount: _modeCount, ...row }) => row)
    .sort((a, b) => b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant));
}
```

- [ ] **Step 4: Run it**

Run: `cd worker && npx vitest run src/__tests__/queries/`
Expected: PASS.

- [ ] **Step 5: Mutation checks**

1. Change the tie-break `p.category < m.category` to `>`. The "breaks a tie" test must FAIL. Revert.
2. Change `COALESCE(${v.merchant}, ${v.merchantRaw})` to `${v.merchant}`. The "falls back" test must FAIL. Revert.
3. Drop `...scopeTerms(v, scope)`. The vector cases with a month or sources must FAIL. Revert.

- [ ] **Step 6: Commit**

```bash
jj commit -m "Add merchant lists with their most frequent category

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The summary service and the full API types

**Files:**
- Modify: `worker/src/api/summary.ts` (add response types)
- Create: `worker/src/services/summary.ts`
- Test: `worker/src/__tests__/services/summary.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4; `categories`, `spendingTypeBudgets`, `tagExclusionPatterns` and `vLive` from `db/schema`.
- Produces:
  ```ts
  // api/summary.ts
  export type SpendingKind = "essential" | "discretionary";
  export interface PeriodsResponse { years: { year: number; months: number[] }[]; sources: string[] }
  export interface CategoryItem { category: string; spendingType: SpendingKind | null; amountCents: number }
  export interface MerchantItem { merchant: string; category: string; spendingType: SpendingKind | null; amountCents: number; txnCount: number }
  export interface MonthTotals { month: number; incomeCents: number; expensesCents: number }
  export interface SummaryResponse {
    year: number; month: number | null;
    cashFlow: { incomeCents: number; expensesCents: number };
    spendingType: { essentialCents: number; discretionaryCents: number; essentialBudgetCents: number | null; discretionaryBudgetCents: number | null };
    expenseCategories: CategoryItem[]; incomeCategories: CategoryItem[];
    topMerchants: MerchantItem[]; topIncome: MerchantItem[];
    monthlyTotals: MonthTotals[] | null;
    monthly: { expense: Grid; income: Grid } | null;
    hiddenCents: number; excludedPatterns: string[];
  }
  // services/summary.ts
  export interface SummaryQuery { year: number; month: number | null; sources?: string[]; includeHidden: boolean }
  export async function summaryPeriods(db: Db): Promise<PeriodsResponse>
  export async function buildSummary(db: Db, q: SummaryQuery): Promise<SummaryResponse>
  ```

- [ ] **Step 1: Add the response types**

Append to `worker/src/api/summary.ts`:

```ts
export type SpendingKind = "essential" | "discretionary";

export interface PeriodsResponse {
  /** Newest year first; months ascending, 1–12. */
  years: { year: number; months: number[] }[];
  sources: string[];
}

export interface CategoryItem {
  category: string;
  /** Expenses: essential, else discretionary (as get_category_spending_type). Income: null. */
  spendingType: SpendingKind | null;
  amountCents: number;
}

export interface MerchantItem {
  merchant: string;
  category: string;
  spendingType: SpendingKind | null;
  amountCents: number;
  txnCount: number;
}

export interface MonthTotals {
  month: number;
  incomeCents: number;
  expensesCents: number;
}

export interface SummaryResponse {
  year: number;
  month: number | null;
  cashFlow: { incomeCents: number; expensesCents: number };
  spendingType: {
    essentialCents: number;
    discretionaryCents: number;
    /** Annual; the client divides by 12 in a month view, as the TUI does. */
    essentialBudgetCents: number | null;
    discretionaryBudgetCents: number | null;
  };
  /** Descending by amount. */
  expenseCategories: CategoryItem[];
  incomeCategories: CategoryItem[];
  /** Every merchant, descending by amount. */
  topMerchants: MerchantItem[];
  topIncome: MerchantItem[];
  /** Year view only: twelve entries, January first. */
  monthlyTotals: MonthTotals[] | null;
  /** Year view only. */
  monthly: { expense: Grid; income: Grid } | null;
  /** Expense total the tag exclusion hides in this period and these sources. */
  hiddenCents: number;
  excludedPatterns: string[];
}
```

- [ ] **Step 2: Write the failing service test**

`worker/src/__tests__/services/summary.test.ts`:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { netCashFlow } from "../../queries/analysis";
import { buildSummary, summaryPeriods } from "../../services/summary";
import { inMemoryCopy } from "../helpers/db";
import { summaryStore, vectorStore } from "../helpers/summaryStore";

describe("summaryPeriods", () => {
  it("lists years newest first with their months, and every source", async () => {
    const { db } = vectorStore();
    const periods = await summaryPeriods(db);
    expect(periods.years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(periods.years[0].months).toEqual([1, 2, 3]);
    expect(periods.years[1].months).not.toContain(6); // the gap month
    expect(periods.sources).toEqual(["Bank A", "Card"]);
  });

  it("is empty for an empty store", async () => {
    const { db } = summaryStore([], []);
    expect(await summaryPeriods(db)).toEqual({ years: [], sources: [] });
  });
});

describe("buildSummary", () => {
  const { db, sqlite } = vectorStore();
  sqlite.exec(`
    INSERT INTO spending_type_budgets (spending_type, annual_budget_cents) VALUES ('essential', 2400000), ('discretionary', NULL);
    INSERT INTO tags (id, name) VALUES (1, 'emergency');
    INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency'), ('trip:*');
    INSERT INTO transaction_tags (transaction_id, tag_id)
      SELECT id, 1 FROM transactions WHERE merchant_raw = 'Bookshop';
  `);

  it("builds a year view whose parts agree with each other", async () => {
    const s = await buildSummary(db, { year: 2026, month: null, includeHidden: false });
    expect(s.year).toBe(2026);
    expect(s.month).toBeNull();
    expect(s.spendingType.essentialCents + s.spendingType.discretionaryCents).toBe(s.cashFlow.expensesCents);
    expect(s.expenseCategories.reduce((a, c) => a + c.amountCents, 0)).toBe(s.cashFlow.expensesCents);
    expect(s.topIncome.reduce((a, c) => a + c.amountCents, 0)).toBe(s.cashFlow.incomeCents);
    expect(s.monthlyTotals).toHaveLength(12);
    expect(s.monthlyTotals!.reduce((a, m) => a + m.expensesCents, 0)).toBe(s.cashFlow.expensesCents);
    expect(s.monthly!.expense.total.totalCents).toBe(s.cashFlow.expensesCents);
    expect(s.spendingType.essentialBudgetCents).toBe(2_400_000);
    expect(s.spendingType.discretionaryBudgetCents).toBeNull();
  });

  it("orders categories by amount and labels spending type like the TUI", async () => {
    const s = await buildSummary(db, { year: 2026, month: null, includeHidden: false });
    const amounts = s.expenseCategories.map((c) => c.amountCents);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    expect(s.expenseCategories.find((c) => c.category === "Rent")?.spendingType).toBe("essential");
    expect(s.expenseCategories.find((c) => c.category === "Other")).toBeUndefined(); // no 2026 Other spend
    expect(s.expenseCategories.find((c) => c.category === "Dining")?.spendingType).toBe("discretionary");
    expect(s.incomeCategories.every((c) => c.spendingType === null)).toBe(true);
    // Books has no spending type stored; the TUI counts it as discretionary.
    const all = await buildSummary(db, { year: 2026, month: null, includeHidden: true });
    expect(all.expenseCategories.find((c) => c.category === "Books")?.spendingType).toBe("discretionary");
  });

  it("hides excluded tags by default and reports what it hid", async () => {
    const hidden = await buildSummary(db, { year: 2026, month: 3, includeHidden: false });
    const shown = await buildSummary(db, { year: 2026, month: 3, includeHidden: true });
    expect(hidden.hiddenCents).toBe(5_000);
    expect(shown.cashFlow.expensesCents - hidden.cashFlow.expensesCents).toBe(5_000);
    expect(hidden.excludedPatterns).toEqual(["emergency", "trip:*"]);
  });

  it("leaves year-only parts out of a month view", async () => {
    const s = await buildSummary(db, { year: 2026, month: 2, includeHidden: false });
    expect(s.month).toBe(2);
    expect(s.monthlyTotals).toBeNull();
    expect(s.monthly).toBeNull();
  });

  it("returns zeros, not an error, for a source filter that matches nothing", async () => {
    const s = await buildSummary(db, { year: 2026, month: null, sources: [], includeHidden: false });
    expect(s.cashFlow).toEqual({ incomeCents: 0, expensesCents: 0 });
    expect(s.expenseCategories).toEqual([]);
    expect(s.monthly!.expense.rows).toEqual([]);
  });
});

describe.runIf(process.env.CROSSCHECK_DB)("buildSummary on real data", () => {
  const sqlite: Database.Database = inMemoryCopy(process.env.CROSSCHECK_DB!);
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  afterAll(() => sqlite.close());

  it("each year's cash flow equals v_summary's", async () => {
    for (const row of await netCashFlow(db, "year")) {
      const s = await buildSummary(db, { year: Number(row.period), month: null, includeHidden: false });
      expect(s.cashFlow).toEqual({ incomeCents: row.incomeCents, expensesCents: row.expensesCents });
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd worker && npx vitest run src/__tests__/services/summary.test.ts`
Expected: FAIL, `../../services/summary` not found.

- [ ] **Step 4: Implement the service**

`worker/src/services/summary.ts`:

```ts
/**
 * The Summary screen's data for one view, assembled from the analysis queries.
 * Route handlers only parse and serialise; everything with a rule lives here
 * or below.
 */

import { asc } from "drizzle-orm";
import type {
  CategoryItem, MerchantItem, MonthTotals, PeriodsResponse, SpendingKind, SummaryResponse,
} from "../api/summary";
import { categories, spendingTypeBudgets, tagExclusionPatterns, vLive } from "../db/schema";
import type { Db } from "../db/types";
import { historicalStats, isAnomaly } from "../domain/anomalies";
import { buildGrid } from "../domain/grid";
import {
  cashFlowTotals, categoryBreakdown, categoryMonthTotalsAllTypes, hiddenTagTotal,
  merchantsInScope, netCashFlow, spendingTypeByYear, type Scope, type TransactionType,
} from "../queries/analysis";

export interface SummaryQuery {
  year: number;
  /** 1–12, or null for the whole year. */
  month: number | null;
  /** Undefined is every source; [] is none. */
  sources?: string[];
  includeHidden: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

export async function summaryPeriods(db: Db): Promise<PeriodsResponse> {
  const months = await db.selectDistinct({ month: vLive.month }).from(vLive).orderBy(asc(vLive.month));
  const sources = await db.selectDistinct({ source: vLive.source }).from(vLive).orderBy(asc(vLive.source));

  const byYear = new Map<number, number[]>();
  for (const { month } of months) {
    const year = Number(month.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), Number(month.slice(5, 7))]);
  }
  return {
    years: [...byYear].sort(([a], [b]) => b - a).map(([year, ms]) => ({ year, months: ms })),
    sources: sources.map((s) => s.source),
  };
}

/** get_category_spending_type: anything not essential is discretionary. Income has none. */
function kindOf(types: Map<string, SpendingKind | null>, category: string, type: TransactionType): SpendingKind | null {
  if (type === "income") return null;
  return types.get(category) === "essential" ? "essential" : "discretionary";
}

export async function buildSummary(db: Db, q: SummaryQuery): Promise<SummaryResponse> {
  const scope: Scope = {
    includeHidden: q.includeHidden,
    sources: q.sources,
    year: String(q.year),
    month: q.month === null ? undefined : `${q.year}-${pad(q.month)}`,
  };
  const yearView = q.month === null;

  const [
    cashFlow, splitRows, budgetRows, typeRows, expenseCats, incomeCats,
    expenseMerchants, incomeMerchants, hiddenCents, patternRows,
  ] = await Promise.all([
    cashFlowTotals(db, scope),
    spendingTypeByYear(db, scope),
    db.select().from(spendingTypeBudgets),
    db.select({ name: categories.name, spendingType: categories.spendingType }).from(categories),
    categoryBreakdown(db, "year", "expense", scope),
    categoryBreakdown(db, "year", "income", scope),
    merchantsInScope(db, "expense", scope),
    merchantsInScope(db, "income", scope),
    hiddenTagTotal(db, { sources: scope.sources, year: scope.year, month: scope.month }),
    db.select({ pattern: tagExclusionPatterns.pattern }).from(tagExclusionPatterns).orderBy(asc(tagExclusionPatterns.id)),
  ]);

  const types = new Map(typeRows.map((t) => [t.name, t.spendingType]));
  const budget = (kind: SpendingKind) =>
    budgetRows.find((b) => b.spendingType === kind)?.annualBudgetCents ?? null;
  const split = (kind: SpendingKind) =>
    splitRows.filter((r) => r.spendingType === kind).reduce((a, r) => a + r.amountCents, 0);

  const categoryItems = (rows: typeof expenseCats, type: TransactionType): CategoryItem[] =>
    rows
      .map((r) => ({ category: r.category, spendingType: kindOf(types, r.category, type), amountCents: r.amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category));
  const merchantItems = (rows: typeof expenseMerchants, type: TransactionType): MerchantItem[] =>
    rows.map((r) => ({ ...r, spendingType: kindOf(types, r.category, type) }));

  let monthlyTotals: MonthTotals[] | null = null;
  let monthly: SummaryResponse["monthly"] = null;
  if (yearView) {
    const [flows, expenseCells, incomeCells, history] = await Promise.all([
      netCashFlow(db, "month", scope),
      categoryBreakdown(db, "month", "expense", scope),
      categoryBreakdown(db, "month", "income", scope),
      categoryMonthTotalsAllTypes(db, scope),
    ]);
    const byMonth = new Map(flows.map((f) => [Number(f.period.slice(5, 7)), f]));
    monthlyTotals = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      incomeCents: byMonth.get(i + 1)?.incomeCents ?? 0,
      expensesCents: byMonth.get(i + 1)?.expensesCents ?? 0,
    }));
    const stats = historicalStats(history);
    monthly = {
      expense: buildGrid(expenseCells, (c, m, a) => isAnomaly(stats, c, m, a)),
      income: buildGrid(incomeCells, () => false),
    };
  }

  return {
    year: q.year,
    month: q.month,
    cashFlow,
    spendingType: {
      essentialCents: split("essential"),
      discretionaryCents: split("discretionary"),
      essentialBudgetCents: budget("essential"),
      discretionaryBudgetCents: budget("discretionary"),
    },
    expenseCategories: categoryItems(expenseCats, "expense"),
    incomeCategories: categoryItems(incomeCats, "income"),
    topMerchants: merchantItems(expenseMerchants, "expense"),
    topIncome: merchantItems(incomeMerchants, "income"),
    monthlyTotals,
    monthly,
    hiddenCents,
    excludedPatterns: patternRows.map((p) => p.pattern),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd worker && npx vitest run src/__tests__/services/summary.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Mutation checks**

1. Pass `scope` instead of the stripped object to `hiddenTagTotal`. Nothing changes, since `includeHidden` is ignored there. Instead, remove `month: scope.month` from that object; the "hides excluded tags" test must FAIL. Revert.
2. Make `kindOf` return `types.get(category) ?? null` for expenses. The "labels spending type" test must FAIL on Books. Revert.

- [ ] **Step 7: Commit**

```bash
jj commit -m "Add the summary service behind the Summary API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hono app, routes and static assets

**Files:**
- Modify: `worker/package.json`, `worker/package-lock.json`
- Create: `worker/src/app.ts`
- Create: `worker/src/routes/summary.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/wrangler.toml`
- Test: `worker/src/__tests__/app/app.test.ts`

**Interfaces:**
- Consumes: `getUser`, `AuthConfig`, `AuthDeps` and `User` (`auth.ts`); `buildSummary`, `summaryPeriods` and `SummaryQuery` (Task 5).
- Produces:
  ```ts
  // app.ts
  export interface AppBindings {
    CF_ACCESS_TEAM_DOMAIN: string; CF_ACCESS_AUD: string; DEV_USER_EMAIL?: string;
    ASSETS: { fetch(request: Request): Promise<Response> };
  }
  export type AppEnv<B extends AppBindings> = { Bindings: B; Variables: { user: User; db: Db } };
  export function createApp<B extends AppBindings>(makeDb: (env: B) => Db, auth?: AuthDeps): Hono<AppEnv<B>>
  export function withCacheHeaders(res: Response, path: string): Response
  // routes/summary.ts
  export function parseSummaryQuery(url: URL): { ok: true; query: SummaryQuery } | { ok: false; error: string }
  ```
  `app.ts` must not import `db/client.ts`, since tests typecheck without Workers types.

- [ ] **Step 1: Add the dependencies**

In `worker/package.json`, add these to `dependencies`: `"hono": "^4.10.0"` and `"zod": "^4.1.0"`. Then run:

```bash
cd worker && cp package-lock.json /tmp/worker-lock.before.json 2>/dev/null; rm -rf node_modules package-lock.json && npm install
grep -c '"node_modules/@rolldown/binding-' package-lock.json   # must print 15
npm ls --depth=0
```

Compare the top-level versions in `npm ls` with before: only `hono` and `zod` should be new. If other packages jumped a major version, pin them back in `package.json` and redo. Run `npm test` to confirm Vitest still starts.

- [ ] **Step 2: Write the failing app test**

`worker/src/__tests__/app/app.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createApp, withCacheHeaders, type AppBindings } from "../../app";
import { vectorStore } from "../helpers/summaryStore";

const { db } = vectorStore();

function setup(email = "a@example.com") {
  const assets = vi.fn(async (req: Request) =>
    new Response(`asset ${new URL(req.url).pathname}`, { headers: { "content-type": "text/html" } }));
  const env: AppBindings = {
    CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
    DEV_USER_EMAIL: email,
    ASSETS: { fetch: assets },
  };
  const app = createApp(() => db);
  const get = (path: string, host = "http://localhost") => app.request(`${host}${path}`, {}, env);
  return { get, assets };
}

describe("authentication", () => {
  it("refuses an unauthenticated request before serving anything, assets included", async () => {
    const { get, assets } = setup();
    const res = await get("/index.html", "https://expenses.example.com"); // not localhost: no dev user
    expect(res.status).toBe(401);
    expect(assets).not.toHaveBeenCalled();
  });

  it("refuses a logged-in email that is not a household user", async () => {
    const { get } = setup("stranger@example.com");
    expect((await get("/api/me")).status).toBe(403);
  });

  it("returns the user from /api/me", async () => {
    const { get } = setup();
    expect(await (await get("/api/me")).json()).toMatchObject({ email: "a@example.com" });
  });
});

describe("/api/summary", () => {
  it("lists periods", async () => {
    const body = await (await setup().get("/api/summary/periods")).json() as { years: { year: number }[] };
    expect(body.years[0].year).toBe(2026);
  });

  it("returns a year view", async () => {
    const res = await setup().get("/api/summary?year=2026");
    expect(res.status).toBe(200);
    const body = await res.json() as { month: null; monthly: unknown };
    expect(body.month).toBeNull();
    expect(body.monthly).not.toBeNull();
  });

  it("filters by repeated sources, including names with commas and quotes", async () => {
    const { get } = setup();
    const card = await (await get("/api/summary?year=2026&sources=Card")).json() as { cashFlow: { incomeCents: number } };
    expect(card.cashFlow.incomeCents).toBe(0);
    const odd = await get("/api/summary?year=2026&sources=" + encodeURIComponent("O'Brien, Ltd"));
    expect(odd.status).toBe(200);
    const none = await (await get("/api/summary?year=2026&sources=")).json() as { cashFlow: { expensesCents: number } };
    expect(none.cashFlow.expensesCents).toBe(0);
  });

  it.each([
    ["missing year", "/api/summary"],
    ["bad year", "/api/summary?year=26"],
    ["month 13", "/api/summary?year=2026&month=13"],
    ["month 0", "/api/summary?year=2026&month=0"],
    ["bad hidden", "/api/summary?year=2026&hidden=yes"],
  ])("rejects %s with a 400 and a message", async (_name, path) => {
    const res = await setup().get(path);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });
});

describe("routing", () => {
  it("answers an unknown API path with a JSON 404, not the app", async () => {
    const { get, assets } = setup();
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(assets).not.toHaveBeenCalled();
  });

  it("serves anything else from the assets, with the right caching", async () => {
    const { get } = setup();
    const page = await get("/some/client/route");
    expect(await page.text()).toBe("asset /some/client/route");
    expect(page.headers.get("cache-control")).toBe("no-store");
    const bundle = await get("/assets/index-abc123.js");
    expect(bundle.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("does not mark a failed asset response immutable", () => {
    const res = withCacheHeaders(new Response("x", { status: 404 }), "/assets/missing.js");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd worker && npx vitest run src/__tests__/app/`
Expected: FAIL, `../../app` not found.

- [ ] **Step 4: Write the summary routes**

`worker/src/routes/summary.ts`:

```ts
/**
 * /api/summary and /api/summary/periods. Parse, call the service, serialise.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import { buildSummary, summaryPeriods, type SummaryQuery } from "../services/summary";

const Params = z.object({
  year: z.string().regex(/^\d{4}$/, "year must be four digits").transform(Number),
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/, "month must be 1–12").transform(Number).optional(),
  hidden: z.enum(["0", "1"], "hidden must be 0 or 1").optional(),
});

/**
 * `sources` is a repeated parameter, so a name may contain commas. Absent
 * means every source; a single empty value means none.
 */
export function parseSummaryQuery(url: URL): { ok: true; query: SummaryQuery } | { ok: false; error: string } {
  const single = Object.fromEntries(["year", "month", "hidden"].flatMap((k) => {
    const v = url.searchParams.get(k);
    return v === null ? [] : [[k, v]];
  }));
  const parsed = Params.safeParse(single);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.path.length ? issue.message : "year is required" };
  }
  const raw = url.searchParams.getAll("sources");
  const sources = raw.length === 0 ? undefined : raw.filter((s) => s !== "");
  return {
    ok: true,
    query: {
      year: parsed.data.year,
      month: parsed.data.month ?? null,
      sources,
      includeHidden: parsed.data.hidden === "1",
    },
  };
}

export function summaryRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/periods", async (c) => c.json(await summaryPeriods(c.get("db"))));

  routes.get("/", async (c) => {
    const parsed = parseSummaryQuery(new URL(c.req.url));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json(await buildSummary(c.get("db"), parsed.query));
  });

  return routes;
}
```

Check what Zod reports for a missing required `year`: its issue has `path: ["year"]` and a generic message. Adjust the error selection so that a missing year returns "year is required" and each regex failure returns its own message. The test only needs an `error` field, but the messages should be readable.

- [ ] **Step 5: Write the app**

`worker/src/app.ts`:

```ts
/**
 * The Worker as a Hono app. Every request, static files included, passes
 * getUser first (wrangler.toml sets run_worker_first), so nothing is served to
 * a request Access did not vouch for.
 *
 * The database comes from the caller: index.ts passes createDb over env.DB,
 * tests pass an in-memory SQLite. That keeps env.DB inside db/client.ts and
 * this file free of Workers-only types.
 */

import { Hono } from "hono";

import { getUser, type AuthDeps, type User } from "./auth";
import { count, isNull } from "drizzle-orm";
import { transactions } from "./db/schema";
import type { Db } from "./db/types";
import { summaryRoutes } from "./routes/summary";

export interface AppBindings {
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  /** Local development only, from worker/.dev.vars. See AuthConfig. */
  DEV_USER_EMAIL?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export type AppEnv<B extends AppBindings> = { Bindings: B; Variables: { user: User; db: Db } };

/** Hashed build output can be cached forever; anything else must be revalidated. */
export function withCacheHeaders(res: Response, path: string): Response {
  const out = new Response(res.body, res);
  out.headers.set(
    "Cache-Control",
    res.ok && path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store",
  );
  return out;
}

export function createApp<B extends AppBindings>(makeDb: (env: B) => Db, auth: AuthDeps = {}) {
  const app = new Hono<AppEnv<B>>();

  app.use("*", async (c, next) => {
    const db = makeDb(c.env);
    const result = await getUser(c.req.raw, {
      teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
      aud: c.env.CF_ACCESS_AUD,
      devUserEmail: c.env.DEV_USER_EMAIL,
    }, db, auth);
    if (!result.ok) {
      console.warn(`auth refused (${result.status}): ${result.reason}`);
      // The reason stays in the log; the client learns only the status.
      return c.body(null, result.status);
    }
    c.set("user", result.user);
    c.set("db", db);
    await next();
  });

  app.get("/health", async (c) => {
    const [row] = await c.get("db")
      .select({ transactions: count() })
      .from(transactions)
      .where(isNull(transactions.deletedAt));
    return c.json({ ok: true, ...row });
  });

  // Who the Worker thinks you are: the first thing to check after deploying.
  app.get("/api/me", (c) => c.json(c.get("user")));

  app.route("/api/summary", summaryRoutes<B>());

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  app.all("*", async (c) => withCacheHeaders(await c.env.ASSETS.fetch(c.req.raw), new URL(c.req.url).pathname));

  return app;
}
```

Sort the imports so that the `drizzle-orm` import comes before the local ones, matching the other files.

- [ ] **Step 6: Rewire `index.ts`**

Replace `worker/src/index.ts` with:

```ts
/**
 * Worker entry point: the Hono app in src/app.ts over D1.
 *
 * Every route is authenticated: getUser (src/auth.ts) verifies the Cloudflare
 * Access JWT before anything touches the database or the static assets. There
 * are no public routes, so a misrouted request that skipped Access still gets
 * nothing.
 */

import { createApp, type AppBindings } from "./app";
import { createDb } from "./db/client";

export interface Env extends AppBindings {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default createApp<Env>((env) => createDb(env.DB)) satisfies ExportedHandler<Env>;
```

If `satisfies ExportedHandler<Env>` doesn't type-check against a Hono instance, export `{ fetch: app.fetch } satisfies ExportedHandler<Env>` instead.

- [ ] **Step 7: Configure the assets**

In `worker/wrangler.toml`, add this after the `routes = [...]` block and before `[[d1_databases]]` (top-level keys stay above the first table, but `[assets]` is itself a table):

```toml
# The frontend build, served by this Worker on the same origin. run_worker_first
# sends every request, static files included, through getUser; an unknown path
# gets index.html so client-side routes survive a reload.
[assets]
directory = "../frontend/dist"
binding = "ASSETS"
run_worker_first = true
not_found_handling = "single-page-application"
```

- [ ] **Step 8: Run everything**

Run: `cd worker && npm test && npm run typecheck`
Expected: PASS.

Then run `mkdir -p ../frontend/dist && echo '<h1>placeholder</h1>' > ../frontend/dist/index.html && npx wrangler deploy --dry-run --outdir /tmp/wrangler-dry`. Expected: the bundle builds and wrangler accepts the `[assets]` block. Then `rm -rf ../frontend/dist /tmp/wrangler-dry`.

- [ ] **Step 9: Mutation checks**

1. Move `app.all("*", …assets…)` above the `app.use` middleware. The "refuses an unauthenticated request … assets included" test must FAIL. Revert.
2. Delete the `app.all("/api/*", …)` line. The "unknown API path" test must FAIL. Revert.

- [ ] **Step 10: Commit**

```bash
jj commit -m "Serve the API and the frontend from one Hono Worker behind getUser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend scaffold, money and API client

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`, `frontend/tsconfig.json`, `frontend/vitest.config.ts`
- Create: `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`
- Create: `frontend/src/lib/money.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/useMediaQuery.ts`
- Test: `frontend/src/__tests__/setup.ts`, `frontend/src/__tests__/lib/money.test.ts`, `frontend/src/__tests__/lib/api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/money.ts
  export function formatCents(cents: number, opts?: { compact?: boolean }): string
  export function formatPercent(value: number | null, digits?: number): string   // null -> "—"
  export function savingsRate(incomeCents: number, expensesCents: number): number | null
  // lib/api.ts
  export class ApiError extends Error { status: number }
  export const NOT_SET_UP = "This account is not set up for the household.";
  export const page: { reload(): void }   // wraps window.location.reload so tests can spy on it
  export async function getJson<T>(path: string): Promise<T>
  // lib/useMediaQuery.ts
  export function useMediaQuery(query: string): boolean
  export const DESKTOP = "(min-width: 768px)";
  ```

- [ ] **Step 1: Dependencies**

In `frontend/package.json`, set:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.90.0",
    "pdfjs-dist": "^6.3.289",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router": "^7.13.0",
    "recharts": "^3.3.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "jsdom": "^28.1.0",
    "tailwindcss": "^4.2.1",
    "typescript": "~5.9.3",
    "vite": "^7.3.1",
    "vitest": "^4.1.11"
  }
```

Then `cd frontend && rm -rf node_modules package-lock.json && npm install && npm test`. The existing payslip tests must still pass.

- [ ] **Step 2: Config files**

`frontend/tsconfig.json`: add `"jsx": "react-jsx"` to `compilerOptions`, and `"types": ["vitest/globals", "@testing-library/jest-dom"]`.

`frontend/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // wrangler dev: the API, with DEV_USER_EMAIL standing in for Access.
    proxy: { "/api": "http://localhost:8787" },
    // src/lib/types.ts imports ../worker/src/api/summary.ts.
    fs: { allow: [".."] },
  },
});
```

`frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Node by default: the payslip parser is pure text handling. Component
    // tests opt in with a `@vitest-environment jsdom` docblock.
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
```

`frontend/src/__tests__/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

`frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>Expenses</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/src/index.css`:

```css
@import "tailwindcss";

/* Colour meaning, used everywhere a figure is shown. */
@theme {
  --color-income: oklch(0.62 0.15 155);
  --color-expense: oklch(0.6 0.19 25);
  --color-essential: oklch(0.75 0.15 75);
  --color-discretionary: oklch(0.62 0.19 25);
  --color-anomaly: oklch(0.6 0.21 25);
}

html { font-feature-settings: "tnum"; } /* figures line up in columns */
body { @apply bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased; }
```

`frontend/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`frontend/src/App.tsx` (the Summary page arrives in Task 8):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } });

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<main className="p-4">Expenses</main>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Write the failing lib tests**

`frontend/src/__tests__/lib/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCents, formatPercent, savingsRate } from "../../lib/money";

describe("formatCents", () => {
  it("formats euros with two decimals and grouping", () => {
    expect(formatCents(123_456)).toBe("€1,234.56");
    expect(formatCents(0)).toBe("€0.00");
    expect(formatCents(-1_234)).toBe("-€12.34");
  });
  it("has a compact form for small tiles", () => {
    expect(formatCents(6_140_000, { compact: true })).toBe("€61.4K");
    expect(formatCents(95_000, { compact: true })).toBe("€950");
  });
});

describe("savingsRate", () => {
  it("is net over income, in percent", () => {
    expect(savingsRate(10_000, 7_500)).toBe(25);
  });
  it("can be negative", () => {
    expect(savingsRate(10_000, 12_000)).toBe(-20);
  });
  it("is null with no income, never a division by zero", () => {
    expect(savingsRate(0, 5_000)).toBeNull();
  });
});

describe("formatPercent", () => {
  it("shows a dash for null", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(36.63)).toBe("36.6%");
  });
});
```

`frontend/src/__tests__/lib/api.test.ts`:

```ts
/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NOT_SET_UP, getJson, page } from "../../lib/api";

// jsdom's window.location cannot be replaced, so the reload goes through `page`.
let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sessionStorage.clear();
  reload = vi.spyOn(page, "reload").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const respond = (res: Partial<Response>) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 200, type: "basic", json: async () => ({}), ...res })));

describe("getJson", () => {
  it("returns the parsed body", async () => {
    respond({ ok: true, status: 200, json: async () => ({ a: 1 }) });
    expect(await getJson("/api/x")).toEqual({ a: 1 });
  });

  it("reloads once when Access redirects, and not again straight after", async () => {
    respond({ status: 0, type: "opaqueredirect" });
    await expect(getJson("/api/x")).rejects.toBeInstanceOf(ApiError);
    await expect(getJson("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on a 401", async () => {
    respond({ status: 401 });
    await expect(getJson("/api/x")).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload on a 403, which would loop, and says why", async () => {
    respond({ status: 403 });
    await expect(getJson("/api/x")).rejects.toThrow(NOT_SET_UP);
    expect(reload).not.toHaveBeenCalled();
  });

  it("surfaces the API's error message", async () => {
    respond({ status: 400, json: async () => ({ error: "year must be four digits" }) });
    await expect(getJson("/api/x")).rejects.toThrow("year must be four digits");
  });
});
```

Run: `cd frontend && npm test`
Expected: FAIL, the modules don't exist.

- [ ] **Step 4: Implement**

`frontend/src/lib/money.ts`:

```ts
/**
 * Display only. Amounts arrive as integer cents; dividing by 100 here is the
 * safe direction (cents to euros for display), never the reverse.
 */

const full = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const compact = new Intl.NumberFormat("en-IE", {
  style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1,
});

export function formatCents(cents: number, opts: { compact?: boolean } = {}): string {
  return (opts.compact ? compact : full).format(cents / 100);
}

/** get_cash_flow_totals' savings rate, in percent. Null when there is no income. */
export function savingsRate(incomeCents: number, expensesCents: number): number | null {
  if (incomeCents <= 0) return null;
  return ((incomeCents - expensesCents) / incomeCents) * 100;
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}
```

If the `Intl` output differs from the test in a trivial way (e.g. `€950.0` in compact mode), fix the formatter options, not the test. The test states what should be displayed.

`frontend/src/lib/api.ts`:

```ts
/**
 * Fetching from the Worker. Access sits in front of it: when the Access
 * session lapses, requests are redirected to the login page, which a fetch
 * cannot follow across origins. So redirects are not followed, and a redirect
 * or a 401 reloads the page, which takes the browser through the login. A 403
 * means the login worked but the email is not a household user; reloading would
 * loop, so it is reported instead.
 */

export const NOT_SET_UP = "This account is not set up for the household.";
const REAUTH_KEY = "reauth-at";
const REAUTH_WINDOW_MS = 30_000;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Indirection so tests can observe a reload; jsdom's location is not replaceable. */
export const page = { reload: () => window.location.reload() };

function reauthenticate(): void {
  let last = 0;
  try { last = Number(sessionStorage.getItem(REAUTH_KEY) ?? 0); } catch { /* storage blocked */ }
  if (Date.now() - last < REAUTH_WINDOW_MS) return; // just tried; don't loop
  try { sessionStorage.setItem(REAUTH_KEY, String(Date.now())); } catch { /* storage blocked */ }
  page.reload();
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { redirect: "manual", headers: { Accept: "application/json" } });
  if (res.type === "opaqueredirect" || res.status === 401) {
    reauthenticate();
    throw new ApiError(401, "Your session has expired. Reloading to sign in again…");
  }
  if (res.status === 403) throw new ApiError(403, NOT_SET_UP);
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
```

`frontend/src/lib/useMediaQuery.ts`:

```ts
import { useSyncExternalStore } from "react";

/** Tailwind's md breakpoint: at or above it is the desktop layout. */
export const DESKTOP = "(min-width: 768px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}
```

- [ ] **Step 5: Run the tests, typecheck and build**

Run: `cd frontend && npm test && npm run build`
Expected: tests PASS, and `dist/index.html` plus `dist/assets/*` exist.

- [ ] **Step 6: Mutation check**

Remove the `if (Date.now() - last < REAUTH_WINDOW_MS) return;` line. The "reloads once" test must FAIL. Revert.

- [ ] **Step 7: Commit**

```bash
jj commit -m "Scaffold the React frontend with money formatting and an Access-aware fetch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Summary page shell, URL state, period picker and filters

**Files:**
- Create: `frontend/src/lib/types.ts`
- Create: `frontend/src/summary/params.ts`, `frontend/src/summary/queries.ts`, `frontend/src/summary/SummaryPage.tsx`, `frontend/src/summary/PeriodPicker.tsx`, `frontend/src/summary/FiltersBar.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/__tests__/summary/params.test.ts`, `frontend/src/__tests__/summary/fixtures.ts`, `frontend/src/__tests__/summary/SummaryPage.test.tsx`

**Interfaces:**
- Consumes: `getJson`, `ApiError` and `formatCents` (Task 7); types from `worker/src/api/summary.ts` (Task 5).
- Produces:
  ```ts
  // lib/types.ts
  export type { SummaryResponse, PeriodsResponse, Grid, GridRow, CategoryItem, MerchantItem, MonthTotals } from "../../../worker/src/api/summary";
  export { averageCents } from "../../../worker/src/api/summary";
  // summary/params.ts
  export interface SummaryParams { year: number | null; month: number | null; sources: string[] | undefined; hidden: boolean }
  export function parseParams(sp: URLSearchParams): SummaryParams
  export function toSearchParams(p: SummaryParams): URLSearchParams
  export function summaryApiPath(p: SummaryParams & { year: number }): string
  // summary/queries.ts
  export function usePeriods(): UseQueryResult<PeriodsResponse, Error>
  export function useSummary(p: SummaryParams): UseQueryResult<SummaryResponse, Error>
  // components
  export function SummaryPage(): JSX.Element
  export function PeriodPicker(props: { periods: PeriodsResponse; year: number; month: number | null; onChange: (year: number, month: number | null) => void }): JSX.Element
  export function FiltersBar(props: { sources: string[]; selected: string[] | undefined; hidden: boolean; hiddenCents: number; excludedPatterns: string[]; onSources: (s: string[] | undefined) => void; onHidden: (h: boolean) => void }): JSX.Element
  ```
  `SummaryPage` renders a `<section aria-label="…">` per block and leaves slots for Tasks 9 and 10 (see Step 5).

- [ ] **Step 1: Write the failing params test**

`frontend/src/__tests__/summary/params.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseParams, summaryApiPath, toSearchParams } from "../../summary/params";

const parse = (qs: string) => parseParams(new URLSearchParams(qs));

describe("parseParams", () => {
  it("reads a full view", () => {
    expect(parse("year=2026&month=3&sources=Card&sources=Bank%20A&hidden=1"))
      .toEqual({ year: 2026, month: 3, sources: ["Card", "Bank A"], hidden: true });
  });
  it("defaults everything", () => {
    expect(parse("")).toEqual({ year: null, month: null, sources: undefined, hidden: false });
  });
  it("tells no sources apart from all sources", () => {
    expect(parse("sources=").sources).toEqual([]);
    expect(parse("").sources).toBeUndefined();
  });
  it("falls back instead of failing on a hand-edited URL", () => {
    expect(parse("year=abc&month=13&hidden=yes")).toEqual({ year: null, month: null, sources: undefined, hidden: false });
    expect(parse("year=2026&month=0").month).toBeNull();
  });
});

describe("round trip", () => {
  it.each([
    { year: 2026, month: 3, sources: ["O'Brien, Ltd", "Card"], hidden: true },
    { year: 2025, month: null, sources: [], hidden: false },
    { year: 2025, month: null, sources: undefined, hidden: false },
  ])("%j", (p) => {
    expect(parseParams(toSearchParams(p))).toEqual(p);
  });
});

describe("summaryApiPath", () => {
  it("builds the API query with repeated sources", () => {
    expect(summaryApiPath({ year: 2026, month: null, sources: ["a,b", "c"], hidden: true }))
      .toBe("/api/summary?year=2026&sources=a%2Cb&sources=c&hidden=1");
    expect(summaryApiPath({ year: 2026, month: 2, sources: [], hidden: false }))
      .toBe("/api/summary?year=2026&month=2&sources=");
  });
});
```

Run: `cd frontend && npx vitest run src/__tests__/summary/params.test.ts`
Expected: FAIL, the module is missing.

- [ ] **Step 2: Implement params, types and queries**

`frontend/src/lib/types.ts`:

```ts
/** The Worker's API types, shared rather than copied, so the two cannot drift. */
export type {
  CategoryItem, Grid, GridCell, GridRow, MerchantItem, MonthTotals, PeriodsResponse, SummaryResponse,
} from "../../../worker/src/api/summary";
export { averageCents } from "../../../worker/src/api/summary";
```

`frontend/src/summary/params.ts`:

```ts
/**
 * The Summary's view lives in the URL, so back/forward, reload and a link sent
 * to the other household member all show the same thing. A hand-edited value
 * that makes no sense falls back to its default rather than failing.
 */

export interface SummaryParams {
  /** Null: the newest year with data. */
  year: number | null;
  /** 1–12, or null for the whole year. */
  month: number | null;
  /** Undefined: every source. []: none. */
  sources: string[] | undefined;
  hidden: boolean;
}

export function parseParams(sp: URLSearchParams): SummaryParams {
  const year = sp.get("year");
  const month = Number(sp.get("month"));
  const raw = sp.getAll("sources");
  return {
    year: year && /^\d{4}$/.test(year) ? Number(year) : null,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
    sources: raw.length === 0 ? undefined : raw.filter((s) => s !== ""),
    hidden: sp.get("hidden") === "1",
  };
}

export function toSearchParams(p: SummaryParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.year !== null) sp.set("year", String(p.year));
  if (p.month !== null) sp.set("month", String(p.month));
  if (p.sources !== undefined) {
    if (p.sources.length === 0) sp.append("sources", "");
    for (const s of p.sources) sp.append("sources", s);
  }
  if (p.hidden) sp.set("hidden", "1");
  return sp;
}

export function summaryApiPath(p: SummaryParams & { year: number }): string {
  return `/api/summary?${toSearchParams(p)}`;
}
```

`frontend/src/summary/queries.ts`:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import type { PeriodsResponse, SummaryResponse } from "../lib/types";
import { summaryApiPath, type SummaryParams } from "./params";

export function usePeriods() {
  return useQuery({ queryKey: ["periods"], queryFn: () => getJson<PeriodsResponse>("/api/summary/periods") });
}

/** Keeps the previous view on screen while the next one loads. */
export function useSummary(p: SummaryParams) {
  return useQuery({
    queryKey: ["summary", p.year, p.month, p.sources ?? null, p.hidden],
    queryFn: () => getJson<SummaryResponse>(summaryApiPath({ ...p, year: p.year! })),
    enabled: p.year !== null,
    placeholderData: keepPreviousData,
  });
}
```

Run the params test. Expected: PASS.

- [ ] **Step 3: Write the test fixtures and the failing page test**

`frontend/src/__tests__/summary/fixtures.ts`:

```ts
import type { Grid, PeriodsResponse, SummaryResponse } from "../../lib/types";

export const periods: PeriodsResponse = {
  years: [{ year: 2026, months: [1, 2, 3] }, { year: 2025, months: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12] }],
  sources: ["Bank A", "Card"],
};

const emptyGrid: Grid = { rows: [], total: { category: "Total", months: Array.from({ length: 12 }, () => ({ amountCents: 0, anomaly: false })), totalCents: 0 } };

export function summary(overrides: Partial<SummaryResponse> = {}): SummaryResponse {
  return {
    year: 2026,
    month: null,
    cashFlow: { incomeCents: 6_140_000, expensesCents: 3_895_000 },
    spendingType: { essentialCents: 2_410_000, discretionaryCents: 1_485_000, essentialBudgetCents: 3_400_000, discretionaryBudgetCents: null },
    expenseCategories: [
      { category: "Groceries", spendingType: "essential", amountCents: 742_000 },
      { category: "Eating out", spendingType: "discretionary", amountCents: 311_000 },
    ],
    incomeCategories: [{ category: "Salary", spendingType: null, amountCents: 5_820_000 }],
    topMerchants: Array.from({ length: 12 }, (_, i) => ({
      merchant: `Shop ${i + 1}`, category: "Groceries", spendingType: "essential" as const, amountCents: 100_000 - i * 1_000, txnCount: 3,
    })),
    topIncome: [{ merchant: "Employer", category: "Salary", spendingType: null, amountCents: 5_820_000, txnCount: 9 }],
    monthlyTotals: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, incomeCents: i < 9 ? 680_000 : 0, expensesCents: i < 9 ? 430_000 : 0 })),
    monthly: {
      expense: {
        rows: [{ category: "Groceries", totalCents: 742_000, months: Array.from({ length: 12 }, (_, i) => ({ amountCents: i < 9 ? 82_444 : 0, anomaly: i === 2 })) }],
        total: { category: "Total", totalCents: 742_000, months: Array.from({ length: 12 }, (_, i) => ({ amountCents: i < 9 ? 82_444 : 0, anomaly: false })) },
      },
      income: emptyGrid,
    },
    hiddenCents: 124_000,
    excludedPatterns: ["emergency"],
    ...overrides,
  };
}

/** A fetch that answers the two Summary endpoints and records what was asked. */
export function mockApi(opts: { periods?: PeriodsResponse; summary?: (url: URL) => SummaryResponse; status?: number } = {}) {
  const calls: URL[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(url);
    if (opts.status) return new Response(JSON.stringify({ error: "boom" }), { status: opts.status });
    const body = url.pathname === "/api/summary/periods"
      ? (opts.periods ?? periods)
      : (opts.summary ?? (() => summary()))(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}
```

`frontend/src/__tests__/summary/SummaryPage.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SummaryPage } from "../../summary/SummaryPage";
import { mockApi, summary } from "./fixtures";

let location = "";
function LocationProbe() {
  location = useLocation().search;
  return null;
}

function renderAt(url: string, api = mockApi()) {
  vi.stubGlobal("fetch", vi.fn(api.fetch));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <SummaryPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("SummaryPage", () => {
  it("opens on the newest year and shows its figures", async () => {
    const api = renderAt("/");
    expect(await screen.findByText("€61,400.00")).toBeInTheDocument();
    expect(api.calls.some((u) => u.pathname === "/api/summary" && u.searchParams.get("year") === "2026")).toBe(true);
  });

  it("moves to a month when its chip is pressed, and puts it in the URL", async () => {
    const api = renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("button", { name: "Feb" }));
    await waitFor(() => expect(location).toContain("month=2"));
    expect(api.calls.some((u) => u.searchParams.get("month") === "2")).toBe(true);
  });

  it("refetches with hidden tags included when toggled", async () => {
    const api = renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("switch", { name: /include hidden tags/i }));
    await waitFor(() => expect(api.calls.some((u) => u.searchParams.get("hidden") === "1")).toBe(true));
  });

  it("shows what the exclusion hides", async () => {
    renderAt("/?year=2026");
    expect(await screen.findByText(/excluding emergency/i)).toHaveTextContent("€1,240.00 hidden");
  });

  it("says so when there is no data at all", async () => {
    renderAt("/", mockApi({ periods: { years: [], sources: [] } }));
    expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
  });

  it("shows an error with a retry button when the API fails", async () => {
    renderAt("/?year=2026", mockApi({ status: 500 }));
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("filters sources, including selecting none", async () => {
    const api = renderAt("/?year=2026", mockApi({ summary: () => summary() }));
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("button", { name: /sources/i }));
    await userEvent.click(within(screen.getByRole("group", { name: /sources/i })).getByRole("button", { name: "None" }));
    await waitFor(() => expect(api.calls.some((u) =>
      u.searchParams.has("sources") && u.searchParams.getAll("sources").join() === "")).toBe(true));
    expect(location).toContain("sources=");
  });
});
```

Run: `cd frontend && npx vitest run src/__tests__/summary/SummaryPage.test.tsx`
Expected: FAIL, `SummaryPage` is missing.

- [ ] **Step 4: Implement the picker and filters**

`frontend/src/summary/PeriodPicker.tsx`:

```tsx
import type { PeriodsResponse } from "../lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3 py-1 text-sm border transition-colors ${
    active
      ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
      : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

export function PeriodPicker(props: {
  periods: PeriodsResponse;
  year: number;
  month: number | null;
  onChange: (year: number, month: number | null) => void;
}) {
  const months = props.periods.years.find((y) => y.year === props.year)?.months ?? [];
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="sr-only" htmlFor="year">Year</label>
      <select
        id="year"
        value={props.year}
        onChange={(e) => props.onChange(Number(e.target.value), null)}
        className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm font-semibold dark:border-slate-700"
      >
        {props.periods.years.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
      </select>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Month">
        <button type="button" className={chip(props.month === null)} aria-pressed={props.month === null}
          onClick={() => props.onChange(props.year, null)}>All</button>
        {months.map((m) => (
          <button key={m} type="button" className={chip(props.month === m)} aria-pressed={props.month === m}
            onClick={() => props.onChange(props.year, m)}>{MONTHS[m - 1]}</button>
        ))}
      </div>
    </div>
  );
}
```

`frontend/src/summary/FiltersBar.tsx`:

```tsx
import { useState } from "react";
import { formatCents } from "../lib/money";

/**
 * Sources and the hidden-tags switch. On a phone both sit behind one
 * "Filters" button; on desktop the sources open as a small popover.
 */
export function FiltersBar(props: {
  sources: string[];
  selected: string[] | undefined;
  hidden: boolean;
  hiddenCents: number;
  excludedPatterns: string[];
  onSources: (s: string[] | undefined) => void;
  onHidden: (h: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = props.selected ?? props.sources;
  const toggle = (s: string) => {
    const next = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s];
    props.onSources(next.length === props.sources.length ? undefined : next);
  };
  const label = props.selected === undefined ? "all" : `${props.selected.length} of ${props.sources.length}`;
  const patterns = props.excludedPatterns.join(", ");

  const tagStatus = props.excludedPatterns.length === 0
    ? "No tags excluded"
    : props.hidden
      ? `Including all (${patterns} not applied)`
      : `Excluding ${patterns} · ${formatCents(props.hiddenCents)} hidden`;

  return (
    <div className="relative flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700">
        Sources: {label} ▾
      </button>
      {open && (
        <div role="group" aria-label="Sources"
          className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex gap-2">
            <button type="button" className="underline" onClick={() => props.onSources(undefined)}>All</button>
            <button type="button" className="underline" onClick={() => props.onSources([])}>None</button>
          </div>
          {props.sources.map((s) => (
            <label key={s} className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
              {s}
            </label>
          ))}
        </div>
      )}
      {props.excludedPatterns.length > 0 && (
        <label className="flex items-center gap-2">
          <button type="button" role="switch" aria-checked={props.hidden} aria-label="Include hidden tags"
            onClick={() => props.onHidden(!props.hidden)}
            className={`h-5 w-9 rounded-full transition-colors ${props.hidden ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-300 dark:bg-slate-700"}`}>
            <span className={`block h-4 w-4 rounded-full bg-white transition-transform dark:bg-slate-900 ${props.hidden ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </label>
      )}
      <span className="text-slate-600 dark:text-slate-400">{tagStatus}</span>
    </div>
  );
}
```

- [ ] **Step 5: Implement the page**

`frontend/src/summary/SummaryPage.tsx`:

```tsx
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";

import { NOT_SET_UP } from "../lib/api";
import { formatCents } from "../lib/money";
import { FiltersBar } from "./FiltersBar";
import { parseParams, toSearchParams, type SummaryParams } from "./params";
import { PeriodPicker } from "./PeriodPicker";
import { usePeriods, useSummary } from "./queries";

function Card(props: { title?: string; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      {props.title && <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-400">{props.title}</h2>}
      {props.children}
    </section>
  );
}

function ErrorCard(props: { error: Error; onRetry: () => void }) {
  return (
    <Card>
      <p className="mb-3">{props.error.message}</p>
      {props.error.message !== NOT_SET_UP && (
        <button type="button" onClick={props.onRetry} className="rounded-md border px-3 py-1">Retry</button>
      )}
    </Card>
  );
}

export function SummaryPage() {
  const [search, setSearch] = useSearchParams();
  const params = parseParams(search);
  const periods = usePeriods();
  const year = params.year ?? periods.data?.years[0]?.year ?? null;
  const view: SummaryParams = { ...params, year };
  const summary = useSummary(view);
  const update = (patch: Partial<SummaryParams>) => setSearch(toSearchParams({ ...view, ...patch }));

  if (periods.error) return <main className="mx-auto max-w-6xl p-4"><ErrorCard error={periods.error} onRetry={() => periods.refetch()} /></main>;
  if (periods.isPending) return <main className="mx-auto max-w-6xl p-4" aria-busy="true"><div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" /></main>;
  if (year === null) {
    return (
      <main className="mx-auto max-w-6xl p-4">
        <Card><p>No transactions yet. Import some from the Transactions screen, or link a bank.</p></Card>
      </main>
    );
  }

  const data = summary.data;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <PeriodPicker periods={periods.data} year={year} month={view.month}
          onChange={(y, m) => update({ year: y, month: m })} />
        <FiltersBar sources={periods.data.sources} selected={view.sources} hidden={view.hidden}
          hiddenCents={data?.hiddenCents ?? 0} excludedPatterns={data?.excludedPatterns ?? []}
          onSources={(s) => update({ sources: s })} onHidden={(h) => update({ hidden: h })} />
      </header>

      {summary.error && <ErrorCard error={summary.error} onRetry={() => summary.refetch()} />}
      {!data && !summary.error && <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" aria-busy="true" />}
      {data && (
        <div className={`flex flex-col gap-4 transition-opacity ${summary.isPlaceholderData ? "opacity-60" : ""}`}>
          {/* Task 9 replaces this line with CashFlowTiles, SpendingSplit, MonthlyChart and the breakdown columns. */}
          <p>Income {formatCents(data.cashFlow.incomeCents)}</p>
          {/* Task 10 adds the monthly grids here. */}
        </div>
      )}
    </main>
  );
}
```

In `App.tsx`, replace the placeholder route element with `<SummaryPage />` (and import it).

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npm test`
Expected: PASS. The "opens on the newest year" test finds `€61,400.00` in the placeholder line; Task 9 moves it into the tiles.

- [ ] **Step 7: Build**

Run: `cd frontend && npm run build`
Expected: success. This also proves that `tsc` accepts the import of `worker/src/api/summary.ts`.

- [ ] **Step 8: Commit**

```bash
jj commit -m "Add the Summary page shell with URL state, period picker and filters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Cash-flow tiles, spending split, monthly chart and breakdown lists

**Files:**
- Create: `frontend/src/summary/CashFlowTiles.tsx`, `SpendingSplit.tsx`, `MonthlyChart.tsx`, `BreakdownList.tsx`
- Modify: `frontend/src/summary/SummaryPage.tsx`
- Test: `frontend/src/__tests__/summary/CashFlowTiles.test.tsx`; extend `SummaryPage.test.tsx`

**Interfaces:**
- Consumes: `formatCents`, `formatPercent`, `savingsRate`, `useMediaQuery` and `DESKTOP` (Task 7); `SummaryResponse` types (Task 8).
- Produces:
  ```ts
  export function CashFlowTiles(props: { cashFlow: SummaryResponse["cashFlow"] }): JSX.Element
  export function SpendingSplit(props: { split: SummaryResponse["spendingType"]; monthView: boolean }): JSX.Element
  export function MonthlyChart(props: { totals: MonthTotals[] }): JSX.Element
  export function BreakdownList(props: { title: string; items: { label: string; sublabel?: string; amountCents: number; count?: number }[]; showShare?: boolean; limit?: number; tone: "income" | "expense" }): JSX.Element
  ```

- [ ] **Step 1: Write the failing tests**

`frontend/src/__tests__/summary/CashFlowTiles.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashFlowTiles } from "../../summary/CashFlowTiles";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});

describe("CashFlowTiles", () => {
  it("shows income, expenses, net and the savings rate", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 6_140_000, expensesCents: 3_895_000 }} />);
    expect(screen.getByText("€61,400.00")).toBeInTheDocument();
    expect(screen.getByText("€38,950.00")).toBeInTheDocument();
    expect(screen.getByText("€22,450.00")).toBeInTheDocument();
    expect(screen.getByText("36.6%")).toBeInTheDocument();
  });

  it("shows a dash, not a number, for the savings rate with no income", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 0, expensesCents: 5_000 }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("-€50.00")).toBeInTheDocument();
  });
});
```

Add to `SummaryPage.test.tsx`:

```tsx
  it("lists ten merchants and reveals the rest on request", async () => {
    renderAt("/?year=2026");
    const merchants = await screen.findByRole("region", { name: "Top expense merchants" });
    expect(within(merchants).getAllByRole("listitem")).toHaveLength(10);
    await userEvent.click(within(merchants).getByRole("button", { name: /show all 12/i }));
    expect(within(merchants).getAllByRole("listitem")).toHaveLength(12);
  });

  it("shows the budget used, prorated to a month in a month view", async () => {
    renderAt("/?year=2026&month=2", mockApi({ summary: () => summary({ month: 2, monthlyTotals: null, monthly: null }) }));
    // 3,400,000 / 12 = 283,333.33 cents budget; 2,410,000 essential -> 851% used
    expect(await screen.findByText(/851% of €2,833\.33\/mo/)).toBeInTheDocument();
  });
```

Run: `cd frontend && npm test`
Expected: FAIL.

- [ ] **Step 2: Implement the components**

`frontend/src/summary/CashFlowTiles.tsx`:

```tsx
import { formatCents, formatPercent, savingsRate } from "../lib/money";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import type { SummaryResponse } from "../lib/types";

export function CashFlowTiles(props: { cashFlow: SummaryResponse["cashFlow"] }) {
  const compact = !useMediaQuery(DESKTOP);
  const { incomeCents, expensesCents } = props.cashFlow;
  const net = incomeCents - expensesCents;
  const tiles = [
    { label: "Income", value: formatCents(incomeCents, { compact }), tone: "text-income" },
    { label: "Expenses", value: formatCents(expensesCents, { compact }), tone: "text-expense" },
    { label: "Net", value: formatCents(net, { compact }), tone: net >= 0 ? "text-income" : "text-expense" },
    { label: "Savings rate", value: formatPercent(savingsRate(incomeCents, expensesCents)), tone: "" },
  ];
  return (
    <section aria-label="Cash flow" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div className="text-xs uppercase tracking-wide text-slate-500">{t.label}</div>
          <div className={`mt-1 text-xl font-semibold md:text-2xl ${t.tone}`}>{t.value}</div>
        </div>
      ))}
    </section>
  );
}
```

Note: the tiles use the compact form on phones, and the test stubs `matchMedia` as desktop, so full amounts are shown.

`frontend/src/summary/SpendingSplit.tsx`:

```tsx
import { formatCents } from "../lib/money";
import type { SummaryResponse } from "../lib/types";

/** _build_spending_type_line: the split, and each side against its budget. */
export function SpendingSplit(props: { split: SummaryResponse["spendingType"]; monthView: boolean }) {
  const { essentialCents, discretionaryCents } = props.split;
  const total = essentialCents + discretionaryCents;
  const share = (c: number) => (total > 0 ? Math.round((c / total) * 100) : 0);
  const divisor = props.monthView ? 12 : 1;
  const period = props.monthView ? "/mo" : "/yr";

  const side = (label: string, cents: number, annual: number | null, tone: string) => {
    const budget = annual === null ? null : annual / divisor;
    const used = budget ? Math.round((cents / budget) * 100) : null;
    return (
      <div>
        <span className={`mr-1 inline-block h-2 w-2 rounded-full ${tone}`} />
        <span className="font-medium">{label}</span> {formatCents(cents)} ({share(cents)}%)
        {budget !== null && (
          <span className={cents <= budget ? "text-income" : "text-expense"}>
            {" "}· {used}% of {formatCents(budget)}{period}
          </span>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Essential and discretionary" className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
      <div className="mb-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="bg-essential" style={{ width: `${share(essentialCents)}%` }} />
        <div className="bg-discretionary" style={{ width: `${share(discretionaryCents)}%` }} />
      </div>
      <div className="flex flex-col gap-1 md:flex-row md:gap-6">
        {side("Essential", essentialCents, props.split.essentialBudgetCents, "bg-essential")}
        {side("Discretionary", discretionaryCents, props.split.discretionaryBudgetCents, "bg-discretionary")}
      </div>
    </section>
  );
}
```

`formatCents(budget)` with a fractional cents value (283,333.33) formats to `€2,833.33`, which is the display the test expects.

`frontend/src/summary/MonthlyChart.tsx`:

```tsx
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "../lib/money";
import type { MonthTotals } from "../lib/types";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export function MonthlyChart(props: { totals: MonthTotals[] }) {
  const data = props.totals.map((t) => ({ ...t, label: MONTHS[t.month - 1] }));
  return (
    <section aria-label="Income and expenses by month" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-400">Income and expenses by month</h2>
      <div className="h-48 md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={1}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickFormatter={(c: number) => formatCents(c, { compact: true })} width={56} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip formatter={(c) => formatCents(Number(c))} />
            <Bar dataKey="incomeCents" name="Income" fill="var(--color-income)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expensesCents" name="Expenses" fill="var(--color-expense)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

`frontend/src/summary/BreakdownList.tsx`:

```tsx
import { useState } from "react";
import { formatCents } from "../lib/money";

export interface BreakdownItem {
  label: string;
  sublabel?: string;
  amountCents: number;
  count?: number;
}

/** A ranked list with proportional bars: categories, merchants, income sources. */
export function BreakdownList(props: {
  title: string;
  items: BreakdownItem[];
  showShare?: boolean;
  limit?: number;
  tone: "income" | "expense";
}) {
  const [all, setAll] = useState(false);
  const total = props.items.reduce((a, i) => a + i.amountCents, 0);
  const max = Math.max(1, ...props.items.map((i) => i.amountCents));
  const shown = props.limit && !all ? props.items.slice(0, props.limit) : props.items;

  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-3 flex justify-between text-sm font-semibold text-slate-600 dark:text-slate-400">
        <span>{props.title}</span>
        <span>{formatCents(total)}</span>
      </h2>
      {props.items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in this period.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <li key={item.label} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {item.label}
                  {item.sublabel && <span className="ml-1.5 text-xs text-slate-500">{item.sublabel}</span>}
                </span>
                <span className="shrink-0">
                  {formatCents(item.amountCents)}
                  {props.showShare && total > 0 && (
                    <span className="ml-1.5 text-xs text-slate-500">{((item.amountCents / total) * 100).toFixed(1)}%</span>
                  )}
                  {item.count !== undefined && <span className="ml-1.5 text-xs text-slate-500">×{item.count}</span>}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <div className={`h-1.5 rounded-full ${props.tone === "income" ? "bg-income" : "bg-expense"}`}
                  style={{ width: `${(item.amountCents / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {props.limit !== undefined && props.items.length > props.limit && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-3 text-sm underline">
          {all ? "Show fewer" : `Show all ${props.items.length}`}
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Put them on the page**

In `SummaryPage.tsx`, replace the placeholder `<p>Income …</p>` line with:

```tsx
          <CashFlowTiles cashFlow={data.cashFlow} />
          <SpendingSplit split={data.spendingType} monthView={data.month !== null} />
          {data.monthlyTotals && <MonthlyChart totals={data.monthlyTotals} />}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <BreakdownList title="Expense categories" tone="expense" showShare
                items={data.expenseCategories.map((c) => ({ label: c.category, sublabel: c.spendingType === "essential" ? "Ess." : "Disc.", amountCents: c.amountCents }))} />
              <BreakdownList title="Top expense merchants" tone="expense" limit={10}
                items={data.topMerchants.map((m) => ({ label: m.merchant, sublabel: m.category, amountCents: m.amountCents, count: m.txnCount }))} />
            </div>
            <div className="flex flex-col gap-4">
              <BreakdownList title="Income categories" tone="income" showShare
                items={data.incomeCategories.map((c) => ({ label: c.category, amountCents: c.amountCents }))} />
              <BreakdownList title="Top income sources" tone="income" limit={10}
                items={data.topIncome.map((m) => ({ label: m.merchant, sublabel: m.category, amountCents: m.amountCents, count: m.txnCount }))} />
            </div>
          </div>
```

Import the four components, and remove the now-unused `formatCents` import if nothing else uses it.

- [ ] **Step 4: Run the tests and build**

Run: `cd frontend && npm test && npm run build`
Expected: PASS. (If Recharts warns about zero width in jsdom, that's expected and harmless.)

- [ ] **Step 5: Commit**

```bash
jj commit -m "Show cash flow, the spending split, the monthly chart and breakdown lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Monthly grid with sparklines, desktop and phone

**Files:**
- Create: `frontend/src/summary/Sparkline.tsx`, `frontend/src/summary/MonthlyGrid.tsx`
- Modify: `frontend/src/summary/SummaryPage.tsx`
- Test: `frontend/src/__tests__/summary/MonthlyGrid.test.tsx`

**Interfaces:**
- Consumes: `Grid`, `GridRow` and `averageCents` (`lib/types`); `useMediaQuery` and `DESKTOP`; `formatCents`.
- Produces:
  ```ts
  export function Sparkline(props: { values: { amountCents: number; anomaly: boolean }[]; label: string }): JSX.Element
  export function MonthlyGrid(props: { title: string; grid: Grid; tone: "income" | "expense" }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

`frontend/src/__tests__/summary/MonthlyGrid.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Grid } from "../../lib/types";
import { MonthlyGrid } from "../../summary/MonthlyGrid";

const months = (xs: number[], hot = -1) => xs.map((amountCents, i) => ({ amountCents, anomaly: i === hot }));
const grid: Grid = {
  rows: [
    { category: "Groceries", totalCents: 30_000, months: months([10_000, 0, 20_000, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2) },
    { category: "Travel", totalCents: 5_000, months: months([0, 0, 0, 0, 5_000, 0, 0, 0, 0, 0, 0, 0]) },
  ],
  total: { category: "Total", totalCents: 35_000, months: months([10_000, 0, 20_000, 0, 5_000, 0, 0, 0, 0, 0, 0, 0]) },
};

const screenIs = (desktop: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }));
afterEach(() => vi.unstubAllGlobals());

describe("MonthlyGrid on desktop", () => {
  it("is a table with totals, averages over active months, and a total row averaged over twelve", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" />);
    const table = screen.getByRole("table");
    const groceries = within(table).getByRole("row", { name: /Groceries/ });
    expect(groceries).toHaveTextContent("€300.00"); // total
    expect(groceries).toHaveTextContent("€150.00"); // 30,000 / 2 active months
    const total = within(table).getByRole("row", { name: /^Total/ }); // the header row also says "Total"
    expect(total).toHaveTextContent("€29.17"); // 35,000 / 12
  });

  it("marks an anomaly so it is visible without colour", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" />);
    expect(screen.getByTitle(/unusually high/i)).toHaveTextContent("€200.00");
  });
});

describe("MonthlyGrid on a phone", () => {
  it("shows one row per category and expands to the monthly numbers on tap", async () => {
    screenIs(false);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const row = screen.getByRole("button", { name: /Groceries/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Mar")).toBeInTheDocument();
  });
});

describe("MonthlyGrid with nothing in it", () => {
  it("says so rather than drawing an empty table", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly income" grid={{ rows: [], total: grid.total }} tone="income" />);
    expect(screen.getByText(/nothing this year/i)).toBeInTheDocument();
  });
});
```

Run: `cd frontend && npx vitest run src/__tests__/summary/MonthlyGrid.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement the sparkline**

`frontend/src/summary/Sparkline.tsx`:

```tsx
import type { GridCell } from "../lib/types";

/** Twelve bars, anomalies in the anomaly colour. Inline SVG: there are dozens. */
export function Sparkline(props: { values: GridCell[]; label: string }) {
  const max = Math.max(1, ...props.values.map((v) => v.amountCents));
  const w = 4, gap = 2, h = 24;
  return (
    <svg role="img" aria-label={props.label} width={12 * (w + gap)} height={h} className="shrink-0">
      {props.values.map((v, i) => {
        const bh = v.amountCents > 0 ? Math.max(1.5, (v.amountCents / max) * h) : 1;
        return (
          <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1}
            className={v.anomaly ? "fill-anomaly" : v.amountCents > 0 ? "fill-slate-400 dark:fill-slate-500" : "fill-slate-200 dark:fill-slate-800"} />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 3: Implement the grid**

`frontend/src/summary/MonthlyGrid.tsx`:

```tsx
import { useState } from "react";
import { formatCents } from "../lib/money";
import { averageCents, type Grid, type GridCell, type GridRow } from "../lib/types";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { Sparkline } from "./Sparkline";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Amount(props: { cell: GridCell }) {
  if (props.cell.amountCents === 0) return <span className="text-slate-400">–</span>;
  const text = formatCents(props.cell.amountCents);
  return props.cell.anomaly
    ? <span title="Unusually high: more than 2σ above the previous 12 months" className="rounded bg-anomaly/15 px-1 font-semibold text-anomaly">{text} ↑</span>
    : <>{text}</>;
}

function DesktopTable(props: { grid: Grid }) {
  const row = (r: GridRow, isTotal = false) => (
    <tr key={r.category} className={isTotal ? "font-semibold" : "border-t border-slate-100 dark:border-slate-800"}>
      <th scope="row" className="sticky left-0 bg-white py-1.5 pr-3 text-left font-medium dark:bg-slate-950">{r.category}</th>
      {r.months.map((c, i) => <td key={i} className="px-2 text-right whitespace-nowrap"><Amount cell={c} /></td>)}
      <td className="px-2 text-right whitespace-nowrap">{formatCents(r.totalCents)}</td>
      <td className="px-2 text-right whitespace-nowrap">{formatCents(averageCents(r, isTotal))}</td>
      <td className="pl-2">{!isTotal && <Sparkline values={r.months} label={`${r.category} by month`} />}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="sticky left-0 bg-white text-left dark:bg-slate-950">Category</th>
            {MONTHS.map((m) => <th key={m} className="px-2 text-right font-normal">{m}</th>)}
            <th className="px-2 text-right font-normal">Total</th>
            <th className="px-2 text-right font-normal">Average</th>
            <th className="pl-2 text-left font-normal">Trend</th>
          </tr>
        </thead>
        <tbody>
          {row(props.grid.total, true)}
          {props.grid.rows.map((r) => row(r))}
        </tbody>
      </table>
    </div>
  );
}

function PhoneRows(props: { grid: Grid }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {props.grid.rows.map((r) => (
        <li key={r.category} className="py-2">
          <button type="button" aria-expanded={open === r.category}
            onClick={() => setOpen(open === r.category ? null : r.category)}
            className="flex w-full items-center justify-between gap-3 text-left text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.category}</span>
              <span className="text-xs text-slate-500">{formatCents(r.totalCents)} · avg {formatCents(averageCents(r))}</span>
            </span>
            <Sparkline values={r.months} label={`${r.category} by month`} />
          </button>
          {open === r.category && (
            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
              {r.months.map((c, i) => (
                <div key={i} className="flex justify-between">
                  <dt className="text-slate-500">{MONTHS[i]}</dt>
                  <dd><Amount cell={c} /></dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MonthlyGrid(props: { title: string; grid: Grid; tone: "income" | "expense" }) {
  const desktop = useMediaQuery(DESKTOP);
  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-400">{props.title}</h2>
      {props.grid.rows.length === 0
        ? <p className="text-sm text-slate-500">Nothing this year.</p>
        : desktop ? <DesktopTable grid={props.grid} /> : <PhoneRows grid={props.grid} />}
    </section>
  );
}
```

The `tone` prop is currently unused. Drop it if `noUnusedParameters` complains about destructuring (it won't for a props object), or use it to colour the header. Keep the interface as specified.

- [ ] **Step 4: Put the grids on the page**

In `SummaryPage.tsx`, replace the "Task 10" comment with:

```tsx
          {data.monthly && (
            <details open className="group">
              <summary className="cursor-pointer select-none py-1 text-sm font-semibold">Monthly detail</summary>
              <div className="mt-2 flex flex-col gap-4">
                <MonthlyGrid title="Monthly expenses" grid={data.monthly.expense} tone="expense" />
                <MonthlyGrid title="Monthly income" grid={data.monthly.income} tone="income" />
              </div>
            </details>
          )}
```

- [ ] **Step 5: Run the tests and build**

Run: `cd frontend && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Mutation check**

In `DesktopTable`, pass `averageCents(r)` for the Total row (drop `isTotal`). The "total row averaged over twelve" assertion must FAIL. Revert.

- [ ] **Step 7: Commit**

```bash
jj commit -m "Add the monthly grid: a table with trends on desktop, sparkline rows on a phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: CI, deploy and docs

**Files:**
- Modify: `.github/workflows/tests.yml`, `.github/workflows/deploy.yml`
- Modify: `worker/README.md`, `docs/WEB_PORT_PLAN.md`

- [ ] **Step 1: tests.yml**

Replace every `actions/checkout@v4` with `actions/checkout@v5` and `actions/setup-node@v4` with `actions/setup-node@v5`. In the `frontend` job, after "Run tests", add:

```yaml
      - name: Build
        run: npm run build
```

- [ ] **Step 2: deploy.yml**

Make the same v4→v5 bumps. Add `"frontend/**"` to `on.push.paths`. Change the header comment to "Ship the Worker and the frontend when a change to either reaches main". Remove the job-level `defaults.run.working-directory: worker`. Before `- run: npm ci`, add `working-directory: worker` to each existing worker step (`npm ci`, Typecheck, Test, the drift check, and every `npx wrangler …` step). Set `cache-dependency-path` to `|\n  worker/package-lock.json\n  frontend/package-lock.json`. Insert these steps before "Record the pre-deploy restore point":

```yaml
      # The assets upload with the Worker, so the frontend is built and checked
      # first. A failure here stops the deploy before any migration runs.
      - name: Frontend install
        working-directory: frontend
        run: npm ci

      - name: Frontend tests
        working-directory: frontend
        run: npm test

      - name: Frontend build
        working-directory: frontend
        run: npm run build
```

The "Still behind Access" step needs no working directory.

- [ ] **Step 3: Validate the YAML**

Run: `python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in ['.github/workflows/tests.yml','.github/workflows/deploy.yml']];print('ok')"`
Expected: `ok`. Then check by eye that every `npx wrangler` and `npm` step in deploy.yml has a `working-directory`.

- [ ] **Step 4: README**

In `worker/README.md`, after the `DEV_USER_EMAIL` paragraph, add:

````markdown
### With the frontend

Run the Worker and Vite side by side; Vite proxies `/api` to the Worker:

```sh
npx wrangler dev          # in worker/, :8787
npm run dev               # in frontend/, open the URL it prints
```

`wrangler dev` alone serves `../frontend/dist`, so run `npm run build` in
`frontend/` first if you want to see the built app on :8787.

For synthetic data instead of real data, build the seed from the cross-check
fixture:

```sh
../.venv/bin/python ../tools/crosscheck/make_fixture.py /tmp/fixture
EXPENSES_ANALYZER_CONFIG_DIR=/tmp/fixture PYTHONPATH=.. ../.venv/bin/python ../tools/migrate_to_sqlite.py \
  --out /tmp/fixture/dev.db --tokens-plaintext --user you@example.com:You:self
../tools/dump_for_d1.sh /tmp/fixture/dev.db > /tmp/d1_data.sql
npx wrangler d1 execute expenses --local --file=/tmp/d1_data.sql
```
````

Before writing this, check the local D1 reset steps earlier in the README. If local D1 already has data, the insert collides, and the README's existing reset step applies first. Reference it rather than repeating it.

- [ ] **Step 5: WEB_PORT_PLAN.md**

- Under "Still to do", delete the "**Deploy pipeline secrets.**" bullet (they are set, and the pipeline has run).
- Under "### 2. Frontend screens", add after the first paragraph:

```markdown
- ~~Summary, core views.~~ Done: one Worker serves the app and the API
  (`[assets]`, `run_worker_first`), `GET /api/summary` and `/periods`, and the
  dashboard with tiles, spending split, monthly chart, breakdowns and the
  monthly grid. The grid's anomaly flags and the merchant lists are held to
  the Python by the `summary` section of `python_vectors.json`. Still to come
  for Summary: the pension-aware savings rate, drill-down (with
  Transactions), editing the exclusion patterns, the payslip-only month note.
```

- [ ] **Step 6: Commit**

```bash
jj commit -m "Build and ship the frontend with the Worker; bump actions to v5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verify end to end, then open the PR

- [ ] **Step 1: Full test runs**

```bash
make test && make lint
PYTHONPATH=. .venv/bin/python tools/crosscheck/vectors.py --check
(cd worker && npm test && npm run typecheck)
(cd frontend && npm test && npm run build)
```

All must pass. Paste the summary lines into the PR description.

- [ ] **Step 2: Real-data check (local, opt-in, never committed)**

Build a DB from the real parquet into the scratchpad, following the command in the worker README ("To run that comparison on real data too"). Then run `CROSSCHECK_DB=<that path> npm test` in `worker/`. Expected: every case passes, including the scoped cases and "buildSummary on real data". Delete the DB afterwards.

- [ ] **Step 3: Run it locally and look**

Seed local D1 with the synthetic fixture (Task 11, Step 4, with `DEV_USER_EMAIL` set to the fixture user). Start `wrangler dev` and `npm run dev`, then use the `webapp-testing` skill (Playwright) to screenshot `/?year=2026`, `/?year=2026&month=2` and the grid expanded, at 390×844 and 1280×900, in light and dark (`colorScheme`). Check:
- no horizontal page scroll at 390px (the grid scrolls inside its card on desktop only);
- the month chips scroll sideways on a phone;
- the tiles use the compact form on a phone;
- anomaly cells are visible in both themes;
- nothing overlaps.

Fix what's wrong, rerun the tests, and commit the fixes. Screenshots stay in the scratchpad (they show fixture data only, but don't commit them).

- [ ] **Step 4: Privacy scan**

```bash
jj diff --from main --to @ > <scratchpad>/pr.diff
grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' <scratchpad>/pr.diff | grep -v '@example\.com$' | sort -u
grep -n '/Users/' <scratchpad>/pr.diff
```

Both must print nothing, apart from addresses already in the repo before this branch. Also grep the diff for the employer's name and the spouse's first name (see the `no-company-name` memory; don't write either into any file). Check each commit message too: `jj log -r 'main..@' --no-graph -T description`.

- [ ] **Step 5: Delete the spec and plan**

Per the project's convention, the spec and plan files go once the feature is done. Delete `docs/superpowers/specs/2026-09-30-web-summary-design.md` and this plan, and commit ("Remove the Summary spec and plan now that it has shipped").

- [ ] **Step 6: PR**

Follow the `use-jj` skill:

```bash
jj bookmark create web-summary -r @-
jj git push --bookmark web-summary
gh pr create --head web-summary --title "Web Summary screen: dashboard served by the Worker" --body-file <scratchpad>/pr.md
```

The PR body covers: what's in it, what's deliberately left for later (from the spec's "Out" list), how the numbers were verified (vectors, SQL-over-scoped-views, the real-data run), the screenshots checklist, and that merging deploys (the frontend now triggers `deploy.yml`). End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

Ask the user before pushing: the push is outward-facing, and merging it deploys.
