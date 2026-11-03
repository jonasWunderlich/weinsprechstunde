import { ImageEntry } from '../services/file-system-access.service';

/**
 * Reine, DOM-freie Auswahl-/Sortier-Logik des ImagePicker (Req 17.28–17.31).
 *
 * Bewusst als Pure-Function ausgelagert, damit die Unit-Tests das Standardverhalten
 * („nur ungenutzt"), das Umschalten, die Datum-Sortierung und den Dateinamen-Filter
 * direkt gegen diese Logik prüfen können, ohne das Formular oder die File System
 * Access API einzubinden.
 */

/** Sortierrichtung der ImagePicker-Galerie nach `date` (Req 17.30). */
export type ImageSortDirection = 'desc' | 'asc';

/** Eingangsparameter der Bildauswahl des ImagePicker. */
export interface ImagePickerView {
  /** `true` = alle Bilder; `false` (Default) = nur ungenutzte (`assigned === false`, Req 17.28). */
  showAll: boolean;
  /** Dateinamen-Filter (Req 17.31); case-insensitiv, Teilstring. Leer = kein Filter. */
  nameFilter: string;
  /** Sortierrichtung nach Datum (Req 17.30). */
  sort: ImageSortDirection;
}

/**
 * Wendet die ImagePicker-Ansicht auf das Bild-Listing an (Req 17.28–17.31):
 *
 * - **Standard „nur ungenutzt" (Req 17.28):** bei `showAll === false` bleiben nur Bilder
 *   mit `assigned === false` übrig (keinem Weineintrag über sein `image`-Feld zugeordnet).
 * - **Umschalten auf „alle" (Req 17.29):** bei `showAll === true` werden alle Bilder gezeigt.
 * - **Dateinamen-Filter (Req 17.31):** case-insensitiver Teilstring-Vergleich auf `name`.
 * - **Datum-Sortierung (Req 17.30):** nach `date` auf- oder absteigend; bei Gleichstand
 *   stabil nach `name` für eine deterministische Reihenfolge.
 *
 * Die Eingabeliste wird nicht mutiert.
 */
export function selectPickerImages(images: ImageEntry[], view: ImagePickerView): ImageEntry[] {
  const needle = view.nameFilter.trim().toLowerCase();
  const filtered = images.filter((img) => {
    if (!view.showAll && img.assigned) return false;
    if (needle !== '' && !img.name.toLowerCase().includes(needle)) return false;
    return true;
  });

  const factor = view.sort === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => {
    if (a.date !== b.date) return (a.date - b.date) * factor;
    return a.name.localeCompare(b.name);
  });
}
