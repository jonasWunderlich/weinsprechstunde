# Abschlussbericht: Aufteilung der Python-Tests nach Domäne

Branch `test-split` (nicht gemergt, nicht gepusht). Produktivcode unverändert.

## Testlauf je Commit (alle 108 passed)
| Commit | Inhalt | Ergebnis |
|---|---|---|
| e801f20 | scripts/pytest.ini (testpaths = tests) | 108 passed |
| fee60fa | test_config.py nach tests/config/ | 108 passed |
| a7b6b2b | test_deploy.py nach tests/deploy_ftp/ | 108 passed |
| 4fae146 | Pipeline-Tests nach tests/pipeline/, REPO_ROOT/FIXTURES in conftest | 108 passed |
| 2f17f18 | test_properties.py in Pipeline- und Backup-Teil geteilt | 108 passed |
| fa9a3bb | make test, test-pipeline, test-deploy, test-config | 108 passed |
| letzter Commit | Steering, Specs, README (docs) | 108 passed (`.venv/bin/python -m pytest scripts/tests -q`) |

Hinweis: 4fae146 wurde einmal per `--amend` korrigiert (Importfehler in test_contract_fixtures.py), bevor weitergearbeitet wurde.

## ID-Diff
Vorher/Nachher-Test-IDs (Pfadpräfix entfernt, `test_properties_*.py` auf `test_properties.py` normalisiert): Diff leer. Vorher-Liste: `.agents/tasks/test-ids-before.txt`.

## Zahlen je Ordner
pipeline 64, deploy_ftp 28, config 16, Summe 108. Aufruf aus `scripts/`, den Unterordnern und dem Repo-Root funktioniert.

## Bytes (alle *.py)
| Ordner | vorher | nachher |
|---|---|---|
| scripts/tests gesamt | 98 512 | 98 930 |
| conftest.py | 2 733 | 3 244 |
| config | – | 11 419 |
| deploy_ftp | – | 31 061 |
| pipeline | – | 53 206 |

Die Zunahme (418 Bytes) stammt von Konstanten, `fresh_dir` in conftest und dem zweiten Docstring-Kopf.

## Dokumentation (letzter Commit)
- Steering: domain-pipeline, domain-deploy-ftp (Transportänderung -> zusätzlich pipeline/test_backup.py), weinlib-config/-pipeline/-deploy-ftp.
- Pfad `scripts/tests/pipeline/test_contract_fixtures.py` in import-format, editor-output, export-format, contracts-index ohne Versionsanhebung; pipeline/design.md, pipeline/tasks.md; deploy-ftp/design.md (Testing Strategy).
- README: Abschnitt "Tests" mit den make-Targets.
- grep nach `scripts/tests/test_` in .kiro (ohne _archive) und README: keine Treffer. _archive und historische Reports unverändert.

## Offene Punkte
- Optionales fileMatch-Steering für scripts/tests/pipeline/** und deploy_ftp/** nicht angelegt (Wirkung von fileMatch auf Testpfade ungeprüft).
- test_deploy.py (31 KB) nicht weiter zerlegt (Plan: später, falls nötig).
- CI führt weiterhin keine Tests aus (`make test` in deploy.yml wäre Verhaltenswechsel, Entscheidung beim User).
- Merge nach main steht aus.
- Untracked, nicht committet: ideas.md, .kiro/hooks/, .agents/tasks/weinlib-split/, test-ids-before.txt, test-split-plan.md, dieser Bericht.
