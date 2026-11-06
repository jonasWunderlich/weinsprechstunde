# Technik-Design: Angular-Frontend „Weinsprechstunde" (Tasks 15–22, Checkpoint 23)

## Overview

Dieses Dokument legt die konkrete technische Umsetzung des Angular-Frontends der App „Weinsprechstunde" fest. Es deckt die Implementierungs-Tasks 15–22 des Plans (`.kiro/specs/weinliste/tasks.md`) und den Abschluss-Checkpoint 23 ab: Projekt-Setup/Modelle/Datenservice, UserPreferencesService, FilterService inkl. der reinen `applyFiltersAndSort`-Funktion, Router/AppComponent/NavComponent, ControlsRow mit schema-gesteuerten Filtern, WineGrid/WineTile, WineList sowie WineDetailDialog — jeweils mit Teststrategie (Unit + Property-Based mit fast-check).

Das Frontend ist eine eigenständige Angular SPA, die ausschließlich die fertig generierte `wines.json` sowie `wine-schema.json` als statische Assets lädt (kein Laufzeit-Backend, keine Abhängigkeit zum Import-Skript). Zustand wird durchgängig mit Angular Signals verwaltet; der `FilterService` ist die einzige Quelle der Wahrheit für Filter-, Such-, Sortier- und Ansichtszustand. Styling ist reines SCSS im Light Mode ohne UI-Framework.

Die maßgebliche Architektur-Vorlage ist der Abschnitt „2. Angular Frontend" in `.kiro/specs/weinliste/design.md`. Dessen Pseudocode (Service-Signaturen, Pure-Funktion `applyFiltersAndSort`, Komponentenverträge, feste Overlay-/Dialog-Templates) ist verbindlich und wird hier auf eine vollständige, implementierbare Datei- und Verantwortungsstruktur heruntergebrochen. Designsprache (Farbpalette, Kachel-Layout, festes bordertes Info-Overlay, Rating-Kreis, Nav-Dropdowns, Pill-förmige Controls) wird aus der bestehenden Musikalben-App unter `existing_angular_app/` **sinngemäß übernommen, nicht kopiert**. Komponenten- und Dateinamen folgen der Spec (`wine-wall`, `wine-tile`, `wine-tile-overlay`, `wine-tile-cover`, `wine-list-item`, `controls-row`, `nav`, `sort-button`, `scroll-top-button`).

### Technologie-Stack (nach Design-Freigabe fixiert)

| Aspekt | Festlegung |
|---|---|
| Framework | Angular **22**, Standalone-Komponenten (kein NgModule) |
| Sprache | TypeScript (strict) |
| Reaktivität | Angular **Signals** durchgängig: `signal`, `computed`, `effect`, `input()`/`output()`, `inject()` |
| Change Detection | **zoneless** + `ChangeDetectionStrategy.OnPush` für alle Komponenten |
| Templates | Control Flow `@if`/`@for`/`@switch` (keine `*ngIf`/`*ngFor`) |
| HTTP | `HttpClient` via `provideHttpClient()`, `forkJoin` für paralleles Laden |
| Routing | Angular Router, `provideRouter(routes)` |
| Styling | reines SCSS, Light Mode, CSS-Variablen; **kein** Material/Tailwind/Bootstrap |
| Tests | Jasmine + Karma (Angular-Standard), Property-Tests mit **fast-check** (≥100 Iterationen) |
| Node/CLI | Node 24, Angular CLI 22.2.5 lokal (`npx ng …`), gemäß `.agents/tasks/frontend-setup.md` |

Das Projektgerüst existiert bereits (`frontend/`, Angular 22, zoneless/Signals, SCSS; `wines.json` mit 559 echten Weinen und `wine-schema.json` liegen unter `frontend/src/assets/`). Diese Dateien werden **nicht** überschrieben.

### Realitätscheck der Datenlage (prägt das gesamte UI)

Die ausgelieferte `wines.json` (559 Einträge, erzeugt mit `scaffold_mode=true`) hat eine wichtige Eigenschaft, die das Design bestimmt:

- **Alle** Schema-Felder sind in jedem Objekt vorhanden, aber überwiegend `null`. Fehlend ≠ null: Felder sind present-but-null.
- Reale Befüllung (gemessen): `price` ~117/559, `rating` nur ~4, `grape`/`country`/`producer`/`origin`/`year` nur ~2. `tasting_date`, `image`, `name`, `description` sind praktisch durchgängig gesetzt.
- Der inhaltliche Reichtum steckt in **Zusatzfeldern außerhalb des Schemas**: `taste_eye` (~119), `taste_nose` (~120), `taste_mouth` (~120), `conclusion_tobias/_wolfgang/_simon`, `development`, `percentage`, `spontansprechstunde`. Deren Werte sind Strings (auch numerisch gemeinte wie `percentage: "5"`).

Konsequenzen, die sich durch das ganze Design ziehen:
1. „Feld vorhanden" heißt im Frontend überall **truthy / nicht-null / nicht-leerer-String** — nie bloß „key existiert". Leere Felder werden konsequent ausgeblendet, es dürfen keine leeren Labels, keine `null`-Texte, keine leeren Rating-Kreise erscheinen.
2. Overlay und Listenzeile wirken bei vielen Weinen fast leer; das feste Template muss mit minimalem Inhalt (oft nur `name` + `tasting_date`) sauber aussehen.
3. Der WineDetailDialog ist der eigentliche Informationsträger. Seine generische Zusatzfelder-Sektion (`extraEntries`) zeigt den Großteil der realen Verkostungsinhalte und muss erstklassig gestaltet sein, nicht als Debug-Anhang.
4. Navigations-Dropdowns (Regionen aus `origin`, Rebsorten aus `grape`) sind aktuell dünn besetzt — die Zählung/Sortierung muss mit sehr wenigen Einträgen genauso korrekt funktionieren wie mit vielen.

---

## Dateistruktur (`frontend/src/app/`)

Flache, gut auffindbare Struktur in Anlehnung an die Album-App (`components/`, `services/`), aber mit Weinlisten-Namen und einem eigenen `models/`-Ordner für typsichere Modelle.

```
frontend/src/
├── main.ts                         (bestehend – bootstrapApplication)
├── styles.scss                     Design-Tokens (CSS-Variablen), globale Resets, Light Mode
├── assets/
│   ├── wines.json                  (bestehend, NICHT überschreiben)
│   └── wine-schema.json            (bestehend, NICHT überschreiben)
└── app/
    ├── app.ts                      AppComponent (Root: nav + outlet + global dialog + load/error)
    ├── app.html
    ├── app.scss
    ├── app.config.ts               provideRouter, provideHttpClient, zoneless
    ├── app.routes.ts               /, /region/:slug, /rebsorte/:slug, ** → ''
    ├── models/
    │   ├── wine.model.ts           Wine, WineFilter, NavigationFilter, EMPTY_FILTER, SortOption, LoadState
    │   ├── wine-schema.model.ts     WineSchemaField, FilterType
    │   └── user-preferences.model.ts  UserPreferences
    ├── services/
    │   ├── wine-data.service.ts     WineDataService (forkJoin, loadState)
    │   ├── filter.service.ts        FilterService (Single Source of Truth) + applyFiltersAndSort (export)
    │   └── user-preferences.service.ts  UserPreferencesService (Cookie ws_prefs)
    └── components/
        ├── wine-wall/               WineWallComponent (Route-Integration, Container)
        ├── nav/                     NavComponent (NavBar + Regionen/Rebsorten-Dropdowns)
        ├── controls-row/            ControlsRowComponent (Suche, Filter, Toggles, Sort)
        │   └── filter-field/        FilterFieldComponent (dynamisch je filter_type)
        ├── sort-button/             SortButtonComponent (Sortierauswahl)
        ├── wine-grid/               WineGridComponent (Kacheln, EndlessScroll, BackButtonTile)
        ├── wine-tile/               WineTileComponent
        │   ├── wine-tile-cover/     WineTileCoverComponent (Bild + PlaceholderIcon)
        │   └── wine-tile-overlay/   WineTileOverlayComponent (festes Template)
        ├── wine-list/               WineListComponent (Liste, EndlessScroll, BackButtonItem)
        │   └── wine-list-item/      WineListItemComponent
        ├── wine-detail-dialog/      WineDetailDialogComponent (modal, feste Gruppen + extraEntries)
        ├── rating-circle/           RatingCircleComponent (wiederverwendbar: Overlay + Dialog)
        └── scroll-top-button/       ScrollTopButtonComponent
```

Zwei bewusste Ergänzungen gegenüber der reinen Spec-Liste, begründet aus der Datenlage und DRY:
- **`rating-circle/`** als eigene Komponente, da der Rating-Kreis identisch im Overlay und im Dialog erscheint (Req 11.3, 13.3). Keine neue Designsprache, nur Wiederverwendung.
- **`filter-field/`** als Unterkomponente der ControlsRow, da Req 9.7–9.11 fünf Filtertypen fordern, deren Rendering sonst die ControlsRow überladen würde. Sie ist der einzige „dynamische" Teil des Frontends (schema-gesteuert); alle anderen Templates sind fest.

`BackButtonTile`/`BackButtonItem` werden **nicht** als eigene Komponenten, sondern als erstes bedingtes Element direkt in WineGrid bzw. WineList gerendert (Req 10.4, 12.5) — sie sind reine Darstellung ohne eigene Logik.

---

## Models (`app/models/`)

Exakt gemäß Design-Dokument „Data Models / TypeScript". Keine Abweichung. Kernpunkte:

```typescript
// wine.model.ts
export interface Wine {
  name: string;
  year?: number;
  country?: string;
  origin?: string;
  grape?: string | string[];
  type?: string;
  producer?: string;
  quality?: string | string[];
  price?: number;            // Schema: type "number", decimals 2; in wines.json in allen gesetzten Fällen float
  rating?: number;
  tasting_date?: string;     // ISO-8601
  image?: string;
  audio?: string;
  video?: string;
  description?: string;
  [key: string]: unknown;    // unbekannte Zusatzfelder typsicher (Req 14.7)
}

export interface WineFilter {
  searchText: string;
  // ein Slot je dropdown-Schemafeld (country, origin, type, producer, quality):
  // Wert = exakter Match oder null (inaktiv). Generisch statt fünf Einzelfeldern,
  // damit künftige Schema-dropdowns ohne Modelländerung mitgefiltert werden (Review-Finding 1).
  dropdowns: Record<string, string | null>;
  grape: string[];                 // multi-select (Req 9.7): leeres Array = inaktiv
  yearFrom: number | null;  yearTo: number | null;
  ratingFrom: number | null; ratingTo: number | null;
  tastingDateFrom: string | null; tastingDateTo: string | null;
}

export interface NavigationFilter { type: 'region' | 'rebsorte'; slug: string; }

// dropdowns wird mit allen dropdown-Schemafeldern auf null vorbelegt; fehlende
// Keys gelten ohnehin als inaktiv (siehe applyFiltersAndSort / hasActiveFilter).
export const EMPTY_FILTER: WineFilter = {
  searchText: '',
  dropdowns: { country: null, origin: null, type: null, producer: null, quality: null },
  grape: [],
  yearFrom: null, yearTo: null, ratingFrom: null, ratingTo: null,
  tastingDateFrom: null, tastingDateTo: null,
};

export type SortOption = 'tasting_date_desc' | 'tasting_date_asc' | 'rating_desc';
export type LoadState  = 'idle' | 'loading' | 'loaded' | 'error';
```

```typescript
// wine-schema.model.ts
export type FilterType =
  | 'text-search' | 'range' | 'date-range'
  | 'dropdown' | 'rating-range' | 'multi-select' | null;

export interface WineSchemaField {
  field: string;
  type: 'text' | 'number' | 'date' | 'multi-value';   // reales Schema nutzt nur diese vier
  filter_type: FilterType;
  default_filter: boolean;
  decimals?: number;   // nur type 'number': 0 = Integer (year), 1 = rating, 2 = price
}
```

**Abgleich mit dem realen `wine-schema.json` (maßgeblich, nicht der ältere `design.md`-Pseudocode):** Das echte Schema verwendet für die `type`-Union ausschließlich `text`, `number`, `date`, `multi-value`. Insbesondere hat `rating` `type: "number"` mit `decimals: 1` (nicht `type: "rating"`) und `price` `type: "number"` mit `decimals: 2`. Req 17.1 listet `rating` zwar als erlaubten `type`-Wert, im aktuellen Datenbestand tritt er aber nie auf; die Union wird daher am realen Schema ausgerichtet. Ein `rating`-Feld wird im Frontend **nicht** über `type` erkannt, sondern über `filter_type === 'rating-range'` bzw. `field === 'rating'` — das ist die stabile, schema-getreue Kennung. Die frühere Divergenz (`type: 'rating'`, `price: 'text'`) stammte aus dem veralteten Pseudocode und ist hiermit korrigiert.

Analog weicht auch `price` von Req 17.2 ab (Review-Finding 7): Req 17.2 nennt `price` als `(text, null, …)`, das reale `wine-schema.json` führt es jedoch als `type: "number"` / `filter_type: null` / `decimals: 2`, und das Modell setzt `price?: number`. Maßgeblich ist das reale Schema — verifiziert an `wines.json`, wo alle gesetzten Preise durchgängig Floats sind. Der Dialog formatiert `price` daher als Zahl über `formatPrice()` (de-Dezimalkomma, 2 Nachkommastellen, `€`), nicht als rohen Text.

```typescript
// user-preferences.model.ts
export interface UserPreferences {
  visibleFilters: string[];
  sortOption: SortOption;
  viewMode: 'grid' | 'list';
}
```

**Invarianten-Eigentümerschaft (Modelle):** Das Modell garantiert nur Form, nicht Werte. Die Invariante „leere Felder werden nicht gezeigt" liegt bei der Präsentationsschicht (Overlay/Dialog/ListItem), nicht beim Modell — zentralisiert über einen gemeinsamen Helfer `isPresent(value)` (siehe unten), damit `null`, `undefined`, `''` und leere Arrays überall identisch als „abwesend" gelten. Die Filter-AND-Invariante liegt ausschließlich in `applyFiltersAndSort` (siehe FilterService).

Gemeinsamer Helfer (in `models/` oder als kleine pure util), genutzt von allen Präsentationskomponenten:
```typescript
export function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
export function grapeList(w: Wine): string[] {
  return Array.isArray(w.grape) ? w.grape : (w.grape ? [w.grape] : []);
}
export function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
```
**`slugify`-Konsistenz (korrigiert, siehe Review-Finding 10):** `slugify` muss ausschließlich **frontend-intern** konsistent sein — die NavComponent erzeugt den Slug aus demselben Rohwert (`origin`/`grape`), gegen den `applyFiltersAndSort` matcht (`slugify(wine.origin) === navFilter.slug`). Beide Seiten des Vergleichs laufen durch denselben Helfer, daher ist der Treffer garantiert. Eine Konsistenz mit der Python-`slugify_name` (python-slugify) ist **nicht** nötig und wird hier auch nicht behauptet: Das Frontend liest keine vom Python-Skript erzeugten Slugs (die Slugs entstehen rein clientseitig aus den Rohwerten der geladenen `wines.json`). Die früher im Dokument behauptete Python-Konsistenz war eine unverifizierte Annahme und ist gestrichen.

Zusätzlich transliteriert der Helfer deutsche Umlaute (ä→ae, ö→oe, ü→ue, ß→ss), **bevor** Nicht-`[a-z0-9-]`-Zeichen entfernt werden. Grund: deutsche Regionen/Rebsorten (z. B. „Grüner Veltliner", „Württemberg") ergäben sonst unschöne Slugs wie `grner-veltliner`. Die Transliteration ist rein kosmetisch und ändert nichts an der internen Konsistenz, da Nav und Matcher denselben Helfer verwenden. Falls später Deep-Links aus Python-Slugs unterstützt werden sollen, muss die Regel exakt an python-slugify angeglichen werden; das ist aktuell nicht im Scope.

**Slug-Kollision bei Nav-Zählung vs. Match — akzeptierte Einschränkung (Review-Finding 8):** `countBy` gruppiert die Nav-Einträge nach **Rohwert** (z. B. „Grüner Veltliner"), während die Navigation und `applyFiltersAndSort` über `slugify(value)` matchen. Theoretisch könnten zwei verschiedene Rohwerte denselben Slug ergeben (z. B. „Grüner Veltliner" und „Gruener Veltliner" → `gruener-veltliner`); dann zeigte die Nav zwei getrennte Zähleinträge, deren Links beide auf denselben Slug führten und deren Counts einzeln nicht zur gemeinsam gefilterten Menge passten. Bei der aktuellen Realdatenlage (nur 2 befüllte `origin`/`grape`-Werte) tritt das nicht auf. Festlegung: Diese Kollision wird als **bei dieser Datenlage akzeptierte, bekannte Einschränkung** dokumentiert und nicht gesondert aufgelöst. Sollte sie mit mehr Daten relevant werden, ist der Fix, `countBy` nach `slugify(value)` zu gruppieren und je Slug einen Anzeige-Rohwert zu wählen — Nav-Gruppierung und Match liefen dann über dieselbe Schlüsselbasis. Für den aktuellen Scope bleibt die Rohwert-Gruppierung (lesbarere Anzeige-Labels, kein beobachtbares Problem).

### Medien-Basispfad (`IMAGE_BASE`, `mediaSrc`) — Review-Finding 1

Die Werte in `image`/`audio`/`video` sind **bloße Dateinamen ohne Verzeichnis** (z. B. `12-10-21-riesling.jpg`, `12-10-21-riesling.mp3`). Es gibt im Frontend kein Bildverzeichnis; das Import-Skript legt skalierte Bilder in `image_export_dir` (`./export/images`) ab und deployt sie per PhaseDeploy auf `deploy.remote_images_path` (`/var/www/images`), während die Angular-SPA selbst nach `deploy.remote_path` (`/var/www/html`, Web-Root) ausgeliefert wird. Bilder und Medien liegen auf dem Server somit unter der absoluten URL `/images/<datei>` **relativ zum Web-Root** — getrennt von den Angular-Assets.

Daraus folgt die verbindliche Festlegung eines zentralen Basispfads als Konstante (einzige Quelle der Medien-URL-Regel):

```typescript
// models/media.ts (oder in der gemeinsamen util-Datei)
export const IMAGE_BASE = '/images/';   // Server-Mount von deploy.remote_images_path, relativ zum Web-Root

export function mediaSrc(file: string | null | undefined): string | null {
  return isPresent(file) ? IMAGE_BASE + file : null;
}
```

`WineTileCoverComponent` und der `WineDetailDialog` (Bild/Audio/Video) benutzen **ausschließlich** `mediaSrc(...)` zum Bilden der URL; der rohe Dateiname wird nie direkt an `[src]` gebunden. `mediaSrc()` liefert `null`, wenn kein Dateiname gesetzt ist — der Aufrufer rendert das Element dann gar nicht bzw. zeigt das PlaceholderIcon (Cover).

**Lokale Bereitstellung (`ng serve` / Smoke-Test):** Damit `/images/<datei>` auch lokal auflöst, wird im Dev ein Angular-Dev-Proxy verwendet oder die Exportbilder werden unter `frontend/public/images` bereitgestellt. Verbindliche Festlegung: ein Symlink `frontend/public/images → ../../export/images` (Angular liefert `public/` unter Web-Root aus, siehe `frontend-setup.md`), sodass dieselbe absolute URL `/images/<datei>` lokal wie in Produktion funktioniert, ohne den Code zu ändern. Alternativ ein `proxy.conf.json`-Eintrag, falls die Bilder nur auf dem Server liegen. Der Symlink ist bevorzugt, weil er keinen zusätzlichen Prozess braucht und produktionsidentische URLs liefert. `export/images` und `frontend/public/images` werden **nicht** committet (reine Build-/Dev-Artefakte).

### Wertabbildungs-Helfer `distinctValuesForField` und `countBy` — Review-Findings 7 & 8

Beide Helfer sind pure Funktionen (DOM-frei, Property-testbar) und bilden die **einzige** Quelle der Vorschlagswerte für dropdown/multi-select-Filter (`distinctValuesForField`) bzw. der Nav-Zählungen (`countBy`). Multi-value-Felder (`grape`, `quality` können `string | string[]` sein) werden über einen gemeinsamen `valueList`-Helfer flach ausgerollt; alle Werte werden über `isPresent` gefiltert und `localeCompare('de')`-sortiert.

```typescript
// Rollt ein (ggf. multi-value) Feld eines Weins zu einer flachen String-Liste aus
export function valueList(w: Wine, field: string): string[] {
  const raw = w[field];
  if (Array.isArray(raw)) return raw.filter(isPresent).map(String);
  return isPresent(raw) ? [String(raw)] : [];
}

// Distinct, present-gefilterte, de-sortierte Vorschlagswerte eines Feldes (dropdown/multi-select)
export function distinctValuesForField(wines: Wine[], field: string): string[] {
  const set = new Set<string>();
  for (const w of wines) for (const v of valueList(w, field)) set.add(v);
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

// Zählkarte {value,count}[] für Nav-Anzeige; überspringt present-but-null; de-sortiert
export function countBy(
  wines: Wine[],
  toValues: (w: Wine) => (string | null | undefined)[],
): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const w of wines) for (const v of toValues(w)) if (isPresent(v)) m.set(v!, (m.get(v!) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'de'))
    .map(([value, count]) => ({ value, count }));
}
```

Festlegungen und Verdrahtung:
- **`distinctValuesForField`** behandelt `grape`/`quality` über `valueList` als multi-value (flach ausgerollt), alle anderen Felder als Einzelwert; filtert `isPresent` (kein leerer Vorschlag); sortiert `localeCompare('de')`. Rückgabe sind reine `string[]` (ohne Count), weil die Filter-Dropdowns nur Werte brauchen.
- **Alle dropdown- und das multi-select-Filterfeld** beziehen ihre Optionen **durchgängig** aus `distinctValuesForField(this.data.wines(), this.field().field)`. Das ist die einzige Optionsquelle der `FilterFieldComponent` (siehe dort); es gibt keine zweite Quelle.
- **`countBy`** liefert `{value,count}[]` und dient **ausschließlich** den Nav-Dropdowns (Req 8.5/8.6, Anzeige „Rheingau (7)"). `availableRegions = countBy(wines, w => [w.origin])`, `availableGrapes = countBy(wines, w => valueList(w, 'grape'))`. Das frühere `availableCountries` (nur `string[]` ohne Count) entfällt — Länder sind ein dropdown-Filter und beziehen ihre Werte wie alle anderen dropdowns aus `distinctValuesForField`, nicht aus einem eigenen FilterService-Computed.

---

## Services

### WineDataService (Task 15.2 — Req 7.1–7.5, 17.4)

**Verantwortung:** Einmaliges, paralleles Laden von `wines.json` und `wine-schema.json`; Bereitstellung als Signals; Verwaltung des Ladezustands. Keine Filterlogik, keine Routen-Kenntnis.

```typescript
@Injectable({ providedIn: 'root' })
export class WineDataService {
  private readonly http = inject(HttpClient);

  readonly wines     = signal<Wine[]>([]);
  readonly schema    = signal<WineSchemaField[]>([]);
  readonly loadState = signal<LoadState>('idle');

  loadAll(): void {
    if (this.loadState() !== 'idle') return;     // kein Reload bei Routenwechsel
    this.loadState.set('loading');
    forkJoin({
      wines:  this.http.get<Wine[]>('assets/wines.json'),
      schema: this.http.get<WineSchemaField[]>('assets/wine-schema.json'),
    }).pipe(
      catchError(() => { this.loadState.set('error'); return EMPTY; })
    ).subscribe(({ wines, schema }) => {
      this.wines.set(wines);
      this.schema.set(schema);
      this.loadState.set('loaded');
    });
  }
}
```

Entscheidungen und Begründungen:
- **`forkJoin`** statt zwei getrennter Requests: beide Assets werden gemeinsam benötigt, bevor UI/Filter sinnvoll arbeiten; ein kombinierter „loaded"-Übergang vermeidet Zwischenzustände (Req 7.1, 17.4). Gewählt gegenüber `Promise.all`/`fetch`, weil `HttpClient` testbar (HttpTestingController) und Angular-idiomatisch ist.
- **Guard `loadState() !== 'idle'`**: garantiert einmaliges Laden; wiederholte `loadAll()`-Aufrufe (z. B. bei Routenwechsel, falls jemals aufgerufen) sind No-ops (Req 7.5). `loadAll()` wird ausschließlich einmal in `AppComponent.ngOnInit` aufgerufen; Routenwechsel triggern es nie (Req 7.7, 14.9).
- **Asset-Pfad relativ** (`assets/...`, kein führender Slug-Slash) passend zur Angular-Build-Asset-Auslieferung (`dist/.../browser/assets/`, siehe `frontend-setup.md`). Hinweis gegenüber dem Design-Pseudocode, der `/assets/...` schreibt: relativer Pfad ist robuster bei Deployment in ein Unterverzeichnis; dies ist die bewusste Festlegung.

**Fehlerbehandlung konkret:**

| Operation | Fehlerbedingung | Recoverable? | Caller erhält | Logging |
|---|---|---|---|---|
| `GET assets/wines.json` oder `assets/wine-schema.json` | Netzwerk-/HTTP-Fehler, ungültiges JSON (Parse-Error im HttpClient) | Fatal für den App-Start (keine Daten darstellbar) | `loadState()` wird `'error'`; `wines()`/`schema()` bleiben leere Arrays | `console.error` mit Statuscode/URL im `catchError` (einmalig, kein Secret involviert) |

Die App zeigt daraufhin die Fehlermeldung im Hauptbereich (Req 7.4), kein Crash, keine Exception nach außen. Ein Retry ist bewusst nicht Teil dieser Tasks (nicht in Req); ein manuelles Neuladen der Seite ist die Recovery.

**Validierung externer Eingabe (`wines.json`):** Die Daten gelten als vom eigenen Import-Skript erzeugt (vertrauenswürdige Quelle), werden aber defensiv behandelt: Zugriffe erfolgen nur über die typisierte `Wine`-Schnittstelle und `isPresent`; kein `innerHTML`/`[innerHTML]` für Weinwerte (XSS-Schutz durch Angulars Default-Interpolation). Medien-URLs (`audio`/`video`/`image`) werden als Attribut-Bindung (`[src]`) gesetzt — Angular sanitisiert `src` kontextbezogen. Es findet keine Schema-Pflichtfeld-Validierung statt (nicht gefordert); fehlende/`null`-Werte werden wie überall über `isPresent` toleriert.

### UserPreferencesService (Task 16.1 — Req 18.1–18.6)

**Verantwortung:** Lesen/Schreiben des Cookies `ws_prefs` (ohne festes Ablaufdatum). Speichert **nur** Konfiguration (welche Zusatzfilter sichtbar sind, Sortierung, Ansicht) — **nie** Filterwerte (Req 18.3).

```typescript
const COOKIE_NAME = 'ws_prefs';
const DEFAULT_PREFS: UserPreferences = {
  visibleFilters: [],
  sortOption: 'tasting_date_desc',
  viewMode: 'grid',
};

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  load(): UserPreferences {
    try {
      const raw = this._getCookieValue(COOKIE_NAME);
      if (!raw) return { ...DEFAULT_PREFS };
      return { ...DEFAULT_PREFS, ...JSON.parse(decodeURIComponent(raw)) };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  save(prefs: UserPreferences): void {
    const value = encodeURIComponent(JSON.stringify(prefs));
    document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=31536000; SameSite=Strict`;
  }

  private _getCookieValue(name: string): string | null {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? match[1] : null;
  }
}
```

Entscheidungen und Begründungen:
- **`max-age=31536000` (1 Jahr) statt gar kein Max-Age.** Der Design-Pseudocode setzt kein Max-Age → das ergäbe ein Session-Cookie, das beim Browser-Schließen verfällt. Req 18.1 verlangt „ohne festes Ablaufdatum" im Sinne von *persistent über Besuche hinweg* (Req 18-User-Story: „zwischen Besuchen beibehält"). Ein Session-Cookie widerspräche dem. Gewählt: langes, gleitendes Max-Age (bei jedem `save()` erneuert) → verhält sich praktisch wie „läuft nicht ab", bleibt aber ein persistenter Cookie. **Diese Abweichung vom Pseudocode ist beabsichtigt und auf die Requirements abgestimmt.**
- **`SameSite=Strict`**, `path=/`. Kein `Secure`-Flag erzwungen, da die öffentliche Weinliste auch unter HTTP lokal testbar bleiben muss; es werden keine sensiblen Daten gespeichert (nur UI-Vorlieben).
- **Defensives `load()`**: fehlender/korrupter Cookie → Defaults; `{ ...DEFAULT_PREFS, ...parsed }` toleriert künftige neue Felder und fehlende alte (Vorwärts-/Rückwärtskompatibilität).

**Validierung Cookie-Inhalt:** `load()` validiert nicht feingranular (z. B. ob `sortOption` ein gültiger `SortOption` ist). Das ist akzeptabel, weil ein manipulierter Cookie nur die eigene Ansicht beeinflusst (kein Sicherheitsrisiko, kein geteilter Zustand). `applyFiltersAndSort` behandelt eine unbekannte `sortOption` über den Default-Zweig (tasting_date_desc), und ein unbekannter `visibleFilters`-Eintrag wird von der ControlsRow ignoriert (nur Schnittmenge mit Schema-Feldern wird gerendert). Damit ist ein korrupter Cookie harmlos.

**Eigentümerschaft:** Dieser Service kennt den FilterService nicht. Der FilterService ruft `load()` im Konstruktor und `save()` bei jeder relevanten Änderung auf. So bleibt die Cookie-Serialisierung an einer Stelle gekapselt (Req 18.5: „sofort aktualisieren").

### FilterService + applyFiltersAndSort (Task 17.1/17.2 — Req 7.6, 9.*, 14.10, 18.4/18.5)

**Verantwortung:** Einzige Quelle der Wahrheit für den gesamten Filter-, Such-, Sortier- und Ansichtszustand (Req 7.6, 14.10). Keine andere Komponente hält filterrelevanten Zustand. Berechnet die gefilterte/sortierte Liste sowie die Navigations-Metadaten (Regionen/Rebsorten mit Count). Persistiert Vorlieben über den UserPreferencesService.

#### Zustand (Signals)

| Signal | Typ | Zweck |
|---|---|---|
| `filter` | `signal<WineFilter>` | ControlsRow-Filterwerte (Suche, Dropdowns, Ranges) |
| `navigationFilter` | `signal<NavigationFilter \| null>` | URL-basierter Region-/Rebsorten-Filter |
| `sortOption` | `signal<SortOption>` | aktive Sortierung |
| `viewMode` | `signal<'grid' \| 'list'>` | Kachel- vs. Listenansicht |
| `infoToggleActive` | `signal<boolean>` | InfoToggle (Overlay dauerhaft) |
| `visibleFilterFields` | `signal<string[]>` | zusätzlich eingeblendete Filter (aus Cookie) |

#### Konstruktor: Cookie-Init + Default aus Schema

```typescript
constructor() {
  const saved = this.prefs.load();
  this.sortOption.set(saved.sortOption);
  this.viewMode.set(saved.viewMode);
  this.visibleFilterFields.set(saved.visibleFilters);
}
```

Zu Req 18.6 („wenn kein Cookie: Default aus Schema `default_filter: true`"): Die **Standard-Filter sind in der ControlsRow fest verdrahtet** (Suche, grape, rating, tasting_date — Req 9.3) und immer sichtbar, unabhängig vom Cookie. `visibleFilterFields` enthält **nur zusätzlich eingeblendete** Felder. Ein leerer Cookie (`visibleFilters: []`) ist daher der korrekte Default: Standard-Filter sichtbar, keine Extra-Filter. Falls eine strengere Lesart von 18.6 gewünscht ist (Extra-Defaults aus Schema), bleibt ein Hook: Die ControlsRow berechnet die sichtbaren Felder als Vereinigung aus „fest" und `visibleFilterFields`; eine spätere Initialisierung von `visibleFilterFields` aus `schema.filter(f => f.default_filter)` wäre additiv möglich. Für diese Tasks gilt die einfache, requirements-konforme Variante (leerer Default).

#### Computed-Werte

```typescript
// text-search-Felder schema-abgeleitet (Req 9.2) — aktuell nur 'name'
readonly searchFields = computed(() =>
  this.wineData.schema().filter(f => f.filter_type === 'text-search').map(f => f.field)
);

readonly filteredWines = computed(() =>
  applyFiltersAndSort(
    this.wineData.wines(),
    this.filter(),
    this.navigationFilter(),
    this.sortOption(),
    this.searchFields(),
  )
);

// Nav-Zählungen (nur für die NavComponent, Req 8.5/8.6)
readonly availableRegions = computed(() => countBy(this.wineData.wines(), w => [w.origin]));
readonly availableGrapes  = computed(() => countBy(this.wineData.wines(), w => valueList(w, 'grape')));

// Zurück-Button-Steuerung — feldweise explizit (Review-Finding 5),
// mit korrektem grape-Array-Term und dropdowns-Menge (Review-Findings 1 & 2)
readonly hasActiveFilter = computed(() => {
  const f = this.filter();
  return this.navigationFilter() !== null
    || f.searchText.trim() !== ''
    || f.grape.length > 0
    || Object.values(f.dropdowns).some(v => v !== null)
    || f.yearFrom !== null || f.yearTo !== null
    || f.ratingFrom !== null || f.ratingTo !== null
    || f.tastingDateFrom !== null || f.tastingDateTo !== null;
});
```

`availableRegions`/`availableGrapes` liefern `{ value, count }[]`, alphabetisch nach `value` sortiert (`localeCompare`, de-Locale), für die Nav-Anzeige „Rheingau (7)" (Req 8.5/8.6). `countBy` (siehe gemeinsame Helfer oben) reduziert eine Wertabbildung (ein Wert pro Wein bzw. Liste bei grape über `valueList`) auf eine Zählkarte und überspringt leere Werte (`isPresent`). So tauchen `null`-Herkünfte/Rebsorten nicht als „ (557)"-Phantomeintrag auf — entscheidend bei der dünnen Realdatenlage. Ein früheres `availableCountries` gibt es nicht mehr: Länder sind ein dropdown-Filter und beziehen ihre Vorschlagswerte wie alle anderen dropdowns aus `distinctValuesForField` (siehe FilterFieldComponent); die Nav zeigt keine Länder an.

**`hasActiveFilter` ist feldweise explizit definiert (Review-Finding 5)** statt generisch über `Object.entries`. Grund: Eine generische `v !== null && v !== ''`-Prüfung über alle `WineFilter`-Felder koppelt die Aktiv-Erkennung an die exakte Feldmenge und würde ein legitimes numerisches `0` (z. B. bei einem künftig `0`-fähigen Range-Feld) fälschlich als aktiven Filter werten und den Zurück-Button auslösen (Req 10.4/12.5). Die explizite Prüfung je Feld plus getrimmter `searchText` ist robust gegen Felderweiterungen und gegen den „present-but-null"-Fallstrick. Zwei Terme sind dabei typkorrekt gewählt (Review-Findings 1 & 2): `grape` ist ein `string[]` und wird über `f.grape.length > 0` geprüft (nie `!== null`, was immer wahr wäre); die fünf dropdown-Felder leben im `dropdowns`-Record und werden gesammelt über `Object.values(f.dropdowns).some(v => v !== null)` geprüft (ein einzelnes `f.country` gäbe es nicht mehr und würde origin/type/producer/quality übersehen). Der Button wird korrekt sowohl durch Navigations- als auch durch ControlsRow-Filter ausgelöst.

#### Methoden (Signaturen)

```typescript
setNavigationFilter(type: 'region' | 'rebsorte', slug: string): void;  // setzt navigationFilter
clearNavigationFilter(): void;                                         // navigationFilter = null
clearAllFilters(): void;        // filter = { ...EMPTY_FILTER }; navigationFilter = null — NUR Werte, keine Konfiguration
setSortOption(opt: SortOption): void;   // + _savePrefs()
setViewMode(mode: 'grid' | 'list'): void; // + _savePrefs()
toggleFilterField(field: string, visible: boolean): void; // visibleFilterFields +/- field, + _savePrefs()
updateFilter(patch: Partial<WineFilter>): void;  // ControlsRow setzt einzelne Filterwerte
private _savePrefs(): void;     // prefs.save({ visibleFilters, sortOption, viewMode })
```

`updateFilter` ist gegenüber dem Design-Pseudocode ergänzt: Die ControlsRow braucht einen typsicheren Weg, einzelne `WineFilter`-Felder zu setzen (z. B. `updateFilter({ searchText: q })`, `updateFilter({ ratingFrom: 6 })`), ohne das ganze Objekt zu ersetzen. Intern: `this.filter.update(f => ({ ...f, ...patch }))`. Filterwerte landen **nie** im Cookie (Req 18.3), daher ruft `updateFilter` **kein** `_savePrefs()`.

**Reset-Semantik von `clearAllFilters()` (Review-Finding 6):** `clearAllFilters()` setzt ausschließlich die **Filterwerte** zurück: `this.filter.set({ ...EMPTY_FILTER })` (frische Kopie, inkl. des mit allen fünf dropdown-Keys auf `null` vorbelegten `dropdowns`-Records) und `this.navigationFilter.set(null)`. **Unverändert** bleiben `visibleFilterFields`, `sortOption`, `viewMode` und `infoToggleActive` — das sind Konfiguration, kein Filterwert (Req 18.2/18.3). Konkret: die über „Mehr Filter" eingeblendeten Zusatzfelder bleiben nach „Zurück" sichtbar (nur geleert), weil ihre Sichtbarkeit persistierte Konfiguration ist und nicht mitgelöscht werden darf. `clearAllFilters()` ruft daher **kein** `_savePrefs()` (es ändert keine Konfiguration). `goBack()` in Grid/List und `goHome()` in der Nav rufen `clearAllFilters()` und navigieren auf `/`; auch sie fassen `visibleFilterFields`/`sortOption`/`viewMode` nicht an. `EMPTY_FILTER` ist die **einzige** Quelle der Leerform und entspricht exakt der oben definierten `dropdowns`-Record-Fassung (eine Quelle, keine Divergenz zur FilterField-Verdrahtung).

`setNavigationFilter` erhält aktuell einen bereits erzeugten Slug aus der URL. Zur Anzeige-Konsistenz wird der Slug in `applyFiltersAndSort` gegen `slugify(wine.origin)` / `slugify(grape)` verglichen (siehe unten) — so ist die Zuordnung unabhängig davon robust, ob die Nav den Slug aus Rohwert erzeugt.

#### Reine Funktion `applyFiltersAndSort` (exportiert, DOM-frei, Property-testbar)

Verbindlich gemäß Design-Pseudocode. Festlegungen zur AND-Semantik und Korrektheit:

```typescript
export function applyFiltersAndSort(
  wines: Wine[],
  filter: WineFilter,
  navFilter: NavigationFilter | null,
  sort: SortOption,
  searchFields: string[],   // schema-abgeleitet: alle Felder mit filter_type === 'text-search' (Req 9.2)
): Wine[] {
  const filtered = wines.filter(wine => {
    // 1. Navigation-Filter (Slug-Vergleich über slugify)
    if (navFilter) {
      if (navFilter.type === 'region') {
        if (!wine.origin || slugify(wine.origin) !== navFilter.slug) return false;
      } else {
        if (!grapeList(wine).some(g => slugify(g) === navFilter.slug)) return false;
      }
    }
    // 2. Freitextsuche: case-insensitiv, NUR über schema-definierte text-search-Felder
    if (filter.searchText.trim()) {
      const q = filter.searchText.toLowerCase().trim();
      const haystacks = searchFields.flatMap(f => valueList(wine, f));
      if (!haystacks.some(h => h.toLowerCase().includes(q))) return false;
    }
    // 3. Dropdown-Filter (country, origin, type, producer, quality) — generisch über dropdowns-Record
    for (const [field, sel] of Object.entries(filter.dropdowns)) {
      if (sel != null && String(wine[field] ?? '') !== sel) return false;
    }
    // multi-select grape: OR innerhalb des Feldes (Req 9.7), AND gegenüber anderen Feldern (Req 9.12)
    if (filter.grape.length > 0) {
      const wineGrapes = grapeList(wine);
      if (!filter.grape.some(g => wineGrapes.includes(g))) return false;
    }
    // 4. Range-Filter (null = Grenze inaktiv; fehlender Wert fällt bei aktiver Grenze raus)
    if (filter.yearFrom   != null && (wine.year   == null || wine.year   < filter.yearFrom))   return false;
    if (filter.yearTo     != null && (wine.year   == null || wine.year   > filter.yearTo))     return false;
    if (filter.ratingFrom != null && (wine.rating == null || wine.rating < filter.ratingFrom)) return false;
    if (filter.ratingTo   != null && (wine.rating == null || wine.rating > filter.ratingTo))   return false;
    // date-range symmetrisch zur year/rating-Regel: fehlendes Datum fällt bei aktiver Grenze raus (Review-Finding 3)
    if (filter.tastingDateFrom != null && (wine.tasting_date == null || wine.tasting_date < filter.tastingDateFrom)) return false;
    if (filter.tastingDateTo   != null && (wine.tasting_date == null || wine.tasting_date > filter.tastingDateTo))   return false;
    return true;
  });

  return filtered.slice().sort((a, b) => {
    if (sort === 'tasting_date_asc') return (a.tasting_date ?? '').localeCompare(b.tasting_date ?? '');
    if (sort === 'rating_desc')      return (b.rating ?? 0) - (a.rating ?? 0);
    return (b.tasting_date ?? '').localeCompare(a.tasting_date ?? ''); // tasting_date_desc (Default)
  });
}
```

Entscheidungen:
- **AND-Logik (Req 9.12):** Jeder nicht-neutrale Filter ist eine eigene `return false`-Bedingung; ein Wein überlebt nur, wenn er alle aktiven Kriterien erfüllt. Property 11 prüft genau das.
- **multi-select grape (Req 9.7/9.12) — Mehrfachauswahl (Review-Finding 4):** `filter.grape` ist ein `string[]`. Semantik: **OR innerhalb** des Grape-Feldes (ein Wein passt, wenn eine seiner Rebsorten in der Auswahl liegt), **AND gegenüber** allen anderen Filterfeldern. Ein leeres Array = Kriterium inaktiv. Das erfüllt Req 9.7 (Mehrfachauswahl) vollständig; die frühere Einzelauswahl-Reduktion ist aufgehoben. `grapeList(wine)` rollt auch Array-Grapes aus, sodass sowohl `string`- als auch `string[]`-Weindaten korrekt getroffen werden.
- **Freitextsuche (Req 9.2) — schema-getreu (Review-Finding 6):** Req 9.2 fordert, dass die Suche **ausschließlich** die Felder vergleicht, deren `filter_type` im WineSchema `text-search` ist. Im echten `wine-schema.json` ist das **nur** `name`. Die durchsuchte Feldmenge wird daher **nicht hartkodiert und nicht um Kontextfelder (year/grape/producer/origin) erweitert**, sondern als Parameter `searchFields` übergeben, den der FilterService schema-abgeleitet berechnet (`schema().filter(f => f.filter_type === 'text-search').map(f => f.field)`). Fügt ein späteres Schema weitere `text-search`-Felder hinzu, erweitert sich die Suche automatisch — ohne Codeänderung und ohne Abweichung von Req 9.2. Damit prüft Property 10 gegen genau die schema-definierte Feldmenge, die auch die Implementierung nutzt (eine Quelle, kein Drift). Pro Wein werden die Werte der `searchFields` über `valueList` ausgerollt (robust gegen multi-value), damit die Suche auch bei Array-Werten korrekt arbeitet. Eine Erweiterung der Suche auf Kontextfelder wäre nur zulässig, wenn zuvor Schema **und** Req 9.2 entsprechend fortgeschrieben würden; das ist nicht Teil dieses Scopes.
- **Range + fehlender Wert (year, rating UND tasting_date):** Bei aktiver Grenze fliegen Weine mit `null`-Wert raus (ein Wein ohne `rating` erfüllt `ratingFrom=6` nicht). Diese Regel gilt für alle drei Range-Felder symmetrisch — auch für `tasting_date`: bei aktiver `tastingDateFrom` **oder** `tastingDateTo` fällt ein Wein ohne `tasting_date` heraus (Review-Finding 3). Die frühere `?? ''`-Behandlung war asymmetrisch (Wein ohne Datum blieb bei aktiver `To`-Grenze fälschlich drin); jetzt wird `wine.tasting_date == null` wie bei year/rating explizit geprüft. Das ist bei nur ~4 bewerteten bzw. ~2 fehlenden Datumswerten eine spürbare, aber korrekte und spezifizierte Semantik.
- **Sortierung stabil & rein:** `slice()` vor `sort` vermeidet Mutation der Eingabe (wichtig, da Eingabe ein Signal-Wert ist). `localeCompare` auf ISO-Datumsstrings ist für `YYYY-MM-DD` ordnungserhaltend. Reihenfolge-Erhalt beim Rendern wird separat durch WineGrid/WineList garantiert (Property 14).

**Eigentümerschaft der Filter-Invariante:** vollständig in `applyFiltersAndSort`. Keine Komponente filtert selbst; Grid/List slicen nur die bereits gefilterte/sortierte Liste für EndlessScroll.

---

## Routing & Container

### app.config.ts (Task 18.1)

```typescript
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(),
  ],
};
```

Kein `provideClientHydration` (keine SSR nötig für diese statische SPA). `provideHttpClient()` ersetzt das Backend-Api-Provider-Muster der Album-App. **`withComponentInputBinding()` wird bewusst NICHT aktiviert (Review-Finding 9):** Die WineWallComponent liest ihre Navigations-Metadaten über einen reaktiven Stream (`params` + `data`, siehe unten), nicht über `input()`-Bindings. Ein aktiviertes, aber ungenutztes `withComponentInputBinding()` würde zwei einander widersprechende Routing-Muster suggerieren und Implementierer verwirren.

### app.routes.ts (Task 18.1 — Req 14.9)

```typescript
export const routes: Routes = [
  { path: '',               component: WineWallComponent },
  { path: 'region/:slug',   component: WineWallComponent, data: { navType: 'region' } },
  { path: 'rebsorte/:slug', component: WineWallComponent, data: { navType: 'rebsorte' } },
  { path: '**',             redirectTo: '' },
];
```

Alle drei Routen rendern dieselbe `WineWallComponent`. Da die Komponente über alle Routen hinweg **nicht neu instanziiert wird** (gleiche Komponente, nur Parameteränderung), lösen Routenwechsel keine Re-Mounts und erst recht keine HTTP-Requests aus (Req 7.5, 14.9). **Der Navigationstyp (region vs. rebsorte) wird robust über `route.data` je Route gesetzt (Review-Finding 9)** statt über `routeConfig?.path`. Da `data` und `params` beide vom `ActivatedRoute`-Stream kommen, bleiben sie bei jedem Routenwechsel konsistent — auch bei geteilter Komponenteninstanz ohne Re-Mount. `WineWallComponent` reagiert über `combineLatest([params, data])` (siehe unten).

### AppComponent (Task 18.1 — Req 7.3, 7.4, 13.1)

Root-Shell: dauerhafte NavBar, Router-Outlet, globaler DetailDialog, Lade-/Fehleranzeige. Der „aktuell geöffnete Wein" liegt ausschließlich im `DialogService` (`dialog.wine()`); die AppComponent bindet diesen Zustand nur an den Dialog, hält selbst keinen eigenen Wein-Zustand (ein Dialog, egal ob aus Grid oder List geöffnet).

```typescript
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavComponent, RouterOutlet, WineDetailDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit {
  readonly dataService = inject(WineDataService);
  readonly dialog      = inject(DialogService);
  ngOnInit(): void { this.dataService.loadAll(); }
}
```

`app.html`:
```html
<app-nav />
<main>
  @switch (dataService.loadState()) {
    @case ('loading') { <div class="state state--loading">Lade Weine…</div> }
    @case ('error')   { <div class="state state--error">Fehler beim Laden der Weindaten. Bitte Seite neu laden.</div> }
    @default          { <router-outlet /> }
  }
</main>
<app-wine-detail-dialog [wine]="dialog.wine()" (close)="dialog.close()" />
```

**Dialog-Öffnung aus beliebiger Tiefe (eindeutig über `DialogService`, Review-Finding 11):** Der Dialog gehört der AppComponent (ein globaler Dialog über dem Router-Outlet). Als einzige Mechanik dient ein schlanker, dedizierter `DialogService` (`@Injectable({ providedIn: 'root' })`):

```typescript
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly wine = signal<Wine | null>(null);
  open(w: Wine): void { this.wine.set(w); }
  close(): void       { this.wine.set(null); }
}
```

WineTile/WineListItem rufen aus beliebiger Tiefe `dialog.open(wine)`; die AppComponent bindet `[wine]="dialog.wine()"` und schließt über `(close)="dialog.close()"`. Begründung: Das vermeidet das Durchreichen von `openDetail`-Outputs über den Router-Outlet und hält den UI-Transientzustand („offener Wein") sauber getrennt vom FilterService (der ausschließlich Filter-/Sortier-/Ansichtszustand besitzt). Es gibt **kein** lokales `selectedWine`-Signal in der AppComponent oder WineWallComponent — der `DialogService` ist die einzige Zustandsquelle für den geöffneten Wein. Grid/List injizieren den `DialogService` direkt und rufen in ihrem `openDetail(w)`-Handler `dialog.open(w)` (siehe WineGrid), sodass auch hier kein Output über den Outlet wandert.

### WineWallComponent (Task 18.3 — Req 7.7, 8.9)

Container, der Route-Parameter in den FilterService überträgt und je `viewMode` Grid oder List rendert. Lädt **keine** Daten.

```typescript
@Component({
  selector: 'app-wine-wall',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ControlsRowComponent, WineGridComponent, WineListComponent, ScrollTopButtonComponent],
  templateUrl: './wine-wall.html',
})
export class WineWallComponent {
  private readonly route         = inject(ActivatedRoute);
  private readonly destroyRef    = inject(DestroyRef);
  readonly filterService         = inject(FilterService);

  constructor() {
    // params und data stammen aus demselben ActivatedRoute-Stream → konsistent pro Emission,
    // auch bei geteilter Komponenteninstanz ohne Re-Mount (Review-Finding 9)
    combineLatest([this.route.params, this.route.data])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, data]) => {
        const slug = params['slug'];
        const navType = data['navType'] as 'region' | 'rebsorte' | undefined;
        if (!slug || !navType) { this.filterService.clearNavigationFilter(); return; }
        this.filterService.setNavigationFilter(navType, slug);
      });
  }
}
```

Der Typ kommt aus `route.data.navType` (in den Routen gesetzt), nicht aus `route.snapshot.routeConfig?.path`. `combineLatest([params, data])` emittiert bei jedem Routenwechsel ein konsistentes Paar, und `takeUntilDestroyed(destroyRef)` räumt die Subscription sauber ab (zoneless-konform). Für die Basisroute `''` fehlt `navType` → `clearNavigationFilter()`.

`wine-wall.html`:
```html
<app-controls-row />
@if (filterService.viewMode() === 'grid') { <app-wine-grid /> }
@else                                      { <app-wine-list /> }
<app-scroll-top-button />
```

Beim Verlassen eines Navigationsfilters (Route `''`) wird der Filter zurückgesetzt (Req 8.10 — Logo-Klick navigiert auf `/`, was hier `clearNavigationFilter` auslöst). ControlsRow-Filter bleiben beim Ansichtswechsel erhalten, da sie im FilterService leben (Req 9.19).

**Edge Case:** Direkter Aufruf einer Slug-Route, deren Slug zu keinem Wein passt → `filteredWines()` ist leer → Grid/List zeigen „Keine Weine gefunden" (Req 10.3, 12.4). Kein Fehler.

---

## NavComponent (Task 18.2 — Req 8.1–8.10, 14.8)

**Verantwortung:** dauerhafte NavBar mit Logo-Platzhalter links, App-Name „Weinsprechstunde", und zwei Dropdown-Menüs „Regionen"/„Rebsorten" mit Count. Navigiert per Router auf Slug-Routen und schließt das Menü. Logo/Home setzt Filter zurück.

```typescript
@Component({
  selector: 'app-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './nav.html',
  styleUrl: './nav.scss',
})
export class NavComponent {
  private readonly router        = inject(Router);
  private readonly filterService = inject(FilterService);

  readonly regionsOpen = signal(false);
  readonly grapesOpen  = signal(false);
  readonly regions = this.filterService.availableRegions;   // {value, count}[]
  readonly grapes  = this.filterService.availableGrapes;

  toggleRegions(): void { this.grapesOpen.set(false); this.regionsOpen.update(v => !v); }
  toggleGrapes(): void  { this.regionsOpen.set(false); this.grapesOpen.update(v => !v); }

  navigateToRegion(value: string): void {
    this.router.navigate(['/region', slugify(value)]);
    this.regionsOpen.set(false);
  }
  navigateToGrape(value: string): void {
    this.router.navigate(['/rebsorte', slugify(value)]);
    this.grapesOpen.set(false);
  }
  goHome(): void {
    this.filterService.clearAllFilters();
    this.router.navigate(['/']);
  }
}
```

Designsprache (aus Album-`nav` übernommen, nicht kopiert): weiße Leiste mit dezentem Schatten (`box-shadow: 0 2px 15px rgba(0,0,0,.08)`), `padding: var(--padding-horizontal-md)`, Flex-Layout `space-between`. Dropdown als absolut positioniertes Panel unter der Leiste mit mehrspaltiger Linkliste (`column-count`), responsive 2→4 Spalten. Die Zähl-Anzeige „Rheingau (7)" aus `{value, count}` (Req 8.5/8.6).

Entscheidungen:
- **Slug-Erzeugung beim Navigieren** über denselben `slugify`-Helfer, den `applyFiltersAndSort` zum Matchen nutzt → garantiert, dass der navigierte Slug wieder die Weine dieser Region/Rebsorte trifft (Konsistenz-Invariante: `slugify` ist die einzige Quelle der Slug-Regel).
- **Dropdowns schließen sich gegenseitig** und beim Navigieren (Req 8.7/8.8). Kein globaler Outside-Click-Handler nötig für diese Tasks; ein optionaler `@HostListener('document:click')` kann ergänzt werden, ist aber nicht requirements-pflichtig.
- **Logo/Home** (Req 8.10): `clearAllFilters()` + Navigation `/`. „Active"-Zustand des Home-Links über `routerLinkActive` bzw. `hasActiveFilter()`.

Edge Case: leere Daten (`loadState !== 'loaded'`) → `regions()`/`grapes()` leer → Dropdowns zeigen eine dezente „keine Einträge"-Zeile statt leerer Liste.

---

## ControlsRow & FilterField (Task 19.1 — Req 9.1–9.19, 17.4, 18.6)

**Verantwortung:** dauerhafte Steuerzeile unter der NavBar mit Freitextsuche, Standard-Filtern, „Mehr Filter"-Button, dynamischen Zusatzfiltern, Sortierung, InfoToggle und ListToggle. Alle Werte lesen/schreiben ausschließlich den FilterService.

### Aufbau der sichtbaren Filter

- **Standard-Filter (fest, immer sichtbar, Req 9.3):** Freitextsuche, Grape (multi-select), Rating (rating-range 1.0–10.0, Schritt 0.1), Verkostungsdatum (date-range).
- **Zusatzfilter (Req 9.4–9.6):** Über „Mehr Filter" lassen sich alle weiteren Schema-Felder mit `filter_type !== null` einblenden (country, origin, type, producer, quality dropdown; year range). Einblenden/Ausblenden ruft `filterService.toggleFilterField(field, visible)` → persistiert im Cookie.

```typescript
@Component({
  selector: 'app-controls-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilterFieldComponent, SortButtonComponent],
  templateUrl: './controls-row.html',
  styleUrl: './controls-row.scss',
})
export class ControlsRowComponent {
  private readonly data = inject(WineDataService);
  readonly fs           = inject(FilterService);

  readonly STANDARD_FIELDS = ['name', 'grape', 'rating', 'tasting_date'];

  // filterbare Felder aus Schema (filter_type != null)
  readonly filterableFields = computed(() =>
    this.data.schema().filter(f => f.filter_type !== null));

  // in ControlsRow gerenderte Felder: Standard ∪ eingeblendete, in Schema-Reihenfolge
  readonly activeFields = computed(() => {
    const extra = new Set(this.fs.visibleFilterFields());
    return this.filterableFields().filter(f =>
      this.STANDARD_FIELDS.includes(f.field) || extra.has(f.field));
  });

  readonly moreFiltersOpen = signal(false);

  onSearch(value: string): void { this.fs.updateFilter({ searchText: value }); }
  toggleInfo(): void  { this.fs.infoToggleActive.update(v => !v); }
  toggleList(): void  { this.fs.setViewMode(this.fs.viewMode() === 'grid' ? 'list' : 'grid'); }
  toggleMoreFilter(field: string, on: boolean): void { this.fs.toggleFilterField(field, on); }
}
```

### FilterFieldComponent (dynamisch je `filter_type`)

Eine Komponente, die anhand `schemaField.filter_type` das passende Eingabe-Widget rendert und Änderungen gezielt in den FilterService schreibt. Das ist der einzige schema-gesteuerte Teil des UIs (Req 17.4 — Schema konfiguriert die Filter).

```typescript
@Component({
  selector: 'app-filter-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filter-field.html',
})
export class FilterFieldComponent {
  field = input.required<WineSchemaField>();
  private readonly data = inject(WineDataService);
  readonly fs           = inject(FilterService);

  // Vorschlagswerte aus den Weindaten (distinct, sortiert), je nach Feld
  readonly options = computed(() => distinctValuesForField(this.data.wines(), this.field().field));
}
```

| `filter_type` | Widget | FilterService-Ziel | Req |
|---|---|---|---|
| `text-search` | Textinput + Clear-Button | `updateFilter({ searchText })` | 9.2 |
| `multi-select` (grape) | **Mehrfachauswahl** (Checkbox-/Chip-Liste) aus `distinctValuesForField` | `updateFilter({ grape })` mit `string[]` ( an-/abwählen) | 9.7 |
| `dropdown` (country, origin, type, producer, quality) | Einzel-Dropdown aus `distinctValuesForField` | `updateFilter({ dropdowns: { ...current, [field().field]: value } })` (value `null` bei „— alle —") | 9.8 |
| `range` (year) | zwei Zahleneingaben von/bis | `updateFilter({ yearFrom, yearTo })` | 9.9 |
| `date-range` (tasting_date) | zwei `type="date"`-Eingaben | `updateFilter({ tastingDateFrom, tastingDateTo })` | 9.10 |
| `rating-range` (rating) | zwei Eingaben, Schritt 0.1, Bereich 1.0–10.0 | `updateFilter({ ratingFrom, ratingTo })` | 9.11 |

**`dropdown`-Filter für alle fünf Felder generisch (Review-Finding 1):** `country`, `origin`, `type`, `producer`, `quality` haben im realen Schema `filter_type: 'dropdown'` und sind damit über „Mehr Filter" alle zuschaltbar (Req 9.4/9.8). Sie teilen sich **ein einziges** Modellfeld: `WineFilter.dropdowns: Record<string, string | null>`. Die FilterFieldComponent rendert für jedes `dropdown`-Feld ein Einzel-`<select>` mit den `distinctValuesForField`-Optionen plus einer „— alle —"-Option (Wert `null`); eine Auswahl ruft `updateFilter({ dropdowns: { ...this.fs.filter().dropdowns, [this.field().field]: value } })`, „— alle —" setzt `value = null`. `applyFiltersAndSort` iteriert über `Object.entries(filter.dropdowns)` und vergleicht `String(wine[field] ?? '')` exakt gegen den gesetzten Wert (inaktiv bei `null`). Damit sind alle fünf Dropdown-Filter funktionsfähig, und `hasActiveFilter` erkennt sie über `Object.values(f.dropdowns).some(v => v !== null)`. Gewählt wurde die generische Record-Variante statt fünf Einzelfelder, weil sie robust gegen künftige Schema-dropdowns ist (ein neues dropdown-Feld braucht keine Modell-, Filter- oder hasActiveFilter-Änderung) und die FilterFieldComponent einheitlich `this.field().field` als Schlüssel nutzen kann.

**`multi-select`-Grape als echte Mehrfachauswahl (Review-Finding 4):** Req 9.7 fordert für `multi-select` eine Mehrfachauswahl; das wird jetzt umgesetzt, statt auf Einzelauswahl zu reduzieren. `WineFilter.grape` ist ein `string[]`. Die FilterFieldComponent rendert die Vorschlagswerte aus `distinctValuesForField(wines, 'grape')` als an-/abwählbare Liste (Checkboxen oder entfernbare Chips); An-/Abwählen ruft `updateFilter({ grape: <neues Array> })`. Leeres Array = Filter inaktiv. In `applyFiltersAndSort` gilt OR innerhalb des Feldes (ein Wein passt, wenn eine seiner Rebsorten in der Auswahl liegt) und AND gegenüber den übrigen Feldern (Req 9.12) — so ist Property 11 (AND-Kombination) auch für multi-select vollständig prüfbar. Die frühere, nicht durch Requirements gedeckte Scope-Reduktion auf Einzelauswahl entfällt.

### Sortierung, InfoToggle, ListToggle

- **SortButtonComponent** (Req 9.13/9.14): siehe eigener Vertrag unten.
- **InfoToggle** (Req 9.15–9.17): schaltet `fs.infoToggleActive`. Wirkt global auf alle Tiles (siehe WineTile).
- **ListToggle** (Req 9.18/9.19): `setViewMode`; aktive Filter/Sortierung bleiben erhalten (liegen im FilterService). Cookie wird aktualisiert.

### SortButtonComponent (Task 19.1 — Req 9.13/9.14) — Vertrag (Review-Finding 5)

Eigenständige Komponente ohne Inputs/Outputs; liest/schreibt ausschließlich den FilterService. Umgesetzt als natives `<select>` (ein Widget, tastatur- und screenreader-tauglich, kein eigener Open/Close-Zustand nötig). Die drei `SortOption`-Werte haben feste deutsche Labels gemäß Req 9.13; die aktive Option ist über die `[value]`-Bindung am `<select>` markiert.

```typescript
@Component({
  selector: 'app-sort-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sort-button.html',
  styleUrl: './sort-button.scss',
})
export class SortButtonComponent {
  readonly fs = inject(FilterService);
  readonly options: { value: SortOption; label: string }[] = [
    { value: 'tasting_date_desc', label: 'Neueste Verkostung zuerst' },
    { value: 'tasting_date_asc',  label: 'Älteste Verkostung zuerst' },
    { value: 'rating_desc',       label: 'Beste Bewertung zuerst' },
  ];
  onChange(value: SortOption): void { this.fs.setSortOption(value); }
}
```

```html
<select class="sort-select" [value]="fs.sortOption()"
        (change)="onChange($any($event.target).value)">
  @for (o of options; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
</select>
```

Auswahl → `fs.setSortOption(value)` → sofortige Neusortierung (computed `filteredWines` reagiert) + Cookie (`_savePrefs`). Pill-förmiges Styling wie die übrigen Controls.

### ScrollTopButtonComponent (Req 14.4-nah; im Design gesetzte Komponente) — Vertrag (Review-Finding 5)

Eigenständige Komponente ohne Inputs/Outputs, kein Service. Ein fixierter Button unten rechts, der ab einem Scroll-Offset von `window.scrollY > 600` erscheint und per Klick die Seite smooth nach oben scrollt. Gescrollt wird das **Fenster** (nicht ein Container), da Grid/List im normalen Dokumentfluss liegen.

```typescript
@Component({
  selector: 'app-scroll-top-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scroll-top-button.html',
  styleUrl: './scroll-top-button.scss',
})
export class ScrollTopButtonComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly visible = signal(false);

  constructor() {
    const onScroll = () => this.visible.set(window.scrollY > 600);
    // passiver Listener (kein Throttling nötig; setzt nur ein Signal, OnPush/zoneless-konform)
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // Initialzustand
    this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
  }

  scrollToTop(): void { window.scrollTo({ top: 0, behavior: 'smooth' }); }
}
```

```html
@if (visible()) {
  <button class="scroll-top" type="button" (click)="scrollToTop()" aria-label="Nach oben scrollen">↑</button>
}
```

Entscheidung Listener statt IntersectionObserver: Der Button hat keinen natürlichen Sentinel im DOM (er reagiert auf den globalen Scroll-Offset, nicht auf Sichtbarkeit eines Elements), daher ist ein passiver `scroll`-Listener die einfachere, direkte Lösung. Er setzt nur ein Signal — in zoneless mit OnPush ist das unkritisch, ein Throttling ist nicht nötig, weil kein teurer Layout-Zugriff je Event erfolgt. Cleanup erfolgt über `DestroyRef`.

### Validierung der Filtereingaben

| Eingabe | Regel | Verhalten bei Verletzung |
|---|---|---|
| Suche | optional, String, beliebige Länge | leer/Whitespace → Filter inaktiv (getrimmt) |
| year from/to | optional, Integer | nicht-numerisch → `null` (Grenze inaktiv); from>to erlaubt, ergibt leere Menge (kein Fehler) |
| rating from/to | optional, Float, 1.0–10.0, Schritt 0.1 | außerhalb Bereich wird vom `input[type=number] min/max/step` begrenzt; leere Eingabe → `null` |
| tasting_date from/to | optional, ISO-Datum via Datepicker | ungültig/leer → `null` |
| dropdown (country/origin/type/producer/quality) | optional, Wert aus Vorschlagsliste | „— alle —"-Option → `null` |
| grape (multi-select) | optional, 0..n Werte aus Vorschlagsliste | keine Auswahl → leeres Array `[]` (inaktiv) |

Leere Grenze = `null` = Kriterium inaktiv; bei grape ist das leere Array `[]` der inaktive Zustand. Diese Normalisierung (`'' → null`, `NaN → null`, keine Auswahl → `[]`) passiert in der ControlsRow/FilterField vor `updateFilter`, damit `applyFiltersAndSort` nur saubere `WineFilter`-Werte sieht.

Designsprache: Pill-förmige Buttons (`border-radius: 20px`, `height: 40px`, dezenter Box-Shadow) und bordete Suchinput (`border: 2px solid var(--accent)`, `border-radius: 8px`) sinngemäß aus Album-`app.scss`/`controls-row` übernommen, auf Wein-Farbpalette gemappt.

---

## WineGrid, WineTile & Unterkomponenten (Task 20 — Req 10, 11, 13.1)

### WineGridComponent (Task 20.1 — Req 10.1–10.4)

**Verantwortung:** gefilterte/sortierte Weine als responsives CSS-Grid, EndlessScroll via IntersectionObserver, Zurück-Button als erstes Element bei aktivem Filter, Leer-Hinweis.

```typescript
@Component({
  selector: 'app-wine-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WineTileComponent],
  templateUrl: './wine-grid.html',
  styleUrl: './wine-grid.scss',
})
export class WineGridComponent {
  private readonly router = inject(Router);
  readonly fs             = inject(FilterService);
  readonly dialog         = inject(DialogService);

  readonly PAGE_SIZE = 24;
  readonly visibleCount = signal(this.PAGE_SIZE);

  readonly allWines     = this.fs.filteredWines;
  readonly visibleWines = computed(() => this.allWines().slice(0, this.visibleCount()));
  readonly showBackButton = this.fs.hasActiveFilter;
  readonly isEmpty      = computed(() => this.allWines().length === 0);

  // Reset auf Seite 1 bei jeder Änderung der gefilterten Liste
  private readonly _resetOnFilter = effect(() => {
    this.allWines();               // Abhängigkeit registrieren
    this.visibleCount.set(this.PAGE_SIZE);
  });

  onSentinelVisible(): void {
    this.visibleCount.update(n => Math.min(n + this.PAGE_SIZE, this.allWines().length));
  }

  openDetail(w: Wine): void { this.dialog.open(w); }
  goBack(): void { this.fs.clearAllFilters(); this.router.navigate(['/']); }
}
```

EndlessScroll-Mechanik: Ein Sentinel-`<div>` am Ende des Grids wird von einem `IntersectionObserver` beobachtet (aufgesetzt in `afterNextRender`/`ngAfterViewInit` auf ein `viewChild`-ElementRef). Sichtbarwerden → `onSentinelVisible()` erhöht `visibleCount` um `PAGE_SIZE`, bis alle Weine gerendert sind (Req 10.2). Der Observer wird in `DestroyRef`/`ngOnDestroy` getrennt. Begründung IntersectionObserver statt Scroll-Listener: effizienter, kein Throttling nötig, sauber mit zoneless.

**Reset bei Filteränderung (Req-relevant, Property 14):** `effect` setzt `visibleCount` zurück, sobald sich `filteredWines` ändert — sonst bliebe man bei einem engeren Filter auf einer hohen Seitenzahl „hängen" bzw. sähe Reste. Da `visibleWines` ein reines Prefix-`slice` von `filteredWines` ist, bleibt die Reihenfolge exakt erhalten (Property 14).

**Zurück-Button (Req 10.4):** als erstes Grid-Kind, gleiche Zellengröße wie eine Tile (`aspect-ratio: 1/1`, gleiche Grid-Spalte), nur sichtbar wenn `showBackButton()`. Klick → `goBack()`.

**Responsives Grid (Req 10.1, 14.4) — verbindliche Breakpoints laut Aufgabenstellung:**
```scss
.wine-grid {
  display: grid;
  gap: var(--padding-horizontal-md);
  padding: 0 var(--padding-horizontal-md) var(--padding-horizontal-md);
  grid-template-columns: 1fr;                                   /* mobile < 600px: 1 Spalte */
}
@media (min-width: 600px) {                                     /* Tablet 600–1024px */
  .wine-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
}
@media (min-width: 1025px) {                                    /* Desktop > 1024px */
  .wine-grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
}
```
Die drei Zonen entsprechen exakt der Vorgabe: mobil 1 Spalte, Tablet und Desktop `auto-fill`-CSS-Grid mit steigender Mindestbreite. Dies lehnt sich an die `auto-fill, minmax(...)`-Technik der Album-Wall an, präzisiert die Breakpoints aber auf 600/1024.

**Leerzustand (Req 10.3):** `@if (isEmpty())` → zentrierter Hinweis „Keine Weine gefunden".

### WineTileComponent (Task 20.2 — Req 11.1–11.9, 13.1)

```typescript
@Component({
  selector: 'app-wine-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WineTileCoverComponent, WineTileOverlayComponent],
  templateUrl: './wine-tile.html',
  styleUrl: './wine-tile.scss',
})
export class WineTileComponent {
  wine       = input.required<Wine>();
  showInfos  = input<boolean>(false);   // = fs.infoToggleActive von außen gebunden
  openDetail = output<Wine>();

  private readonly localOverlay = signal(false);
  readonly overlayVisible = computed(() => this.showInfos() || this.localOverlay());
  readonly hasMedia       = computed(() => isPresent(this.wine().audio) || isPresent(this.wine().video));

  onMouseEnter(): void { if (!this.showInfos()) this.localOverlay.set(true);  }
  onMouseLeave(): void { if (!this.showInfos()) this.localOverlay.set(false); }
  onTap(): void        { if (!this.showInfos()) this.localOverlay.update(v => !v); }
  onOpen(): void       { this.openDetail.emit(this.wine()); }
  onPlay(e: Event): void { e.stopPropagation(); this.openDetail.emit(this.wine()); }
}
```

Interaktion:
- **Hover (Desktop, Req 11.5/11.6):** `mouseenter`/`mouseleave` schalten `localOverlay`, aber nur wenn InfoToggle aus.
- **Tap (Mobil, Req 11.7/11.8):** `onTap` toggelt `localOverlay`; erneuter Tap blendet aus.
- **InfoToggle erzwingt Overlay (Req 11.4/9.16/9.17):** `overlayVisible = showInfos() || localOverlay()`. Ist `showInfos` true, ist das Overlay bei **jeder** Tile sichtbar, unabhängig von `localOverlay` (Property 12). Wird `showInfos` wieder false, bestimmt allein `localOverlay` die Sichtbarkeit — vollständiger Roundtrip (Property 13).
- **Play-Button (Req 11.9):** nur wenn `hasMedia()`; Klick öffnet Detail (`stopPropagation`, damit nicht doppelt mit dem Tile-Klick).
- **Tile-Klick (Req 13.1):** öffnet Detail über `openDetail` → `DialogService.open`.

Die Unterscheidung Hover vs. Tap erfolgt pragmatisch über beide Event-Handler gleichzeitig; auf Touch-Geräten feuert `mouseenter` nicht zuverlässig, daher deckt `onTap` (click) den mobilen Fall ab. Ein Doppelzweck-Klick (Overlay-Toggle vs. Detail öffnen) wird aufgelöst, indem der **Detail-Öffnen-Trigger** ein dedizierter Bereich/Button ist bzw. der Klick bei bereits sichtbarem Overlay öffnet; konkret: Erstkontakt zeigt Overlay, ein Klick auf den Overlay-Inhalt/Play öffnet den Dialog. Diese Feinheit ist Darstellungslogik und über `overlayVisible` + explizite Open-Trigger lösbar, ohne zusätzlichen Zustand.

### WineTileCoverComponent (Req 11.1/11.2)

Rendert das Bild über `mediaSrc(wine.image)` (zentraler `IMAGE_BASE = '/images/'`, siehe gemeinsame Helfer / Review-Finding 1) mit `loading="lazy"`. Bei fehlendem Bild (`mediaSrc(...)` liefert `null`) oder `(error)`-Event das **PlaceholderIcon** (inline-SVG Weinglas); ein lokales `imageError`-Signal kippt bei `(error)` auf das Placeholder. Der rohe Dateiname wird nie direkt an `[src]` gebunden. Keine externen Bild-URLs, kein Google-Fallback (anders als Album-App).

### WineTileOverlayComponent (Req 11.3/11.4) — festes Template

Kein Schema-Durchlauf. Genau die sechs Felder in fester Anordnung, jeweils nur wenn `isPresent`:

```html
<div class="overlay">
  @if (isPresent(wine().rating)) { <app-rating-circle [value]="wine().rating!" /> }
  @if (isPresent(wine().year))     { <div class="wine-year">{{ wine().year }}</div> }
  @if (isPresent(wine().name))     { <div class="wine-name">{{ wine().name }}</div> }
  @if (isPresent(wine().producer)) { <div class="wine-producer">{{ wine().producer }}</div> }
  @if (grapeList(wine()).length)   { <div class="wine-grape">{{ grapeList(wine()).join(', ') }}</div> }
  @if (isPresent(wine().origin))   { <div class="wine-origin">{{ wine().origin }}</div> }
</div>
```

Designsprache (aus Album-`album-tile-overlay` sinngemäß): am unteren Kachelrand verankertes Panel mit kräftigem Rahmen (`border: 3px solid var(--text-dark)`) und halbtransparent-weißem Grund (`--background-info-tile: rgba(255,255,255,.95)`), Rating-Kreis oben rechts überlappend. Auf Mobil kleinere Schrift/Padding und scrollbar bei wenig Platz. **Property 15** prüft: Für jede Teilmenge gesetzter Overlay-Felder erscheinen genau die vorhandenen, keine leeren.

### RatingCircleComponent (Req 11.3/13.3)

`value = input.required<number>()`. Kreis mit `--color-highlight`-Rand, zeigt `value` mit einer Nachkommastelle (`rating`-Schema `decimals: 1`), z. B. `6.0`. Größe per Input/Klasse (Overlay kleiner als Dialog). Wird nur gerendert, wenn der Aufrufer `isPresent(rating)` prüft — die Komponente selbst nimmt an, dass ein Wert anliegt.

---

## WineList & WineListItem (Task 21.1 — Req 12.1–12.5, 13.1)

Strukturell analog zum Grid, aber vertikale Liste. Teilt EndlessScroll-, Zurück-Button- und Leer-Logik mit dem Grid (gleiche `visibleCount`/Sentinel/`DialogService`-Muster; die gemeinsame EndlessScroll-Logik kann als kleines `useEndlessScroll`-Helfer/Basismuster geteilt werden, ist aber bewusst nicht overengineered — zwei schlanke Komponenten mit gleichem Muster sind akzeptabel).

```typescript
@Component({
  selector: 'app-wine-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WineListItemComponent],
  templateUrl: './wine-list.html',
  styleUrl: './wine-list.scss',
})
export class WineListComponent { /* visibleCount, visibleWines, showBackButton, isEmpty, onSentinelVisible, goBack, openDetail — wie WineGrid */ }
```

### WineListItemComponent (Req 12.2)

Kompakte Zeile mit genau: Name, Weingut (`producer`), Jahr (`year`), Herkunftsland (`country`), Rating. Leere Felder werden über `isPresent` ausgeblendet (keine leeren Spalten/Trenner). Klick → `openDetail` (Req 13.1). Rating als kleiner Rating-Kreis oder kompakte Zahl rechtsbündig.

```html
<button class="list-item" type="button" (click)="open()">
  <span class="li-name">{{ wine().name }}</span>
  @if (isPresent(wine().producer)) { <span class="li-producer">{{ wine().producer }}</span> }
  @if (isPresent(wine().year))     { <span class="li-year">{{ wine().year }}</span> }
  @if (isPresent(wine().country))  { <span class="li-country">{{ wine().country }}</span> }
  @if (isPresent(wine().rating))   { <app-rating-circle class="li-rating" [value]="wine().rating!" /> }
</button>
```

Layout: `display: flex`/CSS-Grid-Zeile mit `space-between`, auf Mobil umbrechend. Zurück-Button am Listenanfang als volle Zeile (Req 12.5). Leer-Hinweis identisch zum Grid (Req 12.4).

---

## WineDetailDialog (Task 22.1 — Req 13.1–13.8, Property 16)

**Verantwortung:** modaler Dialog mit allen Details eines Weins in **festen Gruppen**, generischer Anhang unbekannter Zusatzfelder, Medien-Player, Schließen per Button/Backdrop, Body-Scroll-Lock. Keine tabellarische Auflistung, keine Schema-Generierung der bekannten Felder (Req 13.2).

```typescript
@Component({
  selector: 'app-wine-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RatingCircleComponent],
  templateUrl: './wine-detail-dialog.html',
  styleUrl: './wine-detail-dialog.scss',
})
export class WineDetailDialogComponent {
  wine  = input<Wine | null>(null);
  close = output<void>();

  private static readonly KNOWN = new Set([
    'name','producer','year','rating','country','origin',
    'grape','type','quality','tasting_date','description',
    'price','image','audio','video',
  ]);

  readonly extraEntries = computed(() => {
    const w = this.wine();
    if (!w) return [];
    return Object.entries(w)
      .filter(([k, v]) => !WineDetailDialogComponent.KNOWN.has(k) && isPresent(v))
      .map(([key, value]) => ({ key, label: humanizeKey(key), value: String(value) }));
  });

  readonly isPresent = isPresent;
  readonly grapeList = grapeList;

  onBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('dialog-backdrop')) this.close.emit();
  }
  onClose(): void { this.close.emit(); }

  // Body-Scroll-Lock solange ein Wein gesetzt ist — mit garantiertem Cleanup (Review-Finding 12)
  private readonly _scrollLock = effect((onCleanup) => {
    document.body.style.overflow = this.wine() ? 'hidden' : '';
    onCleanup(() => { document.body.style.overflow = ''; });
  });
}
```

### Feste Gruppenstruktur (Req 13.2)

Jede Gruppe und jedes Feld nur rendern, wenn Inhalt vorhanden (`isPresent`); Gruppen ohne jeden Inhalt komplett ausblenden, damit keine leeren Überschriften erscheinen:

1. **Kopfbereich:** `name`, `producer`, `year`, RatingCircle (`rating`).
2. **Herkunft:** `country`, `origin`.
3. **Weinprofil:** `grape` (als Liste), `type`, `quality`.
4. **Verkostung:** `tasting_date` (lokalisiert dargestellt), `description`.
5. **Kaufinfo:** `price` (`number`, `decimals: 2`) wird mit `formatPrice(price)` dargestellt (siehe unten) — zwei Nachkommastellen, deutsches Dezimalkomma, `€`-Suffix, z. B. `6,99 €`.
6. **Medien:** großes Bild über `mediaSrc(wine().image)`; `@if (mediaSrc(wine().audio); as a) { <audio controls [src]="a"></audio> }`; `@if (mediaSrc(wine().video); as v) { <video controls [src]="v"></video> }`. `mediaSrc` setzt den zentralen `IMAGE_BASE` (`/images/`) vor den Dateinamen und liefert `null` bei fehlendem Wert, sodass das Element gar nicht gerendert wird.
7. **Zusatzfelder (`extraEntries`):** alle unbekannten, gesetzten Felder als gestaltete Key-Value-Paare am Ende. `humanizeKey` nutzt eine **vollständige, fixierte Label-Map** für alle real vorkommenden Extra-Keys plus einen snake_case→Titel-Case-Fallback für Unbekannte (Review-Finding 13):

```typescript
const EXTRA_LABELS: Record<string, string> = {
  taste_eye:          'Auge',
  taste_nose:         'Nase',
  taste_mouth:        'Mund',
  conclusion_tobias:  'Fazit Tobias',
  conclusion_wolfgang:'Fazit Wolfgang',
  conclusion_simon:   'Fazit Simon',
  development:        'Entwicklung',
  percentage:         'Alkoholgehalt (%)',   // inhaltlich: der in den Daten als Prozentwert geführte Alkoholgehalt
  spontansprechstunde:'Spontansprechstunde',
};

export function humanizeKey(key: string): string {
  return EXTRA_LABELS[key]
    ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
```

Die Keys entsprechen exakt den im Realitätscheck gezählten Extra-Feldern. Dies trägt — wie der Realitätscheck zeigt — den Großteil der echten Inhalte und wird daher gestalterisch als vollwertige „Verkostungsnotizen"-Sektion umgesetzt, nicht als roher Debug-Dump.

**Preisformatierung (Review-Finding 14):** als gemeinsamer Helfer, damit Dialog (und ggf. ListItem) identisch formatieren:
```typescript
export function formatPrice(price: number | null | undefined): string | null {
  return isPresent(price)
    ? price!.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
    : null;
}
```
`price` ist laut Schema/Modell ein `number` (`decimals: 2`); eine String-Sonderbehandlung entfällt (Review-Finding 2).

**Property 16** verlangt: *jedes* im Objekt vorhandene Feld wird angezeigt. Das wird durch zwei disjunkte, erschöpfende Pfade garantiert: bekannte Felder (`KNOWN`) in den festen Gruppen + alle übrigen gesetzten Felder in `extraEntries`. Da `KNOWN ∪ extraKeys` alle Keys abdeckt und jede Gruppe das jeweilige bekannte Feld genau dann rendert, wenn `isPresent`, erscheint kein gesetztes Feld ungezeigt. Der Test prüft: für ein beliebiges Wine-Objekt ist jeder Key mit `isPresent`-Wert im gerenderten DOM nachweisbar (über ein `data-field`-Attribut je Feld/Entry als stabiler Testanker).

### Schließen & Scroll-Lock

- **Schließen-Button (Req 13.5/13.6):** `onClose()` → `close`-Output → AppComponent/`DialogService.close()` setzt `wine` auf `null`.
- **Backdrop-Klick (Req 13.7):** nur wenn direkt auf `.dialog-backdrop` geklickt (nicht auf Dialoginhalt).
- **Body-Scroll-Lock (Req 13.8):** `effect` setzt `body.overflow = 'hidden'` solange ein Wein anliegt, sonst `''`. Die `onCleanup`-Rückgabe setzt `overflow` auch bei Component-Destroy, Hot-Reload und Testende garantiert zurück, sodass ein zuletzt gesetztes `'hidden'` nie dauerhaft stecken bleibt (Review-Finding 12). Keyboard-ESC optional ergänzbar (nicht pflichtig).
- **Rendering:** Dialog rendert nur bei `wine() !== null` (ganzes Template in `@if (wine(); as w)`), sodass bei geschlossenem Zustand kein Backdrop im DOM ist.

### Medien-Sicherheit

`audio`/`video`/`image` werden als `[src]` gebunden; Angular sanitisiert `src`. Werte stammen aus der eigenen `wines.json` (bloße Dateinamen). `mediaSrc()` setzt den zentralen `IMAGE_BASE` (`/images/`, siehe gemeinsame Helfer) davor und liefert `null` bei fehlendem Wert. Kein `innerHTML`, keine `bypassSecurityTrust*`-Aufrufe.

### Edge Cases Dialog

| Fall | Verhalten |
|---|---|
| Wein nur mit `name`/`tasting_date` | nur Kopf + Verkostung-Datum; übrige Gruppen ausgeblendet |
| `rating` null | kein Rating-Kreis |
| Zusatzfeld mit leerem String | nicht in `extraEntries` (via `isPresent`) |
| `grape` als Array | in Weinprofil als `', '.join` |
| `price` gesetzt (`number`) | `formatPrice()` → `6,99 €` (de-Dezimalkomma, 2 Nachkommastellen) |
| `price` null | Kaufinfo-Gruppe ausgeblendet |
| `audio` und `video` beide vorhanden | beide Player gerendert |

---

## SCSS-Organisation (Req 14.3/14.5 — reines SCSS, Light Mode)

Dreistufige, komponentennahe Organisation in Anlehnung an die Album-App, aber aufgeräumt:

1. **Globale Design-Tokens** in `src/styles.scss` als CSS-Custom-Properties unter `:root` (Light Mode, kein Dark Mode). Eigene Weinpalette statt der Album-Farben, z. B.:
   ```scss
   :root {
      --color-accent: rgb(0, 158, 255);
      --color-hover: #ffba49;
      --color-focus: rgb(0, 83, 135);
      --color-active: #ef5b5b;
      --color-highlight: #b4c292;
      --color-critical: red;
      --color-black: #161211;
      --color-white: #FFF;
      --text-color-light: var(--color-white);
      --text-color-dark: #161211;
      --text-color-muted: rgba(43, 35, 32, 0.55);
      --color-background-main: var(--color-white);
      --color-background-surface: var(--color-white);
      --color-background-info-tile: rgba(255, 255, 255, 0.95);
      --color-button-bg: var(--color-accent);
      --color-button-label: var(--text-color-light);
      --color-filter-border: var(--color-accent);
      --color-filter-background: var(--text-color-light);
      --box-shadow-subtle: 0 1px 3px rgba(0, 0, 0, 0.12);
      --radius-pill: 8px;
      --radius-input: 8px;
      --padding-padding-unit: 4px;
      --padding-horizontal-md: 12px;
   }
   ```
   Dazu globale Resets, Box-Sizing, Grundtypografie, `a`/`button`-Basisstile.
2. **Geteilte Mixins/Funktionen** in `src/_shared.scss` (via `@use`), z. B. `filter-button()` (Pill-Button), `card-surface()`, `overlay-panel()`, `responsive-grid()`. Komponenten binden gezielt ein, was sie brauchen — kein globaler Leak.
3. **Komponenten-SCSS** pro Komponente (`styleUrl`), `:host`-scoped. Nur komponentenspezifisches Layout; Tokens via `var(--…)`, Muster via `@use '../../shared' as s`.

Responsive-Strategie global konsistent: Mobile-First, Breakpoints bei **600px** und **1024px** als SCSS-Variablen (`$bp-tablet: 600px; $bp-desktop: 1024px`) zentral in `_shared.scss`, damit Grid (WineGrid), Nav-Dropdown-Spalten, Overlay-Dichte und Dialog-Layout dieselben Grenzen nutzen. Kein UI-Framework, keine CSS-Bibliothek (Req 14.3).

---

## Testing-Strategie (Jasmine + fast-check)

Zwei Ebenen pro Baustein: **Unit-Tests** (konkrete Fälle/Randfälle) und **Property-Based-Tests** (fast-check, `{ numRuns: 100 }` minimum, Tag-Kommentar `// Feature: weinliste, Property N: <text>`). Was unit- vs. property- vs. integration-testbar ist:

### Was unit- vs. property-testbar ist

- **Reine Funktionen** (`applyFiltersAndSort`, `isPresent`, `slugify`, `grapeList`, `valueList`, `humanizeKey`, `distinctValuesForField`, `countBy`, `mediaSrc`, `formatPrice`): ohne DOM/TestBed testbar — ideal für Property-Tests.
- **Services** (`WineDataService` mit HttpTestingController; `UserPreferencesService` gegen `document.cookie`; `FilterService` mit gemocktem WineDataService): Unit-Tests; `UserPreferencesService`-Roundtrip auch Property.
- **Komponenten mit Logik** (`WineTile` Overlay-Toggle, `WineGrid` EndlessScroll/Reset/Back, `WineDetailDialog` close/backdrop/scroll-lock/extraEntries): TestBed + `ComponentFixture`. `WineTile` und `WineDetailDialog` tragen zusätzlich Property-Tests.
- **Integration-nah** (optional, nicht in diesen Sub-Tasks pflichtig): Router-Parameter → FilterService → gerendertes Grid. Wird über die Service- und Komponententests implizit abgedeckt; ein voller Router-Integrationstest ist nicht gefordert.

Ein Design-Hinweis zur Testbarkeit: Dass die gesamte Filterlogik in einer reinen Funktion liegt und der UI-Transientzustand (Dialog) vom Filterzustand getrennt ist, macht die schwierigsten Properties (10, 11, 14) DOM-frei testbar. Hätte die Filterung im Template gelebt, wäre das deutlich schwerer — die Trennung ist daher bewusst so gewählt.

### Zuordnung Property-Tests (fast-check)

| Property | Ort | Prüfgegenstand |
|---|---|---|
| **10** Freitextsuche Vollständigkeit/Korrektheit (Req 9.2) | `applyFiltersAndSort` | Gegen die **schema-abgeleitete** `searchFields`-Menge (filter_type `text-search`, aktuell nur `name`): jeder Ergebnis-Wein matcht den Begriff (case-insensitiv) in ≥1 dieser Felder; kein Wein, der in keinem `searchFields`-Feld matcht, erscheint. Generator: zufällige Weinlisten + Suchbegriffe + variable `searchFields`-Mengen. |
| **11** Kombinierte Filter AND-Logik (Req 9.12) | `applyFiltersAndSort` | Jeder Ausgabe-Wein erfüllt **alle** aktiven Kriterien; kein Wein, der eins verletzt, ist dabei. Generator: zufällige `WineFilter`-Kombinationen. |
| **12** InfoToggle wirkt auf alle Kacheln (Req 9.16) | `WineTileComponent` (TestBed) | Bei `showInfos=true` ist `overlayVisible` bei jeder Kachel true, unabhängig von `localOverlay`. |
| **13** InfoToggle-Roundtrip (Req 9.17) | `WineTileComponent` | true→false stellt Ausgangszustand her: `overlayVisible === localOverlay`. |
| **14** Reihenfolge nach Filterung erhalten (Req 10.1) | `WineGrid`/`applyFiltersAndSort` | `visibleWines` ist exaktes Prefix von `filteredWines`; keine Umsortierung durch Rendering/Scroll. |
| **15** WineTileOverlay Datenvollständigkeit (Req 11.4) | `WineTileOverlayComponent` (TestBed) | Für jede Teilmenge gesetzter Overlay-Felder erscheinen genau die vorhandenen. |
| **16** WineDetailDialog Feldvollständigkeit (Req 13.2) | `WineDetailDialogComponent` (TestBed) | Jedes im Objekt gesetzte Feld (bekannt + unbekannt) ist im DOM nachweisbar (`data-field`-Anker). |
| **19** UserPreferences Cookie-Roundtrip (Req 18.1–18.3) | `UserPreferencesService` | `save(p)` → `load()` liefert strukturell gleiches Objekt; keine Filterwerte im Cookie. |

Generatoren: ein `arbitraryWine` (fast-check `fc.record` mit optionalen/`null`-Feldern und gelegentlichen Extra-Keys, passend zur Realdatenlage mit vielen `null`s) und `arbitraryFilter`. Für DOM-Properties (12,13,15,16) rendert der Test die Komponente via TestBed und prüft Signals/DOM über `data-field`-Attribute.

### Unit-Test-Schwerpunkte (aus Tasks 15.3, 17.3, 18.4, 20.3, 22.2)

- **WineDataService (15.3):** loading→loaded bei erfolgreichem forkJoin; loading→error bei HTTP-Fehler; kein zweites Laden bei erneutem `loadAll()`; paralleles Laden beider Assets.
- **FilterService (17.3):** Filterergebnisse für konkrete Beispiele; Cookie-Init im Konstruktor (gemockter PrefsService); `availableRegions/Grapes` mit korrektem Count und Ausschluss von `null`.
- **AppComponent/NavComponent (18.4):** Lade-/Fehler-Rendering je `loadState`; Regionen/Rebsorten-Links mit Count; Navigation + Menü-Schließen; Home-Reset.
- **WineGrid/WineTile (20.3):** EndlessScroll erhöht `visibleCount`; Reset bei Filteränderung; Back-Button-Sichtbarkeit an `hasActiveFilter`; Overlay-Toggle Hover/Tap; Play-Button nur bei Medien; Klick öffnet Dialog.
- **WineDetailDialog (22.2):** close-Output bei Button; Backdrop-Klick schließt nur bei Backdrop-Target; Body-Scroll-Lock setzt/zurücksetzt `overflow`; `extraEntries` enthält genau die unbekannten, gesetzten Felder.

Alle Property-Tests tragen den vorgeschriebenen Tag-Kommentar `// Feature: weinliste, Property N: <property_text>` und laufen mit mindestens 100 Iterationen.

---

## Verifikation & Checkpoint 23

Checkpoint 23 verlangt grünen Gesamtstand. Verifikation nach Implementierung:
- `npx ng build` (aus `frontend/`) muss fehlerfrei bauen; Assets (`wines.json`, `wine-schema.json`) müssen im Output liegen (gemäß `frontend-setup.md` bereits konfiguriert).
- `npx ng test` (Karma/Jasmine) muss alle Unit- und Property-Tests grün liefern.
- Manuelle Smoke-Prüfung gegen die echte `wines.json` (559 Weine, viele `null`-Felder): Grid rendert, Overlay/Dialog zeigen keine leeren Labels, Suche/Filter/Sort/ViewToggle/InfoToggle funktionieren, Navigationsrouten setzen Filter ohne Nachladen, Dialog öffnet/schließt mit Scroll-Lock.
- Temporäre Testartefakte entfernen; nichts committen ohne ausdrückliche Anweisung.

---

## Zusammenfassung der Komponenten-Verträge (inputs/outputs)

| Komponente | inputs | outputs | liest Service |
|---|---|---|---|
| AppComponent | — | — | WineDataService, DialogService |
| WineWallComponent | — | — | FilterService, ActivatedRoute |
| NavComponent | — | — | FilterService, Router |
| ControlsRowComponent | — | — | FilterService, WineDataService |
| FilterFieldComponent | `field: WineSchemaField` | — | FilterService, WineDataService |
| SortButtonComponent | — | — | FilterService |
| WineGridComponent | — | — | FilterService, DialogService, Router |
| WineTileComponent | `wine: Wine`, `showInfos: boolean` | `openDetail: Wine` | — |
| WineTileCoverComponent | `wine: Wine` | — | — |
| WineTileOverlayComponent | `wine: Wine` | — | — |
| WineListComponent | — | — | FilterService, DialogService, Router |
| WineListItemComponent | `wine: Wine` | `openDetail: Wine` | — |
| WineDetailDialogComponent | `wine: Wine \| null` | `close: void` | — |
| RatingCircleComponent | `value: number` | — | — |
| ScrollTopButtonComponent | — | — | — |

---

## Bewusste Festlegungen & Abweichungen vom Design-Pseudocode (für die Review)

1. **Asset-Pfad relativ** (`assets/...` statt `/assets/...`) für deploymentrobuste Auslieferung.
2. **Cookie mit `max-age` ~1 Jahr** statt Session-Cookie — richtet die Pseudocode-Vorlage an Req 18.1/User-Story (persistente Vorlieben) aus.
3. **Zwei kleine Zusatzkomponenten** (`RatingCircleComponent`, `FilterFieldComponent`) und **ein `DialogService`** — reine Wiederverwendung/Entkopplung, keine neue Designsprache, keine Verletzung der FilterService-Single-Source-of-Truth (der DialogService hält nur UI-Transientzustand „offener Wein").
4. **`updateFilter(patch)`-Methode** ergänzt, damit die ControlsRow typsicher einzelne Filterwerte setzt, ohne Cookie-Persistenz (Req 18.3).
5. **`multi-select`-Grape als echte Mehrfachauswahl** (`WineFilter.grape: string[]`, OR innerhalb/AND zwischen Feldern) — Req 9.7 fordert Mehrfachauswahl; die frühere Einzelauswahl-Reduktion ist aufgehoben (Review-Finding 4).
6. **Grid-Breakpoints exakt 600/1024** laut Aufgabenstellung, abweichend von den Album-Breakpoints (520/710/940).
7. **`PAGE_SIZE = 24`** (EndlessScroll-Seitengröße in WineGrid/WineList) ist ein bewusst gewählter, benannter Konstantenwert, konsistent mit dem `design.md`-Pseudocode (tasks.md 20.1 nennt nur generisch `PAGE_SIZE`). 24 ist ein guter Kompromiss für die responsiven Grid-Spaltenzahlen (teilbar durch 1/2/3/4/6 Spalten → volle letzte Reihe).
8. **Medien-Basispfad `IMAGE_BASE = '/images/'`** als zentrale Konstante (Review-Finding 1 der Vorrunde), abgeleitet aus `deploy.remote_images_path` relativ zum Web-Root (`deploy.remote_path`); lokal via Symlink `frontend/public/images → export/images`.
9. **`applyFiltersAndSort` erhält einen zusätzlichen Parameter `searchFields: string[]`** gegenüber dem `design.md`-Pseudocode (Review-Finding 4 dieser Runde). Die im Pseudocode hartkodierte Feldliste `name/year/grape/producer/origin` **entfällt**, da sie Req 9.2 widerspricht: Req 9.2 fordert, dass die Freitextsuche ausschließlich Felder mit `filter_type === 'text-search'` durchsucht (im realen Schema nur `name`). `searchFields` wird vom FilterService schema-abgeleitet berechnet und übergeben. Für diese konkrete Stelle ist damit **das Technik-Design maßgeblich, nicht der `design.md`-Pseudocode** — die ansonsten für den Pseudocode geltende Verbindlichkeit ist hier bewusst und requirements-begründet aufgehoben. Property 10 prüft gegen genau diese schema-abgeleitete Feldmenge.
10. **Dropdown-Filter generisch über `WineFilter.dropdowns: Record<string,string|null>`** statt fünf Einzelfelder (Review-Finding 1 dieser Runde) — deckt country/origin/type/producer/quality (Req 9.4/9.8) mit einer einheitlichen Filter-, Reset- und `hasActiveFilter`-Mechanik ab; `EMPTY_FILTER.dropdowns` belegt alle fünf Keys mit `null`.
11. **date-range-Filter behandelt fehlendes `tasting_date` symmetrisch** wie year/rating (Review-Finding 3 dieser Runde): bei aktiver `tastingDateFrom`-**oder**-`tastingDateTo`-Grenze fällt ein Wein ohne Datum heraus; die frühere asymmetrische `?? ''`-Form ist ersetzt.

Keine dieser Festlegungen verletzt eine Acceptance Criteria; sie präzisieren oder korrigieren den Pseudocode entlang der Requirements und der realen Datenlage.

---

## Antworten auf das Design-Review — Runde 2 (`.agents/tasks/design-review.json`, Stand aktuell)

Verdikt der aktuellen Review: **CHANGES_REQUESTED** (2 HIGH, 4 MEDIUM, 3 NIT). Alle 8 Findings sind in diesem Dokument behoben. Begründung je Finding:

| # | Sev | Status | Umsetzung im Design |
|---|---|---|---|
| 1 | HIGH | behoben | Dropdown-Filter für `country/origin/type/producer/quality` generisch über `WineFilter.dropdowns: Record<string,string|null>` modelliert. `applyFiltersAndSort` iteriert über `Object.entries(filter.dropdowns)`; `FilterFieldComponent` schreibt `updateFilter({ dropdowns: { ...current, [field]: value } })`; `hasActiveFilter` prüft `Object.values(f.dropdowns).some(v => v !== null)`; `EMPTY_FILTER.dropdowns` belegt alle fünf Keys mit `null`. Widget-Tabelle und ControlsRow-Prosa präzisiert (kein „bzw. passendes Feld" mehr). |
| 2 | HIGH | behoben | `hasActiveFilter`-grape-Term von `f.grape !== null` (immer wahr bei `string[]`) auf `f.grape.length > 0` korrigiert; der `country`-Term ist durch die `dropdowns`-Prüfung ersetzt. Der Zurück-Button ist jetzt nur bei tatsächlich aktivem Filter sichtbar. |
| 3 | MED | behoben | `tasting_date`-Range symmetrisch wie year/rating: `wine.tasting_date == null` fällt bei aktiver `From`- **oder** `To`-Grenze heraus; `?? ''` entfernt. Entscheidungsliste um die explizite Regel ergänzt. |
| 4 | MED | behoben | Signaturerweiterung `searchFields` als nummerierter Eintrag (Nr. 9) in die zentrale Abweichungsliste aufgenommen; dort festgehalten, dass für diese Stelle das Technik-Design maßgeblich ist, nicht der `design.md`-Pseudocode, und dass die hartkodierte Feldliste (Req-9.2-widrig) entfällt. |
| 5 | MED | behoben | Vollständige Verträge für `SortButtonComponent` (natives `<select>`, drei de-Labels gemäß Req 9.13, `fs.setSortOption`, aktive Option markiert) und `ScrollTopButtonComponent` (erscheint ab `window.scrollY > 600`, passiver Scroll-Listener mit DestroyRef-Cleanup, `window.scrollTo({top:0,behavior:'smooth'})`) ergänzt. |
| 6 | MED | behoben | (a) `EMPTY_FILTER` an die `dropdowns`-Record-Form angeglichen (einzige Quelle der Leerform). (b) Reset-Semantik explizit dokumentiert: `clearAllFilters()` setzt nur `filter={...EMPTY_FILTER}` und `navigationFilter=null`; `visibleFilterFields`, `sortOption`, `viewMode`, `infoToggleActive` bleiben unverändert (Konfiguration, kein Filterwert); kein `_savePrefs()`. `goBack`/`goHome` entsprechend. |
| 7 | NIT | behoben | `price`-Abweichung von Req 17.2 (`text,null`) explizit dokumentiert: reales Schema `number`/`decimals:2`, Modell `price?:number`, verifiziert an `wines.json`; maßgeblich ist das reale Schema. |
| 8 | NIT | behoben | Slug-Kollision zwischen `countBy` (Rohwert) und `slugify`-Match als bei aktueller Datenlage akzeptierte, bekannte Einschränkung dokumentiert, inkl. Fix-Pfad (countBy nach `slugify` gruppieren) für den Fall wachsender Daten. |

Keine Findings wurden zurückgestellt oder ignoriert; alle Änderungen bleiben innerhalb der ursprünglichen Requirements (Req 7–14, 17, 18) und der realen Artefakte (`wine-schema.json`, `wines.json`).

---

## Antworten auf das Design-Review — Runde 1 (historisch)

Verdikt der Runde-1-Review: **CHANGES_REQUESTED** (3 HIGH, 9 MEDIUM, 3 NIT). Alle 15 Findings sind im Dokument behoben. Begründung je Finding:

| # | Sev | Status | Umsetzung im Design |
|---|---|---|---|
| 1 | HIGH | behoben | Medien-Basispfad als zentrale Konstante `IMAGE_BASE = '/images/'` + `mediaSrc()`-Helfer festgelegt (abgeleitet aus `deploy.remote_images_path` relativ zum Web-Root). Cover und Dialog-Medien nutzen ausschließlich `mediaSrc`. Lokale Bereitstellung via Symlink `frontend/public/images → export/images` spezifiziert. |
| 2 | HIGH | behoben | `Wine.price` auf `price?: number` korrigiert (Schema `number`, `decimals: 2`; Daten durchgängig float). Dialog formatiert via `formatPrice()` (de-Komma, 2 Nachkommastellen, `€`). String-Sonderfall gestrichen. |
| 3 | HIGH | behoben | `WineSchemaField.type`-Union am realen Schema ausgerichtet: `text \| number \| date \| multi-value` (kein `rating`). `decimals` dokumentiert (year 0, rating 1, price 2). rating-Erkennung über `filter_type === 'rating-range'` / `field === 'rating'`, nicht über `type`. |
| 4 | MED | behoben (spec-konform) | `WineFilter.grape: string[]` mit echter Mehrfachauswahl; OR innerhalb des Feldes, AND zwischen Feldern (Req 9.7/9.12). FilterField rendert an-/abwählbare Liste. EMPTY_FILTER, Validierungstabelle und `applyFiltersAndSort` angepasst. Keine Scope-Reduktion mehr. |
| 5 | MED | behoben | `hasActiveFilter` feldweise explizit (`navigationFilter`, getrimmter `searchText`, jedes Dropdown-/Range-Feld `!== null`), nicht mehr generisch über `Object.entries`. |
| 6 | MED | behoben (Variante a) | `searchFields` schema-abgeleitet (`filter_type === 'text-search'`, aktuell nur `name`) und als Parameter an `applyFiltersAndSort` übergeben; keine hartkodierten Kontextfelder. Property 10 prüft gegen genau diese Menge. |
| 7 | MED | behoben | `distinctValuesForField` mit Signatur und Verhalten definiert: multi-value via `valueList` ausgerollt, `isPresent`-Filter, `localeCompare('de')`-Sortierung. Einzige Optionsquelle aller dropdown/multi-select-Filter. |
| 8 | MED | behoben | `countBy` als Helfer definiert (`{value,count}[]`, `isPresent`, `localeCompare`). Verdrahtung festgelegt: dropdowns aus `distinctValuesForField`, `availableRegions/Grapes` (mit Count) nur für die Nav. `availableCountries` entfernt. |
| 9 | MED | behoben | `withComponentInputBinding()` entfernt; Navigationstyp über `route.data.navType` je Route; WineWallComponent wertet `combineLatest([params, data])` mit `takeUntilDestroyed` aus. `routeConfig?.path`-Lesung gestrichen. |
| 10 | MED | behoben | Doku-Aussage korrigiert: `slugify` nur frontend-intern konsistent (Nav ↔ Matcher), keine Python-Konsistenz behauptet. Umlaut-Transliteration (ae/oe/ue/ss) ergänzt für saubere deutsche Slugs. |
| 11 | MED | behoben | Eindeutig auf `DialogService` festgelegt; AppComponent-Beispielcode auf `[wine]="dialog.wine()" (close)="dialog.close()"` korrigiert; lokales `selectedWine` samt Prosa gestrichen; `DialogService`-Vertrag ausformuliert. |
| 12 | MED | behoben | Scroll-Lock-`effect` mit `onCleanup(() => document.body.style.overflow = '')`; garantiertes Zurücksetzen bei Destroy/Hot-Reload/Testende. |
| 13 | NIT | behoben | Vollständige `EXTRA_LABELS`-Konstante für alle real vorkommenden Extra-Keys + snake_case-Titelcase-Fallback fixiert; `percentage` → „Alkoholgehalt (%)". |
| 14 | NIT | behoben | `formatPrice()`-Regel festgeschrieben: `toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' €'`. |
| 15 | NIT | behoben | `PAGE_SIZE = 24` als bewusste, benannte Festlegung in die Liste aufgenommen (mit Begründung Spaltenteilbarkeit). |

Keine Findings wurden zurückgestellt oder ignoriert; alle Änderungen bleiben innerhalb der ursprünglichen Requirements (Req 7–14, 17, 18) und der realen Artefakte (`wine-schema.json`, `wines.json`).
