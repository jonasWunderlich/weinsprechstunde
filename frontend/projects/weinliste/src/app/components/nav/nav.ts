import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FilterService } from '@weinsprechstunde/shared';

/** NavBar: App-Name + Logo-Platzhalter. Navigation vorerst ohne Menüpunkte. */
@Component({
  selector: 'app-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav.html',
  styleUrl: './nav.scss',
  imports: [RouterLink],
})
export class NavComponent {
  private readonly router = inject(Router);
  private readonly filterService = inject(FilterService);
  menuHidden = true;

  navigateTo(path: string): void {
    this.filterService.clearAllFilters();
    this.menuHidden = true;
    this.router.navigate([path]);
  }


}
