# Expense Analyzer

[![codecov](https://codecov.io/gh/pallotron/expenses_analyzer/branch/main/graph/badge.svg)](https://codecov.io/gh/pallotron/expenses_analyzer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)

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

- **Import Transactions**: Import your financial transactions from CSV files (recommended, most stable).
- **Bank Integration** (experimental): Link your bank accounts via TrueLayer (UK/Europe) to automatically sync transactions. This feature is still experimental; CSV import is more reliable.
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

   ```bash
   make install
   ```

3. **Run the application:**
   You can now run the application from any directory:

   ```bash
   expenses-analyzer
   ```

### Developer Setup

If you want to work on the code, the recommended approach is to use the Makefile which handles virtual environment creation and dependency installation using `uv`:

1. **Clone the repository:**

   ```bash
   git clone https://github.com/pallotron/expense-analyzer.git
   cd expense-analyzer
   ```

2. **Ensure you have Python 3.12+:**

   ```bash
   python3 --version
   ```

3. **Set up the development environment:**

   ```bash
   make venv
   source .venv/bin/activate
   ```

   This will create a virtual environment using `uv` and install all dependencies.

## Additional Tools

The project includes additional scripts in the `tools/` directory that can be used to interact with the application's data directly.

- **`tools/validate_data.py`**: This script provides an example of how to access and validate the `transactions.parquet` database file. It performs checks for data quality, missing values, and duplicates, and provides summaries of key columns. You can run it using:

  ```bash
  uv run python tools/validate_data.py
  ```

## Screenshots

Here’s a glimpse of what Expense Analyzer looks like in action.

### Summary screen

![Summary Screen](screenshots/summary.png)

![Summary Screen](screenshots/summary-monthly.png)

View your expenses summarized by year and month, with a breakdown by category.
Cells are clickable to drill down into more detailed views.
You can some bar charts to visualize your spending patterns over time.
Trend indicators help you see how your spending is changing month over month.

### Transactions screen

![Transactions Screen](screenshots/transactions.png)

Browse through your individual transactions with ease. Filter by date, category, or merchant to find exactly what you're looking for.

### Categorization Screen

![Categorize Screen](screenshots/categorize-merchants.jpg)

Easily categorize new merchants that the application hasn't seen before or move existing merchants to different categories. You can assign categories quickly to keep your data organized.
Toggle multiple selections with the spacebar, enter the new category, and click "Apply Category" to update all selected merchants at once, once you are happy click "Save Changes" to persist the changes on disk.

## Importing Data

For detailed instructions on how to import your financial data, please see the [Importing Data Guide](docs/IMPORTING_DATA.md). This guide covers:

- Importing transactions from CSV files.
- Optional direct bank integration with TrueLayer (for UK/Europe).
- An overview of how your data is processed and stored.

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
