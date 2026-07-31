from unittest.mock import patch

from expenses.payslip_parser import (
    parse_lines,
    extract_amounts,
    PayslipRun,
    month_from_filename,
    resolve_password,
    parse_payslip,
)

# Synthetic lines mirroring the verified Irish payslip layout (no real data).
JULY_LINES = [
    "Salary 13458.33",
    "Device Reimbursement 40.00",
    "Bonus 2614.00",
    "On-Call 396.00",
    "Notional Pay/Bik",
    "BIK Medical 384.44",
    "BIK Dental 56.25",
    "USC on 112658.19 1025.14 6697.18 0.00 0.00",
    "AVC 269.17 1884.18 0.00 0.00",
    "Pension 1076.67 7536.68 1076.67 7536.68",
    "PAYE 5163.77 33752.41",
    "PRSI 711.85 4731.59 1906.76 12674.01",
    "Pension monies from previous period(s) have been remitted",
]


# Same payroll template, as emitted by a different provider: uppercase labels,
# an employer-only pension, misc deductions, and a non-taxable adjustment.
UPPERCASE_LINES = [
    "SALARY 3000.00",
    "HEALTH INSURANCE SUB 300.00",
    "Notional Pay/Bik",
    "SMALL BEN EXEMPTION 1500.00",
    "WORKING FROM HOME SUB 400.00",
    "USC on 45000.00 60.00 900.00 0.00 0.00",
    "PENSION ER 0.00 0.00 220.00 2640.00",
    "SPORTS CLUB 5.00 60.00 0.00 0.00",
    "GROUP HEALTH PLAN 300.00 1800.00 0.00 0.00",
    "PAYE 500.00 7000.00",
    "PRSI 140.00 1800.00 380.00 5000.00",
]


def test_extract_amounts_parses_two_decimal_numbers():
    assert extract_amounts("Pension 1076.67 7536.68 1076.67 7536.68") == [
        1076.67, 7536.68, 1076.67, 7536.68
    ]
    assert extract_amounts("PRSI Code") == []


def test_parse_lines_extracts_core_fields():
    run: PayslipRun = parse_lines(JULY_LINES, month="2026-07", source_file="2026-07.pdf")
    assert run is not None
    assert run.salary == 13458.33
    assert run.bonus == 2614.00
    assert run.oncall == 396.00
    assert run.reimbursements == 40.00
    assert run.pension_ee == 1076.67
    assert run.avc == 269.17
    assert run.pension_er == 1076.67
    assert run.paye == 5163.77
    assert run.prsi_ee == 711.85
    assert run.usc == 1025.14
    assert run.pension_ee_ytd == 7536.68
    assert run.avc_ytd == 1884.18
    assert run.pension_er_ytd == 7536.68


def test_parse_lines_derives_gross_and_net():
    run: PayslipRun = parse_lines(JULY_LINES, month="2026-07", source_file="2026-07.pdf")
    # Gross = cash earnings, excludes notional BIK
    assert run.gross == 16508.33
    assert run.tax_total == 6900.76           # PAYE + PRSI_ee + USC
    assert run.deds_from_gross == 1345.84      # PensionEE + AVC
    assert round(run.net, 2) == 8261.73        # Gross - deds - tax


def test_parse_lines_returns_none_for_unrecognized_format():
    assert parse_lines(["Total Pay 1000.00", "Deductions 200.00"],
                       month="2026-07", source_file="x.pdf") is None


def test_parse_lines_handles_uppercase_labels():
    run = parse_lines(UPPERCASE_LINES, month="2025-12", source_file="2025-12.pdf")
    assert run is not None
    assert run.salary == 3000.00
    assert run.pension_er == 220.00
    assert run.pension_ee == 0.00
    assert run.usc == 60.00
    assert run.paye == 500.00
    assert run.prsi_ee == 140.00


def test_parse_lines_separates_gross_from_notional_and_non_taxable():
    run = parse_lines(UPPERCASE_LINES, month="2025-12", source_file="2025-12.pdf")
    # A taxable subsidy counts toward gross; notional BIK never does.
    assert run.gross == 3300.00
    assert run.non_taxable_adj == 400.00
    # Both unrecognized 4-amount lines are treated as misc deductions.
    assert run.misc_deductions == 305.00
    assert run.net == 3300.00 - 700.00 - 305.00 + 400.00


def test_parse_lines_splits_a_line_carrying_two_labels():
    # Text extraction sometimes runs two items onto one line; each must keep
    # its own amounts rather than the first label swallowing all of them.
    run = parse_lines(
        UPPERCASE_LINES[:5] + ["BACKPAY 650.00 USC on 27000.00 86.66 565.48 0.00 0.00"]
        + UPPERCASE_LINES[6:],
        month="2025-07", source_file="2025-07.pdf",
    )
    assert run is not None
    assert run.salary == 3650.00
    assert run.usc == 86.66


def test_parse_lines_counts_earnings_under_provider_specific_labels():
    lines = [
        "Salary 10200.00",
        "Sign On Bonus 15000.00",
        "Retro Pay 916.67",
        "Device Reimbursement 2.00",
        "Device Reimb(tax free) 38.00",
        "USC on 25202.00 1686.48 1686.48 0.00 0.00",
        "AVC 204.00 204.00 0.00 0.00",
        "Pension 816.00 816.00 816.00 816.00",
        "PAYE 9049.47 9049.47",
        "PRSI 1033.28 1033.28 2810.02 2810.02",
    ]
    run = parse_lines(lines, month="2025-09", source_file="2025-09.pdf")
    assert run is not None
    assert run.bonus == 15000.00
    assert run.salary == 10200.00 + 916.67
    assert run.reimbursements == 2.00
    assert run.non_taxable_adj == 38.00


def test_parse_lines_subtracts_a_negative_salary_adjustment():
    # Unpaid leave reduces salary and is signed negative on the payslip.
    run = parse_lines(
        ["SALARY 3166.67", "UNPAID LEAVE -730.77"] + UPPERCASE_LINES[5:],
        month="2026-04", source_file="2026-04.pdf",
    )
    assert run is not None
    assert run.salary == 3166.67 - 730.77
    assert run.gross == 2435.90


def test_parse_lines_accepts_a_supplementary_run_without_salary():
    # An off-cycle on-call payment has no salary line but is still a real run.
    run = parse_lines(
        [
            "On-Call 468.75",
            "USC on 14650.17 37.50 841.23 0.00 0.00",
            "AVC 0.00 260.00 0.00 0.00",
            "Pension 0.00 1040.00 0.00 1040.00",
            "PAYE 187.50 4262.56",
            "PRSI 19.69 615.30 52.74 1648.14",
        ],
        month="2026-01", source_file="2026-01-oncall.pdf",
    )
    assert run is not None
    assert run.salary == 0.0
    assert run.oncall == 468.75
    assert run.net == 224.06


def test_net_reconciled_flags_a_label_the_parser_does_not_know():
    # The summary block is bare amounts terminated by the label block; its last
    # entry is net. Here it disagrees with what the line items add up to.
    lines = JULY_LINES + ["16508.33", "1345.84", "6900.76", "0.00", "9999.99", "NOTE"]
    run = parse_lines(lines, month="2026-07", source_file="2026-07.pdf")
    assert run.stated_net == 9999.99
    assert run.net_reconciled is False


def test_net_reconciled_accepts_a_matching_stated_net():
    lines = JULY_LINES + ["8261.73", "NOTE"]
    run = parse_lines(lines, month="2026-07", source_file="2026-07.pdf")
    assert run.net_reconciled is True


def test_net_reconciled_is_true_when_payslip_states_no_net():
    run = parse_lines(JULY_LINES, month="2026-07", source_file="2026-07.pdf")
    assert run.stated_net is None
    assert run.net_reconciled is True


def test_month_from_filename():
    assert month_from_filename("2026-07.pdf") == "2026-07"
    assert month_from_filename("2026-01-oncall.pdf") == "2026-01"
    assert month_from_filename("notes.pdf") is None


def test_resolve_password_prefers_explicit(tmp_path):
    (tmp_path / "pin.txt").write_text("1234")
    assert resolve_password(str(tmp_path), explicit="9999") == "9999"


def test_resolve_password_reads_pin_file(tmp_path, monkeypatch):
    monkeypatch.delenv("PAYSLIP_PDF_PASSWORD", raising=False)
    (tmp_path / "pin.txt").write_text("1234\n")
    assert resolve_password(str(tmp_path), explicit=None) == "1234"


def test_resolve_password_falls_back_to_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PAYSLIP_PDF_PASSWORD", "envpw")
    assert resolve_password(str(tmp_path), explicit=None) == "envpw"


def test_parse_payslip_uses_extracted_lines():
    with patch("expenses.payslip_parser.extract_text_lines", return_value=JULY_LINES):
        run = parse_payslip("/fake/2026-07.pdf")
    assert run is not None
    assert run.month == "2026-07"
    assert run.pension_ee == 1076.67
