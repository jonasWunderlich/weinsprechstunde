import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Wiederverwendbarer Rating-Kreis (Overlay + Dialog). Eine Nachkommastelle. */
@Component({
  selector: 'app-rating-circle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="rating-circle">{{ display() }}</span>`,
  styleUrl: './rating-circle.scss',
})
export class RatingCircleComponent {
  readonly value = input.required<number>();
  readonly display = computed(() => this.value().toFixed(1));
}
