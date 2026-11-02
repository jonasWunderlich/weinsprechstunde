import { Component, Input, signal } from '@angular/core';
import { Album } from '../../api/model/album';
import { AlbumTileCover } from '../album-tile-cover/album-tile-cover';
import { AlbumTileOverlay } from '../album-tile-overlay/album-tile-overlay';

@Component({
  selector: 'app-album-tile',
  templateUrl: './album-tile.html',
  styleUrl: './album-tile.scss',
  imports: [AlbumTileCover, AlbumTileOverlay],
})
export class AlbumTile {
  @Input() album!: Album;
  @Input() lazy = true;
  @Input() showInfos = true;

  showDetails = signal(false);

  toggleDetails(): void {
    this.showDetails.update(visible => !visible);
  }

  onMouseEnter(): void {
    this.showDetails.set(true);
  }

  onMouseLeave(): void {
    this.showDetails.set(false);
  }

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
