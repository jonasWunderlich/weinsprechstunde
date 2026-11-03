import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { isPresent } from '@weinsprechstunde/shared';
import { EditorStateService } from '../../services/editor-state.service';
import { EditorListItem } from '../../models/editor-list.model';
import { EntryThumbnailComponent } from '../entry-thumbnail/entry-thumbnail';

/**
 * Eintragsliste des Editors (linke Spalte, Req 17.8). Zeigt angelegte und unbekannte
 * Weine in der vom {@link EditorStateService} gelieferten Reihenfolge an, markiert
 * defekte (Req 17.26) und unvollständige (Req 17.20) Einträge und verdrahtet die
 * Auswahl zum rechts angezeigten WineEditor (Req 17.9).
 */
@Component({
  selector: 'app-editor-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntryThumbnailComponent],
  templateUrl: './editor-list.html',
  styleUrl: './editor-list.scss',
})
export class EditorListComponent {
  readonly state = inject(EditorStateService);

  isSelected(item: EditorListItem): boolean {
    return this.state.selectedId() === item.id;
  }

  select(item: EditorListItem): void {
    this.state.select(item);
  }

  /**
   * Klick auf das Bild eines unbekannten Weins: legt per File System Access API eine
   * vorläufige JSON an und öffnet den WineEditor für den neuen Eintrag (Req 17.36).
   * Für angelegte Weine wählt ein Klick auf das Bild schlicht den Eintrag aus.
   */
  onImageClick(item: EditorListItem, event: Event): void {
    if (item.kind === 'unknown') {
      event.stopPropagation();
      void this.state.createFromImage(item.image);
    }
  }

  /** Anzeigename eines Eintrags (Platzhalter für unbekannte/unvollständige). */
  title(item: EditorListItem): string {
    if (item.kind === 'unknown') return item.placeholder;
    if (item.broken) return item.entry.name;
    const name = item.wine?.name;
    return isPresent(name) ? String(name) : '(ohne Namen)';
  }

  /** Anzuzeigendes `tasting_date` (ISO) oder `null`. */
  date(item: EditorListItem): string | null {
    return item.sortDate;
  }

  /**
   * Relativer Pfad der Vorschaudatei. Für unbekannte Weine das Bild selbst; für
   * angelegte Weine das im `image`-Feld referenzierte Bild, das stets im selben
   * Verzeichnis wie die JSON-Quelldatei liegt (Req 17.35).
   */
  imagePath(item: EditorListItem): string | null {
    if (item.kind === 'unknown') return item.image.path;
    const img = item.wine?.image;
    if (!isPresent(img)) return null;
    const segments = item.entry.dirSegments;
    return [...segments, String(img)].join('/');
  }

  trackItem(_: number, item: EditorListItem): string {
    return item.id;
  }
}
