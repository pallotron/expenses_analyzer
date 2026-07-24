from expenses.payslip_parser import PayslipRun
from expenses.payslip_handler import is_ignored, aggregate_runs, DEFAULT_IGNORE


def _run(month, source, **kw):
    return PayslipRun(month=month, source_file=source, **kw)


def test_is_ignored_matches_default_tokens():
    assert is_ignored("2025-12-fuckedup.pdf", DEFAULT_IGNORE) is True
    assert is_ignored("2025-12-correct.pdf", DEFAULT_IGNORE) is False


def test_aggregate_sums_supplementary_runs():
    runs = [
        _run("2026-01", "2026-01.pdf", salary=13000.0, oncall=681.25,
             pension_ee=1040.0, pension_ee_ytd=1040.0,
             pension_er=1040.0, pension_er_ytd=1040.0,
             avc=260.0, avc_ytd=260.0, paye=4075.06, prsi_ee=595.61, usc=803.73),
        _run("2026-01", "2026-01-oncall.pdf", oncall=468.75,
             pension_ee=0.0, pension_ee_ytd=1040.0,
             pension_er=0.0, pension_er_ytd=1040.0,
             avc=0.0, avc_ytd=260.0, paye=187.50, prsi_ee=19.69, usc=37.50),
    ]
    df = aggregate_runs(runs)
    assert list(df["Month"]) == ["2026-01"]
    row = df.iloc[0]
    assert row["OnCall"] == 681.25 + 468.75
    assert row["PensionEE"] == 1040.0          # 1040 + 0
    assert row["PensionER"] == 1040.0
    assert row["AVC"] == 260.0
    assert set(row["SourceFiles"].split(", ")) == {"2026-01.pdf", "2026-01-oncall.pdf"}
    assert bool(row["YTDReconciled"]) is True   # summed period (1040) == YTD (1040) in month 1


def test_aggregate_flags_ytd_mismatch():
    # First month of tax year: summed period pension should equal YTD. Break it.
    runs = [
        _run("2026-01", "a.pdf", salary=1000.0, pension_ee=500.0, pension_ee_ytd=999.0,
             pension_er=0.0, pension_er_ytd=0.0, avc=0.0, avc_ytd=0.0),
    ]
    df = aggregate_runs(runs)
    assert bool(df.iloc[0]["YTDReconciled"]) is False


def test_aggregate_reconciles_across_months():
    runs = [
        _run("2026-01", "jan.pdf", salary=1000.0, pension_ee=100.0, pension_ee_ytd=100.0,
             pension_er=100.0, pension_er_ytd=100.0, avc=0.0, avc_ytd=0.0),
        _run("2026-02", "feb.pdf", salary=1000.0, pension_ee=100.0, pension_ee_ytd=200.0,
             pension_er=100.0, pension_er_ytd=200.0, avc=0.0, avc_ytd=0.0),
    ]
    df = aggregate_runs(runs).set_index("Month")
    assert bool(df.loc["2026-01", "YTDReconciled"]) is True
    assert bool(df.loc["2026-02", "YTDReconciled"]) is True  # 200 - 100 == 100 period
