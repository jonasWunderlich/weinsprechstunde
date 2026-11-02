"""Unit-Tests für Phase export."""

import json

from conftest import make_config, write_json
from conftest import weinimport as wi


def run_export(tmp_path, wines):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    for i, w in enumerate(wines):
        write_json(import_dir / f"w{i}.json", w)
    export_path = tmp_path / "out" / "wines.json"
    config = make_config(import_dir=str(import_dir), export_path=str(export_path))
    wi.phase_export(config)
    return json.loads(export_path.read_text(encoding="utf-8"))


def test_sort_descending_dates_undated_last(tmp_path):
    result = run_export(
        tmp_path,
        [
            {"name": "A", "tasting_date": "2020-01-01"},
            {"name": "B"},
            {"name": "C", "tasting_date": "2022-05-05"},
            {"name": "D", "tasting_date": "2021-03-03"},
        ],
    )
    names = [w["name"] for w in result]
    assert names == ["C", "D", "A", "B"]


def test_skip_entries_without_name(tmp_path, capsys):
    result = run_export(
        tmp_path,
        [{"name": "A", "tasting_date": "2020-01-01"}, {"year": 2019}],
    )
    assert len(result) == 1
    assert "kein 'name'" in capsys.readouterr().err


def test_unknown_fields_preserved(tmp_path):
    result = run_export(
        tmp_path,
        [{"name": "A", "custom_field": "foo", "another": [1, 2, 3]}],
    )
    assert result[0]["custom_field"] == "foo"
    assert result[0]["another"] == [1, 2, 3]


def test_output_is_valid_json_with_unicode(tmp_path):
    result = run_export(tmp_path, [{"name": "Grosses Gewächs", "origin": "Rhône"}])
    assert result[0]["name"] == "Grosses Gewächs"
    assert result[0]["origin"] == "Rhône"


def test_export_creates_parent_dirs(tmp_path):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    write_json(import_dir / "w.json", {"name": "A"})
    export_path = tmp_path / "deep" / "nested" / "wines.json"
    config = make_config(import_dir=str(import_dir), export_path=str(export_path))
    wi.phase_export(config)
    assert export_path.exists()
