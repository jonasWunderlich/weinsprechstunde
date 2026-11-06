#!/usr/bin/env python3
"""Weinsprechstunde Import-Skript.

Ein phasenbasiertes CLI, das JSON-Quelldateien aus dem Import-Ordner aufbereitet,
eine fertige ``wines.json`` exportiert, Bilder skaliert und Artefakte optional auf
einen Webserver deployt. Der Transport nutzt FTP mit explizitem TLS (FTPES). Vor der
Pipeline kann ein Zwei-Tier-Backup erstellt und bei Bedarf der Import-Ordner per
FTPES vom Webserver heruntergeladen werden.

Phasen (argparse):
    (ohne Argument) backup -> [remote-download] -> prepare -> export -> image-export
    backup | prepare | export | image-export | deploy

Maßgeblich ist der Pseudocode in ``.kiro/specs/weinliste/design.md``,
Abschnitt „1. Python Import-Skript". Code bleibt 3.12-kompatibel.
"""

from __future__ import annotations

import argparse
import ftplib
import json
import os
import shutil
import ssl
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

CONFIG_PATH = "weinsprechstunde.config.json"
SECRETS_FILENAME = "weinsprechstunde.secrets.json"
DEFAULT_IMPORT_DIRNAME = "import"
SCHEMA_PATH = "wine-schema.json"
LAST_ARCHIVAL_FILE = ".last_archival"


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------


@dataclass
class Wine:
    name: str
    year: Optional[int] = None
    country: Optional[str] = None
    origin: Optional[str] = None
    grape: Optional[str | list[str]] = None
    type: Optional[str] = None
    producer: Optional[str] = None
    quality: Optional[str] = None
    price: Optional[str] = None
    rating: Optional[float] = None
    tasting_date: Optional[str] = None  # ISO-8601: "YYYY-MM-DD"
    image: Optional[str] = None
    audio: Optional[str] = None
    video: Optional[str] = None
    description: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class SchemaField:
    field: str
    type: str  # "text" | "number" | "date" | "rating" | "multi-value"
    filter_type: str | None  # "text-search" | "range" | "date-range" | "dropdown" |
    #                          "rating-range" | "multi-select" | null
    default_filter: bool
    decimals: int | None = None  # nur für number-Felder: 0 = int, 1/2 = float-Präzision


@dataclass
class BackupConfig:
    backup_dir: str
    max_last_backups: int
    max_archival_backups: int
    archival_interval_days: int
    remote_backup_dir: Optional[str] = None


@dataclass
class DeployConfig:
    protocol: str  # "ftpes"
    remote_path: str
    remote_images_path: str
    remote_import_path: str
    # Eigener Remote-Unterordner für die statische Editor-App
    # (frontend/dist/editor/browser/). Standard: "/wine_app/editor" – eine
    # eigene URL im wine_app-Bereich (Req 17.1). Leer = Editor-Deploy
    # übersprungen (aus der Config entfernbar, ohne DeployConfig(**raw) zu
    # brechen).
    remote_editor_path: str = ""
    # host/user/password werden aus der Config, der Secrets-Datei oder aus
    # Umgebungsvariablen aufgelöst (Reihenfolge Config > Secrets > Env). Leerer
    # Default, damit aus der Config entfernte Felder DeployConfig(**raw["deploy"])
    # nicht brechen.
    host: str = ""
    user: str = ""
    password: str = ""


@dataclass
class OptimizeConfig:
    """Einstellungen der Bildoptimierung im Import-Ordner (Phase optimize-images).

    Verkleinert Originalbilder im ``import_dir`` **in-place** auf eine maximale Höhe.
    Nur Bilder, deren Höhe ``max_height`` überschreitet, werden angefasst – dadurch ist
    die Phase idempotent und berührt effektiv nur neu hinzugekommene (zu große) Bilder.
    """

    enabled: bool = True
    max_height: int = 1400
    quality: int = 85


@dataclass
class EditorConfig:
    path: str  # URL-Pfad des Editors
    password_hash: str  # bcrypt-Hash


@dataclass
class Config:
    import_dir: str
    import_source: str  # "local" | "remote"
    export_path: str
    scaffold_mode: bool
    image_export_dir: str
    image_resize_mode: str  # "width" | "height"
    image_resize_px: int
    deploy: DeployConfig
    editor: EditorConfig
    backup: Optional[BackupConfig] = None
    optimize: Optional[OptimizeConfig] = None


# ---------------------------------------------------------------------------
# Konfiguration + Schema laden
# ---------------------------------------------------------------------------


def load_config(path: str = CONFIG_PATH) -> Config:
    """Konfigurationsdatei einlesen und zu verschachtelten Dataclasses parsen."""
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        sys.stderr.write(f"FEHLER: Konfigurationsdatei '{path}' nicht gefunden.\n")
        sys.exit(1)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"FEHLER: Konfigurationsdatei ist kein valides JSON: {e}\n")
        sys.exit(1)

    # Verschachtelte dicts explizit zu Dataclasses parsen -- ein naives
    # Config(**raw) würde dicts statt Dataclasses zuweisen, der Phasencode
    # greift aber per Attribut zu (config.deploy.host, config.backup.max_last_backups).
    deploy = DeployConfig(**raw["deploy"])
    editor = EditorConfig(**raw["editor"])
    backup = BackupConfig(**raw["backup"]) if raw.get("backup") else None
    optimize = OptimizeConfig(**raw["optimize"]) if raw.get("optimize") else OptimizeConfig()

    # Secrets-Auflösung: strikt Config > Secrets-Datei > Env.
    # 1) Optionale Secrets-Datei neben der Config lesen; fehlende Datei ist
    #    KEIN Fehler. Werte nur einspielen, wenn das Config-Feld leer ist.
    project_dir = Path(path).resolve().parent
    secrets: dict = {}
    secrets_path = project_dir / SECRETS_FILENAME
    if secrets_path.exists():
        try:
            secrets = json.loads(secrets_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            sys.stderr.write(
                f"FEHLER: Secrets-Datei '{secrets_path}' ist kein valides JSON: {e}\n"
            )
            sys.exit(1)
        for field_name in ("host", "user", "password"):
            if not getattr(deploy, field_name) and secrets.get(field_name):
                setattr(deploy, field_name, secrets[field_name])

    # 2) Env-Fallback für host/user (nur wenn weiterhin leer). Das Passwort
    #    bleibt der resolve_password-Logik (Config > Env) vorbehalten.
    if not deploy.host:
        deploy.host = os.environ.get("WEINSPRECHSTUNDE_DEPLOY_HOST", "")
    if not deploy.user:
        deploy.user = os.environ.get("WEINSPRECHSTUNDE_DEPLOY_USER", "")

    # import_dir: Config > Secrets-Datei > Standard "<Projektordner>/import".
    # Leere Werte (""/fehlend) zählen als nicht gesetzt.
    import_dir = (
        raw.get("import_dir")
        or secrets.get("import_dir")
        or str(project_dir / DEFAULT_IMPORT_DIRNAME)
    )

    return Config(
        import_dir=import_dir,
        import_source=raw["import_source"],
        export_path=raw["export_path"],
        scaffold_mode=raw["scaffold_mode"],
        image_export_dir=raw["image_export_dir"],
        image_resize_mode=raw["image_resize_mode"],
        image_resize_px=raw["image_resize_px"],
        deploy=deploy,
        editor=editor,
        backup=backup,
        optimize=optimize,
    )


def load_wine_schema(path: str = SCHEMA_PATH) -> list[SchemaField]:
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        sys.stderr.write("FEHLER: wine-schema.json nicht gefunden.\n")
        sys.exit(1)
    return [SchemaField(**entry) for entry in raw]


def get_scaffold_fields(schema: list[SchemaField]) -> list[str]:
    return [f.field for f in schema]


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------


ARCHIVE_DIR_NAME = "_archive"


def collect_json_files(import_dir: str) -> list[Path]:
    """Rekursiv alle .json-Dateien in import_dir erfassen.

    Der Archiv-Ordner ``import_dir/_archive/`` wird vollständig übersprungen
    (Req 17.51): Dateien darin fließen weder in prepare/export noch in den
    Bildexport ein. Da ``collect_json_files`` die zentrale Dateierfassung aller
    drei Phasen (prepare, export, image-export) ist, genügt diese eine Stelle –
    keine verstreute Sonderbehandlung in den Phasen. Da der Bildexport Bilder
    ausschließlich über das ``image``-Feld der eingesammelten JSON-Dateien
    auflöst, bleiben auch im Archiv liegende Bilder automatisch unexportiert.
    """
    root = Path(import_dir)
    return sorted(
        p for p in root.rglob("*.json")
        if ARCHIVE_DIR_NAME not in p.relative_to(root).parts
    )


def slugify_name(name: str) -> str:
    """Name -> URL-freundlicher Slug (python-slugify)."""
    from slugify import slugify

    return slugify(name)


def find_image_sibling(json_path: Path) -> str | None:
    """Bilddatei mit gleichem Basisnamen im selben Verzeichnis suchen."""
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        candidate = json_path.with_suffix(ext)
        if candidate.exists():
            return candidate.name
    return None


def read_exif_date(image_path: Path) -> str | None:
    """EXIF DateTimeOriginal -> ISO-8601-Datumsstring (piexif)."""
    try:
        import piexif

        exif = piexif.load(str(image_path))
        dt_bytes = exif["Exif"].get(piexif.ExifIFD.DateTimeOriginal)
        if dt_bytes:
            dt_str = dt_bytes.decode()  # "YYYY:MM:DD HH:MM:SS"
            return dt_str[:10].replace(":", "-")
    except Exception:
        pass
    return None


def resolve_password(config: Config) -> str:
    """Passwort aus Config oder Umgebungsvariable lesen."""
    password = config.deploy.password
    if not password:
        password = os.environ.get("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", "")
        if not password:
            sys.stderr.write(
                "FEHLER: Kein Deploy-Passwort gefunden. Setze die Umgebungsvariable "
                "WEINSPRECHSTUNDE_DEPLOY_PASSWORD mit dem Server-Passwort, z. B.: "
                "export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=deinPasswort\n"
            )
            sys.exit(1)
    return password


# ---------------------------------------------------------------------------
# Transport-Helfer (gemeinsam für Deploy UND Remote-Download, Req 1.10)
# ---------------------------------------------------------------------------


class _ReuseTLS_FTP(ftplib.FTP_TLS):
    """FTP_TLS, das die Kontroll-TLS-Session auf dem Datenkanal wiederverwendet.

    Pure-FTPd (Host Europe) verlangt, dass die Datenverbindung dieselbe
    TLS-Session wie der Kontrollkanal benutzt. Pythons Standard-``FTP_TLS`` tut
    das NICHT, weshalb der Datentransfer (Prune-Listing/Upload/Download) gegen
    den Produktivserver hängt. Dieses Override reicht die TLS-Session des
    Kontrollkanals an den Datenkanal weiter und behebt die Blockade.

    Verifiziert gegen den echten Server via scripts/ftps_upload_probe.py.
    """

    def ntransfercmd(self, cmd, rest=None):  # noqa: D102 (ftplib-Signatur)
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        # Nur wenn der Datenkanal verschlüsselt ist (prot_p) und der
        # Kontroll-Socket tatsächlich eine via SSLContext aufgebaute Session
        # trägt, die Session auf dem Datenkanal wiederverwenden. Fehlt die
        # Session (z. B. kein SSLSocket), bleibt es beim Standardverhalten.
        if self._prot_p:
            session = getattr(self.sock, "session", None)
            if session is not None:
                conn = self.context.wrap_socket(
                    conn, server_hostname=self.host, session=session
                )
        return conn, size


def _ftps_connect(host: str, user: str, password: str) -> "ftplib.FTP_TLS":
    """FTP-Verbindung mit explizitem TLS (FTPES) öffnen und einloggen.

    Vorlage: scripts/ftps_probe.py. Standardmäßig wird das Serverzertifikat
    NICHT verifiziert (``ssl._create_unverified_context``), weil der Webspace
    ein Zertifikat mit abweichendem Hostnamen ausliefert; die Verbindung bleibt
    dennoch TLS-verschlüsselt. Mit ``FTPS_VERIFY=1`` lässt sich die reguläre
    Zertifikatsprüfung aktivieren.

    Verwendet ``_ReuseTLS_FTP``, damit der Datenkanal die TLS-Session des
    Kontrollkanals wiederverwendet (Pflicht für Pure-FTPd/Host Europe).
    """
    verify = os.environ.get("FTPS_VERIFY", "0") != "0"
    ctx = ssl.create_default_context() if verify else ssl._create_unverified_context()
    ftp = _ReuseTLS_FTP(context=ctx)
    ftp.connect(host, 21, timeout=20)
    ftp.auth()                 # explizites TLS auf dem Kontrollkanal
    ftp.login(user, password)  # Login über verschlüsselte Verbindung
    ftp.prot_p()               # auch Datenkanal verschlüsseln
    ftp.set_pasv(True)
    return ftp


def _upload_ftp(ftp: "ftplib.FTP", local_file: Path, remote_file: str) -> None:
    """Eine lokale Datei per FTP hochladen."""
    with open(local_file, "rb") as fh:
        ftp.storbinary(f"STOR {remote_file}", fh)


def _download_ftp(host: str, user: str, password: str, remote_path: str,
                  local_path: Path) -> None:
    """Remote-Verzeichnis rekursiv per FTPES nach local_path herunterladen."""
    ftp = _ftps_connect(host, user, password)
    try:
        local_path.mkdir(parents=True, exist_ok=True)
        _ftp_download_dir(ftp, remote_path, local_path)
    finally:
        ftp.quit()


def _ftp_is_dir(ftp: "ftplib.FTP", path: str) -> bool:
    current = ftp.pwd()
    try:
        ftp.cwd(path)
        ftp.cwd(current)
        return True
    except ftplib.error_perm:
        return False


def _ftp_list_entries(ftp: "ftplib.FTP", remote_dir: str) -> list[tuple[str, bool]]:
    """Einträge eines Remote-Verzeichnisses als (basename, is_dir) auflisten.

    Nutzt primär ``MLSD`` (RFC 3659): EIN Listing-Roundtrip liefert pro Eintrag
    direkt den Typ (``type=dir``/``cdir``/``pdir`` vs. ``file``), sodass KEIN
    ``_ftp_is_dir`` (zwei ``cwd``-Roundtrips pro Eintrag) mehr nötig ist. Das
    eliminiert die ~1000 TLS-Roundtrips, die den Prune über ``/wine_app/images``
    (~476 Bilder) blockiert haben.

    Fällt ``MLSD`` aus (Server ohne MLSD-Support o. Ä.), wird robust auf das
    bisherige Verhalten (``nlst`` + ``_ftp_is_dir`` pro Eintrag) zurückgefallen.
    """
    try:
        entries: list[tuple[str, bool]] = []
        for base, facts in ftp.mlsd(remote_dir):
            if base in (".", ".."):
                continue
            entry_type = (facts.get("type") or "").lower()
            if entry_type in ("cdir", "pdir"):
                continue
            entries.append((base, entry_type == "dir"))
        return entries
    except (ftplib.error_perm, ftplib.error_proto, AttributeError, OSError):
        # Fallback: nlst + cwd-basierte Typerkennung (altes Verhalten).
        result: list[tuple[str, bool]] = []
        for name in ftp.nlst(remote_dir):
            base = name.rsplit("/", 1)[-1]
            if base in (".", ".."):
                continue
            remote_entry = name if "/" in name else f"{remote_dir.rstrip('/')}/{name}"
            result.append((base, _ftp_is_dir(ftp, remote_entry)))
        return result


def _ftp_download_dir(ftp: "ftplib.FTP", remote_dir: str, local_dir: Path) -> None:
    local_dir.mkdir(parents=True, exist_ok=True)
    for base, is_dir in _ftp_list_entries(ftp, remote_dir):
        remote_entry = f"{remote_dir.rstrip('/')}/{base}"
        local_entry = local_dir / base
        if is_dir:
            _ftp_download_dir(ftp, remote_entry, local_entry)
        else:
            with open(local_entry, "wb") as fh:
                ftp.retrbinary(f"RETR {remote_entry}", fh.write)


# ---------------------------------------------------------------------------
# Phase backup
# ---------------------------------------------------------------------------


def phase_backup(config: Config) -> None:
    """Zwei-Tier-Backup: Last-Backups bei jedem Lauf, Archival-Backups nach Intervall."""
    if not config.backup:
        return

    backup_dir = Path(config.backup.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    # Gesichert wird ausschließlich die exportierte wines.json als einzelne
    # Datei – nicht der Import-Ordner. Zielname trägt die Endung der Quelle.
    export_path = Path(config.export_path)
    suffix = export_path.suffix

    if not export_path.exists():
        sys.stderr.write(
            f"WARNUNG: Backup übersprungen – Export-Datei {export_path} existiert "
            "noch nicht (läuft backup vor dem ersten export?).\n"
        )
        return

    # Last-Backup: bei jedem Lauf
    last_name: Optional[str] = f"last_{timestamp}{suffix}"
    last_path = backup_dir / last_name
    try:
        shutil.copy2(export_path, last_path)
    except Exception as e:
        sys.stderr.write(f"WARNUNG: Last-Backup fehlgeschlagen: {e}\n")
        last_name = None

    _prune_backups(backup_dir, prefix="last_", max_count=config.backup.max_last_backups)

    # Archival-Backup: nur wenn Intervall abgelaufen
    last_archival_path = backup_dir / LAST_ARCHIVAL_FILE
    archival_due = True
    if last_archival_path.exists():
        last_ts = datetime.fromisoformat(last_archival_path.read_text().strip())
        if datetime.now() - last_ts < timedelta(days=config.backup.archival_interval_days):
            archival_due = False

    archival_name: Optional[str] = None
    if archival_due:
        archival_name = f"archival_{timestamp}{suffix}"
        archival_path = backup_dir / archival_name
        try:
            shutil.copy2(export_path, archival_path)
            last_archival_path.write_text(datetime.now().isoformat())
        except Exception as e:
            sys.stderr.write(f"WARNUNG: Archival-Backup fehlgeschlagen: {e}\n")
            archival_name = None

        _prune_backups(
            backup_dir, prefix="archival_", max_count=config.backup.max_archival_backups
        )

    # Remote-Backups wenn konfiguriert
    if config.backup.remote_backup_dir and config.deploy:
        try:
            _remote_backup(config, last_name, archival_name)
        except Exception as e:
            sys.stderr.write(f"WARNUNG: Remote-Backup fehlgeschlagen: {e}\n")


def _prune_backups(backup_dir: Path, prefix: str, max_count: int) -> None:
    """Älteste Backup-Dateien löschen wenn max_count überschritten.

    Backups sind einzelne, zeitgestempelte Dateien (``last_*.json`` /
    ``archival_*.json``). Die Marker-Datei (``.last_archival``) wird nie als
    Backup gewertet; die zeitstempelbasierte lexikografische Sortierung bleibt.
    """
    entries = sorted(
        f for f in backup_dir.iterdir()
        if f.is_file() and f.name.startswith(prefix) and f.name != LAST_ARCHIVAL_FILE
    )
    while len(entries) > max_count:
        oldest = entries.pop(0)
        try:
            oldest.unlink()
        except Exception as e:
            sys.stderr.write(
                f"WARNUNG: Backup-Datei {oldest} konnte nicht gelöscht werden: {e}\n"
            )


def _remote_backup(config: Config, last_name: Optional[str],
                   archival_name: Optional[str]) -> None:
    """Lokale Backup-Dateien auf den Webspace übertragen (best effort).

    Best effort bedeutet: Ist kein Deploy-Passwort verfügbar (z. B. bei einem
    rein lokalen Lauf ohne gesetzte Umgebungsvariable), wird das Remote-Backup
    übersprungen und die Pipeline läuft weiter (Req 19.7, 19.9) – das Skript
    bricht NICHT ab.
    """
    assert config.backup is not None
    remote_base = config.backup.remote_backup_dir
    if not remote_base:
        return
    password = config.deploy.password or os.environ.get(
        "WEINSPRECHSTUNDE_DEPLOY_PASSWORD", ""
    )
    if not password:
        sys.stderr.write(
            "WARNUNG: Remote-Backup übersprungen – kein Deploy-Passwort gesetzt "
            "(WEINSPRECHSTUNDE_DEPLOY_PASSWORD). Lokales Backup bleibt bestehen.\n"
        )
        return
    backup_dir = Path(config.backup.backup_dir)
    names = [n for n in (last_name, archival_name) if n]
    if not names:
        return

    ftp = _ftps_connect(config.deploy.host, config.deploy.user, password)
    try:
        _ftp_makedirs(ftp, remote_base)
        for name in names:
            _upload_ftp(ftp, backup_dir / name, f"{remote_base.rstrip('/')}/{name}")
    finally:
        ftp.quit()


def _ftp_makedirs(ftp: "ftplib.FTP", remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    path = ""
    for part in parts:
        path = f"{path}/{part}"
        try:
            ftp.mkd(path)
        except ftplib.error_perm:
            pass


# ---------------------------------------------------------------------------
# Remote-Import-Download (wenn import_source = "remote")
# ---------------------------------------------------------------------------


def download_remote_import(config: Config, password: str) -> None:
    """Synchronisiert deploy.remote_import_path auf den lokalen import_dir."""
    try:
        _download_ftp(
            host=config.deploy.host,
            user=config.deploy.user,
            password=password,
            remote_path=config.deploy.remote_import_path,
            local_path=Path(config.import_dir),
        )
    except Exception as e:
        sys.stderr.write(
            f"FEHLER: Download des Import-Ordners von {config.deploy.host}:"
            f"{config.deploy.remote_import_path} fehlgeschlagen. "
            f"Server-Meldung: {e}\n"
        )
        sys.exit(1)


# ---------------------------------------------------------------------------
# Phase prepare
# ---------------------------------------------------------------------------


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def collect_image_files(import_dir: str) -> list[Path]:
    """Rekursiv alle Bilddateien in ``import_dir`` erfassen; ``_archive`` wird
    vollständig übersprungen (konsistent mit ``collect_json_files``, Req 17.51)."""
    root = Path(import_dir)
    return sorted(
        p
        for p in root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in IMAGE_EXTENSIONS
        and ARCHIVE_DIR_NAME not in p.relative_to(root).parts
    )


def optimize_image(path: Path, max_height: int, quality: int) -> bool:
    """Skaliert ein einzelnes Bild **in-place** auf ``max_height`` (Höhe), sofern es
    höher ist; Seitenverhältnis bleibt erhalten. Gibt ``True`` zurück, wenn das Bild
    verkleinert wurde, sonst ``False`` (bereits klein genug / übersprungen).

    Nur Bilder, deren Höhe ``max_height`` überschreitet, werden angefasst – dadurch ist
    die Optimierung idempotent und berührt effektiv nur neu hinzugekommene zu große
    Bilder. JPEG wird progressiv/optimiert, PNG mit maximaler Kompression gespeichert;
    die EXIF-Ausrichtung wird vor dem Skalieren angewandt.
    """
    from PIL import Image, ImageOps

    with Image.open(path) as opened:
        _, height = opened.size
        if height <= max_height:
            return False

        img = ImageOps.exif_transpose(opened)
        width, height = img.size
        scale = max_height / height
        new_width = max(1, round(width * scale))
        img = img.resize((new_width, max_height), Image.Resampling.LANCZOS)

        suffix = path.suffix.lower()
        if suffix in {".jpg", ".jpeg"}:
            if img.mode not in ("RGB", "L"):
                if img.mode == "RGBA":
                    background = Image.new("RGB", img.size, (255, 255, 255))
                    background.paste(img, mask=img.getchannel("A"))
                    img = background
                else:
                    img = img.convert("RGB")
            img.save(path, format="JPEG", quality=quality, optimize=True, progressive=True)
        elif suffix == ".png":
            img.save(path, format="PNG", optimize=True, compress_level=9)
        elif suffix == ".webp":
            img.save(path, format="WEBP", quality=quality, method=6)
        else:
            return False
        return True


def phase_optimize_images(config: Config) -> None:
    """Verkleinert zu große Originalbilder im ``import_dir`` in-place (eine maximale
    Höhe). Läuft vor prepare/export, damit die weitere Pipeline und der Editor mit den
    bereits optimierten Bildern arbeiten. ``_archive`` wird übersprungen.

    Idempotent: Bilder bis ``max_height`` bleiben unangetastet, daher werden bei jedem
    Lauf praktisch nur neu hinzugekommene, zu große Bilder skaliert.
    """
    opt = config.optimize or OptimizeConfig()
    if not opt.enabled:
        return

    scaled = 0
    skipped = 0
    failed = 0
    for image in collect_image_files(config.import_dir):
        try:
            if optimize_image(image, opt.max_height, opt.quality):
                scaled += 1
            else:
                skipped += 1
        except Exception as e:  # noqa: BLE001 – defekte/unlesbare Datei soll die Phase nicht abbrechen
            failed += 1
            sys.stderr.write(f"WARNUNG: optimize-images – {image}: {e}\n")

    sys.stderr.write(
        f"optimize-images: {scaled} skaliert (max. Höhe {opt.max_height}px), "
        f"{skipped} bereits klein genug, {failed} fehlerhaft.\n"
    )


def phase_prepare(config: Config, schema: list[SchemaField]) -> None:
    skipped_renames = 0
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        if "name" not in data:
            sys.stderr.write(f"WARNUNG: {json_file} – kein 'name', übersprungen.\n")
            continue

        # 1. Auto-detect image (nur wenn Feld nicht vorhanden)
        if "image" not in data:
            sibling = find_image_sibling(json_file)
            if sibling:
                data["image"] = sibling

        # 2. EXIF -> tasting_date (nur wenn nicht vorhanden)
        if "tasting_date" not in data and data.get("image"):
            exif_date = read_exif_date(json_file.parent / data["image"])
            if exif_date:
                data["tasting_date"] = exif_date

        # 3. Umbenennung (braucht nur tasting_date; Datei bleibt im Unterordner)
        if data.get("tasting_date"):
            new_stem = f"{data['tasting_date']}-{slugify_name(data['name'])}"
            skipped_renames += rename_file_group(json_file, new_stem, data)
            json_file = json_file.parent / f"{new_stem}.json"
        else:
            sys.stderr.write(
                f"WARNUNG: {json_file} – kein 'tasting_date', Umbenennung übersprungen.\n"
            )

        # 4. Typ-Normalisierung für number-Felder (year, price, rating, …)
        normalize_number_fields(data, schema, json_file)

        # 5. scaffold_mode anwenden
        apply_scaffold_mode(data, config, schema)
        json_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    if skipped_renames:
        # Kollisionen (Zieldatei existiert bereits) werden nicht mehr pro Datei
        # geloggt, sondern am Ende der prepare-Phase zusammengefasst.
        sys.stderr.write(
            f"prepare: {skipped_renames} Umbenennung(en) übersprungen "
            f"(Zieldatei existierte bereits).\n"
        )


def rename_file_group(json_file: Path, new_stem: str, data: dict) -> int:
    """JSON + Bild + Audio auf neuen Basisnamen umbenennen.

    Gibt die Anzahl übersprungener Umbenennungen zurück (Zieldatei existierte
    bereits). Diese Kollisionen werden NICHT pro Datei geloggt – die rufende
    prepare-Phase fasst sie am Ende zu einer Zeile zusammen, damit die Konsole
    ruhig bleibt.
    """
    skipped = 0
    for field_name in ("image", "audio"):
        if not data.get(field_name):
            continue
        old_path = json_file.parent / data[field_name]
        if not old_path.exists():
            continue
        new_path = old_path.parent / f"{new_stem}{old_path.suffix}"
        if new_path.exists():
            skipped += 1
            continue
        old_path.rename(new_path)
        data[field_name] = new_path.name

    new_json = json_file.parent / f"{new_stem}.json"
    if new_json.exists() and new_json != json_file:
        return skipped + 1
    if new_json != json_file:
        json_file.rename(new_json)
    return skipped


def normalize_number_fields(data: dict, schema: list[SchemaField],
                            json_file: Path) -> None:
    """Felder mit WineSchema-Typ 'number' von String zu Zahl normalisieren.

    - Dezimal-Komma -> Dezimalpunkt ("6,99" -> "6.99")
    - decimals == 0 -> Integer (year: "2017" -> 2017)
    - decimals == 1 -> Float, 1 Nachkommastelle (rating: "6" -> 6.0)
    - decimals == 2 -> Float, 2 Nachkommastellen (price: "6,99" -> 6.99)
    Nicht umwandelbare Werte bleiben unverändert und erzeugen eine Warnung.
    """
    number_fields = {f.field: f for f in schema if f.type == "number"}
    for field_name, spec in number_fields.items():
        if field_name not in data:
            continue
        value = data[field_name]
        if value is None or isinstance(value, (int, float)):
            # bereits numerisch oder leer -> nur ggf. auf decimals runden
            if isinstance(value, (int, float)):
                data[field_name] = _round_to_decimals(value, spec.decimals)
            continue
        if not isinstance(value, str) or value.strip() == "":
            continue
        raw = value.strip().replace(",", ".")
        try:
            parsed = float(raw)
        except ValueError:
            sys.stderr.write(
                f"WARNUNG: {json_file} – Feld '{field_name}' Wert '{value}' ist keine "
                f"Zahl, unverändert belassen.\n"
            )
            continue
        data[field_name] = _round_to_decimals(parsed, spec.decimals)


def _round_to_decimals(value: float, decimals: int | None) -> int | float:
    """Auf die konfigurierte Nachkommastellen-Anzahl normalisieren."""
    if decimals is None:
        return value
    if decimals == 0:
        return int(round(value))
    return round(float(value), decimals)


def apply_scaffold_mode(data: dict, config: Config, schema: list[SchemaField]) -> None:
    scaffold_fields = get_scaffold_fields(schema)
    if config.scaffold_mode:
        for field_name in scaffold_fields:
            if field_name not in data:
                data[field_name] = None
        # bestehende Nicht-null-Werte bleiben unverändert
    else:
        keys_to_remove = [k for k, v in data.items() if v is None or v == ""]
        for k in keys_to_remove:
            del data[k]


# ---------------------------------------------------------------------------
# Phase export
# ---------------------------------------------------------------------------


def phase_export(config: Config) -> None:
    wines: list[dict] = []
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        if "name" not in data:
            sys.stderr.write(f"WARNUNG: {json_file} – kein 'name', übersprungen.\n")
            continue
        wines.append(data)

    with_date = sorted(
        [w for w in wines if w.get("tasting_date")],
        key=lambda w: w["tasting_date"],
        reverse=True,
    )
    without_date = [w for w in wines if not w.get("tasting_date")]

    output_path = Path(config.export_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(with_date + without_date, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Phase image-export
# ---------------------------------------------------------------------------


def phase_image_export(config: Config) -> None:
    from PIL import Image

    scaled = 0
    skipped = 0
    missing = 0
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        image_ref = data.get("image")
        if not image_ref:
            continue

        src = json_file.parent / image_ref
        if not src.exists():
            # Fehlende Quelldatei wird nicht pro Bild geloggt, sondern am Ende
            # der Phase zusammengefasst (ruhige Konsole).
            missing += 1
            continue

        dst = Path(config.image_export_dir) / image_ref
        dst.parent.mkdir(parents=True, exist_ok=True)

        # Timestamp-Vergleich: still überspringen wenn Kopie aktuell
        # (keine Zeile pro bereits vorhandenem Bild).
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue

        with Image.open(src) as img:
            px = config.image_resize_px
            if config.image_resize_mode == "width":
                img.thumbnail((px, 99999))
            else:  # "height"
                img.thumbnail((99999, px))
            img.save(dst, format=img.format)
        scaled += 1
        # Originale werden nicht verändert

    sys.stderr.write(
        f"image-export: {scaled} skaliert, {skipped} bereits vorhanden "
        f"übersprungen, {missing} Quellen fehlten.\n"
    )


# ---------------------------------------------------------------------------
# Phase deploy
# ---------------------------------------------------------------------------


def phase_deploy(config: Config, force_images: bool = False) -> None:
    password = resolve_password(config)

    try:
        _deploy_ftp(config, password, force_images=force_images)
    except SystemExit:
        raise
    except Exception as e:
        sys.stderr.write(
            f"FEHLER: Verbindung zum Server {config.deploy.host} fehlgeschlagen. "
            f"Server-Meldung: {e}. "
            f"Bitte prüfe: (1) Ist der Hostname '{config.deploy.host}' korrekt? "
            f"(2) Sind Benutzername und Passwort gültig? "
            f"(3) Ist der Server erreichbar und das Protokoll "
            f"({config.deploy.protocol}) korrekt?\n"
        )
        sys.exit(1)


# Name des öffentlichen Angular-Projekts im Workspace (projects/weinliste).
# Dessen Build landet unter frontend/dist/weinliste/browser/ und ist die einzige
# App, die diese Deploy-Phase ausliefert. Der Workspace baut daneben noch die
# Editor-App (frontend/dist/editor/browser/) und die shared-Library – deshalb
# wird der öffentliche Ordner hier bevorzugt aufgelöst.
PUBLIC_APP_PROJECT = "weinliste"

# Name des Editor-Angular-Projekts im Workspace (projects/editor). Dessen Build
# landet unter frontend/dist/editor/browser/ und wird – als rein statische App
# ohne Weindaten – zusätzlich zur öffentlichen Weinliste in den eigenen
# Editor-Remote-Unterordner (deploy.remote_editor_path) deployt (Req 16.3, 17.1).
EDITOR_APP_PROJECT = "editor"


def _resolve_dist_dir(base: Path = Path("frontend/dist")) -> Path:
    """Tatsächliches Angular-Build-Output-Verzeichnis als Deploy-Wurzel ermitteln.

    Der Builder ``@angular/build:application`` schreibt den auszuliefernden
    Browser-Build nach ``frontend/dist/<projekt>/browser/`` (verschachtelt),
    während ältere/flache Angular-Setups direkt nach ``frontend/dist/`` bauen.
    Seit dem Workspace-Umbau (projects/shared|weinliste|editor) liegen im
    dist-Ordner MEHRERE ``<projekt>/browser/``-Builds nebeneinander (weinliste +
    editor); ausgeliefert wird nur die öffentliche App ``weinliste``.
    Diese Funktion löst robust den Ordner auf, dessen Inhalt (``index.html``,
    ``assets/`` usw.) direkt in ``remote_path`` landen soll (Req 6.7):

    1. Enthält ``base`` selbst eine ``index.html`` -> flacher dist-Ordner.
    2. Existiert ``base/weinliste/browser/`` mit ``index.html`` -> öffentliche App
       (bevorzugt, auch wenn weitere ``<projekt>/browser/`` daneben liegen).
    3. Sonst: genau ein ``<projekt>/browser/``-Unterordner mit ``index.html``.
    4. Fallback: ``base`` unverändert (robust gegen leicht andere Defaults).
    """
    if not base.exists():
        return base
    if (base / "index.html").exists():
        return base
    # Öffentliche App (weinliste) bevorzugt – unabhängig von weiteren Builds
    # (editor) im selben dist-Ordner.
    public_browser = base / PUBLIC_APP_PROJECT / "browser"
    if (public_browser / "index.html").exists():
        return public_browser
    # Kandidaten: <base>/<projekt>/browser mit index.html
    browser_candidates = [
        p for p in base.glob("*/browser") if (p / "index.html").exists()
    ]
    if len(browser_candidates) == 1:
        return browser_candidates[0]
    # Fallback: irgendein Unterordner mit index.html (z. B. <base>/<projekt>)
    nested = [p for p in base.glob("*") if p.is_dir() and (p / "index.html").exists()]
    if len(nested) == 1:
        return nested[0]
    return base


def _resolve_editor_dist_dir(base: Path = Path("frontend/dist")) -> Optional[Path]:
    """Browser-Build-Ordner der statischen Editor-App ermitteln.

    ``ng build editor`` schreibt nach ``frontend/dist/editor/browser/`` (Builder
    ``@angular/build:application``). Diese Funktion liefert robust den Ordner,
    dessen Inhalt (``index.html``, ``assets/`` …) direkt in
    ``remote_editor_path`` landen soll:

    1. ``base/editor/browser/`` mit ``index.html`` -> Standard-Workspace-Output.
    2. ``base/editor/`` mit ``index.html`` -> flacher Editor-Build.
    3. Sonst ``None`` (kein Editor-Build vorhanden -> Editor-Deploy wird still
       übersprungen, der weinliste-Deploy läuft davon unberührt weiter).
    """
    editor_browser = base / EDITOR_APP_PROJECT / "browser"
    if (editor_browser / "index.html").exists():
        return editor_browser
    editor_flat = base / EDITOR_APP_PROJECT
    if (editor_flat / "index.html").exists():
        return editor_flat
    return None


def _local_dist_files(dist_dir: Path) -> dict[str, Path]:
    """Relative Pfad -> lokale Datei für alle Dateien im dist-Ordner."""
    result: dict[str, Path] = {}
    if not dist_dir.exists():
        return result
    for item in dist_dir.rglob("*"):
        if item.is_file():
            result[item.relative_to(dist_dir).as_posix()] = item
    return result


def _protected_prefixes(config: Config) -> tuple[set[str], list[str]]:
    """Pfade, die der Prune unter remote_path NIE löschen darf.

    Gibt (exakte Relativpfade, Verzeichnis-Präfixe) zurück. Geschützt sind die
    hochgeladene ``wines.json`` (Basename aus ``export_path``) sowie – falls sie
    unterhalb von ``remote_path`` liegen – der komplette Bilderordner
    (``remote_images_path``), der Daten-/Import-Ordner (``remote_import_path``)
    und der Editor-Ordner (``remote_editor_path``). So kann der dist-Prune der
    öffentlichen Weinliste diese nie entfernen (Req 6.6, 17.1): Der Editor liegt
    als eigener Unterbaum (z. B. ``/wine_app/editor``) unter ``remote_path`` und
    wird von einem separaten, eigenen Upload-/Prune-Schritt gepflegt – der
    weinliste-Prune darf ihn nicht anfassen.
    """
    base = config.deploy.remote_path.rstrip("/")
    exact: set[str] = {Path(config.export_path).name}
    prefixes: list[str] = []

    for sub in (
        config.deploy.remote_images_path,
        config.deploy.remote_import_path,
        config.deploy.remote_editor_path,
    ):
        if not sub:
            continue
        sub = sub.rstrip("/")
        if sub == base:
            # Ordner liegt direkt unter remote_path -> der Ordner selbst ist
            # remote_base, nichts weiter zu schützen.
            prefixes.append("")
        elif sub.startswith(base + "/"):
            prefixes.append(sub[len(base) + 1:] + "/")
    return exact, prefixes


def _is_protected(rel: str, exact: set[str], prefixes: list[str]) -> bool:
    if rel in exact:
        return True
    return any(prefix and rel.startswith(prefix) for prefix in prefixes)


def _deploy_ftp(config: Config, password: str, force_images: bool = False) -> None:
    ftp = _ftps_connect(config.deploy.host, config.deploy.user, password)
    try:
        # Browser-Build-Ordner als Deploy-Wurzel (Req 6.7).
        dist_dir = _resolve_dist_dir()
        local_files = _local_dist_files(dist_dir)
        remote_base = config.deploy.remote_path

        # 1) dist-Ordner hochladen (Timestamp-Vergleich).
        _ftp_makedirs(ftp, remote_base)
        for rel, local_file in local_files.items():
            remote_file = f"{remote_base.rstrip('/')}/{rel}"
            _ftp_makedirs(ftp, remote_file.rsplit("/", 1)[0])
            if not _ftp_up_to_date(ftp, remote_file, local_file):
                _upload_ftp(ftp, local_file, remote_file)

        # 2) Prune: veraltete Serverdateien NUR unter /wine_app löschen;
        #    images/, data/ und wines.json bleiben geschützt (Req 6.6).
        exact, prefixes = _protected_prefixes(config)
        _ftp_prune(ftp, remote_base, set(local_files.keys()), exact, prefixes)

        # 3) wines.json (und optional wine-schema.json) nach
        #    remote_import_path ablegen (nie löschen).
        import_base = config.deploy.remote_import_path
        wines_json = Path(config.export_path)
        if wines_json.exists():
            _ftp_makedirs(ftp, import_base)
            remote_wines = f"{import_base.rstrip('/')}/{wines_json.name}"
            if not _ftp_up_to_date(ftp, remote_wines, wines_json):
                _upload_ftp(ftp, wines_json, remote_wines)
        schema_json = wines_json.parent / "wine-schema.json"
        if schema_json.exists():
            _ftp_makedirs(ftp, import_base)
            remote_schema = f"{import_base.rstrip('/')}/{schema_json.name}"
            if not _ftp_up_to_date(ftp, remote_schema, schema_json):
                _upload_ftp(ftp, schema_json, remote_schema)

        # 4) Bilder nach remote_images_path ablegen (nie löschen).
        images_dir = Path(config.image_export_dir)
        if images_dir.exists():
            _ftp_makedirs(ftp, config.deploy.remote_images_path)
            for img in images_dir.iterdir():
                if img.is_file():
                    remote_img = f"{config.deploy.remote_images_path.rstrip('/')}/{img.name}"
                    # Mit --force-images werden ALLE Bilder neu hochgeladen
                    # (kein MDTM/Timestamp-Vergleich); sonst nur neuere/fehlende.
                    if force_images or not _ftp_up_to_date(ftp, remote_img, img):
                        _upload_ftp(ftp, img, remote_img)

        # 5) Statische Editor-App in ihren eigenen Remote-Unterordner ablegen
        #    (Req 16.3, 17.1). Separater, in sich geschlossener Schritt: Upload
        #    des Editor-Build-Outputs + Prune AUSSCHLIESSLICH unterhalb von
        #    remote_editor_path. Die ausgelieferte App enthält keine Weindaten;
        #    der Editor-Schritt berührt images/, data/ und wines.json NICHT und
        #    löscht dort nichts (der weinliste-Prune schützt zudem den
        #    Editor-Unterbaum über _protected_prefixes).
        _deploy_editor(ftp, config, force_images=force_images)
    finally:
        ftp.quit()


def _deploy_editor(ftp: "ftplib.FTP", config: Config, force_images: bool = False) -> None:
    """Statische Editor-App in ``remote_editor_path`` deployen (additiv).

    Lädt den Editor-Browser-Build (``frontend/dist/editor/browser/``) in den
    konfigurierten Editor-Unterordner (Timestamp-Vergleich wie beim
    weinliste-Build) und prunet veraltete Dateien NUR unterhalb von
    ``remote_editor_path``. Fehlt die Editor-Konfiguration oder der Build, wird
    der Schritt still übersprungen – der weinliste-Deploy bleibt davon
    unberührt. Der Editor-Prune bewegt sich ausschließlich in seinem eigenen
    Unterbaum und kann daher Weindaten/Bilder (images/, data/, wines.json) nie
    berühren.
    """
    editor_base = (config.deploy.remote_editor_path or "").rstrip("/")
    if not editor_base:
        return
    editor_dist = _resolve_editor_dist_dir()
    if editor_dist is None:
        return

    editor_files = _local_dist_files(editor_dist)
    _ftp_makedirs(ftp, editor_base)
    for rel, local_file in editor_files.items():
        remote_file = f"{editor_base}/{rel}"
        _ftp_makedirs(ftp, remote_file.rsplit("/", 1)[0])
        if not _ftp_up_to_date(ftp, remote_file, local_file):
            _upload_ftp(ftp, local_file, remote_file)

    # Prune ausschließlich im Editor-Unterbaum: veraltete Editor-Dateien
    # entfernen, ohne irgendetwas außerhalb von editor_base anzufassen.
    _ftp_prune(ftp, editor_base, set(editor_files.keys()))


def _ftp_up_to_date(ftp: "ftplib.FTP", remote_file: str, local_file: Path) -> bool:
    """True, wenn die Remote-Datei (MDTM) nicht älter ist als die lokale Datei."""
    try:
        resp = ftp.sendcmd(f"MDTM {remote_file}")
    except ftplib.error_perm:
        return False
    # Antwort: "213 YYYYMMDDHHMMSS"
    parts = resp.split()
    if len(parts) < 2:
        return False
    try:
        remote_dt = datetime.strptime(parts[1][:14], "%Y%m%d%H%M%S")
    except ValueError:
        return False
    return remote_dt.timestamp() >= local_file.stat().st_mtime


def _ftp_prune(ftp: "ftplib.FTP", remote_base: str, keep: set[str],
               protected_exact: Optional[set[str]] = None,
               protected_prefixes: Optional[list[str]] = None) -> None:
    """Dateien im remote dist-Ordner löschen, die lokal nicht mehr existieren.

    ``protected_exact``/``protected_prefixes`` schützen wines.json und den
    Bilderordner, falls diese unter remote_base liegen (Req 6.6).
    """
    exact = protected_exact or set()
    prefixes = protected_prefixes or []

    def walk(remote_dir: str, prefix: str) -> None:
        try:
            entries = _ftp_list_entries(ftp, remote_dir)
        except ftplib.error_perm:
            return
        for base, is_dir in entries:
            rel = f"{prefix}{base}"
            remote_entry = f"{remote_dir.rstrip('/')}/{base}"
            if is_dir:
                # Geschützte Teilbäume (images/, data/) GAR NICHT betreten:
                # kein Rekursionsabstieg, kein Listing, keine Typprüfung für
                # deren Inhalt. Das vermeidet ~1000 FTP/TLS-Roundtrips und damit
                # die Deploy-Blockade (Req 6.6, Performance).
                if _is_protected(f"{rel}/", exact, prefixes):
                    continue
                walk(remote_entry, f"{rel}/")
            elif rel not in keep and not _is_protected(rel, exact, prefixes):
                try:
                    ftp.delete(remote_entry)
                except ftplib.error_perm:
                    pass

    walk(remote_base, "")


# ---------------------------------------------------------------------------
# CLI / main
# ---------------------------------------------------------------------------


def _run_full_pipeline(config: Config, schema: list[SchemaField]) -> None:
    """backup -> [remote-download] -> optimize-images -> prepare -> export -> image-export (NICHT deploy)."""
    phase_backup(config)
    if config.import_source == "remote":
        password = resolve_password(config)
        download_remote_import(config, password)
    phase_optimize_images(config)
    phase_prepare(config, schema)
    phase_export(config)
    phase_image_export(config)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="weinimport.py",
        description=(
            "Weinsprechstunde Import-Skript. Ohne Phasen-Argument läuft die "
            "Pipeline backup -> optimize-images -> prepare -> export -> image-export (ohne deploy)."
        ),
    )
    parser.add_argument(
        "phase",
        nargs="?",
        choices=[
            "backup",
            "optimize-images",
            "prepare",
            "export",
            "image-export",
            "deploy",
        ],
        help="Einzelne Phase ausführen. Ohne Angabe läuft die volle Pipeline.",
    )
    parser.add_argument(
        "--config",
        default=CONFIG_PATH,
        help=f"Pfad zur Konfigurationsdatei (Standard: {CONFIG_PATH}).",
    )
    parser.add_argument(
        "--schema",
        default=SCHEMA_PATH,
        help=f"Pfad zur wine-schema.json (Standard: {SCHEMA_PATH}).",
    )
    parser.add_argument(
        "--force-images",
        action="store_true",
        help=(
            "Nur für die deploy-Phase: ALLE Bilder neu hochladen, unabhängig "
            "vom MDTM/Timestamp-Vergleich (sonst werden nur neuere/fehlende "
            "Bilder deployt)."
        ),
    )
    return parser


def main(argv: Optional[list[str]] = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    config = load_config(args.config)
    schema = load_wine_schema(args.schema)

    if args.phase == "backup":
        phase_backup(config)
    elif args.phase == "optimize-images":
        if config.import_source == "remote":
            password = resolve_password(config)
            download_remote_import(config, password)
        phase_optimize_images(config)
    elif args.phase == "prepare":
        if config.import_source == "remote":
            password = resolve_password(config)
            download_remote_import(config, password)
        phase_prepare(config, schema)
    elif args.phase == "export":
        phase_export(config)
    elif args.phase == "image-export":
        phase_image_export(config)
    elif args.phase == "deploy":
        phase_deploy(config, force_images=args.force_images)
    else:
        _run_full_pipeline(config, schema)


if __name__ == "__main__":
    main()
