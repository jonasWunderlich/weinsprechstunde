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


# ---------------------------------------------------------------------------
# Remote-Import-Download (wenn import_source = "remote")
# ---------------------------------------------------------------------------


def download_remote_import(config: Config, password: str) -> None:
    """Synchronisiert deploy.remote_import_path auf den lokalen import_dir."""
    try:
        ft._download_ftp(
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
    ftp = ft._ftps_connect(config.deploy.host, config.deploy.user, password)
    try:
        # Browser-Build-Ordner als Deploy-Wurzel (Req 6.7).
        dist_dir = _resolve_dist_dir()
        local_files = _local_dist_files(dist_dir)
        remote_base = config.deploy.remote_path

        # 1) dist-Ordner hochladen (Timestamp-Vergleich).
        ft._ftp_makedirs(ftp, remote_base)
        for rel, local_file in local_files.items():
            remote_file = f"{remote_base.rstrip('/')}/{rel}"
            ft._ftp_makedirs(ftp, remote_file.rsplit("/", 1)[0])
            if not _ftp_up_to_date(ftp, remote_file, local_file):
                ft._upload_ftp(ftp, local_file, remote_file)

        # 2) Prune: veraltete Serverdateien NUR unter /wine_app löschen;
        #    images/, data/ und wines.json bleiben geschützt (Req 6.6).
        exact, prefixes = _protected_prefixes(config)
        _ftp_prune(ftp, remote_base, set(local_files.keys()), exact, prefixes)

        # 3) wines.json (und optional wine-schema.json) nach
        #    remote_import_path ablegen (nie löschen).
        import_base = config.deploy.remote_import_path
        wines_json = Path(config.export_path)
        if wines_json.exists():
            ft._ftp_makedirs(ftp, import_base)
            remote_wines = f"{import_base.rstrip('/')}/{wines_json.name}"
            if not _ftp_up_to_date(ftp, remote_wines, wines_json):
                ft._upload_ftp(ftp, wines_json, remote_wines)
        schema_json = wines_json.parent / "wine-schema.json"
        if schema_json.exists():
            ft._ftp_makedirs(ftp, import_base)
            remote_schema = f"{import_base.rstrip('/')}/{schema_json.name}"
            if not _ftp_up_to_date(ftp, remote_schema, schema_json):
                ft._upload_ftp(ftp, schema_json, remote_schema)

        # 4) Bilder nach remote_images_path ablegen (nie löschen).
        images_dir = Path(config.image_export_dir)
        if images_dir.exists():
            ft._ftp_makedirs(ftp, config.deploy.remote_images_path)
            for img in images_dir.iterdir():
                if img.is_file():
                    remote_img = f"{config.deploy.remote_images_path.rstrip('/')}/{img.name}"
                    # Mit --force-images werden ALLE Bilder neu hochgeladen
                    # (kein MDTM/Timestamp-Vergleich); sonst nur neuere/fehlende.
                    if force_images or not _ftp_up_to_date(ftp, remote_img, img):
                        ft._upload_ftp(ftp, img, remote_img)

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
    ft._ftp_makedirs(ftp, editor_base)
    for rel, local_file in editor_files.items():
        remote_file = f"{editor_base}/{rel}"
        ft._ftp_makedirs(ftp, remote_file.rsplit("/", 1)[0])
        if not _ftp_up_to_date(ftp, remote_file, local_file):
            ft._upload_ftp(ftp, local_file, remote_file)

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
            entries = ft._ftp_list_entries(ftp, remote_dir)
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
