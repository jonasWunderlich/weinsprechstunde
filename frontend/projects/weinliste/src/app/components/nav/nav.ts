import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FilterService } from '@weinsprechstunde/shared';

/** NavBar: App-Name + Logo-Platzhalter. Navigation vorerst ohne Menüpunkte. */
@Component({
  selector: 'app-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav.html',
  styleUrl: './nav.scss',
})
export class NavComponent {
  private readonly router = inject(Router);
  private readonly filterService = inject(FilterService);

  goHome(): void {
    this.filterService.clearAllFilters();
    this.router.navigate(['/']);
  }
}
