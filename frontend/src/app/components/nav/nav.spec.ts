import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { NavComponent } from './nav';
import { FilterService } from '../../services/filter.service';

describe('NavComponent', () => {
  function setup() {
    const fsMock = {
      availableRegions: signal([{ value: 'Rheingau', count: 7 }]),
      availableGrapes: signal([{ value: 'Grüner Veltliner', count: 3 }]),
      clearAllFilters: vi.fn(),
    };
    const router = { navigate: vi.fn() };
    TestBed.configureTestingModule({
      imports: [NavComponent],
      providers: [
        { provide: FilterService, useValue: fsMock },
        { provide: Router, useValue: router },
      ],
    });
    const fixture = TestBed.createComponent(NavComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, fsMock, router };
  }

  it('zeigt Regionen-Links mit Count nach Öffnen', () => {
    const { fixture, c } = setup();
    c.toggleRegions();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Rheingau (7)');
  });

  it('navigiert mit korrektem Slug und schließt Menü', () => {
    const { c, router } = setup();
    c.toggleRegions();
    c.navigateToRegion('Rheingau');
    expect(router.navigate).toHaveBeenCalledWith(['/region', 'rheingau']);
    expect(c.regionsOpen()).toBe(false);
  });

  it('navigiert Rebsorte mit transliteriertem Slug', () => {
    const { c, router } = setup();
    c.navigateToGrape('Grüner Veltliner');
    expect(router.navigate).toHaveBeenCalledWith(['/rebsorte', 'gruener-veltliner']);
  });

  it('Dropdowns schließen sich gegenseitig', () => {
    const { c } = setup();
    c.toggleRegions();
    expect(c.regionsOpen()).toBe(true);
    c.toggleGrapes();
    expect(c.regionsOpen()).toBe(false);
    expect(c.grapesOpen()).toBe(true);
  });

  it('goHome ruft clearAllFilters und navigiert auf /', () => {
    const { c, fsMock, router } = setup();
    c.goHome();
    expect(fsMock.clearAllFilters).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
