# Importing and Processing Data

This document outlines the various methods for importing your financial data into Expense Analyzer, how the data is processed, and how to set up optional direct bank integration.

## CSV Import

To get started, you'll need to import your transaction data. The application supports importing CSV files.

1. **Navigate to the Import Screen**: Once the application is running, press `i` to go to the "Import" screen.

   ![Import Screen](screenshots/import-001-start.jpg)

2. **Select your CSV file(s)**: Use the file browser to navigate to and select the CSV file(s) you wish to import.

   ![File Browser](screenshots/import-002-browse.jpg)

3. **Map Columns**: The application will show a preview of your CSV and guide you through mapping your columns (e.g., 'Date', 'Merchant', 'Amount') to the application's internal fields.

   ![Map Columns](screenshots/import-003-csv-preview.jpg)

4. **Confirm Import**: After mapping the columns, review the transactions and confirm the import. New transactions will be added to your records.

## Recommended Workflow: Combining CSV and Bank Sync

For the most complete financial history, we recommend a two-stage approach:

1.  **Bootstrap Your History with CSV**:
    Log in to your bank's website and export your transaction history as a CSV file. To get a full picture, export data from the beginning of your desired tracking period (e.g., January 1st) up to about 90 days ago. Use the CSV import process described above to load this data into the application.

2.  **Automate the Present with Bank Sync**:
    After your historical data is loaded, use the **TrueLayer** integration to connect your bank account. The first sync will automatically fetch the last 90 days of transactions and, from then on, you can sync to get new transactions as they happen.

**Why this approach?**

Due to Open Banking regulations, most banks only provide the most recent **90 days** of transaction history via their APIs. This means the initial sync won't retrieve your entire history. By importing a CSV first, you create a complete historical record, and then use the bank integration for the convenience of automated updates going forward. The application intelligently handles any small overlaps between your CSV and your first bank sync to prevent duplicate entries.

## Bank Account Integration (Optional)

The application can automatically sync transactions directly from your bank accounts using **TrueLayer** (UK/European banks). This is an optional feature that requires a developer account.

### Quick Comparison

| Feature | TrueLayer |
|---------|-----------|
| **Best For** | UK, Ireland, Europe |
| **Keybinding** | Press `Shift+L` |
| **Free Tier** | Sandbox: unlimited |
| **Setup** | [TrueLayer Setup Guide](TRUELAYER_SETUP.md) |

### TrueLayer Integration (UK/Europe)

TrueLayer provides access to banks in the UK, Ireland, and across Europe.

**Quick Setup:**
```bash
export TRUELAYER_CLIENT_ID="your_client_id"
export TRUELAYER_CLIENT_SECRET="your_client_secret"
export TRUELAYER_ENV="sandbox"  # or "production"

# Optional: customize scopes and providers
export TRUELAYER_SCOPES="info accounts balance transactions offline_access"
export TRUELAYER_PROVIDERS="uk-ob-all uk-oauth-all ie-ob-all"
```

📖 **[Full TrueLayer Setup Guide](TRUELAYER_SETUP.md)**

### Without Bank Integration

Don't want to use bank APIs? No problem! You can still use the application by importing CSV exports from your bank's website (press `i` for the Import screen). The CSV import feature works great and doesn't require any external API credentials.

## Data Processing with Pandas and Parquet

Under the hood, Expense Analyzer uses powerful and efficient libraries to handle your financial data.

- **Data Import and Cleaning**: When you import a CSV file, the data is loaded into a **Pandas DataFrame**. This allows for flexible and powerful data manipulation. The application cleans the data, standardizes column names, and handles different data types to ensure consistency.

- **Storage**: Once processed, your transaction data is stored in the **Parquet** format. Parquet is a columnar storage file format that is highly efficient for analytics. It offers excellent compression and performance, which means your data is stored compactly and can be queried quickly. This is especially useful as your transaction history grows over time.

- **Data Access**: Whenever you view your transactions or summaries, the application reads the Parquet file back into a Pandas DataFrame to perform calculations and display the data. This ensures that the application remains fast and responsive, even with large datasets.
