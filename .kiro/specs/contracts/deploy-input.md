# Vertrag: deploy-input

- Version: 1.1.0
- Produzent (Eigentümer): deploy-ftp (definiert Erwartung); befüllt von pipeline (`export/`) und build (`frontend/dist/`)
- Konsumenten: deploy-ftp (Phase `deploy`)
- Changelog:
  - 1.1.0 (2026-11-07): Audio/Video als lokale Eingaben (`audio_export_dir`, `video_export_dir`), neue Remote-Schlüssel `remote_audio_path`/`remote_video_path`, Prune-Schutz und Reihenfolge ergänzt. Rückwärtskompatibel (Defaults).
  - 1.0.0 (2026-11-06): Erstfassung aus Ist-Zustand.

Siehe auch: [export-format](export-format.md), [build-output](build-output.md).

## Lokale Eingaben

| Eingabe | Pfad | Pflicht |
|---|---|---|
| Weinliste-Build | `frontend/dist/weinliste/browser/` mit `index.html` | ja |
| Editor-Build | `frontend/dist/editor/browser/` (alternativ flach `frontend/dist/editor/`) mit `index.html` | nein; fehlt → Editor-Schritt still übersprungen |
| Weindaten | `export_path` (`export/data/wines.json`) | nein; fehlt → nicht hochgeladen |
| Schema-Kopie | `export/data/wine-schema.json` (neben `wines.json`) | nein |
| Bilder | `image_export_dir` (`export/images/`), nur Dateien direkt im Ordner | nein |
| Audio | `audio_export_dir` (`export/audio/`), nur Dateien direkt im Ordner | nein |
| Video | `video_export_dir` (`export/video/`), nur Dateien direkt im Ordner | nein |

Auflösung Weinliste-Dist (`_resolve_dist_dir`): `frontend/dist` mit eigener `index.html` → dieser; sonst `dist/weinliste/browser`; sonst genau ein `dist/*/browser` mit `index.html`; sonst `frontend/dist`.

## Remote-Pfade (`weinsprechstunde.config.json` → `deploy`)

| Schlüssel | Ist-Wert | Inhalt |
|---|---|---|
| `protocol` | `ftpes` | Transport (FTPS explizit) |
| `remote_path` | `/` | Weinliste-Dist-Wurzel |
| `remote_images_path` | `/images` | Bilder |
| `remote_audio_path` | `/audio` (Default) | Audio; leer → Audio-Upload übersprungen |
| `remote_video_path` | `/video` (Default) | Video; leer → Video-Upload übersprungen |
| `remote_import_path` | `/data` | `wines.json`, `wine-schema.json`; Quelle für Remote-Import-Download |
| `remote_editor_path` | `/edit` | Editor-Dist; leer → Editor-Deploy übersprungen |
| `backup.remote_backup_dir` | `/backup` | Server-Backups |

`host`, `user`, `password`: Reihenfolge Config > `weinsprechstunde.secrets.json` > Umgebung (`WEINSPRECHSTUNDE_DEPLOY_HOST|USER|PASSWORD`). Nicht in der Config versioniert.

## Invarianten

- Upload nur bei Remote älter als lokal (MDTM-Vergleich); `--force-images` lädt alle Bilder sowie Audio und Video.
- Prune unter `remote_path` löscht nie: `wines.json`-Basename, `remote_images_path`, `remote_audio_path`, `remote_video_path`, `remote_import_path`, `remote_editor_path`.
- Editor-Prune ausschließlich unterhalb `remote_editor_path`.
- `wines.json`, `wine-schema.json`, Bilder, Audio, Video werden nie gelöscht.
- Kein automatisches Backup beim Deploy.
- Deploy-Phase baut nichts; sie erwartet fertige Artefakte.
- Reihenfolge Deploy: Weinliste-Dist → Prune → `wines.json`/Schema → Bilder → Audio → Video → Editor-Dist.
