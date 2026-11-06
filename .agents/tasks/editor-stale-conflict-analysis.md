# Analyse: Falscher Konflikt und veralteter Stand beim erneuten Öffnen eines Weins (Editor)

Nur gelesen, nichts geändert. Pfade relativ zu `frontend/projects/editor/src/app/` (kurz `app/`). Ausgeführt: `npx ng test editor --watch=false` → 19 Dateien, 187 Tests grün (Ist-Zustand; kein Test deckt den Fehler ab). `git status` zeigt keine Änderungen an Editor-Code.

## 1. Kurzantwort

Beide Symptome haben dieselbe Ursache, und sie ist nicht iCloud: Der Auto-Save aktualisiert nur den `EditorSaveService` (Zeitstempel und Objekt, pro Eintrag lokal), aber nicht den Scan-Cache im `EditorStateService` (`_entries`). Auch ein Refresh nach dem Speichern findet nicht statt. Beim Wiederöffnen liest der Editor Wein und `lastModified` aus diesem veralteten Cache.

- Symptom 2 (alter Stand): Das Formular wird aus dem Cache-Objekt vom letzten Scan befüllt.
- Symptom 1 (Konflikt): Der veraltete Cache-Zeitstempel wird als „Ladewert" in `init` übernommen. Die Datei auf der Platte hat seit dem eigenen Schreiben einen neueren `lastModified`. Der erste Auto-Save nach dem Wiederöffnen wirft deshalb `ConflictError`.

Das ist ein Logikfehler und reproduzierbar ohne Cloud-Sync. Es widerspricht Req 17.6 („Nach eigener Aktion (… Speichern) wird die Liste automatisch aktualisiert"). Gut lösbar (Aufwand klein bis mittel). Der Vertrag editor-output braucht dafür keine Änderung, wenn die Konfliktregel unverändert bleibt.

Zusatzbefund (Datenverlust-Risiko): Bestätigt der User in dieser Lage „Überschreiben", schreibt `confirmOverwrite` den veralteten Formularstand zurück. Die Änderungen der ersten Runde gehen dann verloren (siehe 3.4).

## 2. Beleg: Lade- und Speicherpfad (Frage a)

- Scan: `FileSystemAccessService.scan()` → `walk()` → `readWineEntry()` liest `file.text()` und merkt `lastModified: file.lastModified` im `WineEntry` (`app/services/file-system-access.service.ts`, `readWineEntry`, Zeile ~341).
- `readJson()` (Zeile ~382) liefert ebenfalls `lastModified`, wird aber im Produktionscode von keiner Komponente aufgerufen. Gefunden nur in Tests (Grep über `readJson`: kein Aufrufer in `wine-editor.ts`/`editor-state.service.ts`).
- Öffnen eines Weins: `WineEditorComponent` hat im Konstruktor einen `effect`. Er ruft `loadEntry(item)` auf, und das ruft `this.save.init(item.entry.path, wine, item.entry.lastModified, schema)` (`app/components/wine-editor/wine-editor.ts`, `loadEntry`, ca. Zeile 181). `item` kommt aus `state.selectedItem()`, `wine` und `lastModified` also aus dem Scan-Cache.
- `EditorSaveService.init` (`app/services/editor-save.service.ts:68-76`) setzt `current = {...wine}`, `lastModified`, löscht Timer (`clearTimers()`).
- Speichern: `saveFields` (Zeile ~104-130) ruft `fsa.writeJson(path, next, this.lastModified)`. `writeJson` (`file-system-access.service.ts`, ca. Zeile 396-408) liest `handle.getFile()`, vergleicht `current.lastModified !== expectedLastModified` und wirft sonst `ConflictError`. Danach schreibt es, liest erneut `getFile()` und gibt den neuen `lastModified` zurück.
- Nach eigenem erfolgreichen Speichern: `this.current = next; this.lastModified = newLastModified;` (`editor-save.service.ts:113-116`). Der Zeitstempel wird also nur innerhalb derselben `EditorSaveService`-Instanz und derselben `init`-Phase aktualisiert (Test „nach erfolgreichem Save gilt kein erneuter Konflikt", `editor-save.service.spec.ts:126-134`). Dieser Pfad ist korrekt.
- Der `EditorSaveService` ist `providers: [EditorSaveService]` der Komponente (`wine-editor.ts:67`). Es gibt eine Instanz pro Komponente. Sie wird bei jedem Eintragswechsel per `init` neu belegt. Der neue Zeitstempel geht dabei verloren, er wird nirgends zurückgemeldet.

## 3. Beleg: Datenquelle beim Wiederauswählen (Frage b)

### 3.1 Cache
`EditorStateService` (`app/services/editor-state.service.ts`):
- `_entries` / `_images` werden nur in `refresh()` gesetzt (Zeile ~224-246), also nach vollständigem `fsa.scan()`.
- `selectedItem` (Zeile ~100-111) löst die Auswahl aus `_entries()` auf: `toCreatedListItem(entry)` (`app/models/editor-list.ts:31-43`) reicht `entry.wine` und `entry.lastModified` unverändert durch.
- `select()` (Zeile ~190-215) liest nichts von der Platte, es setzt nur `_selectedId`.

### 3.2 Wird der Cache nach Auto-Save aktualisiert?
Nein. `EditorSaveService` kennt den `EditorStateService` nicht (nur `FileSystemAccessService`), `wine-editor.ts` ruft nach `scheduleFieldSave`/`saveField` weder `state.refresh()` noch eine andere Aktualisierung. Grep über `refresh(` im Editor: Aufrufe nur in `editor-shell.ts` (Start, Freigabe, Button), und in `editor-state.service.ts` nach Archivieren (Zeilen ~280/298), `commitDraft` (~326) und `linkDraftToExisting` (~353/358). Der Cache wird weder aktualisiert noch verworfen.

### 3.3 Spec vs. Ist
- Req 17.6 nennt „Speichern" ausdrücklich als Auslöser für automatische Listenaktualisierung (`.kiro/specs/editor/requirements.md:35`). Design Zeile 46: „automatischer Refresh nach eigenen Aktionen".
- Umgesetzt ist das für Anlegen, Archivieren, Bild-Verknüpfen, nicht für Auto-Save. Dass dies bewusst so entschieden wurde, ist nicht belegt (`tasks.md` und Design erwähnen es nicht). Der Docstring in `file-system-access.service.ts:233` behauptet sogar „Nach jeder Änderung (… Speichern) löst der EditorStateService einen erneuten scan() aus". Das stimmt im Code nicht.
- Folge: auch die Liste (Name, Sortierung, Filter, Auto-Vervollständigung über `EditorWineDataService.wines`) zeigt nach Auto-Save den alten Stand.

### 3.4 Ablauf Schritt für Schritt
1. Editor startet, `refresh()` → `_entries` enthält Wein W mit `lastModified = T0` und Objekt W0.
2. User wählt W: `init(path, W0, T0)`. Formular zeigt W0.
3. User ändert Feld A (z. B. Preis). Nach 500 ms: `writeJson(path, W1, T0)`. Platte hat T0 → ok. Neuer `lastModified = T1`, Service merkt T1 (`this.lastModified = T1`). Status „Erfolg". Der Cache bleibt bei (W0, T0).
4. User wählt einen anderen Wein. `selectedItem` wechselt, Effekt läuft, `init` für den anderen Wein, T1 ist verloren.
5. User wählt W wieder. `selectedItem` → `toCreatedListItem(entry)` mit (W0, T0). `init(path, W0, T0)`. Formular zeigt W0, Symptom 2: A hat den alten Wert, obwohl die Platte W1 enthält.
6. User ändert Feld B. Nach 500 ms: `writeJson(path, W0+B, T0)`. Platte hat T1 ≠ T0 → `ConflictError` → Banner mit dem gemeldeten Text (`wine-editor.html:104-117`). Symptom 1.
7. Klickt der User „Überschreiben": `confirmOverwrite(currentFieldValues())` (`wine-editor.ts` ca. 495-510) schreibt alle Schemafelder aus dem veralteten Formular (`currentFieldValues` iteriert über alle `fields()`), `current` ist W0. Die Änderung A aus Schritt 3 wird zurückgesetzt, ohne Warnung (stilles Verlust-Risiko). Schema-fremde Felder stammen ebenfalls aus W0.

Der Fehler tritt schon beim ersten Wiederöffnen auf, unabhängig von iCloud und von der Zeit („wenige Minuten" ist nur ein Hinweis darauf, dass der User zwischendurch einen anderen Wein geöffnet hat). Er tritt auch nach einem Wechsel A → B → A auf. Ohne Wechsel (Wein bleibt offen) tritt er nicht auf.

## 4. Die iCloud-These (Frage c)

- Der Code liest den neuen Zeitstempel unmittelbar nach `createWritable().close()` per `getFile()` (`writeJson`, ca. Zeile 405-407). Ändert iCloud die mtime danach (z. B. durch Download-/Upload-Metadatenupdate), wäre der gemerkte Wert T1 veraltet und das nächste Speichern derselben offenen Instanz würde einen Konflikt melden. Das ist plausibel, aber nicht belegt (im Code und in den Specs gibt es keine Messung). Siehe auch Design Zeile 65 und 121: Die App geht ausdrücklich davon aus, dass Cloud-Sync-Konflikte nicht ihre Aufgabe sind, `lastModified` deckt nur „lokale Änderung seit dem Laden" ab.
- Die gemeldeten Symptome erklärt die These nicht: Symptom 2 (alter Stand angezeigt) ist mit mtime-Änderung nicht erklärbar. Der Ablauf in 3.4 reicht vollständig aus und ist deterministisch.
- Die These bleibt als zweites, getrenntes Risiko: Nach der Behebung der Cache-Ursache kann iCloud weiterhin Zeitstempel nachträglich verändern, dann bleibt ein Rest an Fehlalarmen. Dagegen hilft nur eine Inhalts- oder Toleranzprüfung (Variante C/D unten).
- Kurzer Praxistest zur Klärung (nicht ausgeführt, nicht aus dem Code ersichtlich): Wein ändern, im Editor offen lassen, im Dateisystem (`stat`) die mtime zweimal im Abstand einiger Minuten ablesen. Ändert sie sich, ist iCloud beteiligt.

## 5. Lösungsvarianten (Frage d)

### A. Cache nach Auto-Save gezielt aktualisieren (empfohlen, Kern)
Nach erfolgreichem `writeJson` im State den Eintrag ersetzen: neues `WineEntry` mit `wine = next`, `lastModified = newLastModified`, und `wineData.wines` mit demselben Objekt befüllen.
- Umsetzung: `EditorStateService.applySaved(path, wine, lastModified)`, aufgerufen vom `WineEditorComponent` (oder per Callback/Event aus `EditorSaveService`; der Save-Service bleibt sonst frei vom State). Muss auch den `confirmOverwrite`-Pfad abdecken.
- Wirkung: Symptom 1 und 2 weg, Liste/Filter/Sortierung aktualisieren sich (Req 17.6 erfüllt), kein zusätzlicher Verzeichnis-Scan.
- Kritisch: `buildEditorList` verbindet `filteredWines` und Einträge über Objektidentität (`byWine: Map<Wine, WineEntry>`, `editor-list.ts` ca. Zeile 123-130). Das neue `wine`-Objekt muss in `_entries` und in `wineData.wines` dasselbe sein, sonst verschwindet der Eintrag aus der Liste.
- Kritisch: Der `effect` in `WineEditorComponent` hängt an `created()` → `selectedItem()` und läuft nach jeder Cache-Änderung erneut. `loadEntry` setzt dann `values` neu und `init` löscht alle Debounce-Timer. Mit Variante A würde der Effekt nach jedem Speichern das Formular zurücksetzen, laufende Eingaben in anderen Feldern gehen verloren (Cursorsprung, gelöschter Timer). Deshalb Effekt auf Pfadwechsel begrenzen: nur neu initialisieren, wenn sich `entry.path` ändert (oder die ausgewählte ID), und der Cache-Update-Pfad darf `values` nicht anfassen.

### B. Beim Öffnen frisch von Platte lesen
`select()` bzw. `loadEntry` lädt per `fsa.readJson` (existiert bereits, liefert `lastModified`) und initialisiert daraus.
- Vorteil: auch Änderungen außerhalb des Editors (iCloud-Sync von anderem Gerät) werden beim Öffnen sichtbar; der Konflikt-Basiswert ist garantiert aktuell.
- Nachteil: asynchron (Zwischenzustand/Flackern, Race bei schnellem Weiterklicken über Pfeiltasten, `selectRelative`), Liste/Filter bleiben ohne A trotzdem veraltet. Fehlerfälle (Datei weg, JSON defekt) müssen behandelt werden.
- Als Ergänzung zu A sinnvoll, als Ersatz nicht.

### C. Inhaltsvergleich statt reiner Zeitstempelprüfung
Bei Abweichung des Zeitstempels die Datei lesen und mit dem zuletzt selbst geschriebenen Text (bzw. dem geladenen Text) vergleichen. Sind sie identisch, nur den Zeitstempel übernehmen, kein Konflikt. Nur bei abweichendem Inhalt `ConflictError`.
- Fängt iCloud-Touches (mtime ändert sich, Inhalt nicht) ab. Echte externe Änderungen bleiben erkennbar.
- Vertragswirkung: Editor-output-Zeile „Konfliktschutz: Schreiben nur wenn `File.lastModified` dem Ladewert entspricht" wird gelockert. Das ist eine Verhaltens-/Textänderung am Vertrag → Minor-Anhebung (1.1.0) mit Changelog; Req 17.25 („Best-effort-Konflikterkennung über `File.lastModified`") und Property 17 müssen um „und Inhalt weicht ab" ergänzt werden. Pipeline (Konsument) ist nicht betroffen: Dateiformat und Schreibregeln (`JSON.stringify(wine, null, 2)`) bleiben gleich, nur die Bedingung für Überschreibungswarnungen ändert sich.
- Mehr Aufwand: der Text der geladenen Datei muss mitgeführt werden (`readWineEntry` hat ihn, `WineEntry` trägt ihn nicht), oder Vergleich geparstes Objekt gegen `current` per Deep-Equal.

### D. Toleranzfenster (z. B. ±2 s)
Verworfen: Cloud-Sync kann beliebig später eingreifen; ein Fenster macht echte, schnelle externe Änderungen unsichtbar und verletzt „kein stilles Überschreiben" (Req 17.25). Außerdem kein Beleg, dass Fehlalarme in einem festen Fenster liegen. Zeitstempel-Auflösung (APFS ns, `lastModified` ms gerundet) ist bei Gleichheitsvergleich unkritisch, solange beide Werte aus `getFile()` stammen.

### E. Refresh (voller Scan) nach jedem Auto-Save
Technisch einfach, aber `scan()` liest alle JSONs und Bild-EXIF (`resolveImageDate`) und leert den Thumbnail-Cache (`clearThumbnailCache`). Das wäre nach jedem Tastendruck-Debounce teuer, und die Effekt-Problematik aus A (Formular-Reset) trifft voll zu. Nicht empfohlen.

### Empfehlung
A (gezielter Cache-Update, mit Effekt auf Pfadwechsel begrenzt) als Pflicht. Dazu optional C als Absicherung gegen iCloud-mtime-Änderungen, falls der Praxistest (Abschnitt 4) das bestätigt. B nur, wenn gewünscht ist, dass beim Öffnen Änderungen von anderen Geräten sichtbar sind. Mit A allein bleibt der Vertrag editor-output 1.0.0 unverändert (Verhalten der Datei-Schreibregeln unverändert, nur der Editor erfüllt Req 17.6 jetzt wirklich).

Zusätzlich sollte `confirmOverwrite` sicherer werden: vor dem Überschreiben die Platte neu lesen, damit `current` (Basis für schema-fremde Felder) und der angezeigte Stand zusammenpassen, oder dem User den Unterschied zeigen. Das ist unabhängig vom Hauptfehler; eine Änderung am Verhalten ist nur nötig, wenn das gewünscht ist.

## 6. Auswirkungen auf Vertrag, Properties, Requirements (Frage d, Fortsetzung)

| Thema | Variante A | Variante C |
|---|---|---|
| Vertrag editor-output (aktuell 1.0.0) | keine Änderung nötig | Minor-Anhebung auf 1.1.0, Changelog, Konfliktschutz-Zeile anpassen |
| Property 17 (Design Z. 90-91) | bleibt gültig; offener Task in `tasks.md` Zeile 5 (Property-Test noch nicht geschrieben) | Formulierung erweitern („…und der Dateiinhalt vom erwarteten abweicht") |
| Req 17.25 | unverändert | Zusatz „best effort … Inhalt" |
| Req 17.6 | wird erst jetzt für „Speichern" erfüllt | wie A |
| Pipeline (Konsument) | keine Auswirkung (Format unverändert) | keine Auswirkung |

Bei A ändern sich nur Editor-interne Dateien (`editor-state.service.ts`, `wine-editor.ts`, ggf. `editor-save.service.ts`) und der Docstring in `file-system-access.service.ts:233`. Shared bleibt unberührt, also nur das Editor-Projekt bauen und testen.

## 7. Fallstricke (Frage e)

1. Effekt-Neustart: Jede Änderung an `_entries` erzeugt ein neues `selectedItem`/`created`-Objekt und startet den Effekt in `WineEditorComponent` neu → Formular-Reset und `clearTimers()` mitten in der Eingabe. Pflicht: Effekt nur bei Pfadwechsel neu initialisieren (Variante A).
2. Race Debounce vs. Zeitstempel: Debounce ist pro Feld (`timers: Map`), mehrere Felder können fast gleichzeitig `saveField` starten. `saveFields` ist nicht serialisiert: zwei überlappende `writeJson` mit demselben erwarteten Wert → das zweite sieht den neuen mtime des ersten und meldet Konflikt, oder (bei umgekehrter Reihenfolge der Abschlüsse) überschreibt `this.lastModified` den neueren Wert mit dem älteren. Zusätzlich liest jede Instanz `this.current` beim Start, nicht beim Abschluss (`current = next` verwirft Änderungen des parallelen Saves, weil beide von demselben `current` ausgehen: Feld A und Feld B parallel → der zweite Schreiber enthält A nicht). Ob das in der Praxis auftritt, ist nicht belegt; es sollte aber mit einer Warteschlange (Promise-Kette pro Instanz) gelöst werden, bevor Variante A weitere Aufrufer hinzufügt.
3. Eintragswechsel vor Ablauf der 500 ms: `init` ruft `clearTimers()`, ausstehende Eingaben gehen still verloren (kein Flush). Bestehendes Verhalten, im Code belegt (`editor-save.service.ts:69-70`); hier relevant, weil es vergleichbar „verlorene Änderungen" erzeugt. Mit der Korrektur sollte auch ein Flush beim Wechsel erwogen werden.
4. Echte externe Änderungen müssen erkannt bleiben: Der Cache-Update darf den Zeitstempel nur aus dem Rückgabewert von `writeJson` nehmen (also dem Wert, den die eigene Schreiboperation erzeugt hat), nie aus „now". Nicht den Konfliktvergleich abschalten oder erst beim Öffnen großzügig machen.
5. Mehrere Tabs/Geräte: Zweiter Tab hat einen eigenen Cache; Änderungen dort erzeugen beim ersten Save im ersten Tab zu Recht einen Konflikt. Gerade deshalb Option B (frisch lesen beim Öffnen) oder der manuelle Aktualisieren-Button (Req 17.7).
6. iCloud-Konfliktkopien (z. B. „a 2.json"): würden als zusätzliche Weine/Dateien erscheinen; Design Zeile 121: nicht Aufgabe der App. Weiter so lassen, aber im Handbuch/Hinweis erwähnen.
7. Konflikt und lokale Eingaben: Bei `ConflictError` behält der Editor die Eingaben im Formular (Service setzt nur Status). Das muss beim Cache-Update erhalten bleiben: bei Konflikt darf der Cache nicht überschrieben und das Formular nicht zurückgesetzt werden. „Abbrechen" (`dismissConflict`) lässt Formular und Platte auseinanderlaufen; ein Hinweis oder Neu-Laden wäre sinnvoll (kein Muss).
8. Unvollständige Weine / Entwürfe: Entwürfe haben keine JSON (`loadDraft` ruft `save.init` nicht auf), betroffen sind sie nicht. Unvollständige Weine (leerer `name`) sind normale `created`-Einträge und brauchen dieselbe Cache-Aktualisierung; `incomplete` wird in `toCreatedListItem` aus `wine.name` berechnet und stimmt nach Update automatisch.
9. link-image, Anlegen, Archivieren: Diese Pfade rufen schon `refresh()` und holen frische Zeitstempel; keine zusätzliche Arbeit. Prüfen, dass ein ausstehender Auto-Save-Debounce nicht nach einem Archivieren/Verschieben noch auf den alten Pfad schreibt (Auswahlwechsel ruft `clearTimers()`, `archiveEntry` setzt die Auswahl zurück → über den Effekt abgedeckt, aber nicht per Test belegt).
10. Zeitstempel-Auflösung/Rundung: `lastModified` ist ganzzahlig (ms). Vergleich per `!==` ist konsistent, solange beide Werte aus `File.lastModified` stammen. Ein Test mit Fake-FS, der Zeitstempel hochzählt (wie `FakeFsa` in `editor-save.service.spec.ts`), spiegelt das gut.
11. Objektidentität in der Liste (siehe Variante A): `wineData.wines` und `_entries[i].wine` müssen dasselbe Objekt sein.
12. `confirmOverwrite` nach Fehlalarm: siehe 3.4 Schritt 7, kann echte Änderungen zurücksetzen.

## 8. Vorhandene Tests und Lücken (Frage f)

Vorhanden (alle grün):
- `services/editor-save.service.spec.ts`: Debounce, Fehlerstatus, Konflikt bei geändertem Zeitstempel, `confirmOverwrite`, „kein erneuter Konflikt nach erfolgreichem Save" (nur innerhalb derselben Instanz, ohne Neu-`init`).
- `services/file-system-access.service.spec.ts`: `readJson` merkt `lastModified`; `writeJson` wirft `ConflictError` bei abweichendem Wert, schreibt bei passendem Wert.
- `services/editor-state.service.spec.ts`: Refresh, Auswahl, Archivieren/Anlegen mit Refresh. Kein Test für Cache-Update nach Auto-Save.
- `components/wine-editor/wine-editor.spec.ts`: `FakeFsa.writeJson` ignoriert den erwarteten Zeitstempel und gibt immer 1 zurück, daher kann dieser Spec den Fehler nicht zeigen.
- Property 17 (fast-check) ist laut `.kiro/specs/editor/tasks.md` Zeile 5 noch offen (`- [ ] 1.`). Es existiert kein Property-Test dazu.

Neu nötig (Aufwand insgesamt klein bis mittel):
1. `editor-state.service.spec.ts`: Nach `applySaved(path, wine, ts)` liefern `selectedItem()`, `listItems()` und `wines()` das neue Objekt, `entry.lastModified === ts`, Identität stimmt, Reihenfolge/Filter korrekt (klein).
2. `wine-editor.spec.ts` (Integration, kleiner bis mittlerer Aufwand): `FakeFsa` mit simulierter Platte (Inhalt plus hochzählendem mtime, `writeJson` mit Konfliktprüfung): Wein A öffnen → Feld ändern → 500 ms (Fake-Timer) → anderen Wein wählen → A erneut wählen → Formular zeigt geänderten Wert, nächste Änderung führt nicht zu `conflict` (Regressionstest für beide Symptome).
3. Dito: Echte externe Änderung (Fake-mtime von außen erhöhen) nach dem Wiederöffnen löst weiterhin `conflict` aus (Schutz vor Überkorrektur).
4. Dito: Eingabe in Feld B während des Cache-Updates von Feld A wird nicht vom Effekt zurückgesetzt (Fallstrick 1).
5. `editor-save.service.spec.ts`: überlappende Saves (zwei Felder fast gleichzeitig) führen zu `current` mit beiden Änderungen und letztem Zeitstempel (Fallstrick 2; nur falls die Warteschlange eingeführt wird).
6. Property 17 als fast-check nachziehen (Task offen), erweitert um „nach eigenem Schreiben + Neuöffnen kein Konflikt".
7. Bei Variante C: Tests „gleicher Inhalt, anderer mtime → kein Konflikt" und „anderer Inhalt → Konflikt" (klein bis mittel).

## 9. Reproduktion

Im Editor (Chromium, freigegebener Ordner):
1. Ordner freigeben, Wein A auswählen, ein Feld ändern (z. B. Preis), „Gespeichert" abwarten.
2. Anderen Wein B auswählen, danach A erneut: das Formular zeigt den alten Preis (Symptom 2).
3. Anderes Feld in A ändern: nach ca. 500 ms erscheint der Konfliktbanner (Symptom 1). Mit „Aktualisieren" (Req 17.7, löst `refresh()` aus) und erneutem Öffnen verschwindet der Fehler, ein Hinweis auf die Cache-Ursache.

Unit-Test-Entwurf (Prosa, nichts committet), in `wine-editor.spec.ts`-Stil mit gemocktem `FileSystemAccessService`:
- Fake mit „Platte": Map path → {wine, mtime}. `scan()` liefert `WineEntry` aus der Platte. `writeJson(path, wine, expected)` wirft `ConflictError`, wenn `expected !== mtime`, sonst Platte aktualisieren, `mtime++`, neuen Wert zurückgeben.
- `render` mit zwei Einträgen (a.json, b.json), `state.select` auf A, `fixture.detectChanges()`.
- Feld `price` im Input per `input`-Event auf „9,5" setzen, `vi.advanceTimersByTime(500)` und `await` (Fake-Timer wie in `editor-save.service.spec.ts`).
- Prüfen: Platte enthält `price: 9.5`.
- `state.select(B)`, `detectChanges`, `state.select(A)`, `detectChanges`.
- Erwartung (heute rot): Feldwert `price` ist „9.5". Dann Feld `year` ändern, 500 ms, Erwartung: `saveState().status === 'success'` und kein `[data-testid="conflict-banner"]`. Heute: Status `conflict`, Banner sichtbar.
- Gegenprobe: Zwischen den Schritten `mtime` der Platte von außen erhöhen → Banner muss erscheinen.

## 10. Einschätzung (Frage g)

- Lösbar: Ja. Kern (Variante A plus Effekt-Begrenzung) ist ein überschaubarer Eingriff in drei Editor-Dateien und Tests; kein Vertrags- und kein Pipeline-Eingriff.
- Risiko hoch: Effekt-Reset des Formulars während der Eingabe (Fallstrick 1) und überlappende Saves (Fallstrick 2); beide ohne neue Tests leicht zu übersehen.
- Risiko mittel: iCloud kann weiterhin nachträglich mtime ändern (nicht belegt). Dann bleiben vereinzelt echte „Fehlalarme", die nur Variante C beseitigt, mit Vertrags-Minor-Anhebung.
- Risiko niedrig: Fehlende Wirksamkeit bei mehreren Tabs/Geräten; hier greift weiterhin der Konfliktschutz, wie gewünscht.
- Nicht aus dem Code ersichtlich: ob iCloud den mtime nach dem Schreiben ändert; ob die Auslassung des Auto-Save-Refreshs bewusst war (Spec und Docstring sagen das Gegenteil).
