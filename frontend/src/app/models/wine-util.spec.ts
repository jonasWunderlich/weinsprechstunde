import {
  countBy,
  distinctValuesForField,
  formatPrice,
  grapeList,
  humanizeKey,
  isPresent,
  mediaSrc,
  slugify,
  valueList,
} from './wine-util';
import { Wine } from './wine.model';

function wine(partial: Partial<Wine>): Wine {
  return { name: 'X', ...partial } as Wine;
}

describe('isPresent', () => {
  it('false für null/undefined/leere Strings/leere Arrays', () => {
    expect(isPresent(null)).toBe(false);
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent('')).toBe(false);
    expect(isPresent('   ')).toBe(false);
    expect(isPresent([])).toBe(false);
  });
  it('true für 0, false, nicht-leere Strings/Arrays', () => {
    expect(isPresent(0)).toBe(true);
    expect(isPresent(false)).toBe(true);
    expect(isPresent('a')).toBe(true);
    expect(isPresent(['a'])).toBe(true);
  });
});

describe('slugify', () => {
  it('transliteriert Umlaute vor dem Filtern', () => {
    expect(slugify('Grüner Veltliner')).toBe('gruener-veltliner');
    expect(slugify('Württemberg')).toBe('wuerttemberg');
    expect(slugify('Rheingau')).toBe('rheingau');
  });
  it('entfernt Sonderzeichen und normalisiert Whitespace', () => {
    expect(slugify('  Côtes du Rhône!  ')).toBe('ctes-du-rhne');
    expect(slugify('A/B  C')).toBe('ab-c');
  });
});

describe('valueList / grapeList', () => {
  it('rollt String, Array und null aus', () => {
    expect(valueList(wine({ grape: 'Riesling' }), 'grape')).toEqual(['Riesling']);
    expect(valueList(wine({ grape: ['A', 'B'] }), 'grape')).toEqual(['A', 'B']);
    expect(valueList(wine({ grape: null as unknown as undefined }), 'grape')).toEqual([]);
  });
  it('grapeList gibt immer ein Array', () => {
    expect(grapeList(wine({ grape: 'A' }))).toEqual(['A']);
    expect(grapeList(wine({ grape: ['A', 'B'] }))).toEqual(['A', 'B']);
    expect(grapeList(wine({}))).toEqual([]);
  });
});

describe('distinctValuesForField', () => {
  it('distinct, de-sortiert, present-gefiltert, multi-value flach', () => {
    const wines = [
      wine({ grape: ['Riesling', 'Silvaner'] }),
      wine({ grape: 'Riesling' }),
      wine({ grape: null as unknown as undefined }),
      wine({ grape: 'Älbling' }),
    ];
    expect(distinctValuesForField(wines, 'grape')).toEqual(['Älbling', 'Riesling', 'Silvaner']);
  });
});

describe('countBy', () => {
  it('überspringt leere Werte und zählt korrekt', () => {
    const wines = [
      wine({ origin: 'Rheingau' }),
      wine({ origin: 'Rheingau' }),
      wine({ origin: null as unknown as undefined }),
      wine({ origin: 'Mosel' }),
    ];
    expect(countBy(wines, (w) => [w.origin])).toEqual([
      { value: 'Mosel', count: 1 },
      { value: 'Rheingau', count: 2 },
    ]);
  });
});

describe('humanizeKey', () => {
  it('nutzt die Label-Map', () => {
    expect(humanizeKey('taste_eye')).toBe('Auge');
    expect(humanizeKey('conclusion_tobias')).toBe('Fazit Tobias');
  });
  it('fällt auf snake_case→Titel zurück', () => {
    expect(humanizeKey('some_new_field')).toBe('Some New Field');
  });
});

describe('mediaSrc', () => {
  it('null bei fehlendem Dateinamen', () => {
    expect(mediaSrc(null)).toBeNull();
    expect(mediaSrc('')).toBeNull();
  });
  it('setzt /images/-Präfix', () => {
    expect(mediaSrc('a.jpg')).toBe('/images/a.jpg');
  });
});

describe('formatPrice', () => {
  it('formatiert mit Dezimalkomma und €', () => {
    expect(formatPrice(6.99)).toBe('6,99 €');
    expect(formatPrice(6)).toBe('6,00 €');
  });
  it('null bei fehlendem Preis', () => {
    expect(formatPrice(null)).toBeNull();
    expect(formatPrice(undefined)).toBeNull();
  });
});
