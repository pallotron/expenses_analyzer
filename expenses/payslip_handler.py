"""Scan, aggregate, and persist payslip data."""
import json
import logging
import os
from typing import Dict, List, Optional, Tuple

import pandas as pd

from expenses import config
from expenses.payslip_parser import PayslipRun, parse_payslip, resolve_password

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
