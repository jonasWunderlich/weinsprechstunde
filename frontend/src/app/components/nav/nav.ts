import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FilterService } from '../../services/filter.service';
import { slugify } from '../../models/wine-util';

/** NavBar: App-Name + Logo-Platzhalter, Dropdowns Regionen/Rebsorten mit Count. */
@Component({
  selector: 'app-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav.html',
  styleUrl: './nav.scss',
})
export class NavComponent {
  private readonly router = inject(Router);
  private readonly filterService = inject(FilterService);

  readonly regionsOpen = signal(false);
  readonly grapesOpen = signal(false);
  readonly regions = this.filterService.availableRegions;
  readonly grapes = this.filterService.availableGrapes;

  toggleRegions(): void {
    this.grapesOpen.set(false);
    this.regionsOpen.update((v) => !v);
  }
  toggleGrapes(): void {
    this.regionsOpen.set(false);
    this.grapesOpen.update((v) => !v);
  }

  navigateToRegion(value: string): void {
    this.router.navigate(['/region', slugify(value)]);
    this.regionsOpen.set(false);
  }
  navigateToGrape(value: string): void {
    this.router.navigate(['/rebsorte', slugify(value)]);
    this.grapesOpen.set(false);
  }

  goHome(): void {
    this.filterService.clearAllFilters();
    this.router.navigate(['/']);
  }
}
