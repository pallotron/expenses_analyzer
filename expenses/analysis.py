import calendar
from typing import List, Optional, Tuple

import pandas as pd

from expenses.tags import cell_matches_patterns, normalize_pattern


def calculate_trends(data: List[float]) -> List[Tuple[float, str]]:
    """
    Calculates the trend for a series of numbers by comparing each number
    to the previous one.

    Args:
        data: A list of numbers (floats or ints).

    Returns:
        A list of tuples, where each tuple contains the original number
        and a trend indicator ('↑', '↓', '=', or '-').
    """
    if not data:
        return []

    trends = [(data[0], "-")]  # First item has no trend
    for i in range(1, len(data)):
        previous = data[i - 1]
        current = data[i]
        if current > previous:
            trend = "↑"
        elif current < previous:
            trend = "↓"
        else:
            trend = "="
        trends.append((current, trend))
    return trends


def calculate_income_summary(
    transactions: pd.DataFrame, period: str = "month"
) -> pd.DataFrame:
    """Calculate total income by period.

    Args:
        transactions: DataFrame with Date, Amount, Type columns.
        period: Grouping period - "month", "year", or "day".

    Returns:
        DataFrame with period and total income columns.
    """
    if transactions.empty or "Type" not in transactions.columns:
        return pd.DataFrame(columns=["Period", "Income"])

    income_df = transactions[transactions["Type"] == "income"].copy()
    if income_df.empty:
        return pd.DataFrame(columns=["Period", "Income"])

    income_df["Date"] = pd.to_datetime(income_df["Date"])

    if period == "year":
        income_df["Period"] = income_df["Date"].dt.to_period("Y")
    elif period == "day":
        income_df["Period"] = income_df["Date"].dt.to_period("D")
    else:  # default to month
        income_df["Period"] = income_df["Date"].dt.to_period("M")

    result = income_df.groupby("Period")["Amount"].sum().reset_index()
    result.columns = ["Period", "Income"]
    return result


def calculate_expense_summary(
    transactions: pd.DataFrame, period: str = "month"
) -> pd.DataFrame:
    """Calculate total expenses by period.

    Args:
        transactions: DataFrame with Date, Amount, Type columns.
        period: Grouping period - "month", "year", or "day".

    Returns:
        DataFrame with period and total expenses columns.
    """
    if transactions.empty or "Type" not in transactions.columns:
        return pd.DataFrame(columns=["Period", "Expenses"])

    expense_df = transactions[transactions["Type"] == "expense"].copy()
    if expense_df.empty:
        return pd.DataFrame(columns=["Period", "Expenses"])

    expense_df["Date"] = pd.to_datetime(expense_df["Date"])

    if period == "year":
        expense_df["Period"] = expense_df["Date"].dt.to_period("Y")
    elif period == "day":
        expense_df["Period"] = expense_df["Date"].dt.to_period("D")
    else:  # default to month
        expense_df["Period"] = expense_df["Date"].dt.to_period("M")

    result = expense_df.groupby("Period")["Amount"].sum().reset_index()
    result.columns = ["Period", "Expenses"]
    return result


def calculate_net_cash_flow(
    transactions: pd.DataFrame, period: str = "month"
) -> pd.DataFrame:
    """Calculate net cash flow (income - expenses) by period.

    Args:
        transactions: DataFrame with Date, Amount, Type columns.
        period: Grouping period - "month", "year", or "day".

    Returns:
        DataFrame with period, income, expenses, and net columns.
    """
    income_summary = calculate_income_summary(transactions, period)
    expense_summary = calculate_expense_summary(transactions, period)

    if income_summary.empty and expense_summary.empty:
        return pd.DataFrame(columns=["Period", "Income", "Expenses", "Net"])

    # Merge income and expenses
    if income_summary.empty:
        result = expense_summary.copy()
        result["Income"] = 0.0
    elif expense_summary.empty:
        result = income_summary.copy()
        result["Expenses"] = 0.0
    else:
        result = pd.merge(income_summary, expense_summary, on="Period", how="outer")
        result = result.fillna(0.0)

    result["Net"] = result["Income"] - result["Expenses"]
    result = result.sort_values("Period")

    return result[["Period", "Income", "Expenses", "Net"]]


def calculate_savings_rate(
    transactions: pd.DataFrame, period: str = "month"
) -> pd.DataFrame:
    """Calculate savings rate: (income - expenses) / income * 100.

    Args:
        transactions: DataFrame with Date, Amount, Type columns.
        period: Grouping period - "month", "year", or "day".

    Returns:
        DataFrame with period, income, expenses, net, and savings_rate columns.
    """
    cash_flow = calculate_net_cash_flow(transactions, period)

    if cash_flow.empty:
        return pd.DataFrame(
            columns=["Period", "Income", "Expenses", "Net", "SavingsRate"]
        )

    # Calculate savings rate, handling zero income gracefully
    cash_flow["SavingsRate"] = cash_flow.apply(
        lambda row: (row["Net"] / row["Income"] * 100) if row["Income"] > 0 else 0.0,
        axis=1,
    )

    return cash_flow


def calculate_category_breakdown_by_type(
    transactions: pd.DataFrame, transaction_type: str, period: str = "month"
) -> pd.DataFrame:
    """Calculate category breakdown filtered by transaction type.

    Args:
        transactions: DataFrame with Date, Amount, Type, Category columns.
        transaction_type: "expense" or "income".
        period: Grouping period - "month", "year", or "day".

    Returns:
        DataFrame with period, category, and amount columns.
    """
    if transactions.empty or "Type" not in transactions.columns:
        return pd.DataFrame(columns=["Period", "Category", "Amount"])

    filtered_df = transactions[transactions["Type"] == transaction_type].copy()
    if filtered_df.empty:
        return pd.DataFrame(columns=["Period", "Category", "Amount"])

    filtered_df["Date"] = pd.to_datetime(filtered_df["Date"])

    if period == "year":
        filtered_df["Period"] = filtered_df["Date"].dt.to_period("Y")
    elif period == "day":
        filtered_df["Period"] = filtered_df["Date"].dt.to_period("D")
    else:  # default to month
        filtered_df["Period"] = filtered_df["Date"].dt.to_period("M")

    # Handle missing Category column
    if "Category" not in filtered_df.columns:
        filtered_df["Category"] = "Uncategorized"

    result = filtered_df.groupby(["Period", "Category"])["Amount"].sum().reset_index()
    return result


def get_cash_flow_totals(transactions: pd.DataFrame) -> dict:
    """Get total income, expenses, net, and savings rate for all transactions.

    Args:
        transactions: DataFrame with Date, Amount, Type columns.

    Returns:
        Dictionary with total_income, total_expenses, net, and savings_rate.
    """
    if transactions.empty or "Type" not in transactions.columns:
        return {
            "total_income": 0.0,
            "total_expenses": 0.0,
            "net": 0.0,
            "savings_rate": 0.0,
        }

    total_income = transactions[transactions["Type"] == "income"]["Amount"].sum()
    total_expenses = transactions[transactions["Type"] == "expense"]["Amount"].sum()
    net = total_income - total_expenses
    savings_rate = (net / total_income * 100) if total_income > 0 else 0.0

    return {
        "total_income": total_income,
        "total_expenses": total_expenses,
        "net": net,
        "savings_rate": savings_rate,
    }


def split_tagged_transactions(
    df: pd.DataFrame, excluded_patterns: List[str]
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Split transactions into (kept, excluded) based on tag patterns.

    Patterns are exact tags ("emergency") or trailing-star prefixes ("travel:*").
    """
    if df.empty or not excluded_patterns or "Tags" not in df.columns:
        return df, df.iloc[0:0]

    patterns = [normalize_pattern(p) for p in excluded_patterns]
    mask = df["Tags"].apply(lambda cell: cell_matches_patterns(cell, patterns))
    return df[~mask].copy(), df[mask].copy()


def exclude_tagged_transactions(
    df: pd.DataFrame, excluded_patterns: List[str]
) -> Tuple[pd.DataFrame, float]:
    """Split out transactions whose tags match any excluded pattern.

    Patterns are exact tags ("emergency") or trailing-star prefixes ("travel:*").

    Returns:
        (df without excluded rows, total expense Amount of the excluded rows)
    """
    kept, excluded_rows = split_tagged_transactions(df, excluded_patterns)
    if excluded_rows.empty:
        return kept, 0.0
    hidden_total = float(
        excluded_rows.loc[excluded_rows["Type"] == "expense", "Amount"].sum()
    )
    return kept, hidden_total


def _coverage_label(months_covered: List[int]) -> str:
    """Human label for a set of covered months, e.g. 'Sep–Dec', 'Jan', or '3 mo'.

    Contiguous runs are shown as a month-abbreviation range (or a single
    abbreviation when there's only one month). Non-contiguous coverage falls
    back to a count, since a range would misleadingly imply full coverage.
    """
    if not months_covered:
        return ""
    contiguous = all(
        b - a == 1 for a, b in zip(months_covered, months_covered[1:])
    )
    if not contiguous:
        return f"{len(months_covered)} mo"
    start = calendar.month_abbr[months_covered[0]]
    end = calendar.month_abbr[months_covered[-1]]
    return start if start == end else f"{start}–{end}"


def _align_bank_totals(
    transactions: pd.DataFrame, year: int, months_covered: List[int]
) -> dict:
    """Compute cash-flow totals restricted to (year, months_covered)."""
    if transactions is None or transactions.empty or "Date" not in transactions.columns:
        return {"total_income": 0.0, "total_expenses": 0.0, "net": 0.0, "savings_rate": 0.0}

    aligned = transactions[
        (transactions["Date"].dt.year == year)
        & (transactions["Date"].dt.month.isin(months_covered))
    ]
    return get_cash_flow_totals(aligned)


def get_enhanced_savings_totals(
    transactions: pd.DataFrame,
    payslips: pd.DataFrame,
    year: int,
    month: Optional[int] = None,
) -> Optional[dict]:
    """Combine bank net cashflow with pension contributions from payslips.

    The bank side is restricted to only the months that also have a matching
    payslip, so a partial-year payslip coverage is never compared against a
    full-year bank total (which would inflate/distort the savings rate).

    Args:
        transactions: DataFrame with Date, Amount, Type columns.
        payslips: DataFrame with PAYSLIP_COLUMNS.
        year: calendar year to match.
        month: optional 1-12; None means the whole year.

    The pension-aware rate is expressed on the SAME base as the plain bank
    savings rate (bank income), with pension added to both the amount saved and
    the income. This keeps it directly comparable to the bank-only rate rather
    than switching to a gross- or take-home-plus-pension base.

    Returns dict with pension_saved, enhanced_saved, income_with_pension,
    rate_with_pension, reconciled, months_covered, coverage_label. None if no
    payslip rows match the period.
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

    months_covered = sorted({int(str(m).split("-")[1]) for m in matched["Month"]})
    bank = _align_bank_totals(transactions, year, months_covered)

    pension_ee = float(matched["PensionEE"].sum())
    avc = float(matched["AVC"].sum())
    pension_er = float(matched["PensionER"].sum())

    pension_saved = round(pension_ee + avc + pension_er, 2)
    enhanced_saved = round(bank["net"] + pension_saved, 2)
    # Same base as the bank savings rate: bank income with pension added.
    income_with_pension = round(bank["total_income"] + pension_saved, 2)
    rate_with_pension = (
        (enhanced_saved / income_with_pension * 100) if income_with_pension > 0 else 0.0
    )

    return {
        "pension_saved": pension_saved,
        "enhanced_saved": enhanced_saved,
        "income_with_pension": income_with_pension,
        "rate_with_pension": rate_with_pension,
        "reconciled": bool(matched["YTDReconciled"].all()),
        "months_covered": months_covered,
        "coverage_label": _coverage_label(months_covered),
    }
