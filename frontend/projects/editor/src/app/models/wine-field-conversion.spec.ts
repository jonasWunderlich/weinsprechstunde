import { describe, expect, it } from 'vitest';
import { Wine, WineSchemaField } from '@weinsprechstunde/shared';
import {
  convertNumberField,
  mergeWineForSave,
  parseGrapeTags,
  unknownFieldKeys,
} from './wine-field-conversion';

const SCHEMA: WineSchemaField[] = [
  { field: 'name', type: 'text', filter_type: 'text-search', default_filter: true },
  { field: 'year', type: 'number', filter_type: 'range', default_filter: false, decimals: 0 },
  { field: 'price', type: 'number', filter_type: null, default_filter: false, decimals: 2 },
  {
    field: 'rating',
    type: 'number',
    filter_type: 'rating-range',
    default_filter: true,
    decimals: 1,
  },
  { field: 'grape', type: 'multi-value', filter_type: 'multi-select', default_filter: true },
];

describe('convertNumberField – Typkonvertierung (Req 17.22)', () => {
  it('year: "2017" → Integer 2017 (decimals 0)', () => {
    expect(convertNumberField('2017', 0)).toEqual({ ok: true, value: 2017 });
  });

  it('year: Nachkommastellen werden für decimals 0 abgeschnitten', () => {
    expect(convertNumberField('2017.9', 0)).toEqual({ ok: true, value: 2017 });
  });

  it('rating: "6" → 6 (decimals 1)', () => {
    expect(convertNumberField('6', 1)).toEqual({ ok: true, value: 6 });
  });

  it('rating: rundet auf 1 Nachkommastelle', () => {
    expect(convertNumberField('6.37', 1)).toEqual({ ok: true, value: 6.4 });
  });

  it('price: "6,99" → 6.99 (Dezimal-Komma akzeptiert, decimals 2)', () => {
    expect(convertNumberField('6,99', 2)).toEqual({ ok: true, value: 6.99 });
  });

  it('price: rundet auf 2 Nachkommastellen', () => {
    expect(convertNumberField('6,999', 2)).toEqual({ ok: true, value: 7 });
    expect(convertNumberField('6,994', 2)).toEqual({ ok: true, value: 6.99 });
  });

  it('leerer Wert → null (Feld geleert)', () => {
    expect(convertNumberField('', 0)).toEqual({ ok: true, value: null });
    expect(convertNumberField('   ', 2)).toEqual({ ok: true, value: null });
  });

  it('nicht konvertierbarer Wert → ok:false mit erhaltenem Rohwert (Req 2.18)', () => {
    expect(convertNumberField('auf Anfrage', 2)).toEqual({ ok: false, raw: 'auf Anfrage' });
  });
});

describe('parseGrapeTags – Chip-Eingabe → Array (Req 17.18)', () => {
  it('trennt Komma-getrennte Tags, trimmt und entfernt Leere/Duplikate', () => {
    expect(parseGrapeTags('Merlot, Syrah , Merlot, , Riesling')).toEqual([
      'Merlot',
      'Syrah',
      'Riesling',
    ]);
  });

  it('akzeptiert bereits ein Array', () => {
    expect(parseGrapeTags(['Merlot', 'Merlot', ' Syrah '])).toEqual(['Merlot', 'Syrah']);
  });
});

describe('mergeWineForSave – schema-fremde Felder erhalten (Req 17.27)', () => {
  it('erhält schema-fremde Felder unverändert beim Speichern bekannter Felder', () => {
    const original: Wine = {
      name: 'Alt',
      year: 2019,
      taste_nose: 'Kirsche',
      percentage: 13.5,
      wp_unmapped_foo: { a: 1 },
    };
    const merged = mergeWineForSave(original, SCHEMA, { name: 'Neu', year: 2020 });
    expect(merged.name).toBe('Neu');
    expect(merged.year).toBe(2020);
    expect(merged['taste_nose']).toBe('Kirsche');
    expect(merged['percentage']).toBe(13.5);
    expect(merged['wp_unmapped_foo']).toEqual({ a: 1 });
  });

  it('entfernt ein Schema-Feld, das auf null (geleert) gesetzt wird', () => {
    const original: Wine = { name: 'A', price: 9.99 };
    const merged = mergeWineForSave(original, SCHEMA, { price: null });
    expect('price' in merged).toBe(false);
  });

  it('lässt ein Feld mit value undefined unverändert', () => {
    const original: Wine = { name: 'A', price: 9.99 };
    const merged = mergeWineForSave(original, SCHEMA, { price: undefined });
    expect(merged.price).toBe(9.99);
  });

  it('schreibt grape als Array', () => {
    const original: Wine = { name: 'A' };
    const merged = mergeWineForSave(original, SCHEMA, { grape: ['Merlot', 'Syrah'] });
    expect(merged.grape).toEqual(['Merlot', 'Syrah']);
  });
});

describe('unknownFieldKeys', () => {
  it('liefert nur schema-fremde Keys', () => {
    const wine: Wine = { name: 'A', year: 2020, taste_eye: 'klar', foo: 1 };
    expect(unknownFieldKeys(wine, SCHEMA).sort()).toEqual(['foo', 'taste_eye']);
  });
});
