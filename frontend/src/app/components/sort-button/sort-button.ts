import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SortOption } from '../../models/wine.model';
import { FilterService } from '../../services/filter.service';

/** Sortierauswahl als natives <select>. Liest/schreibt nur den FilterService. */
@Component({
  selector: 'app-sort-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sort-button.html',
  styleUrl: './sort-button.scss',
})
export class SortButtonComponent {
  readonly fs = inject(FilterService);
  readonly options: { value: SortOption; label: string }[] = [
    { value: 'tasting_date_desc', label: 'Neueste Verkostung zuerst' },
    { value: 'tasting_date_asc', label: 'Älteste Verkostung zuerst' },
    { value: 'rating_desc', label: 'Beste Bewertung zuerst' },
  ];

  onChange(value: string): void {
    this.fs.setSortOption(value as SortOption);
  }
}
