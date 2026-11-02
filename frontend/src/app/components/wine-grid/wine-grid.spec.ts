import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { WineGridComponent } from './wine-grid';
import { FilterService } from '../../services/filter.service';
import { DialogService } from '../../services/dialog.service';
import { Wine } from '../../models/wine.model';

function makeWines(n: number): Wine[] {
  return Array.from({ length: n }, (_, i) => ({ name: 'W' + i }) as Wine);
}

describe('WineGridComponent', () => {
  function setup(wines: Wine[], hasActive = false) {
    const filtered = signal(wines);
    const hasActiveFilter = signal(hasActive);
    const fsMock = {
      filteredWines: filtered,
      hasActiveFilter,
      infoToggleActive: signal(false),
      clearAllFilters: vi.fn(),
    };
    const dialog = { open: vi.fn() };
    const router = { navigate: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [WineGridComponent],
      providers: [
        { provide: FilterService, useValue: fsMock },
        { provide: DialogService, useValue: dialog },
        { provide: Router, useValue: router },
      ],
    });
    const fixture = TestBed.createComponent(WineGridComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, fsMock, dialog, router, filtered };
  }

  it('visibleWines zeigt alle gefilterten Weine ohne Paginierung', () => {
    const { c } = setup(makeWines(100));
    expect(c.visibleWines().length).toBe(100);
    expect(c.visibleWines().map((w) => w.name)).toEqual(makeWines(100).map((w) => w.name));
  });

  it('visibleWines folgt Filteränderungen vollständig', () => {
    const { c, filtered, fixture } = setup(makeWines(100));
    expect(c.visibleWines().length).toBe(100);
    filtered.set(makeWines(30));
    fixture.detectChanges();
    expect(c.visibleWines().length).toBe(30);
  });

  it('Back-Button-Sichtbarkeit folgt hasActiveFilter', () => {
    expect(setup(makeWines(5), false).c.showBackButton()).toBe(false);
    expect(setup(makeWines(5), true).c.showBackButton()).toBe(true);
  });

  it('isEmpty bei leerer Liste', () => {
    expect(setup([]).c.isEmpty()).toBe(true);
  });

  it('openDetail ruft DialogService.open', () => {
    const { c, dialog } = setup(makeWines(3));
    c.openDetail({ name: 'X' } as Wine);
    expect(dialog.open).toHaveBeenCalled();
  });

  it('goBack ruft clearAllFilters und navigiert auf /', () => {
    const { c, fsMock, router } = setup(makeWines(3), true);
    c.goBack();
    expect(fsMock.clearAllFilters).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
