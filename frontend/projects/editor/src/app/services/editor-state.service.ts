import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { FilterService, WineSchemaField } from '@weinsprechstunde/shared';
import { FileSystemAccessService, ImageEntry, WineEntry } from './file-system-access.service';
import { EditorWineDataService } from './editor-wine-data.service';
import { FromImageService } from './from-image.service';
import { ArchiveService } from './archive.service';
import { EditorListItem, EntryTypeFilter } from '../models/editor-list.model';
import { buildEditorList, hasAttributeFilter } from '../models/editor-list';
import { imagelessEntries } from '../models/from-image';

/**
 * Zentraler Zustand der Editor-App rund um die Eintragsliste (Req 17.6–17.15).
 *
 * Die attributbasierte Filter-/Such-/Sortierlogik stammt unverändert aus dem geteilten
 * {@link FilterService} (Req 17.11); dieser liest seine Daten aus dem
 * {@link EditorWineDataService}, den der `EditorStateService` aus dem Verzeichnis-Scan
 * befüllt.
 *
 * Zusätzlich hält die Klasse den editor-spezifischen dreiwertigen Eintragstyp-Filter
 * (Req 17.14), die Auswahl des rechts angezeigten Eintrags (Req 17.9) und die
 * Refresh-Logik (Auto-Refresh nach eigener Aktion + manueller Button, kein Polling,
 * Req 17.6/17.7).
 */
@Injectable({ providedIn: 'root' })
export class EditorStateService {
  private readonly fsa = inject(FileSystemAccessService);
  private readonly filter = inject(FilterService);
  private readonly wineData = inject(EditorWineDataService);
  private readonly fromImage = inject(FromImageService);
  private readonly archive = inject(ArchiveService);

  // ── Scan-Rohdaten ───────────────────────────────────────────────────────────
  private readonly _entries = signal<WineEntry[]>([]);
  private readonly _images = signal<ImageEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  // ── Editor-spezifischer Eintragstyp-Filter (Req 17.14) ──────────────────────────
  readonly entryType = signal<EntryTypeFilter>('all');

  // ── Auswahl des rechts angezeigten Eintrags (Req 17.9) ──────────────────────────
  private readonly _selectedId = signal<string | null>(null);
  readonly selectedId = this._selectedId.asReadonly();

  // ── from-image: per Bildklick angelegter vorläufiger Eintrag (Req 17.36–17.43) ──
  /** Pfad der aktuell per Bildklick angelegten vorläufigen JSON (oder `null`). */
  private readonly _provisionalPath = signal<string | null>(null);
  readonly provisionalPath = this._provisionalPath.asReadonly();
  /** Fehleranzeige für fehlgeschlagenes Anlegen/Verknüpfen (Req 17.43). */
  private readonly _fromImageError = signal<string | null>(null);
  readonly fromImageError = this._fromImageError.asReadonly();

  // ── Archivieren (Req 17.44–17.48) ───────────────────────────────────────────
  /** Fehleranzeige für fehlgeschlagenes Archivieren (Req 17.48). */
  private readonly _archiveError = signal<string | null>(null);
  readonly archiveError = this._archiveError.asReadonly();

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Alle (ungefilterten) Scan-Einträge inkl. defekter JSONs. */
  readonly entries = this._entries.asReadonly();
  readonly images = this._images.asReadonly();

  /** Angelegte Weine (gültige JSONs); gespiegelt aus dem letzten Scan. */
  readonly wines = this.wineData.wines.asReadonly();

  /**
   * Die endgültig anzuzeigende Liste: angelegte Weine aus dem geteilten
   * `FilterService` (gefiltert + sortiert) gemischt mit unbekannten Weinen gemäß
   * Eintragstyp-Filter und Standardsortierung (Req 17.10/17.12).
   */
  readonly listItems = computed<EditorListItem[]>(() => {
    const mixByDate = this.filter.sortOption() === 'tasting_date_desc';
    return buildEditorList(
      this.filter.filteredWines(),
      this._entries(),
      this._images(),
      this.entryType(),
      mixByDate,
    );
  });

  /** Der aktuell rechts im WineEditor angezeigte Eintrag (Req 17.9). */
  readonly selectedItem = computed<EditorListItem | null>(() => {
    const id = this._selectedId();
    if (id === null) return null;
    return this.listItems().find((i) => i.id === id) ?? null;
  });

  /**
   * `true`, wenn der aktuell ausgewählte Eintrag der soeben per Bildklick angelegte
   * vorläufige Eintrag ist. Nur dann bietet das `name`-Feld das Autocomplete bildloser
   * Einträge und die zwei Eingabewege (Req 17.38/17.39).
   */
  readonly isProvisionalSelected = computed<boolean>(() => {
    const path = this._provisionalPath();
    return path !== null && this._selectedId() === path;
  });

  /**
   * Vorschläge für das `name`-Autocomplete eines per Bildklick angelegten Eintrags:
   * alle bestehenden bildlosen Weineinträge (ohne gesetztes `image`-Feld), ohne den
   * vorläufigen Eintrag selbst (Req 17.38).
   */
  readonly imagelessSuggestions = computed<WineEntry[]>(() =>
    imagelessEntries(this._entries(), this._provisionalPath() ?? undefined),
  );

  constructor() {
    // Auto-Umschalten „Nur unbekannte" → „Nur angelegte", sobald ein attributbasierter
    // Filter gesetzt wird (Req 17.15): unbekannte Weine besitzen keine solchen Attribute.
    effect(() => {
      const active = hasAttributeFilter(this.filter.filter());
      if (active && untracked(() => this.entryType()) === 'unknown') {
        this.entryType.set('created');
      }
    });
  }

  /** Setzt das WineSchema (wird beim App-Start geladen, Req 18.5). */
  setSchema(schema: WineSchemaField[]): void {
    this.wineData.schema.set(schema);
  }

  /** Setzt den Eintragstyp-Filter (Req 17.14). */
  setEntryType(type: EntryTypeFilter): void {
    this.entryType.set(type);
  }

  /** Wählt einen Listeneintrag aus; defekte JSONs sind nicht auswählbar (Req 17.26). */
  select(item: EditorListItem | null): void {
    if (item && item.kind === 'created' && item.broken) return;
    const id = item ? item.id : null;
    // Verlässt der Benutzer den per Bildklick angelegten vorläufigen Eintrag, endet der
    // from-image-Modus (das name-Autocomplete der zwei Wege gilt nur für diesen Eintrag).
    if (id !== this._provisionalPath()) {
      this._provisionalPath.set(null);
    }
    this._fromImageError.set(null);
    this._archiveError.set(null);
    this._selectedId.set(id);
  }

  /**
   * Lädt die Liste neu durch erneuten Verzeichnis-Scan (manueller Aktualisieren-Button
   * sowie Auto-Refresh nach eigener Aktion, Req 17.6/17.7). Es findet kein Polling statt.
   */
  async refresh(): Promise<void> {
    if (!this.fsa.hasAccess()) return;
    this._loading.set(true);
    this._error.set(null);
    try {
      const result = await this.fsa.scan();
      this._entries.set(result.entries);
      this._images.set(result.images);
      // Angelegte Weine (gültige JSONs) an den geteilten FilterService weiterreichen.
      this.wineData.wines.set(
        result.entries.filter((e) => e.wine !== null && !e.broken).map((e) => e.wine!),
      );
      // Auswahl beibehalten, falls der Eintrag noch existiert; sonst zurücksetzen.
      const id = this._selectedId();
      if (id !== null && !this.listItems().some((i) => i.id === id)) {
        this._selectedId.set(null);
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this._loading.set(false);
    }
  }

  /** Setzt alle attributbasierten Filter zurück (delegiert an den FilterService). */
  clearFilters(): void {
    this.filter.clearAllFilters();
  }

  /** Setzt die from-image-Fehleranzeige zurück. */
  clearFromImageError(): void {
    this._fromImageError.set(null);
  }

  /** Setzt die Archivierungs-Fehleranzeige zurück. */
  clearArchiveError(): void {
    this._archiveError.set(null);
  }

  /**
   * Archiviert ein ungenutztes Bild (unbekannter Wein): verschiebt die Bilddatei nach
   * `_archive` (Req 17.46), setzt die Auswahl zurück und lädt die Liste neu (Auto-Refresh
   * nach eigener Aktion, Req 17.6). Bei Fehler bleibt die Datei am Ursprungsort und es
   * wird eine erkennbare Fehleranzeige gesetzt (Req 17.48); Auswahl und Liste bleiben
   * unverändert.
   */
  async archiveImage(image: ImageEntry): Promise<void> {
    this._archiveError.set(null);
    try {
      await this.archive.archiveImage(image);
      this.resetSelectionAfterArchive();
      await this.refresh();
    } catch (err) {
      this._archiveError.set(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Archiviert einen angelegten Weineintrag: verschiebt die JSON-Quelldatei zusammen mit
   * den referenzierten `image`/`audio`/`video`-Mediendateien gemeinsam nach `_archive`
   * (Req 17.47), setzt die Auswahl zurück und lädt die Liste neu (Req 17.6). Bei Fehler
   * bleiben die betroffenen Dateien am Ursprungsort und es wird eine erkennbare
   * Fehleranzeige gesetzt (Req 17.48); Auswahl und Liste bleiben unverändert.
   */
  async archiveEntry(entry: WineEntry): Promise<void> {
    this._archiveError.set(null);
    try {
      await this.archive.archiveEntry(entry);
      this.resetSelectionAfterArchive();
      await this.refresh();
    } catch (err) {
      this._archiveError.set(err instanceof Error ? err.message : String(err));
    }
  }

  /** Setzt nach erfolgreicher Archivierung Auswahl und from-image-Modus zurück. */
  private resetSelectionAfterArchive(): void {
    this._selectedId.set(null);
    this._provisionalPath.set(null);
    this._fromImageError.set(null);
  }

  /**
   * Legt per Klick auf das Bild eines unbekannten Weins eine vorläufige JSON-Quelldatei
   * an (Req 17.36/17.37), lädt die Liste neu (Auto-Refresh, Req 17.6) und öffnet den
   * WineEditor für den neuen Eintrag (Req 17.36). Bei Fehler wird eine erkennbare
   * Fehleranzeige gesetzt (Req 17.43) und keine Auswahl geändert.
   */
  async createFromImage(image: ImageEntry): Promise<void> {
    this._fromImageError.set(null);
    try {
      const created = await this.fromImage.createFromImage(image, this.wineData.schema());
      await this.refresh();
      // Auswahl auf den resultierenden (vorläufigen) Eintrag setzen und als „provisorisch"
      // markieren, damit das name-Autocomplete die zwei Eingabewege anbietet (Req 17.38/17.39).
      this._provisionalPath.set(created.path);
      this._selectedId.set(created.path);
    } catch (err) {
      this._fromImageError.set(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Verknüpft (link-image) den aktuell per Bildklick angelegten vorläufigen Eintrag mit
   * einem ausgewählten bestehenden bildlosen Eintrag (Req 17.41): entfernt die vorläufige
   * JSON, setzt das `image`-Feld des bestehenden Eintrags, verschiebt das Bild bei Bedarf
   * und zeigt fortan den bestehenden Eintrag an. Bei Fehler bleibt ein Zustand ohne
   * doppelte JSON zurück und es wird eine erkennbare Fehleranzeige gesetzt (Req 17.43).
   *
   * @param targetPath Pfad der JSON des ausgewählten bestehenden bildlosen Eintrags.
   */
  async linkToExisting(targetPath: string): Promise<void> {
    this._fromImageError.set(null);
    const provisionalPath = this._provisionalPath();
    if (provisionalPath === null) return;

    const entries = this._entries();
    const provisional = entries.find((e) => e.path === provisionalPath);
    const target = entries.find((e) => e.path === targetPath);
    if (!provisional || !target) {
      this._fromImageError.set('Der zu verknüpfende Eintrag wurde nicht gefunden.');
      return;
    }
    // Das zum vorläufigen Eintrag gehörende Bild aus dem Bild-Listing auflösen.
    const imageName =
      typeof provisional.wine?.image === 'string' ? provisional.wine.image : null;
    const image = this._images().find(
      (i) => i.name === imageName && segmentsEqual(i.dirSegments, provisional.dirSegments),
    );
    if (!image) {
      this._fromImageError.set('Das zugehörige Bild wurde nicht gefunden.');
      return;
    }

    try {
      const result = await this.fromImage.linkImage(provisional, target, image);
      this._provisionalPath.set(null);
      await this.refresh();
      // Fortan den bestehenden (nun verknüpften) Eintrag anzeigen und bearbeiten (Req 17.41).
      this._selectedId.set(result.path);
    } catch (err) {
      this._fromImageError.set(err instanceof Error ? err.message : String(err));
      // Rollback hat den Ausgangszustand wiederhergestellt; Liste neu laden, damit die
      // Ansicht konsistent bleibt (vorläufiger Eintrag bleibt ausgewählt).
      await this.refresh();
    }
  }
}

/** Vergleicht zwei Verzeichnis-Segment-Listen auf Gleichheit. */
function segmentsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i]);
}
