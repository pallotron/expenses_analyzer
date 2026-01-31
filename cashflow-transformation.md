# Cash Flow Transformation Plan

## Overview

Transform the Expenses Analyzer application from expense-only tracking to full cash flow management supporting both income and expenses, with savings rate calculations and comprehensive financial insights.

## Current State Analysis

### Data Model
- **DataFrame Schema:** Date, Merchant, Amount, Source, Deleted
- **Amount Convention:** All amounts stored as positive numbers (expenses only)
- **Storage:** Single Parquet file (`transactions.parquet`)
- **Categories:** Expense categories only (Groceries, Dining, Transportation, etc.)
- **Deduplication Key:** `(Date, Merchant, Amount)` tuple

### Bank Integration (TrueLayer)
- **Current Behavior:** Filters to DEBIT transactions only (expenses)
- **Credit Filtering:** Lines 182-183 in `truelayer_handler.py` explicitly exclude credits
- **Amount Handling:** Negates TrueLayer amounts (-5.50 → 5.50) to make positive

### UI Components
- **SummaryScreen:** Category breakdown, monthly trends (expenses only)
- **TransactionScreen:** Transaction listing with filtering (expenses only)
- **CategorizeScreen:** Merchant categorization (expense categories only)
- **Analysis:** Minimal - only trend calculation (↑/↓/=)

## Transformation Strategy

### Phase 1: Data Model Enhancement

#### 1.1 Add Transaction Type Column
**File:** `expenses/data_handler.py`

- Add `Type` column to DataFrame schema with values: `"expense"` or `"income"`
- Update `load_transactions_from_parquet()` to default `Type="expense"` for backward compatibility
- Update `validate_transaction_dataframe()` to validate Type column

**Changes:**
```python
# In load_transactions_from_parquet (around line 137)
if "Type" not in df.columns:
    df["Type"] = "expense"  # Default for existing data

# In validate_transaction_dataframe (validation.py)
# Add validation for Type column (must be "expense" or "income")
```

#### 1.2 Update Amount Handling Convention
**File:** `expenses/data_handler.py`

**Decision Point:** Keep amounts positive but use Type column to distinguish, OR use signed amounts?

**Recommended Approach:** Keep amounts positive, use Type column
- **Pros:** Simpler migration, clearer for users, easier filtering
- **Cons:** Requires Type column in all operations
- **Alternative:** Signed amounts (negative=expense, positive=income) - requires more migration work

#### 1.3 Create Migration Helper
**File:** `expenses/data_handler.py` (new function)

```python
def migrate_legacy_transactions():
    """
    One-time migration for existing users.
    Adds Type="expense" to all existing transactions.
    """
    # Load with include_deleted=True to migrate everything
    # Add Type column
    # Save back
    # Log migration completion
```

### Phase 2: Bank Integration Updates

#### 2.1 Update TrueLayer Transaction Conversion
**File:** `expenses/truelayer_handler.py`

**Lines to modify:** 543-598 in `convert_truelayer_transactions_to_dataframe()`

**Changes:**
1. Remove DEBIT-only filter
2. Keep both CREDIT and DEBIT transactions
3. Add Type column based on transaction_type:
   - DEBIT → Type="expense"
   - CREDIT → Type="income"
4. Update amount handling:
   - For expenses: Keep current logic (negate to positive)
   - For income: Negate to positive (credits are positive in API)

```python
# Before:
df = df[df["transaction_type"] == "DEBIT"]  # REMOVE THIS

# After:
df["Type"] = df["transaction_type"].map({
    "DEBIT": "expense",
    "CREDIT": "income"
})
# Keep amounts positive for both types
df["Amount"] = df["amount"].abs()
```

#### 2.2 Update Test Suite
**File:** `tests/test_truelayer_handler.py`

- Update `test_convert_truelayer_transactions_only_credits` (line 342) to expect income transactions
- Add new tests for mixed DEBIT/CREDIT scenarios
- Test Type column is correctly assigned

### Phase 3: Category System Expansion

#### 3.1 Create Income Categories
**File:** `expenses/default_categories.json`

**Add income categories:**
- Salary/Wages
- Freelance Income
- Investment Income
- Dividends
- Interest
- Rental Income
- Gifts Received
- Refunds
- Tax Refunds
- Business Income
- Pension/Retirement
- Government Benefits
- Other Income

#### 3.2 Update Gemini AI Categorization
**File:** `expenses/gemini_utils.py`

**Function:** `get_gemini_category_suggestions_for_merchants()`

**Changes:**
1. Accept additional parameter: `transaction_type: str = "expense"`
2. Update prompt to include appropriate categories based on type
3. Provide different guidance for income vs expense categorization

```python
def get_gemini_category_suggestions_for_merchants(
    merchant_names: List[str],
    transaction_type: str = "expense"
) -> Dict[str, str]:
    # Filter categories by type
    # Update prompt to categorize based on income or expense
```

#### 3.3 Update Categorize Screen
**File:** `expenses/screens/categorize_screen.py`

- Add Type filter (dropdown: All, Income, Expense)
- Show appropriate categories based on transaction type
- Update AI categorization to pass transaction type

### Phase 4: Analysis Module Enhancement

#### 4.1 Create Cash Flow Analysis Functions
**File:** `expenses/analysis.py`

**New functions:**

```python
def calculate_income_summary(transactions: pd.DataFrame, period: str = "month") -> pd.DataFrame:
    """Calculate total income by period."""

def calculate_expense_summary(transactions: pd.DataFrame, period: str = "month") -> pd.DataFrame:
    """Calculate total expenses by period."""

def calculate_net_cash_flow(transactions: pd.DataFrame, period: str = "month") -> pd.DataFrame:
    """Calculate net cash flow (income - expenses) by period."""

def calculate_savings_rate(transactions: pd.DataFrame, period: str = "month") -> pd.DataFrame:
    """Calculate savings rate: (income - expenses) / income * 100."""

def calculate_category_breakdown_by_type(
    transactions: pd.DataFrame,
    transaction_type: str,
    period: str = "month"
) -> pd.DataFrame:
    """Calculate category breakdown filtered by type."""
```

#### 4.2 Create Cash Flow Metrics
**New metrics to calculate:**
- Monthly income total
- Monthly expense total
- Monthly net cash flow
- Monthly savings rate (%)
- Trend analysis (month-over-month for income, expenses, net)
- Average income vs average expenses
- Highest/lowest cash flow months

### Phase 5: UI Screen Updates

#### 5.1 Update Summary Screen
**File:** `expenses/screens/summary_screen.py`

**New Layout Structure:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Summary - 2025                                     [Year Tabs]   │
├─────────────────────────────────────────────────────────────────┤
│ Cash Flow Overview                                               │
│ ┌─────────────────┬─────────────────┬─────────────────────────┐ │
│ │ Income: $5,000  │ Expenses: $3,500│ Net: $1,500 (30% rate) │ │
│ └─────────────────┴─────────────────┴─────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────┬──────────────────────────────┐ │
│ │ Income by Category          │ Expense by Category          │ │
│ │ ┌──────────────┬───────┬──┐ │ ┌──────────────┬───────┬──┐│ │
│ │ │ Salary       │ 4500  │██│ │ │ Groceries    │ 800   │██││ │
│ │ │ Freelance    │ 500   │█ │ │ │ Dining       │ 300   │█ ││ │
│ │ └──────────────┴───────┴──┘ │ └──────────────┴───────┴──┘│ │
│ └─────────────────────────────┴──────────────────────────────┘ │
│                                                                  │
│ Monthly Cash Flow Trend                                          │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Jan: +1200 ↑ │ Feb: +1500 ↑ │ Mar: +800 ↓ │ ...           │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation Changes:**
1. Add cash flow metrics at top (income, expenses, net, savings rate)
2. Create dual-column layout: Income categories (left) vs Expense categories (right)
3. Add monthly cash flow trend table showing net by month
4. Update existing category breakdown to filter by Type
5. Add savings rate chart/visualization
6. Color coding: Green for income, Red for expenses, Blue for net positive

#### 5.2 Update Transaction Screen
**File:** `expenses/screens/transaction_screen.py`

**New Features:**
1. Add Type filter (dropdown: All, Income, Expense)
2. Add visual distinction:
   - Income rows: Green text or background
   - Expense rows: Red text or default
3. Update merchant summary to show separate totals:
   - Total Income: $X
   - Total Expenses: $Y
   - Net: $Z
4. Update filtering logic to include Type

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Transactions                          [Type: All ▼]              │
├─────────────────────────────────────────────────────────────────┤
│ Filters: Date [____] Merchant [____] Amount [____] Type [____]  │
├─────────────────────────────────────────────────────────────────┤
│ Date       │ Merchant      │ Amount  │ Type    │ Category       │
│ 2025-01-10 │ Employer Corp │ +2500   │ Income  │ Salary         │
│ 2025-01-09 │ Whole Foods   │  45.30  │ Expense │ Groceries      │
├─────────────────────────────────────────────────────────────────┤
│ Summary: Income: $2500 | Expenses: $45.30 | Net: $2454.70      │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.3 Update Import Screen
**File:** `expenses/screens/import_screen.py`

**New Features:**
1. Add Type detection/selection:
   - Auto-detect based on amount sign (negative=expense, positive=income)
   - Manual dropdown: "Expense" or "Income" (default: Expense)
2. Update preview to show Type column
3. Update amount filtering logic:
   - Remove expense-only filter (lines filtering Amount >= 0)
   - Keep all transactions regardless of sign
4. Update AI categorization to pass transaction type

**UI Addition:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Import CSV                                                       │
├─────────────────────────────────────────────────────────────────┤
│ Column Mapping:                                                  │
│ Date Column:     [date     ▼]                                   │
│ Merchant Column: [merchant ▼]                                   │
│ Amount Column:   [amount   ▼]                                   │
│ Transaction Type: [Expense ▼] (Auto-detect from sign / Manual)  │
│                                                                  │
│ [✓] Suggest categories with AI                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.4 Create New Cash Flow Screen (Optional)
**File:** `expenses/screens/cashflow_screen.py` (NEW)

**Purpose:** Dedicated screen for cash flow visualization

**Features:**
- Monthly income vs expenses bar chart
- Net cash flow line graph
- Savings rate trend
- Year-over-year comparisons
- Goal tracking (future enhancement)

**Keybinding:** `f` for "Flow" or `k` for "Kash flow" 😄

### Phase 6: CSV Import Updates

#### 6.1 Update Amount Processing
**File:** `expenses/data_handler.py`

**Function:** `clean_amount()` (lines 60-69)

**Changes:**
- Keep existing logic but preserve sign information
- Return tuple: `(amount_value, inferred_type)`
- Parenthetical negatives → expense
- Positive amounts → income (if not overridden)

#### 6.2 Update Import Flow
**File:** `expenses/screens/import_screen.py`

**Function:** `_process_row()` and `import_data()`

**Changes:**
1. Remove expense-only filtering (lines checking `Amount >= 0`)
2. Add Type column to imported DataFrame
3. Use Type selector value or infer from amount sign
4. Pass transaction_type to AI categorization

### Phase 7: Testing Updates

#### 7.1 Update Existing Tests
**Files:** All test files

**Changes:**
- Update assertions to include Type column
- Add Type="expense" to test data for backward compatibility
- Update TrueLayer tests to handle income transactions

#### 7.2 Create New Tests
**New test scenarios:**

```python
# tests/test_data_handler.py
def test_load_transactions_with_type_column()
def test_load_transactions_backward_compatible()  # No Type column
def test_append_transactions_with_income()
def test_deduplication_with_mixed_types()

# tests/test_analysis.py
def test_calculate_income_summary()
def test_calculate_expense_summary()
def test_calculate_net_cash_flow()
def test_calculate_savings_rate()
def test_savings_rate_zero_income()  # Edge case

# tests/test_truelayer_handler.py
def test_convert_truelayer_transactions_with_credits()
def test_convert_truelayer_transactions_mixed()
def test_type_column_assignment()

# tests/test_screens.py (NEW)
def test_summary_screen_with_income_and_expenses()
def test_transaction_screen_type_filter()
def test_import_screen_type_selection()
```

### Phase 8: Documentation Updates

#### 8.1 Update CLAUDE.md
**File:** `CLAUDE.md`

**Sections to update:**
- Project Overview: Change description to "cash flow tracking"
- Data Storage Model: Document Type column
- Amount Parsing: Document income/expense handling
- AI Categorization: Document income categories

#### 8.2 Update README (if exists)
- Update description from "expense analyzer" to "cash flow tracker"
- Update features list to include income tracking and savings rate

#### 8.3 Create Migration Guide
**File:** `MIGRATION.md` (NEW)

Document for existing users:
- What's changed (Type column, income support)
- Migration process (automatic on first run)
- New features available
- Breaking changes (if any)

## Implementation Order

### Phase A: Foundation (Non-Breaking)
1. Add Type column with "expense" default (backward compatible)
2. Update validation to support Type column
3. Create migration helper function
4. Update tests to include Type in test data
5. Run full test suite to ensure no regressions

### Phase B: Bank Integration
1. Update TrueLayer conversion to include income
2. Update TrueLayer tests
3. Test with real TrueLayer sandbox data (both debits and credits)

### Phase C: Categories and AI
1. Add income categories to default_categories.json
2. Update Gemini AI to support transaction_type parameter
3. Test AI categorization with income transactions

### Phase D: Analysis and Calculations
1. Implement new analysis functions in analysis.py
2. Create comprehensive tests for calculations
3. Test edge cases (zero income, zero expenses, etc.)

### Phase E: UI Updates (Most Visible)
1. Update ImportScreen with Type selector
2. Update TransactionScreen with Type filter and visual distinction
3. Update CategorizeScreen to handle income categories
4. Update SummaryScreen with dual income/expense layout and metrics
5. Test each screen thoroughly with mixed data

### Phase F: Documentation and Polish
1. Update CLAUDE.md
2. Create MIGRATION.md
3. Update README
4. Test end-to-end user workflows

## Critical Files to Modify

### Core Data Layer
- `expenses/data_handler.py` - Type column, migration, validation
- `expenses/validation.py` - Type column validation
- `expenses/config.py` - No changes needed (paths remain same)

### Bank Integration
- `expenses/truelayer_handler.py` - Include credits, add Type column
- `tests/test_truelayer_handler.py` - Update tests for income

### Analysis
- `expenses/analysis.py` - Add cash flow calculation functions

### AI and Categories
- `expenses/gemini_utils.py` - Support income categorization
- `expenses/default_categories.json` - Add income categories

### UI Screens
- `expenses/screens/summary_screen.py` - Dual layout, metrics
- `expenses/screens/transaction_screen.py` - Type filter, visual distinction
- `expenses/screens/import_screen.py` - Type selector
- `expenses/screens/categorize_screen.py` - Type filter

### Tests
- `tests/test_data_handler.py` - Type column tests
- `tests/test_analysis.py` - Cash flow calculation tests
- `tests/test_truelayer_handler.py` - Income transaction tests
- `tests/test_gemini_utils.py` - Income categorization tests
- Update all test fixtures to include Type column

### Documentation
- `CLAUDE.md` - Update all references to expenses-only
- `README.md` - Update project description
- `MIGRATION.md` (NEW) - Migration guide for users

## Verification Plan

### Unit Tests
```bash
make test
# All tests should pass with Type column support
# New tests for income, cash flow, savings rate
```

### Manual Testing Workflow
1. **Fresh Install Test:**
   - Delete `~/.config/expenses_analyzer/`
   - Run `expenses-analyzer`
   - Import CSV with both income and expenses
   - Verify Type column is assigned correctly
   - Check summary screen shows dual breakdown

2. **Migration Test:**
   - Use existing data from real installation
   - Run updated app
   - Verify migration adds Type="expense" to existing data
   - Import new income transactions
   - Verify mixed data displays correctly

3. **TrueLayer Test:**
   - Connect TrueLayer sandbox account
   - Sync transactions (should include both debits and credits)
   - Verify income transactions are imported
   - Check Type column assignment
   - Verify summary screen shows income separately

4. **AI Categorization Test:**
   - Import income transactions without categories
   - Enable AI categorization
   - Verify income categories are suggested (Salary, Freelance, etc.)
   - Verify expense categories still work

5. **Cash Flow Metrics Test:**
   - Import mixed transactions (income and expenses)
   - Check summary screen metrics:
     - Total income
     - Total expenses
     - Net cash flow
     - Savings rate %
   - Verify calculations are correct
   - Check monthly trends display

### Edge Cases to Test
- Zero income (should handle gracefully, no division by zero)
- Zero expenses (savings rate = 100%)
- Negative net cash flow (spending more than earning)
- Single transaction type (only income or only expenses)
- Empty dataset
- Large amounts (billions)
- Date ranges spanning multiple years

### Performance Testing
- Import 10,000+ transactions with mixed types
- Verify summary screen renders quickly
- Check transaction filtering performance
- Ensure Type column doesn't slow down operations

## Rollback Plan

If issues arise:
1. Type column defaults to "expense" (backward compatible)
2. Can revert TrueLayer filter to DEBIT-only
3. Old parquet files without Type column load fine (default added)
4. No data loss - all changes are additive

## Future Enhancements (Out of Scope)

- Budget tracking and goal setting
- Investment tracking (stocks, crypto)
- Multi-currency support
- Transfer categorization (between accounts)
- Forecasting and predictions
- Custom reporting
- Export to tax software
- Bill payment reminders

## Estimated Complexity

- **Data Layer:** Low - Additive changes only
- **Bank Integration:** Low - Filter removal, Type assignment
- **Analysis:** Medium - New calculations needed
- **UI Updates:** High - Most visible changes, requires careful design
- **Testing:** Medium - Many new scenarios to cover

**Total Effort:** Moderate - Well-structured codebase makes this transformation straightforward. Most work is in UI updates and comprehensive testing.

## Success Criteria

✅ Type column added to all transactions
✅ Income transactions imported from TrueLayer
✅ Income categories available and AI-categorized
✅ Summary screen shows dual income/expense breakdown
✅ Cash flow metrics displayed (income, expenses, net, savings rate)
✅ Transaction screen filters by Type
✅ All existing tests pass with Type column
✅ New tests cover income scenarios
✅ Migration works for existing users
✅ Documentation updated

---

*Ready for implementation! Start with Phase A (Foundation) to ensure backward compatibility before moving to visible changes.*
