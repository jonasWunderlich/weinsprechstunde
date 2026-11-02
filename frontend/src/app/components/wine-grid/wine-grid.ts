import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { Wine } from '../../models/wine.model';
import { FilterService } from '../../services/filter.service';
import { DialogService } from '../../services/dialog.service';
import { WineTileComponent } from '../wine-tile/wine-tile';

@Component({
  selector: 'app-wine-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WineTileComponent],
  templateUrl: './wine-grid.html',
  styleUrl: './wine-grid.scss',
})
export class WineGridComponent {
  private readonly router = inject(Router);
  readonly fs = inject(FilterService);
  readonly dialog = inject(DialogService);

  // Alle Daten sind bereits vollständig geladen – keine Paginierung nötig.
  readonly visibleWines = this.fs.filteredWines;
  readonly showBackButton = this.fs.hasActiveFilter;
  readonly isEmpty = computed(() => this.visibleWines().length === 0);

  openDetail(w: Wine): void {
    this.dialog.open(w);
  }

  goBack(): void {
    this.fs.clearAllFilters();
    this.router.navigate(['/']);
  }
}
