---
name: domain-pipeline
description: Import-zu-Export-Pipeline (import/ -> export/, scripts/weinimport.py Phasen optimize-images, prepare, export, image-export, wine-schema.json). Laden bei Arbeit an Aufbereitung, wines.json-Erzeugung, Bildexport oder Pipeline-Specs.
inclusion: auto
---
# Domäne pipeline

Scope: `import/`, `export/`, `scripts/weinimport.py` (Phasen optimize-images, prepare, export, image-export; nicht deploy), `wine-schema.json`, Tests in `scripts/tests/`. Nicht lesen: editor, weinliste, shared, deploy-ftp.

## Verträge
- #[[file:.kiro/specs/contracts/import-format.md]]
- #[[file:.kiro/specs/contracts/editor-output.md]]
- #[[file:.kiro/specs/contracts/export-format.md]]

## Specs
- #[[file:.kiro/specs/pipeline/requirements.md]]
- #[[file:.kiro/specs/pipeline/design.md]]
- #[[file:.kiro/specs/pipeline/tasks.md]]
