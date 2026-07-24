# Payslip-Based Pension Savings Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse monthly payslip PDFs to capture pension contributions and show an enhanced savings rate (bank cashflow + pension) alongside the existing bank-only rate.

**Architecture:** A pure line-parser (`payslip_parser.py`) turns pypdf-extracted text into per-run records; an aggregator/persistence layer (`payslip_handler.py`) scans a user-picked folder, groups by month, sums supplementary runs, reconciles YTD, and upserts `payslips.parquet`; `analysis.py` gains enhanced-rate functions; a new `PayslipsScreen` (scan→preview→confirm) drives it; the Summary screen displays both rates.

**Tech Stack:** Python 3.12+, Pandas, PyArrow/Parquet, Textual, `pypdf` (new), pytest.

## Global Constraints

- **Privacy:** Never write the maintainer's employer/company name or any personal absolute path into code, config defaults, docs, or fixtures. Locations are user-configured at runtime with env override. (See `CLAUDE.md` → Privacy Conventions.)
- **Fixtures:** Test fixtures must be synthetic. Never commit real payslip PDFs. Core parsing logic is tested against plain text/strings, not PDF files.
- **Format:** Parsing targets one Irish PAYE payslip layout. Unrecognized layouts must be skipped and flagged, never guessed (parser returns `None`).
- **VCS:** This repo uses **jj**, not git. Commit steps use `jj` (working copy is always a commit; `jj desc -m` sets the message, changes auto-snapshot). Run `jj new` before starting each task's change.
- **Style:** flake8 max line length 110, max complexity 10; format with `black` (`make format`). Run tests with `PYTHONPATH=. pytest` (or `make test`).
- **Notifications:** `self.app.show_notification(message: str, timeout: int = 3)` — no `severity` argument.

---

### Task 1: Add `pypdf` dependency and config paths

**Files:**
- Modify: `pyproject.toml` (dependencies list)
- Modify: `expenses/config.py`
- Test: `tests/test_config_payslips.py` (create)

**Interfaces:**
- Produces: `expenses.config.PAYSLIPS_FILE: Path`, `expenses.config.PAYSLIP_SETTINGS_FILE: Path`, `expenses.config.PAYSLIP_DIR: Optional[str]`, `expenses.config.PAYSLIP_PDF_PASSWORD: Optional[str]`

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_payslips.py`:

```python
import importlib


def test_payslip_config_paths(monkeypatch, tmp_path):
    monkeypatch.setenv("EXPENSES_ANALYZER_CONFIG_DIR", str(tmp_path))
    import expenses.config as config
    importlib.reload(config)

    assert config.PAYSLIPS_FILE == tmp_path / "payslips.parquet"
    assert config.PAYSLIP_SETTINGS_FILE == tmp_path / "payslip_settings.json"


def test_payslip_env_overrides(monkeypatch, tmp_path):
    monkeypatch.setenv("EXPENSES_ANALYZER_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("PAYSLIP_DIR", "/some/runtime/path")
    monkeypatch.setenv("PAYSLIP_PDF_PASSWORD", "secret")
    import expenses.config as config
    importlib.reload(config)

    assert config.PAYSLIP_DIR == "/some/runtime/path"
    assert config.PAYSLIP_PDF_PASSWORD == "secret"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_config_payslips.py -v`
Expected: FAIL with `AttributeError: module 'expenses.config' has no attribute 'PAYSLIPS_FILE'`

- [ ] **Step 3: Add config entries**

In `expenses/config.py`, after the `EXPORTS_DIR` line, add:

```python
# Payslip / pension tracking
PAYSLIPS_FILE: Path = CONFIG_DIR / "payslips.parquet"
PAYSLIP_SETTINGS_FILE: Path = CONFIG_DIR / "payslip_settings.json"

# Optional runtime overrides (never hardcode a personal folder path)
PAYSLIP_DIR = os.getenv("PAYSLIP_DIR")  # folder containing payslip PDFs
PAYSLIP_PDF_PASSWORD = os.getenv("PAYSLIP_PDF_PASSWORD")  # optional PDF password
```

- [ ] **Step 4: Add the dependency**

In `pyproject.toml`, add `"pypdf>=4.0"` to the `dependencies` list, then install into the venv:

Run: `uv pip install --python .venv/bin/python "pypdf>=4.0"`
Expected: pypdf installed (or "already satisfied").

- [ ] **Step 5: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_config_payslips.py -v`
Expected: PASS (both tests)

- [ ] **Step 6: Commit**

```bash
jj new -m "Add payslip config paths and pypdf dependency"
# (edits auto-snapshot into the working-copy commit)
jj st
```

---

### Task 2: Pure line parser — earnings and deductions

**Files:**
- Create: `expenses/payslip_parser.py`
- Test: `tests/test_payslip_parser.py` (create)

**Interfaces:**
- Produces:
  - `@dataclass PayslipRun` with fields: `month: str`, `source_file: str`, `salary: float`, `bonus: float`, `oncall: float`, `reimbursements: float`, `pension_ee: float`, `avc: float`, `pension_er: float`, `paye: float`, `prsi_ee: float`, `usc: float`, `pension_ee_ytd: float`, `avc_ytd: float`, `pension_er_ytd: float`, and computed properties `gross`, `tax_total`, `deds_from_gross`, `net`.
  - `parse_lines(lines: list[str], month: str, source_file: str) -> Optional[PayslipRun]` — pure; returns `None` if the Irish-format signature (a `Pension` line with ≥4 numbers plus a `Salary` line) is absent.
  - `extract_amounts(text: str) -> list[float]` — helper.

- [ ] **Step 1: Write the failing test**

Create `tests/test_payslip_parser.py`:

```python
from expenses.payslip_parser import parse_lines, extract_amounts, PayslipRun

# Synthetic lines mirroring the verified Irish payslip layout (no real data).
JULY_LINES = [
    "Salary 13458.33",
    "Device Reimbursement 40.00",
    "Bonus 2614.00",
    "On-Call 396.00",
    "Notional Pay/Bik",
    "BIK Medical 384.44",
    "BIK Dental 56.25",
    "USC on 112658.19 1025.14 6697.18 0.00 0.00",
    "AVC 269.17 1884.18 0.00 0.00",
    "Pension 1076.67 7536.68 1076.67 7536.68",
    "PAYE 5163.77 33752.41",
    "PRSI 711.85 4731.59 1906.76 12674.01",
    "Pension monies from previous period(s) have been remitted",
]


def test_extract_amounts_parses_two_decimal_numbers():
    assert extract_amounts("Pension 1076.67 7536.68 1076.67 7536.68") == [
        1076.67, 7536.68, 1076.67, 7536.68
    ]
    assert extract_amounts("PRSI Code") == []


def test_parse_lines_extracts_core_fields():
    run = parse_lines(JULY_LINES, month="2026-07", source_file="2026-07.pdf")
    assert run is not None
    assert run.salary == 13458.33
    assert run.bonus == 2614.00
    assert run.oncall == 396.00
    assert run.reimbursements == 40.00
    assert run.pension_ee == 1076.67
    assert run.avc == 269.17
    assert run.pension_er == 1076.67
    assert run.paye == 5163.77
    assert run.prsi_ee == 711.85
    assert run.usc == 1025.14
    assert run.pension_ee_ytd == 7536.68
    assert run.avc_ytd == 1884.18
    assert run.pension_er_ytd == 7536.68


def test_parse_lines_derives_gross_and_net():
    run = parse_lines(JULY_LINES, month="2026-07", source_file="2026-07.pdf")
    # Gross = cash earnings, excludes notional BIK
    assert run.gross == 16508.33
    assert run.tax_total == 6900.76           # PAYE + PRSI_ee + USC
    assert run.deds_from_gross == 1345.84      # PensionEE + AVC
    assert round(run.net, 2) == 8261.73        # Gross - deds - tax


def test_parse_lines_returns_none_for_unrecognized_format():
    assert parse_lines(["Total Pay 1000.00", "Deductions 200.00"],
                       month="2026-07", source_file="x.pdf") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_payslip_parser.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'expenses.payslip_parser'`

- [ ] **Step 3: Write the parser**

Create `expenses/payslip_parser.py`:

```python
"""Pure parsing of Irish PAYE payslip text into structured records.

PDF I/O lives in extract functions further down; the ``parse_lines`` logic is
kept pure (operates on text) so it is unit-testable without PDF fixtures.
"""
import logging
import re
from dataclasses import dataclass
from typing import List, Optional

logger = logging.getLogger(__name__)

_AMOUNT = re.compile(r"-?\d[\d,]*\.\d{2}")


def extract_amounts(text: str) -> List[float]:
    """Return all 2-decimal numbers in ``text`` (commas stripped)."""
    return [float(m.replace(",", "")) for m in _AMOUNT.findall(text)]


@dataclass
class PayslipRun:
    """One payroll run (one PDF). Gross/net are derived, not parsed."""

    month: str
    source_file: str
    salary: float = 0.0
    bonus: float = 0.0
    oncall: float = 0.0
    reimbursements: float = 0.0
    pension_ee: float = 0.0
    avc: float = 0.0
    pension_er: float = 0.0
    paye: float = 0.0
    prsi_ee: float = 0.0
    usc: float = 0.0
    pension_ee_ytd: float = 0.0
    avc_ytd: float = 0.0
    pension_er_ytd: float = 0.0

    @property
    def gross(self) -> float:
        """Cash earnings (excludes notional BIK)."""
        return round(self.salary + self.bonus + self.oncall + self.reimbursements, 2)

    @property
    def tax_total(self) -> float:
        return round(self.paye + self.prsi_ee + self.usc, 2)

    @property
    def deds_from_gross(self) -> float:
        return round(self.pension_ee + self.avc, 2)

    @property
    def net(self) -> float:
        return round(self.gross - self.deds_from_gross - self.tax_total, 2)


def parse_lines(lines: List[str], month: str, source_file: str) -> Optional[PayslipRun]:
    """Parse stripped payslip text lines into a PayslipRun.

    Returns None if the Irish-format signature is absent (a Salary line and a
    Pension line carrying >= 4 amounts). This is the "fail loudly" guard: an
    unrecognized layout is never guessed at.
    """
    run = PayslipRun(month=month, source_file=source_file)
    saw_salary = False
    saw_pension = False

    for raw in lines:
        line = raw.strip()
        nums = extract_amounts(line)

        if line.startswith("Salary") and nums:
            run.salary = nums[0]
            saw_salary = True
        elif line.startswith("Bonus") and nums:
            run.bonus = nums[0]
        elif line.startswith("On-Call") and nums:
            run.oncall = nums[0]
        elif line.startswith("Device Reimbursement") and nums:
            run.reimbursements += nums[0]
        elif line.startswith("AVC") and len(nums) >= 2:
            run.avc, run.avc_ytd = nums[0], nums[1]
        elif line.startswith("Pension") and len(nums) >= 4:
            run.pension_ee, run.pension_ee_ytd = nums[0], nums[1]
            run.pension_er, run.pension_er_ytd = nums[2], nums[3]
            saw_pension = True
        elif line.startswith("PAYE") and nums:
            run.paye = nums[0]
        elif line.startswith("PRSI") and nums:
            run.prsi_ee = nums[0]
        elif line.startswith("USC") and len(nums) >= 2:
            # "USC on <base> <period> <ytd> ..." -> period is the 2nd number
            run.usc = nums[1]

    if not (saw_salary and saw_pension):
        logger.warning("Unrecognized payslip format for %s; skipping", source_file)
        return None
    return run
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_payslip_parser.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
jj new -m "Add pure payslip line parser"
jj st
```

---

### Task 3: PDF extraction, password resolution, and `parse_payslip`

**Files:**
- Modify: `expenses/payslip_parser.py`
- Test: `tests/test_payslip_parser.py` (add tests)

**Interfaces:**
- Consumes: `PayslipRun`, `parse_lines` (Task 2)
- Produces:
  - `extract_text_lines(pdf_path: str, password: Optional[str]) -> list[str]` — pypdf I/O; raises `PayslipDecryptError` if encrypted and password missing/wrong.
  - `resolve_password(folder: str, explicit: Optional[str]) -> Optional[str]` — order: explicit → `pin.txt` in folder → `PAYSLIP_PDF_PASSWORD` env.
  - `month_from_filename(name: str) -> Optional[str]` — extracts `YYYY-MM` prefix.
  - `parse_payslip(pdf_path: str, password: Optional[str] = None) -> Optional[PayslipRun]` — orchestrates; returns `None` on unrecognized format.
  - `class PayslipDecryptError(Exception)`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_payslip_parser.py`:

```python
import os
from unittest.mock import patch

from expenses.payslip_parser import (
    month_from_filename,
    resolve_password,
    parse_payslip,
)


def test_month_from_filename():
    assert month_from_filename("2026-07.pdf") == "2026-07"
    assert month_from_filename("2026-01-oncall.pdf") == "2026-01"
    assert month_from_filename("notes.pdf") is None


def test_resolve_password_prefers_explicit(tmp_path):
    (tmp_path / "pin.txt").write_text("1234")
    assert resolve_password(str(tmp_path), explicit="9999") == "9999"


def test_resolve_password_reads_pin_file(tmp_path, monkeypatch):
    monkeypatch.delenv("PAYSLIP_PDF_PASSWORD", raising=False)
    (tmp_path / "pin.txt").write_text("1234\n")
    assert resolve_password(str(tmp_path), explicit=None) == "1234"


def test_resolve_password_falls_back_to_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PAYSLIP_PDF_PASSWORD", "envpw")
    assert resolve_password(str(tmp_path), explicit=None) == "envpw"


def test_parse_payslip_uses_extracted_lines():
    from tests.test_payslip_parser import JULY_LINES
    with patch("expenses.payslip_parser.extract_text_lines", return_value=JULY_LINES):
        run = parse_payslip("/fake/2026-07.pdf")
    assert run is not None
    assert run.month == "2026-07"
    assert run.pension_ee == 1076.67
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_payslip_parser.py -k "month_from or resolve_password or parse_payslip" -v`
Expected: FAIL with `ImportError: cannot import name 'month_from_filename'`

- [ ] **Step 3: Add the PDF I/O + orchestration**

First add `import os` to the imports block at the **top** of `expenses/payslip_parser.py`
(keeping all imports at module top to satisfy flake8 E402). Then append the following below
the existing code:

```python
_MONTH_RE = re.compile(r"(\d{4}-\d{2})")


class PayslipDecryptError(Exception):
    """Raised when an encrypted payslip cannot be opened with the given password."""


def month_from_filename(name: str) -> Optional[str]:
    """Extract a YYYY-MM prefix from a payslip filename, or None."""
    base = os.path.basename(name)
    m = _MONTH_RE.match(base)
    return m.group(1) if m else None


def resolve_password(folder: str, explicit: Optional[str]) -> Optional[str]:
    """Resolve a PDF password: explicit arg -> pin.txt in folder -> env var."""
    if explicit:
        return explicit
    pin_file = os.path.join(folder, "pin.txt")
    if os.path.isfile(pin_file):
        with open(pin_file, "r", encoding="utf-8") as fh:
            pin = fh.read().strip()
        if pin:
            return pin
    return os.getenv("PAYSLIP_PDF_PASSWORD")


def extract_text_lines(pdf_path: str, password: Optional[str]) -> List[str]:
    """Extract text lines from a (possibly encrypted) PDF using pypdf."""
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    if reader.is_encrypted:
        if not password:
            raise PayslipDecryptError(f"{pdf_path} is encrypted but no password was provided")
        if reader.decrypt(password) == 0:
            raise PayslipDecryptError(f"Wrong password for {pdf_path}")
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def parse_payslip(pdf_path: str, password: Optional[str] = None) -> Optional[PayslipRun]:
    """Parse a single payslip PDF into a PayslipRun, or None if unrecognized."""
    month = month_from_filename(pdf_path)
    if month is None:
        logger.warning("Cannot derive month from %s; skipping", pdf_path)
        return None
    lines = extract_text_lines(pdf_path, password)
    return parse_lines(lines, month=month, source_file=os.path.basename(pdf_path))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_payslip_parser.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
jj new -m "Add payslip PDF extraction and password resolution"
jj st
```

---

### Task 4: Aggregation — group, ignore-list, sum, YTD reconciliation

**Files:**
- Create: `expenses/payslip_handler.py`
- Test: `tests/test_payslip_handler.py` (create)

**Interfaces:**
- Consumes: `PayslipRun` (Task 2)
- Produces:
  - `DEFAULT_IGNORE = ["fuckedup", "wrong", "old", "draft"]`
  - `is_ignored(filename: str, ignore_list: list[str]) -> bool`
  - `aggregate_runs(runs: list[PayslipRun]) -> pd.DataFrame` — one row per month with columns `Month, Gross, Net, TaxTotal, PensionEE, AVC, PensionER, Bonus, OnCall, SourceFiles, YTDReconciled`. Sums this-period values across same-month runs; sets `YTDReconciled` per the YTD cross-check.

- [ ] **Step 1: Write the failing test**

Create `tests/test_payslip_handler.py`:

```python
from expenses.payslip_parser import PayslipRun
from expenses.payslip_handler import is_ignored, aggregate_runs, DEFAULT_IGNORE


def _run(month, source, **kw):
    return PayslipRun(month=month, source_file=source, **kw)


def test_is_ignored_matches_default_tokens():
    assert is_ignored("2025-12-fuckedup.pdf", DEFAULT_IGNORE) is True
    assert is_ignored("2025-12-correct.pdf", DEFAULT_IGNORE) is False


def test_aggregate_sums_supplementary_runs():
    runs = [
        _run("2026-01", "2026-01.pdf", salary=13000.0, oncall=681.25,
             pension_ee=1040.0, pension_ee_ytd=1040.0,
             pension_er=1040.0, pension_er_ytd=1040.0,
             avc=260.0, avc_ytd=260.0, paye=4075.06, prsi_ee=595.61, usc=803.73),
        _run("2026-01", "2026-01-oncall.pdf", oncall=468.75,
             pension_ee=0.0, pension_ee_ytd=1040.0,
             pension_er=0.0, pension_er_ytd=1040.0,
             avc=0.0, avc_ytd=260.0, paye=187.50, prsi_ee=19.69, usc=37.50),
    ]
    df = aggregate_runs(runs)
    assert list(df["Month"]) == ["2026-01"]
    row = df.iloc[0]
    assert row["OnCall"] == 681.25 + 468.75
    assert row["PensionEE"] == 1040.0          # 1040 + 0
    assert row["PensionER"] == 1040.0
    assert row["AVC"] == 260.0
    assert set(row["SourceFiles"].split(", ")) == {"2026-01.pdf", "2026-01-oncall.pdf"}
    assert bool(row["YTDReconciled"]) is True   # summed period (1040) == YTD (1040) in month 1


def test_aggregate_flags_ytd_mismatch():
    # First month of tax year: summed period pension should equal YTD. Break it.
    runs = [
        _run("2026-01", "a.pdf", salary=1000.0, pension_ee=500.0, pension_ee_ytd=999.0,
             pension_er=0.0, pension_er_ytd=0.0, avc=0.0, avc_ytd=0.0),
    ]
    df = aggregate_runs(runs)
    assert bool(df.iloc[0]["YTDReconciled"]) is False


def test_aggregate_reconciles_across_months():
    runs = [
        _run("2026-01", "jan.pdf", salary=1000.0, pension_ee=100.0, pension_ee_ytd=100.0,
             pension_er=100.0, pension_er_ytd=100.0, avc=0.0, avc_ytd=0.0),
        _run("2026-02", "feb.pdf", salary=1000.0, pension_ee=100.0, pension_ee_ytd=200.0,
             pension_er=100.0, pension_er_ytd=200.0, avc=0.0, avc_ytd=0.0),
    ]
    df = aggregate_runs(runs).set_index("Month")
    assert bool(df.loc["2026-01", "YTDReconciled"]) is True
    assert bool(df.loc["2026-02", "YTDReconciled"]) is True  # 200 - 100 == 100 period
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_payslip_handler.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'expenses.payslip_handler'`

- [ ] **Step 3: Write the aggregator**

Create `expenses/payslip_handler.py`:

```python
"""Scan, aggregate, and persist payslip data."""
import logging
from typing import Dict, List

import pandas as pd

from expenses.payslip_parser import PayslipRun

logger = logging.getLogger(__name__)

DEFAULT_IGNORE = ["fuckedup", "wrong", "old", "draft"]

PAYSLIP_COLUMNS = [
    "Month", "Gross", "Net", "TaxTotal", "PensionEE", "AVC", "PensionER",
    "Bonus", "OnCall", "SourceFiles", "YTDReconciled",
]


def is_ignored(filename: str, ignore_list: List[str]) -> bool:
    """True if the filename contains any ignore-list token (case-insensitive)."""
    low = filename.lower()
    return any(token.lower() in low for token in ignore_list)


def aggregate_runs(runs: List[PayslipRun]) -> pd.DataFrame:
    """Aggregate per-run records into one row per month.

    Same-month runs have their this-period values summed. YTDReconciled checks,
    for every month, that the summed period pension (employee + AVC) equals the
    month's ending YTD minus the previous month's ending YTD within the same
    calendar (Irish tax) year; January's prior is 0.
    """
    if not runs:
        return pd.DataFrame(columns=PAYSLIP_COLUMNS)

    by_month: Dict[str, List[PayslipRun]] = {}
    for run in runs:
        by_month.setdefault(run.month, []).append(run)

    # First pass: per-month sums, period pension, and ending YTD.
    period_pension: Dict[str, float] = {}
    ending_ytd: Dict[str, float] = {}
    partial: Dict[str, dict] = {}
    for month in sorted(by_month):
        group = by_month[month]
        pension_ee = round(sum(r.pension_ee for r in group), 2)
        avc = round(sum(r.avc for r in group), 2)
        period_pension[month] = round(pension_ee + avc, 2)
        ending_ytd[month] = round(max(r.pension_ee_ytd + r.avc_ytd for r in group), 2)
        partial[month] = {
            "Month": month,
            "Gross": round(sum(r.gross for r in group), 2),
            "Net": round(sum(r.net for r in group), 2),
            "TaxTotal": round(sum(r.tax_total for r in group), 2),
            "PensionEE": pension_ee,
            "AVC": avc,
            "PensionER": round(sum(r.pension_er for r in group), 2),
            "Bonus": round(sum(r.bonus for r in group), 2),
            "OnCall": round(sum(r.oncall for r in group), 2),
            "SourceFiles": ", ".join(r.source_file for r in group),
        }

    # Second pass: YTD reconciliation against the previous month in the same year.
    months = sorted(partial)
    rows = []
    for i, month in enumerate(months):
        year = month[:4]
        prev_ytd = 0.0
        if i > 0 and months[i - 1][:4] == year:
            prev_ytd = ending_ytd[months[i - 1]]
        expected = round(ending_ytd[month] - prev_ytd, 2)
        row = partial[month]
        row["YTDReconciled"] = abs(period_pension[month] - expected) < 0.01
        rows.append(row)

    return pd.DataFrame(rows, columns=PAYSLIP_COLUMNS)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_payslip_handler.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
jj new -m "Add payslip aggregation with YTD reconciliation"
jj st
```

---

### Task 5: Handler — settings, folder scan, and parquet persistence

**Files:**
- Modify: `expenses/payslip_handler.py`
- Test: `tests/test_payslip_handler.py` (add tests)

**Interfaces:**
- Consumes: `aggregate_runs`, `is_ignored` (Task 4); `expenses.config` (Task 1); `parse_payslip`, `resolve_password` (Task 3)
- Produces:
  - `load_payslip_settings() -> dict` / `save_payslip_settings(settings: dict) -> None`
  - `get_payslip_folder() -> Optional[str]` — env `PAYSLIP_DIR` overrides saved setting.
  - `set_payslip_folder(path: str) -> None`
  - `scan_folder(folder: str, password: Optional[str] = None, ignore_list=DEFAULT_IGNORE) -> tuple[pd.DataFrame, list[str]]` — returns `(aggregated_df, skipped_files)`.
  - `load_payslips() -> pd.DataFrame` / `save_payslips(df) -> None`
  - `upsert_payslips(new_df: pd.DataFrame) -> pd.DataFrame` — replace rows by `Month`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_payslip_handler.py`:

```python
import json
import pandas as pd
import expenses.config as config
from expenses.payslip_handler import (
    load_payslip_settings, save_payslip_settings, get_payslip_folder,
    load_payslips, save_payslips, upsert_payslips, PAYSLIP_COLUMNS,
)


def test_settings_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    save_payslip_settings({"folder": "/x"})
    assert load_payslip_settings() == {"folder": "/x"}


def test_env_overrides_saved_folder(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    save_payslip_settings({"folder": "/saved"})
    monkeypatch.setattr(config, "PAYSLIP_DIR", "/env")
    assert get_payslip_folder() == "/env"


def test_upsert_replaces_month(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIPS_FILE", tmp_path / "p.parquet")
    base = pd.DataFrame([
        {c: v for c, v in zip(PAYSLIP_COLUMNS,
         ["2026-01", 100.0, 80.0, 10.0, 5.0, 0.0, 5.0, 0.0, 0.0, "a.pdf", True])},
    ])
    save_payslips(base)
    newer = pd.DataFrame([
        {c: v for c, v in zip(PAYSLIP_COLUMNS,
         ["2026-01", 200.0, 160.0, 20.0, 10.0, 0.0, 10.0, 0.0, 0.0, "b.pdf", True])},
    ])
    result = upsert_payslips(newer)
    assert len(result) == 1
    assert result.iloc[0]["Gross"] == 200.0
    assert load_payslips().iloc[0]["Gross"] == 200.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_payslip_handler.py -k "settings or env_overrides or upsert" -v`
Expected: FAIL with `ImportError: cannot import name 'load_payslip_settings'`

- [ ] **Step 3: Add settings, scan, and persistence**

First extend the **top-of-file** imports in `expenses/payslip_handler.py` so all imports stay
at module top (flake8 E402). The import block should become:

```python
import json
import logging
import os
from typing import Dict, List, Optional, Tuple

import pandas as pd

from expenses import config
from expenses.payslip_parser import PayslipRun, parse_payslip, resolve_password
```

Then append the following functions below the existing code:

```python
def load_payslip_settings() -> dict:
    path = config.PAYSLIP_SETTINGS_FILE
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Could not read payslip settings: %s", exc)
        return {}


def save_payslip_settings(settings: dict) -> None:
    with open(config.PAYSLIP_SETTINGS_FILE, "w", encoding="utf-8") as fh:
        json.dump(settings, fh, indent=2)


def get_payslip_folder() -> Optional[str]:
    """Env override wins, then the saved setting."""
    if config.PAYSLIP_DIR:
        return config.PAYSLIP_DIR
    return load_payslip_settings().get("folder")


def set_payslip_folder(path: str) -> None:
    settings = load_payslip_settings()
    settings["folder"] = path
    save_payslip_settings(settings)


def scan_folder(
    folder: str,
    password: Optional[str] = None,
    ignore_list=DEFAULT_IGNORE,
) -> Tuple[pd.DataFrame, list]:
    """Parse all payslip PDFs in ``folder`` and aggregate by month.

    Returns (aggregated_df, skipped_files). Files that are ignored, unparseable,
    or unrecognized are collected in skipped_files rather than raising.
    """
    pw = resolve_password(folder, password)
    runs = []
    skipped = []
    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith(".pdf"):
            continue
        if is_ignored(name, ignore_list):
            skipped.append(name)
            continue
        path = os.path.join(folder, name)
        try:
            run = parse_payslip(path, pw)
        except Exception as exc:  # decrypt/parse failures must not abort the scan
            logger.warning("Failed to parse %s: %s", name, exc)
            skipped.append(name)
            continue
        if run is None:
            skipped.append(name)
        else:
            runs.append(run)
    return aggregate_runs(runs), skipped


def load_payslips() -> pd.DataFrame:
    if not os.path.isfile(config.PAYSLIPS_FILE):
        return pd.DataFrame(columns=PAYSLIP_COLUMNS)
    return pd.read_parquet(config.PAYSLIPS_FILE)


def save_payslips(df: pd.DataFrame) -> None:
    df.to_parquet(config.PAYSLIPS_FILE, index=False)


def upsert_payslips(new_df: pd.DataFrame) -> pd.DataFrame:
    """Replace existing rows with matching Month, keep the rest, and persist."""
    existing = load_payslips()
    if not existing.empty:
        existing = existing[~existing["Month"].isin(new_df["Month"])]
    combined = pd.concat([existing, new_df], ignore_index=True)
    combined = combined.sort_values("Month").reset_index(drop=True)
    save_payslips(combined)
    return combined
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_payslip_handler.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
jj new -m "Add payslip settings, folder scan, and parquet persistence"
jj st
```

---

### Task 6: Enhanced savings-rate analysis

**Files:**
- Modify: `expenses/analysis.py`
- Test: `tests/test_analysis.py` (add tests)

**Interfaces:**
- Consumes: `get_cash_flow_totals` (existing, returns `{"total_income","total_expenses","net","savings_rate"}`); payslip DataFrame with `PAYSLIP_COLUMNS`.
- Produces:
  - `get_enhanced_savings_totals(bank_totals: dict, payslips: pd.DataFrame, year: int, month: Optional[int] = None) -> Optional[dict]` — returns `{"pension_saved","enhanced_saved","rate_totalcomp","rate_posttax","reconciled"}` or `None` if no payslip rows match the period.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_analysis.py`:

```python
import pandas as pd
from expenses.analysis import get_enhanced_savings_totals


def _payslips():
    return pd.DataFrame([
        {"Month": "2026-01", "Gross": 13681.25, "Net": 8200.0, "TaxTotal": 5000.0,
         "PensionEE": 1040.0, "AVC": 260.0, "PensionER": 1040.0,
         "Bonus": 0.0, "OnCall": 681.25, "SourceFiles": "a.pdf", "YTDReconciled": True},
        {"Month": "2026-02", "Gross": 14000.0, "Net": 8400.0, "TaxTotal": 5100.0,
         "PensionEE": 1040.0, "AVC": 260.0, "PensionER": 1040.0,
         "Bonus": 0.0, "OnCall": 0.0, "SourceFiles": "b.pdf", "YTDReconciled": True},
    ])


def test_enhanced_savings_single_month():
    bank = {"total_income": 8200.0, "total_expenses": 6200.0, "net": 2000.0,
            "savings_rate": 24.39}
    result = get_enhanced_savings_totals(bank, _payslips(), year=2026, month=1)
    assert result is not None
    assert result["pension_saved"] == 1040.0 + 260.0 + 1040.0        # 2340
    assert result["enhanced_saved"] == 2000.0 + 2340.0               # 4340
    # total-comp basis: 4340 / (Gross 13681.25 + PensionER 1040) = 29.48%
    assert round(result["rate_totalcomp"], 2) == 29.48
    # post-tax basis: 4340 / (Net 8200 + 2340) = 41.18%
    assert round(result["rate_posttax"], 2) == 41.18
    assert result["reconciled"] is True


def test_enhanced_savings_year_sums_months():
    bank = {"total_income": 16600.0, "total_expenses": 12000.0, "net": 4600.0,
            "savings_rate": 27.71}
    result = get_enhanced_savings_totals(bank, _payslips(), year=2026)
    assert result["pension_saved"] == 2 * 2340.0

def test_enhanced_savings_none_when_no_payslip():
    bank = {"total_income": 100.0, "total_expenses": 50.0, "net": 50.0,
            "savings_rate": 50.0}
    assert get_enhanced_savings_totals(bank, _payslips(), year=2099, month=5) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_analysis.py -k enhanced -v`
Expected: FAIL with `ImportError: cannot import name 'get_enhanced_savings_totals'`

- [ ] **Step 3: Add the analysis function**

First update the existing top import `from typing import List, Tuple` in `expenses/analysis.py`
to `from typing import List, Optional, Tuple` (keep imports at module top — flake8 E402). Then
append the function below the existing code:

```python
def get_enhanced_savings_totals(
    bank_totals: dict,
    payslips: pd.DataFrame,
    year: int,
    month: Optional[int] = None,
) -> Optional[dict]:
    """Combine bank net cashflow with pension contributions from payslips.

    Args:
        bank_totals: output of get_cash_flow_totals for the same period.
        payslips: DataFrame with PAYSLIP_COLUMNS.
        year: calendar year to match.
        month: optional 1-12; None means the whole year.

    Returns dict with pension_saved, enhanced_saved, rate_totalcomp,
    rate_posttax, reconciled. None if no payslip rows match the period.
    """
    if payslips is None or payslips.empty:
        return None

    prefix = f"{year:04d}-"
    matched = payslips[payslips["Month"].astype(str).str.startswith(prefix)]
    if month is not None:
        key = f"{year:04d}-{month:02d}"
        matched = payslips[payslips["Month"].astype(str) == key]
    if matched.empty:
        return None

    pension_ee = float(matched["PensionEE"].sum())
    avc = float(matched["AVC"].sum())
    pension_er = float(matched["PensionER"].sum())
    gross = float(matched["Gross"].sum())
    net = float(matched["Net"].sum())

    pension_saved = round(pension_ee + avc + pension_er, 2)
    enhanced_saved = round(bank_totals["net"] + pension_saved, 2)

    denom_totalcomp = gross + pension_er
    denom_posttax = net + pension_ee + avc + pension_er

    rate_totalcomp = (enhanced_saved / denom_totalcomp * 100) if denom_totalcomp > 0 else 0.0
    rate_posttax = (enhanced_saved / denom_posttax * 100) if denom_posttax > 0 else 0.0

    return {
        "pension_saved": pension_saved,
        "enhanced_saved": enhanced_saved,
        "rate_totalcomp": rate_totalcomp,
        "rate_posttax": rate_posttax,
        "reconciled": bool(matched["YTDReconciled"].all()),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_analysis.py -k enhanced -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
jj new -m "Add enhanced savings rate combining bank and pension data"
jj st
```

---

### Task 7: Summary screen display

**Files:**
- Modify: `expenses/screens/summary_screen.py` (imports near line 34; `update_cash_flow` at lines 878-910)
- Test: manual (Textual UI); logic covered by Task 6.

**Interfaces:**
- Consumes: `get_enhanced_savings_totals` (Task 6), `load_payslips` (Task 5)

- [ ] **Step 1: Add imports**

Near the existing `get_cash_flow_totals` import (line ~34) in `summary_screen.py`, add:

```python
from expenses.analysis import get_enhanced_savings_totals
from expenses.payslip_handler import load_payslips
```

- [ ] **Step 2: Append the enhanced line in `update_cash_flow`**

In `update_cash_flow`, after `line1` is built and before the widget update block (around line 899), add:

```python
            enhanced_line = ""
            try:
                enhanced = get_enhanced_savings_totals(
                    totals, load_payslips(), year, month
                )
            except Exception as exc:
                logging.warning("Enhanced savings unavailable: %s", exc)
                enhanced = None
            if enhanced:
                flag = "" if enhanced["reconciled"] else "  [yellow]⚠ YTD[/yellow]"
                enhanced_line = (
                    f"[bold]With pension:[/bold] "
                    f"saved [green]{enhanced['enhanced_saved']:,.2f}[/green]  |  "
                    f"[bold]Rate (total comp):[/bold] {enhanced['rate_totalcomp']:.1f}%  |  "
                    f"[bold]Rate (post-tax):[/bold] {enhanced['rate_posttax']:.1f}%{flag}"
                )
```

- [ ] **Step 3: Include the enhanced line in the widget output**

Replace the widget-update block (currently lines ~904-908) with:

```python
            cash_flow_widget = self.query_one(f"#{widget_id}", Static)
            parts = [line1]
            if line2:
                parts.append(line2)
            if enhanced_line:
                parts.append(enhanced_line)
            cash_flow_widget.update("\n".join(parts))
```

- [ ] **Step 4: Verify the app runs and displays both rates**

Run: `PYTHONPATH=. python -m expenses.main`
Expected: Summary screen loads; for years/months with payslip data a "With pension" line appears beneath the existing savings rate. (Ctrl+Q to quit.)

- [ ] **Step 5: Run full test suite (no regressions)**

Run: `make test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
jj new -m "Show enhanced pension-aware savings rate on summary screen"
jj st
```

---

### Task 8: Payslips screen and app registration

**Files:**
- Create: `expenses/screens/payslips_screen.py`
- Modify: `expenses/app.py` (SCREENS dict lines 55-65; BINDINGS lines 67-77; imports)
- Test: manual (Textual UI); underlying logic covered by Tasks 4-5.

**Interfaces:**
- Consumes: `get_payslip_folder`, `set_payslip_folder`, `scan_folder`, `upsert_payslips` (Task 5); `BaseScreen`; `FileBrowserScreen` (via `push_screen("file_browser", callback)`).

- [ ] **Step 1: Create the screen**

Create `expenses/screens/payslips_screen.py`:

```python
"""Screen for importing payslip PDFs and computing pension-aware savings."""
import logging

import pandas as pd
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.widgets import Button, DataTable, Static

from expenses.screens.base_screen import BaseScreen
from expenses.payslip_handler import (
    get_payslip_folder,
    set_payslip_folder,
    scan_folder,
    upsert_payslips,
)


class PayslipsScreen(BaseScreen):
    """Scan a folder of payslip PDFs, preview, and import."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._preview_df = pd.DataFrame()

    def compose_content(self) -> ComposeResult:
        with Vertical():
            yield Static(id="payslip_folder_label")
            with Horizontal():
                yield Button("Choose Folder", id="choose_folder_button")
                yield Button("Scan", id="scan_button")
            yield DataTable(id="payslip_preview", cursor_type="row")
            yield Static(id="payslip_status")
            yield Button("Import Payslips", id="import_payslips_button")

    def on_mount(self) -> None:
        self._refresh_folder_label()

    def _refresh_folder_label(self) -> None:
        folder = get_payslip_folder()
        label = self.query_one("#payslip_folder_label", Static)
        label.update(f"[bold]Folder:[/bold] {folder or '(none chosen yet)'}")

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "choose_folder_button":
            self.app.push_screen("file_browser", self._handle_folder_chosen)
        elif event.button.id == "scan_button":
            self._scan()
        elif event.button.id == "import_payslips_button":
            self._import()

    def _handle_folder_chosen(self, path) -> None:
        if path:
            set_payslip_folder(str(path))
            self._refresh_folder_label()

    def _scan(self) -> None:
        folder = get_payslip_folder()
        if not folder:
            self.app.show_notification("Choose a payslip folder first.", timeout=5)
            return
        try:
            df, skipped = scan_folder(folder)
        except Exception as exc:  # noqa: BLE001
            logging.warning("Payslip scan failed: %s", exc)
            self.app.show_notification(f"Scan failed: {exc}", timeout=10)
            return
        self._preview_df = df
        self._render_preview(df, skipped)

    def _render_preview(self, df: pd.DataFrame, skipped) -> None:
        table = self.query_one("#payslip_preview", DataTable)
        table.clear(columns=True)
        table.add_columns("Month", "Gross", "Net", "EE Pens", "ER Pens", "Flag")
        for _, row in df.iterrows():
            flag = "" if row["YTDReconciled"] else "⚠ YTD"
            table.add_row(
                row["Month"], f"{row['Gross']:,.2f}", f"{row['Net']:,.2f}",
                f"{row['PensionEE'] + row['AVC']:,.2f}", f"{row['PensionER']:,.2f}", flag,
            )
        status = self.query_one("#payslip_status", Static)
        msg = f"{len(df)} month(s) parsed."
        if skipped:
            msg += f" Skipped: {', '.join(skipped)}"
        status.update(msg)

    def _import(self) -> None:
        if self._preview_df.empty:
            self.app.show_notification("Nothing to import. Scan first.", timeout=5)
            return
        combined = upsert_payslips(self._preview_df)
        self.app.show_notification(
            f"Imported. {len(combined)} month(s) stored.", timeout=5
        )
```

- [ ] **Step 2: Register the screen and binding in `app.py`**

Add the import near the other screen imports:

```python
from expenses.screens.payslips_screen import PayslipsScreen
```

Add to the `SCREENS` dict (after `"budget_types": BudgetTypesScreen,`):

```python
        "payslips": PayslipsScreen,
```

Add to `BINDINGS` (after the `budget_types` binding):

```python
        Binding("y", "push_screen('payslips')", "Payslips", show=True),
```

- [ ] **Step 3: Verify the screen opens and imports**

Run: `PYTHONPATH=. python -m expenses.main`
Expected: Press `y` → Payslips screen. Choose Folder (pick a folder of payslip PDFs), Scan → preview table populates; Import Payslips → success notification. Press `s` → Summary shows the "With pension" line for covered periods. (Ctrl+Q to quit.)

- [ ] **Step 4: Run full test suite**

Run: `make test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
jj new -m "Add Payslips screen and y keybinding"
jj st
```

---

### Task 9: Documentation

**Files:**
- Create: `docs/PAYSLIPS.md`
- Modify: `README.md` (Features list ~line 33; new section; config files list ~line 159)
- Modify: `CLAUDE.md` (screens list, data-storage model, keybindings, env vars)

- [ ] **Step 1: Write `docs/PAYSLIPS.md`**

Create `docs/PAYSLIPS.md`:

```markdown
# Payslip & Pension Tracking

Bank cashflow alone understates your savings rate: pension contributions are
deducted before your salary reaches the bank, so they never show up. This
feature reads your monthly payslip PDFs, extracts the pension figures, and shows
an enhanced savings rate on the Summary screen alongside the bank-only rate.

## How it works

1. Press `y` to open the **Payslips** screen.
2. **Choose Folder** — pick the folder containing your payslip PDFs. The choice
   is remembered (stored in `payslip_settings.json`); you only pick it once.
3. **Scan** — every PDF is parsed and grouped by month. A preview shows gross,
   net, employee pension, and employer pension per month.
4. **Import Payslips** — saves the parsed data to `payslips.parquet`.
5. Open the **Summary** screen (`s`): months/years with payslip data show a
   "With pension" line with two savings rates (total-comp and post-tax basis).

Re-scanning is idempotent — each month is upserted, so running it monthly just
adds the newest payslip.

## Folder and password configuration

- **Folder:** picked in the UI and remembered. Override with the `PAYSLIP_DIR`
  environment variable.
- **Password:** if your payslip PDFs are encrypted, the password is resolved in
  this order: a `pin.txt` file in the folder → the `PAYSLIP_PDF_PASSWORD`
  environment variable → a prompt. Unencrypted PDFs need no password. The
  password is never logged.

## Multiple PDFs for one month

- Files whose names contain an ignore token (`fuckedup`, `wrong`, `old`,
  `draft`) are skipped, so a corrected payslip can supersede a bad one.
- Any remaining PDFs for the same month are **summed** (e.g. a supplementary
  on-call or bonus run adds to the base payslip).
- **YTD reconciliation:** for January (Irish tax year start) the summed monthly
  pension is cross-checked against the payslip's year-to-date figure. A mismatch
  is flagged with `⚠ YTD` rather than silently trusted.

## Savings-rate formulas

```
pension_saved  = employee pension + AVC + employer pension
enhanced_saved = bank_net (income − expenses) + pension_saved

Rate (total comp) = enhanced_saved / (Gross + employer pension)
Rate (post-tax)   = enhanced_saved / (Net + employee pension + AVC + employer pension)
```

## Supported formats

Payslip parsing currently supports one **Irish PAYE payslip layout**. Other
countries/providers are not supported yet; an unrecognized payslip is skipped
and listed under "Skipped" rather than parsed incorrectly. The feature is
opt-in, so it has no effect unless you point it at a payslip folder.

## Privacy

Payslips are read locally and never uploaded. Passwords are never written to the
logs. No employer name or personal path is stored in the application code.
```

- [ ] **Step 2: Update `README.md` Features list**

After the existing "Transaction Tags" bullet (~line 33), add:

```markdown
- **Payslip & Pension Tracking**: Import monthly payslip PDFs to capture pension contributions and see a pension-aware savings rate alongside the bank-only rate. See the [Payslip & Pension Tracking Guide](docs/PAYSLIPS.md). Currently supports the Irish PAYE payslip layout.
```

- [ ] **Step 3: Add a README section and config-file entries**

After the "Importing Data" section, add:

```markdown
## Payslip & Pension Tracking

Your savings rate from bank data alone misses pension contributions deducted
before salary reaches your account. Press `y` to open the Payslips screen, point
it at a folder of payslip PDFs, and import them to see an enhanced savings rate.
Full details, configuration, and the savings-rate formulas are in the
[Payslip & Pension Tracking Guide](docs/PAYSLIPS.md).

Environment variables:
- `PAYSLIP_DIR`: folder containing payslip PDFs (otherwise chosen in the UI and remembered).
- `PAYSLIP_PDF_PASSWORD`: password for encrypted payslip PDFs (optional).
```

In the config-files list (~line 159), add:

```markdown
- `payslips.parquet`: Stores parsed payslip data (gross, net, pension) per month.
- `payslip_settings.json`: Remembers your chosen payslip folder.
```

- [ ] **Step 4: Update `CLAUDE.md`**

- In the Screens list (Architecture section), add: `PayslipsScreen`: Import payslip PDFs and compute pension-aware savings.
- In the "Data Storage Model" list, add `payslips.parquet` and `payslip_settings.json` with one-line descriptions.
- In the App Core keybindings line, add `y=Payslips`.
- In Configuration → Environment Variables, add `PAYSLIP_DIR` and `PAYSLIP_PDF_PASSWORD`.

- [ ] **Step 5: Verify links and lint**

Run: `make lint`
Expected: PASS (no flake8 errors)

- [ ] **Step 6: Commit**

```bash
jj new -m "Document payslip and pension tracking"
jj st
```

---

## Post-implementation

- [ ] Run `make format && make all` — everything green.
- [ ] Confirm `pypdf` is listed in `pyproject.toml` dependencies (it is now a real runtime dependency, not just a design-time inspection tool).
- [ ] Per `[[cleanup-spec-plan-docs]]`: once the feature is merged and stable, delete the spec and plan under `docs/superpowers/`.
