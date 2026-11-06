import { describe, expect, it } from 'vitest';
import { Wine, WineSchemaField } from '@weinsprechstunde/shared';
import schemaJson from '../../../../../../wine-schema.json';
import importFixture from '../../../../../../.kiro/specs/contracts/fixtures/import/2021/2021-01-18-keller-riesling-trocken.json';
import { mergeWineForSave, unknownFieldKeys } from './wine-field-conversion';

// Golden-Fixture (Vertrag editor-output): Ein vom Editor geschriebener Eintrag bleibt
// beim Auto-Save eines Feldes ansonsten unverändert; schema-fremde Felder bleiben erhalten.
describe('Vertrag editor-output – Golden-Fixture', () => {
  const schema = schemaJson as WineSchemaField[];
  const wine = importFixture as unknown as Wine;

  it('Auto-Save eines Feldes verändert keine anderen Felder und erhält schema-fremde', () => {
    const saved = mergeWineForSave(wine, schema, { rating: 9 });
    expect(saved).toEqual({ ...wine, rating: 9 });
    expect(unknownFieldKeys(saved, schema)).toEqual(['note']);
  });

  it('Fixture enthält nur typrichtige Schema-Felder (number als Zahl, grape als Array)', () => {
    expect(typeof wine.year).toBe('number');
    expect(typeof wine.price).toBe('number');
    expect(typeof wine.rating).toBe('number');
    expect(Array.isArray(wine.grape)).toBe(true);
  });
});
