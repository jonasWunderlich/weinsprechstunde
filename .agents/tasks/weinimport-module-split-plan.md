# Plan: Modulsplit von scripts/weinimport.py

Nur gelesen, nichts geändert. Geprüft: `weinimport.py` (komplett strukturell, Schlüsselstellen im Detail), `scripts/tests/*` (conftest, alle `monkeypatch.setattr`-Stellen), `ftps_*probe.py`, Makefile, `.github/workflows/deploy.yml`, `.kiro/steering/*`, `.kiro/specs/{pipeline,deploy-ftp,contracts}`, README. Ist-Zustand: `.venv/bin/python -m pytest scripts/tests -q` → **106 passed** (5,6 s). Git: Arbeitsbaum sauber bis auf `.kiro/hooks/` und `ideas.md` (untracked). Nicht geprüft: der Split selbst (nichts umgesetzt), Token-Zahlen sind Byte-Schätzungen (Tokenizer nicht gemessen).

## 0. Kurzantwort

- Split in ein Paket `scripts/weinlib/` mit 6 Modulen. `scripts/weinimport.py` bleibt als dünne Fassade (Einstieg + Re-Exports). Dadurch bleiben `python scripts/weinimport.py <phase>`, Makefile, CI und Probe-Skripte **unverändert**.
- Hauptrisiko sind die **Tests mit `monkeypatch.setattr(wi, ...)`**: Re-Exports reichen dafür nicht, weil der Patch die Fassade trifft, nicht das Modul, das den Namen nachschlägt. 9 Patch-Stellen (5 Namen) müssen auf das definierende Modul umgestellt werden. Lesende `wi.<name>`-Zugriffe (ca. 130) laufen über Re-Exports unverändert.
- Verträge (`contracts/*`) sind **nicht** betroffen, keine Versionsanhebung. Steering/Specs brauchen reine Pfad-Updates (Domänen-Scope, Beschreibungen).
- Erwartete Ersparnis: Pipeline-Arbeit liest ~21 KB statt 50 KB (−57 %), Deploy-Arbeit ~28 KB (−44 %), Backup-Arbeit ~18 KB (−64 %).

## 1. Inventar weinimport.py (1279 Zeilen, 49 902 Bytes)

| Zeilen | Bytes | Inhalt | Domäne |
|---|---|---|---|
| 1–37 | 1 205 | Docstring, Imports, Konstanten `CONFIG_PATH`, `SECRETS_FILENAME`, `DEFAULT_IMPORT_DIRNAME`, `SCHEMA_PATH`, `LAST_ARCHIVAL_FILE` | config (`LAST_ARCHIVAL_FILE` → backup) |
| 39–137 | 3 098 | Dataclasses `Wine` (45, im Code nirgends verwendet), `SchemaField`, `BackupConfig`, `DeployConfig`, `OptimizeConfig`, `EditorConfig`, `Config` | config |
| 139–224 | 3 518 | `load_config` (144, inkl. Secrets, import_dir-Fallback), `load_wine_schema` (212), `get_scaffold_fields` (222) | config |
| 226–281 | 1 954 | `ARCHIVE_DIR_NAME`, `collect_json_files`, `slugify_name`, `find_image_sibling`, `read_exif_date` | pipeline |
| 283–296 | 596 | `resolve_password` (Config/Env, `sys.exit(1)`) | config/secrets |
| 298–425 | 5 552 | Transport: `_ReuseTLS_FTP`, `_ftps_connect`, `_upload_ftp`, `_download_ftp`, `_ftp_is_dir`, `_ftp_list_entries`, `_ftp_download_dir` | deploy-ftp (Fundament) |
| 426–549 | ~4 600 | `phase_backup` (431), `_prune_backups` (494), `_remote_backup` (515) | backup (Spec: pipeline Req 20; nutzt FTP) |
| 551–560 | ~430 | `_ftp_makedirs` | deploy-ftp (Transport; von backup UND deploy genutzt) |
| 562–585 | 880 | `download_remote_import` (567) | deploy-ftp (Remote-Import-Download) |
| 586–813 | 9 062 | `IMAGE_EXTENSIONS`, `collect_image_files`, `optimize_image`, `phase_optimize_images`, `phase_prepare`, `rename_file_group`, `normalize_number_fields`, `_round_to_decimals`, `apply_scaffold_mode` | pipeline |
| 814–842 | 988 | `phase_export` | pipeline |
| 843–891 | 1 635 | `phase_image_export` | pipeline |
| 892–1188 | 13 425 | `phase_deploy`, `PUBLIC_APP_PROJECT`, `EDITOR_APP_PROJECT`, `_resolve_dist_dir`, `_resolve_editor_dist_dir`, `_local_dist_files`, `_protected_prefixes`, `_is_protected`, `_deploy_ftp`, `_deploy_editor`, `_ftp_up_to_date` (nutzt `datetime.strptime`), `_ftp_prune` | deploy-ftp |
| 1189–1279 | 2 951 | `_run_full_pipeline`, `build_parser`, `main` | cli |

Kopplungen (aus Code gelesen, Zeilen von `weinimport.py`):
- `deploy`-Abschnitt (892–1188) ruft **keine** Pipeline-Funktion auf; er nutzt nur `Config`, `resolve_password`, Transport und `_ftp_makedirs`.
- `phase_backup` (Pipeline-Spec Req 20) ruft über `_remote_backup` den Transport (`_ftps_connect` 542, `_ftp_makedirs` 544, `_upload_ftp` 546). Das ist die einzige Pipeline→FTP-Kante.
- `download_remote_import` (567) nutzt `_download_ftp`; `main` und `_run_full_pipeline` rufen es vor prepare/optimize.
- Pipeline-Funktionen (586–891) nutzen nur `Config`, `SchemaField`, die Helfer aus 226–281.
- `shutil`, `datetime` werden in `phase_backup` genutzt, `datetime` zusätzlich in `_ftp_up_to_date` (1147).

## 2. Zielstruktur

Name des Pakets: **`scripts/weinlib/`**, nicht `scripts/weinimport/`. Ein Paket `weinimport/` neben `weinimport.py` ist mehrdeutig: `import weinimport` lädt das Paket, das File bliebe nur per Pfad ausführbar, und `conftest` lädt per `spec_from_file_location` das File und registriert es als `sys.modules["weinimport"]`.

```
scripts/
  weinimport.py        # Fassade ~1,5 KB: sys.path-Insert, Re-Exports, main()-Aufruf
  weinlib/
    __init__.py        # leer
    config.py          # ~7,6 KB
    ftp_transport.py   # ~6,0 KB
    pipeline.py        # ~13,7 KB
    backup.py          # ~4,7 KB
    deploy.py          # ~14,3 KB
    cli.py             # ~3,0 KB
```

| Modul | Inhalt | Domäne |
|---|---|---|
| `config.py` | Konstanten (CONFIG_PATH, SECRETS_FILENAME, DEFAULT_IMPORT_DIRNAME, SCHEMA_PATH), alle Dataclasses inkl. `Wine`, `load_config`, `load_wine_schema`, `get_scaffold_fields`, `resolve_password` | shared Fundament (Python) |
| `ftp_transport.py` | `_ReuseTLS_FTP`, `_ftps_connect`, `_upload_ftp`, `_download_ftp`, `_ftp_is_dir`, `_ftp_list_entries`, `_ftp_download_dir`, `_ftp_makedirs` | deploy-ftp |
| `pipeline.py` | `ARCHIVE_DIR_NAME`, `IMAGE_EXTENSIONS`, Helfer, `phase_optimize_images`, `phase_prepare`, `phase_export`, `phase_image_export`, `apply_scaffold_mode` usw. | pipeline |
| `backup.py` | `LAST_ARCHIVAL_FILE`, `phase_backup`, `_prune_backups`, `_remote_backup` | pipeline (Spec Req 20), nutzt Transport |
| `deploy.py` | `phase_deploy`, `_deploy_ftp`, `_deploy_editor`, Dist-Auflösung, Schutzlogik, `_ftp_up_to_date`, `_ftp_prune`, `download_remote_import` | deploy-ftp |
| `cli.py` | `_run_full_pipeline`, `build_parser`, `main` | Orchestrierung (keine Fachlogik) |

Abhängigkeitsrichtung (azyklisch, nur nach unten):

```
weinimport.py (Fassade) -> cli -> pipeline, backup, deploy
pipeline -> config, backup   (phase_export ruft phase_backup vor dem Schreiben)
backup   -> config, ftp_transport
deploy   -> config, ftp_transport
ftp_transport -> (nur stdlib)
config   -> (nur stdlib)
```

`pipeline` importiert `backup` (und transitiv `ftp_transport`), aber nie `deploy`. Das ist der Gewinn für die Token-Ersparnis. `config.py` bleibt gemeinsames Fundament, weil `Config` `DeployConfig`/`BackupConfig` aggregiert. Eine weitere Aufteilung der Dataclasses wäre ein Zyklus-Risiko ohne Nutzen (3 KB).

Wichtige Konvention für Mock-Fähigkeit: `backup.py` und `deploy.py` importieren `from weinlib import ftp_transport as ft` und rufen `ft._ftps_connect(...)`, `ft._upload_ftp(...)`, `ft._ftp_makedirs(...)`, `ft._download_ftp(...)`. So gibt es **einen** Patch-Punkt für alle Konsumenten. Ein `from ... import _ftps_connect` würde zwei getrennte Patches erzwingen.

Eigenheit der Fassade: `python scripts/weinimport.py` hat `scripts/` automatisch in `sys.path`. Bei `conftest` (Laden per Dateipfad) nicht. Deshalb setzt die Fassade selbst `sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))`, bevor sie `weinlib` importiert. Damit ist keine conftest-Änderung nötig. `ftps_deploy_probe.py` fügt `scripts/` ohnehin selbst ein.

## 3. Rückwärtskompatibilität

Unverändert zu halten (alle gelesen):
- Makefile Z. 23, 27, 31, 35, 48: `$(PYTHON) scripts/weinimport.py <phase> [--force-images]`.
- `.github/workflows/deploy.yml` Z. 35, 51: `python scripts/weinimport.py prepare && ... export && ... image-export`, `... deploy`. `pip install -r scripts/requirements.txt` bleibt. Kein `paths:`-Filter vorhanden, das neue Verzeichnis löst also nichts Zusätzliches aus.
- `ftps_deploy_probe.py` Z. 29/70: `import weinimport`, `weinimport._ReuseTLS_FTP`. Das läuft über Re-Export. `ftps_probe.py` und `ftps_upload_probe.py` importieren weinimport nicht.
- Tests: `conftest.py` lädt `scripts/weinimport.py` per `spec_from_file_location`, nutzt `weinimport.DeployConfig`, `EditorConfig`, `Config`, `SchemaField`.
- `__pycache__/` und `*.pyc` sind in `.gitignore`, also kein Problem für `weinlib/`.

Lösung: Fassade mit **expliziten** Re-Exports (keine Wildcards, damit die Namensliste greppbar ist), z. B. `from weinlib.config import (CONFIG_PATH, Config, ...)`. `if __name__ == "__main__": main()` bleibt in der Fassade.

Gelesene Zugriffe der Tests (Namen, die die Fassade re-exportieren muss; Häufigkeit aus grep): `phase_prepare` 20, `phase_deploy` 16, `phase_image_export` 14, `load_config` 14, `phase_export` 8, `phase_backup` 6, `_ReuseTLS_FTP` 6, `collect_json_files` 5, `load_wine_schema` 4, `resolve_password` 3, `_resolve_dist_dir` 3, `BackupConfig` 3, `apply_scaffold_mode` 2, `_resolve_editor_dist_dir` 2, `_is_protected` 2, `SchemaField` 2, `LAST_ARCHIVAL_FILE` 2, sowie je 1: `read_exif_date`, `get_scaffold_fields`, `download_remote_import`, `build_parser`, `_protected_prefixes`, `_ftps_connect`, `EditorConfig`, `DeployConfig`, `shutil`. Dazu `conftest`-Namen s. o.

**Tests, die beim Split brechen (Schreibzugriffe, 9 Stellen):**

| Datei:Zeile | Patch | Neues Ziel |
|---|---|---|
| `test_backup.py:46, 155, 172` | `monkeypatch.setattr(wi, "datetime", FrozenDatetime)` | `weinlib.backup` (dort `datetime`) |
| `test_properties.py:403, 436` | `monkeypatch.setattr(wi, "datetime", _Frozen)` | `weinlib.backup` |
| `test_backup.py:170` | `monkeypatch.setattr(wi.shutil, "copy2", boom)` | `shutil` direkt (`monkeypatch.setattr(shutil, "copy2", ...)`); funktioniert auch nur, weil `wi.shutil` das globale Modul ist. Alternativ `weinlib.backup.shutil`. |
| `test_backup.py:213, 233` | `setattr(wi, "_ftps_connect", ...)` | `weinlib.ftp_transport` |
| `test_deploy.py:160, 314` | `setattr(wi, "_ftps_connect", ...)` | `weinlib.ftp_transport` |
| `test_deploy.py:45` | `setattr(wi, "_deploy_ftp", boom)` | `weinlib.deploy` (`phase_deploy` sucht den Namen in `deploy`) |
| `test_deploy.py:567` | `setattr(wi, "_download_ftp", boom)` | `weinlib.ftp_transport` (nur mit `ft._download_ftp`-Konvention) |

Nicht betroffen: `monkeypatch.setattr(ftplib.FTP, "ntransfercmd", ...)` (test_deploy:619, 648) und `monkeypatch.chdir` (17×). Die Config- und Dist-Pfade sind relativ zum cwd (`CONFIG_PATH`, `Path("frontend/dist")`), nicht zum Modulort. Keine `Path(__file__)`-Nutzung in `weinimport.py` (nur `__name__` in Z. 1278).

Alternative, die ich ablehne: Fassade mit `__setattr__`-Weiterleitung (Proxy-Modul), damit Tests unverändert bleiben. Das ist Magie, versteckt Patch-Ziele und erschwert genau die Agent-Lesbarkeit, die der Split erreichen will. Neun Test-Zeilen anzupassen ist billiger und ehrlicher.

Empfehlung für die Tests: `conftest.py` zusätzlich Fixtures/Module-Handles anbieten (`from weinlib import backup, deploy, ftp_transport`), die Tests zugleich nach Domäne zuordnen (`test_backup.py` → backup, `test_deploy.py` → deploy+transport, Rest → pipeline). Dateiumbenennung ist nicht nötig.

## 4. Migrationsreihenfolge (jeder Schritt: `.venv/bin/python -m pytest scripts/tests -q` → 106 passed)

1. **Basis sichern**: Test-Lauf (grün, 106) und Smoke `.venv/bin/python scripts/weinimport.py --help`. Tag/Branch `pre-split` (Rollback-Anker).
2. **Paket anlegen + `config.py`**: Konstanten, Dataclasses, `load_config`, `load_wine_schema`, `get_scaffold_fields`, `resolve_password` verschieben (1:1 kopieren, nicht umschreiben). `weinimport.py` importiert sie aus `weinlib.config` (Fassade teilweise) und fügt `sys.path`-Insert ein. Tests grün (reine Leseprobe + `chdir`).
3. **`ftp_transport.py`**: Z. 298–425 + `_ftp_makedirs`. `weinimport.py` re-exportiert. Die internen Aufrufe in `backup`/`deploy`-Code noch im Monolithen verweisen vorerst auf die re-exportierten Namen; **Achtung**: die Tests mit `setattr(wi, "_ftps_connect")` brechen hier, falls interner Code den Namen nicht mehr in `wi` nachschlägt. Daher Schritt 3 und die Test-Umstellung (Patch auf `ft._ftps_connect`) im selben Commit, zusammen mit `ft.`-Aufrufen im Monolithen.
4. **`pipeline.py`**: Z. 226–281 (ohne `resolve_password`), 586–891. Reine Verschiebung, Tests grün.
5. **`backup.py`**: `phase_backup`, `_prune_backups`, `_remote_backup`, `LAST_ARCHIVAL_FILE`. Gleichzeitig die 5 `datetime`/`shutil`-Patches in `test_backup.py`/`test_properties.py` umstellen.
6. **`deploy.py`**: Z. 562–585 und 892–1188. Patches `_deploy_ftp`, `_download_ftp` umstellen.
7. **`cli.py`**: Z. 1189–1279. `weinimport.py` wird zur Fassade (Docstring behalten, kurz).
8. **Endprüfung**: volle Tests; `make -n all deploy` (Trockenlauf, ohne Netz); `python scripts/weinimport.py --help`; Import-Check der Probe `scripts/ftps_deploy_probe.py` (nur `python -c "import sys; sys.path.insert(0,'scripts'); import weinimport; weinimport._ReuseTLS_FTP"`, kein Netz). Echten Deploy nicht auslösen.
9. **Steering/Specs/README** nach Abschnitt 5 anpassen (eigener Commit).

Jeder Schritt = ein Commit, einzeln revertierbar. Risiken:
- Patch-Ziele (siehe oben): Tests grün sind nur aussagekräftig, wenn der Patch wirklich greift. Absicherung: nach Umstellung kurz prüfen, dass der Test ohne Patch scheitern würde (z. B. `_ftps_connect` würde sonst echtes Netz probieren).
- Zyklus bei falscher Platzierung von `_ftp_makedirs`/`resolve_password` (siehe Platzierung oben).
- `sys.path`-Insert in der Fassade: bei `conftest`-Laden muss `weinlib` als Top-Level gefunden werden; Name `weinlib` darf nicht mit einem installierten Paket kollidieren (nicht geprüft per `pip`, in `requirements.txt` steht es nicht).
- CI: `python scripts/weinimport.py` läuft auf Ubuntu mit Python 3.12; relative Importe vermeiden (absolut `from weinlib import ...`), weil die Fassade kein Paket ist.
- Hypothesis-Cache in `scripts/tests/.hypothesis` ist nicht ignoriert (untracked war er im `git status` nicht aufgelistet; `git check-ignore` meldet nichts). Kein Einfluss auf den Split.

Rollback: `git revert` der Split-Commits oder Reset auf `pre-split`; Makefile/CI müssen dabei nie angefasst werden.

## 5. Anpassungen an Steering/Specs/Verträgen

Verträge: **keine Änderung, keine Versionsanhebung.** Die Verträge beschreiben Daten (import/export-Format, deploy-input, build-output), nicht den Python-Aufbau. Einzige Python-Verweise sind die Testpfade `scripts/tests/test_contract_fixtures.py` (contracts-index.md:31, editor-output.md:43, export-format.md:39, import-format.md:48), die gleich bleiben.

Zu ändern (alle Pfadverweise gelesen):
- `.kiro/steering/domain-pipeline.md`: Scope und `description` nennen `scripts/weinimport.py`. Neu: `scripts/weinlib/{config,pipeline,backup}.py`, Fassade nur erwähnen. Nicht lesen: `deploy.py`, `ftp_transport.py`, `cli.py`.
- `.kiro/steering/domain-deploy-ftp.md`: Scope neu: `scripts/weinlib/{config,ftp_transport,deploy}.py`, `deploy/`, `*_probe.py`, `backup/`. Hinweis: `backup.py` nutzt den Transport, Änderungen am Transport erfordern Backup-Tests.
- `.kiro/steering/product.md` (Zeilen 13/14): Domänentabelle auf neue Pfade.
- `.kiro/steering/orchestration.md`: bleibt (ruft weiter `weinimport.py`). Optional ein Satz „Fassade". fileMatch bleibt `["Makefile", ".github/**"]`.
- **fileMatch-Chance**: Die Domänen-Steerings sind `inclusion: auto` (Beschreibung-getrieben). Optional zusätzlich je Domäne eine `fileMatch`-Datei (`scripts/weinlib/deploy.py`, `scripts/weinlib/ftp_transport.py` → deploy-ftp; `scripts/weinlib/pipeline.py`, `backup.py` → pipeline), damit der passende Kontext genau dann kommt, wenn die Datei offen ist. Das ist ein Zusatznutzen, kein Muss.
- `.kiro/specs/pipeline/requirements.md:3`, `design.md:3`: Domäne/Skriptpfad. `.kiro/specs/deploy-ftp/requirements.md:3`: Domäne. Die CLI-Befehlstabellen (`python weinimport.py ...`) bleiben gültig.
- Widerspruch in den Specs zur Zuordnung von `backup`: Pipeline-Spec Req 20 beansprucht `backup` (inkl. Remote-Upload), `product.md` und `domain-deploy-ftp.md` nennen „Server-Backups" bei deploy-ftp; `deploy-ftp/design.md:35` sagt „Kein Pre-Deploy-Backup". Klären (Frage Q1).
- `.kiro/specs/_archive/**`: **nicht anfassen** (historisch).
- `README.md:5`: Zeile „`scripts/weinimport.py` — Python-CLI" um „(Einstieg; Logik in `scripts/weinlib/`)" ergänzen. `README.md:31` bleibt.
- `scripts/requirements.txt:1` Kommentar: optional.
- `.agents/tasks/**`: historische Reports, nicht ändern.

## 6. Token-Ersparnis (Bytes, geschätzt aus Zeilenbereichen)

Vorher: jede Arbeit am Skript liest 49 902 B (~12–14 k Tokens bei 3,5–4 B/Token, Schätzung).

| Aufgabe | Zu lesen nachher | Bytes | vs. 49,9 KB |
|---|---|---|---|
| Pipeline (prepare/export/image) | config + pipeline | ~21,3 KB | −57 % |
| Backup | config + ftp_transport + backup | ~18,3 KB | −63 % |
| Deploy/Remote-Download | config + ftp_transport + deploy | ~27,9 KB | −44 % |
| CLI/Phasen-Wiring | cli (+ config für Parser-Defaults) | ~10,6 KB | −79 % |

Weitere Hebel: `config.py` enthält ~3 KB `load_config` und Dataclasses, die in jeder Aufgabe mitgelesen werden. Die Ersparnis steigt, wenn der Agent nur Teilbereiche (Dataclasses) liest. Die Tests sind mit 80+ KB (`test_deploy.py` 31 KB, `test_properties.py` 19,6 KB, `test_config.py` 11,4 KB) größer als jedes neue Modul. Wer wirklich Tokens sparen will, sollte danach die Tests nach Domäne trennen (`test_properties.py` enthält gemischte Domänen) oder in Steering „nur betroffene Testdatei lesen" festschreiben. Das ist ein Folgeschritt, nicht Teil dieses Splits.

## 7. Offene Entscheidungen

- **Q1: Wohin gehört `backup`?** (a) `backup.py` bleibt Pipeline-Domäne (Spec Req 20), nutzt `ftp_transport` als gemeinsames Fundament; (b) `backup.py` wird deploy-ftp zugeordnet (passt zu `product.md`: „Server-Backups"). Empfehlung **(a)** für den Code-Split, weil die Spec es der Pipeline zuordnet und `backup` im Standardlauf `_run_full_pipeline` vor prepare läuft. Dann `product.md` und `domain-deploy-ftp.md` angleichen: dort „Server-Backups" ersetzen durch „Remote-Upload als Transport-Nutzer".
- **Q2: Paketname.** (a) `scripts/weinlib/` (b) `scripts/weinimport/`-Paket und `weinimport.py` entfällt, Makefile/CI auf `python -m ...` umstellen (c) `scripts/wine/`. Empfehlung **(a)**: kein Namenskonflikt, Makefile/CI/Probes unberührt.
- **Q3: Tests anpassen oder Proxy-Fassade?** (a) 9 Patch-Stellen auf definierende Module umstellen (b) Proxy mit `__setattr__`-Weiterleitung. Empfehlung **(a)**, siehe Abschnitt 3.
- **Q4: Ein `pipeline.py` oder weiter teilen** (`pipeline/prepare.py`, `export.py`, `images.py`)? Empfehlung ein Modul (~13,7 KB): `phase_prepare` teilt Helfer mit `export`; weitere Dateien sparen kaum Tokens, erhöhen aber Importkomplexität.
- **Q5: `Wine`-Dataclass** (Z. 45) ist im Skript ungenutzt. (a) unverändert nach `config.py` verschieben (b) im Zuge des Splits löschen. Empfehlung **(a)**; der Split soll rein strukturell bleiben, Löschen separat. Ich habe nicht geprüft, ob Tests `wi.Wine` nutzen (grep-Zählung zeigt keinen Treffer).
- **Q6: Zusätzliche `fileMatch`-Steerings** für `scripts/weinlib/*`? Empfehlung **ja**, als eigener letzter Commit, weil es den Kontext dateischarf lädt.
- **Q7: Test-Dateien nach Domäne trennen** (Folgeschritt, s. Abschnitt 6)? Empfehlung **separat danach**, nicht im selben Branch.
