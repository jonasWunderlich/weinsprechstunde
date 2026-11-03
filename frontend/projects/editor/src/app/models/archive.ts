import { Wine, isPresent } from '@weinsprechstunde/shared';
import { WineEntry } from '../services/file-system-access.service';

/**
 * Reine, DOM-freie Hilfen für das Archivieren im Editor (Req 17.44–17.50).
 *
 * Der Editor bietet bewusst **keine Lösch-Funktion** (Req 17.44). Als einzige
 * entfernende Aktion existiert das Archivieren = Verschieben nach `import_dir/_archive/`
 * (Req 17.45). Das endgültige Löschen und das Zurückholen (Dearchivieren) bleiben dem
 * Dateisystem vorbehalten (Req 17.50).
 *
 * Diese Logik — welche Dateien zu einem angelegten Eintrag gehören und in welcher
 * Reihenfolge sie verschoben werden — liegt als Pure-Functions hier, damit die
 * zugehörigen Unit-Tests direkt andocken können, ohne die File System Access API
 * einzubinden.
 */

/** Die Wine-Felder, deren Werte eine zu archivierende Mediendatei referenzieren können. */
export const MEDIA_FIELDS = ['image', 'audio', 'video'] as const;

/**
 * Liefert die in den Feldern `image`/`audio`/`video` referenzierten Mediendateinamen
 * eines angelegten Weineintrags (Req 17.47). Nur vorhandene (nicht-leere) String-Werte
 * zählen; Dubletten (z. B. identischer Datei­name in zwei Feldern) werden entfernt,
 * damit keine Datei doppelt verschoben wird.
 */
export function referencedMediaNames(wine: Wine | null): string[] {
  if (!wine) return [];
  const names: string[] = [];
  for (const field of MEDIA_FIELDS) {
    const value = wine[field];
    if (typeof value === 'string' && isPresent(value)) {
      const trimmed = value.trim();
      if (!names.includes(trimmed)) names.push(trimmed);
    }
  }
  return names;
}

/**
 * Baut die vollständige, geordnete Liste der zu archivierenden Quellpfade eines
 * angelegten Weineintrags (Req 17.47): zuerst die referenzierten Mediendateien im
 * selben Unterordner wie die JSON, zuletzt die JSON-Quelldatei selbst.
 *
 * Die JSON wird bewusst **zuletzt** aufgeführt: Solange die JSON am Ursprungsort liegt,
 * bleibt der Eintrag für die App ein konsistenter angelegter Wein. Erst wenn alle Medien
 * verschoben sind, wird die JSON nachgezogen.
 *
 * Mediendateien werden relativ zum Verzeichnis der JSON-Quelldatei aufgelöst
 * (`image`/`audio`/`video` enthalten nur den Dateinamen ohne Pfad, Req 17.35).
 */
export function entryArchiveSourcePaths(entry: WineEntry): string[] {
  const dir = entry.dirSegments;
  const mediaPaths = referencedMediaNames(entry.wine).map((name) =>
    [...dir, name].join('/'),
  );
  return [...mediaPaths, entry.path];
}
