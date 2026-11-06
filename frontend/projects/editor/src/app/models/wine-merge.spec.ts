import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Wine, WineSchemaField } from '@weinsprechstunde/shared';
import { applyConflictChoices, deepEqual, mergeThreeWay } from './wine-merge';
import { convertNumberField, mergeWineForSave } from './wine-field-conversion';

const SCHEMA: WineSchemaField[] = [
  { field: 'name', type: 'text', filter_type: 'text-search', default_filter: true },
  { field: 'price', type: 'number', filter_type: null, default_filter: false, decimals: 2 },
  { field: 'grape', type: 'multi-value', filter_type: 'multi-select', default_filter: false },
];

describe('deepEqual', () => {
  it('vergleicht Arrays und Objekte strukturell', () => {
    expect(deepEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(deepEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(deepEqual({ a: 1, b: [1] }, { b: [1], a: 1 })).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(6.99, 6.99)).toBe(true);
  });
});

describe('mergeThreeWay', () => {
  const base: Wine = { name: 'Alpha', year: 2020, grape: ['Riesling'], extra: 'x' };

  it('übernimmt nur lokal geänderte Felder', () => {
    const r = mergeThreeWay(base, { ...base, year: 2021 }, base);
    expect(r.merged).toEqual({ ...base, year: 2021 });
    expect(r.fromDisk).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });

  it('übernimmt nur auf der Platte geänderte Felder und listet sie', () => {
    const r = mergeThreeWay(base, base, { ...base, name: 'Beta' });
    expect(r.merged.name).toBe('Beta');
    expect(r.fromDisk).toEqual(['name']);
    expect(r.conflicts).toEqual([]);
  });

  it('wertet gleich geänderte Felder nicht als Konflikt', () => {
    const r = mergeThreeWay(base, { ...base, year: 2022 }, { ...base, year: 2022 });
    expect(r.merged.year).toBe(2022);
    expect(r.fromDisk).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });

  it('meldet abweichend geänderte Felder als Konflikt mit beiden Werten', () => {
    const r = mergeThreeWay(base, { ...base, year: 2021 }, { ...base, year: 2019 });
    expect(r.conflicts).toEqual([{ field: 'year', local: 2021, disk: 2019 }]);
  });

  it('behandelt schema-fremde Felder wie alle anderen', () => {
    const r = mergeThreeWay(
      base,
      { ...base, own: 1, extra: 'lokal' },
      { ...base, extra: 'platte', other: true },
    );
    expect(r.conflicts).toEqual([{ field: 'extra', local: 'lokal', disk: 'platte' }]);
    expect(r.merged['own']).toBe(1);
    expect(r.merged['other']).toBe(true);
    expect(r.fromDisk).toEqual(['other']);
  });

  it('erkennt entfernte Felder (lokal geleert, auf der Platte geändert = Konflikt)', () => {
    const { year: _year, ...withoutYear } = base;
    const r = mergeThreeWay(base, withoutYear as Wine, { ...base, year: 1999 });
    expect(r.conflicts).toEqual([{ field: 'year', local: undefined, disk: 1999 }]);
    const removedBoth = mergeThreeWay(base, withoutYear as Wine, withoutYear as Wine);
    expect(removedBoth.conflicts).toEqual([]);
    expect('year' in removedBoth.merged).toBe(false);
  });

  it('vergleicht Arrays per Deep-Equal', () => {
    const same = mergeThreeWay(base, { ...base, grape: ['Silvaner'] }, { ...base, grape: ['Silvaner'] });
    expect(same.conflicts).toEqual([]);
    const diff = mergeThreeWay(base, { ...base, grape: ['Silvaner'] }, { ...base, grape: ['Merlot'] });
    expect(diff.conflicts.map((c) => c.field)).toEqual(['grape']);
    const untouched = mergeThreeWay(base, { ...base, grape: ['Riesling'] }, base);
    expect(untouched.conflicts).toEqual([]);
    expect(untouched.fromDisk).toEqual([]);
  });

  it('vergleicht in gespeicherten Typen: Eingabe "6,99" entspricht Plattenwert 6.99', () => {
    const conv = convertNumberField('6,99', 2);
    expect(conv.ok && conv.value).toBe(6.99);
    const priced: Wine = { name: 'Alpha' };
    const local = mergeWineForSave(priced, SCHEMA, { price: conv.ok ? conv.value : undefined });
    const r = mergeThreeWay(priced, local, { name: 'Alpha', price: 6.99 });
    expect(r.conflicts).toEqual([]);
    expect(r.merged.price).toBe(6.99);
    // Ein anderer Wert bleibt ein Konflikt.
    const other = mergeThreeWay(priced, local, { name: 'Alpha', price: 7.5 });
    expect(other.conflicts).toEqual([{ field: 'price', local: 6.99, disk: 7.5 }]);
  });
});

describe('applyConflictChoices', () => {
  const base: Wine = { name: 'A', year: 1 };
  it('nimmt je Feld die gewählte Version', () => {
    const r = mergeThreeWay(base, { name: 'L', year: 2 }, { name: 'D', year: 3 });
    expect(applyConflictChoices(r, { name: 'local', year: 'disk' })).toEqual({ name: 'L', year: 3 });
    expect(applyConflictChoices(r, { name: 'disk', year: 'local' })).toEqual({ name: 'D', year: 2 });
  });
  it('entfernt ein Feld, wenn die lokale Version „leer" ist', () => {
    const r = mergeThreeWay(base, { name: 'A' }, { name: 'A', year: 5 });
    expect('year' in applyConflictChoices(r, { year: 'local' })).toBe(false);
  });
});

describe('mergeThreeWay (Eigenschaften)', () => {
  const KEYS = ['a', 'b', 'c', 'd'];
  const value = fc.oneof(
    fc.integer({ min: 0, max: 3 }),
    fc.constantFrom('x', 'y'),
    fc.constantFrom(['g'], ['g', 'h']),
  );
  const wine = fc
    .record(Object.fromEntries(KEYS.map((k) => [k, fc.option(value, { nil: undefined })])))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as Wine);

  it('entspricht je Feld der Drei-Wege-Regel', () => {
    fc.assert(
      fc.property(wine, wine, wine, (b, l, d) => {
        const r = mergeThreeWay(b, l, d);
        for (const k of KEYS) {
          const lc = !deepEqual(b[k], l[k]);
          const dc = !deepEqual(b[k], d[k]);
          const conflict = r.conflicts.find((c) => c.field === k);
          if (lc && dc && !deepEqual(l[k], d[k])) {
            expect(conflict).toEqual({ field: k, local: l[k], disk: d[k] });
          } else {
            expect(conflict).toBeUndefined();
            expect(r.merged[k]).toEqual(lc ? l[k] : d[k]);
          }
          expect(r.fromDisk.includes(k)).toBe(!lc && dc);
        }
      }),
    );
  });

  it('ohne lokale Änderung ergibt der Merge den Plattenstand', () => {
    fc.assert(
      fc.property(wine, wine, (b, d) => {
        const r = mergeThreeWay(b, b, d);
        expect(r.conflicts).toEqual([]);
        expect(r.merged).toEqual(d);
      }),
    );
  });

  it('ohne Plattenänderung ergibt der Merge den lokalen Stand', () => {
    fc.assert(
      fc.property(wine, wine, (b, l) => {
        const r = mergeThreeWay(b, l, b);
        expect(r.conflicts).toEqual([]);
        expect(r.merged).toEqual(l);
      }),
    );
  });
});
