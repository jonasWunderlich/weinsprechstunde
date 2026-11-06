# Requirements: editor (Wine Editor Web-App)

Domäne: `frontend/projects/editor` (Angular, reine Browser-App ohne Backend). Pflegt die JSON-Quelldateien im `import_dir` über die File System Access API.

Verträge:
- #[[file:.kiro/specs/contracts/import-format.md]] (Ordnerstruktur, Feldregeln, `_archive`, Schema-Regeln Req 18)
- #[[file:.kiro/specs/contracts/editor-output.md]] (was der Editor schreibt, Auto-Save-Regeln, Roundtrip Property 28)
- #[[file:.kiro/specs/contracts/shared-api.md]] (FilterService, Models, Util)

## Glossar (nur editor)

- **WineEditorApp**: Statische Angular-App (Chromium: Chrome/Edge), per eigener URL geöffnet, enthält keine Weindaten. Liest und schreibt JSON-, Bild- und Mediendateien direkt im vom Benutzer einmalig freigegebenen Cloud-Ordner (= `import_dir`). Verteilung zwischen Beteiligten übernimmt die Cloud-Synchronisation. Teilt Filter-/Such-/Sortier-/Schema-Logik mit der öffentlichen Weinliste über `@weinsprechstunde/shared`. Kein Login, keine `editor.path`/`editor.password_hash`-Config.
- **WineEditor**: Bearbeitungsformular für einen Eintrag.
- **ImagePicker**: durchsuchbare Bildauswahl für Dateien im `import_dir`, standardmäßig nur noch nicht zugeordnete Bilder.
- **Angelegter Wein**: Eintrag mit JSON-Quelldatei. **Unbekannter Wein**: Bilddatei, die von keinem `image`-Feld einer (nicht archivierten) JSON referenziert wird.
- **Entwurf**: geöffneter unbekannter Wein ohne JSON-Datei.

## Requirements

### Requirement 16: Zugriffsschutz Wine Editor

16.1 Reine Browser-App ohne Server/Backend, ohne Authentifizierung (kein Passwort, Session-Cookie, Rate-Limiting); Zugang allein über die im Browser erteilte Ordner-Freigabe.
16.2 Alle Datei- und Bildzugriffe ausschließlich über die Ordner-Freigabe (File System Access API); Zugriff nur auf den freigegebenen Ordner (= `import_dir`), Ausbruch durch die Browser-API technisch ausgeschlossen.
16.3 Die deployte statische App enthält keine Weindaten; Weindaten nur aus/in den lokal freigegebenen Ordner.
16.4 Kommt ohne `editor.path` und `editor.password_hash` in der Config aus.

### Requirement 17: Wine Editor Web-App (ohne 17.51)

Plattform und Ordner
17.1 Reine Angular-Browser-App ohne Backend (zweite App im Workspace), statisch deployt, per URL geöffnet; bearbeitet JSON-, Bild-, Mediendateien über die File System Access API an Ort und Stelle im freigegebenen Cloud-Ordner; Verteilung per Cloud-Sync.
17.2 Erster Start: Aufforderung zur Freigabe des Cloud-Ordners (= `import_dir`); Ordner-Handle wird in IndexedDB persistiert.
17.3 Erneutes Öffnen mit persistiertem Handle: kurze Re-Autorisierung statt erneuter Ordnersuche.
17.4 Nur Chromium (Chrome/Edge); ohne File System Access API verständlicher Hinweis.
17.5 Verteilung der Dateien allein per Cloud-Sync; der Editor löst keine Sync-Konflikte (gleichzeitiges Bearbeiten derselben Datei kann Sync-Konflikte erzeugen, außerhalb der Verantwortung der App).
17.6 Nach eigener Aktion (Anlegen, Archivieren, Bild-Verknüpfen, Speichern) wird die Liste automatisch aktualisiert.
17.7 Für Änderungen anderer Beteiligter ein manueller Aktualisieren-Button; kein automatisches Polling.

Layout und Liste
17.8 Zwei-Spalten-Layout: Eintragsliste links, WineEditor rechts.
17.9 Auswahl eines Eintrags zeigt dessen Details im WineEditor.
17.10 Liste mit denselben attributbasierten Filter-/Such-/Sortiermöglichkeiten wie die öffentliche Weinliste (WineSchema, FilterService/ControlsRow) plus Eintragstyp-Filter; unterscheidet angelegte und unbekannte Weine.
17.11 Filter-, Such-, Sortierlogik und WineSchema-Verarbeitung aus dem geteilten Bereich (`@weinsprechstunde/shared`), nicht dupliziert.
17.12 Standardsortierung absteigend nach `tasting_date`; angelegte und unbekannte Weine gemischt nach Datum; ohne ermittelbares Datum ans Ende; weitere Optionen wie in der Weinliste (geteilter FilterService).
17.13 Unbekannter Wein in der Liste: Platzhaltertext „unbekannter Wein", `tasting_date` aus dem Bild (falls ermittelbar), Bildvorschau.
17.14 Eintragstyp-Filter mit genau vier Zuständen: „Alle", „Nur angelegte" (JSON existiert), „Ohne Bilder" (angelegte Weine ohne `image`), „Nur unbekannte" (nicht referenzierte Bilder).
17.15 Steht der Filter auf „Nur unbekannte" und der Benutzer gibt einen Wert in einen attributbasierten Filter ein → automatisch auf „Nur angelegte".

Formular
17.16 Eingabefelder für alle Schema-Felder; `tasting_date` Datepicker, `rating` Zahleneingabe Schritt 0.1, 1.0–10.0.
17.17 Felder mit `filter_type` `dropdown`/`multi-select` (`country`, `origin`, `grape`, `type`, `producer`, `quality`): Auswahl aus bereits vorkommenden Werten; übrige Textfelder: Autocomplete aus bekannten Werten.
17.18 `grape` als Tag-/Chip-Eingabe mit Autocomplete aus vorhandenen Rebsorten; als Array gespeichert.
17.19 `audio`/`video`: Medien-Picker analog ImagePicker über Mediendateien im `import_dir`; übernimmt den Dateinamen.
17.20 Eintrag ohne nicht-leeres `name`: in Liste und WineEditor als unvollständig markiert; Zwischenstand wird dennoch automatisch gespeichert.

Auto-Save
17.21 Schreiben in die JSON ohne manuelle Aktion, frühestens 500 ms nach der letzten Eingabe im Feld (Debounce 500 ms pro Feld).
17.22 `number`-Felder typrichtig als JSON-Zahl (`year` Ganzzahl, `price` 2, `rating` 1 Nachkommastelle), Dezimal-Komma akzeptiert (`"6,99"` → `6.99`), konsistent zur Normalisierung der Pipeline.
17.23 Erfolgreicher Auto-Save → Speicherstatus-Indikator „Erfolg".
17.24 Fehlgeschlagener Auto-Save → Indikator „Fehler" mit erkennbarer Fehleranzeige; zuletzt eingegebene Feldinhalte bleiben erhalten.
17.25 Best-effort-Konflikterkennung über `File.lastModified`: Datei seit dem Laden extern verändert → Warnung, kein Überschreiben ohne Bestätigung.
17.26 Ungültiges JSON in `import_dir`: Datei in Liste als fehlerhaft markiert, nicht im WineEditor geöffnet (Korrektur im Dateisystem).
17.27 Schema-fremde Felder werden im WineEditor angezeigt und beim Speichern erhalten.

Bilder und Medien
17.28 `image`-Feld mit ImagePicker: Galerie der Bilder im `import_dir` mit clientseitig erzeugten Thumbnails; standardmäßig nur keinem Eintrag zugeordnete Bilder.
17.29 Umschalt-Button „nur ungenutzte Bilder" ⇄ „alle Bilder".
17.30 Sortierung der Bilder nach Datum (Aufnahme- bzw. Dateidatum).
17.31 Filter-Eingabefeld nach Dateiname.
17.32 Bilddateien: `.jpg`, `.jpeg`, `.png`, `.webp`, case-insensitive (unbekannte Weine und ImagePicker).
17.33 Vorschauen (Listen-Thumbnails, ImagePicker, WineEditor) clientseitig aus den über die File System Access API gelesenen Originalen (Canvas/`createImageBitmap`); Originale unverändert.
17.34 Auswahl im ImagePicker übernimmt den Dateinamen ins `image`-Feld des bearbeiteten Eintrags.
17.35 `image`/`audio`/`video` nur als Dateiname ohne Pfad; Bild liegt stets im selben Verzeichnis wie die zugehörige JSON (gleichnamige Bilder in verschiedenen Unterordnern bleiben eindeutig).

Entwurf und Anlegen
17.36 Auswahl eines unbekannten Weins (Klick auf Eintrag oder Bild) öffnet den WineEditor als Entwurf mit vollständigem Schema-Formular; `image` = Dateiname, `tasting_date` = EXIF `DateTimeOriginal` (falls vorhanden, sonst leer); es wird KEINE JSON angelegt.
17.37 Entwurf ohne JSON: alle Felder außer `name` readonly; geschrieben wird nichts, solange kein nicht-leerer Name eingetragen ist.
17.38 Im `name`-Feld des Entwurfs ein Autocomplete aller bestehenden Einträge, deren JSON kein gesetztes `image` hat (leer, `null` oder fehlend).
17.39 Anlegen nur per manueller Aktion (Schaltfläche „Wein anlegen"), nur bei nicht-leerem Namen; Tippen im `name`-Feld legt nichts an und verknüpft nichts.
17.40 Eigener neuer Name (kein exakter Autocomplete-Treffer): neue JSON mit Bild-Basisname + `.json` im selben Unterordner wie das Bild, mit Name, `image` und den bis dahin eingegebenen Feldern; die Umbenennung nach `{tasting_date}-{slug(name)}` bleibt der Aufbereitung überlassen.
17.41 Name entspricht exakt einem bildlosen Eintrag: dessen `image` auf den Bild-Dateinamen setzen, Bild bei Bedarf in das JSON-Verzeichnis verschieben, fortan diesen Eintrag bearbeiten (link-image); keine zusätzliche JSON.
17.42 Nach abgeschlossenem Anlegen genau eine JSON pro Wein; der Wein bleibt im WineEditor geöffnet und bearbeitbar, unabhängig vom aktuellen Listenfilter.
17.43 Schlägt Anlegen, Setzen des `image`-Feldes oder Bildverschieben fehl → erkennbare Fehleranzeige, kein Zustand mit doppelter JSON für denselben Wein.

Archivieren
17.44 Keine Funktion zum Löschen von Einträgen oder Dateien; nur Archivieren; endgültiges Löschen manuell im Dateisystem.
17.45 Archiv-Ordner `import_dir/_archive/` (fester Name).
17.46 Ungenutztes Bild archivieren → Bilddatei nach `_archive` verschieben.
17.47 Angelegten Eintrag archivieren → JSON zusammen mit den in `image`/`audio`/`video` referenzierten Dateien (sofern vorhanden) nach `_archive` verschieben.
17.48 Schlägt das Verschieben fehl → erkennbare Fehleranzeige, Dateien bleiben am Ursprungsort.
17.49 Dateien in `_archive` werden vollständig ignoriert (keine archivierten Bilder als unbekannte, keine archivierten JSON als angelegte Weine).
17.50 Keine Dearchivieren-Funktion; Zurückholen manuell im Dateisystem.
