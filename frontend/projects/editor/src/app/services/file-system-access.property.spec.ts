import { TestBed } from '@angular/core/testing';
import fc from 'fast-check';
import {
  DirectoryHandleStore,
  FileSystemAccessService,
  SHOW_DIRECTORY_PICKER,
  ThumbnailRenderer,
  Thumbnail,
} from './file-system-access.service';
import { FsaDirectoryHandle, ShowDirectoryPickerFn } from './fsa-types';
import { FakeDirectoryHandle } from './testing/fake-fsa';
import { scaleToFit } from './canvas-thumbnail-renderer';

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
 * Renderer, der das übergebene Blob niemals verändert (reines Lesen) und ein
 * Thumbnail mit seitenverhältniserhaltender Verkleinerung über {@link scaleToFit}
 * erzeugt. Simuliert den Pfad, den der echte Canvas-Renderer in Chromium nimmt.
 */
class AspectPreservingRenderer extends ThumbnailRenderer {
  constructor(
    private readonly srcW: number,
    private readonly srcH: number,
  ) {
    super();
  }
  override async render(blob: Blob, maxSize: number): Promise<Thumbnail> {
    const { width, height } = scaleToFit(this.srcW, this.srcH, maxSize);
    return { blob: new Blob([await blob.arrayBuffer()], { type: 'image/png' }), width, height };
  }
}

function makeService(opts: {
  picker: ShowDirectoryPickerFn;
  renderer?: ThumbnailRenderer;
}): FileSystemAccessService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      FileSystemAccessService,
      { provide: SHOW_DIRECTORY_PICKER, useValue: opts.picker },
      { provide: DirectoryHandleStore, useValue: new InMemoryStore() },
      {
        provide: ThumbnailRenderer,
        useValue: opts.renderer ?? new AspectPreservingRenderer(400, 200),
      },
    ],
  });
  return TestBed.inject(FileSystemAccessService);
}

// Arbitrary: ein zufälliger Verzeichnisbaum aus Dateien und Unterordnern.
interface TreeNode {
  dirs: Record<string, TreeNode>;
  files: string[];
}

const fileNameArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,6}$/),
    fc.constantFrom('.json', '.jpg', '.jpeg', '.png', '.webp', '.txt'),
  )
  .map(([base, ext]) => base + ext);

const dirNameArb = fc.stringMatching(/^[a-z]{1,5}$/);

/**
 * Tiefenbegrenzter Baum-Generator. `fc.letrec` kann ohne harte Tiefengrenze
 * gelegentlich pathologisch tiefe Strukturen erzeugen (Stacküberlauf beim
 * Generieren); daher begrenzen wir die Rekursion explizit.
 */
function treeArbOfDepth(depth: number): fc.Arbitrary<TreeNode> {
  const filesArb = fc.uniqueArray(fileNameArb, { maxLength: 4 });
  if (depth <= 0) {
    return filesArb.map((files) => ({ files, dirs: {} }));
  }
  return fc.record({
    files: filesArb,
    dirs: fc.dictionary(dirNameArb, treeArbOfDepth(depth - 1), { maxKeys: 2 }),
  });
}

const treeArb: fc.Arbitrary<TreeNode> = treeArbOfDepth(3);

function buildHandle(node: TreeNode, name: string): FakeDirectoryHandle {
  const dir = new FakeDirectoryHandle(name);
  for (const f of node.files) {
    dir.addFile(f, f.endsWith('.json') ? JSON.stringify({ name: f }) : 'binary', 1);
  }
  for (const [child, childNode] of Object.entries(node.dirs)) {
    dir.children.set(child, buildHandle(childNode, child));
  }
  return dir;
}

/** Sammelt alle Pfade aus dem Baum, die das Scannen erfassen DARF (JSON/Bild, ohne _archive top-level). */
function expectedScanPaths(node: TreeNode, segments: string[]): string[] {
  const out: string[] = [];
  for (const f of node.files) {
    const lower = f.toLowerCase();
    if (lower.endsWith('.json') || /\.(jpe?g|png|webp)$/.test(lower)) {
      out.push([...segments, f].join('/'));
    }
  }
  for (const [child, childNode] of Object.entries(node.dirs)) {
    if (segments.length === 0 && child === '_archive') continue;
    out.push(...expectedScanPaths(childNode, [...segments, child]));
  }
  return out;
}

describe('Property 26: Zugriff bleibt auf den freigegebenen Ordner beschränkt', () => {
  // Feature: weinliste, Property 26: Zugriff bleibt auf den freigegebenen Ordner beschränkt (Validates: Requirements 16.2)
  it('scannt ausschließlich Nachfahren des freigegebenen Handles und ignoriert _archive', async () => {
    await fc.assert(
      fc.asyncProperty(treeArb, fc.boolean(), async (node, withArchive) => {
        const n: TreeNode = withArchive
          ? {
              files: node.files,
              dirs: {
                ...node.dirs,
                _archive: { files: ['secret.json', 'secret.jpg'], dirs: {} },
              },
            }
          : node;
        const root = buildHandle(n, 'import_dir');
        const svc = makeService({ picker: async () => root });
        await svc.requestDirectory();

        const { entries, images } = await svc.scan();
        const scanned = [...entries.map((e) => e.path), ...images.map((i) => i.path)].sort();
        const expected = expectedScanPaths(n, []).sort();

        // Alle erfassten Pfade liegen im erwarteten (auf root beschränkten) Set,
        // und kein _archive-Pfad taucht auf.
        expect(scanned).toEqual(expected);
        expect(scanned.some((p) => p.split('/')[0] === '_archive')).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 23: Clientseitiges Thumbnail lässt Original unverändert und erhält Seitenverhältnis', () => {
  // Feature: weinliste, Property 23: Clientseitiges Thumbnail lässt Original unverändert und erhält Seitenverhältnis (Validates: Requirements 17.33)
  it('Original bleibt byte-identisch und Seitenverhältnis bleibt innerhalb 0.01 erhalten', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Realistische Bildmaße mit moderatem Seitenverhältnis ([0.5 .. 2.0]): die
        // Thumbnail-Erzeugung ist dann nicht degeneriert — beide Kanten bleiben
        // deutlich > 1 px —, sodass die 0.01-Toleranz des Seitenverhältnisses nicht
        // durch 1-px-Rundung der kurzen Kante verletzt wird.
        fc.integer({ min: 200, max: 4000 }),
        fc.double({ min: 0.5, max: 2.0, noNaN: true }),
        fc.integer({ min: 128, max: 512 }),
        async (w, ratio, maxSize) => {
          const h = Math.max(200, Math.round(w / ratio));
          const root = new FakeDirectoryHandle('import_dir');
          const originalBytes = `orig-${w}x${h}`;
          const handle = root.addFile('pic.jpg', originalBytes, 7);
          const svc = makeService({
            picker: async () => root,
            renderer: new AspectPreservingRenderer(w, h),
          });
          await svc.requestDirectory();

          const thumb = await svc.createThumbnail('pic.jpg', maxSize);

          // (1) Original byte-identisch unverändert.
          const original = await handle.getFile();
          expect(await original.text()).toBe(originalBytes);
          expect(original.lastModified).toBe(7);

          // (2) Seitenverhältnis innerhalb relativer Toleranz 0.01 des Originals.
          const originalRatio = w / h;
          const thumbRatio = thumb.width / thumb.height;
          expect(Math.abs(originalRatio - thumbRatio) / originalRatio).toBeLessThanOrEqual(0.01);

          // Thumbnail nicht größer als Original-Längskante bzw. maxSize.
          expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(Math.max(w, h, maxSize));
        },
      ),
      { numRuns: 100 },
    );
  });
});
