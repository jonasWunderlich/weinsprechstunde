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
  /** Hält den nächsten Schreibvorgang an, bis der Callback aufgerufen wird. */
  private gate: Promise<void> | null = null;
  holdNextWrite(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((r) => {
      release = r;
    });
    return release;
  }

  async writeJson(path: string, wine: Wine, expectedLastModified?: number): Promise<number> {
    const gate = this.gate;
    this.gate = null;
    if (gate) await gate;
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
  describe('Warteschlange pro Eintrag', () => {
    it('serialisiert überlappende Saves: beide Änderungen enthalten, Zeitstempel vom letzten', async () => {
      const { save, fsa } = setup();
      const release = fsa.holdNextWrite();
      const first = save.saveField('price', 5.5);
      const second = save.saveField('year', 2020);
      release();
      await Promise.all([first, second]);

      expect(save.state().status).toBe('success');
      expect(fsa.writes).toHaveLength(2);
      expect(fsa.writes[1].wine.price).toBe(5.5);
      expect(fsa.writes[1].wine.year).toBe(2020);
      expect(save.loadedLastModified).toBe(fsa.currentLastModified);
    });

    it('meldet nach überlappenden Saves keinen Konflikt bei Folge-Save', async () => {
      const { save, fsa } = setup();
      const release = fsa.holdNextWrite();
      const a = save.saveField('price', 1);
      const b = save.saveField('year', 2001);
      release();
      await Promise.all([a, b]);
      await save.saveField('name', 'Neu');
      expect(save.state().status).toBe('success');
      expect(fsa.writes.at(-1)?.wine).toMatchObject({ name: 'Neu', price: 1, year: 2001 });
    });

    it('ruft onSaved nach jedem Erfolg mit dem Rückgabewert von writeJson auf', async () => {
      const { save, fsa } = setup();
      const calls: [string, Wine, number][] = [];
      save.onSaved = (p, w, lm) => calls.push([p, w, lm]);
      await save.saveField('price', 2);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('a.json');
      expect(calls[0][1].price).toBe(2);
      expect(calls[0][2]).toBe(fsa.currentLastModified);
    });
  });

  describe('flush', () => {
    it('speichert ausstehende Eingaben sofort statt zu warten', async () => {
      const { save, fsa } = setup();
      save.scheduleFieldSave('price', 3);
      save.scheduleFieldSave('year', 1999);
      const failure = await save.flush();
      expect(failure).toBeNull();
      expect(fsa.writes).toHaveLength(1);
      expect(fsa.writes[0].wine).toMatchObject({ price: 3, year: 1999 });
      // Timer sind abgeräumt: nach Ablauf des Fensters wird nichts mehr geschrieben.
      await vi.advanceTimersByTimeAsync(600);
      expect(fsa.writes).toHaveLength(1);
    });

    it('liefert den Fehlschlag bei Konflikt und überschreibt nicht', async () => {
      const { save, fsa } = setup();
      fsa.currentLastModified = 200;
      save.scheduleFieldSave('price', 3);
      const failure = await save.flush();
      expect(failure).toEqual({ path: 'a.json', status: 'conflict', error: null });
      expect(fsa.writes).toHaveLength(0);
    });

    it('liefert den Fehlschlag bei Schreibfehler', async () => {
      const { save, fsa } = setup();
      fsa.failWith = new Error('Festplatte voll');
      save.scheduleFieldSave('price', 3);
      const failure = await save.flush();
      expect(failure?.status).toBe('error');
      expect(failure?.error).toContain('Festplatte voll');
    });

    it('wartet auf bereits laufende Saves und beeinflusst den Status eines neuen Eintrags nicht', async () => {
      const { save, fsa } = setup();
      const release = fsa.holdNextWrite();
      const running = save.saveField('price', 4);
      const flushed = save.flush();
      save.init('b.json', { name: 'Beta' }, 100, SCHEMA);
      release();
      await running;
      expect(await flushed).toBeNull();
      expect(fsa.writes[0].path).toBe('a.json');
      expect(save.state().status).toBe('idle');
    });
  });
});
