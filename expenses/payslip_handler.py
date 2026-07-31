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

# The owner that payslips recorded before multi-owner support belong to.
DEFAULT_OWNER = "self"

PAYSLIP_COLUMNS = [
    "Owner", "Month", "Gross", "Net", "TaxTotal", "PensionEE", "AVC", "PensionER",
    "Bonus", "OnCall", "SourceFiles", "YTDReconciled", "NetReconciled",
]


def is_ignored(filename: str, ignore_list: List[str]) -> bool:
    """True if the filename contains any ignore-list token (case-insensitive)."""
    low = filename.lower()
    return any(token.lower() in low for token in ignore_list)


def aggregate_runs(runs: List[PayslipRun], owner: str = DEFAULT_OWNER) -> pd.DataFrame:
    """Aggregate per-run records into one row per month for a single owner.

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
            "Owner": owner,
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
            "NetReconciled": all(r.net_reconciled for r in group),
        }

    # Second pass: YTD reconciliation against the previous month in the same year.
    months = sorted(partial)
    rows = []
    for i, month in enumerate(months):
        year = month[:4]
        prev_ytd = 0.0
        if i > 0 and months[i - 1][:4] == year:
            prev_ytd = ending_ytd[months[i - 1]]
            # Year-to-date only ever climbs within one employment, so a fall
            # means a new employer started its own count part-way through the
            # year. Comparing across that boundary would flag a false mismatch.
            if ending_ytd[month] < prev_ytd:
                prev_ytd = 0.0
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


def _owners_from_settings(settings: dict) -> Dict[str, List[str]]:
    """Read the owner -> folders map, upgrading the single-folder format.

    Settings written before multi-owner support held one ``folder`` for one
    person; those become the default owner's sole folder.
    """
    owners = settings.get("owners")
    if isinstance(owners, dict):
        return {
            name: list(entry.get("folders", []))
            for name, entry in owners.items()
            if isinstance(entry, dict)
        }
    legacy = settings.get("folder")
    return {DEFAULT_OWNER: [legacy]} if legacy else {}


def _save_owners(owners: Dict[str, List[str]]) -> None:
    settings = load_payslip_settings()
    settings.pop("folder", None)  # fully replaced by the owners map
    settings["owners"] = {name: {"folders": folders} for name, folders in owners.items()}
    save_payslip_settings(settings)


def list_owners() -> List[str]:
    """Owners that have at least one configured folder, default owner first."""
    owners = _owners_from_settings(load_payslip_settings())
    if config.PAYSLIP_DIR:
        owners.setdefault(DEFAULT_OWNER, [])
    return sorted(owners, key=lambda name: (name != DEFAULT_OWNER, name))


def get_payslip_folders(owner: str = DEFAULT_OWNER) -> List[str]:
    """All folders configured for ``owner``.

    An owner can have several because changing employer part-way through a year
    leaves that year's payslips split across directories. The env override
    applies to the default owner only; it predates multi-owner support and
    naming a single folder cannot express which owner it belongs to otherwise.
    """
    folders = _owners_from_settings(load_payslip_settings()).get(owner, [])
    if owner == DEFAULT_OWNER and config.PAYSLIP_DIR:
        return [config.PAYSLIP_DIR] + [f for f in folders if f != config.PAYSLIP_DIR]
    return folders


def get_payslip_folder(owner: str = DEFAULT_OWNER) -> Optional[str]:
    """The owner's first configured folder, or None."""
    folders = get_payslip_folders(owner)
    return folders[0] if folders else None


def add_payslip_folder(path: str, owner: str = DEFAULT_OWNER) -> None:
    """Add a folder to ``owner``, keeping any already configured."""
    owners = _owners_from_settings(load_payslip_settings())
    folders = owners.setdefault(owner, [])
    if path not in folders:
        folders.append(path)
    _save_owners(owners)


def remove_payslip_folder(path: str, owner: str = DEFAULT_OWNER) -> None:
    """Remove one folder from ``owner``, dropping the owner if it was the last."""
    owners = _owners_from_settings(load_payslip_settings())
    folders = [f for f in owners.get(owner, []) if f != path]
    if folders:
        owners[owner] = folders
    else:
        owners.pop(owner, None)
    _save_owners(owners)


def set_payslip_folder(path: str, owner: str = DEFAULT_OWNER) -> None:
    """Replace all of ``owner``'s folders with a single one."""
    owners = _owners_from_settings(load_payslip_settings())
    owners[owner] = [path]
    _save_owners(owners)


def _parse_folder(
    folder: str,
    password: Optional[str],
    ignore_list,
) -> Tuple[List[PayslipRun], list]:
    """Parse every payslip PDF in one folder. Returns (runs, skipped_names)."""
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
    return runs, skipped


def scan_folder(
    folder: str,
    password: Optional[str] = None,
    ignore_list=DEFAULT_IGNORE,
    owner: str = DEFAULT_OWNER,
) -> Tuple[pd.DataFrame, list]:
    """Parse all payslip PDFs in ``folder`` and aggregate by month.

    Returns (aggregated_df, skipped_files). Files that are ignored, unparseable,
    or unrecognized are collected in skipped_files rather than raising.
    """
    runs, skipped = _parse_folder(folder, password, ignore_list)
    return aggregate_runs(runs, owner), skipped


def scan_owner(
    owner: str = DEFAULT_OWNER,
    password: Optional[str] = None,
    ignore_list=DEFAULT_IGNORE,
) -> Tuple[pd.DataFrame, list]:
    """Parse every folder configured for ``owner`` and aggregate by month.

    Runs from all of the owner's folders are aggregated together, so a month
    straddling a change of employer sums both employers' payslips into the one
    row rather than letting the second folder's scan overwrite the first.
    Each folder resolves its own password, since they are separate employers.
    """
    folders = get_payslip_folders(owner)
    if not folders:
        return pd.DataFrame(columns=PAYSLIP_COLUMNS), []

    runs: List[PayslipRun] = []
    skipped: list = []
    for folder in folders:
        try:
            folder_runs, folder_skipped = _parse_folder(folder, password, ignore_list)
        except OSError as exc:  # an unreadable folder must not lose the others
            logger.warning("Could not read payslip folder %s: %s", folder, exc)
            skipped.append(f"{folder} (unreadable)")
            continue
        runs.extend(folder_runs)
        skipped.extend(folder_skipped)
    return aggregate_runs(runs, owner), skipped


def load_payslips() -> pd.DataFrame:
    if not os.path.isfile(config.PAYSLIPS_FILE):
        return pd.DataFrame(columns=PAYSLIP_COLUMNS)
    df = pd.read_parquet(config.PAYSLIPS_FILE)
    if "NetReconciled" not in df.columns:
        # Written before net was reconciled against the payslip's own figure;
        # unknown rather than verified, so surface it as unreconciled.
        df["NetReconciled"] = False
    if "Owner" not in df.columns:
        # Written before multi-owner support, so every row is the one person.
        df.insert(0, "Owner", DEFAULT_OWNER)
    return df


def save_payslips(df: pd.DataFrame) -> None:
    df.to_parquet(config.PAYSLIPS_FILE, index=False)


def upsert_payslips(new_df: pd.DataFrame) -> pd.DataFrame:
    """Replace existing rows matching (Owner, Month), keep the rest, and persist.

    Keying on the pair means rescanning one owner leaves the other owners'
    months untouched, so each person's payslips can be imported independently.
    """
    if new_df.empty:
        return load_payslips()
    if "Owner" not in new_df.columns:
        new_df = new_df.assign(Owner=DEFAULT_OWNER)

    existing = load_payslips()
    if not existing.empty:
        replaced = set(zip(new_df["Owner"], new_df["Month"]))
        keep = [pair not in replaced for pair in zip(existing["Owner"], existing["Month"])]
        existing = existing[keep]
    # An empty frame contributes no rows but does drag all-NA columns into the
    # dtype resolution, which pandas warns about; drop it instead.
    parts = [part for part in (existing, new_df) if not part.empty]
    combined = pd.concat(parts, ignore_index=True) if parts else new_df
    combined = combined.sort_values(["Owner", "Month"]).reset_index(drop=True)
    save_payslips(combined)
    return combined
