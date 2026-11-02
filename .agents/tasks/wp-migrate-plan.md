# Implementation Plan: WordPress-Migrations-Skript (`scripts/wordpress_migrate.py`)

Setzt Tasks 11, 12, 13 und den Checkpoint-Task 14 aus `.kiro/specs/weinliste/tasks.md` um.
Maßgeblich ist der Pseudocode in `.kiro/specs/weinliste/design.md`, Abschnitt
„4. WordPress-Migrations-Skript", sowie Requirement 20 (20.1–20.20) in `requirements.md`.
Du planst/implementierst; du entscheidest keine Architektur neu.

## Design-Entscheidungen (kurz, mit Begründung)

Diese Punkte sind im Pseudocode nicht vollständig festgelegt. Je eine Entscheidung mit Begründung,
damit der Implementierer nichts offen lässt:

1. **Modulstruktur:** Eine einzige neue Datei `scripts/wordpress_migrate.py`, eigenständig,
   `weinimport.py` bleibt unangetastet. Begründung: Der Auftrag und Task 11 nennen diese Zieldatei
   explizit; `weinimport.py` ist fertig und dient nur als Stilreferenz.
2. **`slugify_name` wird dupliziert, nicht importiert.** `wordpress_migrate.py` definiert eine eigene
   `slugify_name()` (identische 2-Zeilen-Funktion wie in `weinimport.py`). Begründung: Das Skript soll
   eigenständig lauffähig sein; eine Importabhängigkeit auf `weinimport` würde dessen `argparse`/Config-Last
   mitziehen, ohne Mehrwert. Code bleibt Python-3.12-kompatibel wie `weinimport.py`.
3. **SQL-Parsing: wertweises Scannen statt naivem `;`-Split.** Der reale Dump enthält serialisierte
   PHP-Werte in `meta_value` mit eingebetteten Semikolons und maskierten Quotes
   (belegt: `(13, 12, '_menu_item_classes', 'a:1:{i:0;s:0:\"\";}')`). Der im Design skizzierte
   `INSERT_RE` mit nicht-gierigem `.*?;` endet sonst mitten in einer Zeile. Deshalb: `INSERT_RE` nur
   bis `VALUES` matchen (Tabelle + Spalten), dann den Rest ab `VALUES` **zeichenweise/quote-bewusst**
   in Tupel zerlegen (`_split_value_tuples`), die ein `;` oder `)` **innerhalb** eines Strings ignoriert.
   Begründung: korrekte Verarbeitung der realen Daten ist Property 22 (kein Datenverlust).
4. **Maskierungs-Regeln in `_parse_values`:** Unterstützt `\'`, `\"`, `\\`, `\n`, `\r`, `\t`, `\0`
   (mysqldump-Standard-Escapes); `NULL` (ohne Quotes) → `None`; reine Ganzzahl → `int`; Dezimalzahl → `float`;
   alles in Single-Quotes → `str`. Begründung: deckt alle im Dump vorkommenden Literale ab.
5. **`wine_post_count`** = Anzahl der `posts`-Zeilen mit `post_type == "spontansprechstunde"`.
   Begründung: design.md und reale Datenlage (558 solcher Posts im primären Dump, ~0 im `wp_wein`-Dump).
   Konstante `WINE_POST_TYPE = "spontansprechstunde"`.
6. **`rating`-Ableitung aus `fazit_*` wird NICHT automatisch gemappt.** `suggest_target` schlägt für
   `fazit_simon/tobias/wolfgang` kein `target` vor (→ `unmapped`). Begründung: design.md 20.5/Tabelle sagt
   „falls numerischer Wert extrahierbar → rating, sonst unmapped"; der kontrollierte Zwei-Schritt-Prozess
   überlässt diese Entscheidung bewusst dem Benutzer in der `wordpress-mapping.json`. `KNOWN_MAPPINGS`
   enthält nur die eindeutigen Direktzuordnungen `name→name`, `preis→price`.
7. **`copy_all_remaining_images`** gruppiert alle Uploads-Dateien nach Variantenstamm
   (`SIZE_SUFFIX_RE`-bereinigt), wählt pro Gruppe mit `pick_largest_variant` eine Datei und kopiert sie
   genau einmal nach `import_dir`; bereits beim Wein zugeordnete Dateien werden nicht doppelt gezählt.
   `images_unassigned` = übernommene Dateien ohne Wein-Zuordnung. Begründung: Req 20.18 verlangt ALLE
   Originale/größten Varianten, ohne Duplikate der schon kopierten.
8. **Testdaten sind Fixtures, nie die echten Dumps.** `migrate_wordpress/` und `import/` sind in
   `.gitignore` und auf dieser Maschine groß/vorhanden, aber nicht reproduzierbar. Alle Tests bauen kleine
   SQL-Snippets und temporäre Uploads-Ordner in `tmp_path`. Begründung: deterministische, CI-taugliche Tests.

## Vorab geprüfte Projektfakten

- Python-Interpreter/Tests: `.venv/bin/python -m pytest scripts/tests` (keine `pytest.ini`; `conftest.py`
  liegt in `scripts/tests` und wird per sys.path gefunden). Hypothesis und pytest sind in
  `scripts/requirements.txt` gepinnt (`pytest==9.2.0`, `hypothesis==6.170.14`).
- `conftest.py` lädt Module dynamisch per `importlib.util.spec_from_file_location`. Für das neue Skript
  wird derselbe Mechanismus genutzt (siehe Item 7).
- Reale Spalten (als Fixture-Vorlage): `wp_posts(ID, post_author, post_date, …, post_title, …, post_name,
  …, post_parent, …, post_type, post_mime_type, comment_count)`; `wp_postmeta(meta_id, post_id, meta_key,
  meta_value)`. Standard-Präfix `wp_`, zweiter Dump `wp_wein`.
- Abhängigkeiten: nur stdlib (`re`, `shutil`, `pathlib`, `dataclasses`, `argparse`, `collections`, `os`,
  `sys`, `json`) plus `python-slugify` (bereits in requirements.txt). `sqlparse` ist laut Design optional
  und wird NICHT eingeführt (regex/zeichenweises Parsen genügt).

---

# Implementation Plan

- [ ] 1. Modulgerüst, Konstanten und Dataclasses in `scripts/wordpress_migrate.py` anlegen.
      Datei mit Shebang + Modul-Docstring (Verweis auf design.md Abschnitt 4), `from __future__ import
      annotations`, Imports (stdlib + `slugify`). Konstanten `WINE_POST_TYPE = "spontansprechstunde"`,
      `MAPPING_PATH = "wordpress-mapping.json"`, `MIGRATE_DIR = "migrate_wordpress"`,
      `INSERT_RE`, `SIZE_SUFFIX_RE`, `KNOWN_MAPPINGS`. Dataclasses in dieser Reihenfolge:
      `WinePost` (Felder: `id: int`, `title: str`, `date: str`, plus `post_type: str`),
      `ParsedDump` (`path: Path`, `tables: dict[str, list[dict]]`, und `@property wine_post_count`
      = Anzahl `posts`-Zeilen mit `post_type == WINE_POST_TYPE`),
      `MigrationReport` (exakt wie design.md Abschnitt 7, inkl. `print()`). Lokale `slugify_name()` wie
      in weinimport.py. Deutsche Kommentare/Meldungen wie im Referenzskript.
      Files: scripts/wordpress_migrate.py
      Verify: `.venv/bin/python -c "import importlib.util,pathlib; s=importlib.util.spec_from_file_location('wpm','scripts/wordpress_migrate.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.WINE_POST_TYPE, m.MigrationReport)"`
      — Modul importiert fehlerfrei, gibt `spontansprechstunde` und die Dataclass aus.

- [ ] 2. SQL-Parsing implementieren: `_strip_prefix()`, `_parse_values()`, `_split_value_tuples()`,
      `parse_sql_dump()`. `_strip_prefix("wp_posts")→"posts"`, `_strip_prefix("wp_wein_posts")→"posts"`
      (zuerst `wp_wein_`, dann `wp_` entfernen). `_split_value_tuples(rows)` zerlegt die VALUES-Sektion
      **quote-bewusst** in `(...)`-Tupel: zählt Klammertiefe nur außerhalb von Strings, erkennt Stringende
      nur bei unmaskiertem `'`. `_parse_values(tuple_str)` liefert Python-Werte gemäß Design-Entscheidung 4
      (Escapes `\' \" \\ \n \r \t \0`, `NULL`→None, int/float/str). `parse_sql_dump()` nutzt `INSERT_RE`
      nur für Tabelle+Spalten, dann `_split_value_tuples` + `_parse_values` und baut
      `dict(zip(cols, values))` je Zeile; Rückgabe `ParsedDump`.
      Files: scripts/wordpress_migrate.py
      Verify: Items 7–8 (Unit-Tests `test_wordpress_migrate.py::Test...Parsing`) laufen grün —
      siehe `.venv/bin/python -m pytest scripts/tests/test_wordpress_migrate.py -q`.

- [ ] 3. Dump-Auswahl + Zusammenführung: `select_primary_dump()` und `merge_supplementary_tables()`
      exakt nach design.md Abschnitt 1. `select_primary_dump` = `max(dumps, key=lambda d: d.wine_post_count)`.
      `merge_supplementary_tables` hängt fehlende Zeilen (Dedup über `meta_id`/`object_id`) aus den
      Zusatz-Dumps an den primären an. In `analyze()`/`migrate()` wird nach `select_primary_dump` einmal
      `merge_supplementary_tables(primary, dumps)` aufgerufen.
      Files: scripts/wordpress_migrate.py
      Verify: Teil der Parsing-Unit-Tests (Item 8) — primäre Quelle = Dump mit mehr Wein-Posts;
      `.venv/bin/python -m pytest scripts/tests/test_wordpress_migrate.py -q` grün.

- [ ] 4. ACF-Mapping + Postmeta-Zugriff: `suggest_target()`, `suggest_action()`, `extract_wine_posts()`,
      `get_postmeta()`, `get_meta()`. `suggest_action`: `_`/`field_`-Präfix→`"ignore"`,
      key in `KNOWN_MAPPINGS`→`"map"`, sonst `"unmapped"`. `extract_wine_posts(dump)` filtert
      `dump.tables["posts"]` auf `post_type == WINE_POST_TYPE` und baut `WinePost(id, title=post_title,
      date=post_date, post_type)`. `get_postmeta(dump, post_id)` → `dict[meta_key→meta_value]` aus
      `dump.tables["postmeta"]`; `get_meta(dump, post_id, key)` → Einzelwert oder None.
      Files: scripts/wordpress_migrate.py
      Verify: Item 9 (`Test...Mapping`) grün: `.venv/bin/python -m pytest scripts/tests/test_wordpress_migrate.py -q`.

- [ ] 5. Bild-Zuordnung: `resolve_image()`, `pick_largest_variant()`, `_best_match_by_name()`,
      `copy_to_import()`, `copy_all_remaining_images()`. `resolve_image` nach design.md Abschnitt 4
      (`_thumbnail_id`→Attachment-`_wp_attached_file`→`uploads/<rel>`, Fallback Namensähnlichkeit via
      Slug). `_best_match_by_name` sucht rekursiv in uploads nach Datei, deren bereinigter Stamm den Slug
      enthält/am ähnlichsten ist (einfaches Substring-/difflib-Matching, deterministisch). `pick_largest_variant`
      exakt wie Design (Original ohne Suffix bevorzugen, sonst `max(..., getsize)`). `copy_to_import`
      kopiert mit `shutil.copy2` nach `import_dir` (flach, Zielname = Dateiname), legt `import_dir` an.
      `copy_all_remaining_images(uploads_dir, import_dir, report)` gemäß Design-Entscheidung 7
      (Gruppierung, je Gruppe eine Variante, keine Doppelkopien, `images_unassigned` zählen).
      Files: scripts/wordpress_migrate.py
      Verify: Item 10 (`Test...Images`) grün: `.venv/bin/python -m pytest scripts/tests/test_wordpress_migrate.py -q`.

- [ ] 6. `analyze()`, `print_analyze_report()`, `migrate()`, Hilfen `iso_date()`/`write_json()` und
      `argparse`-`main()`. `analyze()` nach design.md Abschnitt 5 (meta_keys mit Häufigkeit über
      `extract_wine_posts`/`get_postmeta` sammeln, `wordpress-mapping.json` mit `{target,action,_count}`
      absteigend nach Häufigkeit schreiben, KEINE Weindaten/Bilder, dann `print_analyze_report`).
      `print_analyze_report` gibt primäre Quelle + Begründung, volle Feldliste mit `_count` und den
      Prüfhinweis auf stdout aus (Req 20.3/20.6/20.7). `migrate()` nach design.md Abschnitt 6:
      geprüfte Mapping-Datei lesen; **jedes** vorkommende Feld, das fehlt → `sys.stderr` + `sys.exit(1)`
      mit Feldnamen (Req 20.9); `map`→`target`, `unmapped`→`wp_unmapped_{key}`, `ignore`→verwerfen;
      pro Wein `name` (Fallback `post.title`) Pflicht, `tasting_date` aus `iso_date(post.date)`; Bild
      zuordnen+kopieren (`image`-Feld); am Ende `copy_all_remaining_images`; `report.print()`.
      `write_json` schreibt pro Wein `import_dir/<slug>.json` (Kollisionen mit Zähler-Suffix vermeiden),
      kompatibel zur Phase `prepare` (nur `name` Pflicht, UTF-8, `ensure_ascii=False`).
      `main(argv)` mit Subcommands `analyze`/`migrate` + `--migrate-dir`/`--import-dir` Optionen
      (Defaults aus Konstanten bzw. `weinsprechstunde.config.json`-`import_dir` falls vorhanden,
      sonst `import`). `if __name__ == "__main__": main()`.
      Files: scripts/wordpress_migrate.py
      Verify: `.venv/bin/python scripts/wordpress_migrate.py --help` und `… analyze --help` zeigen beide
      Subcommands ohne Fehler; Items 9–11 grün.

- [ ] 7. Test-Infrastruktur: `scripts/tests/conftest.py` um einen Loader `wpm`/Modul-Fixture für
      `wordpress_migrate.py` erweitern (gleicher `importlib`-Mechanismus wie `_load_weinimport`), plus
      Helfer `make_sql_dump(tmp, name, posts=[...], postmeta=[(post_id,key,val)...])`, der eine kleine,
      syntaktisch echte `INSERT INTO`-Datei (inkl. mind. einer Zeile mit maskiertem Quote und einem
      serialisierten PHP-Wert mit eingebettetem `;`) schreibt, und `make_uploads(tmp, {rel:bytes})`.
      Bestehende `weinimport`-Fixtures NICHT verändern (nur additiv ergänzen).
      Files: scripts/tests/conftest.py
      Verify: `.venv/bin/python -m pytest scripts/tests -q` sammelt weiterhin alle bestehenden Tests
      (keine Importfehler): `.venv/bin/python -m pytest scripts/tests --co -q`.

- [ ] 8. Unit-Tests SQL-Parsing + Dump-Auswahl in `scripts/tests/test_wordpress_migrate.py` (Task 11.2).
      Fälle: mehrzeiliges `INSERT ... VALUES (...),(...);`; maskierte Quotes `\'` und `\"`; `NULL`→None;
      Int/Float/String-Literale; serialisierter PHP-Wert mit `;` innerhalb des Strings bleibt intakt;
      `_strip_prefix` für `wp_`/`wp_wein_`; `select_primary_dump` wählt Dump mit mehr `spontansprechstunde`-
      Posts; `merge_supplementary_tables` ergänzt fehlende postmeta-Zeilen ohne Duplikate.
      Files: scripts/tests/test_wordpress_migrate.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_wordpress_migrate.py -q` — alle Parsing-Tests grün.

- [ ] 9. Unit-Tests ACF-Mapping in `test_wordpress_migrate.py` (Task 12.2, Req 20.5).
      Fälle: `suggest_action` für bekannte Keys (`name`,`preis`→map), `_name`/`field_xxx`→ignore,
      `alkoholgehalt`→unmapped; `suggest_target` liefert `name`/`price` bzw. None;
      `extract_wine_posts` liefert nur `spontansprechstunde`-Posts; `get_postmeta`/`get_meta` korrekt.
      Files: scripts/tests/test_wordpress_migrate.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_wordpress_migrate.py -q` grün.

- [ ] 10. Unit-Tests Bild-Varianten + Zuordnung in `test_wordpress_migrate.py` (Task 12.2, Req 20.16).
      Fälle: `pick_largest_variant` bevorzugt `bild.jpg` vor `bild-150x150.jpg`/`bild-scaled.jpg`; ohne
      Original die größte Datei (`getsize`); `resolve_image` über `_thumbnail_id`→`_wp_attached_file`;
      Fallback über Namensähnlichkeit; `copy_all_remaining_images` kopiert jede Variantengruppe genau
      einmal und zählt `images_unassigned`.
      Files: scripts/tests/test_wordpress_migrate.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_wordpress_migrate.py -q` grün.

- [ ] 11. Unit-Tests `analyze`/`migrate`-Verhalten in `test_wordpress_migrate.py` (Task 13.1/13.2).
      Fälle: `analyze` schreibt `wordpress-mapping.json` mit `_count` und schreibt KEINE JSON/Bilder in
      `import_dir` (Req 20.7); `migrate` mit vollständigem Mapping erzeugt pro Wein eine JSON (`name`
      Pflicht, `tasting_date` aus post_date), `map`/`unmapped`/`ignore` wirken korrekt; fehlendes Feld in
      Mapping → `SystemExit` mit Feldname in stderr (Req 20.9); Ergebnis ist durch
      `weinimport.phase_prepare` verarbeitbar (Mini-Integration: prepare über das erzeugte import_dir
      laufen lassen, keine Exception). Alle Pfade über `tmp_path`, `monkeypatch.chdir` für die
      Mapping-Datei.
      Files: scripts/tests/test_wordpress_migrate.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_wordpress_migrate.py -q` grün.

- [ ] 12. Property-Test 22 in `scripts/tests/test_properties.py` ergänzen (Task 13.3, Req 20.8–20.12).
      `# Feature: weinliste, Property 22: Migration — Verarbeitung gemäß geprüfter Mapping-Datei`.
      `@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])`.
      Strategie erzeugt zufällige meta_key/value-Mengen + zufällige Mapping-Aktionen; Invarianten:
      jeder `map`-Wert landet unter `target`, jeder `unmapped`-Wert unter `wp_unmapped_{key}`, kein
      `ignore`-Wert erscheint, kein Nutzdatenwert geht verloren (map∪unmapped vollständig), und ein
      Feld ohne Mapping-Eintrag führt zu `SystemExit`. Nutzt den `wpm`-Loader aus conftest.
      Files: scripts/tests/test_properties.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_properties.py -k property_22 -q` — ≥100
      Iterationen grün.

- [ ] 13. Checkpoint (Task 14): gesamte Suite grün + statische Prüfung.
      Keine Code-Änderung außer Fixes, die die Verifikation aufdeckt.
      Files: (keine neuen)
      Verify: `.venv/bin/python -m pytest scripts/tests -q` — alle Tests (bestehende weinimport-Tests
      + neue wordpress_migrate-Tests + Property 22) grün; `.venv/bin/python -m py_compile
      scripts/wordpress_migrate.py` ohne Fehler; manuell `.venv/bin/python scripts/wordpress_migrate.py
      analyze --help` prüfen.

## Teststruktur / Fixtures (Zusammenfassung)

- `scripts/tests/conftest.py`: additiv `wpm`-Loader + `make_sql_dump()`/`make_uploads()`-Helfer.
- `scripts/tests/test_wordpress_migrate.py` (neu): Unit-Tests, gegliedert in Parsing (Item 8),
  Mapping (Item 9), Bilder (Item 10), analyze/migrate (Item 11).
- `scripts/tests/test_properties.py` (erweitert): Property 22 (Item 12).
- Alle Tests nutzen `tmp_path`/`monkeypatch`; echte Dumps unter `migrate_wordpress/` werden NICHT gelesen
  (gitignored, nicht reproduzierbar).

## Verifikations-Reihenfolge (gesamt)

1. Nach Item 1: Modul-Import-Smoke-Test.
2. Nach Items 2–6 inkrementell: `test_wordpress_migrate.py` schrittweise grün.
3. Nach Item 7: Gesamt-Collection bleibt intakt (`pytest --co`).
4. Nach Items 8–11: `pytest scripts/tests/test_wordpress_migrate.py` grün.
5. Nach Item 12: `pytest -k property_22` grün (≥100 Iterationen).
6. Item 13 (Checkpoint): `pytest scripts/tests` komplett grün + `py_compile`.

## Offene Punkte / Annahmen

- `_best_match_by_name`-Ähnlichkeitsmaß ist im Design nicht exakt spezifiziert. Annahme: deterministisches
  Substring-Matching mit `difflib.SequenceMatcher`-Score als Tiebreaker; nur Treffer über einem festen
  Schwellenwert gelten als Zuordnung, sonst gilt das Bild als nicht zugeordnet (fällt in Req 20.18).
- `tasting_date` aus `post_date`: `iso_date()` nimmt die ersten 10 Zeichen des mysqldump-Datums
  (`YYYY-MM-DD HH:MM:SS` → `YYYY-MM-DD`). Konsistent mit dem ISO-Format der Phase prepare.
- Der Checkpoint-Task 14 bittet laut tasks.md ggf. um Benutzer-Rückfrage; im Rahmen dieses Plans gilt er
  als erfüllt, sobald die Suite grün ist.
