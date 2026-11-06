import { EMPTY_FILTER, Wine, WineSchemaField, applyFiltersAndSort } from '@weinsprechstunde/shared';
import schemaJson from '../../../../../../wine-schema.json';
import winesFixture from '../../../../../../.kiro/specs/contracts/fixtures/export/wines.json';

// Golden-Fixture (Vertrag export-format): Die Export-Fixture ist für die Weinliste
// konsumierbar und entspricht den Typen aus wine-schema.json.
describe('Vertrag export-format – Golden-Fixture', () => {
  const schema = schemaJson as WineSchemaField[];
  const wines = winesFixture as unknown as Wine[];

  it('jeder Eintrag hat name und Schema-Felder mit passendem Typ (oder null)', () => {
    for (const wine of wines) {
      expect(typeof wine.name).toBe('string');
      for (const f of schema) {
        const v = wine[f.field];
        if (v === null || v === undefined) continue;
        if (f.type === 'number') expect(typeof v).toBe('number');
        else if (f.type === 'multi-value') expect(typeof v === 'string' || Array.isArray(v)).toBe(true);
        else expect(typeof v).toBe('string');
      }
    }
  });

  it('applyFiltersAndSort verarbeitet die Fixture ohne Verlust (Leerfilter, Datum absteigend)', () => {
    const result = applyFiltersAndSort(wines, EMPTY_FILTER, 'tasting_date_desc', ['name']);
    expect(result).toHaveLength(wines.length);
    expect(result[0].name).toBe('Keller Riesling Trocken');
  });
});
