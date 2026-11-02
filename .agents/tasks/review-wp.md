# Review: WordPress-Migrations-Skript (`scripts/wordpress_migrate.py`)

Geprüft gegen Requirement 20 (20.1–20.20), design.md Abschnitt „4. WordPress-Migrations-Skript",
Plan `.agents/tasks/wp-migrate-plan.md` und Property 22 aus `tasks.md`.

## Verifikations-Evidenz

Die Evidenz des Coders lag mir nicht als separates Dokument/Prior-Step-Output vor. Da ein
konkreter, benennbarer Zweifel bestand (post_type-Abweichung, siehe unten) und die realen Dumps
im Workspace vorhanden sind, habe ich einen eng begrenzten Spot-Check durchgeführt — keine
Vollsanierung der Review-Pflicht:

- `py_compile scripts/wordpress_migrate.py` → OK.
- `pytest scripts/tests/test_wordpress_migrate.py` + Property 22 → 29 passed, 0 failed.
- Gesamte Suite `pytest scripts/tests` → 88 passed.
- `git status`/`git log` für `scripts/weinimport.py` → keine uncommitted Änderungen; Referenzskript unangetastet.
- Spot-Check gegen reale Dumps: `post_type`-Verteilung + `analyze`-Pfad.

## Prüfpunkte (a)–(i)

(a) **Zwei-Schritt-Trennung (20.7):** `analyze()` sammelt meta_keys, schreibt ausschließlich
`wordpress-mapping.json` und ruft `print_analyze_report()`. Keine `write_json`/`copy_*`-Aufrufe im
analyze-Pfad. Test `TestAnalyze::test_analyze_writes_mapping_and_no_data` prüft explizit
`not import_dir.exists()`. Erfüllt.

(b) **Abbruch bei fehlendem Feld (20.9):** `migrate()` prüft pro meta_key `if key not in mapping`,
schreibt eine deutsche Fehlermeldung mit dem Feldnamen auf stderr und `sys.exit(1)`. Abgedeckt durch
`test_migrate_missing_field_aborts` und Property 22 (`drop_one`-Variante). Erfüllt.

(c) **map/unmapped/ignore-Semantik (20.5, 20.10–20.12):** `suggest_action` liefert `ignore` für
`_`-/`field_`-Präfix, `map` für `KNOWN_MAPPINGS`, sonst `unmapped`. `migrate()` setzt `map`→
`wine[target]`, `unmapped`→`wine[f"wp_unmapped_{key}"]`, `ignore`→verworfen. Tests `TestAcfMapping`
und `test_migrate_actions_applied` (inkl. `"zombi" not in data` und `"wp_unmapped_zombi" not in data`).
Erfüllt.

(d) **Bild-Varianten-Auswahl (20.16):** `pick_largest_variant` bereinigt den Stamm via
`SIZE_SUFFIX_RE` (`-WxH`/`-scaled`), bevorzugt die Original-Datei ohne Suffix, sonst `max(..., st_size)`.
Tests `test_pick_largest_prefers_original` und `test_pick_largest_without_original`. Erfüllt.

(e) **Alle Originale/größten Bilder übernehmen (20.18):** `copy_all_remaining_images` gruppiert nach
`(parent, bereinigter Stamm, suffix)`, kopiert je Gruppe genau eine Datei und überspringt bereits
zugeordnete (die in `already` aus dem import_dir-Scan erfasst sind), wodurch Doppelkopien vermieden
werden. `images_unassigned` zählt nur zusätzlich übernommene. Test
`test_copy_all_remaining_images_one_per_group`. Erfüllt.

(f) **Abschlussbericht (20.19):** `MigrationReport.print()` gibt primäre Quelle + Begründung, erkannte
Weine, erstellte JSON-Dateien, gemappte/unmapped/ignorierte Felder (Anzahl + Liste) sowie zugeordnete
und nicht zugeordnete (übernommene) Bilder aus. Vollständig gemäß Design-Abschnitt 7. Erfüllt.

(g) **prepare-Kompatibilität (20.20):** `name` ist Pflicht (Fallback `post.title`), `tasting_date` aus
`iso_date(post.date)` (erste 10 Zeichen, ISO-validiert). `write_json` schreibt UTF-8 mit
`ensure_ascii=False`. Integrationstest `test_migrate_result_compatible_with_prepare` lässt
`weinimport.phase_prepare` über das erzeugte import_dir laufen (keine Exception). Erfüllt.

(h) **Property 22 (20.8–20.12):** `test_property_22_migration_follows_mapping`,
`@settings(max_examples=100)`, korrekt getaggt. Invarianten: jeder map-Wert unter `target`, jeder
unmapped-Wert unter `wp_unmapped_{key}`, kein ignore-Wert im Objekt, und bei einem fehlenden
Mapping-Eintrag `SystemExit`. Deckt die Garantie „kein Datenverlust + Abbruch bei fehlendem Feld"
tatsächlich ab. Erfüllt.

(i) **Stil/Kompatibilität:** Deutsche stderr-Meldungen konsistent zu weinimport.py; `from __future__
import annotations` + `Optional`/`dict[...]`-Annotations → 3.12-kompatibel; PEP-8-konform (Zeilenumbrüche,
Benennung). `weinimport.py` unverändert (git bestätigt). Erfüllt.

## Dokumentierte Design-Abweichung (geprüft, akzeptiert)

Plan/Design nennen `spontansprechstunde` als `post_type`. Der Coder verwendet stattdessen
`WINE_POST_TYPE = "weinsprechstunde"` mit ausführlicher Begründung im Code-Kommentar. Gegen die realen
Dumps verifiziert:

- `post_type`-Verteilung in `kpmq9ui_sprechstunde.sql`: `weinsprechstunde` = 557 (passt exakt zu den im
  Design genannten „557 Datensätze"); `spontansprechstunde` kommt dort ausschließlich als meta_key mit
  Wert `'0'` vor (boolesches Flag), nicht als post_type.
- `analyze`-Spot-Check: primäre Quelle korrekt gewählt, 557 Wein-Posts erkannt, 32 Felder,
  `name`/`preis`→map, `auge`/`nase`/`mund`/`alkoholgehalt`→unmapped, `_name`→ignore.

Die Spec war an dieser Stelle in sich widersprüchlich (`spontansprechstunde` ist im Design selbst als
meta_key gelistet). Die Korrektur ist sachlich richtig und notwendig, damit die Migration auf den realen
Daten überhaupt Weine erkennt. Kein Blocker.

## Ergebnis

Alle Acceptance Criteria 20.1–20.20 sind erfüllt, Property 22 deckt die geforderte Garantie ab, Tests
grün (88 passed), `weinimport.py` unangetastet. Keine blockierenden Findings.

**Verdict: APPROVED**
