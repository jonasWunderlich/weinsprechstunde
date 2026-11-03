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

  describe('from-image: Anlegen per Bildklick (Req 17.36)', () => {
    it('legt eine vorläufige JSON an, refresht und wählt den neuen Eintrag aus', async () => {
      const image = imageEntry('u.jpg', 0, false);
      const { state, fsa, fromImage } = setup({ entries: [], images: [image] });
      await state.refresh();

      // Nach dem Anlegen liefert der Scan den vorläufigen Eintrag.
      fsa.scanResult = { entries: [wineEntry('u.json', { name: null as never, image: 'u.jpg' })], images: [] };

      await state.createFromImage(image);

      expect(fromImage.createCalls).toHaveLength(1);
      expect(state.selectedId()).toBe('u.json');
      expect(state.isProvisionalSelected()).toBe(true);
      expect(state.fromImageError()).toBeNull();
    });

    it('setzt eine Fehleranzeige, wenn das Anlegen fehlschlägt (Req 17.43)', async () => {
      const image = imageEntry('u.jpg', 0, false);
      const { state, fromImage } = setup({ entries: [], images: [image] });
      await state.refresh();
      fromImage.createError = new Error('existiert bereits');

      await state.createFromImage(image);

      expect(state.fromImageError()).toContain('existiert bereits');
      expect(state.isProvisionalSelected()).toBe(false);
    });
  });

  describe('from-image: name-Autocomplete bildloser Einträge (Req 17.38)', () => {
    it('schlägt nur bildlose, nicht-defekte Einträge vor (ohne den vorläufigen)', async () => {
      const entries = [
        wineEntry('u.json', { name: null as never, image: 'u.jpg' }), // vorläufig
        wineEntry('a.json', { name: 'Alpha' }), // bildlos → Vorschlag
        wineEntry('b.json', { name: 'Beta', image: 'b.jpg' }), // hat Bild → kein Vorschlag
        wineEntry('broken.json', null, true), // defekt → kein Vorschlag
      ];
      const image = imageEntry('u.jpg', 0, false);
      const { state, fsa } = setup({ entries, images: [image] });
      await state.refresh();
      // vorläufigen Eintrag als from-image markieren
      fsa.scanResult = { entries, images: [image] };
      await state.createFromImage(image);

      expect(state.imagelessSuggestions().map((e) => e.path)).toEqual(['a.json']);
    });
  });

  describe('from-image: Weg 2 — Auswahl eines bestehenden Eintrags (link-image, Req 17.41)', () => {
    it('verknüpft, löscht den vorläufigen Modus und wählt den bestehenden Eintrag', async () => {
      const prov = wineEntry('u.json', { name: null as never, image: 'u.jpg' });
      const target = wineEntry('bestehend.json', { name: 'Bestehend' });
      const image = imageEntry('u.jpg', 0, false);
      const { state, fsa, fromImage } = setup({ entries: [prov, target], images: [image] });
      await state.refresh();
      await state.createFromImage(image);

      // Nach dem Verknüpfen liefert der Scan nur noch den bestehenden Eintrag mit Bild.
      fsa.scanResult = {
        entries: [wineEntry('bestehend.json', { name: 'Bestehend', image: 'u.jpg' })],
        images: [imageEntry('u.jpg', 0, true)],
      };

      await state.linkToExisting('bestehend.json');

      expect(fromImage.linkCalls).toHaveLength(1);
      expect(fromImage.linkCalls[0].target.path).toBe('bestehend.json');
      expect(state.selectedId()).toBe('bestehend.json');
      expect(state.isProvisionalSelected()).toBe(false);
      expect(state.fromImageError()).toBeNull();
    });

    it('setzt eine Fehleranzeige ohne doppelte JSON bei Fehlschlag (Req 17.43)', async () => {
      const prov = wineEntry('u.json', { name: null as never, image: 'u.jpg' });
      const target = wineEntry('bestehend.json', { name: 'Bestehend' });
      const image = imageEntry('u.jpg', 0, false);
      const { state, fromImage } = setup({ entries: [prov, target], images: [image] });
      await state.refresh();
      await state.createFromImage(image);
      fromImage.linkError = new Error('Verknüpfen fehlgeschlagen');

      await state.linkToExisting('bestehend.json');

      expect(state.fromImageError()).toContain('Verknüpfen fehlgeschlagen');
      // Der vorläufige Modus bleibt erhalten (Rollback wiederhergestellt).
      expect(state.provisionalPath()).toBe('u.json');
    });
  });

  it('Weg 1 (eigener neuer Name) behält den vorläufigen Eintrag', async () => {
    const prov = wineEntry('u.json', { name: null as never, image: 'u.jpg' });
    const image = imageEntry('u.jpg', 0, false);
    const { state, fromImage } = setup({ entries: [prov], images: [image] });
    await state.refresh();
    await state.createFromImage(image);

    // Weg 1 läuft NICHT über linkToExisting — der vorläufige Eintrag bleibt ausgewählt.
    expect(fromImage.linkCalls).toHaveLength(0);
    expect(state.provisionalPath()).toBe('u.json');
    expect(state.selectedId()).toBe('u.json');
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
});
