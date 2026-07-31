import pandas as pd

import expenses.config as config
from expenses.payslip_parser import PayslipRun
from expenses.payslip_handler import (
    is_ignored, aggregate_runs, DEFAULT_IGNORE, PAYSLIP_COLUMNS,
    load_payslip_settings, save_payslip_settings, get_payslip_folder,
    load_payslips, save_payslips, upsert_payslips,
    add_payslip_folder, remove_payslip_folder, get_payslip_folders, list_owners,
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


def test_single_folder_settings_become_the_default_owner(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    monkeypatch.setattr(config, "PAYSLIP_DIR", None)
    save_payslip_settings({"folder": "/legacy"})
    assert list_owners() == ["self"]
    assert get_payslip_folders("self") == ["/legacy"]


def test_an_owner_can_hold_several_folders(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    monkeypatch.setattr(config, "PAYSLIP_DIR", None)
    # One person, two employers in the same year.
    add_payslip_folder("/old-employer", owner="self")
    add_payslip_folder("/new-employer", owner="self")
    add_payslip_folder("/theirs", owner="other")
    assert get_payslip_folders("self") == ["/old-employer", "/new-employer"]
    assert get_payslip_folders("other") == ["/theirs"]
    # The default owner sorts first so it stays the landing selection.
    assert list_owners() == ["self", "other"]

    remove_payslip_folder("/old-employer", owner="self")
    assert get_payslip_folders("self") == ["/new-employer"]
    remove_payslip_folder("/theirs", owner="other")
    assert list_owners() == ["self"]


def test_adding_a_folder_twice_does_not_duplicate_it(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    monkeypatch.setattr(config, "PAYSLIP_DIR", None)
    add_payslip_folder("/x", owner="self")
    add_payslip_folder("/x", owner="self")
    assert get_payslip_folders("self") == ["/x"]


def test_env_override_applies_only_to_the_default_owner(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    add_payslip_folder("/theirs", owner="other")
    monkeypatch.setattr(config, "PAYSLIP_DIR", "/env")
    assert get_payslip_folders("self") == ["/env"]
    assert get_payslip_folders("other") == ["/theirs"]


def test_aggregate_tags_rows_with_their_owner():
    runs = [_run("2026-01", "a.pdf", salary=1000.0, pension_ee=100.0,
                 pension_ee_ytd=100.0, pension_er=0.0, pension_er_ytd=0.0)]
    assert list(aggregate_runs(runs, owner="other")["Owner"]) == ["other"]


def test_aggregate_treats_a_ytd_drop_as_a_change_of_employer():
    # Leaving one employer part-way through a year restarts year-to-date at the
    # next; that is not a mismatch and must not be flagged as one.
    runs = [
        _run("2025-08", "old-aug.pdf", salary=1000.0, pension_ee=100.0,
             pension_ee_ytd=800.0, pension_er=0.0, pension_er_ytd=0.0),
        _run("2025-09", "new-sep.pdf", salary=1000.0, pension_ee=120.0,
             pension_ee_ytd=120.0, pension_er=0.0, pension_er_ytd=0.0),
    ]
    df = aggregate_runs(runs).set_index("Month")
    assert bool(df.loc["2025-09", "YTDReconciled"]) is True


def _row(owner, month, gross, source="a.pdf"):
    values = {
        "Owner": owner, "Month": month, "Gross": gross, "Net": gross * 0.8,
        "TaxTotal": 10.0, "PensionEE": 5.0, "AVC": 0.0, "PensionER": 5.0,
        "Bonus": 0.0, "OnCall": 0.0, "SourceFiles": source,
        "YTDReconciled": True, "NetReconciled": True,
    }
    return pd.DataFrame([{c: values[c] for c in PAYSLIP_COLUMNS}])


def test_upsert_replaces_month(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIPS_FILE", tmp_path / "p.parquet")
    save_payslips(_row("self", "2026-01", 100.0))
    result = upsert_payslips(_row("self", "2026-01", 200.0, source="b.pdf"))
    assert len(result) == 1
    assert result.iloc[0]["Gross"] == 200.0
    assert load_payslips().iloc[0]["Gross"] == 200.0


def test_upsert_keeps_other_owners_for_the_same_month(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIPS_FILE", tmp_path / "p.parquet")
    save_payslips(_row("self", "2026-01", 100.0))
    upsert_payslips(_row("other", "2026-01", 300.0))
    # Rescanning one owner must not disturb the other's row for that month.
    result = upsert_payslips(_row("self", "2026-01", 200.0))
    assert len(result) == 2
    by_owner = result.set_index("Owner")["Gross"].to_dict()
    assert by_owner == {"self": 200.0, "other": 300.0}


def test_load_payslips_stamps_rows_written_before_owners_existed(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIPS_FILE", tmp_path / "p.parquet")
    legacy = _row("self", "2026-01", 100.0).drop(columns=["Owner", "NetReconciled"])
    legacy.to_parquet(tmp_path / "p.parquet", index=False)
    loaded = load_payslips()
    assert list(loaded["Owner"]) == ["self"]
    assert bool(loaded.iloc[0]["NetReconciled"]) is False
