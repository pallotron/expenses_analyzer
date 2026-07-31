# Payslip & Pension Tracking

Bank cashflow alone underestimates your savings rate: pension contributions are
deducted before your salary reaches the bank, so they never show up. This
feature reads your monthly payslip PDFs, extracts the pension figures, and shows
an enhanced savings rate on the Summary screen alongside the bank-only rate.

## How it works

1. Press `y` to open the **Payslips** screen.
2. **Add Folder** — pick a folder containing payslip PDFs. The choice is
   remembered (stored in `payslip_settings.json`); you only pick it once.
3. **Scan** — every PDF is parsed and grouped by month. A preview shows gross,
   net, employee pension, and employer pension per month.
4. **Import Payslips** — saves the parsed data to `payslips.parquet`.
5. Open the **Summary** screen (`s`): months/years with payslip data show a
   "With pension" line showing a pension-aware savings rate on the same base as
   the bank-only rate (directly comparable).

Re-scanning is idempotent — each month is upserted, so running it monthly just
adds the newest payslip.

## Several people

Payslips are recorded per **person**, keyed on `(Owner, Month)`. Add a name in
the "Add person…" box, give that person their own folder, then scan and import
as above. Each person is scanned independently, so re-importing one leaves the
others untouched. Payslips recorded before this existed belong to `self`.

The Summary screen sums pension across everyone. Only pension is added, never a
second salary: this assumes **everyone's take-home pay already lands in the bank
accounts you track**, so their net pay is in the cashflow already and only the
pre-tax pension is invisible. A month counts toward the savings rate when at
least one person has a payslip for it.

## Several employers for one person

A person can have more than one folder. Changing employer part-way through a
year leaves that year's payslips split across directories, and both folders must
be scanned for the year to be complete — so **Add Folder** adds to the list
rather than replacing it, and each folder resolves its own password. Months
straddling the move sum both employers' payslips into one row.

Year-to-date pension restarts at a new employer. A drop in year-to-date is read
as the start of a new employment rather than a mismatch, so a mid-year move is
not flagged with `⚠ YTD`.

## Folder and password configuration

- **Folder:** picked in the UI and remembered. The `PAYSLIP_DIR` environment
  variable overrides the folder list for `self` only — naming a single folder
  cannot express which person it belongs to.
- **Password:** if your payslip PDFs are encrypted, the password is resolved in
  this order: a `pin.txt` file in the folder → the `PAYSLIP_PDF_PASSWORD`
  environment variable. Unencrypted PDFs need no password. If a PDF is encrypted
  and neither source provides a working password, that file is skipped and listed
  under "Skipped" in the scan preview. The password is never logged.

## Multiple PDFs for one month

- Files whose names contain an ignore token (`fuckedup`, `wrong`, `old`,
  `draft`) are skipped, so a corrected payslip can supersede a bad one.
- Any remaining PDFs for the same month are **summed** (e.g. a supplementary
  on-call or bonus run adds to the base payslip).
- **YTD reconciliation:** for January (Irish tax year start) the summed monthly
  pension is cross-checked against the payslip's year-to-date figure. A mismatch
  is flagged with `⚠ YTD` rather than silently trusted.
- **Net reconciliation:** the net derived from the line items is checked against
  the net the payslip itself states. They diverge when the payslip carries an
  earnings or deduction label the parser does not recognise, which would
  otherwise silently understate gross; that is flagged with `⚠ NET`.

## Savings-rate formulas

The pension-aware rate is shown on the **same base as the plain bank savings
rate** (your bank income), with pension added to both sides, so it's directly
comparable — e.g. "Savings Rate 31.4% → 44.9% with pension".

```
pension_saved       = employee pension + AVC + employer pension
enhanced_saved      = bank_net (income − expenses) + pension_saved
income_with_pension = bank_income + pension_saved

Savings rate (bank only)   = bank_net / bank_income
Savings rate (with pension) = enhanced_saved / income_with_pension
```

`pension_saved` is summed across everyone with a payslip for the month.

Both the bank net and bank income are restricted to the months that have a
payslip (see reconciliation above), so a partial year isn't compared against a
full-year bank total.

## Supported formats

Payslip parsing supports the **Irish PAYE payslip layout**, matching labels
case-insensitively so that providers differing only in vocabulary and casing
share one parser. Deductions keyed by provider-specific names (a social club, a
health insurance premium) are recognised by their shape rather than by name, so
they need no per-employer configuration.

An unrecognized payslip is skipped and listed under "Skipped" rather than parsed
incorrectly, and a payslip whose stated net disagrees with its line items is
flagged rather than trusted. The feature is opt-in, so it has no effect unless
you point it at a payslip folder.

## Privacy

Payslips are read locally and never uploaded. Passwords are never written to the
logs. No employer name or personal path is stored in the application code.
