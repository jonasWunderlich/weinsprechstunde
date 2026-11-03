/*
 * Test-only Einstiegspunkt der Library `@weinsprechstunde/shared`.
 *
 * Bewusst NICHT Teil von `public-api.ts`: die hier re-exportierten Helfer
 * (fast-check-Generatoren) sind reines Test-Scaffolding und dürfen nicht in den
 * Produktions-Build der Library gelangen. Beide Apps und die Library selbst nutzen
 * sie in ihren Specs über den Alias `@weinsprechstunde/shared/testing`.
 */
export * from './lib/testing/test-helpers';
