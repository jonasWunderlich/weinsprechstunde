"""Unit-Tests für Phase backup (Rolling Window + Intervall + Fehlerbehandlung).

Backup sichert ausschließlich die exportierte wines.json als einzelne,
zeitgestempelte Datei (``last_<ts>.json`` / ``archival_<ts>.json``) – nicht den
Import-Ordner.
"""

from datetime import datetime, timedelta

import pytest

from conftest import make_config, write_json
from conftest import weinimport as wi
from weinlib import backup as backup_mod
from weinlib import ftp_transport as ft


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


def setup_export(tmp_path, content='[{"name": "A"}]'):
    """Lege eine exportierte wines.json an und gib ihren Pfad zurück."""
    export_path = tmp_path / "export" / "data" / "wines.json"
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_text(content, encoding="utf-8")
    return export_path


class FrozenDatetime(datetime):
    _now = datetime(2024, 1, 1, 12, 0, 0)

    @classmethod
    def now(cls, tz=None):
        return cls._now


def run_backup_at(monkeypatch, config, moment):
    FrozenDatetime._now = moment
    monkeypatch.setattr(backup_mod, "datetime", FrozenDatetime)
    wi.phase_backup(config)


def count_prefix(backup_dir, prefix):
    return len(
        [
            f
            for f in backup_dir.iterdir()
            if f.is_file()
            and f.name.startswith(prefix)
            and f.name != wi.LAST_ARCHIVAL_FILE
        ]
    )


def test_last_backup_is_single_file_copy_of_export(tmp_path, monkeypatch):
    export_path = setup_export(tmp_path, content='[{"name": "A"}]')
    backup = make_backup_config(wi, tmp_path, archival_interval_days=0)
    config = make_config(export_path=str(export_path), backup=backup)
    backup_dir = tmp_path / "backup"

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))

    last_files = [f for f in backup_dir.iterdir() if f.name.startswith("last_")]
    assert len(last_files) == 1
    backup_file = last_files[0]
    # Einzelne Datei (kein Ordner) mit .json-Endung
    assert backup_file.is_file()
    assert backup_file.suffix == ".json"
    assert backup_file.name == "last_2024-01-01_12-00-00.json"
    # Inhalt entspricht der exportierten wines.json – NICHT dem Import-Ordner
    assert backup_file.read_text(encoding="utf-8") == '[{"name": "A"}]'


def test_last_rolling_window(tmp_path, monkeypatch):
    export_path = setup_export(tmp_path)
    backup = make_backup_config(wi, tmp_path, max_last_backups=3, archival_interval_days=0)
    config = make_config(export_path=str(export_path), backup=backup)
    backup_dir = tmp_path / "backup"

    for i in range(5):
        run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, i))

    assert count_prefix(backup_dir, "last_") == 3


def test_archival_not_due_within_interval(tmp_path, monkeypatch):
    export_path = setup_export(tmp_path)
    backup = make_backup_config(wi, tmp_path, archival_interval_days=30)
    config = make_config(export_path=str(export_path), backup=backup)
    backup_dir = tmp_path / "backup"

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))
    assert count_prefix(backup_dir, "archival_") == 1
    # 10 Tage später -> nicht fällig
    run_backup_at(monkeypatch, config, datetime(2024, 1, 11, 12, 0, 0))
    assert count_prefix(backup_dir, "archival_") == 1


def test_archival_due_after_interval(tmp_path, monkeypatch):
    export_path = setup_export(tmp_path)
    backup = make_backup_config(wi, tmp_path, max_archival_backups=5, archival_interval_days=30)
    config = make_config(export_path=str(export_path), backup=backup)
    backup_dir = tmp_path / "backup"

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))
    run_backup_at(monkeypatch, config, datetime(2024, 2, 1, 12, 0, 0))  # 31 Tage später
    assert count_prefix(backup_dir, "archival_") == 2


def test_archival_backup_is_single_file(tmp_path, monkeypatch):
    export_path = setup_export(tmp_path, content='[{"name": "B"}]')
    backup = make_backup_config(wi, tmp_path, archival_interval_days=30)
    config = make_config(export_path=str(export_path), backup=backup)
    backup_dir = tmp_path / "backup"

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))

    archival_files = [f for f in backup_dir.iterdir() if f.name.startswith("archival_")]
    assert len(archival_files) == 1
    assert archival_files[0].is_file()
    assert archival_files[0].name == "archival_2024-01-01_12-00-00.json"
    assert archival_files[0].read_text(encoding="utf-8") == '[{"name": "B"}]'


def test_marker_file_not_pruned_as_backup(tmp_path, monkeypatch):
    """Die .last_archival-Marker-Datei darf nicht als Backup gewertet/geprunt werden."""
    export_path = setup_export(tmp_path)
    backup = make_backup_config(wi, tmp_path, max_last_backups=3, archival_interval_days=30)
    config = make_config(export_path=str(export_path), backup=backup)
    backup_dir = tmp_path / "backup"

    for i in range(5):
        run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, i))

    marker = backup_dir / wi.LAST_ARCHIVAL_FILE
    assert marker.exists()
    assert count_prefix(backup_dir, "last_") == 3


def test_backup_skipped_when_export_missing(tmp_path, monkeypatch, capsys):
    """Fehlt die Export-Datei (backup vor erstem export), Warnung statt Crash."""
    export_path = tmp_path / "export" / "data" / "wines.json"  # existiert nicht
    backup = make_backup_config(wi, tmp_path)
    config = make_config(export_path=str(export_path), backup=backup)
    backup_dir = tmp_path / "backup"

    FrozenDatetime._now = datetime(2024, 1, 1, 12, 0, 0)
    monkeypatch.setattr(backup_mod, "datetime", FrozenDatetime)
    wi.phase_backup(config)

    assert "übersprungen" in capsys.readouterr().err
    assert not any(f.name.startswith("last_") for f in backup_dir.iterdir())


def test_backup_failure_warns_no_abort(tmp_path, monkeypatch, capsys):
    export_path = setup_export(tmp_path)
    backup = make_backup_config(wi, tmp_path)
    config = make_config(export_path=str(export_path), backup=backup)

    def boom(*a, **k):
        raise OSError("copy kaputt")

    monkeypatch.setattr(backup_mod.shutil, "copy2", boom)
    FrozenDatetime._now = datetime(2024, 1, 1, 12, 0, 0)
    monkeypatch.setattr(backup_mod, "datetime", FrozenDatetime)
    # Darf nicht abbrechen
    wi.phase_backup(config)
    assert "fehlgeschlagen" in capsys.readouterr().err


def test_no_backup_config_noop(tmp_path):
    config = make_config(export_path=str(setup_export(tmp_path)), backup=None)
    wi.phase_backup(config)  # darf nichts tun / nicht crashen


# ---------------------------------------------------------------------------
# Remote-Backup (best effort, Einzeldateien per Fake-FTP)
# ---------------------------------------------------------------------------


class FakeFTP:
    """Minimale FTP_TLS-Attrappe: merkt sich hochgeladene Dateien und mkd-Pfade."""

    def __init__(self):
        self.stored = []
        self.made_dirs = []

    def mkd(self, path):
        self.made_dirs.append(path)

    def storbinary(self, cmd, fh):
        self.stored.append(cmd.split(" ", 1)[1])

    def quit(self):
        pass


def test_remote_backup_uploads_single_files(tmp_path, monkeypatch):
    export_path = setup_export(tmp_path)
    backup = make_backup_config(
        wi, tmp_path, remote_backup_dir="/backup", archival_interval_days=0
    )
    config = make_config(password="geheim", export_path=str(export_path), backup=backup)

    fake = FakeFTP()
    monkeypatch.setattr(ft, "_ftps_connect", lambda *a, **k: fake)

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))

    # Last- und Archival-Datei (Intervall 0 -> fällig) als Einzeldateien hochgeladen
    assert "/backup/last_2024-01-01_12-00-00.json" in fake.stored
    assert "/backup/archival_2024-01-01_12-00-00.json" in fake.stored
    # Es wurden ausschließlich .json-Einzeldateien hochgeladen (keine Ordner)
    assert all(p.endswith(".json") for p in fake.stored)


def test_remote_backup_skipped_without_password(tmp_path, monkeypatch, capsys):
    export_path = setup_export(tmp_path)
    backup = make_backup_config(
        wi, tmp_path, remote_backup_dir="/backup", archival_interval_days=0
    )
    config = make_config(password="", export_path=str(export_path), backup=backup)
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", raising=False)

    fake = FakeFTP()
    monkeypatch.setattr(ft, "_ftps_connect", lambda *a, **k: fake)

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))

    # Ohne Passwort: Remote-Backup übersprungen, keine Uploads, kein Abbruch
    assert fake.stored == []
    assert "übersprungen" in capsys.readouterr().err
    # Lokales Backup bleibt dennoch bestehen
    backup_dir = tmp_path / "backup"
    assert any(f.name.startswith("last_") for f in backup_dir.iterdir())


@pytest.mark.parametrize("content", ["", "kein-datum"])
def test_invalid_archival_marker_makes_archival_due(tmp_path, monkeypatch, capsys, content):
    """Leerer/beschädigter .last_archival-Marker: Warnung, Archival fällig, kein Crash (Req 20.9)."""
    export_path = setup_export(tmp_path)
    backup = make_backup_config(wi, tmp_path, archival_interval_days=30)
    config = make_config(export_path=str(export_path), backup=backup)
    backup_dir = tmp_path / "backup"
    backup_dir.mkdir()
    (backup_dir / wi.LAST_ARCHIVAL_FILE).write_text(content, encoding="utf-8")

    run_backup_at(monkeypatch, config, datetime(2024, 1, 1, 12, 0, 0))

    assert "ungültig" in capsys.readouterr().err
    assert count_prefix(backup_dir, "last_") == 1
    assert count_prefix(backup_dir, "archival_") == 1
    # Marker ist danach wieder gültig
    datetime.fromisoformat((backup_dir / wi.LAST_ARCHIVAL_FILE).read_text())
