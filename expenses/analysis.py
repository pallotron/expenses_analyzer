from typing import List, Tuple

import pandas as pd


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
