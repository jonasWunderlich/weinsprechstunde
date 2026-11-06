---
inclusion: always
---
# Weinsprechstunde: Domänenkarte

Weinbewertungen: Import-JSONs werden im Editor gepflegt, per Pipeline zu `wines.json` exportiert, in der öffentlichen Weinliste angezeigt und per FTPS/SFTP deployt.

| Domäne | Pfade |
|---|---|
| editor | `frontend/projects/editor/**` |
| weinliste | `frontend/projects/weinliste/**` |
| shared | `frontend/projects/shared/**` (Vertrag shared-api) |
| pipeline | `import/` -> `export/`, `scripts/weinimport.py` (optimize-images, prepare, export, image-export), `wine-schema.json` |
| deploy-ftp | Deploy-Phase in `scripts/weinimport.py`, `deploy/`, `*_probe.py`, `backup/` (FTPS/SFTP-Upload, Remote-Import-Download, Server-Backups) |

Orchestrierung (Makefile, `.github/workflows/deploy.yml`) ist domänenlos: siehe `orchestration.md`.

## Regel
Nur die eigene Domäne und deren Verträge laden. Andere Domänen (Code und Specs) nicht lesen. Verträge: `.kiro/specs/contracts/`, Domänen-Specs: `.kiro/specs/<domäne>/`. Domänen-Steering (`domain-*.md`) wird automatisch nach Thema geladen.
