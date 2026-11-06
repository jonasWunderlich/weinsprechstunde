# Vertrag: shared-api

- Version: 1.0.0
- Produzent (Eigentümer): shared (`frontend/projects/shared/**`)
- Konsumenten: editor, weinliste
- Changelog:
  - 1.0.0 (2026-11-06): Erstfassung aus Ist-Zustand (`public-api.ts`).

## Import

- Alias `@weinsprechstunde/shared` → `frontend/projects/shared/src/public-api.ts`.
- Alias `@weinsprechstunde/shared/testing` → `frontend/projects/shared/src/testing.ts` (nur Specs; fast-check-Generatoren; nicht in `public-api.ts`).
- Peer-Abhängigkeiten: `@angular/common`, `@angular/core` `^22.0.0`.
- Nur über diese Aliasse importieren, keine Tiefenimporte in `shared/src/lib/**`.

## Exporte (`public-api.ts`)

Modelle (`wine.model.ts`): `Wine`, `WineFilter`, `NavigationFilter`, `EMPTY_FILTER`, `SortOption`, `LoadState`.
- `Wine`: `name: string`; optional `year, price, rating: number`; `country, origin, type, producer, description, tasting_date, image, audio, video: string`; `grape, quality: string | string[]`; Index-Signatur `[key: string]: unknown` (Zugriff auf Zusatzfelder per Klammer).
- `SortOption`: `tasting_date_desc | tasting_date_asc | rating_desc | price_desc | price_asc | name_asc | name_desc`.
- `LoadState`: `idle | loading | loaded | error`.

Schema (`wine-schema.model.ts`): `WineSchemaField`, `FilterType`. Entspricht [`wine-schema.json`](../../../wine-schema.json).

Präferenzen (`user-preferences.model.ts`): `UserPreferences`.

Hilfsfunktionen (`wine-util.ts`): `IMAGE_BASE` (`/images/`), `VIDEO_BASE` (`/video/`), `AUDIO_BASE` (`/audio/`), `isPresent`, `grapeList`, `slugify`, `valueList`, `distinctValuesForField`, `countBy`, `EXTRA_LABELS`, `humanizeKey`, `mediaSrc`, `formatPrice`.

Dienste:
- `WineDataSource` (abstrakte Klasse + DI-Token): `wines: Signal<Wine[]>`, `schema: Signal<WineSchemaField[]>`. Jede App stellt per `{ provide: WineDataSource, useExisting: … }` bereit.
- `FilterService`: nutzt nur `WineDataSource.wines/schema` und `UserPreferencesService`.
- `applyFiltersAndSort(wines, filter, sort, searchFields): Wine[]` (rein, DOM-frei).
- `UserPreferencesService`: `save()` / `load()` (Cookie).

## FilterService und WineFilter (Schnittstelle)
- `WineFilter`: `searchText: string`; `dropdowns: Record<string, string|null>` (country, type, producer, quality); `multiSelects: Record<string, string[]>` (grape, origin; leer = inaktiv); `yearFrom|yearTo|ratingFrom|ratingTo: number|null`; `tastingDateFrom|tastingDateTo: string|null`. `EMPTY_FILTER` = alle inaktiv. `NavigationFilter` ist Legacy-Typ, ungenutzt.
- Zustand (Signals): `filter`, `sortOption` (Standard `tasting_date_desc`), `viewMode` (`grid|list`, Standard `grid`), `infoToggleActive`, `visibleFilterFields: string[]` (aus Cookie). Berechnet: `searchFields` (Felder mit `filter_type = text-search`), `filteredWines` (`applyFiltersAndSort`), `hasActiveFilter`.
- Methoden: `clearAllFilters()` (nur Werte, nicht Sichtbarkeit/Sort/Ansicht), `updateFilter(patch)`, `setSortOption`, `setViewMode`, `toggleFilterField(field, visible)` (Ausblenden ruft `resetFilterKey`), `resetFilterKey(key)`. Änderungen an Sortierung, Ansicht und sichtbaren Filtern werden per `UserPreferencesService.save` gespeichert.
- Bereichsfilter: fehlender Wert (`null`) eines Weins fällt bei aktiver Grenze heraus. Preis-Sortierung: fehlender Preis zuletzt.

## Invarianten

- Filter: AND zwischen Feldern/Filterarten; OR innerhalb eines Multiselect-Feldes.
- Freitextsuche: case-insensitiv, nur über übergebene `searchFields` (schema-definierte `text-search`-Felder).
- Filterung erhält die Reihenfolge der Eingabe; Sortierung nur gemäß `SortOption`.
- `isPresent`: `false` für `null`, `undefined`, leeren/Whitespace-String, leeres Array; sonst `true`. Einzige Quelle der „leere Felder ausblenden"-Regel.
- `mediaSrc(file, kind)`: `null` bei nicht vorhandenem Wert, sonst `*_BASE + file`.
- Property 19 (UserPreferences Cookie-Roundtrip): `save` → `load` liefert strukturell gleiches Objekt für jede Kombination aus `visibleFilters`, `sortOption`, `viewMode`. Cookie `ws_prefs`, `path=/`, `SameSite=Strict`; speichert nur Feldnamen sichtbarer Filter, keine Filterwerte. *Validates: Req 19.1–19.3.* Test: weinliste (fast-check).
- Keine Abhängigkeit von `editor` oder `weinliste`; keine App-spezifische Datenbeschaffung (HTTP/FSA).

## Zählt als Shared-Änderung (Vertragsprüfung beider Apps nötig)

- Jede Änderung unter `frontend/projects/shared/**`, die obige Exporte/Invarianten berührt.
- Änderungen an `frontend/package.json`, `frontend/angular.json`, `frontend/tsconfig*.json` (inkl. `projects/*/tsconfig*.json`), globalen Styles.
