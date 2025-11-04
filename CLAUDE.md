# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Expense Analyzer is a Textual TUI (Text User Interface) application for analyzing personal financial transactions. Built with Python 3.12+, it uses Pandas for data processing, Parquet for efficient storage, and Google's Gemini AI for automatic expense categorization.

## Development Commands

### Environment Setup
```bash
make install          # Install system-wide with pipx
make venv            # Create virtual environment with uv and install dependencies
```

### Testing and Quality
```bash
make test            # Run pytest test suite (PYTHONPATH=. is set automatically)
make lint            # Run flake8 linting (error-level and complexity checks)
make format          # Format code with black
make all             # Run lint + test
```

### Running the Application
```bash
# After installation:
expenses-analyzer

# Development mode:
python -m expenses.main
# or
python expenses/main.py
```

### Running Single Tests
```bash
PYTHONPATH=. pytest tests/test_data_handler.py -v
PYTHONPATH=. pytest tests/test_data_handler.py::test_function_name -v
```

## Architecture Overview

### Application Structure

**Main Entry Point**: `expenses/main.py` → `expenses/app.py` (`ExpensesApp` class)

The application follows a screen-based architecture powered by Textual:

- **App Core** (`app.py`): Main `ExpensesApp` class manages screen navigation via keybindings (s=Summary, t=Transactions, i=Import, c=Categorize, d=Delete)
- **Screens** (`screens/`): Each major feature is a screen that inherits from `BaseScreen`
  - `SummaryScreen`: Aggregated expense views with yearly/monthly breakdowns
  - `TransactionScreen`: Detailed transaction browsing with filtering
  - `ImportScreen`: CSV import wizard with column mapping
  - `CategorizeScreen`: Merchant categorization interface
  - `DeleteScreen`: Transaction deletion interface
  - `FileBrowserScreen`: File system navigation for imports
  - `ConfirmationScreen`: Reusable confirmation dialogs
- **Data Layer** (`data_handler.py`): All Parquet I/O and category management
- **Analysis** (`analysis.py`): Trend calculations and data aggregation
- **Filtering** (`transaction_filter.py`): Transaction filtering logic
- **AI Integration** (`gemini_utils.py`): Google Gemini API for merchant categorization
- **Widgets** (`widgets/`): Reusable UI components (notifications, log viewer)

### Data Storage Model

All user data lives in `~/.config/expenses_analyzer/` (configurable via `EXPENSES_ANALYZER_CONFIG_DIR`):

- `transactions.parquet`: Main transaction database (Pandas DataFrame with Date, Merchant, Amount, Category columns)
- `categories.json`: Merchant-to-category mappings `{"merchant_name": "category"}`
- `default_categories.json`: List of available categories (copied from package on first run)
- `app.log`: Application logs

**Critical Data Flow**:
1. CSV Import → `ImportScreen.import_data()` → `append_transactions()` in `data_handler.py`
2. Parquet is the single source of truth - all reads/writes go through `load_transactions_from_parquet()` and `save_transactions_to_parquet()`
3. Category assignments are persisted separately in `categories.json` and merged with transactions on load
4. Gemini AI suggestions (if `GEMINI_API_KEY` is set) happen during import via `get_gemini_category_suggestions_for_merchants()`

### Key Design Patterns

- **Screen Navigation**: Push/pop stack model with `ExpensesApp.push_screen()` and `action_pop_screen()`
- **Notifications**: `ExpensesApp.show_notification()` mounts temporary notification widgets
- **Confirmations**: `ExpensesApp.push_confirmation()` with callback pattern for destructive operations
- **Mixin Pattern**: `DataTableOperationsMixin` provides shared table interaction logic for screens
- **Configuration Injection**: `config.py` centralizes all file paths using environment variables

## Important Implementation Notes

### CSV Import Architecture
The legacy `load_transactions_from_csvs()` function was removed - all imports now flow through:
`ImportScreen` → `import_data()` method → `append_transactions()` in `data_handler.py`

### Amount Parsing
The `clean_amount()` function in `data_handler.py` handles various formats:
- Parenthetical negatives: `(100.00)` → `-100.00`
- Currency symbols: `€100`, `$100`, `£100`
- CSV dashes representing zero: `-` → `0.00`

### AI Categorization
- Optional feature requiring `GEMINI_API_KEY` environment variable
- Uses `gemini-flash-latest` model (hardcoded, should be configurable per TODO.md)
- Batches multiple merchants in single API call for efficiency
- Only suggests categories for merchants not in `categories.json`

### Testing Strategy
Currently 7 test files covering:
- Core data handling (`test_data_handler.py`)
- Analysis utilities (`test_analysis.py`)
- Transaction filtering (`test_transaction_filter.py`)
- Gemini integration (`test_gemini_utils.py`)
- Screen components (transaction, confirmation screens)
- Widgets (`test_widgets.py`)

Use `PYTHONPATH=.` when running pytest as the project structure requires it.

## Version Control

**This repository uses Jujutsu (jj), not git.** Use jj commands for all version control operations:

- `jj status` - Check working copy status
- `jj diff` - View changes
- `jj describe -m "message"` - Set commit message for current change
- `jj new` - Create a new change
- `jj squash` - Squash current change into parent
- `jj log` - View commit history
- `jj git push` - Push to git remote
- `jj op undo` - Undo last operation

The working copy (`@`) is always a commit in jj. There's no staging area - changes are automatically part of the working copy commit.

**Important Workflow:**
- **Always run `jj new` before starting a new feature or fix** - This creates a new change on top of the current one, keeping commits organized and avoiding mixing unrelated changes in the working copy.

## Configuration

### Environment Variables
- `EXPENSES_ANALYZER_CONFIG_DIR`: Override default config location (default: `~/.config/expenses_analyzer/`)
- `GEMINI_API_KEY`: Google Gemini API key for auto-categorization (optional)

### Python Version
Requires Python 3.12+ (specified in `pyproject.toml`)

## Common Workflows

### Adding a New Screen
1. Create new screen class in `expenses/screens/` inheriting from `BaseScreen`
2. Register in `ExpensesApp.SCREENS` dict in `app.py`
3. Add keybinding in `ExpensesApp.BINDINGS` if needed
4. Implement `compose()` for UI and action handlers

### Modifying Data Schema
1. Update DataFrame operations in `data_handler.py`
2. Parquet files auto-adapt to new columns (backward compatible)
3. Update `load_transactions_from_parquet()` default columns if needed
4. Consider migration strategy for existing user data

### Adding Transaction Filters
1. Extend `TransactionFilter` class in `transaction_filter.py`
2. Update `TransactionScreen` to expose new filter options
3. Filters operate on Pandas DataFrames - use `.loc[]` and boolean indexing

## Code Style

- **Linting**: Flake8 with max line length 110, max complexity 10
- **Formatting**: Black (run `make format` before committing)
- **Type Hints**: Partially implemented, ongoing work (see TODO.md)
- **Logging**: Use Python's `logging` module, logs go to `app.log`

## Package Management

The project uses:
- `uv` for fast virtual environment and dependency management
- `pipx` for system-wide installation
- `setuptools` as build backend (pyproject.toml)
- Entry point: `expenses-analyzer` command → `expenses.main:main`
