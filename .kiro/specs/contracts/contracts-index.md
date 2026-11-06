# Verträge zwischen Domänen

| Vertrag | Version | Produzent | Konsumenten |
|---|---|---|---|
| [import-format](import-format.md) | 1.0.0 | Quelle/Editor | editor, pipeline |
| [editor-output](editor-output.md) | 1.0.0 | editor | pipeline |
| [export-format](export-format.md) | 1.1.0 | pipeline | weinliste, deploy-ftp |
| [shared-api](shared-api.md) | 1.0.0 | shared | editor, weinliste |
| [deploy-input](deploy-input.md) | 1.2.0 | deploy-ftp | deploy-ftp (Erwartung an pipeline/build) |
| [build-output](build-output.md) | 1.1.1 | editor, weinliste | deploy-ftp |

## Verträge je Domäne

- editor: import-format, editor-output, shared-api
- weinliste: export-format, shared-api
- pipeline: import-format, editor-output, export-format
- deploy-ftp: deploy-input, build-output

Maßgeblich für Datenstruktur: `wine-schema.json` (Repo-Root). Verträge verlinken darauf, ohne zu duplizieren.

## Regeln

- Vertragsänderung = Pflichtschritt in den Tasks beider Seiten (Produzent und alle Konsumenten) plus Versionsanhebung und Changelog-Eintrag im Vertrag.
- Ändert sich ein Vertrag nicht, müssen die Domänen auf der anderen Seite nicht geprüft oder angepasst werden.
- Shared-Regel: Ändert sich `frontend/projects/shared/**` nicht, kann editor nicht weinliste beeinflussen und umgekehrt. Dann nur das eigene Projekt prüfen, bauen und testen.
- Änderungen an `frontend/package.json`, `frontend/angular.json`, `frontend/tsconfig*.json` und globalen Styles zählen als Shared-Änderung (beide Apps prüfen).

## Golden Fixtures

- `fixtures/import/` → prepare + export → `fixtures/export/wines.json`.
- pipeline: `scripts/tests/pipeline/test_contract_fixtures.py`
- editor: `frontend/projects/editor/src/app/models/contract-fixture.spec.ts`
- weinliste: `frontend/projects/weinliste/src/app/services/contract-fixture.spec.ts`
