# Deploy-Phase Analyse — `make deploy`

Read-only Code-Analyse. Keine Code-Änderungen, kein Netzwerkzugriff, kein Server-Kontakt.
Quellen: `scripts/weinimport.py`, `weinsprechstunde.config.json`, `Makefile`,
`frontend/angular.json`, `scripts/tests/test_deploy.py`, `scripts/tests/conftest.py`.

---

## 1. Zusammenfassung (Kernaussage zuerst)

**`make deploy` lädt Dateien hoch und löscht serverseitig nur innerhalb eines
einzigen Verzeichnisses (`remote_path` = `/var/www/html`) — und dort nur Dateien,
die zum hochgeladenen `frontend/dist`-Baum gehören, aber lokal nicht (mehr)
existieren.** `wines.json` und der Bilderordner sind explizit vom Prune
ausgenommen. `remote_images_path` (`/var/www/images`) und `remote_import_path`
(`/var/www/import`) werden vom Prune **nie** angefasst — dorthin wird nur hochgeladen.

Das Prune ist also grundsätzlich eingegrenzt und mit Schutzmechanismen versehen.
**Es gibt jedoch zwei wichtige Vorbehalte, die vor einem echten Deploy geklärt
werden sollten:**

1. **Build-Output-Pfad-Fehlanpassung (funktionaler Fehler, kein Datenverlust):**
   Der Angular-Build schreibt nach `frontend/dist/ng-weinsprechstunde/browser/`,
   der Deploy liest aber `frontend/dist` als Wurzel. Dadurch wird der ganze Baum
   mit dem Präfix `ng-weinsprechstunde/browser/…` hochgeladen, die Website liegt
   also **nicht** im Web-Root. Das ist für die *Prune-Sicherheit* sogar günstig
   (weniger wird als „bekannt" markiert), für die *Funktion* aber falsch.

2. **Config-Diskrepanz zum Briefing:** Der echte Host in der Config ist
   `wp13170803.server-he.de` (User `weintransfer@wp13170803.server-he.de`), **nicht**
   `weinsprechstunde.de` / User `datentransfer`. Die Remote-Pfade stimmen
   (`/var/www/html`, `/var/www/images`, `/var/www/import`).

3. **Kein Dry-Run / Trockenlauf vorhanden.** Es gibt keinen Schalter, der den
   Deploy ohne echten Upload/Prune simuliert.

**Einschätzung:** Das Prune-Verhalten selbst ist nicht „gefährlich aggressiv".
`make deploy` kann ausgeführt werden, ohne dass auf `/var/www/images` oder
`/var/www/import` etwas gelöscht wird. Vorsicht gilt nur, falls unter
`/var/www/html` Dateien liegen, die **nicht** aus diesem Repo stammen und nicht
geschützt sind — diese würden vom Prune entfernt (Details unten, Abschnitt 3).

---

## 2. Was `make deploy` Schritt für Schritt tut

### 2.1 Makefile-Kette

`Makefile`, Target `deploy`:

```make
deploy: prepare export image-export
	cd frontend && npm run build
	$(PYTHON) scripts/weinimport.py deploy
```

Reihenfolge: `prepare` → `export` → `image-export` (Make-Prerequisites) →
`npm run build` (Angular) → `weinimport.py deploy`.

- `prepare` / `export` / `image-export` sind rein lokal (JSON aufbereiten,
  `wines.json` nach `export_path` schreiben, Bilder nach `image_export_dir`
  skalieren). Kein Server-Kontakt.
- `npm run build` erzeugt den Angular-Build (siehe 2.4).
- `weinimport.py deploy` ist die einzige Phase mit Server-Kontakt.

### 2.2 `phase_deploy(config)` — Einstieg (weinimport.py ~Z. 720)

```python
def phase_deploy(config: Config) -> None:
    password = resolve_password(config)
    try:
        if config.deploy.protocol == "sftp":
            _deploy_sftp(config, password)
        else:
            _deploy_ftp(config, password)
    except SystemExit:
        raise
    except Exception as e:
        sys.stderr.write("FEHLER: Verbindung zum Server … fehlgeschlagen. …")
        sys.exit(1)
```

Ablauf:
1. `resolve_password(config)` — Passwort auflösen oder sauber abbrechen (Abschnitt 5).
2. Je nach `protocol` → `_deploy_sftp` (bei dieser Config) oder `_deploy_ftp`.
3. Verbindungs-/Laufzeitfehler werden gefangen und führen zu `sys.exit(1)` mit
   einer erklärenden Meldung. `SystemExit` (z. B. aus `resolve_password`) wird
   durchgereicht.

### 2.3 `_deploy_sftp(config, password)` — die eigentliche Arbeit (weinimport.py ~Z. 770)

Reihenfolge der Aufrufe:
1. `_sftp_connect(host, user, password)` — Verbindung öffnen (paramiko, Port 22).
2. `dist_dir = Path("frontend/dist")`; `local_files = _local_dist_files(dist_dir)`
   — rekursive Map *relativer Pfad → lokale Datei* über alle Dateien im dist-Baum.
3. `_sftp_makedirs(remote_base)` — `remote_path` anlegen (falls nötig).
4. **Upload dist:** für jede Datei aus `local_files`: Zielpfad bilden,
   Zielverzeichnis anlegen, und nur hochladen, wenn `_sftp_up_to_date` **false**
   ist (Timestamp-Vergleich, siehe 2.5).
5. **Prune dist:** `exact, prefixes = _protected_prefixes(config)` dann
   `_sftp_prune(sftp, remote_base, keep=set(local_files), exact, prefixes)`
   — löscht veraltete Dateien unter `remote_path` (Abschnitt 3).
6. **Upload wines.json:** `Path(config.export_path)` → wenn vorhanden, nach
   `remote_path/<basename>` hochladen (mit Timestamp-Vergleich). Wird nie geprunt.
7. **Upload Bilder:** alle Dateien (nicht rekursiv, `iterdir`) aus
   `image_export_dir` → nach `remote_images_path/<name>` (mit Timestamp-Vergleich).
8. `finally`: `sftp.close()` + `transport.close()`.

`_deploy_ftp` (weinimport.py ~Z. 838) ist strukturgleich mit FTP-Primitiven
(`_ftp_makedirs`, `_ftp_up_to_date` via `MDTM`, `_ftp_prune`). Bei dieser Config
(`protocol: "sftp"`) irrelevant, aber identisches Prune-/Schutzverhalten.

### 2.4 Angular-Build-Output (wichtig)

`frontend/angular.json` nutzt den Builder `@angular/build:application`, Projekt
`ng-weinsprechstunde`. Der tatsächliche Build-Output (im Repo vorhanden) liegt unter:

```
frontend/dist/ng-weinsprechstunde/browser/
  index.html, main-*.js, styles-*.css, favicon.ico,
  assets/wines.json, assets/wine-schema.json, images/…
```

`angular.json` kopiert `src/assets/**` → `assets/` im Build. Da `export_path` =
`./frontend/src/assets/wines.json` ist, landet `wines.json` **zusätzlich** schon
im Build unter `…/browser/assets/wines.json`.

Der Deploy liest aber `Path("frontend/dist")` als Wurzel (`_local_dist_files`,
`item.relative_to(dist_dir)`), nicht `…/ng-weinsprechstunde/browser`. Konsequenz:
Alle Remote-Pfade bekommen das Präfix `ng-weinsprechstunde/browser/…`. → Siehe
Abschnitt 8 (Risiko/Empfehlung).

### 2.5 Timestamp-Vergleich (`_sftp_up_to_date`, weinimport.py ~Z. 820)

```python
def _sftp_up_to_date(sftp, remote_file, local_file) -> bool:
    try:
        remote_mtime = sftp.stat(remote_file).st_mtime
    except IOError:
        return False
    return remote_mtime >= local_file.stat().st_mtime
```

Nur Dateien, deren Remote-mtime älter als lokal ist (oder die remote fehlen),
werden hochgeladen. Reiner Optimierungsschritt, keine Löschung.

---

## 3. Löscht/Prunt der Deploy etwas auf dem Server? (wichtigste Frage)

**Ja — aber nur innerhalb von `remote_path` (`/var/www/html`) und mit Schutzregeln.**

### 3.1 Prune-Mechanik — `_sftp_prune` (weinimport.py ~Z. 827)

```python
def _sftp_prune(sftp, remote_base, keep, protected_exact=None, protected_prefixes=None):
    def walk(remote_dir, prefix):
        for entry in sftp.listdir_attr(remote_dir):
            rel = f"{prefix}{entry.filename}"
            remote_entry = f"{remote_dir.rstrip('/')}/{entry.filename}"
            if S_ISDIR(entry.st_mode):
                walk(remote_entry, f"{rel}/")
            elif rel not in keep and not _is_protected(rel, exact, prefixes):
                try: sftp.remove(remote_entry)
                except IOError: pass
    walk(remote_base, "")
```

Verhalten:
- **Wurzel:** immer nur `remote_base` = `config.deploy.remote_path` = `/var/www/html`.
  Es wird **rekursiv** durch alle Unterordner gelaufen.
- **Gelöscht wird eine Datei**, wenn ihr relativer Pfad `rel`
  (a) **nicht** in `keep` steht (`keep` = Menge der lokalen dist-Relativpfade) **und**
  (b) **nicht** geschützt ist.
- Verzeichnisse selbst werden nie gelöscht (nur `sftp.remove` auf Dateien).
- Fehler beim Löschen werden stillschweigend verschluckt (`except IOError: pass`).

**Wie aggressiv?** Innerhalb von `/var/www/html` löscht der Prune **jede
ungeschützte Datei, die nicht Teil des lokalen dist-Baums ist** — auch Dateien,
die mit diesem Tool gar nichts zu tun haben (z. B. manuell dort abgelegte Dateien,
andere Apps, `.htaccess` o. Ä.). Das ist die einzige real gefährliche Stelle.

Wegen der Pfad-Fehlanpassung aus 2.4 ist `keep` aktuell eine Menge von Pfaden wie
`ng-weinsprechstunde/browser/index.html`. Das heißt: Bei der *aktuellen*
Build-Konstellation würden die hochgeladenen Dateien unter
`/var/www/html/ng-weinsprechstunde/browser/…` landen, und der Prune würde
sämtliche *anderen* Dateien unter `/var/www/html` als „nicht in keep" ansehen und —
falls ungeschützt — löschen.

### 3.2 Schutzmechanismen — `_protected_prefixes` / `_is_protected` (weinimport.py ~Z. 738)

```python
def _protected_prefixes(config):
    base = config.deploy.remote_path.rstrip("/")          # /var/www/html
    exact = {Path(config.export_path).name}               # {"wines.json"}
    prefixes = []
    images = config.deploy.remote_images_path.rstrip("/")  # /var/www/images
    if images == base:
        prefixes.append("")
    elif images.startswith(base + "/"):
        prefixes.append(images[len(base)+1:] + "/")
    return exact, prefixes

def _is_protected(rel, exact, prefixes):
    if rel in exact: return True
    return any(prefix and rel.startswith(prefix) for prefix in prefixes)
```

- **`wines.json`** (Basename von `export_path`) ist immer geschützt — der Prune
  entfernt sie nie, auch nicht eine schon vorher serverseitig liegende
  (bestätigt durch Test `test_deploy_never_prunes_server_wines_json_without_local_export`).
- **Bilderordner:** nur geschützt, **falls `remote_images_path` unterhalb von
  `remote_path` liegt.** Bei dieser Config ist `/var/www/images` **nicht** unter
  `/var/www/html` → `prefixes` bleibt leer. Das ist **unkritisch**, weil der Prune
  ohnehin nur `/var/www/html` durchläuft und `/var/www/images` gar nicht berührt.

### 3.3 Was wird NICHT geprunt

- **`remote_images_path` (`/var/www/images`):** kein Prune-Durchlauf. Nur Upload
  (neue/aktualisierte Bilder). Alte Serverbilder bleiben liegen (werden nie gelöscht).
- **`remote_import_path` (`/var/www/import`):** von der Deploy-Phase überhaupt nicht
  angefasst — weder Upload noch Prune. (Wird nur beim *Download* genutzt, wenn
  `import_source = "remote"`; hier ist es `"local"`.)
- **`wines.json`** unter `remote_path`: geschützt (siehe oben).

**Fazit Abschnitt 3:** Datenverlust ist nur unter `/var/www/html` möglich, und zwar
für ungeschützte Dateien, die nicht im lokalen dist-Baum vorkommen.
`/var/www/images` und `/var/www/import` sind sicher.

---

## 4. Remote-Backup vor dem Deploy

**Wichtig: Die Deploy-Phase zieht KEIN Backup.** `phase_deploy` ruft weder
`phase_backup` noch `_remote_backup` auf. Backups passieren nur in `phase_backup`
(Phase `backup` bzw. die volle Pipeline ohne Argument) — und `make deploy` ruft
`phase_backup` **nicht** auf (die Prerequisites sind `prepare export image-export`,
kein `backup`).

`_remote_backup` (weinimport.py ~Z. 310) wird ausschließlich am Ende von
`phase_backup` aufgerufen, und auch nur wenn `backup.remote_backup_dir` gesetzt ist:

```python
if config.backup.remote_backup_dir and config.deploy:
    try: _remote_backup(config, last_name, archival_name)
    except Exception as e: sys.stderr.write("WARNUNG: Remote-Backup fehlgeschlagen: …")
```

Was `_remote_backup` tut: lädt die lokalen Backup-Ordner (`last_*` / `archival_*`
aus `backup_dir`) nach `remote_backup_dir` (`/var/www/backup`) hoch. Es sichert also
**den lokalen Import-Backup-Ordner**, nicht den Live-Webserver-Zustand (kein Download
des aktuellen `/var/www/html` vor dem Überschreiben).

**Ohne Passwort:** `_remote_backup` ist „best effort". Fehlt das Passwort (Config
leer **und** Env-Var leer), wird das Remote-Backup **übersprungen** mit Warnung,
die Pipeline läuft weiter — es bricht **nicht** ab:

```python
password = config.deploy.password or os.environ.get("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", "")
if not password:
    sys.stderr.write("WARNUNG: Remote-Backup übersprungen – kein Deploy-Passwort gesetzt …")
    return
```

**Konsequenz für den Nutzer:** Vor `make deploy` existiert *kein* automatischer
Snapshot des Live-Servers. Wer eine Absicherung gegen das Prune will, muss vorher
manuell `/var/www/html` sichern.

---

## 5. Passwort-Auflösung — `resolve_password` (weinimport.py ~Z. 230)

```python
def resolve_password(config: Config) -> str:
    password = config.deploy.password
    if not password:
        password = os.environ.get("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", "")
        if not password:
            sys.stderr.write("FEHLER: Kein Deploy-Passwort gefunden. Setze die "
                             "Umgebungsvariable WEINSPRECHSTUNDE_DEPLOY_PASSWORD …")
            sys.exit(1)
    return password
```

Bestätigt:
- Primär wird `config.deploy.password` benutzt. In der aktuellen Config ist dieses
  **leer** (`"password": ""`).
- Bei leerem Config-Passwort wird die Env-Var **`WEINSPRECHSTUNDE_DEPLOY_PASSWORD`**
  gelesen (Test `test_password_from_env_fallback`).
- Ist auch die Env-Var leer, bricht der Deploy **sauber mit `sys.exit(1)`** ab —
  **bevor** eine Verbindung geöffnet wird und **bevor** irgendetwas hochgeladen
  oder geprunt wird. `phase_deploy` ruft `resolve_password` als allererste Zeile auf,
  und `SystemExit` wird in `phase_deploy` bewusst durchgereicht. Es passiert also
  **nichts Halbes** (Tests `test_missing_password_exits_with_req_6_11_message`).

→ **Bestätigt:** Ohne Passwort kein Teil-Deploy, sondern ein sauberer Abbruch mit
klarer Fehlermeldung inkl. `export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=…`-Hinweis.

---

## 6. Konkret angefasste Remote-Pfade (aus der Config)

Aus `weinsprechstunde.config.json`:

| Config-Feld          | Wert (real)                                  | Briefing-Erwartung      | Deploy-Nutzung |
|----------------------|----------------------------------------------|-------------------------|----------------|
| `protocol`           | `sftp`                                        | sftp                    | → `_deploy_sftp` |
| `host`               | `wp13170803.server-he.de`                     | *weinsprechstunde.de* ⚠ | Verbindung (Port 22) |
| `user`               | `weintransfer@wp13170803.server-he.de`        | *datentransfer* ⚠       | Login |
| `password`           | `""` (leer)                                   | —                       | → Env-Var-Fallback |
| `remote_path`        | `/var/www/html`                               | ✓                       | Upload dist + wines.json; **Prune** |
| `remote_images_path` | `/var/www/images`                             | ✓                       | Upload Bilder (kein Prune) |
| `remote_import_path` | `/var/www/import`                             | ✓                       | **nicht** in Deploy (nur Remote-Download) |
| `backup.remote_backup_dir` | `/var/www/backup`                       | —                       | nur in `phase_backup`, nicht in Deploy |

**Hinweis-Diskrepanz:** Host/User weichen vom Briefing ab (`wp13170803.server-he.de`
statt `weinsprechstunde.de`, `weintransfer@…` statt `datentransfer`). Das ändert
nichts am Verhalten, sollte aber bestätigt werden, damit der Deploy auf dem
gewünschten Server landet.

Tatsächlich angefasst bei `make deploy`:
- **`/var/www/html`** — Upload des dist-Baums + `wines.json`; **einziger Prune-Ort**.
- **`/var/www/images`** — Upload geskalter Bilder; kein Prune.
- **`/var/www/import`** — unberührt.
- **`/var/www/backup`** — unberührt (nur bei `backup`-Phase).

---

## 7. Dry-Run / Trockenlauf

**Es gibt keinen Dry-Run-Modus.** Der `argparse`-Parser (`build_parser`,
weinimport.py ~Z. 920) kennt nur die Positionsargumente
`backup | prepare | export | image-export | deploy` plus `--config` / `--schema`.
Kein `--dry-run`, kein `--no-upload`, kein `-n`.

Testmöglichkeiten ohne echten Server:
- Die vorhandenen **Unit-Tests** (`scripts/tests/test_deploy.py`) fahren den Deploy
  mit einem Fake-SFTP-Client (monkeypatched `_sftp_connect`) und prüfen Upload-/
  Prune-/Schutz-Verhalten, ganz ohne Netzwerk. Das ist der sicherste „Trockenlauf":
  `cd scripts && pytest tests/test_deploy.py`.
- Ein echter Trockenlauf gegen den Produktivserver ist mit dem Skript nicht möglich.

---

## 8. Risikoeinschätzung & Empfehlungen

### Risiko-Ampel

| Aspekt | Risiko | Begründung |
|--------|--------|------------|
| Prune auf `/var/www/images` | **Grün** | Wird vom Prune nie durchlaufen; nur Upload. |
| Prune auf `/var/www/import` | **Grün** | Von Deploy gar nicht angefasst. |
| `wines.json` versehentlich gelöscht | **Grün** | Explizit geschützt (`_protected_prefixes`), per Test abgesichert. |
| Deploy ohne Passwort macht „etwas Halbes" | **Grün** | Sauberer `sys.exit(1)` vor jeder Server-Aktion. |
| Prune auf `/var/www/html` löscht Fremddateien | **Gelb** | Alles Ungeschützte unter `/var/www/html`, das nicht im dist-Baum liegt, wird gelöscht. Nur relevant, wenn dort Nicht-Repo-Dateien liegen. |
| Kein Live-Backup vor Deploy | **Gelb** | Deploy zieht kein Snapshot des Servers; Prune-Löschungen sind nicht automatisch wiederherstellbar. |
| Build-Output-Pfad-Fehlanpassung | **Gelb** | Website landet unter `…/ng-weinsprechstunde/browser/` statt im Root → Seite funktioniert so nicht; kein Datenverlust. |
| Falscher Zielserver (Host/User ≠ Briefing) | **Gelb** | Bitte bestätigen, dass `wp13170803.server-he.de` gewollt ist. |

### Ist `make deploy` sicher auszuführen?

**Weitgehend ja, mit Einschränkungen.** Das Prune ist eng begrenzt (nur
`/var/www/html`) und schützt die wichtigen Artefakte. Gefährlich wäre es nur, wenn
unter `/var/www/html` fremde/wichtige Dateien liegen, die nicht aus diesem Repo
stammen — diese würde der Prune entfernen. **Vor dem ersten echten Deploy sollte
der Nutzer den Ist-Zustand von `/var/www/html` prüfen** (am besten vorher manuell
sichern).

### Empfehlungen (nichts davon implementiert)

1. **Build-Output-Pfad korrigieren** (Funktionsfehler): Entweder in `angular.json`
   einen `outputPath` auf `dist` ohne `ng-weinsprechstunde/browser`-Verschachtelung
   setzen, oder in `_deploy_sftp`/`_deploy_ftp` `dist_dir` auf
   `frontend/dist/ng-weinsprechstunde/browser` zeigen lassen. Solange das nicht
   stimmt, liegt die ausgelieferte Seite im falschen Remote-Unterordner.
2. **Vor dem ersten Deploy manuell sichern:** z. B. serverseitig
   `/var/www/html` kopieren, da der Deploy kein Live-Backup zieht.
3. **Host/User bestätigen:** Abgleichen, dass `wp13170803.server-he.de` /
   `weintransfer@…` der gewünschte Zielserver ist (Briefing nannte
   `weinsprechstunde.de` / `datentransfer`).
4. **Optional einen `--dry-run`-Schalter ergänzen**, der Upload/Prune nur
   protokolliert statt auszuführen — es gibt aktuell keinen.
5. **Passwort** nicht in die (getrackte) Config schreiben, sondern über
   `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` setzen (Config ist leer, Fallback funktioniert).

---

## 9. Verifikation (was gelesen/geprüft wurde)

- `scripts/weinimport.py`: `phase_deploy`, `_deploy_sftp`, `_deploy_ftp`,
  `_local_dist_files`, `_protected_prefixes`, `_is_protected`, `_sftp_prune`,
  `_ftp_prune`, `_sftp_up_to_date`, `resolve_password`, `_remote_backup`,
  `phase_backup`, `build_parser`/`main` — vollständig gelesen.
- `weinsprechstunde.config.json`, `Makefile` — vollständig gelesen.
- `frontend/angular.json` (Builder/Assets) + tatsächlicher Build-Output unter
  `frontend/dist/ng-weinsprechstunde/browser/` (per `find` bestätigt: `index.html`,
  `assets/wines.json`, `images/` vorhanden).
- `scripts/tests/test_deploy.py` + `conftest.py` — Prune-Schutz, Passwort-Fallback
  und sauberer Abbruch sind durch Tests abgedeckt.
- Testlauf-Vorschlag (ohne Netzwerk): `cd scripts && pytest tests/test_deploy.py`.
  (In dieser Read-only-Analyse nicht ausgeführt.)
