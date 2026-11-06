# Vertrag: editor-output

- Version: 1.0.0
- Produzent (Eigentümer): editor
- Konsumenten: pipeline
- Changelog:
  - 1.0.0 (2026-11-06): Erstfassung aus Ist-Zustand.

Datenstruktur: [`wine-schema.json`](../../../wine-schema.json). Ordnerstruktur: [import-format](import-format.md). Dieser Vertrag beschreibt nur, was der Editor in den Import-Ordner schreibt.

## Schreibzugriffe (File System Access API, nur innerhalb des freigegebenen `import_dir`)

| Aktion | Ergebnis |
|---|---|
| Entwurf aus Bild anlegen | `{Bild-Stem}.json` im selben Ordner wie das Bild; alle Schema-Felder `null`, `image` = Bild-Dateiname, `tasting_date` = EXIF-Datum oder `null`; bei Formularanlage mit eingegebenen Feldwerten, `image` immer gesetzt |
| Bild mit bildlosem Eintrag verknüpfen | `image` des bestehenden Eintrags gesetzt, Bild im Ordner der JSON, keine zweite JSON |
| Auto-Save | `JSON.stringify(wine, null, 2)` in bestehende Datei (UTF-8) |
| Archivieren | JSON + referenzierte Medien (`image`/`audio`/`video`) nach `import_dir/_archive/` verschoben (flach); Medien zuerst, JSON zuletzt; Rollback bei Fehler |

Der Editor löscht nie Dateien aus dem Import-Ordner (außer Entwurf-JSON beim Verknüpfen) und benennt nie nach `{tasting_date}-{slug}` um (das macht prepare).

## Auto-Save-Regeln

- Debounce 500 ms pro Feld.
- Beim Schreiben: Original-Objekt als Basis, nur bekannte Schema-Felder mit Formularwerten überschrieben; schema-fremde Felder unverändert.
- Wert `undefined` (nicht konvertierbar): Feld bleibt unverändert.
- Geleertes Feld (`null`): Schlüssel wird entfernt.
- Number-Felder: JSON-Zahl, Dezimal-Komma akzeptiert, Rundung nach `decimals` (`year` Integer, `rating` 1, `price` 2).
- `grape`: Array aus getrimmten, nicht-leeren, duplikatfreien Tags (Eingabe kommagetrennt).
- `audio`/`video`: Dateiname ohne Pfad, Datei existiert im Import-Ordner.
- Konfliktschutz: Schreiben nur wenn `File.lastModified` dem Ladewert entspricht; sonst `ConflictError`, keine Überschreibung ohne Bestätigung.

## Invarianten (Roundtrip)

- Property 28 (Schema-fremde Felder bleiben erhalten): Nach Laden und Auto-Save sind alle Felder außerhalb der WineSchema unverändert in der JSON; der Editor-Save ändert keine Felder außer den explizit gespeicherten. *Validates: Req 17.27.* Test: editor (fast-check).
- Vom Editor geschriebene Number-Felder entsprechen der Pipeline-Normalisierung (`prepare` ändert sie nicht mehr).
- Jeder Wein hat genau eine JSON-Quelldatei.

## Golden Fixture

- [`fixtures/import/2021/2021-01-18-keller-riesling-trocken.json`](fixtures/import/2021/2021-01-18-keller-riesling-trocken.json).
- Test editor: `frontend/projects/editor/src/app/models/contract-fixture.spec.ts`.
- Test pipeline: `scripts/tests/test_contract_fixtures.py`.
