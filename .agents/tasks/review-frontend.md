# Review: Angular-Frontend „Weinsprechstunde" gegen Requirements 7–14 (2. Pass)

Scope: Angular-Frontend unter `frontend/` gegen die freigegebenen Requirements 7–14
(`.kiro/specs/weinliste/requirements.md`), Design (`frontend-design.md`,
`.kiro/specs/weinliste/design.md`) und Plan (`frontend-plan.md`). Dieser Pass verifiziert die
Behebung des einzigen Blockers des Vorgänger-Reviews (Finding 1 — fehlende
Verifikationsnachweise) und die davon betroffenen Pfade. Die Testsuite wurde gemäß Auftrag
**nicht** erneut ausgeführt; die festgehaltenen Coder-Nachweise wurden gelesen.

## Verifikationsnachweise (Prüfung des vorigen Blockers)

Der vorige Blocker (Finding 1) ist behoben:

- Frontend-Commit vorhanden: `ae5ce20 feat: Angular-Frontend Weinsprechstunde (Weinliste,
  Tasks 15-22)`. `frontend/src/**` ist nicht mehr untracked.
- Verifikationsnotiz vorhanden: `.agents/tasks/verification-frontend.md` hält fest:
  - `npm install`: erfolgreich, 0 vulnerabilities.
  - `npx ng build`: „Application bundle generation complete", valides
    `dist/ng-weinsprechstunde/` (prebuild bewusst übersprungen, Scripts unverändert).
  - `npx ng test --watch=false` (Vitest 4 + jsdom): **10 Test Files / 67 Tests grün**.
  - Property-Tests (fast-check, numRuns=100): 10, 11, 12, 13, 14, 15, 16, 19 grün, je mit
    Tag `// Feature: weinliste, Property N: …`.
- Die Commit-Message spiegelt dieselben Nachweise.

Spot-Check (eng begrenzt, zur Auflösung eines konkreten Zweifels, ob die Property-Tags/
`numRuns` tatsächlich im Code stehen — ein erster Tool-Glob lieferte einen falschen
Negativtreffer): `grep -rn "numRuns"` / `grep -rn "Feature: weinliste, Property"` über
`frontend/src` belegt alle 8 Property-Tests mit Tag und `{ numRuns: 100 }`:
- Property 10/11/14 in `services/filter.service.spec.ts`
- Property 12/13 in `components/wine-tile/wine-tile.spec.ts`
- Property 15 in `components/wine-tile/wine-tile-overlay/wine-tile-overlay.spec.ts`
- Property 16 in `components/wine-detail-dialog/wine-detail-dialog.spec.ts`
- Property 19 in `services/user-preferences.service.spec.ts`

Damit ist die Pflichtverifikation vollständig erbracht.

## Prüfung gegen Requirements 7–14 (Code-Befund)

### Req 7 — Datenladen / Single Source of Truth
- Einmaliges, paralleles Laden via `forkJoin` in `WineDataService.loadAll()` mit Guard
  `loadState() !== 'idle'` → kein Reload (7.1, 7.5). `catchError` → `console.error` +
  `loadState='error'` (7.4). (`services/wine-data.service.ts`)
- `FilterService` kapselt die gesamte Filterlogik; `applyFiltersAndSort` ist die einzige
  Filter-/Sortierfunktion. Komponenten halten **keinen** Filter-State — WineGrid/WineList
  lesen ausschließlich `fs.filteredWines`/`fs.hasActiveFilter`; WineTile/Nav halten nur
  transienten UI-State (Overlay-Sichtbarkeit, Menü-offen, `visibleCount`-Pagination), keinen
  Filterzustand (7.6, 14.10). (`services/filter.service.ts`, `components/wine-grid/wine-grid.ts`)
- Routenwechsel laden nichts nach: `WineWallComponent` überträgt nur Route-Parameter per
  `combineLatest([params,data])` in `setNavigationFilter`/`clearNavigationFilter`, kein
  `loadAll` (7.7, 14.9). (`components/wine-wall/wine-wall.ts`)

### Req 8 — Navigation
- NavBar mit Dropdowns Regionen/Rebsorten mit Count aus `availableRegions`/`availableGrapes`
  (`countBy`, überspringt leere Werte). Klick → `router.navigate(['/region'|'/rebsorte',
  slugify(value)])`, Menü schließt; `goHome()` ruft `clearAllFilters()` + `/` (8.*).
  (`components/nav/nav.ts`)

### Req 9 — Controls Row / schema-gesteuerte Filter
- Freitextsuche vergleicht case-insensitiv nur Felder mit `filter_type === 'text-search'`
  (`searchFields`-Computed, an `applyFiltersAndSort` übergeben) (9.2).
- `FilterFieldComponent` ist der einzige schema-gesteuerte Teil: `@switch (field().filter_type)`
  rendert text-search/multi-select/dropdown/range/rating-range (min 1.0/max 10.0/step 0.1)/
  date-range; Optionen aus `distinctValuesForField` (9.7–9.11).
- AND-Logik über alle aktiven Kriterien in `applyFiltersAndSort` (9.12); grape OR-innerhalb/
  AND-zwischen; year/rating/tasting_date symmetrische Range-Regel (null-Wert fällt bei aktiver
  Grenze raus). Drei Sortieroptionen, InfoToggle, ListToggle (9.13–9.19).

### Req 10/11/12 — Grid, Tile, List
- WineGrid: responsives Grid (SCSS 600/1025), EndlessScroll via IntersectionObserver-Sentinel
  + `visibleCount`-Reset per `effect` bei Filteränderung, Leerzustand „Keine Weine gefunden",
  Zurück-Kachel als erstes Element bei `showBackButton()=hasActiveFilter`, **gleiche Größe**
  (`width:100%; aspect-ratio:1/1` wie Grid-Zelle), `goBack` → `clearAllFilters` + `/`
  (10.1–10.4). (`components/wine-grid/wine-grid.{ts,html,scss}`)
- WineTile/Overlay: **festes** Overlay-Template mit genau rating/year/name/producer/grape/
  origin, je `@if isPresent(...)`; Hover/Tap-Toggle, InfoToggle erzwingt Overlay, Play-Button
  nur bei audio|video, Klick öffnet Detail; keine dynamische Schema-Generierung (11.*).
- WineList: kompakte Zeile, leere Felder ausgeblendet, gleiche EndlessScroll-/Back-/Empty-
  Mechanik (12.*).

### Req 13 — WineDetailDialog
- **Festes** Template mit festen Gruppen (Kopf/Herkunft/Weinprofil/Verkostung/Kaufinfo/Medien);
  **keine** dynamische Generierung aus dem Schema. Unbekannte Zusatzfelder (`extraEntries`,
  `KNOWN`-Set-Ausschluss + `isPresent`, `humanizeKey`-Label) werden ausschließlich am Ende als
  Key-Value angehängt (13.2). RatingCircle bei rating (13.3), AudioPlayer bei audio (13.4),
  Schließen-Button + Backdrop-Klick nur auf `.dialog-backdrop` (13.5–13.7), Body-Scroll-Lock
  via `effect(onCleanup)` (13.8). (`components/wine-detail-dialog/**`)

### Req 14 — Technik/Architektur
- Standalone, `OnPush` durchgängig, zoneless (`provideZonelessChangeDetection`), Signals/
  `computed`/`effect`, `input()`/`output()`, `inject()`, Control Flow `@if/@for/@switch` (14.1,
  14.2). Reines SCSS mit Light-Mode-Tokens; `package.json` ohne Material/Tailwind/Bootstrap
  (14.3, 14.5). Responsives Layout (14.4). `Wine` mit `[key: string]: unknown` (14.7). Router,
  Routenwechsel ohne Daten-Requests; kein `withComponentInputBinding()`, navType über
  `route.data` (14.9). Geforderte Komponentennamen vorhanden (14.8). FilterService einzige
  Quelle (14.10).

### Fehlende-Felder-Robustheit & Cookie
- `isPresent` zentralisiert null/undefined/''/[]-Behandlung; `grapeList`/`valueList` behandeln
  `string | string[] | null`; Bracket-Zugriff auf Index-Signatur. Overlay/List/Dialog blenden
  abwesende Felder konsequent aus.
- Cookie `ws_prefs`: `path=/; max-age=31536000; SameSite=Strict` — persistent „ohne festes
  Ablaufdatum" (gleitendes 1-Jahr-Max-Age). Dies ist eine im Design explizit begründete,
  requirementskonforme Festlegung (ein Session-Cookie widerspräche „zwischen Besuchen
  beibehalten", Req 18.1). Als freigegebene Trade-off-Entscheidung gewertet, kein Finding.
  Speichert nur Konfiguration, nie Filterwerte; `clearAllFilters` lässt Sichtbarkeit/Sort/View
  unangetastet (18.1–18.5). (`services/user-preferences.service.ts`, `filter.service.ts`)

### Property-Tests
- fast-check (devDependency) vorhanden. Property-Tests 10, 11, 12, 13, 14, 15, 16, 19
  vorhanden, je mit Tag `// Feature: weinliste, Property N: …` und `{ numRuns: 100 }`; grün
  laut Coder-Nachweis (67 Tests / 10 Files). Per Spot-Check im Code bestätigt.

## Findings (Blocker)

Keine. Der einzige Blocker des Vorgänger-Reviews (Finding 1 — fehlende
Verifikationsnachweise) ist behoben: Build- und Testergebnisse inkl. Property-Tests 10–16/19
sind in `verification-frontend.md` und der Commit-Message festgehalten; die Tag-/`numRuns`-
Marker sind im Code vorhanden. Es wurden keine neuen blockierenden Korrektheits-,
Sicherheits- oder Datenfehler festgestellt.

## Verdikt

APPROVED. Die Implementierung erfüllt Requirements 7–14 vollständig, und die geforderten
Verifikationsnachweise (Build + Testsuite inkl. fast-check Property-Tests 10–16, 19) liegen
nun festgehalten vor.
