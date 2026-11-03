/**
 * Schmale Typdefinitionen für die File System Access API.
 *
 * Die vollständigen Lib-DOM-Typen für die File System Access API (insbesondere
 * `showDirectoryPicker`, `queryPermission`/`requestPermission` und `move`) sind in
 * der TypeScript-Standardbibliothek noch nicht stabil/vollständig vorhanden. Wir
 * definieren hier daher genau die Teilmenge, die der {@link FileSystemAccessService}
 * tatsächlich benötigt. Das hält den Service typsicher und — wichtiger — leicht
 * mit einfachen Fake-Handles in Tests (vitest + jsdom) nachbaubar, da die echte
 * Browser-API dort nicht verfügbar ist.
 */

export type FsaPermissionState = 'granted' | 'denied' | 'prompt';

export interface FsaPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

/** Gemeinsame Basis von Datei- und Verzeichnis-Handle. */
export interface FsaHandle {
  readonly kind: 'file' | 'directory';
  readonly name: string;
  queryPermission?(descriptor?: FsaPermissionDescriptor): Promise<FsaPermissionState>;
  requestPermission?(descriptor?: FsaPermissionDescriptor): Promise<FsaPermissionState>;
}

/** Writable-Stream zum Schreiben einer Datei (Teilmenge). */
export interface FsaWritableStream {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FsaFileHandle extends FsaHandle {
  readonly kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsaWritableStream>;
}

export interface FsaDirectoryHandle extends FsaHandle {
  readonly kind: 'directory';
  /** Async-Iterator über [name, handle]-Paare der Einträge. */
  entries(): AsyncIterableIterator<[string, FsaFileHandle | FsaDirectoryHandle]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsaFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsaDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** Signatur von `window.showDirectoryPicker`. */
export type ShowDirectoryPickerFn = (options?: {
  mode?: 'read' | 'readwrite';
}) => Promise<FsaDirectoryHandle>;
