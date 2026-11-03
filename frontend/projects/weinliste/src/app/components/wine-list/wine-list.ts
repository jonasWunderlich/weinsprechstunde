import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { FilterService, Wine } from '@weinsprechstunde/shared';
import { DialogService } from '../../services/dialog.service';
import { WineListItemComponent } from './wine-list-item/wine-list-item';

@Component({
  selector: 'app-wine-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WineListItemComponent],
  templateUrl: './wine-list.html',
  styleUrl: './wine-list.scss',
})
export class WineListComponent {
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
