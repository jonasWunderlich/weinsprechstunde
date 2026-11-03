import { Injectable, inject } from '@angular/core';
import { FileSystemAccessService, ImageEntry, WineEntry } from './file-system-access.service';
import { entryArchiveSourcePaths } from '../models/archive';

/** Ergebnis einer erfolgreichen Archivierung (Req 17.46/17.47). */
export interface ArchiveResult {
  /** Ursprungspfade der verschobenen Dateien (in Verschiebe-Reihenfolge). */
  sourcePaths: string[];
  /** Neue Pfade der Dateien im `_archive`-Ordner. */
  archivedPaths: string[];
}

/**
 * Orchestriert die Archivierungs-Aktionen des Editors über den
 * {@link FileSystemAccessService} (Req 17.44–17.48).
 *
 * Es gibt bewusst **keine Lösch-Funktion** (Req 17.44) und **kein Dearchivieren**
 * (Req 17.50) — als einzige entfernende Aktion existiert das Verschieben nach
 * `import_dir/_archive/`.
 *
 * Fehler-/Konsistenz-Garantie (Req 17.48): Schlägt das Verschieben einer Datei fehl,
 * bleiben die betroffenen Dateien an ihrem Ursprungsort. Bei einem angelegten Eintrag
 * mit mehreren Dateien werden vor dem ersten Verschieben alle Quelldateien auf Existenz
 * geprüft; schlägt mittendrin dennoch ein Verschieben fehl, werden die bereits
 * verschobenen Dateien zurückgerollt, sodass keine inkonsistente Teilverschiebung ohne
 * Datenverlust zurückbleibt.
 *
 * Die reine Logik (welche Dateien gehören zu einem Eintrag, Reihenfolge) liegt in
 * `models/archive.ts`.
 */
@Injectable({ providedIn: 'root' })
export class ArchiveService {
  private readonly fsa = inject(FileSystemAccessService);

  /**
   * Archiviert ein ungenutztes Bild = verschiebt die Bilddatei nach `_archive`
   * (Req 17.46). Schlägt das Verschieben fehl, bleibt das Bild am Ursprungsort und der
   * Fehler wird (mit erkennbarer Meldung) weitergereicht (Req 17.48).
   */
  async archiveImage(image: ImageEntry): Promise<ArchiveResult> {
    return this.archivePaths([image.path]);
  }

  /**
   * Archiviert einen angelegten Weineintrag = verschiebt die JSON-Quelldatei zusammen mit
   * den in `image`/`audio`/`video` referenzierten Mediendateien gemeinsam nach `_archive`
   * (Req 17.47). Referenzierte Medien, die am Ursprungsort nicht (mehr) existieren, werden
   * übersprungen (der Eintrag lässt sich trotzdem archivieren); die JSON wird zuletzt
   * verschoben (Req 17.47). Bei Fehler: Rollback, keine inkonsistente Teilverschiebung
   * (Req 17.48).
   */
  async archiveEntry(entry: WineEntry): Promise<ArchiveResult> {
    const candidates = entryArchiveSourcePaths(entry);
    // Nicht (mehr) vorhandene Mediendateien überspringen; die JSON selbst (letzter
    // Eintrag) muss existieren.
    const jsonPath = entry.path;
    const sources: string[] = [];
    for (const path of candidates) {
      if (path === jsonPath || (await this.fsa.fileExists(path))) {
        sources.push(path);
      }
    }
    return this.archivePaths(sources);
  }

  /**
   * Verschiebt die angegebenen Quellpfade in den `_archive`-Ordner. Scheitert ein
   * Verschieben, werden bereits verschobene Dateien an ihren Ursprungsort zurückgerollt
   * und der Fehler mit erkennbarer Meldung geworfen (Req 17.48).
   */
  private async archivePaths(sources: string[]): Promise<ArchiveResult> {
    const moved: { source: string; archived: string }[] = [];
    try {
      for (const source of sources) {
        const archived = await this.fsa.archiveFile(source);
        moved.push({ source, archived });
      }
    } catch (err) {
      // Rollback: bereits verschobene Dateien wieder an den Ursprungsort bewegen, damit
      // keine inkonsistente Teilverschiebung zurückbleibt (Req 17.48).
      await this.rollback(moved);
      throw wrapArchiveError(err);
    }
    return {
      sourcePaths: moved.map((m) => m.source),
      archivedPaths: moved.map((m) => m.archived),
    };
  }

  /** Bewegt bereits archivierte Dateien best-effort an ihren Ursprungsort zurück. */
  private async rollback(moved: { source: string; archived: string }[]): Promise<void> {
    for (const { source, archived } of moved) {
      const destDirSegments = source.split('/').slice(0, -1);
      try {
        await this.fsa.moveFile(archived, destDirSegments);
      } catch {
        // best-effort Rollback: Konnte eine Datei nicht zurückbewegt werden, bleibt sie
        // im Archiv — es geht keine Datei verloren.
      }
    }
  }
}

/** Verpackt einen Fehler mit erkennbarer Archivierungs-Meldung (Req 17.48). */
function wrapArchiveError(err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(`Archivieren fehlgeschlagen: ${detail}`);
}
