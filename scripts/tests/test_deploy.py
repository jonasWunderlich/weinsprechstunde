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


def _patch_sftp(monkeypatch, fake):
    class FakeTransport:
        def close(self):
            pass

    monkeypatch.setattr(wi, "_sftp_connect", lambda *a, **k: (FakeTransport(), fake))


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

    config = make_config(password="geheim", protocol="sftp")
    remote_file = f"{config.deploy.remote_path}/index.html"
    # Remote-Datei ist neuer -> kein Re-Upload
    fake = FakeSFTP(remote_mtimes={remote_file: local_mtime + 100})
    _patch_sftp(monkeypatch, fake)

    wi.phase_deploy(config)
    assert not any(p.endswith("index.html") for p in fake.uploaded)


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
