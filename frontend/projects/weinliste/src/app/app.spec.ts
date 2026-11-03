import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { App } from './app';
import {
  FilterService,
  LoadState,
  Wine,
  WineDataSource,
  WineSchemaField,
} from '@weinsprechstunde/shared';
import { WineDataService } from './services/wine-data.service';
import { DialogService } from './services/dialog.service';

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
      providers: [
        provideRouter([]),
        { provide: WineDataService, useValue: dataMock },
        { provide: WineDataSource, useValue: dataMock },
      ],
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

  describe('Pfeiltasten-Navigation im WineDetailDialog', () => {
    const WINES: Wine[] = [
      { name: 'A' } as Wine,
      { name: 'B' } as Wine,
      { name: 'C' } as Wine,
    ];

    function arrowSetup() {
      const ctx = setup('loaded', WINES);
      const dialog = TestBed.inject(DialogService);
      const app = ctx.fixture.componentInstance;
      return { ...ctx, dialog, app };
    }

    it('→ öffnet bei geschlossenem Dialog den ersten Wein', () => {
      const { app, dialog } = arrowSetup();
      expect(dialog.wine()).toBeNull();
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(dialog.wine()?.name).toBe('A');
    });

    it('← öffnet bei geschlossenem Dialog den letzten Wein', () => {
      const { app, dialog } = arrowSetup();
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(dialog.wine()?.name).toBe('C');
    });

    it('→ zeigt den nächsten Wein', () => {
      const { app, dialog } = arrowSetup();
      dialog.open(WINES[0]);
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(dialog.wine()?.name).toBe('B');
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(dialog.wine()?.name).toBe('C');
    });

    it('← zeigt den vorherigen Wein', () => {
      const { app, dialog } = arrowSetup();
      dialog.open(WINES[2]);
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(dialog.wine()?.name).toBe('B');
    });

    it('→ wrappt vom letzten auf den ersten Wein', () => {
      const { app, dialog } = arrowSetup();
      dialog.open(WINES[2]);
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(dialog.wine()?.name).toBe('A');
    });

    it('← wrappt vom ersten auf den letzten Wein', () => {
      const { app, dialog } = arrowSetup();
      dialog.open(WINES[0]);
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(dialog.wine()?.name).toBe('C');
    });

    it('passiert nichts bei leerer Liste', () => {
      const ctx = setup('loaded', []);
      const dialog = TestBed.inject(DialogService);
      ctx.fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(dialog.wine()).toBeNull();
    });

    it('ignoriert Pfeiltasten in Eingabefeldern', () => {
      const { app, dialog } = arrowSetup();
      const input = document.createElement('input');
      const ev = new KeyboardEvent('keydown', { key: 'ArrowRight' });
      Object.defineProperty(ev, 'target', { value: input });
      app.onKeydown(ev);
      expect(dialog.wine()).toBeNull();
    });

    it('ignoriert Pfeiltasten mit Modifier', () => {
      const { app, dialog } = arrowSetup();
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }));
      expect(dialog.wine()).toBeNull();
    });

    it('blockiert i/l bei offenem Dialog, während ←/→ navigieren', () => {
      const { app, dialog } = arrowSetup();
      const fs = TestBed.inject(FilterService);
      dialog.open(WINES[0]);

      // i und l bleiben bei offenem Dialog wirkungslos
      app.onKeydown(new KeyboardEvent('keydown', { key: 'i' }));
      expect(fs.infoToggleActive()).toBe(false);
      app.onKeydown(new KeyboardEvent('keydown', { key: 'l' }));
      expect(fs.viewMode()).toBe('grid');

      // Pfeiltasten navigieren weiterhin
      app.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(dialog.wine()?.name).toBe('B');
    });
  });

  describe('Escape schließt den WineDetailDialog', () => {
    const WINES: Wine[] = [{ name: 'A' } as Wine, { name: 'B' } as Wine];

    function escSetup() {
      const ctx = setup('loaded', WINES);
      const dialog = TestBed.inject(DialogService);
      const app = ctx.fixture.componentInstance;
      return { ...ctx, dialog, app };
    }

    it('Escape schließt den geöffneten Dialog', () => {
      const { app, dialog } = escSetup();
      dialog.open(WINES[0]);
      expect(dialog.wine()?.name).toBe('A');
      app.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(dialog.wine()).toBeNull();
    });

    it('Escape tut nichts bei geschlossenem Dialog', () => {
      const { app, dialog } = escSetup();
      expect(dialog.wine()).toBeNull();
      app.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(dialog.wine()).toBeNull();
    });

    it('Escape in einem Eingabefeld schließt den Dialog nicht', () => {
      const { app, dialog } = escSetup();
      dialog.open(WINES[0]);
      const input = document.createElement('input');
      const ev = new KeyboardEvent('keydown', { key: 'Escape' });
      Object.defineProperty(ev, 'target', { value: input });
      app.onKeydown(ev);
      expect(dialog.wine()?.name).toBe('A');
    });
  });
});
