import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  DirectoryHandleStore,
  FileSystemAccessService,
  ImageEntry,
  ScanResult,
  SHOW_DIRECTORY_PICKER,
  ThumbnailRenderer,
  Thumbnail,
  WineEntry,
} from './file-system-access.service';
import { FsaDirectoryHandle } from './fsa-types';
import { FakeDirectoryHandle } from './testing/fake-fsa';
import { FromImageService } from './from-image.service';
import { DEFAULT_WINE_SCHEMA } from '../models/default-schema';

// ── Fakes für die injizierbaren FSA-Adapter ─────────────────────────────────────

class InMemoryStore extends DirectoryHandleStore {
  saved: FsaDirectoryHandle | null = null;
  override async save(h: FsaDirectoryHandle): Promise<void> {
    this.saved = h;
  }
  override async load(): Promise<FsaDirectoryHandle | null> {
    return this.saved;
  }
  override async clear(): Promise<void> {
    this.saved = null;
  }
}

class FakeThumbnailRenderer extends ThumbnailRenderer {
  override async render(blob: Blob, maxSize: number): Promise<Thumbnail> {
    return { blob, width: maxSize, height: maxSize };
  }
}

/** Baut einen minimalen JPEG-Puffer mit EXIF-`DateTimeOriginal` (Big-Endian). */
function buildJpegWithDate(dateStr: string): Uint8Array {
  const ascii = dateStr.padEnd(19, ' ') + '\0';
  const asciiBytes = new TextEncoder().encode(ascii);
  const header = 8;
  const ifd0 = header;
  const ifd0Size = 2 + 12 + 4;
  const exifIfd = ifd0 + ifd0Size;
  const exifIfdSize = 2 + 12 + 4;
  const asciiOffset = exifIfd + exifIfdSize;
  const tiffLen = asciiOffset + asciiBytes.length;
  const tiff = new DataView(new ArrayBuffer(tiffLen));
  tiff.setUint16(0, 0x4d4d);
  tiff.setUint16(2, 0x002a);
  tiff.setUint32(4, ifd0);
  tiff.setUint16(ifd0, 1);
  tiff.setUint16(ifd0 + 2, 0x8769);
  tiff.setUint16(ifd0 + 4, 4);
  tiff.setUint32(ifd0 + 6, 1);
  tiff.setUint32(ifd0 + 10, exifIfd);
  tiff.setUint32(ifd0 + 14, 0);
  tiff.setUint16(exifIfd, 1);
  tiff.setUint16(exifIfd + 2, 0x9003);
  tiff.setUint16(exifIfd + 4, 2);
  tiff.setUint32(exifIfd + 6, asciiBytes.length);
  tiff.setUint32(exifIfd + 10, asciiOffset);
  tiff.setUint32(exifIfd + 14, 0);
  new Uint8Array(tiff.buffer).set(asciiBytes, asciiOffset);
  const exifHeader = new TextEncoder().encode('Exif\0\0');
  const app1DataLen = exifHeader.length + tiffLen;
  const app1SegLen = app1DataLen + 2;
  const total = 2 + 2 + 2 + app1DataLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0xffd8);
  dv.setUint16(2, 0xffe1);
  dv.setUint16(4, app1SegLen);
  out.set(exifHeader, 6);
  out.set(new Uint8Array(tiff.buffer), 6 + exifHeader.length);
  return out;
}

function configure(root: FakeDirectoryHandle): {
  fsa: FileSystemAccessService;
  svc: FromImageService;
} {
  TestBed.configureTestingModule({
    providers: [
      FileSystemAccessService,
      FromImageService,
      { provide: SHOW_DIRECTORY_PICKER, useValue: async () => root },
      { provide: DirectoryHandleStore, useValue: new InMemoryStore() },
      { provide: ThumbnailRenderer, useValue: new FakeThumbnailRenderer() },
    ],
  });
  const fsa = TestBed.inject(FileSystemAccessService);
  const svc = TestBed.inject(FromImageService);
  return { fsa, svc };
}

async function withRoot(
  build: (root: FakeDirectoryHandle) => void,
): Promise<{ fsa: FileSystemAccessService; svc: FromImageService; root: FakeDirectoryHandle }> {
  const root = new FakeDirectoryHandle('import_dir');
  build(root);
  const { fsa, svc } = configure(root);
  await fsa.requestDirectory();
  return { fsa, svc, root };
}

function imageEntry(path: string): ImageEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, date: 0, dateSource: 'lastModified', assigned: false };
}

async function readScan(fsa: FileSystemAccessService): Promise<ScanResult> {
  return fsa.scan();
}

describe('FromImageService.createFromImage (Req 17.36/17.37)', () => {
  it('legt die vorläufige JSON im selben Unterordner mit Basisname + .json an', async () => {
    const { fsa, svc } = await withRoot((root) => {
      const sub = root.addDir('sub');
      sub.addFile('IMG_1.jpg', 'imgdata', 100);
    });

    const result = await svc.createFromImage(imageEntry('sub/IMG_1.jpg'), DEFAULT_WINE_SCHEMA);

    expect(result.path).toBe('sub/IMG_1.json');
    const { wine } = await fsa.readJson('sub/IMG_1.json');
    expect(wine.image).toBe('IMG_1.jpg');
  });

  it('belegt alle Schema-Felder mit null außer image und tasting_date (EXIF)', async () => {
    const jpeg = buildJpegWithDate('2021:07:15 12:30:00');
    const { fsa, svc } = await withRoot((root) => {
      root.addFile('a.jpg', jpeg, 100);
    });

    await svc.createFromImage(imageEntry('a.jpg'), DEFAULT_WINE_SCHEMA);

    const { wine } = await fsa.readJson('a.json');
    expect(wine.image).toBe('a.jpg');
    expect(wine.tasting_date).toBe('2021-07-15');
    for (const f of DEFAULT_WINE_SCHEMA) {
      if (f.field === 'image' || f.field === 'tasting_date') continue;
      expect(wine[f.field]).toBeNull();
    }
  });

  it('setzt tasting_date auf null ohne EXIF-Datum', async () => {
    const { fsa, svc } = await withRoot((root) => {
      root.addFile('a.png', 'nojpeg', 100);
    });

    await svc.createFromImage(imageEntry('a.png'), DEFAULT_WINE_SCHEMA);

    const { wine } = await fsa.readJson('a.json');
    expect(wine.tasting_date).toBeNull();
  });

  it('wirft, wenn bereits eine JSON für dieses Bild existiert (kein Überschreiben)', async () => {
    const { svc } = await withRoot((root) => {
      root.addFile('a.jpg', 'imgdata', 100);
      root.addFile('a.json', JSON.stringify({ name: 'Bestehend' }), 100);
    });

    await expect(svc.createFromImage(imageEntry('a.jpg'), DEFAULT_WINE_SCHEMA)).rejects.toThrow();
  });
});

describe('FromImageService.linkImage (Req 17.41/17.42/17.43)', () => {
  function provisionalEntry(path: string, image: string): WineEntry {
    const parts = path.split('/');
    const name = parts.pop() as string;
    return {
      name,
      path,
      dirSegments: parts,
      wine: { name: null as unknown as string, image } as never,
      broken: false,
      lastModified: 0,
    };
  }
  function targetEntry(path: string): WineEntry {
    const parts = path.split('/');
    const name = parts.pop() as string;
    return { name, path, dirSegments: parts, wine: { name: 'Bestehend' }, broken: false, lastModified: 0 };
  }

  it('verknüpft im selben Verzeichnis: image gesetzt, vorläufige JSON entfernt, genau eine JSON', async () => {
    const { fsa, svc, root } = await withRoot((r) => {
      r.addFile('IMG_1.jpg', 'imgdata', 100);
      r.addFile('IMG_1.json', JSON.stringify({ name: null, image: 'IMG_1.jpg' }), 100);
      r.addFile('bestehend.json', JSON.stringify({ name: 'Bestehend' }), 100);
    });

    const result = await svc.linkImage(
      provisionalEntry('IMG_1.json', 'IMG_1.jpg'),
      targetEntry('bestehend.json'),
      imageEntry('IMG_1.jpg'),
    );

    expect(result.path).toBe('bestehend.json');
    expect(result.wine.image).toBe('IMG_1.jpg');

    const paths = root.listPaths();
    expect(paths).toContain('bestehend.json');
    expect(paths).not.toContain('IMG_1.json'); // vorläufige JSON entfernt
    expect(paths).toContain('IMG_1.jpg'); // Bild bleibt (gleiches Verzeichnis)

    // Genau eine JSON für den Wein.
    const { entries } = await readScan(fsa);
    expect(entries.map((e) => e.path).sort()).toEqual(['bestehend.json']);
    const target = entries[0];
    expect(target.wine?.image).toBe('IMG_1.jpg');
  });

  it('verschiebt das Bild in das Verzeichnis des bestehenden Eintrags, wenn es woanders liegt', async () => {
    const { fsa, svc, root } = await withRoot((r) => {
      const sub = r.addDir('sub');
      sub.addFile('IMG_1.jpg', 'imgdata', 100);
      sub.addFile('IMG_1.json', JSON.stringify({ name: null, image: 'IMG_1.jpg' }), 100);
      const ziel = r.addDir('ziel');
      ziel.addFile('bestehend.json', JSON.stringify({ name: 'Bestehend' }), 100);
    });

    await svc.linkImage(
      provisionalEntry('sub/IMG_1.json', 'IMG_1.jpg'),
      targetEntry('ziel/bestehend.json'),
      imageEntry('sub/IMG_1.jpg'),
    );

    const paths = root.listPaths();
    expect(paths).toContain('ziel/IMG_1.jpg'); // Bild verschoben
    expect(paths).not.toContain('sub/IMG_1.jpg'); // Original weg
    expect(paths).not.toContain('sub/IMG_1.json'); // vorläufige JSON weg
    expect(paths).toContain('ziel/bestehend.json');

    const { wine } = await fsa.readJson('ziel/bestehend.json');
    expect(wine.image).toBe('IMG_1.jpg');

    // Bild und JSON liegen im selben Verzeichnis, genau eine JSON.
    const { entries } = await readScan(fsa);
    expect(entries.map((e) => e.path).sort()).toEqual(['ziel/bestehend.json']);
  });

  it('hinterlässt bei Fehler keinen Zustand mit doppelter JSON (Rollback, Req 17.43)', async () => {
    const { fsa, svc, root } = await withRoot((r) => {
      const sub = r.addDir('sub');
      sub.addFile('IMG_1.jpg', 'imgdata', 100);
      sub.addFile('IMG_1.json', JSON.stringify({ name: null, image: 'IMG_1.jpg' }), 100);
      const ziel = r.addDir('ziel');
      ziel.addFile('bestehend.json', JSON.stringify({ name: 'Bestehend' }), 100);
    });

    // removeEntry so patchen, dass das Entfernen der vorläufigen JSON fehlschlägt.
    const sub = (root as FakeDirectoryHandle).children.get('sub') as FakeDirectoryHandle;
    const originalRemove = sub.removeEntry.bind(sub);
    sub.removeEntry = async (name: string) => {
      if (name === 'IMG_1.json') throw new Error('remove failed');
      return originalRemove(name);
    };

    await expect(
      svc.linkImage(
        provisionalEntry('sub/IMG_1.json', 'IMG_1.jpg'),
        targetEntry('ziel/bestehend.json'),
        imageEntry('sub/IMG_1.jpg'),
      ),
    ).rejects.toThrow();

    // Invariante: niemals zwei JSON-Dateien für denselben Wein. Die vorläufige JSON
    // konnte nicht entfernt werden → der bestehende Eintrag darf das Bild NICHT
    // zugeordnet behalten (Rollback auf bildlos + Bild zurück).
    const { wine } = await fsa.readJson('ziel/bestehend.json');
    expect(wine.image == null || wine.image === '').toBe(true);

    const paths = root.listPaths();
    // Das Bild wurde in sein Ursprungsverzeichnis zurückgerollt.
    expect(paths).toContain('sub/IMG_1.jpg');
    expect(paths).not.toContain('ziel/IMG_1.jpg');
  });
});
