# Transaction Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-transaction tags (`emergency`, `trip:<name>`) with summary-screen exclusion of emergency spend and per-row/bulk tagging in the Transactions screen.

**Architecture:** A `Tags` string column (comma-separated tokens) in `transactions.parquet`, managed exclusively through helper functions in `data_handler.py`. The Summary screen filters out excluded tags (configurable via `tag_settings.json`) before aggregation; the Transactions screen gains a tag modal (modeled on `BulkEditTransactionScreen`) and a Tags filter.

**Tech Stack:** Python 3.12+, pandas, Textual TUI, pytest (unittest.TestCase style), parquet via pyarrow.

**Spec:** `docs/superpowers/specs/2026-07-07-transaction-tags-design.md` — read it first.

## Global Constraints

- **VCS is jj, not git.** Per repo CLAUDE.md: `jj st` → `jj new` if `@` has changes → `jj desc -m "message"` before coding. Never `git commit`. Commit messages: imperative sentence case, no prefix, no full stop (match `jj log` style).
- Tag format: lowercase, charset `[a-z0-9:_-]`, comma-separated with no spaces in the stored cell. Spaces in input become `-`; other invalid chars are dropped.
- Default exclusion list: `{"exclude_from_summary": ["emergency"]}`.
- Tests: `PYTHONPATH=. pytest tests/<file> -v` (PYTHONPATH is required). Style: `unittest.TestCase` classes, `@patch("expenses.data_handler.<fn>")` mocks — match `tests/test_data_handler.py`.
- Lint/format: `make lint` (flake8, max line 110, max complexity 10) and `make format` (black) must pass; run `make all` at the end of every task.
- Summary toggle key is `x` (NOT `e` — `e` is Export PDF there).
- The user's live parquet already contains an `Emergency` boolean column (a handful of rows) — the migration in Task 2 is not hypothetical; never drop those rows' information.

## File Structure

- `expenses/tags.py` — **new**: tag string helpers (pure functions, no I/O). Kept out of the 764-line `data_handler.py` on purpose.
- `expenses/data_handler.py` — modify: load/append backward-compat + migration, `tag_transactions()` persistence, `load_tag_settings()`.
- `expenses/config.py` — modify: add `TAG_SETTINGS_FILE`.
- `expenses/analysis.py` — modify: add `exclude_tagged_transactions()`.
- `expenses/screens/summary_screen.py` — modify: exclusion wiring + `x` toggle + status line.
- `expenses/screens/transaction_screen.py` — modify: Tags column, Tags filter, `g`/`G` actions.
- `expenses/screens/tag_transactions_screen.py` — **new**: modal for entering tags.
- Tests: `tests/test_tags.py` (new), additions to `tests/test_data_handler.py`, `tests/test_analysis.py`.

---

### Task 1: Tag helper module

**Files:**
- Create: `expenses/tags.py`
- Test: `tests/test_tags.py` (new)

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces (used by Tasks 2, 4, 5, 6, 7):
  - `normalize_tag(raw: str) -> str` — lowercase, strip, spaces→`-`, drop chars outside `[a-z0-9:_-]`; may return `""`.
  - `parse_tags(cell) -> list[str]` — split a stored cell; tolerates `None`/NaN/empty → `[]`.
  - `join_tags(tags: list[str]) -> str` — normalize, dedup preserving order, join with `,`.
  - `add_tags_to_cell(cell: str, tags: list[str]) -> str`
  - `remove_tags_from_cell(cell: str, tags: list[str]) -> str`
  - `series_has_tag(s: pd.Series, tag: str) -> pd.Series` — exact-token match.
  - `series_has_tag_prefix(s: pd.Series, prefix: str) -> pd.Series`
  - `all_tags_in_series(s: pd.Series) -> list[str]` — sorted distinct tags.

- [ ] **Step 1: Start the change**

```bash
jj st   # if @ has changes: jj new
jj desc -m "Add tag helper module for transaction tags"
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_tags.py`:

```python
import unittest

import pandas as pd

from expenses.tags import (
    add_tags_to_cell,
    all_tags_in_series,
    join_tags,
    normalize_tag,
    parse_tags,
    remove_tags_from_cell,
    series_has_tag,
    series_has_tag_prefix,
)


class TestTagHelpers(unittest.TestCase):

    def test_normalize_tag(self) -> None:
        self.assertEqual(normalize_tag("  Emergency "), "emergency")
        self.assertEqual(normalize_tag("Trip: Paris Jun26"), "trip:-paris-jun26")
        self.assertEqual(normalize_tag("trip:paris jun26"), "trip:paris-jun26")
        self.assertEqual(normalize_tag("we!rd@"), "werd")
        self.assertEqual(normalize_tag("   "), "")

    def test_parse_tags(self) -> None:
        self.assertEqual(parse_tags("emergency,trip:x"), ["emergency", "trip:x"])
        self.assertEqual(parse_tags(""), [])
        self.assertEqual(parse_tags(None), [])
        self.assertEqual(parse_tags(float("nan")), [])

    def test_join_tags_normalizes_and_dedups(self) -> None:
        self.assertEqual(join_tags(["Emergency", "emergency", "trip:x"]), "emergency,trip:x")
        self.assertEqual(join_tags(["", "  "]), "")

    def test_add_and_remove_cell(self) -> None:
        self.assertEqual(add_tags_to_cell("", ["emergency"]), "emergency")
        self.assertEqual(add_tags_to_cell("emergency", ["trip:x"]), "emergency,trip:x")
        self.assertEqual(add_tags_to_cell("emergency", ["emergency"]), "emergency")
        self.assertEqual(remove_tags_from_cell("emergency,trip:x", ["emergency"]), "trip:x")
        self.assertEqual(remove_tags_from_cell("trip:x", ["nope"]), "trip:x")

    def test_series_has_tag_exact_token(self) -> None:
        s = pd.Series(["emergency", "trip:x", "emergency,trip:x", "", None])
        self.assertEqual(series_has_tag(s, "emergency").tolist(), [True, False, True, False, False])
        # exact token: "trip" must not match "trip:x"
        self.assertEqual(series_has_tag(s, "trip").tolist(), [False, False, False, False, False])

    def test_series_has_tag_prefix(self) -> None:
        s = pd.Series(["trip:x", "trip:y,emergency", "emergency"])
        self.assertEqual(series_has_tag_prefix(s, "trip:").tolist(), [True, True, False])

    def test_all_tags_in_series(self) -> None:
        s = pd.Series(["trip:x,emergency", "emergency", ""])
        self.assertEqual(all_tags_in_series(s), ["emergency", "trip:x"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_tags.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'expenses.tags'`

- [ ] **Step 4: Write the implementation**

Create `expenses/tags.py`:

```python
"""Pure helpers for the per-transaction Tags column.

Stored format: lowercase tokens matching [a-z0-9:_-], comma-separated,
no spaces (e.g. "emergency,trip:paris-jun26"). Screens and data_handler
must use these helpers instead of manipulating the string directly.
"""

import re
from typing import List, Optional

import pandas as pd

_INVALID_CHARS = re.compile(r"[^a-z0-9:_-]")


def normalize_tag(raw: str) -> str:
    """Normalize a single tag: lowercase, strip, spaces to '-', drop invalid chars."""
    tag = str(raw).strip().lower().replace(" ", "-")
    return _INVALID_CHARS.sub("", tag)


def parse_tags(cell: Optional[str]) -> List[str]:
    """Split a stored Tags cell into a list. Tolerates None/NaN/empty."""
    if cell is None or (isinstance(cell, float) and pd.isna(cell)):
        return []
    return [t for t in str(cell).split(",") if t]


def join_tags(tags: List[str]) -> str:
    """Normalize, dedup (order-preserving) and join tags for storage."""
    seen = []
    for raw in tags:
        tag = normalize_tag(raw)
        if tag and tag not in seen:
            seen.append(tag)
    return ",".join(seen)


def add_tags_to_cell(cell: Optional[str], tags: List[str]) -> str:
    return join_tags(parse_tags(cell) + list(tags))


def remove_tags_from_cell(cell: Optional[str], tags: List[str]) -> str:
    to_remove = {normalize_tag(t) for t in tags}
    return join_tags([t for t in parse_tags(cell) if t not in to_remove])


def series_has_tag(s: pd.Series, tag: str) -> pd.Series:
    """Exact-token match: 'trip' does not match 'trip:x'."""
    wanted = normalize_tag(tag)
    return s.apply(lambda cell: wanted in parse_tags(cell))


def series_has_tag_prefix(s: pd.Series, prefix: str) -> pd.Series:
    return s.apply(lambda cell: any(t.startswith(prefix) for t in parse_tags(cell)))


def all_tags_in_series(s: pd.Series) -> List[str]:
    tags = set()
    for cell in s:
        tags.update(parse_tags(cell))
    return sorted(tags)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_tags.py -v`
Expected: all PASS. If `test_normalize_tag`'s second case fails, check the expected literal is `"trip:-paris-jun26"`.

- [ ] **Step 6: Lint, format, full suite**

Run: `make all`
Expected: flake8 clean, all tests pass.

- [ ] **Step 7: Verify commit content**

```bash
jj st    # should show only expenses/tags.py and tests/test_tags.py
```

---

### Task 2: Tags column in load/append + Emergency migration

**Files:**
- Modify: `expenses/data_handler.py` — `load_transactions_from_parquet()` (the backward-compat block) and `append_transactions()` (the "Add X column if not present" block)
- Test: `tests/test_data_handler.py`

**Interfaces:**
- Consumes: `add_tags_to_cell` from Task 1.
- Produces: every DataFrame returned by `load_transactions_from_parquet()` has a `Tags` string column (no NaN); legacy `Emergency` column is folded in and dropped. `append_transactions()` fills `Tags=""` on new rows. The two empty-DataFrame fallbacks in `load_transactions_from_parquet` gain `"Tags"` in their column lists.

- [ ] **Step 1: Start the change**

```bash
jj st   # @ has Task 1 changes → jj new
jj desc -m "Add Tags column backward compatibility and Emergency migration"
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/test_data_handler.py` (inside `TestDataHandler`; add `import tempfile`, `from pathlib import Path`, and `from expenses.data_handler import load_transactions_from_parquet` to the imports):

```python
    def test_load_adds_tags_column_and_migrates_emergency(self) -> None:
        df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-03-13", "2026-03-14"]),
                "Merchant": ["AerLingus", "Tesco"],
                "Amount": [298.99, 12.00],
                "Source": ["Bank B", "Bank B"],
                "Deleted": [False, False],
                "Type": ["expense", "expense"],
                "Emergency": [True, False],
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            parquet_path = Path(tmp) / "transactions.parquet"
            df.to_parquet(parquet_path, index=False)
            with patch("expenses.data_handler.TRANSACTIONS_FILE", parquet_path):
                loaded = load_transactions_from_parquet()
        self.assertIn("Tags", loaded.columns)
        self.assertNotIn("Emergency", loaded.columns)
        self.assertEqual(loaded["Tags"].tolist(), ["emergency", ""])

    def test_load_adds_empty_tags_when_missing(self) -> None:
        df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-01-01"]),
                "Merchant": ["Tesco"],
                "Amount": [5.00],
                "Deleted": [False],
                "Type": ["expense"],
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            parquet_path = Path(tmp) / "transactions.parquet"
            df.to_parquet(parquet_path, index=False)
            with patch("expenses.data_handler.TRANSACTIONS_FILE", parquet_path):
                loaded = load_transactions_from_parquet()
        self.assertEqual(loaded["Tags"].tolist(), [""])

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_append_transactions_defaults_tags(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01"]),
                "Merchant": ["Existing Merchant"],
                "Amount": [10.00],
                "Deleted": [False],
                "Type": ["expense"],
                "Tags": ["emergency"],
            }
        )
        new_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-02"]),
                "Merchant": ["New Merchant"],
                "Amount": [20.00],
            }
        )
        mock_load.return_value = existing_df.copy()
        append_transactions(new_df)
        saved_df = mock_save.call_args[0][0]
        self.assertEqual(saved_df["Tags"].tolist(), ["emergency", ""])
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_data_handler.py -v -k "tags or emergency"`
Expected: 3 FAILs (`Tags` column missing / `Emergency` still present).

- [ ] **Step 4: Implement**

In `expenses/data_handler.py`, add to the module imports:

```python
from expenses.tags import add_tags_to_cell
```

In `load_transactions_from_parquet()`, directly after the existing `Type` backward-compat block and **before** the `if not include_deleted:` filter, insert:

```python
        # Add Tags column if it doesn't exist (backward compatibility)
        if "Tags" not in df.columns:
            df["Tags"] = ""
        df["Tags"] = df["Tags"].fillna("").astype(str)

        # One-time migration: fold legacy Emergency boolean into Tags
        if "Emergency" in df.columns:
            emergency_mask = df["Emergency"].fillna(False).astype(bool)
            df.loc[emergency_mask, "Tags"] = df.loc[emergency_mask, "Tags"].apply(
                lambda cell: add_tags_to_cell(cell, ["emergency"])
            )
            df = df.drop(columns=["Emergency"])
            logging.info("Migrated legacy Emergency column into Tags")
```

Update **both** empty-DataFrame fallbacks in the same function (missing file and corruption) to include the new column:

```python
        return pd.DataFrame(
            columns=["Date", "Merchant", "Amount", "Source", "Deleted", "Type", "Tags"]
        )
```

In `append_transactions()`, after the `Type` default block (`new_transactions["Type"] = "expense"`), add:

```python
    # Add Tags column to new transactions if not present
    if "Tags" not in new_transactions.columns:
        new_transactions["Tags"] = ""
```

Also in `append_transactions()`, where existing columns are standardized (the block that does `existing_transactions["Type"] = ...astype(str)`), add:

```python
    if "Tags" not in existing_transactions.columns:
        existing_transactions["Tags"] = ""
    existing_transactions["Tags"] = existing_transactions["Tags"].fillna("").astype(str)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_data_handler.py -v`
Expected: new tests PASS, all pre-existing tests still PASS (the migration is additive; if an old test asserts an exact column list, add `"Tags"` to its expectation).

- [ ] **Step 6: `make all`, then verify commit**

```bash
make all
jj st   # only data_handler.py and test_data_handler.py
```

---

### Task 3: tag_settings.json

**Files:**
- Modify: `expenses/config.py`, `expenses/data_handler.py`
- Test: `tests/test_data_handler.py`

**Interfaces:**
- Produces: `config.TAG_SETTINGS_FILE: Path`; `data_handler.load_tag_settings() -> dict` returning at minimum `{"exclude_from_summary": [...]}`, defaulting to `["emergency"]`, recreating the file on corruption (same posture as other config files). Used by Task 5/6.

- [ ] **Step 1: Start the change**

```bash
jj st && jj new
jj desc -m "Add tag settings file with summary exclusion list"
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/test_data_handler.py` (add `load_tag_settings` to the data_handler imports, plus `import json`):

```python
    def test_load_tag_settings_creates_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings_path = Path(tmp) / "tag_settings.json"
            with patch("expenses.data_handler.TAG_SETTINGS_FILE", settings_path):
                settings = load_tag_settings()
            self.assertEqual(settings, {"exclude_from_summary": ["emergency"]})
            self.assertTrue(settings_path.exists())

    def test_load_tag_settings_recovers_from_corruption(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings_path = Path(tmp) / "tag_settings.json"
            settings_path.write_text("{not json")
            with patch("expenses.data_handler.TAG_SETTINGS_FILE", settings_path):
                settings = load_tag_settings()
            self.assertEqual(settings, {"exclude_from_summary": ["emergency"]})

    def test_load_tag_settings_reads_existing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings_path = Path(tmp) / "tag_settings.json"
            settings_path.write_text(json.dumps({"exclude_from_summary": ["emergency", "oneoff"]}))
            with patch("expenses.data_handler.TAG_SETTINGS_FILE", settings_path):
                settings = load_tag_settings()
            self.assertEqual(settings["exclude_from_summary"], ["emergency", "oneoff"])
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_data_handler.py -v -k tag_settings`
Expected: FAIL — `ImportError: cannot import name 'load_tag_settings'`

- [ ] **Step 4: Implement**

`expenses/config.py` — after `CATEGORY_TYPES_FILE`:

```python
TAG_SETTINGS_FILE: Path = CONFIG_DIR / "tag_settings.json"
```

`expenses/data_handler.py` — add `TAG_SETTINGS_FILE` to the existing `from expenses.config import (...)` import, then add near the other config loaders:

```python
DEFAULT_TAG_SETTINGS = {"exclude_from_summary": ["emergency"]}


def load_tag_settings() -> dict:
    """Load tag settings, creating the file with defaults if missing or corrupt."""
    try:
        with open(TAG_SETTINGS_FILE, "r", encoding="utf-8") as f:
            settings = json.load(f)
        if not isinstance(settings.get("exclude_from_summary"), list):
            raise ValueError("exclude_from_summary must be a list")
        return settings
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as e:
        if TAG_SETTINGS_FILE.exists():
            logging.warning(f"tag_settings.json invalid ({e}); recreating with defaults")
        with open(TAG_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_TAG_SETTINGS, f, indent=2)
        return dict(DEFAULT_TAG_SETTINGS)
```

(`json` and `logging` are already imported in `data_handler.py`; verify.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_data_handler.py -v -k tag_settings`
Expected: 3 PASS.

- [ ] **Step 6: `make all`, verify commit content with `jj st`**

---

### Task 4: tag_transactions() persistence function

**Files:**
- Modify: `expenses/data_handler.py`
- Test: `tests/test_data_handler.py`

**Interfaces:**
- Consumes: `add_tags_to_cell`, `remove_tags_from_cell` (Task 1); `load_transactions_from_parquet`, `save_transactions_to_parquet`, `create_auto_backup` (existing).
- Produces: `tag_transactions(indices: list[int], tags: list[str], mode: str = "add") -> int` — applies tags to the given original DataFrame indices, returns count updated. Used by Task 7's screen actions. Mirrors `update_transactions()`: backup first, load with `include_deleted=True`, mutate, save.

- [ ] **Step 1: Start the change**

```bash
jj st && jj new
jj desc -m "Add tag_transactions persistence function"
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/test_data_handler.py` (import `tag_transactions`):

```python
    @patch("expenses.data_handler.create_auto_backup")
    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_tag_transactions_add_and_remove(
        self, mock_save: MagicMock, mock_load: MagicMock, mock_backup: MagicMock
    ) -> None:
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-03-13", "2026-03-14", "2026-03-15"]),
                "Merchant": ["AerLingus", "Tesco", "Ryanair"],
                "Amount": [298.99, 12.00, 213.56],
                "Deleted": [False, False, False],
                "Type": ["expense", "expense", "expense"],
                "Tags": ["", "emergency", ""],
            }
        )
        mock_load.return_value = existing_df.copy()
        count = tag_transactions([0, 2], ["Trip: Paris Mar26"], mode="add")
        self.assertEqual(count, 2)
        saved_df = mock_save.call_args[0][0]
        self.assertEqual(
            saved_df["Tags"].tolist(),
            ["trip:-paris-mar26", "emergency", "trip:-paris-mar26"],
        )

        mock_load.return_value = saved_df.copy()
        count = tag_transactions([1], ["emergency"], mode="remove")
        self.assertEqual(count, 1)
        saved_df2 = mock_save.call_args[0][0]
        self.assertEqual(saved_df2.loc[1, "Tags"], "")

    @patch("expenses.data_handler.create_auto_backup")
    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_tag_transactions_skips_unknown_index_and_empty_tags(
        self, mock_save: MagicMock, mock_load: MagicMock, mock_backup: MagicMock
    ) -> None:
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-03-13"]),
                "Merchant": ["AerLingus"],
                "Amount": [298.99],
                "Deleted": [False],
                "Type": ["expense"],
                "Tags": [""],
            }
        )
        mock_load.return_value = existing_df.copy()
        self.assertEqual(tag_transactions([99], ["emergency"]), 0)
        self.assertEqual(tag_transactions([0], ["  !!  "]), 0)
        mock_save.assert_not_called()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_data_handler.py -v -k tag_transactions`
Expected: ImportError FAIL.

- [ ] **Step 4: Implement**

In `expenses/data_handler.py` (extend the Task 2 import line):

```python
from expenses.tags import add_tags_to_cell, normalize_tag, remove_tags_from_cell
```

Add after `update_transactions()`:

```python
def tag_transactions(indices: List[int], tags: List[str], mode: str = "add") -> int:
    """Add or remove tags on transactions identified by DataFrame index.

    Args:
        indices: Original DataFrame indices (as shown by load_transactions_from_parquet).
        tags: Tags to apply; normalized via expenses.tags rules.
        mode: "add" or "remove".

    Returns:
        Number of transactions updated (0 if tags normalize to nothing).
    """
    clean_tags = [t for t in (normalize_tag(t) for t in tags) if t]
    if not clean_tags or not indices:
        return 0

    create_auto_backup()
    all_transactions = load_transactions_from_parquet(include_deleted=True)

    apply_fn = add_tags_to_cell if mode == "add" else remove_tags_from_cell
    updated_count = 0
    for original_index in indices:
        if original_index not in all_transactions.index:
            logging.warning(f"Index {original_index} not found for tagging, skipping")
            continue
        current = all_transactions.at[original_index, "Tags"]
        all_transactions.at[original_index, "Tags"] = apply_fn(current, clean_tags)
        updated_count += 1

    if updated_count:
        save_transactions_to_parquet(all_transactions)
        logging.info(f"{mode} tags {clean_tags} on {updated_count} transaction(s)")
    return updated_count
```

(`List` is already imported from `typing` in this file; verify.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_data_handler.py -v -k tag_transactions`
Expected: 2 PASS.

- [ ] **Step 6: `make all`, verify with `jj st`**

---

### Task 5: exclude_tagged_transactions() in analysis.py

**Files:**
- Modify: `expenses/analysis.py`
- Test: `tests/test_analysis.py`

**Interfaces:**
- Consumes: `parse_tags` (Task 1).
- Produces: `exclude_tagged_transactions(df: pd.DataFrame, excluded_tags: list[str]) -> tuple[pd.DataFrame, float]` — returns (rows carrying none of the excluded tags, total `Amount` of the excluded rows where `Type == "expense"`). Missing `Tags` column → df returned unchanged with 0.0. Used by Task 6's Summary screen.

- [ ] **Step 1: Start the change**

```bash
jj st && jj new
jj desc -m "Add tag exclusion helper to analysis module"
```

- [ ] **Step 2: Write the failing test**

Append to `tests/test_analysis.py` (match that file's existing style — check whether it uses `unittest.TestCase` or plain pytest functions and mirror it; the code below assumes a TestCase class exists to extend, otherwise write module-level functions):

```python
def test_exclude_tagged_transactions():
    df = pd.DataFrame(
        {
            "Date": pd.to_datetime(["2026-03-13", "2026-03-14", "2026-03-15", "2026-03-16"]),
            "Merchant": ["AerLingus", "Tesco", "Ryanair", "Refund Inc"],
            "Amount": [298.99, 12.00, 213.56, 50.00],
            "Type": ["expense", "expense", "expense", "income"],
            "Tags": ["emergency", "", "emergency,trip:x", "emergency"],
        }
    )
    filtered, hidden = exclude_tagged_transactions(df, ["emergency"])
    assert filtered["Merchant"].tolist() == ["Tesco"]
    # income row is excluded from view but NOT counted in hidden expense total
    assert hidden == pytest.approx(512.55)


def test_exclude_tagged_transactions_no_tags_column():
    df = pd.DataFrame({"Amount": [1.0], "Type": ["expense"]})
    filtered, hidden = exclude_tagged_transactions(df, ["emergency"])
    assert len(filtered) == 1
    assert hidden == 0.0


def test_exclude_tagged_transactions_empty_exclusion_list():
    df = pd.DataFrame(
        {"Amount": [1.0], "Type": ["expense"], "Tags": ["emergency"]}
    )
    filtered, hidden = exclude_tagged_transactions(df, [])
    assert len(filtered) == 1
    assert hidden == 0.0
```

Add needed imports at the top of the test file: `import pytest`, `import pandas as pd`, and `from expenses.analysis import exclude_tagged_transactions`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_analysis.py -v -k exclude_tagged`
Expected: ImportError FAIL.

- [ ] **Step 4: Implement**

In `expenses/analysis.py`:

```python
from expenses.tags import parse_tags


def exclude_tagged_transactions(
    df: pd.DataFrame, excluded_tags: list[str]
) -> tuple[pd.DataFrame, float]:
    """Split out transactions carrying any excluded tag.

    Returns:
        (df without excluded rows, total expense Amount of the excluded rows)
    """
    if df.empty or not excluded_tags or "Tags" not in df.columns:
        return df, 0.0

    excluded_set = set(excluded_tags)
    mask = df["Tags"].apply(lambda cell: bool(excluded_set & set(parse_tags(cell))))
    excluded_rows = df[mask]
    hidden_total = float(
        excluded_rows.loc[excluded_rows["Type"] == "expense", "Amount"].sum()
    )
    return df[~mask].copy(), hidden_total
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_analysis.py -v`
Expected: new tests PASS, existing tests unaffected.

- [ ] **Step 6: `make all`, verify with `jj st`**

---

### Task 6: Summary screen — exclude by default, `x` toggles

**Files:**
- Modify: `expenses/screens/summary_screen.py`

**Interfaces:**
- Consumes: `exclude_tagged_transactions` (Task 5), `load_tag_settings` (Task 3).
- Produces: UI behaviour only. `self.exclude_tags_active: bool` (default `True`), `self.hidden_tag_total: float`, `action_toggle_tag_exclusion()` bound to `x`.

No unit test for this task (screen wiring); verification is manual, and the logic it calls is covered by Task 5's tests.

- [ ] **Step 1: Start the change**

```bash
jj st && jj new
jj desc -m "Exclude emergency-tagged spend from summary with x toggle"
```

- [ ] **Step 2: Implement**

In `expenses/screens/summary_screen.py`:

a) Imports — extend the existing `from expenses.data_handler import (...)` with `load_tag_settings`, and add:

```python
from expenses.analysis import exclude_tagged_transactions
```

(If `analysis` is already imported under another form, follow the existing import style.)

b) `BINDINGS` — add:

```python
        Binding("x", "toggle_tag_exclusion", "Incl/Excl Tagged"),
```

c) `__init__` — before the `self.load_and_prepare_data()` call add:

```python
        self.exclude_tags_active: bool = True
        self.hidden_tag_total: float = 0.0
        self.excluded_tags: list[str] = load_tag_settings()["exclude_from_summary"]
```

d) `load_and_prepare_data()` — at the **end** of the method (after the Category mapping), add:

```python
        if not self._all_transactions.empty and self.exclude_tags_active:
            self._all_transactions, self.hidden_tag_total = exclude_tagged_transactions(
                self._all_transactions, self.excluded_tags
            )
        else:
            self.hidden_tag_total = 0.0
```

e) Status line — in `compose_content()`, directly after the title `Static`, add:

```python
        yield Static(self._tag_exclusion_status(), id="tag_exclusion_status")
```

and add the two methods:

```python
    def _tag_exclusion_status(self) -> str:
        if not self.excluded_tags:
            return ""
        if self.exclude_tags_active:
            return (
                f"excluding: {', '.join(self.excluded_tags)} "
                f"(€{self.hidden_tag_total:,.0f} hidden) — press x to include"
            )
        return "including all tags — press x to exclude"

    def action_toggle_tag_exclusion(self) -> None:
        """Toggle whether excluded tags (e.g. emergency) are hidden from totals."""
        self.exclude_tags_active = not self.exclude_tags_active
        self.load_and_prepare_data()
        self.query_one("#tag_exclusion_status", Static).update(
            self._tag_exclusion_status()
        )
        self.call_after_refresh(self.update_initial_views)
```

Note: the status `Static` must also be refreshed after the initial data load — call `.update(self._tag_exclusion_status())` at the end of `on_mount` (the hidden total is only known after `load_and_prepare_data()` ran). If `compose_content` doesn't exist in this screen (it may use `compose`), place the `Static` in whichever compose method yields the title.

- [ ] **Step 3: Run the full test suite**

Run: `make all`
Expected: pass — this task changes no tested logic paths, but summary screen tests (if any touch `__init__`) may need the `load_tag_settings` call mocked; if a test constructs `SummaryScreen` without a config dir, patch `expenses.screens.summary_screen.load_tag_settings` to return the default dict.

- [ ] **Step 4: Manual verification (uses your real data — the migration from Task 2 will fire here)**

```bash
python -m expenses.main
```

- Press `s` for Summary → 2026 totals should be lower for the tagged months than before; status line shows `excluding: emergency (€1,234 hidden)`.
- Press `x` → totals grow back, status line flips to `including all tags`.
- Press `x` again → excluded again.
- Quit; run `python -c "import pandas as pd; df = pd.read_parquet('$HOME/.config/expenses_analyzer/transactions.parquet'); print('Emergency' in df.columns, (df['Tags']=='emergency').sum() if 'Tags' in df.columns else 'no Tags')"` — after the first in-app save (any edit) the legacy column disappears; before a save it may still exist on disk, which is fine (migration reapplies on every load).

- [ ] **Step 5: Verify with `jj st`, refine message if needed**

---

### Task 7: Transactions screen — Tags column, filter, g/G tagging

**Files:**
- Create: `expenses/screens/tag_transactions_screen.py`
- Modify: `expenses/screens/transaction_screen.py`

**Interfaces:**
- Consumes: `tag_transactions` (Task 4), `join_tags`/`parse_tags` (Task 1).
- Produces: `TagTransactionsScreen(ModalScreen[Optional[Dict]])` returning `{"tags": list[str], "mode": "add"|"remove"}` or `None`; `action_tag_selected` (`g`), `action_tag_filtered` (`G`) on `TransactionScreen`; `Tags` in `self.columns`; `tags_filter` input wired into the filters dict.

- [ ] **Step 1: Start the change**

```bash
jj st && jj new
jj desc -m "Add tagging UI to transactions screen"
```

- [ ] **Step 2: Create the modal**

Create `expenses/screens/tag_transactions_screen.py` (modeled on `bulk_edit_transaction_screen.py`):

```python
from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static, Input, Label, Select
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
from typing import Dict, List, Optional

from expenses.tags import normalize_tag


class TagTransactionsScreen(ModalScreen[Optional[Dict]]):
    """Modal to add or remove tags on a set of transactions."""

    DEFAULT_CSS = """
    TagTransactionsScreen {
        align: center middle;
    }

    TagTransactionsScreen #dialog {
        width: 60;
        height: auto;
        padding: 1 2;
        background: $surface;
        border: solid $primary;
    }

    TagTransactionsScreen #title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }

    TagTransactionsScreen #count_display {
        text-align: center;
        color: $text-muted;
        margin-bottom: 1;
    }

    TagTransactionsScreen #button_container {
        margin-top: 1;
        align: center middle;
    }
    """

    BINDINGS = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("ctrl+s", "save", "Apply", show=False),
    ]

    def __init__(self, selected_count: int, existing_tags: Optional[List[str]] = None) -> None:
        self.selected_count = selected_count
        self.existing_tags = existing_tags or []
        super().__init__()

    def compose(self) -> ComposeResult:
        hint = ""
        if self.existing_tags:
            hint = f"existing: {', '.join(self.existing_tags)}"
        yield Vertical(
            Static("Tag Transactions", id="title"),
            Static(f"Applying to {self.selected_count} transaction(s)", id="count_display"),
            Label("Tags (comma-separated, e.g. emergency, trip:paris-jun26):"),
            Input(value="", placeholder=hint or "tag1, tag2", id="tags_input"),
            Label("Mode:"),
            Select(
                [("Add tags", "add"), ("Remove tags", "remove")],
                value="add",
                id="mode_select",
            ),
            Horizontal(
                Button("Apply", variant="success", id="apply"),
                Button("Cancel", variant="error", id="cancel"),
                id="button_container",
            ),
            Static("Ctrl+S to apply, Escape to cancel", id="help_text"),
            id="dialog",
        )

    def on_mount(self) -> None:
        self.query_one("#tags_input", Input).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "apply":
            self._apply()
        else:
            self.dismiss(None)

    def action_save(self) -> None:
        self._apply()

    def action_cancel(self) -> None:
        self.dismiss(None)

    def _apply(self) -> None:
        raw = self.query_one("#tags_input", Input).value
        tags = [t for t in (normalize_tag(t) for t in raw.split(",")) if t]
        if not tags:
            self.notify("No valid tags entered.", severity="warning")
            return
        mode = self.query_one("#mode_select", Select).value
        self.dismiss({"tags": tags, "mode": mode})
```

- [ ] **Step 3: Wire up the transaction screen**

In `expenses/screens/transaction_screen.py`:

a) Imports:

```python
from expenses.data_handler import tag_transactions          # extend existing import block
from expenses.screens.tag_transactions_screen import TagTransactionsScreen
from expenses.tags import all_tags_in_series
```

b) `BINDINGS` — add:

```python
        Binding("g", "tag_selected", "Tag Selected"),
        Binding("G", "tag_filtered", "Tag Filtered"),
```

c) `self.columns` in `__init__` — append `"Tags"`:

```python
        self.columns: list[str] = [
            "Date",
            "Merchant",
            "Amount",
            "Type",
            "Source",
            "Category",
            "Tags",
        ]
```

d) Filters — add a `ClearableInput` to the filter `Horizontal` in `compose_content`:

```python
            ClearableInput(placeholder="Filter by Tag...", id="tags_filter"),
```

and add to the `filters` dict where the others are built:

```python
            "tags": (
                "Tags",
                "contains",
                self.query_one("#tags_filter", ClearableInput).value,
            ),
```

Check the input-changed handler: if filter inputs are wired by listening to specific ids, register `tags_filter` the same way the others are (search for `source_filter` handling and mirror it).

e) Actions — add alongside `action_bulk_edit`:

```python
    def action_tag_selected(self) -> None:
        """Tag selected rows (g); falls back to the cursor row if none selected."""
        indices = list(self.selected_rows)
        if not indices:
            table = self.query_one("#transaction_table", DataTable)
            if table.cursor_row is not None and not self.display_df.empty:
                row_key = table.coordinate_to_cell_key(
                    (table.cursor_row, 0)
                ).row_key.value
                indices = [int(row_key)]
        if not indices:
            self.app.show_notification("No transactions selected", timeout=3)
            return
        self._open_tag_modal(indices)

    def action_tag_filtered(self) -> None:
        """Tag all rows matching the current filters (G)."""
        indices = list(self.display_df.index)
        if not indices:
            self.app.show_notification("No transactions match the filters", timeout=3)
            return
        self._open_tag_modal(indices)

    def _open_tag_modal(self, indices: list[int]) -> None:
        existing = (
            all_tags_in_series(self.transactions["Tags"])
            if "Tags" in self.transactions.columns
            else []
        )

        def on_result(result: dict | None) -> None:
            if not result:
                return
            count = tag_transactions(indices, result["tags"], mode=result["mode"])
            self.selected_rows.clear()
            self.load_and_prepare_data()
            self.update_table()
            self.app.show_notification(
                f"{result['mode']}ed {', '.join(result['tags'])} "
                f"on {count} transaction(s)",
                timeout=4,
            )

        self.app.push_screen(TagTransactionsScreen(len(indices), existing), on_result)
```

Adjust the two method names called in `on_result` to whatever this screen actually uses to reload and repaint (search for what `delete_selected_transactions` calls after deleting — reuse exactly those; the names above are the likely ones but the file is under active refactor).

- [ ] **Step 4: Add the Tags filter regression test**

Append to `tests/test_transaction_filter.py` (mirror its existing style; it imports `apply_filters` and pandas already):

```python
def test_contains_filter_on_tags_column():
    df = pd.DataFrame({"Tags": ["emergency", "trip:x", "emergency,trip:y", ""]})
    filtered = apply_filters(df, {"tags": ("Tags", "contains", "trip:")})
    assert filtered["Tags"].tolist() == ["trip:x", "emergency,trip:y"]
```

Run: `PYTHONPATH=. pytest tests/test_transaction_filter.py -v`
Expected: PASS (apply_filters is generic; this pins the Tags use-case).

- [ ] **Step 5: Run the full suite**

Run: `make all`
Expected: pass. If existing transaction-screen tests assert the column list, update them to include `"Tags"`.

- [ ] **Step 6: Manual verification**

```bash
python -m expenses.main
```

- Press `t` → Tags column visible; the emergency-tagged rows show `emergency`.
- Type `emergency` in the Tag filter → exactly those transactions; total matches the tagged rows.
- Select two rows with space, press `g`, enter `trip:test`, Apply → notification, Tags column updates.
- Press `g` again on the same rows, mode Remove, `trip:test` → tag gone.
- Set a date filter Mar 2026 + source `Bank B`, press `G`, add `trip:test-bulk`, then remove it the same way.
- Quit and rerun — tags persist.

**Deferred (spec marks it optional):** the Summary-screen tag selector ("trip cost broken down by category"). The Transactions screen already answers it — filter by `trip:x` and read the per-category merchant summary panel. Build the Summary selector only if that proves insufficient in practice.

- [ ] **Step 7: Verify with `jj st` — should show only the two screen files and the filter test**

---

### Task 8: Documentation and final sweep

**Files:**
- Modify: `README.md` (Features section), `CLAUDE.md` (Data Storage Model section)

**Interfaces:** none.

- [ ] **Step 1: Start the change**

```bash
jj st && jj new
jj desc -m "Document transaction tags feature"
```

- [ ] **Step 2: README.md** — add to the Features list:

```markdown
- **Transaction Tags**: Tag transactions (e.g. `emergency`, `trip:paris-jun26`) from the Transactions screen (`g` = tag selected, `G` = tag all filtered). The Summary screen hides tags listed in `tag_settings.json` (default: `emergency`) from totals; press `x` to toggle.
```

- [ ] **Step 3: CLAUDE.md** — in "Data Storage Model", extend the `transactions.parquet` bullet to mention the `Tags` column and add:

```markdown
- `tag_settings.json`: Tag behaviour settings, currently `{"exclude_from_summary": ["emergency"]}` — tags hidden from Summary totals by default
```

Also note in the same section: `Tags` is a comma-separated lowercase string column; manipulate it only via `expenses/tags.py` helpers.

- [ ] **Step 4: Full verification**

```bash
make all
```

Expected: lint clean, entire suite green.

- [ ] **Step 5: Review the whole stack**

```bash
jj log -n 12
jj st
```

Expected: one change per task stacked on `szwwzpow` (spec) → based on `main`. Do NOT push — leave that to the user.
