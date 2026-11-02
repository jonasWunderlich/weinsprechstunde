import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { combineLatest } from 'rxjs';
import { FilterService } from '../../services/filter.service';
import { ControlsRowComponent } from '../controls-row/controls-row';
import { WineGridComponent } from '../wine-grid/wine-grid';
import { WineListComponent } from '../wine-list/wine-list';
import { ScrollTopButtonComponent } from '../scroll-top-button/scroll-top-button';

/** Container: überträgt Route-Parameter in den FilterService, lädt KEINE Daten. */
@Component({
  selector: 'app-wine-wall',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ControlsRowComponent, WineGridComponent, WineListComponent, ScrollTopButtonComponent],
  templateUrl: './wine-wall.html',
})
export class WineWallComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly filterService = inject(FilterService);

  constructor() {
    combineLatest([this.route.params, this.route.data])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, data]) => {
        const slug = params['slug'];
        const navType = data['navType'] as 'region' | 'rebsorte' | undefined;
        if (!slug || !navType) {
          this.filterService.clearNavigationFilter();
          return;
        }
        this.filterService.setNavigationFilter(navType, slug);
      });
  }
}
