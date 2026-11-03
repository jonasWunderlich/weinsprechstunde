"""Gemeinsame Test-Fixtures und Helfer für die weinimport-Testsuite."""

import importlib.util
import json
import sys
from io import BytesIO
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "weinimport.py"
WPM_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "wordpress_migrate.py"


def _load_weinimport():
    spec = importlib.util.spec_from_file_location("weinimport", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["weinimport"] = module
    spec.loader.exec_module(module)
    return module


def _load_wordpress_migrate():
    spec = importlib.util.spec_from_file_location(
        "wordpress_migrate", WPM_SCRIPT_PATH
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["wordpress_migrate"] = module
    spec.loader.exec_module(module)
    return module


weinimport = _load_weinimport()
wordpress_migrate = _load_wordpress_migrate()


@pytest.fixture
def wi():
    """Das geladene weinimport-Modul."""
    return weinimport


@pytest.fixture
def wpm():
    """Das geladene wordpress_migrate-Modul."""
    return wordpress_migrate


def _sql_literal(value) -> str:
    """Python-Wert als SQL-Literal für die Fixture-Dumps formatieren."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = (
        str(value)
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
        .replace("\0", "\\0")
    )
    return f"'{escaped}'"


def make_sql_dump(tmp: Path, name: str, posts=None, postmeta=None,
                  prefix: str = "wp_") -> Path:
    """Kleinen, syntaktisch echten mysqldump-Textdump schreiben.

    ``posts``: Liste von dicts (beliebige Spalten, mind. ID/post_type).
    ``postmeta``: Liste von (post_id, meta_key, meta_value)-Tupeln; die
    ``meta_id`` wird automatisch vergeben.
    """
    lines: list[str] = []

    if posts:
        cols = ["ID", "post_author", "post_date", "post_title",
                "post_name", "post_parent", "post_type",
                "post_mime_type", "comment_count"]
        lines.append(
            f"INSERT INTO `{prefix}posts` "
            f"({', '.join(f'`{c}`' for c in cols)}) VALUES"
        )
        rows = []
        for p in posts:
            row = ", ".join(_sql_literal(p.get(c)) for c in cols)
            rows.append(f"({row})")
        lines.append(",\n".join(rows) + ";")

    if postmeta:
        lines.append(
            f"INSERT INTO `{prefix}postmeta` "
            f"(`meta_id`, `post_id`, `meta_key`, `meta_value`) VALUES"
        )
        rows = []
        for i, (post_id, key, value) in enumerate(postmeta, start=1):
            rows.append(
                f"({i}, {_sql_literal(post_id)}, "
                f"{_sql_literal(key)}, {_sql_literal(value)})"
            )
        lines.append(",\n".join(rows) + ";")

    path = tmp / name
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def make_uploads(tmp: Path, files: dict) -> Path:
    """Uploads-Ordner mit {relativer Pfad: bytes} anlegen; Pfad zurückgeben."""
    uploads = tmp / "uploads"
    for rel, content in files.items():
        target = uploads / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return uploads


def make_config(**overrides):
    """Baut ein Config-Objekt mit sinnvollen Defaults für Tests."""
    deploy = weinimport.DeployConfig(
        protocol=overrides.pop("protocol", "ftpes"),
        host=overrides.pop("host", "example.com"),
        user=overrides.pop("user", "myuser"),
        password=overrides.pop("password", ""),
        remote_path=overrides.pop("remote_path", "/wine_app"),
        remote_images_path=overrides.pop("remote_images_path", "/wine_app/images"),
        remote_import_path=overrides.pop("remote_import_path", "/wine_app/data"),
        remote_editor_path=overrides.pop("remote_editor_path", "/wine_app/editor"),
    )
    editor = weinimport.EditorConfig(path="/editor", password_hash="")
    backup = overrides.pop("backup", None)
    defaults = dict(
        import_dir="./import",
        import_source="local",
        export_path="./export/data/wines.json",
        scaffold_mode=True,
        image_export_dir="./export/images",
        image_resize_mode="width",
        image_resize_px=1200,
    )
    defaults.update(overrides)
    return weinimport.Config(deploy=deploy, editor=editor, backup=backup, **defaults)


def default_schema():
    """Das reale wine-schema.json als SchemaField-Liste."""
    schema_path = SCRIPT_PATH.parents[1] / "wine-schema.json"
    raw = json.loads(schema_path.read_text(encoding="utf-8"))
    return [weinimport.SchemaField(**entry) for entry in raw]


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def make_jpeg(path: Path, size=(200, 100), exif_date: str | None = None) -> None:
    """Erzeugt ein JPEG, optional mit EXIF DateTimeOriginal ('YYYY:MM:DD HH:MM:SS')."""
    from PIL import Image

    img = Image.new("RGB", size, color=(120, 60, 30))
    if exif_date:
        import piexif

        exif_dict = {"Exif": {piexif.ExifIFD.DateTimeOriginal: exif_date.encode()}}
        exif_bytes = piexif.dump(exif_dict)
        img.save(path, format="JPEG", exif=exif_bytes)
    else:
        img.save(path, format="JPEG")
