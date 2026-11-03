import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Wine, WineSchemaField } from '@weinsprechstunde/shared';
import { EditorSaveService } from './editor-save.service';
import { ConflictError, FileSystemAccessService } from './file-system-access.service';

const SCHEMA: WineSchemaField[] = [
  { field: 'name', type: 'text', filter_type: 'text-search', default_filter: true },
  { field: 'year', type: 'number', filter_type: 'range', default_filter: false, decimals: 0 },
  { field: 'price', type: 'number', filter_type: null, default_filter: false, decimals: 2 },
];

/**
 * Fake des FileSystemAccessService, der das Konfliktverhalten von `writeJson`
 * (Vergleich `expectedLastModified` gegen den aktuellen Zeitstempel) nachbildet.
 */
class FakeFsa {
  writes: { path: string; wine: Wine }[] = [];
  /** Aktueller „Dateizustand" auf der Platte. */
  currentLastModified = 100;
  /** Wenn gesetzt, wirft der nächste Schreibvorgang diesen Fehler (Nicht-Konflikt). */
  failWith: Error | null = null;

  async writeJson(path: string, wine: Wine, expectedLastModified?: number): Promise<number> {
    if (this.failWith) {
      const e = this.failWith;
      throw e;
    }
    if (expectedLastModified !== undefined && expectedLastModified !== this.currentLastModified) {
      throw new ConflictError(expectedLastModified, this.currentLastModified);
    }
    this.writes.push({ path, wine: structuredClone(wine) });
    this.currentLastModified += 1;
    return this.currentLastModified;
  }
}

function setup(): { save: EditorSaveService; fsa: FakeFsa } {
  const fsa = new FakeFsa();
  TestBed.configureTestingModule({
    providers: [{ provide: FileSystemAccessService, useValue: fsa }, EditorSaveService],
  });
  const save = TestBed.inject(EditorSaveService);
  save.init('a.json', { name: 'Alpha' }, 100, SCHEMA);
  return { save, fsa };
}

describe('EditorSaveService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('Debounce (Req 17.21)', () => {
    it('speichert erst nach Ablauf des 500-ms-Fensters', async () => {
      const { save, fsa } = setup();
      save.scheduleFieldSave('name', 'Beta');
      expect(fsa.writes.length).toBe(0);
      await vi.advanceTimersByTimeAsync(499);
      expect(fsa.writes.length).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(fsa.writes.length).toBe(1);
      expect(fsa.writes[0].wine.name).toBe('Beta');
    });

    it('setzt das Debounce-Fenster pro Feld bei erneuter Eingabe zurück', async () => {
      const { save, fsa } = setup();
      save.scheduleFieldSave('name', 'B');
      await vi.advanceTimersByTimeAsync(300);
      save.scheduleFieldSave('name', 'Beta');
      await vi.advanceTimersByTimeAsync(300);
      expect(fsa.writes.length).toBe(0); // Timer wurde zurückgesetzt
      await vi.advanceTimersByTimeAsync(200);
      expect(fsa.writes.length).toBe(1);
      expect(fsa.writes[0].wine.name).toBe('Beta');
    });

    it('debouncet pro Feld unabhängig', async () => {
      const { save, fsa } = setup();
      save.scheduleFieldSave('name', 'Beta');
      save.scheduleFieldSave('year', 2020);
      await vi.advanceTimersByTimeAsync(500);
      expect(fsa.writes.length).toBe(2);
    });

    it('setzt den Status nach erfolgreichem Save auf "success" (Req 17.23)', async () => {
      const { save } = setup();
      save.scheduleFieldSave('name', 'Beta');
      await vi.advanceTimersByTimeAsync(500);
      expect(save.state().status).toBe('success');
    });
  });

  describe('Fehlerbehandlung (Req 17.24)', () => {
    it('zeigt Status "error" und erhält den Lade-Zeitstempel (keine Übernahme)', async () => {
      const { save, fsa } = setup();
      fsa.failWith = new Error('Festplatte voll');
      const before = save.loadedLastModified;
      await save.saveField('name', 'Beta');
      expect(save.state().status).toBe('error');
      expect(save.state().error).toContain('Festplatte voll');
      // Lade-Zeitstempel unverändert → Feldinhalte/Formular bleiben die Quelle der Wahrheit.
      expect(save.loadedLastModified).toBe(before);
    });
  });

  describe('Konflikterkennung über File.lastModified (Req 17.25)', () => {
    it('setzt Status "conflict" und überschreibt NICHT, wenn die Datei extern verändert wurde', async () => {
      const { save, fsa } = setup();
      // Externe Änderung simulieren: Zeitstempel der „Platte" weicht vom Lade-Wert ab.
      fsa.currentLastModified = 200;
      await save.saveField('name', 'Beta');
      expect(save.state().status).toBe('conflict');
      expect(fsa.writes.length).toBe(0); // nicht überschrieben
    });

    it('überschreibt nach Bestätigung trotz Konflikt (confirmOverwrite)', async () => {
      const { save, fsa } = setup();
      fsa.currentLastModified = 200;
      await save.saveField('name', 'Beta');
      expect(save.state().status).toBe('conflict');
      await save.confirmOverwrite({ name: 'Beta' });
      expect(save.state().status).toBe('success');
      expect(fsa.writes.length).toBe(1);
      expect(fsa.writes[0].wine.name).toBe('Beta');
    });

    it('nach erfolgreichem Save gilt kein erneuter Konflikt (Zeitstempel wird übernommen)', async () => {
      const { save, fsa } = setup();
      await save.saveField('name', 'Beta');
      expect(save.state().status).toBe('success');
      await save.saveField('name', 'Gamma');
      expect(save.state().status).toBe('success');
      expect(fsa.writes.length).toBe(2);
    });
  });

  describe('Typkonvertierung beim Save (Req 17.22)', () => {
    it('schreibt bereits konvertierte number-Werte typrichtig', async () => {
      const { save, fsa } = setup();
      await save.saveFields({ year: 2020, price: 6.99 });
      expect(fsa.writes[0].wine.year).toBe(2020);
      expect(fsa.writes[0].wine.price).toBe(6.99);
    });
  });
});
