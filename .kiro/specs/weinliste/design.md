# Design Document: Weinsprechstunde

## Overview

„Weinsprechstunde" besteht aus drei voneinander unabhängigen Subsystemen:

1. **Python Import-Skript** (`scripts/weinimport.py`) — ein phasenbasiertes CLI, das JSON-Quelldateien aus dem Import-Ordner aufbereitet, eine fertige `wines.json` exportiert, Bilder skaliert und Artefakte optional per FTPES (FTP mit explizitem TLS) auf einen Webserver deployt. Vor der Pipeline kann ein Zwei-Tier-Backup erstellt und bei Bedarf der Import-Ordner per FTPES vom Webserver heruntergeladen werden.
2. **Angular SPA Frontend** (`frontend/`) — liest die fertig generierte `wines.json` sowie die zentrale `wine-schema.json` und stellt Weine in Kachel- oder Listenansicht mit dynamischer, schema-gesteuerter Filterkonfiguration dar. Die App hat nur eine Route (`/`); sämtliche Filter liegen im FilterService.
3. **Wine Editor Web-App** (WineEditorApp) — eine **reine Angular-Browser-App ohne eigenes Backend** zur komfortablen Pflege der JSON-Quelldateien im `import_dir`. Sie ist eine **zweite Angular-App im selben Workspace** (`frontend/projects/editor`) und teilt Filter-, Such-, Sortier- und WineSchema-Verarbeitungslogik über einen gemeinsam genutzten Angular-Library-/Shared-Code-Bereich (`@weinsprechstunde/shared`) mit der öffentlichen Weinliste. Es gibt **kein FastAPI-Backend, keinen lokalen Server, kein `localhost`, kein Startskript und keine `/api/*`-Endpunkte**. Die Editor-App wird — wie die öffentliche Weinliste — als **statische App** auf den Webserver deployt und über eine **eigene URL** geöffnet (eigener Editor-Pfad im `wine_app`-Bereich); die ausgelieferte App enthält **keine Weindaten**, sondern nur die App-Hülle (UI) (Requirement 16.3). Der Dateizugriff erfolgt **direkt im Browser über die File System Access API**: Der Benutzer gibt **einmalig** den Cloud-Ordner (= `import_dir`) frei, das Ordner-Handle wird im Browser (IndexedDB) persistiert, und bei erneutem Öffnen genügt eine kurze Re-Autorisierung. Die App liest, schreibt, verschiebt und legt JSON-, Bild- und Mediendateien direkt in diesem Ordner an. Sie läuft **ausschließlich in Chromium-basierten Browsern (Chrome/Edge)** und zeigt bei fehlender File System Access API einen verständlichen Hinweis (Req 17.4). Es gibt **keine Authentifizierung** (kein Passwort, kein Session-Cookie, kein Rate-Limiting) — der Schutz ergibt sich allein aus der vom Benutzer im Browser erteilten Ordner-Freigabe; ein Ausbruch über den freigegebenen Ordner hinaus ist durch die Browser-API technisch ausgeschlossen (Requirement 16). Thumbnails/Bildvorschauen werden **clientseitig im Browser** (Canvas / `createImageBitmap`) aus den über die File System Access API gelesenen Originalbildern erzeugt; die Originale bleiben unverändert. Der Editor bietet bewusst **keine Lösch-Funktion** — ungewollte Einträge und Bilder werden ausschließlich archiviert (nach `import_dir/_archive/` verschoben); das endgültige Löschen bleibt dem Dateisystem vorbehalten. Die Cloud-Synchronisation des freigegebenen Ordners verteilt die bearbeiteten Dateien zwischen den Beteiligten; die App löst keine Sync-Konflikte. Nutzt ebenfalls `wine-schema.json` für dynamische Formularfelder.

Die drei Subsysteme teilen sich zwei zentrale Konfigurationsdateien im Projekt-Root:
- `weinsprechstunde.config.json` — Laufzeitparameter (Pfade, Deploy, Backup); kein Editor-Objekt mehr (die Browser-App braucht weder `editor.path` noch `editor.password_hash`)
- `wine-schema.json` — Felddefinitionen aller bekannten Weinattribute (Typ, Filter-Typ, Sichtbarkeit)

Laufzeitabhängigkeiten zwischen den Subsystemen existieren nicht.

---

## Architecture

```
weinsprechstunde2/
├── weinsprechstunde.config.json      ← zentrale Laufzeit-Konfiguration
├── wine-schema.json                  ← zentrale Felddefinitionen (shared)
├── Makefile                          ← Build-Targets
├── .github/
│   └── workflows/
│       └── deploy.yml               ← GitHub Actions CI/CD
├── scripts/
│   ├── weinimport.py                ← Python CLI (backup/prepare/export/image-export/deploy)
│   └── requirements.txt
├── import/                          ← Quelldaten (JSON + Bilder + Audio + Video)
│                                      = Cloud-Ordner; vom Benutzer im Browser per
│                                        File System Access API freigegeben (siehe unten)
├── backup/                          ← lokale wines.json-Backups (last_*.json + archival_*.json + .last_archival)
├── export/
│   └── images/                      ← skalierte Exportbilder (generiert)
├── frontend/                        ← Angular-Workspace (eine angular.json, ein package.json)
│   ├── angular.json                 ← definiert die Projekte: weinliste, editor, shared
│   ├── package.json
│   ├── projects/
│   │   ├── shared/                  ← geteilte Angular-Library (@weinsprechstunde/shared)
│   │   │   └── src/lib/             ← FilterService, Wine-Models, WineSchema-Verarbeitung,
│   │   │                              ControlsRow-/Filter-Logik (von beiden Apps genutzt)
│   │   ├── weinliste/               ← öffentliche Weinliste (bisherige SPA)
│   │   │   ├── src/app/             ← Komponenten (lädt data/ zur Laufzeit)
│   │   │   └── public/
│   │   │       ├── data/  → ../../../../export/data    ← wines.json + wine-schema.json (Symlink)
│   │   │       └── images/ → ../../../../export/images ← skalierte Bilder (Symlink)
│   │   └── editor/                  ← Editor-Angular-App (WineEditorApp, reine Browser-App)
│   │       └── src/app/             ← Zwei-Spalten-Layout, WineEditor,
│   │                                  ImagePicker + Audio-/Video-Picker (kein Login);
│   │                                  nutzt @weinsprechstunde/shared und greift über die
│   │                                  File System Access API (FileSystemAccessService)
│   │                                  direkt auf den freigegebenen import_dir zu —
│   │                                  kein Backend, keine Netzwerkanfragen für Daten
│   ├── (public app: ng build weinliste → frontend/dist/weinliste/browser/)
│   └── (editor app: ng build editor   → frontend/dist/editor/browser/ — statische App,
│                                         wird wie die Weinliste deployt, eigene URL)
```

**Begründung der Struktur:** Ein einziger Angular-Workspace (`frontend/`) mit drei
Projekten (`weinliste`-App, `editor`-App und einer `shared`-Library) hält genau *eine*
Toolchain, *ein* `package.json` und *eine* `angular.json` vor. Die gemeinsame Logik
(FilterService, Wine-Models, WineSchema-Verarbeitung, ControlsRow-/Filter-Logik) lebt
in der `shared`-Library und wird von beiden Apps über den TypeScript-Pfad-Alias
`@weinsprechstunde/shared` importiert — dadurch wird nichts dupliziert. Die bestehende
öffentliche App wird dabei nicht gebrochen: Ihr bisheriger Code wandert nach
`projects/weinliste/`, die geteilten Teile werden in `projects/shared/` extrahiert, und
ihre Funktion bleibt unverändert (gleiche Komponenten, gleicher Build-Output
`frontend/dist/weinliste/browser/`, den die PhaseDeploy weiterhin auflöst).

**Build und Deployment der Editor-App:** `ng build editor` erzeugt — genau wie
`ng build weinliste` — rein **statische Angular-Artefakte** (`frontend/dist/editor/browser/`).
Diese werden zusammen mit der öffentlichen Weinliste auf den Webserver deployt und über
eine **eigene URL** (eigener Editor-Pfad im `wine_app`-Bereich) geöffnet. Es gibt **kein
Backend, keinen lokalen Server, kein `localhost` und kein Startskript**. Die ausgelieferte
App enthält **keine Weindaten** — nur die App-Hülle (Req 16.3). Zur Laufzeit gibt der
Benutzer im Browser **einmalig** den lokalen (cloud-synchronisierten) Cloud-Ordner
(= `import_dir`) über die File System Access API frei; das Ordner-Handle wird in IndexedDB
persistiert, und bei erneutem Öffnen genügt eine kurze Re-Autorisierung (Req 17.2/17.3).
Die Verteilung der bearbeiteten JSON-/Medien-Dateien zwischen den Beteiligten übernimmt
allein die Cloud-Synchronisation des Ordners; die App löst keine Sync-Konflikte (Req 17.5).

```
┌──────────────────────────────────────────────────────────────────────┐
│  Build-Zeit (Python Import-Skript)                                   │
│                                                                      │
│  [Phase backup]  ─►  backup/last_*.json + backup/archival_*.json    │
│       ↓                                                              │
│  [optional] Remote-Import-Download (FTPES)                           │
│       ↓                                                              │
│  import/                                                             │
│  ├── wein-a.json  ─┐  [Phase prepare]  ─►  aufbereitete JSON-Dateien │
│  ├── wein-a.jpg   ─┤  [Phase export]   ─►  export/data/             │
│  └── 2021/        │                          wines.json              │
│      └── wein-b.json┘  [Phase image-export] ─►  export/images/      │
│                         [Phase deploy]  ─►  Webserver (FTPES)       │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Geteilte Angular-Library  (projects/shared, @weinsprechstunde/shared)│
│                                                                      │
│  FilterService · Wine-Models · WineSchema-Verarbeitung ·            │
│  ControlsRow-/Filter-Logik   — von BEIDEN Apps importiert            │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ import                          │ import
                ▼                                 ▼
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│  Browser: öffentliche Weinliste  │  │  Chromium-Browser: Wine-Editor   │
│  (projects/weinliste)            │  │  (projects/editor, kein Login,   │
│                                  │  │   statische App von eigener URL) │
│  AppComponent (i/l-Kürzel)       │  │  WineEditorApp                   │
│  ├── NavComponent                │  │  ├── Ordner-Freigabe (FSA API)   │
│  └── WineWallComponent (Route /) │  │  ├── Aktualisieren-Button        │
│      ├── ControlsRowComponent    │  │  ├── links: Eintragsliste        │
│      ├── WineGridComponent       │  │  │    (ControlsRow + Eintrags-   │
│      └── WineListComponent       │  │  │     typ-Filter via shared     │
│  WineDetailDialogComponent       │  │  │     FilterService)            │
│                                  │  │  └── rechts: WineEditor          │
│                                  │  │       + ImagePicker + A/V-Picker │
│                                  │  │  FileSystemAccessService         │
│  lädt data/ zur Laufzeit (HTTP)  │  │  (clientseitige Thumbnails)      │
└──────────────────────────────────┘  └───────────────┬──────────────────┘
                                                       │ File System Access API
                                                       │ (direkt, kein Backend)
                                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  import_dir  =  lokaler Cloud-Ordner (JSON + Medien)                  │
│  — vom Benutzer im Browser per File System Access API freigegeben,    │
│    Ordner-Handle in IndexedDB persistiert (Re-Autorisierung beim      │
│    erneuten Öffnen); Zugriff technisch auf diesen Ordner beschränkt — │
│  Lesen/Schreiben/Anlegen/Verschieben · _archive/ wird ignoriert       │
│  ⇄ Cloud-Sync (Dropbox/OneDrive/iCloud) verteilt die Dateien          │
│     zwischen allen Beteiligten (keine Konfliktauflösung durch die App) │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```mermaid
graph TD
    C[export/data/wines.json] -->|Phase backup| K[backup/last_*.json + archival_*.json]
    A -->|Phase prepare| B[aufbereitete JSON-Dateien]
    B -->|Phase export| C[export/data/wines.json]
    B -->|Phase image-export| D[export/images/]
    C -->|HTTP GET /data/wines.json| E[Weinliste-App (Angular)]
    F[wine-schema.json] -->|HTTP GET /data/wine-schema.json| E
    D -->|Phase deploy FTPES| G[Webserver /wine_app]
    C -->|Phase deploy FTPES| G
    EB[editor static build<br/>frontend/dist/editor] -->|Phase deploy FTPES| G
    S[shared Angular-Library<br/>FilterService · Wine-Models · WineSchema] -->|import| E
    S -->|import| J[Wine-Editor-App Angular<br/>Chromium-Browser, kein Login, kein Backend]
    J -->|File System Access API<br/>Lesen/Schreiben/Anlegen/Verschieben| I[import_dir = Cloud-Ordner<br/>*.json + Medien]
    J -.ignoriert.-> AR[import/_archive/]
    I -.Cloud-Sync verteilt Dateien.-> I
```

---

## Central Configuration Files

### `weinsprechstunde.config.json`

```json
{
  "import_dir": "./import",
  "import_source": "local",
  "export_path": "./export/data/wines.json",
  "scaffold_mode": true,
  "image_export_dir": "./export/images",
  "image_resize_mode": "width",
  "image_resize_px": 1200,
  "deploy": {
    "protocol": "ftpes",
    "remote_path": "/wine_app",
    "remote_images_path": "/wine_app/images",
    "remote_import_path": "/wine_app/data"
  },
  "backup": {
    "backup_dir": "./backup",
    "remote_backup_dir": "/backup",
    "max_last_backups": 10,
    "max_archival_backups": 24,
    "archival_interval_days": 30
  }
}
```

> **Kein `editor`-Objekt mehr:** Die früheren Felder `editor.path` und
> `editor.password_hash` **entfallen** (Requirement 16.4). Die WineEditorApp ist eine
> reine Browser-App ohne Backend und benötigt weder einen geheimen URL-Pfad noch ein
> Passwort; der Schutz ergibt sich allein aus der im Browser erteilten Freigabe des
> Cloud-Ordners über die File System Access API.

> `host`, `user` und `password` stehen **nicht** in der ConfigFile. Sie werden
> zur Laufzeit aufgelöst: ConfigFile > unversionierte
> `weinsprechstunde.secrets.json` (Vorlage: `weinsprechstunde.secrets.example.json`)
> > Umgebungsvariablen `WEINSPRECHSTUNDE_DEPLOY_HOST`/`_USER`/`_PASSWORD`
> (CI-Fallback). Eine fehlende Secrets-Datei ist kein Fehler.

### `wine-schema.json`

Definiert alle bekannten Weinattribute mit Datentyp, Filter-Typ und ob sie standardmäßig als Filter angezeigt werden. Wird von Python-Skript, Angular-Frontend und Wine-Editor gemeinsam genutzt.

Hinweis: `default_filter` steuert nicht mehr die initiale Filtersichtbarkeit — fest
sichtbar ist nur die Freitextsuche, alle übrigen Filter sind optional über „Mehr Filter"
zuschaltbar. Das Flag bleibt im Schema erhalten (unverändert), wird aber vom Frontend für
die initiale Anzeige nicht mehr ausgewertet.

```json
[
  { "field": "name",         "type": "text",        "filter_type": "text-search",  "default_filter": true  },
  { "field": "year",         "type": "number",      "filter_type": "range",        "default_filter": false, "decimals": 0 },
  { "field": "country",      "type": "text",        "filter_type": "dropdown",     "default_filter": false },
  { "field": "origin",       "type": "text",        "filter_type": "dropdown",     "default_filter": false },
  { "field": "grape",        "type": "multi-value", "filter_type": "multi-select", "default_filter": true  },
  { "field": "type",         "type": "text",        "filter_type": "dropdown",     "default_filter": false },
  { "field": "producer",     "type": "text",        "filter_type": "dropdown",     "default_filter": false },
  { "field": "quality",      "type": "text",        "filter_type": "dropdown",     "default_filter": false },
  { "field": "price",        "type": "number",      "filter_type": null,           "default_filter": false, "decimals": 2 },
  { "field": "rating",       "type": "number",      "filter_type": "rating-range", "default_filter": true,  "decimals": 1 },
  { "field": "tasting_date", "type": "date",        "filter_type": "date-range",   "default_filter": true  },
  { "field": "image",        "type": "text",        "filter_type": null,           "default_filter": false },
  { "field": "audio",        "type": "text",        "filter_type": null,           "default_filter": false },
  { "field": "video",        "type": "text",        "filter_type": null,           "default_filter": false },
  { "field": "description",  "type": "text",        "filter_type": null,           "default_filter": false }
]
```

---

## Components and Interfaces

### 1. Python Import-Skript (`scripts/weinimport.py`)

#### Einstiegspunkt (argparse)

| Aufruf | Verhalten |
|---|---|
| `python weinimport.py` | Führt backup → (remote-download) → prepare → export → image-export sequenziell aus |
| `python weinimport.py backup` | Nur Phase backup |
| `python weinimport.py prepare` | Nur Phase prepare |
| `python weinimport.py export` | Nur Phase export |
| `python weinimport.py image-export` | Nur Phase image-export |
| `python weinimport.py deploy` | Nur Phase deploy |
| `python weinimport.py deploy --force-images` | Deploy, lädt ALLE Bilder neu hoch (kein Timestamp-Vergleich); auch via `make deploy FORCE_IMAGES=1` |

#### Konfiguration laden

```python
def load_config(path: str = "weinsprechstunde.config.json") -> Config:
    try:
        with open(path) as f:
            raw = json.load(f)
    except FileNotFoundError:
        sys.stderr.write(f"FEHLER: Konfigurationsdatei '{path}' nicht gefunden.\n")
        sys.exit(1)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"FEHLER: Konfigurationsdatei ist kein valides JSON: {e}\n")
        sys.exit(1)
    return Config(**raw)

def load_wine_schema(path: str = "wine-schema.json") -> list[SchemaField]:
    try:
        with open(path) as f:
            raw = json.load(f)
    except FileNotFoundError:
        sys.stderr.write(f"FEHLER: wine-schema.json nicht gefunden.\n")
        sys.exit(1)
    return [SchemaField(**entry) for entry in raw]

def get_scaffold_fields(schema: list[SchemaField]) -> list[str]:
    return [f.field for f in schema]
```

#### Hilfsfunktionen

```python
ARCHIVE_DIR_NAME = "_archive"

def collect_json_files(import_dir: str) -> list[Path]:
    """Rekursiv alle .json-Dateien in import_dir erfassen.

    Der Archiv-Ordner import_dir/_archive/ wird vollständig übersprungen
    (Req 17.51): Dateien darin fließen weder in prepare/export noch in den
    Bildexport ein. Da collect_json_files die zentrale Dateierfassung aller
    drei Phasen (prepare, export, image-export) ist, genügt diese eine Stelle.
    """
    root = Path(import_dir)
    return sorted(
        p for p in root.rglob("*.json")
        if ARCHIVE_DIR_NAME not in p.relative_to(root).parts
    )

def slugify_name(name: str) -> str:
    """Name → URL-freundlicher Slug (python-slugify)."""
    from slugify import slugify
    return slugify(name)

def find_image_sibling(json_path: Path) -> str | None:
    """Bilddatei mit gleichem Basisnamen im selben Verzeichnis suchen."""
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        candidate = json_path.with_suffix(ext)
        if candidate.exists():
            return candidate.name
    return None

def read_exif_date(image_path: Path) -> str | None:
    """EXIF DateTimeOriginal → ISO-8601-Datumsstring (piexif)."""
    try:
        import piexif
        exif = piexif.load(str(image_path))
        dt_bytes = exif["Exif"].get(piexif.ExifIFD.DateTimeOriginal)
        if dt_bytes:
            dt_str = dt_bytes.decode()   # "YYYY:MM:DD HH:MM:SS"
            return dt_str[:10].replace(":", "-")
    except Exception:
        pass
    return None

def resolve_password(config: Config) -> str:
    """Passwort aus Config oder Umgebungsvariable lesen."""
    password = config.deploy.password
    if not password:
        password = os.environ.get("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", "")
        if not password:
            sys.stderr.write(
                "FEHLER: Kein Deploy-Passwort gefunden. Setze die Umgebungsvariable "
                "WEINSPRECHSTUNDE_DEPLOY_PASSWORD mit dem Server-Passwort, z. B.: "
                "export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=deinPasswort\n"
            )
            sys.exit(1)
    return password
```

---

#### Phase `backup`

Zwei-Tier-Backup-System: Gesichert wird ausschließlich die **exportierte `wines.json`** (`config.export_path`) als einzelne, zeitgestempelte Datei — NICHT der Import-Ordner und kein Ordner. **Last-Backups** (`last_<ts>.json`) werden bei jedem Lauf erstellt und bewahren die letzten `max_last_backups` Kopien. **Archival-Backups** (`archival_<ts>.json`) werden nur erstellt, wenn mindestens `archival_interval_days` Tage seit dem letzten Archival vergangen sind, und bewahren die letzten `max_archival_backups` Kopien. Der Zeitstempel des letzten Archival-Backups wird in der Marker-Datei `backup/.last_archival` gespeichert (die nie als Backup gewertet oder geprunt wird). Existiert `export_path` noch nicht (backup vor erstem `export`), wird mit Warnung übersprungen. Ist `remote_backup_dir` gesetzt, werden die erstellten Einzeldateien per FTPES hochgeladen (best effort, siehe `_remote_backup`).

```python
from datetime import datetime, timedelta
import shutil

LAST_ARCHIVAL_FILE = ".last_archival"

def phase_backup(config: Config) -> None:
    if not config.backup:
        return

    backup_dir = Path(config.backup.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    # Gesichert wird nur die exportierte wines.json als einzelne Datei.
    export_path = Path(config.export_path)
    suffix = export_path.suffix
    if not export_path.exists():
        sys.stderr.write(f"WARNUNG: Backup übersprungen – {export_path} existiert nicht.\n")
        return

    # Last-Backup: bei jedem Lauf
    last_name = f"last_{timestamp}{suffix}"
    last_path = backup_dir / last_name
    try:
        shutil.copy2(export_path, last_path)
    except Exception as e:
        sys.stderr.write(f"WARNUNG: Last-Backup fehlgeschlagen: {e}\n")
        last_name = None

    _prune_backups(backup_dir, prefix="last_", max_count=config.backup.max_last_backups)

    # Archival-Backup: nur wenn Intervall abgelaufen
    last_archival_path = backup_dir / LAST_ARCHIVAL_FILE
    archival_due = True
    if last_archival_path.exists():
        last_ts = datetime.fromisoformat(last_archival_path.read_text().strip())
        if datetime.now() - last_ts < timedelta(days=config.backup.archival_interval_days):
            archival_due = False

    archival_name = None
    if archival_due:
        archival_name = f"archival_{timestamp}{suffix}"
        archival_path = backup_dir / archival_name
        try:
            shutil.copy2(export_path, archival_path)
            last_archival_path.write_text(datetime.now().isoformat())
        except Exception as e:
            sys.stderr.write(f"WARNUNG: Archival-Backup fehlgeschlagen: {e}\n")
            archival_name = None

        _prune_backups(backup_dir, prefix="archival_", max_count=config.backup.max_archival_backups)

    # Remote-Backups wenn konfiguriert (Einzeldateien per FTPES, best effort)
    if config.backup.remote_backup_dir and config.deploy:
        try:
            _remote_backup(config, last_name, archival_name)
        except Exception as e:
            sys.stderr.write(f"WARNUNG: Remote-Backup fehlgeschlagen: {e}\n")

def _prune_backups(backup_dir: Path, prefix: str, max_count: int) -> None:
    """Älteste Backup-Dateien löschen wenn max_count überschritten.

    Backups sind Einzeldateien (last_*.json / archival_*.json); die
    Marker-Datei .last_archival wird nie als Backup gewertet.
    """
    entries = sorted(
        f for f in backup_dir.iterdir()
        if f.is_file() and f.name.startswith(prefix) and f.name != LAST_ARCHIVAL_FILE
    )
    while len(entries) > max_count:
        oldest = entries.pop(0)
        try:
            oldest.unlink()
        except Exception as e:
            sys.stderr.write(f"WARNUNG: Backup-Datei {oldest} konnte nicht gelöscht werden: {e}\n")

def _remote_backup(config, last_name, archival_name) -> None:
    """Die lokalen Backup-DATEIEN best effort per FTPES hochladen.

    Ohne Deploy-Passwort wird übersprungen (Warnung), ohne Abbruch.
    """
    remote_base = config.backup.remote_backup_dir
    password = config.deploy.password or os.environ.get("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", "")
    if not password:
        sys.stderr.write("WARNUNG: Remote-Backup übersprungen – kein Deploy-Passwort.\n")
        return
    backup_dir = Path(config.backup.backup_dir)
    names = [n for n in (last_name, archival_name) if n]
    if not names:
        return
    ftp = _ftps_connect(config.deploy.host, config.deploy.user, password)
    try:
        _ftp_makedirs(ftp, remote_base)
        for name in names:
            _upload_ftp(ftp, backup_dir / name, f"{remote_base.rstrip('/')}/{name}")
    finally:
        ftp.quit()
```

---

#### Remote-Import-Download (wenn `import_source = "remote"`)

```python
def download_remote_import(config: Config, password: str) -> None:
    """
    Synchronisiert deploy.remote_import_path auf lokalen import_dir.
    Bei Fehler: lesbarer Fehler mit Serverpfad + Server-Meldung → abbrechen.
    """
    try:
        _download_ftp(
            host=config.deploy.host,
            user=config.deploy.user,
            password=password,
            remote_path=config.deploy.remote_import_path,
            local_path=Path(config.import_dir),
        )
    except Exception as e:
        sys.stderr.write(
            f"FEHLER: Download des Import-Ordners von {config.deploy.host}:"
            f"{config.deploy.remote_import_path} fehlgeschlagen. "
            f"Server-Meldung: {e}\n"
        )
        sys.exit(1)
```

---

#### Phase `prepare`

```python
def phase_prepare(config: Config, schema: list[SchemaField]) -> None:
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        if "name" not in data:
            sys.stderr.write(f"WARNUNG: {json_file} – kein 'name', übersprungen.\n")
            continue

        # 1. Auto-detect image (nur wenn Feld nicht vorhanden)
        if "image" not in data:
            sibling = find_image_sibling(json_file)
            if sibling:
                data["image"] = sibling

        # 2. EXIF → tasting_date (nur wenn nicht vorhanden)
        if "tasting_date" not in data and data.get("image"):
            exif_date = read_exif_date(json_file.parent / data["image"])
            if exif_date:
                data["tasting_date"] = exif_date

        # 3. Umbenennung (braucht nur tasting_date; Datei bleibt im Unterordner)
        if data.get("tasting_date"):
            new_stem = f"{data['tasting_date']}-{slugify_name(data['name'])}"
            rename_file_group(json_file, new_stem, data)
            json_file = json_file.parent / f"{new_stem}.json"
        else:
            sys.stderr.write(f"WARNUNG: {json_file} – kein 'tasting_date', Umbenennung übersprungen.\n")

        # 4. Typ-Normalisierung für number-Felder (year, price, rating, …)
        normalize_number_fields(data, schema, json_file)

        # 5. scaffold_mode anwenden
        apply_scaffold_mode(data, config, schema)
        json_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

def rename_file_group(json_file: Path, new_stem: str, data: dict) -> int:
    """JSON + Bild + Audio auf neuen Basisnamen umbenennen.

    Gibt die Anzahl übersprungener Umbenennungen (Zieldatei existierte bereits)
    zurück. Diese Kollisionen werden NICHT pro Datei geloggt; die prepare-Phase
    fasst sie am Ende zu EINER Zeile zusammen (ruhige Konsole).
    """
    skipped = 0
    for field in ("image", "audio"):
        if not data.get(field):
            continue
        old_path = json_file.parent / data[field]
        if not old_path.exists():
            continue
        new_path = old_path.parent / f"{new_stem}{old_path.suffix}"
        if new_path.exists():
            skipped += 1   # still überspringen, keine pro-Datei-Warnung
            continue
        old_path.rename(new_path)
        data[field] = new_path.name

    new_json = json_file.parent / f"{new_stem}.json"
    if new_json.exists() and new_json != json_file:
        return skipped + 1
    if new_json != json_file:
        json_file.rename(new_json)
    return skipped

# phase_prepare summiert die Rückgabewerte und schreibt am Ende höchstens EINE
# Zusammenfassung: "prepare: N Umbenennung(en) übersprungen (Zieldatei existierte
# bereits)." statt einer Warnzeile pro kollidierender Datei.

def normalize_number_fields(data: dict, schema: list[SchemaField], json_file: Path) -> None:
    """Felder mit WineSchema-Typ 'number' von String zu Zahl normalisieren.

    - Dezimal-Komma → Dezimalpunkt ("6,99" → "6.99")
    - decimals == 0 → Integer (year: "2017" → 2017)
    - decimals == 1 → Float, 1 Nachkommastelle (rating: "6" → 6.0)
    - decimals == 2 → Float, 2 Nachkommastellen (price: "6,99" → 6.99)
    Nicht umwandelbare Werte bleiben unverändert und erzeugen eine Warnung.
    """
    number_fields = {f.field: f for f in schema if f.type == "number"}
    for field, spec in number_fields.items():
        if field not in data:
            continue
        value = data[field]
        if value is None or isinstance(value, (int, float)):
            # bereits numerisch oder leer → nur ggf. auf decimals runden
            if isinstance(value, (int, float)):
                data[field] = _round_to_decimals(value, spec.decimals)
            continue
        if not isinstance(value, str) or value.strip() == "":
            continue
        raw = value.strip().replace(",", ".")
        try:
            parsed = float(raw)
        except ValueError:
            sys.stderr.write(
                f"WARNUNG: {json_file} – Feld '{field}' Wert '{value}' ist keine Zahl, "
                f"unverändert belassen.\n"
            )
            continue
        data[field] = _round_to_decimals(parsed, spec.decimals)


def _round_to_decimals(value: float, decimals: int | None) -> int | float:
    """Auf die konfigurierte Nachkommastellen-Anzahl normalisieren."""
    if decimals is None:
        return value
    if decimals == 0:
        return int(round(value))
    return round(float(value), decimals)


def apply_scaffold_mode(data: dict, config: Config, schema: list[SchemaField]) -> None:
    scaffold_fields = get_scaffold_fields(schema)
    if config.scaffold_mode:
        for field in scaffold_fields:
            if field not in data:
                data[field] = None
        # bestehende Nicht-null-Werte bleiben unverändert
    else:
        keys_to_remove = [k for k, v in data.items() if v is None or v == ""]
        for k in keys_to_remove:
            del data[k]
```

---

#### Phase `export`

```python
def phase_export(config: Config) -> None:
    wines = []
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        if "name" not in data:
            sys.stderr.write(f"WARNUNG: {json_file} – kein 'name', übersprungen.\n")
            continue
        wines.append(data)

    with_date    = sorted(
        [w for w in wines if w.get("tasting_date")],
        key=lambda w: w["tasting_date"],
        reverse=True
    )
    without_date = [w for w in wines if not w.get("tasting_date")]

    output_path = Path(config.export_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(with_date + without_date, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )
```

---

#### Phase `image-export`

```python
def phase_image_export(config: Config) -> None:
    from PIL import Image

    scaled = skipped = missing = 0
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        image_ref = data.get("image")
        if not image_ref:
            continue

        src = json_file.parent / image_ref
        if not src.exists():
            missing += 1           # keine pro-Bild-Warnung; am Ende zusammengefasst
            continue

        dst = Path(config.image_export_dir) / image_ref
        dst.parent.mkdir(parents=True, exist_ok=True)

        # Timestamp-Vergleich: STILL überspringen wenn Kopie aktuell
        # (keine Zeile pro bereits vorhandenem Bild).
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue

        with Image.open(src) as img:
            px = config.image_resize_px
            if config.image_resize_mode == "width":
                img.thumbnail((px, 99999))
            else:  # "height"
                img.thumbnail((99999, px))
            img.save(dst, format=img.format)
        scaled += 1
        # Originale werden nicht verändert

    # EINE Zusammenfassung statt pro-Bild-Warnungen:
    sys.stderr.write(
        f"image-export: {scaled} skaliert, {skipped} bereits vorhanden "
        f"übersprungen, {missing} Quellen fehlten.\n"
    )
```

**Ruhiges Logging (prepare + image-export)**: Weder `prepare` noch
`image-export` schreiben eine Warnzeile pro übersprungener Datei/Bild. Bereits
vorhandene Zielbilder (Timestamp aktuell) werden still übersprungen; fehlende
Bildquellen und Umbenennungs-Kollisionen werden nur als EINE
Zusammenfassungszeile am Ende der jeweiligen Phase ausgegeben
(`image-export: X skaliert, Y bereits vorhanden übersprungen, Z Quellen
fehlten.` bzw. `prepare: N Umbenennung(en) übersprungen ...`). Das vermeidet die
frühere Konsolenflut bei hunderten bereits deployten Bildern.

---

#### Phase `deploy`

```python
def phase_deploy(config: Config, force_images: bool = False) -> None:
    password = resolve_password(config)

    try:
        _deploy_ftp(config, password, force_images=force_images)  # FTPES (FTP_TLS)
    except Exception as e:
        sys.stderr.write(
            f"FEHLER: Verbindung zum Server {config.deploy.host} fehlgeschlagen. "
            f"Server-Meldung: {e}. "
            f"Bitte prüfe: (1) Ist der Hostname '{config.deploy.host}' korrekt? "
            f"(2) Sind Benutzername und Passwort gültig? "
            f"(3) Ist der Server erreichbar und das Protokoll ({config.deploy.protocol}) korrekt?\n"
        )
        sys.exit(1)
```

**FTPES-Verbindung** (`_ftps_connect`): Transport ist `ftplib.FTP_TLS`
(stdlib). Ablauf: `connect(host, 21)` → `auth()` (explizites TLS auf dem
Kontrollkanal) → `login(user, password)` → `prot_p()` (TLS auf dem Datenkanal)
→ `set_pasv(True)`. Die Zertifikatsprüfung ist standardmäßig deaktiviert
(`ssl._create_unverified_context()`), weil der Webspace ein Zertifikat mit
abweichendem Hostnamen ausliefert; die Verbindung bleibt TLS-verschlüsselt. Mit
`FTPS_VERIFY=1` wird `ssl.create_default_context()` und damit die reguläre
Prüfung aktiviert. Da `FTP_TLS` eine Unterklasse von `ftplib.FTP` ist, arbeiten
die Upload-/Prune-/Download-Helfer (`_upload_ftp`, `_ftp_makedirs`,
`_ftp_prune`, `_ftp_list_entries`, `_ftp_is_dir`, `_ftp_up_to_date`,
`_ftp_download_dir`) unverändert auf dem übergebenen Verbindungsobjekt.

**Effizientes Verzeichnis-Listing (`_ftp_list_entries`, MLSD)**: Prune und
Remote-Download ermitteln Verzeichnisinhalte primär über `ftp.mlsd()`
(RFC 3659). Ein einziger MLSD-Roundtrip pro Verzeichnis liefert für jeden
Eintrag direkt den Typ (`type=dir`/`file`), sodass KEIN `_ftp_is_dir` mehr
nötig ist – dieses hatte pro Eintrag zwei `cwd`-Roundtrips über einen neuen
TLS-Datenkanal gemacht. Bei ~476 Bildern unter `/wine_app/images` entfielen so
~1000 langsame FTP/TLS-Roundtrips, die den Deploy-Prune faktisch blockierten.
Unterstützt der Server MLSD nicht (oder schlägt es fehl), fällt
`_ftp_list_entries` robust auf das alte Verhalten (`nlst` + `_ftp_is_dir` pro
Eintrag) zurück.

**TLS-Session-Reuse auf dem Datenkanal**: `_ftps_connect` instanziert nicht
direkt `ftplib.FTP_TLS`, sondern die Subklasse `_ReuseTLS_FTP`, die
`ntransfercmd` überschreibt. Sie wrappt den Datenkanal-Socket mit der
TLS-Session des Kontrollkanals (`self.sock.session`). Das ist für Pure-FTPd
(Host Europe) zwingend nötig: Der Server verlangt, dass die Datenverbindung
dieselbe TLS-Session wie der Kontrollkanal wiederverwendet, sonst blockiert er
den Datentransfer (Prune-Listing/Upload/Download hängen). Pythons
Standard-`FTP_TLS` tut das nicht. Der Reuse greift nur im `prot_p`-Fall und nur,
wenn der Kontroll-Socket eine Session trägt; andernfalls bleibt es beim
Standardverhalten. Da alle FTPES-Transfers (Deploy-Upload, Prune-Listing,
Remote-Import-Download, Remote-Backup-Upload) über `_ftps_connect` laufen,
profitieren sie alle automatisch.

Deploy-Logik:
- **Build-Wurzel**: Nicht `frontend/dist` als Wurzel nehmen, sondern das
  tatsächliche Browser-Build-Verzeichnis auflösen (`_resolve_dist_dir`). Der
  Builder `@angular/build:application` schreibt nach
  `frontend/dist/<projekt>/browser/`; diese Funktion liefert den `browser`-
  Unterordner, sodass `index.html`/Build-Dateien direkt unter `remote_path`
  (`/wine_app`) landen (Req 6.14). Ein klassischer flacher `dist`-Ordner (mit
  `index.html` direkt in `frontend/dist`) wird unverändert verwendet; Fallback
  bleibt `frontend/dist`.
- **Kein Pre-Deploy-Backup**: Es wird KEIN automatisches Pre-Deploy-Backup mehr
  erstellt (der Ziel-Webspace unterstützt keine serverseitige Kopie, und der
  Nutzer will den Live-Stand beim Deploy bewusst überschreiben). Der Inhalt von
  `/wine_app` wird überschrieben; der Backup-Mechanismus der `wines.json`
  (`_remote_backup`/`phase_backup`, nur Teil der backup-Phase) bleibt davon
  unberührt.
- **Deploy-Reihenfolge**: Upload des Build-Outputs → Prune (nur unter
  `/wine_app`) → `wines.json`/`wine-schema.json` nach `remote_import_path`
  (`/wine_app/data`) → Bilder nach `remote_images_path` (`/wine_app/images`).
- **Prune-Scope & Schutz**: Der Prune löscht veraltete Serverdateien
  ausschließlich unterhalb von `remote_path` (`/wine_app`) und berührt den
  Web-Root (inkl. Root-`.htaccess`, siehe `deploy/htaccess-webroot.txt`) nie.
  `_protected_prefixes(config)` schützt zusätzlich die Präfixe `images/` und
  `data/` sowie die WineDataAsset (`wines.json`) exakt, sodass laufzeitgeladene
  Daten/Bilder beim Prune nie gelöscht werden (Req 6.6).
- **Prune betritt geschützte Teilbäume nicht**: `_ftp_prune` steigt in ein
  Verzeichnis, dessen relativer Pfad einem geschützten Präfix (`images/`,
  `data/`) entspricht, GAR NICHT erst hinab – kein Listing, keine Typprüfung,
  kein `delete` für dessen Inhalt. Das ist sowohl Schutz (nie löschen) als auch
  Performance (keine unnötige Rekursion über hunderte Bilder) und beseitigt die
  bisherige Deploy-Blockade.
- **MLSD-basiertes Listing**: Der Prune-Walk nutzt `_ftp_list_entries` (MLSD,
  ein Roundtrip pro Verzeichnis) statt `_ftp_is_dir` (zwei `cwd`-Roundtrips pro
  Eintrag). Siehe „Effizientes Verzeichnis-Listing".
- **`--force-images`**: Ist das CLI-Flag `--force-images` gesetzt, werden beim
  Deploy ALLE Bilder neu hochgeladen (der `MDTM`/Timestamp-Vergleich
  `_ftp_up_to_date` wird für Bilder übersprungen → immer `STOR`). Ohne das Flag
  bleibt das bisherige Verhalten: nur neuere/fehlende Bilder hochladen. Über das
  Makefile durchreichbar mit `make deploy FORCE_IMAGES=1`.
- Timestamp-Vergleich: FTP via `MDTM`.
- Zugangsdaten (`host`/`user`/`password`) werden nie im Klartext in der Config
  gehalten, sondern über Secrets-Datei/Umgebungsvariablen aufgelöst (Req 6.13).

**Transparenter Root-Rewrite & base-href**: Die App liegt physisch unter
`/wine_app`, ist aber unter `https://weinsprechstunde.de/` erreichbar. Ein
manuell eingerichtetes Root-`.htaccess` (versioniert in
`deploy/htaccess-webroot.txt`, NICHT vom Deploy verwaltet) schreibt alle
Requests intern nach `/wine_app/` um, ohne die sichtbare URL zu ändern (kein
`R=`-Redirect; SPA-Fallback auf `/wine_app/index.html`). Dazu bleibt
`<base href="/">`, sodass die App ihre Assets als `/data/...`, `/images/...`
und gehashte Build-Dateien anfragt, die der Rewrite 1:1 auf `/wine_app/...`
mappt.

---

#### GitHub Actions Workflow (`.github/workflows/deploy.yml`)

```yaml
name: Deploy Weinsprechstunde

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Python dependencies
        run: pip install -r scripts/requirements.txt

      - name: Install Node dependencies
        run: npm ci
        working-directory: frontend

      - name: Run import pipeline
        env:
          WEINSPRECHSTUNDE_DEPLOY_HOST: ${{ secrets.WEINSPRECHSTUNDE_DEPLOY_HOST }}
          WEINSPRECHSTUNDE_DEPLOY_USER: ${{ secrets.WEINSPRECHSTUNDE_DEPLOY_USER }}
          WEINSPRECHSTUNDE_DEPLOY_PASSWORD: ${{ secrets.WEINSPRECHSTUNDE_DEPLOY_PASSWORD }}
        run: python scripts/weinimport.py prepare export image-export

      - name: Build Angular
        run: npm run build
        working-directory: frontend

      - name: Deploy to server
        env:
          WEINSPRECHSTUNDE_DEPLOY_HOST: ${{ secrets.WEINSPRECHSTUNDE_DEPLOY_HOST }}
          WEINSPRECHSTUNDE_DEPLOY_USER: ${{ secrets.WEINSPRECHSTUNDE_DEPLOY_USER }}
          WEINSPRECHSTUNDE_DEPLOY_PASSWORD: ${{ secrets.WEINSPRECHSTUNDE_DEPLOY_PASSWORD }}
        run: python scripts/weinimport.py deploy
```

> Wenn `import_source = "remote"`: Das Import-Skript lädt den Import-Ordner beim Start von `prepare` automatisch via FTPES herunter, bevor Phase prepare beginnt. Der CI-Workflow bleibt gleich. Host, Benutzer und Passwort stammen aus GitHub Secrets (`WEINSPRECHSTUNDE_DEPLOY_HOST`/`_USER`/`_PASSWORD`).

**Python-Bibliotheken (`scripts/requirements.txt`):**

| Bibliothek | Zweck |
|---|---|
| `Pillow` | Bildskalierung in Phase image-export |
| `piexif` | EXIF-Auslesen für tasting_date |
| `ftplib` (stdlib) | FTPES-Verbindung (`FTP_TLS`) in Phase deploy + Remote-Download |
| `ssl` (stdlib) | TLS-Kontext für FTPES (Zertifikatsprüfung optional via `FTPS_VERIFY`) |
| `python-slugify` | Slug-Generierung für Dateinamen |
| `dataclasses` (stdlib) | Datenmodelle |
| `argparse` (stdlib) | CLI-Einstiegspunkt |

> Für die WineEditorApp werden **keine** Python-Bibliotheken benötigt: Sie ist eine
> reine Angular-Browser-App ohne Backend (kein `fastapi`, kein `uvicorn`, keine
> Auth-Bibliotheken wie `bcrypt`/`itsdangerous`). Dateizugriff und Thumbnails laufen
> clientseitig über die File System Access API im Browser (Requirement 16/17); diese
> `requirements.txt` enthält ausschließlich die Abhängigkeiten des Import-Skripts.

---

### 2. Angular Frontend (`frontend/`)

#### Router-Konfiguration

Die App hat genau eine Inhaltsroute (`/`), die die `WineWallComponent` rendert, plus einen Wildcard-Redirect. Es gibt keine filterspezifischen Routen (`/region/:slug`, `/rebsorte/:slug` entfallen); der gesamte Filterzustand liegt im `FilterService`.

```typescript
// app.routes.ts
export const routes: Routes = [
  { path: '',   component: WineWallComponent },
  { path: '**', redirectTo: '' }
];
```

#### Komponentenstruktur

```
AppComponent (globale Tastaturkürzel i/l via host-keydown)
├── NavComponent (Logo-Platzhalter + App-Name; Klick = clearAllFilters + navigate '/')
└── WineWallComponent (liest keine Route-Parameter; Container der Hauptansicht)
    ├── ControlsRowComponent
    │   ├── FilterFieldComponent (fest: Freitextsuche "Filter")
    │   ├── FilterFieldComponent (×n optional, aus visibleFilterFields; mit Entfernen-Icon)
    │   ├── "Mehr Filter"-Menü (Checkbox-Liste optionaler Filter)
    │   ├── SortButtonComponent (natives <select>, 5 Optionen)
    │   ├── InfoToggle (Button, title "Tastenkürzel: i")
    │   └── ListToggle (Button, title "Tastenkürzel: l")
    ├── WineGridComponent (rendert ALLE gefilterten Weine, keine Paginierung)
    │   ├── Zurück-Button (back-tile, nur wenn hasActiveFilter())
    │   └── WineTileComponent (×n)
    │       ├── WineTileCoverComponent
    │       ├── WineTileOverlayComponent (festes Template)
    │       └── PlayButtonComponent (wenn audio/video vorhanden)
    └── WineListComponent (rendert ALLE gefilterten Weine, keine Paginierung)
        ├── Zurück-Button (back-item, nur wenn hasActiveFilter())
        └── WineListItemComponent (×n; WineTileCover-Thumbnail + Name/Weingut/Jahr/Land/Rating)
WineDetailDialogComponent (modal, festes Template in Gruppen)
```

#### Services

```typescript
// WineDataService — lädt data/wines.json und data/wine-schema.json einmalig, parallel
@Injectable({ providedIn: 'root' })
export class WineDataService {
  private readonly http = inject(HttpClient);

  readonly wines = signal<Wine[]>([]);
  readonly schema = signal<WineSchemaField[]>([]);
  readonly loadState = signal<LoadState>('idle');

  loadAll(): void {
    if (this.loadState() !== 'idle') return;
    this.loadState.set('loading');
    forkJoin({
      wines:  this.http.get<Wine[]>('data/wines.json'),
      schema: this.http.get<WineSchemaField[]>('data/wine-schema.json'),
    }).pipe(
      catchError(() => { this.loadState.set('error'); return EMPTY; })
    ).subscribe(({ wines, schema }) => {
      this.wines.set(wines);
      this.schema.set(schema);
      this.loadState.set('loaded');
    });
  }
}
```

```typescript
// FilterService — einzige Quelle der Wahrheit für alle Filter, Sortierung, Ansicht
@Injectable({ providedIn: 'root' })
export class FilterService {
  private readonly wineData = inject(WineDataService);
  private readonly prefs    = inject(UserPreferencesService);

  // Zustand
  readonly filter              = signal<WineFilter>({ ...EMPTY_FILTER });
  readonly sortOption          = signal<SortOption>('tasting_date_desc');
  readonly viewMode            = signal<'grid' | 'list'>('grid');
  readonly infoToggleActive    = signal<boolean>(false);
  readonly visibleFilterFields = signal<string[]>([]);  // aus Cookie

  constructor() {
    const saved = this.prefs.load();
    this.sortOption.set(saved.sortOption);
    this.viewMode.set(saved.viewMode);
    this.visibleFilterFields.set(saved.visibleFilters);
  }

  // text-search-Felder schema-abgeleitet (aktuell nur 'name')
  readonly searchFields = computed(() =>
    this.wineData.schema()
      .filter(f => f.filter_type === 'text-search')
      .map(f => f.field)
  );

  // Berechnete Werte
  readonly filteredWines = computed(() =>
    applyFiltersAndSort(
      this.wineData.wines(),
      this.filter(),
      this.sortOption(),
      this.searchFields()
    )
  );

  readonly hasActiveFilter = computed(() => {
    const f = this.filter();
    return (
      f.searchText.trim() !== '' ||
      Object.values(f.dropdowns).some(v => v !== null) ||
      Object.values(f.multiSelects).some(v => v.length > 0) ||
      f.yearFrom !== null || f.yearTo !== null ||
      f.ratingFrom !== null || f.ratingTo !== null ||
      f.tastingDateFrom !== null || f.tastingDateTo !== null
    );
  });

  /** Setzt NUR die Filterwerte zurück; Sichtbarkeit/Sort/View bleiben. */
  clearAllFilters(): void {
    this.filter.set({ ...EMPTY_FILTER });
  }

  setSortOption(opt: SortOption): void {
    this.sortOption.set(opt);
    this._savePrefs();
  }

  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode.set(mode);
    this._savePrefs();
  }

  toggleFilterField(field: string, visible: boolean): void {
    this.visibleFilterFields.update(fields => {
      const set = new Set(fields);
      if (visible) set.add(field);
      else set.delete(field);
      return [...set];
    });
    // Beim Ausblenden den zugehörigen Filterwert zurücksetzen, damit ein
    // entfernter Filter nicht unsichtbar weiterwirkt (Icon ODER "Mehr Filter").
    if (!visible) this.resetFilterKey(field);
    this._savePrefs();
  }

  /** Setzt den Filterwert eines einzelnen optionalen Filter-Keys zurück. */
  resetFilterKey(key: string): void {
    this.filter.update(f => {
      switch (key) {
        case 'grape':
        case 'origin':
          return { ...f, multiSelects: { ...f.multiSelects, [key]: [] } };
        case 'country':
        case 'type':
        case 'producer':
        case 'quality':
          return { ...f, dropdowns: { ...f.dropdowns, [key]: null } };
        case 'yearFrom': case 'yearTo':
        case 'ratingFrom': case 'ratingTo':
        case 'tastingDateFrom': case 'tastingDateTo':
          return { ...f, [key]: null };
        default:
          return f;
      }
    });
  }

  updateFilter(patch: Partial<WineFilter>): void {
    this.filter.update(f => ({ ...f, ...patch }));
  }

  private _savePrefs(): void {
    this.prefs.save({
      visibleFilters: this.visibleFilterFields(),
      sortOption: this.sortOption(),
      viewMode: this.viewMode(),
    });
  }
}

/**
 * Pure Funktion — einfach unit-testbar. Einzige Eigentümerin der AND-Invariante.
 * `searchFields` sind die schema-definierten text-search-Felder (aktuell nur 'name').
 * `valueList(wine, field)` liefert die Stringwerte eines (ggf. Array-)Feldes.
 */
export function applyFiltersAndSort(
  wines: Wine[],
  filter: WineFilter,
  sort: SortOption,
  searchFields: string[]
): Wine[] {
  const filtered = wines.filter(wine => {
    // 1. Freitextsuche: case-insensitiv, NUR über schema-definierte text-search-Felder
    if (filter.searchText.trim()) {
      const q = filter.searchText.toLowerCase().trim();
      const haystacks = searchFields.flatMap(f => valueList(wine, f));
      if (!haystacks.some(h => h.toLowerCase().includes(q))) return false;
    }
    // 2. Einzelauswahl-Dropdowns (country, type, producer, quality)
    for (const [field, sel] of Object.entries(filter.dropdowns)) {
      if (sel != null && !valueList(wine, field).includes(sel)) return false;
    }
    // 3. Multiselect-Dropdowns (grape, origin): OR innerhalb, AND zwischen Feldern
    for (const [field, selected] of Object.entries(filter.multiSelects)) {
      if (selected.length > 0) {
        const values = valueList(wine, field);
        if (!selected.some(s => values.includes(s))) return false;
      }
    }
    // 4. Range-Grenzen (jede Grenze ein eigener optionaler Filter; null = inaktiv)
    if (filter.yearFrom   != null && (wine.year   == null || wine.year   < filter.yearFrom))   return false;
    if (filter.yearTo     != null && (wine.year   == null || wine.year   > filter.yearTo))     return false;
    if (filter.ratingFrom != null && (wine.rating == null || wine.rating < filter.ratingFrom)) return false;
    if (filter.ratingTo   != null && (wine.rating == null || wine.rating > filter.ratingTo))   return false;
    if (filter.tastingDateFrom != null && (wine.tasting_date == null || wine.tasting_date < filter.tastingDateFrom)) return false;
    if (filter.tastingDateTo   != null && (wine.tasting_date == null || wine.tasting_date > filter.tastingDateTo))   return false;
    return true;
  });

  return filtered.slice().sort((a, b) => {
    switch (sort) {
      case 'tasting_date_asc': return (a.tasting_date ?? '').localeCompare(b.tasting_date ?? '');
      case 'rating_desc':      return (b.rating ?? 0) - (a.rating ?? 0);
      case 'price_desc':       return (b.price ?? -Infinity) - (a.price ?? -Infinity);
      case 'price_asc':        return (a.price ?? Infinity) - (b.price ?? Infinity);
      default:                 return (b.tasting_date ?? '').localeCompare(a.tasting_date ?? ''); // tasting_date_desc
    }
  });
}
```

```typescript
// UserPreferencesService — Cookie ws_prefs (kein Ablaufdatum)
export interface UserPreferences {
  visibleFilters: string[];
  sortOption: SortOption;
  viewMode: 'grid' | 'list';
}

const COOKIE_NAME = 'ws_prefs';
const DEFAULT_PREFS: UserPreferences = {
  visibleFilters: [],
  sortOption: 'tasting_date_desc',
  viewMode: 'grid',
};

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  load(): UserPreferences {
    try {
      const raw = this._getCookieValue(COOKIE_NAME);
      if (!raw) return { ...DEFAULT_PREFS };
      return { ...DEFAULT_PREFS, ...JSON.parse(decodeURIComponent(raw)) };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  save(prefs: UserPreferences): void {
    const value = encodeURIComponent(JSON.stringify(prefs));
    // Kein Max-Age → Session-Cookie (persistent bis Browser-Schließen)
    document.cookie = `${COOKIE_NAME}=${value}; path=/; SameSite=Strict`;
  }

  private _getCookieValue(name: string): string | null {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? match[1] : null;
  }
}
```

#### WineWallComponent — Container der Hauptansicht

Reiner Container. Lädt keine Daten, liest keine Route-Parameter; der Filterzustand liegt vollständig im `FilterService`. Wählt je nach `viewMode()` zwischen WineGrid und WineList.

```typescript
@Component({ /* … */ })
export class WineWallComponent {
  readonly filterService = inject(FilterService);
}
```

#### ControlsRowComponent — Filterkatalog

Fest sichtbar ist nur die Freitextsuche (Label „Filter"). Alle übrigen Filter sind optional und werden einzeln über das „Mehr Filter"-Menü zugeschaltet. Range-Grenzen sind bewusst als eigene Bound-Filter aufgeführt.

```typescript
readonly searchDescriptor: FilterDescriptor = { key: 'search', label: 'Filter', kind: 'text-search' };

readonly OPTIONAL_DESCRIPTORS: FilterDescriptor[] = [
  { key: 'grape',           label: 'Rebsorte',      kind: 'multi-select', field: 'grape' },
  { key: 'origin',          label: 'Region',        kind: 'multi-select', field: 'origin' },
  { key: 'country',         label: 'Land',          kind: 'dropdown',     field: 'country' },
  { key: 'type',            label: 'Typ',           kind: 'dropdown',     field: 'type' },
  { key: 'producer',        label: 'Weingut',       kind: 'dropdown',     field: 'producer' },
  { key: 'quality',         label: 'Qualität',      kind: 'dropdown',     field: 'quality' },
  { key: 'ratingFrom',      label: 'Bewertung ab',  kind: 'rating-bound', bound: 'from' },
  { key: 'ratingTo',        label: 'Bewertung bis', kind: 'rating-bound', bound: 'to' },
  { key: 'tastingDateFrom', label: 'Verkostung ab', kind: 'date-bound',   bound: 'from' },
  { key: 'tastingDateTo',   label: 'Verkostung bis',kind: 'date-bound',   bound: 'to' },
  { key: 'yearFrom',        label: 'Jahrgang ab',   kind: 'year-bound',   bound: 'from' },
  { key: 'yearTo',          label: 'Jahrgang bis',  kind: 'year-bound',   bound: 'to' },
];

// Entfernen über das Icon am Filter → blendet aus UND setzt den Wert zurück.
removeFilter(key: string): void { this.fs.toggleFilterField(key, false); }
```

Das `FilterFieldComponent` ist deskriptorgesteuert (`kind` bestimmt die Darstellung):
`text-search` → Suchfeld; `dropdown` → natives `<select>` mit Einzelauswahl;
`multi-select` → kompaktes aufklappbares Dropdown (Trigger-Button mit Zusammenfassung
„Alle"/Wert/„n gewählt" + Checkbox-Panel mit „Zurücksetzen"/„Fertig");
`rating-bound`/`year-bound` → eine Zahleneingabe; `date-bound` → eine Datumseingabe.
Optionale Filter tragen ein Entfernen-Icon (✕) neben dem Label.

#### SortButtonComponent

Natives `<select>` mit fünf Optionen, das nur den `FilterService` liest/schreibt:
„Neueste Verkostung zuerst" (`tasting_date_desc`, Standard), „Älteste Verkostung zuerst"
(`tasting_date_asc`), „Beste Bewertung zuerst" (`rating_desc`), „Teuerste zuerst"
(`price_desc`), „Günstigste zuerst" (`price_asc`).

#### WineGridComponent — alle gefilterten Weine + Zurück-Button

Alle Weindaten sind beim Start vollständig geladen; das Grid rendert **alle** gefilterten
Weine direkt — keine Paginierung, kein IntersectionObserver, kein Nachladen. Der
Zurück-Button (`back-tile`, gleiche Größe wie eine Kachel) erscheint, wenn ein
ControlsRow-Filter aktiv ist (`hasActiveFilter`). WineList arbeitet analog (Zurück-Button als `back-item`-Zeile).

```typescript
@Component({ /* … */ })
export class WineGridComponent {
  readonly fs = inject(FilterService);

  readonly visibleWines   = this.fs.filteredWines;   // keine Slice/Paginierung
  readonly showBackButton = this.fs.hasActiveFilter;
  readonly isEmpty        = computed(() => this.visibleWines().length === 0);

  goBack(): void {
    this.fs.clearAllFilters();
    this.router.navigate(['/']);
  }
}
```

#### WineTileComponent

```typescript
@Component({ /* … */ })
export class WineTileComponent {
  wine       = input.required<Wine>();
  showInfos  = input<boolean>(false);   // InfoToggle-Zustand von außen
  openDetail = output<Wine>();

  private readonly localOverlay = signal(false);
  readonly overlayVisible = computed(() => this.showInfos() || this.localOverlay());
  readonly hasMedia       = computed(() => !!this.wine().audio || !!this.wine().video);

  onMouseEnter(): void { if (!this.showInfos()) this.localOverlay.set(true);  }
  onMouseLeave(): void { if (!this.showInfos()) this.localOverlay.set(false); }
  onTap(): void        { if (!this.showInfos()) this.localOverlay.update(v => !v); }
  onClick(): void      { this.openDetail.emit(this.wine()); }
}
```

**WineTileOverlay** — festes Template (keine dynamische Generierung aus WineSchema):

```html
<div class="overlay">
  @if (wine().rating) {
    <div class="rating-circle">{{ wine().rating }}</div>
  }
  @if (wine().year)     { <div class="wine-year">{{ wine().year }}</div> }
  @if (wine().name)     { <div class="wine-name">{{ wine().name }}</div> }
  @if (wine().producer) { <div class="wine-producer">{{ wine().producer }}</div> }
  @if (wine().grape)    { <div class="wine-grape">{{ grape(wine()) }}</div> }
  @if (wine().origin)   { <div class="wine-origin">{{ wine().origin }}</div> }
</div>
```

#### NavComponent

Nur Logo-Platzhalter + App-Name „Weinsprechstunde". Keine Navigationsmenüpunkte
(keine Regionen/Rebsorten-Dropdowns). Ein Klick auf das Logo bzw. den App-Namen setzt
alle aktiven Filter zurück und navigiert zur Startroute `/`.

```typescript
@Component({ /* … */ })
export class NavComponent {
  private readonly router        = inject(Router);
  private readonly filterService = inject(FilterService);

  goHome(): void {
    this.filterService.clearAllFilters();
    this.router.navigate(['/']);
  }
}
```

#### WineDetailDialogComponent

Feste Gruppenstruktur — keine tabellarische Auflistung, keine Generierung aus WineSchema:

- **Kopfbereich**: Name, Weingut, Jahr, RatingCircle
- **Herkunft**: Land, Region
- **Weinprofil**: Rebsorte(n), Typ, Qualität
- **Verkostung**: Datum, Beschreibung
- **Kaufinfo**: Preis
- **Medien**: Bild (groß), `<audio controls [src]="wine().audio">` (wenn audio), `<video controls [src]="wine().video">` (wenn video)
- **Zusatzfelder**: unbekannte Key-Value-Paare am Ende

```typescript
@Component({ /* … */ })
export class WineDetailDialogComponent {
  wine  = input<Wine | null>(null);
  close = output<void>();

  readonly extraEntries = computed(() => {
    if (!this.wine()) return [];
    const knownFields = new Set([
      'name', 'producer', 'year', 'rating', 'country', 'origin',
      'grape', 'type', 'quality', 'tasting_date', 'description',
      'price', 'image', 'audio', 'video'
    ]);
    return Object.entries(this.wine()!).filter(([k]) => !knownFields.has(k));
  });

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialog-backdrop')) {
      this.close.emit();
    }
  }

  private readonly _scrollLock = effect(() => {
    document.body.style.overflow = this.wine() ? 'hidden' : '';
  });
}
```

#### AppComponent

```typescript
@Component({
  template: `
    <app-nav />
    <router-outlet />
    @if (dataService.loadState() === 'loading') {
      <div class="loading">Lade Weine…</div>
    } @else if (dataService.loadState() === 'error') {
      <div class="error">Fehler beim Laden der Weindaten.</div>
    }
    <app-wine-detail-dialog [wine]="selectedWine()" (close)="selectedWine.set(null)" />
  `
})
export class AppComponent implements OnInit {
  readonly dataService   = inject(WineDataService);
  readonly dialog        = inject(DialogService);
  readonly filterService = inject(FilterService);

  ngOnInit(): void {
    this.dataService.loadAll();
  }
}
```

#### Globale Tastaturkürzel (AppComponent host-keydown-Listener)

Die AppComponent registriert einen globalen `(document:keydown)`-Listener:
`i` schaltet `infoToggleActive` um (wie InfoToggle), `l` wechselt via `setViewMode`
zwischen Grid und Liste (wie ListToggle), `→` navigiert im WineDetailDialog zum nächsten
und `←` zum vorherigen Wein. Gemeinsame Guards für alle vier Shortcuts (`i`, `l`, `←`, `→`):
Sie feuern nicht, wenn
(a) der Fokus in einem Eingabefeld liegt (`INPUT`/`TEXTAREA`/`SELECT`/`contenteditable`), oder
(b) eine Modifier-Taste (Ctrl/Meta/Alt) gedrückt ist.

Zusätzlicher Dialog-Guard **nur für `i` und `l`**: Diese beiden Shortcuts feuern nicht,
solange der WineDetailDialog offen ist (`dialog.wine() !== null`). Die Pfeiltasten
`←`/`→` sind bei geöffnetem Dialog hingegen **gerade aktiv** — sie dienen dort der
Navigation zwischen den Weinen. Die zugehörigen Buttons für `i` und `l` tragen einen
`title`-Hinweis („Tastenkürzel: i" bzw. „Tastenkürzel: l").

**Navigationslogik der Pfeiltasten (kein eigener Zustand).** Index-Quelle ist
ausschließlich die über den FilterService gefilterte und sortierte Liste
`filterService.filteredWines()` — exakt dieselbe Reihenfolge, die WineGrid und WineList
rendern. Sei `list = filterService.filteredWines()` und `n = list.length`
(bei `n === 0` tun die Pfeiltasten nichts):

- **Dialog offen** (`dialog.wine() !== null`): Der aktuell gezeigte Wein wird über seine
  Position `i` in `list` bestimmt (Index des aktuellen `dialog.wine()` in `list`).
  `→` zeigt `list[(i + 1) % n]`, `←` zeigt `list[(i - 1 + n) % n]`. Durch den
  Modulo-Wrap folgt nach dem letzten Wein wieder der erste und vor dem ersten der letzte.
  Wird der aktuelle Wein in `list` nicht gefunden (`i === -1`, z. B. durch zwischenzeitlich
  geänderte Filter), verhält sich `→` wie „Dialog geschlossen, erster Wein" und `←` wie
  „Dialog geschlossen, letzter Wein".
- **Dialog geschlossen** (`dialog.wine() === null`): `→` öffnet den WineDetailDialog mit
  dem ersten Wein `list[0]`, `←` mit dem letzten Wein `list[n - 1]`.

```typescript
host: { '(document:keydown)': 'onKeydown($event)' }

onKeydown(event: KeyboardEvent): void {
  // Gemeinsame Guards für i, l, ArrowLeft, ArrowRight
  if (event.defaultPrevented) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (this.isEditableTarget(event.target)) return;

  const dialogOpen = this.dialog.wine() !== null;

  switch (event.key) {
    case 'ArrowRight':
      this.navigateDialog(+1);
      event.preventDefault();
      return;
    case 'ArrowLeft':
      this.navigateDialog(-1);
      event.preventDefault();
      return;
  }

  // i und l bleiben bei offenem Dialog deaktiviert (nur die Pfeiltasten navigieren dann)
  if (dialogOpen) return;

  switch (event.key.toLowerCase()) {
    case 'i':
      this.filterService.infoToggleActive.update(v => !v);
      event.preventDefault();
      break;
    case 'l':
      this.filterService.setViewMode(this.filterService.viewMode() === 'grid' ? 'list' : 'grid');
      event.preventDefault();
      break;
  }
}

/**
 * Navigiert im WineDetailDialog relativ zum aktuell gezeigten Wein.
 * Index-Quelle ist die gefilterte/sortierte Liste des FilterService
 * (gleiche Reihenfolge wie WineGrid/WineList) — kein eigener Zustand.
 * `dir` ist +1 (ArrowRight) oder -1 (ArrowLeft).
 */
private navigateDialog(dir: 1 | -1): void {
  const list = this.filterService.filteredWines();
  const n = list.length;
  if (n === 0) return;

  const current = this.dialog.wine();
  if (current === null) {
    // Dialog geschlossen: ArrowRight → erster Wein, ArrowLeft → letzter Wein
    this.dialog.open(dir === 1 ? list[0] : list[n - 1]);
    return;
  }

  const i = list.indexOf(current);
  if (i === -1) {
    // Aktueller Wein nicht in gefilterter Liste: wie geschlossener Dialog behandeln
    this.dialog.open(dir === 1 ? list[0] : list[n - 1]);
    return;
  }

  // Modulo-Wrap: nach dem letzten folgt der erste, vor dem ersten der letzte
  this.dialog.open(list[(i + dir + n) % n]);
}

private isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
```

---

### 3. Wine Editor Web-App (WineEditorApp)

**Technologie:** Reine Angular-Browser-App ohne Backend — eine eigenständige
Angular-App unter `frontend/projects/editor`, die Code mit der öffentlichen Weinliste
über die geteilte Library `@weinsprechstunde/shared` teilt. `ng build editor` erzeugt
**statische Angular-Artefakte** (`frontend/dist/editor/browser/`), die — wie die
öffentliche Weinliste — auf den Webserver deployt und über eine **eigene URL** geöffnet
werden (Req 17.1). Es gibt **kein FastAPI-Backend, keinen lokalen Server, kein `localhost`,
kein Startskript und keine `/api/*`-Endpunkte**. Die App enthält **keine Weindaten** — nur
die App-Hülle (Req 16.3). Sie läuft **ausschließlich in Chromium-basierten Browsern
(Chrome/Edge)** und zeigt bei fehlender File System Access API einen verständlichen
Hinweis (Req 17.4). Es gibt keinen Login-Screen und keine Authentifizierung (Req 16.1).

Der gesamte Datenzugriff läuft **clientseitig im Browser über die File System Access API**:
Ein Angular-Service (`FileSystemAccessService`) kapselt Verzeichnis-Handles, das Lesen,
Schreiben, Anlegen und Verschieben von Dateien sowie die clientseitige Thumbnail-Erzeugung.
Der Benutzer gibt **einmalig** den Cloud-Ordner (= `import_dir`) frei; das Ordner-Handle
wird in IndexedDB persistiert, bei erneutem Öffnen genügt eine kurze Re-Autorisierung
(Req 17.2/17.3). Es gibt keine serverseitige Logik: Wine-Listing, Anlegen, Verknüpfen,
Medien-Listing, Thumbnails und Archivierung werden allein über die File System Access API
im `import_dir` ausgeführt. Der Schutz ergibt sich aus der im Browser erteilten
Ordner-Freigabe; ein Ausbruch über diesen Ordner hinaus ist durch die Browser-API
technisch ausgeschlossen (Requirement 16).

Der Editor stellt bewusst **keine Funktion zum Löschen** von Weineinträgen oder
Dateien bereit (Req 17.44): Als entfernende Aktion existiert ausschließlich das
**Archivieren** (Verschieben nach `import_dir/_archive/`). Das endgültige Löschen
sowie das Zurückholen (Dearchivieren) erfolgen ausschließlich manuell im
Dateisystem (Req 17.50).

#### Sicherheitskonzept (reine Browser-App, keine Auth)

```
Webserver (eigene Editor-URL)          Browser (Chrome/Edge)
┌───────────────────────────┐          ┌──────────────────────────────────┐
│  statische Editor-App      │  laden   │  WineEditorApp (Angular)         │
│  (frontend/dist/editor)    │ ───────► │  — keine Weindaten, nur UI —     │
│  — keine Weindaten —       │          │  FileSystemAccessService         │
└───────────────────────────┘          └───────────────┬──────────────────┘
                                                        │ File System Access API
                                                        │ (einmalige Freigabe,
                                                        │  Handle in IndexedDB)
                                                        ▼
                                        ┌──────────────────────────────────┐
                                        │  import_dir = lokaler Cloud-Ordner│
                                        │  JSON + Medien (⇄ Cloud-Sync)     │
                                        └──────────────────────────────────┘

frontend/projects/editor/   ← Editor-Angular-App (Entwicklungsquelle); `ng build editor`
                              erzeugt die statische App, die deployt wird
```

Das Sicherheitskonzept der WineEditorApp beruht nicht auf Authentifizierung, sondern auf
der im Browser erteilten Ordner-Freigabe (Requirement 16):

- **Keine Authentifizierung (Req 16.1):** Die App ist eine reine Browser-App ohne Server
  und ohne Backend. Es gibt kein Passwort, kein Session-Cookie und kein Rate-Limiting; der
  Zugang wird allein über die vom Benutzer im Browser erteilte Freigabe des Cloud-Ordners
  kontrolliert.
- **Zugriff bleibt auf den freigegebenen Ordner beschränkt (Req 16.2):** Alle datei- und
  bildbezogenen Zugriffe laufen ausschließlich über die vom Benutzer erteilte
  Ordner-Freigabe (File System Access API). Die App kann nur auf den freigegebenen
  Cloud-Ordner (= `import_dir`) und dessen Inhalt zugreifen; ein Ausbruch über diesen
  Ordner hinaus ist durch die Browser-API technisch ausgeschlossen — es ist keine
  anwendungsseitige Pfadprüfung nötig, da die Browser-API die Grenze garantiert.
- **Keine Weindaten in der App (Req 16.3):** Die deployte statische App enthält keine
  Weindaten; sie liest und schreibt Weindaten ausschließlich im lokal freigegebenen
  Cloud-Ordner.

**Ordner-Freigabe & Handle-Persistenz (`FileSystemAccessService`, Req 17.2/17.3/17.4):**
Beim ersten Start fordert die App den Benutzer auf, den Cloud-Ordner (= `import_dir`) über
`window.showDirectoryPicker()` freizugeben, und persistiert das erhaltene
`FileSystemDirectoryHandle` in IndexedDB. Bei erneutem Öffnen wird das Handle aus IndexedDB
geladen und über `handle.queryPermission()` / `handle.requestPermission()` kurz
re-autorisiert, ohne dass der Benutzer den Ordner erneut suchen muss. Ist die File System
Access API nicht verfügbar (nicht-Chromium-Browser), zeigt die App einen verständlichen
Hinweis statt der Editor-Oberfläche (Req 17.4).

```typescript
// FileSystemAccessService (vereinfacht)
async requestFolder(): Promise<FileSystemDirectoryHandle> {
  if (!('showDirectoryPicker' in window)) {
    throw new UnsupportedBrowserError();   // → verständlicher Hinweis (Req 17.4)
  }
  const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  await this.persistHandle(handle);        // Handle in IndexedDB speichern (Req 17.2)
  return handle;
}

async restoreFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await this.loadHandle();  // aus IndexedDB (Req 17.3)
  if (!handle) return null;
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    perm = await handle.requestPermission({ mode: 'readwrite' });   // Re-Autorisierung
  }
  return perm === 'granted' ? handle : null;
}
```

**Clientseitige Datenzugriffs-Schicht (`FileSystemAccessService`):**

Es gibt **keine** Endpunkte und **keine** Netzwerkanfragen für Daten. Stattdessen kapselt
der `FileSystemAccessService` alle Dateioperationen über die File System Access API
(Verzeichnis-Handles, Datei-Lesen/-Schreiben, Anlegen, Verschieben, clientseitige
Thumbnails). Die früheren Backend-Operationen bilden sich wie folgt auf
File-System-Access-Operationen im `import_dir` ab:

| Operation | File-System-Access-Umsetzung |
|---|---|
| Wine-Listing | Verzeichnis rekursiv scannen (`handle.entries()`), alle `.json` außerhalb `_archive` lesen; Konflikterkennung ausschließlich über `File.lastModified` |
| Einzelnen Wein lesen | JSON-Datei lesen und `File.lastModified` als Lade-Zeitstempel merken (für die Konflikterkennung beim Speichern, Req 17.25) |
| Wein speichern / Auto-Save | Vor dem Schreiben `File.lastModified` erneut lesen und mit dem Lade-Zeitstempel vergleichen; bei Abweichung Konfliktwarnung (Req 17.25), sonst über `createWritable()` schreiben |
| Neuen leeren Weineintrag anlegen | Neue `.json`-Datei im `import_dir` über `getFileHandle(name, { create: true })` erzeugen |
| Bildlose Weineinträge (fürs `name`-Autocomplete) | Wine-Listing nach Einträgen ohne gesetztes `image`-Feld (leer, `null` oder nicht vorhanden) filtern (Req 17.38) |
| Entwurf anlegen (manuell, from-image) | Beim Klick auf „Wein anlegen“ eine neue `.json`-Datei im selben Unterordner wie das Bild (Bild-Basisname + `.json`) mit Name, `image` = Dateiname, `tasting_date` (EXIF `DateTimeOriginal`, clientseitig) und den eingegebenen Feldern schreiben (Req 17.36/17.39/17.40) |
| Bild verknüpfen (link-image) | `image`-Feld des bestehenden bildlosen Eintrags setzen und die Bilddatei bei Bedarf in dessen JSON-Verzeichnis verschieben (Lesen → neu anlegen → Original entfernen); keine zweite JSON (Req 17.41) |
| Bild-Listing (mit `date` + `assigned`) | Verzeichnis scannen (`.jpg/.jpeg/.png/.webp`, case-insensitive), je Bild das Datum (EXIF `DateTimeOriginal`, sonst `File.lastModified`) ermitteln und `assigned` aus den `image`-Feldern der JSONs ableiten (Req 17.28/17.29) |
| Medien-Listing (audio/video) | Verzeichnis nach passenden Mediendateien scannen (ohne `_archive`, Req 17.19) |
| Thumbnails / Bildvorschauen | **Clientseitig** aus dem per File System Access API gelesenen Originalbild erzeugen (Canvas / `createImageBitmap`); Original unverändert (Req 17.33) |
| Archivieren (Bild / Wein) | Datei(en) in `import_dir/_archive/` verschieben (Req 17.46/17.47) |
| `_archive` | Bei allen Scans vollständig überspringen (Req 17.49) |
| Autocomplete-/Dropdown-/Multi-Select-Werte | Aus den bereits geladenen Weineinträgen clientseitig ableiten (inkl. bekannter Rebsorten für `grape`, Req 17.17/17.18) |
| WineSchema | `wine-schema.json` als statisches Asset der Editor-App laden |

Alle Scans (Wine-Listing, Bild-Listing, Medien-Listing) MÜSSEN den Ordner
`import_dir/_archive/` vollständig ignorieren (Req 17.49): archivierte Bilder erscheinen
nicht als unbekannte Weine, archivierte JSON-Dateien nicht als angelegte Weine. Die
Zuordnung „unbekanntes Bild" / „ungenutztes Bild" ergibt sich daraus, dass kein `image`-Feld
einer (nicht archivierten) JSON-Datei den Dateinamen referenziert; das Bild-Listing liefert
diesen Status pro Bild als `assigned`-Flag (Req 17.28/17.29). Als Bilddateien gelten (für
unbekannte Weine, ImagePicker und Thumbnails) Dateien mit den Endungen `.jpg`, `.jpeg`,
`.png` und `.webp` case-insensitive (Req 17.32).

**Bild-Listing mit Datum und Zuordnungsstatus (Req 17.28/17.29):** Der
`FileSystemAccessService` scannt den `import_dir` (ohne `_archive`) und liefert je
Bilddatei ein Objekt mit mindestens `name` (Dateiname ohne Pfad), `date`
(Aufnahme-/Dateidatum: EXIF `DateTimeOriginal`, falls vorhanden, sonst `File.lastModified`)
und `assigned` (Zuordnungsstatus: `false` = keinem Weineintrag zugeordnet/ungenutzt,
`true` = von einem `image`-Feld referenziert). Mit diesen Feldern sortiert das Frontend die
ImagePicker-Galerie nach Datum (Req 17.30) und schaltet zwischen „nur ungenutzte" und „alle
Bilder" um (Req 17.29). Das Namensfilter des ImagePicker (Req 17.31) arbeitet clientseitig
auf dieser Liste.

**Thumbnails / Bildvorschauen (Req 17.33):** Thumbnails werden **clientseitig im Browser**
aus dem über die File System Access API gelesenen Originalbild erzeugt (z. B. über
`createImageBitmap` und Zeichnen auf ein verkleinertes `<canvas>`, Ausgabe als
Object-URL/Blob). Die Originaldateien werden dabei nie verändert. Diese Vorschauen nutzen
die Listen-Thumbnails (angelegte wie unbekannte Weine), das Bildgitter des ImagePicker und
die Vorschau im WineEditor, sodass nie die vollen Originalbilder angezeigt werden müssen
(Req 17.33).

**Medien-Picker für `audio`/`video` (Req 17.19):** Für die Felder `audio` und `video`
listet der `FileSystemAccessService` die passenden Mediendateien im `import_dir` (ohne
`_archive`) für den jeweiligen Feldtyp. Der zugehörige Frontend-Picker (analog zum
ImagePicker) übernimmt bei Auswahl den **Dateinamen** der Mediendatei in das Feld `audio`
bzw. `video`.

**Auto-Save mit externer-Änderungserkennung (Req 17.20–17.25):** Das Editor-Frontend
schreibt pro Feld frühestens 500 ms nach der letzten Eingabe direkt über die File System
Access API in die JSON-Quelldatei (`createWritable()`). Zur Best-effort-Konflikterkennung
merkt sich die App beim Laden des Eintrags dessen `File.lastModified`. Vor dem Schreiben
liest sie `File.lastModified` erneut; weicht der Wert vom gemerkten Lade-Zeitstempel ab
(= die Datei wurde seit dem Laden extern verändert, z. B. durch eine Cloud-Sync-Änderung
eines anderen Beteiligten), warnt die App und überschreibt **nicht** ohne ausdrückliche
Bestätigung des Benutzers (Req 17.25). Erfolg/Fehler jedes Auto-Saves steuern den
Speicherstatus-Indikator (Zustände „Erfolg"/„Fehler", Req 17.23/17.24); bei Fehler bleiben
die zuletzt eingegebenen Feldinhalte erhalten (Req 17.24). Beim Schreiben von
`number`-Feldern konvertiert das Frontend typrichtig (`year` als Ganzzahl, `price` mit 2,
`rating` mit 1 Nachkommastelle; Dezimal-Komma wird akzeptiert, z. B. „6,99" → `6.99`),
konsistent zur Normalisierung im ImportScript (Req 17.22). Ein Eintrag ohne nicht-leeres
`name`-Feld wird dabei nicht blockiert: Der Zwischenstand wird dennoch gespeichert, der
Eintrag aber als unvollständig markiert (Req 17.20).

**Defekte JSON-Dateien & schema-fremde Felder (Req 17.26/17.27):** Ist eine JSON-Datei im
`import_dir` kein gültiges JSON, kennzeichnet die App sie im Listing als **fehlerhaft** und
öffnet sie nicht zum Bearbeiten im WineEditor — die Korrektur erfolgt manuell im Dateisystem
(Req 17.26). Enthält eine (gültige) JSON-Datei Felder, die nicht in der WineSchema definiert
sind, liest, zeigt und speichert die App diese schema-fremden Felder unverändert mit (sie
werden beim Auto-Save erhalten, nicht entfernt, Req 17.27).

**Entwurf für einen unbekannten Wein (Req 17.36/17.37):** Wählt der Benutzer einen
unbekannten Wein aus (Klick auf den Eintrag oder sein Bild), öffnet die App den WineEditor
als **Entwurf** und zeigt das vollständige, aus der WineSchema abgeleitete Formular — es wird
dabei **keine** JSON-Quelldatei angelegt. Das Formular ist mit `image` (Dateiname des
Bildes) und `tasting_date` (aus EXIF `DateTimeOriginal` des clientseitig gelesenen Bildes,
falls vorhanden, sonst leer) vorbefüllt. Solange noch keine JSON existiert, sind alle Felder
**außer `name` schreibgeschützt** und es wird nichts geschrieben.

**Bildlose Einträge fürs `name`-Autocomplete (Req 17.38):** Im Entwurf bietet das `name`-Feld
ein Autocomplete, das ausschließlich bestehende Weineinträge **ohne gesetztes `image`-Feld**
vorschlägt. Dafür filtert die App das Wine-Listing auf alle (nicht-archivierten)
Weineinträge, deren JSON kein gesetztes `image`-Feld hat (`image` leer, `null` oder nicht
vorhanden).

**Manuelles Anlegen (Req 17.39):** Das Tippen im `name`-Feld legt **nichts** an und löst
keine Verknüpfung aus. Das Anlegen passiert erst über eine manuelle Aktion (Schaltfläche
„Wein anlegen“), die nur bei nicht-leerem Namen verfügbar ist. Beim Anlegen deckt die App
zwei Wege ab:

- **(a) Eigener neuer Name (Req 17.40):** Entspricht der eingegebene Name keinem
  Autocomplete-Vorschlag exakt, legt die App über die File System Access API im **selben
  Unterordner** wie das Bild eine neue JSON-Datei mit dem Bild-Basisnamen (+ `.json`) an und
  schreibt den Namen, das `image`-Feld (Dateiname) sowie die bis dahin eingegebenen Felder.
  Die **endgültige Umbenennung** nach `{tasting_date}-{slug(name)}` bleibt der PhasePreparate
  des ImportScripts überlassen (keine Duplizierung der Umbenennungslogik).
- **(b) Verknüpfen mit einem bestehenden bildlosen Eintrag (link-image, Req 17.41):**
  Entspricht der Name exakt einem bestehenden bildlosen Weineintrag aus dem Autocomplete,
  legt die App **keine** neue JSON an, sondern setzt das `image`-Feld dieses Eintrags auf den
  Bild-Dateinamen und verschiebt das Bild bei Bedarf in dessen JSON-Verzeichnis (Bild und
  JSON danach stets im selben Verzeichnis, Req 17.35). Fortan bearbeitet der WineEditor den
  bestehenden Eintrag.

`image`, `audio` und `video` werden stets nur als Dateiname ohne Pfad gespeichert; die
Mediendateien liegen im selben Verzeichnis wie die JSON-Datei (Req 17.35).

Nach einem manuell abgeschlossenen Anlegevorgang existiert für den Wein **genau eine**
JSON-Quelldatei (Req 17.42) — die neu angelegte oder die verknüpfte bestehende —, und dieser
Wein **bleibt im WineEditor geöffnet und bearbeitbar**, unabhängig davon, ob der aktuelle
Listenfilter ihn gerade anzeigt (der geöffnete Eintrag wird aus den rohen Scan-Daten
aufgelöst, nicht aus der gefilterten Liste). Schlägt das Anlegen der JSON oder beim
Verknüpfen das Setzen des `image`-Feldes bzw. das Bildverschieben fehl, zeigt die App eine
erkennbare Fehleranzeige und hinterlässt **keinen** Zustand mit doppelter JSON für denselben
Wein (Req 17.43). Die Invariante lautet: **niemals zwei JSON-Dateien für denselben Wein.**

**Archivierung (`import_dir/_archive/`):** Archivieren eines ungenutzten Bildes verschiebt
die Bilddatei, Archivieren eines angelegten Weineintrags verschiebt die JSON-Datei zusammen
mit den in `image`/`audio`/`video` referenzierten Mediendateien (sofern vorhanden) in den
`_archive`-Ordner (Req 17.46/17.47) — jeweils über die File System Access API. Scheitert ein
Verschieben, bleibt die betroffene Datei an ihrem Ursprungsort und die App zeigt eine
erkennbare Fehleranzeige (Req 17.48). Es gibt bewusst weder eine Lösch- noch eine
Dearchivierungs-Funktion (Req 17.44/17.50) — endgültiges Löschen und Zurückholen erfolgen
manuell im Dateisystem.

**Cloud-Sync-Einschränkung (Req 17.5):** Die Verteilung der JSON-Quelldateien, Bild- und
Mediendateien zwischen den Beteiligten übernimmt ausschließlich die Cloud-Synchronisation
des Ordners. Die WineEditorApp löst **keine** Cloud-Sync-Konflikte auf: Bearbeiten mehrere
Personen gleichzeitig dieselbe Datei, kann die Cloud-Sync Konfliktkopien erzeugen, die
außerhalb der Verantwortung der App liegen. Die Best-effort-Konflikterkennung des Auto-Saves
über `File.lastModified` (Req 17.25) deckt nur den lokalen Fall ab, dass die Datei seit dem
Laden verändert wurde; sie ersetzt keine Cloud-Sync-Konfliktauflösung.

**Konflikterkennung über `File.lastModified` (clientseitig):**

```typescript
// Auszug aus dem Auto-Save über die File System Access API
async save(fileHandle: FileSystemFileHandle, loadedLastModified: number, data: object) {
  const current = await fileHandle.getFile();
  if (current.lastModified !== loadedLastModified) {
    // Datei wurde seit dem Laden extern verändert (z. B. Cloud-Sync) — Req 17.25
    throw new ConflictError();           // Frontend warnt, überschreibt erst nach Bestätigung
  }
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}
```

#### Editor-Angular-Frontend (`frontend/projects/editor`)

**Kein Login, Auto-Refresh & manueller Aktualisieren-Button (Req 17.6/17.7):** Die
`editor`-App hat **keinen Login-Screen** und keine Auth-Logik — sie ist eine reine
Browser-App ohne Backend und greift über den `FileSystemAccessService` direkt auf den
freigegebenen `import_dir` zu (Req 16). Nach jeder **eigenen** Aktion (Anlegen,
Archivieren, Bild-Verknüpfen oder Speichern) aktualisiert die App die Eintragsliste
automatisch (Req 17.6). Für Änderungen anderer Beteiligter, die über die
Cloud-Synchronisation in den `import_dir` gelangen, stellt die App einen **manuellen
Aktualisieren-Button** zum Neuladen der Liste bereit (erneuter Verzeichnis-Scan); es gibt
**kein** automatisches Polling (Req 17.7).

**Zwei-Spalten-Layout (Req 17.8/17.9):** links die Eintragsliste, rechts der
`WineEditor` für den gewählten Eintrag. Ein Klick auf einen Listeneintrag zeigt dessen
Details rechts; unbekannte Weine werden mit dem Platzhaltertext „unbekannter Wein", dem
aus dem Bild ermittelten `tasting_date` (sofern vorhanden) und einer clientseitig erzeugten
Bildvorschau dargestellt (Req 17.13).

**Geteilte Filterlogik (Req 17.10/17.11):** Die Liste nutzt denselben `FilterService`
und dieselbe ControlsRow-/Filter-Logik wie die öffentliche Weinliste — beide Apps
importieren sie aus `@weinsprechstunde/shared`, sodass Filter-, Such-, Sortier- und
WineSchema-Verarbeitung nicht dupliziert werden. Die bestehende FilterService-Logik der
öffentlichen App wird dafür unverändert in die `shared`-Library extrahiert; die
öffentliche Weinliste konsumiert sie danach aus derselben Library und behält ihr
Verhalten. Die attributbasierten Filter (Freitextsuche, Rebsorte, Region, Rating-Range,
…) stammen vollständig aus dem geteilten `FilterService`.

**Standard-Sortierung (Req 17.12):** Die Liste wird standardmäßig absteigend nach
`tasting_date` sortiert, wobei angelegte und unbekannte Weine gemischt nach Datum
einsortiert werden und Einträge ohne ermittelbares `tasting_date` ans Ende gestellt
werden. Diese Sortierung sowie die weiteren Sortieroptionen stammen aus dem geteilten
`FilterService` (identisch zur öffentlichen Weinliste) und werden nicht im Editor
dupliziert; unbekannte Weine werden dafür mit ihrem aus dem Bild ermittelten
`tasting_date` in dieselbe Sortierung eingereiht.

**Zusätzlicher Eintragstyp-Filter (Req 17.10/17.14/17.15):** Nur im Editor gibt es einen
vierwertigen Eintragstyp-Filter „Alle" / „Nur angelegte" / „Ohne Bilder" / „Nur unbekannte". Angelegte
Weine haben eine JSON-Quelldatei im `import_dir`; unbekannte Weine sind Bilddateien ohne
referenzierende JSON (die Bild-Listing-Einträge mit `assigned = false`). Steht der Filter
auf „Nur unbekannte" und der Benutzer tippt in einen attributbasierten Filter, schaltet der
Editor automatisch auf „Nur angelegte" um (unbekannte Weine besitzen keine solchen
Attribute, Req 17.15). Dieser Filter ist editor-spezifisch und liegt in der `editor`-App,
nicht in der geteilten Library.

**WineEditor-Formular** — Angular-Formularsteuerelemente dynamisch aus `wine-schema.json`
(neue Felder erscheinen automatisch, ohne Code-Änderung, Req 17.16):

| WineSchema `type` / `filter_type` | Angular-Eingabe |
|---|---|
| `text` (name) | Textfeld; Pflichtfeld — leeres `name` markiert den Eintrag als unvollständig, blockiert aber nicht (Req 17.20) |
| `number` (year) | Zahleneingabe (min=1900, max=2100); Auto-Save schreibt eine Ganzzahl (Req 17.22) |
| `date` (tasting_date) | Datepicker (Req 17.16) |
| `rating` (rating) | Zahleneingabe min=1.0, max=10.0, step=0.1; Auto-Save schreibt 1 Nachkommastelle (Req 17.16/17.22) |
| `dropdown`/`multi-select` (country, origin, type, producer, quality) | Auswahl aus vorkommenden Werten (clientseitig aus den geladenen Einträgen, Req 17.17) |
| `multi-value` (grape) | Tag-/Chip-Eingabe mit Autocomplete aus bekannten Rebsorten (Req 17.18) |
| `text` (price) | Textfeld mit Autocomplete aus den bekannten Werten; Auto-Save schreibt 2 Nachkommastellen, Dezimal-Komma akzeptiert (Req 17.17/17.22) |
| `text` (description) | Mehrzeiliges Textfeld |
| schema-fremdes Feld (nicht in WineSchema) | Wird angezeigt und beim Speichern erhalten (Req 17.27) |
| `text` (name, Entwurf eines unbekannten Weins) | Textfeld mit Autocomplete bildloser Einträge; manuelles Anlegen per „Wein anlegen“-Button — eigener neuer Name (neue JSON) oder exakter Treffer (Verknüpfung) (Req 17.38–17.41) |
| `text` (image) | ImagePicker (Req 17.28/17.29/17.30/17.31) |
| `text` (audio, video) | Medien-Picker analog zum ImagePicker (Req 17.19) |

**Grape als Tag-/Chip-Eingabe (Req 17.18):** Das multi-value-Feld `grape` wird als
Chip-Eingabe umgesetzt: Rebsorten werden einzeln als Chips hinzugefügt, jeweils mit
Autocomplete-Vorschlägen aus den bereits vorkommenden Rebsorten (clientseitig aus den
geladenen Einträgen abgeleitet). Der Wert wird als **Array** in der JSON-Quelldatei
gespeichert.

**Unvollständige Einträge (Req 17.20):** Fehlt einem Eintrag ein nicht-leeres
`name`-Feld, markiert der Editor ihn sichtbar als unvollständig — sowohl in der
Eintragsliste (links) als auch im WineEditor (rechts). Das Auto-Save speichert den
Zwischenstand dennoch; es blockiert nicht.

**Defekte JSON & schema-fremde Felder (Req 17.26/17.27):** Eine JSON-Quelldatei, die kein
gültiges JSON ist, wird in der Eintragsliste sichtbar als **fehlerhaft** markiert und lässt
sich **nicht** im WineEditor öffnen (die Korrektur erfolgt manuell im Dateisystem, Req
17.26). Enthält ein (gültiger) Eintrag Felder, die nicht in der WineSchema definiert sind,
zeigt der WineEditor diese schema-fremden Felder an und erhält sie beim Auto-Save
unverändert (Req 17.27).

**Live-/Auto-Save (Req 17.21–17.25):** Pro Feld wird mit 500 ms Debounce automatisch über
die File System Access API in die JSON-Quelldatei geschrieben — keine manuelle
Speicheraktion (Req 17.21). `number`-Felder werden beim Auto-Save typrichtig konvertiert
(`year` als Ganzzahl, `price` mit 2, `rating` mit 1 Nachkommastelle; Dezimal-Komma
akzeptiert, z. B. „6,99" → `6.99`), konsistent zur Normalisierung im ImportScript (Req
17.22). Ein **Speicherstatus-Indikator** zeigt die diskreten Zustände „Erfolg" bzw.
„Fehler" (Req 17.23/17.24); bei Fehler bleiben die zuletzt eingegebenen Feldinhalte erhalten
(Req 17.24). Erkennt die App eine externe Änderung (`File.lastModified` weicht vom
Lade-Zeitstempel ab), warnt sie und überschreibt erst nach Bestätigung (Req 17.25). Nach
erfolgreichem Speichern aktualisiert die App die Liste automatisch (Req 17.6).

**ImagePicker (Req 17.28–17.31/17.34):** Eine durchsuchbare Galerie mit Thumbnails der
Bilddateien im `import_dir` (Bildtypen `.jpg/.jpeg/.png/.webp`, case-insensitive). Die
Thumbnails werden **clientseitig im Browser** aus den über die File System Access API
gelesenen Originalbildern erzeugt (Originale unverändert, Req 17.33). Datengrundlage ist das
clientseitige Bild-Listing, das je Bild `name`, `date` (EXIF `DateTimeOriginal` bzw.
`File.lastModified`) und `assigned` (Zuordnungsstatus) liefert. Daraus ergibt sich das
Verhalten des Pickers:

- **Standardansicht (Req 17.28):** nur ungenutzte Bilder (`assigned = false`), also keinem
  Weineintrag zugeordnet.
- **Umschalt-Button (Req 17.29):** wechselt die Anzeige zwischen „nur ungenutzte" und
  „alle Bilder" — rein clientseitig über das `assigned`-Flag.
- **Sortierung nach Datum (Req 17.30):** die angezeigten Bilder werden nach dem
  `date`-Feld (Aufnahme-/Dateidatum) sortiert.
- **Filter-Eingabefeld (Req 17.31):** filtert die angezeigten Bilder clientseitig nach
  Dateiname.

Bei Auswahl eines Bildes wird dessen Dateiname (ohne Pfad) in das `image`-Feld des aktuell
bearbeiteten Eintrags übernommen (Req 17.34). Der `_archive`-Ordner erscheint nie.

**Audio-/Video-Picker (Req 17.19):** Für die Felder `audio` und `video` gibt es je einen
Medien-Picker analog zum ImagePicker. Er listet die passenden Mediendateien aus dem
`import_dir` über den `FileSystemAccessService` (ohne `_archive`) und übernimmt bei Auswahl
den **Dateinamen** (ohne Pfad) in das jeweilige Feld (Req 17.35).

**Entwurf per Auswahl eines unbekannten Weins (Req 17.36/17.37):** Die Auswahl eines
unbekannten Weins (Klick auf Eintrag oder Bild) öffnet den `WineEditor` als Entwurf und zeigt
das vollständige Formular, ohne eine JSON anzulegen; alle Felder außer `name` sind
schreibgeschützt, `image`/`tasting_date` sind vorbefüllt.

**`name`-Autocomplete & manuelles Anlegen (Req 17.38–17.43):** Das `name`-Feld schlägt
ausschließlich **bestehende bildlose Weineinträge** vor (JSON ohne gesetztes `image`-Feld),
clientseitig aus dem Wine-Listing gefiltert (Req 17.38). Das Tippen legt nichts an; erst die
Schaltfläche „Wein anlegen“ (nur bei nicht-leerem Namen, Req 17.39) schreibt — und deckt zwei
Wege ab:

- **(a) Eigener neuer Name (Req 17.40):** Neue JSON im selben Unterordner wie das Bild
  (Bild-Basisname + `.json`) mit Name, `image` und den eingegebenen Feldern.
- **(b) Exakter Treffer eines bestehenden bildlosen Eintrags (Req 17.41):** `image`-Feld des
  bestehenden Eintrags setzen, Bild bei Bedarf in dessen Verzeichnis verschieben; keine neue
  JSON. Fortan bearbeitet der WineEditor den bestehenden Eintrag.

Nach einem manuell abgeschlossenen Anlegevorgang existiert für denselben Wein **genau eine**
JSON-Quelldatei (Req 17.42); der Wein bleibt im WineEditor geöffnet (aufgelöst aus den rohen
Scan-Daten, unabhängig vom Listenfilter) und der Auto-Save greift fortan normal. Schlägt das
Anlegen bzw. beim Weg (b) das Setzen des `image`-Feldes oder das Bildverschieben fehl, zeigt
die App eine erkennbare Fehleranzeige und hinterlässt **keinen** Zustand mit doppelter JSON
für denselben Wein (Req 17.43). Die Invariante lautet: **niemals zwei JSON-Dateien für
denselben Wein.**

**Archivieren (kein Löschen):** Der Editor bietet keine Lösch-Funktion (Req 17.44). Als
entfernende Aktionen existieren ausschließlich: ungenutztes Bild archivieren bzw. angelegten
Eintrag samt referenzierter `image`/`audio`/`video`-Medien archivieren — jeweils durch
Verschieben nach `import_dir/_archive/` über die File System Access API. Bei Fehlschlag
zeigt die App eine erkennbare Fehleranzeige und die Dateien bleiben am Ursprungsort
(Req 17.46–17.48). Nach dem Archivieren aktualisiert die App die Liste automatisch (Req
17.6). Dearchivieren erfolgt manuell im Dateisystem (Req 17.50).

---

---

## Data Models

### Python (`scripts/weinimport.py`)

```python
from dataclasses import dataclass, field
from typing import Optional, Any

@dataclass
class Wine:
    name: str
    year: Optional[int]           = None
    country: Optional[str]        = None
    origin: Optional[str]         = None
    grape: Optional[str | list[str]] = None
    type: Optional[str]           = None
    producer: Optional[str]       = None
    quality: Optional[str]        = None
    price: Optional[str]          = None
    rating: Optional[float]       = None
    tasting_date: Optional[str]   = None   # ISO-8601: "YYYY-MM-DD"
    image: Optional[str]          = None
    audio: Optional[str]          = None
    video: Optional[str]          = None
    description: Optional[str]    = None
    extra: dict[str, Any]         = field(default_factory=dict)

@dataclass
class SchemaField:
    field: str
    type: str                     # "text" | "number" | "date" | "rating" | "multi-value"
    filter_type: str | None       # "text-search" | "range" | "date-range" | "dropdown" |
                                  # "rating-range" | "multi-select" | null
    default_filter: bool
    decimals: int | None = None   # nur für type == "number": 0 = int, 1/2 = float-Präzision

@dataclass
class BackupConfig:
    backup_dir: str
    max_last_backups: int
    max_archival_backups: int
    archival_interval_days: int
    remote_backup_dir: Optional[str] = None

@dataclass
class DeployConfig:
    protocol: str                 # "ftpes"
    remote_path: str
    remote_images_path: str
    remote_import_path: str
    # host/user/password NICHT in der Config — zur Laufzeit aufgelöst
    # (Config > weinsprechstunde.secrets.json > Env _HOST/_USER/_PASSWORD).
    host: str = ""
    user: str = ""
    password: str = ""

# Kein EditorConfig mehr: Die WineEditorApp ist eine reine Browser-App ohne Backend
# und ohne Auth; die früheren Felder editor.path / editor.password_hash entfallen (Req 16.4).

@dataclass
class Config:
    import_dir: str
    import_source: str            # "local" | "remote"
    export_path: str
    scaffold_mode: bool
    image_export_dir: str
    image_resize_mode: str        # "width" | "height"
    image_resize_px: int
    deploy: DeployConfig
    backup: Optional[BackupConfig] = None
```

### TypeScript (`frontend/src/app/models/`)

```typescript
// wine.model.ts
export interface Wine {
  name: string;
  year?: number;
  country?: string;
  origin?: string;
  grape?: string | string[];
  type?: string;
  producer?: string;
  quality?: string | string[];
  price?: number;               // Schema: type "number", decimals 2
  rating?: number;              // Schema: type "number", decimals 1
  tasting_date?: string;        // ISO-8601
  image?: string;
  audio?: string;
  video?: string;
  description?: string;
  [key: string]: unknown;       // unbekannte Zusatzfelder typsicher
}

export interface WineFilter {
  searchText: string;
  // Einzelauswahl-Dropdowns (country, type, producer, quality): Wert = exakter Match oder null.
  dropdowns: Record<string, string | null>;
  // Multiselect-Dropdowns (grape, origin): leeres Array = inaktiv. OR innerhalb, AND zwischen Feldern.
  multiSelects: Record<string, string[]>;
  // Range-Grenzen — jede Grenze ist ein eigener, einzeln zuschaltbarer Filter.
  yearFrom: number | null;
  yearTo: number | null;
  ratingFrom: number | null;
  ratingTo: number | null;
  tastingDateFrom: string | null;
  tastingDateTo: string | null;
}

// Legacy-Typ: im Modell noch vorhanden, aber nicht mehr verwendet (kein navigationFilter-
// Signal, keine /region- bzw. /rebsorte-Routen mehr). Filtern nach Region/Rebsorte läuft
// ausschließlich über multiSelects in der ControlsRow.
export interface NavigationFilter {
  type: 'region' | 'rebsorte';
  slug: string;
}

export const EMPTY_FILTER: WineFilter = {
  searchText: '',
  dropdowns: { country: null, type: null, producer: null, quality: null },
  multiSelects: { grape: [], origin: [] },
  yearFrom: null, yearTo: null,
  ratingFrom: null, ratingTo: null,
  tastingDateFrom: null, tastingDateTo: null,
};

export type SortOption =
  | 'tasting_date_desc'
  | 'tasting_date_asc'
  | 'rating_desc'
  | 'price_desc'
  | 'price_asc'
  | 'name_asc'
  | 'name_desc';
export type LoadState   = 'idle' | 'loading' | 'loaded' | 'error';

// wine-schema.model.ts
export type FilterType =
  | 'text-search' | 'range' | 'date-range'
  | 'dropdown' | 'rating-range' | 'multi-select'
  | null;

export interface WineSchemaField {
  field: string;
  type: 'text' | 'number' | 'date' | 'multi-value';   // reales Schema nutzt nur diese vier
  filter_type: FilterType;
  default_filter: boolean;
  decimals?: number;   // nur für type 'number': 0 = Integer (year), 1 = rating, 2 = price
}

// user-preferences.model.ts
export interface UserPreferences {
  visibleFilters: string[];
  sortOption: SortOption;
  viewMode: 'grid' | 'list';
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Rekursive Dateierfassung

*For any* Verzeichnisbaum mit JSON-Dateien in beliebig tief verschachtelten Unterordnern: Die Funktion `collect_json_files` muss alle JSON-Dateien in der Ergebnisliste enthalten — unabhängig von der Tiefe der Verschachtelung.

**Validates: Requirements 2.2**

### Property 2: Ungültige Einträge werden ausgeschlossen

*For any* JSON-Objekt ohne `name`-Feld: Dieses Objekt darf nicht in der exportierten `wines.json` enthalten sein — weder nach Phase export noch nach Phase prepare.

**Validates: Requirements 2.3, 3.3**

### Property 3: `tasting_date` wird nie überschrieben

*For any* JSON-Datei mit bereits bestehendem `tasting_date`-Feld: Nach Ausführung der Phase prepare muss der Wert von `tasting_date` identisch mit dem ursprünglichen Wert sein.

**Validates: Requirements 2.7**

### Property 4: `scaffold_mode=true` — Vollständigkeit und Werterhaltung

*For any* Wine-JSON mit einer beliebigen Teilmenge der Schema-Felder gesetzt und `scaffold_mode=true`: Nach `apply_scaffold_mode` müssen (1) alle in `wine-schema.json` definierten Felder im Objekt vorhanden sein und (2) alle ursprünglich gesetzten Nicht-null-Werte unverändert erhalten bleiben.

**Validates: Requirements 2.14**

### Property 5: `scaffold_mode=false` — Keine null/leeren Felder

*For any* Wine-JSON mit beliebigen Feldern (darunter einige mit `null` oder leerem String) und `scaffold_mode=false`: Nach `apply_scaffold_mode` darf kein Feld mit dem Wert `null` oder `""` im Objekt verbleiben.

**Validates: Requirements 2.15**

### Property 6: Sortiertinvariante

*For any* Liste von Wine-Objekten mit und ohne `tasting_date`: Nach der Sortierung durch Phase export gilt — alle Weine mit `tasting_date` erscheinen vor allen Weinen ohne `tasting_date`, und die Weine mit `tasting_date` sind absteigend nach dem Datum geordnet.

**Validates: Requirements 3.5**

### Property 7: JSON-Roundtrip

*For any* Liste von Wine-Objekten, die Phase export in `wines.json` schreibt: Das anschließende Parsen der geschriebenen Datei muss eine strukturell äquivalente Liste ergeben — kein Datenverlust, keine Typänderungen.

**Validates: Requirements 3.6**

### Property 8: Unbekannte Felder werden bewahrt

*For any* Wine-JSON mit beliebigen Zusatzfeldern (Felder außerhalb der Schema-Definition): Alle diese Zusatzfelder müssen unverändert in der exportierten `wines.json` enthalten sein.

**Validates: Requirements 3.4**

### Property 9: Bildskalierung erhält Seitenverhältnis

*For any* Bild mit beliebigen Dimensionen (Breite × Höhe) und beiden `image_resize_mode`-Werten (`"width"` / `"height"`): Das Seitenverhältnis des skalierten Exports muss innerhalb einer Toleranz von 0,01 dem Seitenverhältnis des Originals entsprechen.

**Validates: Requirements 4.7**

### Property 10: Freitextsuche — Vollständigkeit und Korrektheit

*For any* Liste von Weinen und *for any* Suchbegriff: Jeder Wein in der gefilterten Ergebnisliste muss den Suchbegriff (case-insensitiv) in mindestens einem der Felder mit `filter_type = "text-search"` enthalten. Kein Wein, der in keinem dieser Felder übereinstimmt, darf im Ergebnis erscheinen.

**Validates: Requirements 9.2**

### Property 11: Kombinierte Filter — AND-Logik

*For any* Kombination aktiver Filterkriterien (dropdowns: country/type/producer/quality, multiSelects: grape/origin, yearFrom/To, ratingFrom/To, tastingDateFrom/To) und *for any* Wein in der gefilterten Ausgabe: Der Wein muss alle aktiven Filterkriterien gleichzeitig erfüllen (AND zwischen Feldern; OR innerhalb eines Multiselect-Feldes). Kein Wein, der auch nur ein aktives Kriterium verletzt, darf in der Ausgabe erscheinen.

**Validates: Requirements 9.13**

### Property 12: InfoToggle wirkt auf alle Kacheln

*For any* Menge gerenderter WineTiles mit beliebigem lokalem Overlay-Zustand: Wenn `infoToggleActive === true`, muss `overlayVisible` für jede einzelne Kachel `true` sein — unabhängig vom jeweiligen `localOverlay`-Zustand.

**Validates: Requirements 9.17**

### Property 13: InfoToggle-Roundtrip

*For any* WineTile-Zustand: Das Aktivieren von `infoToggleActive` gefolgt vom Deaktivieren muss `overlayVisible` bei jeder Kachel wieder ausschließlich durch `localOverlay` bestimmen lassen — der Ausgangszustand ist vollständig wiederhergestellt.

**Validates: Requirements 9.18**

### Property 14: Reihenfolge nach Filterung erhalten

*For any* Filteroperation auf einer sortierten Weinliste: Die Reihenfolge der Weine in `visibleWines` muss exakt der Reihenfolge in `filteredWines` entsprechen — keine Umsortierung durch das Rendering (es werden ohnehin alle gefilterten Weine direkt gerendert).

**Validates: Requirements 11.1**

### Property 15: WineTileOverlay — Datenvollständigkeit

*For any* Wine-Objekt mit einer beliebigen Teilmenge der Overlay-Felder (Name, Jahr, Herkunftsregion, Typ, Weingut, Rating, Rebsorte): Die gerenderte WineTileOverlay-Komponente muss alle im Objekt vorhandenen (nicht-null) Overlay-Felder anzeigen.

**Validates: Requirements 12.4**

### Property 16: WineDetailDialog — Feldvollständigkeit

*For any* Wine-Objekt mit beliebigen Feldern (bekannte Pflicht- und Optionalfelder sowie unbekannte Zusatzfelder): Der WineDetailDialog muss alle im Objekt vorhandenen Felder anzeigen — kein Feld darf ausgelassen werden.

**Validates: Requirements 14.2**

### Property 17: Konflikt-Erkennung über `File.lastModified`

*For any* Weineintrag: Wenn der Auto-Save der WineEditorApp beim Speichern feststellt, dass die `File.lastModified` der JSON-Quelldatei seit dem Laden abweicht (die Datei wurde extern verändert), muss der Schreibvorgang abgelehnt und eine Konfliktwarnung ausgelöst werden, ohne die Datei ohne Bestätigung zu überschreiben.

**Validates: Requirements 17.25**

### Property 18: WineSchema-Roundtrip

*For any* gültige `wine-schema.json`-Datei: Das Einlesen durch `load_wine_schema` und das anschließende Serialisieren der zurückgegebenen `SchemaField`-Liste muss eine strukturell äquivalente JSON-Struktur ergeben — kein Datenverlust, keine Typenänderungen.

**Validates: Requirements 18.1**

### Property 19: UserPreferences Cookie-Roundtrip

*For any* `UserPreferences`-Objekt mit beliebiger Kombination aus `visibleFilters`, `sortOption` und `viewMode`: Das Speichern via `UserPreferencesService.save()` gefolgt von `UserPreferencesService.load()` muss das strukturell äquivalente Objekt zurückgeben — kein Datenverlust.

**Validates: Requirements 19.1, 19.2, 19.3**

### Property 20: Last-Backup Rolling Window

*For any* Sequenz von Pipeline-Läufen mit konfiguriertem `max_last_backups = N` und beliebigem `N ≥ 1`: Nach jedem Lauf darf die Anzahl der `last_*.json`-Dateien im `backup_dir` niemals größer als `N` sein (die Marker-Datei `.last_archival` zählt nicht).

**Validates: Requirements 20.2, 20.3**

### Property 21: Archival-Backup Intervall-Invariante

*For any* Sequenz von Pipeline-Läufen mit `archival_interval_days = D`: Der zeitliche Abstand zwischen zwei aufeinanderfolgenden Archival-Backups muss stets ≥ D Tage betragen. Kein Archival-Backup wird erstellt, wenn weniger als D Tage seit dem letzten vergangen sind.

**Validates: Requirements 20.4, 20.5**

### Property 23: Clientseitiges Thumbnail lässt Original unverändert und erhält Seitenverhältnis

*For any* Originalbild (`.jpg/.jpeg/.png/.webp`) mit beliebigen Dimensionen im `import_dir`: Nach der clientseitigen Thumbnail-Erzeugung des `FileSystemAccessService` (Canvas / `createImageBitmap`) muss (1) die Originaldatei byte-identisch unverändert bleiben und (2) das Seitenverhältnis der erzeugten Vorschau innerhalb einer Toleranz von 0,01 dem Seitenverhältnis des Originals entsprechen.

**Validates: Requirements 17.33**

### Property 24: Anlegen eines Entwurfs — Ort, Name und Feldbelegung

*For any* Bilddatei in einem beliebigen Unterordner des `import_dir` und *for any* eingegebenen neuen Namen: Nach dem manuellen Anlegen eines Entwurfs (über den `FileSystemAccessService`) muss die erzeugte JSON-Datei (1) im selben Unterordner wie das Bild liegen, (2) als Basisnamen den Basisnamen des Bildes tragen (Endung `.json`), (3) `image` auf den Dateinamen des Bildes (ohne Pfad) und (4) `name` auf den eingegebenen Namen gesetzt haben — ohne dass eine Umbenennung nach `{tasting_date}-{slug(name)}` stattfindet (diese bleibt der PhasePreparate überlassen).

**Validates: Requirements 17.35, 17.36, 17.40**

### Property 25: Genau eine JSON pro Wein nach link-image-Verknüpfung

*For any* unbekannten Wein (Entwurf) und *for any* bestehenden bildlosen Weineintrag: Nach Abschluss des Verknüpfungswegs (link-image über den `FileSystemAccessService`) existiert für den betroffenen Wein **genau eine** JSON-Quelldatei — die des bestehenden Eintrags mit auf den Bild-Dateinamen gesetztem `image`-Feld, während keine zweite JSON angelegt wird und Bild und JSON im selben Verzeichnis liegen. Schlägt das Entfernen der vorläufigen JSON oder das Verschieben des Bildes fehl, darf **kein** Zustand mit zwei JSON-Quelldateien für denselben Wein zurückbleiben.

**Validates: Requirements 17.41, 17.42, 17.43**

### Property 26: Zugriff bleibt auf den freigegebenen Ordner beschränkt

*For any* datei- und bildbezogene Operation der WineEditorApp (Lesen, Schreiben, Anlegen, Verschieben, Thumbnail, Archivieren): Der Zugriff bleibt ausschließlich auf den vom Benutzer freigegebenen Cloud-Ordner (= `import_dir`) und dessen Inhalt beschränkt; ein Ausbruch über diesen Ordner hinaus ist durch die File System Access API technisch ausgeschlossen (API-garantiert, keine anwendungsseitige Pfadprüfung).

**Validates: Requirements 16.2**

### Property 27: Editor-Typkonvertierung beim Auto-Save

*For any* `number`-Feld der WineSchema und *for any* Eingabewert, der eine Zahl mit optionalem Dezimal-Komma darstellt: Der beim Auto-Save geschriebene JSON-Wert muss eine Zahl sein, die der konfigurierten `decimals`-Normalisierung entspricht (`year` Ganzzahl, `price` 2 Nachkommastellen, `rating` 1 Nachkommastelle), wobei ein Dezimal-Komma wie ein Dezimalpunkt behandelt wird (z. B. „6,99" → `6.99`) — konsistent zur Normalisierung im ImportScript.

**Validates: Requirements 17.22**

### Property 28: Schema-fremde Felder bleiben erhalten

*For any* gültige JSON-Quelldatei mit beliebigen Feldern außerhalb der WineSchema: Nach dem Laden im WineEditor und einem anschließenden Auto-Save müssen alle schema-fremden Felder unverändert in der JSON-Quelldatei enthalten sein — kein schema-fremdes Feld darf entfernt oder verändert werden.

**Validates: Requirements 17.27**

---

## Error Handling

| Szenario | Verhalten |
|---|---|
| ConfigFile fehlt oder kein valides JSON | ImportScript bricht mit lesbarer Fehlermeldung auf stderr ab (exit 1) |
| wine-schema.json fehlt | ImportScript bricht mit Fehlermeldung auf stderr ab (exit 1) |
| JSON-Quelldatei ohne `name`-Feld | Datei überspringen, Warnung auf stderr |
| Umbenennung: Zieldatei existiert bereits | Umbenennung überspringen, Warnung auf stderr |
| Referenziertes Bild nicht im import_dir | Warnung auf stderr, nächster Eintrag |
| Remote-Import-Download fehlgeschlagen | ImportScript bricht mit Fehlermeldung (Serverpfad + Server-Meldung) ab (exit 1) |
| deploy.password leer + Env-Variable fehlt | ImportScript bricht mit präziser Fehlermeldung ab (exit 1) |
| Serververbindung schlägt fehl (deploy) | ImportScript bricht mit präziser Fehlermeldung (Host + Protokoll + Server-Meldung) ab (exit 1) |
| Backup fehlgeschlagen (lokal oder remote) | Warnung auf stderr, Pipeline läuft trotzdem weiter |
| `wines.json` nicht erreichbar (Frontend) | `loadState = 'error'`, Fehlermeldung im Hauptbereich |
| Wine ohne `image`, kein Sibling gefunden | PlaceholderIcon in WineTileCover rendern |
| Leere Filterergebnisse (Frontend) | Hinweismeldung „Keine Weine gefunden" im Grid/List |
| Unbekannte Felder in Wine-JSON | Werden unverändert durchgereicht (`[key: string]: unknown`) |
| Editor: Ordner-Freigabe verweigert/zurückgezogen | Editor zeigt Aufforderung zur (Re-)Freigabe des Cloud-Ordners; ohne Freigabe kein Datenzugriff (Req 17.2/17.3) |
| Editor: fehlende File System Access API (nicht-Chromium-Browser) | Verständlicher Hinweis statt Editor-Oberfläche (Req 17.4) |
| Editor: Schreibfehler beim Auto-Save | Speicherstatus „Fehler", zuletzt eingegebene Feldinhalte bleiben erhalten (Req 17.24) |
| Editor: Konflikt beim Speichern (`File.lastModified` abweichend) | Konfliktwarnung vor dem Überschreiben, kein Schreiben ohne Bestätigung (Req 17.25) |
| Editor: defekte JSON-Quelldatei | In Liste als fehlerhaft markiert, nicht im WineEditor geöffnet (Req 17.26) |
| Editor: Archiv-Verschieben schlägt fehl | Datei bleibt am Ursprungsort, erkennbare Fehleranzeige (Req 17.48) |
| Editor: link-image/Verschieben schlägt fehl | Kein Zustand mit doppelter JSON, erkennbare Fehleranzeige (Req 17.43) |
| Editor: gleichzeitige Cloud-Sync-Bearbeitung | Cloud-Sync kann Konfliktkopien erzeugen; die WineEditorApp löst das nicht auf (Req 17.5) |

---

## Testing Strategy

**Zwei Teststacks:** Python (Import-Skript mit pytest + hypothesis) und
Angular (öffentliche Weinliste, Wine-Editor-App und die geteilte Library mit vitest + jsdom +
fast-check über `ng test` / `@angular/build:unit-test`). Die Wine-Editor-App hat kein Backend und damit keinen eigenen Teststack mehr —
sie wird im Angular-Stack getestet.

### Python Import-Skript (pytest + hypothesis)

- **Unit-Tests** mit temporären Verzeichnissen (`tmp_path`):
  - `phase_backup`: Einzeldatei-Kopie der exportierten wines.json, Rolling Window für last_*.json und archival_*.json, Intervall-Prüfung, Remote-Upload (Fake-FTP)
  - `phase_prepare`: EXIF-Auslesen, Auto-detect image, Umbenennung, scaffold_mode
  - `phase_export`: Sortierung, Felderhaltung, Dateischreiben
  - `phase_image_export`: Skalierung, Timestamp-Check, Formaterhalt
  - `phase_deploy`: Timestamp-Vergleich, selektives Löschen, Passwort-Fallback
  - `load_wine_schema`: Parsen, Fehlerfälle
  - `download_remote_import`: Fehlerbehandlung bei fehlgeschlagenem Download
- **Property-Tests (hypothesis)**: Properties 1–9, 18, 20, 21
  - Mindestens 100 Iterationen pro Property
  - Tag-Format: `# Feature: weinliste, Property N: <property_text>`

### Angular Frontend (vitest + jsdom + fast-check)

- **Unit-Tests**: WineDataService (HTTP-States, paralleles Laden), FilterService (Filterlogik inkl. dropdowns/multiSelects/Bound-Filter, resetFilterKey, Cookie-Init), AppComponent (Tastaturkürzel i/l inkl. Guard-Bedingungen; Pfeiltasten-Navigation ←/→: nächster/vorheriger Wein mit Modulo-Wrap über `filteredWines`, Öffnen des ersten Weins bei `→` bzw. des letzten bei `←` wenn kein Dialog offen ist, i/l bei offenem Dialog blockiert während ←/→ navigieren, sowie Guards in Eingabefeldern und mit Modifier-Tasten), ControlsRowComponent (Filterkatalog, Mehr-Filter-Menü, removeFilter), FilterFieldComponent (Freitextsuche, Multiselect-Dropdown, Bound-Felder), SortButtonComponent (5 Optionen), WineTileComponent (Overlay-Toggle, Play-Button), WineDetailDialogComponent (close, Backdrop-Click, Body-Scroll-Lock), NavComponent (Logo-Klick = clearAllFilters + '/'), WineListItemComponent (Thumbnail + Felder), UserPreferencesService (Cookie-Roundtrip), WineGridComponent/WineListComponent (alle Weine gerendert, Zurück-Button)
- **Property-Tests (fast-check)**: Properties 10–16, 19
  - `applyFiltersAndSort` — Properties 10, 11, 14 (pure function, kein DOM nötig)
  - WineTileComponent — Properties 12, 13, 15 (via TestBed)
  - WineDetailDialogComponent — Property 16 (via TestBed)
  - UserPreferencesService — Property 19 (Cookie-Roundtrip)
  - Mindestens 100 Iterationen: `fc.assert(fc.property(...), { numRuns: 100 })`
  - Tag-Format: `// Feature: weinliste, Property N: <property_text>`

### Wine-Editor-App: Angular (vitest + jsdom + fast-check)

Die Editor-Angular-App (`frontend/projects/editor`) ist eine reine Browser-App ohne
Backend und wird mit **demselben Test-Setup wie die öffentliche Weinliste** getestet
(`ng test`, vitest + jsdom + fast-check). Es gibt **keine** FastAPI-/pytest-Tests mehr. Die File
System Access API wird in den Tests über den `FileSystemAccessService` gemockt/abstrahiert
(ein Fake-Service bzw. gemockte Verzeichnis-/Datei-Handles), sodass Listings, Anlegen,
Verschieben, Konflikterkennung und Thumbnail-Erzeugung ohne echten Dateizugriff prüfbar sind.

- **Browser-Voraussetzungen & Ordner-Freigabe**: kein Login-Screen — Start ohne Anmeldung (Req 16.1/17.1); Ordner-Freigabe beim ersten Start und Handle-Persistenz/-Wiederherstellung über IndexedDB (gemockt), Re-Autorisierung beim erneuten Öffnen (Req 17.2/17.3); verständlicher Hinweis bei fehlender File System Access API (nicht-Chromium-Browser, Req 17.4)
- **Keine Netzwerkanfragen für Daten / keine Weindaten in der App**: alle Datenzugriffe laufen über den `FileSystemAccessService` auf den freigegebenen `import_dir`; die App enthält keine gebündelten Weindaten (Req 16.2/16.3)
- **Unit-Tests**: Auto-Refresh der Liste nach eigener Aktion (Anlegen/Archivieren/Verknüpfen/Speichern) und manueller Aktualisieren-Button (erneuter Scan) ohne Polling (Req 17.6/17.7), Zwei-Spalten-Layout/Eintragsauswahl (Req 17.8/17.9), Standard-Sortierung über den geteilten FilterService (tasting_date absteigend, gemischte Typen, undatierte ans Ende, Req 17.12), Eintragstyp-Filter (drei Zustände; Auto-Umschalten „Nur unbekannte" → „Nur angelegte" bei attributbasierter Eingabe, Req 17.14/17.15), WineEditor-Formular aus WineSchema (Datepicker, Rating-Step, Req 17.16), Dropdown-/Multi-Select-Werte aus geladenen Einträgen (Req 17.17), grape als Tag-/Chip-Eingabe mit Autocomplete → Array (Req 17.18), Audio-/Video-Picker übernimmt Dateiname (Req 17.19/17.35), Unvollständig-Markierung bei leerem `name` in Liste und WineEditor ohne Blockieren (Req 17.20), defekte JSON in Liste als fehlerhaft markiert und nicht öffenbar (Req 17.26), schema-fremde Felder angezeigt und beim Speichern erhalten (Req 17.27), Bild-Listing mit `date`/`assigned` und unbekannte Weine (`assigned = false`; Bildtypen `.jpg/.jpeg/.png/.webp` case-insensitive, Req 17.28/17.29/17.32), ImagePicker (Standard „nur ungenutzte" / Umschalt-Button auf alle / Datumssortierung / Dateinamen-Filter, clientseitige Thumbnail-Vorschau, Req 17.28–17.31/17.34), Auto-Save-Debounce (500 ms) direkt über die File System Access API + Typkonvertierung der number-Felder + Speicherstatus-Indikator (Erfolg/Fehler, Req 17.21–17.24), Konfliktwarnung bei abweichender `File.lastModified` (Req 17.25), Entwurf eines unbekannten Weins (volles Formular ohne JSON, Felder außer `name` readonly, `image`/`tasting_date` vorbefüllt, Req 17.36/17.37), manuelles Anlegen per „Wein anlegen“-Button (Req 17.39) mit zwei Wegen — eigener neuer Name (neue JSON, Req 17.40) bzw. exakter Treffer → Verknüpfung (link-image, Req 17.41), am Ende genau eine JSON pro Wein, Wein bleibt geöffnet, Fehleranzeige ohne doppelte JSON (Req 17.38–17.43), Archivieren-Aktionen (Verschieben nach `_archive/`) inkl. Fehleranzeige — **keine** Lösch-Aktion (Req 17.44/17.46–17.48), `_archive`-Ignorierung bei allen Scans (Req 17.49)
- **Property-Tests (fast-check)**: Property 17 (Konflikt-Erkennung über `File.lastModified`), Property 23 (clientseitiges Thumbnail lässt Original unverändert, Seitenverhältnis), Property 24 (Entwurf-Anlegen: Ort/Name/Feldbelegung), Property 25 (genau eine JSON pro Wein nach link-image-Verknüpfung), Property 26 (Zugriff bleibt auf den freigegebenen Ordner beschränkt — über den gemockten `FileSystemAccessService`), Property 27 (Editor-Typkonvertierung), Property 28 (schema-fremde Felder bleiben erhalten)
  - Mindestens 100 Iterationen: `fc.assert(fc.property(...), { numRuns: 100 })`
  - Tag-Format: `// Feature: weinliste, Property N: <property_text>`
- **Geteilte Library (`@weinsprechstunde/shared`)**: FilterService-, Filter-/Such-/Sortier- und WineSchema-Verarbeitungslogik wird durch die bestehenden Tests der Library abgedeckt (vitest + jsdom + fast-check, Properties 10, 11, 14 der `applyFiltersAndSort`-Logik, inkl. der Standard-Sortierung aus Req 17.12) und gilt damit für beide Apps gemeinsam — keine Duplizierung der Tests.
