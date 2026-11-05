import { Wine } from './wine.model';

/** Server-Mount von deploy.remote_images_path, relativ zum Web-Root. */
export const IMAGE_BASE = '/images/';
export const VIDEO_BASE = '/video/';
export const AUDIO_BASE = '/audio/';

/**
 * „Feld vorhanden" = truthy / nicht-null / nicht-leerer-String / nicht-leeres-Array.
 * Einzige Quelle der „leere Felder ausblenden"-Regel.
 */
export function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function grapeList(w: Wine): string[] {
  return Array.isArray(w.grape) ? w.grape : w.grape ? [w.grape] : [];
}

/**
 * Transliteriert deutsche Umlaute VOR dem Entfernen von Nicht-[a-z0-9-]-Zeichen.
 * Frontend-interne Konsistenz: Nav und applyFiltersAndSort laufen durch denselben Helfer.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/** Rollt ein (ggf. multi-value) Feld eines Weins zu einer flachen String-Liste aus. */
export function valueList(w: Wine, field: string): string[] {
  const raw = w[field];
  if (Array.isArray(raw)) return raw.filter(isPresent).map(String);
  return isPresent(raw) ? [String(raw)] : [];
}

/** Distinct, present-gefilterte, de-sortierte Vorschlagswerte eines Feldes. */
export function distinctValuesForField(wines: Wine[], field: string): string[] {
  const set = new Set<string>();
  for (const w of wines) for (const v of valueList(w, field)) set.add(v);
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

/** Zählkarte {value,count}[] für Nav-Anzeige; überspringt present-but-null; de-sortiert. */
export function countBy(
  wines: Wine[],
  toValues: (w: Wine) => (string | null | undefined)[],
): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const w of wines)
    for (const v of toValues(w)) if (isPresent(v)) m.set(v!, (m.get(v!) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'de'))
    .map(([value, count]) => ({ value, count }));
}

/** Vollständige, fixierte Label-Map für real vorkommende Extra-Keys. */
export const EXTRA_LABELS: Record<string, string> = {
  taste_eye: 'Auge',
  taste_nose: 'Nase',
  taste_mouth: 'Mund',
  conclusion_tobias: 'Fazit Tobias',
  conclusion_wolfgang: 'Fazit Wolfgang',
  conclusion_simon: 'Fazit Simon',
  development: 'Entwicklung',
  percentage: 'Alkoholgehalt (%)',
  spontansprechstunde: 'Spontansprechstunde',
};

export function humanizeKey(key: string): string {
  return EXTRA_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Baut die Medien-URL aus Dateiname + zentralem IMAGE_BASE; null bei fehlendem Wert. */
export function mediaSrc(file: string | null | undefined, media: 'image' | 'video' | 'audio' = 'image'): string | null {
  const base = media === 'image' ? IMAGE_BASE : media === 'video' ? VIDEO_BASE : AUDIO_BASE;
  return isPresent(file) ? base + file : null;
}

/** de-Dezimalkomma, 2 Nachkommastellen, €-Suffix. null bei fehlendem Preis. */
export function formatPrice(price: number | null | undefined): string | null {
  return isPresent(price)
    ? price!.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
    : null;
}
