import { ChangeDetectionStrategy, Component, computed, effect, input, output } from '@angular/core';
import {
  formatPrice,
  grapeList,
  humanizeKey,
  isPresent,
  mediaSrc,
  Wine,
} from '@weinsprechstunde/shared';
import { RatingCircleComponent } from '../rating-circle/rating-circle';

@Component({
  selector: 'app-wine-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RatingCircleComponent],
  templateUrl: './wine-detail-dialog.html',
  styleUrl: './wine-detail-dialog.scss',
})
export class WineDetailDialogComponent {
  readonly wine = input<Wine | null>(null);
  readonly close = output<void>();

  private static readonly KNOWN = new Set([
    'name',
    'producer',
    'year',
    'rating',
    'country',
    'origin',
    'grape',
    'type',
    'quality',
    'tasting_date',
    'description',
    'price',
    'image',
    'audio',
    'video',
  ]);

  readonly extraEntries = computed(() => {
    const w = this.wine();
    if (!w) return [];
    return Object.entries(w)
      .filter(([k, v]) => !WineDetailDialogComponent.KNOWN.has(k) && isPresent(v))
      .map(([key, value]) => ({ key, label: humanizeKey(key), value: String(value) }));
  });

  readonly isPresent = isPresent;
  readonly grapeList = grapeList;
  readonly mediaSrc = mediaSrc;
  readonly formatPrice = formatPrice;

  readonly hasOrigin = computed(() => {
    const w = this.wine();
    return !!w && (isPresent(w.country) || isPresent(w.origin));
  });
  readonly hasProfile = computed(() => {
    const w = this.wine();
    return !!w && (grapeList(w).length > 0 || isPresent(w.type) || isPresent(w.quality));
  });
  readonly hasTasting = computed(() => {
    const w = this.wine();
    return !!w && (isPresent(w.tasting_date) || isPresent(w.description));
  });
  readonly qualityList = computed(() => {
    const w = this.wine();
    if (!w) return [];
    return Array.isArray(w.quality) ? w.quality : isPresent(w.quality) ? [String(w.quality)] : [];
  });
  readonly hasMedia = computed(() => {
    const w = this.wine();
    return (
      !!w && (mediaSrc(w.image) !== null || mediaSrc(w.audio, 'audio') !== null || mediaSrc(w.video, 'video') !== null)
    );
  });

  constructor() {
    // Body-Scroll-Lock mit garantiertem Cleanup.
    effect((onCleanup) => {
      document.body.style.overflow = this.wine() ? 'hidden' : '';
      onCleanup(() => {
        document.body.style.overflow = '';
      });
    });
  }

  onBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('dialog-backdrop')) this.close.emit();
  }
  onClose(): void {
    this.close.emit();
  }
}
