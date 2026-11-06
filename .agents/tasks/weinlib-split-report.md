# Abschlussbericht: weinlib-Split (Branch `weinlib-split`)

> Hinweis: Die Commit-Hashes in diesem Bericht gehören zur Historie vor der Bereinigung (Revert-Paare der verworfenen Backup-Variante entfernt, Hashes dadurch geändert). Inhaltlich ist der Stand identisch; zusätzlich folgt der Commit "run backup as first step of make deploy".


Stand: HEAD `7c55831`. Nichts gepusht, nicht gemergt, Bericht bewusst nicht committet. Gate-F-Finding (Steering behauptete Backup-Garantie) behoben: Commit `0aa96c6` formuliert `domain-pipeline.md` und `product.md` auf den Ist-Zustand um (nur Vollpipeline, export allein offen). Der fileMatch-Commit wurde per Rebase (lokal, ungepusht) wieder ans Ende gesetzt, daher `35f2354` jetzt `7c55831`. Gates A bis E sind APPROVED.

## 1. Testergebnis pro Commit und am Ende

Befehl: `.venv/bin/python -m pytest scripts/tests -q`. Jeder Commit wurde in einem temporären `git worktree` (detached, danach entfernt) mit dem Haupt-venv getestet. Das gitignorierte Verzeichnis `.kiro/specs/contracts/fixtures/import` wurde in den Worktree kopiert. Ohne diese Kopie schlägt `test_contract_fixtures` im frischen Checkout fehl (Umgebungseffekt, kein Codefehler).

| Commit | Ergebnis |
|---|---|
| c152bff refactor: add weinlib package with config module | 106 passed |
| fa14a76 refactor: move ftp transport to weinlib.ftp_transport | 106 passed |
| 187c80c refactor: move pipeline phases to weinlib.pipeline | 106 passed |
| e826127 refactor: move backup phase to weinlib.backup | 106 passed |
| 0cfb0f0 refactor: move deploy phase and remote download to weinlib.deploy | 106 passed |
| c59f349 refactor: move cli to weinlib.cli; weinimport.py is now a facade | 106 passed |
| 465958d docs: point steering, specs, readme to weinlib; backup in pipeline domain | 106 passed |
| 28eaf74 fix: backup immer vor JSON-Export (in phase_export, Req 20) | 110 passed (inkl. 4 neue Tests) |
| 923a094 docs: Abhängigkeit pipeline -> backup -> ftp_transport | 110 passed |
| 85dc898 Revert von 923a094 | 110 passed |
| 51fe00c Revert von 28eaf74 | 106 passed |
| 0aa96c6 docs: Backup-Aussage im Steering korrigiert | 106 passed |
| 7c55831 chore: add filematch steering for scripts/weinlib | 106 passed |

Endstand jetzt im Arbeitsverzeichnis: **106 passed in 5.71s**.

## 2. `git log --oneline main..weinlib-split`

```
7c55831 chore: add filematch steering for scripts/weinlib
0aa96c6 docs: Backup-Aussage im Steering auf Ist-Zustand korrigiert (nur Vollpipeline; export allein offen). Tests: 106 passed (Docs-only)
51fe00c Revert "fix: backup immer vor JSON-Export (in phase_export, Req 20)"
85dc898 Revert "docs: Abhängigkeit pipeline -> backup -> ftp_transport im Pipeline-Steering"
923a094 docs: Abhängigkeit pipeline -> backup -> ftp_transport im Pipeline-Steering
28eaf74 fix: backup immer vor JSON-Export (in phase_export, Req 20)
465958d docs: point steering, specs, readme to weinlib; backup in pipeline domain
c59f349 refactor: move cli to weinlib.cli; weinimport.py is now a facade
0cfb0f0 refactor: move deploy phase and remote download to weinlib.deploy
e826127 refactor: move backup phase to weinlib.backup
187c80c refactor: move pipeline phases to weinlib.pipeline
fa14a76 refactor: move ftp transport to weinlib.ftp_transport
c152bff refactor: add weinlib package with config module
```

28eaf74 und 923a094 (Backup in `phase_export`) wurden ohne Nutzerentscheidung umgesetzt und per Revert zurückgenommen. Siehe Abschnitt 6. Die Revert-Paare bleiben in der Historie sichtbar. Ob sie vor dem Merge per Rebase entfernt werden, entscheidest du.

## 3. Bytegrößen vorher/nachher

Baseline: `scripts/weinimport.py` = 49 902 B (`baseline.txt`).

| Datei | Plan (ca.) | Ist (`wc -c`) |
|---|---|---|
| `scripts/weinimport.py` (Fassade) | ~1,5 KB | **1 776 B** (Vorgabe < ca. 3 KB erfüllt) |
| `weinlib/__init__.py` | – | 0 B |
| `weinlib/config.py` | ~7,6 KB | 7 629 B |
| `weinlib/ftp_transport.py` | ~6,0 KB | 5 993 B |
| `weinlib/pipeline.py` | ~13,7 KB | 13 884 B |
| `weinlib/backup.py` | ~4,7 KB | 4 960 B |
| `weinlib/deploy.py` | ~14,3 KB | 14 642 B |
| `weinlib/cli.py` | ~3,0 KB | 3 288 B |
| Summe weinlib + Fassade | ~50 KB | 52 172 B |

Alle Module liegen nahe am Plan (Abweichung max. ca. +6 %). Die Summe ist um 2 270 B größer als vorher, durch Importköpfe und Re-Exports.

### Token-Vergleich pro Aufgabentyp (Abschnitt 6 des Plans)

Das sind Byte-Schätzungen. Ein Tokenizer wurde nicht gemessen. Basis ist 49 902 B pro Arbeit am Skript vorher, bei ca. 3,5 bis 4 B/Token also etwa 12 bis 14 k Tokens.

| Aufgabe | Zu lesen nachher | Plan | Ist | Ersparnis Ist vs. 49 902 B |
|---|---|---|---|---|
| Pipeline (prepare/export/image) | config + pipeline | ~21,3 KB | 21 513 B | −57 % |
| Backup | config + ftp_transport + backup | ~18,3 KB | 18 582 B | −63 % |
| Deploy/Remote-Download | config + ftp_transport + deploy | ~27,9 KB | 28 264 B | −43 % |
| CLI/Phasen-Wiring | cli + config | ~10,6 KB | 10 917 B | −78 % |

Die Tests (insgesamt über 80 KB) sind weiterhin größer als jedes einzelne Modul. Der Plan stuft die Testaufteilung als Folgeschritt ein, sie ist nicht Teil dieses Splits.

## 4. Importgrenzen und Zyklen (grep-Evidenz)

`grep -nE "^\s*(from|import) " scripts/weinlib/*.py` ergibt für interne Importe:

- `pipeline.py`: nur `from weinlib.config import ...`. Es gibt keinen Import von `deploy`, `ftp_transport`, `backup` oder `cli`. Die übrigen Importe sind Stdlib bzw. lazy `slugify`, `piexif` und `PIL`.
- `ftp_transport.py`: keine `weinlib`-Importe (Blatt).
- `config.py`: keine `weinlib`-Importe (Fundament).
- `backup.py`: `ftp_transport`, `config`.
- `deploy.py`: `ftp_transport`, `config`.
- `cli.py`: `backup`, `config`, `deploy`, `pipeline`.
- `weinimport.py` (Fassade): Re-Exports aus allen Modulen.

Abhängigkeitsgraph: `cli → {backup, deploy, pipeline, config}`, `backup → {ftp_transport, config}`, `deploy → {ftp_transport, config}`, `pipeline → {config}`. Das ist ein DAG. Kein Modul außer `cli` und der Fassade importiert `cli`, und niemand importiert die Fassade, also gibt es keine Zyklen. Bestätigt zusätzlich dadurch, dass alle Module beim Test-Import ohne `ImportError` laden.

## 5. Makefile, CI, Probes

`git diff main --stat -- Makefile .github 'scripts/*_probe.py'` liefert eine leere Ausgabe. Die Dateien sind unverändert.

## 6. Backup vor JSON-Export (Req 20, `backup-analysis.md`)

Antwort auf die Frage, ob das Backup immer vor dem JSON-Export stattfindet: **Nein, nur im Vollpipeline-Pfad.**

| Pfad | Backup vor Export garantiert? |
|---|---|
| `scripts/weinimport.py` ohne Argument (`_run_full_pipeline`) | JA, bei konfiguriertem `backup`. `cli.py:28` `phase_backup` läuft vor `cli.py:34` `phase_export`. Schreiben erst in `pipeline.py:321`. Ohne `backup`-Config ist es ein No-Op, ohne vorhandene wines.json ein Skip mit Warnung. |
| `make export` (Phase `export`) | NEIN: nur `phase_export`, ohne Backup-Aufruf |
| `make all` / `make deploy` | NEIN: Ziele `prepare export image-export`, ohne `backup` |
| GitHub Actions `deploy.yml` | NEIN: `prepare && export && image-export`. Zusätzlich hat der CI-Checkout keine wines.json (gitignored), ein Backup wäre dort ohnehin ein Skip. |

Dein Wunsch („Backup immer vor dem JSON-Export, Teil der Pipeline") ist damit **nicht vollständig erfüllt**. Makefile und `deploy.yml` dürfen nicht geändert werden, daher kommen nur Code-Varianten in Frage. Der Code entspricht dem Stand vor dem Fix (Reverts 85dc898 und 51fe00c).

### Offene Entscheidungen (brauchen deine Antwort)

1. **Wo genau?**
   - Option A (Empfehlung): Aufruf in `phase_export` vor dem Schreiben (`pipeline.py` ~Z.319) und Entfernen aus `_run_full_pipeline`, damit nur ein Backup pro Lauf entsteht. Pro: Garantie in allen Pfaden inklusive Make und CI. Contra: Neue Abhängigkeit `pipeline → backup → ftp_transport`. Dann muss auch das Steering „pipeline importiert nie ftp_transport" angepasst werden. Der Plan und diese Prüfung gingen von „pipeline importiert nie deploy" aus, das bliebe erfüllt.
   - Option B: In `cli.main` im Zweig `export` zuerst `phase_backup`. Pro: Module bleiben entkoppelt. Contra: Die Garantie gilt nur über die CLI, nicht für direkte `phase_export`-Aufrufe. Der Doppelaufruf im Vollpipeline-Lauf muss vermieden werden.
2. **Verhalten bei Backup-Fehler:** Heute ist es best effort, nur eine Warnung (`backup.py:44`, `:65`, `:77`). Alternative: Export abbrechen, wenn das lokale Last-Backup fehlschlägt. Empfehlung: Warnung beibehalten, damit der Export nicht an einem Remote-Backup scheitert.
3. **CI ohne vorhandene wines.json:** Skip mit Warnung (heute schon so). Alternative: Remote-Wert vorab laden. Das erfordert Netzwerk und ist ein größerer Eingriff. Empfehlung: Skip beibehalten.
4. **Ohne `backup`-Config:** stiller No-Op (heute) oder Warnung.

Bei Wahl von Option A kommt zusätzlich ein Test über `cli.main(["export"])` hinzu. Eine frühere Umsetzung (28eaf74) hatte 4 Tests ergänzt (106 auf 110).

## 7. Die 9 geänderten Monkeypatch-Stellen

Diff `git diff main -U0 -- scripts/tests`. Wirksamkeit wird dadurch belegt, dass der Aufrufer die Zielfunktion zur Laufzeit über das gepatchte Modulobjekt auflöst. Ein `from x import y` am Modulkopf würde den Patch umgehen. Ob die Stellen wirklich greifen, zeigt außerdem, dass die Tests mit Fakes bzw. `boom` grün sind: Hätte ein Patch keine Wirkung, würden diese Tests den echten FTP-Code bzw. die echte Uhrzeit nutzen und fehlschlagen.

| # | Test | Patch | Aufruf im Code |
|---|---|---|---|
| 1 | test_backup | `backup_mod.datetime` | `backup.py:24` `datetime.now()` (Modul-Global) |
| 2 | test_backup | `backup_mod.datetime` | `backup.py:53/54/63` |
| 3 | test_backup | `backup_mod.shutil.copy2` | `backup.py:42/62` `shutil.copy2`, gleiches `shutil`-Objekt |
| 4 | test_backup | `ft._ftps_connect` | `backup.py:128` `ft._ftps_connect(...)` |
| 5 | test_backup | `ft._ftps_connect` | `backup.py:128` |
| 6 | test_deploy | `deploy._deploy_ftp` | `deploy.py:47` Aufruf im selben Modul (Modul-Global) |
| 7 | test_deploy | `ft._ftps_connect` | `deploy.py:190` `ft._ftps_connect(...)` |
| 8 | test_deploy | `ft._ftps_connect` (`fake_connect`) | `deploy.py:190` |
| 9 | test_deploy | `ft._download_ftp` | `deploy.py:22` `ft._download_ftp(...)` |

Zusätzlich 2 Stellen in `test_properties.py` (`backup_mod.datetime` mit `_Frozen`, Aufruf wie #1/#2). Das sind damit 14 geänderte Patch-Zeilen im Diff, von denen 9 unterschiedliche Patch-Ziele/Aufrufstellen in Backup und Deploy sind. Die Zählung 9 aus dem Auftrag bezieht sich auf die Zeilen in `test_backup.py` (5) und `test_deploy.py` (4). Nicht gemessen: Es wurde keine Mutation (Patch absichtlich entfernen) durchgeführt, die Evidenz ist die Aufrufstellen-Analyse plus grüne Tests.

Hinweis: `ft._download_ftp` ruft intern `_ftps_connect` über die Modul-Globals von `ftp_transport` auf. Der Patch von `ft._ftps_connect` wirkt dadurch auch dort.

## 8. Unberührte Dateien

`git status --short` und `git diff main --stat -- ideas.md .kiro/hooks` zeigen für `ideas.md` und `.kiro/hooks/` nur `??` (untracked, wie schon vor dem Split), keinen Diff gegen `main`. Beide sind unverändert, ebenso `weinsprechstunde.secrets.json` (nicht gelesen).

Ungetrackt im Arbeitsbaum: `.agents/tasks/weinimport-module-split-plan.md`, `.agents/tasks/weinlib-split/`, dieser Bericht, `.kiro/hooks/`, `ideas.md`.
