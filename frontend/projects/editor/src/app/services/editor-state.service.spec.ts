import { TestBed } from '@angular/core/testing';
import { FilterService, WineDataSource, Wine } from '@weinsprechstunde/shared';
import { EditorStateService } from './editor-state.service';
import { EditorWineDataService } from './editor-wine-data.service';
import { FileSystemAccessService, ImageEntry, ScanResult, WineEntry } from './file-system-access.service';
import { FromImageService } from './from-image.service';
import { ArchiveService } from './archive.service';
import { DEFAULT_WINE_SCHEMA } from '../models/default-schema';

function wineEntry(path: string, wine: Wine | null, broken = false): WineEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, wine, broken, lastModified: 0 };
}

function imageEntry(path: string, date: number, assigned = false): ImageEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, date, dateSource: 'lastModified', assigned };
}

/** Konfigurierbarer Fake der File System Access API. */
class FakeFsa {
  scanResult: ScanResult = { entries: [], images: [] };
  scanCalls = 0;
  private access = true;

  hasAccess(): boolean {
    return this.access;
  }
  setAccess(v: boolean): void {
    this.access = v;
  }
  async scan(): Promise<ScanResult> {
    this.scanCalls++;
    return this.scanResult;
  }
  /** EXIF-Datum, das select() beim Öffnen eines Entwurfs lädt. */
  exifDate: string | null = null;
  exifCalls: string[] = [];
  async readImageExifDate(path: string): Promise<string | null> {
    this.exifCalls.push(path);
    return this.exifDate;
  }
}

/** Fake des FromImageService, der nur die aufgerufenen Argumente aufzeichnet. */
class FakeFromImage {
  createCalls: ImageEntry[] = [];
  linkCalls: { provisional: WineEntry; target: WineEntry; image: ImageEntry }[] = [];
  createdPath = 'u.json';
  createError: Error | null = null;
  linkError: Error | null = null;
  linkedPath = 'bestehend.json';

  async createFromImage(image: ImageEntry): Promise<{ path: string; wine: object; lastModified: number; image: ImageEntry }> {
    this.createCalls.push(image);
    if (this.createError) throw this.createError;
    return { path: this.createdPath, wine: { image: image.name }, lastModified: 1, image };
  }

  async linkImage(provisional: WineEntry, target: WineEntry, image: ImageEntry): Promise<{ path: string; wine: object; lastModified: number }> {
    this.linkCalls.push({ provisional, target, image });
    if (this.linkError) throw this.linkError;
    return { path: this.linkedPath, wine: { name: 'Bestehend', image: image.name }, lastModified: 2 };
  }

  // Neuer Entwurfs-Flow:
  draftCalls: { image: ImageEntry; fields: Wine }[] = [];
  draftLinkCalls: { image: ImageEntry; target: WineEntry }[] = [];
  async createDraft(image: ImageEntry, fields: Wine): Promise<{ path: string; wine: object; lastModified: number; image: ImageEntry }> {
    this.draftCalls.push({ image, fields });
    if (this.createError) throw this.createError;
    return { path: this.createdPath, wine: fields, lastModified: 1, image };
  }
  async linkDraftImage(image: ImageEntry, target: WineEntry): Promise<{ path: string; wine: object; lastModified: number }> {
    this.draftLinkCalls.push({ image, target });
    if (this.linkError) throw this.linkError;
    return { path: this.linkedPath, wine: { name: 'Bestehend', image: image.name }, lastModified: 2 };
  }
}

/** Fake des ArchiveService, der die Aufrufe aufzeichnet und Fehler simulieren kann. */
class FakeArchive {
  imageCalls: ImageEntry[] = [];
  entryCalls: WineEntry[] = [];
  imageError: Error | null = null;
  entryError: Error | null = null;

  async archiveImage(image: ImageEntry): Promise<{ sourcePaths: string[]; archivedPaths: string[] }> {
    this.imageCalls.push(image);
    if (this.imageError) throw this.imageError;
    return { sourcePaths: [image.path], archivedPaths: [`_archive/${image.name}`] };
  }

  async archiveEntry(entry: WineEntry): Promise<{ sourcePaths: string[]; archivedPaths: string[] }> {
    this.entryCalls.push(entry);
    if (this.entryError) throw this.entryError;
    return { sourcePaths: [entry.path], archivedPaths: [`_archive/${entry.name}`] };
  }
}

function setup(scan?: ScanResult): {
  state: EditorStateService;
  fsa: FakeFsa;
  fs: FilterService;
  fromImage: FakeFromImage;
  archive: FakeArchive;
} {
  const fsa = new FakeFsa();
  const fromImage = new FakeFromImage();
  const archive = new FakeArchive();
  if (scan) fsa.scanResult = scan;
  TestBed.configureTestingModule({
    providers: [
      { provide: FileSystemAccessService, useValue: fsa },
      { provide: FromImageService, useValue: fromImage },
      { provide: ArchiveService, useValue: archive },
      { provide: WineDataSource, useExisting: EditorWineDataService },
      EditorWineDataService,
      FilterService,
      EditorStateService,
    ],
  });
  const state = TestBed.inject(EditorStateService);
  const fs = TestBed.inject(FilterService);
  state.setSchema(DEFAULT_WINE_SCHEMA);
  return { state, fsa, fs, fromImage, archive };
}

describe('EditorStateService', () => {
  it('stellt angelegte Weine als WineDataSource bereit (nur gültige JSONs)', async () => {
    const good = wineEntry('a.json', { name: 'Alpha' });
    const broken = wineEntry('b.json', null, true);
    const { state } = setup({ entries: [good, broken], images: [] });
    await state.refresh();
    expect(state.wines().map((w) => w.name)).toEqual(['Alpha']);
  });

  it('mischt angelegte und unbekannte Weine standardmäßig nach Datum (undatierte ans Ende)', async () => {
    const entries = [
      wineEntry('a.json', { name: 'Alpha', tasting_date: '2021-05-05' }),
      wineEntry('b.json', { name: 'Beta', tasting_date: '2023-05-05' }),
      wineEntry('c.json', { name: 'Gamma' }),
    ];
    const images = [
      imageEntry('u-2022.jpg', Date.parse('2022-06-06T00:00:00Z'), false),
      imageEntry('u-assigned.jpg', Date.parse('2020-01-01T00:00:00Z'), true),
    ];
    const { state } = setup({ entries, images });
    await state.refresh();
    const labels = state
      .listItems()
      .map((i) => (i.kind === 'created' ? i.wine?.name : 'unbekannter Wein'));
    expect(labels).toEqual(['Beta', 'unbekannter Wein', 'Alpha', 'Gamma']);
  });

  it('schaltet "Nur unbekannte" automatisch auf "Nur angelegte" bei attributbasierter Eingabe', () => {
    const { state, fs } = setup();
    state.setEntryType('unknown');
    expect(state.entryType()).toBe('unknown');
    fs.updateFilter({ searchText: 'rot' });
    TestBed.tick();
    expect(state.entryType()).toBe('created');
  });

  it('schaltet NICHT um, wenn der Filter nicht auf "Nur unbekannte" steht', () => {
    const { state, fs } = setup();
    state.setEntryType('all');
    fs.updateFilter({ searchText: 'rot' });
    TestBed.tick();
    expect(state.entryType()).toBe('all');
  });

  it('entryType=unknown zeigt nur ungenutzte Bilder', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha' })];
    const images = [imageEntry('u.jpg', 0, false), imageEntry('a.jpg', 0, true)];
    const { state } = setup({ entries, images });
    await state.refresh();
    state.setEntryType('unknown');
    expect(state.listItems().map((i) => i.id)).toEqual(['u.jpg']);
  });

  it('wählt einen Eintrag aus und zeigt ihn als selectedItem (Req 17.9)', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha' })];
    const { state } = setup({ entries, images: [] });
    await state.refresh();
    const item = state.listItems()[0];
    state.select(item);
    expect(state.selectedId()).toBe('a.json');
    expect(state.selectedItem()?.id).toBe('a.json');
  });

  it('lässt defekte JSON-Einträge nicht auswählen (Req 17.26)', async () => {
    const entries = [wineEntry('b.json', null, true)];
    const { state } = setup({ entries, images: [] });
    await state.refresh();
    const item = state.listItems()[0];
    state.select(item);
    expect(state.selectedId()).toBeNull();
  });

  it('refresh scannt erneut und hält die Auswahl, solange der Eintrag existiert', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha' })];
    const { state, fsa } = setup({ entries, images: [] });
    await state.refresh();
    state.select(state.listItems()[0]);
    await state.refresh();
    expect(fsa.scanCalls).toBe(2);
    expect(state.selectedId()).toBe('a.json');
  });

  it('refresh setzt die Auswahl zurück, wenn der Eintrag verschwindet', async () => {
    const entries = [wineEntry('a.json', { name: 'Alpha' })];
    const { state, fsa } = setup({ entries, images: [] });
    await state.refresh();
    state.select(state.listItems()[0]);
    fsa.scanResult = { entries: [], images: [] };
    await state.refresh();
    expect(state.selectedId()).toBeNull();
  });

  it('refresh ohne Zugriff führt keinen Scan aus', async () => {
    const { state, fsa } = setup();
    fsa.setAccess(false);
    await state.refresh();
    expect(fsa.scanCalls).toBe(0);
  });

  describe('Entwurf: name-Autocomplete bildloser Einträge (Req 17.38)', () => {
    it('schlägt nur bildlose, nicht-defekte Einträge vor', async () => {
      const entries = [
        wineEntry('a.json', { name: 'Alpha' }), // bildlos → Vorschlag
        wineEntry('b.json', { name: 'Beta', image: 'b.jpg' }), // hat Bild → kein Vorschlag
        wineEntry('broken.json', null, true), // defekt → kein Vorschlag
      ];
      const image = imageEntry('u.jpg', 0, false);
      const { state } = setup({ entries, images: [image] });
      await state.refresh();
      state.select(state.listItems().find((i) => i.kind === 'unknown') ?? null);

      expect(state.imagelessSuggestions().map((e) => e.path)).toEqual(['a.json']);
    });
  });

  describe('Entwurf: Auswahl eines unbekannten Weins legt KEINE JSON an (neuer Flow)', () => {
    it('öffnet den Entwurf, lädt das EXIF-Datum und schreibt nichts', async () => {
      const image = imageEntry('u.jpg', 0, false);
      const { state, fsa, fromImage } = setup({ entries: [], images: [image] });
      fsa.exifDate = '2022-03-03';
      await state.refresh();

      state.select(state.listItems()[0]);
      // Mikrotask-Runde, damit das asynchrone EXIF-Laden ankommt.
      await Promise.resolve();
      await Promise.resolve();

      expect(state.isDraftSelected()).toBe(true);
      expect(state.draftImage()?.path).toBe('u.jpg');
      expect(state.draftTastingDate()).toBe('2022-03-03');
      // Es wurde nichts angelegt/verknüpft.
      expect(fromImage.draftCalls).toHaveLength(0);
      expect(fromImage.draftLinkCalls).toHaveLength(0);
    });
  });

  describe('Entwurf aus Filter „Nur unbekannte" anlegen — Wein bleibt geöffnet', () => {
    it('hält den neu angelegten Wein im Formular (selectedItem ist der neue Eintrag)', async () => {
      const image = imageEntry('u.jpg', 0, false);
      const { state, fsa, fromImage } = setup({ entries: [], images: [image] });
      fromImage.createdPath = 'u.json';
      await state.refresh();
      state.setEntryType('unknown');
      state.select(state.listItems()[0]);
      expect(state.isDraftSelected()).toBe(true);

      // Nach dem Anlegen liefert der Scan den neuen angelegten Eintrag; das Bild ist jetzt
      // zugeordnet (kein unbekannter Wein mehr).
      fsa.scanResult = {
        entries: [wineEntry('u.json', { name: 'Neu', image: 'u.jpg' })],
        images: [imageEntry('u.jpg', 0, true)],
      };

      await state.commitDraft(image, { name: 'Neu', image: 'u.jpg' });

      // Der Wein bleibt geöffnet: selectedItem ist der neue angelegte Eintrag.
      expect(state.selectedId()).toBe('u.json');
      const sel = state.selectedItem();
      expect(sel?.kind).toBe('created');
      expect(sel && sel.kind === 'created' ? sel.wine?.name : null).toBe('Neu');
      expect(state.isDraftSelected()).toBe(false);
    });
  });

  describe('Entwurf → JSON anlegen bzw. verknüpfen (Req 17.40/17.41)', () => {
    it('commitDraft legt die JSON an, refresht und wählt den neuen Eintrag', async () => {
      const image = imageEntry('u.jpg', 0, false);
      const { state, fsa, fromImage } = setup({ entries: [], images: [image] });
      await state.refresh();
      state.select(state.listItems()[0]);

      fsa.scanResult = {
        entries: [wineEntry('u.json', { name: 'Neuer Wein', image: 'u.jpg' })],
        images: [imageEntry('u.jpg', 0, true)],
      };

      await state.commitDraft(image, { name: 'Neuer Wein', image: 'u.jpg' });

      expect(fromImage.draftCalls).toHaveLength(1);
      expect(fromImage.draftCalls[0].fields.name).toBe('Neuer Wein');
      expect(state.selectedId()).toBe('u.json');
      expect(state.fromImageError()).toBeNull();
    });

    it('linkDraftToExisting verknüpft mit einem bestehenden Eintrag und wählt ihn', async () => {
      const target = wineEntry('bestehend.json', { name: 'Bestehend' });
      const image = imageEntry('u.jpg', 0, false);
      const { state, fsa, fromImage } = setup({ entries: [target], images: [image] });
      await state.refresh();
      state.select(state.listItems().find((i) => i.kind === 'unknown') ?? null);

      fsa.scanResult = {
        entries: [wineEntry('bestehend.json', { name: 'Bestehend', image: 'u.jpg' })],
        images: [imageEntry('u.jpg', 0, true)],
      };

      await state.linkDraftToExisting(image, 'bestehend.json');

      expect(fromImage.draftLinkCalls).toHaveLength(1);
      expect(fromImage.draftLinkCalls[0].target.path).toBe('bestehend.json');
      expect(state.selectedId()).toBe('bestehend.json');
      expect(state.fromImageError()).toBeNull();
    });

    it('setzt eine Fehleranzeige bei fehlgeschlagenem Verknüpfen (Req 17.43)', async () => {
      const target = wineEntry('bestehend.json', { name: 'Bestehend' });
      const image = imageEntry('u.jpg', 0, false);
      const { state, fromImage } = setup({ entries: [target], images: [image] });
      await state.refresh();
      state.select(state.listItems().find((i) => i.kind === 'unknown') ?? null);
      fromImage.linkError = new Error('Verknüpfen fehlgeschlagen');

      await state.linkDraftToExisting(image, 'bestehend.json');

      expect(state.fromImageError()).toContain('Verknüpfen fehlgeschlagen');
    });

    it('setzt eine Fehleranzeige bei fehlgeschlagenem Anlegen', async () => {
      const image = imageEntry('u.jpg', 0, false);
      const { state, fromImage } = setup({ entries: [], images: [image] });
      await state.refresh();
      state.select(state.listItems()[0]);
      fromImage.createError = new Error('Anlegen fehlgeschlagen');

      await state.commitDraft(image, { name: 'X', image: 'u.jpg' });

      expect(state.fromImageError()).toContain('Anlegen fehlgeschlagen');
    });
  });

  describe('Pfeiltasten-Navigation in der Liste (selectRelative)', () => {
    const list = () => [
      wineEntry('a.json', { name: 'Alpha', tasting_date: '2023-01-01' }),
      wineEntry('b.json', { name: 'Beta', tasting_date: '2022-01-01' }),
      wineEntry('c.json', { name: 'Gamma', tasting_date: '2021-01-01' }),
    ];

    it('wählt den nächsten und vorherigen Eintrag', async () => {
      const { state } = setup({ entries: list(), images: [] });
      await state.refresh();
      state.select(state.listItems()[0]);
      expect(state.selectedId()).toBe('a.json');

      state.selectRelative(1);
      expect(state.selectedId()).toBe('b.json');
      state.selectRelative(1);
      expect(state.selectedId()).toBe('c.json');
      state.selectRelative(-1);
      expect(state.selectedId()).toBe('b.json');
    });

    it('bleibt am Rand stehen (kein Wrap)', async () => {
      const { state } = setup({ entries: list(), images: [] });
      await state.refresh();
      state.select(state.listItems()[0]);
      state.selectRelative(-1); // schon erster → bleibt
      expect(state.selectedId()).toBe('a.json');

      state.select(state.listItems()[2]);
      state.selectRelative(1); // schon letzter → bleibt
      expect(state.selectedId()).toBe('c.json');
    });

    it('ohne Auswahl wählt Abwärts den ersten, Aufwärts den letzten Eintrag', async () => {
      const { state } = setup({ entries: list(), images: [] });
      await state.refresh();
      expect(state.selectedId()).toBeNull();
      state.selectRelative(1);
      expect(state.selectedId()).toBe('a.json');

      state.select(null);
      state.selectRelative(-1);
      expect(state.selectedId()).toBe('c.json');
    });

    it('überspringt defekte (nicht auswählbare) Einträge', async () => {
      const entries = [
        wineEntry('a.json', { name: 'Alpha', tasting_date: '2023-01-01' }),
        wineEntry('b.json', null, true), // defekt → übersprungen
        wineEntry('c.json', { name: 'Gamma', tasting_date: '2021-01-01' }),
      ];
      const { state } = setup({ entries, images: [] });
      await state.refresh();
      state.select(state.listItems()[0]);
      state.selectRelative(1);
      expect(state.selectedId()).toBe('c.json');
    });
  });

  describe('Archivieren (Req 17.44–17.48)', () => {
    it('archiviert ein ungenutztes Bild, setzt die Auswahl zurück und refresht (Req 17.46/17.6)', async () => {
      const image = imageEntry('u.jpg', 0, false);
      const { state, fsa, archive } = setup({ entries: [], images: [image] });
      await state.refresh();
      state.select(state.listItems()[0]);
      expect(state.selectedId()).toBe('u.jpg');

      // Nach dem Archivieren liefert der Scan das Bild nicht mehr (nach _archive verschoben).
      fsa.scanResult = { entries: [], images: [] };
      const scansBefore = fsa.scanCalls;

      await state.archiveImage(image);

      expect(archive.imageCalls).toHaveLength(1);
      expect(archive.imageCalls[0].path).toBe('u.jpg');
      expect(state.selectedId()).toBeNull(); // Auswahl zurückgesetzt
      expect(fsa.scanCalls).toBe(scansBefore + 1); // Liste refresht
      expect(state.archiveError()).toBeNull();
    });

    it('archiviert einen angelegten Eintrag, setzt die Auswahl zurück und refresht (Req 17.47/17.6)', async () => {
      const entry = wineEntry('a.json', { name: 'Alpha', image: 'a.jpg' });
      const { state, fsa, archive } = setup({ entries: [entry], images: [] });
      await state.refresh();
      state.select(state.listItems()[0]);
      expect(state.selectedId()).toBe('a.json');

      fsa.scanResult = { entries: [], images: [] };
      const scansBefore = fsa.scanCalls;

      await state.archiveEntry(entry);

      expect(archive.entryCalls).toHaveLength(1);
      expect(archive.entryCalls[0].path).toBe('a.json');
      expect(state.selectedId()).toBeNull();
      expect(fsa.scanCalls).toBe(scansBefore + 1);
      expect(state.archiveError()).toBeNull();
    });

    it('setzt bei Fehler eine erkennbare Fehleranzeige und lässt Auswahl/Liste unverändert (Req 17.48)', async () => {
      const entry = wineEntry('a.json', { name: 'Alpha' });
      const { state, fsa, archive } = setup({ entries: [entry], images: [] });
      await state.refresh();
      state.select(state.listItems()[0]);
      archive.entryError = new Error('Archivieren fehlgeschlagen: remove failed');
      const scansBefore = fsa.scanCalls;

      await state.archiveEntry(entry);

      expect(state.archiveError()).toContain('Archivieren fehlgeschlagen');
      // Kein Refresh, Auswahl bleibt erhalten — nichts wurde verändert.
      expect(fsa.scanCalls).toBe(scansBefore);
      expect(state.selectedId()).toBe('a.json');
    });
  });

  describe('applyEntryState (Cache nach Speichern, Req 17.6)', () => {
    it('ersetzt Eintrag und Wine-Daten mit demselben Objekt, ohne Scan und ohne Auswahlwechsel', async () => {
      const { state, fsa } = setup({
        entries: [wineEntry('a.json', { name: 'Alpha' }), wineEntry('b.json', { name: 'Beta' })],
        images: [],
      });
      await state.refresh();
      state.select(state.listItems().find((i) => i.id === 'a.json') ?? null);
      const scans = fsa.scanCalls;
      const saved: Wine = { name: 'Alpha neu', price: 3 };

      state.applyEntryState('a.json', saved, 42);

      const entry = state.entries().find((e) => e.path === 'a.json')!;
      expect(entry.wine).toBe(saved);
      expect(entry.lastModified).toBe(42);
      expect(state.wines().includes(saved)).toBe(true);
      expect(state.wines()).toHaveLength(2);
      expect(state.selectedId()).toBe('a.json');
      expect(state.listItems().map((i) => (i.kind === 'created' ? i.wine?.name : null))).toContain(
        'Alpha neu',
      );
      expect(fsa.scanCalls).toBe(scans);
    });

    it('ignoriert einen unbekannten Pfad', async () => {
      const { state } = setup({ entries: [wineEntry('a.json', { name: 'Alpha' })], images: [] });
      await state.refresh();
      const before = state.entries();
      state.applyEntryState('x.json', { name: 'X' }, 1);
      expect(state.entries()).toBe(before);
    });
  });
});
