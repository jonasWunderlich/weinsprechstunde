import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DIR,
  DirectoryHandleStore,
  FileSystemAccessService,
  ImageEntry,
  SHOW_DIRECTORY_PICKER,
  Thumbnail,
  ThumbnailRenderer,
  WineEntry,
} from './file-system-access.service';
import { FsaDirectoryHandle } from './fsa-types';
import { FakeDirectoryHandle } from './testing/fake-fsa';
import { ArchiveService } from './archive.service';
import { Wine } from '@weinsprechstunde/shared';

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

async function withRoot(
  build: (root: FakeDirectoryHandle) => void,
): Promise<{ fsa: FileSystemAccessService; svc: ArchiveService; root: FakeDirectoryHandle }> {
  const root = new FakeDirectoryHandle('import_dir');
  build(root);
  TestBed.configureTestingModule({
    providers: [
      FileSystemAccessService,
      ArchiveService,
      { provide: SHOW_DIRECTORY_PICKER, useValue: async () => root },
      { provide: DirectoryHandleStore, useValue: new InMemoryStore() },
      { provide: ThumbnailRenderer, useValue: new FakeThumbnailRenderer() },
    ],
  });
  const fsa = TestBed.inject(FileSystemAccessService);
  const svc = TestBed.inject(ArchiveService);
  await fsa.requestDirectory();
  return { fsa, svc, root };
}

function imageEntry(path: string): ImageEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, date: 0, dateSource: 'lastModified', assigned: false };
}

function wineEntry(path: string, wine: Wine): WineEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, wine, broken: false, lastModified: 0 };
}

describe('ArchiveService.archiveImage (Req 17.46)', () => {
  it('verschiebt ein ungenutztes Bild in den _archive-Ordner', async () => {
    const { svc, root } = await withRoot((r) => {
      r.addFile('unused.jpg', 'imgdata', 100);
    });

    const result = await svc.archiveImage(imageEntry('unused.jpg'));

    expect(result.archivedPaths).toEqual([`${ARCHIVE_DIR}/unused.jpg`]);
    const paths = root.listPaths();
    expect(paths).toContain(`${ARCHIVE_DIR}/unused.jpg`);
    expect(paths).not.toContain('unused.jpg');
  });

  it('lässt das Bild bei Fehler am Ursprungsort und meldet den Fehler (Req 17.48)', async () => {
    const { svc, root } = await withRoot((r) => {
      r.addFile('unused.jpg', 'imgdata', 100);
    });
    // Anlegen des _archive-Zielverzeichnisses scheitern lassen.
    const originalGetDir = root.getDirectoryHandle.bind(root);
    root.getDirectoryHandle = async (name: string, options?: { create?: boolean }) => {
      if (name === ARCHIVE_DIR) throw new Error('mkdir failed');
      return originalGetDir(name, options);
    };

    await expect(svc.archiveImage(imageEntry('unused.jpg'))).rejects.toThrow(
      /Archivieren fehlgeschlagen/,
    );

    const paths = root.listPaths();
    expect(paths).toContain('unused.jpg'); // Bild bleibt am Ursprungsort
    expect(paths).not.toContain(`${ARCHIVE_DIR}/unused.jpg`);
  });
});

describe('ArchiveService.archiveEntry (Req 17.47)', () => {
  it('verschiebt JSON + image + audio + video gemeinsam nach _archive', async () => {
    const { svc, root } = await withRoot((r) => {
      r.addFile('a.jpg', 'img', 100);
      r.addFile('a.mp3', 'audio', 100);
      r.addFile('a.mp4', 'video', 100);
      r.addFile('a.json', JSON.stringify({ name: 'A', image: 'a.jpg', audio: 'a.mp3', video: 'a.mp4' }), 100);
    });

    await svc.archiveEntry(
      wineEntry('a.json', { name: 'A', image: 'a.jpg', audio: 'a.mp3', video: 'a.mp4' }),
    );

    const paths = root.listPaths();
    expect(paths).toContain(`${ARCHIVE_DIR}/a.json`);
    expect(paths).toContain(`${ARCHIVE_DIR}/a.jpg`);
    expect(paths).toContain(`${ARCHIVE_DIR}/a.mp3`);
    expect(paths).toContain(`${ARCHIVE_DIR}/a.mp4`);
    expect(paths).not.toContain('a.json');
    expect(paths).not.toContain('a.jpg');
    expect(paths).not.toContain('a.mp3');
    expect(paths).not.toContain('a.mp4');
  });

  it('verschiebt nur die JSON, wenn keine Medien referenziert sind', async () => {
    const { svc, root } = await withRoot((r) => {
      r.addFile('a.json', JSON.stringify({ name: 'A' }), 100);
    });

    await svc.archiveEntry(wineEntry('a.json', { name: 'A' }));

    const paths = root.listPaths();
    expect(paths).toEqual([`${ARCHIVE_DIR}/a.json`]);
  });

  it('überspringt referenzierte Medien, die am Ursprungsort fehlen', async () => {
    const { svc, root } = await withRoot((r) => {
      r.addFile('a.json', JSON.stringify({ name: 'A', image: 'missing.jpg' }), 100);
    });

    await svc.archiveEntry(wineEntry('a.json', { name: 'A', image: 'missing.jpg' }));

    const paths = root.listPaths();
    expect(paths).toEqual([`${ARCHIVE_DIR}/a.json`]);
  });

  it('rollt bei Fehler mitten im Verschieben zurück — keine inkonsistente Teilverschiebung (Req 17.48)', async () => {
    const { fsa, svc, root } = await withRoot((r) => {
      r.addFile('a.jpg', 'img', 100);
      r.addFile('a.json', JSON.stringify({ name: 'A', image: 'a.jpg' }), 100);
    });

    // Das Bild (erste Datei) lässt sich verschieben; danach wird das Entfernen der JSON
    // blockiert, sodass das zweite archiveFile scheitert.
    const originalRemove = root.removeEntry.bind(root);
    root.removeEntry = async (name: string) => {
      if (name === 'a.json') throw new Error('remove failed');
      return originalRemove(name);
    };

    await expect(
      svc.archiveEntry(wineEntry('a.json', { name: 'A', image: 'a.jpg' })),
    ).rejects.toThrow(/Archivieren fehlgeschlagen/);

    // Rollback: die JSON bleibt (konnte nicht entfernt werden), das Bild wurde
    // zurückgerollt → keine inkonsistente Teilverschiebung, kein Datenverlust.
    const paths = root.listPaths();
    expect(paths).toContain('a.json');
    expect(paths).toContain('a.jpg');
    expect(paths).not.toContain(`${ARCHIVE_DIR}/a.jpg`);

    // Der Eintrag ist nach Rollback wieder vollständig les-/scanbar.
    const { entries } = await fsa.scan();
    expect(entries.map((e) => e.path)).toEqual(['a.json']);
  });
});
