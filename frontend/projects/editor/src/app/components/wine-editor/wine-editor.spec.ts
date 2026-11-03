import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FilterService, Wine, WineDataSource } from '@weinsprechstunde/shared';
import { WineEditorComponent } from './wine-editor';
import { EditorStateService } from '../../services/editor-state.service';
import { EditorWineDataService } from '../../services/editor-wine-data.service';
import {
  FileSystemAccessService,
  ImageEntry,
  ScanResult,
  WineEntry,
} from '../../services/file-system-access.service';
import { DEFAULT_WINE_SCHEMA } from '../../models/default-schema';

function wineEntry(path: string, wine: Wine | null, broken = false, lastModified = 0): WineEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, wine, broken, lastModified };
}

class FakeFsa {
  scanResult: ScanResult = { entries: [], images: [] };
  images: ImageEntry[] = [];
  /** Protokoll der writeJson-Aufrufe (Pfad + geschriebenes Wine-Objekt). */
  readonly writes: { path: string; wine: Wine }[] = [];
  hasAccess(): boolean {
    return true;
  }
  async scan(): Promise<ScanResult> {
    return this.scanResult;
  }
  async writeJson(path: string, wine: Wine): Promise<number> {
    this.writes.push({ path, wine });
    return 1;
  }
  async listMedia(): Promise<[]> {
    return [];
  }
  /** Protokoll der Archivierungs-Verschiebungen (von ArchiveService genutzt). */
  readonly archived: string[] = [];
  async archiveFile(sourcePath: string): Promise<string> {
    this.archived.push(sourcePath);
    return `_archive/${sourcePath.split('/').pop()}`;
  }
  async fileExists(path: string): Promise<boolean> {
    return this.scanResult.images.some((i) => i.path === path);
  }
  async moveFile(sourcePath: string, destDirSegments: string[]): Promise<string> {
    return [...destDirSegments, sourcePath.split('/').pop()].join('/');
  }
}

async function render(
  entries: WineEntry[],
  images: ImageEntry[] = [],
): Promise<{
  fixture: ReturnType<typeof TestBed.createComponent<WineEditorComponent>>;
  state: EditorStateService;
  fsa: FakeFsa;
}> {
  const fsa = new FakeFsa();
  fsa.scanResult = { entries, images };
  TestBed.configureTestingModule({
    imports: [WineEditorComponent],
    providers: [
      { provide: FileSystemAccessService, useValue: fsa },
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
  return { fixture, state, fsa };
}

describe('WineEditorComponent', () => {
  it('rendert ein Eingabefeld pro Schema-Feld (dynamisch, Req 17.16)', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha' })];
    const { fixture, state } = await render(entries);
    state.select(state.listItems()[0]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // tasting_date als Datepicker, rating als number mit step 0.1 (Req 17.16).
    const dateInput = el.querySelector('[data-field="tasting_date"] input[type="date"]');
    expect(dateInput).toBeTruthy();
    const rating = el.querySelector('[data-field="rating"] input[type="number"]');
    expect(rating?.getAttribute('step')).toBe('0.1');
    expect(rating?.getAttribute('min')).toBe('1');
    expect(rating?.getAttribute('max')).toBe('10');
  });

  it('markiert einen Eintrag ohne Namen als unvollständig (Req 17.20)', async () => {
    const entries = [wineEntry('a.json', { name: '' } as Wine)];
    const { fixture, state } = await render(entries);
    state.select(state.listItems()[0]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.wine-editor__badge')?.textContent).toContain('unvollständig');
    // Bearbeitung ist nicht blockiert: das Formular wird dennoch gerendert.
    expect(el.querySelector('.wine-editor__form')).toBeTruthy();
  });

  it('markiert einen Eintrag mit Namen NICHT als unvollständig', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha' })];
    const { fixture, state } = await render(entries);
    state.select(state.listItems()[0]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.wine-editor__badge')).toBeNull();
  });

  it('zeigt schema-fremde Felder an (Req 17.27)', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha', taste_nose: 'Kirsche' } as Wine)];
    const { fixture, state } = await render(entries);
    state.select(state.listItems()[0]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const extras = el.querySelector('[data-testid="extra-fields"]');
    expect(extras?.textContent).toContain('taste_nose');
    expect(extras?.textContent).toContain('Kirsche');
  });

  it('rendert den ImagePicker für das image-Feld (Req 17.28)', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha' })];
    const { fixture, state } = await render(entries);
    state.select(state.listItems()[0]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-field="image"] app-image-picker')).toBeTruthy();
  });

  it('übernimmt bei Bildauswahl nur den Dateinamen ohne Pfad ins image-Feld und speichert ihn (Req 17.34/17.35)', async () => {
    const entries = [wineEntry('sub/a.json', { name: 'Alpha' })];
    const images: ImageEntry[] = [
      {
        name: 'wein.jpg',
        path: 'sub/wein.jpg',
        dirSegments: ['sub'],
        date: 0,
        dateSource: 'lastModified',
        assigned: false,
      },
    ];
    const { fixture, state, fsa } = await render(entries, images);
    const created = state.listItems().find((i) => i.kind === 'created');
    state.select(created ?? null);
    // Change Detection zweimal, damit der Lade-Effect (save.init) garantiert läuft.
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.pickImage('wein.jpg');
    // Auto-Save mit 500-ms-Debounce pro Feld (gleicher Weg wie die übrigen Felder).
    await new Promise((resolve) => setTimeout(resolve, 600));

    const lastWrite = fsa.writes.at(-1);
    expect(lastWrite?.path).toBe('sub/a.json');
    // Nur der Dateiname ohne Pfad landet im image-Feld.
    expect(lastWrite?.wine.image).toBe('wein.jpg');
  });

  it('befüllt grape als Chips (Req 17.18)', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha', grape: ['Merlot', 'Syrah'] })];
    const { fixture, state } = await render(entries);
    state.select(state.listItems()[0]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const chips = el.querySelectorAll('[data-field="grape"] .wine-editor__chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('Merlot');
  });

  describe('Archivieren statt Löschen (Req 17.44–17.48)', () => {
    it('bietet für einen angelegten Eintrag einen Archivieren-, aber keinen Lösch-Button (Req 17.44)', async () => {
      const entries = [wineEntry('a.json', { name: 'Alpha' })];
      const { fixture, state } = await render(entries);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="archive-entry"]')).toBeTruthy();
      // Keine Lösch-Funktion im Editor: weder ein Lösch-Button noch eine Lösch-Methode.
      expect(el.querySelector('[data-testid="delete-entry"]')).toBeNull();
      const buttons = Array.from(el.querySelectorAll('button')).map((b) =>
        (b.textContent ?? '').toLowerCase(),
      );
      expect(buttons.some((t) => t.includes('löschen'))).toBe(false);
      const comp = fixture.componentInstance as unknown as Record<string, unknown>;
      expect(typeof comp['deleteEntry']).toBe('undefined');
    });

    it('stellt keine Dearchivierungs-/Lösch-Methode auf dem EditorStateService bereit (Req 17.44/17.50)', async () => {
      const { state } = await render([wineEntry('a.json', { name: 'Alpha' })]);
      const svc = state as unknown as Record<string, unknown>;
      expect(typeof svc['deleteEntry']).toBe('undefined');
      expect(typeof svc['unarchive']).toBe('undefined');
      expect(typeof svc['dearchive']).toBe('undefined');
    });

    it('bietet für ein unbekanntes Bild einen Bild-Archivieren-Button (Req 17.46)', async () => {
      const images: ImageEntry[] = [
        { name: 'u.jpg', path: 'u.jpg', dirSegments: [], date: 0, dateSource: 'lastModified', assigned: false },
      ];
      const { fixture, state } = await render([], images);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="archive-image"]')).toBeTruthy();
    });

    it('archiviert den angelegten Eintrag über die File System Access API (Req 17.47)', async () => {
      const entries = [wineEntry('a.json', { name: 'Alpha' })];
      const { fixture, state, fsa } = await render(entries);
      state.select(state.listItems()[0]);
      fixture.detectChanges();

      await fixture.componentInstance.archiveEntry();

      expect(fsa.archived).toContain('a.json');
      // Auswahl wurde nach dem Archivieren zurückgesetzt (Req 17.6).
      expect(state.selectedId()).toBeNull();
    });

    it('archiviert ein unbekanntes Bild über die File System Access API (Req 17.46)', async () => {
      const images: ImageEntry[] = [
        { name: 'u.jpg', path: 'u.jpg', dirSegments: [], date: 0, dateSource: 'lastModified', assigned: false },
      ];
      const { fixture, state, fsa } = await render([], images);
      state.select(state.listItems()[0]);
      fixture.detectChanges();

      await fixture.componentInstance.archiveImage();

      expect(fsa.archived).toContain('u.jpg');
      expect(state.selectedId()).toBeNull();
    });
  });
});
