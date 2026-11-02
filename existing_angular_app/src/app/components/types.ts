export type SortDirection = 'asc' | 'desc';

export enum SortOptions {
  addedDate = 'addedDate',
  rating = 'rating',
  lastPlayedDate = 'lastPlayedDate',
  title = 'title',
  artist = 'artist',
  genre = 'genre',
  style = 'style',
  country = 'country',
  city = 'city',
  publisher = 'publisher',
  releaseYear = 'releaseYear',
}

export enum FilterOptions {
  tino = 'tino',
  wire = 'wire',
  fan = 'fan',
  wishlist = 'wishlist',
  favorite = 'favorite',
  owned = 'owned',
}

export interface AlbumFilter {
  sortBy?: SortOptions;
  sortDir?: 'asc' | 'desc';
  addedDateFrom?: string;
  addedDateTo?: string;
  albumArtist?: string;
  artist?: string;
  city?: string;
  country?: string;
  decade?: number;
  fan?: boolean;
  favorite?: boolean;
  genre?: string;
  hasVideo?: boolean;
  owned?: boolean;
  page?: number;
  publisher?: string;
  rating?: number;
  ratingMax?: number;
  ratingMin?: number;
  reissue?: boolean;
  releaseDateFrom?: string;
  releaseDateTo?: string;
  releaseYear?: number;
  search?: string;
  size?: number;
  style?: string;
  tino?: boolean;
  title?: string;
  wire?: boolean;
  wishlist?: boolean;
}
