# Weinsprechstunde

Monorepo für die Weinsprechstunde:

- `scripts/weinimport.py` — Python-CLI (Import-/Export-/Image-/Deploy-Phasen); Einstieg, Logik in `scripts/weinlib/`
- `frontend/` — Angular-SPA
- `.kiro/specs/weinliste/` — Spezifikation (requirements.md, design.md)

Die App läuft live unter `https://weinsprechstunde.de/`. Physisch liegt der
Angular-Build im Unterordner `wine_app/` des Web-Roots; der Deploy überträgt per
FTPES ausschließlich nach `/wine_app` (Build-Output, `data/` mit
`wines.json`/`wine-schema.json`, `images/`). Ein Root-`.htaccess` mappt alle
Requests transparent nach `/wine_app/` um, sodass die sichtbare URL `/` bleibt.

## Tests
Python-Tests (pytest, hypothesis) liegen in `scripts/tests/`, getrennt nach Domäne:
- `make test` — alle Tests
- `make test-pipeline` — `scripts/tests/pipeline` (inkl. Backup)
- `make test-deploy` — `scripts/tests/deploy_ftp`
- `make test-config` — `scripts/tests/config`

## Deploy / .htaccess

Der transparente Rewrite liegt versioniert in
[`deploy/htaccess-webroot.txt`](deploy/htaccess-webroot.txt). Diese Datei wird
**nicht** vom Deploy-Skript verwaltet — der Deploy berührt nur `/wine_app` und
lässt den Web-Root unangetastet.

Einmalige, manuelle Einrichtung auf dem Server (per FTPES-Client):

1. `deploy/htaccess-webroot.txt` als `/.htaccess` in den Web-Root (das
   Verzeichnis, in dem der FTP-Login landet) hochladen.
2. Ein eventuell vorhandenes altes Root-`index.html` **entfernen oder
   umbenennen**. Andernfalls verdeckt es die App: Regel 3 der `.htaccess`
   liefert eine existierende Root-Datei direkt aus, statt auf `/wine_app` zu
   fallen, sodass `/` nicht auf die App zeigt.

Danach läuft der reguläre Deploy (`python scripts/weinimport.py deploy`) ohne
weitere Eingriffe am Web-Root; er aktualisiert nur den Inhalt von `/wine_app`.
Ändert sich die `.htaccess` später, ist sie erneut manuell hochzuladen.
