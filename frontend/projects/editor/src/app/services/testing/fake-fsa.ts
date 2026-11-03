import {
  FsaDirectoryHandle,
  FsaFileHandle,
  FsaPermissionDescriptor,
  FsaPermissionState,
  FsaWritableStream,
} from '../fsa-types';

/**
 * Einfache In-Memory-Fakes der File System Access API für die Tests (vitest + jsdom),
 * in denen die echte API nicht verfügbar ist. Sie bilden Verzeichnisse/Dateien als
 * Objektbaum ab und implementieren genau die Teilmenge aus {@link fsa-types}.
 */

/**
 * Minimaler `File`-Ersatz, der nur die vom Service genutzten Member abbildet
 * (`name`, `lastModified`, `text()`, `arrayBuffer()`). Er wird beim Herausgeben als
 * `File` typisiert — eine vollständige `File`-Implementierung ist für die Tests nicht
 * nötig.
 */
export class FakeFile {
  readonly lastModified: number;
  readonly name: string;
  private data: Uint8Array;

  constructor(name: string, content: string | Uint8Array, lastModified = 0) {
    this.name = name;
    this.lastModified = lastModified;
    this.data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  }

  get size(): number {
    return this.data.byteLength;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.slice().buffer as ArrayBuffer;
  }
}

export class FakeFileHandle implements FsaFileHandle {
  readonly kind = 'file' as const;
  file: FakeFile;

  constructor(
    public readonly name: string,
    content: string | Uint8Array = '',
    lastModified = 0,
  ) {
    this.file = new FakeFile(name, content, lastModified);
  }

  async getFile(): Promise<File> {
    return this.file as unknown as File;
  }

  async createWritable(): Promise<FsaWritableStream> {
    const self = this;
    const chunks: Uint8Array[] = [];
    return {
      async write(data: string | BufferSource | Blob): Promise<void> {
        if (typeof data === 'string') {
          chunks.push(new TextEncoder().encode(data));
        } else if (data instanceof Uint8Array) {
          chunks.push(data);
        } else if (data instanceof ArrayBuffer) {
          chunks.push(new Uint8Array(data));
        } else if (ArrayBuffer.isView(data)) {
          chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        } else {
          const buf = await (data as Blob).arrayBuffer();
          chunks.push(new Uint8Array(buf));
        }
      },
      async close(): Promise<void> {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.byteLength;
        }
        // Neues File mit monoton wachsendem lastModified, damit writeJson einen
        // neuen Zeitstempel zurückgibt (simuliert reale Schreibzeit).
        self.file = new FakeFile(self.name, merged, self.file.lastModified + 1);
      },
    };
  }
}

type Entry = FakeFileHandle | FakeDirectoryHandle;

export class FakeDirectoryHandle implements FsaDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, Entry>();
  permission: FsaPermissionState = 'granted';
  requestedPermission: FsaPermissionState = 'granted';

  constructor(public readonly name: string) {}

  async queryPermission(_d?: FsaPermissionDescriptor): Promise<FsaPermissionState> {
    return this.permission;
  }

  async requestPermission(_d?: FsaPermissionDescriptor): Promise<FsaPermissionState> {
    this.permission = this.requestedPermission;
    return this.requestedPermission;
  }

  async *entries(): AsyncIterableIterator<[string, Entry]> {
    for (const [name, handle] of this.children) yield [name, handle];
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FsaFileHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw new Error(`${name} ist ein Verzeichnis.`);
      return existing;
    }
    if (!options?.create) throw new NotFoundError(name);
    const handle = new FakeFileHandle(name);
    this.children.set(name, handle);
    return handle;
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FsaDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw new Error(`${name} ist eine Datei.`);
      return existing;
    }
    if (!options?.create) throw new NotFoundError(name);
    const handle = new FakeDirectoryHandle(name);
    this.children.set(name, handle);
    return handle;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.has(name)) throw new NotFoundError(name);
    this.children.delete(name);
  }

  // ── Test-Komfort ──────────────────────────────────────────────────────────────

  addFile(name: string, content: string | Uint8Array = '', lastModified = 0): FakeFileHandle {
    const handle = new FakeFileHandle(name, content, lastModified);
    this.children.set(name, handle);
    return handle;
  }

  addDir(name: string): FakeDirectoryHandle {
    const handle = new FakeDirectoryHandle(name);
    this.children.set(name, handle);
    return handle;
  }

  /** Flacher Snapshot der enthaltenen Dateinamen (rekursiv, Pfad-join). */
  listPaths(prefix = ''): string[] {
    const out: string[] = [];
    for (const [name, handle] of this.children) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file') out.push(path);
      else out.push(...handle.listPaths(path));
    }
    return out.sort();
  }
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
  constructor(entry: string) {
    super(`Eintrag nicht gefunden: ${entry}`);
  }
}
