import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Wine } from '../../../models/wine.model';
import { grapeList, isPresent } from '../../../models/wine-util';
import { RatingCircleComponent } from '../../rating-circle/rating-circle';

/**
 * FESTES Overlay-Template: genau rating/year/name/producer/grape/origin, je nur wenn
 * isPresent. Keine dynamische Generierung aus dem Schema.
 */
@Component({
  selector: 'app-wine-tile-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RatingCircleComponent],
  templateUrl: './wine-tile-overlay.html',
  styleUrl: './wine-tile-overlay.scss',
})
export class WineTileOverlayComponent {
  readonly wine = input.required<Wine>();
  readonly isPresent = isPresent;
  readonly grapeList = grapeList;
}
