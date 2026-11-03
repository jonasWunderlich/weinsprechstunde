import { Wine } from '@weinsprechstunde/shared';
import { ImageEntry, WineEntry } from '../services/file-system-access.service';

/**
 * Eintragstyp-Filter des Editors (Req 17.10/17.14).
 *
 * - `all`                   – angelegte und unbekannte Weine erscheinen
 * - `created`               – nur Einträge mit vorhandener JSON-Quelldatei
 * - `created-without-image` – nur angelegte Weine ohne gesetztes `image`-Feld
 * - `unknown`               – nur nicht referenzierte Bilddateien (unbekannte Weine)
 */
export type EntryTypeFilter = 'all' | 'created' | 'created-without-image' | 'unknown';

/**
 * Ein vereinheitlichter Listeneintrag der Editor-Liste. Er bildet sowohl angelegte
 * Weine (eine JSON-Quelldatei existiert) als auch unbekannte Weine (ein Bild ohne
 * referenzierende JSON) ab (Req 17.10).
 */
export type EditorListItem = CreatedListItem | UnknownListItem;

/** Ein angelegter Wein (JSON-Quelldatei vorhanden). */
export interface CreatedListItem {
  kind: 'created';
  /** Stabiler Schlüssel (= relativer JSON-Pfad). */
  id: string;
  /** Der zugrunde liegende JSON-Scan-Eintrag. */
  entry: WineEntry;
  /** Geparster Wein; `null` bei defektem JSON (Req 17.26). */
  wine: Wine | null;
  /** `true`, wenn das JSON nicht geparst werden konnte (Req 17.26). */
  broken: boolean;
  /**
   * Unvollständig = kein nicht-leeres `name`-Feld (Req 17.20). Defekte Einträge
   * gelten nicht als unvollständig (sie sind separat markiert).
   */
  incomplete: boolean;
  /** Zum Sortieren genutztes `tasting_date` (ISO `YYYY-MM-DD`) oder `null`. */
  sortDate: string | null;
}

/** Ein unbekannter Wein (ungenutztes Bild ohne JSON). */
export interface UnknownListItem {
  kind: 'unknown';
  /** Stabiler Schlüssel (= relativer Bildpfad). */
  id: string;
  /** Der zugrunde liegende Bild-Scan-Eintrag. */
  image: ImageEntry;
  /** Fester Platzhaltertext „unbekannter Wein" (Req 17.13). */
  placeholder: string;
  /** Aus dem Bild ermitteltes `tasting_date` (ISO `YYYY-MM-DD`) oder `null`. */
  sortDate: string | null;
}

/** Platzhaltertext für unbekannte Weine (Req 17.13). */
export const UNKNOWN_WINE_PLACEHOLDER = 'unbekannter Wein';
