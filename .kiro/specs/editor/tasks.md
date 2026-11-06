# Tasks: editor

Stand: Implementierung abgeschlossen (Historie im Archiv).
- [x] Feldweiser Drei-Wege-Merge beim Speichern mit Konfliktdialog je Feld (Req 17.25, editor-output 1.1.0).
- [x] Öffnen mit frischem Lesen, Cache-Update nach Speichern, Warteschlange und Flush (Req 17.6, 17.9a–c, 17.21a–b).

Offene, optionale Property-Tests (fast-check, `FileSystemAccessService` gemockt):

- [x] 1. Property 17: feldweiser Merge bei abweichendem `File.lastModified`. _Req 17.25_
- [ ] 2. Property 27: Editor-Typkonvertierung beim Auto-Save. _Req 17.22_
- [ ] 3. Property 28: Schema-fremde Felder bleiben erhalten (Vertrag editor-output). _Req 17.27_
- [ ] 4. Property 24: Anlegen eines Entwurfs: Ort, Name, Feldbelegung. _Req 17.35, 17.36, 17.40_
- [ ] 5. Property 25: genau eine JSON pro Wein nach link-image. _Req 17.41–17.43_
- [ ] 6. Vertragsprüfung: `contract-fixture.spec.ts` (neu, noch nicht committet) einmal ausführen und grün bestätigen.
