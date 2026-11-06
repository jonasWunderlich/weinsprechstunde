---
inclusion: always
---
# Verträge zwischen Domänen

Details stehen in den Vertragsdateien, hier nur der Index. Vollständiger Index: [contracts-index](../specs/contracts/contracts-index.md).

| Vertrag | Produzent | Konsumenten |
|---|---|---|
| [import-format](../specs/contracts/import-format.md) | Quelle/Editor | editor, pipeline |
| [editor-output](../specs/contracts/editor-output.md) | editor | pipeline |
| [export-format](../specs/contracts/export-format.md) | pipeline | weinliste, deploy-ftp |
| [shared-api](../specs/contracts/shared-api.md) | shared | editor, weinliste |
| [deploy-input](../specs/contracts/deploy-input.md) | deploy-ftp | deploy-ftp (Erwartung an pipeline/build) |
| [build-output](../specs/contracts/build-output.md) | editor, weinliste | deploy-ftp (editor/weinliste laden ihn nicht; Änderung an Befehl/Ausgabepfad = Versionsanhebung und Anpassung von deploy-ftp) |

## Regeln
- Shared: Ändert sich `frontend/projects/shared/**` nicht, kann editor nicht weinliste beeinflussen und umgekehrt. Dann nur das eigene Projekt prüfen, bauen und testen.
- Änderungen an `frontend/package.json`, `frontend/angular.json`, `frontend/tsconfig*.json` und globalen Styles gelten als Shared-Änderung (beide Apps prüfen).
- Vertragsänderung = Pflichtschritt in den Tasks beider Seiten (Produzent und Konsumenten), inkl. Versionsanhebung und Changelog im Vertrag.
- Ändert sich ein Vertrag nicht, müssen Domänen der Gegenseite nicht angepasst oder geprüft werden.
