import pandas as pd
from pathlib import Path

TRANSACTIONS_FILE: Path = (
    Path.home() / ".config" / "expenses_analyzer" / "transactions.parquet"
)


def validate_parquet_file() -> None:
    """
    Validates the transactions.parquet file for data quality issues.
    """
    if not TRANSACTIONS_FILE.exists():
        print(f"Parquet file not found at: {TRANSACTIONS_FILE}")
        return

    print(f"Reading parquet file from: {TRANSACTIONS_FILE}")
    df = pd.read_parquet(TRANSACTIONS_FILE)

    print("\n--- File Info ---")
    print(f"Number of transactions: {len(df)}")
    print(f"Columns: {df.columns.tolist()}")

    print("\n--- Data Types ---")
    print(df.dtypes)

    print("\n--- Missing Values ---")
    missing_values = df.isnull().sum()
    print(missing_values)

    # Display rows with missing values
    if missing_values.sum() > 0:
        print("\n--- Rows with Missing Values ---")
        missing_rows = df[df.isnull().any(axis=1)]
        print(missing_rows.to_string())

    print("\n--- Duplicate Rows ---")
    print(f"Number of duplicate rows: {df.duplicated().sum()}")

    if "Amount" in df.columns:
        print("\n--- Amount Column Summary ---")
        if pd.api.types.is_numeric_dtype(df["Amount"]):
            print(df["Amount"].describe())
        else:
            print("'Amount' column is not numeric. Investigating...")
            numeric_amount = pd.to_numeric(df["Amount"], errors="coerce")
            non_numeric_rows = df[numeric_amount.isnull() & df["Amount"].notnull()]
            print(
                f"Found {len(non_numeric_rows)} non-numeric values in 'Amount' column."
            )
            if not non_numeric_rows.empty:
                print("Rows with non-numeric 'Amount' values:")
                print(non_numeric_rows.to_string())

    if "Merchant" in df.columns:
        print("\n--- Merchant Column Summary ---")
        print(f"Number of unique merchants: {df['Merchant'].nunique()}")
        print("Top 10 merchants by transaction count:")
        print(df["Merchant"].value_counts().head(10))


if __name__ == "__main__":
    validate_parquet_file()
