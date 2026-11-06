# Vertrag: export-format

- Version: 1.1.0
- Produzent (Eigentümer): pipeline
- Konsumenten: weinliste (lesend), deploy-ftp (transportiert unverändert)
- Changelog:
  - 1.1.0 (2026-11-07): Audio/Video-Export konkretisiert (Config `audio_export_dir`/`video_export_dir`, Defaults, Verhalten); Remote-Auslieferung unverändert. Rückwärtskompatibel.
  - 1.0.0 (2026-11-06): Erstfassung aus Ist-Zustand.

Datenstruktur: [`wine-schema.json`](../../../wine-schema.json).

## Artefakte

| Datei/Ordner | Pfad (Config) | Inhalt |
|---|---|---|
| `wines.json` | `export_path` (`./export/data/wines.json`) | JSON-Array von Wine-Objekten, UTF-8, `indent=2`, `ensure_ascii=false` |
| `wine-schema.json` | `export/data/wine-schema.json` | Kopie von Root-`wine-schema.json` (im Repo versioniert, Inhalt identisch) |
| Bilder | `image_export_dir` (`./export/images/`) | skalierte Kopien, Dateiname = `image`-Wert, flach |
| Audio | `audio_export_dir` (Default `./export/audio/`) | unveränderte Kopien (kein Transkodieren), Dateiname = `audio`-Wert, flach |
| Video | `video_export_dir` (Default `./export/video/`) | unveränderte Kopien, Dateiname = `video`-Wert, flach |

Remote-Auslieferung (Web-Root): `data/wines.json`, `data/wine-schema.json`, `/images/{image}`, `/audio/{audio}`, `/video/{video}`. Weinliste lädt relativ `data/wines.json` und `data/wine-schema.json`.

## Invarianten

- Reihenfolge: Weine mit `tasting_date` zuerst, absteigend nach `tasting_date`; danach Weine ohne `tasting_date` in Quellreihenfolge.
- Jeder Eintrag hat `name`. Einträge ohne `name` sind nicht enthalten.
- `scaffold_mode=true`: jeder Eintrag enthält alle Schema-Felder (fehlend = `null`); Nicht-null-Werte unverändert.
- `scaffold_mode=false`: kein Feld mit `null` oder `""`.
- Typen gemäß Schema: `year` Integer, `price` Float (2 Dezimalen), `rating` Float (1 Dezimale), `tasting_date` `YYYY-MM-DD` oder `null`.
- `grape`: String, Array von Strings oder `null`.
- Schema-fremde Felder bleiben unverändert erhalten.
- Archivierte Einträge (`_archive/`) und deren Medien sind nicht enthalten.
- `image`/`audio`/`video` = Dateiname ohne Pfad.
- Bilder: Seitenverhältnis erhalten; Skalierung nach `image_resize_mode` (`width`|`height`) auf `image_resize_px`; Originale unverändert.
- Medien (Audio/Video) werden in der Phase `image-export` aus den `audio`/`video`-Feldern der nicht archivierten JSONs erzeugt (Quelle: Datei im Ordner der JSON). Fehlende Quelle: Warnung/Zählung in der Zusammenfassungszeile `media-export: …`, kein Abbruch. Ziel gilt als aktuell (nicht erneut kopiert) bei gleicher Größe und Ziel-mtime >= Quell-mtime. Fehlen die Config-Schlüssel, gelten die Defaults.
- Property 7 (JSON-Roundtrip): Parsen der geschriebenen `wines.json` ergibt die geschriebene Liste ohne Datenverlust und Typänderung. *Validates: Req 3.6.* Test: pipeline (hypothesis).

## Golden Fixture

- [`fixtures/export/wines.json`](fixtures/export/wines.json) (Ergebnis von prepare + export auf `fixtures/import/`).
- Test pipeline: `scripts/tests/pipeline/test_contract_fixtures.py`.
- Test weinliste: `frontend/projects/weinliste/src/app/services/contract-fixture.spec.ts`.
