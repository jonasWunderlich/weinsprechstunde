import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilterService, Wine, WineDataSource } from '@weinsprechstunde/shared';
import { WineEditorComponent } from './wine-editor';
import { EditorStateService } from '../../services/editor-state.service';
import { EditorWineDataService } from '../../services/editor-wine-data.service';
import {
  ConflictError,
  FileSystemAccessService,
  ScanResult,
  WineEntry,
} from '../../services/file-system-access.service';
import { DEFAULT_WINE_SCHEMA } from '../../models/default-schema';

/**
 * Fake-„Platte": Dateien mit hochzählendem mtime. `writeJson` prüft den erwarteten
 * Zeitstempel wie der echte Service; `readJson` kann pro Pfad angehalten werden, um
 * Race-Situationen (schnelles Weiterklicken) nachzustellen.
 */
class FakeDisk {
  readonly files = new Map<string, { text: string; mtime: number }>();
  private clock = 1000;
  readonly writes: { path: string; wine: Wine }[] = [];
  private readonly holds = new Map<string, Promise<void>>();
  private readonly releases = new Map<string, () => void>();

  put(path: string, wine: Wine | string): void {
    const text = typeof wine === 'string' ? wine : JSON.stringify(wine);
    this.files.set(path, { text, mtime: ++this.clock });
  }
  /** Externe Änderung (z. B. Cloud-Sync): neuer Inhalt, neuer mtime. */
  externalChange(path: string, wine: Wine): void {
    this.put(path, wine);
  }
  remove(path: string): void {
    this.files.delete(path);
  }
  mtime(path: string): number {
    return this.files.get(path)?.mtime ?? -1;
  }
  wineOnDisk(path: string): Wine {
    return JSON.parse(this.files.get(path)!.text) as Wine;
  }
  /** Hält `readJson` für den Pfad an, bis der zurückgegebene Callback aufgerufen wird. */
  hold(path: string): () => void {
    let release!: () => void;
    this.holds.set(
      path,
      new Promise<void>((r) => {
        release = r;
      }),
    );
    this.releases.set(path, release);
    return release;
  }

  hasAccess(): boolean {
    return true;
  }
  async scan(): Promise<ScanResult> {
    const entries: WineEntry[] = [];
    for (const [path, f] of this.files) {
      let wine: Wine | null = null;
      let broken = false;
      try {
        wine = JSON.parse(f.text) as Wine;
      } catch {
        broken = true;
      }
      const parts = path.split('/');
      const name = parts.pop() as string;
      entries.push({ name, path, dirSegments: parts, wine, broken, lastModified: f.mtime });
    }
    return { entries, images: [] };
  }
  async readJson(path: string): Promise<{ wine: Wine; lastModified: number }> {
    const gate = this.holds.get(path);
    if (gate) {
      this.holds.delete(path);
      await gate;
    }
    const f = this.files.get(path);
    if (!f) throw new DOMException('not found', 'NotFoundError');
    return { wine: JSON.parse(f.text) as Wine, lastModified: f.mtime };
  }
  async writeJson(path: string, wine: Wine, expected?: number): Promise<number> {
    const f = this.files.get(path);
    if (!f) throw new DOMException('not found', 'NotFoundError');
    if (expected !== undefined && f.mtime !== expected) throw new ConflictError(expected, f.mtime);
    this.writes.push({ path, wine: structuredClone(wine) });
    this.put(path, wine);
    return this.mtime(path);
  }
  async listMedia(): Promise<[]> {
    return [];
  }
  async createThumbnail(): Promise<{ blob: Blob; width: number; height: number }> {
    return { blob: new Blob([]), width: 1, height: 1 };
  }
}

interface Ctx {
  fixture: ComponentFixture<WineEditorComponent>;
  state: EditorStateService;
  disk: FakeDisk;
  filter: FilterService;
  wineData: EditorWineDataService;
  el: HTMLElement;
  select(path: string): void;
  settle(ms?: number): Promise<void>;
  type(field: string, value: string): void;
  input(field: string): HTMLInputElement;
}

async function setup(files: Record<string, Wine | string>): Promise<Ctx> {
  const disk = new FakeDisk();
  for (const [p, w] of Object.entries(files)) disk.put(p, w);
  TestBed.configureTestingModule({
    imports: [WineEditorComponent],
    providers: [
      { provide: FileSystemAccessService, useValue: disk },
      { provide: WineDataSource, useExisting: EditorWineDataService },
      EditorWineDataService,
      FilterService,
      EditorStateService,
    ],
  });
  const state = TestBed.inject(EditorStateService);
  state.setSchema(DEFAULT_WINE_SCHEMA);
  await state.refresh();
  const fixture = TestBed.createComponent(WineEditorComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (ms = 0): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  };
  return {
    fixture,
    state,
    disk,
    filter: TestBed.inject(FilterService),
    wineData: TestBed.inject(EditorWineDataService),
    el,
    select: (path) => {
      state.select(state.listItems().find((i) => i.id === path) ?? null);
      fixture.detectChanges();
    },
    settle,
    type: (field, value) => {
      const input = el.querySelector(`[data-field="${field}"] input`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    },
    input: (field) => el.querySelector(`[data-field="${field}"] input`) as HTMLInputElement,
  };
}

const status = (el: HTMLElement): string | null =>
  el.querySelector('[data-testid="save-status"]')?.textContent?.trim() ?? null;
const conflictBanner = (el: HTMLElement): Element | null =>
  el.querySelector('[data-testid="conflict-banner"]');

describe('WineEditor: frisch laden und Cache nach dem Speichern aktualisieren', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const files = (): Record<string, Wine | string> => ({
    'a.json': { name: 'Alpha', price: 5, tasting_date: '2024-01-02' },
    'b.json': { name: 'Beta', tasting_date: '2024-01-01' },
  });

  describe('Regression A → B → A', () => {
    it('zeigt beim Wiederöffnen den gespeicherten Stand (nicht den alten Scan-Stand)', async () => {
      const c = await setup(files());
      c.select('a.json');
      await c.settle();
      c.type('price', '9.5');
      await c.settle(500);
      expect(c.disk.wineOnDisk('a.json').price).toBe(9.5);

      c.select('b.json');
      await c.settle();
      c.select('a.json');
      await c.settle();

      expect(c.input('price').value).toBe('9.5');
    });

    it('meldet nach dem Wiederöffnen keinen Konflikt beim nächsten Auto-Save', async () => {
      const c = await setup(files());
      c.select('a.json');
      await c.settle();
      c.type('price', '9.5');
      await c.settle(500);

      c.select('b.json');
      await c.settle();
      c.select('a.json');
      await c.settle();

      c.type('year', '2019');
      await c.settle(500);

      expect(conflictBanner(c.el)).toBeNull();
      expect(status(c.el)).toBe('Gespeichert');
      const onDisk = c.disk.wineOnDisk('a.json');
      expect(onDisk.year).toBe(2019);
      expect(onDisk.price).toBe(9.5);
    });

    it('erkennt eine echte externe Änderung nach dem Öffnen weiterhin als Konflikt', async () => {
      const c = await setup(files());
      c.select('a.json');
      await c.settle();
      c.type('price', '9.5');
      await c.settle(500);
      c.select('b.json');
      await c.settle();
      c.select('a.json');
      await c.settle();

      c.disk.externalChange('a.json', { name: 'Alpha extern', price: 1 });
      c.type('year', '2019');
      await c.settle(500);

      expect(conflictBanner(c.el)).not.toBeNull();
      // Nichts wurde still überschrieben.
      expect(c.disk.wineOnDisk('a.json').name).toBe('Alpha extern');
    });

    it('zeigt beim Öffnen eine extern geänderte Datei im frischen Stand', async () => {
      const c = await setup(files());
      c.disk.externalChange('a.json', { name: 'Alpha extern', price: 7 });
      c.select('a.json');
      await c.settle();
      expect(c.input('price').value).toBe('7');
      expect(c.input('name').value).toBe('Alpha extern');
      c.type('year', '2019');
      await c.settle(500);
      expect(conflictBanner(c.el)).toBeNull();
    });
  });

  describe('Laden: readonly, latest-wins, Fehler', () => {
    it('zeigt zunächst den Cache read-only (aria-busy) und gibt nach dem Lesen frei', async () => {
      const c = await setup(files());
      c.disk.externalChange('a.json', { name: 'Alpha neu', price: 8 });
      // Cache bleibt auf dem Scan-Stand, die Platte ist neuer.
      const release = c.disk.hold('a.json');
      c.select('a.json');
      await c.settle();

      const form = c.el.querySelector('form.wine-editor__form') as HTMLFormElement;
      expect(form).toBeTruthy();
      expect(form.getAttribute('aria-busy')).toBe('true');
      expect(c.input('price').readOnly).toBe(true);
      expect(c.input('price').value).toBe('5');

      release();
      await c.settle();
      expect(form.getAttribute('aria-busy')).not.toBe('true');
      expect(c.input('price').readOnly).toBe(false);
      expect(c.input('price').value).toBe('8');
    });

    it('latest-wins: späte Antwort einer früheren Auswahl wird verworfen', async () => {
      const c = await setup(files());
      const releaseA = c.disk.hold('a.json');
      c.select('a.json');
      await c.settle();
      c.select('b.json');
      await c.settle();
      expect(c.input('name').value).toBe('Beta');

      releaseA();
      await c.settle();
      expect(c.input('name').value).toBe('Beta');
      expect(c.input('name').readOnly).toBe(false);

      // Gespeichert wird in Beta, nicht in Alpha.
      c.type('year', '2001');
      await c.settle(500);
      expect(c.disk.writes.at(-1)?.path).toBe('b.json');
    });

    it('latest-wins: schnelles Weiterklicken über selectRelative', async () => {
      const c = await setup({
        ...files(),
        'c.json': { name: 'Gamma', tasting_date: '2023-01-01' },
      });
      const releaseA = c.disk.hold('a.json');
      const releaseB = c.disk.hold('b.json');
      c.select('a.json');
      await c.settle();
      c.state.selectRelative(1);
      await c.settle();
      c.state.selectRelative(1);
      await c.settle();
      expect(c.state.selectedId()).toBe('c.json');
      releaseB();
      releaseA();
      await c.settle();
      expect(c.input('name').value).toBe('Gamma');
      expect(c.input('name').readOnly).toBe(false);
    });

    it('ersetzt das Formular durch eine Warnung, wenn die Datei nicht mehr existiert', async () => {
      const c = await setup(files());
      c.disk.remove('a.json');
      c.select('a.json');
      await c.settle();

      expect(c.el.querySelector('form.wine-editor__form')).toBeNull();
      const alert = c.el.querySelector('[data-testid="load-error"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toContain('Aktualisieren');
      // Speichern ist nicht möglich.
      c.fixture.componentInstance.pickImage('x.jpg');
      await c.settle(500);
      expect(c.disk.writes).toHaveLength(0);
    });

    it('ersetzt das Formular durch eine Warnung bei defektem JSON', async () => {
      const c = await setup(files());
      c.disk.put('a.json', '{ kaputt');
      c.select('a.json');
      await c.settle();
      expect(c.el.querySelector('form.wine-editor__form')).toBeNull();
      expect(c.el.querySelector('[data-testid="load-error"]')?.getAttribute('role')).toBe('alert');
    });
  });

  describe('Cache-Aktualisierung nach dem Speichern', () => {
    it('ersetzt den Eintrag mit demselben Objekt in Cache und Wine-Daten, lastModified vom Schreibvorgang', async () => {
      const c = await setup(files());
      c.select('a.json');
      await c.settle();
      c.type('name', 'Alpha Neu');
      await c.settle(500);

      const entry = c.state.entries().find((e) => e.path === 'a.json')!;
      expect(entry.wine?.name).toBe('Alpha Neu');
      expect(entry.lastModified).toBe(c.disk.mtime('a.json'));
      expect(c.wineData.wines().includes(entry.wine as Wine)).toBe(true);
      // Liste (Name) ist aktuell und der Eintrag bleibt auffindbar.
      const item = c.state.listItems().find((i) => i.id === 'a.json');
      expect(item?.kind === 'created' ? item.wine?.name : null).toBe('Alpha Neu');
    });

    it('Filter und Liste arbeiten mit dem gespeicherten Stand', async () => {
      const c = await setup(files());
      c.select('a.json');
      await c.settle();
      c.type('name', 'Zweigelt');
      await c.settle(500);

      c.filter.updateFilter({ searchText: 'zweigelt' });
      TestBed.tick();
      const ids = c.state.listItems().map((i) => i.id);
      expect(ids).toEqual(['a.json']);
    });

    it('setzt das Formular nicht zurück: Eingabe in einem anderen Feld bleibt erhalten', async () => {
      const c = await setup(files());
      c.select('a.json');
      await c.settle();
      c.type('price', '9.5');
      await c.settle(400);
      c.type('year', '2019'); // läuft noch im Debounce, wenn der Preis gespeichert wird
      await c.settle(100); // Preis wird gespeichert → Cache-Update

      expect(c.disk.wineOnDisk('a.json').price).toBe(9.5);
      expect(c.input('year').value).toBe('2019');

      await c.settle(400);
      const onDisk = c.disk.wineOnDisk('a.json');
      expect(onDisk.year).toBe(2019);
      expect(onDisk.price).toBe(9.5);
      expect(conflictBanner(c.el)).toBeNull();
    });

    it('aktualisiert den Cache auch nach „Überschreiben"', async () => {
      const c = await setup(files());
      c.select('a.json');
      await c.settle();
      c.disk.externalChange('a.json', { name: 'Alpha extern' });
      c.type('price', '3');
      await c.settle(500);
      expect(conflictBanner(c.el)).not.toBeNull();

      await c.fixture.componentInstance.confirmOverwrite();
      await c.settle();
      const entry = c.state.entries().find((e) => e.path === 'a.json')!;
      expect(entry.lastModified).toBe(c.disk.mtime('a.json'));
      expect(entry.wine?.price).toBe(3);
      expect(c.wineData.wines().includes(entry.wine as Wine)).toBe(true);
    });
  });
});
