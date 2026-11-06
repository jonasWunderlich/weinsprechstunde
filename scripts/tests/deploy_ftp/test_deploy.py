"""Tests für Phase deploy + Remote-Download (mit Fakes, keine echten Verbindungen)."""

import pytest

from conftest import make_config
from conftest import weinimport as wi
from weinlib import deploy
from weinlib import ftp_transport as ft


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

    monkeypatch.setattr(deploy, "_deploy_ftp", boom)
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


class MlsdFakeFTP(FakeFTP):
    """FakeFTP mit MLSD-Unterstützung (RFC 3659).

    ``mlsd_listing`` bildet remote_dir -> Liste von (basename, {"type": ...})
    ab. Jeder ``mlsd``-Aufruf wird in ``mlsd_calls`` protokolliert, und jeder
    ``nlst``-Aufruf in ``nlst_calls`` – so lässt sich nachweisen, dass der Prune
    MLSD nutzt und geschützte Verzeichnisse GAR NICHT auflistet.
    """

    def __init__(self, mlsd_listing=None, **kwargs):
        super().__init__(**kwargs)
        self.mlsd_listing = mlsd_listing or {}
        self.mlsd_calls = []
        self.nlst_calls = []

    def mlsd(self, path="", facts=None):
        self.mlsd_calls.append(path)
        return list(self.mlsd_listing.get(path, []))

    def nlst(self, path=""):
        self.nlst_calls.append(path)
        return super().nlst(path)


def _patch_ftp(monkeypatch, fake):
    """ft._ftps_connect liefert den Fake statt eine echte FTP_TLS-Verbindung."""
    monkeypatch.setattr(ft, "_ftps_connect", lambda *a, **k: fake)
    return fake


def _make_dist(tmp_path):
    dist = tmp_path / "frontend" / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<html></html>", encoding="utf-8")
    return dist


def _make_workspace_dist(tmp_path, weinliste_files=None, editor_files=None):
    """Realistischer Angular-Workspace-Output: weinliste + editor nebeneinander.

    frontend/dist/weinliste/browser/ (öffentliche App) und
    frontend/dist/editor/browser/ (Editor-App) – genau wie `ng build weinliste`
    und `ng build editor` nebeneinander schreiben. Der Editor-Build enthält
    bewusst KEINE Weindaten – nur die statische App-Hülle (Req 16.3).
    """
    dist = tmp_path / "frontend" / "dist"
    for project, files in (
        ("weinliste", weinliste_files or {"index.html": "<html>weinliste</html>"}),
        ("editor", editor_files or {"index.html": "<html>editor</html>"}),
    ):
        browser = dist / project / "browser"
        browser.mkdir(parents=True)
        for rel, content in files.items():
            target = browser / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
    return dist


def _make_editor_dist(tmp_path, files=None):
    """Editor-Build (ng build editor) unter frontend/dist/editor/browser/.

    Enthält bewusst KEINE Weindaten – nur die statische App-Hülle (Req 16.3).
    """
    browser = tmp_path / "frontend" / "dist" / "editor" / "browser"
    browser.mkdir(parents=True)
    for rel, content in (files or {"index.html": "<html>editor</html>"}).items():
        target = browser / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return browser


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

    monkeypatch.setattr(ft, "_ftps_connect", fake_connect)

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


def test_resolve_dist_dir_prefers_weinliste_in_workspace(tmp_path, monkeypatch):
    """Im Angular-Workspace (projects/weinliste + editor) baut `ng build` mehrere
    `<projekt>/browser/`-Ordner nebeneinander. Die Deploy-Phase liefert nur die
    öffentliche App `weinliste` aus, daher muss `_resolve_dist_dir` deren
    `frontend/dist/weinliste/browser/` deterministisch bevorzugen."""
    monkeypatch.chdir(tmp_path)
    from pathlib import Path

    dist = tmp_path / "frontend" / "dist"
    for project in ("weinliste", "editor"):
        browser = dist / project / "browser"
        browser.mkdir(parents=True)
        (browser / "index.html").write_text("x", encoding="utf-8")

    assert wi._resolve_dist_dir() == Path("frontend/dist/weinliste/browser")


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


# --- Prune: MLSD-Listing + geschützte Teilbäume nicht betreten --------------


def test_prune_uses_mlsd_and_does_not_enter_protected_dirs(tmp_path, monkeypatch):
    """Der Prune nutzt MLSD-Listing und steigt NICHT in images/ oder data/ ab
    (kein Listing, keine Löschung dort), löscht aber veraltete dist-Dateien."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(password="geheim", protocol="ftpes")
    base = config.deploy.remote_path  # /wine_app

    mlsd_listing = {
        base: [
            ("index.html", {"type": "file"}),
            ("stale.js", {"type": "file"}),
            ("images", {"type": "dir"}),
            ("data", {"type": "dir"}),
        ],
        # images/ und data/ liefern Inhalte -- dürfen aber NIE aufgelistet
        # werden, weil der Prune sie nicht betreten darf.
        f"{base}/images": [("keep.jpg", {"type": "file"})],
        f"{base}/data": [("wines.json", {"type": "file"})],
    }
    fake = MlsdFakeFTP(mlsd_listing=mlsd_listing)
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # MLSD wurde fürs remote_base-Listing genutzt (kein nlst-Fallback nötig).
    assert base in fake.mlsd_calls
    assert fake.nlst_calls == []
    # Geschützte Verzeichnisse wurden GAR NICHT aufgelistet (nicht betreten).
    assert f"{base}/images" not in fake.mlsd_calls
    assert f"{base}/data" not in fake.mlsd_calls
    # Veraltete dist-Datei wird geprunt ...
    assert f"{base}/stale.js" in fake.deleted
    # ... aber nichts im geschützten images-/data-Ordner, und wines.json bleibt.
    assert not any("/images/" in p for p in fake.deleted)
    assert not any("/data/" in p for p in fake.deleted)
    assert not any(p.endswith("wines.json") for p in fake.deleted)


def test_prune_mlsd_deletes_stale_nested_dist_file(tmp_path, monkeypatch):
    """MLSD-basierter Prune löscht veraltete Dateien auch in (ungeschützten)
    Unterordnern korrekt."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(password="geheim", protocol="ftpes")
    base = config.deploy.remote_path

    mlsd_listing = {
        base: [
            ("index.html", {"type": "file"}),
            ("assets", {"type": "dir"}),
        ],
        f"{base}/assets": [("old-chunk.js", {"type": "file"})],
    }
    fake = MlsdFakeFTP(mlsd_listing=mlsd_listing)
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # In den ungeschützten assets-Ordner wurde abgestiegen und die veraltete
    # Datei gelöscht.
    assert f"{base}/assets" in fake.mlsd_calls
    assert f"{base}/assets/old-chunk.js" in fake.deleted


# --- --force-images: alle Bilder neu hochladen ------------------------------


def _setup_images_and_dist(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)
    images = tmp_path / "export" / "images"
    images.mkdir(parents=True)
    (images / "a.jpg").write_bytes(b"img-a")
    (images / "b.jpg").write_bytes(b"img-b")
    config = make_config(
        password="geheim",
        protocol="ftpes",
        export_path=str(tmp_path / "export" / "data" / "wines.json"),
        image_export_dir=str(images),
    )
    return config, images


def test_force_images_reuploads_all_images_even_if_up_to_date(tmp_path, monkeypatch):
    config, images = _setup_images_and_dist(tmp_path, monkeypatch)
    base = config.deploy.remote_images_path
    # Beide Remote-Bilder sind laut MDTM aktuell (neuer als lokal).
    future = max((images / n).stat().st_mtime for n in ("a.jpg", "b.jpg")) + 1000
    mtimes = {f"{base}/a.jpg": future, f"{base}/b.jpg": future}
    fake = FakeFTP(mtimes=mtimes)
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config, force_images=True)

    # Trotz aktuellem Timestamp werden ALLE Bilder neu hochgeladen.
    assert f"{base}/a.jpg" in fake.stored
    assert f"{base}/b.jpg" in fake.stored


def test_without_force_images_skips_up_to_date_images(tmp_path, monkeypatch):
    config, images = _setup_images_and_dist(tmp_path, monkeypatch)
    base = config.deploy.remote_images_path
    future = (images / "a.jpg").stat().st_mtime + 1000
    # a.jpg ist aktuell (wird übersprungen), b.jpg fehlt remote (wird geladen).
    mtimes = {f"{base}/a.jpg": future}
    fake = FakeFTP(mtimes=mtimes)
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config, force_images=False)

    assert f"{base}/a.jpg" not in fake.stored  # aktuell -> übersprungen
    assert f"{base}/b.jpg" in fake.stored       # fehlend -> hochgeladen


def test_force_images_cli_flag_parsed():
    """--force-images landet als args.force_images im Parser; Default False."""
    parser = wi.build_parser()
    assert parser.parse_args(["deploy"]).force_images is False
    assert parser.parse_args(["deploy", "--force-images"]).force_images is True


# --- Remote-Download ------------------------------------------------------


def test_download_remote_import_error_exits(monkeypatch, capsys):
    config = make_config(password="geheim", protocol="ftpes", host="h")

    def boom(*a, **k):
        raise OSError("connection refused")

    monkeypatch.setattr(ft, "_download_ftp", boom)
    with pytest.raises(SystemExit) as exc:
        wi.download_remote_import(config, "geheim")
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "Download des Import-Ordners" in err
    assert config.deploy.remote_import_path in err
    assert "connection refused" in err


# --- TLS-Session-Reuse auf dem Datenkanal ---------------------------------


def test_ftps_connection_class_overrides_ntransfercmd():
    """_ftps_connect nutzt eine FTP_TLS-Subklasse, die ntransfercmd überschreibt
    (Voraussetzung für den TLS-Session-Reuse gegen Pure-FTPd)."""
    import ftplib

    assert issubclass(wi._ReuseTLS_FTP, ftplib.FTP_TLS)
    # Das Override liegt auf der Subklasse selbst, nicht geerbt von FTP_TLS.
    assert "ntransfercmd" in vars(wi._ReuseTLS_FTP)


def test_ntransfercmd_reuses_control_session_on_data_channel(monkeypatch):
    """Im prot_p-Fall wird die Kontroll-TLS-Session auf dem Datenkanal
    wiederverwendet: context.wrap_socket wird mit session=<Kontroll-Session>
    aufgerufen."""
    import ftplib

    ftp = wi._ReuseTLS_FTP.__new__(wi._ReuseTLS_FTP)
    ftp._prot_p = True
    ftp.host = "example.test"

    control_session = object()
    raw_data_conn = object()
    wrapped_data_conn = object()

    class FakeControlSock:
        session = control_session

    class FakeContext:
        def __init__(self):
            self.calls = []

        def wrap_socket(self, sock, server_hostname=None, session=None):
            self.calls.append((sock, server_hostname, session))
            return wrapped_data_conn

    ftp.sock = FakeControlSock()
    ftp.context = FakeContext()

    # Basis-ntransfercmd liefert einen rohen (unverschlüsselten) Datenkanal.
    monkeypatch.setattr(ftplib.FTP, "ntransfercmd",
                        lambda self, cmd, rest=None: (raw_data_conn, 123))

    conn, size = ftp.ntransfercmd("RETR foo")

    assert size == 123
    # Datenkanal wurde neu gewrappt -> Session-Reuse aktiv.
    assert conn is wrapped_data_conn
    assert ftp.context.calls == [(raw_data_conn, "example.test", control_session)]


def test_ntransfercmd_no_reuse_when_not_prot_p(monkeypatch):
    """Ohne prot_p bleibt es beim Standardverhalten (kein erneutes wrap_socket)."""
    import ftplib

    ftp = wi._ReuseTLS_FTP.__new__(wi._ReuseTLS_FTP)
    ftp._prot_p = False
    ftp.host = "example.test"
    raw_data_conn = object()

    class FakeContext:
        def __init__(self):
            self.calls = []

        def wrap_socket(self, *a, **k):
            self.calls.append((a, k))
            return object()

    ftp.context = FakeContext()
    monkeypatch.setattr(ftplib.FTP, "ntransfercmd",
                        lambda self, cmd, rest=None: (raw_data_conn, 0))

    conn, _ = ftp.ntransfercmd("LIST")
    assert conn is raw_data_conn
    assert ftp.context.calls == []

# --- Editor-App: eigener Remote-Unterordner im wine_app-Bereich -------------


def test_resolve_editor_dist_dir_nested_and_flat(tmp_path, monkeypatch):
    """_resolve_editor_dist_dir liefert den browser-Unterordner des Editors;
    ohne Editor-Build liefert sie None."""
    monkeypatch.chdir(tmp_path)
    from pathlib import Path

    # Kein Editor-Build vorhanden -> None.
    assert wi._resolve_editor_dist_dir() is None

    # Standard-Workspace-Output: frontend/dist/editor/browser/.
    browser = tmp_path / "frontend" / "dist" / "editor" / "browser"
    browser.mkdir(parents=True)
    (browser / "index.html").write_text("x", encoding="utf-8")
    assert wi._resolve_editor_dist_dir() == Path("frontend/dist/editor/browser")


def test_editor_subtree_is_protected_from_weinliste_prune():
    """Der Editor-Unterordner (/wine_app/editor) ist beim weinliste-Prune
    geschützt wie images/ und data/ (Req 6.6, 17.1)."""
    config = make_config(remote_editor_path="/wine_app/editor")
    exact, prefixes = wi._protected_prefixes(config)
    assert "editor/" in prefixes
    assert wi._is_protected("editor/", exact, prefixes)
    assert wi._is_protected("editor/index.html", exact, prefixes)


def test_deploy_uploads_editor_build_to_remote_editor_path(tmp_path, monkeypatch):
    """Der Editor-Build landet unter deploy.remote_editor_path (/wine_app/editor),
    getrennt von der öffentlichen Weinliste."""
    monkeypatch.chdir(tmp_path)
    _make_workspace_dist(
        tmp_path,
        editor_files={
            "index.html": "<html>editor</html>",
            "assets/app.js": "console.log(1)",
        },
    )

    config = make_config(
        password="geheim",
        protocol="ftpes",
        remote_editor_path="/wine_app/editor",
        export_path=str(tmp_path / "export" / "data" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
    )
    fake = FakeFTP()
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    editor_base = config.deploy.remote_editor_path.rstrip("/")
    base = config.deploy.remote_path.rstrip("/")
    assert f"{editor_base}/index.html" in fake.stored
    assert f"{editor_base}/assets/app.js" in fake.stored
    # Öffentliche Weinliste weiterhin unter remote_path.
    assert f"{base}/index.html" in fake.stored
    # Die öffentliche Weinliste enthält KEINE Editor-Dateien (getrennte Builds).
    assert f"{base}/assets/app.js" not in fake.stored


def test_editor_deploy_never_deletes_wines_or_images(tmp_path, monkeypatch):
    """Der Editor-Schritt löscht keine Weindaten/Bilder und betritt images/,
    data/ und wines.json nicht."""
    monkeypatch.chdir(tmp_path)
    _make_workspace_dist(tmp_path)
    export_path = tmp_path / "export" / "data" / "wines.json"
    export_path.parent.mkdir(parents=True)
    export_path.write_text("[]", encoding="utf-8")
    images = tmp_path / "export" / "images"
    images.mkdir(parents=True)
    (images / "a.jpg").write_bytes(b"img")

    config = make_config(
        password="geheim",
        protocol="ftpes",
        remote_editor_path="/wine_app/editor",
        export_path=str(export_path),
        image_export_dir=str(images),
    )
    base = config.deploy.remote_path
    editor_base = config.deploy.remote_editor_path
    # Server-Listing: wine_app mit images/, data/ und editor/ (mit Altbestand).
    listing = {
        base: [
            f"{base}/index.html",
            f"{base}/images",
            f"{base}/data",
            f"{base}/editor",
        ],
        f"{base}/images": [f"{base}/images/a.jpg"],
        f"{base}/data": [f"{base}/data/wines.json"],
        editor_base: [f"{editor_base}/index.html", f"{editor_base}/stale.js"],
    }
    fake = FakeFTP(
        listing=listing,
        dirs={base, f"{base}/images", f"{base}/data", editor_base},
    )
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # Editor-Build hochgeladen ...
    assert f"{editor_base}/index.html" in fake.stored
    # ... veraltete Editor-Datei im Editor-Unterbaum geprunt ...
    assert f"{editor_base}/stale.js" in fake.deleted
    # ... aber Weindaten/Bilder NIE angetastet (Req 6.6).
    assert not any(p.endswith("wines.json") for p in fake.deleted)
    assert not any("/images/" in p for p in fake.deleted)
    assert not any("/data/" in p for p in fake.deleted)


def test_weinliste_prune_does_not_enter_editor_subtree(tmp_path, monkeypatch):
    """Der weinliste-dist-Prune betritt den Editor-Unterordner GAR NICHT
    (eigener Unterbaum, über _protected_prefixes geschützt). Nur der separate
    Editor-Schritt pflegt diesen Unterbaum (Req 6.6, 17.1)."""
    monkeypatch.chdir(tmp_path)
    # Editor-Build enthält index.html + keep.js -> beide bleiben beim
    # Editor-Prune erhalten (lokal vorhanden).
    _make_workspace_dist(
        tmp_path,
        editor_files={"index.html": "<html>editor</html>", "keep.js": "x"},
    )

    config = make_config(
        password="geheim",
        protocol="ftpes",
        remote_editor_path="/wine_app/editor",
    )
    base = config.deploy.remote_path
    editor_base = config.deploy.remote_editor_path
    listing = {
        base: [f"{base}/index.html", f"{base}/editor"],
        editor_base: [f"{editor_base}/index.html", f"{editor_base}/keep.js"],
    }
    fake = MlsdFakeFTP(
        mlsd_listing={
            base: [("index.html", {"type": "file"}), ("editor", {"type": "dir"})],
            editor_base: [
                ("index.html", {"type": "file"}),
                ("keep.js", {"type": "file"}),
            ],
        },
        listing=listing,
        dirs={base, editor_base},
    )
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # Der weinliste-Prune (startet bei remote_base) darf den Editor-Unterbaum
    # NICHT betreten: Das Editor-Listing kam ausschließlich vom separaten
    # Editor-Prune. Hier prüfen wir, dass keine Editor-Datei durch den
    # weinliste-Prune verloren geht – keep.js und index.html bleiben erhalten.
    assert not any(p.endswith("keep.js") for p in fake.deleted)
    assert not any(p == f"{editor_base}/index.html" for p in fake.deleted)


def test_deploy_skips_editor_when_no_editor_build(tmp_path, monkeypatch):
    """Ohne Editor-Build läuft der weinliste-Deploy unverändert; es wird nichts
    in den Editor-Unterordner hochgeladen."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)  # nur weinliste-dist, KEIN editor-Build

    config = make_config(
        password="geheim",
        protocol="ftpes",
        remote_editor_path="/wine_app/editor",
    )
    fake = FakeFTP()
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    editor_base = config.deploy.remote_editor_path.rstrip("/")
    assert not any(p.startswith(editor_base + "/") for p in fake.stored)
    # weinliste weiterhin deployt.
    assert f"{config.deploy.remote_path.rstrip('/')}/index.html" in fake.stored


def test_deploy_skips_editor_when_remote_editor_path_empty(tmp_path, monkeypatch):
    """Ohne konfigurierten remote_editor_path wird der Editor-Schritt
    übersprungen (rückwärtskompatibel)."""
    monkeypatch.chdir(tmp_path)
    # Realistischer Workspace: weinliste wird aufgelöst, der Editor-Build liegt
    # separat und wird mangels remote_editor_path NICHT hochgeladen.
    _make_workspace_dist(tmp_path)

    config = make_config(password="geheim", protocol="ftpes", remote_editor_path="")
    fake = FakeFTP()
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    # Kein Upload in irgendeinen editor-Remote-Unterordner.
    assert not any(p.startswith("/wine_app/editor/") for p in fake.stored)
    # weinliste weiterhin deployt.
    assert f"{config.deploy.remote_path.rstrip('/')}/index.html" in fake.stored
