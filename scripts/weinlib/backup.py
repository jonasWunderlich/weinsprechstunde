"""Backup-Phase (Pipeline-Domäne): Last-/Archival-Backups der wines.json."""
from __future__ import annotations

import os
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from weinlib import ftp_transport as ft
from weinlib.config import Config

LAST_ARCHIVAL_FILE = ".last_archival"


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

    ftp = ft._ftps_connect(config.deploy.host, config.deploy.user, password)
    try:
        ft._ftp_makedirs(ftp, remote_base)
        for name in names:
            ft._upload_ftp(ftp, backup_dir / name, f"{remote_base.rstrip('/')}/{name}")
    finally:
        ftp.quit()
