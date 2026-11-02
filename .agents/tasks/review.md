# Review (Pass 2): Python Import-Skript `scripts/weinimport.py` (weinliste Tasks 2–10)

Geprüft gegen Requirements 1–6, 17, 19 aus `.kiro/specs/weinliste/requirements.md`,
den Plan `.agents/tasks/plan.md` und den maßgeblichen Pseudocode in
`.kiro/specs/weinliste/design.md` (Abschnitt „1. Python Import-Skript").

Dies ist eine Folge-Prüfung. Die erste Prüfung hatte genau ein blockierendes
Finding (Deploy-Prune löscht die Server-`wines.json`, Req 6.6). Dieser Durchlauf
verifiziert primär den Fix und die vom Fix berührten Pfade und wiederholt keine
bereits erledigten Findings.

## Verifikations-Evidenz (nicht erneut ausgeführt)

Physische Laufspuren im Worktree belegen einen grünen Lauf NACH dem Fix:

- `.pytest_cache/v/cache/lastfailed` ist `{}` (null Fehlschläge beim letzten Lauf).
- `.pytest_cache/v/cache/nodeids` listet nun 52 Tests (zuvor 51) inkl. des neuen
  Regressionstests
  `test_deploy.py::test_deploy_never_prunes_server_wines_json_without_local_export`
  sowie aller Property-Tests `test_property_1..9,18,20,21`.
- Zeitstempel: der Fix-Code (`scripts/weinimport.py`, `test_deploy.py`) wurde
  04:56–04:57 geschrieben; die pytest-Cache-Artefakte (`lastfailed`/`nodeids`)
  datieren auf 04:57–04:59 — der grüne Lauf fand also nach dem Fix statt.
- `make -n deploy` wurde als eng begrenzter Spot-Check ausgeführt und bestätigt die
  Phasenreihenfolge prepare → export → image-export → `ng build` → deploy (Req 5.3).

Damit ist die geforderte Suite nachweislich grün; eine Neuausführung entfällt.

## Prior Finding — verifiziert als behoben

### Finding 1 (Pass 1) — Deploy löscht `wines.json` / Bilder auf dem Server (Req 6.6)

Behoben. Der Prune ist nun gegen die geschützten Pfade abgesichert:

- Neue Helfer `_protected_prefixes(config)` (liefert `exact = {Path(config.export_path).name}`
  — also `wines.json` — plus Verzeichnis-Präfixe für `remote_images_path`, falls
  dieses unter `remote_path` liegt) und `_is_protected(rel, exact, prefixes)`.
- `_deploy_sftp` und `_deploy_ftp` ermitteln `exact, prefixes = _protected_prefixes(config)`
  und reichen sie an `_sftp_prune` bzw. `_ftp_prune` weiter.
- Beide Prune-Funktionen löschen im `rel not in keep`-Zweig nur noch, wenn
  `not _is_protected(rel, exact, prefixes)`. Damit wird eine serverseitig bereits
  vorhandene `wines.json` nie entfernt — auch nicht, wenn `deploy` als Einzelphase
  ohne frische lokale `wines.json` läuft (Req 6.1/6.6).
- Für den Fall `remote_images_path` unterhalb `remote_path` deckt der Prefix-Zweig
  den gesamten Bilderordner ab.

Regressionsnachweis: `test_deploy_uploads_dist_and_never_deletes_wines_or_images`
enthält jetzt eine `wines.json` im Remote-Listing und asserted, dass sie nicht in
`removed` landet; `test_deploy_never_prunes_server_wines_json_without_local_export`
deckt explizit den Einzelphasen-Fall ohne lokale `wines.json` ab. Beide Tests sind
Teil des grünen Laufs.

## Positiv bestätigt (keine neuen Findings)

- **Wortwörtliche Fehlermeldungen (geprüft gegen requirements.md Zeile 183/184).**
  - Req 6.11 (`resolve_password`): `FEHLER: Kein Deploy-Passwort gefunden. Setze die
    Umgebungsvariable WEINSPRECHSTUNDE_DEPLOY_PASSWORD mit dem Server-Passwort,
    z. B.: export WEINSPRECHSTUNDE_DEPLOY_PASSWORD=deinPasswort` — Zeichen-für-Zeichen
    identisch.
  - Req 6.12 (`phase_deploy`): `FEHLER: Verbindung zum Server {host} fehlgeschlagen.
    Server-Meldung: {e}. Bitte prüfe: (1) Ist der Hostname '{host}' korrekt? (2) Sind
    Benutzername und Passwort gültig? (3) Ist der Server erreichbar und das Protokoll
    ({protocol}) korrekt?` — Platzhalter host/Server-Meldung/protocol korrekt
    eingesetzt, Wortlaut identisch.
- **scaffold_mode true/false.** `apply_scaffold_mode` nutzt `get_scaffold_fields`
  (alle Felder aus `wine-schema.json`); `true` füllt fehlende Felder mit `None` und
  erhält bestehende Werte (Req 2.14, Property 4), `false` entfernt nur `None`/`""`
  (`0`/`False` bleiben erhalten, Req 2.15, Property 5).
- **tasting_date nie überschrieben.** EXIF wird nur `if "tasting_date" not in data`
  gelesen (Req 2.7); Unit-Test `test_existing_tasting_date_not_overwritten` und
  Property 3 belegen es. Das abgeleitete Datum wird in die JSON-Quelldatei
  zurückgeschrieben (Req 2.6).
- **Zwei-Tier Rolling-Window-Backup.** `phase_backup`/`_prune_backups`: `last_` bei
  jedem Lauf (Window `max_last_backups`), `archival_` nur bei fälligem Intervall
  (Window `max_archival_backups`), `.last_archival` persistiert (Req 19.8),
  Backup-Fehler → Warnung + Pipeline läuft weiter (Req 19.9). Properties 20/21 und
  Unit-Tests belegen Rolling-Window und Intervall.
- **Sortierung.** `phase_export` sortiert datierte Weine absteigend nach
  `tasting_date`, undatierte ans Ende (Req 3.5, Property 6,
  `test_sort_descending_dates_undated_last`).
- **Kein Löschen von wines.json/Bildern beim Deploy** — siehe Finding-1-Fix oben
  (Req 6.6).
- **Englische Feldnamen durchgängig**; `load_config` parst verschachtelte dicts
  explizit zu `DeployConfig`/`EditorConfig`/`BackupConfig`
  (`test_load_config_parses_nested_dataclasses`, Req 1).
- **Config/Schema-Fehler** → lesbare stderr-Meldung + exit 1 (Req 1.3, 17).
- **Property-Tests** 1–9, 18, 20, 21 vorhanden, jeweils mit Tag-Kommentar
  `# Feature: weinliste, Property N: …` und `@settings(max_examples=100)`
  (20/21/9 zusätzlich `deadline=None`); Unit-Tests pro Phase vorhanden.
- **Build-Pipeline.** Makefile (Einzel-Targets + volle `deploy`-Pipeline),
  `frontend/package.json` `prebuild` (drei Phasen mit `&&` → Abbruch bei Fehler,
  Req 5.1/5.5), `.github/workflows/deploy.yml` (Push auf main, Secrets-Env,
  Req 5.6).

## Urteil

APPROVED — das einzige Finding aus Pass 1 ist behoben und durch Tests abgesichert;
die Verifikations-Evidenz belegt einen grünen Lauf nach dem Fix. Es verbleiben keine
blockierenden Findings gegen die Requirements 1–6, 17, 19.
