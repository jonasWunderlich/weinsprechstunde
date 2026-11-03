import { TestBed } from '@angular/core/testing';
import {
  ConflictError,
  DirectoryHandleStore,
  FileSystemAccessService,
  SHOW_DIRECTORY_PICKER,
  ThumbnailRenderer,
  Thumbnail,
  UnsupportedBrowserError,
  isImageName,
} from './file-system-access.service';
import { FsaDirectoryHandle, ShowDirectoryPickerFn } from './fsa-types';
import { FakeDirectoryHandle } from './testing/fake-fsa';

// ── Fakes für die injizierbaren Adapter ──────────────────────────────────────────

class InMemoryStore extends DirectoryHandleStore {
  saved: FsaDirectoryHandle | null = null;
  override async save(handle: FsaDirectoryHandle): Promise<void> {
    this.saved = handle;
  }
  override async load(): Promise<FsaDirectoryHandle | null> {
    return this.saved;
  }
  override async clear(): Promise<void> {
    this.saved = null;
  }
}

/** Erzeugt deterministisch ein verkleinertes Thumbnail ohne echtes Canvas. */
class FakeThumbnailRenderer extends ThumbnailRenderer {
  override async render(blob: Blob, maxSize: number): Promise<Thumbnail> {
    // Simuliere ein 400x200-Original; skaliere seitenverhältniserhaltend.
    const w = 400;
    const h = 200;
    const longest = Math.max(w, h);
    const ratio = longest > maxSize ? maxSize / longest : 1;
    return {
      blob: new Blob([await blob.text()], { type: 'image/png' }),
      width: Math.round(w * ratio),
      height: Math.round(h * ratio),
    };
  }
}

function configure(
  options: {
    picker?: ShowDirectoryPickerFn | null;
    store?: DirectoryHandleStore;
    renderer?: ThumbnailRenderer;
  } = {},
): FileSystemAccessService {
  TestBed.configureTestingModule({
    providers: [
      FileSystemAccessService,
      { provide: SHOW_DIRECTORY_PICKER, useValue: options.picker ?? null },
      { provide: DirectoryHandleStore, useValue: options.store ?? new InMemoryStore() },
      { provide: ThumbnailRenderer, useValue: options.renderer ?? new FakeThumbnailRenderer() },
    ],
  });
  return TestBed.inject(FileSystemAccessService);
}

describe('isImageName', () => {
  it('erkennt unterstützte Endungen case-insensitive', () => {
    expect(isImageName('a.jpg')).toBe(true);
    expect(isImageName('a.JPEG')).toBe(true);
    expect(isImageName('a.Png')).toBe(true);
    expect(isImageName('a.WEBP')).toBe(true);
  });

  it('lehnt andere Endungen ab', () => {
    expect(isImageName('a.gif')).toBe(false);
    expect(isImageName('a.json')).toBe(false);
    expect(isImageName('a.mp3')).toBe(false);
  });
});

describe('FileSystemAccessService – Browser-Support (Req 17.4)', () => {
  it('apiSupported=false, wenn showDirectoryPicker fehlt', () => {
    const svc = configure({ picker: null });
    expect(svc.apiSupported).toBe(false);
  });

  it('apiSupported=true, wenn showDirectoryPicker vorhanden ist', () => {
    const picker: ShowDirectoryPickerFn = async () => new FakeDirectoryHandle('root');
    const svc = configure({ picker });
    expect(svc.apiSupported).toBe(true);
  });

  it('requestDirectory wirft UnsupportedBrowserError ohne API', async () => {
    const svc = configure({ picker: null });
    await expect(svc.requestDirectory()).rejects.toBeInstanceOf(UnsupportedBrowserError);
  });
});

describe('FileSystemAccessService – Freigabe & Wiederherstellung (Req 17.2/17.3)', () => {
  it('requestDirectory persistiert das Handle und setzt Zustand', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    const store = new InMemoryStore();
    const svc = configure({ picker: async () => root, store });

    const handle = await svc.requestDirectory();

    expect(handle).toBe(root);
    expect(store.saved).toBe(root);
    expect(svc.hasAccess()).toBe(true);
    expect(svc.directoryName()).toBe('import_dir');
  });

  const anyPicker: ShowDirectoryPickerFn = async () => new FakeDirectoryHandle('x');

  it('restoreDirectory stellt mit granted-Permission wieder her (keine erneute Suche)', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.permission = 'granted';
    const store = new InMemoryStore();
    store.saved = root;
    const svc = configure({ picker: anyPicker, store });

    const handle = await svc.restoreDirectory();
    expect(handle).toBe(root);
    expect(svc.hasAccess()).toBe(true);
  });

  it('restoreDirectory re-autorisiert per requestPermission bei prompt', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.permission = 'prompt';
    root.requestedPermission = 'granted';
    const store = new InMemoryStore();
    store.saved = root;
    const svc = configure({ picker: anyPicker, store });

    const handle = await svc.restoreDirectory();
    expect(handle).toBe(root);
  });

  it('restoreDirectory liefert null bei verweigerter Re-Autorisierung', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.permission = 'prompt';
    root.requestedPermission = 'denied';
    const store = new InMemoryStore();
    store.saved = root;
    const svc = configure({ picker: anyPicker, store });

    expect(await svc.restoreDirectory()).toBeNull();
    expect(svc.hasAccess()).toBe(false);
  });

  it('restoreDirectory liefert null ohne persistiertes Handle', async () => {
    const svc = configure({ picker: anyPicker, store: new InMemoryStore() });
    expect(await svc.restoreDirectory()).toBeNull();
  });
});

function wineJson(obj: unknown): string {
  return JSON.stringify(obj);
}

async function withDirectory(
  build: (root: FakeDirectoryHandle) => void,
): Promise<FileSystemAccessService> {
  const root = new FakeDirectoryHandle('import_dir');
  build(root);
  const svc = configure({ picker: async () => root });
  await svc.requestDirectory();
  return svc;
}

describe('FileSystemAccessService – Verzeichnis-Scan (Req 17.1/17.49)', () => {
  it('erfasst JSON-Einträge und Bilder rekursiv', async () => {
    const svc = await withDirectory((root) => {
      root.addFile('a.json', wineJson({ name: 'A', image: 'a.jpg' }), 100);
      root.addFile('a.jpg', 'imgdata', 111);
      const sub = root.addDir('sub');
      sub.addFile('b.json', wineJson({ name: 'B' }), 200);
      sub.addFile('b.png', 'imgdata2', 222);
    });

    const { entries, images } = await svc.scan();

    expect(entries.map((e) => e.path).sort()).toEqual(['a.json', 'sub/b.json']);
    const b = entries.find((e) => e.name === 'b.json')!;
    expect(b.dirSegments).toEqual(['sub']);
    expect(b.wine?.name).toBe('B');
    expect(images.map((i) => i.path).sort()).toEqual(['a.jpg', 'sub/b.png']);
  });

  it('ignoriert den _archive-Ordner vollständig', async () => {
    const svc = await withDirectory((root) => {
      root.addFile('a.json', wineJson({ name: 'A' }), 100);
      root.addFile('a.jpg', 'x', 100);
      const archive = root.addDir('_archive');
      archive.addFile('old.json', wineJson({ name: 'Old' }), 50);
      archive.addFile('old.jpg', 'x', 50);
    });

    const { entries, images } = await svc.scan();

    expect(entries.map((e) => e.name)).toEqual(['a.json']);
    expect(images.map((i) => i.name)).toEqual(['a.jpg']);
  });

  it('markiert defektes JSON als broken, ohne zu werfen (Req 17.26)', async () => {
    const svc = await withDirectory((root) => {
      root.addFile('ok.json', wineJson({ name: 'OK' }), 100);
      root.addFile('bad.json', '{ this is not json', 100);
    });

    const { entries } = await svc.scan();
    const bad = entries.find((e) => e.name === 'bad.json')!;
    const ok = entries.find((e) => e.name === 'ok.json')!;

    expect(bad.broken).toBe(true);
    expect(bad.wine).toBeNull();
    expect(ok.broken).toBe(false);
    expect(ok.wine?.name).toBe('OK');
  });
});

describe('FileSystemAccessService – Bild-Listing (Req 17.28/17.29/17.32)', () => {
  it('liefert assigned=true für referenzierte Bilder, false sonst', async () => {
    const svc = await withDirectory((root) => {
      root.addFile('wine.json', wineJson({ name: 'A', image: 'used.jpg' }), 100);
      root.addFile('used.jpg', 'x', 100);
      root.addFile('free.png', 'x', 100);
    });

    const { images } = await svc.scan();
    const used = images.find((i) => i.name === 'used.jpg')!;
    const free = images.find((i) => i.name === 'free.png')!;

    expect(used.assigned).toBe(true);
    expect(free.assigned).toBe(false);
  });

  it('nutzt File.lastModified als Datum, wenn kein EXIF vorhanden ist', async () => {
    const svc = await withDirectory((root) => {
      root.addFile('photo.png', 'no-exif-here', 1710000000000);
    });

    const { images } = await svc.scan();
    const photo = images[0];
    expect(photo.date).toBe(1710000000000);
    expect(photo.dateSource).toBe('lastModified');
  });
});

describe('FileSystemAccessService – Datei-Operationen', () => {
  it('readJson parst und merkt lastModified', async () => {
    const svc = await withDirectory((root) => {
      root.addFile('a.json', wineJson({ name: 'A', year: 2020 }), 777);
    });

    const { wine, lastModified } = await svc.readJson('a.json');
    expect(wine.name).toBe('A');
    expect(wine.year).toBe(2020);
    expect(lastModified).toBe(777);
  });

  it('writeJson schreibt 2-Space-Indent und erhält schema-fremde Felder', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    const handle = root.addFile('a.json', wineJson({ name: 'A' }), 10);
    const svc = configure({ picker: async () => root });
    await svc.requestDirectory();

    await svc.writeJson('a.json', { name: 'A', description: 'x', custom_field: 'keep' } as never);

    const text = await (await handle.getFile()).text();
    expect(text).toContain('\n  "name": "A"');
    expect(JSON.parse(text).custom_field).toBe('keep');
  });

  it('createJson legt neue Datei an', async () => {
    const svc = await withDirectory(() => {});
    await svc.createJson('sub/new.json', { name: 'New', image: 'x.jpg' } as never);

    const { wine } = await svc.readJson('sub/new.json');
    expect(wine.name).toBe('New');
    expect(wine.image).toBe('x.jpg');
  });

  it('writeJson wirft ConflictError bei abweichendem lastModified (Req 17.25)', async () => {
    const svc = await withDirectory((root) => {
      root.addFile('a.json', wineJson({ name: 'A' }), 500);
    });

    await expect(svc.writeJson('a.json', { name: 'A2' } as never, 499)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('writeJson schreibt bei passendem lastModified', async () => {
    const svc = await withDirectory((root) => {
      root.addFile('a.json', wineJson({ name: 'A' }), 500);
    });

    const newTs = await svc.writeJson('a.json', { name: 'A2' } as never, 500);
    expect(newTs).toBeGreaterThan(500);
    const { wine } = await svc.readJson('a.json');
    expect(wine.name).toBe('A2');
  });
});

describe('FileSystemAccessService – Verschieben & Archivieren (Req 17.46/17.47)', () => {
  it('moveFile verschiebt eine Datei in einen Unterordner (copy+delete)', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.addFile('a.jpg', 'payload', 1);
    const svc = configure({ picker: async () => root });
    await svc.requestDirectory();

    const newPath = await svc.moveFile('a.jpg', ['sub']);

    expect(newPath).toBe('sub/a.jpg');
    expect(root.listPaths()).toEqual(['sub/a.jpg']);
    const moved = await (
      await (await root.getDirectoryHandle('sub')).getFileHandle('a.jpg')
    ).getFile();
    expect(await moved.text()).toBe('payload');
  });

  it('archiveFile verschiebt in den _archive-Ordner', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.addFile('wine.json', wineJson({ name: 'A' }), 1);
    const svc = configure({ picker: async () => root });
    await svc.requestDirectory();

    const newPath = await svc.archiveFile('wine.json');

    expect(newPath).toBe('_archive/wine.json');
    expect(root.listPaths()).toEqual(['_archive/wine.json']);
  });
});

describe('FileSystemAccessService – Thumbnails (Req 17.33)', () => {
  it('erzeugt ein verkleinertes Thumbnail und erhält das Seitenverhältnis', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    const handle = root.addFile('a.jpg', 'original-bytes', 42);
    const svc = configure({ picker: async () => root });
    await svc.requestDirectory();

    const thumb = await svc.createThumbnail('a.jpg', 100);

    // Original (400x200) seitenverhältniserhaltend auf max. 100 -> 100x50.
    expect(thumb.width).toBe(100);
    expect(thumb.height).toBe(50);
    expect(thumb.width / thumb.height).toBeCloseTo(2, 5);

    // Original unverändert.
    const original = await handle.getFile();
    expect(await original.text()).toBe('original-bytes');
    expect(original.lastModified).toBe(42);
  });
});
