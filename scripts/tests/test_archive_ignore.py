"""Unit-Tests: der Ordner ``import_dir/_archive/`` wird im ImportScript in allen
Phasen (prepare, export, image-export) vollständig übersprungen (Req 17.51).

Zentral umgesetzt in ``collect_json_files`` – die drei Phasen sammeln ihre Dateien
ausschließlich darüber ein, deshalb genügt eine Stelle.
"""

import json

from conftest import default_schema, make_config, make_jpeg, write_json
from conftest import weinimport as wi


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# collect_json_files: zentrale Dateierfassung ignoriert _archive
# ---------------------------------------------------------------------------


def test_collect_json_files_skips_archive_dir(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "aktiv.json", {"name": "Aktiv"})
    write_json(import_dir / "_archive" / "alt.json", {"name": "Alt"})

    collected = {p.name for p in wi.collect_json_files(str(import_dir))}
    assert "aktiv.json" in collected
    assert "alt.json" not in collected


def test_collect_json_files_skips_nested_archive_path(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "aktiv.json", {"name": "Aktiv"})
    write_json(
        import_dir / "_archive" / "unterordner" / "tief.json", {"name": "Tief"}
    )

    collected = {p.name for p in wi.collect_json_files(str(import_dir))}
    assert "aktiv.json" in collected
    assert "tief.json" not in collected


def test_collect_json_files_keeps_non_archive_json(tmp_path):
    """Gleichnamige Datei außerhalb von _archive wird normal erfasst."""
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "unterordner" / "wein.json", {"name": "Außerhalb"})
    write_json(import_dir / "_archive" / "wein.json", {"name": "Im Archiv"})

    collected = [p for p in wi.collect_json_files(str(import_dir))]
    names = {p.name for p in collected}
    assert names == {"wein.json"}
    # Die erfasste Datei liegt NICHT im Archiv.
    assert all("_archive" not in p.parts for p in collected)


# ---------------------------------------------------------------------------
# Phase prepare ignoriert _archive
# ---------------------------------------------------------------------------


def test_prepare_ignores_archived_json(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "aktiv.json", {"name": "Aktiv"})
    make_jpeg(import_dir / "aktiv.jpg")

    archived = import_dir / "_archive" / "alt.json"
    write_json(archived, {"name": "Alt"})
    make_jpeg(import_dir / "_archive" / "alt.jpg")

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    # Aktive Datei wurde verarbeitet (Bild automatisch erkannt).
    assert read(import_dir / "aktiv.json")["image"] == "aktiv.jpg"
    # Archivierte Datei blieb unangetastet (kein auto-detektiertes Bild).
    assert "image" not in read(archived)


# ---------------------------------------------------------------------------
# Phase export ignoriert _archive
# ---------------------------------------------------------------------------


def test_export_excludes_archived_json(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "aktiv.json", {"name": "Aktiv"})
    write_json(import_dir / "_archive" / "alt.json", {"name": "Alt"})
    write_json(
        import_dir / "_archive" / "unterordner" / "tief.json", {"name": "Tief"}
    )

    export_path = tmp_path / "export" / "wines.json"
    config = make_config(import_dir=str(import_dir), export_path=str(export_path))
    wi.phase_export(config)

    wines = read(export_path)
    names = {w["name"] for w in wines}
    assert names == {"Aktiv"}


# ---------------------------------------------------------------------------
# Phase image-export ignoriert _archive
# ---------------------------------------------------------------------------


def test_image_export_skips_archived_images(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    (import_dir / "_archive" / "unterordner").mkdir(parents=True)
    # Aktiver Wein mit Bild.
    make_jpeg(import_dir / "aktiv.jpg", size=(400, 200))
    write_json(import_dir / "aktiv.json", {"name": "Aktiv", "image": "aktiv.jpg"})
    # Archivierter Wein mit gleichnamigem Bild + verschachteltes Archiv.
    make_jpeg(import_dir / "_archive" / "alt.jpg", size=(400, 200))
    write_json(
        import_dir / "_archive" / "alt.json", {"name": "Alt", "image": "alt.jpg"}
    )
    make_jpeg(import_dir / "_archive" / "unterordner" / "tief.jpg", size=(400, 200))
    write_json(
        import_dir / "_archive" / "unterordner" / "tief.json",
        {"name": "Tief", "image": "tief.jpg"},
    )

    export_dir = tmp_path / "export" / "images"
    config = make_config(
        import_dir=str(import_dir),
        image_export_dir=str(export_dir),
        image_resize_px=100,
    )
    wi.phase_image_export(config)

    assert (export_dir / "aktiv.jpg").exists()
    assert not (export_dir / "alt.jpg").exists()
    assert not (export_dir / "tief.jpg").exists()


def test_image_export_exports_same_named_image_outside_archive(tmp_path):
    """Ein gleichnamiges Bild außerhalb von _archive wird exportiert."""
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    (import_dir / "sub").mkdir()
    (import_dir / "_archive").mkdir()
    make_jpeg(import_dir / "sub" / "wein.jpg", size=(400, 200))
    write_json(import_dir / "sub" / "wein.json", {"name": "Außerhalb", "image": "wein.jpg"})
    make_jpeg(import_dir / "_archive" / "wein.jpg", size=(400, 200))
    write_json(import_dir / "_archive" / "wein.json", {"name": "Archiviert", "image": "wein.jpg"})

    export_dir = tmp_path / "export" / "images"
    config = make_config(
        import_dir=str(import_dir),
        image_export_dir=str(export_dir),
        image_resize_px=100,
    )
    wi.phase_image_export(config)

    assert (export_dir / "wein.jpg").exists()
