import { Injectable } from '@angular/core';
import { DirectoryHandleStore } from './file-system-access.service';
import { FsaDirectoryHandle } from './fsa-types';

const DB_NAME = 'weinsprechstunde-editor';
const STORE_NAME = 'handles';
const KEY = 'import_dir';

/**
 * Default-Persistenz des Ordner-Handles über IndexedDB (Req 17.2/17.3).
 *
 * `FileSystemDirectoryHandle` ist strukturiert klonbar und kann daher direkt in
 * IndexedDB abgelegt werden. In Tests wird diese Implementierung durch einen
 * In-Memory-Fake ersetzt (siehe {@link DirectoryHandleStore}-Token), sodass kein
 * echtes IndexedDB benötigt wird.
 */
@Injectable()
export class IndexedDbHandleStore extends DirectoryHandleStore {
  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return this.openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
          const req = run(store);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  override async save(handle: FsaDirectoryHandle): Promise<void> {
    await this.tx('readwrite', (store) => store.put(handle, KEY));
  }

  override async load(): Promise<FsaDirectoryHandle | null> {
    const result = await this.tx<unknown>(
      'readonly',
      (store) => store.get(KEY) as IDBRequest<unknown>,
    );
    return (result as FsaDirectoryHandle | undefined) ?? null;
  }

  override async clear(): Promise<void> {
    await this.tx('readwrite', (store) => store.delete(KEY));
  }
}
