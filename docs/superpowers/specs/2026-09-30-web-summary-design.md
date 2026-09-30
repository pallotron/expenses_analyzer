# Web Summary Screen — Design

Step 2 of `docs/WEB_PORT_PLAN.md`, first slice: the React app, how the Worker
serves it, and the Summary screen's core views. Delete this file once the
feature has shipped.

## Goal

The household (two people, on laptops and phones) can open
`expenses.angelofailla.com` and see the Summary they get from the TUI today:
cash flow, spending split, categories, merchants and the monthly grid, per year
or month, with the source filter and the hidden-tags toggle. The numbers must
equal the TUI's, as the service layer's already do.

The phone matters as much as the desktop.

## Scope

In:
- Frontend scaffold (Vite, React 19) served by the Worker, behind `getUser`.
- `GET /api/summary/periods` and `GET /api/summary`.
- Year and month views: cash-flow tiles, essential/discretionary split against
  budget, a monthly income-vs-expenses chart (year view), expense and income
  categories, top merchants and income sources, the category × month grid
  with anomaly flags (year view).
- Source filter and the include-hidden-tags toggle.
- Deploy pipeline builds and ships the frontend.
- Carried-over follow-ups: `actions/checkout` and `actions/setup-node` to v5,
  and removing the stale "deploy pipeline secrets" item from the plan.

Out, each a later PR:
- Pension-aware savings rate (needs `get_enhanced_savings_totals` ported).
- Drill-down into transactions (needs the Transactions screen).
- PDF export (plan step 4).
- Editing the exclusion patterns (Shift+X). It writes, so it goes with the
  Transactions and tags work.
- The payslip-only month note.

## Serving

One Worker serves the API and the app on one origin, behind one Access
application.

`worker/wrangler.toml`:

```toml
[assets]
directory = "../frontend/dist"
binding = "ASSETS"
run_worker_first = true
not_found_handling = "single-page-application"
```

`run_worker_first = true` sends static files through the Worker too, so no
request, not even the JS bundle, skips `getUser`. The cost is one invocation per
asset request, which is nothing at this scale.

`worker/src/index.ts` becomes a Hono app:

1. Middleware: `getUser` on every request. On failure, return the bare status as
   today (the reason stays in the log). On success, put the user and the `Db`
   on the context.
2. Routes: `/health`, `/api/me`, `/api/summary/periods`, `/api/summary`.
3. Any other `/api/*` path: JSON `{"error": "not found"}` with 404.
4. Everything else: `env.ASSETS.fetch(request)`. `index.html` gets
   `Cache-Control: no-store`; hashed files under `/assets/` get
   `public, max-age=31536000, immutable`.

Invariant 2 still holds: routes get the `Db` from `createDb`, never `env.DB`.

## API

All money is integer cents. The client computes rates and formats money.

### `GET /api/summary/periods`

```ts
interface PeriodsResponse {
  years: { year: number; months: number[] }[]; // newest year first; months ascending
  sources: string[];                           // sorted
}
```

Periods come from `v_live`, so a year made up only of hidden-tag rows still
appears. Payslip-only months are not included (out of scope).

### `GET /api/summary`

Query parameters, validated with Zod; any invalid value → 400
`{"error": "<message>"}`:

| param     | form                             | default          |
|-----------|----------------------------------|------------------|
| `year`    | four digits, required            | —                |
| `month`   | 1–12                             | whole year       |
| `sources` | repeated: `sources=a&sources=b`; a single empty value means none | all sources |
| `hidden`  | `1` to include hidden-tag rows   | excluded         |

```ts
interface SummaryResponse {
  year: number;
  month: number | null;
  cashFlow: { incomeCents: number; expensesCents: number };
  spendingType: {
    essentialCents: number;
    discretionaryCents: number;
    // Annual budgets from spending_type_budgets; null when unset.
    // The client divides by 12 in a month view, as the TUI does.
    essentialBudgetCents: number | null;
    discretionaryBudgetCents: number | null;
  };
  expenseCategories: CategoryItem[];     // descending by amount
  incomeCategories: CategoryItem[];
  topMerchants: MerchantItem[];          // expenses, descending, every merchant (the TUI has no limit)
  topIncome: MerchantItem[];             // income, descending, every source
  monthlyTotals: { month: number; incomeCents: number; expensesCents: number }[] | null; // year view only, 12 entries
  monthly: { expense: Grid; income: Grid } | null;                                    // year view only
  hiddenCents: number;                   // expense total the exclusion hides in this period and sources
  excludedPatterns: string[];            // tag_exclusion_patterns, for the "excluding emergency, travel:*" label
}

interface CategoryItem { category: string; spendingType: "essential" | "discretionary" | null; amountCents: number }
interface MerchantItem {
  merchant: string; // canonical name, falling back to merchant_raw as v_transactions does
  // Most frequent category among the merchant's rows in scope; ties go to the
  // alphabetically first, as pandas' mode()[0] does.
  category: string;
  spendingType: "essential" | "discretionary" | null;
  amountCents: number;
  txnCount: number;
}
interface Grid {
  rows: GridRow[];  // descending by total, ties by category name
  total: GridRow;   // category "Total": column sums; never an anomaly
}
interface GridRow {
  category: string;
  months: { amountCents: number; anomaly: boolean }[]; // 12 entries, Jan..Dec
  totalCents: number;
}
```

No average is sent: it is a fractional number of cents, so the client
computes it at display time. For a category row it is total ÷ months with a
non-zero amount (0 if none), as in `_prepare_monthly_summary`; for the Total
row it is total ÷ 12, as in `_populate_monthly_breakdown`. Anomalies are only
ever flagged on the expense grid.

`spendingType` on an income category or source is `null`. The client shows the
first 10 merchants and a "Show all" control.

The tags label follows `_tag_exclusion_status`: with no patterns, "none
excluded"; when excluding, the patterns and the hidden amount; when including,
the patterns marked "not applied".

The response types live in `worker/src/api/summary.ts`, and the frontend imports
them. The file has no imports of its own, so the frontend's compiler and bundle
can take it as it is. It also holds `averageCents(row, isTotal)`, the one
display rule both sides must agree on.

## Query changes

`Scope` in `worker/src/queries/analysis.ts` gains:

```ts
sources?: string[]; // only these sources; undefined = all
year?: string;      // "2026"
month?: string;     // "2026-03", matching v_summary.month
```

With none set, each function builds exactly the query it builds today, so the
existing tests against the SQL files pass unchanged. The filters become `WHERE`
terms on the view.

`hiddenTagTotal` takes the same `Scope` filters (period and sources).

New:
- `categoryMonthTotalsAllTypes(db, scope)`: category × month sums across
  **all** years and **both** types, because the anomaly window crosses year
  boundaries and `_calculate_historical_stats` pivots the whole filtered frame,
  income included. Honours `sources` and `includeHidden`, ignores
  `year`/`month`.
- `worker/src/domain/anomalies.ts`: pure. Given the category × month series, it
  returns per cell whether `amount > mean + 2·std` of the previous 12 months
  (rolling window of 12, min 1 period, shifted by one; std is the sample std,
  `ddof=1`, with NaN → 0), requiring `mean > 0` and `std > 0`, as in
  `_calculate_historical_stats` and `_create_monthly_cell`. The month index runs
  continuously from the first to the last month in the data, and missing
  cells are 0. Pinning down which months form
  the index (pandas' `Grouper(freq="MS")` fills gaps between the first and last
  month) is part of the port; the vectors decide.
- `merchantsInScope(db, type, scope)`: per merchant, amount, count and modal
  category, for one period. `merchantsByYear` is left as it is.
- `worker/src/services/summary.ts`: builds `SummaryResponse` from the queries.
  Route handlers stay thin.

The TUI grid also shows a trend arrow per cell. The web grid does not; the
sparkline replaces it.

## Frontend

`frontend/` becomes a Vite + React 19 app, following `~/code/audax_tracker`'s
setup. `src/payslips/` is untouched.

Libraries: Tailwind v4, TanStack Query, Recharts (the monthly chart only),
React Router (a single `/` route for now). Sparklines are hand-written inline
SVG.

**URL is the state:** `/?year=2026&month=3&sources=a&sources=b&hidden=1`. With no year,
the newest year from `/api/summary/periods` is used. Invalid parameters fall
back to defaults rather than erroring.

**Layout: one scrolling dashboard.**

```
[2026 ▾] [All][Jan]…[Dec]                [Sources ▾] [Tags: excluded (−€1,240) ⇄]
[ Income ] [ Expenses ] [ Net ] [ Savings rate ]
Essential €… (62%) · budget 71% used | Discretionary €… (38%) · 84% used   ▇▇▇▇▇▇▁▁▁
Monthly income vs expenses (year view)
Expenses column                         | Income column
  Expense categories (bars)             |   Income categories
  Top expense merchants                 |   Top income sources
Monthly detail (year view)
```

Phone (below Tailwind's `md` breakpoint): the columns stack. The month chips
scroll sideways. Sources and tags go into a "Filters (n)" sheet. Top merchants,
income and monthly detail are collapsible sections.

**Monthly grid:**
- Desktop: a table with category, Jan–Dec, Total, Average, and a Trend
  sparkline column. Anomaly cells are red.
- Phone: one row per category with total, average and a 12-bar sparkline,
  anomaly bars red. Tapping a row expands it to its 12 monthly amounts.
- Expense and income grids use the same components.

**Components** (`frontend/src/summary/`): `SummaryPage` (URL state and query),
`PeriodPicker`, `FiltersBar`, `CashFlowTiles`, `SpendingSplit`, `MonthlyChart`,
`BreakdownList` (categories and merchants, with bars), `MonthlyGrid`,
`Sparkline`.

**Money:** `frontend/src/lib/money.ts` with `formatCents` (EUR, `en-IE`, two
decimals; a compact form for phone tiles) and `savingsRate(income, expenses)`,
which returns `null` when income is 0 and is shown as "—".

**States:** a skeleton while loading, an error card with Retry, and an empty
state when `periods.years` is empty. A lapsed Access session shows up as a redirect
(requests use `redirect: "manual"`) or a 401. Either reloads the page, which
takes the browser through the Access login. A guard in `sessionStorage` stops
a second reload within 30 seconds, which would otherwise loop. A 403 means the
login worked but the email has no `users` row, so it shows "This account is
not set up for the household" rather than reloading.

**Theme:** follows `prefers-color-scheme`.

## Dev loop

- `worker/`: `npm run dev` (wrangler dev on :8787, `DEV_USER_EMAIL` from
  `.dev.vars`).
- `frontend/`: `npm run dev` (Vite; `/api` proxied to :8787).
- The worker README gets a recipe to seed local D1 from `make_fixture.py`
  output. Real data is optional and never in the repo.

## Dependencies

- `worker/`: `hono`, `zod`.
- `frontend/`: `react`, `react-dom`, `react-router`, `@tanstack/react-query`,
  `recharts`; dev: `vite`, `@vitejs/plugin-react`, `tailwindcss`,
  `@tailwindcss/vite`, `@types/react`, `@types/react-dom`, `jsdom`,
  `@testing-library/react`, `@testing-library/jest-dom`,
  `@testing-library/user-event`.
- Add them to `package.json`, then regenerate each lockfile from scratch.
  Never `npm install <pkg>` (the rolldown lockfile bug).

## CI and deploy

- `deploy.yml`: triggers on `frontend/**` too. Before `wrangler deploy`:
  frontend `npm ci`, typecheck, test, `vite build`. The worker steps and the
  Access check stay as they are.
- `tests.yml`: the frontend job also runs the build.
- Both workflows: `actions/checkout@v5`, `actions/setup-node@v5`.

## Testing

Worker:
- New sections in `python_vectors.json` from `tools/crosscheck/vectors.py`:
  - analysis results with `sources`, `year` and `month` filters;
  - `hiddenTagTotal` scoped;
  - `merchantsInScope`, including the modal category and its tie-break;
  - anomaly flags and grid rows (total, average) from the Python's own
    `_calculate_historical_stats` / `_prepare_monthly_summary` logic, on the
    fixture.
- The existing SQL-equality tests pass unchanged.
- Route tests via `app.request()` on in-memory SQLite: response shape, 400 on
  bad parameters, 403 with no user, JSON 404 for an unknown `/api` path, SPA
  fallback to `ASSETS` for other paths.
- Local, opt-in with `CROSSCHECK_DB`: for every year, `/api/summary` totals
  equal `v_summary`.
- Mutation-check each new test.

Frontend (Vitest, jsdom, testing-library):
- `formatCents` and `savingsRate`.
- `SummaryPage` with a mocked fetch: figures shown, a month chip updates the
  URL, the hidden toggle refetches with `hidden=1`, empty and error states, and
  a 401 or redirect triggers one reload (not two), and a 403 shows the not-set-up message.
- `MonthlyGrid`: table on desktop, expandable rows on a phone (mocked
  `matchMedia`).

By eye, before the PR: run locally on fixture data and take Playwright
screenshots at 390px and 1280px, in light and dark.

## Privacy

The repo is public. No real data in fixtures, screenshots or tests. Scan the
diff for emails, personal paths and names before pushing.
