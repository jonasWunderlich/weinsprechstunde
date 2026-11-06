# Token-Baseline: Domänen-Split der Specs

Schätzung: Tokens ≈ Bytes / 4 (grob, für Vergleiche ausreichend). Gemessen mit `wc -c`/`os.path.getsize`.

## Vorher (Monolith, archiviert in `.kiro/specs/_archive/weinliste-monolith/`)
| Datei | Bytes | ~Tokens |
|---|---|---|
| requirements.md | 73.416 | 18.354 |
| design.md | 121.603 | 30.401 |
| tasks.md | 34.528 | 8.632 |
| **Summe (3 Spec-Dateien)** | **229.547** | **57.387** |
| tasks.meta.json (nur Metadaten) | 11.030 | 2.758 |

Vorher gab es in HEAD kein `.kiro/steering/`. Jede Arbeit an einem Feature der Weinliste-Spec brachte (bei Spec-Nutzung) alle 229.547 Bytes in den Kontext, unabhängig von der Domäne.

## Nachher
### Immer geladen (`inclusion: always`)
| Datei | Bytes |
|---|---|
| steering/product.md | 1.056 |
| steering/contracts-index.md | 1.380 |
| **Summe** | **2.436 (~609 Tokens)** |

### Bei Bedarf (domain-*.md `inclusion: auto`, orchestration.md `fileMatch` Makefile/.github)
| Datei | Bytes |
|---|---|
| domain-editor.md | 783 |
| domain-weinliste.md | 728 |
| domain-pipeline.md | 844 |
| domain-deploy-ftp.md | 753 |
| domain-shared.md | 784 |
| orchestration.md | 1.162 |

### Specs je Domäne
| Datei | Bytes |
|---|---|
| editor/requirements.md / design.md / tasks.md | 9.325 / 9.960 / 714 |
| weinliste/requirements.md / design.md / tasks.md | 10.798 / 8.264 / 872 |
| pipeline/requirements.md / design.md / tasks.md | 8.060 / 9.586 / 261 |
| deploy-ftp/requirements.md / design.md / tasks.md | 4.863 / 4.348 / 123 |

### Verträge (`.kiro/specs/contracts/`)
| Datei | Bytes |
|---|---|
| contracts-index.md | 1.876 |
| import-format.md | 3.613 |
| editor-output.md | 2.765 |
| export-format.md | 2.413 |
| shared-api.md | 4.587 |
| deploy-input.md | 2.388 |
| build-output.md | 1.588 |
| fixtures/ | (Testdaten, werden nicht in den Kontext geladen) |

## Ladeumfang je Domäne (always + Domain-Steering + referenzierte Verträge/Specs)
| Aufgabe | Bytes | ~Tokens | vs. 229.547 Bytes vorher |
|---|---|---|---|
| editor | 34.183 | 8.546 | −85 % |
| weinliste | 30.098 | 7.525 | −87 % |
| pipeline | 29.978 | 7.495 | −87 % |
| deploy-ftp | 16.499 | 4.125 | −93 % |
| shared | 7.807 | 1.952 | −97 % |

Hinweis: Der Vorher-Wert gilt nur, wenn der Monolith geladen wurde. Der Nachher-Wert nimmt an, dass das Domain-Steering samt `#[[file:…]]`-Referenzen vollständig eingebunden wird (Obergrenze; Specs können auch gezielt gelesen werden). Das Archiv wird nicht geladen.

## Vergleich typischer Aufgaben mit den Credit-Hooks
Vorhandene Hooks in `.kiro/hooks` (nicht ändern): `credit-prompt-snapshot` (promptSubmit, `credit-prompt-tracker.py snapshot`) und `credit-ledger` (agentStop, `credit-prompt-tracker.py record`). Sie protokollieren den Credit-Verbrauch je Prompt/Sitzung.

Vorgehen:
1. Gleiche Aufgabe auf zwei Ständen ausführen: alter Stand (Commit vor dem Split, Monolith unter `.kiro/specs/weinliste/`) und neuer Stand. Je Stand eine frische Sitzung.
2. Aufgaben: (a) nur Editor, z. B. ein Feld im Editor-Formular ergänzen oder ändern; (b) nur Pipeline, z. B. eine Normalisierungsregel in `prepare` ändern; optional (c) nur Deploy.
3. Identischer Prompt, gleiches Modell, je Aufgabe nur ein Prompt. Credit-Wert aus dem Ledger (Snapshot vor, Record nach der Sitzung) ablesen und die Differenz je Aufgabe vergleichen.
4. Mehrfach wiederholen (mind. 3 Läufe), da der Verbrauch schwankt; Median vergleichen.
Erwartung: Der Kontext-Anteil sinkt etwa um die Werte der Tabelle oben; der Gesamtverbrauch sinkt weniger, weil Tool-Ausgaben und Modellantworten nicht vom Split abhängen.
