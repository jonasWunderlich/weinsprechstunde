# Implementierungsplan: Angular-Frontend „Weinsprechstunde" (Tasks 15–22)

Dieser Plan setzt das freigegebene Technik-Design (`.agents/tasks/frontend-design.md`) um. Das Design ist maßgeblich; dieser Plan sequenziert es nur und re-entscheidet die Architektur nicht. Alle Pfade sind relativ zu `/Users/za_jonas/repos/weinsprechstunde2/frontend/` (Worktree-Root des Angular-Projekts), sofern nicht anders angegeben.

## Vorab geklärte Fakten aus der Exploration (für den Implementierer verbindlich)

Diese Punkte weichen von Formulierungen im Design/Setup bzw. der Aufgabenstellung ab; die hier festgelegte Variante ist korrekt, weil sie am realen Projektzustand verifiziert wurde:

1. **Test-Runner ist Vitest, nicht Karma/Jasmine.** `angular.json` nutzt den Builder `@angular/build:unit-test`; `devDependencies` enthalten `vitest` + `jsdom` (kein Karma/Jasmine). Verifiziert via `npx ng test --help`: ohne `--browsers` laufen die Tests **im Node.js/jsdom-Environment** (kein Browser nötig). Die Testsyntax (`describe`/`it`/`expect`) ist Vitest-kompatibel (`vitest/globals` in `tsconfig.spec.json`); vorhandene Specs nutzen sie bereits.
2. **Test-Kommando:** `npx ng test --watch=false` (läuft in jsdom, kein Browser). **NICHT** `--browsers=ChromeHeadless` übergeben — das würde Chrome erzwingen und ist das Gegenteil des gewünschten „kein Headless-Browser verfügbar"-Fallbacks. Die jsdom-Default-Ausführung ist der Fallback; sie braucht keinen Browser. Im Design erwähntes „Jasmine + Karma / `ng test` (Karma/Jasmine)" ist überholt — Runner ist Vitest.
3. **`fast-check` ist noch NICHT installiert.** Es muss als `devDependency` ergänzt werden (siehe Schritt 2), sonst kompilieren die Property-Tests nicht.
4. **Root-Komponente heißt aktuell `App`** (Klasse `App`, Selector `app-root`, Dateien `src/app/app.ts|html|scss|spec.ts`). Das Design nennt sie `AppComponent`. Festlegung: die bestehende Datei `src/app/app.ts` wird zur Root-Shell umgebaut; der **Klassenname darf `App` bleiben** (Selector `app-root` ist in `index.html` fest verdrahtet). Wo das Design `AppComponent` sagt, ist die bestehende Root-Klasse gemeint. `main.ts` importiert `App` aus `./app/app` — diesen Import nicht brechen.
5. **`tsconfig.json` setzt `noPropertyAccessFromIndexSignature: true`.** Da `Wine` ein `[key: string]: unknown` hat, MÜSSEN Zugriffe auf schema-/zusatzfelder über **Bracket-Notation** erfolgen (`wine['taste_eye']`, `wine[field]`), nie per Punkt. Das betrifft `valueList`, `applyFiltersAndSort` (dropdowns), `extraEntries`. Außerdem `isolatedModules: true` → Typ-Re-Exports mit `export type` kennzeichnen.
6. **`wines.json` (559 Einträge) nicht überschreiben.** Jeder Eintrag hat alle Schemafelder present-but-null (verifiziert: Eintrag[0] hat alle 15 Keys, die meisten `null`). `wine-schema.json` liegt bereits unter `src/assets/` und entspricht exakt dem im Design referenzierten realen Schema (u. a. `rating` = `number`/`decimals:1`/`filter_type:"rating-range"`, `price` = `number`/`decimals:2`/`filter_type:null`).
7. **Medienpfad/Symlink:** `mediaSrc` nutzt `IMAGE_BASE='/images/'`. Der im Design erwähnte Dev-Symlink `frontend/public/images → ../../export/images` ist **nur für manuelle Smoke-Tests** nötig und NICHT Teil der Build-/Test-Verifikation (Bilder sind für `ng build`/`ng test` irrelevant). Nicht committen. Optional; hier nicht zwingend anzulegen.
8. **Referenz-App (`existing_angular_app/`)** nutzt alte `@Input()`/`@Output()`-Decorators und `@HostListener`. Das ist NUR strukturelle/gestalterische Orientierung. Verbindlich ist das Design: moderne `input()`/`output()`/`inject()`/Signals, `ChangeDetectionStrategy.OnPush`, Control-Flow `@if/@for/@switch`, zoneless. Nicht die Decorator-Muster der Referenz übernehmen.
9. **Reihenfolge:** Datenmodelle/Utils → Services → Router/Shell/Nav → ControlsRow/Filter → Grid/Tile → List → Dialog → SCSS-Feinschliff → Tests. Jeder Schritt lässt das Projekt baubar (`npx ng build`) zurück; Komponenten werden erst in Routen/Parents eingebunden, wenn sie existieren.

Teststrategie global: Jeder Property-Test trägt den Kommentar-Tag `// Feature: weinliste, Property N: <text>` und läuft mit `fc.assert(..., { numRuns: 100 })` (mindestens 100 Iterationen). Reine Funktionen werden ohne TestBed getestet, Komponenten mit TestBed/`ComponentFixture`.

---

## Phase 0 — Vorbereitung & Abhängigkeiten

- [ ] 1. Baseline-Verifikation des vorhandenen Gerüsts herstellen.
      Vor jeder Änderung einmal `npm install` und `npx ng build` laufen lassen, um einen grünen Ausgangspunkt zu bestätigen (das Gerüst baut laut Setup-Notiz fehlerfrei). So sind spätere Fehler eindeutig den eigenen Änderungen zuzuordnen. **Hinweis:** `npm install`/`ng build` lösen KEIN `prebuild` aus (prebuild hängt nur an `npm run build`, nicht an `ng build`); die bestehende `wines.json` bleibt unangetastet. Keine Dateiänderung in diesem Schritt.
      Files: — (nur Verifikation)
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npm install && npx ng build` → Build endet mit „Application bundle generation complete", Assets `wines.json`/`wine-schema.json` liegen unter `dist/ng-weinsprechstunde/browser/assets/`.

- [ ] 2. `fast-check` als devDependency ergänzen und installieren.
      `fast-check` (aktuelle 3.x) in `frontend/package.json` unter `devDependencies` aufnehmen und installieren; `prebuild`, `build`, `start`, `ng`, `watch`, `test` Scripts unverändert lassen. `fast-check` wird in den Property-Tests (Props 10–16, 19) als `import fc from 'fast-check'` genutzt.
      Files: `frontend/package.json`, `frontend/package-lock.json`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npm install && node -e "require('fast-check'); console.log('fast-check ok')"` → gibt „fast-check ok" aus, kein Fehler.

---

## Phase 1 — Datenmodelle & reine Utility-Funktionen

- [ ] 3. Domänenmodelle anlegen.
      `Wine` (mit `[key: string]: unknown`), `WineFilter` (inkl. `dropdowns: Record<string,string|null>`, `grape: string[]`, Range-/Date-Slots), `NavigationFilter`, `EMPTY_FILTER` (alle fünf dropdown-Keys `null`), `SortOption`, `LoadState` exakt gemäß Design-Abschnitt „Models". `WineSchemaField`/`FilterType` mit `type`-Union `text|number|date|multi-value` (am realen Schema ausgerichtet, nicht `rating`). `UserPreferences` mit `visibleFilters`/`sortOption`/`viewMode`. Alle Typ-Exports mit `export interface`/`export type` (wegen `isolatedModules`).
      Files: `frontend/src/app/models/wine.model.ts`, `frontend/src/app/models/wine-schema.model.ts`, `frontend/src/app/models/user-preferences.model.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei (Modelle werden noch nicht genutzt, müssen aber typprüfen).

- [ ] 4. Reine Utility-Funktionen + Property-testbare Helfer anlegen.
      Als DOM-freie, exportierte Funktionen: `isPresent`, `grapeList`, `slugify` (mit Umlaut-Transliteration ä→ae etc. VOR Entfernen von Nicht-`[a-z0-9-]`), `valueList` (Bracket-Zugriff `w[field]`), `distinctValuesForField`, `countBy`, `humanizeKey` (+ `EXTRA_LABELS`-Map), `IMAGE_BASE`/`mediaSrc`, `formatPrice` (de-Dezimalkomma, 2 Nachkommastellen, `€`). Exakt gemäß Design-Snippets. Gemeinsam in einer `util`-Datei (plus `media`-Konstanten); eine einzige Quelle je Regel.
      Files: `frontend/src/app/models/wine-util.ts` (reine Funktionen inkl. `IMAGE_BASE`/`mediaSrc`)
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei.

- [ ] 5. Unit- und Property-Tests für die reinen Utility-Funktionen schreiben.
      Unit-Tests für `isPresent` (null/undefined/''/'  '/[]/0/false-Fälle), `slugify` (Umlaute, Whitespace, Sonderzeichen), `valueList`/`grapeList` (String vs. Array vs. null), `distinctValuesForField` (distinct, de-sortiert, present-gefiltert, multi-value via grape/quality), `countBy` (überspringt leere Werte, Count korrekt), `humanizeKey` (Map-Treffer + snake_case-Fallback), `mediaSrc` (null bei fehlendem File, `/images/`-Präfix sonst), `formatPrice` (`6.99`→`6,99 €`, null→null). Ein kleiner `arbitraryWine`-Generator (fast-check `fc.record`, viele optionale/`null`-Felder, gelegentliche Extra-Keys) wird hier für spätere Property-Tests mit angelegt und exportiert/lokalisiert.
      Files: `frontend/src/app/models/wine-util.spec.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng test --watch=false` → neue Util-Tests grün (jsdom, kein Browser).

---

## Phase 2 — Services

- [ ] 6. `WineDataService` implementieren.
      `@Injectable({providedIn:'root'})` mit Signals `wines`/`schema`/`loadState`; `loadAll()` lädt `assets/wines.json` + `assets/wine-schema.json` parallel per `forkJoin` (relative Asset-Pfade, kein führender Slash), Guard `loadState() !== 'idle'` für Einmal-Laden, `catchError` → `loadState='error'` + `console.error`. `provideHttpClient` wird in Schritt 10 ergänzt.
      Files: `frontend/src/app/services/wine-data.service.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei.

- [ ] 7. Unit-Tests für `WineDataService` (HttpTestingController).
      `provideHttpClient(withTesting)`/`provideHttpClientTesting`; Fälle: idle→loading→loaded bei erfolgreichem forkJoin (beide Requests flushen); loading→error bei HTTP-Fehler eines Requests; zweiter `loadAll()` ist No-op (kein zweiter Request); beide Assets werden angefordert (paralleles Laden). (Task 15.3)
      Files: `frontend/src/app/services/wine-data.service.spec.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng test --watch=false` → Service-Tests grün.

- [ ] 8. `UserPreferencesService` implementieren + Cookie-Roundtrip-Property-Test.
      `load()`/`save()` für Cookie `ws_prefs` mit `max-age=31536000; path=/; SameSite=Strict`, defensives `load()` (fehlend/korrupt → `DEFAULT_PREFS`, Merge `{...DEFAULT_PREFS, ...parsed}`). Speichert nur Konfiguration, nie Filterwerte. Property-Test 19: `save(p)`→`load()` liefert strukturell gleiches Objekt für beliebige gültige `UserPreferences` (fast-check-Generator über `SortOption`/`viewMode`/`string[]`); zusätzlich Unit-Test, dass korrupter Cookie Defaults liefert.
      Files: `frontend/src/app/services/user-preferences.service.ts`, `frontend/src/app/services/user-preferences.service.spec.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng test --watch=false` → Prefs-Tests inkl. Property 19 grün. (Tag `// Feature: weinliste, Property 19: ...`.)

- [ ] 9. `applyFiltersAndSort` + `FilterService` + `DialogService` implementieren.
      (a) Reine Funktion `applyFiltersAndSort(wines, filter, navFilter, sort, searchFields)` exakt gemäß Design: Navigation per `slugify`-Vergleich, Freitextsuche über den Parameter `searchFields` (nicht hartkodiert), generische `dropdowns`-Iteration (Bracket-Zugriff), grape OR-innerhalb/AND-zwischen, year/rating/**tasting_date** symmetrische Range-Regel (null-Wert fällt bei aktiver Grenze raus), `slice().sort(...)` für stabile, mutationsfreie Sortierung. (b) `FilterService` (`providedIn:'root'`): Signals (`filter`, `navigationFilter`, `sortOption`, `viewMode`, `infoToggleActive`, `visibleFilterFields`), Konstruktor liest `prefs.load()`, Computed `searchFields`/`filteredWines`/`availableRegions`/`availableGrapes`/`hasActiveFilter` (feldweise explizit), Methoden `setNavigationFilter`/`clearNavigationFilter`/`clearAllFilters` (nur Werte)/`setSortOption`/`setViewMode`/`toggleFilterField`/`updateFilter`/`_savePrefs`. (c) schlanker `DialogService` mit `wine`-Signal + `open`/`close`.
      Files: `frontend/src/app/services/filter.service.ts` (enthält `applyFiltersAndSort`-Export + `FilterService`), `frontend/src/app/services/dialog.service.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei.

- [ ] 10. Unit- und Property-Tests für Filterlogik und FilterService.
      Property 10 (Freitextsuche Vollständigkeit/Korrektheit gegen schema-abgeleitete `searchFields`), Property 11 (kombinierte Filter AND-Logik) — beide gegen `applyFiltersAndSort` mit `arbitraryWine`/`arbitraryFilter`-Generatoren. Unit-Tests `FilterService`: konkrete Filterergebnisse, Cookie-Init im Konstruktor (gemockter `UserPreferencesService`), `availableRegions/Grapes` mit korrektem Count und Ausschluss von `null`, `hasActiveFilter` true/false-Fälle (inkl. `grape:[]` vs. gesetzt, dropdown gesetzt, numerisches `0` löst NICHT fälschlich aus), `clearAllFilters` lässt `visibleFilterFields`/`sortOption`/`viewMode` unangetastet. (Tasks 17.3/17.4/17.5)
      Files: `frontend/src/app/services/filter.service.spec.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng test --watch=false` → Filterlogik-Tests inkl. Properties 10 & 11 grün (je `numRuns:100`, Tags gesetzt).

---

## Phase 3 — Router, App-Shell, Navigation

- [ ] 11. `app.config.ts` und `app.routes.ts` auf die SPA-Anforderungen umstellen.
      `app.config.ts`: Provider `provideBrowserGlobalErrorListeners()`, `provideZonelessChangeDetection()`, `provideRouter(routes)`, `provideHttpClient()`. **Kein** `withComponentInputBinding()` (Design-Finding 9). `app.routes.ts`: `''`, `region/:slug` (`data:{navType:'region'}`), `rebsorte/:slug` (`data:{navType:'rebsorte'}`), alle → `WineWallComponent`; `**` → `redirectTo:''`. (Da `WineWallComponent` erst in Schritt 13 existiert, diesen Schritt mit Schritt 12/13 zusammen abschließen, damit der Build grün bleibt — siehe Verify.)
      Files: `frontend/src/app/app.config.ts`, `frontend/src/app/app.routes.ts`
      Verify: gemeinsam mit Schritt 13 verifizieren (Routen referenzieren `WineWallComponent`).

- [ ] 12. Root-Shell `App` (Selector `app-root`) zur Weinsprechstunde-Shell umbauen.
      `src/app/app.ts`: `ChangeDetectionStrategy.OnPush`, `inject(WineDataService)` + `inject(DialogService)`, `ngOnInit`→`loadAll()`, Imports `NavComponent`/`RouterOutlet`/`WineDetailDialogComponent`. `app.html`: `<app-nav/>`, `<main>` mit `@switch(loadState())` (loading/error/default→`<router-outlet/>`), globaler `<app-wine-detail-dialog [wine]="dialog.wine()" (close)="dialog.close()"/>`. Platzhalter-Template/Styles entfernen. `app.spec.ts`: den veralteten „Hello"-Test entfernen/ersetzen durch einen schlanken „erstellt die Shell"-Test (sonst schlägt er fehl). Klassenname `App` beibehalten (main.ts-Import). NavComponent/WineDetailDialog werden in Schritt 13 bzw. 19 angelegt — bis dahin bleibt der Build rot; Schritte 11–13 bilden eine Einheit.
      Files: `frontend/src/app/app.ts`, `frontend/src/app/app.html`, `frontend/src/app/app.scss`, `frontend/src/app/app.spec.ts`
      Verify: gemeinsam mit Schritt 13.

- [ ] 13. `NavComponent`, `WineWallComponent` und einen minimalen `WineDetailDialogComponent`-Stub anlegen, damit die Shell baubar wird.
      `NavComponent` (`app-nav`): NavBar „Weinsprechstunde" + Logo-Platzhalter, Dropdowns „Regionen"/„Rebsorten" aus `availableRegions`/`availableGrapes` (Anzeige „Wert (count)"), `navigateToRegion/Grape` (`slugify` + Router), gegenseitiges Schließen, `goHome()`→`clearAllFilters()`+`/`. `WineWallComponent` (`app-wine-wall`): liest Route via `combineLatest([params,data])` + `takeUntilDestroyed`, setzt/löscht Navigation-Filter, rendert `@if viewMode==='grid'` Grid sonst List + ControlsRow + ScrollTopButton. **Für diesen Schritt** dürfen ControlsRow/Grid/List/ScrollTop als minimale leere Platzhalter-Komponenten (nur Selector + leeres Template) angelegt werden, die in den Phasen 4–6 ausgebaut werden; oder WineWall bindet sie erst ein, wenn sie existieren. `WineDetailDialogComponent` zunächst als minimaler Stub (`wine`-input, `close`-output, rendert nichts bei `null`), Ausbau in Phase 7.
      Files: `frontend/src/app/components/nav/nav.ts|html|scss`, `frontend/src/app/components/wine-wall/wine-wall.ts|html`, `frontend/src/app/components/wine-detail-dialog/wine-detail-dialog.ts|html|scss` (Stub), ggf. leere Platzhalter für `controls-row`/`wine-grid`/`wine-list`/`scroll-top-button`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei; App bootstrapped mit Nav + Outlet + Lade-/Fehlerzweig.

- [ ] 14. Unit-Tests für App-Shell und NavComponent.
      App: Rendering je `loadState` (loading-Text, error-Text, sonst Outlet) über gemockten `WineDataService`. Nav: Regionen/Rebsorten-Links mit Count aus gemocktem FilterService, Navigation ruft Router mit korrektem Slug + schließt Menü, `goHome` ruft `clearAllFilters`. (Task 18.4)
      Files: `frontend/src/app/app.spec.ts` (ergänzen), `frontend/src/app/components/nav/nav.spec.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng test --watch=false` → App-/Nav-Tests grün.

---

## Phase 4 — ControlsRow & Filter-Komponenten

- [ ] 15. `ScrollTopButtonComponent`, `SortButtonComponent` und `RatingCircleComponent` implementieren.
      `ScrollTopButton` (`app-scroll-top-button`): `visible`-Signal, passiver `scroll`-Listener (`scrollY>600`), `scrollToTop`, Cleanup via `DestroyRef`. `SortButton` (`app-sort-button`): natives `<select>` mit drei `SortOption`-Labels, `[value]="fs.sortOption()"`, `onChange`→`fs.setSortOption`. `RatingCircle` (`app-rating-circle`): `value=input.required<number>()`, zeigt eine Nachkommastelle. Jeweils `OnPush`. (Diese drei sind blattnahe, wiederverwendbare Bausteine ohne weitere Abhängigkeiten.)
      Files: `frontend/src/app/components/scroll-top-button/scroll-top-button.ts|html|scss`, `frontend/src/app/components/sort-button/sort-button.ts|html|scss`, `frontend/src/app/components/rating-circle/rating-circle.ts|html|scss`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei.

- [ ] 16. `FilterFieldComponent` (schema-gesteuert) implementieren.
      `app-filter-field`, `field=input.required<WineSchemaField>()`, `options=computed(distinctValuesForField(data.wines(), field().field))`. Rendert je `filter_type` das passende Widget (`text-search`, `multi-select`=Grape-Checkbox/Chip-Liste, `dropdown`=Einzel-`<select>` mit „— alle —", `range`=zwei Zahleninputs, `date-range`=zwei `type=date`, `rating-range`=zwei Inputs min 1.0/max 10.0/step 0.1) und schreibt über `fs.updateFilter(...)` (dropdowns generisch via `{...current,[field]:value}`, grape als Array). Normalisierung (`''`/`NaN`→`null`, keine Auswahl→`[]`) vor `updateFilter`.
      Files: `frontend/src/app/components/controls-row/filter-field/filter-field.ts|html|scss`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei.

- [ ] 17. `ControlsRowComponent` ausbauen und verdrahten.
      `app-controls-row`: `STANDARD_FIELDS=['name','grape','rating','tasting_date']`, `filterableFields`/`activeFields` (Schema-Reihenfolge, Standard ∪ eingeblendet), „Mehr Filter"-Toggle (`toggleFilterField`→Cookie), Freitextsuche (`updateFilter({searchText})`), InfoToggle (`fs.infoToggleActive`), ListToggle (`setViewMode`), eingebundene `FilterFieldComponent`/`SortButtonComponent`. Falls in Schritt 13 als Platzhalter angelegt, hier zur vollen Komponente ausbauen und in `WineWallComponent` einbinden.
      Files: `frontend/src/app/components/controls-row/controls-row.ts|html|scss`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei; Controls-Zeile rendert unter der Nav.

---

## Phase 5 — WineGrid & WineTile

- [ ] 18. `WineTileCoverComponent`, `WineTileOverlayComponent` und `WineTileComponent` implementieren.
      `WineTileCover` (`app-wine-tile-cover`): Bild über `mediaSrc(wine().image)` + `loading="lazy"`, `imageError`-Signal → PlaceholderIcon (inline-SVG Weinglas) bei fehlendem Bild/`(error)`; roher Dateiname nie direkt an `[src]`. `WineTileOverlay` (`app-wine-tile-overlay`): festes Template mit genau rating(→`app-rating-circle`)/year/name/producer/grape(join)/origin, je `@if isPresent(...)`; jedes Feld mit `data-field`-Attribut als Testanker. `WineTile` (`app-wine-tile`): `wine=input.required`, `showInfos=input<boolean>`, `openDetail=output<Wine>`, `localOverlay`-Signal, `overlayVisible=computed(showInfos()||localOverlay())`, Hover/Tap-Handler, Play-Button nur bei `hasMedia()`. `isPresent`/`grapeList` als Feld-Referenzen für Templates exponieren.
      Files: `frontend/src/app/components/wine-tile/wine-tile-cover/wine-tile-cover.ts|html|scss`, `frontend/src/app/components/wine-tile/wine-tile-overlay/wine-tile-overlay.ts|html|scss`, `frontend/src/app/components/wine-tile/wine-tile.ts|html|scss`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei.

- [ ] 19. `WineGridComponent` implementieren und in `WineWallComponent` einbinden.
      `app-wine-grid`: `PAGE_SIZE=24`, `visibleCount`-Signal, `allWines=fs.filteredWines`, `visibleWines=computed(slice(0,count))`, `showBackButton=fs.hasActiveFilter`, `isEmpty`, `effect` resettet `visibleCount` bei Filteränderung, IntersectionObserver-Sentinel (`viewChild`+`afterNextRender`/`ngAfterViewInit`, Cleanup via `DestroyRef`) → `onSentinelVisible`, `openDetail`→`dialog.open`, `goBack`→`clearAllFilters`+`/`. Zurück-Kachel als erstes Grid-Kind bei `showBackButton()`. Leerzustand „Keine Weine gefunden". Responsives Grid mit Breakpoints 600/1024 im SCSS.
      Files: `frontend/src/app/components/wine-grid/wine-grid.ts|html|scss`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei; Grid rendert Kacheln.

- [ ] 20. Unit- und Property-Tests für WineGrid & WineTile.
      Unit (Task 20.3): `visibleCount` steigt bei `onSentinelVisible`, Reset bei Filteränderung, Back-Button-Sichtbarkeit an `hasActiveFilter`, Overlay-Toggle Hover/Tap (nur wenn `showInfos` aus), Play-Button nur bei Medien, Klick emittiert `openDetail`/ruft `dialog.open`. Property 12 (InfoToggle: bei `showInfos=true` ist `overlayVisible` immer true), Property 13 (Roundtrip true→false: `overlayVisible===localOverlay`), Property 14 (`visibleWines` exaktes Prefix von `filteredWines`), Property 15 (Overlay zeigt genau die gesetzten Felder; über `data-field`-Anker). TestBed für Komponenten, reine Prefix-Prüfung ggf. gegen `applyFiltersAndSort`.
      Files: `frontend/src/app/components/wine-tile/wine-tile.spec.ts`, `frontend/src/app/components/wine-tile/wine-tile-overlay/wine-tile-overlay.spec.ts`, `frontend/src/app/components/wine-grid/wine-grid.spec.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng test --watch=false` → Grid/Tile-Tests inkl. Properties 12–15 grün.

---

## Phase 6 — WineList & WineListItem

- [ ] 21. `WineListItemComponent` und `WineListComponent` implementieren und einbinden.
      `WineListItem` (`app-wine-list-item`): `wine=input.required`, `openDetail=output`, kompakte Zeile Name/producer/year/country/rating (rating→`app-rating-circle`), leere Felder via `@if isPresent` aus. `WineList` (`app-wine-list`): gleiche `visibleCount`/Sentinel/`isEmpty`/`showBackButton`/`goBack`/`openDetail`-Mechanik wie Grid (Muster bewusst dupliziert, nicht overengineered), Zurück-Zeile am Anfang, Leer-Hinweis. In `WineWallComponent` am `@else`-Zweig einbinden.
      Files: `frontend/src/app/components/wine-list/wine-list-item/wine-list-item.ts|html|scss`, `frontend/src/app/components/wine-list/wine-list.ts|html|scss`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei; ListToggle schaltet zwischen Grid und Liste.

---

## Phase 7 — WineDetailDialog

- [ ] 22. `WineDetailDialogComponent` vollständig implementieren (Stub aus Schritt 13 ersetzen).
      `app-wine-detail-dialog`: `wine=input<Wine|null>`, `close=output<void>`, `KNOWN`-Set, `extraEntries=computed` (unbekannte, `isPresent`-Felder → `{key,label:humanizeKey,value}`), feste Gruppen (Kopf/Herkunft/Weinprofil/Verkostung/Kaufinfo mit `formatPrice`/Medien über `mediaSrc`/Zusatzfelder), leere Felder/Gruppen ausblenden, jedes Feld + jeder Extra-Entry mit `data-field`-Anker. Schließen-Button + Backdrop-Klick (nur auf `.dialog-backdrop`) → `close`, Body-Scroll-Lock via `effect(onCleanup)`. Ganzes Template in `@if(wine(); as w)`. Angebunden ist der Dialog bereits in der App-Shell (Schritt 12) an den `DialogService`.
      Files: `frontend/src/app/components/wine-detail-dialog/wine-detail-dialog.ts|html|scss`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei; Klick auf Kachel/Listenzeile öffnet den Dialog.

- [ ] 23. Unit- und Property-Test für den Dialog.
      Unit (Task 22.2): `close`-Output bei Button; Backdrop-Klick schließt nur bei Backdrop-Target (nicht bei Inhalt); Body-Scroll-Lock setzt `overflow='hidden'` bei gesetztem Wein und `''` bei `null`/Destroy; `extraEntries` enthält genau die unbekannten, gesetzten Felder. Property 16: für ein beliebiges `arbitraryWine` ist jeder Key mit `isPresent`-Wert (bekannt + unbekannt) über seinen `data-field`-Anker im DOM nachweisbar.
      Files: `frontend/src/app/components/wine-detail-dialog/wine-detail-dialog.spec.ts`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng test --watch=false` → Dialog-Tests inkl. Property 16 grün.

---

## Phase 8 — SCSS-Feinschliff & globale Tokens

- [ ] 24. Globale Design-Tokens, Shared-Mixins und Light-Mode-Resets finalisieren.
      `src/styles.scss`: `:root`-CSS-Variablen (Weinpalette: `--color-bg`, `--accent-wine` Bordeaux, `--color-highlight` Gold für Rating, Spacing/Radius-Tokens etc.), globale Resets/Box-Sizing/Grundtypografie, `a`/`button`-Basis. `_shared.scss`: Breakpoint-Variablen (`$bp-tablet:600px`, `$bp-desktop:1024px`) + Mixins (`filter-button`/Pill, `card-surface`, `overlay-panel`, `responsive-grid`), per `@use` eingebunden. Komponenten-SCSS auf Tokens/Mixins umstellen; kein UI-Framework, kein Dark Mode. `anyComponentStyle`-Budget (max 8kB/Datei aus `angular.json`) beachten — Komponenten-SCSS schlank halten.
      Files: `frontend/src/styles.scss`, `frontend/src/_shared.scss`, plus Feinschliff in vorhandenen Komponenten-`*.scss`
      Verify: `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → fehlerfrei, keine Budget-Überschreitung (keine `anyComponentStyle`-Fehler).

---

## Phase 9 — Gesamtverifikation (Checkpoint 23)

- [ ] 25. Vollständige Build- und Testverifikation ausführen.
      Alle Teilschritte zusammenführen und den Gesamtstand grün bestätigen. Temporäre Artefakte entfernen; nichts committen (keine ausdrückliche Anweisung dazu). Keinen Dev-Server starten.
      Files: — (nur Verifikation)
      Verify (alle müssen erfolgreich sein):
      1. `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npm install` → ohne Fehler.
      2. `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng build` → „Application bundle generation complete", `wines.json`/`wine-schema.json` unter `dist/ng-weinsprechstunde/browser/assets/`. (Reines `ng build` ohne `prebuild`; die vorhandene `wines.json` wird nicht neu generiert. `prebuild` läuft nur bei `npm run build` und würde über `scripts/weinimport.py` die `wines.json` neu erzeugen — hier bewusst NICHT ausgeführt.)
      3. `cd /Users/za_jonas/repos/weinsprechstunde2/frontend && npx ng test --watch=false` → alle Unit- und fast-check-Property-Tests (Props 10–16, 19) grün. Läuft im Node.js/jsdom-Environment (kein Headless-Browser nötig/erforderlich). **Fallback:** Sollte die Testausführung in dieser Umgebung dennoch scheitern (nicht wegen Testfehlern, sondern wegen fehlender Laufzeit), ist dies zu dokumentieren und mindestens sicherzustellen, dass die Tests kompilieren (z. B. `npx tsc -p tsconfig.spec.json --noEmit` ist grün).

---

## Hinweise, offene Annahmen und bewusste Festlegungen

- **Test-Kommando korrigiert** gegenüber der Aufgabenstellung: `npx ng test --watch=false` (Vitest/jsdom) statt `--browsers=ChromeHeadless`. Grund: Der reale Builder (`@angular/build:unit-test`, verifiziert via `--help`) läuft ohne `--browsers` in jsdom und braucht keinen Browser — genau der gewünschte „kein Headless-Browser"-Zustand. `--browsers=ChromeHeadless` würde Chrome erzwingen.
- **`fast-check` muss installiert werden** (Schritt 2) — es fehlt im aktuellen `package.json`.
- **Index-Signatur-Zugriffe nur per Bracket** (`noPropertyAccessFromIndexSignature`), relevant in `valueList`/`applyFiltersAndSort`/`extraEntries`.
- **Root-Klasse bleibt `App`** (Selector `app-root`, `main.ts`-Import), wird aber zur Shell umgebaut; der veraltete „Hello"-Spec-Test wird ersetzt (sonst rot).
- **Build-Reihenfolge-Kopplung:** Schritte 11–13 bilden eine baubare Einheit (Routen/Shell referenzieren Nav/Wall/Dialog). Platzhalter-Komponenten für ControlsRow/Grid/List/ScrollTop/Dialog dürfen in Schritt 13 minimal angelegt und später ausgebaut werden, damit jeder Zwischenstand baut.
- **Medien-Symlink `public/images`** ist optional und nur für manuelle Smoke-Tests; nicht Teil von `ng build`/`ng test`, nicht committen.
- **Optionale Test-Sub-Tasks** aus `tasks.md` (mit `*`) sind hier als vollwertige Schritte eingeplant (Design verlangt Unit + Property-Tests für Checkpoint 23). Bei Zeitdruck sind die Property-Tests die zuletzt streichbaren Teile, ohne die Funktionalität zu brechen.
