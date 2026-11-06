import { Injectable, inject, signal } from '@angular/core';
import { Wine, WineSchemaField } from '@weinsprechstunde/shared';
import { ConflictError, FileSystemAccessService } from './file-system-access.service';
import { mergeWineForSave } from '../models/wine-field-conversion';

/** Diskreter Zustand des Speicherstatus-Indikators (Req 17.23/17.24). */
export type SaveStatus = 'idle' | 'saving' | 'success' | 'error' | 'conflict';

/**
 * Momentaufnahme des Speicherstatus für die Anzeige im WineEditor.
 */
export interface SaveState {
  status: SaveStatus;
  /** Lesbare Fehlermeldung bei `status === 'error'` (Req 17.24). */
  error: string | null;
}

/**
 * Kapselt den Live-Auto-Save eines einzelnen Weineintrags über die File System
 * Access API (Req 17.21–17.25).
 *
 * Verantwortlichkeiten:
 * - **Debounce pro Feld (500 ms):** Jede Feldänderung setzt einen eigenen Timer; erst
 *   500 ms nach der letzten Eingabe im jeweiligen Feld wird gespeichert (Req 17.21).
 * - **Typkonvertierung** der number-Felder und **Merge** schema-fremder Felder laufen
 *   über die Pure-Functions in {@link mergeWineForSave} (Req 17.22/17.27).
 * - **Konflikterkennung** über `File.lastModified`: Der Service merkt sich den
 *   Lade-Zeitstempel und reicht ihn an `writeJson` weiter; weicht die Datei ab, wirft
 *   der FileSystemAccessService einen {@link ConflictError}. Der Service setzt dann den
 *   Status `conflict` und speichert **nicht** ohne Bestätigung (Req 17.25).
 * - **Speicherstatus-Indikator** (Erfolg/Fehler/Konflikt); bei Fehler bleiben die
 *   Feldinhalte im Formular erhalten (Req 17.23/17.24), da der Service das Formular nie
 *   zurücksetzt.
 *
 * Die Instanz wird pro geöffnetem Eintrag neu erzeugt (nicht als Singleton), damit
 * Debounce-Timer und Lade-Zeitstempel eintragslokal sind.
 */
@Injectable()
export class EditorSaveService {
  private readonly fsa = inject(FileSystemAccessService);

  private readonly _state = signal<SaveState>({ status: 'idle', error: null });
  readonly state = this._state.asReadonly();

  private path: string | null = null;
  private schema: WineSchemaField[] = [];

  /** Zuletzt geladenes/geschriebenes Wine-Objekt (Quelle schema-fremder Felder). */
  private current: Wine = { name: '' };

  /** `File.lastModified` zum Lade- bzw. letzten Schreibzeitpunkt (Konfliktbasis). */
  private lastModified = 0;

  /** Pro Feld laufende Debounce-Timer (Req 17.21). */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Debounce-Fenster in ms (Req 17.21). Überschreibbar für Tests. */
  debounceMs = 500;

  /**
   * Wird nach jedem erfolgreichen Schreiben aufgerufen (Auto-Save und Überschreiben) mit
   * dem geschriebenen Objekt und dem `lastModified`-Rückgabewert von `writeJson`. Der
   * Aufrufer hält damit seinen Cache aktuell (Req 17.6).
   */
  onSaved: ((path: string, wine: Wine, lastModified: number) => void) | null = null;

  /**
   * Beendet die Bindung an den aktuellen Eintrag: ausstehende Timer werden verworfen,
   * weitere Speichervorgänge sind unmöglich, bis wieder {@link init} aufgerufen wird
   * (z. B. während des frischen Lesens oder wenn die Datei nicht lesbar ist).
   */
  deactivate(): void {
    this.clearTimers();
    this.path = null;
    this._state.set({ status: 'idle', error: null });
  }

  /**
   * Initialisiert den Service für einen konkreten Eintrag.
   *
   * @param path         relativer JSON-Pfad im freigegebenen Ordner.
   * @param wine         das geladene Wine-Objekt.
   * @param lastModified `File.lastModified` zum Ladezeitpunkt (Konfliktbasis).
   * @param schema       die bekannten WineSchema-Felder.
   */
  init(path: string, wine: Wine, lastModified: number, schema: WineSchemaField[]): void {
    this.clearTimers();
    this.path = path;
    this.current = { ...wine };
    this.lastModified = lastModified;
    this.schema = schema;
    this._state.set({ status: 'idle', error: null });
  }

  /**
   * Plant einen Auto-Save eines einzelnen Feldes mit 500-ms-Debounce (Req 17.21).
   * Der übergebene Wert ist bereits typkonvertiert (number-Felder) bzw. das Array der
   * Grape-Tags. `undefined` lässt das Feld beim Speichern unverändert (z. B. nicht
   * konvertierbarer Rohwert).
   */
  scheduleFieldSave(field: string, value: unknown): void {
    const existing = this.timers.get(field);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(field);
      void this.saveField(field, value);
    }, this.debounceMs);
    this.timers.set(field, timer);
  }

  /**
   * Führt den Auto-Save eines Feldes sofort aus (ohne Debounce) — genutzt für
   * Picker-Auswahlen (audio/video), bei denen keine Tipp-Pause nötig ist, und für Tests.
   */
  async saveField(field: string, value: unknown): Promise<void> {
    await this.saveFields({ [field]: value });
  }

  /**
   * Schreibt die übergebenen (bereits konvertierten) Feldwerte über die File System
   * Access API. Schema-fremde Felder bleiben erhalten (Req 17.27). Erfolg/Fehler/Konflikt
   * steuern den Speicherstatus (Req 17.23/17.24/17.25).
   */
  async saveFields(fieldValues: Record<string, unknown>): Promise<void> {
    const path = this.path;
    if (path === null) return;
    const next = mergeWineForSave(this.current, this.schema, fieldValues);
    this._state.set({ status: 'saving', error: null });
    try {
      const newLastModified = await this.fsa.writeJson(path, next, this.lastModified);
      // Erfolg: neuen Lade-Zeitstempel übernehmen, damit Folgespeicherungen nicht
      // fälschlich als Konflikt gewertet werden.
      this.current = next;
      this.lastModified = newLastModified;
      this._state.set({ status: 'success', error: null });
      this.onSaved?.(path, next, newLastModified);
    } catch (err) {
      if (err instanceof ConflictError) {
        // Datei extern verändert — nicht ohne Bestätigung überschreiben (Req 17.25).
        this._state.set({ status: 'conflict', error: null });
      } else {
        // Feldinhalte bleiben erhalten (Formular wird nicht zurückgesetzt, Req 17.24).
        this._state.set({
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Überschreibt die Datei trotz erkanntem Konflikt, nachdem der Benutzer die Warnung
   * bestätigt hat (Req 17.25). Liest den aktuellen `File.lastModified` neu ein und
   * schreibt ohne Konfliktprüfung.
   */
  async confirmOverwrite(fieldValues: Record<string, unknown>): Promise<void> {
    const path = this.path;
    if (path === null) return;
    const next = mergeWineForSave(this.current, this.schema, fieldValues);
    this._state.set({ status: 'saving', error: null });
    try {
      const newLastModified = await this.fsa.writeJson(path, next);
      this.current = next;
      this.lastModified = newLastModified;
      this._state.set({ status: 'success', error: null });
      this.onSaved?.(path, next, newLastModified);
    } catch (err) {
      this._state.set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Setzt den Status zurück auf `idle` (z. B. nach verworfener Konfliktwarnung). */
  reset(): void {
    this._state.set({ status: 'idle', error: null });
  }

  /** Aktueller Lade-/Schreib-Zeitstempel (für Tests/Diagnose). */
  get loadedLastModified(): number {
    return this.lastModified;
  }

  /** Bricht alle laufenden Debounce-Timer ab (beim Wechsel des Eintrags). */
  clearTimers(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
