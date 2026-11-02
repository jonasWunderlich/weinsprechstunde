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
    config = make_config(password="geheim", protocol="ftpes", host="badhost")

    def boom(*a, **k):
        raise OSError("name resolution failed")

    monkeypatch.setattr(wi, "_deploy_ftp", boom)
    with pytest.raises(SystemExit) as exc:
        wi.phase_deploy(config)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "FEHLER: Verbindung zum Server badhost fehlgeschlagen." in err
    assert "Server-Meldung: name resolution failed" in err
    assert "(1) Ist der Hostname 'badhost' korrekt?" in err
    assert "(2) Sind Benutzername und Passwort gültig?" in err
    assert "Protokoll (ftpes) korrekt?" in err


# --- Fake FTP_TLS ---------------------------------------------------------


class FakeFTP:
    """Minimale ftplib.FTP_TLS-Attrappe für den FTPES-Deploy-/Download-Pfad.

    login/auth/prot_p/set_pasv sind no-ops (die echte Verbindung übernimmt
    sonst _ftps_connect). nlst liefert Listings pro Verzeichnis; dirs markiert
    bekannte Verzeichnisse für cwd-basierte _ftp_is_dir-Prüfungen.
    """

    def __init__(self, listing=None, dirs=None, mtimes=None):
        self.stored = []
        self.deleted = []
        self.made_dirs = []
        self.listing = listing or {}
        self.dirs = set(dirs or [])
        self.mtimes = mtimes or {}
        self._pwd = "/"

    # Verbindungs-/TLS-no-ops
    def login(self, user=None, password=None):
        pass

    def auth(self):
        pass

    def prot_p(self):
        pass

    def set_pasv(self, flag):
        pass

    # Verzeichnis-/Datei-Operationen
    def pwd(self):
        return self._pwd

    def cwd(self, path):
        if path in self.dirs or path == self._pwd:
            self._pwd = path
            return
        import ftplib as _f

        raise _f.error_perm(f"550 Not a directory: {path}")

    def mkd(self, path):
        self.dirs.add(path)
        self.made_dirs.append(path)

    def nlst(self, path=""):
        return self.listing.get(path, [])

    def sendcmd(self, cmd):
        if cmd.startswith("MDTM "):
            remote_file = cmd.split(" ", 1)[1]
            if remote_file in self.mtimes:
                import datetime as _dt

                ts = _dt.datetime.fromtimestamp(self.mtimes[remote_file])
                return "213 " + ts.strftime("%Y%m%d%H%M%S")
            import ftplib as _f

            raise _f.error_perm("550 no such file")
        import ftplib as _f

        raise _f.error_perm("500 unknown")

    def storbinary(self, cmd, fh):
        self.stored.append(cmd.split(" ", 1)[1])

    def delete(self, path):
        self.deleted.append(path)

    def quit(self):
        pass


def _patch_ftp(monkeypatch, fake):
    """wi._ftps_connect liefert den Fake statt eine echte FTP_TLS-Verbindung."""
    monkeypatch.setattr(wi, "_ftps_connect", lambda *a, **k: fake)
    return fake


def _make_dist(tmp_path):
    dist = tmp_path / "frontend" / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<html></html>", encoding="utf-8")
    return dist


def test_deploy_uploads_dist_and_never_deletes_wines_or_images(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)
    # wines.json + Bilder vorbereiten
    export_path = tmp_path / "export" / "data" / "wines.json"
    export_path.parent.mkdir(parents=True)
    export_path.write_text("[]", encoding="utf-8")
    images = tmp_path / "export" / "images"
    images.mkdir(parents=True)
    (images / "a.jpg").write_bytes(b"img")

    config = make_config(
        password="geheim",
        protocol="ftpes",
        export_path=str(export_path),
        image_export_dir=str(images),
    )
    base = config.deploy.remote_path  # /wine_app

    # Server hat eine veraltete dist-Datei (lokal nicht vorhanden), eine aus
    # einem früheren Deploy liegende wines.json im data-Ordner sowie den
    # images-/data-Ordner. nlst liefert verschachtelte Pfade mit "/".
    listing = {
        base: [
            f"{base}/index.html",
            f"{base}/old.js",
            f"{base}/images",
            f"{base}/data",
        ],
        f"{base}/images": [f"{base}/images/a.jpg"],
        f"{base}/data": [f"{base}/data/wines.json"],
    }
    fake = FakeFTP(listing=listing, dirs={base, f"{base}/images", f"{base}/data"})
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # index.html nach /wine_app, wines.json nach /wine_app/data, Bild nach
    # /wine_app/images hochgeladen.
    assert f"{base}/index.html" in fake.stored
    assert f"{base}/data/wines.json" in fake.stored
    assert f"{base}/images/a.jpg" in fake.stored
    # veraltete dist-Datei gelöscht
    assert any(p.endswith("old.js") for p in fake.deleted)
    # wines.json, data/ und Bilder NIE gelöscht (Req 6.6).
    assert not any(p.endswith("wines.json") for p in fake.deleted)
    assert not any("/images/" in p for p in fake.deleted)
    assert not any("/data/" in p for p in fake.deleted)


def test_deploy_never_prunes_server_wines_json_without_local_export(tmp_path, monkeypatch):
    """Req 6.6: deploy als Einzelphase (ohne frische lokale wines.json) darf die
    serverseitige wines.json nicht löschen."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)
    # KEINE lokale wines.json, keine Bilder -> nur dist wird hochgeladen.

    config = make_config(
        password="geheim",
        protocol="ftpes",
        export_path=str(tmp_path / "export" / "data" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
    )
    base = config.deploy.remote_path
    listing = {
        base: [f"{base}/index.html", f"{base}/data"],
        f"{base}/data": [f"{base}/data/wines.json"],
    }
    fake = FakeFTP(listing=listing, dirs={base, f"{base}/data"})
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # Serverseitige wines.json bleibt erhalten, auch ohne lokale Datei.
    assert not any(p.endswith("wines.json") for p in fake.deleted)


def test_deploy_skips_upload_when_remote_up_to_date(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    dist = _make_dist(tmp_path)
    local_mtime = (dist / "index.html").stat().st_mtime

    config = make_config(password="geheim", protocol="ftpes")
    base = config.deploy.remote_path
    remote_file = f"{base}/index.html"
    # Remote-Datei ist neuer -> kein Re-Upload
    fake = FakeFTP(mtimes={remote_file: local_mtime + 100})
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)
    assert not any(p.endswith("index.html") for p in fake.stored)


def test_deploy_uses_ftp_tls(tmp_path, monkeypatch):
    """Deploy verbindet über FTP_TLS (gemockt): _ftps_connect wird aufgerufen
    und der Upload läuft gegen die gelieferte FTP_TLS-Attrappe."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(password="geheim", protocol="ftpes")
    fake = FakeFTP()
    calls = {"n": 0}

    def fake_connect(host, user, password):
        calls["n"] += 1
        return fake

    monkeypatch.setattr(wi, "_ftps_connect", fake_connect)

    wi.phase_deploy(config)
    assert calls["n"] == 1
    assert any(p.endswith("index.html") for p in fake.stored)


# --- Build-Output-Pfad (browser-Unterordner als Deploy-Wurzel) --------------


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
    """index.html landet DIREKT unter remote_path, nicht unter
    ng-weinsprechstunde/browser/..."""
    monkeypatch.chdir(tmp_path)
    _make_nested_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="ftpes",
        export_path=str(tmp_path / "export" / "data" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
    )
    fake = FakeFTP()
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    base = config.deploy.remote_path.rstrip("/")
    # index.html direkt unter remote_path, NICHT verschachtelt.
    assert f"{base}/index.html" in fake.stored
    assert not any("ng-weinsprechstunde/browser" in p for p in fake.stored)
    # Unterordner assets/ bleibt erhalten.
    assert f"{base}/assets/wine-schema.json" in fake.stored
    # Die 3rdpartylicenses.txt neben browser/ wird nicht ausgeliefert.
    assert not any(p.endswith("3rdpartylicenses.txt") for p in fake.stored)


def test_resolve_dist_dir_flat_and_nested(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    from pathlib import Path

    flat = tmp_path / "frontend" / "dist"
    flat.mkdir(parents=True)
    (flat / "index.html").write_text("x", encoding="utf-8")
    assert wi._resolve_dist_dir() == Path("frontend/dist")

    (flat / "index.html").unlink()
    browser = flat / "ng-weinsprechstunde" / "browser"
    browser.mkdir(parents=True)
    (browser / "index.html").write_text("x", encoding="utf-8")
    assert wi._resolve_dist_dir() == Path("frontend/dist/ng-weinsprechstunde/browser")


# --- Prune-Scope: nur /wine_app, Pfade außerhalb bleiben unberührt ----------


def test_deploy_prunes_only_within_remote_path(tmp_path, monkeypatch):
    """Der Prune läuft NUR unter remote_path (/wine_app). images/, data/ und
    wines.json darunter sind geschützt."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(password="geheim", protocol="ftpes")
    base = config.deploy.remote_path  # /wine_app
    listing = {
        base: [
            f"{base}/index.html",
            f"{base}/stale.js",
            f"{base}/images",
            f"{base}/data",
        ],
        f"{base}/images": [f"{base}/images/keep.jpg"],
        f"{base}/data": [f"{base}/data/wines.json"],
    }
    fake = FakeFTP(listing=listing, dirs={base, f"{base}/images", f"{base}/data"})
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # stale.js wird geprunt ...
    assert f"{base}/stale.js" in fake.deleted
    # ... aber nichts im geschützten images-/data-Ordner.
    assert not any("/images/" in p for p in fake.deleted)
    assert not any("/data/" in p for p in fake.deleted)


# --- Remote-Download ------------------------------------------------------


def test_download_remote_import_error_exits(monkeypatch, capsys):
    config = make_config(password="geheim", protocol="ftpes", host="h")

    def boom(*a, **k):
        raise OSError("connection refused")

    monkeypatch.setattr(wi, "_download_ftp", boom)
    with pytest.raises(SystemExit) as exc:
        wi.download_remote_import(config, "geheim")
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "Download des Import-Ordners" in err
    assert config.deploy.remote_import_path in err
    assert "connection refused" in err
