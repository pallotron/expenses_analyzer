import pandas as pd


def apply_filters(df: pd.DataFrame, filters: dict) -> pd.DataFrame:
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
                filtered_df = filtered_df[
                    filtered_df[column].str.contains(value, case=False, na=False)
                ]
            elif op == "==":
                filtered_df = filtered_df[filtered_df[column] == value]
        except (ValueError, TypeError):
            pass
    return filtered_df
