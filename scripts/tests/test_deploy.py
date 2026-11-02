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
    """Attrappe eines paramiko-Exec-Channels.

    ``backup_fail`` lässt das serverseitige ``cp -a`` fehlschlagen (Exit != 0).
    ``ls_output`` bestimmt, welche Einträge ``ls -1`` für die Retention liefert.
    """

    def __init__(self, parent, command):
        self.parent = parent
        self.command = command
        self._status = 0
        self._stdout = b""
        self._stderr = b""

    def exec_command(self, command):
        self.command = command
        self.parent.exec_commands.append(command)
        if command.startswith("cp -a") or " && cp -a" in command:
            if self.parent.backup_fail:
                self._status = 1
                self._stderr = b"cp: permission denied"
        elif command.startswith("ls -1"):
            self._stdout = ("\n".join(self.parent.ls_output) + "\n").encode()
        elif command.startswith("rm -rf"):
            self.parent.removed_dirs.append(command)

    def makefile(self, _mode):
        import io

        return io.BytesIO(self._stdout)

    def makefile_stderr(self, _mode):
        import io

        return io.BytesIO(self._stderr)

    def recv_exit_status(self):
        return self._status

    def close(self):
        pass


class FakeTransport:
    """Transport-Attrappe: close + SSH-Exec-Sessions für serverseitiges Backup."""

    def __init__(self, backup_fail=False, ls_output=None):
        self.exec_commands = []
        self.removed_dirs = []
        self.backup_fail = backup_fail
        self.ls_output = ls_output or []

    def open_session(self):
        return FakeChannel(self, "")

    def close(self):
        pass


def _patch_sftp(monkeypatch, fake, transport=None):
    transport = transport or FakeTransport()
    monkeypatch.setattr(
        wi, "_sftp_connect", lambda *a, **k: (transport, fake)
    )
    return transport


def _backup_config():
    """BackupConfig für serverseitige Pre-Deploy-Backups (remote_backup_dir)."""
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


# --- Aufgabe 2: SERVERSEITIGES Pre-Deploy-Backup von remote_path vor Prune ---


def test_predeploy_backup_copies_remote_path_server_side_before_prune(tmp_path, monkeypatch):
    """Vor dem Prune wird remote_path SERVERSEITIG (cp -a per SSH-Exec) in einen
    zeitgestempelten Ordner unter remote_backup_dir kopiert – kein Download."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    # Server hat zwei Dateien unter remote_path; old.js wird nach dem Backup geprunt.
    listing = {config.deploy.remote_path: [FakeEntry("index.html"), FakeEntry("old.js")]}
    fake = FakeSFTP(remote_listing=listing)
    transport = FakeTransport()
    _patch_sftp(monkeypatch, fake, transport)

    wi.phase_deploy(config)

    import re

    # Ein serverseitiges cp -a in einen zeitgestempelten predeploy-Ordner unter
    # remote_backup_dir wurde ausgeführt.
    cp_cmds = [c for c in transport.exec_commands if "cp -a" in c]
    assert cp_cmds, "Kein serverseitiges cp -a Backup ausgeführt"
    assert re.search(r"/backup/predeploy-\d{8}-\d{6}", cp_cmds[0]), cp_cmds[0]
    assert "/html" in cp_cmds[0]  # Quelle ist remote_path
    # Keine Downloads: FakeSFTP hat keine get()-Methode mehr -> rein serverseitig.
    assert not hasattr(fake, "downloaded")
    # Kein lokaler predeploy-Ordner im backup_dir.
    backup_dir = tmp_path / "backup"
    if backup_dir.exists():
        assert not any(d.name.startswith("predeploy-") for d in backup_dir.iterdir())
    # Backup lief VOR dem Prune: old.js wurde danach trotzdem geprunt.
    assert any(p.endswith("old.js") for p in fake.removed)


def test_predeploy_backup_retention_keeps_five_server_side(tmp_path, monkeypatch):
    """Retention: serverseitig bleiben max. MAX_PREDEPLOY_BACKUPS predeploy-
    Ordner übrig; ältere werden per rm -rf serverseitig entfernt."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    # Server meldet 7 vorhandene predeploy-Ordner + nach cp -a kommt der neue
    # hinzu -> ls liefert diese Liste bei der Retention.
    existing = [f"predeploy-20200101-00000{i}" for i in range(7)]
    fake = FakeSFTP()
    transport = FakeTransport(ls_output=existing + ["predeploy-20991231-235959"])
    _patch_sftp(monkeypatch, fake, transport)

    wi.phase_deploy(config)

    rm_cmds = [c for c in transport.exec_commands if c.startswith("rm -rf")]
    # 8 Ordner - 5 behalten = 3 Löschungen.
    assert len(rm_cmds) == 8 - wi.MAX_PREDEPLOY_BACKUPS
    # Die ältesten werden entfernt.
    assert any("predeploy-20200101-000000" in c for c in rm_cmds)


def test_deploy_does_not_prune_when_backup_fails(tmp_path, monkeypatch):
    """Schlägt das serverseitige Pre-Deploy-Backup fehl, wird NICHT geprunt und
    der Deploy bricht sauber ab (exit 1), mit eigener Meldung."""
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
    # Das serverseitige cp -a schlägt fehl -> Backup scheitert grundsätzlich.
    transport = FakeTransport(backup_fail=True)
    _patch_sftp(monkeypatch, fake, transport)

    with pytest.raises(SystemExit) as exc:
        wi.phase_deploy(config)
    assert exc.value.code == 1
    # Kein Prune: keine Datei wurde gelöscht.
    assert fake.removed == []


def test_backup_failure_message_is_distinct_from_connection_error(tmp_path, monkeypatch, capsys):
    """Ein Backup-Fehler darf NICHT als Verbindungs-/Passwort-Problem gemeldet
    werden, sondern mit einer eigenen Pre-Deploy-Backup-Meldung."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    listing = {config.deploy.remote_path: [FakeEntry("index.html")]}
    fake = FakeSFTP(remote_listing=listing)
    transport = FakeTransport(backup_fail=True)
    _patch_sftp(monkeypatch, fake, transport)

    with pytest.raises(SystemExit):
        wi.phase_deploy(config)
    err = capsys.readouterr().err
    assert "Pre-Deploy-Backup" in err
    assert "Prune übersprungen" in err
    # NICHT die Verbindungsfehler-Meldung.
    assert "Verbindung zum Server" not in err


def test_deploy_aborts_without_remote_backup_dir(tmp_path, monkeypatch):
    """Ohne remote_backup_dir gibt es kein serverseitiges Backup-Ziel ->
    Deploy bricht ab, bevor geprunt wird."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    backup = _backup_config()
    backup.remote_backup_dir = None
    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=backup,
    )
    listing = {config.deploy.remote_path: [FakeEntry("index.html"), FakeEntry("old.js")]}
    fake = FakeSFTP(remote_listing=listing)
    transport = FakeTransport()
    _patch_sftp(monkeypatch, fake, transport)

    with pytest.raises(SystemExit) as exc:
        wi.phase_deploy(config)
    assert exc.value.code == 1
    assert fake.removed == []


def test_predeploy_backup_respects_config_override(tmp_path, monkeypatch):
    """Optionales Config-Feld max_predeploy_backups überschreibt den Default 5."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    backup = _backup_config()
    backup.max_predeploy_backups = 2
    config = make_config(
        password="geheim",
        protocol="sftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=backup,
    )
    existing = [f"predeploy-20200101-00000{i}" for i in range(4)]
    fake = FakeSFTP()
    transport = FakeTransport(ls_output=existing + ["predeploy-20991231-235959"])
    _patch_sftp(monkeypatch, fake, transport)

    wi.phase_deploy(config)

    rm_cmds = [c for c in transport.exec_commands if c.startswith("rm -rf")]
    # 5 Ordner - 2 behalten = 3 Löschungen.
    assert len(rm_cmds) == 5 - 2


# --- Aufgabe 2: FTP-Deploy mit lokalem Pre-Deploy-Backup ---------------------


class FakeFTP:
    """Minimale ftplib.FTP-Attrappe für den FTP-Deploy-Pfad.

    ``copy_fail`` lässt die serverseitige Kopie (SITE CPFR/CPTO) fehlschlagen.
    """

    def __init__(self, listing=None, dirs=None, copy_fail=False):
        self.stored = []
        self.deleted = []
        self.removed_dirs = []
        self.site_cmds = []  # ausgeführte SITE CPFR/CPTO Kommandos
        # listing: {remote_dir: [namen]} für nlst; dirs: set von Verzeichnispfaden.
        self.listing = listing or {}
        self.dirs = set(dirs or [])
        self.copy_fail = copy_fail
        self._pwd = "/"

    def login(self, user, password):
        pass

    def pwd(self):
        return self._pwd

    def cwd(self, path):
        # error_perm, wenn das Ziel kein bekanntes Verzeichnis ist.
        if path in self.dirs or path == self._pwd:
            self._pwd = path
            return
        import ftplib as _f

        raise _f.error_perm(f"550 Not a directory: {path}")

    def mkd(self, path):
        self.dirs.add(path)

    def rmd(self, path):
        self.removed_dirs.append(path)
        self.dirs.discard(path)

    def nlst(self, path=""):
        return self.listing.get(path, [])

    def sendcmd(self, cmd):
        if cmd.startswith("SITE CP"):
            if self.copy_fail:
                import ftplib as _f

                raise _f.error_perm(f"550 copy failed: {cmd}")
            self.site_cmds.append(cmd)
            return "250 copied"
        import ftplib as _f

        raise _f.error_perm("500 unknown")

    def storbinary(self, cmd, fh):
        self.stored.append(cmd.split(" ", 1)[1])

    def delete(self, path):
        self.deleted.append(path)

    def quit(self):
        pass


def _patch_ftp(monkeypatch, fake):
    monkeypatch.setattr(wi.ftplib, "FTP", lambda *a, **k: fake)


def test_ftp_deploy_copies_remote_path_server_side_before_prune(tmp_path, monkeypatch):
    """FTP-Deploy: Vor dem Prune wird remote_path SERVERSEITIG (SITE CPFR/CPTO)
    nach remote_backup_dir/predeploy-<ts>/ kopiert – kein Download – und danach
    wird geprunt."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="ftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    base = config.deploy.remote_path
    # Server hat index.html (behalten) und old.js (prunen).
    listing = {base: [f"{base}/index.html", f"{base}/old.js"]}
    fake = FakeFTP(listing=listing, dirs={base})
    _patch_ftp(monkeypatch, fake)

    wi.phase_deploy(config)

    import re

    # Serverseitige Kopie per SITE CPFR/CPTO in zeitgestempelten predeploy-Ordner.
    cpto = [c for c in fake.site_cmds if c.startswith("SITE CPTO")]
    assert cpto, "Keine serverseitige FTP-Kopie (SITE CPTO) ausgeführt"
    assert any(re.search(r"/backup/predeploy-\d{8}-\d{6}", c) for c in cpto), cpto
    # Kein lokaler predeploy-Ordner im backup_dir.
    backup_dir = tmp_path / "backup"
    if backup_dir.exists():
        assert not any(d.name.startswith("predeploy-") for d in backup_dir.iterdir())
    # Backup lief VOR dem Prune: old.js wurde danach geprunt.
    assert any(p.endswith("old.js") for p in fake.deleted)


def test_ftp_deploy_does_not_prune_when_backup_fails(tmp_path, monkeypatch):
    """FTP-Deploy: Schlägt das serverseitige Pre-Deploy-Backup fehl, wird NICHT
    geprunt und der Deploy bricht sauber ab (exit 1)."""
    monkeypatch.chdir(tmp_path)
    _make_dist(tmp_path)

    config = make_config(
        password="geheim",
        protocol="ftp",
        export_path=str(tmp_path / "frontend" / "src" / "assets" / "wines.json"),
        image_export_dir=str(tmp_path / "export" / "images"),
        backup=_backup_config(),
    )
    base = config.deploy.remote_path
    listing = {base: [f"{base}/index.html", f"{base}/old.js"]}
    fake = FakeFTP(listing=listing, dirs={base}, copy_fail=True)
    _patch_ftp(monkeypatch, fake)

    with pytest.raises(SystemExit) as exc:
        wi.phase_deploy(config)
    assert exc.value.code == 1
    assert fake.deleted == []


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
