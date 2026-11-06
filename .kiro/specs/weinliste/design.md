# Design: weinliste

Angular SPA `frontend/projects/weinliste`. Eine Route (`/`). Lädt Daten zur Laufzeit; kennt keine Import-Logik.

Verträge:
- #[[file:.kiro/specs/contracts/export-format.md]] (`data/wines.json`, `data/wine-schema.json`, `/images`, `/audio`, `/video`)
- #[[file:.kiro/specs/contracts/shared-api.md]] (Models, FilterService, `applyFiltersAndSort`, UserPreferencesService, Util)

## Pfade

```
frontend/projects/weinliste/src/app/     Komponenten
frontend/projects/weinliste/public/
  data/   → ../../../../export/data      (Symlink, nur Development)
  images/ → ../../../../export/images    (Symlink, nur Development)
Build: npm run build (in frontend/) → frontend/dist/weinliste/browser/
```

Import gemeinsamer Teile nur über `@weinsprechstunde/shared`. Weinliste-Build enthält keine Weindaten.

## Router und Komponentenstruktur

```typescript
export const routes: Routes = [
  { path: '',   component: WineWallComponent },
  { path: '**', redirectTo: '' }
];
```

```
AppComponent (globale Tastaturkürzel, Lade-/Fehleranzeige)
├── NavComponent (Logo + Name; Klick = clearAllFilters + navigate '/')
└── WineWallComponent (Container, keine Route-Parameter)
    ├── ControlsRowComponent
    │   ├── FilterFieldComponent (fest: Freitextsuche "Filter"; ×n optional, mit Entfernen-Icon)
    │   ├── "Mehr Filter"-Menü (Checkbox-Liste)
    │   ├── SortButtonComponent (natives <select>, 5 Optionen)
    │   ├── InfoToggle (title "Tastenkürzel: i")
    │   └── ListToggle (title "Tastenkürzel: l")
    ├── WineGridComponent (alle Weine; Zurück-Button back-tile bei hasActiveFilter)
    │   └── WineTileComponent → WineTileCover, WineTileOverlay, PlayButton (audio/video)
    └── WineListComponent (alle Weine; Zurück-Button back-item bei hasActiveFilter)
        └── WineListItemComponent (WineTileCover-Thumbnail + Felder)
WineDetailDialogComponent (modal)
```

## Datenladen (Req 7)

`WineDataService` (App-intern, stellt `WineDataSource` aus shared-api bereit): `wines`, `schema`, `loadState` (`idle|loading|loaded|error`). `loadAll()` einmalig; `forkJoin` von `GET data/wines.json` und `GET data/wine-schema.json`; Fehler → `loadState = 'error'`. `AppComponent` ruft `loadAll()` in `ngOnInit`, zeigt „Lade Weine…" bzw. „Fehler beim Laden der Weindaten." und hostet den Dialog.

## FilterService-Nutzung (Req 9, 15.10, 19)

Definition und Signatur: shared-api. Die App nutzt: `filteredWines`, `hasActiveFilter`, `clearAllFilters`, `updateFilter`, `toggleFilterField(field, visible)` (blendet aus und ruft `resetFilterKey`), `setSortOption`, `setViewMode`, `infoToggleActive`, `visibleFilterFields`. Zustand wird aus dem Cookie initialisiert (Req 19.4) und bei jeder Änderung gespeichert (19.5). `default_filter` im Schema wird für die initiale Sichtbarkeit nicht ausgewertet.

## ControlsRow (Req 9)

`FilterDescriptor { key, label, kind, field?, bound? }`. Fest: `search` („Filter", `text-search`). Optional (`OPTIONAL_DESCRIPTORS`):

| key | label | kind |
|---|---|---|
| grape, origin | Rebsorte, Region | multi-select |
| country, type, producer, quality | Land, Typ, Weingut, Qualität | dropdown |
| ratingFrom / ratingTo | Bewertung ab / bis | rating-bound |
| tastingDateFrom / tastingDateTo | Verkostung ab / bis | date-bound |
| yearFrom / yearTo | Jahrgang ab / bis | year-bound |

`removeFilter(key)` = `toggleFilterField(key, false)`. `FilterFieldComponent` rendert nach `kind`: Suchfeld; natives `<select>`; kompaktes Multiselect-Dropdown (Trigger „Alle"/Wert/„n gewählt", Panel mit „Zurücksetzen"/„Fertig"); Zahl- bzw. Datumseingabe. Sortierung: `tasting_date_desc` (Standard), `tasting_date_asc`, `rating_desc`, `price_desc`, `price_asc`.

## WineGrid / WineList

Rendern `filteredWines()` direkt (kein Slice, kein IntersectionObserver). `showBackButton = hasActiveFilter`; `goBack()` = `clearAllFilters()` + navigate `/`. Leere Liste → „Keine Weine gefunden".

## WineTile

Inputs `wine`, `showInfos`; `overlayVisible = showInfos || localOverlay`; `hasMedia` = `audio` oder `video`. Hover (`mouseenter/leave`) bzw. Tap toggelt `localOverlay`, nur wenn `showInfos` false. Overlay ist festes Template mit `@if` je Feld: rating-circle, year, name, producer, grape, origin.

## WineDetailDialog

Feste Gruppen (Req 14.2); Medien: `<audio controls>` bzw. `<video controls>` mit `mediaSrc`. Zusatzfelder = Einträge außerhalb der bekannten Felder (`name, producer, year, rating, country, origin, grape, type, quality, tasting_date, description, price, image, audio, video`). Backdrop-Klick schließt; `effect` setzt `document.body.style.overflow` auf `hidden`, solange `wine()` gesetzt ist.

## Tastaturkürzel (Req 10)

`AppComponent` hat `(document:keydown)`. Gemeinsame Guards für `i`, `l`, `←`, `→`, `Escape`: `defaultPrevented`, Ctrl/Meta/Alt, editierbares Ziel (`INPUT|TEXTAREA|SELECT|contenteditable`). `i` und `l` zusätzlich blockiert bei offenem Dialog. `Escape` schließt den Dialog.

Pfeil-Navigation (kein eigener Zustand): `list = filteredWines()`, `n = list.length` (0 → nichts tun). Dialog zu, oder aktueller Wein nicht in `list`: `→` öffnet `list[0]`, `←` öffnet `list[n-1]`. Sonst `i = list.indexOf(current)`; Ziel `list[(i + dir + n) % n]` (Wrap).

## Build

Befehl und Dist-Pfad siehe oben (Deploy-seitige Sicht: Vertrag build-output, Pflege durch deploy-ftp-Domäne). Weinliste-Build ist unabhängig vom Import-Skript, ohne `prebuild`.

## Correctness Properties

Tag-Format: `// Feature: weinliste, Property N: <text>`. Mindestens 100 Iterationen (fast-check). Properties 10, 11, 14 prüfen `applyFiltersAndSort` aus shared-api (reine Funktion, kein DOM); 12, 13, 15, 16 via TestBed.

### Property 10: Freitextsuche: Vollständigkeit und Korrektheit
Jeder Treffer enthält den Suchbegriff (case-insensitiv) in mindestens einem `text-search`-Feld; kein Nicht-Treffer erscheint. *Validates: Req 9.2*

### Property 11: Kombinierte Filter: AND-Logik
Jeder Wein der gefilterten Ausgabe erfüllt alle aktiven Kriterien (dropdowns, multiSelects, year/rating/tastingDate-Grenzen); AND zwischen Feldern, OR innerhalb eines Multiselect-Feldes. *Validates: Req 9.13*

### Property 12: InfoToggle wirkt auf alle Kacheln
`infoToggleActive === true` ⇒ `overlayVisible` jeder Kachel `true`, unabhängig von `localOverlay`. *Validates: Req 9.17*

### Property 13: InfoToggle-Roundtrip
Aktivieren, dann Deaktivieren: `overlayVisible` hängt wieder nur von `localOverlay` ab. *Validates: Req 9.18*

### Property 14: Reihenfolge nach Filterung erhalten
Die Reihenfolge in `visibleWines` entspricht exakt `filteredWines`. *Validates: Req 11.1*

### Property 15: WineTileOverlay: Datenvollständigkeit
Das Overlay zeigt alle vorhandenen (nicht-null) Overlay-Felder (Name, Jahr, Region, Typ, Weingut, Rating, Rebsorte). *Validates: Req 12.4*

### Property 16: WineDetailDialog: Feldvollständigkeit
Der Dialog zeigt alle im Objekt vorhandenen Felder, auch unbekannte Zusatzfelder. *Validates: Req 14.2*

Property 19 (UserPreferences Cookie-Roundtrip) ist im Vertrag shared-api definiert; weinliste prüft die Cookie-Initialisierung (Req 19) in seinen Unit-Tests.

## Error Handling

| Szenario | Verhalten |
|---|---|
| `wines.json` nicht erreichbar | `loadState = 'error'`, Fehlermeldung im Hauptbereich |
| Wein ohne `image` | PlaceholderIcon in WineTileCover |
| Leere Filterergebnisse | Hinweis „Keine Weine gefunden" in Grid/List |
| Unbekannte Felder | durchgereicht (`[key: string]: unknown`), im Dialog als Zusatzfelder |

## Testing Strategy

vitest + jsdom + fast-check (`ng test`).
- Unit: WineDataService (HTTP-States, paralleles Laden), AppComponent (Kürzel i/l/←/→/Escape inkl. Guards, Modulo-Wrap, i/l bei offenem Dialog blockiert), ControlsRow (Katalog, Mehr-Filter, removeFilter), FilterField, SortButton (5 Optionen), WineTile (Overlay-Toggle, Play-Button), WineDetailDialog (Close, Backdrop, Scroll-Lock), Nav (Logo-Klick), WineListItem, WineGrid/WineList (alle Weine, Zurück-Button), Cookie-Initialisierung.
- Property: 10–16.
- Contract-Fixture: `frontend/projects/weinliste/src/app/services/contract-fixture.spec.ts` (`fixtures/export/wines.json`).
