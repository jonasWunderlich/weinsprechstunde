# Design: deploy-ftp

Verträge:
- #[[file:.kiro/specs/contracts/deploy-input.md]] (Eingaben, Remote-Pfade, Reihenfolge, Prune-Invarianten)
- #[[file:.kiro/specs/contracts/build-output.md]] (Build-Befehle, Dist-Pfade, Build-Aufrufer Makefile/CI)

## Aufrufe

| Aufruf | Verhalten |
|---|---|
| `python weinimport.py deploy` | Phase deploy |
| `python weinimport.py deploy --force-images` | alle Bilder neu hochladen; auch `make deploy FORCE_IMAGES=1` |
| `make deploy` | Import-Phasen + Builds (siehe build-output) + Phase deploy |

## Phase deploy

`phase_deploy(config, force_images)`: `resolve_password` (Config-Passwort > Secrets-Datei > `WEINSPRECHSTUNDE_DEPLOY_PASSWORD`; sonst Fehlermeldung Req 6.11, `exit 1`) → `_deploy_ftp`; jede Exception → Fehlermeldung Req 6.12, `exit 1`.

## FTPES-Verbindung (`_ftps_connect`)

- Transport `ftplib.FTP_TLS`-Subklasse `_ReuseTLS_FTP`: `connect(host, 21)` → `auth()` → `login` → `prot_p()` → `set_pasv(True)`.
- Zertifikat: `ssl._create_unverified_context()`; mit `FTPS_VERIFY=1` `ssl.create_default_context()`.
- TLS-Session-Reuse: `ntransfercmd` wrappt den Datenkanal mit der TLS-Session des Kontrollkanals (`self.sock.session`). Pure-FTPd (Host Europe) verlangt das, sonst hängen Listing/Upload/Download. Greift nur bei `prot_p` und vorhandener Session.
- Alle FTPES-Transfers laufen über `_ftps_connect`; Helfer `_upload_ftp`, `_ftp_makedirs`, `_ftp_prune`, `_ftp_list_entries`, `_ftp_is_dir`, `_ftp_up_to_date`, `_ftp_download_dir` arbeiten auf dem übergebenen Verbindungsobjekt.

## Verzeichnislisting (`_ftp_list_entries`)

MLSD: ein Roundtrip je Verzeichnis liefert Name und Typ, kein `_ftp_is_dir` nötig (vorher zwei `cwd`-Roundtrips je Eintrag; bei ~476 Bildern blockierte das den Prune). Fallback `nlst` + `_ftp_is_dir`.

## Deploy-Logik

- Build-Wurzel: `_resolve_dist_dir` (Reihenfolge in deploy-input). `index.html` landet direkt unter `remote_path`.
- Reihenfolge: Weinliste-Dist → Prune (nur unter `remote_path`) → `wines.json` + `wine-schema.json` nach `remote_import_path` → Bilder nach `remote_images_path` → Editor-Dist nach `remote_editor_path`.
- Prune: `_protected_prefixes(config)` = `images/`, `data/`, `wines.json`-Basename, `remote_editor_path`; `_ftp_prune` steigt in geschützte Teilbäume nicht hinab. Web-Root und Root-`.htaccess` bleiben unberührt.
- Kein Pre-Deploy-Backup (Webspace ohne serverseitige Kopie; Live-Stand wird bewusst überschrieben).
- Zeitvergleich per `MDTM` (`_ftp_up_to_date`); `--force-images` überspringt ihn für Bilder (immer `STOR`).
- Zugangsdaten nie in der Config.

## Root-Rewrite und base-href

App liegt physisch unter `/wine_app`, ist unter `https://weinsprechstunde.de/` erreichbar. Manuell eingerichtetes Root-`.htaccess` (versioniert in `deploy/htaccess-webroot.txt`, NICHT vom Deploy verwaltet) schreibt intern nach `/wine_app/` um (kein `R=`-Redirect, SPA-Fallback auf `/wine_app/index.html`). `<base href="/">` bleibt; Assets `/data/...`, `/images/...` werden 1:1 auf `/wine_app/...` gemappt.

## GitHub Actions (`.github/workflows/deploy.yml`)

Trigger: Push auf `main`. Job `deploy` (ubuntu-latest): `actions/checkout@v4`, `setup-python@v5` (3.12), `setup-node@v4` (20), `pip install -r scripts/requirements.txt`, `npm ci` in `frontend`, Import-Pipeline `python scripts/weinimport.py prepare export image-export` (Secrets als `WEINSPRECHSTUNDE_DEPLOY_HOST|USER|PASSWORD` in `env`), `npm run build` und `npm run build:editor` in `frontend`, `python scripts/weinimport.py deploy` (gleiche Secrets). Bei `import_source = "remote"` lädt das Skript den Import-Ordner zu Beginn von `prepare`. Editor-Deploy nur bei gesetztem `deploy.remote_editor_path` (leer = übersprungen).

## Error Handling

| Szenario | Verhalten |
|---|---|
| Kein Passwort (Config, Secrets, Umgebung) | Meldung Req 6.11, `exit 1` |
| Verbindungsfehler | Meldung Req 6.12 (Host, Protokoll, Server-Meldung), `exit 1` |
| MLSD nicht unterstützt | Fallback `nlst` + `_ftp_is_dir` |
| Import-Phase in Makefile/CI fehlgeschlagen | Abbruch vor Build/Deploy |
| Editor-Dist fehlt | Editor-Schritt still übersprungen (deploy-input) |

## Testing Strategy

pytest in `scripts/tests/deploy_ftp/` (`make test-deploy`), Fake-FTP: Timestamp-Vergleich, selektives Löschen, geschützte Präfixe (Prune betritt sie nicht), MLSD-Fallback, `--force-images`, Passwort-Fallback, Dist-Auflösung (`_resolve_dist_dir`).
