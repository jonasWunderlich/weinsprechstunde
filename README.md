# Weinsprechstunde

Monorepo für die Weinsprechstunde:

- `scripts/weinimport.py` — Python-CLI (Import-/Export-/Image-/Deploy-Phasen); Einstieg, Logik in `scripts/weinlib/`
- `frontend/` — Angular-SPA
- `.kiro/specs/` — Specs je Domäne (`editor`, `weinliste`, `pipeline`, `deploy-ftp`) und Verträge (`contracts/`)

Die App läuft live unter `https://weinsprechstunde.de/`. Der Deploy überträgt per
FTPES direkt in den Web-Root (`/`): Build-Output, `data/` mit
`wines.json`/`wine-schema.json`, `images/`, `audio/` und `video/`; der Editor
liegt unter `/edit`. Beim Deploy werden auf dem Server nur veraltete `.js`- und
`.css`-Dateien gelöscht; alle anderen Dateien (z. B. `.htaccess`, `backup/`)
bleiben unberührt.

## Tests
Python-Tests (pytest, hypothesis) liegen in `scripts/tests/`, getrennt nach Domäne:
- `make test` — alle Tests
- `make test-pipeline` — `scripts/tests/pipeline` (inkl. Backup)
- `make test-deploy` — `scripts/tests/deploy_ftp`
- `make test-config` — `scripts/tests/config`
