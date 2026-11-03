import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { FilterService, Wine, WineSchemaField } from '@weinsprechstunde/shared';
import { FileSystemAccessService, ImageEntry, WineEntry } from './file-system-access.service';
import { EditorWineDataService } from './editor-wine-data.service';
import { FromImageService } from './from-image.service';
import { ArchiveService } from './archive.service';
import { EditorListItem, EntryTypeFilter } from '../models/editor-list.model';
import {
  buildEditorList,
  hasAttributeFilter,
  toCreatedListItem,
  toUnknownListItem,
} from '../models/editor-list';
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

  // ── Entwurf (unbekannter Wein, noch keine JSON) ─────────────────────────────
  /**
   * Das aus dem EXIF/Dateidatum ermittelte `tasting_date` (ISO) des aktuell als Entwurf
   * geöffneten unbekannten Weins, zum Vorbefüllen des Formulars. `null`, solange nichts
   * ermittelt wurde oder kein Entwurf offen ist. Wird beim Auswählen eines unbekannten
   * Eintrags asynchron geladen.
   */
  private readonly _draftTastingDate = signal<string | null>(null);
  readonly draftTastingDate = this._draftTastingDate.asReadonly();
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

  /**
   * Der aktuell rechts im WineEditor angezeigte Eintrag (Req 17.9).
   *
   * Bewusst aus den **rohen** Scan-Daten (`_entries`/`_images`) aufgelöst, NICHT aus der
   * gefilterten `listItems()`: Was im Editor geöffnet ist, hängt nicht vom Listenfilter
   * ab. So bleibt ein frisch angelegter Wein geöffnet, auch wenn der Eintragstyp-Filter
   * (z. B. „Nur unbekannte") ihn in der Liste gerade ausblenden würde.
   */
  readonly selectedItem = computed<EditorListItem | null>(() => {
    const id = this._selectedId();
    if (id === null) return null;
    const entry = this._entries().find((e) => e.path === id);
    if (entry) return toCreatedListItem(entry);
    const image = this._images().find((i) => i.path === id && !i.assigned);
    if (image) return toUnknownListItem(image);
    return null;
  });

  /**
   * `true`, wenn gerade ein unbekannter Wein als **Entwurf** geöffnet ist (Bild ohne
   * JSON). In diesem Modus zeigt der WineEditor das vollständige Formular, schreibt aber
   * nichts, solange kein Name eingetragen ist; das `name`-Feld bietet das Autocomplete
   * bildloser Einträge und die zwei Eingabewege (neuer Name anlegen / bestehenden
   * verknüpfen, Req 17.38/17.39/17.40/17.41).
   */
  readonly isDraftSelected = computed<boolean>(() => this.selectedItem()?.kind === 'unknown');

  /** Das Bild des aktuell geöffneten Entwurfs (unbekannter Wein) oder `null`. */
  readonly draftImage = computed<ImageEntry | null>(() => {
    const item = this.selectedItem();
    return item && item.kind === 'unknown' ? item.image : null;
  });

  /**
   * Vorschläge für das `name`-Autocomplete eines Entwurfs: alle bestehenden bildlosen
   * Weineinträge (ohne gesetztes `image`-Feld), damit man ein Bild einem bestehenden
   * Eintrag zuordnen kann (Req 17.38).
   */
  readonly imagelessSuggestions = computed<WineEntry[]>(() => imagelessEntries(this._entries()));

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

  /**
   * Wählt einen Listeneintrag aus; defekte JSONs sind nicht auswählbar (Req 17.26).
   *
   * Für einen unbekannten Wein (Bild ohne JSON) wird KEINE JSON angelegt — der Editor
   * zeigt stattdessen das vollständige Formular als Entwurf, vorbefüllt mit Bild und
   * (asynchron geladenem) EXIF-`tasting_date`. Die JSON entsteht erst, sobald ein Name
   * eingetragen wird (siehe {@link commitDraft}).
   */
  select(item: EditorListItem | null): void {
    if (item && item.kind === 'created' && item.broken) return;
    const id = item ? item.id : null;
    this._fromImageError.set(null);
    this._archiveError.set(null);
    this._draftTastingDate.set(null);
    this._selectedId.set(id);

    // Für einen unbekannten Wein das EXIF-/Dateidatum zum Vorbefüllen laden (best effort).
    if (item && item.kind === 'unknown') {
      const imagePath = item.image.path;
      void this.fsa
        .readImageExifDate(imagePath)
        .then((date) => {
          // Nur übernehmen, wenn noch derselbe Entwurf offen ist.
          if (this._selectedId() === id) this._draftTastingDate.set(date);
        })
        .catch(() => {
          /* best effort: ohne Datum weiter */
        });
    }
  }

  /**
   * Navigiert mit den Pfeiltasten durch die (gefilterte, sortierte) Liste: `delta = 1`
   * wählt den nächsten, `delta = -1` den vorherigen Eintrag in der Reihenfolge von
   * {@link listItems}. Nicht auswählbare (defekte) Einträge werden übersprungen. Ohne
   * aktuelle Auswahl wählt `delta >= 0` den ersten, `delta < 0` den letzten auswählbaren
   * Eintrag. Am Rand bleibt die Auswahl stehen (kein Wrap).
   */
  selectRelative(delta: number): void {
    const items = this.listItems();
    if (items.length === 0) return;

    const selectable = (i: EditorListItem): boolean => !(i.kind === 'created' && i.broken);
    const id = this._selectedId();
    const currentIndex = id === null ? -1 : items.findIndex((i) => i.id === id);

    let index: number;
    if (currentIndex === -1) {
      // Keine (sichtbare) Auswahl: beim ersten bzw. letzten Eintrag beginnen.
      index = delta >= 0 ? 0 : items.length - 1;
    } else {
      index = currentIndex + (delta >= 0 ? 1 : -1);
    }

    // In Laufrichtung den nächsten auswählbaren Eintrag suchen; am Rand anhalten.
    const step = delta >= 0 ? 1 : -1;
    while (index >= 0 && index < items.length) {
      if (selectable(items[index])) {
        this.select(items[index]);
        return;
      }
      index += step;
    }
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
      // Auswahl beibehalten, solange der geöffnete Eintrag im Scan noch existiert
      // (unabhängig vom Listenfilter — der Editor zeigt auch gefilterte Einträge weiter).
      const id = this._selectedId();
      const stillExists =
        id !== null &&
        (result.entries.some((e) => e.path === id) ||
          result.images.some((i) => i.path === id && !i.assigned));
      if (id !== null && !stillExists) {
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

  /** Setzt nach erfolgreicher Archivierung Auswahl und Entwurfszustand zurück. */
  private resetSelectionAfterArchive(): void {
    this._selectedId.set(null);
    this._draftTastingDate.set(null);
    this._fromImageError.set(null);
  }

  /**
   * Legt die JSON eines zuvor als Entwurf geöffneten unbekannten Weins an, sobald ein
   * Name eingetragen wurde (neuer Flow, Req 17.36/17.37/17.40). Die JSON entsteht im
   * selben Unterordner wie das Bild (Basisname des Bildes + `.json`) mit den im Formular
   * eingegebenen Feldern; `image` wird auf den Bild-Dateinamen gesetzt. Danach lädt die
   * Liste neu und der neu angelegte Eintrag wird ausgewählt (Auto-Refresh, Req 17.6).
   * Bei Fehler wird eine erkennbare Fehleranzeige gesetzt und keine Auswahl geändert.
   *
   * @param image  das Bild des unbekannten Weins (Entwurf).
   * @param fields die im Formular eingegebenen Feldwerte (bereits typkonvertiert/gemischt).
   */
  async commitDraft(image: ImageEntry, fields: Wine): Promise<void> {
    this._fromImageError.set(null);
    try {
      const created = await this.fromImage.createDraft(image, fields);
      await this.refresh();
      this._draftTastingDate.set(null);
      this._selectedId.set(created.path);
    } catch (err) {
      this._fromImageError.set(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Verknüpft (link-image) den aktuell als Entwurf geöffneten unbekannten Wein mit einem
   * bestehenden bildlosen Eintrag (Req 17.41): setzt dessen `image`-Feld, verschiebt das
   * Bild bei Bedarf in dessen Verzeichnis und zeigt fortan den bestehenden Eintrag an.
   * Es wird KEINE neue JSON angelegt → genau eine JSON pro Wein (Req 17.42/17.43). Bei
   * Fehler bleibt der Ausgangszustand erhalten und es wird eine Fehleranzeige gesetzt.
   *
   * @param image      das Bild des Entwurfs.
   * @param targetPath Pfad der JSON des ausgewählten bestehenden bildlosen Eintrags.
   */
  async linkDraftToExisting(image: ImageEntry, targetPath: string): Promise<void> {
    this._fromImageError.set(null);
    const target = this._entries().find((e) => e.path === targetPath);
    if (!target || !target.wine) {
      this._fromImageError.set('Der zu verknüpfende Eintrag wurde nicht gefunden.');
      return;
    }
    try {
      const result = await this.fromImage.linkDraftImage(image, target);
      await this.refresh();
      this._draftTastingDate.set(null);
      this._selectedId.set(result.path);
    } catch (err) {
      this._fromImageError.set(err instanceof Error ? err.message : String(err));
      await this.refresh();
    }
  }
}

/** Vergleicht zwei Verzeichnis-Segment-Listen auf Gleichheit. */
function segmentsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i]);
}
