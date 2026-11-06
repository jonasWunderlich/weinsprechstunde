# Design: pipeline

Python-CLI `scripts/weinimport.py` (Einstieg/Fassade; Logik in `scripts/weinlib/{config,pipeline,backup}.py`; Abhängigkeiten: `scripts/requirements.txt`). Phasen `backup`, `prepare`, `export`, `image-export`.

Verträge:
- #[[file:.kiro/specs/contracts/import-format.md]]
- #[[file:.kiro/specs/contracts/editor-output.md]]
- #[[file:.kiro/specs/contracts/export-format.md]]

## Pfade und Datenfluss

```
weinsprechstunde.config.json   Laufzeit-Config (Root)
wine-schema.json               Felddefinitionen (Root, maßgeblich, siehe import-format)
import/        (import_dir)    JSON + Bild + Audio + Video, rekursiv; _archive/ ignoriert
backup/                        last_*.json, archival_*.json, .last_archival
export/data/wines.json         Ausgabe export
export/images/                 Ausgabe image-export
export/audio/, export/video/   Ausgabe image-export (Medien, unverändert kopiert)
```

`import/` → `prepare` (in place) → `export` → `export/data/wines.json`; `image-export` → `export/images/`. `backup` kopiert vorher `export_path`. Der Remote-Import-Download füllt `import/` vor `prepare`.

## weinsprechstunde.config.json (Ist-Wert)

```json
{
  "import_source": "local",
  "export_path": "./export/data/wines.json",
  "scaffold_mode": true,
  "image_export_dir": "./export/images",
  "audio_export_dir": "./export/audio",
  "video_export_dir": "./export/video",
  "image_resize_mode": "width",
  "image_resize_px": 1200,
  "deploy": { "protocol": "ftpes", "remote_path": "/", "remote_images_path": "/images", "remote_audio_path": "/audio", "remote_video_path": "/video", "remote_import_path": "/data" },
  "backup": { "backup_dir": "./backup", "remote_backup_dir": "/backup", "max_last_backups": 10, "max_archival_backups": 24, "archival_interval_days": 30 }
}
```

Kein `editor`-Objekt. `import_dir` steht nicht in der Config, sondern (optional) in `weinsprechstunde.secrets.json`; Fallback `<Projektordner>/import` (`load_config`). `host`/`user`/`password` nicht in der Config; Auflösung: Config > `weinsprechstunde.secrets.json` (Vorlage `weinsprechstunde.secrets.example.json`) > `WEINSPRECHSTUNDE_DEPLOY_HOST|USER|PASSWORD`. Die Deploy-Werte der Config sind in dieser Domäne nur Eingabe für Remote-Import und Remote-Backup.

## CLI

| Aufruf | Verhalten |
|---|---|
| `python weinimport.py` | backup → (remote-download) → prepare → export → image-export, sequenziell |
| `python weinimport.py backup\|prepare\|export\|image-export` | einzelne Phase |

## Konfiguration und Hilfsfunktionen

- `load_config`: fehlende/ungültige Config → stderr-Meldung, `exit 1`. `load_wine_schema`: fehlende Schema-Datei → Fehler, `exit 1`. `get_scaffold_fields` = alle Schema-Feldnamen.
- `collect_json_files(import_dir)`: `rglob("*.json")`, sortiert, überspringt `_archive` (einzige Stelle für alle drei Phasen, Req 17.51).
- `slugify_name` (`python-slugify`); `find_image_sibling`: gleicher Stem mit `.jpg .jpeg .png .webp`; `read_exif_date`: `DateTimeOriginal` → `YYYY-MM-DD` (piexif), bei Fehler `None`.

## Phase backup (Req 20)

Nur wenn `config.backup` gesetzt. Gesichert wird ausschließlich `export_path` (Einzeldatei). Ablauf:
1. `export_path` fehlt → Warnung, Rückkehr.
2. `last_<ts>.json` kopieren; `_prune_backups(prefix="last_", max_last_backups)`.
3. `backup/.last_archival` (ISO-Zeitstempel) älter als `archival_interval_days` oder fehlend → `archival_<ts>.json` kopieren, Marker schreiben, prunen mit `max_archival_backups`.
4. `remote_backup_dir` gesetzt → `_remote_backup`: ohne Passwort Warnung+Rückkehr; sonst FTPES-Verbindung, `remote_backup_dir` anlegen, neue Dateien hochladen (best effort).
`_prune_backups` wertet nur Dateien mit passendem Präfix, nie `.last_archival`; Löschfehler → Warnung. Jeder Fehler → Warnung, Pipeline läuft weiter.

## Remote-Import-Download (`import_source = "remote"`)

`download_remote_import`: synchronisiert `deploy.remote_import_path` nach `import_dir` (FTPES, Verzeichnislisting bevorzugt per MLSD). Fehler → stderr „Download des Import-Ordners von host:pfad fehlgeschlagen. Server-Meldung: …", `exit 1`.

## Phase prepare (Req 2)

Pro JSON aus `collect_json_files`:
1. Kein `name` → Warnung, weiter.
2. `image` fehlt → `find_image_sibling`.
3. `tasting_date` fehlt und `image` gesetzt → `read_exif_date`.
4. `tasting_date` vorhanden → `new_stem = {tasting_date}-{slug(name)}`; `rename_file_group` benennt JSON, `image`, `audio` im selben Ordner um und aktualisiert `image`/`audio`; existiert ein Ziel → Zähler `skipped++`, keine Einzelwarnung. Ohne `tasting_date`: Warnung, keine Umbenennung.
5. `normalize_number_fields`: für Schema-Typ `number`: String trimmen, `,`→`.`, `float`; `_round_to_decimals` (`0` → `int(round)`, sonst `round(float, decimals)`); bereits numerische Werte werden auf `decimals` gerundet; `None`/leer unverändert; nicht parsebar → Warnung, Wert bleibt.
6. `apply_scaffold_mode`; JSON mit `indent=2, ensure_ascii=False` zurückschreiben.
Ende: höchstens eine Zusammenfassungszeile für übersprungene Umbenennungen.

## Phase export (Req 3)

Alle gültigen Objekte (mit `name`) einlesen; `with_date` absteigend nach `tasting_date`, danach `without_date` in Quellreihenfolge; `export_path.parent` anlegen; `json.dumps(indent=2, ensure_ascii=False)` UTF-8. Ausgabeformat und Invarianten: export-format.

## Phase image-export (Req 4)

Pro JSON mit `image`: Quelle `json.parent / image`; fehlt → `missing++`. Ziel `image_export_dir / image` (flach); Ziel existiert und `mtime >= src.mtime` → `skipped++`. Sonst Pillow `thumbnail` (`width`: `(px, 99999)`, `height`: `(99999, px)`), `save(format=img.format)`, `scaled++`. Am Ende eine Zeile: `image-export: X skaliert, Y bereits vorhanden übersprungen, Z Quellen fehlten.`

Medien: `phase_image_export` ruft am Ende `phase_media_export(config)` auf. Pro JSON mit `audio`/`video`: Quelle `json.parent / wert`; fehlt → `missing++`; Ziel `audio_export_dir|video_export_dir / basename(wert)`; gleiche Größe und `mtime >= src.mtime` → `skipped++`; sonst `shutil.copy2` (übernimmt mtime). Zusätzliche Zeile `media-export: …` nur, wenn Medien referenziert sind. Kein Transkodieren.

Ruhiges Logging: weder prepare noch image-export schreiben Warnungen pro übersprungener Datei; nur die eine Zusammenfassungszeile.

## Data Models (Python)

- `Wine` (dataclass): Schemafelder optional, `name: str` Pflicht, `extra: dict` für Zusatzfelder.
- `SchemaField`: `field`, `type` (`text|number|date|rating|multi-value`), `filter_type`, `default_filter`, `decimals: int|None`.
- `BackupConfig`: `backup_dir`, `max_last_backups`, `max_archival_backups`, `archival_interval_days`, `remote_backup_dir|None`.
- `DeployConfig`: `protocol`, `remote_path`, `remote_images_path`, `remote_audio_path`, `remote_video_path`, `remote_import_path`, `host`, `user`, `password` (zur Laufzeit aufgelöst).
- `Config`: `import_dir`, `import_source`, `export_path`, `scaffold_mode`, `image_export_dir`, `audio_export_dir`, `video_export_dir`, `image_resize_mode`, `image_resize_px`, `deploy`, `backup|None`. Kein `EditorConfig`.

## Bibliotheken (`scripts/requirements.txt`)

`Pillow` (Skalierung), `piexif` (EXIF), `python-slugify` (Slug); stdlib: `ftplib`/`ssl` (FTPES), `dataclasses`, `argparse`. Keine Editor-Backend-Bibliotheken.

## Correctness Properties

Tag-Format: `# Feature: weinliste, Property N: <text>`. Mindestens 100 Iterationen (hypothesis).

### Property 1: Rekursive Dateierfassung
Für jeden Verzeichnisbaum enthält `collect_json_files` alle JSON-Dateien unabhängig von der Tiefe. *Validates: Req 2.2*

### Property 2: Ungültige Einträge werden ausgeschlossen
Ein JSON-Objekt ohne `name` ist weder nach `prepare` noch nach `export` in `wines.json`. *Validates: Req 2.3, 3.3*

### Property 3: `tasting_date` wird nie überschrieben
Ein vorhandener `tasting_date` ist nach `prepare` identisch. *Validates: Req 2.7*

### Property 4: `scaffold_mode=true`: Vollständigkeit und Werterhaltung
Nach `apply_scaffold_mode` sind alle Schema-Felder vorhanden und ursprüngliche Nicht-null-Werte unverändert. *Validates: Req 2.14*

### Property 5: `scaffold_mode=false`: keine null/leeren Felder
Nach `apply_scaffold_mode` bleibt kein Feld mit `null` oder `""`. *Validates: Req 2.15*

### Property 6: Sortierinvariante
Nach `export`: alle Weine mit `tasting_date` vor denen ohne; die mit Datum absteigend. *Validates: Req 3.5*

### Property 8: Unbekannte Felder werden bewahrt
Alle Felder außerhalb des Schemas stehen unverändert in `wines.json`. *Validates: Req 3.4*

### Property 9: Bildskalierung erhält Seitenverhältnis
Für beliebige Maße und beide `image_resize_mode`-Werte weicht das Seitenverhältnis der Kopie um höchstens 0,01 vom Original ab. *Validates: Req 4.7*

### Property 20: Last-Backup Rolling Window
Für `max_last_backups = N ≥ 1` ist die Anzahl `last_*.json` nach jedem Lauf ≤ N (`.last_archival` zählt nicht). *Validates: Req 20.2, 20.3*

### Property 21: Archival-Backup Intervall-Invariante
Zwischen zwei Archival-Backups liegen stets ≥ `archival_interval_days` Tage. *Validates: Req 20.4, 20.5*

Properties 7 (JSON-Roundtrip, Vertrag export-format) und 18 (WineSchema-Roundtrip, Vertrag import-format) sind in den Verträgen definiert; pipeline testet sie in `scripts/tests/pipeline` (hypothesis).

## Error Handling

| Szenario | Verhalten |
|---|---|
| Config fehlt/ungültig | stderr, `exit 1` |
| `wine-schema.json` fehlt | stderr, `exit 1` |
| JSON ohne `name` | überspringen, Warnung |
| Umbenennung: Ziel existiert | still überspringen, eine Summary-Zeile |
| Bildquelle fehlt | weiter, in Summary gezählt |
| Nicht umwandelbarer Zahlenwert | unverändert, Warnung |
| Remote-Import-Download fehlgeschlagen | stderr (Pfad + Server-Meldung), `exit 1` |
| Backup fehlgeschlagen/`export_path` fehlt/kein Passwort für Remote-Backup | Warnung, Pipeline läuft weiter |

## Testing Strategy

pytest + hypothesis, temporäre Verzeichnisse (`tmp_path`):
- Unit: `phase_backup` (Einzeldatei, Rolling Window, Intervall, Remote-Upload mit Fake-FTP), `phase_prepare` (EXIF, Auto-Image, Umbenennung, scaffold), `phase_export`, `phase_image_export`, `load_wine_schema`, `download_remote_import` (Fehlerfall).
- Property: Properties 1–6, 8, 9, 20, 21 sowie 7 und 18 aus den Verträgen.
- Contract-Fixture: `scripts/tests/pipeline/test_contract_fixtures.py` (`fixtures/import/` → prepare + export → `fixtures/export/wines.json`).
