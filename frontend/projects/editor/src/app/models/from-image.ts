import { Wine, WineSchemaField, isPresent } from '@weinsprechstunde/shared';
import { ImageEntry, WineEntry } from '../services/file-system-access.service';

/**
 * Reine, DOM-freie Hilfen für das Anlegen eines Weineintrags per Bildklick
 * (from-image, Req 17.36/17.37) und das Verknüpfen eines Bildes mit einem bestehenden
 * bildlosen Eintrag (link-image, Req 17.38–17.43).
 *
 * Bewusst als Pure-Functions ausgelagert, damit die zugehörigen Property-Tests
 * (30.2 Property 24: Ort/Name/Feldbelegung, 30.3 Property 25: genau eine JSON pro Wein)
 * direkt gegen diese Logik laufen können, ohne die File System Access API einzubinden.
 */

/**
 * Entfernt die Dateiendung eines Dateinamens und liefert den Basisnamen.
 * `2021-wein.jpg` → `2021-wein`, `foo.tar.gz` → `foo.tar` (nur die letzte Endung).
 * Ein Name ohne Endung bleibt unverändert; ein führender Punkt (Dotfile) zählt nicht
 * als Endung.
 */
export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return fileName;
  return fileName.slice(0, dot);
}

/**
 * Vorläufiger JSON-Dateiname eines per Bildklick angelegten Eintrags: Basisname des
 * Bildes + `.json` (Req 17.37). Keine Umbenennung nach `{tasting_date}-{slug(name)}` —
 * das bleibt der PhasePreparate des ImportScripts überlassen.
 */
export function provisionalJsonName(imageFileName: string): string {
  return `${stripExtension(imageFileName)}.json`;
}

/**
 * Relativer Pfad der vorläufigen JSON-Quelldatei: **im selben Unterordner** wie das
 * angeklickte Bild (Req 17.36/17.37).
 */
export function provisionalJsonPath(image: ImageEntry): string {
  const name = provisionalJsonName(image.name);
  return [...image.dirSegments, name].join('/');
}

/**
 * Baut die vorläufige Wine-JSON eines per Bildklick angelegten Eintrags (Req 17.36):
 * Alle Felder der WineSchema werden mit `null` initialisiert — mit Ausnahme von
 * `image` (Dateiname des angeklickten Bildes, ohne Pfad) und `tasting_date` (aus dem
 * EXIF-Aufnahmezeitpunkt `DateTimeOriginal`, falls vorhanden, sonst `null`).
 *
 * @param schema      die bekannten WineSchema-Felder.
 * @param imageName   Dateiname des angeklickten Bildes (ohne Pfad).
 * @param tastingDate EXIF-`DateTimeOriginal` als ISO-`YYYY-MM-DD` oder `null`.
 */
export function buildProvisionalWine(
  schema: WineSchemaField[],
  imageName: string,
  tastingDate: string | null,
): Wine {
  const wine: Record<string, unknown> = {};
  for (const f of schema) {
    wine[f.field] = null;
  }
  wine['image'] = imageName;
  wine['tasting_date'] = tastingDate;
  return wine as Wine;
}

/**
 * Prüft, ob ein Weineintrag **bildlos** ist (Req 17.38): sein `image`-Feld ist leer,
 * `null` oder nicht vorhanden.
 */
export function isImageless(wine: Wine | null): boolean {
  if (!wine) return false;
  return !isPresent(wine.image);
}

/**
 * Liefert alle bestehenden **bildlosen** Weineinträge für das `name`-Autocomplete eines
 * per Bildklick angelegten Eintrags (Req 17.38). Der vorläufige Eintrag selbst
 * (`excludePath`) wird ausgeschlossen, ebenso defekte JSONs.
 *
 * @param entries     alle angelegten Scan-Einträge.
 * @param excludePath Pfad des vorläufigen Eintrags, der nicht vorgeschlagen werden soll.
 */
export function imagelessEntries(entries: WineEntry[], excludePath?: string): WineEntry[] {
  return entries.filter(
    (e) => !e.broken && e.wine !== null && e.path !== excludePath && isImageless(e.wine),
  );
}

/**
 * Setzt das `image`-Feld eines bestehenden Weineintrags auf den angegebenen Dateinamen
 * (Req 17.41). Liefert ein neues Wine-Objekt; das Original bleibt unverändert.
 */
export function withImage(wine: Wine, imageName: string): Wine {
  return { ...wine, image: imageName };
}
