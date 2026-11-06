# Tasks: weinliste

Stand: Implementierung abgeschlossen (Historie im Archiv). Offene, optionale Test-Aufgaben:

- [ ] 1. Unit-Tests Pfeiltasten-Navigation: nächster/vorheriger Wein mit Modulo-Wrap über `filteredWines`, erster/letzter Wein bei geschlossenem Dialog, Guards (Eingabefeld, Modifier), `i`/`l` bei offenem Dialog blockiert. _Req 10.4, 10.6–10.12_
- [ ] 2. Unit-Tests Escape-Handling: schließt den Dialog, kein Effekt bei geschlossenem Dialog, Guards (Eingabefeld, Modifier). _Req 10.4, 10.6, 10.13_
- [ ] 3. Unit-Tests: App bleibt über die geteilte Library lauffähig; `applyFiltersAndSort` aus `@weinsprechstunde/shared` liefert dieselben Ergebnisse, Properties 10, 11, 14 laufen gegen die Library. _Req 15.10, Property 10/11/14_
- [ ] 4. Vertragsprüfung: `contract-fixture.spec.ts` (neu, noch nicht committet) einmal ausführen und grün bestätigen.
