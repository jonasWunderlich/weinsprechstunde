import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  DirectoryHandleStore,
  FileSystemAccessService,
  SHOW_DIRECTORY_PICKER,
  THUMBNAIL_CONCURRENCY,
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

/**
 * Renderer, der blockiert, bis er freigegeben wird, und dabei die maximale Anzahl
 * gleichzeitig laufender Aufrufe mitzählt. Damit lässt sich belegen, dass
 * {@link FileSystemAccessService.createThumbnail} nie mehr als
 * {@link THUMBNAIL_CONCURRENCY} Dekodierungen gleichzeitig zulässt (Schutz vor dem
 * Renderer-Crash bei vielen gleichzeitig dekodierten Originalbildern).
 */
class GatedRenderer extends ThumbnailRenderer {
  inFlight = 0;
  maxInFlight = 0;
  private release!: () => void;
  readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  openGate(): void {
    this.release();
  }
  override async render(_blob: Blob, _maxSize: number): Promise<Thumbnail> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await this.gate;
      return { blob: new Blob([]), width: 1, height: 1 };
    } finally {
      this.inFlight--;
    }
  }
}

function makeService(renderer: ThumbnailRenderer, root: FakeDirectoryHandle): FileSystemAccessService {
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

describe('createThumbnail Gleichzeitigkeits-Limit', () => {
  it(`lässt höchstens THUMBNAIL_CONCURRENCY (${THUMBNAIL_CONCURRENCY}) Dekodierungen gleichzeitig zu`, async () => {
    const root = new FakeDirectoryHandle('import_dir');
    const count = THUMBNAIL_CONCURRENCY * 3;
    for (let i = 0; i < count; i++) root.addFile(`img${i}.jpg`, 'x', 1);

    const renderer = new GatedRenderer();
    const svc = makeService(renderer, root);
    await svc.requestDirectory();

    // Alle Thumbnails gleichzeitig anfordern (wie beim Rendern einer langen Liste).
    const pending = Array.from({ length: count }, (_, i) => svc.createThumbnail(`img${i}.jpg`));

    // Den blockierten Renderer eine Mikrotask-Runde laufen lassen, damit die
    // zugelassenen Aufrufe tatsächlich in render() ankommen.
    await Promise.resolve();
    await Promise.resolve();

    // Nie mehr als das Limit gleichzeitig aktiv.
    expect(renderer.maxInFlight).toBeLessThanOrEqual(THUMBNAIL_CONCURRENCY);

    // Gate öffnen und alle abschließen lassen.
    renderer.openGate();
    await Promise.all(pending);
    expect(renderer.inFlight).toBe(0);
    // Über die gesamte Laufzeit wurde das Limit nie überschritten.
    expect(renderer.maxInFlight).toBeLessThanOrEqual(THUMBNAIL_CONCURRENCY);
  });
});
