# Expense Analyzer

A Textual TUI application for analyzing your personal expenses.

## Story time

This project was born out of a combination of necessity and curiosity. After an injury left me with limited mobility and a lot of time on my hands, I found myself wanting to get a better handle on my expenses. I have multiple bank accounts, and I've always been frustrated by the subpar reporting and data export features they offer.

Even modern fintech apps like Revolut, which I love for many reasons, have their own quirks and limitations. For instance, their expense and cash flow reporting features are great, the integration with PTSB is ok and allows me to import the transactions into Revolut, but it's missing direct debits, and there's no sign of a fix in sight.

With my typing ability temporarily reduced, I needed a project that I could work on in short bursts, something that didn't require constant, strenuous typing. This seemed like the perfect opportunity to give "vibe coding" a try.

I decided to build a tool that would finally let me consolidate and analyze my expenses data in a way that made sense to me.

At the same time, I'd been wanting to learn [Textual](https://textual.textualize.io/), a TUI (Text User Interface) framework for Python. The idea of building a powerful, interactive, and terminal-based application was really appealing. So, I decided to combine these goals and create Expense Analyzer. It's a personal tool, born out of a specific set of circumstances, but I hope it can be useful to others who share my frustrations with personal finance management.

It's still a work in progress, but it should be useful enough for geeks like us.
Please contribute if you can or report bugs/issues!

## Features

- **Import Transactions**: Import your financial transactions from CSV files.
- **Automatic Categorization**: Automatically categorizes your expenses using Google's Generative AI.
- **Expense Summary**: View a summary of your expenses, broken down by year and month.
- **Category Breakdown**: See a detailed breakdown of your spending by category.
- **Transaction Viewer**: Browse and review individual transactions.
- **Data Deletion**: Remove transactions you don't want to track.

## Installation

### System-Wide Installation

With the project now packaged, you can install it system-wide using `pip`. This will add an `expenses-analyzer` command to your path.

1. **Clone the repository:**

   ```bash
   git clone https://github.com/pallotron/expense-analyzer.git
   cd expense-analyzer
   ```

2. **Install the package:**
   For the best experience, it's recommended to install command-line tools with `pipx` to avoid dependency conflicts with other Python packages:

   ```bash
   pipx install .
   ```

   Alternatively, you can use `pip`:

   ```bash
   pip install .
   ```

3. **Run the application:**
   You can now run the application from any directory:

   ```bash
   expenses-analyzer
   ```

### Developer Setup

If you want to work on the code, you can follow the steps below to set up a development environment.

1. **Clone the repository:**

   ```bash
   git clone https://github.com/pallotron/expense-analyzer.git
   cd expense-analyzer
   ```

2. **Ensure you have Python 3.12+:**

   ```bash
   python3 --version
   ```

3. **Create a virtual environment:**

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

4. **Install the dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

#### Alternative Installation with `uv`

If you have `uv` installed, you can follow these steps instead:

1. **Clone the repository:**

   ```bash
   git clone https://github.com/pallotron/expense-analyzer.git
   cd expense-analyzer
   ```

2. **Ensure you have Python 3.12+:**
   You can check available Python versions with `uv`:

   ```bash
   uv python list
   ```

   If you don't have Python 3.12 or newer, please install it.

3. **Create a virtual environment:**

   ```bash
   uv venv
   source .venv/bin/activate
   ```

4. **Install the dependencies:**

   ```bash
   uv pip install -r requirements.txt
   ```

## Usage

To run the application after system-wide installation, simply use:

```bash
expenses-analyzer
```

If you are in a developer setup with `uv` activated, you can also use:

```bash
uv run expenses-analyzer
```

## Additional Tools

The project includes additional scripts in the `tools/` directory that can be used to interact with the application's data directly.

- **`tools/validate_data.py`**: This script provides an example of how to access and validate the `transactions.parquet` database file. It performs checks for data quality, missing values, and duplicates, and provides summaries of key columns. You can run it using:

  ```bash
  uv run python tools/validate_data.py
  ```

## Screenshots

Here’s a glimpse of what Expense Analyzer looks like in action.

### Summary screen

![Summary Screen](screenshots/Summary.svg)

View your expenses summarized by year and month, with a breakdown by category.
Cells are clickable to drill down into more detailed views.

### Transactions screen

![Transactions Screen](screenshots/Transactions.svg)

Browse through your individual transactions with ease. Filter by date, category, or merchant to find exactly what you're looking for.

### Categorization Screen

![Categorize Screen](screenshots/CategorizeMerchants.svg)

Easily categorize new merchants that the application hasn't seen before or move existing merchants to different categories. You can assign categories quickly to keep your data organized.
Toggle multiple selections with the spacebar, enter the new category, and click "Apply Category" to update all selected merchants at once, once you are happy click "Save Changes" to persist the changes on disk.

## Importing Data

To get started, you'll need to import your transaction data. The application supports importing CSV files.

1. **Navigate to the Import Screen**: Once the application is running, press `i` to go to the "Import" screen.

   ![Import Screen](screenshots/Import-001-Start.svg)

2. **Select your CSV file(s)**: Use the file browser to navigate to and select the CSV file(s) you wish to import.

   ![File Browser](screenshots/Import-002-Browse.svg)

3. **Map Columns**: The application will show a preview of your CSV and guide you through mapping your columns (e.g., 'Date', 'Merchant', 'Amount') to the application's internal fields.

   ![Map Columns](screenshots/Import-003-CSV_File_Preview.svg)

4. **Confirm Import**: After mapping the columns, review the transactions and confirm the import. New transactions will be added to your records.

## Data Processing with Pandas and Parquet

Under the hood, Expense Analyzer uses powerful and efficient libraries to handle your financial data.

- **Data Import and Cleaning**: When you import a CSV file, the data is loaded into a **Pandas DataFrame**. This allows for flexible and powerful data manipulation. The application cleans the data, standardizes column names, and handles different data types to ensure consistency.

- **Storage**: Once processed, your transaction data is stored in the **Parquet** format. Parquet is a columnar storage file format that is highly efficient for analytics. It offers excellent compression and performance, which means your data is stored compactly and can be queried quickly. This is especially useful as your transaction history grows over time.

- **Data Access**: Whenever you view your transactions or summaries, the application reads the Parquet file back into a Pandas DataFrame to perform calculations and display the data. This ensures that the application remains fast and responsive, even with large datasets.

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
