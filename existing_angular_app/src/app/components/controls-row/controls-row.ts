import { Component, computed, EventEmitter, inject, Input, Output } from '@angular/core';
import { AlbumFilterService } from '../../services/album-filter-service';
import { SortButton } from '../sort-button/sort-button';
import { SortOptions } from '../types';

@Component({
  selector: 'app-controls-row',
  imports: [SortButton],
  templateUrl: './controls-row.html',
  styleUrl: './controls-row.scss',
})
export class ControlsRow {
  private readonly albumFilterService = inject(AlbumFilterService);
  readonly SortOptions = SortOptions;

  @Input() showInfos = true;
  @Input() showList = false;
  @Output() showInfosChange = new EventEmitter<boolean>();
  @Output() showListChange = new EventEmitter<boolean>();

  readonly filters = computed(() => this.albumFilterService.parsedQueryParams());
  readonly hasFilters = computed(
    () =>
      this.albumFilterService.parsedQueryParams().releaseYear !== undefined ||
      this.albumFilterService.parsedQueryParams().decade !== undefined ||
      this.albumFilterService.parsedQueryParams().albumArtist !== undefined ||
      this.albumFilterService.parsedQueryParams().publisher !== undefined ||
      this.albumFilterService.parsedQueryParams().tino !== undefined ||
      this.albumFilterService.parsedQueryParams().wire !== undefined ||
      this.albumFilterService.parsedQueryParams().reissue !== undefined ||
      this.albumFilterService.parsedQueryParams().genre !== undefined ||
      this.albumFilterService.parsedQueryParams().style !== undefined ||
      this.albumFilterService.parsedQueryParams().city !== undefined ||
      this.albumFilterService.parsedQueryParams().country !== undefined,
  );

  updateSearch(event: Event): void {
    const search = (event.target as HTMLInputElement).value;
    this.albumFilterService.updateFilters({ search: search || undefined });
  }

  clearSearch(): void {
    this.albumFilterService.updateFilters({ search: undefined });
  }

  expandSearch(): void {
    this.albumFilterService.replaceFilters({
      search: this.albumFilterService.parsedQueryParams().search,
    });
  }

  setSort(value: SortOptions): void {
    this.albumFilterService.updateFilters({
      sortBy: value,
    });
  }

  toggleFilter(key: 'tino' | 'wire' | 'reissue'): void {
    const isActive = this.albumFilterService.parsedQueryParams()[key];
    let updatedValue: boolean | null = null;
    
    const isUndefined = isActive == undefined || isActive == null;
    
    if (isUndefined) {
      updatedValue = true;
    } else if (isActive) {
      updatedValue = false;
    }
    this.albumFilterService.updateFilters({
      [key]: updatedValue,
    });
  }
}
