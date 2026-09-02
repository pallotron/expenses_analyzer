import pandas as pd
from typing import Any, Dict, Optional, Tuple


def _unquote(value: Any) -> Optional[str]:
    """The text inside a "quoted" filter value, or None if it is not quoted.

    Quoting is how a caller asks for an exact match instead of a substring
    search: drill-downs from the Summary screen quote what they pass, so
    clicking a merchant called "NS" does not also pull in "Bunsen".
    """
    text = str(value)
    if len(text) >= 2 and text.startswith('"') and text.endswith('"'):
        return text[1:-1]
    return None


def apply_filters(
    df: pd.DataFrame, filters: Dict[str, Tuple[str, str, Any]]
) -> pd.DataFrame:
    """Applies a set of filters to a DataFrame.

    Args:
        df: The DataFrame to filter.
        filters: A dictionary of filters to apply. The keys are the filter names,
            and the values are tuples of (column, operator, value).

    Returns:
        The filtered DataFrame.
    """
    filtered_df = df.copy()
    for filter_name, (column, op, value) in filters.items():
        if value is None or value == "" or pd.isna(value):
            continue

        try:
            if op == ">=":
                filtered_df = filtered_df[filtered_df[column] >= value]
            elif op == "<=":
                filtered_df = filtered_df[filtered_df[column] <= value]
            elif op == "contains":
                exact = _unquote(value)
                if exact is not None:
                    filtered_df = filtered_df[
                        filtered_df[column].astype(str).str.casefold()
                        == exact.casefold()
                    ]
                else:
                    filtered_df = filtered_df[
                        filtered_df[column].str.contains(
                            value, case=False, na=False, regex=False
                        )
                    ]
            elif op == "==":
                filtered_df = filtered_df[filtered_df[column] == value]
        except (ValueError, TypeError):
            pass
    return filtered_df
