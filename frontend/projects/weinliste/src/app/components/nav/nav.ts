import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FilterService } from '@weinsprechstunde/shared';

/** NavBar: App-Name + Logo-Platzhalter. Navigation vorerst ohne Menüpunkte. */
@Component({
  selector: 'app-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav.html',
  styleUrl: './nav.scss',
})
export class NavComponent {
  private readonly router = inject(Router);
  private readonly filterService = inject(FilterService);
  showMenuDialog = signal(false);

  navigateTo(path: string): void {
    this.filterService.clearAllFilters();
    this.showMenuDialog.set(false);
    this.router.navigate([path]);
  }
}
