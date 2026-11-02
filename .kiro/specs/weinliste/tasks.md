# Implementation Plan: Weinsprechstunde

## Overview

Dieser Plan setzt die vier Subsysteme von „Weinsprechstunde" in einer inkrementellen Reihenfolge um: Zuerst die gemeinsame Grundlage (Projektstruktur + zentrale Konfigurationsdateien), dann das Python Import-Skript, das WordPress-Migrations-Skript, das Angular-Frontend und zuletzt die Wine-Editor-Web-App. Jede Aufgabe baut auf vorherigen auf und endet in integriertem, verdrahtetem Code.

Sprachen laut Design: **Python** (`scripts/`, `editor/`), **TypeScript/Angular** (`frontend/`), **Vanilla HTML/JS** (`editor/static/`).

Property-Tests: `hypothesis` (Python, pytest), `fast-check` (Angular, Jasmine). Jeder Property-Test ist mit Property-Nummer und validierten Requirements annotiert.

## Tasks

- [ ] 1. Gemeinsame Grundlage: Projektstruktur und zentrale Konfiguration
  - [ ] 1.1 Verzeichnisstruktur und zentrale Konfigurationsdateien anlegen
    - Ordnerstruktur erstellen: `scripts/`, `frontend/`, `editor/`, `export/images/`, `backup/`
    - `weinsprechstunde.config.json` im Projekt-Root mit allen Pflicht- und Optionalfeldern (`import_dir`, `import_source`, `export_path`, `scaffold_mode`, `image_export_dir`, `image_resize_mode`, `image_resize_px`, `deploy`-Objekt, `backup`-Objekt, `editor`-Objekt) anlegen
    - `wine-schema.json` im Projekt-Root mit allen 15 Feldern (name, year, country, origin, grape, type, producer, quality, price, rating, tasting_date, image, audio, video, description) gemäß Design anlegen
    - `.gitignore` um Secrets, `export/`, `backup/` ergänzen
    - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.12, 1.13, 1.14, 1.16, 17.1, 17.2_

- [ ] 2. Python Import-Skript: Datenmodelle, Config- und Schema-Laden
  - [ ] 2.1 `scripts/requirements.txt` und Datenmodelle erstellen
    - `scripts/requirements.txt` mit Pillow, piexif, paramiko, python-slugify, bcrypt, itsdangerous, pytest, hypothesis
    - Dataclasses in `scripts/weinimport.py`: `Wine`, `SchemaField`, `BackupConfig`, `DeployConfig`, `EditorConfig`, `Config`
    - _Requirements: 14.6, 1.2, 1.14, 1.16_

  - [ ] 2.2 Config- und Schema-Laden implementieren
    - `load_config()`: ConfigFile einlesen, bei fehlender Datei / ungültigem JSON mit lesbarer Fehlermeldung auf stderr abbrechen (exit 1)
    - `load_wine_schema()`: `wine-schema.json` einlesen, bei fehlender Datei abbrechen
    - `get_scaffold_fields()`: Feldliste aus Schema ableiten
    - argparse-Einstiegspunkt mit Phasen-Argumenten (kein Argument → backup→prepare→export→image-export)
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 17.3, 3.1, 4.1_

  - [ ]* 2.3 Unit-Tests für Config- und Schema-Laden
    - Fehlerfälle (fehlende Datei, ungültiges JSON), korrektes Parsen
    - _Requirements: 1.1, 1.3, 17.3_

  - [ ]* 2.4 Property-Test WineSchema-Roundtrip
    - **Property 18: WineSchema-Roundtrip**
    - **Validates: Requirements 17.1**
    - Tag: `# Feature: weinliste, Property 18: ...`

- [ ] 3. Python Import-Skript: Hilfsfunktionen
  - [ ] 3.1 Datei-Hilfsfunktionen implementieren
    - `collect_json_files()`: rekursive Erfassung aller `.json` in `import_dir`
    - `slugify_name()`, `find_image_sibling()`, `read_exif_date()` (piexif), `resolve_password()` (Config → Umgebungsvariable, Fehlermeldung bei Fehlen)
    - _Requirements: 2.2, 2.5, 2.6, 6.11, 13_

  - [ ]* 3.2 Property-Test rekursive Dateierfassung
    - **Property 1: Rekursive Dateierfassung**
    - **Validates: Requirements 2.2**
    - Tag: `# Feature: weinliste, Property 1: ...`

- [ ] 4. Python Import-Skript: Phase prepare
  - [ ] 4.1 `phase_prepare` und Scaffold-Logik implementieren
    - Auto-detect image, EXIF→tasting_date (nur wenn fehlend, bestehendes nie überschreiben)
    - `rename_file_group()`: Umbenennung JSON+Bild+Audio zu `YYYY-MM-DD-slug.json`, Felder aktualisieren, Zieldatei-Kollision überspringen mit Warnung
    - `apply_scaffold_mode()`: `true` → alle Schema-Felder mit null auffüllen (bestehende erhalten); `false` → null/leere Felder entfernen
    - Einträge ohne `name` überspringen mit Warnung; ohne `year` Umbenennung überspringen aber erhalten
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15_

  - [ ]* 4.2 Unit-Tests für Phase prepare (tmp_path)
    - EXIF-Auslesen, Auto-detect image, Umbenennung, Kollision, scaffold_mode true/false
    - _Requirements: 2.4, 2.5, 2.6, 2.8, 2.11, 2.14, 2.15_

  - [ ]* 4.3 Property-Test tasting_date wird nie überschrieben
    - **Property 3: `tasting_date` wird nie überschrieben**
    - **Validates: Requirements 2.7**
    - Tag: `# Feature: weinliste, Property 3: ...`

  - [ ]* 4.4 Property-Test scaffold_mode=true Vollständigkeit/Werterhaltung
    - **Property 4: `scaffold_mode=true` — Vollständigkeit und Werterhaltung**
    - **Validates: Requirements 2.14**
    - Tag: `# Feature: weinliste, Property 4: ...`

  - [ ]* 4.5 Property-Test scaffold_mode=false keine null/leeren Felder
    - **Property 5: `scaffold_mode=false` — Keine null/leeren Felder**
    - **Validates: Requirements 2.15**
    - Tag: `# Feature: weinliste, Property 5: ...`

- [ ] 5. Python Import-Skript: Phase export
  - [ ] 5.1 `phase_export` implementieren
    - Alle JSON lesen, Einträge ohne `name` überspringen mit Warnung
    - Unbekannte Felder unverändert übernehmen
    - Sortierung: absteigend nach `tasting_date`, Weine ohne Datum ans Ende
    - Valides JSON an `export_path` schreiben (Verzeichnis anlegen)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 5.2 Unit-Tests für Phase export (tmp_path)
    - Sortierung, Felderhaltung, Dateischreiben
    - _Requirements: 3.3, 3.5, 3.6_

  - [ ]* 5.3 Property-Test ungültige Einträge werden ausgeschlossen
    - **Property 2: Ungültige Einträge werden ausgeschlossen**
    - **Validates: Requirements 2.3, 3.3**
    - Tag: `# Feature: weinliste, Property 2: ...`

  - [ ]* 5.4 Property-Test Sortiertinvariante
    - **Property 6: Sortiertinvariante**
    - **Validates: Requirements 3.5**
    - Tag: `# Feature: weinliste, Property 6: ...`

  - [ ]* 5.5 Property-Test JSON-Roundtrip
    - **Property 7: JSON-Roundtrip**
    - **Validates: Requirements 3.6**
    - Tag: `# Feature: weinliste, Property 7: ...`

  - [ ]* 5.6 Property-Test unbekannte Felder werden bewahrt
    - **Property 8: Unbekannte Felder werden bewahrt**
    - **Validates: Requirements 3.4**
    - Tag: `# Feature: weinliste, Property 8: ...`

- [ ] 6. Python Import-Skript: Phase image-export
  - [ ] 6.1 `phase_image_export` implementieren
    - Referenzierte Bilder aus JSON ermitteln, fehlende mit Warnung überspringen
    - Skalierung per Pillow: `width`/`height`-Modus, Seitenverhältnis erhalten, Format beibehalten
    - Timestamp-Vergleich: Kopie überspringen wenn aktuell
    - Originale nicht verändern, Kopien in `image_export_dir`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [ ]* 6.2 Unit-Tests für Phase image-export (tmp_path)
    - Skalierung, Timestamp-Check, Formaterhalt, fehlendes Bild
    - _Requirements: 4.5, 4.6, 4.8, 4.9, 4.11_

  - [ ]* 6.3 Property-Test Bildskalierung erhält Seitenverhältnis
    - **Property 9: Bildskalierung erhält Seitenverhältnis**
    - **Validates: Requirements 4.7**
    - Tag: `# Feature: weinliste, Property 9: ...`

- [ ] 7. Python Import-Skript: Phase backup
  - [ ] 7.1 `phase_backup` und Rolling-Window-Logik implementieren
    - Last-Backup bei jedem Lauf (`last_YYYY-MM-DD_HH-MM-SS`), Rolling Window `max_last_backups`
    - Archival-Backup wenn `archival_interval_days` vergangen (`archival_*`), Rolling Window `max_archival_backups`
    - Zeitstempel in `backup/.last_archival` persistieren
    - `_prune_backups()`: ältesten Ordner löschen; Fehler → Warnung, Pipeline läuft weiter
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.8, 19.9_

  - [ ]* 7.2 Unit-Tests für Phase backup (tmp_path)
    - Rolling Window last/archival, Intervall-Prüfung, Fehlerbehandlung
    - _Requirements: 19.2, 19.3, 19.4, 19.6, 19.9_

  - [ ]* 7.3 Property-Test Last-Backup Rolling Window
    - **Property 20: Last-Backup Rolling Window**
    - **Validates: Requirements 19.2, 19.3**
    - Tag: `# Feature: weinliste, Property 20: ...`

  - [ ]* 7.4 Property-Test Archival-Backup Intervall-Invariante
    - **Property 21: Archival-Backup Intervall-Invariante**
    - **Validates: Requirements 19.4, 19.5**
    - Tag: `# Feature: weinliste, Property 21: ...`

- [ ] 8. Python Import-Skript: Phase deploy und Remote-Import-Download
  - [ ] 8.1 `phase_deploy` (SFTP/FTP) implementieren
    - SFTP (paramiko) und FTP (ftplib) Übertragung von dist-Ordner, `wines.json`, `image_export_dir`
    - Timestamp-Vergleich (SFTP `stat().st_mtime`, FTP `MDTM`), veraltete dist-Serverdateien löschen
    - `wines.json` und Bilder niemals auf Server löschen; Passwort via resolve_password
    - Präzise Fehlermeldungen bei Verbindungs-/Passwortfehlern (exit 1)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13_

  - [ ] 8.2 Remote-Import-Download implementieren
    - `download_remote_import()`: bei `import_source="remote"` `deploy.remote_import_path` vor prepare synchronisieren (SFTP/FTP)
    - Gleiche Verbindungsparameter/Passwort-Handling wie deploy
    - Fehler → lesbare Meldung mit Serverpfad + Server-Meldung, abbrechen (exit 1)
    - Remote-Backups (`backup.remote_backup_dir`) in `phase_backup` einbinden
    - _Requirements: 1.9, 1.10, 1.11, 19.7_

  - [ ]* 8.3 Unit-Tests für deploy und Remote-Download
    - Timestamp-Vergleich, selektives Löschen, Passwort-Fallback, Download-Fehlerbehandlung
    - _Requirements: 6.4, 6.5, 6.6, 6.11, 1.11_

- [ ] 9. Build-Pipeline und CI
  - [ ] 9.1 Makefile, prebuild und GitHub Actions erstellen
    - `Makefile` mit Targets für prepare, export, image-export (einzeln) und `deploy` (volle Pipeline inkl. `ng build`)
    - `frontend/package.json` `prebuild`-Script (prepare→export→image-export, Abbruch bei Fehler)
    - `.github/workflows/deploy.yml`: Push auf main → volle Pipeline, Secrets als Env-Variablen, Remote-Download wenn konfiguriert
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 10. Checkpoint - Import-Skript vollständig
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. WordPress-Migrations-Skript: SQL-Parsing und Datenmodelle
  - [ ] 11.1 `scripts/wordpress_migrate.py` Parsing-Grundlage
    - Dataclasses `ParsedDump`, `WinePost`, `MigrationReport`
    - `parse_sql_dump()` (regex `INSERT INTO`), `_split_value_tuples()`, `_parse_values()` (maskierte Quotes, NULL, Zahlen, Strings), `_strip_prefix()`
    - `select_primary_dump()` (meiste Wein-Posts), `merge_supplementary_tables()`
    - argparse mit `analyze` / `migrate`
    - _Requirements: 20.1, 20.2, 20.3_

  - [ ]* 11.2 Unit-Tests für SQL-Parsing (Fixtures)
    - INSERT-Statements, maskierte Quotes, NULL-Werte, Präfix-Strip, primäre Quelle
    - _Requirements: 20.2, 20.3_

- [ ] 12. WordPress-Migrations-Skript: ACF-Mapping und Bild-Zuordnung
  - [ ] 12.1 ACF-Mapping und Bildauflösung implementieren
    - `KNOWN_MAPPINGS`, `suggest_target()`, `suggest_action()` (`_`/`field_` → ignore)
    - `extract_wine_posts()`, `get_postmeta()`, `get_meta()`
    - `resolve_image()` (`_thumbnail_id` → Attachment → `_wp_attached_file`, Fallback Namensähnlichkeit), `pick_largest_variant()` (Original bevorzugen, sonst größte)
    - _Requirements: 20.5, 20.14, 20.15, 20.16_

  - [ ]* 12.2 Unit-Tests für ACF-Mapping und Bild-Varianten
    - Bekannte Keys, `_`/`field_` überspringen, unmapped, Bild-Varianten-Auswahl
    - _Requirements: 20.5, 20.16_

- [ ] 13. WordPress-Migrations-Skript: analyze und migrate
  - [ ] 13.1 Analyse-Schritt implementieren
    - `analyze()`: meta_keys mit Häufigkeit sammeln, `wordpress-mapping.json` mit Vorschlägen (target/action/_count) schreiben, KEINE Weindaten/Bilder
    - `print_analyze_report()`: primäre Quelle + Begründung, Feldliste mit Häufigkeit, Prüf-Hinweis
    - _Requirements: 20.3, 20.4, 20.5, 20.6, 20.7_

  - [ ] 13.2 Migrations-Schritt implementieren
    - `migrate()`: geprüfte Mapping-Datei lesen; Feld nicht in Mapping → Abbruch mit Feldname
    - action map→target, unmapped→`wp_unmapped_{key}`, ignore→verwerfen
    - JSON pro Wein schreiben (`name` Pflicht, `tasting_date` aus post_date), Bild zuordnen+kopieren
    - Alle restlichen Bilder übernehmen, `MigrationReport.print()`
    - _Requirements: 20.8, 20.9, 20.10, 20.11, 20.12, 20.13, 20.17, 20.18, 20.19, 20.20_

  - [ ]* 13.3 Property-Test Migration gemäß geprüfter Mapping-Datei
    - **Property 22: Migration — Verarbeitung gemäß geprüfter Mapping-Datei**
    - **Validates: Requirements 20.8, 20.9, 20.10, 20.11, 20.12**
    - Tag: `# Feature: weinliste, Property 22: ...`

- [ ] 14. Checkpoint - Migrations-Skript vollständig
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Angular Frontend: Projekt-Setup, Modelle und Datenservice
  - [ ] 15.1 Angular-Projekt und Datenmodelle anlegen
    - Angular-SPA mit TypeScript, Signals, reines SCSS, Light Mode, responsive
    - Modelle: `Wine` (mit `[key: string]: unknown`), `WineFilter`, `NavigationFilter`, `EMPTY_FILTER`, `SortOption`, `LoadState`, `WineSchemaField`, `FilterType`, `UserPreferences`
    - `wine-schema.json` als Asset nach `frontend/src/assets/` kopieren/symlinken
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.7_

  - [ ] 15.2 WineDataService implementieren
    - `wines`, `schema`, `loadState` Signals; `loadAll()` lädt `wines.json` + `wine-schema.json` parallel (forkJoin), Fehlerbehandlung
    - Keine Abhängigkeit zum ImportScript, einmaliges vollständiges Laden
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 17.4_

  - [ ]* 15.3 Unit-Tests für WineDataService
    - HTTP-States (loading/loaded/error), paralleles Laden
    - _Requirements: 7.3, 7.4_

- [ ] 16. Angular Frontend: UserPreferencesService
  - [ ] 16.1 UserPreferencesService implementieren
    - Cookie `ws_prefs` (kein Ablaufdatum), `load()`/`save()` für visibleFilters, sortOption, viewMode
    - Keine Filterwerte speichern; Defaults aus Schema `default_filter`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [ ]* 16.2 Property-Test UserPreferences Cookie-Roundtrip
    - **Property 19: UserPreferences Cookie-Roundtrip**
    - **Validates: Requirements 18.1, 18.2, 18.3**
    - Tag: `// Feature: weinliste, Property 19: ...`

- [ ] 17. Angular Frontend: FilterService und Filterlogik
  - [ ] 17.1 `applyFiltersAndSort` Pure-Funktion implementieren
    - Navigation-Filter (region/rebsorte per Slug), Freitextsuche (text-search-Felder, case-insensitiv), Dropdown, Range, Date-Range, Rating-Range mit AND-Logik
    - Sortierung tasting_date_desc/asc, rating_desc
    - _Requirements: 9.2, 9.12, 10.1_

  - [ ] 17.2 FilterService implementieren
    - Signals: filter, navigationFilter, sortOption, viewMode, infoToggleActive, visibleFilterFields
    - Computed: filteredWines, availableRegions/Grapes/Countries (mit Count), hasActiveFilter
    - Methoden: setNavigationFilter, clear*, setSortOption, setViewMode, toggleFilterField (+ prefs speichern)
    - Einzige Quelle der Wahrheit, Cookie-Init im Konstruktor
    - _Requirements: 7.6, 9.5, 9.6, 9.12, 9.13, 9.14, 14.10, 18.4, 18.5_

  - [ ]* 17.3 Unit-Tests für FilterService
    - Filterlogik, Cookie-Init, Regionen/Rebsorten-Berechnung mit Count
    - _Requirements: 8.5, 8.6, 9.12_

  - [ ]* 17.4 Property-Test Freitextsuche Vollständigkeit/Korrektheit
    - **Property 10: Freitextsuche — Vollständigkeit und Korrektheit**
    - **Validates: Requirements 9.2**
    - Tag: `// Feature: weinliste, Property 10: ...`

  - [ ]* 17.5 Property-Test kombinierte Filter AND-Logik
    - **Property 11: Kombinierte Filter — AND-Logik**
    - **Validates: Requirements 9.12**
    - Tag: `// Feature: weinliste, Property 11: ...`

- [ ] 18. Angular Frontend: Router, AppComponent und NavComponent
  - [ ] 18.1 Router und AppComponent implementieren
    - Routen `/`, `/region/:slug`, `/rebsorte/:slug` (alle WineWallComponent), Wildcard-Redirect
    - AppComponent: `app-nav`, `router-outlet`, Lade-/Fehleranzeige, WineDetailDialog global, `loadAll()` bei Init
    - Routenwechsel lösen keine HTTP-Requests aus
    - _Requirements: 7.7, 14.8, 14.9_

  - [ ] 18.2 NavComponent implementieren
    - NavBar: App-Name „Weinsprechstunde", Logo-Platzhalter links
    - Dropdowns „Regionen"/„Rebsorten" mit Count aus FilterService, Navigation zu Slug-Route, Menü schließen
    - Logo-Klick → Filter zurücksetzen, URL `/`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 14.8_

  - [ ] 18.3 WineWallComponent implementieren
    - Route-Parameter lesen, FilterService Navigation-Filter setzen/zurücksetzen ohne Datenladen
    - ControlsRow + WineGrid/WineList je nach viewMode einbinden
    - _Requirements: 7.7, 8.9, 14.8_

  - [ ]* 18.4 Unit-Tests für AppComponent und NavComponent
    - Lade-/Fehlerzustand, Regionen/Rebsorten-Rendering, Navigation
    - _Requirements: 7.3, 7.4, 8.5, 8.6_

- [ ] 19. Angular Frontend: ControlsRow und Filter-Komponenten
  - [ ] 19.1 ControlsRow + dynamische Filter-Komponenten implementieren
    - Freitextsuche; Standard-Filter (Grape multi-select, Rating rating-range Schritt 0.1, Verkostungsdatum date-range)
    - „Mehr Filter"-Button für weitere filterbare Felder (filter_type≠null), Ein-/Ausblenden + Cookie
    - FilterFieldComponent dynamisch je filter_type (multi-select, dropdown, range, date-range, rating-range 1.0–10.0)
    - SortControl, InfoToggle, ListToggle; alle an FilterService gebunden
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.13, 9.14, 9.15, 9.16, 9.17, 9.18, 9.19, 17.4, 18.6_

- [ ] 20. Angular Frontend: WineGrid, WineTile und Unterkomponenten
  - [ ] 20.1 WineGrid mit EndlessScroll und Zurück-Button implementieren
    - Responsive Kachelung, IntersectionObserver-EndlessScroll (PAGE_SIZE), Reset bei Filteränderung
    - BackButtonTile als erstes Element wenn `hasActiveFilter()`, Klick → Filter zurücksetzen + URL `/`
    - Hinweismeldung bei leeren Ergebnissen
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ] 20.2 WineTile, Cover, Overlay und PlayButton implementieren
    - WineTileCover mit PlaceholderIcon-Fallback
    - WineTileOverlay festes Template (year, name, producer, grape, rating-circle, origin), leere Felder ausblenden
    - Hover (Desktop) / Tap (Mobil) Overlay-Toggle, InfoToggle von außen erzwingt Overlay
    - PlayButton bei audio/video → öffnet Detail; Klick öffnet WineDetailDialog
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 13.1_

  - [ ]* 20.3 Unit-Tests für WineGrid und WineTile
    - EndlessScroll, Zurück-Button-Sichtbarkeit, Overlay-Toggle, Play-Button
    - _Requirements: 10.2, 10.4, 11.5, 11.9_

  - [ ]* 20.4 Property-Test InfoToggle wirkt auf alle Kacheln
    - **Property 12: InfoToggle wirkt auf alle Kacheln**
    - **Validates: Requirements 9.16**
    - Tag: `// Feature: weinliste, Property 12: ...`

  - [ ]* 20.5 Property-Test InfoToggle-Roundtrip
    - **Property 13: InfoToggle-Roundtrip**
    - **Validates: Requirements 9.17**
    - Tag: `// Feature: weinliste, Property 13: ...`

  - [ ]* 20.6 Property-Test Reihenfolge nach Filterung erhalten
    - **Property 14: Reihenfolge nach Filterung erhalten**
    - **Validates: Requirements 10.1**
    - Tag: `// Feature: weinliste, Property 14: ...`

  - [ ]* 20.7 Property-Test WineTileOverlay Datenvollständigkeit
    - **Property 15: WineTileOverlay — Datenvollständigkeit**
    - **Validates: Requirements 11.4**
    - Tag: `// Feature: weinliste, Property 15: ...`

- [ ] 21. Angular Frontend: WineList und WineListItem
  - [ ] 21.1 WineList mit EndlessScroll und Zurück-Button implementieren
    - Vertikale Liste von WineListItems (Name, Weingut, Jahr, Herkunftsland, Rating)
    - EndlessScroll, BackButtonItem bei aktivem Filter, leere-Ergebnis-Hinweis
    - Klick auf Item → WineDetailDialog
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 13.1_

- [ ] 22. Angular Frontend: WineDetailDialog
  - [ ] 22.1 WineDetailDialog implementieren
    - Feste Gruppenstruktur (Kopf, Herkunft, Weinprofil, Verkostung, Kaufinfo, Medien), leere Felder ausblenden
    - RatingCircle, AudioPlayer (wenn audio), VideoPlayer (wenn video)
    - Unbekannte Zusatzfelder am Ende (extraEntries)
    - Schließen-Button, Backdrop-Klick, Body-Scroll-Lock
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [ ]* 22.2 Unit-Tests für WineDetailDialog
    - close, Backdrop-Click, Body-Scroll-Lock, extraEntries
    - _Requirements: 13.6, 13.7, 13.8_

  - [ ]* 22.3 Property-Test WineDetailDialog Feldvollständigkeit
    - **Property 16: WineDetailDialog — Feldvollständigkeit**
    - **Validates: Requirements 13.2**
    - Tag: `// Feature: weinliste, Property 16: ...`

- [ ] 23. Checkpoint - Angular Frontend vollständig
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 24. Wine Editor: Passwort-Hashing und Auth-Grundlage
  - [ ] 24.1 `scripts/hash_password.py` und FastAPI-Auth implementieren
    - `hash_password.py`: bcrypt-Hash erzeugen und in `editor.password_hash` der ConfigFile schreiben
    - `editor/main.py`: FastAPI-App, Config laden, itsdangerous-Serializer
    - Rate-Limiter (in-memory, 5 Fehlversuche/10 min → 15 min Sperre), `check_rate_limit`, `record_failed_attempt`
    - `POST /api/auth/login` (bcrypt prüfen, generische Fehlermeldung), Session-Cookie (HttpOnly, Secure, SameSite=Strict, 30 Tage)
    - `require_auth`-Dependency, HTTP→HTTPS-Redirect
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12_

  - [ ]* 24.2 Unit-Tests für Auth und Rate-Limiter
    - richtiges/falsches Passwort, bcrypt, Fehlversuch-Zählung, Sperr-Fenster, generische Meldung
    - _Requirements: 15.5, 15.7, 15.8, 15.9_

- [ ] 25. Wine Editor: CRUD-API mit ETag-Konflikterkennung
  - [ ] 25.1 FastAPI CRUD- und Hilfs-Endpunkte implementieren
    - `GET /api/wines`, `GET/PUT/POST/DELETE /api/wines/{id}` (ETag + If-Match, 409 bei Konflikt)
    - `GET /api/images`, `/api/images/unassigned`, `/api/autocomplete/{field}`, `/api/schema`
    - Alle Endpunkte durch `require_auth` geschützt; Schreiben in `import_dir`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.6, 16.9, 16.10, 16.11, 16.13, 16.14, 16.15, 16.16, 15.10, 17.5_

  - [ ]* 25.2 Unit-Tests für CRUD-Endpunkte (httpx)
    - GET/PUT/POST/DELETE, Autocomplete, ImagePicker-Endpunkte, Schema-Endpunkt
    - _Requirements: 16.2, 16.3, 16.6, 16.10, 16.11_

  - [ ]* 25.3 Property-Test ETag-Konflikt-Erkennung
    - **Property 17: ETag-Konflikt-Erkennung**
    - **Validates: Requirements 16.16**
    - Tag: `# Feature: weinliste, Property 17: ...`

- [ ] 26. Wine Editor: Vanilla-JS Frontend
  - [ ] 26.1 Editor-Frontend implementieren
    - `editor/static/index.html` (Login + durchsuch-/sortierbare Weinliste)
    - `edit.html` + `app.js`: WineEditor-Formular dynamisch aus `wine-schema.json` (Autocomplete via datalist, Datepicker, rating 1.0–10.0 Schritt 0.1, textarea)
    - ImagePicker-Modal (unassigned default, Toggle alle, Freitextsuche, Auswahl → image-Feld)
    - Speichern explizit (If-Match ETag, Erfolg/Fehler, 409-Warnung), Löschen mit Bestätigung, Login-Redirect bei Session-Ablauf
    - _Requirements: 16.1, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13, 16.14, 16.15, 16.16, 17.5, 17.6_

- [ ] 27. Finaler Checkpoint - Alle Subsysteme
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Aufgaben mit `*` sind optionale Test-Sub-Tasks und können für ein schnelleres MVP übersprungen werden.
- Jede Aufgabe referenziert konkrete Requirements zur Nachverfolgbarkeit.
- Checkpoints sichern inkrementelle Validierung nach jedem Subsystem.
- Property-Tests (22 Stück) validieren universelle Korrektheitseigenschaften: Python/hypothesis (Props 1–9, 17, 18, 20–22), Angular/fast-check (Props 10–16, 19). Mindestens 100 Iterationen pro Property.
- Unit-Tests validieren konkrete Beispiele und Randfälle.
- Die vier Subsysteme sind laufzeitunabhängig; die gemeinsame Grundlage (Task 1) ist Voraussetzung für alle.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "11.1", "15.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "11.2", "12.1", "15.2", "16.1"] },
    { "id": 3, "tasks": ["3.1", "12.2", "13.1", "15.3", "16.2", "17.1", "24.1"] },
    { "id": 4, "tasks": ["3.2", "4.1", "13.2", "13.3", "17.2", "24.2", "25.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.4", "4.5", "5.1", "17.3", "17.4", "17.5", "25.2", "25.3"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "6.1", "18.1", "18.2", "26.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "7.1", "18.3", "18.4", "19.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "7.4", "8.1", "20.1", "20.2"] },
    { "id": 9, "tasks": ["8.2", "8.3", "20.3", "20.4", "20.5", "20.6", "20.7", "21.1", "22.1"] },
    { "id": 10, "tasks": ["9.1", "22.2", "22.3"] }
  ]
}
```
