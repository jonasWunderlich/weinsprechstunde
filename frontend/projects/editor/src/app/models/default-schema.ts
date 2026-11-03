import { WineSchemaField } from '@weinsprechstunde/shared';

/**
 * Default-WineSchema (entspricht `wine-schema.json` im Projekt-Root, Req 18.2).
 *
 * Der geteilte {@link FilterService} benötigt das Schema u. a. zur Ableitung der
 * text-search-Felder. Das vollständige Laden der `wine-schema.json` zur Laufzeit
 * (Req 18.5) folgt in späteren Editor-Tasks; bis dahin dient diese Konstante als
 * Startwert, damit die geteilte Filter-/Sortierlogik funktioniert.
 */
export const DEFAULT_WINE_SCHEMA: WineSchemaField[] = [
  { field: 'name', type: 'text', filter_type: 'text-search', default_filter: true },
  { field: 'year', type: 'number', filter_type: 'range', default_filter: false, decimals: 0 },
  { field: 'country', type: 'text', filter_type: 'dropdown', default_filter: false },
  { field: 'origin', type: 'text', filter_type: 'dropdown', default_filter: false },
  { field: 'grape', type: 'multi-value', filter_type: 'multi-select', default_filter: true },
  { field: 'type', type: 'text', filter_type: 'dropdown', default_filter: false },
  { field: 'producer', type: 'text', filter_type: 'dropdown', default_filter: false },
  { field: 'quality', type: 'text', filter_type: 'dropdown', default_filter: false },
  { field: 'price', type: 'number', filter_type: null, default_filter: false, decimals: 2 },
  { field: 'rating', type: 'number', filter_type: 'rating-range', default_filter: true, decimals: 1 },
  { field: 'tasting_date', type: 'date', filter_type: 'date-range', default_filter: true },
  { field: 'image', type: 'text', filter_type: null, default_filter: false },
  { field: 'audio', type: 'text', filter_type: null, default_filter: false },
  { field: 'video', type: 'text', filter_type: null, default_filter: false },
  { field: 'description', type: 'text', filter_type: null, default_filter: false },
];
