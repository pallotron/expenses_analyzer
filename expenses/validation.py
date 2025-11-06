"""Data validation for transaction DataFrames."""

import logging
from datetime import datetime
from typing import List, Optional
import pandas as pd


class ValidationError(Exception):
    """Raised when data validation fails."""

    def __init__(self, message: str, errors: List[str]):
        super().__init__(message)
        self.errors = errors


def _validate_schema(df: pd.DataFrame) -> List[str]:
    """Validate DataFrame schema - check for required columns."""
    required_columns = {"Date", "Merchant", "Amount"}
    missing_columns = required_columns - set(df.columns)
    if missing_columns:
        return [f"Missing required columns: {', '.join(sorted(missing_columns))}"]
    return []


def _validate_dates(df: pd.DataFrame, min_date: datetime, max_date: datetime) -> List[str]:
    """Validate date column values and ranges."""
    errors = []
    try:
        dates = pd.to_datetime(df["Date"], errors="coerce", format="mixed")
        invalid_dates = dates.isna()
        if invalid_dates.any():
            errors.append(
                f"Found {invalid_dates.sum()} row(s) with invalid dates that cannot be parsed"
            )

        # Check date ranges
        valid_dates = dates[~invalid_dates]
        if len(valid_dates) > 0:
            too_old = valid_dates < min_date
            too_new = valid_dates > max_date

            if too_old.any():
                errors.append(
                    f"Found {too_old.sum()} date(s) before minimum allowed date {min_date.date()}"
                )
            if too_new.any():
                errors.append(
                    f"Found {too_new.sum()} date(s) after maximum allowed date {max_date.date()}"
                )
    except Exception as e:
        errors.append(f"Date validation failed: {e}")
    return errors


def _validate_merchants(df: pd.DataFrame) -> List[str]:
    """Validate merchant column values."""
    try:
        merchants = df["Merchant"].astype(str)
        empty_merchants = (merchants.str.strip() == "") | merchants.isna()
        if empty_merchants.any():
            return [f"Found {empty_merchants.sum()} row(s) with empty or missing merchant names"]
    except Exception as e:
        return [f"Merchant validation failed: {e}"]
    return []


def _validate_amounts(df: pd.DataFrame, max_amount: float) -> List[str]:
    """Validate amount column values and ranges."""
    errors = []
    try:
        amounts = pd.to_numeric(df["Amount"], errors="coerce")
        invalid_amounts = amounts.isna()
        if invalid_amounts.any():
            errors.append(f"Found {invalid_amounts.sum()} row(s) with non-numeric amounts")

        # Check for unreasonably large amounts
        valid_amounts = amounts[~invalid_amounts]
        if len(valid_amounts) > 0:
            abs_amounts = valid_amounts.abs()
            too_large = abs_amounts > max_amount
            if too_large.any():
                errors.append(
                    f"Found {too_large.sum()} row(s) with amounts (absolute value) "
                    f"exceeding ${max_amount:,.2f}"
                )

            # Check for zero amounts
            zero = valid_amounts == 0
            if zero.any():
                logging.warning(f"Found {zero.sum()} row(s) with zero amounts - allowed but unusual")
    except Exception as e:
        errors.append(f"Amount validation failed: {e}")
    return errors


def _validate_types(df: pd.DataFrame) -> List[str]:
    """Validate column data types."""
    errors = []
    try:
        # Date should be datetime
        if not pd.api.types.is_datetime64_any_dtype(df["Date"]):
            try:
                pd.to_datetime(df["Date"], format="mixed")
            except Exception:
                errors.append("Date column cannot be converted to datetime type")

        # Amount should be numeric
        if not pd.api.types.is_numeric_dtype(df["Amount"]):
            try:
                pd.to_numeric(df["Amount"])
            except Exception:
                errors.append("Amount column cannot be converted to numeric type")
    except Exception as e:
        errors.append(f"Type validation failed: {e}")
    return errors


def validate_transaction_dataframe(
    df: pd.DataFrame,
    min_date: Optional[datetime] = None,
    max_date: Optional[datetime] = None,
    max_amount: float = 1_000_000.0,
) -> None:
    """Validate a transaction DataFrame before saving to Parquet.

    Performs comprehensive validation including:
    - Schema validation (required columns, correct types)
    - Value validation (non-empty, valid dates, numeric amounts)
    - Range validation (reasonable dates and amounts)

    Args:
        df: DataFrame to validate
        min_date: Minimum allowed date (default: 1900-01-01)
        max_date: Maximum allowed date (default: today + 1 year)
        max_amount: Maximum allowed transaction amount (default: 1 million)

    Raises:
        ValidationError: If validation fails, with details about all errors found
    """
    if min_date is None:
        min_date = datetime(1900, 1, 1)
    if max_date is None:
        max_date = datetime.now().replace(year=datetime.now().year + 1)

    # 1. Schema validation
    errors = _validate_schema(df)
    if errors:
        raise ValidationError("Schema validation failed: missing required columns", errors)

    # 2. Empty DataFrame check
    if df.empty:
        logging.warning("Validating empty DataFrame - this is allowed but unusual")
        return

    # 3. Run all validations
    errors.extend(_validate_dates(df, min_date, max_date))
    errors.extend(_validate_merchants(df))
    errors.extend(_validate_amounts(df, max_amount))
    errors.extend(_validate_types(df))

    # If we found any errors, raise ValidationError
    if errors:
        error_summary = f"Validation failed with {len(errors)} error(s)"
        logging.error(f"{error_summary}: {'; '.join(errors)}")
        raise ValidationError(error_summary, errors)

    logging.debug(f"Validation passed for DataFrame with {len(df)} rows")


def validate_and_clean_dataframe(df: pd.DataFrame, **validation_kwargs) -> pd.DataFrame:
    """Validate and return a cleaned copy of the DataFrame.

    This is a convenience function that:
    1. Creates a copy of the DataFrame
    2. Ensures proper types (datetime for Date, numeric for Amount)
    3. Validates the cleaned DataFrame
    4. Returns the cleaned version

    Args:
        df: DataFrame to validate and clean
        **validation_kwargs: Additional arguments passed to validate_transaction_dataframe

    Returns:
        Cleaned and validated DataFrame

    Raises:
        ValidationError: If validation fails
    """
    cleaned = df.copy()

    # Ensure Date is datetime
    if "Date" in cleaned.columns:
        cleaned["Date"] = pd.to_datetime(cleaned["Date"], errors="coerce", format="mixed")

    # Ensure Amount is numeric
    if "Amount" in cleaned.columns:
        cleaned["Amount"] = pd.to_numeric(cleaned["Amount"], errors="coerce")

    # Ensure Merchant is string
    if "Merchant" in cleaned.columns:
        cleaned["Merchant"] = cleaned["Merchant"].astype(str)

    # Validate the cleaned DataFrame
    validate_transaction_dataframe(cleaned, **validation_kwargs)

    return cleaned
