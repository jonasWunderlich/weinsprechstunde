import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Wine } from '../../../models/wine.model';
import { isPresent } from '../../../models/wine-util';
import { RatingCircleComponent } from '../../rating-circle/rating-circle';
import { WineTileCoverComponent } from '../../wine-tile/wine-tile-cover/wine-tile-cover';

@Component({
  selector: 'app-wine-list-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RatingCircleComponent, WineTileCoverComponent],
  templateUrl: './wine-list-item.html',
  styleUrl: './wine-list-item.scss',
})
export class WineListItemComponent {
  readonly wine = input.required<Wine>();
  readonly openDetail = output<Wine>();
  readonly isPresent = isPresent;

  open(): void {
    this.openDetail.emit(this.wine());
  }
}
