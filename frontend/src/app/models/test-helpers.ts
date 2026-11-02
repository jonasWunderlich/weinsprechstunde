import fc from 'fast-check';
import { Wine, WineFilter, EMPTY_FILTER } from './wine.model';

/**
 * Generator für realitätsnahe Weine: alle Schemafelder present-but-often-null,
 * gelegentliche Extra-Keys. Nur für Tests.
 */
export function arbitraryWine(): fc.Arbitrary<Wine> {
  const optStr = fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: null });
  const optNum = fc.option(fc.integer({ min: 1950, max: 2025 }), { nil: null });
  const optRating = fc.option(
    fc.float({ min: 1, max: 10, noNaN: true }).map((n) => Math.round(n * 10) / 10),
    { nil: null },
  );
  const optDate = fc.option(
    fc
      .date({ min: new Date('2010-01-01'), max: new Date('2024-12-31') })
      .map((d) => d.toISOString().slice(0, 10)),
    { nil: null },
  );
  const grapeArb = fc.option(
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 3 }),
    ),
    { nil: null },
  );

  return fc
    .record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      year: optNum,
      country: optStr,
      origin: optStr,
      grape: grapeArb,
      type: optStr,
      producer: optStr,
      quality: optStr,
      price: fc.option(
        fc.float({ min: 1, max: 100, noNaN: true }).map((n) => Math.round(n * 100) / 100),
        { nil: null },
      ),
      rating: optRating,
      tasting_date: optDate,
      image: optStr,
      audio: optStr,
      video: optStr,
      description: optStr,
      // gelegentliche Extra-Keys (als Strings, wie in echten Daten)
      taste_eye: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: undefined }),
      conclusion_tobias: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: undefined }),
      percentage: fc.option(fc.string({ minLength: 1, maxLength: 4 }), { nil: undefined }),
    })
    .map((w) => {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(w)) if (v !== undefined) clean[k] = v;
      return clean as unknown as Wine;
    });
}

export function arbitraryFilter(): fc.Arbitrary<WineFilter> {
  const optStr = fc.option(fc.string({ maxLength: 10 }), { nil: null });
  return fc.record({
    searchText: fc.string({ maxLength: 8 }),
    dropdowns: fc.record({
      country: optStr,
      origin: optStr,
      type: optStr,
      producer: optStr,
      quality: optStr,
    }),
    grape: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 3 }),
    yearFrom: fc.option(fc.integer({ min: 1950, max: 2025 }), { nil: null }),
    yearTo: fc.option(fc.integer({ min: 1950, max: 2025 }), { nil: null }),
    ratingFrom: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
    ratingTo: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
    tastingDateFrom: fc.option(fc.constant('2015-01-01'), { nil: null }),
    tastingDateTo: fc.option(fc.constant('2022-01-01'), { nil: null }),
  });
}

export function emptyFilter(): WineFilter {
  return { ...EMPTY_FILTER, dropdowns: { ...EMPTY_FILTER.dropdowns } };
}
