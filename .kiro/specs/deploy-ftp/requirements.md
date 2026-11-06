# Requirements: deploy-ftp (Build-Orchestrierung, FTPES-Deploy, CI)

Domäne: Phase `deploy` in `scripts/weinlib/{config,ftp_transport,deploy}.py` (Einstieg/Fassade: `scripts/weinimport.py`), `Makefile`, `.github/workflows/deploy.yml`. Deploy-Phase baut nichts; sie erwartet fertige Artefakte.

Verträge:
- #[[file:.kiro/specs/contracts/deploy-input.md]] (lokale Eingaben, Remote-Pfade, Invarianten)
- #[[file:.kiro/specs/contracts/build-output.md]] (Build-Befehle und Dist-Pfade)

## Glossar (nur deploy-ftp)

- **PhaseDeploy**: Phase `deploy`, überträgt Build-Output, `wines.json`, `wine-schema.json` und Bilder per FTPES (FTP mit explizitem TLS).
- **DeployConfig**: `deploy`-Objekt der Config (`protocol`, `remote_path`, `remote_images_path`, `remote_import_path`, `remote_editor_path`); `host`, `user`, `password` nur zur Laufzeit (Config > `weinsprechstunde.secrets.json` > Umgebung `WEINSPRECHSTUNDE_DEPLOY_HOST|USER|PASSWORD`).
- **GitHubSecrets**: Secret-Store; Werte werden als Umgebungsvariablen in den Workflow injiziert.

## Requirements

### Requirement 5: Build-Pipeline

5.1 Der Angular-Build (`npm run build` / `ng build`) läuft ohne Kopplung an das Import-Skript; kein `prebuild`-Schritt mit Import-Phasen.
5.2 `Makefile` (oder `build.sh`) macht `prepare`, `export`, `image-export` auch einzeln und unabhängig aufrufbar.
5.3 `Makefile` bietet `deploy`: prepare, export, image-export, Angular-Build, dann PhaseDeploy. Import-Phasen löst das Makefile aus, nicht der Angular-Build.
5.4 Das Skript ohne Phasenargument (`python script.py`) führt die Import-Phasen sequenziell aus.
5.5 Schlägt eine Import-Phase in Makefile/CI fehl → Abbruch vor Angular-Build bzw. Deploy.
5.6 `.github/workflows/deploy.yml` führt bei Push auf `main` die vollständige Pipeline aus. Bei `import_source = "remote"` lädt der Workflow den Import-Ordner vorher per FTPES. Der Workflow baut Weinliste und Editor; der Editor wird nur bei gesetztem `deploy.remote_editor_path` deployt. Host, User, Passwort kommen aus GitHub Secrets als `WEINSPRECHSTUNDE_DEPLOY_HOST|USER|PASSWORD`.

### Requirement 6: Phase deploy

6.1 Aufruf `python script.py deploy`.
6.2 Überträgt Angular Build-Output, `wines.json` und alle Dateien aus `image_export_dir` auf den Webserver.
6.3 Transport per FTPES (`deploy.protocol = "ftpes"`). Zertifikatsprüfung standardmäßig aus (Webspace-Zertifikat mit abweichendem Hostnamen), Verbindung bleibt TLS-verschlüsselt; `FTPS_VERIFY=1` aktiviert die reguläre Prüfung.
6.4 Lokale Datei nicht neuer als die Serverdatei → nicht erneut übertragen.
6.5 Datei im Build-Output lokal nicht mehr vorhanden, aber unter `deploy.remote_path` auf dem Server → auf dem Server löschen (Prune).
6.6 `wines.json`, `wine-schema.json` und Bilder werden auf dem Server nie gelöscht.
6.7 Build-Artefakte unter `deploy.remote_path`.
6.8 Bilder unter `deploy.remote_images_path` (`/wine_app/images`).
6.9 `wines.json` und `wine-schema.json` unter `deploy.remote_import_path` (`/wine_app/data`); Frontend lädt zur Laufzeit aus `data/`.
6.10 `deploy.password` in der Config nicht leer → als Passwort verwenden.
6.11 `deploy.password` leer → `weinsprechstunde.secrets.json`, dann `WEINSPRECHSTUNDE_DEPLOY_PASSWORD`. Fehlt beides → Abbruch mit: „FEHLER: Kein Deploy-Passwort gefunden. Setze die Umgebungsvariable WEINSPRECHSTUNDE_DEPLOY_PASSWORD mit dem Server-Passwort, z. B.: export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=deinPasswort". Deploy stoppt.
6.12 Verbindungsfehler → Abbruch mit: „FEHLER: Verbindung zum Server [host] fehlgeschlagen. Server-Meldung: [Originalmeldung]. Bitte prüfe: (1) Ist der Hostname '[host]' korrekt? (2) Sind Benutzername und Passwort gültig? (3) Ist der Server erreichbar und das Protokoll ([protocol]) korrekt?" Deploy stoppt.
6.13 Zugangsdaten ausschließlich über Umgebungsvariablen/Secrets-Datei, nie im Klartext in Config oder Versionskontrolle.
6.14 Deploy-Wurzel des Build-Outputs ist das tatsächliche Browser-Build-Verzeichnis (`frontend/dist/<projekt>/browser/` bei `@angular/build:application`; flacher `frontend/dist/` mit `index.html` unverändert), sodass `index.html` und Build-Dateien direkt unter `deploy.remote_path` liegen.
6.15 Kein automatisches Pre-Deploy-Backup; Inhalt von `remote_path` wird überschrieben. Prune löscht nur unterhalb von `remote_path`, lässt den Web-Root (inkl. Root-`.htaccess`) unberührt; `remote_images_path`, `remote_import_path` und `wines.json` sind gemäß 6.6 ausgenommen.
6.16 Prune betritt geschützte Teilbäume (`images/`, `data/`) gar nicht: kein Listing, keine Typprüfung (`_ftp_is_dir`), kein Löschen (Schutz und Performance, behebt die frühere Deploy-Blockade).
6.17 Verzeichnislistings (Prune, Remote-Download) primär per MLSD (`ftp.mlsd()`, RFC 3659, ein Roundtrip je Verzeichnis); Fallback bei Nichtunterstützung oder Fehler: `nlst` + `_ftp_is_dir`.
6.18 CLI-Parameter `--force-images` lädt ALLE Bilder neu hoch (kein MDTM-Vergleich); ohne Flag nur neuere/fehlende. Durchreichbar als `make deploy FORCE_IMAGES=1`.
