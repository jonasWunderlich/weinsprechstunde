/**
 * Domänenmodelle der Weinliste. Form, nicht Werte: die „leere Felder ausblenden"-
 * Invariante liegt in der Präsentationsschicht (isPresent), die AND-Filter-Invariante
 * in applyFiltersAndSort.
 */

export interface Wine {
  name: string;
  year?: number;
  country?: string;
  origin?: string;
  grape?: string | string[];
  type?: string;
  producer?: string;
  quality?: string | string[];
  price?: number; // Schema: type "number", decimals 2
  rating?: number; // Schema: type "number", decimals 1
  tasting_date?: string; // ISO-8601
  image?: string;
  audio?: string;
  video?: string;
  description?: string;
  // unbekannte Zusatzfelder typsicher (Req 14.7) — Zugriff nur per Bracket
  [key: string]: unknown;
}

export interface WineFilter {
  searchText: string;
  // Einzelauswahl-Dropdowns (country, type, producer, quality):
  // Wert = exakter Match oder null (inaktiv).
  dropdowns: Record<string, string | null>;
  // Multiselect-Dropdowns (grape, origin): leeres Array = inaktiv.
  // OR innerhalb eines Feldes, AND zwischen Feldern.
  multiSelects: Record<string, string[]>;
  yearFrom: number | null;
  yearTo: number | null;
  ratingFrom: number | null;
  ratingTo: number | null;
  tastingDateFrom: string | null;
  tastingDateTo: string | null;
}

export interface NavigationFilter {
  type: 'region' | 'rebsorte';
  slug: string;
}

export const EMPTY_FILTER: WineFilter = {
  searchText: '',
  dropdowns: { country: null, type: null, producer: null, quality: null },
  multiSelects: { grape: [], origin: [] },
  yearFrom: null,
  yearTo: null,
  ratingFrom: null,
  ratingTo: null,
  tastingDateFrom: null,
  tastingDateTo: null,
};

export type SortOption =
  | 'tasting_date_desc'
  | 'tasting_date_asc'
  | 'rating_desc'
  | 'price_desc'
  | 'price_asc';
export type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
