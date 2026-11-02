"""Tests für load_config und load_wine_schema."""

import json

import pytest

from conftest import weinimport as wi


def test_load_config_missing_file_exits(tmp_path, capsys):
    missing = tmp_path / "nope.json"
    with pytest.raises(SystemExit) as exc:
        wi.load_config(str(missing))
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "Konfigurationsdatei" in err
    assert "nicht gefunden" in err


def test_load_config_invalid_json_exits(tmp_path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text("{ not valid json", encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        wi.load_config(str(bad))
    assert exc.value.code == 1
    assert "kein valides JSON" in capsys.readouterr().err


def test_load_config_parses_nested_dataclasses(tmp_path):
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(
        json.dumps(
            {
                "import_dir": "./import",
                "import_source": "local",
                "export_path": "./out/wines.json",
                "scaffold_mode": True,
                "image_export_dir": "./export/images",
                "image_resize_mode": "width",
                "image_resize_px": 1200,
                "deploy": {
                    "protocol": "sftp",
                    "host": "example.com",
                    "user": "myuser",
                    "password": "",
                    "remote_path": "/var/www/html",
                    "remote_images_path": "/var/www/images",
                    "remote_import_path": "/var/www/import",
                },
                "backup": {
                    "backup_dir": "./backup",
                    "remote_backup_dir": "/var/www/backup",
                    "max_last_backups": 10,
                    "max_archival_backups": 24,
                    "archival_interval_days": 30,
                },
                "editor": {"path": "/editor-geheim", "password_hash": "abc"},
            }
        ),
        encoding="utf-8",
    )
    config = wi.load_config(str(cfg_path))

    # Verschachtelte dicts müssen zu Dataclasses geparst sein (Attributzugriff).
    assert isinstance(config.deploy, wi.DeployConfig)
    assert config.deploy.host == "example.com"
    assert config.deploy.protocol == "sftp"
    assert isinstance(config.backup, wi.BackupConfig)
    assert config.backup.max_last_backups == 10
    assert config.backup.archival_interval_days == 30
    assert config.backup.remote_backup_dir == "/var/www/backup"
    assert isinstance(config.editor, wi.EditorConfig)
    assert config.editor.path == "/editor-geheim"


def test_load_config_without_backup(tmp_path):
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(
        json.dumps(
            {
                "import_dir": "./import",
                "import_source": "local",
                "export_path": "./out/wines.json",
                "scaffold_mode": False,
                "image_export_dir": "./export/images",
                "image_resize_mode": "height",
                "image_resize_px": 800,
                "deploy": {
                    "protocol": "ftp",
                    "host": "h",
                    "user": "u",
                    "password": "p",
                    "remote_path": "/r",
                    "remote_images_path": "/ri",
                    "remote_import_path": "/im",
                },
                "editor": {"path": "/e", "password_hash": ""},
            }
        ),
        encoding="utf-8",
    )
    config = wi.load_config(str(cfg_path))
    assert config.backup is None
    assert config.scaffold_mode is False


def test_load_wine_schema_missing_exits(tmp_path, capsys):
    with pytest.raises(SystemExit) as exc:
        wi.load_wine_schema(str(tmp_path / "missing-schema.json"))
    assert exc.value.code == 1
    assert "wine-schema.json nicht gefunden" in capsys.readouterr().err


def test_load_wine_schema_parses(tmp_path):
    schema_path = tmp_path / "wine-schema.json"
    schema_path.write_text(
        json.dumps(
            [
                {"field": "name", "type": "text", "filter_type": "text-search", "default_filter": True},
                {"field": "price", "type": "text", "filter_type": None, "default_filter": False},
            ]
        ),
        encoding="utf-8",
    )
    schema = wi.load_wine_schema(str(schema_path))
    assert [s.field for s in schema] == ["name", "price"]
    assert schema[1].filter_type is None
    assert wi.get_scaffold_fields(schema) == ["name", "price"]
