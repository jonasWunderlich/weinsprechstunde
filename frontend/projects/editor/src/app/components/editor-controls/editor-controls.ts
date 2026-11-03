import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FilterService, SortOption } from '@weinsprechstunde/shared';
import { EntryTypeFilterComponent } from '../entry-type-filter/entry-type-filter';

/**
 * Schlanke Steuerzeile der Editor-Liste: attributbasierte Freitextsuche und
 * Sortierung laufen über den geteilten {@link FilterService} (Req 17.10/17.11);
 * zusätzlich der editor-spezifische Eintragstyp-Filter (Req 17.14).
 *
 * Die vollständige ControlsRow der öffentlichen Weinliste hängt an deren
 * WineDataService; der Editor nutzt hier bewusst eine eigene, leichte Zeile, die
 * aber dieselbe geteilte Filter-/Sortierlogik ansteuert.
 */
@Component({
  selector: 'app-editor-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntryTypeFilterComponent],
  templateUrl: './editor-controls.html',
  styleUrl: './editor-controls.scss',
})
export class EditorControlsComponent {
  readonly fs = inject(FilterService);

  readonly sortOptions: { value: SortOption; label: string }[] = [
    { value: 'tasting_date_desc', label: 'Neueste Verkostung zuerst' },
    { value: 'tasting_date_asc', label: 'Älteste Verkostung zuerst' },
    { value: 'name_asc', label: 'Name A–Z' },
    { value: 'name_desc', label: 'Name Z–A' },
    { value: 'rating_desc', label: 'Beste Bewertung zuerst' },
    { value: 'price_desc', label: 'Höchster Preis zuerst' },
    { value: 'price_asc', label: 'Niedrigster Preis zuerst' },
  ];

  onSearch(value: string): void {
    this.fs.updateFilter({ searchText: value });
  }

  onSort(value: string): void {
    this.fs.setSortOption(value as SortOption);
  }
}
