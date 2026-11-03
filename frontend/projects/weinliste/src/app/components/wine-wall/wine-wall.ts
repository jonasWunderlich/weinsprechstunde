import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FilterService } from '@weinsprechstunde/shared';
import { ControlsRowComponent } from '../controls-row/controls-row';
import { WineGridComponent } from '../wine-grid/wine-grid';
import { WineListComponent } from '../wine-list/wine-list';
import { ScrollTopButtonComponent } from '../scroll-top-button/scroll-top-button';

/** Container der Hauptansicht. Lädt KEINE Daten; Filterzustand liegt im FilterService. */
@Component({
  selector: 'app-wine-wall',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ControlsRowComponent, WineGridComponent, WineListComponent, ScrollTopButtonComponent],
  templateUrl: './wine-wall.html',
})
export class WineWallComponent {
  readonly filterService = inject(FilterService);
}
