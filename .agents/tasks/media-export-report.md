# Bericht: Audio/Video-Export und -Deploy (Branch `media-export`)

## Commits
1. `fix: rename video file together with json, image and audio` (pipeline.rename_file_group + Test)
2. `feat: export audio and video within image-export phase` (config.py, pipeline.py `phase_media_export`, Fassade, weinsprechstunde.config.json, `test_media_export.py`)
3. `feat: deploy audio and video next to images, protect from prune` (deploy.py `_upload_flat_dir`, Prune-Schutz, conftest, Deploy-Tests)
4. `docs: bump export-format and deploy-input to 1.1.0 ...` (Verträge, contracts-index, Specs pipeline/deploy-ftp)

## Testläufe
`.venv/bin/python -m pytest scripts/tests -q`: Basis 108 -> nach 1: 109 -> nach 2: 116 -> nach 3 und 4: 121 passed, jeweils vor dem Commit grün.
`make -n deploy`: Struktur unverändert (backup, optimize-images, prepare, export, image-export, Builds, deploy). `weinimport.py --help` läuft. `git diff main -- Makefile .github` leer. Golden-Fixture-Test grün, Fixture unverändert. `ftp_transport.py` nicht geändert (daher kein extra `test_backup.py`-Lauf nötig, lief aber in der Gesamtsuite mit).

## Entscheidungen
- Keine neue CLI-Phase: `phase_image_export` ruft am Ende `phase_media_export(config)` auf. Makefile, `make all/deploy` und deploy.yml exportieren damit ohne Änderung Medien.
- Quelle: `audio`/`video` der nicht archivierten JSONs (`collect_json_files`, `_archive` ignoriert), Datei relativ zur JSON. Kopie unverändert (`shutil.copy2`), Zielname = Basename des Feldwerts (flach).
- Aktualitätskriterium: gleiche Größe UND Ziel-mtime >= Quell-mtime (copy2 übernimmt mtime, Größe fängt Änderungen mit alter mtime ab).
- Fehlende Quelle: Zählung, kein Abbruch. Zusammenfassungszeile `media-export: …` nur, wenn Medien referenziert sind. So bleibt Req 4.12 / der bestehende Test (genau eine Zeile) für Bild-only-Läufe gültig.
- Config: `audio_export_dir`/`video_export_dir` (Default `./export/audio`/`./export/video`, per `raw.get`, rückwärtskompatibel); `deploy.remote_audio_path`/`remote_video_path` (Default `/audio`, `/video`; leer = überspringen). weinsprechstunde.config.json ergänzt.
- Deploy: gemeinsamer Helfer `_upload_flat_dir` (Bilder, Audio, Video). Reihenfolge: ... Bilder -> Audio -> Video -> Editor. MDTM-Vergleich, nie löschen. `_protected_prefixes` schützt Audio/Video-Pfade, Prune betritt sie nicht.
- `--force-images` gilt auch für Audio/Video ("dieselben Regeln wie Bilder"). Folge: erzwungener Re-Upload auch großer Videos. Bei Bedarf trennbar.
- Verträge: export-format 1.0.0 -> 1.1.0, deploy-input 1.0.0 -> 1.1.0, contracts-index aktualisiert. wine-schema.json unverändert.
- Neue Pflichtfelder in Dataclasses nur mit Defaults, daher keine Brüche bei bestehenden Configs.

## Befunde (nicht geändert)
- `frontend/angular.json` (Dev-Assets, Zeilen ~103-109): Audio `public/audio` -> `audio`, aber Video `public/videos` -> `videos`. Das ist inkonsistent zum Vertrag und zur Weinliste (`/video/`). Im Dev-Modus würde `/video/{file}` nicht gefunden. Das gehört zu Shared/Weinliste und ist ein offener Punkt.
- Weinliste/shared (`wine-util.ts`): `IMAGE_BASE='/images/'`, `VIDEO_BASE='/video/'`, `AUDIO_BASE='/audio/'`, also relative Root-URLs passend zum Vertrag. Keine Änderung nötig.

## Offene Punkte
- Rewrite im Root-`.htaccess` (manuell, `deploy/htaccess-webroot.txt`): `/audio/…` und `/video/…` müssen wie `/images/…` auf `/wine_app/…` gemappt werden, falls dies nicht generisch geschieht. Nicht geprüft, nicht Teil des Deploys. Zudem Remote-Pfade in der echten Config (`/audio`, `/video` relativ zum FTP-Root) analog zu `/images`.
- Steering-Texte (orchestration/product) nennen nur Phasennamen; inhaltlich weiter korrekt, nicht geändert.
- Kein realer Deploy, kein Netzzugriff getestet (nur Fake-FTP).
