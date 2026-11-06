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
    # remote_editor_path ist optional und fällt ohne Angabe auf "" zurück
    # (DeployConfig(**raw["deploy"]) bricht dadurch nicht).
    assert config.deploy.remote_editor_path == ""


def test_load_config_parses_remote_editor_path(tmp_path):
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
                    "protocol": "ftpes",
                    "host": "example.com",
                    "user": "myuser",
                    "password": "",
                    "remote_path": "/wine_app",
                    "remote_images_path": "/wine_app/images",
                    "remote_import_path": "/wine_app/data",
                    "remote_editor_path": "/wine_app/editor",
                },
                "editor": {"path": "/editor-geheim", "password_hash": ""},
            }
        ),
        encoding="utf-8",
    )
    config = wi.load_config(str(cfg_path))
    assert config.deploy.remote_editor_path == "/wine_app/editor"


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


# --- Secrets-Auflösung (Config > Secrets-Datei > Env) ---------------------


def _write_config(tmp_path, deploy_overrides=None):
    """Minimale Config-Datei; deploy-Felder host/user/password per Override leer
    oder gesetzt. Rückgabe: Pfad zur Config."""
    deploy = {
        "protocol": "ftpes",
        "host": "",
        "user": "",
        "password": "",
        "remote_path": "/wine_app",
        "remote_images_path": "/wine_app/images",
        "remote_import_path": "/wine_app/data",
    }
    deploy.update(deploy_overrides or {})
    cfg_path = tmp_path / "weinsprechstunde.config.json"
    cfg_path.write_text(
        json.dumps(
            {
                "import_source": "local",
                "export_path": "./export/data/wines.json",
                "scaffold_mode": True,
                "image_export_dir": "./export/images",
                "image_resize_mode": "width",
                "image_resize_px": 1200,
                "deploy": deploy,
                "editor": {"path": "/e", "password_hash": ""},
            }
        ),
        encoding="utf-8",
    )
    return cfg_path


def _write_secrets(tmp_path, data):
    secrets = tmp_path / "weinsprechstunde.secrets.json"
    secrets.write_text(json.dumps(data), encoding="utf-8")
    return secrets


def test_config_without_secrets_file_is_not_an_error(tmp_path, monkeypatch):
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_HOST", raising=False)
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_USER", raising=False)
    cfg_path = _write_config(tmp_path)
    config = wi.load_config(str(cfg_path))
    # Keine Secrets-Datei, keine Env -> Felder bleiben leer, kein Fehler.
    assert config.deploy.host == ""
    assert config.deploy.user == ""
    assert config.deploy.password == ""


def test_secrets_file_fills_host_user_password(tmp_path, monkeypatch):
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_HOST", raising=False)
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_USER", raising=False)
    cfg_path = _write_config(tmp_path)
    _write_secrets(tmp_path, {"host": "s-host", "user": "s-user", "password": "s-pass"})
    config = wi.load_config(str(cfg_path))
    assert config.deploy.host == "s-host"
    assert config.deploy.user == "s-user"
    assert config.deploy.password == "s-pass"


def test_config_values_take_precedence_over_secrets(tmp_path, monkeypatch):
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_HOST", raising=False)
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_USER", raising=False)
    cfg_path = _write_config(
        tmp_path,
        {"host": "cfg-host", "user": "cfg-user", "password": "cfg-pass"},
    )
    _write_secrets(tmp_path, {"host": "s-host", "user": "s-user", "password": "s-pass"})
    config = wi.load_config(str(cfg_path))
    # Config > Secrets.
    assert config.deploy.host == "cfg-host"
    assert config.deploy.user == "cfg-user"
    assert config.deploy.password == "cfg-pass"


def test_secrets_take_precedence_over_env(tmp_path, monkeypatch):
    monkeypatch.setenv("WEINSPRECHSTUNDE_DEPLOY_HOST", "env-host")
    monkeypatch.setenv("WEINSPRECHSTUNDE_DEPLOY_USER", "env-user")
    cfg_path = _write_config(tmp_path)
    _write_secrets(tmp_path, {"host": "s-host", "user": "s-user"})
    config = wi.load_config(str(cfg_path))
    # Secrets > Env.
    assert config.deploy.host == "s-host"
    assert config.deploy.user == "s-user"


def test_env_fills_host_user_when_config_and_secrets_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("WEINSPRECHSTUNDE_DEPLOY_HOST", "env-host")
    monkeypatch.setenv("WEINSPRECHSTUNDE_DEPLOY_USER", "env-user")
    cfg_path = _write_config(tmp_path)
    config = wi.load_config(str(cfg_path))
    # Keine Config-Werte, keine Secrets-Datei -> Env greift.
    assert config.deploy.host == "env-host"
    assert config.deploy.user == "env-user"


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


# --- import_dir-Auflösung (Config > Secrets-Datei > <Projektordner>/import) ---
def test_import_dir_from_secrets_when_not_in_config(tmp_path, monkeypatch):
    for k in ("HOST", "USER", "PASSWORD"):
        monkeypatch.delenv(f"WEINSPRECHSTUNDE_DEPLOY_{k}", raising=False)
    cfg_path = _write_config(tmp_path)
    _write_secrets(tmp_path, {"import_dir": "/mein/import"})
    assert wi.load_config(str(cfg_path)).import_dir == "/mein/import"


def test_import_dir_defaults_to_project_import_folder(tmp_path, monkeypatch):
    for k in ("HOST", "USER", "PASSWORD"):
        monkeypatch.delenv(f"WEINSPRECHSTUNDE_DEPLOY_{k}", raising=False)
    cfg_path = _write_config(tmp_path)
    assert wi.load_config(str(cfg_path)).import_dir == str(tmp_path.resolve() / "import")


def test_import_dir_empty_secret_falls_back_to_default(tmp_path, monkeypatch):
    for k in ("HOST", "USER", "PASSWORD"):
        monkeypatch.delenv(f"WEINSPRECHSTUNDE_DEPLOY_{k}", raising=False)
    cfg_path = _write_config(tmp_path)
    _write_secrets(tmp_path, {"import_dir": ""})
    assert wi.load_config(str(cfg_path)).import_dir == str(tmp_path.resolve() / "import")


def test_import_dir_config_takes_precedence_over_secrets(tmp_path, monkeypatch):
    for k in ("HOST", "USER", "PASSWORD"):
        monkeypatch.delenv(f"WEINSPRECHSTUNDE_DEPLOY_{k}", raising=False)
    cfg_path = _write_config(tmp_path)
    raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    raw["import_dir"] = "/aus/config"
    cfg_path.write_text(json.dumps(raw), encoding="utf-8")
    _write_secrets(tmp_path, {"import_dir": "/aus/secrets"})
    assert wi.load_config(str(cfg_path)).import_dir == "/aus/config"
