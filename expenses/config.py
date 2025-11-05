import os
from pathlib import Path

# Use environment variable for config directory, with a default
_default_config_dir = Path.home() / ".config" / "expenses_analyzer"
CONFIG_DIR: Path = Path(os.getenv("EXPENSES_ANALYZER_CONFIG_DIR", _default_config_dir))

# Ensure the config directory exists
CONFIG_DIR.mkdir(parents=True, exist_ok=True)

CATEGORIES_FILE: Path = CONFIG_DIR / "categories.json"
TRANSACTIONS_FILE: Path = CONFIG_DIR / "transactions.parquet"
DEFAULT_CATEGORIES_FILE: Path = CONFIG_DIR / "default_categories.json"
LOG_FILE: Path = CONFIG_DIR / "app.log"

# Plaid API Configuration
PLAID_CLIENT_ID = os.getenv("PLAID_CLIENT_ID")
PLAID_SECRET = os.getenv("PLAID_SECRET")
PLAID_ENV = os.getenv("PLAID_ENV", "sandbox")  # Default to sandbox for development
