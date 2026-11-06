# Plan: Aufteilung der Python-Tests nach Domäne

Stand: nur gelesen und in einer Wegwerf-Kopie (`/tmp/ts`, danach gelöscht) erprobt. Im Repo wurde nichts geändert.

## 0. Kurzfassung

- Empfohlen: Unterordner `scripts/tests/{pipeline,deploy_ftp,config}/`, ein gemeinsames `conftest.py` bleibt in `scripts/tests/`, dazu eine neue `scripts/pytest.ini`. Marker braucht es nicht.
- Ergebnis im Experiment: 108 Tests, 64 in `pipeline` (inkl. Backup), 28 in `deploy_ftp`, 16 in `config`. Die Summe stimmt (64+28+16=108).
- Zwei Dateien müssen zerlegt werden:
  - `test_properties.py` mischt Pipeline und Backup (P20/P21).
  - `test_deploy.py` ist rein deploy-ftp, aber 31 KB groß. Optional in drei Dateien teilen.
- Zwei Stolpersteine, beide real reproduziert:
  1. `test_contract_fixtures.py` nutzt `Path(__file__).parents[2]`. Nach dem Verschieben in einen Unterordner scheitert er (`parents[3]` nötig).
  2. Ohne `pytest.ini` wird `rootdir` zum Unterordner, sobald man dort `pytest` startet. Dann wird das übergeordnete `conftest.py` nicht geladen (`ModuleNotFoundError: conftest`).
- Token-Ersparnis: Ein Pipeline-Agent liest statt 98,5 KB nur ca. 57 KB (inkl. conftest) und ein Deploy-Agent ca. 34 KB. Details in Abschnitt 6.

## 1. Inventar (geprüft mit `pytest --collect-only -q`, `wc -c`, grep nach `wi.`/`ft.`/`deploy.`/`backup_mod.`)

Gesamt 108 Tests, 98 512 Bytes in `scripts/tests/*.py`.

| Datei | Bytes | Tests | Getestete Funktionen | Domäne |
|---|---|---|---|---|
| conftest.py | 2 733 | – | lädt `weinimport` als `wi`; Helfer `make_config`, `default_schema`, `write_json`, `make_jpeg` | gemeinsam |
| test_archive_ignore.py | 6 160 | 7 | `collect_json_files`, `phase_prepare`, `phase_export`, `phase_image_export` | pipeline |
| test_backup.py | 10 115 | 12 (11 Funktionen, 1 parametrisiert x2) | `phase_backup`, `LAST_ARCHIVAL_FILE`, Remote-Teil über `ft._ftps_connect` | backup (Domäne pipeline) |
| test_config.py | 11 419 | 16 | `load_config`, `load_wine_schema`, Secrets- und Env-Vorrang, `import_dir`-Fallback | config |
| test_contract_fixtures.py | 1 122 | 1 | `phase_prepare`, `phase_export`, `load_wine_schema` | contract (pipeline) |
| test_deploy.py | 31 061 | 28 | `phase_deploy`, `resolve_password`, `_resolve_dist_dir`, `_ReuseTLS_FTP`, `download_remote_import`, `build_parser` | deploy-ftp |
| test_export.py | 2 057 | 5 | `phase_export` | pipeline |
| test_image_export.py | 4 882 | 8 | `phase_image_export` | pipeline |
| test_prepare.py | 9 346 | 20 | `phase_prepare`, `read_exif_date`, `SchemaField` | pipeline |
| test_properties.py | 19 617 | 13 | siehe unten | gemischt |

Prüfungen: Der einzige Import aus conftest ist `from conftest import ...`. Die Monkeypatch-Ziele sind `backup_mod.datetime` (5x), `ft._ftps_connect` (4x), `deploy._deploy_ftp` (1x) und `ft._download_ftp` (1x). Alle zeigen auf `weinlib`-Module, nicht auf die Fassade.

### 1a. test_properties.py (504 Zeilen, 19 617 Bytes)

| Zeilen | Inhalt | Bytes (ca.) | Ziel |
|---|---|---|---|
| 1–42 | Docstring, Imports, `fresh_dir`, `_counter`, Strategien | 1 652 | geteilt: `fresh_dir` braucht auch P20/P21 |
| 43–374 | P1 Rekursive Erfassung, P2 ohne Name, P3 tasting_date, P4 Scaffold true, P5 Scaffold false, P6 Sortierung, P7 JSON-Roundtrip, P8 unbekannte Felder, P9 Seitenverhältnis, P18 Schema-Roundtrip | 13 144 | pipeline |
| 375–463 | `_Frozen`, P20 Rolling Window, P21 Archival-Intervall, `_list_archival` | 3 302 | backup (pipeline) |
| 464–504 | `_decimal_places`, P23 Number-Normalisierung | 1 519 | pipeline |

Zuordnung nach getesteter Funktion:
- P1, P2 testen `collect_json_files`.
- P3 testet `phase_prepare`.
- P4 und P5 testen `apply_scaffold_mode`.
- P6 bis P8 testen `phase_export`.
- P9 testet `phase_image_export`.
- P18 testet `load_wine_schema` (Config-Funktion, aber Vertrag import-format, Produzent pipeline). Bleibt in pipeline.
- P20 und P21 testen `phase_backup` und `backup_mod.datetime`.
- P23 testet `phase_prepare` (Normalisierung).

Hinweis: Der Docstring (Zeile 2) nennt „Properties 1–9, 18, 20, 21“, obwohl auch P23 enthalten ist. Beim Splitten korrigieren.

### 1b. test_deploy.py (856 Zeilen, 31 061 Bytes): komplett deploy-ftp, kein Test gehört anderswohin

| Zeilen | Tests | Gegenstand | Bytes (ca.) | Vorschlag |
|---|---|---|---|---|
| 1–60 | `test_password_from_config`, `test_password_from_env_fallback` (testen `resolve_password`, definiert in `config.py`), `test_missing_password_exits_with_req_6_11_message`, `test_connection_failure_exits_with_req_6_12_message` | Passwort und Fehlermeldungen von `phase_deploy` | 2 154 | `test_deploy.py` |
| 61–207 | `FakeFTP`, `MlsdFakeFTP`, `_patch_ftp`, `_make_dist`, `_make_workspace_dist`, `_make_editor_dist` | Fake und Helfer | 4 689 | `deploy_ftp/_fakes` (siehe Abschnitt 2) oder in `test_deploy.py` |
| 209–552 | Upload, Prune, MLSD, `_resolve_dist_dir`, Force-Images (17 Tests) | Kernlogik | 12 980 | `test_deploy.py` |
| 553–561 | `test_force_images_cli_flag_parsed` (testet `wi.build_parser`, also `cli.py`) | CLI-Flag | 375 | bleibt in `test_deploy.py` (Thema `--force-images`) |
| 563–580 | `test_download_remote_import_error_exits` (`deploy.download_remote_import`, patcht `ft._download_ftp`) | Remote-Download | 636 | `test_ftp_transport.py` oder `test_deploy.py` |
| 582–658 | `test_ftps_connection_class_overrides_ntransfercmd`, `test_ntransfercmd_reuses_control_session_on_data_channel`, `test_ntransfercmd_no_reuse_when_not_prot_p` | `ftp_transport._ReuseTLS_FTP` | 2 549 | `test_ftp_transport.py` |
| 660–856 | Editor-Deploy (9 Tests: `_resolve_editor_dist_dir`, geschützte Prefixe, Upload, Skip-Fälle) | `_deploy_editor` | 7 674 | `test_deploy_editor.py` |

Die Tests 1–60 und 209–552 benutzen `FakeFTP` aus diesem File. Der Editor-Block (660–856) benutzt `_patch_ftp`, `_make_workspace_dist` und `_make_editor_dist` aus dem Helferblock 61–207.

Anmerkung: `test_backup.py` hat eine eigene, andere `FakeFTP`-Klasse (Zeile 190). Sie ist unabhängig von der in `test_deploy.py` und muss nicht zusammengelegt werden.

### 1c. Weitere Dateien

- `test_config.py`: alle 16 Tests betreffen nur `config.py`. Sie verwenden kein `make_config`, nur `conftest.weinimport`. `deploy.password`/`deploy.host` dort sind Config-Felder, kein Deploy-Code.
- `test_backup.py`: alle 12 Tests sind Pipeline-Domäne (Backup ist laut `domain-pipeline.md` Teil der Pipeline). Sie benötigen `ftp_transport` nur als Monkeypatch-Ziel (`test_remote_backup_*`, Zeilen 190–245).
- `test_prepare.py`, `test_export.py`, `test_image_export.py`, `test_archive_ignore.py`, `test_contract_fixtures.py`: reine Pipeline.

## 2. Zielstruktur

```
scripts/
  pytest.ini                       # NEU: rootdir fixieren, testpaths = tests
  tests/
    conftest.py                    # bleibt EINE Datei (Fixtures + Helfer, siehe unten)
    config/
      test_config.py                          (16)
    pipeline/
      test_prepare.py                         (20)
      test_export.py                          (5)
      test_image_export.py                    (8)
      test_archive_ignore.py                  (7)
      test_contract_fixtures.py               (1)
      test_properties_pipeline.py             (11: P1–P9, P18, P23)
      test_backup.py                          (12)
      test_properties_backup.py               (2: P20, P21)
    deploy_ftp/
      test_deploy.py                          (Kern, 4 + 17 + 1 = 22)
      test_ftp_transport.py                   (4: Download + 3x TLS)   # optional
      test_deploy_editor.py                   (9)                      # optional
```

Bei der Kernvariante (nur Verschieben, kein Zerlegen von `test_deploy.py`) wird `test_deploy.py` 28 Tests groß und 31 KB. Mit der optionalen Zerlegung ergeben sich ungefähr 21 KB, 3,2 KB und 7,7 KB. Der Editor-Block braucht dann die Fakes aus einem gemeinsamen Modul (z. B. `deploy_ftp/fakes.py`, dann `from fakes import ...`; Sonst Duplikat). Das ist der einzige Teil mit echtem Zusatzaufwand und der Grund, warum es optional bleibt.

### 2a. Entscheidung zum conftest

Nicht aufteilen. Gründe, geprüft:
- `from conftest import ...` löst über `sys.path` auf (kein Paket, `rootdir/conftest`-Stil). Ein zweites `conftest.py` in einem Unterordner würde denselben Modulnamen `conftest` haben und kollidiert mit dem obersten. Dann wäre `from conftest import make_config` nicht mehr eindeutig.
- Das gemeinsame `conftest.py` ist nur 2,7 KB groß. Eine Aufteilung spart praktisch nichts.
- Nutzung der Helfer: `make_config` wird von allen Domänen außer config genutzt, `write_json` von pipeline und backup, `make_jpeg` und `default_schema` nur von pipeline.

Falls Pipeline-Helfer (`make_jpeg`, `default_schema`, `fresh_dir`) künftig stören: in ein Hilfsmodul `scripts/tests/support_pipeline.py` verschieben, niemals in ein zweites `conftest.py`.

`fresh_dir` (aus `test_properties.py`) wird von P20/P21 mitbenutzt. Beim Zerlegen entweder nach `conftest.py` verschieben (5 Zeilen) oder in beiden neuen Property-Dateien duplizieren. Empfehlung: nach `conftest.py` (einziger Ort, `_counter` bleibt eindeutig).

### 2b. Aufruf pro Domäne (alle im Experiment mit 108 Tests gegengeprüft)

| Zweck | Befehl (aus dem Repo-Root) | Tests |
|---|---|---|
| alles | `.venv/bin/python -m pytest scripts/tests -q` | 108 |
| pipeline (inkl. Backup) | `.venv/bin/python -m pytest scripts/tests/pipeline -q` | 64 |
| deploy-ftp | `.venv/bin/python -m pytest scripts/tests/deploy_ftp -q` | 28 |
| config (Fundament) | `.venv/bin/python -m pytest scripts/tests/config -q` | 16 |
| Änderung an `ftp_transport.py` | `pytest scripts/tests/deploy_ftp scripts/tests/pipeline/test_backup.py -q` | 40 |
| Änderung an `config.py` | `pytest scripts/tests/config scripts/tests/pipeline scripts/tests/deploy_ftp -q` (alles) | 108 |

Zusätzlich möglich: `-k backup` (funktioniert auch ohne Marker, da die Dateien so heißen). Ein Marker `@pytest.mark.<domain>` ist nicht nötig. Der Ordnerpfad ist stabiler und der Agent muss die Testdatei nicht öffnen, um zu wissen, ob sie dazugehört.

### 2c. Makefile / CI / README

Aktuell: Das Makefile hat kein Test-Target, `deploy.yml` führt keine Tests aus und das README erwähnt keine Tests (geprüft per grep). Test-Aufruf steht nur in `.kiro/steering/weinlib-config.md` (`python -m pytest scripts/tests -q`).

Empfehlung: Targets ergänzen. Sie kosten nichts und geben Agenten einen kurzen Befehl:

```make
.PHONY: test test-pipeline test-deploy test-config
test:          ; $(PYTHON) -m pytest scripts/tests -q
test-pipeline: ; $(PYTHON) -m pytest scripts/tests/pipeline -q
test-deploy:   ; $(PYTHON) -m pytest scripts/tests/deploy_ftp -q
test-config:   ; $(PYTHON) -m pytest scripts/tests/config -q
```

`make deploy` sollte `test` nicht aufrufen (der Deploy baut nichts außer Artefakten und die Pipeline-Reihenfolge ist durch Vertrag festgelegt). CI: optionaler Schritt `make test` vor Deploy (5,5 s). Das ist ein Verhaltenswechsel und bleibt Entscheidung des Users (Frage 4).

## 3. Risiken (real geprüft, wo angegeben)

1. **Pfad-Tiefe** (reproduziert): `test_contract_fixtures.py` setzt `SCHEMA` und `FIXTURES` per `Path(__file__).resolve().parents[2]`. Im Unterordner `pipeline/` muss das `parents[3]` sein. Nach dem Anpassen: 108 passed. `conftest.py` nutzt `parents[1]`/`SCRIPT_PATH.parents[1]` und bleibt wegen unverändertem Ort korrekt. Prüfen: weitere `__file__`-Zugriffe in den Tests per grep.
2. **rootdir/confcutdir** (reproduziert): `cd scripts/tests/deploy_ftp && pytest` ohne Ini-Datei → `ModuleNotFoundError: No module named 'conftest'`. Mit `scripts/pytest.ini` (`testpaths = tests`) liefen beide Fälle grün: aus dem Unterordner (28 passed) und aus `scripts/` (108 passed).
3. **Basename-Kollision** (reproduziert): Ohne `__init__.py` müssen Testdateinamen über alle Ordner eindeutig sein. Eine zweite `test_config.py` in `deploy_ftp/` führte zu einem Collection-Fehler. Die Zielstruktur hat keine doppelten Namen (daher `test_properties_pipeline.py`/`test_properties_backup.py` statt zweimal `test_properties.py`). Keine `__init__.py` ergänzen, sonst funktioniert `from conftest import` nicht mehr so.
4. **Hypothesis-Datenbank**: `.hypothesis/` liegt im aktuellen Arbeitsverzeichnis. Vorhanden sind `scripts/tests/.hypothesis` und `/.hypothesis` im Repo-Root. Beide enthalten ein eigenes `.gitignore`, kein Git-Problem. Die Ablage ist nur ein Cache; wer aus anderem Ordner startet, legt einen weiteren an. Optional in `pytest.ini`: `addopts = -p no:cacheprovider` ist nicht nötig; stattdessen ein einheitlicher Aufruf aus dem Repo-Root (Makefile) reicht.
5. **Monkeypatch-Ziele**: Alle Ziele sind `weinlib.*`-Module (`backup_mod`, `ft`, `deploy`), keine Ordnerpfade. Das Verschieben ändert sie nicht. Beim Zerlegen von `test_deploy.py` muss jede neue Datei `from weinlib import deploy`/`ftp_transport as ft` selbst importieren.
6. **Test-IDs ändern sich** (Pfadpräfix): `scripts/tests/test_x.py::t` wird `scripts/tests/<ordner>/test_x.py::t`. Alle Einträge in Specs und Steering mit dem alten Pfad müssen mit (Abschnitt 5). Für die Vorher/Nachher-Prüfung wird nur der Teil nach dem letzten `/` verglichen.
7. **Gemeinsame Fakes**: Beim Zerlegen von `test_deploy.py` braucht der Editor-Block `FakeFTP`/`_patch_ftp`/`_make_*_dist`. Wird er ausgelagert, entsteht ein neues Hilfsmodul (kein `conftest`). Das ist der einzige Teil mit Mehraufwand.
8. **Fassade `wi`**: Die Tests laden alles über `weinimport.py`. Jede Domäne lädt dadurch alle Module (Importzeit 0,1 s, kein Problem). Ein Test der Domäne X kann also unbemerkt Y importieren. Das ist kein Token-Thema, nur eine Isolationsfrage.
9. **Laufzeit**: 108 Tests laufen 5,5 s, davon 3,2 s allein P9. Parallelisierung oder getrennte Läufe sparen Zeit kaum, relevant ist nur der Lese-Aufwand der Agenten.

## 4. Migrationsreihenfolge

Jeder Schritt endet mit `pytest scripts/tests -q` = 108 passed.

0. **Vorher-Stand sichern**: `.venv/bin/python -m pytest scripts/tests --collect-only -q | sed 's#.*/##' | grep :: | sort > /tmp/ids_before.txt`. (108 Zeilen; `sed` entfernt den Ordnerpfad, `test_backup.py::...[kein-datum]` bleibt erhalten.)
1. **`scripts/pytest.ini`** anlegen (`[pytest]`, `testpaths = tests`). Noch nichts verschoben; 108 grün. Damit ist Risiko 2 vorab beseitigt.
2. **config/**: `git mv scripts/tests/test_config.py scripts/tests/config/`. 108 grün.
3. **deploy_ftp/**: `git mv test_deploy.py` nach `deploy_ftp/`. 108 grün.
4. **pipeline/ (ganze Dateien)**: `git mv` von `test_prepare.py`, `test_export.py`, `test_image_export.py`, `test_archive_ignore.py`, `test_backup.py`, `test_contract_fixtures.py`; dort `parents[2]` → `parents[3]` ändern. `test_properties.py` vorläufig mit verschieben. 108 grün.
5. **test_properties.py zerlegen**: `fresh_dir` + `_counter` nach `conftest.py`; Zeilen 375–463 (P20, P21, `_Frozen`, `_list_archival`) nach `pipeline/test_properties_backup.py`; Rest nach `pipeline/test_properties_pipeline.py`. Imports pro Datei bereinigen (`backup_mod`, `datetime` nur im Backup-Teil). Docstring korrigieren (P23). 108 grün; `pipeline` = 64.
6. **Optional: `test_deploy.py` zerlegen** (`test_ftp_transport.py`, `test_deploy_editor.py`, Hilfsmodul `fakes.py` für `FakeFTP`/`MlsdFakeFTP`/`_patch_ftp`/`_make_*`). 108 grün; `deploy_ftp` = 28.
7. **Nachher-Stand prüfen**: `pytest scripts/tests --collect-only -q | sed 's#.*/##' | grep :: | sort > /tmp/ids_after.txt`; `diff /tmp/ids_before.txt /tmp/ids_after.txt` muss leer sein. Hinweis: `test_properties.py::…` wird zu `test_properties_pipeline.py::…`/`test_properties_backup.py::…`. Dafür vor dem Diff `sed 's/test_properties_[a-z]*\.py/test_properties.py/'` anwenden. Zusätzlich `pytest scripts/tests -q` meldet „108 passed“ und die drei Domänenzahlen ergeben 64+28+16.
8. **Makefile-Targets, Steering, Specs, README** (Abschnitt 5) in einem eigenen Commit.

Rollback ist trivial: nur `git mv` und Textänderungen, kein Produktivcode betroffen.

## 5. Anpassungen an Steering/Specs/README

- `.kiro/steering/domain-pipeline.md` (Scope, Zeile 8): „Tests in `scripts/tests/`“ → „Tests in `scripts/tests/pipeline/` (inkl. Backup und Vertrags-Fixture); Konfig-Tests in `scripts/tests/config/`“. Ergänzen: „Nur `scripts/tests/pipeline` ausführen (`make test-pipeline`); nicht lesen: `scripts/tests/deploy_ftp`“.
- `.kiro/steering/domain-deploy-ftp.md`: Scope um `scripts/tests/deploy_ftp/` erweitern, Hinweis „nur diesen Ordner lesen/ausführen“. Bestehende Regel „Änderungen an `ftp_transport.py` erfordern Backup-Tests“ präzisieren: `scripts/tests/pipeline/test_backup.py` (nur diese Datei, nicht den ganzen Pipeline-Ordner).
- `.kiro/steering/weinlib-config.md` (Zeile 7): Prüfbefehl `python -m pytest scripts/tests -q` bleibt richtig, denn `config.py` ist Fundament. Zusätzlich: „Schnellprüfung zuerst `scripts/tests/config`“.
- `.kiro/steering/weinlib-pipeline.md` und `weinlib-deploy-ftp.md`: je einen Satz „Tests: `scripts/tests/pipeline` bzw. `scripts/tests/deploy_ftp`“. fileMatch-Muster bleiben unverändert (sie gelten für Quelldateien). Optional: eigene fileMatch-Datei `scripts/tests/pipeline/**` → `domain-pipeline.md` und `scripts/tests/deploy_ftp/**` → `domain-deploy-ftp.md`, damit das passende Steering beim Öffnen von Tests geladen wird.
- Verträge und Specs mit dem alten Pfad `scripts/tests/test_contract_fixtures.py` (per grep gefunden): `.kiro/specs/contracts/{import-format,editor-output,export-format,contracts-index}.md`, `.kiro/specs/pipeline/design.md:153`, `.kiro/specs/pipeline/tasks.md:5`. Neuer Pfad `scripts/tests/pipeline/test_contract_fixtures.py`. Hinweis: Das ist eine Pfadänderung ohne Inhaltsänderung des Vertrags. Ob dafür eine Versionsanhebung nötig ist, ist Frage 5. `.kiro/specs/deploy-ftp/design.md:59` (Testing Strategy) um den Ordner `scripts/tests/deploy_ftp` ergänzen.
- `.kiro/specs/pipeline/design.md:133,150`: „pipeline testet sie in `scripts/tests`“ → `scripts/tests/pipeline`.
- `README.md`: enthält keinen Test-Abschnitt. Kurzen Abschnitt „Tests“ mit den `make test*`-Targets ergänzen.
- `.agents/tasks/weinimport-module-split-plan.md` Abschnitt 6 ist als Historie zu betrachten und nicht anzupassen.

## 6. Erwartete Token-Ersparnis (Bytes der zu lesenden Tests; Grobschätzung 1 Token ≈ 4 Bytes)

Vorher (jeder Agent liest/führt `scripts/tests` aus): 98 512 Bytes ≈ 24,6 k Tokens.

| Agent | Nachher: Bytes | Anteil | Tokens ca. |
|---|---|---|---|
| pipeline (inkl. Backup, ohne config) | prepare 9 346 + export 2 057 + image 4 882 + archive 6 160 + contract 1 122 + props-pipeline ≈ 16 300 + backup 10 115 + props-backup ≈ 4 000 + conftest 2 733 ≈ **56 700** | 58 % | ≈ 14,2 k |
| deploy-ftp (ohne config) | test_deploy 31 061 + conftest 2 733 = **33 800** (Kern 3-fach geteilt: ca. 21 k, wenn nur der Kern gebraucht wird) | 34 % | ≈ 8,5 k |
| config-Änderung (nur Konfig-Tests) | test_config 11 419 + conftest 2 733 = **14 150** | 14 % | ≈ 3,5 k |
| Backup-Änderung | test_backup 10 115 + props-backup ≈ 4 000 + conftest 2 733 ≈ **16 850** | 17 % | ≈ 4,2 k |

Einsparung pro Aufgabe: pipeline ca. 42 %, deploy-ftp ca. 66 %, config ca. 86 %. Die Zahlen sind Bytes-Schätzungen aus den gemessenen Zeilenbereichen. Reale Tokenzahlen weichen ab (Umlaute, Code). Voraussetzung ist, dass der Agent nur den Ordner seiner Domäne liest. Das muss im Steering stehen (Abschnitt 5), sonst bleibt der Effekt aus.

## 7. Offene Entscheidungen für den User

1. **Ordner oder Dateipräfix?** Optionen: (a) Unterordner `pipeline/`, `deploy_ftp/`, `config/`; (b) flach mit Präfixen (`test_pipeline_*.py`). Empfehlung (a): Es ist per Pfad aufrufbar (`pytest scripts/tests/pipeline`), Steering kann einen Pfad nennen, und die Agenten-Regel „nicht lesen: `scripts/tests/deploy_ftp`“ ist eindeutig. Ich habe (a) mit `scripts/pytest.ini` real getestet (108 grün).
2. **Backup-Tests: unter `pipeline/` oder eigener Ordner `backup/`?** Optionen: (a) in `pipeline/` (so ordnet `domain-pipeline.md` Backup zu); (b) eigener Ordner. Empfehlung (a); `test_backup.py` + `test_properties_backup.py` sind per Dateiname einzeln aufrufbar. Die Abhängigkeit von `ftp_transport` bleibt über die Regel „bei Transportänderung `pipeline/test_backup.py` mitlaufen lassen“ abgedeckt.
3. **`test_deploy.py` (31 KB) zusätzlich zerlegen?** Optionen: (a) nur verschieben; (b) in Kern, `test_ftp_transport.py`, `test_deploy_editor.py` teilen (zusätzliches Hilfsmodul für Fakes). Empfehlung: (a) jetzt, (b) später als eigener Schritt, wenn die Datei weiter wächst. Das Token-Ziel ist mit (a) schon zu zwei Dritteln erreicht, (b) bringt für Deploy-Agenten höchstens weitere 10 KB.
4. **Test-Targets im Makefile und Test-Schritt in CI?** Optionen: (a) nur `make test*`-Targets; (b) zusätzlich `make test` in `deploy.yml` vor dem Deploy; (c) nichts. Empfehlung (a): kein Verhaltenswechsel bei Deploy. (b) wäre sinnvoll, ändert aber, wann ein Push deployt (rote Tests blockieren Deploy). Das ist deine Entscheidung.
5. **`resolve_password`-Tests (2 Tests in `test_deploy.py:14–25`) nach `config/` verschieben?** Sie testen `config.resolve_password`. Optionen: (a) in `deploy_ftp/` lassen; (b) nach `config/test_config.py`. Empfehlung (a): Das Passwort wird nur vom Deploy und vom Remote-Backup genutzt, und die Tests brauchen `make_config`/Deploy-Meldungen aus demselben File. Bei (b) bräuchte die config-Domäne `make_config`.
6. **Pfadänderung in den Verträgen (Test-Verweis `test_contract_fixtures.py`)**: Optionen: (a) Pfad anpassen ohne Versionsanhebung (Vertragsinhalt unverändert); (b) Patch-Version anheben mit Changelog. Empfehlung (a), da Produzent/Konsument und Semantik unverändert sind und die Regel „Vertragsänderung = Versionsanhebung“ sich auf den Vertragsinhalt bezieht. Wenn du lieber streng bist: (b).
7. **Pfadabhängigkeit der Fixture-Tests**: `parents[3]` ist fragil. Optionen: (a) bei `parents[3]` bleiben; (b) in `conftest.py` zwei Konstanten `REPO_ROOT`/`FIXTURES` bereitstellen. Empfehlung (b) im selben Schritt, da `conftest.py` bereits `SCRIPT_PATH` hat und der Pfad nie wieder von der Ordnertiefe abhängt.

## Was ich geprüft habe

- `pytest --collect-only -q` (108 Tests), `wc -c`/`wc -l` je Datei, Zeilenbereiche und Byte-Summen per Skript, `grep` nach `wi.`/`ft.`/`deploy.`/`backup_mod.`-Aufrufen und `monkeypatch.setattr`-Zielen, Steering-Dateien (`domain-*`, `weinlib-*`), `.gitignore`, `Makefile`, `deploy.yml`, README (kein Test-Hinweis).
- In einer Kopie in `/tmp/ts` die Zielstruktur gebaut und folgende Läufe geprüft: gesamt 108 grün (mit `pytest.ini`), `pipeline` 64, `deploy_ftp` 28, `config` 16, Start aus dem Unterordner, Basename-Kollision, Pfadtiefe der Contract-Fixture. Die Kopie ist gelöscht, das Repo ist unverändert.
- Nicht geprüft: Aufteilung von `test_deploy.py` in drei Dateien (nur anhand von Zeilenbereichen geplant), Token-Zahlen mit echtem Tokenizer (nur Bytes), Verhalten von Kiro-fileMatch-Mustern auf Testpfade.
