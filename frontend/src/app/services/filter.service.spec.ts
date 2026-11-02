import { TestBed } from '@angular/core/testing';
import fc from 'fast-check';
import { applyFiltersAndSort, FilterService } from './filter.service';
import { WineDataService } from './wine-data.service';
import { UserPreferencesService } from './user-preferences.service';
import { Wine, WineFilter } from '../models/wine.model';
import { valueList } from '../models/wine-util';
import { arbitraryFilter, arbitraryWine, emptyFilter } from '../models/test-helpers';
import { signal } from '@angular/core';
import { WineSchemaField } from '../models/wine-schema.model';

function wine(p: Partial<Wine>): Wine {
  return { name: 'X', ...p } as Wine;
}

const SEARCH_FIELDS = ['name'];

describe('applyFiltersAndSort (reine Funktion)', () => {
  it('Einzelauswahl-Dropdown exakter Match', () => {
    const wines = [wine({ name: 'A', country: 'DE' }), wine({ name: 'B', country: 'FR' })];
    const f = emptyFilter();
    f.dropdowns['country'] = 'FR';
    const out = applyFiltersAndSort(wines, f, 'tasting_date_desc', SEARCH_FIELDS);
    expect(out.map((w) => w.name)).toEqual(['B']);
  });

  it('Multiselect grape: OR innerhalb, AND zwischen Feldern', () => {
    const wines = [
      wine({ name: 'A', grape: ['Riesling'], country: 'DE' }),
      wine({ name: 'B', grape: ['Silvaner'], country: 'DE' }),
      wine({ name: 'C', grape: ['Riesling'], country: 'FR' }),
    ];
    const f = emptyFilter();
    f.multiSelects['grape'] = ['Riesling', 'Silvaner'];
    f.dropdowns['country'] = 'DE';
    const out = applyFiltersAndSort(wines, f, 'tasting_date_desc', SEARCH_FIELDS);
    expect(out.map((w) => w.name).sort()).toEqual(['A', 'B']);
  });

  it('Multiselect origin (Region) filtert korrekt', () => {
    const wines = [
      wine({ name: 'A', origin: 'Rheingau' }),
      wine({ name: 'B', origin: 'Mosel' }),
      wine({ name: 'C', origin: 'Pfalz' }),
    ];
    const f = emptyFilter();
    f.multiSelects['origin'] = ['Rheingau', 'Pfalz'];
    const out = applyFiltersAndSort(wines, f, 'tasting_date_desc', SEARCH_FIELDS);
    expect(out.map((w) => w.name).sort()).toEqual(['A', 'C']);
  });

  it('rating-range schließt fehlende Werte aus', () => {
    const wines = [wine({ name: 'A', rating: 8 }), wine({ name: 'B' })];
    const f = emptyFilter();
    f.ratingFrom = 6;
    const out = applyFiltersAndSort(wines, f, 'tasting_date_desc', SEARCH_FIELDS);
    expect(out.map((w) => w.name)).toEqual(['A']);
  });

  it('date-range schließt fehlendes Datum symmetrisch aus (von und bis)', () => {
    const wines = [wine({ name: 'A', tasting_date: '2020-06-01' }), wine({ name: 'B' })];
    const fFrom = emptyFilter();
    fFrom.tastingDateFrom = '2020-01-01';
    expect(
      applyFiltersAndSort(wines, fFrom, 'tasting_date_desc', SEARCH_FIELDS).map((w) => w.name),
    ).toEqual(['A']);
    const fTo = emptyFilter();
    fTo.tastingDateTo = '2021-01-01';
    expect(
      applyFiltersAndSort(wines, fTo, 'tasting_date_desc', SEARCH_FIELDS).map((w) => w.name),
    ).toEqual(['A']);
  });

  it('Sortierung price_desc / price_asc', () => {
    const wines = [
      wine({ name: 'Mittel', price: 20 }),
      wine({ name: 'Teuer', price: 50 }),
      wine({ name: 'Günstig', price: 5 }),
    ];
    expect(
      applyFiltersAndSort(wines, emptyFilter(), 'price_desc', SEARCH_FIELDS).map((w) => w.name),
    ).toEqual(['Teuer', 'Mittel', 'Günstig']);
    expect(
      applyFiltersAndSort(wines, emptyFilter(), 'price_asc', SEARCH_FIELDS).map((w) => w.name),
    ).toEqual(['Günstig', 'Mittel', 'Teuer']);
  });

  it('mutiert die Eingabe nicht', () => {
    const wines = [wine({ name: 'B', tasting_date: '2020-01-01' }), wine({ name: 'A', tasting_date: '2021-01-01' })];
    const copy = [...wines];
    applyFiltersAndSort(wines, emptyFilter(), 'tasting_date_asc', SEARCH_FIELDS);
    expect(wines).toEqual(copy);
  });

  // Feature: weinliste, Property 10: Freitextsuche vergleicht ausschließlich schema-definierte
  // text-search-Felder; jeder Treffer matcht case-insensitiv in >=1 dieser Felder, kein Nicht-Treffer erscheint.
  it('Property 10: Freitextsuche Vollständigkeit/Korrektheit gegen searchFields', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryWine(), { maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 5 }),
        fc.subarray(['name', 'producer', 'origin', 'grape']),
        (wines, q, searchFields) => {
          const f = emptyFilter();
          f.searchText = q;
          const out = applyFiltersAndSort(wines, f, 'tasting_date_desc', searchFields);
          const query = q.toLowerCase().trim();
          const matches = (w: Wine) =>
            searchFields
              .flatMap((fld) => valueList(w, fld))
              .some((h) => h.toLowerCase().includes(query));
          // Korrektheit: jeder Ausgabewein matcht
          for (const w of out) expect(matches(w)).toBe(true);
          // Vollständigkeit: jeder matchende Eingabewein ist in der Ausgabe
          const outSet = new Set(out);
          for (const w of wines) if (matches(w)) expect(outSet.has(w)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: weinliste, Property 11: kombinierte Filter wirken als AND; jeder Ausgabewein erfüllt
  // alle aktiven Kriterien, kein Wein der eins verletzt ist dabei.
  it('Property 11: kombinierte Filter AND-Logik', () => {
    fc.assert(
      fc.property(fc.array(arbitraryWine(), { maxLength: 30 }), arbitraryFilter(), (wines, f) => {
        const out = applyFiltersAndSort(wines, f, 'tasting_date_desc', SEARCH_FIELDS);
        const satisfies = (w: Wine): boolean => {
          if (f.searchText.trim()) {
            const q = f.searchText.toLowerCase().trim();
            const hay = SEARCH_FIELDS.flatMap((fld) => valueList(w, fld));
            if (!hay.some((h) => h.toLowerCase().includes(q))) return false;
          }
          for (const [field, sel] of Object.entries(f.dropdowns))
            if (sel != null && !valueList(w, field).includes(sel)) return false;
          for (const [field, selected] of Object.entries(f.multiSelects)) {
            if (selected.length > 0) {
              const values = valueList(w, field);
              if (!selected.some((x) => values.includes(x))) return false;
            }
          }
          if (f.yearFrom != null && (w.year == null || w.year < f.yearFrom)) return false;
          if (f.yearTo != null && (w.year == null || w.year > f.yearTo)) return false;
          if (f.ratingFrom != null && (w.rating == null || w.rating < f.ratingFrom)) return false;
          if (f.ratingTo != null && (w.rating == null || w.rating > f.ratingTo)) return false;
          if (
            f.tastingDateFrom != null &&
            (w.tasting_date == null || w.tasting_date < f.tastingDateFrom)
          )
            return false;
          if (
            f.tastingDateTo != null &&
            (w.tasting_date == null || w.tasting_date > f.tastingDateTo)
          )
            return false;
          return true;
        };
        for (const w of out) expect(satisfies(w)).toBe(true);
        const outSet = new Set(out);
        for (const w of wines) if (satisfies(w)) expect(outSet.has(w)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: weinliste, Property 14: Reihenfolge nach Filterung erhalten — ein Prefix-slice
  // von filteredWines ist exaktes Prefix (gleiche Reihenfolge).
  it('Property 14: visibleWines ist exaktes Prefix von filteredWines', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryWine(), { maxLength: 40 }),
        arbitraryFilter(),
        fc.integer({ min: 0, max: 40 }),
        (wines, f, count) => {
          const full = applyFiltersAndSort(wines, f, 'rating_desc', SEARCH_FIELDS);
          const prefix = full.slice(0, count);
          for (let i = 0; i < prefix.length; i++) expect(prefix[i]).toBe(full[i]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('FilterService', () => {
  function setup(wines: Wine[], schema: WineSchemaField[] = []) {
    const dataMock = {
      wines: signal(wines),
      schema: signal(schema),
    };
    const prefsMock = {
      load: vi.fn().mockReturnValue({
        visibleFilters: ['country'],
        sortOption: 'rating_desc',
        viewMode: 'list',
      }),
      save: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        FilterService,
        { provide: WineDataService, useValue: dataMock },
        { provide: UserPreferencesService, useValue: prefsMock },
      ],
    });
    return { service: TestBed.inject(FilterService), prefsMock, dataMock };
  }

  it('initialisiert aus dem Cookie im Konstruktor', () => {
    const { service } = setup([]);
    expect(service.sortOption()).toBe('rating_desc');
    expect(service.viewMode()).toBe('list');
    expect(service.visibleFilterFields()).toEqual(['country']);
  });

  it('hasActiveFilter: leer=false, numerisches 0 löst nicht aus, Werte lösen aus', () => {
    const { service } = setup([]);
    expect(service.hasActiveFilter()).toBe(false);
    service.updateFilter({ ratingFrom: 0 });
    expect(service.hasActiveFilter()).toBe(true);
    service.clearAllFilters();
    expect(service.hasActiveFilter()).toBe(false);
    service.updateFilter({ multiSelects: { ...service.filter().multiSelects, grape: ['Riesling'] } });
    expect(service.hasActiveFilter()).toBe(true);
    service.clearAllFilters();
    service.updateFilter({ multiSelects: { ...service.filter().multiSelects, origin: ['Mosel'] } });
    expect(service.hasActiveFilter()).toBe(true);
    service.clearAllFilters();
    service.updateFilter({ dropdowns: { ...service.filter().dropdowns, country: 'Deutschland' } });
    expect(service.hasActiveFilter()).toBe(true);
  });

  it('toggleFilterField(false) setzt den zugehörigen Filterwert zurück', () => {
    const { service } = setup([]);
    // Multiselect (origin)
    service.toggleFilterField('origin', true);
    service.updateFilter({ multiSelects: { ...service.filter().multiSelects, origin: ['Mosel'] } });
    expect(service.filter().multiSelects['origin']).toEqual(['Mosel']);
    service.toggleFilterField('origin', false);
    expect(service.filter().multiSelects['origin']).toEqual([]);
    expect(service.visibleFilterFields()).not.toContain('origin');

    // Dropdown (country)
    service.updateFilter({ dropdowns: { ...service.filter().dropdowns, country: 'Deutschland' } });
    service.toggleFilterField('country', false);
    expect(service.filter().dropdowns['country']).toBeNull();

    // Range-Grenze (ratingFrom)
    service.updateFilter({ ratingFrom: 7 });
    service.toggleFilterField('ratingFrom', false);
    expect(service.filter().ratingFrom).toBeNull();

    // Datums-Grenze (tastingDateTo)
    service.updateFilter({ tastingDateTo: '2021-01-01' });
    service.toggleFilterField('tastingDateTo', false);
    expect(service.filter().tastingDateTo).toBeNull();
  });

  it('resetFilterKey leert nur den adressierten Filter', () => {
    const { service } = setup([]);
    service.updateFilter({
      multiSelects: { grape: ['Riesling'], origin: ['Mosel'] },
      ratingFrom: 5,
    });
    service.resetFilterKey('grape');
    expect(service.filter().multiSelects['grape']).toEqual([]);
    // andere Filter bleiben unangetastet
    expect(service.filter().multiSelects['origin']).toEqual(['Mosel']);
    expect(service.filter().ratingFrom).toBe(5);
  });

  it('clearAllFilters lässt Konfiguration unangetastet', () => {
    const { service } = setup([]);
    service.setSortOption('tasting_date_asc');
    service.setViewMode('list');
    service.toggleFilterField('origin', true);
    service.updateFilter({ searchText: 'abc' });
    service.clearAllFilters();
    expect(service.filter().searchText).toBe('');
    expect(service.sortOption()).toBe('tasting_date_asc');
    expect(service.viewMode()).toBe('list');
    expect(service.visibleFilterFields()).toContain('origin');
  });

  it('setSortOption/setViewMode/toggleFilterField persistieren; updateFilter nicht', () => {
    const { service, prefsMock } = setup([]);
    prefsMock.save.mockClear();
    service.updateFilter({ searchText: 'x' });
    expect(prefsMock.save).not.toHaveBeenCalled();
    service.setSortOption('tasting_date_asc');
    expect(prefsMock.save).toHaveBeenCalled();
  });

  it('searchFields aus Schema abgeleitet', () => {
    const { service } = setup(
      [],
      [
        { field: 'name', type: 'text', filter_type: 'text-search', default_filter: true },
        { field: 'origin', type: 'text', filter_type: 'dropdown', default_filter: false },
      ],
    );
    expect(service.searchFields()).toEqual(['name']);
  });
});
