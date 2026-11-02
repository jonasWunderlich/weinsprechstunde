import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { WineSchemaField } from '../../../models/wine-schema.model';
import { distinctValuesForField } from '../../../models/wine-util';
import { WineDataService } from '../../../services/wine-data.service';
import { FilterService } from '../../../services/filter.service';

/** Schema-gesteuertes Filter-Widget: filter_type bestimmt die Darstellung. */
@Component({
  selector: 'app-filter-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filter-field.html',
  styleUrl: './filter-field.scss',
})
export class FilterFieldComponent {
  readonly field = input.required<WineSchemaField>();
  private readonly data = inject(WineDataService);
  readonly fs = inject(FilterService);

  readonly options = computed(() => distinctValuesForField(this.data.wines(), this.field().field));

  readonly selectedDropdown = computed(() => this.fs.filter().dropdowns[this.field().field] ?? '');
  readonly selectedGrapes = computed(() => this.fs.filter().grape);

  onSearch(value: string): void {
    this.fs.updateFilter({ searchText: value });
  }

  onDropdown(value: string): void {
    const field = this.field().field;
    this.fs.updateFilter({
      dropdowns: { ...this.fs.filter().dropdowns, [field]: value === '' ? null : value },
    });
  }

  toggleGrape(value: string, checked: boolean): void {
    const current = new Set(this.fs.filter().grape);
    if (checked) current.add(value);
    else current.delete(value);
    this.fs.updateFilter({ grape: [...current] });
  }

  isGrapeSelected(value: string): boolean {
    return this.fs.filter().grape.includes(value);
  }

  onYearFrom(v: string): void {
    this.fs.updateFilter({ yearFrom: this.toNum(v) });
  }
  onYearTo(v: string): void {
    this.fs.updateFilter({ yearTo: this.toNum(v) });
  }
  onRatingFrom(v: string): void {
    this.fs.updateFilter({ ratingFrom: this.toNum(v) });
  }
  onRatingTo(v: string): void {
    this.fs.updateFilter({ ratingTo: this.toNum(v) });
  }
  onDateFrom(v: string): void {
    this.fs.updateFilter({ tastingDateFrom: v === '' ? null : v });
  }
  onDateTo(v: string): void {
    this.fs.updateFilter({ tastingDateTo: v === '' ? null : v });
  }

  private toNum(v: string): number | null {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
}
