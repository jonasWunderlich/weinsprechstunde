import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { isPresent, Wine } from '@weinsprechstunde/shared';
import { WineTileCoverComponent } from './wine-tile-cover/wine-tile-cover';
import { WineTileOverlayComponent } from './wine-tile-overlay/wine-tile-overlay';

@Component({
  selector: 'app-wine-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WineTileCoverComponent, WineTileOverlayComponent],
  templateUrl: './wine-tile.html',
  styleUrl: './wine-tile.scss',
})
export class WineTileComponent {
  readonly wine = input.required<Wine>();
  readonly showInfos = input<boolean>(false); // = fs.infoToggleActive von außen gebunden
  readonly openDetail = output<Wine>();

  private readonly localOverlay = signal(false);
  readonly overlayVisible = computed(() => this.showInfos() || this.localOverlay());
  readonly hasMedia = computed(
    () => isPresent(this.wine().audio) || isPresent(this.wine().video),
  );

  private overlayWasVisibleOnEnter = false;

  onMouseEnter(): void {
    if (!this.showInfos()) this.localOverlay.set(true);
  }
  onMouseLeave(): void {
    if (!this.showInfos()) this.localOverlay.set(false);
  }

  onTileClick(): void {
    // Erstkontakt (Tap auf Mobil) zeigt Overlay; ist es bereits sichtbar, öffnet der Klick das Detail.
    if (this.overlayVisible()) {
      this.openDetail.emit(this.wine());
    } else if (!this.showInfos()) {
      this.localOverlay.set(true);
    }
  }

  onPlay(e: Event): void {
    e.stopPropagation();
    this.openDetail.emit(this.wine());
  }
}
