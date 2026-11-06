# Review Domänen-Split

Verdikt: APPROVED (keine Blocker). Quelle: Working Tree, `domain-split-verification.md` (Tests nicht erneut ausgeführt).

## Prüfpunkte
1. Mapping: Alle 20 Requirements sind in den neuen Specs vorhanden. Die Kriterien-Anzahl je Requirement stimmt mit dem Archiv überein (Req 15.6 und 17.51 zur Pipeline gesplittet, Summen passen). Req 18 steht als Schema-Regeln in `contracts/import-format.md` (6 Kriterien als Bullets). Alle 27 vorhandenen Properties (1–21, 23–28) sind in den neuen design.md oder Verträgen auffindbar. Property 22 fehlt schon im Original. Keine verlorene Anforderung gefunden.
2. Steering: Front-Matter ist gültig. `product.md` und `contracts-index.md` (always) sind zusammen 2.436 Bytes. `orchestration.md` ist fileMatch mit `Makefile` und `.github/**`. Die fünf `domain-*.md` haben `inclusion: auto` mit name und description.
3. Referenzen per grep: editor lädt import-format, editor-output, shared-api; weinliste lädt export-format, shared-api; pipeline lädt import-format, editor-output, export-format; deploy-ftp lädt deploy-input, build-output. Es gibt keine Specs anderer Domänen. Hinweis (kein Blocker): editor und weinliste referenzieren zusätzlich `build-output`, den sie selbst als Produzent besitzen. Das entspricht dem Muster pipeline → export-format. Der Mehrverbrauch ist 1,6 KB.
4. Verträge gegen Code geprüft:
   - `_resolve_dist_dir` und die Deploy-Reihenfolge in `weinimport.py`.
   - `outputPath` in `angular.json` (`dist/weinliste`, `dist/editor`).
   - Makefile `deploy` und `deploy.yml` (CI baut nur die Weinliste, Editor wird übersprungen).
   - `deploy.remote_editor_path` hat im Code den Default `""`.
   Keine Abweichung gefunden.
5. Nicht angefasst: `.kiro/hooks` (zwei Dateien, Stand 4. Nov., nie getrackt, unverändert). `scripts/weinimport.py` und Anwendungslogik sind unverändert. Neu sind nur Tests und `frontend/eslint.config.mjs`. Das Archiv ist per `git mv` verschoben (R-Status) und enthält die README „Nicht laden". Die ESLint-Grenze ist vorhanden (`no-restricted-imports` in beide Richtungen), laut Verifikation mit Negativtest. `eslint` und `typescript-eslint` sind exakt gepinnt.
6. Größe: Vorher 229.547 Bytes (Monolith). Nachher laden editor ca. 34 KB (−85 %), weinliste ca. 30 KB, pipeline ca. 30 KB, deploy-ftp ca. 16 KB, shared ca. 8 KB. Das ist deutlich besser als das Ziel von 1/3–1/2. Das ist dokumentiert in `token-baseline.md`, samt Hook-basiertem Messvorgehen. Die Werte sind Bytes/4-Schätzungen und eine Obergrenze.

## Offene Hinweise (keine Blocker)
- `contracts/deploy-input.md` nennt als Ist-Wert `remote_path` `/`, `remote_editor_path` `/edit` usw. Das sind uncommittete lokale Änderungen in `weinsprechstunde.config.json`. Im Commit stehen `/wine_app...`. Vor dem Commit klären, welche Werte gelten sollen. Die Config und `nav.ts` stammen nicht aus dem Split und sollten nicht mitcommittet werden, falls unbeabsichtigt.
- `frontend/package.json` und `package-lock.json` wurden für ESLint geändert. Das gilt nach der Shared-Regel als Shared-Änderung.
