"""CLI: Phasen-Orchestrierung (argparse) für das Weinsprechstunde Import-Skript."""
from __future__ import annotations

import argparse
from typing import Optional

from weinlib.backup import phase_backup
from weinlib.config import (
    CONFIG_PATH,
    SCHEMA_PATH,
    Config,
    SchemaField,
    load_config,
    load_wine_schema,
    resolve_password,
)
from weinlib.deploy import download_remote_import, phase_deploy
from weinlib.pipeline import (
    phase_export,
    phase_image_export,
    phase_optimize_images,
    phase_prepare,
)


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
