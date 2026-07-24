from expenses.payslip_parser import parse_lines, extract_amounts, PayslipRun

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
