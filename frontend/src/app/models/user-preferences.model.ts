import { SortOption } from './wine.model';

export interface UserPreferences {
  visibleFilters: string[];
  sortOption: SortOption;
  viewMode: 'grid' | 'list';
}
