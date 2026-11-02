"""Tests für Phase deploy + Remote-Download (mit Fakes, keine echten Verbindungen)."""

import pytest

from conftest import make_config
from conftest import weinimport as wi


# --- resolve_password -----------------------------------------------------


def test_password_from_config(monkeypatch):
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", raising=False)
    config = make_config(password="geheim")
    assert wi.resolve_password(config) == "geheim"


def test_password_from_env_fallback(monkeypatch):
    monkeypatch.setenv("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", "envpass")
    config = make_config(password="")
    assert wi.resolve_password(config) == "envpass"


def test_missing_password_exits_with_req_6_11_message(monkeypatch, capsys):
    monkeypatch.delenv("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", raising=False)
    config = make_config(password="")
    with pytest.raises(SystemExit) as exc:
        wi.resolve_password(config)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "FEHLER: Kein Deploy-Passwort gefunden." in err
    assert "WEINSPRECHSTUNDE_DEPLOY_PASSWORD" in err
    assert "export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=deinPasswort" in err


# --- Verbindungsfehler ----------------------------------------------------


def test_connection_failure_exits_with_req_6_12_message(monkeypatch, capsys):
    config = make_config(password="geheim", protocol="sftp", host="badhost")

    def boom(*a, **k):
        raise OSError("name resolution failed")

    monkeypatch.setattr(wi, "_deploy_sftp", boom)
    with pytest.raises(SystemExit) as exc:
        wi.phase_deploy(config)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "FEHLER: Verbindung zum Server badhost fehlgeschlagen." in err
    assert "Server-Meldung: name resolution failed" in err
    assert "(1) Ist der Hostname 'badhost' korrekt?" in err
    assert "(2) Sind Benutzername und Passwort gültig?" in err
    assert "Protokoll (sftp) korrekt?" in err


# --- Fake SFTP ------------------------------------------------------------


class FakeSFTP:
    def __init__(self, remote_mtimes=None, remote_listing=None):
        self.uploaded = []
        self.removed = []
        self.remote_mtimes = remote_mtimes or {}
        self.remote_listing = remote_listing or {}

    def stat(self, path):
        if path in self.remote_mtimes:
            class S:
                st_mtime = self.remote_mtimes[path]

            return S()
        raise IOError("no such file")

    def mkdir(self, path):
        pass

    def put(self, local, remote):
        self.uploaded.append(remote)

    def remove(self, path):
        self.removed.append(path)

    def listdir_attr(self, path):
        return self.remote_listing.get(path, [])

    def close(self):
        pass


class FakeEntry:
    def __init__(self, filename, is_dir=False):
        import stat as st

        self.filename = filename
        self.st_mode = st.S_IFDIR if is_dir else st.S_IFREG


class FakeChannel:
    """Minimale paramiko-Channel-Attrappe für exec_command-Backups."""

    def __init__(self, transport):
        self._transport = transport
        self._exit = 0

    def exec_command(self, cmd):
        self._transport.commands.append(cmd)
        # Fehlersimulation: Transport kann ein Kommando als fehlschlagend markieren.
        if self._transport.fail_on and self._transport.fail_on in cmd:
            self._exit = 1

    def makefile_stderr(self, _mode="rb"):
        import io

        return io.BytesIO(b"boom" if self._exit != 0 else b"")

    def recv_exit_status(self):
        return self._exit


class FakeTransport:
    """Transport-Attrappe mit SSH-Session-Unterstützung (open_session)."""

    def __init__(self, fail_on=None):
        self.commands = []
        self.fail_on = fail_on

    def open_session(self):
        return FakeChannel(self)

    def close(self):
        pass


def _patch_sftp(monkeypatch, fake, transport=None):
    transport = transport or FakeTransport()
    monkeypatch.setattr(
        wi, "_sftp_connect", lambda *a, **k: (transport, fake)
    )
    return transport


def _backup_config():
    """BackupConfig mit gesetztem remote_backup_dir für Pre-Deploy-Backups."""
    return wi.BackupConfig(
        backup_dir="./backup",
        max_last_backups=10,
        max_archival_backups=24,
        archival_interval_days=30,
        remote_backup_dir="/backup",
    )


def _make_dist(tmp_path):
    dist = tmp_path / "frontend" / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<html></html>", encoding="utf-8")
    return dist


def test_deploy_uploads_dist_and_never_deletes_wines_or_images(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)
    # wines.json + Bilder vorbereiten
    export_path = tmp_path / "frontend" / "src" / "assets" / "wines.json"
    export_path.parent.mkdir(parents=True)
    export_path.write_text("[]", encoding="utf-8")
    images = tmp_path / "export" / "images"
    images.mkdir(parents=True)
    (images / "a.jpg").write_bytes(b"img")

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(export_path),
        image_export_dir=str(images),
        backup=_backup_config(),
    )

    # Server hat eine veraltete dist-Datei (lokal nicht vorhanden) UND eine
    # aus einem früheren Deploy bereits vorhandene wines.json.
    listing = {
        config.deploy.remote_path: [
            FakeEntry("index.html"),
            FakeEntry("old.js"),
            FakeEntry("wines.json"),
        ]
    }
    fake = FakeSFTP(remote_listing=listing)
    _patch_sftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # index.html + wines.json + a.jpg hochgeladen
    assert any(p.endswith("index.html") for p in fake.uploaded)
    assert any(p.endswith("wines.json") for p in fake.uploaded)
    assert any(p.endswith("a.jpg") for p in fake.uploaded)
    # veraltete dist-Datei gelöscht
    assert any(p.endswith("old.js") for p in fake.removed)
    # wines.json und Bilder NIE gelöscht -- auch die bereits auf dem Server
    # liegende wines.json darf der Prune nicht entfernen (Req 6.6).
    assert not any(p.endswith("wines.json") for p in fake.removed)
    assert not any(p.endswith("a.jpg") for p in fake.removed)


def test_deploy_never_prunes_server_wines_json_without_local_export(tmp_path, monkeypatch):
    """Req 6.6: deploy als Einzelphase (ohne frische lokale wines.json) darf die
    serverseitige wines.json nicht löschen."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)
    # KEINE lokale wines.json, keine Bilder -> nur dist wird hochgeladen.

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )

    listing = {
        config.deploy.remote_path: [
            FakeEntry("index.html"),
            FakeEntry("wines.json"),
        ]
    }
    fake = FakeSFTP(remote_listing=listing)
    _patch_sftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # Serverseitige wines.json bleibt erhalten, auch ohne lokale Datei.
    assert not any(p.endswith("wines.json") for p in fake.removed)


def test_deploy_skips_upload_when_remote_up_to_date(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    dist = _make_dist(tmp_path)
    local_mtime = (dist / "index.html").stat().st_mtime

    config = make_config(password="geheim", protocol="sftp", backup=_backup_config())
    remote_file = f"{config.deploy.remote_path}/index.html"
    # Remote-Datei ist neuer -> kein Re-Upload
    fake = FakeSFTP(remote_mtimes={remote_file: local_mtime + 100})
    _patch_sftp(monkeypatch, fake)

    wi.phase_deploy(config)
    assert not any(p.endswith("index.html") for p in fake.uploaded)


# --- Aufgabe 1: Build-Output-Pfad (browser-Unterordner als Deploy-Wurzel) ---


def _make_nested_dist(tmp_path):
    """Angular @angular/build:application-Output: dist/<projekt>/browser/."""
    browser = tmp_path / "frontend" / "dist" / "ng-weinsprechstunde" / "browser"
    browser.mkdir(parents=True)
    (browser / "index.html").write_text("<html></html>", encoding="utf-8")
    (browser / "main-ABC123.js").write_text("console.log(1)", encoding="utf-8")
    (browser / "assets").mkdir()
    (browser / "assets" / "wine-schema.json").write_text("[]", encoding="utf-8")
    # 3rdpartylicenses.txt liegt neben browser/ und darf NICHT mit hochgeladen
    # werden (nur der browser-Inhalt ist die Deploy-Wurzel).
    (browser.parent / "3rdpartylicenses.txt").write_text("x", encoding="utf-8")
    return browser


def test_deploy_uploads_browser_build_as_remote_root(tmp_path, monkeypatch):
    """Aufgabe 1: index.html landet DIREKT unter remote_path, nicht unter
    ng-weinsprechstunde/browser/..."""
    monkeypatch.chdir(tmp_path)
    _make_nested_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    fake = FakeSFTP()
    _patch_sftp(monkeypatch, fake)

    wi.phase_deploy(config)

    base = config.deploy.remote_path.rstrip("/")
    # index.html direkt unter remote_path, NICHT verschachtelt.
    assert f"{base}/index.html" in fake.uploaded
    assert not any("ng-weinsprechstunde/browser" in p for p in fake.uploaded)
    # Unterordner assets/ bleibt erhalten.
    assert f"{base}/assets/wine-schema.json" in fake.uploaded
    # Die 3rdpartylicenses.txt neben browser/ wird nicht ausgeliefert.
    assert not any(p.endswith("3rdpartylicenses.txt") for p in fake.uploaded)


def test_resolve_dist_dir_flat_and_nested(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    # Flacher dist-Ordner (klassisch): index.html direkt in frontend/dist.
    from pathlib import Path

    flat = tmp_path / "frontend" / "dist"
    flat.mkdir(parents=True)
    (flat / "index.html").write_text("x", encoding="utf-8")
    # _resolve_dist_dir arbeitet relativ zum cwd (hier tmp_path).
    assert wi._resolve_dist_dir() == Path("frontend/dist")

    # Verschachtelter Build: <projekt>/browser mit index.html wird aufgelöst.
    (flat / "index.html").unlink()
    browser = flat / "ng-weinsprechstunde" / "browser"
    browser.mkdir(parents=True)
    (browser / "index.html").write_text("x", encoding="utf-8")
    assert wi._resolve_dist_dir() == Path("frontend/dist/ng-weinsprechstunde/browser")


# --- Aufgabe 2: serverseitiges Pre-Deploy-Backup vor dem Prune ---------------


def test_predeploy_backup_runs_before_prune(tmp_path, monkeypatch):
    """Vor dem Prune wird serverseitig ein zeitgestempeltes predeploy-Backup
    unter remote_backup_dir angelegt (per exec_command, kein lokaler Download)."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    listing = {config.deploy.remote_path: [FakeEntry("index.html"), FakeEntry("old.js")]}
    fake = FakeSFTP(remote_listing=listing)
    transport = FakeTransport()
    _patch_sftp(monkeypatch, fake, transport)

    wi.phase_deploy(config)

    # Ein mkdir-Backup-Kommando mit zeitgestempeltem Zielordner unter
    # remote_backup_dir wurde abgesetzt.
    import re

    mkdir_cmds = [c for c in transport.commands if c.startswith("mkdir -p")]
    assert mkdir_cmds, "Kein Backup-mkdir-Kommando gefunden"
    assert any(re.search(r"/backup/predeploy-\d{8}-\d{6}", c) for c in mkdir_cmds)
    # Ein cp -a-Kommando kopiert den remote_path-Inhalt serverseitig.
    assert any(c.startswith("cp -a") and "/html" in c for c in transport.commands)
    # Das Backup lief VOR dem Prune: old.js wurde trotzdem geprunt.
    assert any(p.endswith("old.js") for p in fake.removed)


def test_predeploy_backup_retention_keeps_five(tmp_path, monkeypatch):
    """Retention: nach dem Backup werden ältere predeploy-Ordner serverseitig
    geprunt, sodass max. MAX_PREDEPLOY_BACKUPS übrig bleiben."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    fake = FakeSFTP()
    transport = FakeTransport()
    _patch_sftp(monkeypatch, fake, transport)

    wi.phase_deploy(config)

    # Ein Retention-Kommando behält genau MAX_PREDEPLOY_BACKUPS (head -n -5).
    retention = [c for c in transport.commands if "predeploy-*" in c and "head -n" in c]
    assert retention, "Kein Retention-Kommando gefunden"
    assert any(f"head -n -{wi.MAX_PREDEPLOY_BACKUPS}" in c for c in retention)


def test_deploy_does_not_prune_when_backup_fails(tmp_path, monkeypatch):
    """Schlägt das Pre-Deploy-Backup fehl, wird NICHT geprunt und der Deploy
    bricht sauber ab (exit 1), bevor serverseitig gelöscht wird."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    listing = {config.deploy.remote_path: [FakeEntry("index.html"), FakeEntry("old.js")]}
    fake = FakeSFTP(remote_listing=listing)
    # Transport lässt das cp -a-Backup-Kommando fehlschlagen.
    transport = FakeTransport(fail_on="cp -a")
    _patch_sftp(monkeypatch, fake, transport)

    with pytest.raises(SystemExit) as exc:
        wi.phase_deploy(config)
    assert exc.value.code == 1
    # Kein Prune: keine Datei wurde gelöscht.
    assert fake.removed == []


def test_deploy_aborts_without_remote_backup_dir(tmp_path, monkeypatch):
    """Ohne remote_backup_dir kann kein serverseitiges Backup erstellt werden ->
    Deploy bricht ab, bevor geprunt wird."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    backup = wi.BackupConfig(
        backup_dir="./backup",
        max_last_backups=10,
        max_archival_backups=24,
        archival_interval_days=30,
        remote_backup_dir=None,
    )
    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=backup,
    )
    listing = {config.deploy.remote_path: [FakeEntry("index.html"), FakeEntry("old.js")]}
    fake = FakeSFTP(remote_listing=listing)
    _patch_sftp(monkeypatch, fake)

    with pytest.raises(SystemExit) as exc:
        wi.phase_deploy(config)
    assert exc.value.code == 1
    assert fake.removed == []


# --- Remote-Download ------------------------------------------------------


def test_download_remote_import_error_exits(monkeypatch, capsys):
    config = make_config(password="geheim", protocol="sftp", host="h")

    def boom(*a, **k):
        raise OSError("connection refused")

    monkeypatch.setattr(wi, "_download_sftp", boom)
    with pytest.raises(SystemExit) as exc:
        wi.download_remote_import(config, "geheim")
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "Download des Import-Ordners" in err
    assert config.deploy.remote_import_path in err
    assert "connection refused" in err
