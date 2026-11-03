import { Wine, WineFilter, isPresent } from '@weinsprechstunde/shared';
import { ImageEntry, WineEntry } from '../services/file-system-access.service';
import {
  CreatedListItem,
  EditorListItem,
  EntryTypeFilter,
  UNKNOWN_WINE_PLACEHOLDER,
  UnknownListItem,
} from './editor-list.model';

/**
 * Wandelt eine EXIF-/Dateidatums-Angabe (ms-Timestamp) in ein ISO-`YYYY-MM-DD`-Datum
 * um, damit unbekannte Weine mit demselben `tasting_date`-Format wie angelegte Weine
 * in dieselbe Sortierung einfließen (Req 17.12/17.13).
 */
export function timestampToIsoDate(ts: number | null | undefined): string | null {
  if (ts == null || Number.isNaN(ts)) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Liest ein `tasting_date` (ISO-String) aus einem Wein; `null`, wenn nicht vorhanden. */
export function wineSortDate(wine: Wine | null): string | null {
  if (!wine) return null;
  const raw = wine.tasting_date;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/** Baut einen Listeneintrag für einen angelegten Wein aus einem Scan-Eintrag. */
export function toCreatedListItem(entry: WineEntry): CreatedListItem {
  const wine = entry.wine;
  const hasName = !entry.broken && !!wine && isPresent(wine.name);
  return {
    kind: 'created',
    id: entry.path,
    entry,
    wine,
    broken: entry.broken,
    // Defekte Einträge werden als fehlerhaft (nicht als „unvollständig") markiert.
    incomplete: !entry.broken && !hasName,
    sortDate: wineSortDate(wine),
  };
}

/** Baut einen Listeneintrag für einen unbekannten Wein aus einem Bild-Scan-Eintrag. */
export function toUnknownListItem(image: ImageEntry): UnknownListItem {
  return {
    kind: 'unknown',
    id: image.path,
    image,
    placeholder: UNKNOWN_WINE_PLACEHOLDER,
    sortDate: timestampToIsoDate(image.date),
  };
}

/**
 * Vergleicht zwei Listeneinträge absteigend nach `tasting_date` und stellt Einträge
 * ohne ermittelbares Datum ans Ende (Req 17.12). Bei gleichem Datum bzw. beidseitig
 * fehlendem Datum wird stabil nach `id` sortiert, damit die Reihenfolge deterministisch
 * bleibt.
 */
export function compareByDateDesc(a: EditorListItem, b: EditorListItem): number {
  const da = a.sortDate;
  const db = b.sortDate;
  if (da && db) {
    const cmp = db.localeCompare(da);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  }
  if (da && !db) return -1; // datierte vor undatierten
  if (!da && db) return 1;
  return a.id.localeCompare(b.id); // beide undatiert → stabil
}

/**
 * Prüft, ob ein attributbasierter Filter aktiv ist (Freitextsuche, Dropdowns,
 * Multiselects, Range-/Date-/Rating-Grenzen). Dient dem Auto-Umschalten des
 * Eintragstyp-Filters (Req 17.15).
 */
export function hasAttributeFilter(filter: WineFilter): boolean {
  return (
    filter.searchText.trim() !== '' ||
    Object.values(filter.dropdowns).some((v) => v !== null) ||
    Object.values(filter.multiSelects).some((v) => v.length > 0) ||
    filter.yearFrom !== null ||
    filter.yearTo !== null ||
    filter.ratingFrom !== null ||
    filter.ratingTo !== null ||
    filter.tastingDateFrom !== null ||
    filter.tastingDateTo !== null
  );
}

/**
 * Baut die endgültig anzuzeigende Editor-Liste (Req 17.10/17.12/17.14).
 *
 * @param filteredWines  die bereits vom geteilten FilterService gefilterten und nach
 *        der gewählten Sortierung sortierten angelegten Weine. Für die Standard-
 *        sortierung (`tasting_date_desc`) wird das Ergebnis hier gemeinsam mit den
 *        unbekannten Weinen neu nach Datum gemischt; bei anderen Sortierungen bleiben
 *        die angelegten Weine in ihrer vorsortierten Reihenfolge und unbekannte Weine
 *        (sofern sichtbar) folgen dahinter.
 * @param createdEntries alle angelegten Scan-Einträge (inkl. defekter JSONs), zur
 *        Auflösung der zu `filteredWines` gehörenden Metadaten.
 * @param images         das Bild-Listing des Scans (unbekannte Weine = `assigned=false`).
 * @param entryType      der dreiwertige Eintragstyp-Filter.
 * @param mixByDate      `true`, wenn angelegte und unbekannte Weine gemischt nach Datum
 *        sortiert werden sollen (Standardsortierung).
 */
export function buildEditorList(
  filteredWines: Wine[],
  createdEntries: WineEntry[],
  images: ImageEntry[],
  entryType: EntryTypeFilter,
  mixByDate: boolean,
): EditorListItem[] {
  // 1. Angelegte Weine (sofern der Eintragstyp sie zulässt). Reihenfolge von
  //    `filteredWines` respektieren (= geteilte Sortierung des FilterService).
  const created: CreatedListItem[] = [];
  if (entryType !== 'unknown') {
    const byWine = new Map<Wine, WineEntry>();
    for (const e of createdEntries) if (e.wine) byWine.set(e.wine, e);
    for (const w of filteredWines) {
      const entry = byWine.get(w);
      if (entry) created.push(toCreatedListItem(entry));
    }
  }

  // 2. Unbekannte Weine (nur ungenutzte Bilder), sofern der Eintragstyp sie zulässt.
  const unknown: UnknownListItem[] = [];
  if (entryType !== 'created') {
    for (const img of images) {
      if (!img.assigned) unknown.push(toUnknownListItem(img));
    }
  }

  if (!mixByDate) {
    // Nicht-Standard-Sortierung: angelegte in FilterService-Reihenfolge, danach
    // unbekannte nach Datum absteigend (undatierte ans Ende).
    return [...created, ...unknown.slice().sort(compareByDateDesc)];
  }

  // Standardsortierung: angelegte + unbekannte gemischt absteigend nach Datum,
  // undatierte ans Ende (Req 17.12).
  return [...created, ...unknown].sort(compareByDateDesc);
}
