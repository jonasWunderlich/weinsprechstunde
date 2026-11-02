# Implementation Plan — FTPES-Deploy + Frontend-Entkopplung (Option B)

Grundlage: `.agents/tasks/transparent-rewrite-deploy-plan.md` (gelesen, gegen Code
abgeglichen). Wo der Auftragstext den Recherche-Plan präzisiert, folgt dieser Plan dem
**Auftragstext** — insbesondere: der Nutzer hat **Option B (strikte Trennung)** gewählt
(der Recherche-Plan empfahl Option A; diese Abweichung ist verbindlich), und FTPES ist
das einzige Protokoll (SFTP/paramiko komplett raus).

Baseline verifiziert vor Planung:
- `.venv/bin/python -m pytest scripts/tests/test_deploy.py scripts/tests/test_config.py -q` → **24 passed**
- `cd frontend && npx ng test --watch=false` → **69 passed (10 files)**
- `ng build` erzeugt aktuell `dist/ng-weinsprechstunde/browser/` mit gebündeltem
  `images/`, `assets/wines.json`, `assets/wine-schema.json` (verifiziert per `ls`).

Build/Test-Kommandos (entdeckt):
- Python-Tests: `.venv/bin/python -m pytest scripts/tests -q` (cwd = Repo-Root)
- Frontend-Tests: `npx ng test --watch=false` (cwd = `frontend/`, vitest/jsdom)
- Build: `npx ng build` (cwd = `frontend/`)

## Verbindliche Design-Entscheidungen (grounded in code)

1. **Protokoll = FTPES, SFTP entfällt vollständig.** Vorlage ist der funktionierende
   `scripts/ftps_probe.py` (`FTP_TLS` + `ssl._create_unverified_context()` +
   `auth()`/`login()`/`prot_p()`/`set_pasv(True)`). Grund: Zertifikat hat CN/SAN leer
   (Hostname-Mismatch auf Shared Hosting), daher `FTPS_VERIFY=0`-Default. `protocol`
   in der Config wird zu `"ftpes"` normiert; der sftp-Branch wird gelöscht, nicht nur
   übersprungen.

2. **Kein Pre-Deploy-Backup.** `SITE HELP` auf diesem Pure-FTPd zeigt nur
   ALIAS/CHMOD/IDLE/UTIME → CPFR/CPTO fehlt, der Mechanismus funktioniert ohnehin nicht;
   der Nutzer will ihn nicht. Der gesamte Predeploy-/SSH-Exec-Pfad wird entfernt.
   Deploy-Reihenfolge danach: Upload dist → Prune (nur in `wine_app`) → wines.json/schema
   → Bilder.

3. **Deploy-Ziele.** `remote_path = /wine_app`, `remote_images_path = /wine_app/images`,
   `remote_import_path = /wine_app/data`. Damit liegen images/ und data/ unter base; der
   bestehende `_protected_prefixes`-Mechanismus greift. `_protected_prefixes` wird um den
   `data/`-Prefix (aus `remote_import_path` relativ zu base) erweitert, damit der Prune
   `data/` nie löscht (die wines.json/schema stammen nicht aus dem dist-Build).

4. **Frontend-Entkopplung (Option B, strikt) — gewählte, builder-konsistente Lösung.**
   `@angular/build:application` kopiert jeden `assets`-Eintrag (inkl. `public/**`) in
   `dist`. `assets` ist **pro Build-Configuration überschreibbar**
   (development/production). Deshalb:
   - **Top-Level `assets`**: nur `favicon.ico` (der `src/assets`-Glob entfällt, da
     `src/assets` nur noch wines.json/schema enthielte, die ausziehen).
   - **`production`-Configuration** (Default von `ng build`): `assets` = nur
     `favicon.ico` → **dist enthält KEIN `images/` und KEIN `assets/wines.json`**.
   - **`development`-Configuration** (`ng serve`): `assets` zusätzlich um
     `public/data` (→ `/data/...`) und `public/images` (→ `/images/...`) erweitert, damit
     lokal `data/wines.json`, `data/wine-schema.json` und `/images/<datei>` erreichbar
     sind, OHNE in den Production-Build zu gelangen.
   - `export_path` wird von `./frontend/src/assets/wines.json` auf `./export/data/wines.json`
     geändert; `wine-schema.json` wird für das lokale Serven ebenfalls nach `export/data/`
     bereitgestellt (Symlink `public/data` → `../../export/data`). Der Images-Symlink
     `frontend/public/images → ../../export/images` bleibt, wird aber nur in der
     development-Configuration als Asset eingebunden.
   - `WineDataService` lädt `data/wines.json` + `data/wine-schema.json` (statt
     `assets/...`). `IMAGE_BASE` bleibt `/images/` (absolut); `mediaSrc`-Verhalten und
     `wine-util.spec` bleiben unverändert.
   - Deploy lädt `export/data/*` → `remote_import_path` und `image_export_dir` →
     `remote_images_path`; der dist-Upload trägt weder data noch images.

5. **Secrets.** `host`/`user`/`password` raus aus der Config (nur `protocol`,
   `remote_path`, `remote_images_path`, `remote_import_path` bleiben). Auflöse-Reihenfolge
   je Feld: **Config-Wert (falls gesetzt) > Secrets-Datei > Env-Var**. Secrets-Datei
   `weinsprechstunde.secrets.json` (fester Pfad neben der Config, unversioniert,
   `.gitignore`); versioniert: `weinsprechstunde.secrets.example.json`. Env-Vars:
   `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` (existiert), neu `WEINSPRECHSTUNDE_DEPLOY_HOST`,
   `WEINSPRECHSTUNDE_DEPLOY_USER`. Fehlende Secrets-Datei ist KEIN Fehler. Die
   getesteten Passwort-Meldungen/Config-Vorrang (Req 6.11) bleiben unverändert.

6. **Root-.htaccess** wird versioniert unter `deploy/htaccess-webroot.txt` abgelegt
   (transparenter interner Rewrite nach `/wine_app/`, kein `R=`), NICHT vom Deploy-Skript
   verwaltet. Einmaliger manueller Upload + altes Root-`index.html` entfernen wird
   dokumentiert.

## Items

- [ ] 1. Secrets aus Config entkoppeln + Beispiel-Datei + .gitignore.
      `weinsprechstunde.config.json`: `deploy.host`/`user`/`password` entfernen,
      `protocol` → `"ftpes"`, `remote_images_path` → `/wine_app/images`,
      `remote_import_path` → `/wine_app/data`, `export_path` →
      `./export/data/wines.json`. Neue versionierte `weinsprechstunde.secrets.example.json`
      mit Platzhaltern (`host`/`user`/`password`). `.gitignore` um
      `weinsprechstunde.secrets.json` ergänzen (und den veralteten Eintrag
      `frontend/src/assets/wines.json` entfernen, da export_path umzieht).
      Files: `weinsprechstunde.config.json`, `weinsprechstunde.secrets.example.json`, `.gitignore`
      Verify: `.venv/bin/python -m pytest scripts/tests/test_config.py -q` — grün (nach Item 2);
      `git check-ignore weinsprechstunde.secrets.json` meldet die Datei.

- [ ] 2. `load_config` + Secrets-/Env-Auflösung in `scripts/weinimport.py`.
      `DeployConfig`-Felder `host`/`user`/`password` auf `""`-Default setzen, damit die
      aus der Config entfernten Felder nicht brechen (`DeployConfig(**raw["deploy"])`).
      In `load_config` nach dem Parsen optional `weinsprechstunde.secrets.json` (fester
      Pfad: neben der Config-Datei, `Path(path).resolve().parent`) laden; `host`/`user`/
      `password` in `DeployConfig` einspielen, NUR wenn der Config-Wert leer ist. Fehlende
      Secrets-Datei → kein Fehler. Danach je Feld Env-Fallback:
      `WEINSPRECHSTUNDE_DEPLOY_HOST`/`_USER` (neu) für host/user, Passwort bleibt in
      `resolve_password` (Config>Env, Meldung unverändert). host/user-Env-Fallback als
      eigener Helfer (z.B. `resolve_host`/`resolve_user`) oder in `load_config` eingespielt;
      Reihenfolge Config > Secrets > Env strikt einhalten.
      Files: `scripts/weinimport.py`
      Verify: `.venv/bin/python -m pytest scripts/tests/test_config.py scripts/tests/test_deploy.py -q`
      — bestehende Passwort-Tests (`test_password_from_config`, `test_password_from_env_fallback`,
      `test_missing_password_exits_with_req_6_11_message`) grün.

- [ ] 3. FTPES-Transport `_ftps_connect` + Umstellung aller FTP-Pfade; SFTP/paramiko
      entfernen. Neue Funktion `_ftps_connect(host,user,password) -> FTP_TLS` (Vorlage
      `ftps_probe.py`: `FTPS_VERIFY`-Env, Default unverified; `connect(host,21,timeout)`,
      `auth()`, `login()`, `prot_p()`, `set_pasv(True)`). `_deploy_ftp`, `_download_ftp`,
      `_remote_backup` (Import-Backup) auf `_ftps_connect` umstellen. Entfernen:
      `_deploy_sftp`, `_sftp_connect`, `_upload_sftp`, `_download_sftp`,
      `_sftp_download_dir`, `_sftp_makedirs`, `_upload_dir_sftp`, `_sftp_up_to_date`,
      `_sftp_prune`, sftp-Branches in `phase_deploy`/`download_remote_import`/
      `_remote_backup`, `import paramiko`. `protocol`-Semantik auf FTPES (kein sftp-Zweig).
      `paramiko==5.1.0` aus `scripts/requirements.txt` entfernen.
      Files: `scripts/weinimport.py`, `scripts/requirements.txt`
      Verify: `.venv/bin/python -m pytest scripts/tests/test_deploy.py -q` (nach Item 5,
      wenn die Tests umgestellt sind). Zwischenstand: `python -c "import ast;
      ast.parse(open('scripts/weinimport.py').read())"` fehlerfrei.

- [ ] 4. Pre-Deploy-Backup vollständig entfernen. Entfernen: Klasse `PreDeployBackupError`;
      Funktionen `_predeploy_remote_backup_dir`, `_max_predeploy_backups`,
      `_predeploy_server_backup_sftp`, `_predeploy_server_backup_ftp`,
      `_ftp_server_copy_dir`, `_prune_predeploy_backups_server`,
      `_prune_predeploy_backups_server_ftp`, `_ssh_exec`, `_shq`; Konstante
      `MAX_PREDEPLOY_BACKUPS`; Feld `BackupConfig.max_predeploy_backups`; die
      `_predeploy_server_backup_*`-Aufrufe in `_deploy_ftp`; den
      `except PreDeployBackupError`-Zweig in `phase_deploy`. `_ftp_rmtree` prüfen:
      wird nach Entfernen von `_prune_predeploy_backups_server_ftp` nur noch dort gebraucht
      → ebenfalls entfernen (keine anderen Aufrufer; per grep bestätigen). Deploy-Reihenfolge
      in `_deploy_ftp`: Upload dist → Prune → wines.json/schema → Bilder.
      Files: `scripts/weinimport.py`
      Verify: `grep -n "predeploy\|PreDeployBackup\|_ssh_exec\|MAX_PREDEPLOY" scripts/weinimport.py`
      liefert nichts; Parse-Check fehlerfrei. (Funktionaler Verify über Item 5.)

- [ ] 5. Prune-Scope + `_protected_prefixes` erweitern; Deploy auf data/schema umstellen.
      `_protected_prefixes` um den `data/`-Prefix erweitern: wenn `remote_import_path`
      unter `remote_path` liegt, zusätzlichen Prefix (relativ zu base + `/`) zurückgeben
      (analog zur bestehenden images-Logik). `_deploy_ftp`: nach dem dist-Upload/Prune
      die wines.json von `export_path` nach `remote_import_path` laden (nicht mehr unter
      `remote_path`), und — falls lokal vorhanden — `wine-schema.json` ebenfalls nach
      `remote_import_path`. Bilder weiter nach `remote_images_path`. Der dist-Upload darf
      keine `data/`/`images/`-Unterordner enthalten (die liegen nicht im Browser-Build,
      siehe Item 7); der Prune in `/wine_app` schützt `images/`, `data/` und — falls noch
      vorhanden — `wines.json` exakt.
      Files: `scripts/weinimport.py`
      Verify: über Item 6 (umgestellte Tests).

- [ ] 6. `scripts/tests/test_deploy.py` auf FTPES + kein-Backup umschreiben.
      Entfernen: alle Predeploy-Tests (`test_predeploy_backup_*`,
      `test_deploy_does_not_prune_when_backup_fails`,
      `test_backup_failure_message_is_distinct_from_connection_error`,
      `test_deploy_aborts_without_remote_backup_dir`,
      `test_predeploy_backup_respects_config_override`,
      `test_ftp_deploy_copies_remote_path_server_side_before_prune`,
      `test_ftp_deploy_does_not_prune_when_backup_fails`) sowie die SFTP-gebundenen Tests
      und Fakes (`FakeSFTP`, `FakeEntry`, `FakeChannel`, `FakeTransport`, `_patch_sftp`,
      `_backup_config`, `test_connection_failure_exits_with_req_6_12_message` mit `sftp`,
      `test_download_remote_import_error_exits` mit `_download_sftp`). `FakeFTP` zum
      `FTP_TLS`-Mock machen (`FTP_TLS` ist FTP-Subklasse): `_patch_ftp` patcht
      `wi.ftplib.FTP_TLS` und `wi._ftps_connect` so, dass der Fake ohne echte Verbindung
      zurückkommt (login/auth/prot_p/set_pasv als no-ops auf dem Fake). Neue/angepasste
      Tests: Deploy verbindet per `FTP_TLS` (gemockt); lädt dist nach `/wine_app`; prunt NUR
      dort; schützt `images/`+`data/`+`wines.json`; lädt wines.json nach `/wine_app/data`
      und Bilder nach `/wine_app/images`. Secrets-Tests (in test_config.py oder test_deploy.py):
      host/user/password aus Secrets-Datei; Config-Vorrang vor Secrets; Secrets vor Env; neue
      Env-Vars `_HOST`/`_USER`. `make_config`-Defaults in `conftest.py` ggf. auf `ftpes`
      + `/wine_app`-Pfade anpassen (ohne bestehende Passwort-Tests zu brechen).
      Files: `scripts/tests/test_deploy.py`, `scripts/tests/conftest.py`, `scripts/tests/test_config.py`
      Verify: `.venv/bin/python -m pytest scripts/tests -q` — alle grün; Anzahl melden.

- [ ] 7. Frontend-Entkopplung (Option B). `frontend/angular.json`: Top-Level `assets`
      auf nur `{"glob":"favicon.ico","input":"public"}` reduzieren (src/assets-Glob
      entfernen). In `configurations.production` KEINE zusätzlichen assets (dist clean).
      In `configurations.development` `assets` überschreiben mit favicon + zwei Einträgen,
      die `public/data` nach `/data` und `public/images` nach `/images` ausliefern (globs
      mit `output: "data"` bzw. `output: "images"`). Symlinks anlegen:
      `frontend/public/data → ../../export/data` (neu), `frontend/public/images →
      ../../export/images` (existiert). `frontend/src/assets/wine-schema.json` nach
      `export/data/wine-schema.json` verschieben/bereitstellen (die Datei wird lokal und
      per Deploy aus `export/data` geliefert; Projekt-Root `wine-schema.json` bleibt die
      Python-Schema-Quelle). `WineDataService.loadAll()`: `assets/wines.json` →
      `data/wines.json`, `assets/wine-schema.json` → `data/wine-schema.json`.
      `wine-data.service.spec.ts`: `expectOne('data/wines.json')` /
      `expectOne('data/wine-schema.json')` (alle drei Vorkommen inkl. `expectNone`).
      Files: `frontend/angular.json`, `frontend/public/data` (Symlink),
      `frontend/src/app/services/wine-data.service.ts`,
      `frontend/src/app/services/wine-data.service.spec.ts`,
      `export/data/wine-schema.json`
      Verify: `cd frontend && npx ng test --watch=false` — grün (Anzahl melden);
      `npx ng build` erfolgreich; danach prüfen und melden:
      `ls dist/ng-weinsprechstunde/browser` enthält KEIN `images/` und
      `ls dist/ng-weinsprechstunde/browser/assets` enthält KEIN `wines.json`.

- [ ] 8. Root-.htaccess versioniert ablegen + dokumentieren. `deploy/htaccess-webroot.txt`
      mit dem kommentierten Rewrite aus Abschnitt 4 des Recherche-Plans (RewriteEngine On;
      `.well-known` ausnehmen; `wine_app/` nicht erneut umschreiben; existierende Dateien
      unter `wine_app/` per `-f` ausliefern; SPA-Fallback auf `/wine_app/index.html`; alles
      interner Rewrite ohne `R=`). NICHT ins Deploy-Skript aufnehmen. Dokumentieren
      (README-Abschnitt oder im Plan/Spec), dass die Datei einmalig manuell in den Web-Root
      als `/.htaccess` hochzuladen ist und ein altes Root-`index.html` zu entfernen/umbenennen
      ist.
      Files: `deploy/htaccess-webroot.txt`, `README.md` (Abschnitt „Deploy / .htaccess")
      Verify: Datei existiert und enthält `RewriteEngine On` + `/wine_app/index.html`
      (Review liest sie). Kein Build betroffen.

- [ ] 9. `deploy.yml` CI-Env ergänzen. In die Schritte „Run import pipeline" und
      „Deploy to server" (und, falls `import_source=remote` je genutzt wird, in beide)
      `WEINSPRECHSTUNDE_DEPLOY_HOST: ${{ secrets.WEINSPRECHSTUNDE_DEPLOY_HOST }}` und
      `WEINSPRECHSTUNDE_DEPLOY_USER: ${{ secrets.WEINSPRECHSTUNDE_DEPLOY_USER }}`
      zusätzlich zum vorhandenen `_PASSWORD` aufnehmen, damit host/user in CI aus Env
      kommen (stehen nicht mehr in der Config, keine Secrets-Datei in CI).
      Files: `.github/workflows/deploy.yml`
      Verify: YAML-Parse (`python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
      falls PyYAML verfügbar, sonst visuelle Prüfung durch Review).

- [ ] 10. Spec nachziehen (`.kiro/specs/weinliste/requirements.md` + `design.md`).
      FTPES statt SFTP (Protokoll `"ftpes"`, Zertifikatsprüfung deaktiviert); Deploy nach
      Unterordner `wine_app` mit transparentem Root-.htaccess-Rewrite und base-href `/`;
      wines.json/wine-schema.json/Bilder laufzeit-geladen aus `data/` bzw. `/images/`
      statt gebündelt; kein Pre-Deploy-Backup mehr; Secrets-Datei + Env-Fallback (inkl.
      `_HOST`/`_USER`). Konkret: Req 6.3/6.8/6.9 auf FTPES + data/ anpassen;
      **Req 6.15–6.18 (Pre-Deploy-Backup) entfernen**; `DeployConfig`-Glossar (host/user/
      password jetzt aus Secrets/Env), `WineDataAsset`/Req 7 auf `data/`-Ladepfad; in
      `design.md` den SFTP-/paramiko-/Predeploy-Abschnitt (ca. Z. 559–616) und die
      requirements-Bibliothekstabelle (paramiko-Zeile) ersetzen. Spec und Code konsistent.
      Files: `.kiro/specs/weinliste/requirements.md`, `.kiro/specs/weinliste/design.md`
      Verify: `grep -ni "paramiko\|sftp\|predeploy\|pre-deploy-backup" .kiro/specs/weinliste/*.md`
      liefert keine veralteten Deploy-Aussagen mehr (Migrations-/Remote-Download-Erwähnungen
      ggf. auf FTPES umgestellt); Review prüft Konsistenz mit dem Code.

## Digest

Build/Test (heute grün):
- `.venv/bin/python -m pytest scripts/tests/test_deploy.py scripts/tests/test_config.py -q` → 24 passed
- `cd frontend && npx ng test --watch=false` → 69 passed (10 files)
- `cd frontend && npx ng build` → OK (dist enthält aktuell images/ + assets/wines.json — nach Item 7 nicht mehr)

### `weinsprechstunde.config.json`
Block `deploy` (aktuell): `protocol "sftp"`, `host`, `user`, `password ""`,
`remote_path "/wine_app"`, `remote_images_path "/images"`, `remote_import_path "/data"`.
Ändern zu: ohne host/user/password; `protocol "ftpes"`; `remote_images_path
"/wine_app/images"`; `remote_import_path "/wine_app/data"`. Top-Level `export_path`
`"./frontend/src/assets/wines.json"` → `"./export/data/wines.json"`.
Test: `scripts/tests/test_config.py::test_load_config_parses_nested_dataclasses` (nutzt eigene Inline-Config).

### `scripts/weinimport.py`
- `DeployConfig` (Z. ~90): `protocol,host,user,password,remote_path,remote_images_path,remote_import_path`
  → host/user/password mit Default `""`.
- `load_config` (Z. ~128): Secrets-Datei laden + einspielen (Config>Secrets), danach host/user-Env-Fallback.
- `resolve_password` (Z. ~210): unverändert (Config>Env, Meldung Req 6.11). Neu analog `resolve_host`/`resolve_user` (Config/Secrets>Env).
- Transport: neu `_ftps_connect`; `_deploy_ftp` (Z. ~870), `_download_ftp` (Z. ~250),
  `_remote_backup` (Z. ~300) auf `_ftps_connect` umstellen.
- Entfernen: `_sftp_*`, `_deploy_sftp` (Z. ~690), `import paramiko`, sftp-Branch in
  `phase_deploy` (Z. ~559) / `download_remote_import` (Z. ~341) / `_remote_backup`.
- Entfernen Predeploy: `PreDeployBackupError`, `_predeploy_*`, `_ftp_server_copy_dir`,
  `_prune_predeploy_backups_server*`, `_ssh_exec`, `_shq`, `MAX_PREDEPLOY_BACKUPS`,
  `BackupConfig.max_predeploy_backups`, `_ftp_rmtree` (nur vom Predeploy genutzt),
  `except PreDeployBackupError`-Zweig.
- `_protected_prefixes` (Z. ~790): data-Prefix ergänzen.
- `_deploy_ftp`: wines.json/schema → `remote_import_path`; Reihenfolge Upload→Prune→data→images.
Tests: `scripts/tests/test_deploy.py` (umgeschrieben), `scripts/tests/test_config.py`.
Verify: `.venv/bin/python -m pytest scripts/tests -q`.

### `scripts/requirements.txt`
Zeile `paramiko==5.1.0` (+ Kommentar) entfernen.
Test: keiner direkt; Build der venv.

### `scripts/tests/test_deploy.py` + `conftest.py`
Predeploy-/SFTP-Tests + Fakes raus; `FakeFTP` → FTP_TLS-Mock; neue FTPES-/Secrets-Tests.
`make_config`-Defaults ggf. auf `ftpes` + `/wine_app`. Verify: `pytest scripts/tests -q`.

### `frontend/angular.json`
`architect.build.options.assets` (Z. ~28): auf nur favicon reduzieren; `configurations.development`
um `public/data`→`/data`, `public/images`→`/images` erweitern; `production` ohne data/images.
Verify: `npx ng build` → dist ohne images/, ohne assets/wines.json.

### `frontend/src/app/services/wine-data.service.ts`
`loadAll()` (Z. 23–25): `'assets/wines.json'`→`'data/wines.json'`,
`'assets/wine-schema.json'`→`'data/wine-schema.json'`.
Test: `wine-data.service.spec.ts` — `expectOne('data/wines.json')` / `'data/wine-schema.json'`
(3 Vorkommen + `expectNone`). Verify: `npx ng test --watch=false`.

### `frontend/public/` (Symlinks)
`images → ../../export/images` (existiert, bleibt), neu `data → ../../export/data`.
`export/data/wine-schema.json` bereitstellen. Kein Test; über ng serve/build verifiziert.

### `.gitignore`
`weinsprechstunde.secrets.json` ergänzen; veralteten `frontend/src/assets/wines.json`-Eintrag
entfernen (export_path zieht um). Verify: `git check-ignore weinsprechstunde.secrets.json`.

### `.github/workflows/deploy.yml`
In `Run import pipeline` + `Deploy to server` `WEINSPRECHSTUNDE_DEPLOY_HOST`/`_USER` aus
Secrets ergänzen. Verify: YAML-Parse / Review.

### `deploy/htaccess-webroot.txt` (neu) + `README.md`
Kommentierter Rewrite; README-Doku zu manuellem Upload + altem index.html. Verify: Datei-Inhalt.

### `.kiro/specs/weinliste/requirements.md` + `design.md`
Req 6 auf FTPES/data/ umstellen, **6.15–6.18 entfernen**; design.md SFTP-/Predeploy-Abschnitt
(Z. ~559–616) + paramiko-Zeile ersetzen; Req 7/WineDataAsset auf `data/`. Verify: grep ohne
veraltete Deploy-Begriffe; Review-Konsistenzprüfung gegen Code.
