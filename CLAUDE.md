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

- **App Core** (`app.py`): Main `ExpensesApp` class manages screen navigation via keybindings (s=Summary, t=Transactions, i=Import, c=Categorize, d=Bulk Delete, l=Link Banks)
- **Screens** (`screens/`): Each major feature is a screen that inherits from `BaseScreen`
  - `SummaryScreen`: Aggregated expense views with yearly/monthly breakdowns
  - `TransactionScreen`: Detailed transaction browsing with filtering
  - `ImportScreen`: CSV import wizard with column mapping
  - `CategorizeScreen`: Merchant categorization interface
  - `DeleteScreen`: Transaction deletion interface
  - `FileBrowserScreen`: File system navigation for imports
  - `TrueLayerScreen`: Bank account linking and transaction sync (displayed as "Link Banks")
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
- `truelayer_connections.json`: TrueLayer linked account metadata (connection_id, access_token, refresh_token, provider_name, last_sync)
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
- `TRUELAYER_CLIENT_ID`: TrueLayer API client ID (required for TrueLayer integration)
- `TRUELAYER_CLIENT_SECRET`: TrueLayer API client secret (required for TrueLayer integration)
- `TRUELAYER_ENV`: TrueLayer environment - "sandbox" or "production" (default: "sandbox")

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

## Bank Account Integrations

The application supports automatic transaction import from bank accounts via two integration providers: TrueLayer.

### Unified OAuth Server

Both TrueLayer share a unified OAuth callback server:

**File:** `expenses/oauth_server.py`
- Single Flask server running on port 3000
- Handles callbacks for TrueLayer (`/truelayer-callback`)
- Thread-safe token stores for both providers
- Prevents port conflicts and simplifies deployment

### TrueLayer Integration

**Files:**
- `expenses/truelayer_handler.py`: Core business logic for TrueLayer API interactions
- `expenses/screens/truelayer_screen.py`: UI for linking accounts and syncing transactions
- `tests/test_truelayer_handler.py`: Comprehensive test suite

**Architecture:**
- Uses `requests` library directly (no official Python SDK available)
- OAuth flow opens TrueLayer auth in browser, handles redirect to localhost:3000/truelayer-callback
- Stores connections in `~/.config/expenses_analyzer/truelayer_connections.json`
- Supports multiple accounts per connection
- Transactions tagged with source: "TrueLayer - {provider_name}"

**Key Functions:**
- `exchange_code_for_token()`: Exchanges OAuth code for access/refresh tokens
- `refresh_access_token()`: Refreshes expired access tokens
- `get_accounts()`: Fetches all accounts for a connection
- `fetch_transactions()`: Fetches transactions for a specific account with date range
- `sync_all_accounts()`: Syncs transactions from all accounts
- `convert_truelayer_transactions_to_dataframe()`: Converts TrueLayer format to DataFrame

**API Endpoints:**
- Auth: `https://auth.truelayer.com` (production) or `https://auth.truelayer-sandbox.com` (sandbox)
- Data API: `https://api.truelayer.com/data/v1` (production) or `https://api.truelayer-sandbox.com/data/v1` (sandbox)

**Supported Regions:** UK, Europe (all TrueLayer-supported countries)

**Keybinding:** Press `l` to access Link Banks screen

### Common Integration Patterns

Both integrations follow similar architecture:

1. **OAuth Flow:**
   - User clicks "Connect" button in UI
   - Unified Flask server starts on port 3000 (if not already running)
   - Browser opens provider's auth page
   - User authenticates with bank
   - Provider redirects to localhost:3000 callback (different routes for TrueLayer)
   - Authorization code/token captured and stored in provider-specific stores

2. **Transaction Sync:**
   - User clicks "Sync Transactions" button
   - Worker thread fetches transactions in background
   - Transactions converted to standard DataFrame format
   - Preview shown in UI (first 10 transactions)
   - User confirms import
   - Transactions appended with source tracking and deduplication

3. **Data Processing:**
   - Amounts inverted to positive for expenses (TrueLayer return negative for debits)
   - Credits filtered out (only debits/expenses imported)
   - Duplicates detected on (Date, Merchant, Amount) tuple
   - AI categorization triggered via Gemini if `GEMINI_API_KEY` set

4. **Security:**
   - All credential files stored in `~/.config/expenses_analyzer/` with secure permissions (600)
   - Access tokens stored locally, never logged
   - OAuth servers run only during auth flow, automatically stopped after

### Adding a New Bank Integration

To add a new provider (e.g., Yodlee, Finicity):

1. Create `expenses/{provider}_handler.py` with core logic
2. Create `expenses/{provider}_oauth_server.py` for OAuth handling
3. Create `expenses/screens/{provider}_screen.py` for UI
4. Update `expenses/config.py` with required env vars
5. Register screen in `expenses/app.py` SCREENS dict and add keybinding
6. Follow the common patterns above for OAuth flow and transaction sync
7. Create test suite in `tests/test_{provider}_handler.py`
8. Update dependencies in `pyproject.toml` if new packages needed
