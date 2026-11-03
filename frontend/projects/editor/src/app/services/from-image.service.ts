import { Injectable, inject } from '@angular/core';
import { Wine, WineSchemaField } from '@weinsprechstunde/shared';
import { FileSystemAccessService, ImageEntry, WineEntry } from './file-system-access.service';
import {
  buildProvisionalWine,
  provisionalJsonPath,
  withImage,
} from '../models/from-image';

/** Ergebnis eines erfolgreichen from-image-Anlegevorgangs (Req 17.36/17.37). */
export interface CreatedProvisional {
  /** Relativer Pfad der neu angelegten vorläufigen JSON-Quelldatei. */
  path: string;
  /** Der angelegte (vorläufige) Wein. */
  wine: Wine;
  /** `File.lastModified` der neu angelegten Datei (Konfliktbasis des Auto-Save). */
  lastModified: number;
  /** Das Bild, aus dem der Eintrag angelegt wurde. */
  image: ImageEntry;
}

/** Ergebnis einer erfolgreichen Verknüpfung (link-image, Req 17.41). */
export interface LinkResult {
  /** Relativer Pfad der JSON des bestehenden Eintrags (= verbleibende JSON). */
  path: string;
  /** Der aktualisierte bestehende Wein (mit gesetztem `image`-Feld). */
  wine: Wine;
  /** `File.lastModified` der JSON des bestehenden Eintrags nach dem Schreiben. */
  lastModified: number;
}

/**
 * Orchestriert die File-System-Operationen des per-Bildklick-Anlegens (from-image,
 * Req 17.36/17.37) und des Verknüpfens mit einem bestehenden bildlosen Eintrag
 * (link-image, Req 17.41–17.43) über den {@link FileSystemAccessService}.
 *
 * Die reine Logik (Pfad-/Namensbildung, Feldbelegung) liegt in `models/from-image.ts`;
 * dieser Service kapselt die eigentlichen, nebenwirkungsbehafteten FSA-Aufrufe in
 * testbaren Methoden, damit die Property-Tests 30.2/30.3 direkt andocken können.
 */
@Injectable({ providedIn: 'root' })
export class FromImageService {
  private readonly fsa = inject(FileSystemAccessService);

  /**
   * Legt per Bildklick eine vorläufige JSON-Quelldatei im **selben Unterordner** wie das
   * Bild an (Basisname des Bildes + `.json`, Req 17.36/17.37). Alle WineSchema-Felder
   * werden mit `null` initialisiert — außer `image` (Dateiname des Bildes) und
   * `tasting_date` (EXIF `DateTimeOriginal`, falls vorhanden, sonst `null`).
   *
   * @throws wenn unter dem vorläufigen Pfad bereits eine Datei existiert (kein
   *         Überschreiben eines bestehenden Eintrags).
   */
  async createFromImage(image: ImageEntry, schema: WineSchemaField[]): Promise<CreatedProvisional> {
    const path = provisionalJsonPath(image);
    if (await this.fsa.fileExists(path)) {
      throw new Error(`Es existiert bereits eine JSON-Datei für dieses Bild: ${path}`);
    }
    const tastingDate = await this.fsa.readImageExifDate(image.path);
    const wine = buildProvisionalWine(schema, image.name, tastingDate);
    const lastModified = await this.fsa.createJson(path, wine);
    return { path, wine, lastModified, image };
  }

  /**
   * Legt die JSON eines zuvor als Entwurf bearbeiteten unbekannten Weins an (neuer Flow):
   * im selben Unterordner wie das Bild (Basisname + `.json`, Req 17.37) mit den im
   * Formular eingegebenen Feldern. Das `image`-Feld wird stets auf den Bild-Dateinamen
   * (ohne Pfad) gesetzt. Es wird nicht umbenannt (bleibt der PhasePreparate überlassen).
   *
   * @throws wenn unter dem Zielpfad bereits eine Datei existiert (kein Überschreiben).
   */
  async createDraft(image: ImageEntry, fields: Wine): Promise<CreatedProvisional> {
    const path = provisionalJsonPath(image);
    if (await this.fsa.fileExists(path)) {
      throw new Error(`Es existiert bereits eine JSON-Datei für dieses Bild: ${path}`);
    }
    const wine = withImage(fields, image.name);
    const lastModified = await this.fsa.createJson(path, wine);
    return { path, wine, lastModified, image };
  }

  /**
   * Verknüpft das Bild eines Entwurfs (unbekannter Wein, noch keine eigene JSON) mit einem
   * bestehenden bildlosen Eintrag (link-image, neuer Flow, Req 17.41–17.43): Bild bei
   * Bedarf in dessen Verzeichnis verschieben, `image`-Feld setzen und schreiben. Da im
   * Entwurfs-Flow keine zweite JSON existiert, entfällt das Entfernen einer vorläufigen
   * JSON — die Invariante „genau eine JSON pro Wein" bleibt trivial erfüllt. Bei einem
   * Schreibfehler wird ein zuvor verschobenes Bild zurückgerollt.
   *
   * @param image  das Bild des Entwurfs.
   * @param target der ausgewählte bestehende bildlose Eintrag (bleibt erhalten).
   */
  async linkDraftImage(image: ImageEntry, target: WineEntry): Promise<LinkResult> {
    if (!target.wine) {
      throw new Error('Der ausgewählte Eintrag hat keinen gültigen JSON-Inhalt.');
    }
    const sameDir = segmentsEqual(image.dirSegments, target.dirSegments);
    let movedImagePath: string | null = null;
    if (!sameDir) {
      movedImagePath = await this.fsa.moveFile(image.path, target.dirSegments);
    }
    try {
      const nextWine = withImage(target.wine, image.name);
      const lastModified = await this.fsa.writeJson(target.path, nextWine);
      return { path: target.path, wine: nextWine, lastModified };
    } catch (err) {
      if (movedImagePath) {
        await this.safeMoveBack(movedImagePath, image);
      }
      throw wrapLinkError(err);
    }
  }

    /**
   * Verknüpft das angeklickte Bild mit einem bestehenden bildlosen Weineintrag
   * (link-image, Req 17.41–17.43). Als **eine zusammenhängende Operation** mit sauberem
   * Rollback-Verhalten:
   *
   * 1. Bild bei Bedarf in das Verzeichnis der JSON des bestehenden Eintrags verschieben
   *    (falls es in einem anderen Unterordner liegt, Req 17.41/17.35).
   * 2. `image`-Feld des bestehenden Eintrags auf den Bild-Dateinamen setzen und schreiben.
   * 3. Vorläufige JSON der per Bildklick angelegten Datei entfernen (Req 17.41).
   *
   * Reihenfolge und Rollback sichern die Invariante **niemals zwei JSON-Dateien für
   * denselben Wein** (Req 17.42/17.43): Die vorläufige JSON wird erst entfernt, nachdem
   * das Bild am Zielort liegt und das `image`-Feld des bestehenden Eintrags konsistent
   * geschrieben wurde. Schlägt ein Schritt davor fehl, bleibt der Ausgangszustand
   * erhalten (bereits verschobenes Bild wird zurückgerollt).
   *
   * @param provisional der per Bildklick angelegte vorläufige Eintrag (wird entfernt).
   * @param target      der ausgewählte bestehende bildlose Eintrag (bleibt erhalten).
   * @param image       das angeklickte Bild.
   */
  async linkImage(
    provisional: WineEntry,
    target: WineEntry,
    image: ImageEntry,
  ): Promise<LinkResult> {
    if (!target.wine) {
      throw new Error('Der ausgewählte Eintrag hat keinen gültigen JSON-Inhalt.');
    }

    const sameDir = segmentsEqual(image.dirSegments, target.dirSegments);
    let movedImagePath: string | null = null;

    // 1. Bild bei Bedarf in das Zielverzeichnis verschieben.
    if (!sameDir) {
      movedImagePath = await this.fsa.moveFile(image.path, target.dirSegments);
    }

    try {
      // 2. image-Feld des bestehenden Eintrags setzen und schreiben.
      const nextWine = withImage(target.wine, image.name);
      const lastModified = await this.fsa.writeJson(target.path, nextWine);

      // 3. Vorläufige JSON entfernen — erst jetzt, da das Bild am Zielort und das
      //    image-Feld konsistent geschrieben ist (Req 17.42/17.43).
      try {
        await this.fsa.removeFile(provisional.path);
      } catch (err) {
        // Die vorläufige JSON konnte nicht entfernt werden → doppelte JSON droht.
        // Den bestehenden Eintrag auf bildlos zurücksetzen und Bild zurückrollen,
        // damit kein Zustand mit doppelter JSON und zugeordnetem Bild zurückbleibt.
        await this.rollback(target, movedImagePath, image);
        throw wrapLinkError(err);
      }

      return { path: target.path, wine: nextWine, lastModified };
    } catch (err) {
      // Fehler beim Schreiben des image-Feldes: nur das ggf. verschobene Bild zurückrollen.
      if (movedImagePath) {
        await this.safeMoveBack(movedImagePath, image);
      }
      throw wrapLinkError(err);
    }
  }

  /**
   * Rollback nach fehlgeschlagenem Entfernen der vorläufigen JSON: Das `image`-Feld des
   * bestehenden Eintrags wird wieder entfernt und ein verschobenes Bild zurückbewegt,
   * sodass der Ausgangszustand (vorläufige JSON + bildloser Eintrag) wiederhergestellt
   * ist und keine doppelte Bild-Zuordnung zurückbleibt (Req 17.43).
   */
  private async rollback(
    target: WineEntry,
    movedImagePath: string | null,
    image: ImageEntry,
  ): Promise<void> {
    try {
      await this.fsa.writeJson(target.path, target.wine as Wine);
    } catch {
      // best-effort
    }
    if (movedImagePath) {
      await this.safeMoveBack(movedImagePath, image);
    }
  }

  /** Bewegt ein zuvor verschobenes Bild best-effort an seinen ursprünglichen Ort zurück. */
  private async safeMoveBack(movedImagePath: string, image: ImageEntry): Promise<void> {
    try {
      await this.fsa.moveFile(movedImagePath, image.dirSegments);
    } catch {
      // best-effort Rollback
    }
  }
}

/** Vergleicht zwei Verzeichnis-Segment-Listen auf Gleichheit. */
function segmentsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i]);
}

/** Verpackt einen Fehler mit erkennbarer Verknüpfungs-Meldung (Req 17.43). */
function wrapLinkError(err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(`Verknüpfen des Bildes fehlgeschlagen: ${detail}`);
}
