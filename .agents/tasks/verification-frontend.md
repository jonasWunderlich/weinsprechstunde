# Verifikationsnotiz — Angular-Frontend „Weinsprechstunde" (Tasks 15–22)

Diese Notiz hält die geforderten Verifikationsnachweise fest (Finding 1 aus
`review-frontend.json`, Verdict CHANGES_REQUESTED). Alle Befehle wurden im Ordner
`frontend/` ausgeführt.

Umgebung: macOS (darwin), zsh. Testrunner: `@angular/build:unit-test` (Vitest 4 + jsdom).
Es wird **kein** Headless-Browser benötigt; die Tests laufen in der jsdom-Umgebung.

## 1. `npm install`

```
up to date, audited 314 packages in 1s
found 0 vulnerabilities
```
Ergebnis: erfolgreich (Exit 0).

## 2. `npx ng build`

Hinweis: Build wurde bewusst **ohne** `npm run build` ausgeführt, damit der `prebuild`-Schritt
(`python ../scripts/weinimport.py prepare|export|image-export`) die bereits finalisierte
`wines.json` nicht neu generiert. Die `prebuild`-Scripts in `package.json` bleiben unverändert
vorhanden.

```
Initial chunk files | Names         |  Raw size | Estimated transfer size
main-LAYDR6GU.js    | main          | 281.94 kB |                74.27 kB
styles-52MLHNUD.css | styles        | 815 bytes |               815 bytes
                    | Initial total | 282.75 kB |                75.08 kB
Application bundle generation complete. [3.950 seconds]
Output location: .../frontend/dist/ng-weinsprechstunde
```
Ergebnis: fehlerfrei (Exit 0), valides `dist/ng-weinsprechstunde/` erzeugt.

## 3. `npx ng test --watch=false`

```
 RUN  v4.1.12 /Users/.../frontend
 Test Files  10 passed (10)
      Tests  67 passed (67)
   Duration  4.17s
```
Ergebnis: alle Unit- und Property-Tests grün (Exit 0).

### Property-Based-Tests (fast-check, numRuns=100), mit Tag-Kommentaren
- Property 10 (Freitextsuche gegen searchFields): `services/filter.service.spec.ts`
- Property 11 (kombinierte Filter AND-Logik): `services/filter.service.spec.ts`
- Property 12 (InfoToggle erzwingt Overlay auf allen Kacheln): `components/wine-tile/wine-tile.spec.ts`
- Property 13 (InfoToggle-Roundtrip true→false): `components/wine-tile/wine-tile.spec.ts`
- Property 14 (Reihenfolge nach Filterung / Prefix-slice): `services/filter.service.spec.ts`
- Property 15 (WineTileOverlay Datenvollständigkeit): `components/wine-tile/wine-tile-overlay/wine-tile-overlay.spec.ts`
- Property 16 (WineDetailDialog Feldvollständigkeit): `components/wine-detail-dialog/wine-detail-dialog.spec.ts`
- Property 19 (UserPreferences Cookie-Roundtrip): `services/user-preferences.service.spec.ts`

Alle 8 Properties tragen den Kommentar `// Feature: weinliste, Property N: …` und laufen mit
`{ numRuns: 100 }`.

## 4. Smoke-Check — 559 Weine über gemockten WineDataService

- `src/app/app.spec.ts`: `it('lädt die echten 559 Weine über einen gemockten DataService')`
  mockt den `WineDataService`, setzt 559 Wine-Objekte und prüft `dataMock.wines().length === 559`.
- `src/app/services/wine-data.service.spec.ts`: prüft `idle → loading → loaded` über `forkJoin`
  mit beiden Assets (`wines.json` + `wine-schema.json`).
- `src/assets/wines.json` enthält bestätigt **559** Einträge (Zählung via `json.load`).
- Es wurde **kein** langlaufender Dev-Server (`ng serve`) gestartet.

## Fazit
Finding 1 behoben: Build fehlerfrei, Testsuite inkl. aller Property-Tests (10–16, 19) grün,
Nachweise hier dokumentiert und per Commit festgehalten.
