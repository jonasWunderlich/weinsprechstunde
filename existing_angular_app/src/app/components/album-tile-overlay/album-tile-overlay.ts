import { Component, inject, Input } from '@angular/core';
import { Album } from '../../api';
import { AlbumFilterService } from '../../services/album-filter-service';
import { AlbumTileFilterLink } from '../album-tile-filter-link/album-tile-filter-link';
import { SortOptions } from '../types';

@Component({
  selector: 'app-album-tile-overlay',
  imports: [AlbumTileFilterLink],
  templateUrl: './album-tile-overlay.html',
  styleUrl: './album-tile-overlay.scss',
})
export class AlbumTileOverlay {
  @Input() album!: Album;

  private readonly albumFilterService = inject(AlbumFilterService);

  setFilter(filter: string, value?: string | number): void {
    if (value) {
      this.albumFilterService.replaceFilters({
        [filter]: value,
        sortBy: SortOptions.releaseYear,
        sortDir: 'desc',
      });
    }
  }
}
