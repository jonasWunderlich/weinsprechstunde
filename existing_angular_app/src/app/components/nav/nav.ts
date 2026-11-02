import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavActiveFilter } from '../../nav-active-filter/nav-active-filter';
import { AlbumFilterService } from '../../services/album-filter-service';
import { AlbumMetaService } from '../../services/album-meta-service';
import { AlbumTileFilterLink } from '../album-tile-filter-link/album-tile-filter-link';
import { Icon } from '../icon/icon';
import { SortOptions } from '../types';

@Component({
  selector: 'app-nav',
  imports: [RouterLink, AlbumTileFilterLink, Icon, NavActiveFilter],
  templateUrl: './nav.html',
  styleUrl: './nav.scss',
})
export class Nav {
  readonly yearsAndDecades = inject(AlbumMetaService).data;
  readonly albumFilterService = inject(AlbumFilterService);
  menuHidden = true;
  showLegend = false;

  public readonly filterParams = computed(() => {
    return this.albumFilterService.parsedQueryParams();
  });

  public readonly prevYear = computed(() => {
    const y = this.filterParams().releaseYear;
    return y && y > 1900 ? y - 1 : undefined;
  });

  public readonly nextYear = computed(() => {
    const y = this.filterParams().releaseYear;
    return y && y < 2026 ? y + 1 : undefined;
  });

  public readonly prevDecade = computed(() => {
    const d = this.filterParams().decade;
    return d ? d - 10 : undefined;
  });

  public readonly nextDecade = computed(() => {
    const d = this.filterParams().decade;
    return d && d < 2020 ? d + 10 : undefined;
  });

  setReleaseYear(value?: string | number): void {
    if (!value) {
      return;
    }

    const releaseYear = Number(value);
    const sortBy = releaseYear === 2026 ? SortOptions.addedDate : SortOptions.rating;

    this.albumFilterService.replaceFilters({
      releaseYear,
      sortBy,
      sortDir: 'desc',
    });
    this.menuHidden = true;
  }

  setDecade(decade?: number | string): void {
    if (!decade) {
      return;
    }

    this.albumFilterService.replaceFilters({
      decade: Number(decade),
      sortBy: SortOptions.rating,
      sortDir: 'desc',
    });
    this.menuHidden = true;
  }

  resetFilters(filter: string) {
    this.albumFilterService.replaceFilters({
      [filter]: undefined,
      sortBy: SortOptions.lastPlayedDate,
      sortDir: 'desc',
    });
  }

  noFiltersActive(): boolean {
    const filter = this.filterParams();
    return (
      filter.albumArtist === undefined &&
      filter.publisher === undefined &&
      filter.genre === undefined &&
      filter.style === undefined &&
      filter.country === undefined &&
      filter.city === undefined &&
      filter.releaseYear === undefined &&
      filter.decade === undefined &&
      filter.owned === undefined &&
      filter.favorite === undefined &&
      filter.wishlist === undefined
    );
  }
}
