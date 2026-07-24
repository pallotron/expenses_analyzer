import pandas as pd

import expenses.config as config
from expenses.payslip_parser import PayslipRun
from expenses.payslip_handler import (
    is_ignored, aggregate_runs, DEFAULT_IGNORE, PAYSLIP_COLUMNS,
    load_payslip_settings, save_payslip_settings, get_payslip_folder,
    load_payslips, save_payslips, upsert_payslips,
)


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


def test_settings_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    save_payslip_settings({"folder": "/x"})
    assert load_payslip_settings() == {"folder": "/x"}


def test_env_overrides_saved_folder(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    save_payslip_settings({"folder": "/saved"})
    monkeypatch.setattr(config, "PAYSLIP_DIR", "/env")
    assert get_payslip_folder() == "/env"


def test_upsert_replaces_month(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIPS_FILE", tmp_path / "p.parquet")
    base = pd.DataFrame([
        {c: v for c, v in zip(PAYSLIP_COLUMNS,
         ["2026-01", 100.0, 80.0, 10.0, 5.0, 0.0, 5.0, 0.0, 0.0, "a.pdf", True])},
    ])
    save_payslips(base)
    newer = pd.DataFrame([
        {c: v for c, v in zip(PAYSLIP_COLUMNS,
         ["2026-01", 200.0, 160.0, 20.0, 10.0, 0.0, 10.0, 0.0, 0.0, "b.pdf", True])},
    ])
    result = upsert_payslips(newer)
    assert len(result) == 1
    assert result.iloc[0]["Gross"] == 200.0
    assert load_payslips().iloc[0]["Gross"] == 200.0
