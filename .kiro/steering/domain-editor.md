---
name: domain-editor
description: Editor-App (Angular, frontend/projects/editor) zum Pflegen der Wein-Importdaten. Laden bei Arbeit an Editor, Import-JSON-Bearbeitung, editor-output, Editor-Build oder Editor-Specs.
inclusion: auto
---
# Domäne editor

Scope: `frontend/projects/editor/**`. Nicht lesen: weinliste, pipeline, deploy-ftp. `shared` nur lesen, wenn nötig, über den Vertrag shared-api.

Ändert sich shared nicht, nur das Projekt editor prüfen, bauen und testen.

## Verträge
- #[[file:.kiro/specs/contracts/import-format.md]]
- #[[file:.kiro/specs/contracts/editor-output.md]]
- #[[file:.kiro/specs/contracts/shared-api.md]]

## Specs
- #[[file:.kiro/specs/editor/requirements.md]]
- #[[file:.kiro/specs/editor/design.md]]
- #[[file:.kiro/specs/editor/tasks.md]]
