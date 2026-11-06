import { Injectable, inject, signal } from '@angular/core';
import { Wine, WineSchemaField } from '@weinsprechstunde/shared';
import { ConflictError, FileSystemAccessService } from './file-system-access.service';
import { mergeWineForSave } from '../models/wine-field-conversion';
import {
  ConflictChoice,
  FieldConflict,
  MergeResult,
  applyConflictChoices,
  mergeThreeWay,
} from '../models/wine-merge';

/** Meldung, wenn die Datei beim Speichern nicht mehr existiert (wie beim Öffnen). */
export const FILE_MISSING_MESSAGE =
  'Die Datei wurde nicht gefunden (verschoben, umbenannt oder entfernt). Bitte oben auf „Aktualisieren“ klicken, um die Liste neu einzulesen. Dieser Eintrag kann nicht gespeichert werden.';

/** Maximale Wiederholungen, wenn die Datei zwischen Lesen und Schreiben erneut wechselt. */
const MAX_WRITE_ATTEMPTS = 3;

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

/** Fehlgeschlagener letzter Speichervorgang eines Eintrags (Ergebnis von `flush`). */
export interface SaveFailure {
  path: string;
  status: 'conflict' | 'error';
  error: string | null;
}

/** Zustand eines geöffneten Eintrags; Speichervorgänge laufen pro Eintrag nacheinander. */
interface Slot {
  path: string;
  schema: WineSchemaField[];
  /** Zuletzt geladenes/geschriebenes Wine-Objekt (Quelle schema-fremder Felder). */
  current: Wine;
  /** `File.lastModified` zum Lade- bzw. letzten Schreibzeitpunkt (Konfliktbasis). */
  lastModified: number;
  /** Kette der Speichervorgänge (serialisiert, Req 17.21). */
  queue: Promise<void>;
  /** Ergebnis des letzten Speichervorgangs, falls fehlgeschlagen. */
  failure: SaveFailure | null;
  /** Wegen eines Feldkonflikts noch nicht gespeicherte (konvertierte) Feldwerte. */
  unsaved: Record<string, unknown>;
  /** Offener Feldkonflikt samt Plattenstand, auf dem das Merge-Ergebnis beruht. */
  conflict: { result: MergeResult; diskLastModified: number } | null;
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
 * - **Konflikterkennung** über `File.lastModified` mit feldweisem Drei-Wege-Merge: Beim
 *   Speichern wird die Datei erneut gelesen. Gleicher Zeitstempel wie zuletzt bekannt →
 *   einfach speichern. Sonst werden Basis (letzter bekannter Plattenstand), lokaler und
 *   aktueller Plattenstand per {@link mergeThreeWay} zusammengeführt; nur bei Feldern mit
 *   abweichenden Änderungen auf beiden Seiten entsteht der Status `conflict`, den der
 *   Benutzer je Feld über {@link resolveConflicts} entscheidet (Req 17.25).
 * - **Warteschlange:** Speichervorgänge eines Eintrags laufen nacheinander. Jeder baut
 *   auf dem Ergebnis des vorherigen auf (Wine-Objekt und Zeitstempel), so gehen bei
 *   fast gleichzeitigen Änderungen mehrerer Felder keine Änderungen verloren.
 * - **Flush:** {@link flush} speichert ausstehende Eingaben sofort (Wechsel des Eintrags).
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

  private slot: Slot | null = null;

  /** Pro Feld laufende Debounce-Timer samt Wert (Req 17.21). */
  private readonly pending = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; value: unknown }
  >();

  /** Debounce-Fenster in ms (Req 17.21). Überschreibbar für Tests. */
  debounceMs = 500;

  /**
   * Wird nach jedem erfolgreichen Schreiben aufgerufen (Auto-Save und Überschreiben) mit
   * dem geschriebenen Objekt und dem `lastModified`-Rückgabewert von `writeJson`. Der
   * Aufrufer hält damit seinen Cache aktuell (Req 17.6).
   */
  onSaved: ((path: string, wine: Wine, lastModified: number) => void) | null = null;

  /**
   * Wird aufgerufen, wenn beim Speichern Feldwerte von der Platte übernommen wurden
   * (Merge oder Konfliktwahl „Platte"), mit den Feldnamen und dem gespeicherten Objekt.
   */
  onMerged: ((path: string, fields: string[], wine: Wine) => void) | null = null;

  private readonly _conflicts = signal<FieldConflict[]>([]);
  /** Felder des offenen Konflikts (leer, wenn keiner offen ist). */
  readonly conflicts = this._conflicts.asReadonly();

  /**
   * Initialisiert den Service für einen konkreten Eintrag. Ausstehende Eingaben des
   * vorherigen Eintrags werden verworfen; vorher {@link flush} aufrufen, um sie zu sichern.
   *
   * @param path         relativer JSON-Pfad im freigegebenen Ordner.
   * @param wine         das geladene Wine-Objekt.
   * @param lastModified `File.lastModified` zum Ladezeitpunkt (Konfliktbasis).
   * @param schema       die bekannten WineSchema-Felder.
   */
  init(path: string, wine: Wine, lastModified: number, schema: WineSchemaField[]): void {
    this.clearTimers();
    this.slot = {
      path,
      schema,
      current: { ...wine },
      lastModified,
      queue: Promise.resolve(),
      failure: null,
      unsaved: {},
      conflict: null,
    };
    this._conflicts.set([]);
    this._state.set({ status: 'idle', error: null });
  }

  /**
   * Beendet die Bindung an den aktuellen Eintrag: ausstehende Timer werden verworfen,
   * weitere Speichervorgänge sind unmöglich, bis wieder {@link init} aufgerufen wird
   * (z. B. während des frischen Lesens oder wenn die Datei nicht lesbar ist). Bereits
   * laufende Speichervorgänge werden noch zu Ende geführt.
   */
  deactivate(): void {
    this.clearTimers();
    this.slot = null;
    this._conflicts.set([]);
    this._state.set({ status: 'idle', error: null });
  }

  /**
   * Plant einen Auto-Save eines einzelnen Feldes mit 500-ms-Debounce (Req 17.21).
   * Der übergebene Wert ist bereits typkonvertiert (number-Felder) bzw. das Array der
   * Grape-Tags. `undefined` lässt das Feld beim Speichern unverändert (z. B. nicht
   * konvertierbarer Rohwert).
   */
  scheduleFieldSave(field: string, value: unknown): void {
    const existing = this.pending.get(field);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pending.delete(field);
      void this.saveField(field, value);
    }, this.debounceMs);
    this.pending.set(field, { timer, value });
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
   * steuern den Speicherstatus (Req 17.23/17.24/17.25). Läuft hinter allen zuvor
   * gestarteten Speichervorgängen desselben Eintrags.
   */
  async saveFields(fieldValues: Record<string, unknown>): Promise<void> {
    const slot = this.slot;
    if (slot === null) return;
    await this.enqueue(slot, () => this.write(slot, fieldValues));
  }

  /**
   * Speichert alle ausstehenden (noch im Debounce wartenden) Eingaben des aktuellen
   * Eintrags sofort und wartet, bis alle Speichervorgänge dieses Eintrags beendet sind.
   * Liefert den Fehlschlag des letzten Speichervorgangs (Konflikt/Fehler) oder `null`.
   */
  async flush(): Promise<SaveFailure | null> {
    const slot = this.slot;
    if (slot === null) return null;
    if (this.pending.size > 0) {
      const values: Record<string, unknown> = {};
      for (const [field, p] of this.pending) {
        clearTimeout(p.timer);
        values[field] = p.value;
      }
      this.pending.clear();
      void this.enqueue(slot, () => this.write(slot, values));
    }
    await slot.queue;
    return slot.failure;
  }

  /**
   * Schließt einen offenen Feldkonflikt ab: je Konfliktfeld `local` (meine Version) oder
   * `disk` (neue Version von der Platte). Fehlt eine Wahl, passiert nichts. Danach wird
   * gespeichert (Req 17.25).
   */
  async resolveConflicts(choices: Record<string, ConflictChoice>): Promise<void> {
    const slot = this.slot;
    if (slot === null) return;
    await this.enqueue(slot, () => this.resolve(slot, choices));
  }

  /** Setzt den Status zurück auf `idle` (z. B. nach verworfener Konfliktwarnung). */
  reset(): void {
    if (this.slot) {
      this.slot.failure = null;
      this.slot.conflict = null;
    }
    this._conflicts.set([]);
    this._state.set({ status: 'idle', error: null });
  }

  /** Aktueller Lade-/Schreib-Zeitstempel (für Tests/Diagnose). */
  get loadedLastModified(): number {
    return this.slot?.lastModified ?? 0;
  }

  /** `true`, wenn für das Feld noch eine Eingabe im Debounce wartet. */
  hasPending(field: string): boolean {
    return this.pending.has(field);
  }

  /** Bricht alle laufenden Debounce-Timer ab, ohne zu speichern. */
  clearTimers(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  /** Hängt einen Speichervorgang an die Kette des Eintrags (`op` wirft nie). */
  private enqueue(slot: Slot, op: () => Promise<void>): Promise<void> {
    const run = slot.queue.then(op);
    slot.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Ein Speichervorgang. Baut auf `slot.current`/`slot.lastModified` des vorherigen
   * Vorgangs auf. Den sichtbaren Status setzt er nur, solange der Eintrag noch der
   * aktuell geöffnete ist. Die Datei wird vorher erneut gelesen und bei abweichendem
   * Zeitstempel feldweise zusammengeführt.
   */
  private async write(slot: Slot, fieldValues: Record<string, unknown>): Promise<void> {
    const values = { ...slot.unsaved, ...fieldValues };
    const local = mergeWineForSave(slot.current, slot.schema, values);
    const visible = (): boolean => this.slot === slot;
    if (visible()) this._state.set({ status: 'saving', error: null });
    try {
      for (let attempt = 1; ; attempt++) {
        let toWrite = local;
        let fromDisk: string[] = [];
        let expected = slot.lastModified;
        const disk = await this.fsa.readJson(slot.path);
        if (disk.lastModified !== slot.lastModified) {
          const result = mergeThreeWay(slot.current, local, disk.wine);
          if (result.conflicts.length > 0) {
            this.openConflict(slot, values, result, disk.lastModified, visible());
            return;
          }
          toWrite = result.merged;
          fromDisk = result.fromDisk;
          expected = disk.lastModified;
        }
        try {
          const newLastModified = await this.fsa.writeJson(slot.path, toWrite, expected);
          this.finishSave(slot, toWrite, newLastModified, fromDisk, visible());
          return;
        } catch (err) {
          // Datei zwischen Lesen und Schreiben erneut verändert: noch einmal zusammenführen.
          if (!(err instanceof ConflictError) || attempt >= MAX_WRITE_ATTEMPTS) throw err;
        }
      }
    } catch (err) {
      this.failSave(slot, err, visible());
    }
  }

  /** Schreibt das Ergebnis eines gelösten Feldkonflikts. */
  private async resolve(slot: Slot, choices: Record<string, ConflictChoice>): Promise<void> {
    const open = slot.conflict;
    if (open === null) return;
    if (!open.result.conflicts.every((c) => choices[c.field] !== undefined)) return;
    const visible = (): boolean => this.slot === slot;
    const final = applyConflictChoices(open.result, choices);
    const fromDisk = [
      ...open.result.fromDisk,
      ...open.result.conflicts.filter((c) => choices[c.field] === 'disk').map((c) => c.field),
    ];
    if (visible()) this._state.set({ status: 'saving', error: null });
    try {
      const newLastModified = await this.fsa.writeJson(slot.path, final, open.diskLastModified);
      this.finishSave(slot, final, newLastModified, fromDisk, visible());
    } catch (err) {
      if (err instanceof ConflictError) {
        // Datei erneut verändert: Konflikte gegen den neuen Plattenstand neu bestimmen.
        slot.conflict = null;
        this._conflicts.set([]);
        await this.write(slot, {});
      } else {
        this.failSave(slot, err, visible());
      }
    }
  }

  private openConflict(
    slot: Slot,
    values: Record<string, unknown>,
    result: MergeResult,
    diskLastModified: number,
    visible: boolean,
  ): void {
    slot.unsaved = values;
    slot.conflict = { result, diskLastModified };
    slot.failure = { path: slot.path, status: 'conflict', error: null };
    if (visible) {
      this._conflicts.set(result.conflicts);
      this._state.set({ status: 'conflict', error: null });
    }
  }

  private finishSave(
    slot: Slot,
    saved: Wine,
    lastModified: number,
    fromDisk: string[],
    visible: boolean,
  ): void {
    // Erfolg: neuen Lade-Zeitstempel übernehmen, damit Folgespeicherungen nicht
    // fälschlich als Konflikt gewertet werden.
    slot.current = saved;
    slot.lastModified = lastModified;
    slot.failure = null;
    slot.unsaved = {};
    slot.conflict = null;
    if (visible) {
      this._conflicts.set([]);
      this._state.set({ status: 'success', error: null });
    }
    if (fromDisk.length > 0) this.onMerged?.(slot.path, fromDisk, saved);
    this.onSaved?.(slot.path, saved, lastModified);
  }

  private failSave(slot: Slot, err: unknown, visible: boolean): void {
    // Feldinhalte bleiben erhalten (Formular wird nicht zurückgesetzt, Req 17.24).
    const name = (err as { name?: string } | null)?.name;
    const error =
      name === 'NotFoundError'
        ? FILE_MISSING_MESSAGE
        : err instanceof Error
          ? err.message
          : String(err);
    slot.failure = { path: slot.path, status: 'error', error };
    if (visible) this._state.set({ status: 'error', error });
  }
}
