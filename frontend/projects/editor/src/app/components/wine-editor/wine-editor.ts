import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Wine, WineSchemaField, distinctValuesForField, isPresent } from '@weinsprechstunde/shared';
import { EditorStateService } from '../../services/editor-state.service';
import { EditorWineDataService } from '../../services/editor-wine-data.service';
import { EditorSaveService } from '../../services/editor-save.service';
import {
  FileSystemAccessService,
  MediaEntry,
  MediaKind,
} from '../../services/file-system-access.service';
import {
  convertNumberField,
  parseGrapeTags,
  unknownFieldKeys,
} from '../../models/wine-field-conversion';
import { CreatedListItem } from '../../models/editor-list.model';
import { ImagePickerComponent } from '../image-picker/image-picker';
import { EntryThumbnailComponent } from '../entry-thumbnail/entry-thumbnail';

/**
 * Art des Eingabefeldes, das aus einem WineSchema-Feld abgeleitet wird (Req 17.16–17.19).
 */
type FieldKind =
  | 'date'
  | 'rating'
  | 'number'
  | 'chips'
  | 'dropdown'
  | 'media'
  | 'image'
  | 'text';

/** Ein vorbereitetes Eingabefeld des Formulars. */
interface EditorField {
  schema: WineSchemaField;
  kind: FieldKind;
  /** Für `media`-Felder: welcher Picker (audio/video). */
  mediaKind?: MediaKind;
  /** Für dropdown/text-Autocomplete: Vorschlagswerte aus den vorhandenen Einträgen. */
  suggestions: string[];
}

/**
 * Das vollständige WineEditor-Formular (Task 28.1, Req 17.16–17.27).
 *
 * Das Formular wird **dynamisch** aus dem WineSchema erzeugt (Req 18.6): Jedes
 * Schema-Feld bekommt ein typgerechtes Eingabefeld (Datepicker für `tasting_date`,
 * Rating-Zahleneingabe 1.0–10.0 Step 0.1, Dropdown/Chips mit Autocomplete aus den
 * vorhandenen Einträgen, Audio-/Video-Picker). Schema-fremde Felder werden zusätzlich
 * angezeigt und beim Speichern erhalten (Req 17.27).
 *
 * Der eigentliche Live-Auto-Save (500-ms-Debounce pro Feld, Typkonvertierung,
 * Konflikterkennung, Speicherstatus) liegt im {@link EditorSaveService}; diese
 * Komponente konvertiert Eingaben und reicht sie dorthin durch.
 */
@Component({
  selector: 'app-wine-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ImagePickerComponent, EntryThumbnailComponent],
  providers: [EditorSaveService],
  templateUrl: './wine-editor.html',
  styleUrl: './wine-editor.scss',
})
export class WineEditorComponent {
  readonly state = inject(EditorStateService);
  private readonly wineData = inject(EditorWineDataService);
  private readonly save = inject(EditorSaveService);
  private readonly fsa = inject(FileSystemAccessService);

  readonly isPresent = isPresent;

  /** Speicherstatus-Indikator (Req 17.23/17.24). */
  readonly saveState = this.save.state;

  /** Der aktuell bearbeitete angelegte Eintrag, sofern auswählbar. */
  readonly created = computed<CreatedListItem | null>(() => {
    const item = this.state.selectedItem();
    if (item && item.kind === 'created' && !item.broken && item.wine) return item;
    return null;
  });

  /**
   * `true`, wenn ein unbekannter Wein als Entwurf geöffnet ist (Bild ohne JSON). Dann
   * zeigt der Editor das vollständige Formular, schreibt aber nichts, solange kein Name
   * eingetragen ist (neuer Flow).
   */
  readonly isDraft = this.state.isDraftSelected;

  /** Das Bild des aktuell geöffneten Entwurfs (oder `null`). */
  readonly draftImage = this.state.draftImage;

  /**
   * `true`, wenn ein editierbares Formular angezeigt werden soll: entweder ein gültiger
   * angelegter Eintrag oder ein Entwurf (unbekannter Wein).
   */
  readonly editing = computed<boolean>(() => this.created() !== null || this.isDraft());

  /** Lokaler, editierbarer Arbeitsstand der Feldwerte (als String bzw. Chips-Array). */
  private readonly values = signal<Record<string, string | string[]>>({});

  /** Schema-fremde Felder (als JSON-serialisierte Rohwerte zur Anzeige). */
  readonly extraFields = signal<{ key: string; value: string }[]>([]);

  /** Mediendateien je Picker-Typ (lazy geladen). */
  readonly audioFiles = signal<MediaEntry[]>([]);
  readonly videoFiles = signal<MediaEntry[]>([]);

  /** Die aus dem WineSchema abgeleiteten Eingabefelder (Req 17.16/18.6). */
  readonly fields = computed<EditorField[]>(() => {
    const schema = this.wineData.schema();
    const wines = this.wineData.wines();
    return schema.map((f) => this.toField(f, wines));
  });

  /** `true`, wenn der Eintrag/Entwurf kein nicht-leeres `name`-Feld hat (Req 17.20). */
  readonly incomplete = computed(() => {
    if (this.isDraft()) return !isPresent(this.values()['name']);
    const item = this.created();
    return item ? item.incomplete : false;
  });

  /**
   * Alias für {@link isDraft}: nur im Entwurfsmodus bietet das `name`-Feld die zwei
   * Eingabewege und das Autocomplete bildloser Einträge (Req 17.38/17.39/17.40/17.41).
   */
  readonly isProvisional = this.state.isDraftSelected;

  /** from-image-Fehleranzeige (Req 17.43). */
  readonly fromImageError = this.state.fromImageError;

  /** Archivierungs-Fehleranzeige (Req 17.48). */
  readonly archiveError = this.state.archiveError;

  /**
   * Vorschläge für das `name`-Autocomplete eines per Bildklick angelegten Eintrags:
   * bestehende bildlose Weineinträge als `{ name, path }` (Req 17.38). Gleichnamige
   * Einträge werden über den Pfad eindeutig gehalten.
   */
  readonly imagelessSuggestions = computed(() =>
    this.state
      .imagelessSuggestions()
      .map((e) => ({ name: isPresent(e.wine?.name) ? String(e.wine?.name) : e.name, path: e.path }))
      .filter((s) => s.name.trim() !== ''),
  );

  constructor() {
    // Bei jedem Eintragswechsel: Save-Service initialisieren und Formular mit den
    // geladenen Werten befüllen (Req 17.9). Defekte JSONs sind nicht auswählbar, daher
    // erreicht uns hier immer ein gültiges Wine-Objekt.
    effect(() => {
      // Entwurf (unbekannter Wein): vollständiges Formular, vorbefüllt mit Bild und
      // (asynchron geladenem) EXIF-Datum; es wird nichts geschrieben, bis ein Name da ist.
      if (this.isDraft()) {
        const img = this.draftImage();
        const date = this.state.draftTastingDate();
        this.loadDraft(img ? img.name : '', date);
        return;
      }
      const item = this.created();
      if (!item || !item.wine) {
        this.values.set({});
        this.extraFields.set([]);
        return;
      }
      this.loadEntry(item);
    });
  }

  // ── Formular-Aufbau ─────────────────────────────────────────────────────────

  private loadEntry(item: CreatedListItem): void {
    const wine = item.wine as Wine;
    const schema = this.wineData.schema();
    this.save.init(item.entry.path, wine, item.entry.lastModified, schema);

    const next: Record<string, string | string[]> = {};
    for (const f of schema) {
      const raw = wine[f.field];
      if (f.field === 'grape') {
        next[f.field] = Array.isArray(raw) ? raw.map(String) : isPresent(raw) ? [String(raw)] : [];
      } else {
        next[f.field] = isPresent(raw) ? String(raw) : '';
      }
    }
    this.values.set(next);

    // Schema-fremde Felder anzeigen (Req 17.27).
    const extras = unknownFieldKeys(wine, schema).map((key) => ({
      key,
      value: this.stringifyExtra(wine[key]),
    }));
    this.extraFields.set(extras);
  }

  /**
   * Befüllt das Formular für einen Entwurf (unbekannter Wein, noch keine JSON): alle
   * Schema-Felder leer, außer `image` (Bild-Dateiname) und `tasting_date` (EXIF/Dateidatum).
   * Der Save-Service wird NICHT initialisiert — es wird erst geschrieben, wenn ein Name
   * eingetragen wird (siehe {@link onProvisionalNameInput}).
   */
  private loadDraft(imageName: string, tastingDate: string | null): void {
    const schema = this.wineData.schema();
    const next: Record<string, string | string[]> = {};
    for (const f of schema) {
      if (f.field === 'grape') next[f.field] = [];
      else if (f.field === 'image') next[f.field] = imageName;
      else if (f.field === 'tasting_date') next[f.field] = tastingDate ?? '';
      else next[f.field] = '';
    }
    this.values.set(next);
    this.extraFields.set([]);
  }

  private stringifyExtra(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  }

  private toField(f: WineSchemaField, wines: Wine[]): EditorField {
    const kind = this.fieldKind(f);
    const suggestions =
      kind === 'dropdown' || kind === 'chips' || kind === 'text'
        ? distinctValuesForField(wines, f.field)
        : [];
    const mediaKind: MediaKind | undefined =
      f.field === 'audio' ? 'audio' : f.field === 'video' ? 'video' : undefined;
    return { schema: f, kind, mediaKind, suggestions };
  }

  private fieldKind(f: WineSchemaField): FieldKind {
    if (f.field === 'tasting_date' || f.type === 'date') return 'date';
    if (f.field === 'rating') return 'rating';
    if (f.field === 'image') return 'image';
    if (f.field === 'audio' || f.field === 'video') return 'media';
    if (f.type === 'number') return 'number';
    if (f.field === 'grape' || f.type === 'multi-value') return 'chips';
    if (f.filter_type === 'dropdown' || f.filter_type === 'multi-select') return 'dropdown';
    return 'text';
  }

  // ── Template-Zugriffe ──────────────────────────────────────────────────────

  value(field: string): string {
    const v = this.values()[field];
    return typeof v === 'string' ? v : '';
  }

  chips(field: string): string[] {
    const v = this.values()[field];
    return Array.isArray(v) ? v : [];
  }

  /** Eindeutige `datalist`-ID je Feld. */
  listId(field: string): string {
    return `wine-editor-list-${field}`;
  }

  /**
   * `true`, wenn ein Feld im Entwurfsmodus gesperrt ist: Solange noch keine JSON existiert,
   * sind alle Felder außer `name` readonly/disabled. Erst nach dem Anlegen (Name gesetzt
   * + Button) sind sie editierbar.
   */
  isFieldLocked(field: string): boolean {
    return this.isDraft() && field !== 'name';
  }

  // ── Eingabe-Handler ────────────────────────────────────────────────────────

  /**
   * Behandelt eine Texteingabe (Text-/Dropdown-/number-/rating-/date-Felder). Der Wert
   * wird lokal gehalten und ein debouncter Auto-Save geplant (Req 17.21). number-Felder
   * werden typkonvertiert (Req 17.22).
   */
  onInput(field: EditorField, raw: string): void {
    this.values.update((v) => ({ ...v, [field.schema.field]: raw }));
    // Im Entwurfsmodus nur lokal halten — es gibt noch keine JSON (wird beim Namen angelegt).
    if (this.isDraft()) return;
    const value = this.convertForSave(field, raw);
    this.save.scheduleFieldSave(field.schema.field, value);
  }

  /**
   * Behandelt die Eingabe im `name`-Feld eines Entwurfs. Tippen legt NICHTS an und löst
   * KEIN Verknüpfen aus — der Wert wird nur lokal gehalten (und per Autocomplete
   * ergänzt). Das Anlegen passiert erst manuell über {@link commitDraftManually}
   * (Button), wenn ein Name eingetragen ist.
   *
   * Für einen regulären angelegten Eintrag (kein Entwurf) verhält sich das Namensfeld wie
   * jedes andere Feld (normaler Auto-Save).
   */
  onProvisionalNameInput(field: EditorField, raw: string): void {
    if (this.isDraft()) {
      // Entwurf: nur lokal halten, nichts anlegen/verknüpfen.
      this.values.update((v) => ({ ...v, [field.schema.field]: raw }));
      return;
    }
    this.onInput(field, raw);
  }

  /**
   * `true`, wenn ein Entwurf mit nicht-leerem Namen vorliegt — nur dann ist das manuelle
   * Anlegen über {@link commitDraftManually} möglich.
   */
  readonly canCreateDraft = computed<boolean>(
    () => this.isDraft() && isPresent(this.values()['name']),
  );

  /**
   * Legt den Entwurf manuell an (Button „Wein anlegen"). Deckt beide Wege ab:
   * entspricht der eingegebene Name exakt einem bestehenden bildlosen Wein, wird das Bild
   * mit diesem verknüpft (link-image); andernfalls wird eine neue JSON angelegt. Erst
   * dieser Aufruf schreibt — das Tippen tut es nicht.
   */
  async commitDraftManually(): Promise<void> {
    const image = this.draftImage();
    const name = this.value('name').trim();
    if (!image || name === '') return;

    const matches = this.imagelessSuggestions().filter((s) => s.name === name);
    if (matches.length === 1) {
      await this.state.linkDraftToExisting(image, matches[0].path);
      return;
    }
    await this.state.commitDraft(image, this.draftWineFromForm(name));
  }

  /**
   * Baut aus dem aktuellen Formularstand den anzulegenden Wein eines Entwurfs: alle
   * Schema-Felder typkonvertiert (number/rating), `grape` als Array, leere Textfelder
   * weggelassen; `name` wird gesetzt. `image`/`tasting_date` stammen aus der Vorbefüllung.
   */
  private draftWineFromForm(name: string): Wine {
    const wine: Record<string, unknown> = {};
    for (const f of this.fields()) {
      const key = f.schema.field;
      if (key === 'name') continue;
      const raw = this.values()[key];
      if (f.kind === 'chips') {
        const arr = Array.isArray(raw) ? raw : parseGrapeTags(typeof raw === 'string' ? raw : '');
        if (arr.length > 0) wine[key] = arr;
        continue;
      }
      const converted = this.convertForSave(f, typeof raw === 'string' ? raw : '');
      // null = leeres Feld (weglassen), undefined = nicht konvertierbar (weglassen).
      if (converted !== null && converted !== undefined) wine[key] = converted;
    }
    wine['name'] = name;
    return wine as Wine;
  }

  /** Fügt einen Grape-Tag hinzu (Req 17.18) und speichert das Array sofort. */
  addChip(field: string, raw: string): void {
    const tag = raw.trim();
    if (tag === '') return;
    const current = this.chips(field);
    if (current.includes(tag)) return;
    const next = [...current, tag];
    this.values.update((v) => ({ ...v, [field]: next }));
    if (this.isDraft()) return;
    this.save.scheduleFieldSave(field, next);
  }

  /** Entfernt einen Grape-Tag (Req 17.18). */
  removeChip(field: string, tag: string): void {
    const next = this.chips(field).filter((t) => t !== tag);
    this.values.update((v) => ({ ...v, [field]: next }));
    if (this.isDraft()) return;
    this.save.scheduleFieldSave(field, next);
  }

  /**
   * Konvertiert einen Rohwert in den zu speichernden Wert gemäß Feldart (Req 17.22):
   * number/rating per {@link convertNumberField}; leere Texte → `null` (Feld geleert);
   * nicht konvertierbare Zahlen → `undefined` (Rohwert bleibt im Formular, kein Schreiben).
   */
  private convertForSave(field: EditorField, raw: string): unknown {
    if (field.kind === 'number' || field.kind === 'rating') {
      const result = convertNumberField(raw, field.schema.decimals);
      return result.ok ? result.value : undefined;
    }
    if (field.kind === 'chips') {
      return parseGrapeTags(raw);
    }
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  }

  // ── Medien-Picker (audio/video, Req 17.19) ─────────────────────────────────

  /** Öffnet/lädt die Medienliste für einen Picker. */
  async loadMedia(kind: MediaKind): Promise<void> {
    const files = await this.fsa.listMedia(kind);
    if (kind === 'audio') this.audioFiles.set(files);
    else this.videoFiles.set(files);
  }

  /** Übernimmt den Dateinamen der ausgewählten Mediendatei in das Feld (Req 17.19/17.35). */
  pickMedia(field: string, entry: MediaEntry): void {
    this.values.update((v) => ({ ...v, [field]: entry.name }));
    if (this.isDraft()) return;
    this.save.scheduleFieldSave(field, entry.name);
  }

  /** Entfernt die Medien-Zuordnung eines Feldes. */
  clearMedia(field: string): void {
    this.values.update((v) => ({ ...v, [field]: '' }));
    if (this.isDraft()) return;
    this.save.scheduleFieldSave(field, null);
  }

  // ── ImagePicker (Req 17.28–17.35) ──────────────────────────────────────────

  /** Bild-Listing aus dem Verzeichnis-Scan (Datengrundlage des ImagePicker). */
  readonly images = this.state.images;

  /**
   * Relativer Pfad des Bildes des aktuell gepflegten Eintrags für die große
   * Bildvorschau im WineEditor-Kopf. Für unbekannte Weine das Bild selbst; für
   * angelegte Weine das im `image`-Feld referenzierte Bild (live aus dem Formular,
   * damit die Vorschau direkt nach einer Bildauswahl aktualisiert), aufgelöst im
   * Verzeichnis der JSON-Quelldatei. `null`, wenn kein Bild gesetzt ist.
   */
  readonly previewPath = computed<string | null>(() => {
    const item = this.state.selectedItem();
    if (!item) return null;
    if (item.kind === 'unknown') return item.image.path;
    const image = this.value('image');
    if (!isPresent(image)) return null;
    return [...item.entry.dirSegments, image].join('/');
  });

  /**
   * Übernimmt den Dateinamen (ohne Pfad) des im ImagePicker gewählten Bildes in das
   * `image`-Feld und speichert über denselben Auto-Save-Weg wie die übrigen Felder
   * (Req 17.34/17.35).
   */
  pickImage(name: string): void {
    this.values.update((v) => ({ ...v, image: name }));
    if (this.isDraft()) return;
    this.save.scheduleFieldSave('image', name);
  }

  /** Entfernt die Bild-Zuordnung des `image`-Feldes. */
  clearImage(): void {
    this.values.update((v) => ({ ...v, image: '' }));
    if (this.isDraft()) return;
    this.save.scheduleFieldSave('image', null);
  }

  // ── Bildauswahl-Dialog (Req 17.28–17.35) ───────────────────────────────────

  /** Ob der große Bildauswahl-Dialog geöffnet ist. */
  private readonly _imagePickerOpen = signal(false);
  readonly imagePickerOpen = this._imagePickerOpen.asReadonly();

  /**
   * Titel des Bildauswahl-Dialogs: der Name des gerade gepflegten Weins, damit sich das
   * Etikett auf der Flasche mit dem Eintrag abgleichen lässt. Ohne Namen ein neutraler
   * Platzhalter.
   */
  readonly imagePickerTitle = computed<string>(() => {
    const item = this.created();
    const name = item?.wine?.name;
    return isPresent(name) ? String(name) : '(ohne Namen)';
  });

  /** Öffnet den großen Bildauswahl-Dialog („Bild ergänzen" / „Bild ersetzen"). */
  openImagePicker(): void {
    this._imagePickerOpen.set(true);
  }

  /** Schließt den Bildauswahl-Dialog ohne Änderung. */
  closeImagePicker(): void {
    this._imagePickerOpen.set(false);
  }

  /** Übernimmt die Auswahl aus dem Dialog und schließt ihn (Req 17.34/17.35). */
  onPickImageFromDialog(name: string): void {
    this.pickImage(name);
    this._imagePickerOpen.set(false);
  }

  // ── Konfliktbestätigung (Req 17.25) ────────────────────────────────────────

  /** Aktuelle Feldwerte als zu speicherndes Set (für die Konfliktbestätigung). */
  private currentFieldValues(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of this.fields()) {
      const raw = this.values()[f.schema.field];
      if (f.kind === 'chips') {
        out[f.schema.field] = Array.isArray(raw) ? parseGrapeTags(raw) : [];
      } else {
        out[f.schema.field] = this.convertForSave(f, typeof raw === 'string' ? raw : '');
      }
    }
    return out;
  }

  /** Überschreibt die extern veränderte Datei nach Benutzerbestätigung (Req 17.25). */
  async confirmOverwrite(): Promise<void> {
    await this.save.confirmOverwrite(this.currentFieldValues());
  }

  /**
   * Verwirft die Konfliktwarnung, ohne zu überschreiben: Der Status wechselt zurück
   * nach `idle`, die Datei bleibt unangetastet (Req 17.25).
   */
  dismissConflict(): void {
    this.save.reset();
  }

  // ── Archivieren (kein Löschen, Req 17.44–17.48) ─────────────────────────────

  /**
   * Archiviert den aktuell geöffneten angelegten Eintrag: JSON + referenzierte
   * `image`/`audio`/`video`-Medien gemeinsam nach `_archive` (Req 17.47). Nach Erfolg
   * setzt die App Auswahl zurück und aktualisiert die Liste (Req 17.6); bei Fehler bleibt
   * alles am Ursprungsort und es erscheint eine erkennbare Fehleranzeige (Req 17.48).
   */
  async archiveEntry(): Promise<void> {
    const item = this.created();
    if (!item) return;
    await this.state.archiveEntry(item.entry);
  }

  /**
   * Archiviert den aktuell als unbekannter Wein geöffneten Eintrag: verschiebt das
   * ungenutzte Bild nach `_archive` (Req 17.46).
   */
  async archiveImage(): Promise<void> {
    const item = this.state.selectedItem();
    if (!item || item.kind !== 'unknown') return;
    await this.state.archiveImage(item.image);
  }
}
