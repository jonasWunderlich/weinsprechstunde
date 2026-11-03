import { TestBed } from '@angular/core/testing';
import fc from 'fast-check';
import { UserPreferencesService } from './user-preferences.service';
import { UserPreferences } from '../models/user-preferences.model';
import { SortOption } from '../models/wine.model';

function clearCookie() {
  document.cookie = 'ws_prefs=; path=/; max-age=0';
}

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [UserPreferencesService] });
    service = TestBed.inject(UserPreferencesService);
    clearCookie();
  });

  afterEach(() => clearCookie());

  it('load liefert Defaults bei fehlendem Cookie', () => {
    expect(service.load()).toEqual({
      visibleFilters: [],
      sortOption: 'tasting_date_desc',
      viewMode: 'grid',
    });
  });

  it('load liefert Defaults bei korruptem Cookie', () => {
    document.cookie = 'ws_prefs=' + encodeURIComponent('{not json') + '; path=/';
    expect(service.load().sortOption).toBe('tasting_date_desc');
  });

  it('merged fehlende Felder mit Defaults', () => {
    document.cookie = 'ws_prefs=' + encodeURIComponent(JSON.stringify({ viewMode: 'list' })) + '; path=/';
    const p = service.load();
    expect(p.viewMode).toBe('list');
    expect(p.sortOption).toBe('tasting_date_desc');
  });

  // Feature: weinliste, Property 19: save(p) → load() liefert strukturell gleiches Objekt
  // für beliebige gültige UserPreferences (nur Konfiguration, keine Filterwerte).
  it('Property 19: Cookie-Roundtrip erhält Konfiguration', () => {
    const sortArb = fc.constantFrom<SortOption>(
      'tasting_date_desc',
      'tasting_date_asc',
      'rating_desc',
    );
    const prefsArb: fc.Arbitrary<UserPreferences> = fc.record({
      visibleFilters: fc.array(fc.string({ maxLength: 10 }), { maxLength: 5 }),
      sortOption: sortArb,
      viewMode: fc.constantFrom<'grid' | 'list'>('grid', 'list'),
    });
    fc.assert(
      fc.property(prefsArb, (p) => {
        service.save(p);
        expect(service.load()).toEqual(p);
      }),
      { numRuns: 100 },
    );
  });
});
