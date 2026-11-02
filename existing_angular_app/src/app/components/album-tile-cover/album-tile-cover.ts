import { Component, Input } from '@angular/core';
import { Album } from '../../api';

@Component({
  selector: 'app-album-tile-cover',
  imports: [],
  templateUrl: './album-tile-cover.html',
  styleUrl: './album-tile-cover.scss',
})
export class AlbumTileCover {
  @Input() album!: Album;
  @Input() lazy = true;

  imageError = false;

  onImageError(): void {
    this.imageError = true;
  }

  hasValidCover(): boolean {
    return !!this.album?.urlCover && this.album.urlCover !== '' && !this.imageError;
  }

  googleImageSearchUrl(value: Album) {
    if (!value) return '#';

    const artists = value.albumArtist?.map(a => a.trim()).join(', ') ?? '';
    const searchQuery = `${artists} - ${value.title}`;

    return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchQuery)}`;
  }
}
