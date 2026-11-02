"""Unit-Tests für das WordPress-Migrations-Skript (scripts/wordpress_migrate.py).

Deckt SQL-Parsing (inkl. maskierter Quotes/NULL/Zahlen), Präfix-Strip,
primäre-Quelle-Auswahl, Tabellen-Merge, ACF-Mapping, Bild-Varianten-Auswahl
und das analyze/migrate-Verhalten ab. Fixtures bauen kleine SQL-Snippets und
temporäre Uploads-Ordner; die echten Dumps werden nie gelesen.
"""

import json

import pytest

from conftest import make_sql_dump, make_uploads


# ---------------------------------------------------------------------------
# SQL-Parsing
# ---------------------------------------------------------------------------


class TestSqlParsing:
    def test_parse_simple_insert(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path,
            "d.sql",
            posts=[{"ID": 1, "post_title": "Riesling",
                    "post_type": "weinsprechstunde", "comment_count": 0}],
        )
        dump = wpm.parse_sql_dump(dump_path)
        assert "posts" in dump.tables
        row = dump.tables["posts"][0]
        assert row["ID"] == 1
        assert row["post_title"] == "Riesling"
        assert row["comment_count"] == 0

    def test_parse_null_value(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            postmeta=[(1, "note", None)],
        )
        dump = wpm.parse_sql_dump(dump_path)
        assert dump.tables["postmeta"][0]["meta_value"] is None

    def test_parse_escaped_single_quote(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            postmeta=[(1, "note", "Tobi's Wein")],
        )
        dump = wpm.parse_sql_dump(dump_path)
        assert dump.tables["postmeta"][0]["meta_value"] == "Tobi's Wein"

    def test_parse_escaped_double_quote(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            postmeta=[(1, "note", 'sagt "prost"')],
        )
        dump = wpm.parse_sql_dump(dump_path)
        assert dump.tables["postmeta"][0]["meta_value"] == 'sagt "prost"'

    def test_parse_int_and_float(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            postmeta=[(1, "preis", 6), (2, "alk", 12)],
        )
        dump = wpm.parse_sql_dump(dump_path)
        assert dump.tables["postmeta"][0]["meta_id"] == 1
        assert dump.tables["postmeta"][0]["post_id"] == 1

    def test_serialized_php_with_embedded_semicolon_intact(self, wpm, tmp_path):
        # Realer ACF-Serialisierungswert mit eingebettetem ';' und maskierten
        # Quotes darf nicht mitten im String getrennt werden.
        serialized = 'a:1:{i:0;s:0:"";}'
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            postmeta=[(1, "_menu_item_classes", serialized),
                      (2, "name", "Zweiter")],
        )
        dump = wpm.parse_sql_dump(dump_path)
        rows = dump.tables["postmeta"]
        assert rows[0]["meta_value"] == serialized
        assert rows[1]["meta_value"] == "Zweiter"

    def test_multi_row_insert(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            posts=[
                {"ID": 1, "post_type": "weinsprechstunde"},
                {"ID": 2, "post_type": "weinsprechstunde"},
                {"ID": 3, "post_type": "page"},
            ],
        )
        dump = wpm.parse_sql_dump(dump_path)
        assert len(dump.tables["posts"]) == 3

    def test_strip_prefix_standard(self, wpm):
        assert wpm._strip_prefix("wp_posts") == "posts"
        assert wpm._strip_prefix("wp_postmeta") == "postmeta"

    def test_strip_prefix_wein(self, wpm):
        assert wpm._strip_prefix("wp_weinposts") == "posts"
        assert wpm._strip_prefix("wp_weinpostmeta") == "postmeta"

    def test_wine_post_count(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            posts=[
                {"ID": 1, "post_type": "weinsprechstunde"},
                {"ID": 2, "post_type": "weinsprechstunde"},
                {"ID": 3, "post_type": "attachment"},
            ],
        )
        dump = wpm.parse_sql_dump(dump_path)
        assert dump.wine_post_count == 2


# ---------------------------------------------------------------------------
# Dump-Auswahl + Merge
# ---------------------------------------------------------------------------


class TestDumpSelection:
    def test_primary_dump_by_wine_count_not_size(self, wpm, tmp_path):
        few = make_sql_dump(
            tmp_path, "few.sql",
            posts=[{"ID": 1, "post_type": "weinsprechstunde"}],
        )
        many = make_sql_dump(
            tmp_path, "many.sql",
            posts=[
                {"ID": 1, "post_type": "weinsprechstunde"},
                {"ID": 2, "post_type": "weinsprechstunde"},
                {"ID": 3, "post_type": "weinsprechstunde"},
            ],
        )
        dumps = [wpm.parse_sql_dump(few), wpm.parse_sql_dump(many)]
        primary = wpm.select_primary_dump(dumps)
        assert primary.path.name == "many.sql"

    def test_merge_adds_missing_postmeta_without_duplicates(self, wpm, tmp_path):
        primary_path = make_sql_dump(
            tmp_path, "primary.sql",
            posts=[{"ID": 1, "post_type": "weinsprechstunde"}],
            postmeta=[(1, "name", "A")],
        )
        # Supplement hat meta_id 1 (Duplikat) + eine neue Zeile.
        supp_path = make_sql_dump(
            tmp_path, "supp.sql",
            postmeta=[(1, "name", "A"), (99, "preis", "6,99")],
        )
        primary = wpm.parse_sql_dump(primary_path)
        supp = wpm.parse_sql_dump(supp_path)
        # meta_ids kollidieren (beide starten bei 1) -> echte Dedup testen,
        # indem wir die supp-meta_id auf einen neuen Wert setzen.
        supp.tables["postmeta"][0]["meta_id"] = 1  # Duplikat zu primary
        supp.tables["postmeta"][1]["meta_id"] = 99  # neu
        wpm.merge_supplementary_tables(primary, [primary, supp])
        meta_ids = [r["meta_id"] for r in primary.tables["postmeta"]]
        assert meta_ids.count(1) == 1
        assert 99 in meta_ids


# ---------------------------------------------------------------------------
# ACF-Mapping
# ---------------------------------------------------------------------------


class TestAcfMapping:
    def test_suggest_action_known(self, wpm):
        assert wpm.suggest_action("name") == "map"
        assert wpm.suggest_action("preis") == "map"

    def test_suggest_action_ignore_prefixes(self, wpm):
        assert wpm.suggest_action("_name") == "ignore"
        assert wpm.suggest_action("_thumbnail_id") == "ignore"
        assert wpm.suggest_action("field_5cc1abc") == "ignore"

    def test_suggest_action_unmapped(self, wpm):
        assert wpm.suggest_action("alkoholgehalt") == "unmapped"
        assert wpm.suggest_action("auge") == "unmapped"
        assert wpm.suggest_action("fazit_simon") == "unmapped"

    def test_suggest_target(self, wpm):
        assert wpm.suggest_target("name") == "name"
        assert wpm.suggest_target("preis") == "price"
        assert wpm.suggest_target("alkoholgehalt") is None

    def test_extract_wine_posts_filters_type(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            posts=[
                {"ID": 1, "post_title": "Wein A", "post_date": "2021-05-01 10:00:00",
                 "post_type": "weinsprechstunde"},
                {"ID": 2, "post_title": "Seite", "post_type": "page"},
            ],
        )
        dump = wpm.parse_sql_dump(dump_path)
        posts = wpm.extract_wine_posts(dump)
        assert len(posts) == 1
        assert posts[0].title == "Wein A"
        assert posts[0].date == "2021-05-01 10:00:00"

    def test_get_postmeta_and_get_meta(self, wpm, tmp_path):
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            postmeta=[(1, "name", "A"), (1, "preis", "6,99"), (2, "name", "B")],
        )
        dump = wpm.parse_sql_dump(dump_path)
        meta = wpm.get_postmeta(dump, 1)
        assert meta == {"name": "A", "preis": "6,99"}
        assert wpm.get_meta(dump, 2, "name") == "B"
        assert wpm.get_meta(dump, 1, "missing") is None


# ---------------------------------------------------------------------------
# Bild-Varianten + Zuordnung
# ---------------------------------------------------------------------------


class TestImages:
    def test_pick_largest_prefers_original(self, wpm, tmp_path):
        uploads = make_uploads(tmp_path, {
            "bild.jpg": b"x" * 500,
            "bild-150x150.jpg": b"x" * 100,
            "bild-scaled.jpg": b"x" * 2000,
        })
        variant = uploads / "bild-150x150.jpg"
        chosen = wpm.pick_largest_variant(variant)
        assert chosen.name == "bild.jpg"

    def test_pick_largest_without_original(self, wpm, tmp_path):
        uploads = make_uploads(tmp_path, {
            "bild-150x150.jpg": b"x" * 100,
            "bild-768x1024.jpg": b"x" * 5000,
            "bild-scaled.jpg": b"x" * 2000,
        })
        variant = uploads / "bild-150x150.jpg"
        chosen = wpm.pick_largest_variant(variant)
        assert chosen.name == "bild-768x1024.jpg"

    def test_resolve_image_via_thumbnail_id(self, wpm, tmp_path):
        uploads = make_uploads(tmp_path, {"2021/05/wein.jpg": b"img"})
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            posts=[{"ID": 10, "post_title": "Wein",
                    "post_type": "weinsprechstunde"}],
            postmeta=[
                (10, "_thumbnail_id", 55),
                (55, "_wp_attached_file", "2021/05/wein.jpg"),
            ],
        )
        dump = wpm.parse_sql_dump(dump_path)
        post = wpm.extract_wine_posts(dump)[0]
        resolved = wpm.resolve_image(dump, post, uploads)
        assert resolved == uploads / "2021/05/wein.jpg"

    def test_resolve_image_fallback_by_name(self, wpm, tmp_path):
        uploads = make_uploads(tmp_path, {"2021/05/toller-riesling.jpg": b"img"})
        dump_path = make_sql_dump(
            tmp_path, "d.sql",
            posts=[{"ID": 10, "post_title": "Toller Riesling",
                    "post_type": "weinsprechstunde"}],
        )
        dump = wpm.parse_sql_dump(dump_path)
        post = wpm.extract_wine_posts(dump)[0]
        resolved = wpm.resolve_image(dump, post, uploads)
        assert resolved == uploads / "2021/05/toller-riesling.jpg"

    def test_copy_all_remaining_images_one_per_group(self, wpm, tmp_path):
        uploads = make_uploads(tmp_path, {
            "2021/bild.jpg": b"x" * 500,
            "2021/bild-150x150.jpg": b"x" * 100,
            "2021/bild-scaled.jpg": b"x" * 2000,
            "2021/andere.jpg": b"y" * 300,
        })
        import_dir = tmp_path / "import"
        report = wpm.MigrationReport()
        wpm.copy_all_remaining_images(uploads, str(import_dir), report)
        copied = sorted(p.name for p in import_dir.iterdir())
        assert copied == ["andere.jpg", "bild.jpg"]
        assert report.images_unassigned == 2


# ---------------------------------------------------------------------------
# analyze / migrate
# ---------------------------------------------------------------------------


class TestAnalyze:
    def test_analyze_writes_mapping_and_no_data(self, wpm, tmp_path, monkeypatch,
                                                capsys):
        migrate_dir = tmp_path / "migrate_wordpress"
        migrate_dir.mkdir()
        make_sql_dump(
            migrate_dir, "dump.sql",
            posts=[{"ID": 1, "post_title": "Wein",
                    "post_type": "weinsprechstunde"}],
            postmeta=[
                (1, "name", "Wein"),
                (1, "preis", "6,99"),
                (1, "auge", "klar"),
                (1, "_name", "field_abc"),
            ],
        )
        monkeypatch.chdir(tmp_path)
        wpm.analyze(migrate_dir=str(migrate_dir))

        mapping = json.loads((tmp_path / "wordpress-mapping.json").read_text())
        assert mapping["name"]["action"] == "map"
        assert mapping["name"]["target"] == "name"
        assert mapping["preis"]["action"] == "map"
        assert mapping["auge"]["action"] == "unmapped"
        assert mapping["_name"]["action"] == "ignore"
        assert mapping["name"]["_count"] == 1

        # Keine Weindaten-JSON / Bilder erzeugt (nur die Mapping-Datei).
        import_dir = tmp_path / "import"
        assert not import_dir.exists()

        out = capsys.readouterr().out
        assert "Primäre Datenquelle" in out
        assert "dump.sql" in out


class TestMigrate:
    def _setup(self, wpm, tmp_path, monkeypatch, mapping):
        migrate_dir = tmp_path / "migrate_wordpress"
        migrate_dir.mkdir()
        make_sql_dump(
            migrate_dir, "dump.sql",
            posts=[{"ID": 1, "post_title": "Fallback Name",
                    "post_date": "2021-05-01 10:00:00",
                    "post_type": "weinsprechstunde"}],
            postmeta=[
                (1, "name", "Echter Wein"),
                (1, "preis", "6,99"),
                (1, "auge", "klar"),
                (1, "zombi", "0"),
            ],
        )
        (migrate_dir / "uploads").mkdir()
        (tmp_path / "wordpress-mapping.json").write_text(
            json.dumps(mapping), encoding="utf-8"
        )
        monkeypatch.chdir(tmp_path)
        return migrate_dir

    def test_migrate_actions_applied(self, wpm, tmp_path, monkeypatch, capsys):
        mapping = {
            "name": {"target": "name", "action": "map", "_count": 1},
            "preis": {"target": "price", "action": "map", "_count": 1},
            "auge": {"target": None, "action": "unmapped", "_count": 1},
            "zombi": {"target": None, "action": "ignore", "_count": 1},
        }
        migrate_dir = self._setup(wpm, tmp_path, monkeypatch, mapping)
        import_dir = tmp_path / "import"
        wpm.migrate(migrate_dir=str(migrate_dir), import_dir=str(import_dir))

        files = list(import_dir.glob("*.json"))
        assert len(files) == 1
        data = json.loads(files[0].read_text())
        assert data["name"] == "Echter Wein"
        assert data["price"] == "6,99"
        assert data["wp_unmapped_auge"] == "klar"
        assert "zombi" not in data
        assert "wp_unmapped_zombi" not in data
        assert data["tasting_date"] == "2021-05-01"

    def test_migrate_skips_empty_and_zero_values(self, wpm, tmp_path, monkeypatch):
        # Werte "", nur Whitespace und "0" werden NICHT übernommen –
        # unabhängig davon ob das Feld auf map oder unmapped steht.
        migrate_dir = tmp_path / "migrate_wordpress"
        migrate_dir.mkdir()
        make_sql_dump(
            migrate_dir, "dump.sql",
            posts=[{"ID": 1, "post_title": "W",
                    "post_date": "2021-05-01 10:00:00",
                    "post_type": "weinsprechstunde"}],
            postmeta=[
                (1, "name", "Echter Wein"),
                (1, "preis", "0"),       # map, aber Platzhalter "0" -> weglassen
                (1, "auge", ""),         # unmapped, aber leer -> weglassen
                (1, "nase", "   "),      # unmapped, nur Whitespace -> weglassen
                (1, "mund", "klar"),     # unmapped, echter Wert -> behalten
            ],
        )
        (migrate_dir / "uploads").mkdir()
        mapping = {
            "name": {"target": "name", "action": "map", "_count": 1},
            "preis": {"target": "price", "action": "map", "_count": 1},
            "auge": {"target": None, "action": "unmapped", "_count": 1},
            "nase": {"target": None, "action": "unmapped", "_count": 1},
            "mund": {"target": None, "action": "unmapped", "_count": 1},
        }
        (tmp_path / "wordpress-mapping.json").write_text(
            json.dumps(mapping), encoding="utf-8"
        )
        monkeypatch.chdir(tmp_path)
        import_dir = tmp_path / "import"
        wpm.migrate(migrate_dir=str(migrate_dir), import_dir=str(import_dir))

        data = json.loads(next(import_dir.glob("*.json")).read_text())
        assert data["name"] == "Echter Wein"
        assert "price" not in data                 # "0" weggelassen
        assert "wp_unmapped_auge" not in data       # "" weggelassen
        assert "wp_unmapped_nase" not in data       # Whitespace weggelassen
        assert data["wp_unmapped_mund"] == "klar"   # echter Wert behalten

    def test_migrate_name_fallback_from_title(self, wpm, tmp_path, monkeypatch):
        mapping = {
            "name": {"target": "name", "action": "ignore", "_count": 1},
            "preis": {"target": "price", "action": "map", "_count": 1},
            "auge": {"target": None, "action": "unmapped", "_count": 1},
            "zombi": {"target": None, "action": "ignore", "_count": 1},
        }
        migrate_dir = self._setup(wpm, tmp_path, monkeypatch, mapping)
        import_dir = tmp_path / "import"
        wpm.migrate(migrate_dir=str(migrate_dir), import_dir=str(import_dir))
        data = json.loads(next(import_dir.glob("*.json")).read_text())
        assert data["name"] == "Fallback Name"

    def test_migrate_missing_field_aborts(self, wpm, tmp_path, monkeypatch, capsys):
        mapping = {
            "name": {"target": "name", "action": "map", "_count": 1},
            # preis/auge/zombi fehlen bewusst
        }
        migrate_dir = self._setup(wpm, tmp_path, monkeypatch, mapping)
        import_dir = tmp_path / "import"
        with pytest.raises(SystemExit) as exc:
            wpm.migrate(migrate_dir=str(migrate_dir), import_dir=str(import_dir))
        assert exc.value.code == 1
        err = capsys.readouterr().err
        assert "preis" in err or "auge" in err or "zombi" in err

    def test_migrate_result_compatible_with_prepare(self, wpm, wi, tmp_path,
                                                    monkeypatch):
        mapping = {
            "name": {"target": "name", "action": "map", "_count": 1},
            "preis": {"target": "price", "action": "map", "_count": 1},
            "auge": {"target": None, "action": "unmapped", "_count": 1},
            "zombi": {"target": None, "action": "ignore", "_count": 1},
        }
        migrate_dir = self._setup(wpm, tmp_path, monkeypatch, mapping)
        import_dir = tmp_path / "import"
        wpm.migrate(migrate_dir=str(migrate_dir), import_dir=str(import_dir))

        # Reguläre Phase prepare über das erzeugte import_dir laufen lassen.
        from conftest import make_config, default_schema

        config = make_config(import_dir=str(import_dir), scaffold_mode=False)
        wi.phase_prepare(config, default_schema())

        data = json.loads(next(import_dir.glob("*.json")).read_text())
        assert data["name"] == "Echter Wein"
