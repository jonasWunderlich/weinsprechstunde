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
- **ConfigFile**: Die zentrale Konfigurationsdatei `weinsprechstunde.config.json` im Projekt-Root, die alle Laufzeitparameter des ImportScripts enthält (`import_dir`, `export_path`, `image_export_dir`, `image_resize_mode`, `image_resize_px` sowie ein `deploy`-Objekt). Die früheren Editor-Felder `editor.path` und `editor.password_hash` entfallen, da die WineEditorApp als reine Browser-App ohne Backend weder einen geheimen URL-Pfad noch ein Passwort benötigt.
- **WineSchema**: Die Datei `wine-schema.json` im Projekt-Root, die für jedes bekannte Weinattribut den Datentyp (`type`), den Filter-Typ (`filter_type`), ob es standardmäßig als Filter angezeigt wird (`default_filter`) und optional für `number`-Felder die Anzahl der Nachkommastellen (`decimals`: `0` = Integer, `1`/`2` = Float mit entsprechender Präzision) definiert. Wird von Python-Skript, Angular-Frontend und Wine-Editor gemeinsam genutzt.
- **FilterType**: Der Filtertyp eines Feldes laut WineSchema. Mögliche Werte: `text-search`, `range`, `date-range`, `dropdown`, `rating-range`, `multi-select`, oder `null` (nicht filterbar).
- **FilterService**: Der zentrale Angular-Service der den gesamten Filter-, Such- und Sortierzustand der App verwaltet. Alle Komponenten und Routen lesen gefilterte Weine ausschließlich über den FilterService. Keine Filterlogik darf außerhalb des FilterService implementiert werden.
- **UserPreferences**: Im Browser-Cookie `ws_prefs` gespeicherte Benutzereinstellungen ohne festes Ablaufdatum: welche zusätzlichen Filter eingeblendet sind (nur Feldnamen), gewählte Sortierung, aktive Ansicht (Grid oder Liste).
- **ActiveFilters**: Die in der ControlsRow aktuell sichtbaren Filter — die fest sichtbare Freitextsuche plus vom Benutzer zusätzlich eingeblendete optionale Filter.
- **WineDataAsset**: Die Datei `wines.json`, die ausschließlich durch das ImportScript erzeugt wird. Sie wird NICHT als gebündeltes Angular-Asset ausgeliefert, sondern separat in den `data/`-Ordner deployt und vom Frontend zur Laufzeit per HTTP aus `data/wines.json` geladen.
- **PhasePreparate** (Phase `prepare`): Die erste Phase des ImportScripts, die JSON-Quelldateien aufbereitet: EXIF-Daten liest, Dateien umbenennt und Felder gemäß WineSchema aufbereitet.
- **PhaseExport** (Phase `export`): Die zweite Phase des ImportScripts, die aufbereitete JSON-Quelldateien liest, sortiert und die WineDataAsset nach `export_path` (`./export/data/wines.json`) schreibt.
- **PhaseImageExport** (Phase `image-export`): Die dritte Phase des ImportScripts, die zu den Weinen gehörige Bilddateien aus dem `import_dir` liest, skaliert und als Kopien in den `image_export_dir` schreibt, ohne die Originale zu verändern.
- **PhaseDeploy** (Phase `deploy`): Die vierte Phase des ImportScripts, die den Angular Build-Output, die WineDataAsset und die exportierten Bilder per FTPES (FTP mit explizitem TLS) auf einen konfigurierten Webserver überträgt.
- **scaffold_mode**: Ein boolescher Konfigurationsparameter, der steuert, ob fehlende Felder in JSON-Quelldateien mit `null` aufgefüllt (`true`) oder Felder mit `null`/Leer-Wert entfernt werden (`false`).
- **Slug**: Ein URL-freundlicher Bezeichner, der aus dem `name`-Feld eines Weins erzeugt wird (Kleinschreibung, Leerzeichen durch Bindestriche ersetzt, Sonderzeichen entfernt).
- **image_export_dir**: Der konfigurierte Zielordner für skalierte Bildkopien, der vom ImportScript in der PhaseImageExport befüllt wird. Dieser Ordner ist von den Angular-Assets getrennt und wird separat konfiguriert.
- **BackupConfig**: Das optionale `backup`-Objekt in der ConfigFile mit den Feldern `backup_dir`, `remote_backup_dir`, `max_last_backups`, `max_archival_backups` und `archival_interval_days`. Steuert zwei unabhängige Rolling-Window-Backups der exportierten `wines.json` als einzelne, zeitgestempelte Dateien (kein Ordner, nicht der Import-Ordner): **Last-Backups** (Dateien mit Präfix `last_`, z. B. `last_YYYY-MM-DD_HH-MM-SS.json`) werden bei jedem Pipeline-Lauf erstellt und bewahren die letzten `max_last_backups` Kopien; **Archival-Backups** (Dateien mit Präfix `archival_`) werden nur erstellt wenn mindestens `archival_interval_days` Tage vergangen sind und bewahren die letzten `max_archival_backups` Kopien. Bei beiden wird die älteste Datei gelöscht wenn das jeweilige Maximum überschritten wird. Ist `remote_backup_dir` gesetzt, werden diese Einzeldateien zusätzlich per FTPES auf den Webspace hochgeladen.
- **DeployConfig**: Das `deploy`-Objekt in der ConfigFile mit den Feldern `protocol`, `remote_path`, `remote_images_path` und `remote_import_path`. Die sensiblen Verbindungsparameter `host`, `user` und `password` stehen NICHT mehr in der ConfigFile, sondern werden zur Laufzeit aufgelöst (Reihenfolge: ConfigFile > unversionierte `weinsprechstunde.secrets.json` > Umgebungsvariablen `WEINSPRECHSTUNDE_DEPLOY_HOST`/`_USER`/`_PASSWORD`).
- **import_source**: Konfigurationsfeld in der ConfigFile das bestimmt ob der Import-Ordner lokal (`"local"`) oder per FTPES vom Webserver (`"remote"`) geladen wird. Im `"remote"`-Modus wird der Inhalt von `deploy.remote_import_path` vor der PhasePreparate auf den lokalen Rechner synchronisiert.
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
- **KeyboardShortcuts**: Globale Tastaturkürzel der App: `i` schaltet das WineTileOverlay auf allen WineTiles um (wie InfoToggle), `l` wechselt zwischen Kachel- und Listenansicht (wie ListToggle). Die Pfeiltasten `←` und `→` navigieren durch die Weine in der aktuell über den FilterService gefilterten und sortierten Reihenfolge (dieselbe Reihenfolge wie in WineGrid und WineList): `→` zeigt den nächsten Wein, `←` den vorherigen Wein im WineDetailDialog an. Am Rand wird umlaufen (Wrap): nach dem letzten Wein folgt bei `→` wieder der erste, vor dem ersten Wein folgt bei `←` der letzte. Ist kein WineDetailDialog geöffnet, öffnet `→` den WineDetailDialog mit dem ersten Wein und `←` mit dem letzten Wein dieser Liste. Die Taste `Escape` schließt den geöffneten WineDetailDialog.
- **tasting_date**: ISO-8601-Datumsstring (z. B. `"2021-10-12"`), der das Verkostungsdatum eines Weins angibt und entweder manuell in der JSON-Quelldatei gesetzt oder vom ImportScript aus EXIF-Daten des Bildes abgeleitet wird.
- **WineEditorApp**: Der Cloud-Ordner-Editor zur komfortablen Pflege der JSON-Quelldateien im `import_dir`. Sie ist eine reine Angular-Browser-App ohne eigenes Backend (zweite Angular-App im selben Workspace), die als statische App auf den Webserver deployt und von jedem Beteiligten über eine eigene URL geöffnet wird. Die ausgelieferte App enthält keine Weindaten; sie ist nur die App-Hülle. Der Dateizugriff erfolgt direkt im Browser über die File System Access API auf den vom Benutzer einmalig freigegebenen Cloud-Ordner (= `import_dir`), dessen JSON-Quelldateien, Bild- und Mediendateien sie an Ort und Stelle liest und schreibt. Die WineEditorApp läuft ausschließlich in Chromium-basierten Browsern (Chrome/Edge), da die File System Access API in anderen Browsern nicht verfügbar ist, und benötigt keine Authentifizierung. Sie teilt ihre Filter-, Such-, Sortier- und WineSchema-Verarbeitungslogik über einen gemeinsam genutzten Angular-Library-/Shared-Code-Bereich mit der öffentlichen Weinliste. Die Cloud-Synchronisation des freigegebenen Ordners verteilt die bearbeiteten Dateien zwischen den Beteiligten.
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
8. THE ConfigFile SHALL ein Feld `import_source` (String, Wert `"local"` oder `"remote"`) enthalten, das bestimmt ob der Import-Ordner lokal oder per FTPES vom konfigurierten Webserver geladen wird.
9. WHEN `import_source` den Wert `"remote"` hat, THE ImportScript SHALL den Import-Ordner vor Ausführung der PhasePreparate per FTPES vom Webserver herunterladen. Der Remote-Pfad wird aus einem neuen Feld `deploy.remote_import_path` in der ConfigFile gelesen.
10. WHEN der Import-Ordner per FTPES heruntergeladen wird, THE ImportScript SHALL dieselben Verbindungsparameter und dasselbe Secrets-Handling (Config > Secrets-Datei > Umgebungsvariablen) verwenden wie die PhaseDeploy.
11. WHEN `import_source` den Wert `"remote"` hat und der Download des Import-Ordners fehlschlägt, THEN THE ImportScript SHALL mit einer lesbaren Fehlermeldung abbrechen, die den Serverpfad und die Fehlermeldung des Servers enthält.
12. THE ConfigFile SHALL das Feld `image_export_dir` (String) als Zielpfad für skalierte Bildkopien der PhaseImageExport enthalten.
13. THE ConfigFile SHALL die Felder `image_resize_mode` (String, Wert `"width"` oder `"height"`) und `image_resize_px` (Integer) zur Steuerung der Bildskalierung in der PhaseImageExport enthalten.
14. THE ConfigFile SHALL ein `deploy`-Objekt enthalten mit den Feldern `protocol` (String, Wert `"ftpes"`), `remote_path` (String), `remote_images_path` (String) und `remote_import_path` (String). Die sensiblen Felder `host`, `user` und `password` stehen NICHT in der ConfigFile.
15. WHERE `host`, `user` oder `password` in der ConfigFile fehlen oder leer sind, THE ImportScript SHALL diese Werte aus einer unversionierten `weinsprechstunde.secrets.json` neben der ConfigFile und — falls dort ebenfalls nicht gesetzt — aus den Umgebungsvariablen `WEINSPRECHSTUNDE_DEPLOY_HOST`, `WEINSPRECHSTUNDE_DEPLOY_USER` bzw. `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` auflösen (Reihenfolge: ConfigFile > Secrets-Datei > Umgebungsvariable). Eine fehlende Secrets-Datei ist kein Fehler.
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
11. WHEN nach einer Umbenennung die Zieldatei bereits existiert, THEN THE ImportScript SHALL die Umbenennung still überspringen und KEINE Warnung pro Datei ausgeben; am Ende der PhasePreparate SHALL es höchstens EINE Zusammenfassungszeile auf der Standardfehlerausgabe ausgeben, die die Anzahl der wegen bereits existierender Zieldatei übersprungenen Umbenennungen nennt (z. B. „prepare: N Umbenennung(en) übersprungen (Zieldatei existierte bereits).").
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
11. WHEN eine in einer JSON-Quelldatei referenzierte Bilddatei nicht im `import_dir` gefunden wird, THEN THE ImportScript SHALL mit dem nächsten Eintrag fortfahren und KEINE Warnung pro fehlender Datei ausgeben; die Anzahl fehlender Quellen SHALL stattdessen in der Phasen-Zusammenfassung (Req 4.12) berücksichtigt werden.
12. THE ImportScript SHALL in der PhaseImageExport für übersprungene Bilder (bereits aktuelle Zielkopie, Req 4.9) KEINE Warnung pro Bild ausgeben, sondern diese still überspringen. Am Ende der PhaseImageExport SHALL es höchstens EINE Zusammenfassungszeile auf der Standardfehlerausgabe ausgeben, die die Anzahl skalierter Bilder, bereits vorhandener (übersprungener) Bilder und fehlender Quellen nennt (z. B. „image-export: X skaliert, Y bereits vorhanden übersprungen, Z Quellen fehlten.").

### Requirement 5: Build-Pipeline

**User Story:** Als Entwickler möchte ich, dass das Angular-Frontend unabhängig von der Import-Logik gebaut werden kann, damit ein Frontend-Build die Importdaten nicht erneut verarbeitet und die Daten unabhängig vom Frontend gepflegt werden können.

#### Acceptance Criteria

1. THE App SHALL den Angular-Build (`npm run build` / `ng build`) OHNE Kopplung an das Import-Skript ausführen. Der Build SHALL KEINEN `prebuild`-Schritt enthalten, der Import-Phasen ausführt; das Frontend ist unabhängig von der Import-Logik.
2. THE App SHALL ein `Makefile` oder `build.sh` enthalten, das die PhasePreparate, die PhaseExport und die PhaseImageExport auch einzeln und unabhängig voneinander aufrufbar macht.
3. THE App SHALL ein `Makefile` oder `build.sh` enthalten, das einen `deploy`-Befehl bereitstellt, der die vollständige Pipeline ausführt: PhasePreparate, PhaseExport, PhaseImageExport, Angular-Build (`npm run build`) und anschließend PhaseDeploy. Die Import-Phasen werden dabei vom Makefile ausgelöst, NICHT vom Angular-Build.
4. THE ImportScript SHALL alle drei Phasen (PhasePreparate, PhaseExport, PhaseImageExport) sequenziell ausführen, wenn es ohne Phasen-Argument aufgerufen wird (`python script.py`).
5. WHEN eine Import-Phase in der Makefile- bzw. CI-Pipeline fehlschlägt, THEN THE Pipeline SHALL abbrechen, bevor der Angular-Build bzw. das Deployment ausgeführt wird.
6. THE App SHALL eine GitHub Actions Workflow-Datei (`.github/workflows/deploy.yml`) enthalten, die bei einem Push auf den `main`-Branch automatisch die vollständige Pipeline ausführt. WHEN `import_source` in der ConfigFile den Wert `"remote"` hat, SHALL der Workflow den Import-Ordner per FTPES vom Webserver herunterladen, bevor die Import-Phasen ausgeführt werden. Host, Benutzer und Deploy-Passwort SHALL der Workflow aus GitHub Secrets als Umgebungsvariablen (`WEINSPRECHSTUNDE_DEPLOY_HOST`/`_USER`/`_PASSWORD`) lesen.

### Requirement 6: Import-Skript – Phase deploy

**User Story:** Als Autor (Toni, Simone) möchte ich, dass fertige Artefakte automatisch auf den Webserver übertragen werden, damit ich die App nach einem Build ohne manuelle FTP-Uploads veröffentlichen kann.

#### Acceptance Criteria

1. THE ImportScript SHALL die PhaseDeploy über den Befehl `python script.py deploy` aufrufbar machen.
2. THE ImportScript SHALL beim Deploy den Angular Build-Output (dist-Ordner), die WineDataAsset und alle Dateien aus dem `image_export_dir` auf den konfigurierten Webserver übertragen.
3. THE ImportScript SHALL die Übertragung per FTPES (FTP mit explizitem TLS, `deploy.protocol = "ftpes"`) durchführen. Die Zertifikatsprüfung ist standardmäßig deaktiviert (der Webspace liefert ein Zertifikat mit abweichendem Hostnamen), die Verbindung bleibt jedoch TLS-verschlüsselt; mit der Umgebungsvariable `FTPS_VERIFY=1` lässt sich die reguläre Zertifikatsprüfung aktivieren.
4. WHEN der Zeitstempel einer lokalen Datei nicht neuer ist als der Zeitstempel der entsprechenden Datei auf dem Server, THE ImportScript SHALL diese Datei nicht erneut übertragen.
5. WHEN eine Datei im Angular Build-Output-Verzeichnis lokal nicht mehr existiert, aber auf dem Server unter `deploy.remote_path` vorhanden ist, THE ImportScript SHALL diese Datei auf dem Server löschen.
6. THE ImportScript SHALL Dateien aus der WineDataAsset und dem `image_export_dir` auf dem Server niemals löschen, unabhängig vom lokalen Zustand.
7. THE ImportScript SHALL die Angular Build-Artefakte unter dem in `deploy.remote_path` konfigurierten Serverpfad ablegen.
8. THE ImportScript SHALL die Bilddateien unter dem in `deploy.remote_images_path` (`/wine_app/images`) konfigurierten Serverpfad ablegen.
9. THE ImportScript SHALL die WineDataAsset (`wines.json`) sowie `wine-schema.json` unter dem in `deploy.remote_import_path` (`/wine_app/data`) konfigurierten Serverpfad ablegen, sodass das Frontend sie zur Laufzeit aus `data/` lädt.
10. WHERE `deploy.password` in der ConfigFile einen nicht-leeren Wert enthält, THE ImportScript SHALL diesen Wert als Passwort für die Serververbindung verwenden.
11. WHERE `deploy.password` in der ConfigFile leer ist, THE ImportScript SHALL das Passwort aus der `weinsprechstunde.secrets.json` und — falls dort nicht gesetzt — aus der Umgebungsvariable `WEINSPRECHSTUNDE_DEPLOY_PASSWORD` lesen. WHEN weder Secrets-Datei noch Umgebungsvariable ein Passwort liefern, THEN THE ImportScript SHALL mit folgender Fehlermeldung auf der Standardfehlerausgabe abbrechen: „FEHLER: Kein Deploy-Passwort gefunden. Setze die Umgebungsvariable WEINSPRECHSTUNDE_DEPLOY_PASSWORD mit dem Server-Passwort, z. B.: export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=deinPasswort". Das Deployment wird gestoppt.
12. WHEN die Verbindung zum Server fehlschlägt, THEN THE ImportScript SHALL mit folgender Fehlermeldung auf der Standardfehlerausgabe abbrechen: „FEHLER: Verbindung zum Server [host] fehlgeschlagen. Server-Meldung: [original Fehlermeldung des Servers]. Bitte prüfe: (1) Ist der Hostname '[host]' korrekt? (2) Sind Benutzername und Passwort gültig? (3) Ist der Server erreichbar und das Protokoll ([protocol]) korrekt?" Das Deployment wird gestoppt.
13. THE ImportScript SHALL alle für das Deployment benötigten Zugangsdaten (Passwörter, Tokens) ausschließlich über Umgebungsvariablen entgegennehmen, sodass diese sicher in externen Secret-Stores (z. B. GitHub Secrets) hinterlegt werden können und niemals im Klartext in der ConfigFile oder im Versionskontrollsystem landen.
14. THE ImportScript SHALL beim Deploy als Wurzel des Angular Build-Outputs das tatsächliche Browser-Build-Verzeichnis verwenden, sodass `index.html`, `assets/` und weitere Build-Dateien DIREKT unter `deploy.remote_path` landen und nicht in einem Unterordner. WHEN der Builder `@angular/build:application` nach `frontend/dist/<projekt>/browser/` baut, THE ImportScript SHALL diesen `browser`-Unterordner als Deploy-Wurzel auflösen; WHEN ein klassischer flacher `frontend/dist/`-Ordner mit `index.html` vorliegt, THE ImportScript SHALL diesen unverändert als Deploy-Wurzel verwenden.
15. THE ImportScript SHALL beim Deploy KEIN automatisches Pre-Deploy-Backup erstellen; der Inhalt von `deploy.remote_path` (`/wine_app`) wird beim Deploy überschrieben. Der Prune löscht veraltete Dateien ausschließlich unterhalb von `deploy.remote_path` und lässt den Web-Root (inkl. Root-`.htaccess`) unberührt; `remote_images_path`, `remote_import_path` und die WineDataAsset sind gemäß Requirement 6.6 vom Prune ausgenommen.
16. THE ImportScript SHALL beim Prune geschützte Teilbäume (`remote_images_path`/`images/` und `remote_import_path`/`data/`) GAR NICHT betreten: Ein Serververzeichnis, dessen relativer Pfad einem geschützten Präfix entspricht, SHALL weder aufgelistet noch rekursiv durchlaufen werden, und für seinen Inhalt SHALL keine Typprüfung (`_ftp_is_dir`) oder Löschung erfolgen. Dies dient Schutz und Performance (Vermeidung hunderter unnötiger FTP/TLS-Roundtrips) und behebt die Deploy-Blockade.
17. THE ImportScript SHALL zur Ermittlung von Verzeichnisinhalten beim Prune (und beim Remote-Download) primär ein MLSD-basiertes Listing (`ftp.mlsd()`, RFC 3659) verwenden, das pro Verzeichnis in EINEM Roundtrip Namen und Typ liefert, statt für jeden Eintrag zwei `cwd`-Roundtrips (`_ftp_is_dir`) auszuführen. WHEN der Server MLSD nicht unterstützt oder es fehlschlägt, THEN THE ImportScript SHALL robust auf das bisherige Verhalten (`nlst` + `_ftp_is_dir`) zurückfallen.
18. THE ImportScript SHALL für die PhaseDeploy einen CLI-Parameter `--force-images` bereitstellen. WHEN `--force-images` gesetzt ist, THE ImportScript SHALL beim Deploy ALLE Bilder neu hochladen, unabhängig vom `MDTM`/Timestamp-Vergleich; WHEN er nicht gesetzt ist, SHALL das bisherige Verhalten gelten (nur neuere/fehlende Bilder hochladen). Der Parameter SHALL über das Makefile als `make deploy FORCE_IMAGES=1` durchreichbar sein.

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

1. THE App SHALL globale Tastaturkürzel bereitstellen: `i` schaltet das WineTileOverlay auf allen WineTiles um (wie der InfoToggle), `l` wechselt zwischen Kachel- und Listenansicht (wie der ListToggle), `→` navigiert zum nächsten Wein und `←` zum vorherigen Wein im WineDetailDialog.
2. WHEN der Benutzer die Taste `i` drückt und keine Ausnahmebedingung vorliegt, THE App SHALL den InfoToggle-Zustand umschalten.
3. WHEN der Benutzer die Taste `l` drückt und keine Ausnahmebedingung vorliegt, THE App SHALL zwischen WineGrid und WineList umschalten.
4. WHILE der Fokus in einem Eingabefeld (`input`, `textarea`, `select` oder einem `contenteditable`-Element) liegt, THE App SHALL die Tastaturkürzel `i`, `l`, `←`, `→` und `Escape` NICHT auslösen.
5. WHILE der WineDetailDialog geöffnet ist, THE App SHALL die Tastaturkürzel `i` und `l` NICHT auslösen.
6. WHEN ein Tastendruck mit einer Modifier-Taste (Ctrl, Cmd/Meta oder Alt) kombiniert ist, THE App SHALL die Tastaturkürzel `i`, `l`, `←`, `→` und `Escape` NICHT auslösen.
7. WHILE der WineDetailDialog geöffnet ist und keine Ausnahmebedingung vorliegt, WHEN der Benutzer die Taste `→` drückt, THE App SHALL im WineDetailDialog den in der über den FilterService gefilterten und sortierten Reihenfolge (dieselbe Reihenfolge wie in WineGrid und WineList) nächsten Wein anzeigen.
8. WHILE der WineDetailDialog geöffnet ist und keine Ausnahmebedingung vorliegt, WHEN der Benutzer die Taste `←` drückt, THE App SHALL im WineDetailDialog den in der über den FilterService gefilterten und sortierten Reihenfolge vorherigen Wein anzeigen.
9. WHILE der WineDetailDialog geöffnet ist und der aktuell angezeigte Wein der letzte Wein der über den FilterService gefilterten und sortierten Reihenfolge ist, WHEN der Benutzer die Taste `→` drückt, THE App SHALL im WineDetailDialog den ersten Wein dieser Reihenfolge anzeigen.
10. WHILE der WineDetailDialog geöffnet ist und der aktuell angezeigte Wein der erste Wein der über den FilterService gefilterten und sortierten Reihenfolge ist, WHEN der Benutzer die Taste `←` drückt, THE App SHALL im WineDetailDialog den letzten Wein dieser Reihenfolge anzeigen.
11. WHILE kein WineDetailDialog geöffnet ist und keine Ausnahmebedingung vorliegt, WHEN der Benutzer die Taste `→` drückt, THE App SHALL den WineDetailDialog mit dem ersten Wein der über den FilterService gefilterten und sortierten Reihenfolge öffnen.
12. WHILE kein WineDetailDialog geöffnet ist und keine Ausnahmebedingung vorliegt, WHEN der Benutzer die Taste `←` drückt, THE App SHALL den WineDetailDialog mit dem letzten Wein der über den FilterService gefilterten und sortierten Reihenfolge öffnen.
13. WHILE der WineDetailDialog geöffnet ist und keine Ausnahmebedingung vorliegt, WHEN der Benutzer die Taste `Escape` drückt, THE App SHALL den WineDetailDialog schließen.

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

**User Story:** Als Autor (Toni, Simone) möchte ich den Editor als reine Browser-App ohne Login-Hürde öffnen können, da er kein Backend besitzt und der Zugriff allein über die lokal erteilte Freigabe des Cloud-Ordners geschützt ist.

#### Acceptance Criteria

1. THE WineEditorApp SHALL als reine Browser-App ohne eigenen Server und ohne Backend betrieben werden und keine Authentifizierung verlangen — es gibt kein Passwort, kein Session-Cookie und kein Rate-Limiting —, da der Zugang allein über die vom Benutzer im Browser erteilte Freigabe des Cloud-Ordners kontrolliert wird.
2. THE WineEditorApp SHALL alle datei- und bildbezogenen Zugriffe ausschließlich über die vom Benutzer im Browser erteilte Ordner-Freigabe (File System Access API) ausführen, sodass die App nur auf den freigegebenen Cloud-Ordner (= `import_dir`) und dessen Inhalt zugreifen kann und ein Ausbruch über diesen Ordner hinaus durch die Browser-API technisch ausgeschlossen ist.
3. THE WineEditorApp SHALL als auf den Webserver deployte statische App keine Weindaten enthalten und Weindaten ausschließlich aus dem lokal freigegebenen Cloud-Ordner lesen und in diesen schreiben.
4. THE WineEditorApp SHALL ohne die ConfigFile-Felder `editor.path` und `editor.password_hash` auskommen, da die Browser-App weder einen geheimen URL-Pfad noch ein Passwort benötigt.

### Requirement 17: Wine Editor Web-App

**User Story:** Als Autor (Toni, Simone) möchte ich alle Weineinträge über eine komfortable Web-Oberfläche anlegen, bearbeiten, offene Bilder abarbeiten und ungewollte Einträge archivieren können, damit ich keine JSON-Quelldateien manuell im Texteditor pflegen muss. Das endgültige Löschen von Einträgen oder Dateien soll bewusst dem Dateisystem vorbehalten bleiben.

#### Acceptance Criteria

1. THE WineEditorApp SHALL als reine Angular-Browser-App ohne Backend (zweite Angular-App im selben Workspace) implementiert sein, als statische App auf den Webserver deployt und per URL geöffnet werden und die JSON-Quelldateien sowie Bild- und Mediendateien über die File System Access API direkt im vom Benutzer freigegebenen Cloud-Ordner (= `import_dir`) an Ort und Stelle bearbeiten, während die Verteilung der Dateien zwischen den Beteiligten über die Cloud-Synchronisation des Ordners erfolgt.
2. THE WineEditorApp SHALL beim ersten Start den Benutzer auffordern, den Cloud-Ordner (= `import_dir`) über die File System Access API freizugeben, und das daraus erhaltene Ordner-Handle im Browser (IndexedDB) persistieren.
3. WHEN die WineEditorApp erneut geöffnet wird und ein persistiertes Ordner-Handle vorliegt, THE WineEditorApp SHALL den Zugriff auf den Cloud-Ordner mit einer kurzen Re-Autorisierung wiederherstellen, ohne dass der Benutzer den Ordner erneut suchen muss.
4. THE WineEditorApp SHALL ausschließlich in Chromium-basierten Browsern (Chrome/Edge) lauffähig sein und bei fehlender File System Access API einen verständlichen Hinweis anzeigen.
5. THE WineEditorApp SHALL die Verteilung der JSON-Quelldateien, Bild- und Mediendateien zwischen den Beteiligten ausschließlich der Cloud-Synchronisation des Ordners überlassen und selbst keine Cloud-Sync-Konflikte auflösen, sodass gleichzeitiges Bearbeiten derselben Datei durch mehrere Personen zu Cloud-Sync-Konflikten führen kann, die außerhalb der Verantwortung der WineEditorApp liegen.
6. WHEN der Benutzer eine eigene Aktion abschließt (Anlegen, Archivieren, Bild-Verknüpfen oder Speichern), THE WineEditorApp SHALL die Liste der Weineinträge automatisch aktualisieren.
7. THE WineEditorApp SHALL für durch die Cloud-Synchronisation entstandene Änderungen anderer Beteiligter einen manuellen Aktualisieren-Button zum Neuladen der Liste bereitstellen und kein automatisches Polling durchführen.
8. THE WineEditorApp SHALL ihre Oberfläche als Zwei-Spalten-Layout darstellen, bei dem die Liste der Weineinträge links und die Detail-/Bearbeitungsansicht (WineEditor) rechts angezeigt wird.
9. WHEN der Benutzer einen Eintrag in der Liste auswählt, THE WineEditorApp SHALL die Details dieses Eintrags im WineEditor rechts anzeigen.
10. THE WineEditorApp SHALL die Liste der Weineinträge mit denselben attributbasierten Filter-, Such- und Sortiermöglichkeiten wie die öffentliche Weinliste (gemäß WineSchema und FilterService/ControlsRow) sowie zusätzlich einem Eintragstyp-Filter darstellen und dabei zwei Eintragstypen unterscheiden: angelegte Weine (eine JSON-Quelldatei existiert im `import_dir`) und unbekannte Weine (Bilddateien im `import_dir`, die von keinem `image`-Feld einer JSON-Quelldatei referenziert werden).
11. THE WineEditorApp SHALL ihre Filter-, Such- und Sortierlogik sowie die WineSchema-Verarbeitung über einen gemeinsam genutzten Angular-Library-/Shared-Code-Bereich mit der öffentlichen Weinliste teilen, sodass diese Logik nicht dupliziert wird.
12. THE WineEditorApp SHALL die Liste standardmäßig absteigend nach `tasting_date` sortieren, wobei angelegte und unbekannte Weine gemischt nach Datum einsortiert werden, Einträge ohne ermittelbares `tasting_date` ans Ende gestellt werden und weitere Sortieroptionen denen der öffentlichen Weinliste über den geteilten FilterService entsprechen.
13. WHILE ein unbekannter Wein in der Liste dargestellt wird, THE WineEditorApp SHALL den Platzhaltertext „unbekannter Wein", das aus dem Bild ermittelte `tasting_date` (sofern ermittelbar) sowie eine Bildvorschau anzeigen.
14. THE WineEditorApp SHALL einen Eintragstyp-Filter mit genau drei Zuständen bereitstellen: „Alle" (angelegte und unbekannte Weine erscheinen), „Nur angelegte" (nur Einträge mit vorhandener JSON-Quelldatei erscheinen) und „Nur unbekannte" (nur nicht referenzierte Bilddateien erscheinen).
15. WHILE der Eintragstyp-Filter auf „Nur unbekannte" steht, WHEN der Benutzer einen Wert in einen attributbasierten Filter (z. B. Freitextsuche, Rebsorte, Region) eingibt, THE WineEditorApp SHALL den Eintragstyp-Filter automatisch auf „Nur angelegte" umschalten, da unbekannte Weine keine solchen Attribute besitzen.
16. THE WineEditorApp SHALL für alle in der WineSchema definierten Felder geeignete Eingabefelder bereitstellen; für das Feld `tasting_date` einen Datepicker und für das Feld `rating` eine Zahleneingabe mit Schrittweite 0.1 im Bereich 1.0 bis 10.0.
17. THE WineEditorApp SHALL für Felder mit `filter_type` „dropdown" oder „multi-select" (`country`, `origin`, `grape`, `type`, `producer`, `quality`) eine Auswahl aus den bereits in anderen Weineinträgen vorkommenden Werten anbieten und für die übrigen Textfelder eine Autocomplete-Textvervollständigung aus den bekannten Werten der vorhandenen Weineinträge bereitstellen.
18. THE WineEditorApp SHALL das multi-value-Feld `grape` als Tag-/Chip-Eingabe darstellen, bei der mehrere Werte einzeln hinzugefügt werden, jeweils mit Autocomplete-Vorschlägen aus den bereits in vorhandenen Weineinträgen vorkommenden Rebsorten, und den Wert als Array in der JSON-Quelldatei speichern.
19. THE WineEditorApp SHALL für die Felder `audio` und `video` jeweils einen Medien-Picker analog zum ImagePicker bereitstellen, der die entsprechenden Mediendateien im `import_dir` anzeigt und bei Auswahl den Dateinamen der ausgewählten Mediendatei in das jeweilige Feld übernimmt.
20. WHILE ein Weineintrag kein nicht-leeres `name`-Feld hat, THE WineEditorApp SHALL diesen Eintrag im WineEditor und in der Liste sichtbar als unvollständig markieren und die automatische Speicherung des Zwischenstands dennoch durchführen.
21. WHILE der Benutzer in ein Feld des WineEditor schreibt, THE WineEditorApp SHALL die zugrunde liegende JSON-Quelldatei ohne manuelle Speicheraktion automatisch aktualisieren, frühestens 500 ms nach der letzten Eingabe im jeweiligen Feld (Debounce 500 ms pro Feld).
22. WHEN die WineEditorApp ein number-Feld der WineSchema automatisch speichert, THE WineEditorApp SHALL den Wert typrichtig als JSON-Zahl schreiben (`year` als Ganzzahl ohne Nachkommastellen, `price` mit 2 Nachkommastellen, `rating` mit 1 Nachkommastelle) und dabei ein Dezimal-Komma als Dezimaltrennzeichen akzeptieren (z. B. „6,99" wird als `6.99` gespeichert), konsistent zur Normalisierung im ImportScript (Requirement 2).
23. WHEN eine automatische Speicherung einer JSON-Quelldatei erfolgreich abgeschlossen wurde, THE WineEditorApp SHALL über einen Speicherstatus-Indikator den diskreten Zustand „Erfolg" anzeigen.
24. IF eine automatische Speicherung einer JSON-Quelldatei fehlschlägt, THEN THE WineEditorApp SHALL über den Speicherstatus-Indikator den diskreten Zustand „Fehler" mit einer Fehleranzeige, die den Fehlschlag erkennbar macht, anzeigen und die zuletzt eingegebenen Feldinhalte im WineEditor erhalten.
25. IF beim automatischen Speichern erkannt wird, dass die JSON-Quelldatei seit dem letzten Laden extern verändert wurde (Best-effort-Konflikterkennung über die Datei-Änderungszeit, die über die File System Access API ermittelt wird, z. B. `File.lastModified`), THEN THE WineEditorApp SHALL den Benutzer vor dem Überschreiben warnen und das Überschreiben nicht ohne Bestätigung durch den Benutzer durchführen.
26. IF eine JSON-Quelldatei im `import_dir` kein gültiges JSON ist, THEN THE WineEditorApp SHALL diese Datei in der Liste sichtbar als fehlerhaft markieren und nicht zum Bearbeiten im WineEditor öffnen, sodass die Korrektur manuell im Dateisystem erfolgt.
27. WHERE eine JSON-Quelldatei Felder enthält, die nicht in der WineSchema definiert sind, THE WineEditorApp SHALL diese Felder im WineEditor anzeigen und beim Speichern erhalten.
28. THE WineEditorApp SHALL für das Feld `image` einen ImagePicker bereitstellen, der eine Galerie der Bilddateien im `import_dir` mit Bildvorschau (clientseitig im Browser aus den über die File System Access API gelesenen Originalbildern erzeugte Thumbnails) anzeigt und standardmäßig ausschließlich die keinem Weineintrag zugeordneten Bilddateien darstellt.
29. THE ImagePicker SHALL einen Umschalt-Button bereitstellen, der die Anzeige zwischen „nur ungenutzte Bilder" (keinem Weineintrag zugeordnet) und „alle Bilder" des `import_dir` wechselt.
30. THE ImagePicker SHALL eine Sortierung der angezeigten Bilddateien nach Datum (Aufnahme- bzw. Dateidatum des Bildes) bereitstellen.
31. THE ImagePicker SHALL ein Filter-Eingabefeld bereitstellen, mit dem die angezeigten Bilddateien nach Dateiname gefiltert werden.
32. THE WineEditorApp SHALL als Bilddateien (für unbekannte Weine und den ImagePicker) Dateien mit den Endungen `.jpg`, `.jpeg`, `.png` und `.webp` case-insensitive berücksichtigen.
33. THE WineEditorApp SHALL Bildvorschauen in Listen-Thumbnails, im ImagePicker und im WineEditor clientseitig im Browser aus den über die File System Access API gelesenen Originalbildern im `import_dir` erzeugen (z. B. über Canvas bzw. `createImageBitmap`), ohne die Originaldateien zu verändern.
34. WHEN der Benutzer ein Bild im ImagePicker auswählt, THE WineEditorApp SHALL den Dateinamen des ausgewählten Bildes in das `image`-Feld des aktuell bearbeiteten Weineintrags übernehmen.
35. THE WineEditorApp SHALL das `image`-Feld (wie `audio` und `video`) ausschließlich als Dateinamen ohne Pfad speichern, wobei die Bilddatei stets im selben Verzeichnis wie die zugehörige JSON-Quelldatei liegt, sodass gleichnamige Bilddateien in verschiedenen Unterordnern des `import_dir` eindeutig bleiben.
36. WHEN der Benutzer auf das Bild eines unbekannten Weins in der Liste klickt, THE WineEditorApp SHALL den WineEditor für diesen Eintrag öffnen und über die File System Access API im Hintergrund eine neue JSON-Quelldatei anlegen, in der alle Felder der WineSchema mit `null` initialisiert sind — mit Ausnahme von `image` (Dateiname des angeklickten Bildes) und `tasting_date` (aus dem EXIF-Aufnahmezeitpunkt `DateTimeOriginal` des Bildes, falls vorhanden, sonst `null`).
37. WHEN die WineEditorApp durch einen Bildklick eine neue JSON-Quelldatei anlegt, THE WineEditorApp SHALL diese mit einem vorläufigen Dateinamen aus dem Basisnamen des angeklickten Bildes und der Endung `.json` im selben Unterordner des `import_dir` wie das Bild erzeugen und die endgültige Umbenennung nach dem Schema `{tasting_date}-{slug(name)}` der PhasePreparate des ImportScripts überlassen, ohne die Umbenennungslogik zu duplizieren.
38. WHEN der WineEditor nach einem Bildklick für einen soeben per Bild angelegten neuen Weineintrag geöffnet ist, THE WineEditorApp SHALL im `name`-Feld ein Autocomplete anbieten, das alle bestehenden Weineinträge vorschlägt, deren JSON-Quelldatei kein gesetztes `image`-Feld besitzt (`image`-Feld leer, `null` oder nicht vorhanden).
39. THE WineEditorApp SHALL im `name`-Feld eines per Bildklick angelegten neuen Weineintrags genau zwei Eingabewege zulassen: die Eingabe eines eigenen neuen Namens oder die Auswahl eines bestehenden bildlosen Weineintrags aus dem Autocomplete.
40. WHEN der Benutzer im `name`-Feld eines per Bildklick angelegten neuen Weineintrags einen eigenen neuen Namen eingibt, ohne einen bestehenden Eintrag aus dem Autocomplete auszuwählen, THE WineEditorApp SHALL den per Bildklick angelegten neuen Weineintrag beibehalten und dessen `name`-Feld mit der Eingabe befüllen.
41. WHEN der Benutzer im `name`-Autocomplete einen bestehenden bildlosen Weineintrag auswählt, THE WineEditorApp SHALL den per Bildklick angelegten vorläufigen Weineintrag samt dessen vorläufiger JSON-Quelldatei über die File System Access API entfernen, das `image`-Feld des ausgewählten bestehenden Weineintrags auf den Dateinamen des angeklickten Bildes setzen, das angeklickte Bild in das Verzeichnis der JSON-Quelldatei des ausgewählten Weineintrags verschieben, falls es in einem anderen Unterordner des `import_dir` liegt, und im WineEditor fortan den ausgewählten bestehenden Weineintrag anzeigen und bearbeiten.
42. THE WineEditorApp SHALL nach Abschluss eines per Bildklick begonnenen Anlegevorgangs für denselben Wein genau eine JSON-Quelldatei vorhalten — entweder den per eigenem Namen angelegten neuen Weineintrag oder den aus dem Autocomplete ausgewählten bestehenden Weineintrag.
43. IF das Entfernen der vorläufigen JSON-Quelldatei oder das Verschieben des angeklickten Bildes beim Verknüpfen mit einem bestehenden bildlosen Weineintrag fehlschlägt, THEN THE WineEditorApp SHALL eine Fehleranzeige, die den Fehlschlag erkennbar macht, anzeigen und einen Zustand ohne doppelte JSON-Quelldatei für denselben Wein hinterlassen.
44. THE WineEditorApp SHALL keine Funktion zum Löschen von Weineinträgen oder Dateien bereitstellen; im Editor ist ausschließlich das Archivieren verfügbar, und das endgültige Löschen erfolgt ausschließlich manuell im Dateisystem.
45. THE WineEditorApp SHALL einen Archiv-Ordner als Unterordner des `import_dir` mit dem festen Namen `_archive` (also `import_dir/_archive/`) für archivierte Dateien verwenden.
46. WHEN der Benutzer im WineEditor ein ungenutztes Bild archiviert, THE WineEditorApp SHALL die Bilddatei über die File System Access API aus dem `import_dir` in den `_archive`-Ordner verschieben.
47. WHEN der Benutzer im WineEditor einen angelegten Weineintrag archiviert, THE WineEditorApp SHALL die JSON-Quelldatei zusammen mit den in den Feldern `image`, `audio` und `video` referenzierten Mediendateien (sofern vorhanden) über die File System Access API gemeinsam in den `_archive`-Ordner verschieben.
48. IF das Verschieben einer Datei in den `_archive`-Ordner fehlschlägt, THEN THE WineEditorApp SHALL eine Fehleranzeige, die den Fehlschlag erkennbar macht, anzeigen und die betroffenen Dateien an ihrem ursprünglichen Ort im `import_dir` belassen.
49. THE WineEditorApp SHALL alle Dateien im `_archive`-Ordner vollständig ignorieren, sodass weder archivierte Bilder als unbekannte Weine noch archivierte JSON-Quelldateien als angelegte Weine in der Liste erscheinen.
50. THE WineEditorApp SHALL keine Funktion zum Dearchivieren oder Zurückholen von Dateien aus dem `_archive`-Ordner bereitstellen; das Zurückverschieben archivierter Dateien erfolgt ausschließlich manuell im Dateisystem.
51. THE ImportScript (PhasePreparate, PhaseExport, PhaseImageExport) SHALL den `_archive`-Ordner vollständig überspringen, sodass archivierte Weineinträge und Bilddateien weder in die `wines.json` noch in den Bildexport einfließen.

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

### Requirement 20: Sicherheitskopien der exportierten wines.json

**User Story:** Als Autor (Toni, Simone) möchte ich bei jedem Build eine aktuelle Sicherheitskopie und zusätzlich regelmäßige Archiv-Snapshots der exportierten `wines.json` haben, damit ich sowohl auf den letzten Stand als auch auf ältere Versionen der Weinliste zurückgreifen kann.

#### Acceptance Criteria

1. WHEN das `backup`-Objekt in der ConfigFile vorhanden ist, THE ImportScript SHALL vor jeder Pipeline-Ausführung (vor PhasePreparate) ein neues Last-Backup erstellen.
2. THE ImportScript SHALL das Last-Backup als Kopie der einzelnen exportierten Datei `export_path` (die `wines.json`) als neue Datei im konfigurierten `backup.backup_dir` erstellen — NICHT als Kopie des Import-Ordners und NICHT als Unterordner. Der Dateiname SHALL das Format `last_YYYY-MM-DD_HH-MM-SS` mit der Dateiendung der Quelle (`.json`) haben, also `last_YYYY-MM-DD_HH-MM-SS.json`.
3. WHEN nach dem Erstellen eines neuen Last-Backups die Anzahl der `last_`-Dateien in `backup.backup_dir` größer als `backup.max_last_backups` ist, THE ImportScript SHALL die älteste `last_`-Datei löschen, sodass genau `backup.max_last_backups` Last-Backups erhalten bleiben. Die Marker-Datei `.last_archival` SHALL dabei NICHT als Backup gewertet werden.
4. THE ImportScript SHALL zusätzlich vor jeder Pipeline-Ausführung prüfen, ob seit dem letzten Archival-Backup mindestens `backup.archival_interval_days` Tage vergangen sind.
5. WHEN ein neues Archival-Backup fällig ist, THE ImportScript SHALL eine Kopie der einzelnen exportierten Datei `export_path` als neue Datei im konfigurierten `backup.backup_dir` erstellen. Der Dateiname SHALL das Format `archival_YYYY-MM-DD_HH-MM-SS.json` haben.
6. WHEN nach dem Erstellen eines neuen Archival-Backups die Anzahl der `archival_`-Dateien in `backup.backup_dir` größer als `backup.max_archival_backups` ist, THE ImportScript SHALL die älteste `archival_`-Datei löschen, sodass genau `backup.max_archival_backups` Archival-Backups erhalten bleiben.
7. WHEN `backup.remote_backup_dir` konfiguriert ist, THE ImportScript SHALL in der Backup-Phase die erstellten Last- und (wenn fällig) Archival-Backup-DATEIEN (`last_<ts>.json` / `archival_<ts>.json`) per FTPES als Einzeldateien nach `backup.remote_backup_dir` auf den Webspace hochladen. Ist kein Deploy-Passwort verfügbar, SHALL das Remote-Backup übersprungen werden (Warnung auf der Standardfehlerausgabe), ohne die Pipeline abzubrechen; das lokale Backup bleibt bestehen.
8. THE ImportScript SHALL den Zeitstempel des zuletzt erstellten Archival-Backups in einer Datei `backup/.last_archival` im lokalen Backup-Ordner speichern, um das Archival-Intervall korrekt zu berechnen.
9. WHEN das Erstellen eines Backups fehlschlägt (lokal oder remote, Last oder Archival), THE ImportScript SHALL eine Warnung auf der Standardfehlerausgabe ausgeben und die Pipeline trotzdem fortsetzen — ein fehlgeschlagenes Backup stoppt nicht den Build.
10. WHEN die exportierte Datei `export_path` zum Zeitpunkt der Backup-Phase noch nicht existiert (z. B. backup läuft vor dem ersten `export`), THE ImportScript SHALL das Backup mit einer Warnung auf der Standardfehlerausgabe überspringen und NICHT abbrechen.

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
