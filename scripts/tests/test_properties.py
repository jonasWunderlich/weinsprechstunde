"""Property-Based-Tests (hypothesis) für das weinimport-Skript.

Properties 1–9, 18, 20, 21 aus design.md „Correctness Properties".
Jede Property läuft mit mindestens 100 Iterationen (@settings(max_examples=100)).
"""

import itertools
import json
from datetime import datetime

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from conftest import default_schema, make_config, make_jpeg, write_json
from conftest import make_sql_dump
from conftest import weinimport as wi
from conftest import wordpress_migrate as wpm

# hypothesis ruft die Testfunktion mehrfach mit demselben function-scoped
# tmp_path auf. Für Phasen, die Dateien schreiben/umbenennen, braucht jede
# Iteration einen frischen Ordner, sonst leaken Dateien zwischen den Beispielen.
_counter = itertools.count()


def fresh_dir(tmp_path, name="import"):
    d = tmp_path / f"{name}_{next(_counter)}"
    d.mkdir(parents=True, exist_ok=True)
    return d

# Bausteine für Wine-Strategien
field_names = ["name", "year", "country", "origin", "grape", "type", "producer",
               "quality", "price", "rating", "image", "audio", "video", "description"]

text_values = st.text(min_size=0, max_size=20)
scalar_values = st.one_of(st.none(), st.text(max_size=10), st.integers(), st.floats(allow_nan=False, allow_infinity=False))


# ---------------------------------------------------------------------------
# Property 1: Rekursive Dateierfassung
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 1: Rekursive Dateierfassung
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(depths=st.lists(st.integers(min_value=0, max_value=6), min_size=1, max_size=15))
def test_property_1_recursive_collection(tmp_path, depths):
    import_dir = fresh_dir(tmp_path)
    expected = set()
    for i, depth in enumerate(depths):
        sub = import_dir
        for level in range(depth):
            sub = sub / f"lvl{level}"
        sub.mkdir(parents=True, exist_ok=True)
        f = sub / f"wein{i}.json"
        f.write_text("{}", encoding="utf-8")
        expected.add(f.resolve())

    collected = {p.resolve() for p in wi.collect_json_files(str(import_dir))}
    assert expected <= collected


# ---------------------------------------------------------------------------
# Property 2: Ungültige Einträge (ohne name) werden ausgeschlossen
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 2: Ungültige Einträge werden ausgeschlossen
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    named=st.lists(st.text(min_size=1, max_size=10), min_size=0, max_size=5),
    unnamed_count=st.integers(min_value=0, max_value=5),
)
def test_property_2_entries_without_name_excluded(tmp_path, named, unnamed_count):
    import_dir = fresh_dir(tmp_path)
    for i, name in enumerate(named):
        write_json(import_dir / f"named{i}.json", {"name": name})
    for j in range(unnamed_count):
        write_json(import_dir / f"unnamed{j}.json", {"year": 2000 + j})

    export_path = import_dir.parent / f"wines_{import_dir.name}.json"
    config = make_config(import_dir=str(import_dir), export_path=str(export_path))
    wi.phase_export(config)

    result = json.loads(export_path.read_text(encoding="utf-8"))
    assert all("name" in w for w in result)
    assert len(result) == len(named)


# ---------------------------------------------------------------------------
# Property 3: tasting_date wird nie überschrieben
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 3: tasting_date wird nie überschrieben
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    tasting_date=st.sampled_from(["2000-01-01", "2010-06-15", "2021-12-31"]),
    has_year=st.booleans(),
    exif_date=st.sampled_from(["2021:10:12 14:30:00", "1999:01:01 00:00:00"]),
)
def test_property_3_tasting_date_never_overwritten(tmp_path, tasting_date, has_year, exif_date):
    import_dir = fresh_dir(tmp_path)
    data = {"name": "Wein", "tasting_date": tasting_date, "image": "wein.jpg"}
    if has_year:
        data["year"] = 2019
    write_json(import_dir / "wein.json", data)
    make_jpeg(import_dir / "wein.jpg", exif_date=exif_date)

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, default_schema())

    # Datei kann umbenannt worden sein -> alle JSON einsammeln
    found = None
    for jf in wi.collect_json_files(str(import_dir)):
        found = json.loads(jf.read_text(encoding="utf-8"))
    assert found is not None
    assert found["tasting_date"] == tasting_date


# ---------------------------------------------------------------------------
# Property 4: scaffold_mode=true — Vollständigkeit + Werterhaltung
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 4: scaffold_mode=true Vollständigkeit und Werterhaltung
@settings(max_examples=100)
@given(
    present=st.dictionaries(
        keys=st.sampled_from([f for f in field_names if f != "name"]),
        values=st.one_of(st.text(min_size=1, max_size=10), st.integers(), st.floats(allow_nan=False, allow_infinity=False)),
        max_size=8,
    )
)
def test_property_4_scaffold_true_complete_and_preserving(present):
    schema = default_schema()
    data = {"name": "Wein"}
    data.update(present)
    original = dict(data)

    config = make_config(scaffold_mode=True)
    wi.apply_scaffold_mode(data, config, schema)

    # (1) alle Schema-Felder vorhanden
    for sf in schema:
        assert sf.field in data
    # (2) ursprüngliche Nicht-null-Werte unverändert
    for k, v in original.items():
        assert data[k] == v


# ---------------------------------------------------------------------------
# Property 5: scaffold_mode=false — keine null/leeren Felder
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 5: scaffold_mode=false keine null/leeren Felder
@settings(max_examples=100)
@given(
    data=st.dictionaries(
        keys=st.sampled_from(field_names),
        values=scalar_values,
        max_size=10,
    )
)
def test_property_5_scaffold_false_no_null_or_empty(data):
    data = dict(data)
    data["name"] = "Wein"  # Pflichtfeld für Realismus
    config = make_config(scaffold_mode=False)
    wi.apply_scaffold_mode(data, config, default_schema())
    for v in data.values():
        assert v is not None
        assert v != ""


# ---------------------------------------------------------------------------
# Property 6: Sortiertinvariante
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 6: Sortiertinvariante
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    dates=st.lists(
        st.one_of(st.none(), st.dates(min_value=datetime(1990, 1, 1).date(), max_value=datetime(2030, 1, 1).date())),
        min_size=0,
        max_size=12,
    )
)
def test_property_6_sort_invariant(tmp_path, dates):
    import_dir = fresh_dir(tmp_path)
    for i, d in enumerate(dates):
        w = {"name": f"W{i}"}
        if d is not None:
            w["tasting_date"] = d.isoformat()
        write_json(import_dir / f"w{i}.json", w)

    export_path = import_dir.parent / f"wines_{import_dir.name}.json"
    config = make_config(import_dir=str(import_dir), export_path=str(export_path))
    wi.phase_export(config)
    result = json.loads(export_path.read_text(encoding="utf-8"))

    dated = [w for w in result if w.get("tasting_date")]
    undated = [w for w in result if not w.get("tasting_date")]
    # alle datierten vor allen undatierten
    assert result[: len(dated)] == dated
    assert result[len(dated):] == undated
    # datierte absteigend
    ds = [w["tasting_date"] for w in dated]
    assert ds == sorted(ds, reverse=True)


# ---------------------------------------------------------------------------
# Property 7: JSON-Roundtrip
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 7: JSON-Roundtrip
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    wines=st.lists(
        st.fixed_dictionaries(
            {"name": st.text(min_size=1, max_size=15)},
            optional={
                "year": st.integers(min_value=1900, max_value=2100),
                "rating": st.floats(min_value=0, max_value=10, allow_nan=False),
                "grape": st.one_of(st.text(max_size=10), st.lists(st.text(max_size=8), max_size=4)),
                "origin": st.text(max_size=12),
            },
        ),
        min_size=1,
        max_size=8,
    )
)
def test_property_7_json_roundtrip(tmp_path, wines):
    import_dir = fresh_dir(tmp_path)
    for i, w in enumerate(wines):
        write_json(import_dir / f"w{i}.json", w)

    export_path = import_dir.parent / f"wines_{import_dir.name}.json"
    config = make_config(import_dir=str(import_dir), export_path=str(export_path))
    wi.phase_export(config)

    parsed = json.loads(export_path.read_text(encoding="utf-8"))
    # Reparsen ergibt dieselbe Struktur wie json-Serialisierung der Eingabe
    assert json.loads(json.dumps(parsed)) == parsed
    # Multiset der Weine bleibt erhalten (keine Datenverluste)
    assert sorted([json.dumps(w, sort_keys=True) for w in parsed]) == \
        sorted([json.dumps(w, sort_keys=True) for w in wines])


# ---------------------------------------------------------------------------
# Property 8: Unbekannte Felder werden bewahrt
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 8: Unbekannte Felder werden bewahrt
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    extra=st.dictionaries(
        keys=st.text(min_size=1, max_size=10).filter(lambda k: k not in field_names and k != "tasting_date"),
        values=st.one_of(st.text(max_size=10), st.integers(), st.lists(st.integers(), max_size=3)),
        min_size=1,
        max_size=5,
    )
)
def test_property_8_unknown_fields_preserved(tmp_path, extra):
    import_dir = fresh_dir(tmp_path)
    data = {"name": "Wein"}
    data.update(extra)
    write_json(import_dir / "w.json", data)

    export_path = import_dir.parent / f"wines_{import_dir.name}.json"
    config = make_config(import_dir=str(import_dir), export_path=str(export_path))
    wi.phase_export(config)

    result = json.loads(export_path.read_text(encoding="utf-8"))
    assert len(result) == 1
    for k, v in extra.items():
        assert result[0][k] == v


# ---------------------------------------------------------------------------
# Property 9: Bildskalierung erhält Seitenverhältnis
# ---------------------------------------------------------------------------

# Feature: weinliste, Property 9: Bildskalierung erhält Seitenverhältnis
#
# Hinweis zur Toleranz 0.01: Pillow skaliert auf ganzzahlige Pixelmaße. Die
# abgeleitete (kleinere) Zielseite wird dabei gerundet; die so erzielbare
# Ratio trägt daher eine Quantisierungsfehler von bis zu ±0,5 px. Die
# Design-Toleranz von 0,01 ist physikalisch nur erreichbar, wenn beide
# Ausgabeseiten groß genug sind. Wir generieren daher Eingaben, deren kleinere
# Ausgabeseite >= ~200 px bleibt (Seitenverhältnis <= 4:1, target_px >= 800).
# deadline=None: Pillow skaliert große Testbilder (bis 4000 px) echt und kann die
# hypothesis-Standard-Deadline (200 ms/Fall) überschreiten -- das ist reine
# Bildverarbeitungszeit, kein Logikfehler.
@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    long_side=st.integers(min_value=800, max_value=4000),
    ratio_num=st.integers(min_value=1, max_value=4),
    ratio_den=st.integers(min_value=1, max_value=4),
    width_is_long=st.booleans(),
    mode=st.sampled_from(["width", "height"]),
    target_px=st.integers(min_value=800, max_value=1600),
)
def test_property_9_aspect_ratio_preserved(
    tmp_path, long_side, ratio_num, ratio_den, width_is_long, mode, target_px
):
    from PIL import Image

    short_side = max(200, round(long_side * ratio_den / ratio_num))
    if width_is_long:
        width, height = long_side, short_side
    else:
        width, height = short_side, long_side

    import_dir = fresh_dir(tmp_path)
    make_jpeg(import_dir / "w.jpg", size=(width, height))
    write_json(import_dir / "w.json", {"name": "Wein", "image": "w.jpg"})

    export_dir = import_dir.parent / f"export_{import_dir.name}"
    config = make_config(
        import_dir=str(import_dir),
        image_export_dir=str(export_dir),
        image_resize_mode=mode,
        image_resize_px=target_px,
    )
    wi.phase_image_export(config)

    with Image.open(export_dir / "w.jpg") as img:
        out_w, out_h = img.size
    original_ratio = width / height
    output_ratio = out_w / out_h
    assert abs(original_ratio - output_ratio) <= 0.01


# ---------------------------------------------------------------------------
# Property 18: WineSchema-Roundtrip
# ---------------------------------------------------------------------------

filter_types = ["text-search", "range", "date-range", "dropdown", "rating-range", "multi-select", None]

# Feature: weinliste, Property 18: WineSchema-Roundtrip
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    entries=st.lists(
        st.fixed_dictionaries(
            {
                "field": st.text(min_size=1, max_size=12),
                "type": st.sampled_from(["text", "number", "date", "rating", "multi-value"]),
                "filter_type": st.sampled_from(filter_types),
                "default_filter": st.booleans(),
            }
        ),
        min_size=1,
        max_size=15,
    )
)
def test_property_18_schema_roundtrip(tmp_path, entries):
    schema_path = tmp_path / f"wine-schema_{next(_counter)}.json"
    schema_path.write_text(json.dumps(entries), encoding="utf-8")

    schema = wi.load_wine_schema(str(schema_path))
    serialized = [
        {
            "field": s.field,
            "type": s.type,
            "filter_type": s.filter_type,
            "default_filter": s.default_filter,
        }
        for s in schema
    ]
    assert serialized == entries


# ---------------------------------------------------------------------------
# Property 20 + 21: Backup Rolling Window / Archival-Intervall
# ---------------------------------------------------------------------------


class _Frozen(datetime):
    _now = datetime(2024, 1, 1, 12, 0, 0)

    @classmethod
    def now(cls, tz=None):
        return cls._now


# Feature: weinliste, Property 20: Last-Backup Rolling Window
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
@given(
    max_last=st.integers(min_value=1, max_value=6),
    runs=st.integers(min_value=1, max_value=12),
)
def test_property_20_last_rolling_window(tmp_path, monkeypatch, max_last, runs):
    import_dir = fresh_dir(tmp_path)
    write_json(import_dir / "w.json", {"name": "A"})
    backup_dir = import_dir.parent / f"backup_{import_dir.name}"

    backup = wi.BackupConfig(
        backup_dir=str(backup_dir),
        max_last_backups=max_last,
        max_archival_backups=100,
        archival_interval_days=0,
        remote_backup_dir=None,
    )
    config = make_config(import_dir=str(import_dir), backup=backup)

    monkeypatch.setattr(wi, "datetime", _Frozen)
    base = datetime(2024, 1, 1, 12, 0, 0)
    import datetime as _dt

    for i in range(runs):
        # eindeutige Timestamps erzwingen über ansteigende Sekunden
        _Frozen._now = base + _dt.timedelta(seconds=i)
        wi.phase_backup(config)
        count = len([d for d in backup_dir.iterdir() if d.is_dir() and d.name.startswith("last_")])
        assert count <= max_last


# Feature: weinliste, Property 21: Archival-Backup Intervall-Invariante
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
@given(
    interval_days=st.integers(min_value=1, max_value=60),
    offsets=st.lists(st.integers(min_value=0, max_value=200), min_size=1, max_size=8),
)
def test_property_21_archival_interval_invariant(tmp_path, monkeypatch, interval_days, offsets):
    import datetime as _dt

    import_dir = fresh_dir(tmp_path)
    write_json(import_dir / "w.json", {"name": "A"})
    backup_dir = import_dir.parent / f"backup_{import_dir.name}"

    backup = wi.BackupConfig(
        backup_dir=str(backup_dir),
        max_last_backups=1000,
        max_archival_backups=1000,
        archival_interval_days=interval_days,
        remote_backup_dir=None,
    )
    config = make_config(import_dir=str(import_dir), backup=backup)
    monkeypatch.setattr(wi, "datetime", _Frozen)

    base = datetime(2024, 1, 1, 12, 0, 0)
    archival_times = []
    for off in sorted(offsets):
        _Frozen._now = base + _dt.timedelta(days=off, seconds=off)
        before = _list_archival(backup_dir)
        wi.phase_backup(config)
        after = _list_archival(backup_dir)
        if len(after) > len(before):
            archival_times.append(_Frozen._now)

    # Abstand zwischen aufeinanderfolgenden Archival-Backups >= interval_days
    for earlier, later in zip(archival_times, archival_times[1:]):
        assert (later - earlier) >= _dt.timedelta(days=interval_days)


def _list_archival(backup_dir):
    if not backup_dir.exists():
        return []
    return sorted(d.name for d in backup_dir.iterdir() if d.is_dir() and d.name.startswith("archival_"))


# ---------------------------------------------------------------------------
# Property 23: Number-Feld-Normalisierung
# ---------------------------------------------------------------------------


def _decimal_places(value) -> int:
    """Anzahl der Nachkommastellen eines Floats anhand seiner Dezimaldarstellung."""
    text = repr(float(value))
    if "e" in text or "E" in text:
        # Exponentialschreibweise -> auf feste Notation umstellen
        text = f"{float(value):.20f}".rstrip("0")
    if "." not in text:
        return 0
    frac = text.split(".", 1)[1].rstrip("0")
    return len(frac)


# Feature: weinliste, Property 23: Number-Feld-Normalisierung
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    whole=st.integers(min_value=0, max_value=100000),
    frac=st.integers(min_value=0, max_value=999),
    use_comma=st.booleans(),
    field_name=st.sampled_from(["year", "rating", "price"]),
)
def test_property_23_number_normalization(tmp_path, whole, frac, use_comma, field_name):
    schema = default_schema()
    decimals = {f.field: f.decimals for f in schema if f.type == "number"}[field_name]

    sep = "," if use_comma else "."
    raw = f"{whole}{sep}{frac:03d}"

    import_dir = fresh_dir(tmp_path)
    write_json(import_dir / "w.json", {"name": "A", field_name: raw})

    config = make_config(import_dir=str(import_dir), scaffold_mode=False)
    wi.phase_prepare(config, schema)

    result = json.loads((import_dir / "w.json").read_text(encoding="utf-8"))[field_name]

    if decimals == 0:
        assert isinstance(result, int)
    else:
        assert isinstance(result, float)
        assert _decimal_places(result) <= decimals


# ---------------------------------------------------------------------------
# Property 22: Migration — Verarbeitung gemäß geprüfter Mapping-Datei
# ---------------------------------------------------------------------------

# meta_keys ohne '_'/'field_'-Präfix (reine Nutzdaten), damit die zufälligen
# Aktionen frei wählbar sind; Werte sind nicht-leere Strings.
_meta_key = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=8
).filter(lambda k: not k.startswith("field_"))
# Nicht-leere Werte: schließt "", reinen Whitespace und den Platzhalter "0"
# aus, da diese von migrate bewusst nicht übernommen werden (siehe eigener
# Leer-Wert-Test in test_wordpress_migrate.py).
_meta_value = st.text(min_size=1, max_size=15).filter(
    lambda v: v.strip() not in ("", "0")
)
_action = st.sampled_from(["map", "unmapped", "ignore"])


# Feature: weinliste, Property 22: Migration — jedes map-Feld landet unter
# target, jedes unmapped-Feld unter wp_unmapped_, kein ignore-Feld erscheint,
# und ein Feld ohne Mapping-Eintrag führt zum Abbruch (kein stilles Verwerfen).
@settings(max_examples=100,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    entries=st.dictionaries(_meta_key, st.tuples(_meta_value, _action),
                            min_size=1, max_size=8),
    drop_one=st.booleans(),
)
def test_property_22_migration_follows_mapping(tmp_path, entries, drop_one):
    migrate_dir = fresh_dir(tmp_path, "migrate_wordpress")
    import_dir = fresh_dir(tmp_path, "import")
    uploads = migrate_dir / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)

    # 'name' ist bei map ein echtes target; um Kollisionen mit dem Pflicht-name
    # zu vermeiden, verwenden wir für map-Felder generische Ziel-Feldnamen.
    postmeta = [(1, key, value) for key, (value, _action_) in entries.items()]
    make_sql_dump(
        migrate_dir, "dump.sql",
        posts=[{"ID": 1, "post_title": "Prop22 Wein",
                "post_date": "2021-05-01 10:00:00",
                "post_type": "weinsprechstunde"}],
        postmeta=postmeta,
    )

    mapping = {}
    for key, (_value, action) in entries.items():
        target = f"wp_target_{key}" if action == "map" else None
        mapping[key] = {"target": target, "action": action, "_count": 1}

    # Variante A: ein vorkommendes Feld fehlt im Mapping -> Abbruch erwartet.
    if drop_one and len(mapping) >= 1:
        dropped = sorted(mapping.keys())[0]
        del mapping[dropped]
        (tmp_path / "wordpress-mapping.json").write_text(
            json.dumps(mapping), encoding="utf-8"
        )
        import pytest
        with pytest.raises(SystemExit):
            # Mapping-Datei liegt in tmp_path; migrate liest relativ zum cwd.
            _run_migrate(tmp_path, migrate_dir, import_dir)
        return

    # Variante B: vollständiges Mapping -> Invarianten prüfen.
    (tmp_path / "wordpress-mapping.json").write_text(
        json.dumps(mapping), encoding="utf-8"
    )
    _run_migrate(tmp_path, migrate_dir, import_dir)

    files = list(import_dir.glob("*.json"))
    assert len(files) == 1
    data = json.loads(files[0].read_text(encoding="utf-8"))

    for key, (value, action) in entries.items():
        if action == "map":
            assert data[f"wp_target_{key}"] == value
        elif action == "unmapped":
            assert data[f"wp_unmapped_{key}"] == value
        else:  # ignore
            assert f"wp_unmapped_{key}" not in data
            assert key not in data


def _run_migrate(cwd, migrate_dir, import_dir):
    """migrate mit der Mapping-Datei in cwd ausführen (relativer MAPPING_PATH)."""
    import os

    prev = os.getcwd()
    os.chdir(cwd)
    try:
        wpm.migrate(migrate_dir=str(migrate_dir), import_dir=str(import_dir))
    finally:
        os.chdir(prev)
