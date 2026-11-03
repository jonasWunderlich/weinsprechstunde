import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FileSystemAccessService } from '../../services/file-system-access.service';
import { EditorStateService } from '../../services/editor-state.service';
import { EditorControlsComponent } from '../editor-controls/editor-controls';
import { EditorListComponent } from '../editor-list/editor-list';
import { WineEditorComponent } from '../wine-editor/wine-editor';

/**
 * Editor-Shell: Zwei-Spalten-Layout (Eintragsliste links, WineEditor rechts, Req 17.8)
 * ohne Login-Screen (Start ohne Anmeldung, Req 17.6).
 *
 * Enthält das Freigabe-Gate (File System Access API, Req 17.2–17.4) sowie den
 * manuellen Aktualisieren-Button (Req 17.7). Es findet kein Polling statt;
 * Auto-Refresh nach eigener Aktion liegt im {@link EditorStateService} (Req 17.6).
 */
@Component({
  selector: 'app-editor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorControlsComponent, EditorListComponent, WineEditorComponent],
  templateUrl: './editor-shell.html',
  styleUrl: './editor-shell.scss',
})
export class EditorShellComponent {
  readonly fsa = inject(FileSystemAccessService);
  readonly state = inject(EditorStateService);

  readonly restoring = signal(false);

  constructor() {
    // Beim Öffnen versuchen, den zuvor freigegebenen Ordner wiederherzustellen
    // (kurze Re-Autorisierung, Req 17.3) und die Liste zu laden.
    if (this.fsa.apiSupported) {
      this.restoring.set(true);
      void this.fsa
        .restoreDirectory()
        .then((handle) => {
          if (handle) return this.state.refresh();
          return undefined;
        })
        .finally(() => this.restoring.set(false));
    }
  }

  /** Fordert den Benutzer zur Ordner-Freigabe auf (Req 17.2) und lädt die Liste. */
  async grantAccess(): Promise<void> {
    await this.fsa.requestDirectory();
    await this.state.refresh();
  }

  /** Manueller Aktualisieren-Button: erneuter Verzeichnis-Scan (Req 17.7). */
  async refresh(): Promise<void> {
    await this.state.refresh();
  }
}
