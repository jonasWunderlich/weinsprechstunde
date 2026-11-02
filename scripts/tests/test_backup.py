"""Unit-Tests für Phase backup (Rolling Window + Intervall + Fehlerbehandlung)."""

from datetime import datetime, timedelta

import pytest

from conftest import make_config, write_json
from conftest import weinimport as wi


def make_backup_config(wi_mod, tmp_path, **overrides):
    defaults = dict(
        backup_dir=str(tmp_path / "backup"),
        max_last_backups=3,
        max_archival_backups=2,
        archival_interval_days=30,
        remote_backup_dir=None,
    )
    defaults.update(overrides)
    return wi_mod.BackupConfig(**defaults)


def setup_import(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "w.json", {"name": "A"})
    return import_dir


class FrozenDatetime(datetime):
    _now = datetime(2024, 1, 1, 12, 0, 0)

    @classmethod
    def now(cls, tz=None):
        return cls._now


def run_backup_at(monkeypatch, config, moment):
    FrozenDatetime._now = moment
    monkeypatch.setattr(wi, "datetime", FrozenDatetime)
    wi.phase_backup(config)


def count_prefix(backup_dir, prefix):
    return len([d for d in backup_dir.iterdir() if d.is_dir() and d.name.startswith(prefix)])


def test_last_rolling_window(tmp_path, monkeypatch):
    import_dir = setup_import(tmp_path)
    backup = make_backup_config(wi, tmp_path, max_last_backups=3, archival_interval_days=0)
    config = make_config(import_dir=str(import_dir), backup=backup)
    backup_dir = tmp_path / "backup"

    for i in range(5):
        run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, i))

    assert count_prefix(backup_dir, "last_") == 3


def test_archival_not_due_within_interval(tmp_path, monkeypatch):
    import_dir = setup_import(tmp_path)
    backup = make_backup_config(wi, tmp_path, archival_interval_days=30)
    config = make_config(import_dir=str(import_dir), backup=backup)
    backup_dir = tmp_path / "backup"

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))
    assert count_prefix(backup_dir, "archival_") == 1
    # 10 Tage später -> nicht fällig
    run_backup_at(monkeypatch, config, datetime(2024, 1, 11, 12, 0, 0))
    assert count_prefix(backup_dir, "archival_") == 1


def test_archival_due_after_interval(tmp_path, monkeypatch):
    import_dir = setup_import(tmp_path)
    backup = make_backup_config(wi, tmp_path, max_archival_backups=5, archival_interval_days=30)
    config = make_config(import_dir=str(import_dir), backup=backup)
    backup_dir = tmp_path / "backup"

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))
    run_backup_at(monkeypatch, config, datetime(2024, 2, 1, 12, 0, 0))  # 31 Tage später
    assert count_prefix(backup_dir, "archival_") == 2


def test_backup_failure_warns_no_abort(tmp_path, monkeypatch, capsys):
    import_dir = setup_import(tmp_path)
    backup = make_backup_config(wi, tmp_path)
    config = make_config(import_dir=str(import_dir), backup=backup)

    def boom(*a, **k):
        raise OSError("copytree kaputt")

    monkeypatch.setattr(wi.shutil, "copytree", boom)
    FrozenDatetime._now = datetime(2024, 1, 1, 12, 0, 0)
    monkeypatch.setattr(wi, "datetime", FrozenDatetime)
    # Darf nicht abbrechen
    wi.phase_backup(config)
    assert "fehlgeschlagen" in capsys.readouterr().err


def test_no_backup_config_noop(tmp_path):
    config = make_config(import_dir=str(setup_import(tmp_path)), backup=None)
    wi.phase_backup(config)  # darf nichts tun / nicht crashen
