// Führt die Import-Phasen (prepare/export/image-export) vor dem Angular-Build aus.
//
// Portabler Python-Interpreter: verwendet das lokale venf (../.venv/bin/python)
// falls vorhanden, sonst python3, sonst python. Damit läuft der prebuild-Schritt
// lokal (dieser Mac hat kein bloßes `python`) und in GitHub Actions gleichermaßen.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const script = resolve(projectRoot, 'scripts', 'weinimport.py');

function resolvePython() {
  const venv = resolve(projectRoot, '.venv', 'bin', 'python');
  if (existsSync(venv)) return venv;
  for (const candidate of ['python3', 'python']) {
    const check = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (check.status === 0) return candidate;
  }
  return 'python3';
}

const python = resolvePython();
const phases = process.argv.slice(2);

for (const phase of phases) {
  const result = spawnSync(python, [script, phase], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
