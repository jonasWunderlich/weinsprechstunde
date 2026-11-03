import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FileSystemAccessService } from '../../services/file-system-access.service';

/**
 * Lädt für einen Bildpfad clientseitig ein Thumbnail über den
 * {@link FileSystemAccessService} (Req 17.33) und zeigt es als Vorschau an. Die
 * Originaldatei wird dabei nicht verändert (reines Lesen). Fehlt der Pfad oder
 * schlägt das Rendern fehl, bleibt ein neutraler Platzhalter sichtbar.
 */
@Component({
  selector: 'app-entry-thumbnail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.entry-thumbnail--large]': 'large()',
  },
  template: `
    @if (url()) {
      <img class="entry-thumbnail__img" [src]="url()" [alt]="alt()" />
    } @else {
      <span class="entry-thumbnail__placeholder" aria-hidden="true">🍷</span>
    }
  `,
  styleUrl: './entry-thumbnail.scss',
})
export class EntryThumbnailComponent implements OnDestroy {
  private readonly fsa = inject(FileSystemAccessService);

  /** Relativer Pfad der Bilddatei im freigegebenen Ordner. */
  readonly path = input<string | null>(null);
  readonly alt = input<string>('');
  /**
   * Längere Kante des erzeugten Vorschaubilds in Pixeln. Default 256 (kleines
   * Listen-Thumbnail); für die große Vorschau im WineEditor deutlich höher setzen,
   * damit der gepflegte Wein erkennbar ist. Die Erzeugung bleibt über das
   * Concurrency-Limit des Service speicherbeschränkt.
   */
  readonly maxSize = input<number>(256);
  /**
   * Große Darstellung: zeigt das vollständige Bild (nicht beschnitten) in einem
   * größeren Rahmen. Für die Bildvorschau im WineEditor, damit der gepflegte Wein
   * erkennbar ist.
   */
  readonly large = input<boolean>(false);

  private readonly _url = signal<string | null>(null);
  readonly url = this._url.asReadonly();
  private objectUrl: string | null = null;

  constructor() {
    effect(() => {
      const path = this.path();
      const maxSize = this.maxSize();
      this.revoke();
      this._url.set(null);
      if (!path) return;
      void this.load(path, maxSize);
    });
  }

  private async load(path: string, maxSize: number): Promise<void> {
    try {
      const thumb = await this.fsa.createThumbnail(path, maxSize);
      // Falls sich Pfad oder Zielgröße während des asynchronen Ladens geändert haben,
      // das Ergebnis verwerfen.
      if (this.path() !== path || this.maxSize() !== maxSize) return;
      this.objectUrl = URL.createObjectURL(thumb.blob);
      this._url.set(this.objectUrl);
    } catch {
      // best-effort: Platzhalter bleibt sichtbar
    }
  }

  private revoke(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  ngOnDestroy(): void {
    this.revoke();
  }
}
