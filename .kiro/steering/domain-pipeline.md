---
name: domain-pipeline
description: Import-zu-Export-Pipeline (import/ -> export/, scripts/weinlib/{config,pipeline,backup}.py, Phasen backup, optimize-images, prepare, export, image-export, wine-schema.json). Laden bei Arbeit an Aufbereitung, wines.json-Erzeugung, Bildexport oder Pipeline-Specs.
inclusion: auto
---
# Domäne pipeline

Scope: `import/`, `export/`, `scripts/weinlib/{config,pipeline,backup}.py` (Phasen backup, optimize-images, prepare, export, image-export; nicht deploy; `scripts/weinimport.py` ist nur die Fassade/Einstieg), `backup/`, `wine-schema.json`, Tests in `scripts/tests/pipeline/` (inkl. Backup und Vertrags-Fixture; Konfig-Tests in `scripts/tests/config/`). Nur `scripts/tests/pipeline` ausführen bzw. lesen (`make test-pipeline`), nicht `scripts/tests/deploy_ftp`. Backup gehört zur Pipeline: ist eine eigene, von den übrigen Phasen unabhängige Phase `backup` (Req 20): sie läuft als allererster Schritt von `make deploy` (`make backup`) und im Vollpipeline-Lauf (`cli._run_full_pipeline`) und sichert die vorhandene `export/data/wines.json`; fehlt sie, nur Warnung. `make export`/`make all` und die CI rufen sie nicht auf. Nicht lesen: editor, weinliste, shared, deploy-ftp (auch nicht `deploy.py`, `ftp_transport.py`, `cli.py`).

## Verträge
- #[[file:.kiro/specs/contracts/import-format.md]]
- #[[file:.kiro/specs/contracts/editor-output.md]]
- #[[file:.kiro/specs/contracts/export-format.md]]

## Specs
- #[[file:.kiro/specs/pipeline/requirements.md]]
- #[[file:.kiro/specs/pipeline/design.md]]
- #[[file:.kiro/specs/pipeline/tasks.md]]
