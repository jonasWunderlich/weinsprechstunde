import { Injectable, computed, inject, signal } from '@angular/core';
import { EMPTY_FILTER, SortOption, Wine, WineFilter } from '../models/wine.model';
import { valueList } from '../models/wine-util';
import { WineDataSource } from './wine-data-source';
import { UserPreferencesService } from './user-preferences.service';

/**
 * Reine, DOM-freie, Property-testbare Filter- + Sortier-Funktion.
 * Alleinige Eigentümerin der Filter-AND-Invariante.
 */
export function applyFiltersAndSort(
  wines: Wine[],
  filter: WineFilter,
  sort: SortOption,
  searchFields: string[],
): Wine[] {
  const filtered = wines.filter((wine) => {
    // 1. Freitextsuche: case-insensitiv, NUR über schema-definierte text-search-Felder
    if (filter.searchText.trim()) {
      const q = filter.searchText.toLowerCase().trim();
      const haystacks = searchFields.flatMap((f) => valueList(wine, f));
      if (!haystacks.some((h) => h.toLowerCase().includes(q))) return false;
    }
    // 2. Einzelauswahl-Dropdowns (country, type, producer, quality)
    for (const [field, sel] of Object.entries(filter.dropdowns)) {
      if (sel != null && !valueList(wine, field).includes(sel)) return false;
    }
    // 3. Multiselect-Dropdowns (grape, origin): OR innerhalb, AND zwischen Feldern
    for (const [field, selected] of Object.entries(filter.multiSelects)) {
      if (selected.length > 0) {
        const values = valueList(wine, field);
        if (!selected.some((s) => values.includes(s))) return false;
      }
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
    switch (sort) {
      case 'tasting_date_asc':
        return (a.tasting_date ?? '').localeCompare(b.tasting_date ?? '');
      case 'rating_desc':
        return (b.rating ?? 0) - (a.rating ?? 0);
      case 'price_desc':
        return (b.price ?? -Infinity) - (a.price ?? -Infinity);
      case 'price_asc':
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      case 'name_asc':
        return compareByName(a, b, 'asc');
      case 'name_desc':
        return compareByName(a, b, 'desc');
      default: // tasting_date_desc
        return (b.tasting_date ?? '').localeCompare(a.tasting_date ?? '');
    }
  });
}

/**
 * Vergleicht zwei Weine nach `name` (case-insensitiv). Weine ohne nicht-leeren Namen
 * landen in beiden Richtungen am Ende, damit sie die alphabetische Liste nicht anführen.
 */
function compareByName(a: Wine, b: Wine, dir: 'asc' | 'desc'): number {
  const na = typeof a.name === 'string' ? a.name.trim().toLowerCase() : '';
  const nb = typeof b.name === 'string' ? b.name.trim().toLowerCase() : '';
  if (na === '' && nb === '') return 0;
  if (na === '') return 1; // a ohne Name → ans Ende
  if (nb === '') return -1; // b ohne Name → ans Ende
  return dir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
}

/**
 * Einzige Quelle der Wahrheit für Filter-, Such-, Sortier- und Ansichtszustand.
 * Keine andere Komponente hält filterrelevanten Zustand.
 */
@Injectable({ providedIn: 'root' })
export class FilterService {
  private readonly wineData = inject(WineDataSource);
  private readonly prefs = inject(UserPreferencesService);

  readonly filter = signal<WineFilter>({ ...EMPTY_FILTER });
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
      this.sortOption(),
      this.searchFields(),
    ),
  );

  readonly hasActiveFilter = computed(() => {
    const f = this.filter();
    return (
      f.searchText.trim() !== '' ||
      Object.values(f.dropdowns).some((v) => v !== null) ||
      Object.values(f.multiSelects).some((v) => v.length > 0) ||
      f.yearFrom !== null ||
      f.yearTo !== null ||
      f.ratingFrom !== null ||
      f.ratingTo !== null ||
      f.tastingDateFrom !== null ||
      f.tastingDateTo !== null
    );
  });

  /** Setzt NUR die Filterwerte zurück; Konfiguration (Sichtbarkeit/Sort/View) bleibt. */
  clearAllFilters(): void {
    this.filter.set({ ...EMPTY_FILTER });
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
    // Beim Ausblenden den zugehörigen Filterwert zurücksetzen, damit ein
    // entfernter Filter nicht unsichtbar weiterwirkt.
    if (!visible) this.resetFilterKey(field);
    this._savePrefs();
  }

  /** Setzt den Filterwert eines einzelnen optionalen Filter-Keys zurück. */
  resetFilterKey(key: string): void {
    this.filter.update((f) => {
      switch (key) {
        case 'grape':
        case 'origin':
          return { ...f, multiSelects: { ...f.multiSelects, [key]: [] } };
        case 'country':
        case 'type':
        case 'producer':
        case 'quality':
          return { ...f, dropdowns: { ...f.dropdowns, [key]: null } };
        case 'yearFrom':
        case 'yearTo':
        case 'ratingFrom':
        case 'ratingTo':
          return { ...f, [key]: null };
        case 'tastingDateFrom':
        case 'tastingDateTo':
          return { ...f, [key]: null };
        default:
          return f;
      }
    });
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
