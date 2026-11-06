// Minimale ESLint-Konfiguration: erzwingt die Domänengrenze zwischen den Apps.
// editor und weinliste dürfen sich nicht gegenseitig importieren; gemeinsamer Code
// ausschließlich über @weinsprechstunde/shared (frontend/projects/shared).
import tseslint from 'typescript-eslint';

const crossImportMessage =
  'Direkter Import zwischen editor und weinliste ist verboten. Gemeinsamen Code über @weinsprechstunde/shared bereitstellen.';

const restrictFor = (other) => [
  'error',
  {
    patterns: [
      { group: [`**/projects/${other}`, `**/projects/${other}/**`], message: crossImportMessage },
      { group: [`../**/${other}/**`, `../**/${other}`], message: crossImportMessage },
    ],
  },
];

export default [
  { ignores: ['dist/**', 'node_modules/**', '.angular/**'] },
  { files: ['projects/**/*.ts'], languageOptions: { parser: tseslint.parser } },
  {
    files: ['projects/editor/**/*.ts'],
    rules: { 'no-restricted-imports': restrictFor('weinliste') },
  },
  {
    files: ['projects/weinliste/**/*.ts'],
    rules: { 'no-restricted-imports': restrictFor('editor') },
  },
];
