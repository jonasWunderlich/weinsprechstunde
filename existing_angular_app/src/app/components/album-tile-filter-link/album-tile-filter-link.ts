import { Component, inject, Input } from '@angular/core';
import { AlbumFilterService } from '../../services/album-filter-service';
import { AlbumFilter, SortOptions } from '../types';

@Component({
  selector: 'app-album-tile-filter-link',
  imports: [],
  templateUrl: './album-tile-filter-link.html',
  styleUrl: './album-tile-filter-link.scss',
})
export class AlbumTileFilterLink {
  private readonly albumFilterService = inject(AlbumFilterService);

  @Input() filter!: string;
  @Input() title?: string;
  @Input() noUnderline = false;
  @Input() value?: string | number;
  @Input() sortBy?: SortOptions;

  setFilter(): void {
    if (this.value) {
      this.albumFilterService.replaceFilters({
        [this.filter]: this.value,
        ...this.getDefaultSorting(this.filter, this.value),
      });
    }
  }

  getDefaultSorting(filter: string, value?: string | number): Partial<AlbumFilter> {
    switch (filter) {
      case SortOptions.releaseYear:
        if (value && value == 2026) {
          return {
            sortBy: SortOptions.addedDate,
            sortDir: 'desc',
          };
        }
        return {
          sortBy: SortOptions.rating,
          sortDir: 'desc',
        };
      case 'albumArtist':
        return {
          sortBy: SortOptions.releaseYear,
          sortDir: 'asc',
        };
      default:
        return {
          sortBy: SortOptions.releaseYear,
          sortDir: 'desc',
        };
    }
  }
}
