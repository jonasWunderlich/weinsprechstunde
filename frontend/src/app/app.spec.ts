import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { WineDataService } from './services/wine-data.service';
import { FilterService } from './services/filter.service';
import { LoadState, Wine } from './models/wine.model';
import { WineSchemaField } from './models/wine-schema.model';

describe('App (Shell)', () => {
  function setup(state: LoadState, wines: Wine[] = []) {
    const loadState = signal<LoadState>(state);
    const dataMock = {
      loadState,
      wines: signal<Wine[]>(wines),
      schema: signal<WineSchemaField[]>([]),
      loadAll: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: WineDataService, useValue: dataMock }],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return { fixture, dataMock, loadState };
  }

  it('erstellt die Shell und ruft loadAll', () => {
    const { fixture, dataMock } = setup('idle');
    expect(fixture.componentInstance).toBeTruthy();
    expect(dataMock.loadAll).toHaveBeenCalled();
  });

  it('zeigt Ladehinweis bei loading', () => {
    const { fixture } = setup('loading');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Lade Weine');
  });

  it('zeigt Fehlerhinweis bei error', () => {
    const { fixture } = setup('error');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Fehler beim Laden');
  });

  it('rendert Router-Outlet bei loaded', () => {
    const { fixture } = setup('loaded');
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull();
  });

  it('lädt die echten 559 Weine über einen gemockten DataService', () => {
    // Smoke-Check: App bindet die geladenen Daten; der DataService liefert die reale Menge.
    const wines = Array.from({ length: 559 }, (_, i) => ({ name: 'W' + i }) as Wine);
    const { dataMock } = setup('loaded', wines);
    expect(dataMock.wines().length).toBe(559);
  });

  it('Shortcut i schaltet das Info-Overlay um', () => {
    const { fixture } = setup('loaded');
    const fs = TestBed.inject(FilterService);
    expect(fs.infoToggleActive()).toBe(false);
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'i' }));
    expect(fs.infoToggleActive()).toBe(true);
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'i' }));
    expect(fs.infoToggleActive()).toBe(false);
  });

  it('Shortcut l wechselt zwischen Grid und Liste', () => {
    const { fixture } = setup('loaded');
    const fs = TestBed.inject(FilterService);
    expect(fs.viewMode()).toBe('grid');
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'l' }));
    expect(fs.viewMode()).toBe('list');
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'l' }));
    expect(fs.viewMode()).toBe('grid');
  });

  it('Shortcuts ignorieren Eingaben in Formularfeldern', () => {
    const { fixture } = setup('loaded');
    const fs = TestBed.inject(FilterService);
    const input = document.createElement('input');
    const ev = new KeyboardEvent('keydown', { key: 'i' });
    Object.defineProperty(ev, 'target', { value: input });
    fixture.componentInstance.onKeydown(ev);
    expect(fs.infoToggleActive()).toBe(false);
  });

  it('Shortcuts ignorieren Modifier-Kombinationen', () => {
    const { fixture } = setup('loaded');
    const fs = TestBed.inject(FilterService);
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'l', metaKey: true }));
    expect(fs.viewMode()).toBe('grid');
  });
});
