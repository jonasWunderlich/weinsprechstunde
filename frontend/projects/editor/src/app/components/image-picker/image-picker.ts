import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { ImageEntry } from '../../services/file-system-access.service';
import { EntryThumbnailComponent } from '../entry-thumbnail/entry-thumbnail';
import {
  ImageSortDirection,
  selectPickerImages,
} from '../../models/image-picker';

/**
 * ImagePicker (Task 29.1, Req 17.28–17.35).
 *
 * Eine durchsuchbare Galerie der Bilddateien im `import_dir` mit clientseitigen
 * Thumbnails (über {@link EntryThumbnailComponent}, Req 17.33). Datengrundlage ist das
 * Bild-Listing (`name`/`date`/`assigned`) aus dem {@link FileSystemAccessService}, das
 * über den `images`-Input hereingereicht wird.
 *
 * Verhalten:
 * - **Standard „nur ungenutzt" (Req 17.28):** zeigt zunächst nur Bilder mit
 *   `assigned === false`.
 * - **Umschalt-Button (Req 17.29):** wechselt zwischen „nur ungenutzt" und „alle".
 * - **Datum-Sortierung (Req 17.30):** nach `date` auf-/absteigend.
 * - **Dateinamen-Filter (Req 17.31):** case-insensitiver Teilstring auf `name`.
 *
 * Bei Auswahl eines Bildes wird dessen **Dateiname ohne Pfad** über `pick` emittiert
 * (Req 17.34/17.35); die Übernahme in das `image`-Feld und die Persistenz über den
 * Auto-Save erledigt die aufrufende WineEditor-Komponente.
 */
@Component({
  selector: 'app-image-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.image-picker--large]': 'large()',
  },
  imports: [EntryThumbnailComponent],
  templateUrl: './image-picker.html',
  styleUrl: './image-picker.scss',
})
export class ImagePickerComponent {
  /** Vollständiges Bild-Listing aus dem Verzeichnis-Scan. */
  readonly images = input<ImageEntry[]>([]);
  /** Aktuell im `image`-Feld gesetzter Dateiname (zum Hervorheben der Auswahl). */
  readonly selected = input<string>('');
  /**
   * Große Kachel-Darstellung mit lesbaren Etiketten (für die Bildauswahl im Dialog).
   * Steuert nur das Layout; das Verhalten (Filter/Sortierung/Auswahl) bleibt gleich.
   */
  readonly large = input<boolean>(false);

  /** Emittiert den Dateinamen (ohne Pfad) des ausgewählten Bildes (Req 17.34/17.35). */
  readonly pick = output<string>();

  /** `false` = nur ungenutzte Bilder (Default, Req 17.28); `true` = alle (Req 17.29). */
  readonly showAll = signal(false);
  /** Dateinamen-Filter (Req 17.31). */
  readonly nameFilter = signal('');
  /** Datum-Sortierrichtung (Req 17.30); Default neueste zuerst. */
  readonly sort = signal<ImageSortDirection>('desc');

  /** Die nach Umschaltung, Filter und Sortierung anzuzeigenden Bilder. */
  readonly visibleImages = computed<ImageEntry[]>(() =>
    selectPickerImages(this.images(), {
      showAll: this.showAll(),
      nameFilter: this.nameFilter(),
      sort: this.sort(),
    }),
  );

  /** Umschalten zwischen „nur ungenutzt" und „alle" (Req 17.29). */
  toggleShowAll(): void {
    this.showAll.update((v) => !v);
  }

  /** Umschalten der Datum-Sortierrichtung (Req 17.30). */
  toggleSort(): void {
    this.sort.update((s) => (s === 'desc' ? 'asc' : 'desc'));
  }

  /** Setzt den Dateinamen-Filter (Req 17.31). */
  setFilter(value: string): void {
    this.nameFilter.set(value);
  }

  /** Auswahl eines Bildes: Dateiname (ohne Pfad) nach außen melden (Req 17.34/17.35). */
  select(image: ImageEntry): void {
    this.pick.emit(image.name);
  }
}
