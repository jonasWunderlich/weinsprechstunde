"""Unit-Tests für Phase prepare."""

import json

from conftest import default_schema, make_config, make_jpeg, write_json
from conftest import weinimport as wi


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_exif_read_sets_tasting_date(tmp_path):
    jpg = tmp_path / "wein.jpg"
    make_jpeg(jpg, exif_date="2021:10:12 14:30:00")
    assert wi.read_exif_date(jpg) == "2021-10-12"


def test_auto_detect_image_when_field_missing(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Wein A"})
    make_jpeg(import_dir / "wein.jpg")

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    data = read(import_dir / "wein.json")
    assert data["image"] == "wein.jpg"


def test_rename_renames_json_image_and_audio(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(
        import_dir / "orig.json",
        {
            "name": "Mein Wein",
            "year": 2019,
            "tasting_date": "2021-10-12",
            "image": "orig.jpg",
            "audio": "orig.mp3",
        },
    )
    make_jpeg(import_dir / "orig.jpg")
    (import_dir / "orig.mp3").write_bytes(b"audio")

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    new_json = import_dir / "2021-10-12-mein-wein.json"
    assert new_json.exists()
    assert not (import_dir / "orig.json").exists()
    assert (import_dir / "2021-10-12-mein-wein.jpg").exists()
    assert (import_dir / "2021-10-12-mein-wein.mp3").exists()
    data = read(new_json)
    assert data["image"] == "2021-10-12-mein-wein.jpg"
    assert data["audio"] == "2021-10-12-mein-wein.mp3"


def test_rename_collision_skips_with_warning(tmp_path, capsys):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    # Zieldatei existiert bereits
    write_json(import_dir / "2021-10-12-mein-wein.json", {"name": "Existing", "year": 2000})
    write_json(
        import_dir / "orig.json",
        {"name": "Mein Wein", "year": 2019, "tasting_date": "2021-10-12"},
    )

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    err = capsys.readouterr().err
    assert "existiert bereits" in err
    # Originaldatei bleibt erhalten
    assert (import_dir / "orig.json").exists()


def test_rename_without_year_only_tasting_date(tmp_path):
    # tasting_date genügt für die Umbenennung – ein 'year'-Feld ist nicht nötig.
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Ohne Jahr", "tasting_date": "2021-10-12"})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    assert (import_dir / "2021-10-12-ohne-jahr.json").exists()
    assert not (import_dir / "wein.json").exists()


def test_missing_tasting_date_skips_rename_keeps_file(tmp_path, capsys):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Ohne Datum", "year": 2019})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    assert (import_dir / "wein.json").exists()
    assert "kein 'tasting_date'" in capsys.readouterr().err


def test_rename_keeps_file_in_subfolder(tmp_path):
    # Die Verzeichnisstruktur bleibt erhalten: Datei wird im Unterordner umbenannt.
    import_dir = tmp_path / "import"
    sub = import_dir / "2021" / "oktober"
    sub.mkdir(parents=True)
    write_json(sub / "wein.json", {"name": "Im Unterordner", "tasting_date": "2021-10-12"})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    assert (sub / "2021-10-12-im-unterordner.json").exists()
    assert not (sub / "wein.json").exists()


def test_missing_name_skips_with_warning(tmp_path, capsys):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"year": 2019})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    assert "kein 'name'" in capsys.readouterr().err


def test_scaffold_true_fills_all_fields(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Wein", "rating": 7.5})

    config = make_config(import_dir=str(import_dir), scaffold_mode=True)
    schema = default_schema()
    wi.phase_prepare(config, schema)

    data = read(import_dir / "wein.json")
    for sf in schema:
        assert sf.field in data
    assert data["rating"] == 7.5  # bestehender Wert bleibt


def test_scaffold_false_removes_null_and_empty(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(
        import_dir / "wein.json",
        {"name": "Wein", "year": 2019, "quality": "", "producer": None, "rating": 7},
    )

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    data = read(import_dir / "wein.json")
    assert "quality" not in data
    assert "producer" not in data
    assert data["rating"] == 7


def test_normalize_number_year_string_to_int(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Wein", "year": "2017"})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    data = read(import_dir / "wein.json")
    assert data["year"] == 2017
    assert isinstance(data["year"], int)


def test_normalize_number_rating_string_to_float_one_decimal(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Wein", "year": 2019, "rating": "6"})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    data = read(import_dir / "wein.json")
    assert data["rating"] == 6.0
    assert isinstance(data["rating"], float)


def test_normalize_number_price_comma_to_float_two_decimals(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Wein", "year": 2019, "price": "6,99"})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    data = read(import_dir / "wein.json")
    assert data["price"] == 6.99
    assert isinstance(data["price"], float)


def test_normalize_number_unparsable_keeps_value_and_warns(tmp_path, capsys):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(
        import_dir / "wein.json",
        {"name": "Wein", "year": 2019, "price": "auf Anfrage"},
    )

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    data = read(import_dir / "wein.json")
    assert data["price"] == "auf Anfrage"
    err = capsys.readouterr().err
    assert "price" in err
    assert "auf Anfrage" in err


def test_normalize_number_already_numeric_rounded_to_decimals(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Wein", "year": 2019, "price": 42})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    data = read(import_dir / "wein.json")
    assert data["price"] == 42.0
    assert isinstance(data["price"], float)


def test_normalize_number_missing_decimals_leaves_value_unchanged(tmp_path):
    # Robustheit: number-Feld ohne decimals-Angabe -> Wert unverändert.
    schema = [
        wi.SchemaField(field="name", type="text", filter_type="text-search",
                       default_filter=True),
        wi.SchemaField(field="score", type="number", filter_type="range",
                       default_filter=False),
    ]
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "wein.json", {"name": "Wein", "score": "7.345"})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, schema)

    data = read(import_dir / "wein.json")
    assert data["score"] == 7.345


def test_existing_tasting_date_not_overwritten(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(
        import_dir / "wein.json",
        {"name": "Wein", "year": 2019, "tasting_date": "2000-01-01", "image": "wein.jpg"},
    )
    make_jpeg(import_dir / "wein.jpg", exif_date="2021:10:12 14:30:00")

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    # Datei wurde umbenannt, aber tasting_date unverändert.
    data = read(import_dir / "2000-01-01-wein.json")
    assert data["tasting_date"] == "2000-01-01"
