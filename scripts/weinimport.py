#!/usr/bin/env python3
"""Weinsprechstunde Import-Skript (Fassade).

Einstieg ``python scripts/weinimport.py [phase]``; die Logik liegt in
``scripts/weinlib/`` (config, ftp_transport, pipeline, backup, deploy, cli).
Die Re-Exports halten ``weinimport.<name>`` für Tests und Probe-Skripte stabil.
"""

import os
import sys

# scripts/ in den Suchpfad aufnehmen (auch beim Laden per Dateipfad, z. B. in Tests).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ruff: noqa: F401 (Re-Exports der Fassade)
from weinlib.backup import LAST_ARCHIVAL_FILE, _prune_backups, _remote_backup, phase_backup
from weinlib.cli import _run_full_pipeline, build_parser, main
from weinlib.config import (
    CONFIG_PATH, DEFAULT_IMPORT_DIRNAME, SCHEMA_PATH, SECRETS_FILENAME,
    BackupConfig, Config, DeployConfig, EditorConfig, OptimizeConfig, SchemaField, Wine,
    get_scaffold_fields, load_config, load_wine_schema, resolve_password,
)
from weinlib.deploy import (
    EDITOR_APP_PROJECT, PUBLIC_APP_PROJECT, _deploy_editor, _deploy_ftp, _ftp_prune,
    _ftp_up_to_date, _is_protected, _local_dist_files, _protected_prefixes,
    _resolve_dist_dir, _resolve_editor_dist_dir, download_remote_import, phase_deploy,
)
from weinlib.ftp_transport import (
    _download_ftp, _ftp_download_dir, _ftp_is_dir, _ftp_list_entries, _ftp_makedirs,
    _ftps_connect, _ReuseTLS_FTP, _upload_ftp,
)
from weinlib.pipeline import (
    ARCHIVE_DIR_NAME, IMAGE_EXTENSIONS, _round_to_decimals, apply_scaffold_mode,
    collect_image_files, collect_json_files, find_image_sibling, normalize_number_fields,
    optimize_image, phase_export, phase_image_export, phase_optimize_images, phase_prepare,
    read_exif_date, rename_file_group, slugify_name,
)

if __name__ == "__main__":
    main()
