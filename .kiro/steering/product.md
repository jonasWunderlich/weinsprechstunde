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
| pipeline | `import/` -> `export/`, `scripts/weinlib/{config,pipeline,backup}.py` (backup, optimize-images, prepare, export, image-export; Backup der bisherigen `wines.json` als eigener erster Schritt von `make deploy` bzw. Vollpipeline-Lauf, unabhängig von den übrigen Phasen), `wine-schema.json` |
| deploy-ftp | `scripts/weinlib/{config,ftp_transport,deploy}.py`, `*_probe.py` (FTPS/SFTP-Transport, Upload, Remote-Import-Download) |

Orchestrierung (Makefile, `.github/workflows/deploy.yml`) ist domänenlos: siehe `orchestration.md`.

## Regel
Nur die eigene Domäne und deren Verträge laden. Andere Domänen (Code und Specs) nicht lesen. Verträge: `.kiro/specs/contracts/`, Domänen-Specs: `.kiro/specs/<domäne>/`. Domänen-Steering (`domain-*.md`) wird automatisch nach Thema geladen.
