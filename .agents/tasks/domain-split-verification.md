# Verifikation Domänen-Split (Iteration 1, ohne Commit)

## Ausgeführt
| Prüfung | Ergebnis |
|---|---|
| `.venv/bin/python -m pytest tests -q` (scripts/, und im Ordner scripts/tests) | Vorher (ohne neue Tests): 101 passed. Nachher: 102 passed (neu: test_contract_fixtures) |
| `npm test -- --watch=false` (frontend) | 19 Dateien / 187 Tests grün (weinliste/editor-Projekt) + shared 3 Dateien / 36 Tests; identisch zu vorher |
| `npm run build` | OK |
| `npm run build:editor` | OK |
| `npm run lint` (neu) | OK, 0 Verstöße; Negativtest mit temporären Cross-Imports in beide Richtungen lieferte je 1 Fehler, Dateien wieder entfernt |

## Änderungen in diesem Schritt
- `scripts/tests/test_contract_fixtures.py`: Der Test schlug fehl, wenn pytest nicht aus dem Repo-Root lief (`wine-schema.json` relativ). Er nutzt jetzt den absoluten Schema-Pfad. Anwendungslogik unverändert.
- ESLint ergänzt: `frontend/eslint.config.mjs`, Skript `lint`, devDependencies `eslint@10.14.0`, `typescript-eslint@8.72.1` (exakt), `package-lock.json` aktualisiert. Regel `no-restricted-imports` verbietet Imports zwischen `projects/editor` und `projects/weinliste` (relativ und über `projects/<x>`-Pfade); gemeinsamer Code nur über `@weinsprechstunde/shared`.
- `dist/` bestand bereits (gitignored), keine Artefakte zu entfernen.

## Beobachtungen
- Beim ersten Build nach `npm install` schlug der weinliste-Build mit `@angular/material/dialog` fehl. Das Paket steht nicht in `package.json`; `nav.ts` (uncommitted) importierte es und lief vorher nur über ein zuvor installiertes, nicht deklariertes Paket. Zwischenzeitlich wurde der Import in `nav.ts` entfernt (nicht von mir), danach Build OK.
- `weinsprechstunde.config.json` hat uncommittete lokale Änderungen (nicht von mir). Der Vertrag deploy-input nennt diese Werte (`remote_path` `/`, `remote_editor_path` `/edit`) als Ist-Zustand; im Commit stehen `/wine_app`, `/wine_app/editor`.

## Checks
(a) Mapping: Req 1–20 und Property 1–28 in den neuen Dateien auffindbar (Req 18 in contracts/import-format.md „Schema-Regeln (Req 18)", Property 22 existiert im Original nicht). 
(b) Front-Matter aller 8 Steering-Dateien gültig; Always-Dateien zusammen 2.436 Bytes (< 6 KB).
(c) Domain-Steering verlinkt nur eigene Verträge/Specs; Specs und Verträge enthalten keine Links auf Specs anderer Domänen (Treffer auf `_archive` betreffen den Import-Ordner).
(d) Verträge gegen `wine-schema.json`, `weinimport.py` (`_resolve_dist_dir`, Deploy-Reihenfolge, Schema-Typen), Makefile, `angular.json` und `deploy.yml` geprüft: keine Abweichung gefunden.
