# Payslip-Based Pension Savings Tracking — Design

**Date:** 2026-07-24
**Status:** Approved design, pending implementation plan

## Problem

The current savings rate is computed purely from bank cashflow in `analysis.py`
(`calculate_savings_rate`, `get_cash_flow_totals`) as `(income − expenses) / income`.
"Income" is whatever salary lands in the bank. Anything deducted *before* pay reaches
the bank — pension contributions, tax — is invisible. Pension contributions are real
savings, so the reported savings rate is understated.

The user keeps monthly payslip PDFs in a local folder (Irish payslip format) that contain
the pension figures. This project adds payslip parsing and an enhanced savings rate that
accounts for pension. The folder location is user-configured at runtime and never
hardcoded (no employer name or personal path in code, config defaults, or fixtures).

## Goals

- Parse monthly payslip PDFs and store the relevant figures.
- Compute an enhanced savings rate that includes employee pension, employer pension,
  and AVC (Additional Voluntary Contributions), shown alongside the existing bank-only
  rate on the Summary screen.
- Keep bank transaction data (`transactions.parquet`) untouched — no double-counting.

## Non-Goals

- Parsing every payroll field (PRSI code, insurable weeks, tax cut-off, credits). These
  feed no analysis (YAGNI).
- Supporting arbitrary payslip layouts. This is a personal tool; parsing targets one
  specific Irish PAYE payslip layout. Multi-country/multi-provider payslip parsing is an
  open-ended problem and explicitly out of scope. See "Format assumption" below for how
  unsupported layouts are handled safely.
- Injecting synthetic rows into `transactions.parquet`.

## Format Assumption (Ireland-only, fail loudly)

Payslip parsing targets a single Irish PAYE payslip layout. This is acceptable because the
feature is entirely **opt-in** — a user who never points the app at a payslip folder is
unaffected. The danger to avoid is producing *wrong* pension numbers for an unrecognized
layout, so the parser must **fail loudly and degrade gracefully**:

- `payslip_parser` **validates** the extracted structure (e.g. the `Pension`/`AVC` lines
  must match the expected shape and yield numeric values). If a payslip does not match, the
  parser returns an "unrecognized format" result — it never guesses.
- Unrecognized/unparseable files are **skipped and flagged** in the preview, never silently
  assigned partial values.
- The parser is an isolated pure module, so adding another country/provider later is an
  additive change (a second format handler). That scaffolding is **not** built now.
- The limitation is documented plainly in `README.md` and `docs/PAYSLIPS.md`.

## Scope of Captured Fields (the "useful waterfall")

Per month we capture enough to show a gross → net → savings breakdown, not just pension:

| Field       | Source on payslip                                  | Purpose |
|-------------|----------------------------------------------------|---------|
| `Month`     | Derived from filename `YYYY-MM` / pay date         | Key |
| `Gross`     | Derived: sum of cash earnings lines (Salary + Bonus + On-Call + reimbursements; excludes notional BIK) | Denominator (total-comp basis) |
| `Net`       | Derived: `Gross − (PensionEE + AVC) − TaxTotal`    | Sanity-check vs bank deposit |
| `TaxTotal`  | PAYE + PRSI (employee) + USC                        | Gross→net waterfall |
| `PensionEE` | `Pension` line, 1st number (employee, this period)  | Savings |
| `AVC`       | `AVC` line, 1st number (this period)                | Savings (employee voluntary) |
| `PensionER` | `Pension` line, 3rd number (employer, this period)  | Savings + total comp |
| `Bonus`     | `Bonus` earnings line                               | Base vs variable |
| `OnCall`    | `On-Call` earnings line                             | Base vs variable |
| `SourceFiles` | list of PDF filenames aggregated into this month  | Provenance |
| `YTDReconciled` | bool — did monthly sums reconcile against YTD?  | Correctness flag |

Payroll metadata (PRSI code, insurable weeks, tax cut-off, credits, BIK) is **not** stored.

### Verified payslip structure

Line-based extraction reliably yields the structured deduction/earnings lines. Example
(`2026-01.pdf`, first month of the Irish tax year, so this-period == YTD):

```
Salary 13000.00
On-Call 681.25
AVC 260.00 260.00 0.00 0.00            # this-period, YTD, (unused), (unused)
Pension 1040.00 1040.00 1040.00 1040.00 # EE period, EE YTD, ER period, ER YTD
PAYE 4075.06 4075.06                    # period, YTD
PRSI 595.61 595.61 1595.40 1595.40      # EE period, EE YTD, ER period, ER YTD
USC on 14181.42 803.73 803.73 0.00 0.00
```

`Gross Pay` and `NETT PAY` also appear in a positional summary box that line-based text
extraction mangles — but we do **not** need to parse it, because every figure is derivable
from the structured line items above:

```
Gross    = Salary + Bonus + On-Call + reimbursements   (cash earnings; excludes notional BIK)
DedsGross = PensionEE + AVC
TaxTotal  = PAYE + PRSI(employee) + USC
Net       = Gross − DedsGross − TaxTotal
```

Verified against `2026-07`: `16508.33 − 1345.84 − 6900.76 = 8261.73` (matches the payslip's
`NETT PAY`). The summary box's `NETT PAY` value is used only as an **optional reconciliation
cross-check** (like the YTD check), never as the primary source. This means parsing needs
only **line-based text extraction** (`pypdf`), not coordinate-aware parsing.

## Architecture

New, well-bounded units:

### `expenses/payslip_parser.py`
Pure parsing. Input: a PDF path + optional password. Output: a parsed-record dataclass
for a single PDF (one payroll run). No I/O beyond reading the given file; no knowledge of
folders, config, or aggregation. Uses `pypdf` for line-based text extraction, then regex/line
matching for the structured earnings and deduction lines; Gross and Net are **derived** from
those line items (see "Verified payslip structure"). The pure line-parsing logic is separated
from PDF I/O so it can be unit-tested with plain text (no PDF fixtures needed).

Password handling is optional and auto-detecting:
- If the PDF is **not encrypted**, no password is needed.
- If encrypted, try password sources in order: `pin.txt` in the folder → `PAYSLIP_PDF_PASSWORD`
  env var → UI prompt (handled by the screen, passed into the parser).
- The password is never logged.

### `expenses/payslip_handler.py`
Aggregation and persistence. Responsibilities:
- Scan the configured folder for PDFs.
- Group files by `YYYY-MM` (from filename).
- Apply an **ignore-list** (configurable; default `["fuckedup", "wrong", "old", "draft"]`)
  to drop superseded files. (The user typically cleans these up manually, but the list is
  a safety net.)
- **Sum this-period values** across all remaining same-month files (supplementary runs like
  `-oncall`, `-bonus` add together; verified that supplementary runs carry this-period
  deductions of their own and share the month's cumulative YTD).
- **YTD reconciliation**: for each month, cross-check `sum(this-period values)` against
  `max(YTD) − previous month's max(YTD)` (Irish tax year = calendar year, YTD resets in
  January). On mismatch, set `YTDReconciled = False` and surface a flag; do not silently
  trust the math. This is a flag, not a hard gate.
- **Upsert** by month into `payslips.parquet` (idempotent — re-scanning monthly just adds
  the newest payslip).

### `expenses/screens/payslips_screen.py`
New `PayslipsScreen`, keybinding `y`, following the TrueLayer sync pattern
(scan → preview → confirm) rather than the CSV import pattern (no column mapping needed for a
fixed layout). Behavior:
- First run with no saved folder: open `FileBrowserScreen` to pick the payslip folder.
- Folder path persisted (see config); subsequent runs show the remembered folder + a Scan
  button + a "Change folder" action.
- Scan parses in a worker thread, shows a preview table (Month, Gross, Net, EE Pension,
  ER Pension, flags for supplement/YTD anomaly), then a confirm action upserts to
  `payslips.parquet`.
- If a PDF is encrypted and no password source resolves, prompt for it here.

Registered in `expenses/app.py` `SCREENS` dict with the `y` binding.

### `expenses/analysis.py` (extended)
New functions computing the enhanced savings rate. Reuse the existing bank `Net`
(income − expenses from `calculate_net_cash_flow`) as the *cash* saved, then add pension
from `payslips.parquet`:

```
pension_saved   = PensionEE + AVC + PensionER
enhanced_saved  = bank_net + pension_saved
```

Both denominator bases are computed and displayed:

```
# Total-comp basis
rate_totalcomp = enhanced_saved / (Gross + PensionER)

# Post-tax basis
rate_posttax   = enhanced_saved / (Net + PensionEE + AVC + PensionER)
```

Functions operate per-period (month/year) and join bank data to payslip data by period.
Months with no payslip fall back to the bank-only rate (pension terms = 0) and are marked
as such so the user isn't misled.

### `expenses/config.py` (extended)
- `PAYSLIP_DIR` env override; persisted chosen path in `payslip_settings.json`.
- `PAYSLIP_PDF_PASSWORD` env override.
- Paths for `payslips.parquet` and `payslip_settings.json` under the config dir.

### `pyproject.toml`
Add `pypdf` dependency (line-based PDF text extraction; handles encrypted PDFs via `decrypt`).

## Data Model

`payslips.parquet` — one row per month, columns as in the field table above. Stored in the
config dir (`~/.config/expenses_analyzer/` by default, honoring
`EXPENSES_ANALYZER_CONFIG_DIR`).

`payslip_settings.json` — e.g. `{"folder": "/Users/.../Payslips", "ignore_list": [...]}`.

## Data Flow

```
Payslip PDFs ──scan──> payslip_handler
   │  (folder from payslip_settings.json / PAYSLIP_DIR)
   ├── group by YYYY-MM, drop ignore-list
   ├── payslip_parser (pypdf line extraction, per file) ──> per-run records
   ├── sum this-period values per month
   ├── YTD reconciliation flag
   └── upsert ──> payslips.parquet
                        │
transactions.parquet ───┼──> analysis.enhanced savings rate (both bases)
                        │        (bank_net + pension) / denominator
                        └──> Summary screen: bank-only vs with-pension
```

## Error Handling

- Encrypted PDF with no resolvable password (no `pin.txt`, no env var) → the file is skipped
  and listed under "Skipped" in the preview; the scan does not crash. (A dedicated in-UI
  password prompt is a possible future enhancement; the `pin.txt`/env sources cover the
  current use case.)
- Unparseable/ malformed payslip → skip with a logged warning and a visible flag; other
  months still process.
- Month present in bank data but missing a payslip → enhanced rate falls back to bank-only
  for that month, clearly labeled.
- YTD mismatch → `YTDReconciled = False`, visible warning flag; values still stored.

## Documentation (in scope)

- **`docs/PAYSLIPS.md`** (new): full guide — folder configuration, password sources, the
  duplicate/supplement resolution rule, the two savings-rate formulas, reconciliation flags,
  and privacy note (payslips are read locally; passwords never logged).
- **`README.md`**: add a Features bullet; add a "Payslip & Pension Tracking" section linking
  `docs/PAYSLIPS.md`; add `payslips.parquet` and `payslip_settings.json` to the config-files
  list; document `PAYSLIP_DIR` and `PAYSLIP_PDF_PASSWORD` env vars.
- **`CLAUDE.md`**: update the screens list, data-storage model, keybindings (`y` = Payslips),
  and Configuration/env-var sections to stay accurate.

## Testing

Per project conventions (pytest, `PYTHONPATH=.`):

- **Parser** (`tests/test_payslip_parser.py`): synthetic/scrubbed fixture PDFs (not the
  user's real payslips) covering a plain month, a bonus month, and a supplementary
  (`-oncall`) run. Assert correct extraction of Gross, Net, PensionEE, AVC, PensionER,
  Bonus, OnCall, TaxTotal. Assert graceful handling of encrypted-without-password.
- **Aggregation** (`tests/test_payslip_handler.py`): grouping by month, ignore-list dropping,
  summing supplementary runs, YTD reconciliation pass/fail, idempotent upsert.
- **Analysis** (`tests/test_analysis.py` additions): both savings-rate bases with known
  inputs; months missing payslips fall back to bank-only.

## Privacy & Security

- Payslips are read locally; content and passwords are never logged.
- `pin.txt` is an optional convenience, never required. No password convention is forced on
  users whose PDFs are unencrypted.
- Test fixtures are synthetic — the user's real payslips are never committed.

## Dependencies to Add

- `pypdf` — line-based PDF text extraction. Handles encrypted PDFs via `PdfReader.decrypt()`.
  Sufficient because Gross/Net are derived from line items rather than the positional summary
  box, so coordinate-aware extraction is not required.
