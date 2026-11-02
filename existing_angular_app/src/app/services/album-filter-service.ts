import { computed, inject, Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlbumFilter, SortOptions } from '../components/types';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AlbumFilterService {
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  private readonly routeQueryParams = toSignal(this.route.queryParams, {
    initialValue: this.route.snapshot.queryParams,
  });

  public readonly parsedQueryParams = computed(() =>
    this.parseParams(this.routeQueryParams() ?? {})
  );

  private parseParams(params: Record<string, any>): AlbumFilter {
    return {
      // Sort Params
      sortBy: params['sortBy'] || 'rating',
      sortDir: params['sortDir'] || 'desc',
      // String Params
      albumArtist: params['albumArtist'] || undefined,
      city: params['city'] || undefined,
      country: params['country'] || undefined,
      genre: params['genre'] || undefined,
      publisher: params['publisher'] || undefined,
      search: params['search'] || null,
      style: params['style'] || undefined,
      // Numerical Params
      decade: params['decade'] ? Number(params['decade']) : undefined,
      ratingMin: params['minRating'] ? Number(params['minRating']) : undefined,
      releaseYear: params['releaseYear'] ? Number(params['releaseYear']) : undefined,
      // Boolean Params
      favorite: params['favorite'] === 'true' ? true : undefined,
      owned: params['owned'] === 'true' ? true : undefined,
      tino: params['tino'] === 'true' ? true : undefined,
      wire: params['wire'] === 'true' ? true : undefined,
      reissue: params['reissue'] === 'true' ? true : params['reissue'] === 'false' ? false : undefined,
      wishlist: params['wishlist'] === 'true' ? true : undefined,
    };
  }

  removeFilter(key: keyof AlbumFilter): void {
    this.updateFilters({ [key]: undefined });
  }

  resetAllFilters(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
    });
  }

  replaceFilters(newFilters: Partial<AlbumFilter>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: newFilters,
      queryParamsHandling: 'replace',
      replaceUrl: false,
    });
  }

  updateFilters(newFilters: Partial<AlbumFilter>): void {
    // Handle Sort Direction if only sortBy is provided
    if (newFilters.sortBy && Object.keys(newFilters).length === 1) {
      const currentFilters = this.parsedQueryParams();
      const isSameSort = currentFilters.sortBy === newFilters.sortBy;
      const isAsc = currentFilters.sortDir === 'asc';
      if (isSameSort) {
        newFilters.sortDir = isAsc ? 'desc' : 'asc';
      } else {
        if (newFilters.sortBy === SortOptions.artist) {
          newFilters.sortDir = 'asc';
        } else {
          newFilters.sortDir = 'desc';
        }
      }
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: newFilters,
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  }
}
