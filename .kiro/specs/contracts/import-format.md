# Vertrag: import-format

- Version: 1.1.0
- Produzent (Eigentümer): Quelle/Editor (Import-Ordner, Domäne editor schreibt; Quelle = iCloud/Remote-Sync)
- Konsumenten: editor, pipeline
- Changelog:
  - 1.1.0 (2026-11-06): `import_dir` wird aus Config > `weinsprechstunde.secrets.json` > Standard `<Projektordner>/import` aufgelöst (Ordnerstruktur unverändert).
  - 1.0.0 (2026-11-06): Erstfassung aus Ist-Zustand; ergänzt um Schema-Regeln (Req 18) und Property 18 (Dokumentation, keine Strukturänderung).

## Datenstruktur

Maßgeblich: [`wine-schema.json`](../../../wine-schema.json) (Repo-Root). Feldnamen, Typen, `decimals`, Filtertypen stehen nur dort. Zusatzfelder außerhalb des Schemas sind erlaubt.

## Ordner (`import_dir`)

- Pfad: `import_dir`, Auflösung Config > `weinsprechstunde.secrets.json` (Normalfall, lokaler Pfad) > Standard `import/` im Projektordner (leer/fehlend = Standard); `import_source` = `local` | `remote`.
- Ein Wein = eine `*.json`-Datei (UTF-8, JSON-Objekt, kein Array).
- Beliebig tiefe Unterordner; Erfassung rekursiv.
- Medien (Bild/Audio/Video) liegen im selben Ordner wie die JSON, die sie referenziert.
- `image`, `audio`, `video` = reiner Dateiname ohne Pfad.
- Bildendungen: `.jpg .jpeg .png .webp` (Groß/Klein egal in Pipeline, Editor `toLowerCase`).
- Audioendungen (Editor-Picker): `.mp3 .m4a .aac .ogg .oga .wav .flac`.
- Videoendungen (Editor-Picker): `.mp4 .mov .webm .m4v .ogv`.
- Dateiname-Konvention nach prepare: `{tasting_date}-{slug(name)}.json` (+ gleicher Stem für Bild/Audio). Vor prepare beliebig (Editor-Entwurf: Bild-Stem + `.json`).
- `_archive/` (oberste Ebene von `import_dir`): vollständig ignoriert (JSON und Medien); Editor verschiebt flach dorthin, kein Löschen.

## Invarianten

- Eintrag ohne Schlüssel `name` ist ungültig und wird von der Pipeline übersprungen.
- `tasting_date`: ISO-8601 `YYYY-MM-DD` oder `null`.
- Number-Felder (`year`, `price`, `rating`): JSON-Zahl oder `null`. Strings mit Dezimal-Komma werden von der Pipeline normalisiert (`"6,99"` → `6.99`).
- `grape`: String oder Array von Strings (Editor schreibt Array).
- Leeres Feld: `null` oder Schlüssel fehlt (Editor löscht Schlüssel beim Leeren).
- Schema-fremde Felder bleiben in jedem Schritt unverändert erhalten.
- Archiv-Datei und Medien eines Eintrags liegen im selben Ordner wie seine JSON.

## Schema-Regeln (Req 18)
- Datei `wine-schema.json` im Projekt-Root, gemeinsam genutzt von Pipeline, Weinliste und Editor. Pro Feld: `field`, `type` (`text|number|date|rating|multi-value`), `filter_type` (`text-search|range|date-range|dropdown|rating-range|multi-select|null`), `default_filter` (Boolean), optional `decimals` (nur `number`: `0` Integer, `1`/`2` Float).
- Mindestens definierte Felder: `name`, `year`, `country`, `origin`, `grape`, `type`, `producer`, `quality`, `price`, `rating`, `tasting_date`, `image`, `audio`, `video`, `description` (Werte der Eigenschaften: nur in der Datei).
- Pipeline liest die Liste der aufzubereitenden Felder aus der Schema-Datei. Weinliste lädt sie beim Start (ControlsRow-Filter), Editor lädt sie beim Start (Eingabefelder nach Feldtyp).
- Neues Feld im Schema ⇒ automatisch Eingabefeld im Editor und potentieller Filter in der Weinliste, ohne Code-Änderung.
- `default_filter` steuert nicht die initiale Filtersichtbarkeit (nur Freitextsuche fest sichtbar); das Flag bleibt im Schema.
- Property 18 (WineSchema-Roundtrip): Einlesen durch `load_wine_schema` und erneutes Serialisieren der `SchemaField`-Liste ergibt eine strukturell äquivalente JSON-Struktur ohne Datenverlust/Typänderung. *Validates: Req 18.1.* Test: pipeline (hypothesis).

## Golden Fixture

- [`fixtures/import/`](fixtures/import/) (inkl. `_archive/`-Beispiel).
- Test pipeline: `scripts/tests/pipeline/test_contract_fixtures.py`.
- Test editor: `frontend/projects/editor/src/app/models/contract-fixture.spec.ts`.
