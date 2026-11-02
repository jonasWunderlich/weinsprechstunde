# Implementation Plan: Python Import-Skript (weinliste Tasks 2–10)

Scope: `scripts/weinimport.py` — ein phasenbasiertes CLI (backup, prepare, export,
image-export, deploy) plus Hilfsfunktionen, Datenmodelle, Remote-Import-Download,
Build-Pipeline (Makefile, frontend/package.json prebuild, GitHub Actions) sowie
Unit- und Property-Based-Tests. Maßgeblich ist der Pseudocode in
`.kiro/specs/weinliste/design.md`, Abschnitt „1. Python Import-Skript".

## Designentscheidungen (grounded im Repo)

- **Interpreter/venv**: Es ist kein Python 3.12 installiert; verfügbar sind
  `python3` (3.15.0a8, Alpha) und `/opt/homebrew/bin/python3.13`. Da Pillow/piexif
  Binary-Wheels brauchen und der 3.15-Alpha riskant ist, wird die venv mit
  **python3.13** erstellt (`python3.13 -m venv .venv`), Code bleibt 3.12-kompatibel
  (type hints `X | Y`, `list[str]` etc. laufen ab 3.10/3.12). Begründung: stabilste
  verfügbare Version nahe am Design-Ziel.
- **Alle Phasen in einer Datei** `scripts/weinimport.py`: Der Design-Pseudocode legt
  ein einziges Skript mit gemeinsamen Datenmodellen und Hilfsfunktionen fest; Phasen
  teilen `collect_json_files`, `resolve_password`, Deploy-/Download-Transport. Keine
  Aufteilung in Module, um dem Design treu zu bleiben.
- **Config-Parsing mit verschachtelten Dataclasses**: `load_config` konstruiert
  `Config(**raw)` nicht naiv (raw enthält verschachtelte dicts für `deploy`, `editor`,
  `backup`). Stattdessen werden die Unterobjekte explizit zu `DeployConfig`,
  `EditorConfig`, `BackupConfig` geparst. Begründung: der naive `Config(**raw)` im
  Pseudocode würde dicts statt Dataclasses zuweisen; der Phasencode greift aber per
  Attribut zu (`config.deploy.host`, `config.backup.max_last_backups`). Dieser
  Feinschliff ist nötig, damit das Skript lauffähig ist.
- **Transport-Helfer**: SFTP via `paramiko`, FTP via `ftplib` (stdlib). Gemeinsame
  interne Funktionen `_upload_sftp/_upload_ftp/_download_sftp/_download_ftp` für
  Deploy UND Remote-Import-Download, da Req 1.10 identisches Verbindungs- und
  Passwort-Handling verlangt.
- **Tests unter `scripts/tests/`** mit `conftest.py`; Property-Tests mit
  `@settings(max_examples=100)` und Tag-Kommentar `# Feature: weinliste, Property N: …`.
  Pillow erzeugt Testbilder on the fly (`PIL.Image.new`), piexif-EXIF wird mit
  `piexif.dump` in JPEGs geschrieben. Transport-Phasen (deploy/download) werden mit
  `monkeypatch`/Fakes getestet — keine echten Netzverbindungen.

## Verifikation (echte Kommandos)

- Setup einmalig: `python3.13 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt`
- Tests: `.venv/bin/python -m pytest scripts/tests -q`
- Property-Tests laufen als Teil der pytest-Suite (mind. 100 Iterationen je Property).
- Smoke-CLI: `.venv/bin/python scripts/weinimport.py prepare` etc. gegen `import/`.

---

- [ ] 1. scripts/requirements.txt anlegen (Task 2.1).
      Pinne die Abhängigkeiten: `Pillow`, `piexif`, `paramiko`, `python-slugify`,
      `bcrypt`, `itsdangerous`, `pytest`, `hypothesis` (jeweils mit `==`-Version).
      Danach venv erstellen und installieren.
      Files: scripts/requirements.txt
      Verify: `python3.13 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt`
      endet erfolgreich; `.venv/bin/python -c "import PIL, piexif, paramiko, slugify, bcrypt, itsdangerous, pytest, hypothesis"` wirft nichts.

- [ ] 2. Datenmodelle + Config/Schema-Laden + CLI-Grundgerüst in scripts/weinimport.py (Task 2.1, 2.2).
      Dataclasses `Wine`, `SchemaField`, `BackupConfig`, `DeployConfig`, `EditorConfig`,
      `Config` exakt wie design.md „Data Models". `load_config()` (FileNotFoundError →
      `FEHLER: Konfigurationsdatei '{path}' nicht gefunden.`; JSONDecodeError →
      `FEHLER: Konfigurationsdatei ist kein valides JSON: {e}`; beide stderr + exit 1),
      verschachtelte dicts explizit zu DeployConfig/EditorConfig/BackupConfig parsen.
      `load_wine_schema()` (FileNotFoundError → `FEHLER: wine-schema.json nicht gefunden.`
      + exit 1), `get_scaffold_fields()`. argparse-Einstiegspunkt mit Phasen
      `backup|prepare|export|image-export|deploy`; ohne Argument → backup→prepare→
      export→image-export (NICHT deploy). `main()` lädt Config+Schema, ruft Phasen auf.
      Files: scripts/weinimport.py
      Verify: `.venv/bin/python scripts/weinimport.py --help` zeigt die 5 Phasen;
      `.venv/bin/python -c "import sys; sys.argv=['x']; import importlib.util as u; ..."` bzw. die Unit-Tests aus Schritt 3 laufen.

- [ ] 3. Unit- + Property-Tests für Config/Schema (Task 2.3, 2.4).
      `scripts/tests/conftest.py` (tmp_path-Helfer). `scripts/tests/test_config.py`:
      fehlende Datei → SystemExit(1) + stderr; ungültiges JSON → SystemExit(1);
      korrektes Parsen inkl. verschachtelter DeployConfig/BackupConfig/EditorConfig;
      `load_wine_schema` fehlende Datei → SystemExit(1). Property 18 (WineSchema-
      Roundtrip) in `scripts/tests/test_properties.py`: Schema laden → SchemaField-Liste
      serialisieren → strukturell äquivalent. Tag `# Feature: weinliste, Property 18: WineSchema-Roundtrip`.
      Files: scripts/tests/conftest.py, scripts/tests/test_config.py, scripts/tests/test_properties.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_config.py scripts/tests/test_properties.py -q` grün.

- [ ] 4. Hilfsfunktionen (Task 3.1).
      `collect_json_files()` (`sorted(Path(import_dir).rglob("*.json"))`),
      `slugify_name()` (python-slugify), `find_image_sibling()` (.jpg/.jpeg/.png/.webp),
      `read_exif_date()` (piexif `DateTimeOriginal` → `YYYY-MM-DD`, Fehler → None),
      `resolve_password()` (Config → Env `WEINSPRECHSTUNDE_DEPLOY_PASSWORD`; bei Fehlen
      WORTWÖRTLICH Req 6.11: `FEHLER: Kein Deploy-Passwort gefunden. Setze die
      Umgebungsvariable WEINSPRECHSTUNDE_DEPLOY_PASSWORD mit dem Server-Passwort, z. B.:
      export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=deinPasswort` + exit 1).
      Files: scripts/weinimport.py
      Verify: Property 1 (Schritt 5) + Unit-Checks laufen.

- [ ] 5. Property-Test rekursive Dateierfassung (Task 3.2).
      Property 1 in test_properties.py: beliebig tief verschachtelte JSON-Dateien →
      `collect_json_files` enthält alle. Tag `# Feature: weinliste, Property 1: Rekursive Dateierfassung`.
      Files: scripts/tests/test_properties.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_properties.py -q` grün.

- [ ] 6. Phase prepare + Scaffold-Logik (Task 4.1).
      `phase_prepare()`, `rename_file_group()`, `apply_scaffold_mode()` exakt wie
      Pseudocode: ohne `name` überspringen + Warnung; auto-detect image (nur wenn Feld
      fehlt); EXIF→`tasting_date` nur wenn fehlend (bestehendes nie überschreiben);
      Umbenennung zu `{tasting_date}-{slug}.json` nur bei `tasting_date`+`year`,
      JSON+Bild+Audio mitbenennen, Felder aktualisieren, Kollision überspringen +
      Warnung; ohne `year` Umbenennung überspringen + Warnung, Datei erhalten;
      scaffold_mode true → Schema-Felder mit null auffüllen (bestehende erhalten),
      false → null/""-Felder entfernen.
      Files: scripts/weinimport.py
      Verify: Unit-/Property-Tests Schritt 7 grün.

- [ ] 7. Tests Phase prepare (Task 4.2–4.5).
      `scripts/tests/test_prepare.py` (tmp_path): EXIF-Auslesen (piexif-JPEG),
      auto-detect image, Umbenennung + Mitbenennen Bild/Audio, Kollision, scaffold true/false.
      Property 3 (tasting_date nie überschrieben), 4 (scaffold=true Vollständigkeit +
      Werterhaltung), 5 (scaffold=false keine null/leeren Felder) in test_properties.py
      mit Tags `# Feature: weinliste, Property 3/4/5: …`.
      Files: scripts/tests/test_prepare.py, scripts/tests/test_properties.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_prepare.py scripts/tests/test_properties.py -q` grün.

- [ ] 8. Phase export (Task 5.1).
      `phase_export()`: alle JSON lesen, ohne `name` überspringen + Warnung, unbekannte
      Felder erhalten, absteigend nach `tasting_date` (ohne Datum ans Ende), valides
      JSON an `export_path` schreiben (`parent.mkdir(parents=True, exist_ok=True)`,
      `ensure_ascii=False`).
      Files: scripts/weinimport.py
      Verify: Tests Schritt 9 grün.

- [ ] 9. Tests Phase export (Task 5.2–5.6).
      `scripts/tests/test_export.py` (tmp_path): Sortierung, Felderhaltung, Dateischreiben.
      Properties 2 (ungültige Einträge ausgeschlossen), 6 (Sortiertinvariante), 7
      (JSON-Roundtrip), 8 (unbekannte Felder bewahrt) in test_properties.py mit Tags.
      Files: scripts/tests/test_export.py, scripts/tests/test_properties.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_export.py scripts/tests/test_properties.py -q` grün.

- [ ] 10. Phase image-export (Task 6.1).
      `phase_image_export()` wie Pseudocode: referenzierte Bilder ermitteln, fehlende
      mit Warnung überspringen, Pillow `thumbnail` für width/height-Modus (Seitenver-
      hältnis + `img.format` erhalten), Timestamp-Vergleich (`dst.st_mtime >= src.st_mtime`
      → überspringen), Originale nie verändern, Ziel in `image_export_dir` (mkdir).
      Files: scripts/weinimport.py
      Verify: Tests Schritt 11 grün.

- [ ] 11. Tests Phase image-export (Task 6.2–6.3).
      `scripts/tests/test_image_export.py` (tmp_path, Pillow `Image.new`): Skalierung,
      Timestamp-Check (kein Re-Export), Formaterhalt, fehlendes Bild → Warnung + weiter,
      Original unverändert. Property 9 (Seitenverhältnis-Toleranz 0.01) für beide Modi.
      Files: scripts/tests/test_image_export.py, scripts/tests/test_properties.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_image_export.py scripts/tests/test_properties.py -q` grün.

- [ ] 12. Phase backup + Rolling Window (Task 7.1).
      `phase_backup()`, `_prune_backups()` wie Pseudocode: `last_YYYY-MM-DD_HH-MM-SS`
      bei jedem Lauf (Rolling Window `max_last_backups`), `archival_*` nur wenn seit
      `backup/.last_archival` ≥ `archival_interval_days` vergangen (Rolling Window
      `max_archival_backups`), Zeitstempel in `.last_archival` persistieren, Fehler →
      Warnung auf stderr + Pipeline läuft weiter. (Remote-Backup-Einbindung folgt in Schritt 16.)
      Files: scripts/weinimport.py
      Verify: Tests Schritt 13 grün.

- [ ] 13. Tests Phase backup (Task 7.2–7.4).
      `scripts/tests/test_backup.py` (tmp_path, Zeit via monkeypatch/parametrisiert):
      Rolling Window last/archival, Intervall-Prüfung (fällig/nicht fällig),
      Fehlerbehandlung (copytree-Fehler → Warnung, kein Abbruch). Property 20 (Last
      Rolling Window ≤ N), 21 (Archival-Intervall ≥ D) in test_properties.py mit Tags.
      Files: scripts/tests/test_backup.py, scripts/tests/test_properties.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_backup.py scripts/tests/test_properties.py -q` grün.

- [ ] 14. Phase deploy + Transport-Helfer (Task 8.1).
      `phase_deploy()`: `resolve_password`, dann `_deploy_sftp`/`_deploy_ftp`; bei
      Verbindungs-Exception WORTWÖRTLICH Req 6.12: `FEHLER: Verbindung zum Server {host}
      fehlgeschlagen. Server-Meldung: {e}. Bitte prüfe: (1) Ist der Hostname '{host}'
      korrekt? (2) Sind Benutzername und Passwort gültig? (3) Ist der Server erreichbar
      und das Protokoll ({protocol}) korrekt?` + exit 1. Deploy-Logik: dist-Ordner
      (`remote_path`) veraltete Serverdateien löschen (SFTP listdir / FTP NLST),
      Timestamp-Vergleich (SFTP `stat().st_mtime`, FTP `MDTM`), `wines.json` (remote_path)
      + Bilder (`remote_images_path`) NIE löschen. Transport-Helfer
      `_upload_sftp/_upload_ftp/_download_sftp/_download_ftp` für Wiederverwendung.
      Files: scripts/weinimport.py
      Verify: Tests Schritt 17 grün.

- [ ] 15. Remote-Import-Download (Task 8.2, Teil 1).
      `download_remote_import(config, password)`: bei `import_source == "remote"` vor
      prepare `deploy.remote_import_path` nach `import_dir` syncen (SFTP/FTP, gleiche
      Helfer/Passwort wie deploy); bei Fehler lesbare Meldung mit Serverpfad +
      Server-Meldung (`FEHLER: Download des Import-Ordners von {host}:{remote_import_path}
      fehlgeschlagen. Server-Meldung: {e}`) + exit 1. In `main()` so verdrahten, dass
      der Download bei remote vor prepare läuft.
      Files: scripts/weinimport.py
      Verify: Tests Schritt 17 grün.

- [ ] 16. Remote-Backups in phase_backup einbinden (Task 8.2, Teil 2).
      `_remote_backup(config, last_name, archival_name)` via Transport-Helfer; in
      `phase_backup` aufrufen wenn `backup.remote_backup_dir` + `deploy` gesetzt; Fehler
      → Warnung, Pipeline läuft weiter (Req 19.7, 19.9).
      Files: scripts/weinimport.py
      Verify: Tests Schritt 17 grün.

- [ ] 17. Tests deploy + Remote-Download (Task 8.3).
      `scripts/tests/test_deploy.py`: Transport mit Fakes/monkeypatch (keine echten
      Verbindungen). Timestamp-Vergleich (kein Re-Upload bei aktueller Serverdatei),
      selektives Löschen (dist ja, wines.json/Bilder nie), Passwort-Fallback über Env,
      fehlendes Passwort → SystemExit(1) + Req-6.11-Wortlaut, Verbindungsfehler →
      SystemExit(1) + Req-6.12-Wortlaut, Download-Fehler → SystemExit(1).
      Files: scripts/tests/test_deploy.py
      Verify: `.venv/bin/python -m pytest scripts/tests/test_deploy.py -q` grün.

- [ ] 18. Build-Pipeline (Task 9.1).
      `Makefile` mit Targets `prepare`, `export`, `image-export` (einzeln, rufen
      `python scripts/weinimport.py <phase>`) und `deploy` (volle Pipeline:
      prepare→export→image-export, dann `cd frontend && ng build`, dann
      `python scripts/weinimport.py deploy`). `frontend/package.json` minimal mit
      scripts-Block inkl. `prebuild` (`python ../scripts/weinimport.py prepare &&
      … export && … image-export`, Abbruch bei Fehler via `&&`) — Hinweis: wird später
      von Task 15 erweitert. `.github/workflows/deploy.yml`: Push auf main → setup-python
      3.12 + setup-node, pip install requirements, (bei remote) Download via Skript,
      prepare/export/image-export, `npm run build`, deploy; `WEINSPRECHSTUNDE_DEPLOY_PASSWORD`
      aus Secrets als Env.
      Files: Makefile, frontend/package.json, .github/workflows/deploy.yml
      Verify: `make -n deploy` listet die erwarteten Phasen; `python -c "import json,sys; json.load(open('frontend/package.json'))"` ok; `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"` ok (falls PyYAML vorhanden, sonst YAML-Lint überspringen).

- [ ] 19. Checkpoint (Task 10): Gesamte pytest-Suite grün.
      Files: —
      Verify: `.venv/bin/python -m pytest scripts/tests -q` — alle Unit- und
      Property-Tests (Properties 1–9, 18, 20, 21) bestehen; `.venv/bin/python
      scripts/weinimport.py prepare && … export && … image-export` gegen `import/`
      läuft ohne Fehler durch.
