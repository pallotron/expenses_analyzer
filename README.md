# Expense Analyzer

A Textual TUI application for analyzing your personal expenses.

## Features

- **Import Transactions**: Import your financial transactions from CSV files.
- **Automatic Categorization**: Automatically categorizes your expenses using Google's Generative AI.
- **Expense Summary**: View a summary of your expenses, broken down by year and month.
- **Category Breakdown**: See a detailed breakdown of your spending by category.
- **Transaction Viewer**: Browse and review individual transactions.
- **Data Deletion**: Remove transactions you don't want to track.

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/pallotron/expense-analyzer.git
   cd expense-analyzer
   ```

2. **Install `uv`:**
   We recommend using `uv`, a fast Python package installer and resolver. If you don't have it, you can install it with Homebrew:

   ```bash
   brew install uv
   ```

3. **Ensure you have Python 3.12+:**
   You can check available Python versions with `uv`:

   ```bash
   uv python list
   ```

   If you don't have Python 3.12 or newer, please install it.

4. **Create a virtual environment:**

   ```bash
   uv venv
   source .venv/bin/activate
   ```

5. **Install the dependencies:**

   ```bash
   uv pip install -r requirements.txt
   ```

## Usage

To run the application, use the following command:

```bash
uv run python main.py
```

## Screenshots

Here’s a glimpse of what Expense Analyzer looks like in action.

| Summary Screen                             | Transactions Screen                                  | Categorize Merchants                                      |
| ------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| ![Summary Screen](screenshots/Summary.svg) | ![Transactions Screen](screenshots/Transactions.svg) | ![Categorize Screen](screenshots/CategorizeMerchants.svg) |

## Importing Data

To get started, you'll need to import your transaction data. The application supports importing CSV files.

1. **Navigate to the Import Screen**: Once the application is running, press `i` to go to the "Import" screen.

   ![Import Screen](screenshots/Import-001-Start.svg)

2. **Select your CSV file(s)**: Use the file browser to navigate to and select the CSV file(s) you wish to import.

   ![File Browser](screenshots/Import-002-Browse.svg)

3. **Map Columns**: The application will show a preview of your CSV and guide you through mapping your columns (e.g., 'Date', 'Merchant', 'Amount') to the application's internal fields.

   ![Map Columns](screenshots/Import-003-CSV_File_Preview.svg)

4. **Confirm Import**: After mapping the columns, review the transactions and confirm the import. New transactions will be added to your records.

## Automatic Categorization with Gemini

The application can use the Google Gemini API to automatically suggest categories for new merchants it hasn't seen before. This is an optional feature.

### Setup

1. **Get a Gemini API Key**: Obtain an API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. **Set the Environment Variable**: For the application to access the key, you must set the `GEMINI_API_KEY` environment variable. You can do this in your shell's configuration file (e.g., `.zshrc`, `.bash_profile`), or by exporting it in your terminal session before running the app:

   ```bash
   export GEMINI_API_KEY="YOUR_API_KEY_HERE"
   ```

If the `GEMINI_API_KEY` is not set, the application will skip the automatic categorization step, and you will need to categorize new merchants manually.

## Configuration

The application stores its data, including transactions and category mappings, in a central configuration directory.

- **Default Location**: `~/.config/expenses_analyzer/`
- **Custom Location**: You can change the storage location by setting the `EXPENSES_ANALYZER_CONFIG_DIR` environment variable:

  ```bash
  export EXPENSES_ANALYZER_CONFIG_DIR="/path/to/your/custom/config"
  ```

The following files are stored in this directory:

- `categories.json`: Stores the mapping of merchants to categories.
- `transactions.parquet`: Stores your financial transactions.
- `app.log`: The application log file.
