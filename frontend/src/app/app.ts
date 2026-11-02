import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WineDataService } from './services/wine-data.service';
import { DialogService } from './services/dialog.service';
import { FilterService } from './services/filter.service';
import { NavComponent } from './components/nav/nav';
import { WineDetailDialogComponent } from './components/wine-detail-dialog/wine-detail-dialog';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavComponent, RouterOutlet, WineDetailDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class App implements OnInit {
  readonly dataService = inject(WineDataService);
  readonly dialog = inject(DialogService);
  private readonly fs = inject(FilterService);

  ngOnInit(): void {
    this.dataService.loadAll();
  }

  /**
   * Globale Tastaturkürzel:
   *   i → Info-Overlay auf allen Kacheln umschalten
   *   l → zwischen Kachel- und Listenansicht wechseln
   * Ignoriert Eingaben in Formularfeldern, bei offenem Dialog sowie
   * Modifier-Kombinationen (z. B. Cmd+L für die Adresszeile).
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.dialog.wine() !== null) return;
    if (this.isEditableTarget(event.target)) return;

    switch (event.key.toLowerCase()) {
      case 'i':
        this.fs.infoToggleActive.update((v) => !v);
        event.preventDefault();
        break;
      case 'l':
        this.fs.setViewMode(this.fs.viewMode() === 'grid' ? 'list' : 'grid');
        event.preventDefault();
        break;
    }
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.isContentEditable === true
    );
  }
}
