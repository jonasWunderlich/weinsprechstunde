import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import fc from 'fast-check';
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
  /** Aktueller Inhalt auf der Platte. */
  disk: Wine = { name: 'Alpha' };
  /** Wenn gesetzt, wirft `readJson` diesen Fehler (z. B. NotFoundError). */
  readFailWith: Error | null = null;
  /** Externe Änderung: neuer Inhalt und neuer Zeitstempel. */
  externalChange(wine: Wine, lastModified = this.currentLastModified + 100): void {
    this.disk = structuredClone(wine);
    this.currentLastModified = lastModified;
  }
  async readJson(): Promise<{ wine: Wine; lastModified: number }> {
    if (this.readFailWith) throw this.readFailWith;
    return { wine: structuredClone(this.disk), lastModified: this.currentLastModified };
  }
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
    this.disk = structuredClone(wine);
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

  describe('Feldweiser Merge statt Konflikt (Req 17.25)', () => {
    it('speichert ohne Merge, wenn der Zeitstempel unverändert ist', async () => {
      const { save, fsa } = setup();
      const merged = vi.fn();
      save.onMerged = merged;
      await save.saveField('name', 'Beta');
      expect(save.state().status).toBe('success');
      expect(merged).not.toHaveBeenCalled();
    });

    it('übernimmt bei bloßer Zeitstempelabweichung (gleicher Inhalt) und speichert', async () => {
      const { save, fsa } = setup();
      fsa.externalChange({ name: 'Alpha' });
      await save.saveField('name', 'Beta');
      expect(save.state().status).toBe('success');
      expect(fsa.writes[0].wine.name).toBe('Beta');
    });

    it('übernimmt nur auf der Platte geänderte Felder (inkl. schema-fremder) und meldet sie', async () => {
      const { save, fsa } = setup();
      const merged = vi.fn();
      const saved = vi.fn();
      save.onMerged = merged;
      save.onSaved = saved;
      fsa.externalChange({ name: 'Alpha', year: 1999, extra: 'x' });
      await save.saveField('price', 5);
      expect(save.state().status).toBe('success');
      expect(fsa.writes[0].wine).toEqual({ name: 'Alpha', year: 1999, extra: 'x', price: 5 });
      expect(merged).toHaveBeenCalledTimes(1);
      expect(merged.mock.calls[0][0]).toBe('a.json');
      expect([...merged.mock.calls[0][1]].sort()).toEqual(['extra', 'year']);
      // Cache-Callback bekommt den Merge-Stand und den Zeitstempel aus writeJson.
      expect(saved).toHaveBeenCalledWith('a.json', fsa.writes[0].wine, fsa.currentLastModified);
      expect(save.loadedLastModified).toBe(fsa.currentLastModified);
    });

    it('wertet gleich geänderte Felder nicht als Konflikt (Komma-Eingabe 6,99 = Platte 6.99)', async () => {
      const { save, fsa } = setup();
      fsa.externalChange({ name: 'Alpha', price: 6.99 });
      await save.saveField('price', 6.99);
      expect(save.state().status).toBe('success');
      expect(fsa.writes[0].wine.price).toBe(6.99);
    });

    it('meldet nur bei abweichend geänderten Feldern einen Konflikt und schreibt nicht', async () => {
      const { save, fsa } = setup();
      fsa.externalChange({ name: 'Gamma', year: 2000 });
      await save.saveFields({ name: 'Beta', year: 2000 });
      expect(save.state().status).toBe('conflict');
      expect(save.conflicts()).toEqual([{ field: 'name', local: 'Beta', disk: 'Gamma' }]);
      expect(fsa.writes.length).toBe(0);
    });

    it('speichert nach Wahl je Feld: meine Version', async () => {
      const { save, fsa } = setup();
      fsa.externalChange({ name: 'Gamma', year: 1999 });
      await save.saveField('name', 'Beta');
      await save.resolveConflicts({ name: 'local' });
      expect(save.state().status).toBe('success');
      expect(save.conflicts()).toEqual([]);
      expect(fsa.writes[0].wine).toEqual({ name: 'Beta', year: 1999 });
    });

    it('speichert nach Wahl je Feld: Platte, und meldet das Feld über onMerged', async () => {
      const { save, fsa } = setup();
      const merged = vi.fn();
      save.onMerged = merged;
      fsa.externalChange({ name: 'Gamma' });
      await save.saveField('name', 'Beta');
      await save.resolveConflicts({ name: 'disk' });
      expect(fsa.writes[0].wine.name).toBe('Gamma');
      expect(merged).toHaveBeenCalledWith('a.json', ['name'], fsa.writes[0].wine);
      expect(save.loadedLastModified).toBe(fsa.currentLastModified);
    });

    it('speichert nicht, solange nicht jedes Konfliktfeld gewählt ist', async () => {
      const { save, fsa } = setup();
      fsa.externalChange({ name: 'Gamma', year: 1 });
      await save.saveFields({ name: 'Beta', year: 2 });
      await save.resolveConflicts({ name: 'local' });
      expect(fsa.writes.length).toBe(0);
      expect(save.state().status).toBe('conflict');
      await save.resolveConflicts({ name: 'local', year: 'disk' });
      expect(fsa.writes[0].wine).toEqual({ name: 'Beta', year: 1 });
    });

    it('behält bei mehreren Konflikt-Saves alle lokalen Änderungen', async () => {
      const { save, fsa } = setup();
      fsa.externalChange({ name: 'Gamma', year: 1 });
      await save.saveField('name', 'Beta');
      await save.saveField('year', 2);
      expect(save.conflicts().map((c) => c.field).sort()).toEqual(['name', 'year']);
      await save.resolveConflicts({ name: 'local', year: 'local' });
      expect(fsa.writes[0].wine).toEqual({ name: 'Beta', year: 2 });
    });

    it('bestimmt Konflikte neu, wenn die Datei während der Entscheidung erneut wechselt', async () => {
      const { save, fsa } = setup();
      fsa.externalChange({ name: 'Gamma' });
      await save.saveField('name', 'Beta');
      fsa.externalChange({ name: 'Delta' });
      await save.resolveConflicts({ name: 'local' });
      expect(save.state().status).toBe('conflict');
      expect(save.conflicts()).toEqual([{ field: 'name', local: 'Beta', disk: 'Delta' }]);
      expect(fsa.writes.length).toBe(0);
    });

    it('Abbrechen verwirft den Konflikt ohne Schreiben', async () => {
      const { save, fsa } = setup();
      fsa.externalChange({ name: 'Gamma' });
      await save.saveField('name', 'Beta');
      save.reset();
      expect(save.state().status).toBe('idle');
      expect(save.conflicts()).toEqual([]);
      expect(fsa.writes.length).toBe(0);
    });

    it('warnt wie beim Öffnen, wenn die Datei beim Speichern nicht mehr existiert', async () => {
      const { save, fsa } = setup();
      fsa.readFailWith = new DOMException('weg', 'NotFoundError');
      await save.saveField('name', 'Beta');
      expect(save.state().status).toBe('error');
      expect(save.state().error).toContain('nicht gefunden');
      expect(fsa.writes.length).toBe(0);
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
      fsa.externalChange({ name: 'Alpha', price: 9 });
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

  describe('Property 17: Konflikt-Erkennung beim Speichern (Req 17.25)', () => {
    const name = fc.constantFrom('A', 'B', 'C');
    const num = fc.integer({ min: 1, max: 3 });
    const opt = <T>(a: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> => fc.option(a, { nil: undefined });
    const wineArb = fc
      .record({ name: opt(name), year: opt(num), price: opt(num), extra: opt(name) })
      .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as Wine);
    const editArb = fc
      .record({ name: opt(name), year: opt(num), price: opt(num) })
      .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));

    it('speichert bei gleichem Zeitstempel; sonst nur bei Feldkonflikten kein Schreiben', async () => {
      await fc.assert(
        fc.asyncProperty(
          wineArb,
          wineArb,
          editArb,
          fc.boolean(),
          async (base, diskWine, edits, sameStamp) => {
            TestBed.resetTestingModule();
            const fsa = new FakeFsa();
            TestBed.configureTestingModule({
              providers: [{ provide: FileSystemAccessService, useValue: fsa }, EditorSaveService],
            });
            const save = TestBed.inject(EditorSaveService);
            save.init('a.json', base, 100, SCHEMA);
            const disk = sameStamp ? base : diskWine;
            if (sameStamp) fsa.disk = structuredClone(base);
            else fsa.externalChange(diskWine);
            await save.saveFields(edits);

            const expected: Record<string, unknown> = {};
            let conflict = false;
            for (const k of ['name', 'year', 'price', 'extra']) {
              const b = (base as Record<string, unknown>)[k];
              const d = (disk as Record<string, unknown>)[k];
              const l = k in edits ? (edits as Record<string, unknown>)[k] : b;
              const lc = l !== b;
              const dc = d !== b;
              if (lc && dc && l !== d) conflict = true;
              const v = lc ? l : d;
              if (v !== undefined) expected[k] = v;
            }
            if (conflict) {
              expect(save.state().status).toBe('conflict');
              expect(fsa.writes).toHaveLength(0);
            } else {
              expect(save.state().status).toBe('success');
              expect(fsa.writes).toHaveLength(1);
              expect(fsa.writes[0].wine).toEqual(expected);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
