import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EditorShellComponent } from './components/editor-shell/editor-shell';

/**
 * Root-Komponente der Editor-App (`projects/editor`). Rendert die Editor-Shell mit
 * Zwei-Spalten-Layout, Eintragsliste und (Platzhalter-)WineEditor (Task 27.1).
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorShellComponent],
  template: `<app-editor-shell />`,
})
export class App {}
