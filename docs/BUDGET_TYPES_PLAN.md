# Essential vs Discretionary Spending + Annual Budgets

## Context
Classify expense categories as "essential" or "discretionary" and set annual budget targets for each type. This enables a quick view of needs vs wants spending and budget tracking in the Summary screen.

## Changes Overview

### 1. New config file: `category_types.json`
**Path:** `~/.config/expenses_analyzer/category_types.json`

```json
{
  "essential": {
    "categories": ["Groceries", "Utilities", "Rent/Mortgage", "Healthcare", "Insurance", "Transportation", "Education", "Taxes", "Professional Services"],
    "annual_budget": null
  },
  "discretionary": {
    "categories": ["Dining", "Travel", "Subscriptions", "Shopping", "Clothing", "Cycling", "Hobbies", "Entertainment", "Amazon Purchases", "Technology", "Home", "Home Improvement"],
    "annual_budget": null
  }
}
```
- Categories not listed in either group default to "discretionary"
- `annual_budget` is nullable — when null, no budget tracking shown
- Ship a default template in `expenses/default_category_types.json`

### 2. Data layer changes
**File:** `expenses/config.py`
- Add `CATEGORY_TYPES_FILE` and `DEFAULT_CATEGORY_TYPES_FILE` path constants

**File:** `expenses/data_handler.py`
- Add `load_category_types() -> dict` — loads from config dir, falls back to package default (same pattern as `load_default_categories()`)
- Add `save_category_types(data: dict)` — saves with secure permissions (same pattern as `save_categories()`)
- Add `get_category_spending_type(category: str, category_types: dict) -> str` — returns "essential" or "discretionary"

### 3. New screen: Budget Types screen
**File:** `expenses/screens/budget_types_screen.py`

- Keybinding: `b` in `ExpensesApp` (currently unused)
- Simple screen with a DataTable listing all known categories
- Columns: Category | Type (Essential/Discretionary)
- Actions:
  - Toggle selected category between Essential/Discretionary (space or enter)
  - Set annual budget for Essential (keybinding)
  - Set annual budget for Discretionary (keybinding)
  - Save changes
- Inherits from `BaseScreen`
- Sources category list from: union of categories in `categories.json` values + `default_categories.json`

### 4. Summary screen integration
**File:** `expenses/screens/summary_screen.py`

- In `load_and_prepare_data()`: also load category types via `load_category_types()`
- In `update_cash_flow()`: extend the cash flow summary Static widget to show a second line:
  ```
  Income: 80,000  |  Expenses: 84,000  |  Net: -4,000  |  Savings Rate: -5%
  Essential: 49,000 (58%)  |  Discretionary: 35,000 (42%)  [Budget: 50,000 — 98% used]
  ```
  - Calculate essential/discretionary totals by mapping each transaction's Category through category_types
  - Show budget progress only when `annual_budget` is not null
  - Color budget text: green if under budget, red if over

### 5. App registration
**File:** `expenses/app.py`
- Add `Binding("b", "push_screen('budget_types')", "Budget Types")` to BINDINGS
- Register `"budget_types": BudgetTypesScreen` in SCREENS dict
- Import `BudgetTypesScreen`

### 6. Default category types file
**File:** `expenses/default_category_types.json`
- Ship with sensible defaults (the essential/discretionary split discussed above)
- Copied to user config dir on first access (same pattern as default_categories.json)

## Files to create
- `expenses/default_category_types.json` — default config
- `expenses/screens/budget_types_screen.py` — new screen

## Files to modify
- `expenses/config.py` — add path constants
- `expenses/data_handler.py` — add load/save functions
- `expenses/app.py` — register screen + keybinding
- `expenses/screens/summary_screen.py` — show breakdown in cash flow line
- `expenses/main.css` — any styling needed for the new screen / cash flow line

## Verification
1. Run `make lint` and `make test` to ensure no regressions
2. Launch app with `python -m expenses.main`, press `b` to open Budget Types screen
3. Verify categories are listed with correct essential/discretionary defaults
4. Toggle some categories, save, go to Summary — verify the cash flow line updates
5. Set annual budgets, verify budget progress appears in Summary

## Implementation Order
1. Config + data layer (steps 1, 2, 6) — foundation, no UI changes
2. Budget Types screen (steps 3, 5) — new screen with save/load
3. Summary integration (step 4) — wire it all together
