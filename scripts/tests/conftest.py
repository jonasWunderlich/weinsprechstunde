"""Gemeinsame Test-Fixtures und Helfer für die weinimport-Testsuite."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "weinimport.py"


def _load_weinimport():
    spec = importlib.util.spec_from_file_location("weinimport", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["weinimport"] = module
    spec.loader.exec_module(module)
    return module


weinimport = _load_weinimport()


@pytest.fixture
def wi():
    """Das geladene weinimport-Modul."""
    return weinimport


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
