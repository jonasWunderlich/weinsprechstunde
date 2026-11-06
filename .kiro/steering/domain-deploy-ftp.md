---
name: domain-deploy-ftp
description: FTPS/SFTP-Deployment (deploy-Phase in scripts/weinimport.py, deploy/, *_probe.py, backup/): Upload, Remote-Import-Download, Server-Backups. Laden bei Arbeit an Deploy, Server-Upload, Backups oder Deploy-Specs.
inclusion: auto
---
# Domäne deploy-ftp

Scope: Deploy-Phase in `scripts/weinimport.py`, `deploy/`, `*_probe.py`, `backup/`. Nicht lesen: editor, weinliste, shared, pipeline. Export- und Build-Ergebnisse gelten als Eingabe laut Vertrag.

## Verträge
- #[[file:.kiro/specs/contracts/deploy-input.md]]
- #[[file:.kiro/specs/contracts/build-output.md]]

## Specs
- #[[file:.kiro/specs/deploy-ftp/requirements.md]]
- #[[file:.kiro/specs/deploy-ftp/design.md]]
- #[[file:.kiro/specs/deploy-ftp/tasks.md]]
