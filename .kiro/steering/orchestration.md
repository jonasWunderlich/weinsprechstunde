---
inclusion: fileMatch
fileMatchPattern: ["Makefile", ".github/**"]
---
# Orchestrierung (keine Domäne)

Makefile und `.github/workflows/deploy.yml` rufen nur die Domänen-Kommandos auf. Fachlogik gehört in die Domänen.

## Makefile
- `optimize-images`, `prepare`, `export`, `image-export`: je `python scripts/weinimport.py <phase>` (Pipeline).
- `all`: optimize-images -> prepare -> export -> image-export (ohne deploy).
- `backup`: `weinimport.py backup` (Pipeline, Req 20).
- `deploy`: zuerst `backup` (allererster Schritt, unabhängig), dann optimize-images, prepare, export, image-export, dann `npm run build` und `npm run build:editor` (in `frontend/`), dann `weinimport.py deploy` (deploy-ftp). `FORCE_IMAGES=1` reicht `--force-images` durch.
- `PYTHON` überschreibbar (Default: `.venv/bin/python`, sonst `python3`).

## `.github/workflows/deploy.yml` (Push auf main)
1. Python 3.12 und Node 20, `pip install -r scripts/requirements.txt`, `npm ci` in `frontend/`.
2. `prepare && export && image-export` (bei `import_source = "remote"` lädt prepare den Import-Ordner per SFTP/FTP).
3. `npm run build` (Weinliste) und `npm run build:editor` (Editor).
4. `weinimport.py deploy` (Editor nur bei gesetztem `deploy.remote_editor_path`).
Zugangsdaten nur über Secrets `WEINSPRECHSTUNDE_DEPLOY_HOST|USER|PASSWORD`.

Makefile und CI bauen beide Apps.
