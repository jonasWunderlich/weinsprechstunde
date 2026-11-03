import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { mediaSrc, Wine } from '@weinsprechstunde/shared';

/** Cover-Bild mit PlaceholderIcon-Fallback. Roher Dateiname nie direkt an [src]. */
@Component({
  selector: 'app-wine-tile-cover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wine-tile-cover.html',
  styleUrl: './wine-tile-cover.scss',
})
export class WineTileCoverComponent {
  readonly wine = input.required<Wine>();
  private readonly imageError = signal(false);

  readonly src = computed(() => mediaSrc(this.wine().image));
  readonly showPlaceholder = computed(() => this.src() === null || this.imageError());

  onError(): void {
    this.imageError.set(true);
  }
}
