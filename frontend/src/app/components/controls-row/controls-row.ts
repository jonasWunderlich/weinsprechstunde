import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { WineSchemaField } from '../../models/wine-schema.model';
import { WineDataService } from '../../services/wine-data.service';
import { FilterService } from '../../services/filter.service';
import { FilterFieldComponent } from './filter-field/filter-field';
import { SortButtonComponent } from '../sort-button/sort-button';

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

  readonly STANDARD_FIELDS = ['name', 'grape', 'rating', 'tasting_date'];

  readonly filterableFields = computed(() =>
    this.data.schema().filter((f) => f.filter_type !== null),
  );

  // Standard-Filter (fest, immer sichtbar), in Schema-Reihenfolge
  readonly standardFields = computed(() =>
    this.filterableFields().filter((f) => this.STANDARD_FIELDS.includes(f.field)),
  );

  // in ControlsRow gerenderte Zusatzfelder: eingeblendet, in Schema-Reihenfolge
  readonly extraFields = computed(() => {
    const extra = new Set(this.fs.visibleFilterFields());
    return this.filterableFields().filter(
      (f) => !this.STANDARD_FIELDS.includes(f.field) && extra.has(f.field),
    );
  });

  // über „Mehr Filter" zuschaltbare Kandidaten (alle filterbaren Nicht-Standard-Felder)
  readonly toggleableFields = computed(() =>
    this.filterableFields().filter((f) => !this.STANDARD_FIELDS.includes(f.field)),
  );

  readonly moreFiltersOpen = signal(false);

  toggleMoreFiltersMenu(): void {
    this.moreFiltersOpen.update((v) => !v);
  }

  isFieldVisible(field: string): boolean {
    return this.fs.visibleFilterFields().includes(field);
  }

  toggleMoreFilter(field: string, on: boolean): void {
    this.fs.toggleFilterField(field, on);
  }

  toggleInfo(): void {
    this.fs.infoToggleActive.update((v) => !v);
  }

  toggleList(): void {
    this.fs.setViewMode(this.fs.viewMode() === 'grid' ? 'list' : 'grid');
  }

  trackField(_: number, f: WineSchemaField): string {
    return f.field;
  }
}
