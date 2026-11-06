# Design: editor

Angular-App `frontend/projects/editor`, reine Browser-App (Chromium), statisch deployt, eigene URL. Kein FastAPI, kein `localhost`, keine `/api/*`, keine Netzwerkanfragen für Daten, keine Weindaten in der App.

Verträge:
- #[[file:.kiro/specs/contracts/import-format.md]] (Ordner, Feldregeln, `_archive`, Schema-Regeln)
- #[[file:.kiro/specs/contracts/editor-output.md]] (Schreibzugriffe, Auto-Save-Regeln, Konfliktschutz, Property 28)
- #[[file:.kiro/specs/contracts/shared-api.md]] (FilterService, Models, `WineDataSource`, Util)

## Pfade

```
frontend/projects/editor/src/app/        Zwei-Spalten-Layout, WineEditor, ImagePicker, A/V-Picker, FileSystemAccessService
Build: npm run build:editor (in frontend/) → frontend/dist/editor/browser/
Datenbasis: freigegebener import_dir (File System Access API); wine-schema.json als statisches Asset der App
```

Gemeinsame Logik nur über `@weinsprechstunde/shared`. Die App stellt `WineDataSource` aus den Scan-Daten bereit. Editor-spezifisch (nicht in shared): Eintragstyp-Filter.

## Zugriff (Req 16, Req 17.2–17.4)

- Keine Auth. Schutz = Ordner-Freigabe; Ausbruch aus dem Ordner durch die Browser-API ausgeschlossen, keine Pfadprüfung nötig.
- `FileSystemAccessService.requestFolder()`: ohne `showDirectoryPicker` → `UnsupportedBrowserError` (Hinweis statt UI); sonst `showDirectoryPicker({mode:'readwrite'})`, Handle in IndexedDB.
- `restoreFolder()`: Handle aus IndexedDB, `queryPermission` / `requestPermission({mode:'readwrite'})`; bei `granted` Handle, sonst `null` (Aufforderung zur Freigabe).

## FileSystemAccessService: Operationen

| Operation | Umsetzung |
|---|---|
| Wine-Listing | rekursiv `entries()`, alle `.json` außer `_archive`; ungültiges JSON → als fehlerhaft markiert |
| Wein lesen | JSON lesen, `File.lastModified` als Lade-Zeitstempel merken |
| Speichern / Auto-Save | `lastModified` erneut lesen; Abweichung → `ConflictError`, sonst `createWritable()` (Regeln: editor-output) |
| Entwurf anlegen | `{Bild-Stem}.json` im Ordner des Bildes: Name, `image`, `tasting_date`, eingegebene Felder |
| Bild verknüpfen (link-image) | `image` des bildlosen Eintrags setzen; Bild bei Bedarf in dessen JSON-Ordner verschieben (lesen → neu anlegen → Original entfernen) |
| Bild-Listing | Scan ohne `_archive`, Endungen `.jpg .jpeg .png .webp` (case-insensitive); je Bild `name`, `date` (EXIF `DateTimeOriginal`, sonst `File.lastModified`), `assigned` (von einem `image`-Feld referenziert) |
| Medien-Listing | Scan ohne `_archive`, Endungen laut import-format |
| Thumbnails | clientseitig `createImageBitmap` + verkleinertes `<canvas>` → Blob/Object-URL; Original unverändert |
| Archivieren | Datei(en) flach nach `import_dir/_archive/` verschieben (editor-output) |
| Autocomplete-/Dropdown-Werte | clientseitig aus den geladenen Einträgen |

Alle Scans ignorieren `_archive`. Unbekannter/ungenutzter Wein = Bild mit `assigned = false`.

## Liste und Filter (Req 17.8–17.15)

Links Liste, rechts WineEditor; gewählter Eintrag wird aus den rohen Scan-Daten aufgelöst (nicht aus der gefilterten Liste), bleibt also bei Filterwechsel offen. Filter, Suche, Sortierung (Standard `tasting_date` absteigend, unbekannte Weine mit Bilddatum eingereiht) vom geteilten FilterService. Eintragstyp-Filter (vier Zustände) liegt in der App; „Nur unbekannte" + Eingabe in einen attributbasierten Filter → automatisch „Nur angelegte". Unbekannter Wein: Text „unbekannter Wein", Bilddatum, Thumbnail. Unvollständige (leerer `name`) und fehlerhafte Einträge sichtbar markiert. Aktualisieren-Button = neuer Scan; automatischer Refresh nach eigenen Aktionen; kein Polling.

## WineEditor-Formular (Req 17.16–17.20, 17.27)

Dynamisch aus `wine-schema.json` (neue Felder erscheinen ohne Code-Änderung).

| Schema | Eingabe |
|---|---|
| `text` name | Textfeld; leer ⇒ unvollständig, blockiert nicht |
| `number` year | Zahl (min 1900, max 2100) |
| `date` tasting_date | Datepicker |
| `rating` | Zahl min 1.0, max 10.0, step 0.1 |
| dropdown/multi-select (country, origin, type, producer, quality) | Auswahl aus vorkommenden Werten |
| `multi-value` grape | Chip-Eingabe mit Autocomplete, Array |
| price | Textfeld mit Autocomplete, 2 Nachkommastellen |
| description | mehrzeilig |
| image | ImagePicker |
| audio, video | Medien-Picker |
| schema-fremd | angezeigt und erhalten |

Auto-Save: Debounce 500 ms pro Feld, Typkonvertierung, Konfliktschutz und Speicherstatus „Erfolg"/„Fehler" (Feldinhalte bleiben bei Fehler). Konflikt: Warnung, Überschreiben nur nach Bestätigung. Cloud-Sync-Konflikte löst die App nicht; die Prüfung über `File.lastModified` deckt nur lokale Änderung seit dem Laden ab.

## ImagePicker und Medien-Picker (Req 17.28–17.35)

Daten aus dem Bild-Listing. Standard `assigned = false`; Umschalter auf alle Bilder; Sortierung nach `date`; Namensfilter clientseitig. Auswahl übernimmt den Dateinamen (ohne Pfad). Audio-/Video-Picker analog über das Medien-Listing. `_archive` erscheint nie.

## Entwurf und Anlegen (Req 17.36–17.43)

Auswahl eines unbekannten Weins ⇒ Entwurf (volles Formular, nur `name` editierbar, `image`/`tasting_date` vorbefüllt, keine Datei). `name`-Autocomplete: nur bildlose Einträge. „Wein anlegen" (nur bei nicht-leerem Namen):
- (a) neuer Name ⇒ neue JSON `{Bild-Stem}.json` im Bildordner mit Name, `image`, eingegebenen Feldern; Umbenennung nach `{tasting_date}-{slug(name)}` bleibt der Aufbereitung.
- (b) exakter Treffer ⇒ link-image; keine neue JSON.
Danach genau eine JSON pro Wein, Wein bleibt geöffnet. Fehler ⇒ Fehleranzeige, kein Zustand mit doppelter JSON. Invariante: niemals zwei JSON für denselben Wein.

## Archivieren (Req 17.44–17.50)

Nur Archivieren, nie Löschen oder Dearchivieren. Ungenutztes Bild ⇒ Bild nach `_archive/`; angelegter Eintrag ⇒ JSON + referenzierte `image`/`audio`/`video`. Medien zuerst, JSON zuletzt, Rollback bei Fehler (editor-output). Fehler ⇒ Dateien bleiben am Ursprungsort, Fehleranzeige. Danach automatischer Refresh.

## Build

Befehl und Dist-Pfad siehe oben (Deploy-seitige Sicht: Vertrag build-output, Pflege durch deploy-ftp-Domäne). Editor-Build ist statisch und ohne Weindaten.

## Correctness Properties

Tag-Format: `// Feature: weinliste, Property N: <text>`. Mindestens 100 Iterationen (fast-check). Die File System Access API wird über den `FileSystemAccessService` gemockt.

### Property 17: Konflikt-Erkennung über `File.lastModified`
Weicht `File.lastModified` beim Speichern vom Lade-Zeitstempel ab, wird der Schreibvorgang abgelehnt und eine Konfliktwarnung ausgelöst, ohne Überschreiben ohne Bestätigung. *Validates: Req 17.25*

### Property 23: Clientseitiges Thumbnail lässt Original unverändert und erhält Seitenverhältnis
Für Originale (`.jpg/.jpeg/.png/.webp`) beliebiger Maße bleibt die Originaldatei byte-identisch, und das Seitenverhältnis der Vorschau weicht um höchstens 0,01 ab. *Validates: Req 17.33*

### Property 24: Anlegen eines Entwurfs: Ort, Name und Feldbelegung
Die erzeugte JSON liegt im selben Unterordner wie das Bild, trägt dessen Basisnamen (`.json`), `image` = Bild-Dateiname (ohne Pfad), `name` = eingegebener Name; keine Umbenennung nach `{tasting_date}-{slug(name)}`. *Validates: Req 17.35, 17.36, 17.40*

### Property 25: Genau eine JSON pro Wein nach link-image
Nach der Verknüpfung existiert genau eine JSON (die des bestehenden Eintrags mit gesetztem `image`), keine zweite; Bild und JSON im selben Verzeichnis. Schlägt ein Schritt fehl, bleiben nie zwei JSON für denselben Wein zurück. *Validates: Req 17.41, 17.42, 17.43*

### Property 26: Zugriff bleibt auf den freigegebenen Ordner beschränkt
Jede Datei-/Bildoperation (Lesen, Schreiben, Anlegen, Verschieben, Thumbnail, Archivieren) bleibt auf den freigegebenen Ordner beschränkt (API-garantiert). *Validates: Req 16.2*

### Property 27: Editor-Typkonvertierung beim Auto-Save
Für jedes `number`-Feld und jede Zahleneingabe (optional Dezimal-Komma) ist der geschriebene Wert eine Zahl gemäß `decimals` (`year` Ganzzahl, `price` 2, `rating` 1; `"6,99"` → `6.99`). *Validates: Req 17.22*

Property 28 (Schema-fremde Felder bleiben erhalten, Roundtrip) ist im Vertrag editor-output definiert; der Property-Test liegt im Editor.

## Error Handling

| Szenario | Verhalten |
|---|---|
| Freigabe verweigert/zurückgezogen | Aufforderung zur (Re-)Freigabe, kein Datenzugriff |
| Keine File System Access API | verständlicher Hinweis statt UI |
| Schreibfehler Auto-Save | Status „Fehler", Feldinhalte bleiben |
| `lastModified` abweichend | Konfliktwarnung, kein Schreiben ohne Bestätigung |
| Defekte JSON | in Liste als fehlerhaft, nicht im WineEditor |
| Archiv-Verschieben fehlgeschlagen | Datei bleibt am Ursprungsort, Fehleranzeige |
| link-image/Verschieben fehlgeschlagen | keine doppelte JSON, Fehleranzeige |
| Gleichzeitige Cloud-Sync-Bearbeitung | Sync-Konfliktkopien möglich, nicht Aufgabe der App |

## Testing Strategy

vitest + jsdom + fast-check (`ng test`), kein Backend-Teststack.
- Unit: Freigabe/Handle-Persistenz (gemockt), Unsupported-Browser-Hinweis, keine Netzwerkanfragen/Weindaten, Auto-Refresh und Aktualisieren-Button ohne Polling, Layout/Auswahl, Standardsortierung, Eintragstyp-Filter inkl. Auto-Umschalten, Formular aus WineSchema, Chips (Array), Audio-/Video-Picker, Unvollständig-/Fehlerhaft-Markierung, schema-fremde Felder, Bild-Listing (`date`/`assigned`), ImagePicker (Standard, Umschalter, Datumssortierung, Namensfilter), Auto-Save (Debounce, Typkonvertierung, Status), Konfliktwarnung, Entwurf, Anlegen (a)/(b), Archivieren (kein Löschen), `_archive`-Ignorierung.
- Property: 17, 23–27 und 28 (aus editor-output).
- Contract-Fixture: `frontend/projects/editor/src/app/models/contract-fixture.spec.ts` (`fixtures/import/`).
- Filter-/Schema-Logik der geteilten Library wird in der Library getestet, nicht im Editor dupliziert.
