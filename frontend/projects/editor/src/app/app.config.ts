import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { WineDataSource } from '@weinsprechstunde/shared';
import { DirectoryHandleStore, ThumbnailRenderer } from './services/file-system-access.service';
import { IndexedDbHandleStore } from './services/indexeddb-handle-store';
import { CanvasThumbnailRenderer } from './services/canvas-thumbnail-renderer';
import { EditorWineDataService } from './services/editor-wine-data.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Default-Adapter für die Browser-APIs; in Tests durch Fakes überschrieben.
    { provide: DirectoryHandleStore, useClass: IndexedDbHandleStore },
    { provide: ThumbnailRenderer, useClass: CanvasThumbnailRenderer },
    // Der geteilte FilterService injiziert die WineDataSource-Abstraktion; im Editor
    // liefert sie der EditorWineDataService aus dem Verzeichnis-Scan (Req 17.11).
    { provide: WineDataSource, useExisting: EditorWineDataService },
  ],
};
