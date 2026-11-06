# Abschlussbericht: editor-load-merge (Domäne editor)

Branch `editor-load-merge`, nicht gepusht, nicht gemergt. Nicht committet: `ideas.md`, `.kiro/hooks/`, `.agents/`.

## Commits (`git log main..HEAD`)

| Hash | Message |
|---|---|
| ed35928 | fix: editor reads wine fresh on open and updates scan cache after save |
| 7e5baaa | fix: serialise saves per wine and flush pending input on wine switch |
| e187cab | docs: editor specs and docstring for fresh load, cache update and save queue |
| 1abcad7 | feat: field-wise three-way merge on save with per-field conflict dialog |
| f516d6a | docs: editor-output 1.1.0 field-wise conflict protection, specs and property 17 |

## Testläufe

| Lauf | Vorher | Nachher |
|---|---|---|
| `ng test editor` | 187 (Baseline) | 239 passed, 21 Dateien |
| `pytest scripts/tests` | 122 | 122 passed |
| `ng build editor` | ok | ok |
| `npm run lint` (eslint projects) | clean | clean |
| `git diff main --stat` für shared, weinliste, package.json, angular.json | leer | leer |

Zwischenstände: 202 (Commit 1), 212 (Commit 2/3), 239 (Commit 4/5). Alle Läufe stehen in den Commit-Messages.

## Red-Proof der Regression

Beleg: `.agents/tasks/editor-load-merge/red-proof.md`. Die neue `wine-editor.load-merge.spec.ts` lief gegen den ungefixten Code (Basis a2cd9a3): 13 Tests, 9 rot, 4 grün. Es gab keine Notwendigkeit für eine eigene Revert-Probe, der Beleg ist konkret.
- Symptom 2 (alter Stand bei A→B→A): `expected '5' to be '9.5'`.
- Symptom 1 (falscher Konflikt): `conflict-banner` sichtbar statt `null`.
- Laden/Cache: kein `aria-busy`, kein Warnhinweis bei fehlender Datei oder defektem JSON, Cache nicht ersetzt, `lastModified` nach Überschreiben veraltet.
- Die 4 grünen Tests sind Gegenproben (echter externer Konflikt, latest-wins, Formular nicht zurückgesetzt). Sie schützen vor Überkorrektur.

## Verhalten (Umsetzung der Nutzerwünsche)

- Öffnen: Cache-Stand sofort, Formular read-only (`aria-busy`) bis `readJson` fertig ist. Danach frischer Stand samt Zeitstempel. Datei fehlt oder JSON defekt: Formular wird durch Warnung ersetzt. Letzte Auswahl gewinnt.
- Speichern: Datei wird neu gelesen. Gleicher Zeitstempel: direkt speichern. Sonst Drei-Wege-Merge je Feld (`mergeThreeWay`). Nur auf der Platte geänderte Felder werden mit Hinweis übernommen. Nur Felder mit unterschiedlichen Änderungen auf beiden Seiten öffnen den Dialog (je Feld „meins" oder „Platte", ohne Vorauswahl). Verschwundene Datei beim Speichern: Warnung wie beim Öffnen.
- Cache: Jeder erfolgreiche Save (Auto-Save und Überschreiben) ersetzt den Cache-Eintrag (`applyEntryState`, dasselbe Objekt in `entries` und `wineData`). Der Formular-Effekt hängt am Pfad, daher kein Reset der Eingaben.
- Vertrag `editor-output` auf 1.1.0 (Konflikt nur bei Feldkonflikten, Dateiformat unverändert). Pipeline-Tasks vermerken keine Auswirkung.

## Detailentscheidungen: Flush bei Fehler

- `flush()` speichert ausstehende Debounce-Eingaben sofort beim Wechsel, beim Zerstören der Komponente und vor dem Archivieren.
- Schlägt der Flush fehl (Konflikt oder Fehler): Es wird nichts überschrieben. Ein schließbarer Hinweis (`flushNotice`) nennt die Datei.
- Speicherungen sind pro Eintrag in einer Promise-Kette serialisiert. Überlappende Feld-Saves bauen aufeinander auf, und der Zeitstempel stammt vom letzten abgeschlossenen Save. Saves eines alten Eintrags berühren den sichtbaren Status nicht.

## Befunde: archive / ImagePicker / link-image

- link-image, Anlegen, Archivieren rufen bereits `refresh()` und holen frische Zeitstempel. Dort war keine Änderung nötig (laut Analyse `editor-stale-conflict-analysis.md`).
- Archivieren: `archiveEntry()` ruft `flushPending()` und archiviert danach unabhängig vom Ergebnis. Bei fehlgeschlagenem Flush (Konflikt) gehen die ausstehenden Eingaben verloren, nur der Hinweis bleibt. Das ist ein Randfall und wurde bewusst nicht geändert, weil jede Änderung das sichtbare Verhalten betrifft (Archivieren abbrechen?). Offen für Entscheidung.
- Ein ausstehender Debounce schreibt nicht auf den alten Pfad (Auswahlwechsel und `archiveEntry` setzen zurück bzw. flushen). Das ist über den Effekt abgedeckt, aber ohne eigenen Test für den Archiv-Pfad.
- ImagePicker: Ich habe diesen Pfad nicht separat untersucht. Er ist weder im Diff noch in der Analyse als betroffen erwähnt. Das ist nicht verifiziert.

## Bekannte Grenzen

- Schreiben ist nicht atomar (kein Temp-Datei-plus-Rename in der File System Access API). Zwischen Re-Read und Write bleibt ein kleines Race-Fenster.
- iCloud-Konfliktkopien (`… 2.json`) werden nicht erkannt oder zusammengeführt. Der Editor sieht nur den Zeitstempel der Datei.
- Die Zeitstempelprüfung hat Dateisystem-Granularität. Zwei Schreiber im selben Zeitfenster können sich nicht unterscheiden.
- Maximal zwei gleichzeitige Schreiber sind die Annahme, daher keine Sperrlogik.

## Offene Punkte

- Entscheidung: Archivieren bei fehlgeschlagenem Flush abbrechen?
- Test für „kein Debounce-Write nach Archivieren" ergänzen (optional).
- Manueller Test im Browser mit echter File System Access API und iCloud-Ordner steht aus (nur Unit-Tests mit simulierter Platte).

## Nachtrag: Review-Fixes (Commit a3eb30c)
- Archivieren bricht ab, wenn der Flush scheitert (Eintrag bleibt, Hinweis "Archivieren abgebrochen"); Hinweistext ohne "erneut öffnen". Test ergänzt, Spec 17.21b angepasst.
- `takeFromDisk` überschreibt keine Felder mit wartendem Debounce-Timer (`EditorSaveService.hasPending`). Kein eigener Test (Timing-Szenario schwer abbildbar), Verhalten per Code-Review.
- Fokus: Konfliktdialog und Lesefehler-Warnung erhalten `tabindex="-1"` und Fokus beim Erscheinen (Test für Konfliktdialog). Dialog zeigt weiterhin Feldschlüssel, konsistent zum Formular (dort ebenfalls Schlüssel, kein Label-Mapping vorhanden).
- Verifikation: ng test editor 241 passed (vorher 239), ng build editor ok, eslint projects/editor sauber, diff main für shared/weinliste/package.json/angular.json leer. Python-Tests unverändert (122, nicht neu gelaufen, keine Python-Änderung).
