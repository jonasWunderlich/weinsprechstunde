"""Konfiguration, Datenmodelle und Secrets-Auflösung des Weinimport-Skripts."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


CONFIG_PATH = "weinsprechstunde.config.json"
SECRETS_FILENAME = "weinsprechstunde.secrets.json"
DEFAULT_IMPORT_DIRNAME = "import"
SCHEMA_PATH = "wine-schema.json"


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
