from pathlib import Path

CONFIG_DIR: Path = Path.home() / ".config" / "expenses_analyzer"
CONFIG_FILE: Path = CONFIG_DIR / "categories.json"
TRANSACTIONS_FILE: Path = CONFIG_DIR / "transactions.parquet"
DEFAULT_CATEGORIES_FILE: Path = CONFIG_DIR / "default_categories.json"
LOG_FILE: Path = CONFIG_DIR / "app.log"
