export type FilterType =
  | 'text-search'
  | 'range'
  | 'date-range'
  | 'dropdown'
  | 'rating-range'
  | 'multi-select'
  | null;

export interface WineSchemaField {
  field: string;
  type: 'text' | 'number' | 'date' | 'multi-value'; // reales Schema nutzt nur diese vier
  filter_type: FilterType;
  default_filter: boolean;
  decimals?: number; // nur type 'number': 0 = Integer (year), 1 = rating, 2 = price
}
