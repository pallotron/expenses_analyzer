import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd
from fpdf import FPDF

from expenses.analysis import get_cash_flow_totals
from expenses.config import EXPORTS_DIR
from expenses.data_handler import load_category_types, get_category_spending_type


def format_currency(amount: float) -> str:
    """Format amount as currency string."""
    return f"${amount:,.2f}"


def create_base_pdf(title: str) -> FPDF:
    """Create PDF with standard header styling."""
    pdf = FPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    # Header
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "EXPENSE ANALYZER", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(
        0,
        6,
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    return pdf


def add_section_title(pdf: FPDF, title: str) -> None:
    """Add a section title to the PDF."""
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_fill_color(230, 230, 230)
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(2)


def add_table(
    pdf: FPDF,
    headers: list[str],
    rows: list[list[str]],
    col_widths: list[int],
    right_align: Optional[list[bool]] = None,
) -> None:
    """Render a table to PDF.

    Args:
        pdf: The FPDF instance.
        headers: Column header strings.
        rows: List of row data (each row is a list of strings).
        col_widths: Width of each column in mm.
        right_align: Optional list of bools indicating right-alignment per column.
    """
    if right_align is None:
        right_align = [False] * len(headers)

    # Header row
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(50, 50, 50)
    pdf.set_text_color(255, 255, 255)
    for i, header in enumerate(headers):
        align = "R" if right_align[i] else "L"
        pdf.cell(col_widths[i], 7, header, border=1, fill=True, align=align)
    pdf.ln()

    # Data rows
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(0, 0, 0)
    for row_idx, row in enumerate(rows):
        fill = row_idx % 2 == 1
        if fill:
            pdf.set_fill_color(245, 245, 245)
        for i, cell in enumerate(row):
            align = "R" if right_align[i] else "L"
            pdf.cell(
                col_widths[i], 6, str(cell), border=1, fill=fill, align=align
            )
        pdf.ln()


def _get_period_label(year: Optional[int], month: Optional[int]) -> str:
    """Build a human-readable period label."""
    if year and month:
        return datetime(year, month, 1).strftime("%B %Y")
    elif year:
        return str(year)
    return "All Time"


def _ensure_exports_dir() -> Path:
    """Create the exports directory if it doesn't exist and return its path."""
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return EXPORTS_DIR


def export_summary_pdf(
    transactions: pd.DataFrame,
    categories: dict,
    year: Optional[int] = None,
    month: Optional[int] = None,
    source_filter: Optional[set[str]] = None,
    output_path: Optional[str] = None,
) -> str:
    """Export summary report to PDF.

    Contains:
    - Report period and generation date
    - Cash flow summary (income, expenses, net, savings rate)
    - Expense categories breakdown table
    - Income categories breakdown table
    - Top 10 expense merchants
    - Top 10 income sources
    - Monthly breakdown table (if viewing yearly data)

    Returns: Path to generated PDF file
    """
    # Prepare data
    df = transactions.copy()
    if df.empty:
        raise ValueError("No transactions to export")

    df["Date"] = pd.to_datetime(df["Date"])
    if "Category" not in df.columns:
        df["Category"] = df["Merchant"].map(categories).fillna("Other")

    # Apply source filter
    if source_filter and "Source" in df.columns:
        df = df[df["Source"].isin(source_filter)]

    # Apply period filter
    if year:
        df = df[df["Date"].dt.year == year]
    if month:
        df = df[df["Date"].dt.month == month]

    if df.empty:
        raise ValueError("No transactions match the selected filters")

    period_label = _get_period_label(year, month)
    pdf = create_base_pdf(f"Summary Report - {period_label}")

    # --- Cash Flow Summary ---
    add_section_title(pdf, "CASH FLOW SUMMARY")
    totals = get_cash_flow_totals(df)
    category_types = load_category_types()

    cash_flow_rows = [
        ["Total Income", format_currency(totals["total_income"])],
        ["Total Expenses", format_currency(totals["total_expenses"])],
        ["Net", format_currency(totals["net"])],
        ["Savings Rate", f"{totals['savings_rate']:.1f}%"],
    ]

    # Calculate essential/discretionary breakdown
    if "Type" in df.columns:
        exp_df = df[df["Type"] == "expense"]
    else:
        exp_df = df
    if not exp_df.empty and "Category" in exp_df.columns:
        ess_total = 0.0
        disc_total = 0.0
        for _, r in exp_df.iterrows():
            stype = get_category_spending_type(r["Category"], category_types)
            if stype == "essential":
                ess_total += r["Amount"]
            else:
                disc_total += r["Amount"]
        total_exp = ess_total + disc_total
        ess_pct = (ess_total / total_exp * 100) if total_exp > 0 else 0
        disc_pct = (disc_total / total_exp * 100) if total_exp > 0 else 0
        cash_flow_rows.append(
            ["Essential Expenses", f"{format_currency(ess_total)} ({ess_pct:.0f}%)"]
        )
        cash_flow_rows.append(
            ["Discretionary Expenses", f"{format_currency(disc_total)} ({disc_pct:.0f}%)"]
        )

        # Budget tracking
        ess_annual = category_types.get("essential", {}).get("annual_budget")
        disc_annual = category_types.get("discretionary", {}).get("annual_budget")
        divisor = 12 if month else 1
        label = "/mo" if month else "/yr"
        if ess_annual is not None:
            ess_budget = ess_annual / divisor
            ess_used = (ess_total / ess_budget * 100) if ess_budget > 0 else 0
            cash_flow_rows.append(
                [f"Essential Budget ({label.strip('/')})", f"{format_currency(ess_budget)} - {ess_used:.0f}% used"]
            )
        if disc_annual is not None:
            disc_budget = disc_annual / divisor
            disc_used = (disc_total / disc_budget * 100) if disc_budget > 0 else 0
            cash_flow_rows.append(
                [f"Discretionary Budget ({label.strip('/')})", f"{format_currency(disc_budget)} - {disc_used:.0f}% used"]
            )

    add_table(pdf, ["Metric", "Value"], cash_flow_rows, [60, 60], [False, True])
    pdf.ln(4)

    # --- Expense Categories ---
    if "Type" in df.columns:
        expense_df = df[df["Type"] == "expense"]
    else:
        expense_df = df

    if not expense_df.empty:
        add_section_title(pdf, "EXPENSE CATEGORIES")
        cat_summary = (
            expense_df.groupby("Category")["Amount"]
            .sum()
            .sort_values(ascending=False)
            .reset_index()
        )
        total_expenses = cat_summary["Amount"].sum()

        expense_rows = []
        for _, row in cat_summary.iterrows():
            pct = (row["Amount"] / total_expenses * 100) if total_expenses > 0 else 0
            stype = get_category_spending_type(row["Category"], category_types)
            type_label = "Ess." if stype == "essential" else "Discr."
            expense_rows.append(
                [row["Category"], type_label, format_currency(row["Amount"]), f"{pct:.1f}%"]
            )
        expense_rows.append(
            ["TOTAL", "", format_currency(total_expenses), "100.0%"]
        )
        add_table(
            pdf,
            ["Category", "Type", "Amount", "%"],
            expense_rows,
            [70, 20, 45, 25],
            [False, False, True, True],
        )
        pdf.ln(4)

    # --- Income Categories ---
    if "Type" in df.columns:
        income_df = df[df["Type"] == "income"]
        if not income_df.empty:
            add_section_title(pdf, "INCOME CATEGORIES")
            income_cat = (
                income_df.groupby("Category")["Amount"]
                .sum()
                .sort_values(ascending=False)
                .reset_index()
            )
            total_income = income_cat["Amount"].sum()

            income_rows = []
            for _, row in income_cat.iterrows():
                pct = (
                    (row["Amount"] / total_income * 100) if total_income > 0 else 0
                )
                income_rows.append(
                    [row["Category"], format_currency(row["Amount"]), f"{pct:.1f}%"]
                )
            income_rows.append(
                ["TOTAL", format_currency(total_income), "100.0%"]
            )
            add_table(
                pdf,
                ["Category", "Amount", "%"],
                income_rows,
                [80, 50, 30],
                [False, True, True],
            )
            pdf.ln(4)

    # --- Top 10 Expense Merchants ---
    if not expense_df.empty:
        add_section_title(pdf, "TOP EXPENSE MERCHANTS")
        merchant_col = (
            "DisplayMerchant" if "DisplayMerchant" in expense_df.columns else "Merchant"
        )
        merchant_summary = (
            expense_df.groupby(merchant_col, as_index=False)
            .agg(
                {
                    "Amount": "sum",
                    "Category": lambda x: x.mode()[0] if len(x.mode()) > 0 else "Other",
                }
            )
            .sort_values("Amount", ascending=False)
            .head(10)
        )
        merchant_rows = []
        for _, row in merchant_summary.iterrows():
            stype = get_category_spending_type(row["Category"], category_types)
            type_label = "Ess." if stype == "essential" else "Discr."
            merchant_rows.append(
                [row[merchant_col], row["Category"], type_label, format_currency(row["Amount"])]
            )
        add_table(
            pdf,
            ["Merchant", "Category", "Type", "Amount"],
            merchant_rows,
            [80, 45, 20, 45],
            [False, False, False, True],
        )
        pdf.ln(4)

    # --- Top 10 Income Sources ---
    if "Type" in df.columns:
        income_df = df[df["Type"] == "income"]
        if not income_df.empty:
            add_section_title(pdf, "TOP INCOME SOURCES")
            merchant_col = (
                "DisplayMerchant"
                if "DisplayMerchant" in income_df.columns
                else "Merchant"
            )
            income_merchant = (
                income_df.groupby(merchant_col, as_index=False)
                .agg(
                    {
                        "Amount": "sum",
                        "Category": lambda x: (
                            x.mode()[0] if len(x.mode()) > 0 else "Other"
                        ),
                    }
                )
                .sort_values("Amount", ascending=False)
                .head(10)
            )
            income_source_rows = [
                [row[merchant_col], row["Category"], format_currency(row["Amount"])]
                for _, row in income_merchant.iterrows()
            ]
            add_table(
                pdf,
                ["Source", "Category", "Amount"],
                income_source_rows,
                [90, 50, 50],
                [False, False, True],
            )
            pdf.ln(4)

    # --- Monthly Breakdown (only for yearly view, not monthly) ---
    if year and not month and not expense_df.empty:
        add_section_title(pdf, "MONTHLY EXPENSE BREAKDOWN")
        monthly = expense_df.pivot_table(
            index="Category",
            columns=expense_df["Date"].dt.month,
            values="Amount",
            aggfunc="sum",
            fill_value=0,
        )
        for m in range(1, 13):
            if m not in monthly.columns:
                monthly[m] = 0
        monthly = monthly[sorted(monthly.columns)]

        month_names = [datetime(2000, m, 1).strftime("%b") for m in range(1, 13)]
        monthly.columns = month_names
        monthly["Total"] = monthly.sum(axis=1)
        non_zero = (monthly[month_names] > 0).sum(axis=1)
        monthly["Avg"] = monthly["Total"].divide(non_zero).fillna(0)
        monthly = monthly.sort_values("Total", ascending=False)

        headers = ["Category", "Type"] + month_names + ["Total", "Avg"]
        # Adjusted widths for landscape: ~277mm usable
        cat_w = 30
        type_w = 14
        month_w = 16
        total_w = 20
        avg_w = 20
        col_widths = [cat_w, type_w] + [month_w] * 12 + [total_w, avg_w]
        right_align = [False, False] + [True] * 14

        monthly_rows = []
        for cat_name, row in monthly.iterrows():
            stype = get_category_spending_type(str(cat_name), category_types)
            type_label = "Ess." if stype == "essential" else "Discr."
            cells = [str(cat_name), type_label]
            for mn in month_names:
                val = row[mn]
                cells.append(f"{val:,.0f}" if val > 0 else "-")
            cells.append(f"{row['Total']:,.0f}")
            cells.append(f"{row['Avg']:,.0f}")
            monthly_rows.append(cells)

        # Total row
        total_cells = ["TOTAL", ""]
        for mn in month_names:
            val = monthly[mn].sum()
            total_cells.append(f"{val:,.0f}" if val > 0 else "-")
        total_cells.append(f"{monthly['Total'].sum():,.0f}")
        total_cells.append(f"{monthly['Total'].sum() / 12:,.0f}")
        monthly_rows.insert(0, total_cells)

        add_table(pdf, headers, monthly_rows, col_widths, right_align)

    # --- Save ---
    exports_dir = _ensure_exports_dir()
    if output_path:
        filepath = output_path
    else:
        period_slug = f"{year}" if year else "all"
        if month:
            period_slug += f"-{month:02d}"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = str(exports_dir / f"summary_{period_slug}_{timestamp}.pdf")

    pdf.output(filepath)
    logging.info(f"Summary PDF exported to {filepath}")
    return filepath


def export_transactions_pdf(
    transactions: pd.DataFrame,
    categories: Optional[dict] = None,
    filters_description: Optional[str] = None,
    output_path: Optional[str] = None,
) -> str:
    """Export transactions report to PDF.

    Contains:
    - Applied filters summary
    - Cash flow totals for filtered data
    - Transaction list table (Date, Merchant, Amount, Type, Category, Source)
    - Merchant summary table

    Returns: Path to generated PDF file
    """
    df = transactions.copy()
    if df.empty:
        raise ValueError("No transactions to export")

    df["Date"] = pd.to_datetime(df["Date"])
    if categories and "Category" not in df.columns:
        df["Category"] = df["Merchant"].map(categories).fillna("Other")
    elif "Category" not in df.columns:
        df["Category"] = "Other"

    if "Type" not in df.columns:
        df["Type"] = "expense"

    pdf = create_base_pdf("Transactions Report")

    # --- Filters Applied ---
    if filters_description:
        add_section_title(pdf, "FILTERS APPLIED")
        pdf.set_font("Helvetica", "", 8)
        pdf.multi_cell(0, 5, filters_description)
        pdf.ln(2)

    # --- Summary ---
    add_section_title(pdf, "SUMMARY")
    totals = get_cash_flow_totals(df)
    summary_rows = [
        ["Total Income", format_currency(totals["total_income"])],
        ["Total Expenses", format_currency(totals["total_expenses"])],
        ["Net", format_currency(totals["net"])],
        ["Transaction Count", str(len(df))],
    ]
    add_table(pdf, ["Metric", "Value"], summary_rows, [60, 60], [False, True])
    pdf.ln(4)

    # --- Transactions Table ---
    add_section_title(pdf, "TRANSACTIONS")
    merchant_col = (
        "DisplayMerchant" if "DisplayMerchant" in df.columns else "Merchant"
    )

    # Sort by date descending
    df = df.sort_values("Date", ascending=False)

    tx_rows = []
    for _, row in df.iterrows():
        date_str = row["Date"].strftime("%Y-%m-%d") if pd.notna(row["Date"]) else ""
        merchant = str(row.get(merchant_col, row.get("Merchant", ""))) or ""
        amount = f"{row['Amount']:,.2f}" if pd.notna(row["Amount"]) else ""
        tx_type = str(row.get("Type", "expense")).capitalize()
        category = str(row.get("Category", "Other"))
        source = str(row.get("Source", "Unknown")) or "Unknown"
        tx_rows.append([date_str, merchant, amount, tx_type, category, source])

    # Landscape A4: ~277mm usable width
    tx_widths = [22, 80, 30, 20, 40, 60]
    tx_align = [False, False, True, False, False, False]
    add_table(
        pdf,
        ["Date", "Merchant", "Amount", "Type", "Category", "Source"],
        tx_rows,
        tx_widths,
        tx_align,
    )
    pdf.ln(4)

    # --- Merchant Summary ---
    add_section_title(pdf, "MERCHANT SUMMARY")
    merchant_agg = (
        df.groupby(merchant_col, as_index=False)
        .agg(
            {
                "Amount": ["sum", "count"],
                "Category": lambda x: x.mode()[0] if len(x.mode()) > 0 else "Other",
            }
        )
    )
    merchant_agg.columns = ["Merchant", "Total", "Count", "Category"]
    merchant_agg = merchant_agg.sort_values("Total", ascending=False)

    merch_rows = [
        [
            row["Merchant"],
            format_currency(row["Total"]),
            str(int(row["Count"])),
            row["Category"],
        ]
        for _, row in merchant_agg.iterrows()
    ]
    add_table(
        pdf,
        ["Merchant", "Total", "Count", "Category"],
        merch_rows,
        [90, 40, 20, 50],
        [False, True, True, False],
    )

    # --- Save ---
    exports_dir = _ensure_exports_dir()
    if output_path:
        filepath = output_path
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = str(exports_dir / f"transactions_{timestamp}.pdf")

    pdf.output(filepath)
    logging.info(f"Transactions PDF exported to {filepath}")
    return filepath
