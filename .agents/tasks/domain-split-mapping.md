# Mapping: weinliste-Monolith → Domänen-Specs

Alt: `.kiro/specs/_archive/weinliste-monolith/` (nicht laden). Neu: `.kiro/specs/<domain>/{requirements,design,tasks}.md` und `.kiro/specs/contracts/`.
Kürzel: P = pipeline, W = weinliste, E = editor, D = deploy-ftp, C = contracts.

## Requirements

| Alt | Neu | Hinweis |
|---|---|---|
| Req 1 (1.1–1.16) | P/requirements.md Req 1 | inkl. Remote-Import (1.8–1.11) und Deploy-Config-Keys/Secrets (1.14–1.15) |
| Req 2 | P/requirements.md Req 2 | |
| Req 3 | P/requirements.md Req 3 | |
| Req 4 | P/requirements.md Req 4 | |
| Req 5 | D/requirements.md Req 5 | Makefile/CI-Orchestrierung; 5.1 verweist auf build-output |
| Req 6 (6.1–6.18) | D/requirements.md Req 6 | |
| Req 7–14 | W/requirements.md Req 7–14 | |
| Req 15 (15.1–15.5, 15.7–15.11) | W/requirements.md Req 15 | |
| Req 15.6 | P/requirements.md „Requirement 15 (Teil)" | Kriterium-Split |
| Req 16 | E/requirements.md Req 16 | |
| Req 17 (17.1–17.50) | E/requirements.md Req 17 | |
| Req 17.51 | P/requirements.md „Requirement 17 (Teil)" | Kriterium-Split; Gegenstück `_archive` in C/import-format |
| Req 18 | C/import-format.md „Schema-Regeln (Req 18)" | Vertragsinhalt; Konsumenten referenzieren |
| Req 19 | W/requirements.md Req 19 | Property 19 in C/shared-api |
| Req 20 | P/requirements.md Req 20 | |
| Einleitung | gekürzt in W (Orientierung), E (Glossar WineEditorApp), P (Kopf) | |
| Glossar | je Domäne nur relevante Begriffe (P: ImportScript, ConfigFile, WineSchema, scaffold_mode, Slug, BackupConfig, import_source; D: PhaseDeploy, DeployConfig, GitHubSecrets; W: App…KeyboardShortcuts; E: WineEditorApp, WineEditor, ImagePicker, Entwurf) | |

## Design-Kapitel

| Alt | Neu |
|---|---|
| Overview / Architecture / Data Flow | verteilt: Pfade je Domäne (P, W, E Abschnitt „Pfade"); Gesamtbild entfällt |
| Central Configuration Files: `weinsprechstunde.config.json` | P/design.md; Deploy-Keys zusätzlich in C/deploy-input |
| Central Configuration Files: `wine-schema.json` | Datei im Root; Regeln in C/import-format; Beispieltabelle entfällt (Datei selbst maßgeblich) |
| 1 Import-Skript: Einstiegspunkt | P/design.md (CLI), D/design.md (Aufrufe deploy) |
| 1: Konfiguration laden, Hilfsfunktionen | P/design.md |
| 1: Phase backup, Remote-Import-Download | P/design.md |
| 1: Phase prepare, export, image-export | P/design.md |
| 1: Phase deploy, FTPES, MLSD, TLS-Reuse, Deploy-Logik, Root-Rewrite | D/design.md |
| 1: GitHub Actions Workflow | D/design.md |
| 1: Python-Bibliotheken | P/design.md |
| 2 Angular Frontend (Router, Komponenten, Services, ControlsRow, Sort, Grid, Tile, Nav, Dialog, AppComponent, Tastaturkürzel) | W/design.md |
| 2: FilterService, `applyFiltersAndSort`, UserPreferencesService (Code) | C/shared-api.md (Schnittstelle), W/design.md (Nutzung) |
| 3 Wine Editor (Technologie, Sicherheit, FS-Access, Operationen, Auto-Save, Entwurf, Archiv, Cloud-Sync, Frontend, Formular, ImagePicker) | E/design.md; Auto-Save-/Schreibregeln in C/editor-output |
| Data Models Python | P/design.md |
| Data Models TypeScript | C/shared-api.md (Wine, WineFilter, SortOption, LoadState, WineSchemaField, UserPreferences) |
| Correctness Properties | siehe unten |
| Error Handling | zeilenweise: Python/Backup/Remote → P; Deploy → D; Frontend → W; Editor → E |
| Testing Strategy | Python Import → P; Deploy-Tests → D; Frontend → W; Editor → E; Fixture-Tests → C/contracts-index |
| tasks.md / tasks.meta.json | Archiv; offene Tasks → `<domain>/tasks.md` |

## Properties

| Property | Neu |
|---|---|
| 1, 2, 3, 4, 5, 6, 8, 9 | P/design.md |
| 7 (JSON-Roundtrip) | C/export-format.md |
| 10, 11, 12, 13, 14, 15, 16 | W/design.md |
| 17 | E/design.md |
| 18 (WineSchema-Roundtrip) | C/import-format.md |
| 19 (UserPreferences-Roundtrip) | C/shared-api.md |
| 20, 21 | P/design.md |
| 22 | existiert im Original nicht (Nummer fehlt, Lücke 21 → 23) |
| 23, 24, 25, 26, 27 | E/design.md |
| 28 (Schema-fremde Felder, Roundtrip) | C/editor-output.md |

## Offene Tasks (aus dem Monolithen)

| Alt | Neu |
|---|---|
| 23.2 Pfeiltasten-Unit-Tests | W/tasks.md 1 |
| 34.2 Escape-Unit-Tests | W/tasks.md 2 |
| 25.3 Shared-Library-Tests | W/tasks.md 3 |
| 28.2 / 28.3 / 28.4 (Properties 17, 27, 28) | E/tasks.md 1–3 |
| 30.2 / 30.3 (Properties 24, 25) | E/tasks.md 4–5 |
| Neu: Fixture-Tests ausführen | P/tasks.md 1, W/tasks.md 4, E/tasks.md 6 |
