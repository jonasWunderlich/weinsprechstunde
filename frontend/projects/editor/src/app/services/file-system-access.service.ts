import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Wine } from '@weinsprechstunde/shared';
import { FsaDirectoryHandle, FsaFileHandle, ShowDirectoryPickerFn } from './fsa-types';
import { readExifDateTimeOriginal } from './exif';

/** Fester Name des Archiv-Unterordners im `import_dir` (Req 17.45/17.49). */
export const ARCHIVE_DIR = '_archive';

/** Unterstützte Bild-Endungen, case-insensitive (Req 17.32). */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/** Unterstützte Audio-Endungen des Audio-Pickers (Req 17.19), case-insensitive. */
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.wav', '.flac'];

/** Unterstützte Video-Endungen des Video-Pickers (Req 17.19), case-insensitive. */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v', '.ogv'];

/** Felder, deren Dateinamen-Referenzen ein Bild als „assigned" markieren. */
const IMAGE_FIELD = 'image';

/**
 * Ein beim Scan erfasster Weineintrag (eine JSON-Quelldatei).
 *
 * `broken=true` kennzeichnet ungültiges JSON (Req 17.26): solche Einträge werden
 * im Listing markiert, aber nicht zum Bearbeiten geöffnet. `content`/`wine` sind
 * dann `null`.
 */
export interface WineEntry {
  /** Dateiname inkl. Endung, ohne Pfad. */
  name: string;
  /** Pfad relativ zum freigegebenen Ordner (z. B. `sub/2021-wein.json`). */
  path: string;
  /** Segmente des Unterordner-Pfads (ohne Dateiname); leer = direkt im Wurzelordner. */
  dirSegments: string[];
  /** Geparster JSON-Inhalt; `null` bei defektem JSON. */
  wine: Wine | null;
  /** `true`, wenn das JSON nicht geparst werden konnte (Req 17.26). */
  broken: boolean;
  /** `File.lastModified` zum Ladezeitpunkt (Basis der Konflikterkennung, Req 17.25). */
  lastModified: number;
}

/** Ein Bild-Listing-Eintrag (Req 17.28/17.29). */
export interface ImageEntry {
  /** Dateiname inkl. Endung, ohne Pfad. */
  name: string;
  /** Pfad relativ zum freigegebenen Ordner. */
  path: string;
  /** Segmente des Unterordner-Pfads (ohne Dateiname). */
  dirSegments: string[];
  /** EXIF-`DateTimeOriginal` (ISO `YYYY-MM-DD`), sonst `File.lastModified`. */
  date: number;
  /** Quelle des Datums — für Diagnose/Sortier-Transparenz. */
  dateSource: 'exif' | 'lastModified';
  /** `true`, wenn ein `image`-Feld irgendeiner JSON diesen Dateinamen referenziert. */
  assigned: boolean;
}

/** Ergebnis eines vollständigen Verzeichnis-Scans. */
export interface ScanResult {
  entries: WineEntry[];
  images: ImageEntry[];
}

/** Medienart für die Audio-/Video-Picker (Req 17.19). */
export type MediaKind = 'audio' | 'video';

/** Ein Mediendatei-Listing-Eintrag für den Audio-/Video-Picker (Req 17.19). */
export interface MediaEntry {
  /** Dateiname inkl. Endung, ohne Pfad (= in das Feld übernommener Wert, Req 17.35). */
  name: string;
  /** Pfad relativ zum freigegebenen Ordner. */
  path: string;
  /** Segmente des Unterordner-Pfads (ohne Dateiname). */
  dirSegments: string[];
}

/**
 * Maximale Anzahl gleichzeitiger Thumbnail-Dekodierungen. Begrenzt den Speicher-Peak,
 * wenn eine lange Liste viele Vorschaubilder auf einmal anfordert (Schutz vor dem
 * Renderer-Crash bei hunderten gleichzeitig dekodierten Originalbildern).
 */
export const THUMBNAIL_CONCURRENCY = 4;

/**
 * Obergrenze des Thumbnail-Caches (Anzahl Einträge). Begrenzt den Speicher bei sehr
 * vielen Bildern; bei Überschreiten wird nach LRU der älteste Eintrag verworfen.
 */
export const THUMBNAIL_CACHE_MAX = 600;

/** Ergebnis der clientseitigen Thumbnail-Erzeugung. */
export interface Thumbnail {
  /** Blob des verkleinerten Vorschaubilds (PNG). */
  blob: Blob;
  width: number;
  height: number;
}

/** Fehler bei fehlender File System Access API (nicht-Chromium, Req 17.4). */
export class UnsupportedBrowserError extends Error {
  constructor() {
    super('Die File System Access API wird von diesem Browser nicht unterstützt.');
    this.name = 'UnsupportedBrowserError';
  }
}

/** Fehler bei erkanntem externen Änderungskonflikt (Req 17.25). */
export class ConflictError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super('Die Datei wurde seit dem Laden extern verändert.');
    this.name = 'ConflictError';
  }
}

// ── Adapter-Tokens: kapseln die nicht in jsdom verfügbaren Browser-APIs ──────────
// So lässt sich der Service in Tests vollständig ohne echte File System Access API,
// ohne IndexedDB und ohne Canvas prüfen, indem diese Tokens mit Fakes überschrieben
// werden.

/** Liefert `window.showDirectoryPicker` oder `null`, wenn die API fehlt. */
export const SHOW_DIRECTORY_PICKER = new InjectionToken<ShowDirectoryPickerFn | null>(
  'SHOW_DIRECTORY_PICKER',
  {
    factory: () => {
      const w = globalThis as unknown as { showDirectoryPicker?: ShowDirectoryPickerFn };
      return typeof w.showDirectoryPicker === 'function'
        ? (w.showDirectoryPicker.bind(globalThis) as ShowDirectoryPickerFn)
        : null;
    },
  },
);

/** Persistenz des Ordner-Handles (Default: IndexedDB). */
export abstract class DirectoryHandleStore {
  abstract save(handle: FsaDirectoryHandle): Promise<void>;
  abstract load(): Promise<FsaDirectoryHandle | null>;
  abstract clear(): Promise<void>;
}

/** Clientseitige Thumbnail-Erzeugung (Default: createImageBitmap + Canvas). */
export abstract class ThumbnailRenderer {
  abstract render(blob: Blob, maxSize: number): Promise<Thumbnail>;
}

@Injectable({ providedIn: 'root' })
export class FileSystemAccessService {
  private readonly picker = inject(SHOW_DIRECTORY_PICKER, { optional: true });
  private readonly store = inject(DirectoryHandleStore);
  private readonly thumbnailRenderer = inject(ThumbnailRenderer);

  private readonly _directory = signal<FsaDirectoryHandle | null>(null);

  /** `true`, wenn die File System Access API im aktuellen Browser verfügbar ist (Req 17.4). */
  readonly apiSupported = this.picker !== null;

  /** Freigabe-Zustand: `true`, sobald ein Ordner-Handle aktiv ist. */
  readonly hasAccess = computed(() => this._directory() !== null);

  /** Name des freigegebenen Ordners oder `null`. */
  readonly directoryName = computed(() => this._directory()?.name ?? null);

  /**
   * Fordert den Benutzer auf, den Cloud-Ordner (`import_dir`) freizugeben
   * (Req 17.2). Das erhaltene Handle wird in IndexedDB persistiert.
   *
   * @throws {@link UnsupportedBrowserError} wenn die API fehlt (Req 17.4).
   */
  async requestDirectory(): Promise<FsaDirectoryHandle> {
    if (!this.picker) throw new UnsupportedBrowserError();
    const handle = await this.picker({ mode: 'readwrite' });
    await this.store.save(handle);
    this._directory.set(handle);
    this.clearThumbnailCache();
    return handle;
  }

  /**
   * Stellt bei erneutem Öffnen den Zugriff über das persistierte Handle her
   * (Req 17.3) — kurze Re-Autorisierung per `queryPermission`/`requestPermission`,
   * ohne dass der Benutzer den Ordner erneut suchen muss.
   *
   * @returns das wiederhergestellte Handle oder `null`, wenn keins vorliegt bzw.
   *          die Berechtigung nicht (mehr) erteilt wird.
   */
  async restoreDirectory(): Promise<FsaDirectoryHandle | null> {
    if (!this.apiSupported) return null;
    const handle = await this.store.load();
    if (!handle) return null;
    const granted = await this.ensurePermission(handle);
    if (!granted) return null;
    this._directory.set(handle);
    this.clearThumbnailCache();
    return handle;
  }

  private async ensurePermission(handle: FsaDirectoryHandle): Promise<boolean> {
    const desc = { mode: 'readwrite' as const };
    let state = (await handle.queryPermission?.(desc)) ?? 'granted';
    if (state !== 'granted') {
      state = (await handle.requestPermission?.(desc)) ?? 'denied';
    }
    return state === 'granted';
  }

  /** Das aktuell freigegebene Verzeichnis-Handle, falls vorhanden. */
  directory(): FsaDirectoryHandle | null {
    return this._directory();
  }

  private requireDirectory(): FsaDirectoryHandle {
    const dir = this._directory();
    if (!dir) throw new Error('Kein Ordner freigegeben.');
    return dir;
  }

  // ── Verzeichnis-Scan ────────────────────────────────────────────────────────

  /**
   * Scannt den freigegebenen Ordner rekursiv (Req 17.1/17.49). Liefert alle
   * JSON-Weineinträge und ein Bild-Listing. Der Unterordner `_archive` wird
   * vollständig übersprungen (Req 17.49).
   *
   * Hinweis zur Pfadbeschränkung (Req 16.2): Der Service traversiert ausschließlich
   * über die vom Benutzer freigegebenen Handles. Die Browser-API beschränkt den
   * Zugriff technisch auf den freigegebenen Ordner; eine anwendungsseitige
   * Path-Traversal-Prüfung ist daher nicht nötig.
   */
  async scan(): Promise<ScanResult> {
    const dir = this.requireDirectory();
    // Nach jeder Änderung (Anlegen/Verschieben/Archivieren/Speichern) löst der
    // EditorStateService einen erneuten scan() aus. Den Thumbnail-Cache hier leeren,
    // damit neu zugewiesene oder verschobene Bilder frische Vorschauen erhalten.
    this.clearThumbnailCache();
    const entries: WineEntry[] = [];
    const rawImages: Array<{
      name: string;
      path: string;
      dirSegments: string[];
      file: File;
    }> = [];

    await this.walk(dir, [], entries, rawImages);

    // `assigned` aus den `image`-Referenzen aller (nicht archivierten) JSONs ableiten.
    const referenced = new Set<string>();
    for (const e of entries) {
      if (!e.wine) continue;
      const ref = e.wine[IMAGE_FIELD];
      if (typeof ref === 'string' && ref.trim() !== '') referenced.add(ref.trim());
    }

    const images: ImageEntry[] = [];
    for (const img of rawImages) {
      const { date, source } = await this.resolveImageDate(img.file);
      images.push({
        name: img.name,
        path: img.path,
        dirSegments: img.dirSegments,
        date,
        dateSource: source,
        assigned: referenced.has(img.name),
      });
    }

    return { entries, images };
  }

  /**
   * Listet die Mediendateien eines Typs (`audio`/`video`) im freigegebenen Ordner für
   * den jeweiligen Picker (Req 17.19). Der Unterordner `_archive` wird übersprungen
   * (Req 17.49). Die Rückgabe ist nach Pfad sortiert.
   */
  async listMedia(kind: MediaKind): Promise<MediaEntry[]> {
    const dir = this.requireDirectory();
    const out: MediaEntry[] = [];
    await this.walkMedia(dir, [], kind, out);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async walkMedia(
    dir: FsaDirectoryHandle,
    segments: string[],
    kind: MediaKind,
    out: MediaEntry[],
  ): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') {
        if (segments.length === 0 && name === ARCHIVE_DIR) continue;
        await this.walkMedia(handle, [...segments, name], kind, out);
      } else if (isMediaName(name, kind)) {
        out.push({ name, path: [...segments, name].join('/'), dirSegments: segments });
      }
    }
  }

  private async walk(
    dir: FsaDirectoryHandle,
    segments: string[],
    entries: WineEntry[],
    images: Array<{ name: string; path: string; dirSegments: string[]; file: File }>,
  ): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') {
        // `_archive` nur auf oberster Ebene als Archiv werten.
        if (segments.length === 0 && name === ARCHIVE_DIR) continue;
        await this.walk(handle, [...segments, name], entries, images);
      } else {
        const path = [...segments, name].join('/');
        if (name.toLowerCase().endsWith('.json')) {
          entries.push(await this.readWineEntry(handle, name, path, segments));
        } else if (isImageName(name)) {
          images.push({ name, path, dirSegments: segments, file: await handle.getFile() });
        }
      }
    }
  }

  private async readWineEntry(
    handle: FsaFileHandle,
    name: string,
    path: string,
    segments: string[],
  ): Promise<WineEntry> {
    const file = await handle.getFile();
    const text = await file.text();
    let wine: Wine | null = null;
    let broken = false;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        wine = parsed as Wine;
      } else {
        broken = true;
      }
    } catch {
      broken = true;
    }
    return { name, path, dirSegments: segments, wine, broken, lastModified: file.lastModified };
  }

  private async resolveImageDate(
    file: File,
  ): Promise<{ date: number; source: 'exif' | 'lastModified' }> {
    if (file.name.toLowerCase().match(/\.jpe?g$/)) {
      try {
        const buf = await file.arrayBuffer();
        const iso = readExifDateTimeOriginal(buf);
        if (iso) {
          const ts = Date.parse(iso);
          if (!Number.isNaN(ts)) return { date: ts, source: 'exif' };
        }
      } catch {
        // best-effort: Fallback auf lastModified
      }
    }
    return { date: file.lastModified, source: 'lastModified' };
  }

  // ── Datei-Operationen ─────────────────────────────────────────────────────────

  /** Löst einen relativen Pfad (`sub/file.json`) zum Datei-Handle auf. */
  private async resolveFileHandle(
    path: string,
    create = false,
  ): Promise<{ parent: FsaDirectoryHandle; name: string; handle: FsaFileHandle }> {
    const dir = this.requireDirectory();
    const parts = path.split('/').filter((p) => p.length > 0);
    const name = parts.pop();
    if (!name) throw new Error(`Ungültiger Pfad: ${path}`);
    let current = dir;
    for (const seg of parts) {
      current = await current.getDirectoryHandle(seg, { create });
    }
    const handle = await current.getFileHandle(name, { create });
    return { parent: current, name, handle };
  }

  /** Liest und parst eine JSON-Datei; merkt sich `File.lastModified`. */
  async readJson(path: string): Promise<{ wine: Wine; lastModified: number }> {
    const { handle } = await this.resolveFileHandle(path);
    const file = await handle.getFile();
    const wine = JSON.parse(await file.text()) as Wine;
    return { wine, lastModified: file.lastModified };
  }

  /**
   * Schreibt ein Wine-Objekt als JSON (2-Space-Indent) in eine bestehende Datei.
   *
   * @param expectedLastModified wenn gesetzt, wird vor dem Schreiben `File.lastModified`
   *        erneut gelesen; weicht er ab, wird ein {@link ConflictError} geworfen und
   *        **nicht** überschrieben (Req 17.25).
   */
  async writeJson(path: string, wine: Wine, expectedLastModified?: number): Promise<number> {
    const { handle } = await this.resolveFileHandle(path);
    if (expectedLastModified !== undefined) {
      const current = await handle.getFile();
      if (current.lastModified !== expectedLastModified) {
        throw new ConflictError(expectedLastModified, current.lastModified);
      }
    }
    await this.writeFile(handle, JSON.stringify(wine, null, 2));
    const after = await handle.getFile();
    return after.lastModified;
  }

  /** Legt eine neue JSON-Datei an (Req 17.36/17.37). */
  async createJson(path: string, wine: Wine): Promise<number> {
    const { handle } = await this.resolveFileHandle(path, true);
    await this.writeFile(handle, JSON.stringify(wine, null, 2));
    const file = await handle.getFile();
    return file.lastModified;
  }

  private async writeFile(handle: FsaFileHandle, data: string): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  /**
   * Verschiebt eine Datei an einen neuen Pfad (z. B. nach `_archive` oder in einen
   * anderen Unterordner). Da die File System Access API kein natives `move` bietet,
   * geschieht dies per copy + delete (Req 17.41/17.46/17.47).
   *
   * @param destDirSegments Zielverzeichnis als Segmente relativ zum Wurzelordner
   *        (leeres Array = Wurzelordner). Das Verzeichnis wird bei Bedarf angelegt.
   * @returns neuer relativer Pfad der verschobenen Datei.
   */
  async moveFile(sourcePath: string, destDirSegments: string[]): Promise<string> {
    const dir = this.requireDirectory();
    const {
      parent: sourceParent,
      name,
      handle: sourceHandle,
    } = await this.resolveFileHandle(sourcePath);

    const sourceFile = await sourceHandle.getFile();
    const data = await sourceFile.arrayBuffer();

    let destDir = dir;
    for (const seg of destDirSegments) {
      destDir = await destDir.getDirectoryHandle(seg, { create: true });
    }
    const destHandle = await destDir.getFileHandle(name, { create: true });
    const writable = await destHandle.createWritable();
    await writable.write(new Uint8Array(data));
    await writable.close();

    await sourceParent.removeEntry(name);
    return [...destDirSegments, name].join('/');
  }

  /** Verschiebt eine Datei in den `_archive`-Ordner (Req 17.46/17.47). */
  async archiveFile(sourcePath: string): Promise<string> {
    return this.moveFile(sourcePath, [ARCHIVE_DIR]);
  }

  // ── Clientseitige Thumbnails ───────────────────────────────────────────────────

  /**
   * Liest die Original-Bilddatei über das freigegebene Handle und erzeugt ein
   * verkleinertes Vorschaubild (Req 17.33). Das Original wird nicht verändert
   * (reines Lesen via `getFile()`); das Seitenverhältnis bleibt erhalten.
   */
  async createThumbnail(path: string, maxSize = 256): Promise<Thumbnail> {
    const key = `${path}@${maxSize}`;

    // 1. Cache-Treffer: fertiges Thumbnail direkt zurückgeben (als MRU neu einsortieren).
    //    Das Originalbild wird nicht erneut gelesen/dekodiert — das behebt das langsame
    //    Nachladen beim Scrollen durch Liste und Dialog.
    const cached = this.thumbnailCache.get(key);
    if (cached) {
      this.thumbnailCache.delete(key);
      this.thumbnailCache.set(key, cached);
      return cached;
    }

    // 2. Bereits laufende Erzeugung für denselben Schlüssel wiederverwenden
    //    (Dedup): Liste und Dialog fordern dasselbe Bild oft gleichzeitig an.
    const inflight = this.thumbnailInflight.get(key);
    if (inflight) return inflight;

    // 3. Neu erzeugen — gedrosselt (Gleichzeitigkeit begrenzt), damit nicht hunderte
    //    Vollbilder parallel dekodiert werden und den Renderer-Prozess sprengen
    //    (Chrome-Crash "Fehlercode: 5").
    const task = this.runThrottled(async () => {
      const { handle } = await this.resolveFileHandle(path);
      const file = await handle.getFile();
      return this.thumbnailRenderer.render(file, maxSize);
    })
      .then((thumb) => {
        this.cacheThumbnail(key, thumb);
        return thumb;
      })
      .finally(() => {
        this.thumbnailInflight.delete(key);
      });

    this.thumbnailInflight.set(key, task);
    return task;
  }

  /**
   * In-Memory-Cache der erzeugten Thumbnails (Schlüssel: `path@maxSize`). Eine
   * `Map` bewahrt die Einfügereihenfolge, sodass sich eine einfache LRU-Strategie
   * umsetzen lässt: Bei Überschreiten von {@link THUMBNAIL_CACHE_MAX} wird der
   * älteste Eintrag verworfen, damit der Speicher nicht unbegrenzt wächst.
   */
  private readonly thumbnailCache = new Map<string, Thumbnail>();
  private readonly thumbnailInflight = new Map<string, Promise<Thumbnail>>();

  private cacheThumbnail(key: string, thumb: Thumbnail): void {
    this.thumbnailCache.set(key, thumb);
    while (this.thumbnailCache.size > THUMBNAIL_CACHE_MAX) {
      const oldest = this.thumbnailCache.keys().next().value;
      if (oldest === undefined) break;
      this.thumbnailCache.delete(oldest);
    }
  }

  /**
   * Leert den Thumbnail-Cache. Wird bei jedem erneuten Verzeichnis-Scan sowie beim
   * Freigeben/Wiederherstellen eines Ordners aufgerufen, damit nach Änderungen
   * (Bild zugewiesen/verschoben/archiviert) keine veralteten Vorschaubilder erscheinen.
   */
  private clearThumbnailCache(): void {
    this.thumbnailCache.clear();
  }

  /**
   * Einfacher Semaphor für die Thumbnail-Erzeugung: höchstens
   * {@link THUMBNAIL_CONCURRENCY} Aufrufe laufen gleichzeitig, der Rest wird
   * eingereiht. Das kappt den Speicher-Peak beim gleichzeitigen Dekodieren vieler
   * Originalbilder (Renderer-Crash-Schutz).
   */
  private thumbnailActive = 0;
  private readonly thumbnailQueue: (() => void)[] = [];

  private async runThrottled<T>(task: () => Promise<T>): Promise<T> {
    if (this.thumbnailActive >= THUMBNAIL_CONCURRENCY) {
      await new Promise<void>((resolve) => this.thumbnailQueue.push(resolve));
    }
    this.thumbnailActive++;
    try {
      return await task();
    } finally {
      this.thumbnailActive--;
      const next = this.thumbnailQueue.shift();
      if (next) next();
    }
  }

  /** Erzeugt ein Thumbnail direkt aus einem bereits gelesenen Blob/File. */
  async createThumbnailFromBlob(blob: Blob, maxSize = 256): Promise<Thumbnail> {
    return this.thumbnailRenderer.render(blob, maxSize);
  }

  // ── EXIF ────────────────────────────────────────────────────────────────────

  /**
   * Liest das EXIF-Aufnahmedatum (`DateTimeOriginal`) eines Bildes über das freigegebene
   * Handle (Req 17.36). Reines Lesen via `getFile()` — das Original bleibt unverändert.
   *
   * @returns ISO-`YYYY-MM-DD` oder `null`, wenn kein Aufnahmedatum ermittelbar ist.
   */
  async readImageExifDate(path: string): Promise<string | null> {
    const { handle } = await this.resolveFileHandle(path);
    const file = await handle.getFile();
    try {
      const buf = await file.arrayBuffer();
      return readExifDateTimeOriginal(buf);
    } catch {
      return null;
    }
  }

  /** Prüft (ohne Fehler zu werfen), ob eine Datei unter `path` existiert. */
  async fileExists(path: string): Promise<boolean> {
    try {
      await this.resolveFileHandle(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Entfernt eine Datei unter dem relativen Pfad (für Rollback der vorläufigen JSON). */
  async removeFile(path: string): Promise<void> {
    const { parent, name } = await this.resolveFileHandle(path);
    await parent.removeEntry(name);
  }
}

/** Prüft, ob ein Dateiname eine unterstützte Bild-Endung hat (Req 17.32). */
export function isImageName(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Prüft, ob ein Dateiname eine unterstützte Audio-/Video-Endung hat (Req 17.19). */
export function isMediaName(name: string, kind: MediaKind): boolean {
  const lower = name.toLowerCase();
  const exts = kind === 'audio' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;
  return exts.some((ext) => lower.endsWith(ext));
}
