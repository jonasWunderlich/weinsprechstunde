---
name: domain-deploy-ftp
description: FTPS/SFTP-Deployment (scripts/weinlib/{config,ftp_transport,deploy}.py, deploy/, *_probe.py): Transport, Upload, Remote-Import-Download. Laden bei Arbeit an Deploy, FTP-Transport, Server-Upload oder Deploy-Specs.
inclusion: auto
---
# Domäne deploy-ftp

Scope: `scripts/weinlib/{config,ftp_transport,deploy}.py`, `deploy/`, `*_probe.py`. `scripts/weinimport.py` ist nur die Fassade. Diese Domäne stellt nur den Transport; Backups gehören zur Pipeline. `backup.py` nutzt den Transport: Änderungen an `ftp_transport.py` erfordern Backup-Tests. Nicht lesen: editor, weinliste, shared, pipeline. Export- und Build-Ergebnisse gelten als Eingabe laut Vertrag.

## Verträge
- #[[file:.kiro/specs/contracts/deploy-input.md]]
- #[[file:.kiro/specs/contracts/build-output.md]]

## Specs
- #[[file:.kiro/specs/deploy-ftp/requirements.md]]
- #[[file:.kiro/specs/deploy-ftp/design.md]]
- #[[file:.kiro/specs/deploy-ftp/tasks.md]]
