import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  DirectoryHandleStore,
  FileSystemAccessService,
  SHOW_DIRECTORY_PICKER,
  ThumbnailRenderer,
  Thumbnail,
} from './file-system-access.service';
import { FsaDirectoryHandle, ShowDirectoryPickerFn } from './fsa-types';
import { FakeDirectoryHandle } from './testing/fake-fsa';

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

/** Renderer, der jede Erzeugung mitzählt — belegt, ob der Cache greift. */
class CountingRenderer extends ThumbnailRenderer {
  calls = 0;
  override async render(_blob: Blob, _maxSize: number): Promise<Thumbnail> {
    this.calls++;
    return { blob: new Blob([]), width: 1, height: 1 };
  }
}

function makeService(
  renderer: ThumbnailRenderer,
  root: FakeDirectoryHandle,
): FileSystemAccessService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      FileSystemAccessService,
      { provide: SHOW_DIRECTORY_PICKER, useValue: (async () => root) as ShowDirectoryPickerFn },
      { provide: DirectoryHandleStore, useValue: new InMemoryStore() },
      { provide: ThumbnailRenderer, useValue: renderer },
    ],
  });
  return TestBed.inject(FileSystemAccessService);
}

describe('createThumbnail Cache', () => {
  it('erzeugt ein Thumbnail nur einmal pro Pfad und Größe (zweiter Aufruf aus dem Cache)', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.addFile('a.jpg', 'x', 1);
    const renderer = new CountingRenderer();
    const svc = makeService(renderer, root);
    await svc.requestDirectory();

    await svc.createThumbnail('a.jpg', 256);
    await svc.createThumbnail('a.jpg', 256);
    await svc.createThumbnail('a.jpg', 256);

    expect(renderer.calls).toBe(1);
  });

  it('cached pro Größe getrennt (unterschiedliche maxSize erzeugen je einmal)', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.addFile('a.jpg', 'x', 1);
    const renderer = new CountingRenderer();
    const svc = makeService(renderer, root);
    await svc.requestDirectory();

    await svc.createThumbnail('a.jpg', 256);
    await svc.createThumbnail('a.jpg', 480);
    await svc.createThumbnail('a.jpg', 256);
    await svc.createThumbnail('a.jpg', 480);

    expect(renderer.calls).toBe(2);
  });

  it('teilt gleichzeitige Anfragen für dasselbe Bild (nur eine Erzeugung)', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.addFile('a.jpg', 'x', 1);
    const renderer = new CountingRenderer();
    const svc = makeService(renderer, root);
    await svc.requestDirectory();

    await Promise.all([
      svc.createThumbnail('a.jpg', 256),
      svc.createThumbnail('a.jpg', 256),
      svc.createThumbnail('a.jpg', 256),
    ]);

    expect(renderer.calls).toBe(1);
  });

  it('invalidiert den Cache bei einem erneuten scan() (frische Vorschau nach Änderung)', async () => {
    const root = new FakeDirectoryHandle('import_dir');
    root.addFile('a.jpg', 'x', 1);
    const renderer = new CountingRenderer();
    const svc = makeService(renderer, root);
    await svc.requestDirectory();

    await svc.createThumbnail('a.jpg', 256);
    expect(renderer.calls).toBe(1);

    await svc.scan();

    await svc.createThumbnail('a.jpg', 256);
    expect(renderer.calls).toBe(2);
  });
});
