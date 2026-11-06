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
  /** Frisches Lesen beim Öffnen: liefert den Stand des letzten Scans. */
  async readJson(path: string): Promise<{ wine: Wine; lastModified: number }> {
    const entry = this.scanResult.entries.find((e) => e.path === path);
    if (!entry?.wine) throw new DOMException('not found', 'NotFoundError');
    return { wine: entry.wine, lastModified: entry.lastModified };
  }
  async listMedia(): Promise<[]> {
    return [];
  }
  /** Protokoll der Thumbnail-Anforderungen (Pfad + maxSize). */
  readonly thumbnailRequests: { path: string; maxSize: number }[] = [];
  async createThumbnail(path: string, maxSize = 256): Promise<{ blob: Blob; width: number; height: number }> {
    this.thumbnailRequests.push({ path, maxSize });
    return { blob: new Blob([]), width: 1, height: 1 };
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
  async readImageExifDate(_path: string): Promise<string | null> {
    return null;
  }
  async createJson(path: string, wine: Wine): Promise<number> {
    this.writes.push({ path, wine });
    return 1;
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

  describe('Bildauswahl per Dialog (Req 17.28–17.35)', () => {
    it('zeigt im image-Feld einen Button statt einer dauerhaft sichtbaren Galerie', async () => {
      const entries = [wineEntry('a.json', { name: 'Alpha' })];
      const { fixture, state } = await render(entries);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      // Kein dauerhaft sichtbarer Picker, sondern ein Öffnen-Button.
      expect(el.querySelector('[data-field="image"] app-image-picker')).toBeNull();
      expect(el.querySelector('[data-testid="image-open-picker"]')).toBeTruthy();
    });

    it('beschriftet den Button „Bild ergänzen", wenn noch kein Bild gesetzt ist', async () => {
      const { fixture, state } = await render([wineEntry('a.json', { name: 'Alpha' })]);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="image-open-picker"]',
      );
      expect(btn?.textContent?.trim()).toBe('Bild ergänzen');
    });

    it('beschriftet den Button „Bild ersetzen", wenn ein Bild gesetzt ist', async () => {
      const { fixture, state } = await render([
        wineEntry('a.json', { name: 'Alpha', image: 'wein.jpg' }),
      ]);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="image-open-picker"]',
      );
      expect(btn?.textContent?.trim()).toBe('Bild ersetzen');
    });

    it('öffnet erst auf Klick den Dialog mit dem Weinnamen im Titel und der Galerie', async () => {
      const entries = [wineEntry('a.json', { name: 'Château Alpha' })];
      const { fixture, state } = await render(entries);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      // Frisches Lesen abwarten: bis dahin ist das Formular read-only.
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      // Vor dem Klick: kein Dialog.
      expect(el.querySelector('[data-testid="image-dialog-title"]')).toBeNull();
      expect(el.querySelector('app-image-picker')).toBeNull();

      (el.querySelector('[data-testid="image-open-picker"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      const title = el.querySelector('[data-testid="image-dialog-title"]');
      expect(title?.textContent).toContain('Château Alpha');
      expect(el.querySelector('[data-testid="image-dialog-body"] app-image-picker, .wine-editor__dialog app-image-picker')).toBeTruthy();
    });

    it('übernimmt die Auswahl aus dem Dialog und schließt ihn', async () => {
      const entries = [wineEntry('sub/a.json', { name: 'Alpha' })];
      const images: ImageEntry[] = [
        { name: 'wein.jpg', path: 'sub/wein.jpg', dirSegments: ['sub'], date: 0, dateSource: 'lastModified', assigned: false },
      ];
      const { fixture, state, fsa } = await render(entries, images);
      state.select(state.listItems().find((i) => i.kind === 'created') ?? null);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      fixture.componentInstance.openImagePicker();
      fixture.detectChanges();
      expect(fixture.componentInstance.imagePickerOpen()).toBe(true);

      fixture.componentInstance.onPickImageFromDialog('wein.jpg');
      fixture.detectChanges();
      // Dialog geschlossen ...
      expect(fixture.componentInstance.imagePickerOpen()).toBe(false);
      // ... und die Auswahl wurde (über den Auto-Save-Weg) gespeichert.
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(fsa.writes.at(-1)?.wine.image).toBe('wein.jpg');
    });

    it('schließt den Dialog über den Schließen-Button ohne Änderung', async () => {
      const { fixture, state } = await render([wineEntry('a.json', { name: 'Alpha' })]);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      fixture.componentInstance.openImagePicker();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      (el.querySelector('[data-testid="image-dialog-close"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.imagePickerOpen()).toBe(false);
    });
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

  describe('Entwurf: unbekannter Wein (neuer Flow)', () => {
    const unknownImage = (): ImageEntry[] => [
      {
        name: 'u.jpg',
        path: 'sub/u.jpg',
        dirSegments: ['sub'],
        date: 0,
        dateSource: 'lastModified',
        assigned: false,
      },
    ];

    it('zeigt beim Auswählen eines unbekannten Weins das vollständige Formular (keine JSON nötig)', async () => {
      const { fixture, state } = await render([], unknownImage());
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      // Vollständiges Formular ist sichtbar (dynamische Felder), inkl. name-Feld.
      expect(el.querySelector('.wine-editor__form')).toBeTruthy();
      expect(el.querySelector('[data-field="name"]')).toBeTruthy();
      expect(el.querySelector('[data-field="rating"]')).toBeTruthy();
      // Entwurfs-Hinweis statt Speicherstatus.
      expect(el.querySelector('[data-testid="draft-hint"]')).toBeTruthy();
      // Das image-Feld ist mit dem Bild-Dateinamen vorbefüllt.
      expect(fixture.componentInstance.value('image')).toBe('u.jpg');
    });

    it('schreibt nichts, solange kein Name eingetragen ist', async () => {
      const { fixture, state, fsa } = await render([], unknownImage());
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Ein anderes Feld ändern, ohne Namen zu setzen.
      const ratingField = fixture.componentInstance
        .fields()
        .find((f) => f.schema.field === 'rating')!;
      fixture.componentInstance.onInput(ratingField, '8');
      await new Promise((r) => setTimeout(r, 600));

      // Es wurde nichts geschrieben (kein writeJson/createJson), da name leer ist.
      expect(fsa.writes).toHaveLength(0);
    });

    it('legt beim Tippen des Namens noch NICHTS an (kein Auto-Commit/Routing)', async () => {
      const { fixture, state, fsa } = await render([], unknownImage());
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const nameField = fixture.componentInstance.fields().find((f) => f.schema.field === 'name')!;
      fixture.componentInstance.onProvisionalNameInput(nameField, 'Mein Wein');
      await new Promise((r) => setTimeout(r, 600));

      // Tippen schreibt nichts; der Entwurf bleibt ausgewählt.
      expect(fsa.writes).toHaveLength(0);
      expect(state.isDraftSelected()).toBe(true);
      // Der Anlegen-Button ist jetzt aktivierbar (Name vorhanden).
      expect(fixture.componentInstance.canCreateDraft()).toBe(true);
    });

    it('sperrt im Entwurf alle Felder außer name (readonly bis angelegt)', async () => {
      const { fixture, state } = await render([], unknownImage());
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const comp = fixture.componentInstance;
      expect(comp.isFieldLocked('name')).toBe(false);
      expect(comp.isFieldLocked('rating')).toBe(true);
      expect(comp.isFieldLocked('image')).toBe(true);

      const el = fixture.nativeElement as HTMLElement;
      const rating = el.querySelector('[data-field="rating"] input') as HTMLInputElement | null;
      expect(rating?.disabled).toBe(true);
    });

    it('legt die JSON erst über den „Wein anlegen"-Button an und lässt den Wein geöffnet', async () => {
      const { fixture, state, fsa } = await render([], unknownImage());
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const nameField = fixture.componentInstance.fields().find((f) => f.schema.field === 'name')!;
      fixture.componentInstance.onProvisionalNameInput(nameField, 'Mein Wein');
      fixture.detectChanges();

      // Nach dem Anlegen liefert der nächste Scan den neuen angelegten Eintrag.
      fsa.scanResult = {
        entries: [wineEntry('sub/u.json', { name: 'Mein Wein', image: 'u.jpg' })],
        images: [
          {
            name: 'u.jpg',
            path: 'sub/u.jpg',
            dirSegments: ['sub'],
            date: 0,
            dateSource: 'lastModified',
            assigned: true,
          },
        ],
      };

      await fixture.componentInstance.commitDraftManually();
      await fixture.whenStable();
      fixture.detectChanges();

      // JSON angelegt ...
      expect(fsa.writes).toHaveLength(1);
      expect(fsa.writes[0].path).toBe('sub/u.json');
      expect(fsa.writes[0].wine.name).toBe('Mein Wein');
      expect(fsa.writes[0].wine.image).toBe('u.jpg');

      // ... und der neu angelegte Wein bleibt im Formular geöffnet (kein Wegspringen).
      expect(state.selectedId()).toBe('sub/u.json');
      expect(state.isDraftSelected()).toBe(false);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.wine-editor__form')).toBeTruthy();
      // name-Feld ist jetzt frei editierbar (nicht mehr gesperrt).
      expect(fixture.componentInstance.isFieldLocked('rating')).toBe(false);
    });

    it('aus Filter „Nur unbekannte": nach dem Anlegen bleibt das Formular mit dem Wein offen', async () => {
      const { fixture, state, fsa } = await render([], unknownImage());
      state.setEntryType('unknown');
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const nameField = fixture.componentInstance.fields().find((f) => f.schema.field === 'name')!;
      fixture.componentInstance.onProvisionalNameInput(nameField, 'Neu');
      fixture.detectChanges();

      fsa.scanResult = {
        entries: [wineEntry('sub/u.json', { name: 'Neu', image: 'u.jpg' })],
        images: [
          {
            name: 'u.jpg',
            path: 'sub/u.jpg',
            dirSegments: ['sub'],
            date: 0,
            dateSource: 'lastModified',
            assigned: true,
          },
        ],
      };

      await fixture.componentInstance.commitDraftManually();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      // Formular bleibt offen; KEIN Platzhaltertext.
      expect(el.textContent).not.toContain('Wähle links einen Eintrag aus');
      expect(el.querySelector('.wine-editor__form')).toBeTruthy();
      expect(state.selectedId()).toBe('sub/u.json');
      // Der Listenfilter bleibt unverändert (ändert sich nicht unter dem Benutzer); der
      // geöffnete Wein wird trotzdem im Editor gezeigt, auch wenn „Nur unbekannte" ihn
      // in der Liste ausblendet.
      expect(state.entryType()).toBe('unknown');
      expect(state.selectedItem()?.kind).toBe('created');
    });

    it('der Anlegen-Button ist ohne Namen deaktiviert', async () => {
      const { fixture, state } = await render([], unknownImage());
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.canCreateDraft()).toBe(false);
      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('[data-testid="draft-create"]') as HTMLButtonElement | null;
      expect(btn?.disabled).toBe(true);
    });
  });

  describe('Große Bildvorschau im Editor', () => {
    it('zeigt für einen angelegten Eintrag das referenzierte Bild groß an (Pfad im JSON-Verzeichnis)', async () => {
      const entries = [wineEntry('sub/a.json', { name: 'Alpha', image: 'wein.jpg' })];
      const { fixture, state } = await render(entries);
      state.select(state.listItems().find((i) => i.kind === 'created') ?? null);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const preview = el.querySelector('app-entry-thumbnail.wine-editor__preview');
      expect(preview).toBeTruthy();
      // previewPath löst den Dateinamen im Verzeichnis der JSON-Quelldatei auf.
      expect(fixture.componentInstance.previewPath()).toBe('sub/wein.jpg');
    });

    it('zeigt keine Vorschau, wenn der angelegte Eintrag kein Bild hat', async () => {
      const entries = [wineEntry('a.json', { name: 'Alpha' })];
      const { fixture, state } = await render(entries);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('app-entry-thumbnail.wine-editor__preview')).toBeNull();
      expect(fixture.componentInstance.previewPath()).toBeNull();
    });

    it('zeigt für einen unbekannten Wein das Bild selbst groß an (Req 17.13)', async () => {
      const images: ImageEntry[] = [
        { name: 'u.jpg', path: 'sub/u.jpg', dirSegments: ['sub'], date: 0, dateSource: 'lastModified', assigned: false },
      ];
      const { fixture, state } = await render([], images);
      state.select(state.listItems()[0]);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('app-entry-thumbnail.wine-editor__preview')).toBeTruthy();
      expect(fixture.componentInstance.previewPath()).toBe('sub/u.jpg');
    });

    it('aktualisiert die Vorschau sofort nach einer Bildauswahl (live aus dem Formular)', async () => {
      const entries = [wineEntry('sub/a.json', { name: 'Alpha' })];
      const images: ImageEntry[] = [
        { name: 'neu.jpg', path: 'sub/neu.jpg', dirSegments: ['sub'], date: 0, dateSource: 'lastModified', assigned: false },
      ];
      const { fixture, state } = await render(entries, images);
      state.select(state.listItems().find((i) => i.kind === 'created') ?? null);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.previewPath()).toBeNull();

      fixture.componentInstance.pickImage('neu.jpg');
      fixture.detectChanges();
      expect(fixture.componentInstance.previewPath()).toBe('sub/neu.jpg');
    });
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
