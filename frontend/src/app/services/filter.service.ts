import { Injectable, computed, inject, signal } from '@angular/core';
import {
  EMPTY_FILTER,
  NavigationFilter,
  SortOption,
  Wine,
  WineFilter,
} from '../models/wine.model';
import { countBy, grapeList, slugify, valueList } from '../models/wine-util';
import { WineDataService } from './wine-data.service';
import { UserPreferencesService } from './user-preferences.service';

/**
 * Reine, DOM-freie, Property-testbare Filter- + Sortier-Funktion.
 * Alleinige Eigentümerin der Filter-AND-Invariante.
 */
export function applyFiltersAndSort(
  wines: Wine[],
  filter: WineFilter,
  navFilter: NavigationFilter | null,
  sort: SortOption,
  searchFields: string[],
): Wine[] {
  const filtered = wines.filter((wine) => {
    // 1. Navigation-Filter (Slug-Vergleich über slugify)
    if (navFilter) {
      if (navFilter.type === 'region') {
        if (!wine.origin || slugify(wine.origin) !== navFilter.slug) return false;
      } else {
        if (!grapeList(wine).some((g) => slugify(g) === navFilter.slug)) return false;
      }
    }
    // 2. Freitextsuche: case-insensitiv, NUR über schema-definierte text-search-Felder
    if (filter.searchText.trim()) {
      const q = filter.searchText.toLowerCase().trim();
      const haystacks = searchFields.flatMap((f) => valueList(wine, f));
      if (!haystacks.some((h) => h.toLowerCase().includes(q))) return false;
    }
    // 3. Dropdown-Filter — generisch über dropdowns-Record
    for (const [field, sel] of Object.entries(filter.dropdowns)) {
      if (sel != null && String(wine[field] ?? '') !== sel) return false;
    }
    // multi-select grape: OR innerhalb, AND gegenüber anderen Feldern
    if (filter.grape.length > 0) {
      const wineGrapes = grapeList(wine);
      if (!filter.grape.some((g) => wineGrapes.includes(g))) return false;
    }
    // 4. Range-Filter (null = inaktiv; fehlender Wert fällt bei aktiver Grenze raus)
    if (filter.yearFrom != null && (wine.year == null || wine.year < filter.yearFrom)) return false;
    if (filter.yearTo != null && (wine.year == null || wine.year > filter.yearTo)) return false;
    if (filter.ratingFrom != null && (wine.rating == null || wine.rating < filter.ratingFrom))
      return false;
    if (filter.ratingTo != null && (wine.rating == null || wine.rating > filter.ratingTo))
      return false;
    if (
      filter.tastingDateFrom != null &&
      (wine.tasting_date == null || wine.tasting_date < filter.tastingDateFrom)
    )
      return false;
    if (
      filter.tastingDateTo != null &&
      (wine.tasting_date == null || wine.tasting_date > filter.tastingDateTo)
    )
      return false;
    return true;
  });

  return filtered.slice().sort((a, b) => {
    if (sort === 'tasting_date_asc')
      return (a.tasting_date ?? '').localeCompare(b.tasting_date ?? '');
    if (sort === 'rating_desc') return (b.rating ?? 0) - (a.rating ?? 0);
    return (b.tasting_date ?? '').localeCompare(a.tasting_date ?? ''); // tasting_date_desc (Default)
  });
}

/**
 * Einzige Quelle der Wahrheit für Filter-, Such-, Sortier- und Ansichtszustand.
 * Keine andere Komponente hält filterrelevanten Zustand.
 */
@Injectable({ providedIn: 'root' })
export class FilterService {
  private readonly wineData = inject(WineDataService);
  private readonly prefs = inject(UserPreferencesService);

  readonly filter = signal<WineFilter>({ ...EMPTY_FILTER });
  readonly navigationFilter = signal<NavigationFilter | null>(null);
  readonly sortOption = signal<SortOption>('tasting_date_desc');
  readonly viewMode = signal<'grid' | 'list'>('grid');
  readonly infoToggleActive = signal(false);
  readonly visibleFilterFields = signal<string[]>([]);

  constructor() {
    const saved = this.prefs.load();
    this.sortOption.set(saved.sortOption);
    this.viewMode.set(saved.viewMode);
    this.visibleFilterFields.set(saved.visibleFilters);
  }

  // text-search-Felder schema-abgeleitet (Req 9.2) — aktuell nur 'name'
  readonly searchFields = computed(() =>
    this.wineData
      .schema()
      .filter((f) => f.filter_type === 'text-search')
      .map((f) => f.field),
  );

  readonly filteredWines = computed(() =>
    applyFiltersAndSort(
      this.wineData.wines(),
      this.filter(),
      this.navigationFilter(),
      this.sortOption(),
      this.searchFields(),
    ),
  );

  readonly availableRegions = computed(() => countBy(this.wineData.wines(), (w) => [w.origin]));
  readonly availableGrapes = computed(() =>
    countBy(this.wineData.wines(), (w) => valueList(w, 'grape')),
  );

  readonly hasActiveFilter = computed(() => {
    const f = this.filter();
    return (
      this.navigationFilter() !== null ||
      f.searchText.trim() !== '' ||
      f.grape.length > 0 ||
      Object.values(f.dropdowns).some((v) => v !== null) ||
      f.yearFrom !== null ||
      f.yearTo !== null ||
      f.ratingFrom !== null ||
      f.ratingTo !== null ||
      f.tastingDateFrom !== null ||
      f.tastingDateTo !== null
    );
  });

  setNavigationFilter(type: 'region' | 'rebsorte', slug: string): void {
    this.navigationFilter.set({ type, slug });
  }

  clearNavigationFilter(): void {
    this.navigationFilter.set(null);
  }

  /** Setzt NUR die Filterwerte zurück; Konfiguration (Sichtbarkeit/Sort/View) bleibt. */
  clearAllFilters(): void {
    this.filter.set({ ...EMPTY_FILTER });
    this.navigationFilter.set(null);
  }

  setSortOption(opt: SortOption): void {
    this.sortOption.set(opt);
    this._savePrefs();
  }

  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode.set(mode);
    this._savePrefs();
  }

  toggleFilterField(field: string, visible: boolean): void {
    this.visibleFilterFields.update((fields) => {
      const set = new Set(fields);
      if (visible) set.add(field);
      else set.delete(field);
      return [...set];
    });
    this._savePrefs();
  }

  updateFilter(patch: Partial<WineFilter>): void {
    this.filter.update((f) => ({ ...f, ...patch }));
  }

  private _savePrefs(): void {
    this.prefs.save({
      visibleFilters: this.visibleFilterFields(),
      sortOption: this.sortOption(),
      viewMode: this.viewMode(),
    });
  }
}
