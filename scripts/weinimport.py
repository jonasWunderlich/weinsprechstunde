#!/usr/bin/env python3
"""Weinsprechstunde Import-Skript.

Ein phasenbasiertes CLI, das JSON-Quelldateien aus dem Import-Ordner aufbereitet,
eine fertige ``wines.json`` exportiert, Bilder skaliert und Artefakte optional auf
einen Webserver deployt. Vor der Pipeline kann ein Zwei-Tier-Backup erstellt und bei
Bedarf der Import-Ordner per FTP/SFTP vom Webserver heruntergeladen werden.

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
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

CONFIG_PATH = "weinsprechstunde.config.json"
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
    # Optionales Feld: wie viele serverseitige Pre-Deploy-Backups unter
    # remote_backup_dir aufbewahrt werden. None -> Default MAX_PREDEPLOY_BACKUPS.
    max_predeploy_backups: Optional[int] = None


@dataclass
class DeployConfig:
    protocol: str  # "ftp" | "sftp"
    host: str
    user: str
    password: str
    remote_path: str
    remote_images_path: str
    remote_import_path: str


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

    return Config(
        import_dir=raw["import_dir"],
        import_source=raw["import_source"],
        export_path=raw["export_path"],
        scaffold_mode=raw["scaffold_mode"],
        image_export_dir=raw["image_export_dir"],
        image_resize_mode=raw["image_resize_mode"],
        image_resize_px=raw["image_resize_px"],
        deploy=deploy,
        editor=editor,
        backup=backup,
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


def collect_json_files(import_dir: str) -> list[Path]:
    """Rekursiv alle .json-Dateien in import_dir erfassen."""
    return sorted(Path(import_dir).rglob("*.json"))


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


def _sftp_connect(host: str, user: str, password: str):
    """SFTP-Client (paramiko) öffnen. Rückgabe: (transport, sftp)."""
    import paramiko

    transport = paramiko.Transport((host, 22))
    transport.connect(username=user, password=password)
    sftp = paramiko.SFTPClient.from_transport(transport)
    return transport, sftp


def _upload_sftp(sftp, local_file: Path, remote_file: str) -> None:
    """Eine lokale Datei per SFTP hochladen."""
    sftp.put(str(local_file), remote_file)


def _download_sftp(host: str, user: str, password: str, remote_path: str,
                   local_path: Path) -> None:
    """Remote-Verzeichnis rekursiv per SFTP nach local_path herunterladen."""
    transport, sftp = _sftp_connect(host, user, password)
    try:
        local_path.mkdir(parents=True, exist_ok=True)
        _sftp_download_dir(sftp, remote_path, local_path)
    finally:
        sftp.close()
        transport.close()


def _sftp_download_dir(sftp, remote_dir: str, local_dir: Path) -> None:
    import stat

    local_dir.mkdir(parents=True, exist_ok=True)
    for entry in sftp.listdir_attr(remote_dir):
        remote_entry = f"{remote_dir.rstrip('/')}/{entry.filename}"
        local_entry = local_dir / entry.filename
        if stat.S_ISDIR(entry.st_mode):
            _sftp_download_dir(sftp, remote_entry, local_entry)
        else:
            sftp.get(remote_entry, str(local_entry))


def _upload_ftp(ftp: "ftplib.FTP", local_file: Path, remote_file: str) -> None:
    """Eine lokale Datei per FTP hochladen."""
    with open(local_file, "rb") as fh:
        ftp.storbinary(f"STOR {remote_file}", fh)


def _download_ftp(host: str, user: str, password: str, remote_path: str,
                  local_path: Path) -> None:
    """Remote-Verzeichnis rekursiv per FTP nach local_path herunterladen."""
    ftp = ftplib.FTP(host)
    ftp.login(user, password)
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


def _ftp_download_dir(ftp: "ftplib.FTP", remote_dir: str, local_dir: Path) -> None:
    local_dir.mkdir(parents=True, exist_ok=True)
    for name in ftp.nlst(remote_dir):
        base = name.rsplit("/", 1)[-1]
        if base in (".", ".."):
            continue
        remote_entry = name if "/" in name else f"{remote_dir.rstrip('/')}/{name}"
        local_entry = local_dir / base
        if _ftp_is_dir(ftp, remote_entry):
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

    # Last-Backup: bei jedem Lauf
    last_name: Optional[str] = f"last_{timestamp}"
    last_path = backup_dir / last_name
    try:
        shutil.copytree(config.import_dir, last_path)
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
        archival_name = f"archival_{timestamp}"
        archival_path = backup_dir / archival_name
        try:
            shutil.copytree(config.import_dir, archival_path)
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
    """Älteste Backup-Ordner löschen wenn max_count überschritten."""
    entries = sorted(
        [d for d in backup_dir.iterdir() if d.is_dir() and d.name.startswith(prefix)]
    )
    while len(entries) > max_count:
        oldest = entries.pop(0)
        try:
            shutil.rmtree(oldest)
        except Exception as e:
            sys.stderr.write(
                f"WARNUNG: Backup-Ordner {oldest} konnte nicht gelöscht werden: {e}\n"
            )


def _remote_backup(config: Config, last_name: Optional[str],
                   archival_name: Optional[str]) -> None:
    """Lokale Backup-Ordner auf den Webspace übertragen (best effort).

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

    if config.deploy.protocol == "sftp":
        transport, sftp = _sftp_connect(config.deploy.host, config.deploy.user, password)
        try:
            for name in names:
                _upload_dir_sftp(sftp, backup_dir / name, f"{remote_base.rstrip('/')}/{name}")
        finally:
            sftp.close()
            transport.close()
    else:
        ftp = ftplib.FTP(config.deploy.host)
        ftp.login(config.deploy.user, password)
        try:
            for name in names:
                _upload_dir_ftp(ftp, backup_dir / name, f"{remote_base.rstrip('/')}/{name}")
        finally:
            ftp.quit()


def _sftp_makedirs(sftp, remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    path = ""
    for part in parts:
        path = f"{path}/{part}"
        try:
            sftp.stat(path)
        except IOError:
            sftp.mkdir(path)


def _upload_dir_sftp(sftp, local_dir: Path, remote_dir: str) -> None:
    _sftp_makedirs(sftp, remote_dir)
    for item in local_dir.iterdir():
        remote_item = f"{remote_dir.rstrip('/')}/{item.name}"
        if item.is_dir():
            _upload_dir_sftp(sftp, item, remote_item)
        else:
            _upload_sftp(sftp, item, remote_item)


def _ftp_makedirs(ftp: "ftplib.FTP", remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    path = ""
    for part in parts:
        path = f"{path}/{part}"
        try:
            ftp.mkd(path)
        except ftplib.error_perm:
            pass


def _upload_dir_ftp(ftp: "ftplib.FTP", local_dir: Path, remote_dir: str) -> None:
    _ftp_makedirs(ftp, remote_dir)
    for item in local_dir.iterdir():
        remote_item = f"{remote_dir.rstrip('/')}/{item.name}"
        if item.is_dir():
            _upload_dir_ftp(ftp, item, remote_item)
        else:
            _upload_ftp(ftp, item, remote_item)


# ---------------------------------------------------------------------------
# Remote-Import-Download (wenn import_source = "remote")
# ---------------------------------------------------------------------------


def download_remote_import(config: Config, password: str) -> None:
    """Synchronisiert deploy.remote_import_path auf den lokalen import_dir."""
    try:
        if config.deploy.protocol == "sftp":
            _download_sftp(
                host=config.deploy.host,
                user=config.deploy.user,
                password=password,
                remote_path=config.deploy.remote_import_path,
                local_path=Path(config.import_dir),
            )
        else:
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


def phase_prepare(config: Config, schema: list[SchemaField]) -> None:
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
            rename_file_group(json_file, new_stem, data)
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


def rename_file_group(json_file: Path, new_stem: str, data: dict) -> None:
    """JSON + Bild + Audio auf neuen Basisnamen umbenennen."""
    for field_name in ("image", "audio"):
        if not data.get(field_name):
            continue
        old_path = json_file.parent / data[field_name]
        if not old_path.exists():
            continue
        new_path = old_path.parent / f"{new_stem}{old_path.suffix}"
        if new_path.exists():
            sys.stderr.write(
                f"WARNUNG: Zieldatei {new_path} existiert bereits, übersprungen.\n"
            )
            continue
        old_path.rename(new_path)
        data[field_name] = new_path.name

    new_json = json_file.parent / f"{new_stem}.json"
    if new_json.exists() and new_json != json_file:
        sys.stderr.write(
            f"WARNUNG: Zieldatei {new_json} existiert bereits, übersprungen.\n"
        )
        return
    if new_json != json_file:
        json_file.rename(new_json)


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

    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        image_ref = data.get("image")
        if not image_ref:
            continue

        src = json_file.parent / image_ref
        if not src.exists():
            sys.stderr.write(f"WARNUNG: Bild {src} nicht gefunden, übersprungen.\n")
            continue

        dst = Path(config.image_export_dir) / image_ref
        dst.parent.mkdir(parents=True, exist_ok=True)

        # Timestamp-Vergleich: überspringen wenn Kopie aktuell
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            continue

        with Image.open(src) as img:
            px = config.image_resize_px
            if config.image_resize_mode == "width":
                img.thumbnail((px, 99999))
            else:  # "height"
                img.thumbnail((99999, px))
            img.save(dst, format=img.format)
        # Originale werden nicht verändert


# ---------------------------------------------------------------------------
# Phase deploy
# ---------------------------------------------------------------------------


class PreDeployBackupError(Exception):
    """Fehler beim Pre-Deploy-Backup von remote_path.

    Eigene Exception-Klasse, damit ein Backup-Fehler in ``phase_deploy`` eine
    eigene, klare Meldung bekommt und NICHT fälschlich als Verbindungsproblem
    (Hostname/Passwort/Protokoll) gemeldet wird (Review-Finding).
    """


def phase_deploy(config: Config) -> None:
    password = resolve_password(config)

    try:
        if config.deploy.protocol == "sftp":
            _deploy_sftp(config, password)
        else:
            _deploy_ftp(config, password)
    except SystemExit:
        raise
    except PreDeployBackupError as e:
        # Das Pre-Deploy-Backup ist fehlgeschlagen. Es wurde NICHT geprunt (das
        # Backup läuft vor dem Prune). Eigene Meldung, damit nicht fälschlich auf
        # Hostname/Passwort/Protokoll verwiesen wird.
        sys.stderr.write(
            f"FEHLER: Pre-Deploy-Backup von {config.deploy.remote_path} "
            f"fehlgeschlagen: {e}. Es wurde nichts auf dem Server gelöscht "
            f"(Prune übersprungen). Bitte das Backup-Problem beheben und den "
            f"Deploy erneut starten.\n"
        )
        sys.exit(1)
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


# Anzahl serverseitiger Pre-Deploy-Backups, die unter
# backup.remote_backup_dir aufbewahrt werden. Dieses Deployment-Backup ist
# getrennt vom lokalen Import-Backup-Mechanismus (max_last_backups/
# max_archival_backups) und hat bewusst ein eigenes, kleines Rolling-Window.
# Per optionalem Config-Feld backup.max_predeploy_backups überschreibbar,
# funktioniert aber ohne Config-Änderung mit diesem Default.
MAX_PREDEPLOY_BACKUPS = 5


def _resolve_dist_dir(base: Path = Path("frontend/dist")) -> Path:
    """Tatsächliches Angular-Build-Output-Verzeichnis als Deploy-Wurzel ermitteln.

    Der Builder ``@angular/build:application`` schreibt den auszuliefernden
    Browser-Build nach ``frontend/dist/<projekt>/browser/`` (verschachtelt),
    während ältere/flache Angular-Setups direkt nach ``frontend/dist/`` bauen.
    Diese Funktion löst robust den Ordner auf, dessen Inhalt (``index.html``,
    ``assets/`` usw.) direkt in ``remote_path`` landen soll (Req 6.7):

    1. Enthält ``base`` selbst eine ``index.html`` -> flacher dist-Ordner.
    2. Sonst: genau ein ``<projekt>/browser/``-Unterordner mit ``index.html``.
    3. Fallback: ``base`` unverändert (robust gegen leicht andere Defaults).
    """
    if not base.exists():
        return base
    if (base / "index.html").exists():
        return base
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


def _predeploy_remote_backup_dir(config: Config) -> tuple[str, str]:
    """Serverseitiges Backup-Ziel ermitteln: (remote_backup_base, predeploy_name).

    Das Backup landet serverseitig unter
    ``<remote_backup_dir>/predeploy-<YYYYmmdd-HHMMSS>/`` – die Daten bleiben auf
    dem Server, laufen NICHT über den lokalen Rechner. Fehlt die Backup-
    Konfiguration (``config.backup``) oder ``remote_backup_dir``, ist kein Ziel
    definiert – das ist ein harter Fehler, denn ohne Backup darf der
    nachfolgende Prune nicht laufen.
    """
    if not config.backup or not config.backup.remote_backup_dir:
        raise PreDeployBackupError(
            "backup.remote_backup_dir fehlt. Ohne serverseitiges Backup-Ziel "
            "darf nicht geprunt werden."
        )
    remote_base = config.backup.remote_backup_dir.rstrip("/")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return remote_base, f"predeploy-{timestamp}"


def _max_predeploy_backups(config: Config) -> int:
    """Aufzubewahrende Pre-Deploy-Backups: Config-Override oder Default 5."""
    if config.backup and config.backup.max_predeploy_backups is not None:
        return config.backup.max_predeploy_backups
    return MAX_PREDEPLOY_BACKUPS


def _predeploy_server_backup_sftp(transport, sftp, config: Config,
                                  remote_path: str) -> None:
    """Pre-Deploy-Backup: remote_path serverseitig kopieren (vor Prune).

    Kopiert den aktuellen Zustand von ``remote_path`` rekursiv (wie ``cp -a``)
    in einen zeitgestempelten Unterordner
    ``<remote_backup_dir>/predeploy-<ts>/`` – die Daten bleiben auf dem Server
    und laufen NICHT durch den lokalen Rechner. Umgesetzt per SSH-Exec über
    denselben paramiko-Transport (SFTP kennt keinen nativen rekursiven
    Server-Copy). Dieses Backup ist getrennt vom Import-Backup
    (``_remote_backup``/``phase_backup``).

    Fehlertoleranz: Schlägt das Backup grundsätzlich fehl (Exec-/Verbindungs-
    fehler oder von der Shell gemeldeter Fehler), wird eine
    ``PreDeployBackupError`` geworfen, damit der Deploy NICHT weiterläuft und
    prunt – lieber sauber scheitern, bevor auf dem Server gelöscht wird.
    """
    remote_base, name = _predeploy_remote_backup_dir(config)
    target = f"{remote_base}/{name}"
    try:
        _ssh_exec(
            transport,
            f"mkdir -p {_shq(target)} && "
            f"cp -a {_shq(remote_path.rstrip('/'))}/. {_shq(target)}/",
        )
    except Exception as e:
        raise PreDeployBackupError(str(e)) from e
    _prune_predeploy_backups_server(transport, remote_base,
                                    _max_predeploy_backups(config))


def _predeploy_server_backup_ftp(ftp, config: Config, remote_path: str) -> None:
    """Pre-Deploy-Backup serverseitig über FTP (vor Prune).

    FTP kennt weder SSH-Exec noch einen nativen rekursiven Server-Copy. Diese
    Variante bleibt dennoch server-seitig: Sie kopiert jede Datei unter
    ``remote_path`` serverseitig per ``RNFR``/``RNTO`` ist NICHT möglich (das
    verschiebt statt zu kopieren), daher wird – wo der FTP-Server die
    SITE-COPY-/Kopier-Erweiterung bietet – ``SITE CPTO`` verwendet; andernfalls
    ist eine reine serverseitige Kopie über Standard-FTP nicht möglich.

    Umsetzung: Für jede Datei unter ``remote_path`` wird versucht, sie
    serverseitig in das zeitgestempelte Ziel zu kopieren, ohne die Daten lokal
    zwischenzuspeichern. Scheitert dies grundsätzlich, wird eine
    ``PreDeployBackupError`` geworfen und NICHT geprunt (fail-closed).
    """
    remote_base, name = _predeploy_remote_backup_dir(config)
    target = f"{remote_base}/{name}"
    try:
        _ftp_makedirs(ftp, target)
        _ftp_server_copy_dir(ftp, remote_path.rstrip("/"), target)
    except Exception as e:
        raise PreDeployBackupError(str(e)) from e
    _prune_predeploy_backups_server_ftp(ftp, remote_base,
                                        _max_predeploy_backups(config))


def _shq(path: str) -> str:
    """Pfad fürs Shell-Exec sicher quoten (einfache Anführungszeichen)."""
    return "'" + path.replace("'", "'\\''") + "'"


def _ssh_exec(transport, command: str) -> str:
    """Kommando über eine SSH-Exec-Session auf dem Server ausführen.

    Nutzt denselben paramiko-Transport wie die SFTP-Verbindung. Wirft bei einem
    Exit-Status != 0 eine Exception mit stderr-Inhalt, damit der Aufrufer ein
    gescheitertes serverseitiges Backup erkennt.
    """
    channel = transport.open_session()
    try:
        channel.exec_command(command)
        stdout = channel.makefile("rb").read()
        stderr = channel.makefile_stderr("rb").read()
        status = channel.recv_exit_status()
    finally:
        channel.close()
    if status != 0:
        msg = stderr.decode(errors="replace").strip() or f"exit status {status}"
        raise RuntimeError(f"SSH-Exec fehlgeschlagen ({command!r}): {msg}")
    return stdout.decode(errors="replace")


def _ftp_server_copy_dir(ftp, remote_src: str, remote_dst: str) -> None:
    """Verzeichnis serverseitig per FTP kopieren (ohne lokalen Umweg).

    Rekursiv über ``remote_src``; Dateien werden per ``SITE CPTO`` (sofern vom
    Server unterstützt) serverseitig dupliziert. Unterstützt der Server keine
    serverseitige Kopie, schlägt ``sendcmd`` fehl und die Exception propagiert
    nach oben (fail-closed, kein Prune).
    """
    _ftp_makedirs(ftp, remote_dst)
    for name in ftp.nlst(remote_src):
        base = name.rsplit("/", 1)[-1]
        if base in (".", ".."):
            continue
        src_entry = name if "/" in name else f"{remote_src.rstrip('/')}/{name}"
        dst_entry = f"{remote_dst.rstrip('/')}/{base}"
        if _ftp_is_dir(ftp, src_entry):
            _ftp_server_copy_dir(ftp, src_entry, dst_entry)
        else:
            # Serverseitige Kopie: SITE CPFR/CPTO (ProFTPD mod_copy). Bleibt
            # vollständig auf dem Server – keine RETR/STOR über den Client.
            ftp.sendcmd(f"SITE CPFR {src_entry}")
            ftp.sendcmd(f"SITE CPTO {dst_entry}")


def _prune_predeploy_backups_server(transport, remote_base: str,
                                    max_count: int) -> None:
    """Nur die neuesten max_count predeploy-Ordner serverseitig behalten.

    Die predeploy-Ordner sind zeitstempel-benannt, daher ergibt lexikografisches
    Sortieren die chronologische Reihenfolge. Löschung per SSH-Exec; best effort:
    Fehler hier dürfen das bereits erfolgte Backup nicht scheitern lassen.
    """
    try:
        listing = _ssh_exec(
            transport,
            f"ls -1 {_shq(remote_base)} 2>/dev/null || true",
        )
    except Exception as e:
        sys.stderr.write(
            f"WARNUNG: Pre-Deploy-Backup-Retention übersprungen "
            f"(Listing fehlgeschlagen): {e}\n"
        )
        return
    entries = sorted(
        line.strip() for line in listing.splitlines()
        if line.strip().startswith("predeploy-")
    )
    while len(entries) > max_count:
        oldest = entries.pop(0)
        path = f"{remote_base.rstrip('/')}/{oldest}"
        try:
            _ssh_exec(transport, f"rm -rf {_shq(path)}")
        except Exception as e:
            sys.stderr.write(
                f"WARNUNG: Pre-Deploy-Backup {path} konnte nicht gelöscht "
                f"werden: {e}\n"
            )


def _prune_predeploy_backups_server_ftp(ftp, remote_base: str,
                                        max_count: int) -> None:
    """Serverseitige Pre-Deploy-Backup-Retention über FTP.

    Entfernt die ältesten ``predeploy-``Ordner unter ``remote_base``, sodass
    maximal ``max_count`` erhalten bleiben. Best effort: Fehler hier dürfen das
    bereits erfolgte Backup nicht scheitern lassen.
    """
    try:
        names = ftp.nlst(remote_base)
    except Exception as e:
        sys.stderr.write(
            f"WARNUNG: Pre-Deploy-Backup-Retention übersprungen "
            f"(Listing fehlgeschlagen): {e}\n"
        )
        return
    entries = sorted(
        n.rsplit("/", 1)[-1] for n in names
        if n.rsplit("/", 1)[-1].startswith("predeploy-")
    )
    while len(entries) > max_count:
        oldest = entries.pop(0)
        path = f"{remote_base.rstrip('/')}/{oldest}"
        try:
            _ftp_rmtree(ftp, path)
        except Exception as e:
            sys.stderr.write(
                f"WARNUNG: Pre-Deploy-Backup {path} konnte nicht gelöscht "
                f"werden: {e}\n"
            )


def _ftp_rmtree(ftp, remote_dir: str) -> None:
    """Verzeichnis rekursiv per FTP löschen."""
    for name in ftp.nlst(remote_dir):
        base = name.rsplit("/", 1)[-1]
        if base in (".", ".."):
            continue
        entry = name if "/" in name else f"{remote_dir.rstrip('/')}/{name}"
        if _ftp_is_dir(ftp, entry):
            _ftp_rmtree(ftp, entry)
        else:
            ftp.delete(entry)
    ftp.rmd(remote_dir)


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
    hochgeladene ``wines.json`` (Basename aus ``export_path``) sowie – falls
    ``remote_images_path`` unterhalb von ``remote_path`` liegt – der komplette
    Bilderordner. So kann der dist-Prune diese nie entfernen (Req 6.6).
    """
    base = config.deploy.remote_path.rstrip("/")
    exact: set[str] = {Path(config.export_path).name}
    prefixes: list[str] = []

    images = config.deploy.remote_images_path.rstrip("/")
    if images == base:
        # Bilder liegen direkt unter remote_path -> nichts weiter zu tun,
        # der Ordner selbst ist remote_base.
        prefixes.append("")
    elif images.startswith(base + "/"):
        prefixes.append(images[len(base) + 1:] + "/")
    return exact, prefixes


def _is_protected(rel: str, exact: set[str], prefixes: list[str]) -> bool:
    if rel in exact:
        return True
    return any(prefix and rel.startswith(prefix) for prefix in prefixes)


def _deploy_sftp(config: Config, password: str) -> None:
    transport, sftp = _sftp_connect(config.deploy.host, config.deploy.user, password)
    try:
        # Tatsächlichen Browser-Build-Ordner als Deploy-Wurzel verwenden, damit
        # index.html/assets direkt unter remote_path landen (Req 6.7).
        dist_dir = _resolve_dist_dir()
        local_files = _local_dist_files(dist_dir)
        remote_base = config.deploy.remote_path

        # dist-Ordner: Upload mit Timestamp-Vergleich
        _sftp_makedirs(sftp, remote_base)
        for rel, local_file in local_files.items():
            remote_file = f"{remote_base.rstrip('/')}/{rel}"
            _sftp_makedirs(sftp, remote_file.rsplit("/", 1)[0])
            if not _sftp_up_to_date(sftp, remote_file, local_file):
                _upload_sftp(sftp, local_file, remote_file)

        # Pre-Deploy-Backup des aktuellen Server-Zustands VOR dem Prune:
        # remote_path wird SERVERSEITIG nach
        # remote_backup_dir/predeploy-<ts>/ kopiert (SSH-Exec, kein Download).
        # Schlägt es grundsätzlich fehl, propagiert die Exception und der Prune
        # läuft NICHT – wir löschen nie ohne vorheriges Backup.
        _predeploy_server_backup_sftp(transport, sftp, config, remote_base)

        # dist-Ordner: veraltete Serverdateien löschen (wines.json/Bilder NIE)
        exact, prefixes = _protected_prefixes(config)
        _sftp_prune(sftp, remote_base, set(local_files.keys()), exact, prefixes)

        # wines.json unter remote_path ablegen (nie löschen)
        wines_json = Path(config.export_path)
        if wines_json.exists():
            remote_wines = f"{remote_base.rstrip('/')}/{wines_json.name}"
            if not _sftp_up_to_date(sftp, remote_wines, wines_json):
                _upload_sftp(sftp, wines_json, remote_wines)

        # Bilder unter remote_images_path ablegen (nie löschen)
        images_dir = Path(config.image_export_dir)
        if images_dir.exists():
            _sftp_makedirs(sftp, config.deploy.remote_images_path)
            for img in images_dir.iterdir():
                if img.is_file():
                    remote_img = f"{config.deploy.remote_images_path.rstrip('/')}/{img.name}"
                    if not _sftp_up_to_date(sftp, remote_img, img):
                        _upload_sftp(sftp, img, remote_img)
    finally:
        sftp.close()
        transport.close()


def _sftp_up_to_date(sftp, remote_file: str, local_file: Path) -> bool:
    """True, wenn die Remote-Datei nicht älter ist als die lokale Datei."""
    try:
        remote_mtime = sftp.stat(remote_file).st_mtime
    except IOError:
        return False
    return remote_mtime >= local_file.stat().st_mtime


def _sftp_prune(sftp, remote_base: str, keep: set[str],
                protected_exact: Optional[set[str]] = None,
                protected_prefixes: Optional[list[str]] = None) -> None:
    """Dateien im remote dist-Ordner löschen, die lokal nicht mehr existieren.

    ``protected_exact``/``protected_prefixes`` schützen wines.json und den
    Bilderordner, falls diese unter remote_base liegen (Req 6.6).
    """
    import stat as stat_mod

    exact = protected_exact or set()
    prefixes = protected_prefixes or []

    def walk(remote_dir: str, prefix: str) -> None:
        try:
            entries = sftp.listdir_attr(remote_dir)
        except IOError:
            return
        for entry in entries:
            rel = f"{prefix}{entry.filename}"
            remote_entry = f"{remote_dir.rstrip('/')}/{entry.filename}"
            if stat_mod.S_ISDIR(entry.st_mode):
                walk(remote_entry, f"{rel}/")
            elif rel not in keep and not _is_protected(rel, exact, prefixes):
                try:
                    sftp.remove(remote_entry)
                except IOError:
                    pass

    walk(remote_base, "")


def _deploy_ftp(config: Config, password: str) -> None:
    ftp = ftplib.FTP(config.deploy.host)
    ftp.login(config.deploy.user, password)
    try:
        # Browser-Build-Ordner als Deploy-Wurzel (Req 6.7), identisch zu SFTP.
        dist_dir = _resolve_dist_dir()
        local_files = _local_dist_files(dist_dir)
        remote_base = config.deploy.remote_path

        _ftp_makedirs(ftp, remote_base)
        for rel, local_file in local_files.items():
            remote_file = f"{remote_base.rstrip('/')}/{rel}"
            _ftp_makedirs(ftp, remote_file.rsplit("/", 1)[0])
            if not _ftp_up_to_date(ftp, remote_file, local_file):
                _upload_ftp(ftp, local_file, remote_file)

        # Pre-Deploy-Backup VOR dem Prune: remote_path wird SERVERSEITIG nach
        # remote_backup_dir/predeploy-<ts>/ kopiert (SITE CPFR/CPTO, kein
        # Download). Fail-closed: Schlägt das Backup fehl, wird abgebrochen,
        # bevor geprunt wird – es wird nie ohne vorheriges Backup gelöscht.
        _predeploy_server_backup_ftp(ftp, config, remote_base)

        exact, prefixes = _protected_prefixes(config)
        _ftp_prune(ftp, remote_base, set(local_files.keys()), exact, prefixes)

        wines_json = Path(config.export_path)
        if wines_json.exists():
            remote_wines = f"{remote_base.rstrip('/')}/{wines_json.name}"
            if not _ftp_up_to_date(ftp, remote_wines, wines_json):
                _upload_ftp(ftp, wines_json, remote_wines)

        images_dir = Path(config.image_export_dir)
        if images_dir.exists():
            _ftp_makedirs(ftp, config.deploy.remote_images_path)
            for img in images_dir.iterdir():
                if img.is_file():
                    remote_img = f"{config.deploy.remote_images_path.rstrip('/')}/{img.name}"
                    if not _ftp_up_to_date(ftp, remote_img, img):
                        _upload_ftp(ftp, img, remote_img)
    finally:
        ftp.quit()


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
            names = ftp.nlst(remote_dir)
        except ftplib.error_perm:
            return
        for name in names:
            base = name.rsplit("/", 1)[-1]
            if base in (".", ".."):
                continue
            rel = f"{prefix}{base}"
            remote_entry = name if "/" in name else f"{remote_dir.rstrip('/')}/{name}"
            if _ftp_is_dir(ftp, remote_entry):
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
    """backup -> [remote-download] -> prepare -> export -> image-export (NICHT deploy)."""
    phase_backup(config)
    if config.import_source == "remote":
        password = resolve_password(config)
        download_remote_import(config, password)
    phase_prepare(config, schema)
    phase_export(config)
    phase_image_export(config)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="weinimport.py",
        description=(
            "Weinsprechstunde Import-Skript. Ohne Phasen-Argument läuft die "
            "Pipeline backup -> prepare -> export -> image-export (ohne deploy)."
        ),
    )
    parser.add_argument(
        "phase",
        nargs="?",
        choices=["backup", "prepare", "export", "image-export", "deploy"],
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
    return parser


def main(argv: Optional[list[str]] = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    config = load_config(args.config)
    schema = load_wine_schema(args.schema)

    if args.phase == "backup":
        phase_backup(config)
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
        phase_deploy(config)
    else:
        _run_full_pipeline(config, schema)


if __name__ == "__main__":
    main()
