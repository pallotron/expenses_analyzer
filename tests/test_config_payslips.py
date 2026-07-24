import importlib


def test_payslip_config_paths(monkeypatch, tmp_path):
    monkeypatch.setenv("EXPENSES_ANALYZER_CONFIG_DIR", str(tmp_path))
    import expenses.config as config
    importlib.reload(config)

    assert config.PAYSLIPS_FILE == tmp_path / "payslips.parquet"
    assert config.PAYSLIP_SETTINGS_FILE == tmp_path / "payslip_settings.json"


def test_payslip_env_overrides(monkeypatch, tmp_path):
    monkeypatch.setenv("EXPENSES_ANALYZER_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("PAYSLIP_DIR", "/some/runtime/path")
    monkeypatch.setenv("PAYSLIP_PDF_PASSWORD", "secret")
    import expenses.config as config
    importlib.reload(config)

    assert config.PAYSLIP_DIR == "/some/runtime/path"
    assert config.PAYSLIP_PDF_PASSWORD == "secret"
