# Prune überspringt geschützte Teilbäume, MLSD-Listing, ruhiges Logging, `--force-images`

Der Fix adressiert die Deploy-Blockade der Weinsprechstunde-Pipeline auf vier Ebenen: der Prune-Walk betritt die geschützten Teilbäume `images/` und `data/` gar nicht mehr (kein Abstieg, kein Listing, keine Typprüfung), Verzeichnisinhalte werden primär über `ftp.mlsd()` in einem Roundtrip pro Verzeichnis ermittelt (mit robustem `nlst`+`_ftp_is_dir`-Fallback), `prepare` und `image-export` loggen nicht mehr pro Datei/Bild sondern nur eine Zusammenfassungszeile, und ein neues CLI-Flag `--force-images` lädt beim Deploy alle Bilder per STOR neu hoch. Die Änderung ist in einem Commit (`8808ba7`) gebündelt, Spec (requirements.md + design.md) und Makefile sind mitgezogen. Die Verifikation lief laut Commit-Message lokal über Fake-FTP/Mocks (`pytest scripts/tests -q` → 118 passed), ohne echten Deploy oder Netzwerk — konform zu den Constraints.

Watch for: keine blockierenden Punkte. Zwei Beobachtungen mit geringer Tragweite — die `image-export`-Zusammenfassung wird auch bei 0/0/0 geschrieben (confirmed), und `--force-images` ist ein parser-weites Flag, das bei anderen Phasen stillschweigend ignoriert wird (confirmed) — beide sind bewusste, harmlose Trade-offs.

**Verdict**: APPROVED

## High-level view

Der Kern des Fixes ist die Entkopplung von Prune-Rekursion und geschützten Ordnern: `_ftp_prune.walk()` prüft bei jedem Verzeichnis zuerst, ob dessen Relativpfad einem geschützten Präfix entspricht, und überspringt es dann komplett — vorher wurde erst abgestiegen und pro Eintrag gelöscht/geprüft. Damit entfällt die Rekursion über die ~476 Bilder unter `/wine_app/images`, die den Deploy faktisch blockierte.

Orthogonal dazu ersetzt `_ftp_list_entries` die teure Per-Eintrag-Typerkennung (`_ftp_is_dir` = zwei `cwd`-Roundtrips) durch ein einziges `MLSD`-Listing pro Verzeichnis, das Name und Typ liefert. Fällt MLSD aus, greift transparent der alte `nlst`+`_ftp_is_dir`-Pfad — die Schutzlogik hängt nicht von MLSD ab, sondern allein von der Präfixprüfung, bleibt also in beiden Pfaden korrekt. `_ftp_download_dir` nutzt denselben Helfer.

Beim Logging sammeln `prepare` und `image-export` jetzt Zähler (übersprungene Umbenennungen bzw. skaliert/übersprungen/fehlend) und schreiben höchstens eine Zusammenfassungszeile statt einer Warnung pro Datei. `rename_file_group` gibt dafür die Anzahl Kollisionen zurück.

Die API-Oberfläche wächst um das parser-weite `--force-images`; in `_deploy_ftp` schaltet es den `_ftp_up_to_date`-Vergleich für Bilder aus, sodass alle Bilder per STOR gehen. Das Makefile reicht es als `make deploy FORCE_IMAGES=1` durch. Sicherheits-/TLS-Pfad (`_ReuseTLS_FTP`/`_ftps_connect`) ist unangetastet.

<details>
<summary>Issues (2)</summary>

1. **Leere image-export-Zusammenfassung** — Die Zeile `image-export: 0 skaliert, 0 bereits vorhanden übersprungen, 0 Quellen fehlten.` wird auch geschrieben, wenn gar keine Bilder verarbeitet wurden. Harmlos, optional könnte man bei allen Zählern auf 0 die Zeile unterdrücken.
2. **`--force-images` parser-weit** — Das Flag ist am Hauptparser definiert und wird bei anderen Phasen (`prepare`, `export`, …) klaglos akzeptiert, aber ignoriert. Help-Text dokumentiert „nur deploy"; keine Aktion nötig, nur bewusst halten.

</details>

<details>
<summary>Details</summary>

### Prune betritt geschützte Teilbäume nicht mehr

Der zentrale Fix sitzt in `walk()` innerhalb `_ftp_prune`. Für jeden Eintrag mit `is_dir=True` wird vor dem Rekursionsabstieg `_is_protected(f"{rel}/", exact, prefixes)` geprüft; trifft ein Präfix (`images/`, `data/`), wird `continue` ausgeführt — kein `_ftp_list_entries` auf dem Unterverzeichnis, keine Typprüfung, kein `delete`. Das ist genau die in Aufgabe 1 geforderte „gar nicht betreten"-Semantik und zugleich der Performance-Hebel: die Rekursion über hunderte Bilder entfällt vollständig.

Der Schutz ist unabhängig vom Listing-Mechanismus: die Entscheidung hängt allein am Relativpfad-Präfix, nicht an MLSD oder `_ftp_is_dir`. Damit bleibt der Schutz auch im Fallback-Pfad erhalten. `test_prune_uses_mlsd_and_does_not_enter_protected_dirs` weist nach, dass `f"{base}/images"` und `f"{base}/data"` nie in `mlsd_calls` landen, `stale.js` aber gelöscht wird und `wines.json` bleibt.

### MLSD-Listing mit Fallback

`_ftp_list_entries` iteriert `ftp.mlsd(remote_dir)` und mappt `type` auf ein `is_dir`-Flag, wobei `.`/`..` und die MLSD-Pseudotypen `cdir`/`pdir` übersprungen werden. Schlägt MLSD fehl — abgefangen werden `error_perm`, `error_proto`, `AttributeError`, `OSError` — wird auf `nlst` + `_ftp_is_dir` pro Eintrag zurückgefallen.

```python
except (ftplib.error_perm, ftplib.error_proto, AttributeError, OSError):
    result = []
    for name in ftp.nlst(remote_dir):
        ...
        result.append((base, _ftp_is_dir(ftp, remote_entry)))
    return result
```

`AttributeError` im except-Satz deckt den Fall ab, dass das Verbindungsobjekt kein `mlsd` kennt — genau das passiert beim alten `FakeFTP` ohne MLSD, wodurch `test_deploy_prunes_only_within_remote_path` jetzt implizit den Fallback-Pfad durchläuft. `test_prune_mlsd_deletes_stale_nested_dist_file` zeigt, dass der MLSD-Pfad in ungeschützte Unterordner (`assets/`) absteigt und dort veraltete Dateien löscht — die Normalfunktion des Prune bleibt also erhalten, nicht nur die Schutzregel.

### Ruhiges Logging in prepare und image-export

`rename_file_group` gibt jetzt die Zahl der Kollisionen zurück statt pro Kollision auf stderr zu schreiben; `phase_prepare` summiert und schreibt am Ende höchstens `prepare: N Umbenennung(en) übersprungen (Zieldatei existierte bereits).`. `phase_image_export` führt die Zähler `scaled`/`skipped`/`missing` und gibt eine einzige Zeile aus. Die bereits-aktuell-Erkennung (`dst.stat().st_mtime >= src.stat().st_mtime`) überspringt jetzt still.

`test_no_per_image_skip_warnings_only_summary` prüft scharf, dass genau eine Zeile (`err.count("\n") == 1`) und keine Pro-Bild-Warnung ausgegeben wird; `test_rename_collision_skips_with_summary` prüft die Abwesenheit von `WARNUNG: Zieldatei` und das Vorhandensein der Zusammenfassung. Die `image-export`-Zeile wird allerdings auch bei 0/0/0 geschrieben — ein leeres `import_dir` erzeugt trotzdem eine Zusammenfassungszeile. Das ist eine einzelne Zeile und eher informativ als störend, aber es ist kein stilles No-op mehr.

### `--force-images` und Makefile-Durchreichung

`build_parser` definiert `--force-images` als `store_true` am Hauptparser; `main` reicht `args.force_images` an `phase_deploy` → `_deploy_ftp` durch. In der Bilder-Schleife wird `force_images or not _ftp_up_to_date(...)` ausgewertet, sodass bei gesetztem Flag der MDTM-Vergleich übersprungen und immer `STOR` ausgeführt wird. `test_force_images_reuploads_all_images_even_if_up_to_date` setzt beide Remote-Bilder auf einen Zukunfts-Timestamp und weist nach, dass trotzdem beide hochgeladen werden; `test_without_force_images_skips_up_to_date_images` bestätigt das Gegenteil für den Default (aktuelles Bild übersprungen, fehlendes hochgeladen). `test_force_images_cli_flag_parsed` deckt Default `False` und `True` ab.

Weil das Flag am Hauptparser hängt, akzeptieren auch `prepare`/`export`/`image-export` es klaglos und ignorieren es. Der Help-Text sagt explizit „nur für die deploy-Phase", also ist das Verhalten dokumentiert; eine Subparser-Struktur, die das Flag nur bei `deploy` zuließe, wäre strenger, lohnt den Umbau hier aber nicht.

### Constraints und Sicherheits-/TLS-Pfad

Der Diff fasst `_ReuseTLS_FTP` und `_ftps_connect` nicht an, wie gefordert; die Tests laufen ausschließlich über `FakeFTP`/`MlsdFakeFTP`, kein echter Deploy-/Netzwerkpfad. Die durch `--force-images` geänderte Trust-Boundary betrifft nur, *ob* ein bereits vorhandenes Bild überschrieben wird, nicht *wohin* oder *mit welchen Credentials* — keine Auth- oder Transport-Lücke.

### Spec-Aktualisierung

requirements.md umformuliert Req 4.11 (kein Pro-Datei-Warnen mehr), ergänzt Req 4.12 (image-export-Zusammenfassung), passt Req 3.11 (prepare-Zusammenfassung) an und fügt Req 6.16–6.18 (Prune betritt Geschütztes nicht, MLSD-Listing+Fallback, `--force-images`) hinzu. design.md dokumentiert `_ftp_list_entries`/MLSD, das ruhige Logging und die Prune-/Force-Images-Semantik — konsistent mit dem Code.

</details>

<details>
<summary>Dateien</summary>

- `scripts/weinimport.py` — neues `_ftp_list_entries` (MLSD+Fallback), Prune überspringt geschützte Dirs, `_ftp_download_dir` auf MLSD-Helfer umgestellt, ruhiges Logging in `phase_prepare`/`rename_file_group`/`phase_image_export`, `--force-images` in `build_parser`/`main`/`phase_deploy`/`_deploy_ftp`.
- `scripts/tests/test_deploy.py` — `MlsdFakeFTP`, Prune-MLSD/Schutz-Tests, `--force-images`-Tests, CLI-Flag-Test.
- `scripts/tests/test_image_export.py` — Zusammenfassung statt Pro-Bild-Warnung, fehlende-Quelle-Zählung.
- `scripts/tests/test_prepare.py` — Kollision erzeugt Zusammenfassung statt Pro-Datei-Warnung.
- `.kiro/specs/weinliste/requirements.md` — Req 3.11/4.11 angepasst, 4.12 und 6.16–6.18 ergänzt.
- `.kiro/specs/weinliste/design.md` — MLSD-Listing, ruhiges Logging, Prune-/Force-Images-Doku.
- `Makefile` — `FORCE_IMAGES=1` → `--force-images` Durchreichung.

Voller Diff: `git diff HEAD~1...HEAD`.

</details>
