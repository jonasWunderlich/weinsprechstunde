import { Component, Input } from '@angular/core';
import { Album } from '../../api';
import { AlbumTileCover } from '../album-tile-cover/album-tile-cover';
import { AlbumTileFilterLink } from '../album-tile-filter-link/album-tile-filter-link';

@Component({
  selector: 'app-album-list-item',
  imports: [AlbumTileCover, AlbumTileFilterLink],
  templateUrl: './album-list-item.html',
  styleUrl: './album-list-item.scss',
})
export class AlbumListItem {
  @Input() album!: Album;
  @Input() lazy = true;

  getRating(rating: number): string {
    switch (rating) {
      case 10:
        return 'I fell the universe bending';
      case 9:
        return 'Insanely Awesome';
      case 8:
        return 'Pretty Awesome';
      case 7:
        return 'Very good';
      case 6:
        return "Great, but It's missing something";
      case 5:
        return 'Good';
      case 4:
        return 'Okay';
      case 3:
        return 'I feel sleepy';
      case 2:
        return 'There is more music in my farts';
      default:
        return 'It hurts';
    }
  }
}
