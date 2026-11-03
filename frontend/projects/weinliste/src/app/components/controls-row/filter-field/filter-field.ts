import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { distinctValuesForField, FilterService } from '@weinsprechstunde/shared';
import { WineDataService } from '../../../services/wine-data.service';

/** Beschreibt einen einzelnen, eigenständig zuschaltbaren Filter. */
export interface FilterDescriptor {
  key: string;
  label: string;
  kind:
    | 'text-search'
    | 'multi-select'
    | 'dropdown'
    | 'rating-bound'
    | 'date-bound'
    | 'year-bound';
  /** Schemafeld für Dropdown/Multiselect (z. B. 'grape', 'origin', 'country'). */
  field?: string;
  /** Grenze für Range-Filter. */
  bound?: 'from' | 'to';
}

/** Schema-/deskriptorgesteuertes Filter-Widget: `kind` bestimmt die Darstellung. */
@Component({
  selector: 'app-filter-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filter-field.html',
  styleUrl: './filter-field.scss',
})
export class FilterFieldComponent {
  readonly descriptor = input.required<FilterDescriptor>();
  /** true = optionaler Filter mit Entfernen-Icon; false = fester Filter (Suche). */
  readonly removable = input<boolean>(false);
  readonly remove = output<string>();
  private readonly data = inject(WineDataService);
  readonly fs = inject(FilterService);

  /** Mögliche Werte für Dropdown/Multiselect aus den tatsächlichen Weindaten. */
  readonly options = computed(() => {
    const field = this.descriptor().field;
    return field ? distinctValuesForField(this.data.wines(), field) : [];
  });

  onRemove(): void {
    this.remove.emit(this.descriptor().key);
  }

  // --- Freitextsuche ---
  readonly searchText = computed(() => this.fs.filter().searchText);
  onSearch(value: string): void {
    this.fs.updateFilter({ searchText: value });
  }

  // --- Einzelauswahl-Dropdown ---
  readonly selectedDropdown = computed(() => {
    const field = this.descriptor().field!;
    return this.fs.filter().dropdowns[field] ?? '';
  });
  onDropdown(value: string): void {
    const field = this.descriptor().field!;
    this.fs.updateFilter({
      dropdowns: { ...this.fs.filter().dropdowns, [field]: value === '' ? null : value },
    });
  }

  // --- Multiselect als aufklappbares Dropdown (Button + Checkbox-Panel) ---
  readonly multiOpen = signal(false);

  readonly selectedMulti = computed(() => {
    const field = this.descriptor().field!;
    return this.fs.filter().multiSelects[field] ?? [];
  });

  /** Zusammenfassung für den geschlossenen Zustand: "Alle" / "X" / "n gewählt". */
  readonly multiSummary = computed(() => {
    const sel = this.selectedMulti();
    if (sel.length === 0) return 'Alle';
    if (sel.length === 1) return sel[0];
    return `${sel.length} gewählt`;
  });

  toggleMultiOpen(): void {
    this.multiOpen.update((v) => !v);
  }
  closeMulti(): void {
    this.multiOpen.set(false);
  }

  isMultiSelected(value: string): boolean {
    return this.selectedMulti().includes(value);
  }
  toggleMultiValue(value: string, checked: boolean): void {
    const field = this.descriptor().field!;
    const current = new Set(this.selectedMulti());
    if (checked) current.add(value);
    else current.delete(value);
    this.fs.updateFilter({
      multiSelects: { ...this.fs.filter().multiSelects, [field]: [...current] },
    });
  }
  clearMulti(): void {
    const field = this.descriptor().field!;
    this.fs.updateFilter({
      multiSelects: { ...this.fs.filter().multiSelects, [field]: [] },
    });
  }

  // --- Range-Grenzen (jeweils einzeln) ---
  readonly ratingValue = computed(() =>
    this.descriptor().bound === 'from' ? this.fs.filter().ratingFrom : this.fs.filter().ratingTo,
  );
  onRating(v: string): void {
    const patch =
      this.descriptor().bound === 'from' ? { ratingFrom: this.toNum(v) } : { ratingTo: this.toNum(v) };
    this.fs.updateFilter(patch);
  }

  readonly yearValue = computed(() =>
    this.descriptor().bound === 'from' ? this.fs.filter().yearFrom : this.fs.filter().yearTo,
  );
  onYear(v: string): void {
    const patch =
      this.descriptor().bound === 'from' ? { yearFrom: this.toNum(v) } : { yearTo: this.toNum(v) };
    this.fs.updateFilter(patch);
  }

  readonly dateValue = computed(() =>
    this.descriptor().bound === 'from'
      ? (this.fs.filter().tastingDateFrom ?? '')
      : (this.fs.filter().tastingDateTo ?? ''),
  );
  onDate(v: string): void {
    const value = v === '' ? null : v;
    const patch =
      this.descriptor().bound === 'from'
        ? { tastingDateFrom: value }
        : { tastingDateTo: value };
    this.fs.updateFilter(patch);
  }

  private toNum(v: string): number | null {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
}
