import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { WineDataService } from '../../services/wine-data.service';
import { FilterService } from '../../services/filter.service';
import { FilterFieldComponent, FilterDescriptor } from './filter-field/filter-field';
import { SortButtonComponent } from '../sort-button/sort-button';

/**
 * Steuerzeile: Freitextsuche (immer sichtbar) + über „Mehr Filter" einzeln
 * zuschaltbare, optionale Filter. Jede Range-Grenze ist ein eigener Filter.
 */
@Component({
  selector: 'app-controls-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilterFieldComponent, SortButtonComponent],
  templateUrl: './controls-row.html',
  styleUrl: './controls-row.scss',
})
export class ControlsRowComponent {
  private readonly data = inject(WineDataService);
  readonly fs = inject(FilterService);

  // Der einzige fest sichtbare Filter: die Freitextsuche.
  readonly searchDescriptor: FilterDescriptor = {
    key: 'search',
    label: 'Filter',
    kind: 'text-search',
  };

  /**
   * Katalog aller optional zuschaltbaren Filter. Reihenfolge = Anzeigereihenfolge
   * im „Mehr Filter"-Menü. Range-Grenzen sind bewusst einzeln aufgeführt.
   */
  readonly OPTIONAL_DESCRIPTORS: FilterDescriptor[] = [
    { key: 'grape', label: 'Rebsorte', kind: 'multi-select', field: 'grape' },
    { key: 'origin', label: 'Region', kind: 'multi-select', field: 'origin' },
    { key: 'country', label: 'Land', kind: 'dropdown', field: 'country' },
    { key: 'type', label: 'Typ', kind: 'dropdown', field: 'type' },
    { key: 'producer', label: 'Weingut', kind: 'dropdown', field: 'producer' },
    { key: 'quality', label: 'Qualität', kind: 'dropdown', field: 'quality' },
    { key: 'ratingFrom', label: 'Bewertung ab', kind: 'rating-bound', bound: 'from' },
    { key: 'ratingTo', label: 'Bewertung bis', kind: 'rating-bound', bound: 'to' },
    { key: 'tastingDateFrom', label: 'Verkostung ab', kind: 'date-bound', bound: 'from' },
    { key: 'tastingDateTo', label: 'Verkostung bis', kind: 'date-bound', bound: 'to' },
    { key: 'yearFrom', label: 'Jahrgang ab', kind: 'year-bound', bound: 'from' },
    { key: 'yearTo', label: 'Jahrgang bis', kind: 'year-bound', bound: 'to' },
  ];

  // Nur Deskriptoren, deren Schemafeld tatsächlich existiert bzw. die schemafrei sind.
  readonly availableDescriptors = computed(() => {
    const known = new Set(this.data.schema().map((s) => s.field));
    return this.OPTIONAL_DESCRIPTORS.filter((d) => !d.field || known.has(d.field));
  });

  // Aktuell eingeblendete Zusatzfilter in Katalog-Reihenfolge.
  readonly visibleDescriptors = computed(() => {
    const on = new Set(this.fs.visibleFilterFields());
    return this.availableDescriptors().filter((d) => on.has(d.key));
  });

  readonly moreFiltersOpen = signal(false);

  toggleMoreFiltersMenu(): void {
    this.moreFiltersOpen.update((v) => !v);
  }

  isFieldVisible(key: string): boolean {
    return this.fs.visibleFilterFields().includes(key);
  }

  toggleMoreFilter(key: string, on: boolean): void {
    this.fs.toggleFilterField(key, on);
  }

  /** Entfernen über das Icon am Filter: blendet aus und setzt den Wert zurück. */
  removeFilter(key: string): void {
    this.fs.toggleFilterField(key, false);
  }

  toggleInfo(): void {
    this.fs.infoToggleActive.update((v) => !v);
  }

  toggleList(): void {
    this.fs.setViewMode(this.fs.viewMode() === 'grid' ? 'list' : 'grid');
  }

  trackDescriptor(_: number, d: FilterDescriptor): string {
    return d.key;
  }
}
