# Requirements: pipeline (Import-Skript, Aufbereitung, Export, Backup)

Domäne: `scripts/weinlib/{config,pipeline,backup}.py` (Einstieg/Fassade: `scripts/weinimport.py`; Phasen `backup`, `prepare`, `export`, `image-export`). Eigenständiges Python-CLI, unabhängig vom Angular-Build.

Verträge:
- #[[file:.kiro/specs/contracts/import-format.md]] (Eingabe, inkl. Schema-Regeln Req 18)
- #[[file:.kiro/specs/contracts/editor-output.md]] (was der Editor schreibt)
- #[[file:.kiro/specs/contracts/export-format.md]] (Ausgabe `wines.json`, Bilder, Roundtrip Property 7)

## Glossar (nur pipeline)

- **ImportScript**: Python-Skript, Phasen `backup`, `prepare`, `export`, `image-export` (die Phase `deploy` liegt im selben Skript, ist aber nicht Teil dieser Domäne).
- **ConfigFile**: `weinsprechstunde.config.json` im Projekt-Root. Keine Felder `editor.path` / `editor.password_hash`, kein `optional_fields`.
- **WineSchema**: `wine-schema.json` im Projekt-Root; liefert Feldliste, `type`, `decimals` (siehe import-format).
- **scaffold_mode**: `true` → fehlende Schema-Felder mit `null` ergänzen; `false` → Felder mit `null`/`""` entfernen.
- **Slug**: Kleinschreibung, Leerzeichen → Bindestrich, Sonderzeichen entfernt (`python-slugify`).
- **BackupConfig**: optionales `backup`-Objekt: `backup_dir`, `remote_backup_dir`, `max_last_backups`, `max_archival_backups`, `archival_interval_days`. Zwei Rolling-Window-Backups der exportierten `wines.json` als Einzeldateien (`last_<ts>.json`, `archival_<ts>.json`); kein Ordner, nicht der Import-Ordner.
- **import_source**: `"local"` | `"remote"`; bei `remote` wird `deploy.remote_import_path` vor `prepare` per FTPES nach `import_dir` synchronisiert.

## Requirements

### Requirement 1: Konfigurationsdatei

1.1 ImportScript liest `weinsprechstunde.config.json` (Projekt-Root) vor jeder Phase.
1.2 Pflichtfelder: `export_path` (String), `scaffold_mode` (Boolean).
1.3 Fehlt die Datei oder ist sie kein valides JSON → lesbare Fehlermeldung auf stderr, Abbruch.
1.4 `import_dir` = Verzeichnis der JSON-Quelldateien, wenn `import_source` = `"local"`. Auflösung: Config-Wert > `weinsprechstunde.secrets.json` > Standard `<Projektordner>/import`; leere Werte zählen als nicht gesetzt. Normalfall: in der Secrets-Datei (lokaler, maschinenabhängiger Pfad), nicht in der versionierten Config.
1.5 `export_path` = Zielpfad der `wines.json`.
1.6 `scaffold_mode` steuert die Feldbehandlung in `prepare`.
1.7 Liste der aufzubereitenden Felder kommt aus `wine-schema.json` (kein `optional_fields` in der Config).
1.8 Feld `import_source` (`"local"` | `"remote"`).
1.9 `remote`: Import-Ordner vor `prepare` per FTPES herunterladen; Quelle `deploy.remote_import_path`.
1.10 Download nutzt dieselben Verbindungsparameter und dasselbe Secrets-Handling (Config > Secrets-Datei > Umgebung) wie der Deploy.
1.11 Schlägt der Download fehl → lesbare Fehlermeldung mit Serverpfad und Server-Meldung, Abbruch.
1.12 `image_export_dir` (String): Zielpfad skalierter Bildkopien.
1.13 `image_resize_mode` (`"width"` | `"height"`) und `image_resize_px` (Integer).
1.14 `deploy`-Objekt mit `protocol` (`"ftpes"`), `remote_path`, `remote_images_path`, `remote_import_path`; `host`, `user`, `password` stehen NICHT in der Config.
1.15 Fehlen `host`/`user`/`password` oder sind leer → `weinsprechstunde.secrets.json` (unversioniert, neben der Config), dann `WEINSPRECHSTUNDE_DEPLOY_HOST|USER|PASSWORD`. Fehlende Secrets-Datei ist kein Fehler.
1.16 Optionales `backup`-Objekt mit `backup_dir`, `remote_backup_dir` (optional), `max_last_backups`, `max_archival_backups`, `archival_interval_days`.

### Requirement 2: Phase prepare

2.1 Aufruf `python script.py prepare`.
2.2 Alle JSON-Dateien in `import_dir` rekursiv einlesen.
2.3 Datei ohne `name` → überspringen, Warnung auf stderr.
2.4 Vorhandenes `image`-Attribut wird als Bildreferenz übernommen.
2.5 Fehlt `image`, existiert aber ein Bild mit gleichem Stem im selben Ordner → `image` automatisch setzen.
2.6 Fehlt `tasting_date` und es gibt ein Bild mit EXIF → `tasting_date` aus `DateTimeOriginal` (ISO-8601) in die JSON schreiben.
2.7 Vorhandenes `tasting_date` bleibt unverändert.
2.8 Mit `tasting_date`: Datei umbenennen zu `YYYY-MM-DD-slug-aus-name.json`; bleibt im bisherigen Unterordner.
2.9 Zugehöriges Bild wird auf denselben Basisnamen umbenannt.
2.10 Zugehörige Audiodatei wird auf denselben Basisnamen umbenannt.
2.11 Existiert die Zieldatei bereits → Umbenennung still überspringen, keine Warnung pro Datei; am Ende höchstens EINE Zeile auf stderr (z. B. „prepare: N Umbenennung(en) übersprungen (Zieldatei existierte bereits).").
2.12 Nach Umbenennung `image`/`audio` in der JSON auf die neuen Namen aktualisieren.
2.13 Ohne `tasting_date`: Umbenennung überspringen, Warnung, Datei bleibt für `export` erhalten.
2.14 `scaffold_mode=true`: alle Schema-Felder schreiben, fehlende mit `null`, bestehende Werte unverändert.
2.15 `scaffold_mode=false`: alle Felder mit `null` oder `""` entfernen.
2.16 `number`-Feld als String → Zahl umwandeln und zurückschreiben; Dezimal-Komma akzeptieren (`"6,99"` → `6.99`).
2.17 `decimals` normalisiert: `0` Integer (`"2017"` → `2017`), `1` Float 1 Stelle (`"6"` → `6.0`), `2` Float 2 Stellen (`"6,99"` → `6.99`).
2.18 Nicht umwandelbar (z. B. `"auf Anfrage"`) → Wert unverändert, Warnung mit Feldname, Wert, Datei.

### Requirement 3: Phase export

3.1 Aufruf `python script.py export`.
3.2 Alle JSON-Dateien aus `import_dir` einlesen.
3.3 Weine ohne `name` überspringen, Warnung.
3.4 Unbekannte Felder unverändert in `wines.json` übernehmen.
3.5 Sortierung absteigend nach `tasting_date`; Weine ohne `tasting_date` ans Ende (Quellreihenfolge).
3.6 Sortierte Daten als valides JSON nach `export_path` schreiben.

### Requirement 4: Phase image-export

4.1 Aufruf `python script.py image-export`.
4.2 Alle JSON aus `import_dir` einlesen, referenzierte Bilder im selben Ordner ermitteln.
4.3 Originale bleiben unverändert.
4.4 Skalierte Kopien nach `image_export_dir`.
4.5 `width`: auf `image_resize_px` Breite, Höhe proportional.
4.6 `height`: auf `image_resize_px` Höhe, Breite proportional.
4.7 Seitenverhältnis immer erhalten.
4.8 Dateiformat bleibt erhalten, keine Konvertierung.
4.9 Kopie existiert und ist nicht älter als das Original → überspringen.
4.10 Kopie fehlt oder ist älter → neu skalieren.
4.11 Referenzierte Bilddatei fehlt → weiter mit nächstem Eintrag, keine Warnung pro Datei; Zählung in der Zusammenfassung.
4.12 Übersprungene Bilder still; am Ende höchstens EINE Zeile auf stderr (z. B. „image-export: X skaliert, Y bereits vorhanden übersprungen, Z Quellen fehlten.").

### Requirement 15 (Teil): Eigenständigkeit

15.6 ImportScript ist ein eigenständiges Python-Skript, unabhängig vom Angular-Build ausführbar.

### Requirement 17 (Teil): Archiv-Ordner

17.51 `prepare`, `export`, `image-export` überspringen `import_dir/_archive/` vollständig; archivierte Weine und Bilder fließen weder in `wines.json` noch in den Bildexport ein.

### Requirement 20: Sicherheitskopien der exportierten wines.json

20.1 Mit `backup`-Objekt: vor jeder Pipeline-Ausführung (vor `prepare`) ein Last-Backup. `make deploy` führt `backup` als allerersten Schritt aus, unabhängig von den übrigen Phasen (Phase `backup`, auch einzeln aufrufbar: `make backup`).
20.2 Last-Backup = Kopie der einzelnen Datei `export_path` nach `backup.backup_dir` als `last_YYYY-MM-DD_HH-MM-SS.json` (nicht Import-Ordner, kein Unterordner).
20.3 Mehr als `max_last_backups` `last_`-Dateien → älteste löschen (genau `max_last_backups` bleiben). `.last_archival` zählt nicht als Backup.
20.4 Vor jeder Pipeline-Ausführung prüfen, ob seit dem letzten Archival-Backup ≥ `archival_interval_days` Tage vergangen sind.
20.5 Archival fällig → Kopie von `export_path` als `archival_YYYY-MM-DD_HH-MM-SS.json` in `backup_dir`.
20.6 Mehr als `max_archival_backups` `archival_`-Dateien → älteste löschen.
20.7 `remote_backup_dir` gesetzt → erstellte Dateien per FTPES als Einzeldateien dorthin hochladen. Ohne Deploy-Passwort: Remote-Backup mit Warnung überspringen, kein Abbruch, lokales Backup bleibt.
20.8 Zeitstempel des letzten Archival-Backups in `backup/.last_archival` (lokaler Backup-Ordner).
20.9 Backup-Fehler (lokal/remote, Last/Archival) → Warnung auf stderr, Pipeline läuft weiter.
20.10 `export_path` existiert beim Backup noch nicht → Backup mit Warnung überspringen, kein Abbruch.
