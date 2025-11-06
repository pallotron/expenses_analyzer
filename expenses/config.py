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
MERCHANT_ALIASES_FILE: Path = CONFIG_DIR / "merchant_aliases.json"
LOG_FILE: Path = CONFIG_DIR / "app.log"

# TrueLayer API Configuration
TRUELAYER_CLIENT_ID = os.getenv("TRUELAYER_CLIENT_ID")
TRUELAYER_CLIENT_SECRET = os.getenv("TRUELAYER_CLIENT_SECRET")

TRUELAYER_ENV = os.getenv(
    "TRUELAYER_ENV", "sandbox"
)  # Default to sandbox for development

# TrueLayer OAuth Scopes (space-separated)
TRUELAYER_SCOPES = os.getenv(
    "TRUELAYER_SCOPES",
    "info accounts balance transactions offline_access",  # Default scopes
)

# TrueLayer Providers (space-separated)
TRUELAYER_PROVIDERS = os.getenv(
    "TRUELAYER_PROVIDERS", ""  # Default: auto-detect based on environment
)
