# Backup-Phase sichert nur noch die exportierte wines.json als Einzeldatei

Die Backup-Phase sicherte bisher den kompletten Import-Ordner rekursiv (`shutil.copytree`) in zeitgestempelte Unterordner. Dieser Umbau stellt sie auf eine einzelne Datei um: gesichert wird jetzt ausschließlich `config.export_path` (`./export/data/wines.json`) via `shutil.copy2` als `last_<ts>.json` / `archival_<ts>.json`. `_prune_backups` prunt entsprechend Backup-Dateien statt -Ordner (Marker `.last_archival` ausgenommen), und `_remote_backup` lädt die Einzeldateien per `_upload_ftp` hoch statt rekursiv. Spec (requirements.md Req 20, design.md Backup-Abschnitt) und `.gitignore` sind nachgezogen. Das entspricht dem Nutzerwunsch „beim Backup nur das export json … es ist nur eine Datei, spare dir den Ordner".

Watch for: Backup läuft in der Full-Pipeline VOR dem Export und sichert damit den Stand des *vorherigen* Laufs, nicht den aktuellen (confirmed). Der erste Lauf auf frischem Checkout sichert gar nichts (confirmed, bewusst per Req 20.10 als Warnung spezifiziert).

**Verdict**: APPROVED

## High-level view

Der Kern des Umbaus ist der Wechsel von Verzeichnis- auf Datei-Semantik an drei zusammengehörigen Stellen: Kopie (`copytree`→`copy2`), Prune (`rmtree`→`unlink`, Filter `is_dir`→`is_file`) und Remote-Upload (`_upload_dir_ftp`→`_upload_ftp`). Alle drei sind konsistent angepasst, der tote `_upload_dir_ftp`-Helper wurde entfernt. Der Zielname erbt den Suffix der Quelle (`.json`), wodurch die zeitstempelbasierte lexikografische Sortierung im Prune erhalten bleibt, da alle Namen dasselbe Suffix tragen.

Die Fehlerbehandlung ist durchgängig fail-open: fehlende Export-Datei, fehlgeschlagene Kopie und fehlendes Deploy-Passwort führen jeweils zu einer stderr-Warnung und `return`/`name = None`, nie zum Abbruch. Der `_remote_backup`-Aufruf ist zusätzlich in ein try/except in `phase_backup` gekapselt, sodass ein FTP-Fehler die Phase nicht sprengt. Remote-Backup bleibt ausschließlich Teil der backup-Phase.

Eine Ordnungsfrage bleibt, ist aber spec-konform: In der Full-Pipeline läuft `phase_backup` als erste Phase, bevor `phase_export` die `wines.json` überhaupt schreibt. Das Backup erfasst damit den Export des vorangegangenen Laufs; der allererste Lauf hat keine Quelldatei und überspringt mit Warnung. Beides ist in Req 20.1 / 20.10 so festgeschrieben, verdient aber eine bewusste Kenntnisnahme.

Die Testsuite wurde vollständig auf Einzeldatei-Semantik umgestellt und um Datei-/Marker-/Missing-Export-/Remote-Upload-Fälle erweitert; Commit meldet 109 passed. Der FTPES-Deploy-Umbau wurde außer der einen `_remote_backup`-Zeile nicht angefasst.

<details>
<summary>Issues (2)</summary>

1. **Backup hinkt einen Lauf hinterher** — `phase_backup` läuft vor `phase_export`, sichert also den vorherigen Export; erster Lauf sichert nichts. Spec-konform (Req 20.1/20.10), aber falls „aktueller Stand" gemeint war, müsste die Phasenreihenfolge oder die Backup-Quelle angepasst werden. Mit dem Nutzer bestätigen, falls nicht gewollt.
2. **Suffix-Annahme an Quelldatei gebunden** — Zielname erbt `export_path.suffix`; bei leerem/anderem Suffix bricht die `.json`-Namenskonvention und potenziell die Sortier-Homogenität. Aktuell unkritisch, da `export_path` fix `wines.json` ist.

</details>

<details>
<summary>Details</summary>

### Datei-Semantik konsistent über Kopie, Prune und Upload

Der Umbau berührt drei Stellen, die gemeinsam den Begriff „Backup" von Ordner auf Datei umdefinieren, und tut das konsistent. `phase_backup` ersetzt `shutil.copytree(config.import_dir, …)` durch `shutil.copy2(export_path, …)`; `_prune_backups` tauscht den Verzeichnisfilter `d.is_dir()` gegen `f.is_file()` und `shutil.rmtree` gegen `oldest.unlink()`; `_remote_backup` ruft `_upload_ftp` statt `_upload_dir_ftp` auf. Der jetzt ungenutzte `_upload_dir_ftp`-Helper ist entfernt, es bleibt kein toter Code.

Die zeitstempel-lexikografische Sortierung im Prune bleibt korrekt, weil der Zielname aus `f"last_{timestamp}{suffix}"` gebildet wird und `suffix` für alle Backups identisch `.json` ist — der angehängte Suffix verschiebt die Ordnung nicht, da er bei jedem Eintrag gleich lang und gleich ist. Die Annahme hängt allerdings an `export_path`: käme die Quelle ohne Suffix oder mit variierendem Suffix, bräche sowohl die `last_*.json`-Namenskonvention als auch die Homogenität der Sortierschlüssel. Im aktuellen Setup ist `export_path` fest `wines.json`, damit ist das kein akutes Problem.

### Marker-Datei wird nie als Backup geprunt

`_prune_backups` schließt `f.name != LAST_ARCHIVAL_FILE` explizit aus. Das ist die entscheidende Absicherung der neuen Datei-Semantik: Mit dem alten `is_dir()`-Filter konnte die Marker-Datei `.last_archival` nie als Backup durchrutschen, mit dem neuen `is_file()`-Filter schon — der Namensausschluss fängt das ab. `test_marker_file_not_pruned_as_backup` deckt genau diesen Regressionspfad ab (5 Läufe, `max_last_backups=3`, Marker muss überleben und zählt nicht mit).

### Phasenreihenfolge: Backup sichert den vorigen Lauf

`_run_full_pipeline` ruft `phase_backup(config)` als erste Phase auf, danach erst `phase_prepare` und `phase_export`. Da die Backup-Quelle jetzt `config.export_path` ist — eine Datei, die `phase_export` am Ende der Pipeline schreibt — sichert die Backup-Phase systematisch den Export des *vorherigen* Laufs, nicht den gerade entstehenden. Auf frischem Checkout existiert `export/data/wines.json` noch nicht, der erste Lauf trifft den „übersprungen"-Zweig und sichert nichts.

Das ist nicht versehentlich: Req 20.1 schreibt das Backup „vor PhasePreparate" fest, und Req 20.10 spezifiziert das Überspringen-mit-Warnung für die fehlende Export-Datei ausdrücklich. Die Umsetzung ist also spec-treu. Es bleibt eine inhärente Eigenschaft der gewählten Reihenfolge, die ein Reviewer kennen sollte: Wer „sichere den Stand, der gerade gebaut wird" erwartet, bekommt stattdessen „sichere den zuletzt gebauten Stand". Falls das nicht gewollt ist, müsste entweder die Phasenreihenfolge geändert oder die Backup-Phase nach dem Export einsortiert werden.

### Fail-open durchgängig

Jeder Fehlerpfad der Phase hält die Pipeline am Laufen. Ein gescheitertes `shutil.copy2` setzt `last_name`/`archival_name = None`, womit der Remote-Upload diese Datei automatisch überspringt (`names = [n for n in (last_name, archival_name) if n]`). Ein fehlendes Deploy-Passwort überspringt `_remote_backup` mit Warnung und lässt das lokale Backup bestehen; ein FTP-Fehler im `_remote_backup`-Aufruf endet als Warnung statt als Abbruch. Tests decken den Missing-Export-, den Copy-Fehler- und den Passwort-fehlt-Fall je einzeln ab.

### Remote-Upload bleibt in der Backup-Phase

Der Upload wird nur aus `phase_backup` heraus getriggert, der Deploy-Pfad ist unberührt — das hält die Auftragsgrenze ein (FTPES-Deploy-Umbau außer der einen `_remote_backup`-Zeile nicht anfassen). Die TLS-Posture (`FTPS_VERIFY=0`) stammt aus dem bestehenden `_ftps_connect` und wird hier nicht verändert, liegt also außerhalb des Diff-Scopes — eine Schwächung der Transport-Sicherheit ist in diesem Diff nicht enthalten.

### .gitignore trifft gezielt wines.json, schont wine-schema.json

`.gitignore` ergänzt genau `export/data/wines.json`. `git check-ignore` bestätigt: `wines.json` wird ignoriert (exit 0), `wine-schema.json` nicht (exit 1), und `git ls-files export/data/` listet `wine-schema.json` weiterhin als getrackt — die Regel trifft das Schema nicht mit, wie gefordert.

### Tests auf Einzeldatei umgestellt

Die Suite ersetzt den `setup_import`-Helper (legte einen Ordner mit `w.json` an) durch `setup_export` (schreibt eine echte `export/data/wines.json`) und `count_prefix` zählt jetzt Dateien statt Ordner inklusive Marker-Ausschluss. Neu abgedeckt: Einzeldatei-Kopie mit Inhaltsgleichheit und `.json`-Suffix (last + archival), Marker-Nichtprune, Missing-Export-Skip, sowie Remote-Upload gegen eine `FakeFTP`-Attrappe (prüft, dass genau die `.json`-Einzeldateien hochgeladen werden und ohne Passwort gar nichts). Der Copy-Fehler-Test patcht nun `copy2` statt `copytree`. Commit-Message meldet `pytest scripts/tests -q -> 109 passed`; Suite wurde auftragsgemäß nicht erneut ausgeführt.

Nicht getestet: der kombinierte Pfad, dass bei einem FTP-Fehler *mitten* im Upload (z. B. erste Datei ok, zweite wirft) die Phase sauber mit Warnung weiterläuft — die try/except-Kapselung in `phase_backup` deckt das zwar ab, ein expliziter Test dafür fehlt. Geringe Priorität.

</details>

<details>
<summary>Geänderte Dateien</summary>

- `scripts/weinimport.py` — `phase_backup` kopiert Einzeldatei statt Ordner; `_prune_backups` auf Dateien umgestellt (Marker-Ausschluss); `_remote_backup` lädt Einzeldateien; `_upload_dir_ftp` entfernt.
- `scripts/tests/test_backup.py` — Helper auf Export-Datei umgestellt, neue Tests für Einzeldatei, Marker, Missing-Export, Remote-Upload.
- `.kiro/specs/weinliste/requirements.md` — Req 20 auf wines.json-Einzeldatei umformuliert, Req 20.10 neu.
- `.kiro/specs/weinliste/design.md` — Backup-Abschnitt, Diagramme, Property 20, Testübersicht nachgezogen.
- `.gitignore` — ignoriert `export/data/wines.json` (wine-schema.json bleibt getrackt).

Vollständiger Diff: `git -C /Users/za_jonas/repos/weinsprechstunde2 diff HEAD~1...HEAD`

</details>
