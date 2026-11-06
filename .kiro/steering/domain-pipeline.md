---
name: domain-pipeline
description: Import-zu-Export-Pipeline (import/ -> export/, scripts/weinlib/{config,pipeline,backup}.py, Phasen backup, optimize-images, prepare, export, image-export, wine-schema.json). Laden bei Arbeit an Aufbereitung, wines.json-Erzeugung, Bildexport oder Pipeline-Specs.
inclusion: auto
---
# Domäne pipeline

Scope: `import/`, `export/`, `scripts/weinlib/{config,pipeline,backup}.py` (Phasen backup, optimize-images, prepare, export, image-export; nicht deploy; `scripts/weinimport.py` ist nur die Fassade/Einstieg), `backup/`, `wine-schema.json`, Tests in `scripts/tests/`. Backup gehört zur Pipeline: läuft im Vollpipeline-Lauf (`cli._run_full_pipeline`) vor dem JSON-Export und sichert die bisherige `wines.json` (Req 20). Für `export` allein (make export/all/deploy, CI) ist das Backup nicht garantiert (offene Entscheidung). Nicht lesen: editor, weinliste, shared, deploy-ftp (auch nicht `deploy.py`, `ftp_transport.py`, `cli.py`).

## Verträge
- #[[file:.kiro/specs/contracts/import-format.md]]
- #[[file:.kiro/specs/contracts/editor-output.md]]
- #[[file:.kiro/specs/contracts/export-format.md]]

## Specs
- #[[file:.kiro/specs/pipeline/requirements.md]]
- #[[file:.kiro/specs/pipeline/design.md]]
- #[[file:.kiro/specs/pipeline/tasks.md]]
