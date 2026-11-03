import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FilterService } from '@weinsprechstunde/shared';
import { WineDataService } from './services/wine-data.service';
import { DialogService } from './services/dialog.service';
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
   *   → → nächsten Wein im WineDetailDialog anzeigen (bzw. Dialog mit erstem Wein öffnen)
   *   ← → vorherigen Wein im WineDetailDialog anzeigen (bzw. Dialog mit letztem Wein öffnen)
   *   Esc → geöffneten WineDetailDialog schließen
   * Ignoriert Eingaben in Formularfeldern sowie Modifier-Kombinationen
   * (z. B. Cmd+L für die Adresszeile). i/l bleiben bei offenem Dialog
   * deaktiviert; die Pfeiltasten funktionieren gerade dann.
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.isEditableTarget(event.target)) return;

    const dialogOpen = this.dialog.wine() !== null;

    switch (event.key) {
      case 'ArrowRight':
        if (this.navigateDialog(1)) event.preventDefault();
        return;
      case 'ArrowLeft':
        if (this.navigateDialog(-1)) event.preventDefault();
        return;
      case 'Escape':
        if (dialogOpen) {
          this.dialog.close();
          event.preventDefault();
        }
        return;
    }

    // i/l bleiben bei offenem Dialog deaktiviert.
    if (dialogOpen) return;

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

  /**
   * Navigiert im WineDetailDialog in der Reihenfolge von `filteredWines`.
   * `direction` ist +1 (nächster) oder -1 (vorheriger).
   * - Bei geschlossenem Dialog: öffnet den ersten (+1) bzw. letzten (-1) Wein.
   * - Bei offenem Dialog: springt zum Nachbar-Wein mit Modulo-Wrap.
   * - Leere Liste: passiert nichts.
   * Gibt true zurück, wenn eine Navigation stattgefunden hat.
   */
  private navigateDialog(direction: 1 | -1): boolean {
    const wines = this.fs.filteredWines();
    if (wines.length === 0) return false;

    const current = this.dialog.wine();
    if (current === null) {
      // Dialog geschlossen: ersten (→) bzw. letzten (←) Wein öffnen.
      this.dialog.open(direction === 1 ? wines[0] : wines[wines.length - 1]);
      return true;
    }

    const idx = wines.indexOf(current);
    // Aktueller Wein nicht mehr in der Liste (z. B. durch Filteränderung):
    // wie bei geschlossenem Dialog den Rand-Wein wählen.
    const baseIdx = idx === -1 ? (direction === 1 ? -1 : 0) : idx;
    const nextIdx = (baseIdx + direction + wines.length) % wines.length;
    this.dialog.open(wines[nextIdx]);
    return true;
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
