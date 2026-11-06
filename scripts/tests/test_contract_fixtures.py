"""Golden-Fixture-Test (Verträge import-format/editor-output -> export-format).

Die Fixture-Importdateien unter .kiro/specs/contracts/fixtures/import/ müssen durch
prepare + export exakt die Fixture fixtures/export/wines.json ergeben.
"""
import json
import shutil
from pathlib import Path

from conftest import make_config
from conftest import weinimport as wi

SCHEMA = Path(__file__).resolve().parents[2] / "wine-schema.json"
FIXTURES = Path(__file__).resolve().parents[2] / ".kiro" / "specs" / "contracts" / "fixtures"


def test_import_fixture_ergibt_export_fixture(tmp_path):
    import_dir = tmp_path / "import"
    shutil.copytree(FIXTURES / "import", import_dir)
    export_path = tmp_path / "out" / "wines.json"
    config = make_config(
        import_dir=str(import_dir), export_path=str(export_path), scaffold_mode=True
    )

    wi.phase_prepare(config, wi.load_wine_schema(str(SCHEMA)))
    wi.phase_export(config)

    actual = json.loads(export_path.read_text(encoding="utf-8"))
    expected = json.loads((FIXTURES / "export" / "wines.json").read_text(encoding="utf-8"))
    assert actual == expected
