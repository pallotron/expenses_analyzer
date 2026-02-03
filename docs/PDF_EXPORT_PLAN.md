# PDF Export Implementation Plan

## Overview

Add PDF export functionality to the Summary and Transactions screens, allowing users to generate reports of their financial data.

## Library Choice

**Recommended: `fpdf2`**

- Pure Python, no external system dependencies
- Simple API for tables and text
- Active maintenance, good documentation
- Lightweight (~500KB)

Alternative considered: `reportlab` (more powerful but more complex for our needs)

## Implementation Steps

### Step 1: Add Dependency

Update `pyproject.toml`:
```toml
dependencies = [
    # ... existing deps
    "fpdf2>=2.7.0",
]
```

### Step 2: Create PDF Export Module

**New file: `expenses/pdf_export.py`**

#### Core Functions

```python
def create_base_pdf(title: str) -> FPDF:
    """Create PDF with standard header/footer styling."""

def add_table(pdf: FPDF, headers: list[str], rows: list[list], col_widths: list[int]):
    """Render a DataFrame-like table to PDF."""

def format_currency(amount: float) -> str:
    """Format amount as currency string."""
```

#### Summary Export

```python
def export_summary_pdf(
    transactions: pd.DataFrame,
    categories: dict,
    year: int | None = None,
    month: int | None = None,
    source_filter: str | None = None,
    output_path: str | None = None
) -> str:
    """
    Export summary report containing:
    - Report period and generation date
    - Cash flow summary (income, expenses, net, savings rate)
    - Expense categories breakdown table
    - Income categories breakdown table
    - Top 10 expense merchants
    - Top 10 income sources
    - Monthly breakdown table (if viewing yearly data)

    Returns: Path to generated PDF file
    """
```

#### Transaction Export

```python
def export_transactions_pdf(
    transactions: pd.DataFrame,
    filters: TransactionFilter | None = None,
    output_path: str | None = None
) -> str:
    """
    Export transactions report containing:
    - Applied filters summary
    - Cash flow totals for filtered data
    - Transaction list table (Date, Merchant, Amount, Type, Category, Source)
    - Merchant summary table

    Returns: Path to generated PDF file
    """
```

### Step 3: Update Summary Screen

**File: `expenses/screens/summary_screen.py`**

1. Add keybinding:
```python
BINDINGS = [
    # ... existing bindings
    Binding("e", "export_pdf", "Export PDF"),
]
```

2. Add export action:
```python
def action_export_pdf(self) -> None:
    """Export current summary view to PDF."""
    from expenses.pdf_export import export_summary_pdf

    try:
        filepath = export_summary_pdf(
            transactions=self.transactions,
            categories=self.categories,
            year=self._get_selected_year(),
            month=self._get_selected_month(),
            source_filter=self.current_source_filter,
        )
        self.app.show_notification(f"Exported to {filepath}", severity="information")
    except Exception as e:
        self.app.show_notification(f"Export failed: {e}", severity="error")
```

### Step 4: Update Transaction Screen

**File: `expenses/screens/transaction_screen.py`**

1. Add keybinding:
```python
BINDINGS = [
    # ... existing bindings
    Binding("e", "export_pdf", "Export PDF"),
]
```

2. Add export action:
```python
def action_export_pdf(self) -> None:
    """Export current filtered transactions to PDF."""
    from expenses.pdf_export import export_transactions_pdf

    try:
        filepath = export_transactions_pdf(
            transactions=self.filtered_transactions,
            filters=self.current_filter,
        )
        self.app.show_notification(f"Exported to {filepath}", severity="information")
    except Exception as e:
        self.app.show_notification(f"Export failed: {e}", severity="error")
```

### Step 5: PDF Output Location

Default export location: `~/.config/expenses_analyzer/exports/`

Filename format:
- Summary: `summary_YYYY-MM_YYYYMMDD_HHMMSS.pdf` (e.g., `summary_2024-01_20240215_143022.pdf`)
- Transactions: `transactions_YYYYMMDD_HHMMSS.pdf`

Create exports directory if it doesn't exist.

## PDF Layout Design

### Summary Report Layout

```
+--------------------------------------------------+
|  EXPENSE ANALYZER - SUMMARY REPORT               |
|  Period: January 2024                            |
|  Generated: 2024-02-15 14:30:22                  |
+--------------------------------------------------+

CASH FLOW SUMMARY
+------------------+------------------+
| Total Income     |        $5,000.00 |
| Total Expenses   |        $3,500.00 |
| Net              |        $1,500.00 |
| Savings Rate     |           30.00% |
+------------------+------------------+

EXPENSE CATEGORIES
+------------------+------------+--------+
| Category         |     Amount |      % |
+------------------+------------+--------+
| Groceries        |    $800.00 |  22.9% |
| Utilities        |    $350.00 |  10.0% |
| ...              |        ... |    ... |
+------------------+------------+--------+
| TOTAL            |  $3,500.00 | 100.0% |
+------------------+------------+--------+

INCOME CATEGORIES
+------------------+------------+--------+
| Category         |     Amount |      % |
+------------------+------------+--------+
| Salary           |  $4,500.00 |  90.0% |
| ...              |        ... |    ... |
+------------------+------------+--------+

TOP EXPENSE MERCHANTS
+----------------------+------------------+------------+
| Merchant             | Category         |     Amount |
+----------------------+------------------+------------+
| Whole Foods          | Groceries        |    $450.00 |
| ...                  | ...              |        ... |
+----------------------+------------------+------------+

MONTHLY BREAKDOWN (if yearly view)
+------------------+--------+--------+--------+...+--------+--------+
| Category         |    Jan |    Feb |    Mar |...|  Total |    Avg |
+------------------+--------+--------+--------+...+--------+--------+
| Groceries        | 800.00 | 750.00 | 820.00 |...| 9500.0 |  791.7 |
+------------------+--------+--------+--------+...+--------+--------+
```

### Transaction Report Layout

```
+--------------------------------------------------+
|  EXPENSE ANALYZER - TRANSACTIONS REPORT          |
|  Generated: 2024-02-15 14:30:22                  |
+--------------------------------------------------+

FILTERS APPLIED
  Date Range: 2024-01-01 to 2024-01-31
  Category: Groceries
  Type: Expense

SUMMARY
+------------------+------------------+
| Total Expenses   |        $1,200.00 |
| Transaction Count|               45 |
+------------------+------------------+

TRANSACTIONS
+------------+----------------------+----------+----------+
| Date       | Merchant             |   Amount | Category |
+------------+----------------------+----------+----------+
| 2024-01-31 | Whole Foods          |   $85.50 | Grocer.. |
| 2024-01-30 | Trader Joe's         |   $62.30 | Grocer.. |
| ...        | ...                  |      ... | ...      |
+------------+----------------------+----------+----------+

MERCHANT SUMMARY
+----------------------+------------+-------+
| Merchant             |      Total | Count |
+----------------------+------------+-------+
| Whole Foods          |    $450.00 |    12 |
| Trader Joe's         |    $320.00 |     8 |
+----------------------+------------+-------+
```

## Testing

**New file: `tests/test_pdf_export.py`**

Test cases:
1. `test_export_summary_pdf_basic` - Export with sample data
2. `test_export_summary_pdf_with_filters` - Export with year/month filters
3. `test_export_summary_pdf_empty_data` - Handle empty DataFrame gracefully
4. `test_export_transactions_pdf_basic` - Export transaction list
5. `test_export_transactions_pdf_with_filters` - Export with filters applied
6. `test_export_transactions_pdf_large_dataset` - Performance with 10k+ rows
7. `test_pdf_file_created` - Verify file exists at expected path
8. `test_pdf_readable` - Verify generated PDF is valid (can be opened)

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `pyproject.toml` | Modify | Add `fpdf2` dependency |
| `expenses/pdf_export.py` | New | PDF generation functions |
| `expenses/config.py` | Modify | Add `EXPORTS_DIR` path constant |
| `expenses/screens/summary_screen.py` | Modify | Add export keybinding and action |
| `expenses/screens/transaction_screen.py` | Modify | Add export keybinding and action |
| `tests/test_pdf_export.py` | New | Unit tests for PDF export |

## Future Enhancements (Out of Scope)

- Custom output path selection via file browser
- CSV/Excel export options
- Chart/graph inclusion in PDF
- Configurable report sections
- Email report directly
- Scheduled automatic exports
