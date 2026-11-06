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
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# scripts/ in den Suchpfad aufnehmen (auch beim Laden per Dateipfad, z. B. in Tests).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from weinlib import ftp_transport as ft
from weinlib.config import (
    CONFIG_PATH,
    DEFAULT_IMPORT_DIRNAME,
    SCHEMA_PATH,
    SECRETS_FILENAME,
    BackupConfig,
    Config,
    DeployConfig,
    EditorConfig,
    OptimizeConfig,
    SchemaField,
    Wine,
    get_scaffold_fields,
    load_config,
    load_wine_schema,
    resolve_password,
)
from weinlib.ftp_transport import (  # noqa: F401 (Re-Exports der Fassade)
    _download_ftp,
    _ftp_download_dir,
    _ftp_is_dir,
    _ftp_list_entries,
    _ftp_makedirs,
    _ftps_connect,
    _ReuseTLS_FTP,
    _upload_ftp,
)

from weinlib.pipeline import (  # noqa: F401 (Re-Exports der Fassade)
    ARCHIVE_DIR_NAME,
    IMAGE_EXTENSIONS,
    _round_to_decimals,
    apply_scaffold_mode,
    collect_image_files,
    collect_json_files,
    find_image_sibling,
    normalize_number_fields,
    optimize_image,
    phase_export,
    phase_image_export,
    phase_optimize_images,
    phase_prepare,
    read_exif_date,
    rename_file_group,
    slugify_name,
)

from weinlib.backup import (  # noqa: F401 (Re-Exports der Fassade)
    LAST_ARCHIVAL_FILE,
    _prune_backups,
    _remote_backup,
    phase_backup,
)


from weinlib.deploy import (  # noqa: F401 (Re-Exports der Fassade)
    EDITOR_APP_PROJECT,
    PUBLIC_APP_PROJECT,
    _deploy_editor,
    _deploy_ftp,
    _ftp_prune,
    _ftp_up_to_date,
    _is_protected,
    _local_dist_files,
    _protected_prefixes,
    _resolve_dist_dir,
    _resolve_editor_dist_dir,
    download_remote_import,
    phase_deploy,
)


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
