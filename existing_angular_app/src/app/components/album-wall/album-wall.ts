import { Location } from '@angular/common';
import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlbumsService } from '../../api/api/albums.service';
import { Album } from '../../api/model/album';
import { AlbumFilterService } from '../../services/album-filter-service';
import { AlbumListItem } from '../album-list-item/album-list-item';
import { AlbumTile } from '../album-tile/album-tile';
import { ControlsRow } from '../controls-row/controls-row';
import { Nav } from '../nav/nav';
import { ScrollTopButton } from '../scroll-top-button/scroll-top-button';

@Component({
  selector: 'app-album-wall',
  imports: [AlbumTile, ControlsRow, Nav, ScrollTopButton, AlbumListItem],
  templateUrl: './album-wall.html',
  styleUrl: './album-wall.scss',
})
export class AlbumWall {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly albumFilterService = inject(AlbumFilterService);
  private readonly albumService = inject(AlbumsService);

  readonly albums = signal<Album[]>([]);
  readonly page = signal<number>(0);
  readonly isLoading = signal<boolean>(false);
  readonly isLastPage = signal<boolean>(false);
  readonly showList = signal<boolean>(false);
  readonly showInfos = signal(false);
  readonly pageSize = 40;

  private readonly initialised = signal(false);
  private readonly filterParams = computed(() => {
    return this.albumFilterService.parsedQueryParams();
  });

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    if (event.key === 'i' || event.key === 'I') {
      event.preventDefault();
      this.showInfos.set(!this.showInfos());
    }
    else if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      this.showList.set(!this.showList());
    }
  }

  private readonly location = inject(Location);

  readonly showBackButton = computed(() => {
    return (
      window.history.length > 1 &&
      !this.filterParams().releaseYear &&
      !this.filterParams().decade &&
      this.albums().length > 0
    );
  });

  goBack(): void {
    this.location.back();
  }

  private resetAndFetch() {
    this.page.set(0);
    this.isLastPage.set(false);
    this.albums.set([]);
    this.fetchAlbums();
  }

  constructor() {
    const params = this.route.snapshot.queryParams;

    if (Object.keys(params).length === 0) {
      this.router
        .navigate([], {
          relativeTo: this.route,
          queryParams: {
            releaseYear: new Date().getFullYear(),
            sortBy: 'addedDate',
            sortDir: 'desc',
          },
          replaceUrl: true,
        })
        .then(() => {
          this.initialised.set(true);
        });
    } else {
      this.initialised.set(true);
    }

    effect(() => {
      if (!this.initialised()) {
        return;
      }

      this.filterParams();

      untracked(() => {
        this.resetAndFetch();
      });
    });
  }

  // Lauscht auf Scroll-Events im Fenster
  @HostListener('window:scroll', [])
  onWindowScroll(): void {
    this.checkAndFetch();
  }

  private checkAndFetch(): void {
    if (this.isLoading() || this.isLastPage()) return;

    const threshold = 500; // Lade nach, wenn man sich 500px dem Ende nähert
    const scrollPosition = window.innerHeight + window.scrollY;
    const documentHeight = document.documentElement.scrollHeight;

    // Wenn der Abstand zum Ende kleiner/gleich dem Threshold ist (oder Bildschirm leer)
    if (documentHeight - scrollPosition <= threshold) {
      this.fetchAlbums();
    }
  }

  fetchAlbums(): void {
    if (this.isLoading() || this.isLastPage()) return;

    this.isLoading.set(true);
    const p = this.filterParams();

    this.albumService
      .albumsGet(
        undefined, // addedDateFrom
        undefined, // addedDateTo
        p.albumArtist, // albumArtist
        undefined, // artist
        p.city, // city
        p.country, // country
        p.decade, // decade
        undefined, // fan
        p.favorite, // favorite
        p.genre, // genre
        undefined, // hasVideo
        undefined, // lastPlayedDateFrom
        undefined, // lastPlayedDateTo
        p.owned, // owned
        this.page(), // page
        p.publisher, // publisher
        undefined, // rating
        undefined, // ratingMax
        undefined, // ratingMin
        p.reissue, // reissue
        undefined, // releaseDateFrom
        undefined, // releaseDateTo
        p.releaseYear, // releaseYear
        p.search, // search
        this.pageSize, // size
        p.sortBy, // sortBy
        p.sortDir, // sortDir
        p.style, // style
        p.tino, // tino
        undefined, // title
        p.wire, // wire
        p.wishlist, // wishlist
      )
      .subscribe({
        next: pageAlbum => {
          const newContent = pageAlbum.content || [];
          const totalPages = pageAlbum.totalPages ?? 0;
          const currentPage = pageAlbum.page ?? this.page();

          this.albums.update(prev => [...prev, ...newContent]);

          const lastPageReached =
            totalPages > 0
              ? currentPage >= totalPages - 1
              : newContent.length < this.pageSize;

          this.isLastPage.set(lastPageReached);
          this.page.update(page => page + 1);
          this.isLoading.set(false);

          // Direkt nach dem Rendern prüfen, ob der Bildschirm immer noch nicht voll ist
          setTimeout(() => {
            this.checkAndFetch();
          });
        },
        error: err => {
          console.error('Error fetching albums:', err);
          this.isLoading.set(false);
        },
      });
  }
}
