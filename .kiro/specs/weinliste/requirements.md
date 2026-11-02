# Requirements Document

## Introduction

„Weinsprechstunde" ist eine Webanwendung bestehend aus zwei vollständig unabhängigen Prozessen:

1. **Python Import-Skript** (eigenständig): Liest JSON-Dateien aus einem konfigurierten Import-Ordner ein, bereitet diese in mehreren Phasen auf (`prepare`, `export`, `image-export`, `deploy`) und schreibt eine fertige `wines.json` sowie skalierte Bildkopien. Es kann optional auch Artefakte auf einen Webserver deployen.
2. **Angular SPA Frontend** (eigenständig): Liest die fertig exportierte `wines.json` und stellt die Weine in einer Kachel- oder Listenansicht dar. Hat keinerlei Laufzeitabhängigkeit zum Import-Skript.

Das Verhalten des Import-Skripts wird durch eine zentrale Konfigurationsdatei `weinsprechstunde.config.json` im Projekt-Root gesteuert. Die Felddefinitionen aller Weinattribute (Typ, Filter-Typ, Sichtbarkeit) sind in einer zweiten zentralen Konfigurationsdatei `wine-schema.json` im Projekt-Root definiert, die von Python-Skript, Angular-Frontend und Wine-Editor gemeinsam genutzt wird.

Das Design und die Komponentenstruktur des Frontends orientieren sich eng am bestehenden Angular Musikalben-Frontend (`album-collection-frontend`), dessen Komponenten direkt in die Weinliste übernommen und angepasst werden:

| Musikalben-Frontend | Weinlisten-Frontend |
|---|---|
| `album-wall` | `wine-wall` |
| `album-tile` | `wine-tile` |
| `album-tile-overlay` | `wine-tile-overlay` |
| `album-tile-cover` | `wine-tile-cover` |
| `album-list-item` | `wine-list-item` |
| `controls-row` | `controls-row` |
| `nav` | `nav` |
| `sort-button` | `sort-button` |
| `scroll-top-button` | `scroll-top-button` |

Die Anwendung richtet sich sowohl an Weinkenner (Autoren Toni und Simone sowie Gäste wie Olfi und Stephan) als auch an Weinlaien (wie Johannes).

## Glossary

- **App**: Das Angular SPA „Weinsprechstunde" als Ganzes.
- **Wine**: Ein einzelner Wein mit Pflichtfeldern `name` und `year` sowie optionalen Feldern `origin`, `grape`, `country`, `region`, `price`, `description`, `producer`, `quality` (String oder Array), `rating`, `tasting_date`, `image`, `audio`, `video` und beliebigen weiteren unbekannten Zusatzfeldern.
- **ImportScript**: Das eigenständige Python-Skript, das JSON-Dateien aus dem Import-Ordner einliest, sie in mehreren Phasen (`prepare`, `export`, `image-export`, optional `deploy`) verarbeitet.
- **MigrationScript**: Das eigenständige, einmalig ausführbare Python-Skript (`scripts/wordpress_migrate.py`), das WordPress-Weindaten aus mehreren SQL-Dateien im Verzeichnis `migrate_wordpress/` (vollständige DB-Dumps sowie einzelne Tabellen-Exporte wie `wp_postmeta.sql` und `wp_term_relationships.sql`) und dem Unterordner `migrate_wordpress/uploads/` in JSON-Weindateien und Bilder im Import-Ordner überführt. Erzeugt die erste Datengrundlage der Anwendung und ist unabhängig vom regulären ImportScript. Das Skript arbeitet in einem kontrollierten Zwei-Schritt-Prozess: Im Analyse-Schritt (`analyze`) werden die Dumps untersucht und eine prüfbare Mapping-Datei (WordPressMapping) erzeugt, ohne Daten zu schreiben; im Migrations-Schritt (`migrate`) werden die Weindaten und Bilder ausschließlich gemäß der vom Benutzer geprüften Mapping-Datei erzeugt.
- **WordPressMapping**: Die Datei `wordpress-mapping.json`, die im Analyse-Schritt der Migration erzeugt und vom Benutzer geprüft wird. Sie legt für jedes WordPress-Weinfeld fest, ob es auf ein WineSchema-Feld gemappt (`map`), als Platzhalter erhalten (`unmapped`) oder verworfen (`ignore`) wird. Der Migrations-Schritt verarbeitet Felder ausschließlich gemäß dieser Datei.
- **ConfigFile**: Die zentrale Konfigurationsdatei `weinsprechstunde.config.json` im Projekt-Root, die alle Laufzeitparameter des ImportScripts enthält (`import_dir`, `export_path`, `image_export_dir`, `image_resize_mode`, `image_resize_px` sowie ein `deploy`-Objekt und ein `editor`-Objekt mit den Feldern `editor.path` (URL-Pfad des Editors) und `editor.password_hash` (bcrypt-Hash des Passworts)).
- **WineSchema**: Die Datei `wine-schema.json` im Projekt-Root, die für jedes bekannte Weinattribut den Datentyp (`type`), den Filter-Typ (`filter_type`), ob es standardmäßig als Filter angezeigt wird (`default_filter`) und optional für `number`-Felder die Anzahl der Nachkommastellen (`decimals`: `0` = Integer, `1`/`2` = Float mit entsprechender Präzision) definiert. Wird von Python-Skript, Angular-Frontend und Wine-Editor gemeinsam genutzt.
- **FilterType**: Der Filtertyp eines Feldes laut WineSchema. Mögliche Werte: `text-search`, `range`, `date-range`, `dropdown`, `rating-range`, `multi-select`, oder `null` (nicht filterbar).
- **FilterService**: Der zentrale Angular-Service der den gesamten Filter-, Such- und Sortierzustand der App verwaltet. Alle Komponenten und Routen lesen gefilterte Weine ausschließlich über den FilterService. Keine Filterlogik darf außerhalb des FilterService implementiert werden.
- **UserPreferences**: Im Browser-Cookie `ws_prefs` gespeicherte Benutzereinstellungen ohne festes Ablaufdatum: welche zusätzlichen Filter eingeblendet sind (nur Feldnamen), gewählte Sortierung, aktive Ansicht (Grid oder Liste).
- **ActiveFilters**: Die in der ControlsRow aktuell sichtbaren Filter — die fest sichtbare Freitextsuche plus vom Benutzer zusätzlich eingeblendete optionale Filter.
- **WineDataAsset**: Die Datei `wines.json`, die als Angular-Asset ausgeliefert wird und ausschließlich durch das ImportScript erzeugt wird.
- **PhasePreparate** (Phase `prepare`): Die erste Phase des ImportScripts, die JSON-Quelldateien aufbereitet: EXIF-Daten liest, Dateien umbenennt und Felder gemäß WineSchema aufbereitet.
- **PhaseExport** (Phase `export`): Die zweite Phase des ImportScripts, die aufbereitete JSON-Quelldateien liest, sortiert und die WineDataAsset schreibt.
- **PhaseImageExport** (Phase `image-export`): Die dritte Phase des ImportScripts, die zu den Weinen gehörige Bilddateien aus dem `import_dir` liest, skaliert und als Kopien in den `image_export_dir` schreibt, ohne die Originale zu verändern.
- **PhaseDeploy** (Phase `deploy`): Die vierte Phase des ImportScripts, die den Angular Build-Output, die WineDataAsset und die exportierten Bilder per FTP oder SFTP auf einen konfigurierten Webserver überträgt.
- **scaffold_mode**: Ein boolescher Konfigurationsparameter, der steuert, ob fehlende Felder in JSON-Quelldateien mit `null` aufgefüllt (`true`) oder Felder mit `null`/Leer-Wert entfernt werden (`false`).
- **Slug**: Ein URL-freundlicher Bezeichner, der aus dem `name`-Feld eines Weins erzeugt wird (Kleinschreibung, Leerzeichen durch Bindestriche ersetzt, Sonderzeichen entfernt).
- **image_export_dir**: Der konfigurierte Zielordner für skalierte Bildkopien, der vom ImportScript in der PhaseImageExport befüllt wird. Dieser Ordner ist von den Angular-Assets getrennt und wird separat konfiguriert.
- **BackupConfig**: Das optionale `backup`-Objekt in der ConfigFile mit den Feldern `backup_dir`, `remote_backup_dir`, `max_last_backups`, `max_archival_backups` und `archival_interval_days`. Steuert zwei unabhängige Rolling-Window-Backups: **Last-Backups** (Präfix `last_`) werden bei jedem Pipeline-Lauf erstellt und bewahren die letzten `max_last_backups` Builds; **Archival-Backups** (Präfix `archival_`) werden nur erstellt wenn mindestens `archival_interval_days` Tage vergangen sind und bewahren die letzten `max_archival_backups` Snapshots. Bei beiden wird das älteste gelöscht wenn das jeweilige Maximum überschritten wird.
- **DeployConfig**: Das `deploy`-Objekt in der ConfigFile mit den Feldern `protocol`, `host`, `user`, `password`, `remote_path`, `remote_images_path` und `remote_import_path`, das alle Verbindungsparameter für PhaseDeploy und den optionalen Remote-Import-Download enthält.
- **import_source**: Konfigurationsfeld in der ConfigFile das bestimmt ob der Import-Ordner lokal (`"local"`) oder per FTP/SFTP vom Webserver (`"remote"`) geladen wird. Im `"remote"`-Modus wird der Inhalt von `deploy.remote_import_path` vor der PhasePreparate auf den lokalen Rechner synchronisiert.
- **GitHubSecrets**: Der verschlüsselte Secret-Store von GitHub, in dem sensitive Zugangsdaten (z. B. `WEINSPRECHSTUNDE_DEPLOY_PASSWORD`) hinterlegt werden. Secrets werden zur Laufzeit von GitHub Actions als Umgebungsvariablen in den Workflow injiziert und sind niemals im Klartext im Repository sichtbar.
- **WineWall**: Die Hauptansicht der App mit NavBar, ControlsRow und WineGrid (Kachelansicht) bzw. WineList (Listenansicht).
- **WineTile**: Eine Kachel in der Kachelansicht, die einen Wein mit Bild, Rating-Kreis und Meta-Overlay darstellt.
- **WineTileOverlay**: Das Info-Overlay einer WineTile mit Weindetails (Jahr, Name, Weingut, Rebsorte(n), Rating-Kreis, Region).
- **WineTileCover**: Der Bildbereich einer WineTile mit Fallback auf PlaceholderIcon.
- **WineListItem**: Eine kompakte Zeile in der Listenansicht mit einem kleinen Weinbild-Thumbnail (wiederverwendeter WineTileCover mit PlaceholderIcon-Fallback) sowie Name, Weingut, Jahr, Herkunftsland und Rating.
- **WineDetailDialog**: Ein modaler Dialog mit allen Details eines Weins inkl. AudioPlayer (wenn `audio` vorhanden) und VideoPlayer (wenn `video` vorhanden).
- **ControlsRow**: Die Zeile unterhalb der NavBar mit Freitextsuche, ActiveFilters, „Mehr Filter"-Button, Sortierung, InfoToggle und ListToggle.
- **NavBar**: Die Navigationszeile am oberen Rand der App mit App-Name „Weinsprechstunde" und Logo-Platzhalter. Ein Klick auf das Logo setzt alle aktiven Filter zurück und navigiert zur Route `/`. Die NavBar enthält keine Navigationsmenüpunkte.
- **WineGrid**: Die Kachelansicht aller gefilterten Weine. Alle gefilterten Weine werden direkt gerendert (keine Paginierung, kein Nachladen).
- **WineList**: Die Listenansicht aller gefilterten Weine. Alle gefilterten Weine werden direkt gerendert (keine Paginierung, kein Nachladen).
- **PlaceholderIcon**: Ein SVG- oder eingebettetes Icon als Fallback, wenn kein Weinbild verfügbar ist.
- **InfoToggle**: Ein Schalter in der ControlsRow, der das WineTileOverlay auf allen WineTiles dauerhaft ein- oder ausschaltet.
- **ListToggle**: Ein Schalter in der ControlsRow, der zwischen Kachelansicht (WineGrid) und Listenansicht (WineList) wechselt.
- **RatingCircle**: Eine kreisförmige visuelle Darstellung des Ratings (1.0–10.0) in der oberen rechten Ecke des WineTileOverlays und im WineDetailDialog.
- **AudioPlayer**: Eine eingebettete Audiowiedergabe-Komponente im WineDetailDialog, die erscheint wenn ein Wein ein `audio`-Feld besitzt.
- **VideoPlayer**: Eine eingebettete Videowiedergabe-Komponente im WineDetailDialog, die erscheint wenn ein Wein ein `video`-Feld besitzt.
- **KeyboardShortcuts**: Globale Tastaturkürzel der App: `i` schaltet das WineTileOverlay auf allen WineTiles um (wie InfoToggle), `l` wechselt zwischen Kachel- und Listenansicht (wie ListToggle).
- **tasting_date**: ISO-8601-Datumsstring (z. B. `"2021-10-12"`), der das Verkostungsdatum eines Weins angibt und entweder manuell in der JSON-Quelldatei gesetzt oder vom ImportScript aus EXIF-Daten des Bildes abgeleitet wird.
- **WineEditorApp**: Die eigenständige Web-App zur komfortablen Pflege der JSON-Quelldateien im `import_dir`, erreichbar über denselben Server wie die öffentliche Weinliste. Der Zugriffspfad (URL-Pfad) des Editors ist über `editor.path` in der ConfigFile konfigurierbar und muss nicht öffentlich bekannt sein.
- **ImagePicker**: Eine durchsuchbare Bildauswahl-Komponente in der WineEditorApp, die Bilddateien aus dem `import_dir` anzeigt, standardmäßig gefiltert auf noch nicht zugeordnete Bilder.
- **WineEditor**: Das Bearbeitungsformular für einen einzelnen Weineintrag innerhalb der WineEditorApp.

## Requirements

### Requirement 1: Konfigurationsdatei

**User Story:** Als Autor (Toni, Simone) möchte ich alle Laufzeitparameter des Import-Skripts in einer zentralen Konfigurationsdatei pflegen, damit ich Pfade, Modus und Deploy-Parameter ohne Code-Änderungen anpassen kann.

#### Acceptance Criteria

1. THE ImportScript SHALL eine ConfigFile `weinsprechstunde.config.json` im Projekt-Root einlesen, bevor eine der Phasen ausgeführt wird.
2. THE ConfigFile SHALL die folgenden Pflichtfelder enthalten: `import_dir` (String), `export_path` (String) und `scaffold_mode` (Boolean).
3. WHEN die ConfigFile fehlt oder nicht valide JSON ist, THEN THE ImportScript SHALL mit einer lesbaren Fehlermeldung auf der Standardfehlerausgabe abbrechen.
4. THE ImportScript SHALL den Wert von `import_dir` als Pfad zum Verzeichnis mit den JSON-Quelldateien verwenden, wenn `import_source` in der ConfigFile den Wert `"local"` hat.
5. THE ImportScript SHALL den Wert von `export_path` als Zielpfad für die WineDataAsset verwenden.
6. THE ImportScript SHALL den Wert von `scaffold_mode` zur Steuerung der Feldbehandlung in der PhasePreparate verwenden.
7. THE ImportScript SHALL die Liste der aufzubereitenden Felder aus der `wine-schema.json` lesen (statt aus `optional_fields` in der ConfigFile). Das Feld `optional_fields` in der ConfigFile entfällt.
8. THE ConfigFile SHALL ein Feld `import_source` (String, Wert `"local"` oder `"remote"`) enthalten, das bestimmt ob der Import-Ordner lokal oder per FTP/SFTP vom konfigurierten Webserver geladen wird.
9. WHEN `import_source` den Wert `"remote"` hat, THE ImportScript SHALL den Import-Ordner vor Ausführung der PhasePreparate per FTP oder SFTP vom Webserver herunterladen. Der Remote-Pfad wird aus einem neuen Feld `deploy.remote_import_path` in der ConfigFile gelesen.
10. WHEN der Import-Ordner per FTP/SFTP heruntergeladen wird, THE ImportScript SHALL dieselben Verbindungsparameter und dasselbe Passwort-Handling (Umgebungsvariable) verwenden wie die PhaseDeploy.
11. WHEN `import_source` den Wert `"remote"` hat und der Download des Import-Ordners fehlschlägt, THEN THE ImportScript SHALL mit einer lesbaren Fehlermeldung abbrechen, die den Serverpfad und die Fehlermeldung des Servers enthält.
12. THE ConfigFile SHALL das Feld `image_export_dir` (String) als Zielpfad für skalierte Bildkopien der PhaseImageExport enthalten.
13. THE ConfigFile SHALL die Felder `image_resize_mode` (String, Wert `"width"` oder `"height"`) und `image_resize_px` (Integer) zur Steuerung der Bildskalierung in der PhaseImageExport enthalten.
14. THE ConfigFile SHALL ein `deploy`-Objekt enthalten mit den Feldern `protocol` (String, Wert `"ftp"` oder `"sftp"`), `host` (String), `user` (String), `password` (String, darf leer sein), `remote_path` (String), `remote_images_path` (String) und `remote_import_path` (String).
15. WHERE das Feld `deploy.password` in der ConfigFile leer ist, THE ImportScript SHALL das Passwort aus einer Umgebungsvariable lesen.
16. THE ConfigFile SHALL ein optionales `backup`-Objekt unterstützen mit den Feldern: `backup_dir` (String, lokaler Pfad für Backups), `remote_backup_dir` (String, Pfad auf dem Webspace für Backups, optional), `max_last_backups` (Integer, maximale Anzahl aufzubewahrender Last-Backups), `max_archival_backups` (Integer, maximale Anzahl aufzubewahrender Archival-Backups) und `archival_interval_days` (Integer, minimale Anzahl Tage zwischen zwei Archival-Backups).

### Requirement 2: Import-Skript – Phase prepare

**User Story:** Als Autor (Toni, Simone) möchte ich, dass das Import-Skript meine JSON-Quelldateien aufbereitet, umbenennt und mit einem einheitlichen Schema versieht, damit ich sie anschließend einfach manuell nachbearbeiten kann.

#### Acceptance Criteria

1. THE ImportScript SHALL die PhasePreparate über den Befehl `python script.py prepare` aufrufbar machen.
2. THE ImportScript SHALL alle JSON-Dateien im konfigurierten `import_dir` einschließlich aller Unterordner rekursiv einlesen.
3. WHEN eine JSON-Quelldatei kein `name`-Feld enthält, THEN THE ImportScript SHALL diese Datei überspringen und eine Warnung auf der Standardfehlerausgabe ausgeben.
4. WHEN eine JSON-Quelldatei ein `image`-Attribut enthält, THE ImportScript SHALL diesen Dateinamen als Referenz für den Bildpfad des Weins übernehmen.
5. WHEN eine JSON-Quelldatei kein `image`-Attribut enthält, aber eine Bilddatei mit demselben Dateinamen (ohne Erweiterung) im gleichen Verzeichnis vorhanden ist, THE ImportScript SHALL diesen Dateinamen automatisch als Referenz für den Bildpfad des Weins setzen.
6. WHEN eine JSON-Quelldatei kein `tasting_date`-Feld enthält und eine zugehörige Bilddatei mit EXIF-Metadaten vorhanden ist, THE ImportScript SHALL das Feld `tasting_date` aus dem EXIF-Tag `DateTimeOriginal` des Bildes ableiten und als ISO-8601-Datumsstring in die JSON-Quelldatei schreiben.
7. WHEN eine JSON-Quelldatei bereits ein `tasting_date`-Feld enthält, THE ImportScript SHALL dieses Feld unverändert lassen und nicht überschreiben.
8. WHEN eine JSON-Quelldatei ein `tasting_date`-Feld enthält, THE ImportScript SHALL die Datei umbenennen zu `YYYY-MM-DD-slug-aus-name.json`, wobei `YYYY-MM-DD` aus `tasting_date` und der Slug aus dem `name`-Feld abgeleitet wird. Die Datei verbleibt dabei in ihrem bisherigen Unterordner (die Verzeichnisstruktur im `import_dir` bleibt erhalten).
9. WHEN eine JSON-Quelldatei für eine Umbenennung qualifiziert und eine zugehörige Bilddatei existiert, THE ImportScript SHALL die Bilddatei ebenfalls auf denselben Basisnamen umbenennen.
10. WHEN eine JSON-Quelldatei für eine Umbenennung qualifiziert und eine zugehörige Audiodatei existiert, THE ImportScript SHALL die Audiodatei ebenfalls auf denselben Basisnamen umbenennen.
11. WHEN nach einer Umbenennung die Zieldatei bereits existiert, THEN THE ImportScript SHALL die Umbenennung überspringen und eine Warnung auf der Standardfehlerausgabe ausgeben.
12. WHEN eine Datei umbenannt wurde und `image`- oder `audio`-Felder in der JSON-Quelldatei vorhanden sind, THE ImportScript SHALL diese Felder auf die neuen Dateinamen aktualisieren.
13. WHEN eine JSON-Quelldatei kein `tasting_date`-Feld enthält, THEN THE ImportScript SHALL die Umbenennung für diese Datei überspringen, eine Warnung ausgeben und die Datei dennoch für die PhaseExport erhalten.
14. WHERE `scaffold_mode` in der ConfigFile auf `true` gesetzt ist, THE ImportScript SHALL alle in der WineSchema definierten Felder in jede JSON-Quelldatei schreiben, fehlende Felder mit dem Wert `null` ergänzen und bestehende Werte unverändert lassen.
15. WHERE `scaffold_mode` in der ConfigFile auf `false` gesetzt ist, THE ImportScript SHALL alle Felder mit dem Wert `null` oder einem leeren String aus jeder JSON-Quelldatei entfernen.
16. WHEN ein Feld in der WineSchema den Typ `number` hat und sein Wert in der JSON-Quelldatei als String vorliegt, THE ImportScript SHALL den Wert in einen numerischen Typ umwandeln und korrigiert in die JSON-Quelldatei zurückschreiben. Dabei SHALL ein Dezimal-Komma als Dezimaltrennzeichen akzeptiert und durch einen Dezimalpunkt ersetzt werden (z. B. `"6,99"` → `6.99`).
17. WHEN ein `number`-Feld in der WineSchema das Attribut `decimals` definiert, THE ImportScript SHALL den umgewandelten Wert auf die angegebene Anzahl Nachkommastellen normalisieren: `decimals: 0` ergibt einen Integer (z. B. `year` `"2017"` → `2017`), `decimals: 1` einen Float mit einer Nachkommastelle (z. B. `rating` `"6"` → `6.0`), `decimals: 2` einen Float mit zwei Nachkommastellen (z. B. `price` `"6,99"` → `6.99`).
18. WHEN der Wert eines `number`-Feldes nicht in eine Zahl umgewandelt werden kann (z. B. `price` `"auf Anfrage"`), THEN THE ImportScript SHALL den Wert unverändert belassen und eine Warnung auf der Standardfehlerausgabe ausgeben, die den Feldnamen, den Wert und die betroffene Datei nennt.

### Requirement 3: Import-Skript – Phase export

**User Story:** Als Autor (Toni, Simone) möchte ich, dass das Import-Skript aus den aufbereiteten Quelldateien eine fertige `wines.json` erzeugt, damit das Angular-Frontend diese laden kann.

#### Acceptance Criteria

1. THE ImportScript SHALL die PhaseExport über den Befehl `python script.py export` aufrufbar machen.
2. THE ImportScript SHALL alle JSON-Dateien aus dem konfigurierten `import_dir` einlesen.
3. THE ImportScript SHALL Weine ohne `name`-Feld überspringen und eine Warnung ausgeben.
4. THE ImportScript SHALL unbekannte Felder in JSON-Eingabedateien unverändert in die WineDataAsset übernehmen.
5. THE ImportScript SHALL die eingelesenen Weindaten absteigend nach dem Feld `tasting_date` sortieren, wobei Weine ohne `tasting_date` ans Ende gestellt werden.
6. THE ImportScript SHALL die sortierten Weindaten als valides JSON in die Ausgabedatei am konfigurierten `export_path` schreiben.

### Requirement 4: Import-Skript – Phase image-export

**User Story:** Als Autor (Toni, Simone) möchte ich, dass das Import-Skript Weinbilder automatisch skaliert und in einen separaten Export-Ordner kopiert, damit ich optimierte Bilder für den Webserver bereitstellen kann, ohne die Originale zu verändern.

#### Acceptance Criteria

1. THE ImportScript SHALL die PhaseImageExport über den Befehl `python script.py image-export` aufrufbar machen.
2. THE ImportScript SHALL alle JSON-Dateien aus dem konfigurierten `import_dir` einlesen und die darin referenzierten Bilddateien aus demselben Verzeichnis ermitteln.
3. THE ImportScript SHALL die Originaldateien im `import_dir` während der PhaseImageExport nicht verändern.
4. THE ImportScript SHALL skalierte Kopien der Bilder in den konfigurierten `image_export_dir` schreiben.
5. WHEN `image_resize_mode` den Wert `"width"` hat, THE ImportScript SHALL die Bilder auf die in `image_resize_px` konfigurierte Breite skalieren und die Höhe proportional anpassen.
6. WHEN `image_resize_mode` den Wert `"height"` hat, THE ImportScript SHALL die Bilder auf die in `image_resize_px` konfigurierte Höhe skalieren und die Breite proportional anpassen.
7. THE ImportScript SHALL das Seitenverhältnis der Originalbilder bei der Skalierung immer erhalten.
8. THE ImportScript SHALL das Dateiformat der Originalbilder bei der Skalierung beibehalten und keine Formatkonvertierung durchführen.
9. WHEN eine skalierte Kopie im `image_export_dir` bereits existiert und der Zeitstempel der Kopie nicht älter als der Zeitstempel des Originals ist, THE ImportScript SHALL dieses Bild überspringen und nicht neu exportieren.
10. WHEN eine skalierte Kopie im `image_export_dir` nicht existiert oder älter als das Original ist, THE ImportScript SHALL das Bild neu skalieren und in den `image_export_dir` schreiben.
11. WHEN eine in einer JSON-Quelldatei referenzierte Bilddatei nicht im `import_dir` gefunden wird, THEN THE ImportScript SHALL eine Warnung auf der Standardfehlerausgabe ausgeben und mit dem nächsten Eintrag fortfahren.

### Requirement 5: Build-Pipeline

**User Story:** Als Entwickler möchte ich, dass der Angular-Build automatisch das Import-Skript ausführt, damit die `wines.json` und die exportierten Bilder immer aktuell sind, wenn ich die App baue.

#### Acceptance Criteria

1. THE App SHALL in der Datei `package.json` einen `prebuild`-Script-Eintrag enthalten, der alle drei Skript-Phasen (PhasePreparate, dann PhaseExport, dann PhaseImageExport) sequenziell ausführt, bevor der Angular-Build startet.
2. THE App SHALL ein `Makefile` oder `build.sh` enthalten, das die PhasePreparate, die PhaseExport und die PhaseImageExport auch einzeln und unabhängig voneinander aufrufbar macht.
3. THE App SHALL ein `Makefile` oder `build.sh` enthalten, das einen `deploy`-Befehl bereitstellt, der die vollständige Pipeline ausführt: PhasePreparate, PhaseExport, PhaseImageExport, Angular-Build (`ng build`) und anschließend PhaseDeploy.
4. THE ImportScript SHALL alle drei Phasen (PhasePreparate, PhaseExport, PhaseImageExport) sequenziell ausführen, wenn es ohne Phasen-Argument aufgerufen wird (`python script.py`).
5. WHEN das ImportScript als Teil des `prebuild`-Schritts fehlschlägt, THEN THE App SHALL den Angular-Build-Prozess abbrechen.
6. THE App SHALL eine GitHub Actions Workflow-Datei (`.github/workflows/deploy.yml`) enthalten, die bei einem Push auf den `main`-Branch automatisch die vollständige Pipeline ausführt. WHEN `import_source` in der ConfigFile den Wert `"remote"` hat, SHALL der Workflow den Import-Ordner per SFTP/FTP vom Webserver herunterladen, bevor die Import-Phasen ausgeführt werden. Deploy-Passwort und alle weiteren Zugangsdaten SHALL der Workflow aus GitHub Secrets als Umgebungsvariablen lesen.

### Requirement 6: Import-Skript – Phase deploy

**User Story:** Als Autor (Toni, Simone) möchte ich, dass fertige Artefakte automatisch auf den Webserver übertragen werden, damit ich die App nach einem Build ohne manuelle FTP-Uploads veröffentlichen kann.

#### Acceptance Criteria

1. THE ImportScript SHALL die PhaseDeploy über den Befehl `python script.py deploy` aufrufbar machen.
2. THE ImportScript SHALL beim Deploy den Angular Build-Output (dist-Ordner), die WineDataAsset und alle Dateien aus dem `image_export_dir` auf den konfigurierten Webserver übertragen.
3. THE ImportScript SHALL das in `deploy.protocol` konfigurierte Übertragungsprotokoll (`"ftp"` oder `"sftp"`) für die Übertragung verwenden.
4. WHEN der Zeitstempel einer lokalen Datei nicht neuer ist als der Zeitstempel der entsprechenden Datei auf dem Server, THE ImportScript SHALL diese Datei nicht erneut übertragen.
5. WHEN eine Datei im Angular Build-Output-Verzeichnis lokal nicht mehr existiert, aber auf dem Server unter `deploy.remote_path` vorhanden ist, THE ImportScript SHALL diese Datei auf dem Server löschen.
6. THE ImportScript SHALL Dateien aus der WineDataAsset und dem `image_export_dir` auf dem Server niemals löschen, unabhängig vom lokalen Zustand.
7. THE ImportScript SHALL die Angular Build-Artefakte unter dem in `deploy.remote_path` konfigurierten Serverpfad ablegen.
8. THE ImportScript SHALL die Bilddateien unter dem in `deploy.remote_images_path` konfigurierten Serverpfad ablegen.
9. THE ImportScript SHALL die WineDataAsset unter dem in `deploy.remote_path` konfigurierten Serverpfad ablegen.
10. WHERE `deploy.password` in der ConfigFile einen nicht-leeren Wert enthält, THE ImportScript SHALL diesen Wert als Passwort für die Serververbindung verwenden.
11. WHERE `deploy.password` in der ConfigFile leer ist, THE ImportScript SHALL das Passwort aus der Umgebungsvariable `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` lesen. WHEN diese Umgebungsvariable nicht gesetzt ist, THEN THE ImportScript SHALL mit folgender Fehlermeldung auf der Standardfehlerausgabe abbrechen: „FEHLER: Kein Deploy-Passwort gefunden. Setze die Umgebungsvariable WEINSPRECHSTUNDE_DEPLOY_PASSWORD mit dem Server-Passwort, z. B.: export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=deinPasswort". Das Deployment wird gestoppt.
12. WHEN die Verbindung zum Server fehlschlägt, THEN THE ImportScript SHALL mit folgender Fehlermeldung auf der Standardfehlerausgabe abbrechen: „FEHLER: Verbindung zum Server [host] fehlgeschlagen. Server-Meldung: [original Fehlermeldung des Servers]. Bitte prüfe: (1) Ist der Hostname '[host]' korrekt? (2) Sind Benutzername und Passwort gültig? (3) Ist der Server erreichbar und das Protokoll ([protocol]) korrekt?" Das Deployment wird gestoppt.
13. THE ImportScript SHALL alle für das Deployment benötigten Zugangsdaten (Passwörter, Tokens) ausschließlich über Umgebungsvariablen entgegennehmen, sodass diese sicher in externen Secret-Stores (z. B. GitHub Secrets) hinterlegt werden können und niemals im Klartext in der ConfigFile oder im Versionskontrollsystem landen.
14. THE ImportScript SHALL beim Deploy als Wurzel des Angular Build-Outputs das tatsächliche Browser-Build-Verzeichnis verwenden, sodass `index.html`, `assets/` und weitere Build-Dateien DIREKT unter `deploy.remote_path` landen und nicht in einem Unterordner. WHEN der Builder `@angular/build:application` nach `frontend/dist/<projekt>/browser/` baut, THE ImportScript SHALL diesen `browser`-Unterordner als Deploy-Wurzel auflösen; WHEN ein klassischer flacher `frontend/dist/`-Ordner mit `index.html` vorliegt, THE ImportScript SHALL diesen unverändert als Deploy-Wurzel verwenden. Diese Auflösung gilt identisch für SFTP und FTP.
15. WHEN die PhaseDeploy startet (nach erfolgreicher Passwort-Auflösung und Verbindungsaufbau, aber VOR dem Löschen veralteter Dateien), THE ImportScript SHALL ein Pre-Deploy-Backup des aktuellen Inhalts von `deploy.remote_path` **serverseitig** rekursiv in einen zeitgestempelten Unterordner `<backup.remote_backup_dir>/predeploy-<YYYYmmdd-HHMMSS>/` kopieren — die Daten bleiben auf dem Server und laufen NICHT über den lokalen Rechner (kein Download, nichts im lokalen `backup.backup_dir`). WHEN `deploy.protocol = "sftp"`, THE ImportScript SHALL die Kopie per SSH-Exec (`cp -a`) über denselben Transport ausführen; WHEN `deploy.protocol = "ftp"`, THE ImportScript SHALL die serverseitige Kopie per `SITE CPFR`/`SITE CPTO` ausführen. Dieses Backup ist getrennt vom bestehenden Import-Backup-Mechanismus (`_remote_backup`/PhaseBackup, Requirement 20) und darf diesen nicht verändern.
16. WHEN der Server unter `deploy.remote_path` leer ist oder einzelne Einträge nicht erwartet strukturiert sind, THE ImportScript SHALL dies sauber behandeln (ein leerer Backup-Ordner ist zulässig und kein Fehler). WHEN das Pre-Deploy-Backup jedoch grundsätzlich fehlschlägt (z. B. Verbindungs-/Exec-/Kopier-Fehler oder fehlende `backup`/`remote_backup_dir`-Konfiguration), THE ImportScript SHALL die PhaseDeploy sauber abbrechen (exit 1), BEVOR veraltete Dateien unter `deploy.remote_path` gelöscht werden — es wird niemals ohne vorheriges Backup geprunt.
17. WHEN das Pre-Deploy-Backup fehlschlägt, THE ImportScript SHALL eine eigene Fehlermeldung ausgeben, die den fehlgeschlagenen Backup-Schritt benennt und klarstellt, dass nichts gelöscht wurde (Prune übersprungen) — und NICHT die generische Verbindungsfehler-Meldung aus Requirement 12 verwenden, damit die Ursache nicht mit einem Hostname-/Passwort-/Protokollproblem verwechselt wird.
18. WHEN ein neues Pre-Deploy-Backup angelegt wurde, THE ImportScript SHALL **serverseitig** die ältesten `predeploy-`Unterordner unter `backup.remote_backup_dir` entfernen, sodass maximal 5 Pre-Deploy-Backups aufbewahrt werden. Dieser Wert (Standard 5, als Konstante `MAX_PREDEPLOY_BACKUPS`) ist unabhängig von `backup.max_last_backups`/`backup.max_archival_backups`; ein optionales Config-Feld `backup.max_predeploy_backups` darf ihn überschreiben, muss aber ohne Config-Änderung mit Default 5 funktionieren. Diese Pre-Deploy-Backup-Logik gilt identisch für `deploy.protocol = "sftp"` und `"ftp"`.

### Requirement 7: Datenladen in der App

**User Story:** Als Gast (Olfi, Johannes, Stephan) möchte ich die Weinliste beim Öffnen der App sehen, ohne manuell Daten laden zu müssen.

#### Acceptance Criteria

1. WHEN die App gestartet wird, THE App SHALL die WineDataAsset über einen HTTP-GET-Request laden.
2. THE App SHALL keinerlei direkte Abhängigkeit zum ImportScript haben und ausschließlich die fertig exportierte `wines.json` als Datenquelle verwenden.
3. WHILE die WineDataAsset geladen wird, THE App SHALL einen Ladezustand anzeigen.
4. IF der HTTP-GET-Request der WineDataAsset fehlschlägt, THEN THE App SHALL eine lesbare Fehlermeldung im Hauptbereich anzeigen.
5. THE App SHALL alle Weindaten einmalig beim Start vollständig laden — ohne Paginierung oder nachträgliches Nachladen von Weindaten bei Routenwechseln.
6. THE App SHALL die gesamte Filterlogik in einem zentralen FilterService kapseln, der von allen Komponenten und Routen gemeinsam genutzt wird. Filterlogik darf nicht über die gesamte Anwendung verteilt sein.

### Requirement 8: Navigation

**User Story:** Als Benutzer möchte ich eine permanente Navigationszeile sehen, damit ich jederzeit weiß, in welcher Anwendung ich mich befinde, und jederzeit zur ungefilterten Startansicht zurückkehren kann.

#### Acceptance Criteria

1. THE App SHALL am oberen Rand der Seite dauerhaft eine NavBar anzeigen.
2. THE NavBar SHALL den Anwendungsnamen „Weinsprechstunde" anzeigen.
3. THE NavBar SHALL einen Logo-Platzhalter links neben dem Anwendungsnamen anzeigen.
4. THE NavBar SHALL keine Navigationsmenüpunkte enthalten (insbesondere keine Menüpunkte „Regionen" oder „Rebsorten"). Filtern nach Region oder Rebsorte erfolgt ausschließlich über die ControlsRow.
5. WHEN ein Benutzer auf den Logo-Platzhalter bzw. den Anwendungsnamen klickt, THE App SHALL alle aktiven Filter zurücksetzen und die URL auf `/` setzen.

### Requirement 9: Controls Row

**User Story:** Als Benutzer möchte ich Weine suchen, filtern und sortieren, damit ich schnell relevante Einträge finde.

#### Acceptance Criteria

1. THE App SHALL unterhalb der NavBar dauerhaft eine ControlsRow anzeigen.
2. THE ControlsRow SHALL eine Freitextsuche enthalten, die den eingegebenen Text case-insensitiv mit allen Feldern vergleicht, deren `filter_type` in der WineSchema `text-search` ist (aktuell nur `name`).
3. THE ControlsRow SHALL als einzigen fest sichtbaren Filter die Freitextsuche anzeigen. Alle übrigen Filter SHALL optional und einzeln über den „Mehr Filter"-Button zuschaltbar sein.
4. THE Freitextsuche SHALL das Label „Filter" tragen und einen nutzerorientierten Platzhalter anzeigen, der die durchsuchbaren Eigenschaften benennt (z. B. „Name, Weingut, Rebsorte, Region …"). Der Platzhalter beschreibt die inhaltliche Erwartung des Benutzers; technisch vergleicht die Freitextsuche ausschließlich die in der WineSchema als `text-search` definierten Felder.
5. THE ControlsRow SHALL einen „Mehr Filter"-Button enthalten, der alle optional zuschaltbaren Filter als einzeln an- und abwählbare Einträge anzeigt. Dazu zählen die Multiselect-Filter Rebsorte (`grape`) und Region (`origin`), die Einzelauswahl-Dropdowns (`country`, `type`, `producer`, `quality`) sowie die einzeln zuschaltbaren Bound-Filter „Bewertung ab", „Bewertung bis", „Verkostung ab", „Verkostung bis", „Jahrgang ab" und „Jahrgang bis".
6. WHEN der Benutzer über den „Mehr Filter"-Button einen optionalen Filter einblendet, THE App SHALL diesen Filter in der ControlsRow anzeigen und die Auswahl im UserPreferences-Cookie speichern.
7. WHEN der Benutzer einen eingeblendeten optionalen Filter ausblendet — entweder durch Abwählen in der „Mehr Filter"-Liste oder über das Entfernen-Icon am Filter selbst —, THE App SHALL ihn aus der ControlsRow entfernen, den zugehörigen Filterwert zurücksetzen und den Cookie aktualisieren.
8. THE ControlsRow SHALL jedem eingeblendeten optionalen Filter ein kleines Entfernen-Icon (✕) neben dem Label hinzufügen, über das der Filter direkt entfernt werden kann.
9. WHEN ein optionaler Filter entfernt wird, THE App SHALL nicht nur dessen Sichtbarkeit aufheben, sondern auch seinen Filterwert zurücksetzen, sodass kein ausgeblendeter Filter unsichtbar weiterwirkt.
10. THE ControlsRow SHALL für Felder mit filter_type `multi-select` (Rebsorte, Region) ein kompaktes, aufklappbares Dropdown anzeigen: einen Trigger-Button mit Zusammenfassung des aktuellen Zustands („Alle" / einzelner gewählter Wert / „n gewählt"), der auf Klick ein scrollbares Panel mit Checkbox-Optionen öffnet; das Panel enthält die Aktionen „Zurücksetzen" und „Fertig". Die auswählbaren Werte stammen aus den vorhandenen Weindaten. Die Mehrfachauswahl wird NICHT als dauerhaft sichtbare Liste dargestellt, damit sie auf viele Rebsorten skaliert.
11. THE ControlsRow SHALL für Felder mit filter_type `dropdown` (`country`, `type`, `producer`, `quality`) ein Dropdown mit Einzelauswahl anzeigen, das Werte aus den vorhandenen Weindaten vorschlägt.
12. THE ControlsRow SHALL jede Range-Grenze als eigenen, unabhängig zuschaltbaren Bound-Filter anzeigen: „Bewertung ab" und „Bewertung bis" (je eine Zahleneingabe mit Schrittweite 0.1 im Bereich 1.0–10.0), „Jahrgang ab" und „Jahrgang bis" (je eine Zahleneingabe) sowie „Verkostung ab" und „Verkostung bis" (je eine Datumseingabe). Jeder Bound-Filter ist optional und unabhängig von seiner Gegengrenze zuschaltbar.
13. WHEN der Benutzer einen oder mehrere Filter setzt, THE App SHALL die aktive Ansicht auf Weine eingrenzen, die alle aktiven Filterkriterien gleichzeitig erfüllen (AND-Logik). Bei Multiselect-Filtern gilt innerhalb eines Feldes OR-Logik, zwischen den Feldern AND-Logik.
14. THE ControlsRow SHALL eine Sortierungsauswahl mit folgenden Optionen enthalten: „Neueste Verkostung zuerst" (Standard), „Älteste Verkostung zuerst", „Beste Bewertung zuerst" (Rating absteigend), „Teuerste zuerst" (Preis absteigend) und „Günstigste zuerst" (Preis aufsteigend). Die gewählte Option wird im UserPreferences-Cookie gespeichert.
15. WHEN der Benutzer eine Sortieroption auswählt, THE App SHALL die aktive Ansicht sofort entsprechend neu sortieren.
16. THE ControlsRow SHALL einen InfoToggle enthalten, der das WineTileOverlay auf allen WineTiles dauerhaft aktiviert oder deaktiviert.
17. WHEN der Benutzer den InfoToggle aktiviert, THE App SHALL das WineTileOverlay auf allen WineTiles dauerhaft sichtbar machen, unabhängig von Hover- oder Klick-Ereignissen.
18. WHEN der Benutzer den InfoToggle deaktiviert, THE App SHALL das WineTileOverlay auf WineTiles wieder ausschließlich durch Hover (Desktop) oder Klick (Mobil) auslösbar machen.
19. THE ControlsRow SHALL einen ListToggle enthalten, der zwischen Kachelansicht (WineGrid) und Listenansicht (WineList) wechselt. Die gewählte Ansicht wird im UserPreferences-Cookie gespeichert.
20. WHEN der Benutzer den ListToggle betätigt, THE App SHALL die aktive Ansicht zwischen WineGrid und WineList umschalten, wobei aktive Filter und Sortierung erhalten bleiben.
21. THE InfoToggle- und ListToggle-Buttons SHALL je einen `title`-Hinweis auf das zugehörige Tastaturkürzel tragen („Tastenkürzel: i" bzw. „Tastenkürzel: l").

### Requirement 10: Tastaturkürzel

**User Story:** Als Benutzer möchte ich die Infos und die Ansicht per Tastatur umschalten können, damit ich die App schneller bedienen kann.

#### Acceptance Criteria

1. THE App SHALL globale Tastaturkürzel bereitstellen: `i` schaltet das WineTileOverlay auf allen WineTiles um (wie der InfoToggle), `l` wechselt zwischen Kachel- und Listenansicht (wie der ListToggle).
2. WHEN der Benutzer die Taste `i` drückt und keine Ausnahmebedingung vorliegt, THE App SHALL den InfoToggle-Zustand umschalten.
3. WHEN der Benutzer die Taste `l` drückt und keine Ausnahmebedingung vorliegt, THE App SHALL zwischen WineGrid und WineList umschalten.
4. WHILE der Fokus in einem Eingabefeld (`input`, `textarea`, `select` oder einem `contenteditable`-Element) liegt, THE App SHALL die Tastaturkürzel NICHT auslösen.
5. WHILE der WineDetailDialog geöffnet ist, THE App SHALL die Tastaturkürzel NICHT auslösen.
6. WHEN ein Tastendruck mit einer Modifier-Taste (Ctrl, Cmd/Meta oder Alt) kombiniert ist, THE App SHALL die Tastaturkürzel NICHT auslösen.

### Requirement 11: Kachelansicht – WineGrid

**User Story:** Als Benutzer möchte ich alle Weine in einer übersichtlichen Kachelung sehen, wobei die neuesten Verkostungen zuerst erscheinen.

#### Acceptance Criteria

1. THE App SHALL gefilterte und sortierte Weine im WineGrid in einer responsiven Kachelung anzeigen.
2. THE App SHALL alle gefilterten und sortierten Weine im WineGrid direkt rendern, ohne Paginierung und ohne Nachladen beim Scrollen — die Weindaten sind beim Start bereits vollständig im Browser geladen.
3. WHEN keine Weine den aktiven Filterkriterien entsprechen, THE App SHALL eine Hinweismeldung anzeigen, dass keine Ergebnisse gefunden wurden.
4. WHEN ein ControlsRow-Filter aktiv ist (`hasActiveFilter`), THE WineGrid SHALL als erstes Element vor der ersten WineTile einen Zurück-Button anzeigen, der dieselbe Größe und denselben Platz wie eine WineTile einnimmt. WHEN der Benutzer den Zurück-Button klickt, THE App SHALL alle aktiven Filter zurücksetzen und die URL auf `/` setzen.

### Requirement 12: WineTile

**User Story:** Als Benutzer möchte ich auf einen Blick die wichtigsten Infos eines Weins auf der Kachel sehen.

#### Acceptance Criteria

1. THE WineTile SHALL ein Weinbild (WineTileCover) oder PlaceholderIcon anzeigen.
2. WHEN für einen Wein kein Bild verfügbar ist, THE WineTileCover SHALL das PlaceholderIcon anzeigen.
3. THE WineTile SHALL einen RatingCircle in der oberen rechten Ecke des WineTileOverlays anzeigen, wenn das Feld `rating` vorhanden ist.
4. THE WineTileOverlay SHALL folgende Felder in einer festen Darstellung anzeigen: Jahr (`year`), Name (`name`), Weingut (`producer`), Rebsorte(n) (`grape`), Rating-Kreis (`rating`), Region (`origin`). Felder ohne Wert werden nicht angezeigt. Die Darstellung ist ein festes Template, keine dynamische Generierung aus dem WineSchema.
5. WHEN ein Benutzer auf einem Desktop-Gerät mit der Maus über eine WineTile fährt und der InfoToggle deaktiviert ist, THE WineTile SHALL das WineTileOverlay einblenden.
6. WHEN ein Benutzer auf einem Desktop-Gerät die Maus von einer WineTile wegbewegt und der InfoToggle deaktiviert ist, THE WineTile SHALL das WineTileOverlay ausblenden.
7. WHEN ein Benutzer auf einem mobilen Gerät auf eine WineTile tippt und der InfoToggle deaktiviert ist, THE WineTile SHALL das WineTileOverlay einblenden.
8. WHEN ein Benutzer auf einem mobilen Gerät erneut auf eine WineTile mit sichtbarem WineTileOverlay tippt und der InfoToggle deaktiviert ist, THE WineTile SHALL das WineTileOverlay ausblenden.
9. WHEN ein Wein ein `audio`-Feld oder ein `video`-Feld enthält, THE WineTile SHALL einen kleinen Play-Button auf der Kachel anzeigen, der beim Klick die Detailansicht öffnet.

### Requirement 13: Listenansicht – WineList

**User Story:** Als Benutzer möchte ich zwischen einer kompakten Listenansicht und der Kachelansicht wechseln können, um Weine schneller zu überfliegen.

#### Acceptance Criteria

1. THE App SHALL gefilterte und sortierte Weine im WineList als vertikale Liste von WineListItems anzeigen, wenn die Listenansicht aktiv ist.
2. THE WineListItem SHALL in einer kompakten Zeile links ein kleines Weinbild-Thumbnail (wiederverwendeter WineTileCover mit PlaceholderIcon-Fallback, wenn kein Bild verfügbar ist) sowie Name, Weingut, Jahr, Herkunftsland und Rating anzeigen. Felder ohne Wert werden nicht angezeigt.
3. THE App SHALL alle gefilterten und sortierten Weine im WineList direkt rendern, ohne Paginierung und ohne Nachladen beim Scrollen — die Weindaten sind beim Start bereits vollständig im Browser geladen.
4. WHEN keine Weine den aktiven Filterkriterien entsprechen, THE App SHALL eine Hinweismeldung anzeigen, dass keine Ergebnisse gefunden wurden.
5. WHEN ein ControlsRow-Filter aktiv ist (`hasActiveFilter`), THE WineList SHALL am Anfang der Liste einen Zurück-Button anzeigen. WHEN der Benutzer den Zurück-Button klickt, THE App SHALL alle aktiven Filter zurücksetzen und die URL auf `/` setzen.

### Requirement 14: WineDetailDialog

**User Story:** Als Benutzer möchte ich alle verfügbaren Details eines Weins in einem Dialog sehen, wenn ich auf eine Kachel oder einen Listeneintrag klicke.

#### Acceptance Criteria

1. WHEN ein Benutzer auf eine WineTile oder ein WineListItem klickt, THE App SHALL den WineDetailDialog für diesen Wein öffnen.
2. THE WineDetailDialog SHALL alle bekannten Weinfelder in einem festen, gestalterisch ansprechenden Template darstellen — keine tabellarische Auflistung und keine dynamische Generierung aus dem WineSchema. Die Felder werden in folgenden Gruppen dargestellt: Kopfbereich (Name, Weingut, Jahr, Rating-Kreis), Herkunft (Land, Region), Weinprofil (Rebsorte(n), Typ, Qualität), Verkostung (Datum, Beschreibung), Kaufinfo (Preis), Medien (Bild groß, Audio-Player wenn audio vorhanden, Video-Player wenn video vorhanden). Felder ohne Wert werden nicht angezeigt. Unbekannte Zusatzfelder werden am Ende als einfache Schlüssel-Wert-Paare angehängt.
3. THE WineDetailDialog SHALL den RatingCircle anzeigen, wenn das Feld `rating` vorhanden ist.
4. WHEN das `audio`-Feld eines Weins vorhanden ist, THE WineDetailDialog SHALL einen AudioPlayer zur Wiedergabe der Audiodatei anzeigen.
5. THE WineDetailDialog SHALL einen Schließen-Button enthalten.
6. WHEN ein Benutzer den Schließen-Button des WineDetailDialogs klickt, THE App SHALL den WineDetailDialog schließen.
7. WHEN ein Benutzer außerhalb des WineDetailDialogs klickt, THE App SHALL den WineDetailDialog schließen.
8. WHEN der WineDetailDialog geöffnet ist, THE App SHALL das Scrollen des Hintergrundinhalts verhindern.

### Requirement 15: Technik und Architektur

**User Story:** Als Entwickler möchte ich, dass die App auf klar definierten Technologien basiert, damit die Codebasis wartbar und erweiterbar bleibt.

#### Acceptance Criteria

1. THE App SHALL als Angular SPA mit TypeScript implementiert sein.
2. THE App SHALL Angular Signals für reaktiven State verwenden.
3. THE App SHALL ausschließlich reines SCSS für das Styling verwenden, ohne externe UI-Frameworks oder CSS-Bibliotheken.
4. THE App SHALL ein responsives Layout bereitstellen, das auf Desktop- und Mobilgeräten nutzbar ist.
5. THE App SHALL im Light Mode dargestellt werden.
6. THE ImportScript SHALL als eigenständiges Python-Skript implementiert sein, das unabhängig vom Angular-Build ausgeführt werden kann.
7. THE App SHALL die Weindatenstruktur so definieren, dass unbekannte Zusatzfelder typsicher als `Record<string, unknown>` erweiterbar sind.
8. THE App SHALL die Komponentenstruktur wine-wall, wine-tile, wine-tile-overlay, wine-tile-cover, wine-list-item, controls-row, nav, sort-button und scroll-top-button verwenden.
9. THE App SHALL Angular Router für URL-basiertes Routing verwenden, wobei Routenwechsel keine Weindaten-HTTP-Requests auslösen dürfen.
10. THE App SHALL den FilterService als einzige Quelle der Wahrheit für alle aktiven Filterkriterien implementieren — keine Komponente darf Filter-State lokal halten der die Weinliste beeinflusst.
11. THE App SOLL die Komponentenstruktur des bestehenden Angular Musikalben-Frontends als Orientierung nutzen, jedoch keine blindes Kopieren vornehmen — jede Komponente und jede Implementierungsentscheidung soll gezielt auf die Anforderungen dieser Anwendung zugeschnitten sein und eine saubere, elegante Implementierung anstreben.

### Requirement 16: Zugriffsschutz Wine Editor

**User Story:** Als Autor (Toni, Simone) möchte ich, dass die Datenpflege-App sicher gegen unbefugten Zugriff ist, dabei aber einfach zu bedienen bleibt.

#### Acceptance Criteria

1. THE WineEditorApp SHALL ausschließlich über HTTPS erreichbar sein. HTTP-Anfragen SHALL auf HTTPS umgeleitet werden.
2. THE WineEditorApp SHALL den Zugriffspfad (URL-Pfad des Editors) als konfigurierbaren Wert `editor.path` in der `weinsprechstunde.config.json` speichern, sodass der Pfad nicht öffentlich bekannt ist.
3. THE WineEditorApp SHALL das Editor-Passwort als bcrypt-Hash im Feld `editor.password_hash` in der `weinsprechstunde.config.json` speichern. Klartextpasswörter dürfen nicht in der Config-Datei stehen.
4. THE WineEditorApp SHALL ein Hilfsskript bereitstellen, mit dem ein neues Passwort gehasht und der Hash in die Config-Datei geschrieben werden kann.
5. WHEN ein Benutzer das korrekte Passwort eingibt, THE WineEditorApp SHALL ein signiertes Session-Cookie mit einer Gültigkeitsdauer von 30 Tagen setzen.
6. THE Session-Cookie SHALL die Flags `HttpOnly`, `Secure` und `SameSite=Strict` gesetzt haben.
7. WHEN ein Benutzer ein falsches Passwort eingibt, THE WineEditorApp SHALL den Fehlversuch für die IP-Adresse des Benutzers zählen.
8. WHEN eine IP-Adresse innerhalb von 10 Minuten 5 oder mehr Fehlversuche akkumuliert hat, THE WineEditorApp SHALL alle weiteren Login-Versuche von dieser IP-Adresse für 15 Minuten ablehnen und eine Fehlermeldung ohne Hinweis auf den Sperrgrund anzeigen.
9. WHEN eine IP-Adresse gesperrt ist und einen Login-Versuch unternimmt, THE WineEditorApp SHALL dieselbe generische Fehlermeldung anzeigen wie bei einem falschen Passwort (kein Hinweis auf Sperrung).
10. THE WineEditorApp SHALL alle API-Endpunkte gegen unauthentifizierte Zugriffe schützen — ein gültiges Session-Cookie ist Voraussetzung für jeden schreibenden und lesenden API-Zugriff.
11. THE WineEditorApp SHALL die authentifizierte Sitzung für 30 Tage aufrechterhalten, sodass der Benutzer sich nicht bei jedem Besuch erneut einloggen muss.
12. WHEN das Session-Cookie abgelaufen oder ungültig ist, THE WineEditorApp SHALL den Benutzer zur Login-Seite weiterleiten.

### Requirement 17: Wine Editor Web-App

**User Story:** Als Autor (Toni, Simone) möchte ich alle Weineinträge über eine komfortable Web-Oberfläche anlegen und bearbeiten können, damit ich keine JSON-Dateien manuell im Texteditor pflegen muss.

#### Acceptance Criteria

1. THE WineEditorApp SHALL als eigenständige Web-App implementiert sein, die auf demselben Server läuft wie die öffentliche Weinliste und von mehreren Personen gleichzeitig von verschiedenen Rechnern aus über den Browser genutzt werden kann.
2. THE WineEditorApp SHALL alle im Import-Ordner vorhandenen Weineinträge als durchsuchbare und sortierbare Liste anzeigen.
3. THE WineEditorApp SHALL das Anlegen eines neuen Weineintrags ermöglichen, der als neue JSON-Quelldatei im konfigurierten `import_dir` gespeichert wird.
4. THE WineEditorApp SHALL das Bearbeiten eines bestehenden Weineintrags ermöglichen, wobei Änderungen direkt in die jeweilige JSON-Quelldatei geschrieben werden.
5. THE WineEditorApp SHALL für alle in der WineSchema definierten Felder geeignete Eingabefelder bereitstellen.
6. THE WineEditorApp SHALL für Felder mit Wiederholungswerten (z. B. `country`, `grape`, `producer`, `type`, `origin`) Autocomplete-Vorschläge aus den bisherigen Werten der vorhandenen Weineinträge anbieten.
7. THE WineEditorApp SHALL für das Feld `tasting_date` einen Datepicker bereitstellen.
8. THE WineEditorApp SHALL für das Feld `rating` eine Zahleneingabe mit Schrittweite 0.1 im Bereich 1.0–10.0 bereitstellen.
9. THE WineEditorApp SHALL für das Feld `image` einen ImagePicker bereitstellen, der eine durchsuchbare Übersicht der Bilddateien im `import_dir` anzeigt.
10. THE ImagePicker SHALL standardmäßig nur Bilddateien anzeigen, die bisher keinem Weineintrag zugeordnet sind (nicht in einem `image`-Feld einer JSON-Datei referenziert werden).
11. THE ImagePicker SHALL eine Umschaltmöglichkeit bieten, um alle verfügbaren Bilddateien im `import_dir` anzuzeigen (unabhängig davon ob sie bereits zugeordnet sind).
12. WHEN ein Benutzer ein Bild im ImagePicker auswählt, THE WineEditorApp SHALL den Dateinamen des ausgewählten Bildes in das `image`-Feld des aktuell bearbeiteten Weineintrags übernehmen.
13. THE WineEditorApp SHALL Änderungen an einem Weineintrag erst speichern, wenn der Benutzer explizit eine Speicheraktion auslöst.
14. WHEN der Benutzer eine Speicheraktion auslöst, THE WineEditorApp SHALL die JSON-Quelldatei des Weineintrags aktualisieren und eine Erfolgs- oder Fehlermeldung anzeigen.
15. THE WineEditorApp SHALL das Löschen eines Weineintrags ermöglichen, wobei eine explizite Bestätigung durch den Benutzer erforderlich ist.
16. WHEN mehrere Benutzer gleichzeitig denselben Weineintrag bearbeiten, THE WineEditorApp SHALL beim Speichern erkennen, dass die Datei seit dem letzten Laden verändert wurde, und den Benutzer vor dem Überschreiben warnen.

### Requirement 18: Wine-Attribut-Schema

**User Story:** Als Entwickler möchte ich alle Weinattribute mit ihrem Datentyp und Filter-Typ an einer zentralen Stelle definieren, damit Python-Skript, Frontend und Editor konsistent dieselbe Felddefinition verwenden.

#### Acceptance Criteria

1. THE System SHALL eine Datei `wine-schema.json` im Projekt-Root verwenden, die für jedes bekannte Weinattribut folgende Eigenschaften definiert: `field` (Feldname), `type` (Datentyp: `text`, `number`, `date`, `rating`, `multi-value`), `filter_type` (FilterType oder `null`), `default_filter` (Boolean).
2. THE WineSchema SHALL mindestens folgende Felder definieren: `name` (text, text-search, default_filter: true), `year` (number, range, false), `country` (text, dropdown, false), `origin` (text, dropdown, false), `grape` (multi-value, multi-select, true), `type` (text, dropdown, false), `producer` (text, dropdown, false), `quality` (text, dropdown, false), `price` (text, null, false), `rating` (rating, rating-range, true), `tasting_date` (date, date-range, true), `image` (text, null, false), `audio` (text, null, false), `video` (text, null, false), `description` (text, null, false).
3. THE ImportScript SHALL die Liste der aufzubereitenden Felder aus der `wine-schema.json` lesen.
4. THE App SHALL die `wine-schema.json` beim Start laden und für die Konfiguration der ControlsRow-Filter verwenden.
5. THE WineEditorApp SHALL die `wine-schema.json` beim Start laden und die Feldtypen zur Bestimmung der Eingabefelder im WineEditor verwenden.
6. WHEN ein neues Feld in `wine-schema.json` hinzugefügt wird, THEN SHALL das neue Feld automatisch als Eingabefeld im WineEditor und als potentieller Filter in der ControlsRow verfügbar sein, ohne Code-Änderungen.

### Requirement 19: Benutzereinstellungen (UserPreferences)

**User Story:** Als Benutzer möchte ich, dass die App meine Filter-Auswahl, Sortierung und Ansicht zwischen Besuchen beibehält, damit ich nicht jedes Mal neu konfigurieren muss.

#### Acceptance Criteria

1. THE App SHALL Benutzereinstellungen in einem Browser-Cookie mit dem Namen `ws_prefs` ohne festes Ablaufdatum speichern.
2. THE Cookie SHALL folgende Einstellungen enthalten: die Liste der vom Benutzer eingeblendeten zusätzlichen Filter-Felder (nur Feldnamen, keine Filterwerte), die gewählte Sortierungsoption, die aktive Ansicht (Grid oder Liste).
3. THE Cookie SHALL keine aktiven Filterwerte speichern — nur die Konfiguration welche Filter sichtbar sind.
4. WHEN die App startet, THE App SHALL die UserPreferences aus dem Cookie lesen und ControlsRow sowie Ansicht entsprechend initialisieren.
5. WHEN der Benutzer eine Einstellung ändert (Filter ein-/ausblenden, Sortierung, Ansicht), THE App SHALL den Cookie sofort aktualisieren.
6. WHEN kein Cookie vorhanden ist, THE App SHALL ohne eingeblendete optionale Filter starten (leere Liste), sodass initial nur die fest sichtbare Freitextsuche angezeigt wird; Sortierung und Ansicht verwenden die Standardwerte (Sortierung „Neueste Verkostung zuerst", Ansicht Grid).

### Requirement 20: Sicherheitskopien des Import-Ordners

**User Story:** Als Autor (Toni, Simone) möchte ich bei jedem Build eine aktuelle Sicherheitskopie und zusätzlich regelmäßige Archiv-Snapshots des Import-Ordners haben, damit ich sowohl auf den letzten Stand als auch auf ältere Versionen zurückgreifen kann.

#### Acceptance Criteria

1. WHEN das `backup`-Objekt in der ConfigFile vorhanden ist, THE ImportScript SHALL vor jeder Pipeline-Ausführung (vor PhasePreparate) ein neues Last-Backup erstellen.
2. THE ImportScript SHALL das Last-Backup als vollständige Kopie des Import-Ordners in einen neuen Unterordner im konfigurierten `backup.backup_dir` erstellen. Der Unterordnername SHALL das Format `last_YYYY-MM-DD_HH-MM-SS` haben.
3. WHEN nach dem Erstellen eines neuen Last-Backups die Anzahl der `last_`-Unterordner in `backup.backup_dir` größer als `backup.max_last_backups` ist, THE ImportScript SHALL den ältesten `last_`-Unterordner löschen, sodass genau `backup.max_last_backups` Last-Backups erhalten bleiben.
4. THE ImportScript SHALL zusätzlich vor jeder Pipeline-Ausführung prüfen, ob seit dem letzten Archival-Backup mindestens `backup.archival_interval_days` Tage vergangen sind.
5. WHEN ein neues Archival-Backup fällig ist, THE ImportScript SHALL eine vollständige Kopie des Import-Ordners in einen neuen Unterordner im konfigurierten `backup.backup_dir` erstellen. Der Unterordnername SHALL das Format `archival_YYYY-MM-DD_HH-MM-SS` haben.
6. WHEN nach dem Erstellen eines neuen Archival-Backups die Anzahl der `archival_`-Unterordner in `backup.backup_dir` größer als `backup.max_archival_backups` ist, THE ImportScript SHALL den ältesten `archival_`-Unterordner löschen, sodass genau `backup.max_archival_backups` Archival-Backups erhalten bleiben.
7. WHEN `import_source` den Wert `"remote"` hat und `backup.remote_backup_dir` konfiguriert ist, THE ImportScript SHALL Last-Backups und (wenn fällig) Archival-Backups ebenfalls auf dem Webspace unter `backup.remote_backup_dir` erstellen und dort jeweils dasselbe Rolling-Window-Verhalten anwenden.
8. THE ImportScript SHALL den Zeitstempel des zuletzt erstellten Archival-Backups in einer Datei `backup/.last_archival` im lokalen Backup-Ordner speichern, um das Archival-Intervall korrekt zu berechnen.
9. WHEN das Erstellen eines Backups fehlschlägt (lokal oder remote, Last oder Archival), THE ImportScript SHALL eine Warnung auf der Standardfehlerausgabe ausgeben und die Pipeline trotzdem fortsetzen — ein fehlgeschlagenes Backup stoppt nicht den Build.

### Requirement 21: Einmalige WordPress-Datenmigration

**User Story:** Als Autor (Toni, Simone) möchte ich meine bereits in WordPress gepflegten Weindaten einmalig importieren, dabei aber vorher kontrollieren welche WordPress-Felder wie übernommen werden, damit ich keine unerwünschten oder falsch zugeordneten Daten in die erste Datengrundlage übernehme.

#### Acceptance Criteria

1. THE System SHALL ein eigenständiges, einmalig ausführbares Migrations-Skript (`scripts/wordpress_migrate.py`) mit zwei getrennten Schritten bereitstellen: einem Analyse-Schritt (`analyze`) und einem Migrations-Schritt (`migrate`).
2. THE MigrationScript SHALL im Analyse-Schritt alle `.sql`-Dateien im Verzeichnis `migrate_wordpress/` einlesen und analysieren.
3. WHEN mehrere vollständige WordPress-Datenbank-Dumps vorhanden sind, THE MigrationScript SHALL im Analyse-Schritt den Dump mit den meisten verwertbaren Weindaten als primäre Datenquelle bestimmen und dies im Analysebericht begründen.
4. THE MigrationScript SHALL im Analyse-Schritt eine Mapping-Datei `wordpress-mapping.json` erzeugen, die für jedes in den Dumps gefundene Weinfeld (meta_key) einen Eintrag mit folgender Struktur enthält: `target` (vorgeschlagenes WineSchema-Feld oder `null`) und `action` (`"map"`, `"unmapped"` oder `"ignore"`).
5. THE MigrationScript SHALL für jeden Feld-Eintrag in der Mapping-Datei einen sinnvollen Vorschlag setzen: bekannte Felder (z.B. `name`, `preis`) mit `action: "map"` und passendem `target`; interne ACF-Referenzfelder (Felder mit `_`-Präfix oder `field_`-Schlüssel) mit `action: "ignore"`; alle übrigen mit `action: "unmapped"`.
6. THE MigrationScript SHALL im Analysebericht für jedes gefundene Feld dessen Häufigkeit (Anzahl der Vorkommen über alle Weine) ausgeben, damit der Benutzer die Relevanz einschätzen kann.
7. THE MigrationScript SHALL im Analyse-Schritt KEINE Weindaten-JSON-Dateien und KEINE Bilder erzeugen — der Analyse-Schritt ist rein beschreibend.
8. THE MigrationScript SHALL im Migrations-Schritt die vom Benutzer geprüfte `wordpress-mapping.json` einlesen und ausschließlich gemäß dieser Datei Felder verarbeiten.
9. WHEN im Migrations-Schritt ein Feld in den Dumps vorkommt, das nicht in der `wordpress-mapping.json` enthalten ist, THEN THE MigrationScript SHALL die Migration mit einer lesbaren Fehlermeldung abbrechen, die den Namen des fehlenden Feldes nennt und auffordert, es in der Mapping-Datei zu ergänzen.
10. WHEN ein Feld in der Mapping-Datei `action: "map"` hat, THE MigrationScript SHALL dessen Wert dem in `target` angegebenen WineSchema-Feld zuweisen.
11. WHEN ein Feld in der Mapping-Datei `action: "unmapped"` hat, THE MigrationScript SHALL dessen Wert unter einem einheitlichen Platzhalter-Feldnamen (z.B. `wp_unmapped_{key}`) im JSON-Objekt erhalten.
12. WHEN ein Feld in der Mapping-Datei `action: "ignore"` hat, THE MigrationScript SHALL dessen Wert vollständig verwerfen und nicht in das JSON-Objekt übernehmen.
12a. WHEN der Wert eines WordPress-Feldes leer ist (`null`, leerer String, nur Whitespace oder der Platzhalterwert `"0"` bzw. `0`), THE MigrationScript SHALL dieses Feld nicht in das JSON-Objekt übernehmen — unabhängig von der konfigurierten `action` (weder als gemapptes noch als `wp_unmapped_`-Feld). In den WordPress-Quelldaten bedeutet `"0"` durchgängig „nicht gesetzt".
13. THE MigrationScript SHALL im Migrations-Schritt für jeden erkannten Wein ein eigenes JSON-Objekt erzeugen und als JSON-Datei im konfigurierten Import-Ordner ablegen.
14. THE MigrationScript SHALL im Migrations-Schritt den Uploads-Ordner `migrate_wordpress/uploads/` einschließlich aller Unterordner nach Bildern durchsuchen.
15. THE MigrationScript SHALL ein Bild einem Wein primär über die WordPress-Datenbankverknüpfung (z.B. `_thumbnail_id` / Attachment-Posts) zuordnen und als Fallback über die Ähnlichkeit zwischen Weinname/Slug und Bilddateiname.
16. WHEN für einen Wein mehrere Bildgrößen existieren (z.B. `bild.jpg`, `bild-150x150.jpg`, `bild-scaled.jpg`), THE MigrationScript SHALL bevorzugt das WordPress-Original (ohne Größen-Suffix) auswählen und andernfalls die größte verfügbare Variante.
17. THE MigrationScript SHALL das ausgewählte Bild in den Import-Ordner kopieren und im JSON-Objekt des zugeordneten Weins im `image`-Feld referenzieren.
18. THE MigrationScript SHALL am Ende des Migrations-Schritts ALLE Original- bzw. jeweils größten Bilder aus dem Uploads-Ordner in den Import-Ordner übernehmen — unabhängig davon ob sie einem Wein zugeordnet werden konnten.
19. THE MigrationScript SHALL am Ende des Migrations-Schritts einen Bericht auf der Standardausgabe erzeugen mit: gewählte primäre Datenquelle, Anzahl erkannter Weine, Anzahl erstellter JSON-Dateien, Liste der gemappten/unmapped/ignorierten Felder, Anzahl zugeordneter Bilder, Anzahl nicht zugeordneter (aber übernommener) Bilder.
20. THE MigrationScript SHALL die Import-Daten so erzeugen, dass sie anschließend durch die reguläre PhasePreparate des ImportScripts weiterverarbeitet werden können (kompatibles JSON-Format, nur `name` als Pflichtfeld).
21. WHEN der Migrations-Schritt (`migrate`) aufgerufen wird und der Import-Ordner bereits JSON-Weindateien enthält, THEN THE MigrationScript SHALL mit einer lesbaren Fehlermeldung abbrechen und auf das Flag `--force` hinweisen, sodass bereits erfolgreich importierte (und ggf. nachbearbeitete) Daten nicht versehentlich überschrieben werden. Die WordPress-Migration ist ein einmaliger Vorgang.
22. WHERE der Migrations-Schritt mit dem Flag `--force` aufgerufen wird, THE MigrationScript SHALL die Migration auch bei bereits vorhandenen Import-Daten ausführen.
