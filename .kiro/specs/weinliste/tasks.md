# Implementation Plan: Weinsprechstunde

## Overview

Dieser Plan setzt die Subsysteme von „Weinsprechstunde" in einer inkrementellen Reihenfolge um: Zuerst die gemeinsame Grundlage (Projektstruktur + zentrale Konfigurationsdateien), dann das Python Import-Skript, das öffentliche Angular-Frontend und zuletzt den Angular-Workspace-Umbau samt der reinen Browser-Editor-App. Jede Aufgabe baut auf vorherigen auf und endet in integriertem, verdrahtetem Code.

Sprachen laut Design: **Python** (`scripts/`) und **TypeScript/Angular** (`frontend/` als Angular-Workspace mit den Projekten `projects/shared`, `projects/weinliste` und `projects/editor`). Es gibt **kein** Editor-Python-Backend und **kein** `editor/static/` — der Editor ist eine reine Angular-Browser-App ohne Backend, die direkt im Browser über die File System Access API auf den `import_dir` zugreift.

Property-Tests: `hypothesis` (Python, pytest), `fast-check` (Angular, vitest + jsdom). Jeder Property-Test ist mit Property-Nummer und validierten Requirements annotiert.

## Tasks

- [x] 1. Gemeinsame Grundlage: Projektstruktur und zentrale Konfiguration
  - [x] 1.1 Verzeichnisstruktur und zentrale Konfigurationsdateien anlegen
    - Ordnerstruktur erstellen: `scripts/`, `frontend/`, `export/images/`, `backup/`
    - `weinsprechstunde.config.json` im Projekt-Root mit allen Pflicht- und Optionalfeldern (`import_dir`, `import_source`, `export_path`, `scaffold_mode`, `image_export_dir`, `image_resize_mode`, `image_resize_px`, `deploy`-Objekt, `backup`-Objekt) anlegen — KEIN `editor`-Objekt (`editor.path`/`editor.password_hash` entfallen, da die Editor-App ohne Backend und ohne Passwort auskommt)
    - `wine-schema.json` im Projekt-Root mit allen 15 Feldern (name, year, country, origin, grape, type, producer, quality, price, rating, tasting_date, image, audio, video, description) gemäß Design anlegen
    - `.gitignore` um Secrets, `export/`, `backup/` ergänzen
    - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.12, 1.13, 1.14, 1.16, 16.4, 18.1, 18.2_

- [x] 2. Python Import-Skript: Datenmodelle, Config- und Schema-Laden
  - [x] 2.1 `scripts/requirements.txt` und Datenmodelle erstellen
    - `scripts/requirements.txt` mit Pillow, piexif, python-slugify, pytest, hypothesis (KEIN `paramiko` — Deploy nutzt `ftplib`/`ssl` (FTPES); KEIN `bcrypt`/`itsdangerous` — die Editor-App hat kein Backend mehr)
    - Dataclasses in `scripts/weinimport.py`: `Wine`, `SchemaField`, `BackupConfig`, `DeployConfig`, `Config` (KEINE `EditorConfig` — das `editor`-Objekt entfällt)
    - _Requirements: 15.6, 1.2, 1.14, 1.16, 16.4_

  - [x] 2.2 Config- und Schema-Laden implementieren
    - `load_config()`: ConfigFile einlesen, bei fehlender Datei / ungültigem JSON mit lesbarer Fehlermeldung auf stderr abbrechen (exit 1)
    - `load_wine_schema()`: `wine-schema.json` einlesen, bei fehlender Datei abbrechen
    - `get_scaffold_fields()`: Feldliste aus Schema ableiten
    - argparse-Einstiegspunkt mit Phasen-Argumenten (kein Argument → backup→prepare→export→image-export)
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 18.3, 3.1, 4.1_

  - [x]* 2.3 Unit-Tests für Config- und Schema-Laden
    - Fehlerfälle (fehlende Datei, ungültiges JSON), korrektes Parsen
    - _Requirements: 1.1, 1.3, 18.3_

  - [x]* 2.4 Property-Test WineSchema-Roundtrip
    - **Property 18: WineSchema-Roundtrip**
    - **Validates: Requirements 18.1**
    - Tag: `# Feature: weinliste, Property 18: ...`

- [x] 3. Python Import-Skript: Hilfsfunktionen
  - [x] 3.1 Datei-Hilfsfunktionen implementieren
    - `collect_json_files()`: rekursive Erfassung aller `.json` in `import_dir`; der Archiv-Ordner `import_dir/_archive/` wird vollständig übersprungen (keine prepare/export/image-export-Verarbeitung archivierter Dateien)
    - `slugify_name()`, `find_image_sibling()`, `read_exif_date()` (piexif), `resolve_password()` (Config → Secrets-Datei → Umgebungsvariable, Fehlermeldung bei Fehlen)
    - _Requirements: 2.2, 2.5, 2.6, 6.11, 17.51_

  - [x]* 3.2 Property-Test rekursive Dateierfassung
    - **Property 1: Rekursive Dateierfassung**
    - **Validates: Requirements 2.2**
    - Tag: `# Feature: weinliste, Property 1: ...`

- [x] 4. Python Import-Skript: Phase prepare
  - [x] 4.1 `phase_prepare` und Scaffold-Logik implementieren
    - Auto-detect image, EXIF→tasting_date (nur wenn fehlend, bestehendes nie überschreiben)
    - `rename_file_group()`: Umbenennung JSON+Bild+Audio zu `YYYY-MM-DD-slug.json`, Felder aktualisieren, Zieldatei-Kollision still überspringen (eine Zusammenfassungszeile am Ende)
    - `normalize_number_fields()`: number-Felder aus String normalisieren (Dezimal-Komma → Punkt, `decimals` 0/1/2), nicht umwandelbare Werte unverändert + Warnung
    - `apply_scaffold_mode()`: `true` → alle Schema-Felder mit null auffüllen (bestehende erhalten); `false` → null/leere Felder entfernen
    - Einträge ohne `name` überspringen mit Warnung; ohne `tasting_date` Umbenennung überspringen aber erhalten
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18_

  - [x]* 4.2 Unit-Tests für Phase prepare (tmp_path)
    - EXIF-Auslesen, Auto-detect image, Umbenennung, Kollision, number-Normalisierung, scaffold_mode true/false
    - _Requirements: 2.4, 2.5, 2.6, 2.8, 2.11, 2.16, 2.17, 2.14, 2.15_

  - [x]* 4.3 Property-Test tasting_date wird nie überschrieben
    - **Property 3: `tasting_date` wird nie überschrieben**
    - **Validates: Requirements 2.7**
    - Tag: `# Feature: weinliste, Property 3: ...`

  - [x]* 4.4 Property-Test scaffold_mode=true Vollständigkeit/Werterhaltung
    - **Property 4: `scaffold_mode=true` — Vollständigkeit und Werterhaltung**
    - **Validates: Requirements 2.14**
    - Tag: `# Feature: weinliste, Property 4: ...`

  - [x]* 4.5 Property-Test scaffold_mode=false keine null/leeren Felder
    - **Property 5: `scaffold_mode=false` — Keine null/leeren Felder**
    - **Validates: Requirements 2.15**
    - Tag: `# Feature: weinliste, Property 5: ...`

- [x] 5. Python Import-Skript: Phase export
  - [x] 5.1 `phase_export` implementieren
    - Alle JSON lesen, Einträge ohne `name` überspringen mit Warnung
    - Unbekannte Felder unverändert übernehmen
    - Sortierung: absteigend nach `tasting_date`, Weine ohne Datum ans Ende
    - Valides JSON an `export_path` schreiben (Verzeichnis anlegen)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 5.2 Unit-Tests für Phase export (tmp_path)
    - Sortierung, Felderhaltung, Dateischreiben
    - _Requirements: 3.3, 3.5, 3.6_

  - [x]* 5.3 Property-Test ungültige Einträge werden ausgeschlossen
    - **Property 2: Ungültige Einträge werden ausgeschlossen**
    - **Validates: Requirements 2.3, 3.3**
    - Tag: `# Feature: weinliste, Property 2: ...`

  - [x]* 5.4 Property-Test Sortiertinvariante
    - **Property 6: Sortiertinvariante**
    - **Validates: Requirements 3.5**
    - Tag: `# Feature: weinliste, Property 6: ...`

  - [x]* 5.5 Property-Test JSON-Roundtrip
    - **Property 7: JSON-Roundtrip**
    - **Validates: Requirements 3.6**
    - Tag: `# Feature: weinliste, Property 7: ...`

  - [x]* 5.6 Property-Test unbekannte Felder werden bewahrt
    - **Property 8: Unbekannte Felder werden bewahrt**
    - **Validates: Requirements 3.4**
    - Tag: `# Feature: weinliste, Property 8: ...`

- [x] 6. Python Import-Skript: Phase image-export
  - [x] 6.1 `phase_image_export` implementieren
    - Referenzierte Bilder aus JSON ermitteln, fehlende still überspringen (in Phasen-Zusammenfassung zählen)
    - Skalierung per Pillow: `width`/`height`-Modus, Seitenverhältnis erhalten, Format beibehalten
    - Timestamp-Vergleich: Kopie überspringen wenn aktuell (eine Zusammenfassungszeile am Ende)
    - Originale nicht verändern, Kopien in `image_export_dir`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12_

  - [x]* 6.2 Unit-Tests für Phase image-export (tmp_path)
    - Skalierung, Timestamp-Check, Formaterhalt, fehlendes Bild
    - _Requirements: 4.5, 4.6, 4.8, 4.9, 4.11_

  - [x]* 6.3 Property-Test Bildskalierung erhält Seitenverhältnis
    - **Property 9: Bildskalierung erhält Seitenverhältnis**
    - **Validates: Requirements 4.7**
    - Tag: `# Feature: weinliste, Property 9: ...`

- [x] 7. Python Import-Skript: Phase backup
  - [x] 7.1 `phase_backup` und Rolling-Window-Logik implementieren
    - Last-Backup bei jedem Lauf (`last_YYYY-MM-DD_HH-MM-SS.json`), Rolling Window `max_last_backups`
    - Archival-Backup wenn `archival_interval_days` vergangen (`archival_*.json`), Rolling Window `max_archival_backups`
    - Zeitstempel in `backup/.last_archival` persistieren (nie als Backup gewertet/geprunt)
    - Gesichert wird nur die exportierte `wines.json` als Einzeldatei; fehlendes `export_path` → Warnung + überspringen
    - `_prune_backups()`: älteste Datei löschen; Fehler → Warnung, Pipeline läuft weiter
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.8, 20.9, 20.10_

  - [x]* 7.2 Unit-Tests für Phase backup (tmp_path)
    - Rolling Window last/archival, Intervall-Prüfung, Fehlerbehandlung
    - _Requirements: 20.2, 20.3, 20.4, 20.6, 20.9_

  - [x]* 7.3 Property-Test Last-Backup Rolling Window
    - **Property 20: Last-Backup Rolling Window**
    - **Validates: Requirements 20.2, 20.3**
    - Tag: `# Feature: weinliste, Property 20: ...`

  - [x]* 7.4 Property-Test Archival-Backup Intervall-Invariante
    - **Property 21: Archival-Backup Intervall-Invariante**
    - **Validates: Requirements 20.4, 20.5**
    - Tag: `# Feature: weinliste, Property 21: ...`

- [x] 8. Python Import-Skript: Phase deploy und Remote-Import-Download
  - [x] 8.1 `phase_deploy` (FTPES) implementieren
    - FTPES-Übertragung (`ftplib`/`ssl`, expliziter TLS, Zertifikatsprüfung standardmäßig aus, `FTPS_VERIFY=1` aktiviert sie) von dist-Ordner (`browser`-Unterordner als Deploy-Wurzel), `wines.json`+`wine-schema.json`, `image_export_dir`
    - Timestamp-Vergleich (MDTM), veraltete dist-Serverdateien unter `remote_path` löschen; geschützte Teilbäume (`images/`, `data/`) nicht betreten/löschen
    - MLSD-basiertes Listing mit Fallback auf `nlst`+`_ftp_is_dir`; `--force-images` lädt alle Bilder neu
    - `wines.json` und Bilder niemals auf Server löschen; Passwort via resolve_password; präzise Fehlermeldungen (exit 1)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17, 6.18_

  - [x] 8.2 Remote-Import-Download implementieren
    - `download_remote_import()`: bei `import_source="remote"` `deploy.remote_import_path` vor prepare per FTPES synchronisieren
    - Gleiche Verbindungsparameter/Passwort-Handling wie deploy
    - Fehler → lesbare Meldung mit Serverpfad + Server-Meldung, abbrechen (exit 1)
    - Remote-Backups (`backup.remote_backup_dir`) in `phase_backup` einbinden (best effort, ohne Passwort überspringen)
    - _Requirements: 1.9, 1.10, 1.11, 20.7_

  - [x]* 8.3 Unit-Tests für deploy und Remote-Download
    - Timestamp-Vergleich, selektives Löschen, Passwort-Fallback, Download-Fehlerbehandlung
    - _Requirements: 6.4, 6.5, 6.6, 6.11, 1.11_

- [x] 9. Build-Pipeline und CI
  - [x] 9.1 Makefile und GitHub Actions erstellen
    - `Makefile` mit Targets für prepare, export, image-export (einzeln) und `deploy` (volle Pipeline inkl. `ng build`); `make deploy FORCE_IMAGES=1` durchreichen
    - Angular-Build OHNE `prebuild`-Kopplung an die Import-Phasen (die Phasen löst das Makefile aus)
    - `.github/workflows/deploy.yml`: Push auf main → volle Pipeline, Secrets als Env-Variablen, Remote-Download wenn konfiguriert
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 10. Checkpoint - Import-Skript vollständig
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Angular Frontend: Projekt-Setup, Modelle und Datenservice
  - [x] 15.1 Angular-Projekt und Datenmodelle anlegen
    - Angular-SPA mit TypeScript, Signals, reines SCSS, Light Mode, responsive
    - Modelle: `Wine` (mit `[key: string]: unknown`), `WineFilter`, `NavigationFilter`, `EMPTY_FILTER`, `SortOption`, `LoadState`, `WineSchemaField`, `FilterType`, `UserPreferences`
    - `wine-schema.json` + `wines.json` zur Laufzeit aus `data/` laden (kein gebündeltes Asset)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.7_

  - [x] 15.2 WineDataService implementieren
    - `wines`, `schema`, `loadState` Signals; `loadAll()` lädt `wines.json` + `wine-schema.json` parallel (forkJoin), Fehlerbehandlung
    - Keine Abhängigkeit zum ImportScript, einmaliges vollständiges Laden
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 18.4_

  - [x]* 15.3 Unit-Tests für WineDataService
    - HTTP-States (loading/loaded/error), paralleles Laden
    - _Requirements: 7.3, 7.4_

- [x] 16. Angular Frontend: UserPreferencesService
  - [x] 16.1 UserPreferencesService implementieren
    - Cookie `ws_prefs` (kein Ablaufdatum), `load()`/`save()` für visibleFilters, sortOption, viewMode
    - Keine Filterwerte speichern; ohne Cookie leere optionale Filter, Defaults (Sortierung „Neueste Verkostung zuerst", Ansicht Grid)
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

  - [x]* 16.2 Property-Test UserPreferences Cookie-Roundtrip
    - **Property 19: UserPreferences Cookie-Roundtrip**
    - **Validates: Requirements 19.1, 19.2, 19.3**
    - Tag: `// Feature: weinliste, Property 19: ...`

- [x] 17. Angular Frontend: FilterService und Filterlogik
  - [x] 17.1 `applyFiltersAndSort` Pure-Funktion implementieren
    - Navigation-Filter (region/rebsorte per Slug), Freitextsuche (text-search-Felder, case-insensitiv), Dropdown, Range, Date-Range, Rating-Range mit AND-Logik (OR innerhalb Multiselect)
    - Sortierung tasting_date_desc/asc, rating_desc, price_desc/asc
    - _Requirements: 9.2, 9.13, 11.1_

  - [x] 17.2 FilterService implementieren
    - Signals: filter, navigationFilter, sortOption, viewMode, infoToggleActive, visibleFilterFields
    - Computed: filteredWines, availableRegions/Grapes/Countries (mit Count), hasActiveFilter
    - Methoden: setNavigationFilter, clear*, setSortOption, setViewMode, toggleFilterField, resetFilterKey (+ prefs speichern)
    - Einzige Quelle der Wahrheit, Cookie-Init im Konstruktor
    - _Requirements: 7.6, 9.6, 9.7, 9.9, 9.13, 15.10, 19.4, 19.5_

  - [x]* 17.3 Unit-Tests für FilterService
    - Filterlogik, Cookie-Init, Regionen/Rebsorten-Berechnung mit Count
    - _Requirements: 9.10, 9.11, 9.13_

  - [x]* 17.4 Property-Test Freitextsuche Vollständigkeit/Korrektheit
    - **Property 10: Freitextsuche — Vollständigkeit und Korrektheit**
    - **Validates: Requirements 9.2**
    - Tag: `// Feature: weinliste, Property 10: ...`

  - [x]* 17.5 Property-Test kombinierte Filter AND-Logik
    - **Property 11: Kombinierte Filter — AND-Logik**
    - **Validates: Requirements 9.13**
    - Tag: `// Feature: weinliste, Property 11: ...`

- [x] 18. Angular Frontend: Router, AppComponent und NavComponent
  - [x] 18.1 Router und AppComponent implementieren
    - Routen `/`, `/region/:slug`, `/rebsorte/:slug` (alle WineWallComponent), Wildcard-Redirect
    - AppComponent: `app-nav`, `router-outlet`, Lade-/Fehleranzeige, WineDetailDialog global, `loadAll()` bei Init
    - Globale Tastaturkürzel `i`/`l` (Guards: nicht in Eingabefeldern, nicht mit Modifier, bei offenem Dialog deaktiviert)
    - Routenwechsel lösen keine HTTP-Requests aus
    - _Requirements: 7.7, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 15.8, 15.9_

  - [x] 18.2 NavComponent implementieren
    - NavBar: App-Name „Weinsprechstunde", Logo-Platzhalter links, keine Navigationsmenüpunkte
    - Logo-Klick → alle Filter zurücksetzen, URL `/`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 15.8_

  - [x] 18.3 WineWallComponent implementieren
    - Route-Parameter lesen, FilterService Navigation-Filter setzen/zurücksetzen ohne Datenladen
    - ControlsRow + WineGrid/WineList je nach viewMode einbinden
    - _Requirements: 7.7, 8.5, 15.8_

  - [x]* 18.4 Unit-Tests für AppComponent und NavComponent
    - Lade-/Fehlerzustand, i/l-Kürzel inkl. Guards, Logo-Klick
    - _Requirements: 7.3, 7.4, 8.5, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 19. Angular Frontend: ControlsRow und Filter-Komponenten
  - [x] 19.1 ControlsRow + dynamische Filter-Komponenten implementieren
    - Freitextsuche als einziger fest sichtbarer Filter (Label „Filter", nutzerorientierter Platzhalter)
    - „Mehr Filter"-Button für optionale Filter (multi-select grape/origin, dropdown country/type/producer/quality, einzeln zuschaltbare Bound-Filter Bewertung/Jahrgang/Verkostung ab/bis); Ein-/Ausblenden + Entfernen-Icon setzt Wert zurück + Cookie
    - FilterFieldComponent dynamisch je filter_type (multi-select als aufklappbares Panel, dropdown, range, date-range, rating-range 1.0–10.0 Schritt 0.1)
    - SortControl (5 Optionen), InfoToggle, ListToggle mit `title`-Kürzelhinweis; alle an FilterService gebunden
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17, 9.18, 9.19, 9.20, 9.21, 18.4, 19.6_

- [x] 20. Angular Frontend: WineGrid, WineTile und Unterkomponenten
  - [x] 20.1 WineGrid mit Zurück-Button implementieren
    - Responsive Kachelung, alle gefilterten Weine direkt gerendert (keine Paginierung/kein Nachladen)
    - BackButtonTile als erstes Element wenn `hasActiveFilter()`, Klick → Filter zurücksetzen + URL `/`
    - Hinweismeldung bei leeren Ergebnissen
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 20.2 WineTile, Cover, Overlay und PlayButton implementieren
    - WineTileCover mit PlaceholderIcon-Fallback
    - WineTileOverlay festes Template (year, name, producer, grape, rating-circle, origin), leere Felder ausblenden
    - Hover (Desktop) / Tap (Mobil) Overlay-Toggle, InfoToggle von außen erzwingt Overlay
    - PlayButton bei audio/video → öffnet Detail; Klick öffnet WineDetailDialog
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 14.1_

  - [x]* 20.3 Unit-Tests für WineGrid und WineTile
    - Zurück-Button-Sichtbarkeit, Overlay-Toggle, Play-Button, leere Ergebnisse
    - _Requirements: 11.3, 11.4, 12.5, 12.9_

  - [x]* 20.4 Property-Test InfoToggle wirkt auf alle Kacheln
    - **Property 12: InfoToggle wirkt auf alle Kacheln**
    - **Validates: Requirements 9.17**
    - Tag: `// Feature: weinliste, Property 12: ...`

  - [x]* 20.5 Property-Test InfoToggle-Roundtrip
    - **Property 13: InfoToggle-Roundtrip**
    - **Validates: Requirements 9.18**
    - Tag: `// Feature: weinliste, Property 13: ...`

  - [x]* 20.6 Property-Test Reihenfolge nach Filterung erhalten
    - **Property 14: Reihenfolge nach Filterung erhalten**
    - **Validates: Requirements 11.1**
    - Tag: `// Feature: weinliste, Property 14: ...`

  - [x]* 20.7 Property-Test WineTileOverlay Datenvollständigkeit
    - **Property 15: WineTileOverlay — Datenvollständigkeit**
    - **Validates: Requirements 12.4**
    - Tag: `// Feature: weinliste, Property 15: ...`

- [x] 21. Angular Frontend: WineList und WineListItem
  - [x] 21.1 WineList mit Zurück-Button implementieren
    - Vertikale Liste von WineListItems (Thumbnail, Name, Weingut, Jahr, Herkunftsland, Rating), leere Felder ausblenden
    - Alle gefilterten Weine direkt gerendert, BackButtonItem bei aktivem Filter, leere-Ergebnis-Hinweis
    - Klick auf Item → WineDetailDialog
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 14.1_

- [x] 22. Angular Frontend: WineDetailDialog
  - [x] 22.1 WineDetailDialog implementieren
    - Feste Gruppenstruktur (Kopf, Herkunft, Weinprofil, Verkostung, Kaufinfo, Medien), leere Felder ausblenden
    - RatingCircle, AudioPlayer (wenn audio), VideoPlayer (wenn video)
    - Unbekannte Zusatzfelder am Ende (extraEntries)
    - Schließen-Button, Backdrop-Klick, Body-Scroll-Lock
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x]* 22.2 Unit-Tests für WineDetailDialog
    - close, Backdrop-Click, Body-Scroll-Lock, extraEntries
    - _Requirements: 14.6, 14.7, 14.8_

  - [x]* 22.3 Property-Test WineDetailDialog Feldvollständigkeit
    - **Property 16: WineDetailDialog — Feldvollständigkeit**
    - **Validates: Requirements 14.2**
    - Tag: `// Feature: weinliste, Property 16: ...`

- [x] 23. Angular Frontend: Pfeiltasten-Navigation im WineDetailDialog (Nachrüstung)
  - [x] 23.1 ←/→-Navigation am bestehenden AppComponent/WineDetailDialog ergänzen
    - Das bereits implementierte öffentliche Frontend um die Pfeiltasten-Navigation erweitern: `→` zeigt den nächsten, `←` den vorherigen Wein in der über den FilterService gefilterten und sortierten Reihenfolge (`filteredWines`, dieselbe Reihenfolge wie WineGrid/WineList) im WineDetailDialog an
    - Wrap am Rand: nach dem letzten Wein folgt bei `→` wieder der erste, vor dem ersten folgt bei `←` der letzte (Modulo-Index über `filteredWines`)
    - Bei geschlossenem Dialog öffnet `→` den WineDetailDialog mit dem ersten, `←` mit dem letzten Wein der Liste
    - Guards wie bei `i`/`l`: nicht auslösen in Eingabefeldern (`input`/`textarea`/`select`/`contenteditable`) oder mit Modifier (Ctrl/Cmd/Alt); `i`/`l` bleiben bei offenem Dialog deaktiviert, `←`/`→` sind aktiv
    - _Requirements: 10.4, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12_

  - [ ]* 23.2 Unit-Tests für die Pfeiltasten-Navigation
    - nächster/vorheriger Wein mit Modulo-Wrap über `filteredWines`, Öffnen des ersten/letzten Weins bei geschlossenem Dialog, Guards (Eingabefeld, Modifier), i/l bei offenem Dialog blockiert während ←/→ navigieren
    - _Requirements: 10.4, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12_

- [x] 34. Angular Frontend: Esc schließt den WineDetailDialog (Nachrüstung)
  - [x] 34.1 Escape-Handling am bestehenden AppComponent/WineDetailDialog ergänzen
    - Das bereits implementierte öffentliche Frontend um das Tastaturkürzel `Escape` erweitern: bei geöffnetem WineDetailDialog schließt `Escape` den WineDetailDialog
    - Guards wie bei `i`/`l`/`←`/`→`: nicht auslösen in Eingabefeldern (`input`/`textarea`/`select`/`contenteditable`) oder mit Modifier (Ctrl/Cmd/Alt)
    - _Requirements: 10.4, 10.6, 10.13_

  - [ ]* 34.2 Unit-Tests für das Escape-Handling
    - Schließen des WineDetailDialogs bei `Escape`, kein Auslösen bei geschlossenem Dialog, Guards (Eingabefeld, Modifier)
    - _Requirements: 10.4, 10.6, 10.13_

- [x] 24. Checkpoint - Öffentliches Angular Frontend vollständig
  - Ensure all tests pass, ask the user if questions arise.

- [x] 25. Wine Editor: Angular-Workspace-Umbau (shared/weinliste/editor)
  - [x] 25.1 `frontend/` zu einem Angular-Workspace mit drei Projekten umstrukturieren
    - `angular.json`, `package.json` und `tsconfig` so umbauen, dass der Workspace die Projekte `projects/shared` (Library `@weinsprechstunde/shared`), `projects/weinliste` (bestehende öffentliche App) und `projects/editor` (neue Editor-App) definiert
    - TypeScript-Pfad-Alias `@weinsprechstunde/shared` einrichten
    - Den bisherigen Code der öffentlichen App nach `projects/weinliste/` verschieben, ohne ihre Funktion zu brechen (gleiche Komponenten, gleicher Build-Output-Bezug `frontend/dist/weinliste/browser/` für die Deploy-Phase)
    - _Requirements: 17.1, 17.11_

  - [x] 25.2 Geteilte Logik in `projects/shared` extrahieren
    - FilterService, Wine-Models, WineSchema-Verarbeitung sowie Filter-/Such-/Sortierlogik (`applyFiltersAndSort`) aus der öffentlichen App nach `@weinsprechstunde/shared` verschieben und von `projects/weinliste` über den Alias importieren — ohne Duplizierung und ohne die öffentliche App zu brechen
    - _Requirements: 17.11, 15.10_

  - [ ]* 25.3 Unit-Tests: öffentliche App bleibt über die geteilte Library lauffähig
    - FilterService/`applyFiltersAndSort` aus `@weinsprechstunde/shared` liefern dieselben Ergebnisse; die bestehenden Properties 10, 11, 14 laufen gegen die Library
    - _Requirements: 17.11_

- [x] 26. Wine Editor: FileSystemAccessService (File System Access API)
  - [x] 26.1 `FileSystemAccessService` in `projects/editor` implementieren
    - Ordner-Freigabe über `window.showDirectoryPicker()`; Ordner-Handle in IndexedDB persistieren und bei erneutem Öffnen mit kurzer Re-Autorisierung wiederherstellen
    - Chromium-only: bei fehlender File System Access API verständlichen Hinweis anzeigen (kein Editor)
    - Verzeichnis scannen (JSON/Bilder/Medien), `_archive` vollständig ignorieren; Datei lesen/schreiben/anlegen/verschieben; Bild-Listing mit `name`/`date`/`assigned`; Bildtypen `.jpg/.jpeg/.png/.webp` case-insensitive
    - Clientseitige Thumbnail-Erzeugung (Canvas / `createImageBitmap`) ohne Veränderung der Originale
    - Zugriff bleibt durch die Browser-API technisch auf den freigegebenen `import_dir` beschränkt (keine anwendungsseitige Pfadprüfung nötig)
    - _Requirements: 16.1, 16.2, 16.3, 17.1, 17.2, 17.3, 17.4, 17.28, 17.32, 17.33_

  - [x]* 26.2 Property-Test Zugriff bleibt auf den freigegebenen Ordner beschränkt
    - **Property 26: Zugriff bleibt auf den freigegebenen Ordner beschränkt**
    - **Validates: Requirements 16.2**
    - Tag: `// Feature: weinliste, Property 26: ...`

  - [x]* 26.3 Property-Test clientseitiges Thumbnail lässt Original unverändert
    - **Property 23: Clientseitiges Thumbnail lässt Original unverändert und erhält Seitenverhältnis**
    - **Validates: Requirements 17.33**
    - Tag: `// Feature: weinliste, Property 23: ...`

- [x] 27. Wine Editor: Zwei-Spalten-Layout und Eintragsliste
  - [x] 27.1 Editor-Shell, Liste und Eintragstyp-Filter implementieren
    - Zwei-Spalten-Layout (Eintragsliste links, WineEditor rechts); kein Login-Screen, Start ohne Anmeldung
    - Liste über den geteilten FilterService/ControlsRow (attributbasierte Filter/Suche/Sortierung) plus Eintragstyp-Filter mit vier Zuständen „Alle"/„Nur angelegte"/„Ohne Bilder"/„Nur unbekannte"; Auto-Umschalten „Nur unbekannte" → „Nur angelegte" bei attributbasierter Eingabe
    - Standard-Sortierung absteigend nach `tasting_date` (angelegte + unbekannte gemischt, undatierte ans Ende); unbekannte Weine mit Platzhalter „unbekannter Wein", ermitteltem `tasting_date` und Bildvorschau
    - Auto-Refresh der Liste nach eigener Aktion (Anlegen/Archivieren/Verknüpfen/Speichern) + manueller Aktualisieren-Button (kein Polling); Auswahl zeigt Eintrag rechts im WineEditor
    - _Requirements: 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 17.13, 17.14, 17.15_

- [x] 28. Wine Editor: WineEditor-Formular mit Live-Auto-Save
  - [x] 28.1 WineEditor-Formular implementieren
    - Dynamische Eingabefelder aus WineSchema; Datepicker für `tasting_date`, Zahleneingabe `rating` 1.0–10.0 Schritt 0.1
    - Dropdown/Multi-Select-Werte aus vorhandenen Einträgen, Autocomplete für übrige Textfelder; `grape` als Tag-/Chip-Eingabe mit Autocomplete → Array
    - Medien-Picker für `audio`/`video` (analog ImagePicker) übernimmt Dateinamen
    - Unvollständig-Markierung bei leerem `name` (Liste + Editor) ohne Blockieren; defekte JSON in Liste markiert, nicht öffenbar; schema-fremde Felder anzeigen und erhalten
    - Live-Auto-Save mit 500 ms-Debounce pro Feld direkt über die File System Access API, Typkonvertierung der number-Felder (`year` int, `price` 2, `rating` 1, Dezimal-Komma akzeptiert), Speicherstatus-Indikator (Erfolg/Fehler, Feldinhalte bei Fehler erhalten), Konflikterkennung über `File.lastModified` mit Bestätigungswarnung
    - _Requirements: 17.16, 17.17, 17.18, 17.19, 17.20, 17.21, 17.22, 17.23, 17.24, 17.25, 17.26, 17.27_

  - [ ]* 28.2 Property-Test Konflikt-Erkennung über `File.lastModified`
    - **Property 17: Konflikt-Erkennung über `File.lastModified`**
    - **Validates: Requirements 17.25**
    - Tag: `// Feature: weinliste, Property 17: ...`

  - [ ]* 28.3 Property-Test Editor-Typkonvertierung beim Auto-Save
    - **Property 27: Editor-Typkonvertierung beim Auto-Save**
    - **Validates: Requirements 17.22**
    - Tag: `// Feature: weinliste, Property 27: ...`

  - [ ]* 28.4 Property-Test Schema-fremde Felder bleiben erhalten
    - **Property 28: Schema-fremde Felder bleiben erhalten**
    - **Validates: Requirements 17.27**
    - Tag: `// Feature: weinliste, Property 28: ...`

- [x] 29. Wine Editor: ImagePicker
  - [x] 29.1 ImagePicker implementieren
    - Galerie der Bilddateien im `import_dir` mit clientseitigen Thumbnails; standardmäßig nur ungenutzte Bilder
    - Umschalt-Button ungenutzt/alle, Datum-Sortierung, Dateiname-Filter; Bildtypen `.jpg/.jpeg/.png/.webp` case-insensitive
    - Auswahl → Dateiname in das `image`-Feld des aktuellen Eintrags übernehmen (nur Dateiname ohne Pfad)
    - _Requirements: 17.28, 17.29, 17.30, 17.31, 17.32, 17.33, 17.34, 17.35_

- [x] 30. Wine Editor: Entwurf-Anlegen (manuell) und name-Verknüpfung
  - [x] 30.1 Entwurf-Anlegen (manuell) und link-image implementieren
    - Auswahl eines unbekannten Weins öffnet den WineEditor als Entwurf (volles Formular, keine JSON); Felder außer `name` readonly, vorbefüllt mit `image` und `tasting_date` (EXIF `DateTimeOriginal` oder leer)
    - Manuelles Anlegen per „Wein anlegen"-Button (nur bei nicht-leerem Namen; Tippen legt nichts an); `name`-Autocomplete schlägt bestehende bildlose Einträge vor
    - Eigener neuer Name → neue JSON (Basisname des Bildes + `.json`) mit Name/`image`/eingegebenen Feldern; exakter Treffer eines bestehenden bildlosen Eintrags → dessen `image` setzen, Bild bei Bedarf verschieben, keine neue JSON → genau eine JSON pro Wein; Wein bleibt geöffnet; bei Fehler erkennbare Fehleranzeige ohne doppelte JSON
    - _Requirements: 17.36, 17.37, 17.38, 17.39, 17.40, 17.41, 17.42, 17.43_

  - [ ]* 30.2 Property-Test Anlegen eines Entwurfs — Ort, Name und Feldbelegung
    - **Property 24: Anlegen eines Entwurfs — Ort, Name und Feldbelegung**
    - **Validates: Requirements 17.35, 17.36, 17.40**
    - Tag: `// Feature: weinliste, Property 24: ...`

  - [ ]* 30.3 Property-Test genau eine JSON pro Wein nach link-image-Verknüpfung
    - **Property 25: Genau eine JSON pro Wein nach link-image-Verknüpfung**
    - **Validates: Requirements 17.41, 17.42, 17.43**
    - Tag: `// Feature: weinliste, Property 25: ...`

- [x] 31. Wine Editor: Archivierung und _archive-Ignorierung
  - [x] 31.1 Archivierungs-Aktionen implementieren
    - Keine Lösch-Funktion; `_archive`-Ordner als `import_dir/_archive/`
    - Ungenutztes Bild archivieren = Bild nach `_archive` verschieben; angelegten Eintrag archivieren = JSON + referenzierte Medien (`image`/`audio`/`video`) gemeinsam nach `_archive` verschieben
    - Fehler beim Verschieben → erkennbare Fehleranzeige, Dateien bleiben am Ursprungsort; `_archive` in allen Editor-Scans vollständig ignorieren; kein Dearchivieren
    - _Requirements: 17.44, 17.45, 17.46, 17.47, 17.48, 17.49, 17.50_

  - [x] 31.2 `_archive`-Ignorierung im ImportScript ergänzen
    - `collect_json_files()` im bereits implementierten ImportScript so erweitern, dass der `import_dir/_archive/`-Ordner in PhasePreparate, PhaseExport und PhaseImageExport vollständig übersprungen wird (eine zentrale Stelle)
    - _Requirements: 17.51_

- [x] 32. Wine Editor: Deploy der statischen Editor-App
  - [x] 32.1 Editor-Build in die Deploy-Phase aufnehmen
    - `ng build editor` → `frontend/dist/editor/browser/` als statische App wie die öffentliche Weinliste auf den Webserver deployen, eigene URL im `wine_app`-Bereich
    - Deploy-Phase/Makefile minimal um den Editor-Build-Output erweitern (ausgelieferte App enthält keine Weindaten)
    - _Requirements: 16.3, 17.1_

- [x] 33. Finaler Checkpoint - Alle Subsysteme
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Aufgaben mit `*` sind optionale Test-Sub-Tasks und können für ein schnelleres MVP übersprungen werden.
- Jede Aufgabe referenziert konkrete Requirements zur Nachverfolgbarkeit.
- Checkpoints sichern inkrementelle Validierung nach jedem Subsystem.
- Property-Tests (27 Stück) validieren universelle Korrektheitseigenschaften:
  - Python/hypothesis (vorhanden): Properties 1–9, 18, 20, 21 — jeweils mit `# Feature: weinliste, Property N: ...`
  - Angular/fast-check öffentliche Weinliste: Properties 10–16, 19 — jeweils mit `// Feature: weinliste, Property N: ...`
  - Angular/fast-check Editor-App (File System Access API über `FileSystemAccessService` gemockt): Property 17 (Konflikt-Erkennung), 23 (Thumbnail lässt Original unverändert), 24 (Entwurf-Anlegen: Ort/Name/Feldbelegung), 25 (genau eine JSON pro Wein nach link-image), 26 (Zugriff bleibt auf den Ordner beschränkt), 27 (Editor-Typkonvertierung), 28 (schema-fremde Felder bleiben erhalten)
  - Mindestens 100 Iterationen pro Property.
- Test-Stack: Python (pytest + hypothesis) sowie Angular (öffentliche Weinliste, Editor-App und geteilte Library mit vitest + jsdom + fast-check). Der Editor hat kein Backend und damit keinen eigenen Teststack — er wird im Angular-Stack getestet.
- Unit-Tests validieren konkrete Beispiele und Randfälle.
- Die Tasks 1–24 (Import-Skript, öffentliches Angular-Frontend inkl. Pfeiltasten-Nachrüstung) sind laufzeitunabhängig von der Editor-App; der Angular-Workspace-Umbau (Task 25) ist Voraussetzung für die Editor-App (Tasks 26–32).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "15.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "15.2", "16.1"] },
    { "id": 3, "tasks": ["3.1", "15.3", "16.2", "17.1", "18.1"] },
    { "id": 4, "tasks": ["3.2", "4.1", "17.2", "18.2", "18.3"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.4", "4.5", "5.1", "17.3", "17.4", "17.5", "18.4", "19.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "6.1", "20.1", "20.2", "21.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "7.1", "20.3", "20.4", "20.5", "20.6", "20.7", "22.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "7.4", "8.1", "22.2", "22.3", "23.1"] },
    { "id": 9, "tasks": ["8.2", "8.3", "9.1", "23.2", "25.1", "34.1"] },
    { "id": 10, "tasks": ["25.2", "25.3", "34.2"] },
    { "id": 11, "tasks": ["26.1", "31.2"] },
    { "id": 12, "tasks": ["26.2", "26.3", "27.1"] },
    { "id": 13, "tasks": ["28.1", "29.1"] },
    { "id": 14, "tasks": ["28.2", "28.3", "28.4", "30.1"] },
    { "id": 15, "tasks": ["30.2", "30.3", "31.1"] },
    { "id": 16, "tasks": ["32.1"] }
  ]
}
```
