import os
import tempfile

import pandas as pd
import pytest

from expenses.pdf_export import (
    export_summary_pdf,
    export_transactions_pdf,
    format_currency,
    create_base_pdf,
)


@pytest.fixture
def sample_transactions():
    """Create sample transaction data for testing."""
    return pd.DataFrame(
        {
            "Date": pd.to_datetime(
                [
                    "2024-01-05",
                    "2024-01-10",
                    "2024-01-15",
                    "2024-02-01",
                    "2024-02-10",
                    "2024-03-01",
                ]
            ),
            "Merchant": [
                "Whole Foods",
                "Shell Gas",
                "Employer Inc",
                "Trader Joes",
                "Electric Co",
                "Employer Inc",
            ],
            "Amount": [85.50, 45.00, 5000.00, 62.30, 120.00, 5000.00],
            "Type": ["expense", "expense", "income", "expense", "expense", "income"],
            "Source": ["Chase", "Chase", "Chase", "Chase", "Chase", "Chase"],
            "Category": [
                "Groceries",
                "Transportation",
                "Salary",
                "Groceries",
                "Utilities",
                "Salary",
            ],
        }
    )


@pytest.fixture
def sample_categories():
    return {
        "Whole Foods": "Groceries",
        "Shell Gas": "Transportation",
        "Employer Inc": "Salary",
        "Trader Joes": "Groceries",
        "Electric Co": "Utilities",
    }


def test_format_currency():
    assert format_currency(1234.56) == "$1,234.56"
    assert format_currency(0) == "$0.00"
    assert format_currency(-500.00) == "$-500.00"


def test_create_base_pdf():
    pdf = create_base_pdf("Test Report")
    assert pdf is not None
    assert pdf.pages_count == 1


def test_export_summary_pdf_basic(sample_transactions, sample_categories):
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "summary.pdf")
        result = export_summary_pdf(
            transactions=sample_transactions,
            categories=sample_categories,
            year=2024,
            output_path=output_path,
        )
        assert result == output_path
        assert os.path.exists(output_path)
        assert os.path.getsize(output_path) > 0


def test_export_summary_pdf_with_month_filter(sample_transactions, sample_categories):
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "summary_month.pdf")
        result = export_summary_pdf(
            transactions=sample_transactions,
            categories=sample_categories,
            year=2024,
            month=1,
            output_path=output_path,
        )
        assert result == output_path
        assert os.path.exists(output_path)


def test_export_summary_pdf_with_source_filter(
    sample_transactions, sample_categories
):
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "summary_source.pdf")
        export_summary_pdf(
            transactions=sample_transactions,
            categories=sample_categories,
            year=2024,
            source_filter={"Chase"},
            output_path=output_path,
        )
        assert os.path.exists(output_path)


def test_export_summary_pdf_empty_data(sample_categories):
    empty_df = pd.DataFrame(
        columns=["Date", "Merchant", "Amount", "Type", "Source", "Category"]
    )
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "summary_empty.pdf")
        with pytest.raises(ValueError, match="No transactions to export"):
            export_summary_pdf(
                transactions=empty_df,
                categories=sample_categories,
                output_path=output_path,
            )


def test_export_transactions_pdf_basic(sample_transactions, sample_categories):
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "transactions.pdf")
        result = export_transactions_pdf(
            transactions=sample_transactions,
            categories=sample_categories,
            output_path=output_path,
        )
        assert result == output_path
        assert os.path.exists(output_path)
        assert os.path.getsize(output_path) > 0


def test_export_transactions_pdf_with_filters(
    sample_transactions, sample_categories
):
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "transactions_filtered.pdf")
        export_transactions_pdf(
            transactions=sample_transactions,
            categories=sample_categories,
            filters_description="From: 2024-01-01\nTo: 2024-01-31\nCategory: Groceries",
            output_path=output_path,
        )
        assert os.path.exists(output_path)


def test_export_transactions_pdf_empty_data():
    empty_df = pd.DataFrame(
        columns=["Date", "Merchant", "Amount", "Type", "Source", "Category"]
    )
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "transactions_empty.pdf")
        with pytest.raises(ValueError, match="No transactions to export"):
            export_transactions_pdf(
                transactions=empty_df,
                output_path=output_path,
            )


def test_pdf_file_readable(sample_transactions, sample_categories):
    """Verify the generated PDF starts with %PDF header (valid PDF)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "readable.pdf")
        export_summary_pdf(
            transactions=sample_transactions,
            categories=sample_categories,
            year=2024,
            output_path=output_path,
        )
        with open(output_path, "rb") as f:
            header = f.read(5)
        assert header == b"%PDF-"


def test_export_summary_pdf_default_path(sample_transactions, sample_categories):
    """Test that the default output path is created correctly."""
    result = export_summary_pdf(
        transactions=sample_transactions,
        categories=sample_categories,
        year=2024,
    )
    assert os.path.exists(result)
    assert "summary_2024_" in result
    assert result.endswith(".pdf")
    # Cleanup
    os.remove(result)


def test_export_transactions_pdf_no_type_column(sample_categories):
    """Test export when Type column is missing (backward compatibility)."""
    df = pd.DataFrame(
        {
            "Date": pd.to_datetime(["2024-01-05", "2024-01-10"]),
            "Merchant": ["Whole Foods", "Shell Gas"],
            "Amount": [85.50, 45.00],
            "Source": ["Chase", "Chase"],
        }
    )
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "no_type.pdf")
        export_transactions_pdf(
            transactions=df,
            categories=sample_categories,
            output_path=output_path,
        )
        assert os.path.exists(output_path)
