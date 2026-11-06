"""Unit-Tests für Phase image-export."""

import os
import time

from PIL import Image

from conftest import make_config, make_jpeg, write_json
from conftest import weinimport as wi


def setup_import(tmp_path, size=(400, 200), image_name="wein.jpg"):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    make_jpeg(import_dir / image_name, size=size)
    write_json(import_dir / "wein.json", {"name": "Wein", "image": image_name})
    export_dir = tmp_path / "export" / "images"
    return import_dir, export_dir


def test_scales_width_mode(tmp_path):
    import_dir, export_dir = setup_import(tmp_path, size=(400, 200))
    config = make_config(
        import_dir=str(import_dir),
        image_export_dir=str(export_dir),
        image_resize_mode="width",
        image_resize_px=100,
    )
    wi.phase_image_export(config)
    with Image.open(export_dir / "wein.jpg") as img:
        assert img.width == 100
        assert img.height == 50


def test_scales_height_mode(tmp_path):
    import_dir, export_dir = setup_import(tmp_path, size=(400, 200))
    config = make_config(
        import_dir=str(import_dir),
        image_export_dir=str(export_dir),
        image_resize_mode="height",
        image_resize_px=50,
    )
    wi.phase_image_export(config)
    with Image.open(export_dir / "wein.jpg") as img:
        assert img.height == 50
        assert img.width == 100


def test_format_preserved(tmp_path):
    import_dir, export_dir = setup_import(tmp_path, image_name="wein.jpg")
    config = make_config(
        import_dir=str(import_dir),
        image_export_dir=str(export_dir),
        image_resize_px=100,
    )
    wi.phase_image_export(config)
    with Image.open(export_dir / "wein.jpg") as img:
        assert img.format == "JPEG"


def test_skip_when_copy_up_to_date(tmp_path):
    import_dir, export_dir = setup_import(tmp_path)
    config = make_config(
        import_dir=str(import_dir), image_export_dir=str(export_dir), image_resize_px=100
    )
    wi.phase_image_export(config)
    dst = export_dir / "wein.jpg"
    first_mtime = dst.stat().st_mtime
    # Kopie neuer machen als Original -> überspringen
    future = time.time() + 1000
    os.utime(dst, (future, future))
    wi.phase_image_export(config)
    assert dst.stat().st_mtime == future  # nicht neu geschrieben
    assert first_mtime != future


def test_reexport_when_original_newer(tmp_path):
    import_dir, export_dir = setup_import(tmp_path)
    config = make_config(
        import_dir=str(import_dir), image_export_dir=str(export_dir), image_resize_px=100
    )
    wi.phase_image_export(config)
    dst = export_dir / "wein.jpg"
    # Kopie künstlich älter machen als Original
    old = time.time() - 1000
    os.utime(dst, (old, old))
    wi.phase_image_export(config)
    assert dst.stat().st_mtime > old  # neu exportiert


def test_missing_image_warns_and_continues(tmp_path, capsys):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Wein", "image": "fehlt.jpg"})
    export_dir = tmp_path / "export" / "images"
    config = make_config(
        import_dir=str(import_dir), image_export_dir=str(export_dir), image_resize_px=100
    )
    wi.phase_image_export(config)
    err = capsys.readouterr().err
    # Keine pro-Bild-Warnung mehr, sondern eine Zusammenfassungszeile mit der
    # Zahl fehlender Quellen.
    assert "nicht gefunden" not in err
    assert "image-export:" in err
    assert "1 Quellen fehlten" in err


def test_no_per_image_skip_warnings_only_summary(tmp_path, capsys):
    """Bereits aktuelle Zielbilder werden still übersprungen – keine Zeile pro
    Bild, nur eine Zusammenfassung am Ende der Phase."""
    import_dir, export_dir = setup_import(tmp_path)
    config = make_config(
        import_dir=str(import_dir), image_export_dir=str(export_dir), image_resize_px=100
    )
    # Erster Lauf skaliert das Bild.
    wi.phase_image_export(config)
    capsys.readouterr()
    # Kopie neuer machen -> zweiter Lauf überspringt still.
    dst = export_dir / "wein.jpg"
    future = time.time() + 1000
    os.utime(dst, (future, future))

    wi.phase_image_export(config)
    err = capsys.readouterr().err
    assert "übersprungen" in err  # nur in der Zusammenfassung
    assert err.count("\n") == 1  # exakt eine Zeile (die Zusammenfassung)
    assert "image-export:" in err
    assert "1 bereits vorhanden übersprungen" in err


def test_original_unchanged(tmp_path):
    import_dir, export_dir = setup_import(tmp_path, size=(400, 200))
    src = import_dir / "wein.jpg"
    before = src.read_bytes()
    config = make_config(
        import_dir=str(import_dir), image_export_dir=str(export_dir), image_resize_px=100
    )
    wi.phase_image_export(config)
    assert src.read_bytes() == before
    with Image.open(src) as img:
        assert img.size == (400, 200)
